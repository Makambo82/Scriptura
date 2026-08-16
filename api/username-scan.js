// ═══════════════════════════════════════════════════════════
//  /api/username-scan, Diagnostic sommaire via @nom d'utilisateur TikTok
//
//  Deux sources complémentaires :
//    • PROFIL  → LamaTok (/v1/user/by/username) : abonnés, likes cumulés,
//      nb de vidéos, bio, statut vérifié. (clé LAMATOK_API_KEY)
//    • VIDÉOS  → ScrapTik (/user-posts) : liste des dernières vidéos avec
//      vues / likes / commentaires / partages / date par vidéo. LamaTok ne
//      liste PAS les vidéos d'un compte (catalogue vérifié), ScrapTik oui.
//      (clé SCRAPTIK_API_KEY, via RapidAPI)
//
//  L'id numérique du compte est déjà fourni par le profil LamaTok : on le
//  passe tel quel à ScrapTik → une seule requête ScrapTik par diagnostic.
//
//  Non-régressif : si SCRAPTIK_API_KEY est absente ou si l'appel échoue,
//  `medias` reste null et le client retombe sur l'Engagement seul (profil).
//
//  Les clés restent entièrement côté serveur : jamais exposées au navigateur.
//  Debug : body.debug=true renvoie _debug (id extrait + réponses ScrapTik).
// ═══════════════════════════════════════════════════════════

const LAMA_BASE = 'https://api.lamatok.com';
const SCRAPTIK_HOST = 'scraptik.p.rapidapi.com';

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

// Tronque une chaîne à N caractères max SANS couper une paire de substituts
// UTF-16 (emoji) en deux : sinon le caractère orphelin, une fois envoyé dans
// un prompt à Claude, fait planter le parseur JSON strict de l'API en aval
// ("no low surrogate in string", 400). Les légendes TikTok sont pleines
// d'emoji, à appliquer ici avant tout .slice() sur du texte utilisateur.
function tronquerSansCouperEmoji(str, n) {
  if (typeof str !== 'string' || str.length <= n) return str || '';
  let s = str.slice(0, n);
  const dernier = s.charCodeAt(s.length - 1);
  if (dernier >= 0xD800 && dernier <= 0xDBFF) s = s.slice(0, -1);
  return s;
}

// Nettoie la clé RapidAPI : si on a collé tout le snippet cURL dans la
// variable d'environnement (erreur fréquente), on en extrait la vraie valeur
// du header ; sinon on retire simplement espaces, retours et guillemets.
function nettoyerCle(k) {
  if (!k) return '';
  const s = String(k);
  const m = s.match(/x-rapidapi-key:\s*['"]?([A-Za-z0-9]{20,})/i);
  if (m) return m[1];
  return s.trim().replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, '');
}

// Résout l'objet utilisateur dans le profil LamaTok, rangé sous
// users = { "<pseudo>": { id, secUid, ... } }, et en extrait id + secUid.
function extraireIds(profil) {
  let u = (profil && (profil.users || profil.user)) || {};
  if (Array.isArray(u)) u = u[0] || {};
  if (u && typeof u === 'object' && u.id == null && u.secUid == null) {
    const c = Object.values(u).find(v => v && typeof v === 'object' && (v.id != null || v.secUid != null));
    if (c) u = c;
  }
  const id = u.id || u.uid || u.user_id || null;
  const secUid = u.secUid || u.sec_uid || null;
  return { id: id ? String(id) : null, secUid: secUid ? String(secUid) : null };
}

// Aplati la réponse ScrapTik (aweme_list) et extrait, par vidéo, les seuls
// champs utiles au diagnostic, en tolérant les alias de nommage.
function normaliserMedias(data) {
  const brut =
    data?.aweme_list || data?.awemeList || data?.items || data?.itemList ||
    data?.videos || data?.data?.aweme_list || data?.data?.items ||
    (Array.isArray(data) ? data : []);
  if (!Array.isArray(brut)) return [];

  return brut.map(m => {
    const s = m.statistics || m.stats || m;
    const num = (...vals) => {
      for (const v of vals) if (v != null && !Number.isNaN(Number(v))) return Number(v);
      return null;
    };
    const vues = num(s.play_count, s.playCount, m.play_count);
    const likes = num(s.digg_count, s.diggCount, s.like_count, s.likeCount);
    const comm = num(s.comment_count, s.commentCount);
    const partages = num(s.share_count, s.shareCount);
    let date = m.create_time ?? m.createTime ?? m.created_at ?? null;
    if (date != null) { date = Number(date); if (date > 1e12) date = Math.round(date / 1000); }
    // Sujet de la vidéo (légende) : indispensable pour analyser le CONTENU
    // (niche réelle, top/flop, concepts récurrents), pas seulement les chiffres.
    const desc = tronquerSansCouperEmoji(String(m.desc || m.description || m.title || m.content || '').trim(), 220);
    return {
      vues: vues ?? null, likes: likes ?? null,
      commentaires: comm ?? null, partages: partages ?? null,
      date: date ?? null, desc
    };
  }).filter(v => v.vues != null || v.likes != null);
}

// Récupère les vidéos d'un compte via ScrapTik /user-posts (avec l'id
// numérique du compte), sur une fenêtre d'HISTORIQUE de ~6 mois. Assez large
// pour couvrir un PIVOT de contenu (le client compare alors avant/après et
// repère la formule gagnante, même ancienne ; les 4 dimensions restent, elles,
// calculées sur le récent). Pagine via max_cursor (vidéos renvoyées de la plus
// récente à la plus ancienne) et s'arrête dès qu'on sort de la fenêtre.
// Deux garde-fous : un PLANCHER (au moins MIN vidéos même si peu publiées) et
// un PLAFOND (MAX vidéos, pour borner coût et latence sur les gros comptes).
// Renvoie la liste normalisée, ou null si tout échoue (non-régressif :
// le diagnostic retombe alors sur l'Engagement).
async function recupererVideos(key, ids) {
  if (!ids.id && !ids.secUid) return null;
  const h = { 'x-rapidapi-key': key, 'x-rapidapi-host': SCRAPTIK_HOST };
  const JOURS_FENETRE = 180;  // ~6 mois (pour voir un éventuel pivot)
  const MIN = 20;             // plancher de fiabilité
  const MAX = 90;             // plafond de coût/latence
  // Borne dure ramenée de 6 à 3 pages : chaque page = 1 requête RapidAPI, et le
  // quota mensuel ScrapTik (plan BASIC) brûle vite. 3 pages (~90 vidéos)
  // couvrent largement les 4 dimensions (calculées sur le récent) et gardent
  // assez d'historique pour la détection de pivot.
  const MAX_PAGES = 3;        // borne dure (ScrapTik ~2-4 s/page, économie quota)
  const BUDGET_MS = 18000;    // budget temps total (bien sous les 60 s Vercel)
  const cutoff = Math.floor(Date.now() / 1000) - JOURS_FENETRE * 86400;
  const t0 = Date.now();

  const toutes = [];          // ordre : de la plus récente à la plus ancienne
  const vues = new Set();     // dédoublonnage léger (date|vues|début de légende)
  let cursor = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() - t0 > BUDGET_MS) break; // ne jamais risquer le timeout Vercel
    const base = ids.id ? { user_id: ids.id } : { sec_uid: ids.secUid };
    const url = 'https://' + SCRAPTIK_HOST + '/user-posts?' +
      new URLSearchParams({ ...base, count: 30, max_cursor: cursor }).toString();
    // Timeout par page : une page ScrapTik lente ne doit pas bloquer la fonction.
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 7000);
    let rep;
    try { rep = await fetch(url, { headers: h, signal: ctrl.signal }); }
    catch (e) { break; }
    finally { clearTimeout(minuteur); }
    if (!rep.ok) break;
    let data; try { data = await rep.json(); } catch (e) { break; }
    const lot = normaliserMedias(data);

    for (const v of lot) {
      const cle = `${v.date}|${v.vues}|${(v.desc || '').slice(0, 24)}`;
      if (!vues.has(cle)) { vues.add(cle); toutes.push(v); }
    }

    // La dernière vidéo de la page est-elle déjà hors fenêtre ? (les suivantes
    // le seront aussi, ScrapTik renvoyant du plus récent au plus ancien.)
    const dernier = lot[lot.length - 1];
    const pageHorsFenetre = dernier && typeof dernier.date === 'number' && dernier.date < cutoff;

    const hasMore = data && (data.has_more ?? data.hasMore);
    const suivant = data && (data.max_cursor ?? data.maxCursor ?? data.cursor);
    if (!lot.length || !hasMore || suivant == null ||
        Number(suivant) === Number(cursor) || toutes.length >= MAX) break;
    // On a assez de vidéos récentes et on est sorti de la fenêtre : inutile de
    // continuer à remonter dans le temps.
    if (pageHorsFenetre && toutes.length >= MIN) break;
    cursor = suivant;
  }

  if (!toutes.length) return null;
  // Fenêtre 2 mois (les vidéos sans date sont conservées, non filtrables) ;
  // si cela laisse moins que le plancher, on complète avec les plus récentes.
  const recentes = toutes.filter(v => typeof v.date !== 'number' || v.date >= cutoff);
  const final = recentes.length >= MIN ? recentes : toutes.slice(0, Math.max(MIN, recentes.length));
  return final.length ? final : null;
}

// Diagnostic (GET ?username=NOM&debug=1) : dit POURQUOI les vidéos ne remontent
// pas, sans JAMAIS exposer les clés. Consultable directement au navigateur.
async function scanDebug(propre, lamaKey, scrapKey) {
  const out = { username: propre, lamaKeyPresent: !!lamaKey, scrapKeyPresent: !!scrapKey };
  let profil = null;
  try {
    const r = await fetch(LAMA_BASE + '/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } });
    out.lamaStatus = r.status;
    profil = await r.json();
  } catch (e) { out.lamaErreur = e.message; }
  const ids = extraireIds(profil || {});
  out.idCompte = ids.id ? 'trouvé' : 'ABSENT';
  out.secUid = ids.secUid ? 'trouvé' : 'ABSENT';
  if (!scrapKey) { out.scrapRaison = 'SCRAPTIK_API_KEY absente côté serveur'; return out; }
  if (!ids.id && !ids.secUid) { out.scrapRaison = 'id du compte introuvable dans le profil LamaTok'; return out; }
  try {
    const base = ids.id ? { user_id: ids.id } : { sec_uid: ids.secUid };
    const url = 'https://' + SCRAPTIK_HOST + '/user-posts?' + new URLSearchParams({ ...base, count: 10, max_cursor: 0 }).toString();
    const r = await fetch(url, { headers: { 'x-rapidapi-key': scrapKey, 'x-rapidapi-host': SCRAPTIK_HOST } });
    out.scrapStatus = r.status;
    let data = null;
    try { data = await r.json(); } catch (e) { out.scrapNonJson = true; }
    if (data) {
      out.scrapClesReponse = Object.keys(data).slice(0, 12);
      out.videosNormalisees = normaliserMedias(data).length;
      if (!out.videosNormalisees) out.scrapMessage = String(data.message || data.error || data.msg || JSON.stringify(data)).slice(0, 200);
    }
  } catch (e) { out.scrapErreur = e.message; }
  return out;
}

export default async function handler(req, res) {
  const lamaKey = process.env.LAMATOK_API_KEY;
  const scrapKey = nettoyerCle(process.env.SCRAPTIK_API_KEY);

  // Diagnostic ouvrable au navigateur (GET). Ne renvoie jamais les clés.
  if (req.method === 'GET') {
    const username = ((req.query && (req.query.username || req.query.u)) || '').toString().trim().replace(/^@+/, '');
    const debug = req.query && (req.query.debug || req.query.d);
    if (!debug || !username) return res.status(400).json({ error: { message: 'Debug : /api/username-scan?username=NOM&debug=1' } });
    if (!lamaKey) return res.status(200).json({ _debug: { lamaKeyPresent: false, scrapKeyPresent: !!scrapKey } });
    return res.status(200).json({ _debug: await scanDebug(username, lamaKey, scrapKey) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  if (!lamaKey) {
    return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });
  }

  try {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: { message: "Nom d'utilisateur manquant" } });
    }
    const propre = username.trim().replace(/^@+/, '');

    // 1) Profil via LamaTok
    const repProfil = await fetch(
      LAMA_BASE + '/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } }
    );
    const profil = await repProfil.json();
    if (!repProfil.ok) {
      const message = (profil && (profil.message || profil.error)) || 'Profil introuvable ou privé';
      return res.status(repProfil.status).json({ error: { message } });
    }

    // 2) Vidéos via ScrapTik (si la clé est configurée), avec l'id du profil.
    const ids = extraireIds(profil);
    let medias = null;
    if (scrapKey) {
      try { medias = await recupererVideos(scrapKey, ids); }
      catch (e) { medias = null; }
      // Auto-réessai UNE fois si aucune vidéo n'est revenue (raté ScrapTik
      // transitoire : lenteur, hoquet) : évite l'affichage « données non
      // fournies » sur un compte qui a bien des vidéos. Coût borné.
      if (!medias) {
        await attendre(900);
        try { medias = await recupererVideos(scrapKey, ids); } catch (e) {}
      }
    }

    return res.status(200).json({ profil, medias });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

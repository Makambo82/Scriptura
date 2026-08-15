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
    const desc = String(m.desc || m.description || m.title || m.content || '').trim().slice(0, 220);
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
async function recupererVideos(key, ids, journal) {
  if (!ids.id && !ids.secUid) { if (journal) journal.push({ erreur: 'aucun id/secUid extrait du profil' }); return null; }
  const h = { 'x-rapidapi-key': key, 'x-rapidapi-host': SCRAPTIK_HOST };
  const JOURS_FENETRE = 180;  // ~6 mois (pour voir un éventuel pivot)
  const MIN = 20;             // plancher de fiabilité
  const MAX = 90;             // plafond de coût/latence
  const MAX_PAGES = 6;        // borne dure (ScrapTik ~2-4 s/page)
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
    catch (e) { if (journal) journal.push({ page, erreur: String(e.name || e.message || e) }); break; }
    finally { clearTimeout(minuteur); }
    const texte = await rep.text().catch(() => '');
    let data = null; try { data = JSON.parse(texte); } catch (e) {}
    const lot = data ? normaliserMedias(data) : [];
    if (journal) journal.push({ page, params: Object.keys(base).join('+'), status: rep.status, ok: rep.ok, nbVideos: lot.length, extrait: texte.slice(0, 400) });
    if (!rep.ok) break;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const lamaKey = process.env.LAMATOK_API_KEY;
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
    const debug = req.body?.debug === true;
    const ids = extraireIds(profil);
    const scrapKey = nettoyerCle(process.env.SCRAPTIK_API_KEY);
    const journal = debug ? [] : null;
    let medias = null;
    if (scrapKey) {
      try { medias = await recupererVideos(scrapKey, ids, journal); }
      catch (e) { medias = null; if (journal) journal.push({ erreurGlobale: String(e.message || e) }); }
    }

    if (debug) {
      return res.status(200).json({
        profil, medias,
        _debug: { idsExtraits: ids, scraptikConfiguree: !!scrapKey, nbVideos: medias ? medias.length : 0, tentatives: journal }
      });
    }
    return res.status(200).json({ profil, medias });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

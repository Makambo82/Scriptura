// ═══════════════════════════════════════════════════════════
//  /api/username-scan, Diagnostic sommaire via @nom d'utilisateur TikTok
//
//  Deux sources complémentaires :
//    • PROFIL  → LamaTok (/v1/user/by/username) : abonnés, likes cumulés,
//      nb de vidéos, bio, statut vérifié. (clé LAMATOK_API_KEY)
//    • VIDÉOS  → TikHub (/fetch_user_post) : liste des dernières vidéos avec
//      vues / likes / commentaires / partages / date par vidéo. LamaTok ne
//      liste PAS les vidéos d'un compte (catalogue vérifié). (clé
//      TIKHUB_API_KEY, payé au crédit, sans abonnement fixe)
//
//  TikHub a besoin du secUid (pas de l'id numérique) pour lister les vidéos.
//  On réutilise d'abord celui déjà présent dans le profil LamaTok (coût
//  zéro) ; s'il manque, un seul appel TikHub supplémentaire (fetch_user_profile)
//  va le chercher.
//
//  Non-régressif : si TikHub ne répond pas, `medias` reste null et le client
//  retombe sur l'Engagement seul (profil).
//
//  Les clés restent entièrement côté serveur : jamais exposées au navigateur.
//  Debug : body.debug=true renvoie _debug (id extrait + réponses des sources).
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierQuota, verifierLimiteAnonyme } from './_lib/acces.js';

const LAMA_BASE = 'https://api.lamatok.com';
const TIKHUB_BASE = 'https://api.tikhub.io';
const PLAFOND_ANONYME_JOUR = 5; // filet IP, coûte 2 API payées par appel

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

// Aplati la réponse TikHub (data.itemList) et extrait, par vidéo, les seuls
// champs utiles au diagnostic, en tolérant les alias de nommage.
function normaliserMedias(data) {
  const brut =
    data?.itemList || data?.data?.itemList ||
    data?.aweme_list || data?.awemeList || data?.items ||
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

// secUid via TikHub (fetch_user_profile), seulement si le profil LamaTok ne
// l'avait pas déjà fourni : coût d'UN crédit TikHub supplémentaire, à éviter
// quand on peut. Chemin confirmé sur de vraies réponses : data.userInfo.user.secUid.
async function secUidViaTikHub(username, key) {
  try {
    const url = TIKHUB_BASE + '/api/v1/tiktok/web/fetch_user_profile?' +
      new URLSearchParams({ uniqueId: username }).toString();
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + key } });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.data?.userInfo?.user?.secUid || data?.data?.user?.secUid || null;
  } catch (e) { return null; }
}

// Récupère les vidéos d'un compte via TikHub /fetch_user_post (secUid
// obligatoire), sur une fenêtre d'HISTORIQUE de ~6 mois. Assez large pour
// couvrir un PIVOT de contenu (le client compare alors avant/après et repère
// la formule gagnante, même ancienne ; les 4 dimensions restent, elles,
// calculées sur le récent). Pagine via cursor et s'arrête dès qu'on sort de
// la fenêtre (cursor/hasMore non confirmés dans la réponse : on pagine
// seulement s'ils sont présents, sinon UNE page de 30 vidéos suffit déjà à
// couvrir le plancher MIN). Deux garde-fous : un PLANCHER (au moins MIN
// vidéos même si peu publiées) et un PLAFOND (MAX vidéos, pour borner coût
// et latence sur les gros comptes). Renvoie la liste normalisée, ou null si
// tout échoue (non-régressif : le diagnostic retombe alors sur l'Engagement).
async function recupererVideosTikHub(key, secUid) {
  if (!secUid) return null;
  const h = { Authorization: 'Bearer ' + key };
  const JOURS_FENETRE = 180;  // ~6 mois (pour voir un éventuel pivot)
  const MIN = 20;             // plancher de fiabilité
  const MAX = 90;             // plafond de coût/latence
  const MAX_PAGES = 3;        // borne dure (économie de crédits)
  const BUDGET_MS = 18000;    // budget temps total (bien sous les 60 s Vercel)
  const cutoff = Math.floor(Date.now() / 1000) - JOURS_FENETRE * 86400;
  const t0 = Date.now();

  const toutes = [];          // ordre : de la plus récente à la plus ancienne
  const vues = new Set();     // dédoublonnage léger (date|vues|début de légende)
  let cursor = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() - t0 > BUDGET_MS) break; // ne jamais risquer le timeout Vercel
    const url = TIKHUB_BASE + '/api/v1/tiktok/web/fetch_user_post?' +
      new URLSearchParams({ secUid, count: 30, cursor }).toString();
    // Timeout par page : une page TikHub lente ne doit pas bloquer la fonction.
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
    // le seront aussi, TikHub renvoyant du plus récent au plus ancien.)
    const dernier = lot[lot.length - 1];
    const pageHorsFenetre = dernier && typeof dernier.date === 'number' && dernier.date < cutoff;

    const d = data && data.data;
    const hasMore = d && (d.hasMore ?? d.has_more);
    const suivant = d && (d.cursor ?? d.max_cursor ?? d.maxCursor);
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
async function scanDebug(propre, lamaKey, tikhubKey) {
  const out = { username: propre, lamaKeyPresent: !!lamaKey, tikhubKeyPresent: !!tikhubKey };
  let profil = null;
  try {
    const r = await fetch(LAMA_BASE + '/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } });
    out.lamaStatus = r.status;
    profil = await r.json();
  } catch (e) { out.lamaErreur = e.message; }
  const ids = extraireIds(profil || {});
  out.idCompte = ids.id ? 'trouvé' : 'ABSENT';
  out.secUid = ids.secUid ? 'trouvé (profil LamaTok)' : 'ABSENT du profil LamaTok';

  if (!tikhubKey) { out.tikhubRaison = 'TIKHUB_API_KEY absente côté serveur'; return out; }

  let secUid = ids.secUid;
  if (!secUid) { secUid = await secUidViaTikHub(propre, tikhubKey); out.secUidViaTikHub = secUid ? 'trouvé' : 'ABSENT'; }
  if (!secUid) { out.tikhubRaison = 'secUid introuvable'; return out; }

  try {
    const url = TIKHUB_BASE + '/api/v1/tiktok/web/fetch_user_post?' + new URLSearchParams({ secUid, count: 10 }).toString();
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tikhubKey } });
    out.tikhubStatus = r.status;
    let data = null;
    try { data = await r.json(); } catch (e) { out.tikhubNonJson = true; }
    if (data) {
      out.tikhubVideosNormalisees = normaliserMedias(data).length;
      if (!out.tikhubVideosNormalisees) out.tikhubMessage = String(data.message || data.error || JSON.stringify(data)).slice(0, 200);
    }
  } catch (e) { out.tikhubErreur = e.message; }
  return out;
}

export default async function handler(req, res) {
  const lamaKey = process.env.LAMATOK_API_KEY;
  const tikhubKey = (process.env.TIKHUB_API_KEY || '').trim();

  // Diagnostic ouvrable au navigateur (GET), réservé aux comptes admin (déclenche
  // de vrais appels payés) : ?username=NOM&debug=1&code_acces=CODE.
  if (req.method === 'GET') {
    const username = ((req.query && (req.query.username || req.query.u)) || '').toString().trim().replace(/^@+/, '');
    const debug = req.query && (req.query.debug || req.query.d);
    if (!debug || !username) return res.status(400).json({ error: { message: 'Debug : /api/username-scan?username=NOM&debug=1' } });
    const droitsDebug = await resoudreDroits((req.query && req.query.code_acces) || '');
    if (!droitsDebug.isAdmin) return res.status(403).json({ error: { message: 'Réservé aux comptes admin' } });
    if (!lamaKey) return res.status(200).json({ _debug: { lamaKeyPresent: false, tikhubKeyPresent: !!tikhubKey } });
    return res.status(200).json({ _debug: await scanDebug(username, lamaKey, tikhubKey) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  if (!lamaKey) {
    return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });
  }

  try {
    const { username, code_acces } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: { message: "Nom d'utilisateur manquant" } });
    }

    // Verrou serveur : droits réels + quota dédié (mensuel pour un plan,
    // 1 seule fois à vie sinon), jamais une valeur envoyée par le client.
    const droits = await resoudreDroits(code_acces);
    if (!droits.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });
    }
    if (droits.anonyme) {
      const limiteIP = await verifierLimiteAnonyme(req, 'username-scan', PLAFOND_ANONYME_JOUR);
      if (!limiteIP.ok) return res.status(403).json({ error: { message: 'Limite atteinte, réessaie plus tard.', code: 'QUOTA_ATTEINT' } });
    }
    const verdict = await verifierQuota(droits, 'diagnosticSommaire', code_acces);
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: 'Quota de diagnostics sommaires atteint.', code: 'QUOTA_ATTEINT', raison: verdict.raison } });
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

    // 2) Vidéos via TikHub (payé au crédit), avec le secUid du profil (déjà
    // fourni par LamaTok si présent, sinon un appel TikHub dédié va le chercher).
    let medias = null;
    if (tikhubKey) {
      const ids = extraireIds(profil);
      let secUid = ids.secUid;
      if (!secUid) secUid = await secUidViaTikHub(propre, tikhubKey);
      if (secUid) {
        try { medias = await recupererVideosTikHub(tikhubKey, secUid); }
        catch (e) { medias = null; }
        // Auto-réessai UNE fois si aucune vidéo n'est revenue (raté
        // transitoire : lenteur, hoquet). Coût borné.
        if (!medias) {
          await attendre(900);
          try { medias = await recupererVideosTikHub(tikhubKey, secUid); } catch (e) {}
        }
      }
    }

    return res.status(200).json({ profil, medias });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

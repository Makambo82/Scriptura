// ═══════════════════════════════════════════════════════════
//  FICHIER TEMPORAIRE, à supprimer une fois le format de réponse TikHub
//  vérifié. Ouvrable directement au navigateur (GET), ne révèle jamais la
//  clé. Sert à voir la vraie forme des données avant d'écrire le vrai
//  parseur dans api/username-scan.js / api/video-stt.js.
//
//  Usage : /api/debug-tikhub?username=UN_PSEUDO_TIKTOK_PUBLIC
// ═══════════════════════════════════════════════════════════

const TIKHUB_BASE = 'https://api.tikhub.io';

async function appelerTikHub(chemin, params, cle) {
  const url = TIKHUB_BASE + chemin + '?' + new URLSearchParams(params).toString();
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + cle } });
  let data = null;
  try { data = await r.json(); } catch (e) { data = { _erreurParsingJson: e.message }; }
  return { status: r.status, data };
}

export default async function handler(req, res) {
  const cle = (process.env.TIKHUB_API_KEY || '').trim();
  const username = ((req.query && req.query.username) || '').toString().trim().replace(/^@+/, '');

  if (!cle) return res.status(200).json({ _debug: { cleTikHubPresente: false } });
  if (!username) return res.status(400).json({ error: { message: 'Debug : /api/debug-tikhub?username=NOM' } });

  const out = { username };

  // 1) Profil (pour obtenir le secUid)
  const profil = await appelerTikHub('/api/v1/tiktok/web/fetch_user_profile', { uniqueId: username }, cle);
  out.profilStatus = profil.status;
  out.profilReponse = profil.data;

  const secUid =
    profil.data?.data?.userInfo?.user?.secUid || profil.data?.data?.user?.secUid ||
    profil.data?.data?.secUid || profil.data?.user?.secUid || profil.data?.secUid || null;
  out.secUidTrouve = secUid || 'ABSENT (voir profilReponse pour trouver le bon chemin)';

  if (!secUid) return res.status(200).json({ _debug: out });

  // 2) Liste des vidéos du compte
  const posts = await appelerTikHub('/api/v1/tiktok/web/fetch_user_post', { secUid, count: 5 }, cle);
  out.postsStatus = posts.status;
  out.postsReponse = posts.data;

  // 3) Détail d'une seule vidéo (si on a bien récupéré une liste)
  const premiereVideoId =
    posts.data?.data?.itemList?.[0]?.id || posts.data?.data?.aweme_list?.[0]?.aweme_id ||
    posts.data?.itemList?.[0]?.id || posts.data?.aweme_list?.[0]?.aweme_id || null;
  out.premiereVideoIdTrouve = premiereVideoId || 'ABSENT (voir postsReponse)';

  if (premiereVideoId) {
    const detail = await appelerTikHub('/api/v1/tiktok/web/fetch_post_detail', { itemId: premiereVideoId }, cle);
    out.detailStatus = detail.status;
    out.detailReponse = detail.data;
  }

  return res.status(200).json({ _debug: out });
}

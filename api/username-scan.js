// ═══════════════════════════════════════════════════════════
//  /api/username-scan — Diagnostic sommaire via @nom d'utilisateur TikTok
//  Récupère le profil PUBLIC d'un compte via LamaTok (service tiers,
//  non-officiel) ET la liste de ses dernières vidéos, puis renvoie ces
//  données brutes telles quelles : c'est js/diagnostic-sommaire.js (côté
//  client) qui en tire ensuite un diagnostic (calculs + IA).
//
//  Deux appels LamaTok :
//    1. /v1/user/by/username  → profil agrégé (abonnés, likes cumulés, bio…)
//    2. /v1/user/medias       → dernières vidéos avec vues / likes /
//                               commentaires / partages / date par vidéo.
//  Le 2e appel débloque les dimensions Portée, Régularité et Viralité, qui
//  ont besoin de données PAR vidéo (un profil seul ne les fournit pas).
//
//  Non-régressif : si l'appel medias échoue (endpoint indisponible, quota,
//  compte privé…), on renvoie quand même le profil seul avec medias:null —
//  le client retombe alors sur l'ancien comportement (Engagement seul).
//
//  La clé LamaTok reste entièrement côté serveur (LAMATOK_API_KEY) :
//  jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

const BASE = 'https://api.lamatok.com';

// Extrait l'identifiant utilisateur du profil, quel que soit le nommage
// renvoyé par LamaTok (structure TikTok : user.id / user.secUid, ou plat).
function extraireIds(profil) {
  const u = (profil && (profil.user || profil.userInfo?.user || profil.data?.user)) || profil || {};
  const id = u.id || u.uid || u.user_id || u.userId || profil?.id || null;
  const secUid = u.secUid || u.sec_uid || u.secuid || profil?.secUid || profil?.sec_uid || null;
  return { id: id ? String(id) : null, secUid: secUid ? String(secUid) : null };
}

// Tente /v1/user/medias avec plusieurs conventions de paramètres, car le nom
// exact (id / sec_uid / user_id) dépend de la version de l'API LamaTok. On
// s'arrête au premier succès ; en cas d'échec total, retourne null (le
// diagnostic reste fonctionnel avec le profil seul).
async function recupererMedias(headers, username, ids, journal) {
  // Plusieurs chemins ET conventions de paramètres testés, car le nom exact
  // (id / sec_uid / user_id) et le sous-chemin dépendent de la version de
  // l'API LamaTok. On s'arrête au premier succès qui renvoie des vidéos.
  const chemins = ['/v1/user/medias', '/v1/user/videos', '/v1/user/posts', '/v1/user/feed'];
  const jeux = [];
  if (ids.id)     jeux.push({ id: ids.id });
  if (ids.id)     jeux.push({ user_id: ids.id });
  if (ids.secUid) jeux.push({ sec_uid: ids.secUid });
  if (ids.secUid) jeux.push({ secUid: ids.secUid });
  jeux.push({ username: username });

  // Cap le nombre d'appels pour borner latence et coût. En mode debug on
  // sonde plus large (journal renseigné) ; en mode normal on se limite aux
  // combinaisons les plus probables tant que le format n'est pas confirmé.
  const MAX = journal ? 12 : 5;
  let n = 0;
  for (const chemin of chemins) {
    for (const base of jeux) {
      if (n++ >= MAX) return null;
      const params = { ...base, count: 30 };
      const url = BASE + chemin + '?' + new URLSearchParams(params).toString();
      try {
        const rep = await fetch(url, { headers });
        const texte = await rep.text();
        let data = null; try { data = JSON.parse(texte); } catch (e) {}
        const liste = data ? normaliserMedias(data) : [];
        if (journal) journal.push({
          chemin, params: Object.keys(base).join('+'),
          status: rep.status, ok: rep.ok, nbVideos: liste.length,
          extrait: texte.slice(0, 400)
        });
        if (rep.ok && liste.length) return liste;
      } catch (e) {
        if (journal) journal.push({ chemin, params: Object.keys(base).join('+'), erreur: String(e.message || e) });
      }
    }
  }
  return null;
}

// Aplati la réponse medias (les wrappers TikTok l'emballent différemment :
// aweme_list, itemList, items, data.medias…) et extrait par vidéo les seuls
// champs utiles au diagnostic, en tolérant les nombreux alias de nommage.
function normaliserMedias(data) {
  const brut =
    data?.aweme_list || data?.awemeList ||
    data?.itemList || data?.item_list ||
    data?.items || data?.medias || data?.videos ||
    data?.data?.aweme_list || data?.data?.itemList || data?.data?.items ||
    (Array.isArray(data) ? data : []);
  if (!Array.isArray(brut)) return [];

  return brut.map(m => {
    const stats = m.statistics || m.stats || m.statisticsV2 || m;
    const num = (...alias) => {
      for (const a of alias) {
        const v = a;
        if (v != null && !Number.isNaN(Number(v))) return Number(v);
      }
      return null;
    };
    const vues = num(stats.play_count, stats.playCount, stats.play, m.play_count, m.playCount);
    const likes = num(stats.digg_count, stats.diggCount, stats.like_count, stats.likeCount);
    const comm = num(stats.comment_count, stats.commentCount);
    const partages = num(stats.share_count, stats.shareCount);
    // create_time en secondes unix (TikTok) ; certains renvoient ms.
    let date = m.create_time ?? m.createTime ?? m.created_at ?? m.createdAt ?? null;
    if (date != null) { date = Number(date); if (date > 1e12) date = Math.round(date / 1000); }
    return {
      vues: vues ?? null,
      likes: likes ?? null,
      commentaires: comm ?? null,
      partages: partages ?? null,
      date: date ?? null
    };
  }).filter(v => v.vues != null || v.likes != null); // garde les vidéos réellement chiffrées
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.LAMATOK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' }
    });
  }

  try {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: { message: "Nom d'utilisateur manquant" } });
    }
    // Nettoie le @ éventuel et les espaces
    const propre = username.trim().replace(/^@+/, '');
    const headers = { accept: 'application/json', 'x-access-key': apiKey };

    const repProfil = await fetch(
      BASE + '/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers }
    );
    const profil = await repProfil.json();

    if (!repProfil.ok) {
      const message = (profil && (profil.message || profil.error)) || 'Profil introuvable ou privé';
      return res.status(repProfil.status).json({ error: { message } });
    }

    // 2e appel : dernières vidéos. Non-bloquant — si ça échoue, medias reste
    // null et le client fonctionne comme avant (profil seul).
    const debug = req.body?.debug === true;
    const ids = extraireIds(profil);
    const journal = debug ? [] : null;
    let medias = null;
    try {
      medias = await recupererMedias(headers, propre, ids, journal);
    } catch (e) { medias = null; }

    const reponse = { profil, medias };
    if (debug) {
      reponse._debug = {
        profilCles: Object.keys(profil || {}),
        userCles: Object.keys((profil && (profil.user || profil.userInfo?.user || profil.data?.user)) || {}),
        idsExtraits: ids,
        tentativesMedias: journal
      };
    }
    return res.status(200).json(reponse);

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  api/_lib/tiktok-media.js, MODULE SERVEUR PARTAGÉ : résolution d'un lien
//  TikTok vers le détail d'une vidéo (TikHub, seule source depuis le retrait
//  de LamaTok, quota épuisé côté LamaTok) et extraction (description, stats,
//  URLs média). Extrait de api/video-stt.js (transcription) pour être
//  réutilisé tel quel par api/tiktok-download.js (lien direct, sans
//  transcription), plutôt que de dupliquer cette logique entre les deux
//  routes.
// ═══════════════════════════════════════════════════════════

const TIKHUB_BASE = 'https://api.tikhub.io';

// Tronque une chaîne à N caractères max SANS couper une paire de substituts
// UTF-16 (emoji) en deux : sinon le caractère orphelin fait planter le
// parseur JSON strict de Claude en aval.
function tronquerSansCouperEmoji(str, n) {
  if (typeof str !== 'string' || str.length <= n) return str || '';
  let s = str.slice(0, n);
  const dernier = s.charCodeAt(s.length - 1);
  if (dernier >= 0xD800 && dernier <= 0xDBFF) s = s.slice(0, -1);
  return s;
}

// Détail d'UNE vidéo via TikHub (/fetch_post_detail, payé au crédit). Seule
// source depuis le retrait de LamaTok. Renvoie l'objet JSON brut :
// urlsVideo/extraireDesc/extraireStats scannent déjà n'importe quelle forme
// de champs (playCount/diggCount/desc/downloadAddr…, confirmés identiques
// à ceux de TikHub sur une vraie réponse), pas besoin de parseur dédié.
async function detailTikHub(id, key) {
  const url = TIKHUB_BASE + '/api/v1/tiktok/web/fetch_post_detail?' + new URLSearchParams({ itemId: id }).toString();
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + key }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
  finally { clearTimeout(minuteur); }
}

function extraireAwemeId(url) {
  const s = String(url || '');
  const m = s.match(/\/(?:video|photo|v)\/(\d{6,25})/);
  if (m) return m[1];
  const m2 = s.match(/[?&](?:aweme_id|item_id|video_id)=(\d{6,25})/);
  if (m2) return m2[1];
  const m3 = s.match(/\b(\d{18,25})\b/);
  if (m3) return m3[1];
  return null;
}

// Seuls les domaines TikTok légitimes peuvent être suivis par le serveur :
// sans ce verrou, `url` (fournie par le client) permettait de faire du
// serveur un relais vers une adresse arbitraire (interne ou externe), le
// serveur suivant les redirections sans aucune vérification.
const HOTES_TIKTOK_AUTORISES = /^(?:[a-z0-9-]+\.)?tiktok\.com$/i;
function hoteAutorise(url) {
  try { return HOTES_TIKTOK_AUTORISES.test(new URL(url).hostname); }
  catch (e) { return false; }
}

async function resoudreLien(url) {
  if (!hoteAutorise(url)) return url; // hôte non-TikTok : on n'essaie même pas de le suivre
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
    // Vérifie aussi la destination finale : une redirection TikTok légitime
    // ne mène jamais hors de tiktok.com.
    if (!hoteAutorise(r.url)) return url;
    return r.url || url;
  } catch (e) { return url; }
}

// Cherche une URL de VIDÉO/AUDIO téléchargeable dans la réponse TikHub.
// On privilégie play_addr / download_addr, et les URLs marquées mime video.
function urlsVideo(obj) {
  const found = []; // { url, score }
  const vus = new Set();
  (function scan(o, ctx, prof) {
    if (!o || typeof o !== 'object' || prof > 9 || vus.has(o)) return;
    vus.add(o);
    let ctx2 = ctx;
    for (const k of Object.keys(o)) {
      if (/play_?addr|download_?addr|bit_?rate|playaddr|video/i.test(k)) ctx2 = true;
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) {
        const estMedia = /\.(mp4|m4a|mp3|mov|webm|aac)(\?|#|$)/i.test(v) || /mime_type=video|mime_type=audio|\/video\/tos\/|is_play_url|\/aweme\//i.test(v);
        const estImage = /\.(jpe?g|png|webp|heic|avif|gif)(\?|#|$)/i.test(v) || /tplv-|~tplv/i.test(v);
        if ((ctx2 || estMedia) && !estImage) {
          let score = 0;
          if (/nwm|no_?watermark|download_?addr/i.test(k) || /nwm|no_?watermark/i.test(v)) score += 3;
          if (/play_?addr|playaddr/i.test(k)) score += 2;
          if (estMedia) score += 1;
          found.push({ url: v, score });
        }
      }
      if (v && typeof v === 'object') scan(v, ctx2, prof + 1);
    }
  })(obj, false, 0);
  const seen = new Set();
  return found.sort((a, b) => b.score - a.score).map(f => f.url).filter(u => (seen.has(u) ? false : (seen.add(u), true))).slice(0, 6);
}

function extraireDesc(obj) {
  let desc = null; const vus = new Set();
  (function scan(o, prof) {
    if (desc || !o || typeof o !== 'object' || prof > 6 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      if (/^(desc|description|title)$/i.test(k) && typeof o[k] === 'string' && o[k].trim().length > 3) { desc = tronquerSansCouperEmoji(o[k].trim(), 400); return; }
      if (o[k] && typeof o[k] === 'object') scan(o[k], prof + 1);
    }
  })(obj, 0);
  return desc;
}

// Nombre d'abonnés de l'AUTEUR de la vidéo, pour calculer la PORTÉE
// (vues ÷ abonnés) : le vrai signal de viralité, bien plus honnête que les
// vues absolues. Cherche la clé de followers à n'importe quelle profondeur.
function extraireAbonnesAuteur(obj) {
  const CLES = /^(follower_count|followercount|followers|fans|fans_count|fanscount)$/i;
  let trouve = null; const vus = new Set();
  (function scan(o, prof) {
    if (trouve != null || !o || typeof o !== 'object' || prof > 8 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      if (CLES.test(k)) { const v = Number(o[k]); if (Number.isFinite(v) && v > 0) { trouve = v; return; } }
    }
    for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object') scan(o[k], prof + 1); }
  })(obj || {}, 0);
  return trouve;
}

// Identifiant public (@handle) de l'auteur, pour aller chercher ses abonnés
// sur son profil quand le détail du post ne les contient pas.
function extraireAuteurUsername(obj) {
  let u = null; const vus = new Set();
  (function scan(o, prof) {
    if (u || !o || typeof o !== 'object' || prof > 8 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      if (/^(unique_id|uniqueId|unique_id_modified|uniqueid)$/i.test(k) && typeof o[k] === 'string' && o[k].trim()) { u = o[k].trim(); return; }
    }
    for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object') scan(o[k], prof + 1); }
  })(obj || {}, 0);
  return u;
}

// Abonnés de l'auteur via son profil TikHub (2e appel, seulement si le
// nombre manque dans le détail du post). Renvoie null en cas d'échec (non
// bloquant). Même endpoint que secUidViaTikHub (api/username-scan.js),
// extraireAbonnesAuteur scanne récursivement, insensible à la profondeur
// exacte du champ dans la réponse.
async function abonnesViaProfil(username, tikhubKey) {
  try {
    const url = TIKHUB_BASE + '/api/v1/tiktok/web/fetch_user_profile?' +
      new URLSearchParams({ uniqueId: username }).toString();
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tikhubKey } });
    if (!r.ok) return null;
    const data = await r.json();
    return extraireAbonnesAuteur(data);
  } catch (e) { return null; }
}

// Statistiques réelles de la vidéo (vues/likes/commentaires/partages + abonnés
// de l'auteur) pour la portée et le score. Cherche l'objet qui porte les vues.
function extraireStats(obj) {
  let stats = null; const vus = new Set();
  (function scan(o, prof) {
    if (stats || !o || typeof o !== 'object' || prof > 7 || vus.has(o)) return;
    vus.add(o);
    const num = (...ks) => { for (const k of ks) { const v = Number(o[k]); if (Number.isFinite(v) && v >= 0) return v; } return null; };
    const vues = num('play_count', 'playCount', 'view_count', 'viewCount');
    if (vues != null && vues > 0) {
      stats = {
        vues,
        likes: num('digg_count', 'diggCount', 'like_count', 'likeCount'),
        commentaires: num('comment_count', 'commentCount'),
        partages: num('share_count', 'shareCount')
      };
      return;
    }
    for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object') scan(o[k], prof + 1); }
  })(obj, 0);
  if (stats) {
    const ab = extraireAbonnesAuteur(obj);
    if (ab != null) stats.abonnesAuteur = ab;
  }
  return stats;
}

// Télécharge une URL média avec des en-têtes crédibles. Renvoie TOUJOURS un
// diagnostic ({status, ct, length, ok, buf?}) pour comprendre les échecs.
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MIN_VIDEO = 50000; // 50 Ko : en dessous, ce n'est pas une vraie vidéo parlée
async function telechargerMedia(url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: {
        'user-agent': UA_DESKTOP,
        'referer': 'https://www.tiktok.com/',
        'accept': '*/*',
        'range': 'bytes=0-'   // TikTok CDN exige souvent un Range pour servir la vidéo
      }
    });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const diag = { status: r.status, ct };
    if (!r.ok && r.status !== 206) return { ...diag, ok: false, reason: 'http ' + r.status };
    if (/text\/html|application\/json/.test(ct)) return { ...diag, ok: false, reason: 'pas un média (html/json)' };
    const buf = Buffer.from(await r.arrayBuffer());
    diag.length = buf.length;
    if (buf.length < MIN_VIDEO) return { ...diag, ok: false, reason: 'trop petit (' + buf.length + ' o)' };
    return { ...diag, ok: true, buf, contentType: ct || 'video/mp4' };
  } catch (e) { return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(minuteur); }
}

// Résout un lien TikTok (court ou long) vers son détail complet via TikHub
// (seule source depuis le retrait de LamaTok). Renvoie
// { id, dataTikHub, description, stats } ou null si le lien n'a pas pu être
// identifié comme une vidéo TikTok.
async function resoudreVideoTikTok(url, tikhubKey) {
  let urlResolue = String(url || '').trim();
  let id = extraireAwemeId(urlResolue);
  if (!id) { urlResolue = await resoudreLien(urlResolue); id = extraireAwemeId(urlResolue); }
  if (!id) return null;

  const dataTikHub = tikhubKey ? await detailTikHub(id, tikhubKey) : null;
  let description = dataTikHub ? (extraireDesc(dataTikHub) || '') : '';
  let stats = dataTikHub ? extraireStats(dataTikHub) : null;

  // Portée : le nombre d'abonnés de l'auteur manque souvent dans le détail
  // d'un post, un 2e appel sur son profil TikHub le complète si besoin.
  if (stats && stats.vues && !stats.abonnesAuteur && tikhubKey) {
    const username = extraireAuteurUsername(dataTikHub);
    if (username) {
      const ab = await abonnesViaProfil(username, tikhubKey);
      if (ab != null) stats.abonnesAuteur = ab;
    }
  }

  return { id, dataTikHub, description, stats };
}

export {
  tronquerSansCouperEmoji,
  detailTikHub,
  extraireAwemeId,
  hoteAutorise,
  resoudreLien,
  urlsVideo,
  extraireDesc,
  extraireAbonnesAuteur,
  extraireAuteurUsername,
  abonnesViaProfil,
  extraireStats,
  telechargerMedia,
  resoudreVideoTikTok
};

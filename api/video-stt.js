// ═══════════════════════════════════════════════════════════
//  /api/video-stt, TRANSCRIPTION D'UNE VIDÉO PAR LA VOIX
//
//  Au lieu de dépendre des sous-titres TikTok (fragiles, URLs expirantes),
//  on RÉCUPÈRE L'AUDIO de la vidéo et on le TRANSCRIT avec ElevenLabs Scribe
//  (speech-to-text). Marche sur n'importe quelle vidéo qui parle.
//
//  Pipeline : lien -> détail de la vidéo -> URL de la vidéo (sans filigrane si
//  possible) -> téléchargement (en-têtes crédibles + Range) -> ElevenLabs
//  /v1/speech-to-text (model scribe_v1) -> texte. Clé ELEVENLABS_API_KEY déjà
//  en place (partagée avec le montage / voix off).
//
//  SOURCE DU MÉDIA : ScrapTik en PRINCIPAL (/get-post?aweme_id=), LamaTok en
//  REPLI (/v1/media/by/id). Raison : LamaTok sert le profil mais rend mal les
//  URLs vidéo ; ScrapTik est notre source vidéo éprouvée (déjà utilisée pour le
//  catalogue d'un compte). Si ScrapTik ne rend rien d'exploitable (clé absente,
//  hoquet, URL qui 403), on retombe sur LamaTok, qui reste un filet fonctionnel.
//
//  POST { url } -> { ok, transcript, description, stats, langue }. Non bloquant :
//  ok=false si la vidéo est indisponible ou sans parole (repli manuel côté client).
//  Clés 100% côté serveur.
// ═══════════════════════════════════════════════════════════

const LAMA_BASE = 'https://api.lamatok.com';
const SCRAPTIK_HOST = 'scraptik.p.rapidapi.com';
const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_TRANSCRIPT = 8000;

// Nettoie la clé RapidAPI (mêmes règles que /api/username-scan) : tolère qu'on
// ait collé tout le snippet cURL dans la variable d'environnement.
function nettoyerCle(k) {
  if (!k) return '';
  const s = String(k);
  const m = s.match(/x-rapidapi-key:\s*['"]?([A-Za-z0-9]{20,})/i);
  if (m) return m[1];
  return s.trim().replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, '');
}

// Tronque une chaîne à N caractères max SANS couper une paire de substituts
// UTF-16 (emoji) en deux (mêmes règles que /api/username-scan) : sinon le
// caractère orphelin fait planter le parseur JSON strict de Claude en aval.
function tronquerSansCouperEmoji(str, n) {
  if (typeof str !== 'string' || str.length <= n) return str || '';
  let s = str.slice(0, n);
  const dernier = s.charCodeAt(s.length - 1);
  if (dernier >= 0xD800 && dernier <= 0xDBFF) s = s.slice(0, -1);
  return s;
}

// Détail d'UNE vidéo via ScrapTik (/get-post). Renvoie l'objet JSON brut, ou
// null en cas d'échec (le handler retombe alors sur LamaTok). Non bloquant.
async function detailScrapTik(id, key) {
  const url = 'https://' + SCRAPTIK_HOST + '/get-post?' + new URLSearchParams({ aweme_id: id }).toString();
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': SCRAPTIK_HOST }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
  finally { clearTimeout(minuteur); }
}

// Détail d'UNE vidéo via LamaTok (/v1/media/by/id). Repli du précédent.
async function detailLamaTok(id, key) {
  try {
    const r = await fetch(LAMA_BASE + '/v1/media/by/id?id=' + encodeURIComponent(id),
      { headers: { accept: 'application/json', 'x-access-key': key } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
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

async function resoudreLien(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
    return r.url || url;
  } catch (e) { return url; }
}

// Cherche une URL de VIDÉO/AUDIO téléchargeable dans la réponse LamaTok.
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

// Abonnés de l'auteur via son profil LamaTok (2e appel, seulement si le nombre
// manque dans le détail du post). Renvoie null en cas d'échec (non bloquant).
async function abonnesViaProfil(username, lamaKey) {
  try {
    const r = await fetch(LAMA_BASE + '/v1/user/by/username?username=' + encodeURIComponent(username),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } });
    if (!r.ok) return null;
    const prof = await r.json();
    return extraireAbonnesAuteur(prof);
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

// Transcrit un buffer audio/vidéo via ElevenLabs Scribe.
async function transcrireEleven(buf, contentType, key) {
  const form = new FormData();
  const type = /audio|video/.test(contentType) ? contentType : 'video/mp4';
  form.append('file', new Blob([buf], { type }), 'video.mp4');
  form.append('model_id', 'scribe_v1');
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(ELEVEN_STT, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: ctrl.signal });
    const txt = await r.text();
    let data = null; try { data = JSON.parse(txt); } catch (e) {}
    if (!r.ok) return { ok: false, status: r.status, message: (data && (data.detail?.message || data.detail || data.message)) || txt.slice(0, 300) };
    return { ok: true, text: (data && data.text) || '', lang: data && (data.language_code || data.language) };
  } catch (e) { return { ok: false, status: 0, message: e.message }; }
  finally { clearTimeout(minuteur); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  const lamaKey = process.env.LAMATOK_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!lamaKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });
  if (!elevenKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (ELEVENLABS_API_KEY)' } });

  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: { message: 'Lien manquant' } });
    }

    // 1) Résoudre le lien court et extraire l'id.
    let urlResolue = url.trim();
    let id = extraireAwemeId(urlResolue);
    if (!id) { urlResolue = await resoudreLien(urlResolue); id = extraireAwemeId(urlResolue); }
    if (!id) {
      return res.status(422).json({ error: { message: "Lien TikTok non reconnu. Vérifie le lien, ou colle le texte de la vidéo à la main." } });
    }

    // 2) Détail de la vidéo : ScrapTik en PRINCIPAL, LamaTok en REPLI.
    const scrapKey = nettoyerCle(process.env.SCRAPTIK_API_KEY);
    const dataScrap = scrapKey ? await detailScrapTik(id, scrapKey) : null;

    // Description & stats : on prend ce que la source principale donne, complété
    // par le repli si besoin.
    let description = dataScrap ? (extraireDesc(dataScrap) || '') : '';
    let stats = dataScrap ? extraireStats(dataScrap) : null;

    // 3) Télécharger la 1re vidéo réellement exploitable (en-têtes crédibles).
    //    On tente d'abord les URLs ScrapTik, puis, si rien ne passe, LamaTok.
    let media = null;
    let dataLama = null;
    if (dataScrap) {
      for (const u of urlsVideo(dataScrap)) {
        const m = await telechargerMedia(u);
        if (m.ok) { media = m; break; }
      }
    }
    if (!media) {
      dataLama = await detailLamaTok(id, lamaKey);
      if (dataLama) {
        if (!description) description = extraireDesc(dataLama) || '';
        if (!stats) stats = extraireStats(dataLama);
        for (const u of urlsVideo(dataLama)) {
          const m = await telechargerMedia(u);
          if (m.ok) { media = m; break; }
        }
      }
    }
    if (!media) {
      // Non bloquant : le client retombe sur le collage manuel.
      return res.status(200).json({ ok: false, description, stats, raison: 'video_indisponible' });
    }

    // 3 bis) PORTÉE : le nombre d'abonnés de l'auteur manque souvent dans le
    // détail d'un post. Sans lui, impossible de mesurer la portée (vues ÷
    // abonnés), et le verdict devient trompeur. On va donc le chercher sur le
    // profil de l'auteur (2e appel LamaTok), une seule fois, si besoin.
    if (stats && stats.vues && !stats.abonnesAuteur) {
      const username = extraireAuteurUsername(dataScrap) || extraireAuteurUsername(dataLama);
      if (username) {
        const ab = await abonnesViaProfil(username, lamaKey);
        if (ab != null) stats.abonnesAuteur = ab;
      }
    }

    // 4) Transcription ElevenLabs Scribe.
    const stt = await transcrireEleven(media.buf, media.contentType, elevenKey);
    if (!stt.ok) {
      return res.status(200).json({ ok: false, description, stats, raison: 'stt_echec' });
    }
    const transcript = (stt.text || '').trim().slice(0, MAX_TRANSCRIPT);
    return res.status(200).json({
      ok: transcript.length > 10,
      transcript,
      description,
      stats,
      langue: stt.lang || null,
      raison: transcript.length > 10 ? null : 'sans_parole'
    });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

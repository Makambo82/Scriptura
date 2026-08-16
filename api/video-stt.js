// ═══════════════════════════════════════════════════════════
//  /api/video-stt, TRANSCRIPTION D'UNE VIDÉO PAR LA VOIX
//
//  Au lieu de dépendre des sous-titres TikTok (fragiles, URLs expirantes),
//  on RÉCUPÈRE L'AUDIO de la vidéo et on le TRANSCRIT avec ElevenLabs Scribe
//  (speech-to-text). Marche sur n'importe quelle vidéo qui parle.
//
//  Pipeline : lien -> LamaTok /v1/media/by/id -> URL de la vidéo (sans
//  filigrane si possible) -> téléchargement (en-têtes crédibles + Range) ->
//  ElevenLabs /v1/speech-to-text (model scribe_v1) -> texte. Clé
//  ELEVENLABS_API_KEY déjà en place (partagée avec le montage / voix off).
//
//  POST { url } -> { ok, transcript, description, langue }. Non bloquant :
//  ok=false si la vidéo est indisponible ou sans parole (repli manuel côté client).
//  Clés 100% côté serveur.
// ═══════════════════════════════════════════════════════════

const LAMA_BASE = 'https://api.lamatok.com';
const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_TRANSCRIPT = 8000;

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
      if (/^(desc|description|title)$/i.test(k) && typeof o[k] === 'string' && o[k].trim().length > 3) { desc = o[k].trim().slice(0, 400); return; }
      if (o[k] && typeof o[k] === 'object') scan(o[k], prof + 1);
    }
  })(obj, 0);
  return desc;
}

// Statistiques réelles de la vidéo (vues/likes/commentaires/partages) pour le
// score de viralité. Cherche l'objet qui porte le nombre de vues.
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

    // 2) Détail LamaTok -> URLs vidéo.
    const rep = await fetch(LAMA_BASE + '/v1/media/by/id?id=' + encodeURIComponent(id),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } });
    const data = await rep.json();
    if (!rep.ok) {
      const message = (data && (data.message || data.error)) || 'Vidéo introuvable ou privée';
      return res.status(rep.status).json({ error: { message } });
    }
    const description = extraireDesc(data) || '';
    const stats = extraireStats(data);
    const urls = urlsVideo(data);

    // 3) Télécharger la 1re vidéo réellement exploitable (en-têtes crédibles).
    let media = null;
    for (const u of urls) {
      const m = await telechargerMedia(u);
      if (m.ok) { media = m; break; }
    }
    if (!media) {
      // Non bloquant : le client retombe sur le collage manuel.
      return res.status(200).json({ ok: false, description, raison: 'video_indisponible' });
    }

    // 4) Transcription ElevenLabs Scribe.
    const stt = await transcrireEleven(media.buf, media.contentType, elevenKey);
    if (!stt.ok) {
      return res.status(200).json({ ok: false, description, raison: 'stt_echec' });
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

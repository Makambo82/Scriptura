// ═══════════════════════════════════════════════════════════
//  /api/video-stt, SONDE + moteur « transcription par la voix »
//
//  Au lieu de dépendre des sous-titres TikTok (fragiles, URLs expirantes),
//  on RÉCUPÈRE L'AUDIO de la vidéo et on le TRANSCRIT avec ElevenLabs Scribe
//  (speech-to-text). Marche sur n'importe quelle vidéo qui parle.
//
//  Pipeline : lien -> LamaTok /v1/media/by/id -> URL de la vidéo (sans
//  filigrane si possible) -> téléchargement -> ElevenLabs /v1/speech-to-text
//  (model scribe_v1) -> texte. Clé ELEVENLABS_API_KEY déjà en place (montage).
//
//  Phase 0 : GET /api/video-stt (au navigateur) affiche un formulaire de test.
//  POST { url } renvoie { ok, transcript, ... } (le mode viral l'utilisera).
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

// Télécharge une URL média (borné en taille) avec des en-têtes TikTok crédibles.
async function telechargerMedia(url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', 'referer': 'https://www.tiktok.com/' }
    });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (/text\/html|application\/json/.test(ct)) return null; // page d'erreur, pas un média
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return null; // trop petit pour être une vidéo
    return { buf, contentType: ct || 'video/mp4' };
  } catch (e) { return null; }
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

const PAGE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Sonde STT, Scriptura</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0d0d0f;color:#eee;margin:0;padding:22px;line-height:1.5}
h1{font-size:1.15rem;color:#E2C87A;margin:0 0 4px}p.sub{color:#9a9a9a;font-size:.85rem;margin:0 0 18px}
input,button{font-size:16px;border-radius:10px;border:1px solid #333;box-sizing:border-box}
input{width:100%;padding:13px;background:#1a1a1e;color:#fff;margin-bottom:10px}
button{width:100%;padding:14px;background:#E2C87A;color:#111;font-weight:700;border:none}button:disabled{opacity:.5}
.verdict{margin-top:18px;padding:14px;border-radius:12px;background:#16161a;border:1px solid #2a2a30;font-size:1rem;font-weight:600}
pre{margin-top:14px;background:#111;border:1px solid #222;border-radius:10px;padding:12px;overflow:auto;font-size:11px;color:#bdbdbd;max-height:55vh}</style></head>
<body><h1>Sonde « transcription par la voix »</h1>
<p class="sub">Colle un lien TikTok : on télécharge l'audio et on le transcrit via ElevenLabs Scribe.</p>
<input id="u" placeholder="https://vm.tiktok.com/... ou .../video/..." autocapitalize="off" autocorrect="off" spellcheck="false"/>
<button id="go" onclick="lancer()">Transcrire la vidéo</button>
<div id="verdict" class="verdict" style="display:none"></div><pre id="out" style="display:none"></pre>
<script>async function lancer(){var url=document.getElementById('u').value.trim();if(!url)return;
var b=document.getElementById('go'),v=document.getElementById('verdict'),o=document.getElementById('out');
b.disabled=true;b.textContent='On transcrit… (quelques secondes)';v.style.display='none';o.style.display='none';
try{var r=await fetch('/api/video-stt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url})});
var d=await r.json();v.style.display='block';v.textContent=d.verdict||'(pas de verdict)';
o.style.display='block';o.textContent=JSON.stringify(d,null,2);
}catch(e){v.style.display='block';v.textContent='Erreur : '+e.message;}finally{b.disabled=false;b.textContent='Transcrire la vidéo';}}</script>
</body></html>`;

export default async function handler(req, res) {
  const lamaKey = process.env.LAMATOK_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;

  const lien = (req.method === 'POST' ? (req.body && req.body.url) : (req.query && req.query.url)) || '';
  if (req.method === 'GET' && !lien) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(PAGE_HTML);
  }
  if (!lien) return res.status(400).json({ error: 'Fournis ?url=<lien TikTok>' });
  if (!lamaKey) return res.status(500).json({ error: 'LAMATOK_API_KEY absente' });
  if (!elevenKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY absente' });

  const rapport = { lien, etapes: [] };
  try {
    // 1) id.
    let urlResolue = lien.trim();
    let id = extraireAwemeId(urlResolue);
    if (!id) { urlResolue = await resoudreLien(urlResolue); id = extraireAwemeId(urlResolue); }
    rapport.awemeId = id;
    if (!id) { rapport.verdict = "Lien TikTok non reconnu."; return res.status(200).json(rapport); }

    // 2) détail LamaTok -> URLs vidéo.
    const rep = await fetch(LAMA_BASE + '/v1/media/by/id?id=' + encodeURIComponent(id),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } });
    const data = await rep.json();
    if (!rep.ok) { rapport.verdict = 'Vidéo introuvable (LamaTok ' + rep.status + ')'; return res.status(200).json(rapport); }
    rapport.description = extraireDesc(data);
    const urls = urlsVideo(data);
    rapport.nbUrlsVideo = urls.length;

    // 3) télécharger la 1re vidéo exploitable.
    let media = null, urlUtilisee = null;
    for (const u of urls) {
      const m = await telechargerMedia(u);
      rapport.etapes.push({ url: u.slice(0, 90), telecharge: !!m, taille: m ? m.buf.length : 0 });
      if (m) { media = m; urlUtilisee = u; break; }
    }
    if (!media) { rapport.verdict = "🔴 Impossible de télécharger la vidéo (URLs protégées/expirées). Voir 'etapes'."; return res.status(200).json(rapport); }
    rapport.tailleMedia = media.buf.length;

    // 4) ElevenLabs Scribe.
    const stt = await transcrireEleven(media.buf, media.contentType, elevenKey);
    if (!stt.ok) { rapport.verdict = '🔴 Transcription échouée (ElevenLabs ' + stt.status + ') : ' + stt.message; return res.status(200).json(rapport); }

    const transcript = (stt.text || '').trim().slice(0, MAX_TRANSCRIPT);
    rapport.ok = transcript.length > 10;
    rapport.langue = stt.lang;
    rapport.transcript = transcript;
    rapport.transcriptExtrait = transcript.slice(0, 500);
    rapport.verdict = rapport.ok
      ? "✅ TRANSCRIPTION RÉUSSIE par la voix. On peut brancher ça sur le mode Analyse virale."
      : "🟡 Transcription vide (vidéo sans parole ?).";
    return res.status(200).json(rapport);

  } catch (e) {
    rapport.verdict = 'Erreur serveur : ' + (e.message || 'inconnue');
    return res.status(200).json(rapport);
  }
}

// ═══════════════════════════════════════════════════════════
//  /api/video-scan, SONDE (Phase 0) « analyser une vidéo par son lien »
//
//  But : découvrir, EN LIVE, ce que nos API TikTok (LamaTok / ScrapTik)
//  renvoient pour UNE vidéo donnée par son URL, et surtout SI le transcript
//  (sous-titres / closed captions) est disponible. Rien n'est encore branché
//  sur l'app : c'est un outil de vérification jetable avant de construire la
//  vraie fonctionnalité.
//
//  Mode auto-découverte : on essaie plusieurs endpoints candidats par
//  fournisseur, on rapporte lequel a marché, on scanne la réponse à la
//  recherche de sous-titres, et si on en trouve on tente de télécharger la
//  piste pour prouver qu'on récupère le vrai texte parlé.
//
//  Usage : GET /api/video-scan?url=<lien>  (ouvrable au navigateur)
//          POST { url, endpoint? }          (endpoint = override plein-URL)
//  Clés 100% côté serveur (LAMATOK_API_KEY, SCRAPTIK_API_KEY).
// ═══════════════════════════════════════════════════════════

const LAMA_BASE = 'https://api.lamatok.com';
const SCRAPTIK_HOST = 'scraptik.p.rapidapi.com';

function nettoyerCle(k) {
  if (!k) return '';
  const s = String(k);
  const m = s.match(/x-rapidapi-key:\s*['"]?([A-Za-z0-9]{20,})/i);
  if (m) return m[1];
  return s.trim().replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, '');
}

// Extrait l'id numérique d'une vidéo depuis une URL TikTok « longue »
// (.../video/1234...). Renvoie null pour un lien court (vm.tiktok.com/...).
function extraireAwemeId(url) {
  const s = String(url || '');
  const m = s.match(/\/(?:video|photo|v)\/(\d{6,25})/);
  if (m) return m[1];
  const m2 = s.match(/[?&](?:aweme_id|item_id|video_id)=(\d{6,25})/);
  if (m2) return m2[1];
  const m3 = s.match(/\b(\d{18,25})\b/); // id brut collé
  if (m3) return m3[1];
  return null;
}

// Résout un lien court (vm.tiktok.com, /t/…) en suivant les redirections
// jusqu'à l'URL longue qui contient l'id.
async function resoudreLien(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
    return r.url || url;
  } catch (e) { return url; }
}

// Scan récursif : repère toute clé qui sent le sous-titre / la caption, et
// renvoie le chemin + un aperçu de la valeur.
function chercherSousTitres(obj) {
  const trouve = [];
  const vus = new Set();
  (function scan(o, chemin, prof) {
    if (!o || typeof o !== 'object' || prof > 8 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      if (/subtitle|caption|cla_info|transcript|webvtt|(^|_)cc(_|$)/i.test(k)) {
        let apercu; try { apercu = JSON.stringify(o[k]).slice(0, 500); } catch (e) { apercu = '[illisible]'; }
        trouve.push({ chemin: (chemin ? chemin + '.' : '') + k, apercu });
      }
      const v = o[k];
      if (v && typeof v === 'object') scan(v, (chemin ? chemin + '.' : '') + k, prof + 1);
    }
  })(obj, '', 0);
  return trouve;
}

// Collecte les URLs qui ressemblent à des pistes de sous-titres.
function collecterUrlsSousTitres(obj) {
  const urls = new Set();
  const vus = new Set();
  (function scan(o, ctx, prof) {
    if (!o || typeof o !== 'object' || prof > 8 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      const ctx2 = ctx || /subtitle|caption|cla_info|(^|_)cc(_|$)/i.test(k);
      const v = o[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v) && (ctx2 || /\.vtt|\.srt|webvtt|subtitle|caption/i.test(v))) urls.add(v);
      if (v && typeof v === 'object') scan(v, ctx2, prof + 1);
    }
  })(obj, false, 0);
  return [...urls].slice(0, 5);
}

// Description / légende de la vidéo (là où l'API la range).
function extraireDesc(obj) {
  let desc = null;
  const vus = new Set();
  (function scan(o, prof) {
    if (desc || !o || typeof o !== 'object' || prof > 6 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      if (/^(desc|description|title|content)$/i.test(k) && typeof o[k] === 'string' && o[k].trim().length > 3) { desc = o[k].trim().slice(0, 400); return; }
      if (o[k] && typeof o[k] === 'object') scan(o[k], prof + 1);
    }
  })(obj, 0);
  return desc;
}

// Un essai d'appel : renvoie un diagnostic normalisé.
async function essayer(nom, url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const rep = await fetch(url, { headers, signal: ctrl.signal });
    const texte = await rep.text();
    let json = null; try { json = JSON.parse(texte); } catch (e) {}
    return { nom, url, status: rep.status, ok: rep.ok, json, brut: json ? null : texte.slice(0, 300) };
  } catch (e) {
    return { nom, url, status: 0, ok: false, erreur: e.message };
  } finally { clearTimeout(t); }
}

// Formulaire de test servi PAR l'endpoint lui-même : ouvrir /api/video-scan au
// navigateur affiche cette page (les routes /api/* sont toujours servies, même
// quand un .html statique ne l'est pas selon la config Vercel).
const PAGE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Sonde vidéo, Scriptura</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0d0d0f;color:#eee;margin:0;padding:22px;line-height:1.5}
h1{font-size:1.15rem;color:#E2C87A;margin:0 0 4px}p.sub{color:#9a9a9a;font-size:.85rem;margin:0 0 18px}
input,button{font-size:16px;border-radius:10px;border:1px solid #333;box-sizing:border-box}
input{width:100%;padding:13px;background:#1a1a1e;color:#fff;margin-bottom:10px}
button{width:100%;padding:14px;background:#E2C87A;color:#111;font-weight:700;border:none}button:disabled{opacity:.5}
.verdict{margin-top:18px;padding:14px;border-radius:12px;background:#16161a;border:1px solid #2a2a30;font-size:1rem;font-weight:600}
pre{margin-top:14px;background:#111;border:1px solid #222;border-radius:10px;padding:12px;overflow:auto;font-size:11px;color:#bdbdbd;max-height:55vh}</style></head>
<body><h1>Sonde « vidéo par lien »</h1>
<p class="sub">Colle un lien TikTok viral (idéalement le lien LONG .../video/123…) pour vérifier si on récupère le transcript.</p>
<input id="u" placeholder="https://www.tiktok.com/@.../video/..." autocapitalize="off" autocorrect="off" spellcheck="false"/>
<button id="go" onclick="lancer()">Sonder la vidéo</button>
<div id="verdict" class="verdict" style="display:none"></div><pre id="out" style="display:none"></pre>
<script>async function lancer(){var url=document.getElementById('u').value.trim();if(!url)return;
var b=document.getElementById('go'),v=document.getElementById('verdict'),o=document.getElementById('out');
b.disabled=true;b.textContent='On sonde…';v.style.display='none';o.style.display='none';
try{var r=await fetch('/api/video-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url})});
var d=await r.json();v.style.display='block';v.textContent=d.verdict||'(pas de verdict)';
o.style.display='block';o.textContent=JSON.stringify({verdict:d.verdict,endpointGagnant:d.endpointGagnant,awemeId:d.awemeId,description:d.description,sousTitres:d.sousTitres,transcriptExtrait:d.transcriptExtrait,essais:d.essais},null,2);
}catch(e){v.style.display='block';v.textContent='Erreur : '+e.message;}finally{b.disabled=false;b.textContent='Sonder la vidéo';}}</script>
</body></html>`;

export default async function handler(req, res) {
  const lamaKey = process.env.LAMATOK_API_KEY;
  const scrapKey = nettoyerCle(process.env.SCRAPTIK_API_KEY);

  const lien = (req.method === 'POST' ? (req.body && req.body.url) : (req.query && req.query.url)) || '';
  const override = (req.method === 'POST' ? (req.body && req.body.endpoint) : (req.query && req.query.endpoint)) || '';
  // Ouverture au navigateur (GET sans paramètre) : on sert le formulaire.
  if (req.method === 'GET' && !lien && !override) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(PAGE_HTML);
  }
  if (!lien && !override) {
    return res.status(400).json({ error: "Fournis ?url=<lien TikTok> (ou endpoint= pour un override)" });
  }

  // 1) Résoudre le lien et extraire l'id.
  let urlResolue = lien;
  let id = extraireAwemeId(lien);
  if (!id && lien) { urlResolue = await resoudreLien(lien); id = extraireAwemeId(urlResolue); }

  const rapport = {
    lien, urlResolue, awemeId: id,
    cles: { lamatok: !!lamaKey, scraptik: !!scrapKey },
    essais: []
  };

  if (!id && !override) {
    rapport.verdict = "Impossible d'extraire l'id de la vidéo depuis ce lien. Colle le lien LONG (.../video/123...), ou réessaie.";
    return res.status(200).json(rapport);
  }

  // 2) Endpoints candidats (auto-découverte). L'override, s'il est fourni,
  //    remplace {id} par l'id trouvé.
  const hLama = { accept: 'application/json', 'x-access-key': lamaKey };
  const hScrap = { 'x-rapidapi-key': scrapKey, 'x-rapidapi-host': SCRAPTIK_HOST };
  const candidats = [];
  if (override) {
    const u = override.replace('{id}', id || '').replace('{url}', encodeURIComponent(urlResolue));
    candidats.push({ nom: 'override', url: u, headers: /rapidapi/.test(u) ? hScrap : hLama });
  } else {
    if (lamaKey) {
      candidats.push({ nom: 'lamatok /v1/media/by/id', url: `${LAMA_BASE}/v1/media/by/id?id=${id}`, headers: hLama });
      candidats.push({ nom: 'lamatok /v1/media/info/by/id', url: `${LAMA_BASE}/v1/media/info/by/id?id=${id}`, headers: hLama });
      candidats.push({ nom: 'lamatok /v1/media/by/url', url: `${LAMA_BASE}/v1/media/by/url?url=${encodeURIComponent(urlResolue)}`, headers: hLama });
    }
    if (scrapKey) {
      candidats.push({ nom: 'scraptik /get-post', url: `https://${SCRAPTIK_HOST}/get-post?aweme_id=${id}`, headers: hScrap });
      candidats.push({ nom: 'scraptik /post', url: `https://${SCRAPTIK_HOST}/post?aweme_id=${id}`, headers: hScrap });
      candidats.push({ nom: 'scraptik /video/info', url: `https://${SCRAPTIK_HOST}/video/info?aweme_id=${id}`, headers: hScrap });
    }
  }

  // 3) Essayer chacun ; s'arrêter au premier qui renvoie un vrai objet vidéo.
  let gagnant = null;
  for (const c of candidats) {
    const r = await essayer(c.nom, c.url, c.headers);
    const aObjet = r.json && typeof r.json === 'object' && JSON.stringify(r.json).length > 200;
    rapport.essais.push({ nom: r.nom, status: r.status, ok: r.ok, aObjet: !!aObjet, erreur: r.erreur, brut: r.brut });
    if (r.ok && aObjet && !gagnant) { gagnant = r; }
  }

  if (!gagnant) {
    rapport.verdict = "Aucun endpoint candidat n'a renvoyé de vidéo. Regarde les 'essais' (statuts) : le bon chemin est peut-être différent. Tu peux relancer avec ?endpoint=<chemin exact avec {id}>.";
    return res.status(200).json(rapport);
  }

  // 4) Analyse du gagnant : desc + sous-titres.
  const data = gagnant.json;
  const sousTitresKeys = chercherSousTitres(data);
  const urlsSt = collecterUrlsSousTitres(data);
  rapport.endpointGagnant = gagnant.nom;
  rapport.description = extraireDesc(data);
  rapport.sousTitres = {
    presents: sousTitresKeys.length > 0 || urlsSt.length > 0,
    cles_trouvees: sousTitresKeys.slice(0, 6),
    urls: urlsSt
  };

  // 5) Si une piste de sous-titres existe, la télécharger pour prouver qu'on
  //    récupère le VRAI texte parlé (le cœur de la fonctionnalité).
  if (urlsSt.length) {
    const st = await essayer('piste sous-titres', urlsSt[0], {});
    const contenu = st.brut || (typeof st.json === 'string' ? st.json : '');
    rapport.transcriptExtrait = (contenu || '').slice(0, 800) || '(vide ou format inattendu)';
    rapport.transcriptOk = !!(contenu && contenu.length > 20);
  }

  rapport.verdict = rapport.sousTitres.presents
    ? (rapport.transcriptOk
      ? "✅ TRANSCRIPT DISPONIBLE : sous-titres trouvés ET téléchargés. La fonctionnalité 'coller un lien' est pleinement faisable en qualité maximale."
      : "🟡 Sous-titres SIGNALÉS mais piste non téléchargée telle quelle. À creuser, probablement OK.")
    : (rapport.description
      ? "🟠 Pas de sous-titres, mais on a la DESCRIPTION. Analyse possible mais plus faible (structure devinée depuis la légende)."
      : "🔴 Ni sous-titres ni description exploitable via cet endpoint.");

  return res.status(200).json(rapport);
}

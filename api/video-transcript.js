// ═══════════════════════════════════════════════════════════
//  /api/video-transcript, récupère le TRANSCRIPT d'une vidéo TikTok par lien
//
//  Pour le mode « Analyser une vidéo virale » (js/generation.js) : l'utilisateur
//  colle le lien de partage TikTok (y compris le lien COURT vm.tiktok.com), on
//  résout le lien, on lit la vidéo via LamaTok (/v1/media/by/id, endpoint
//  confirmé par la sonde Phase 0), on télécharge la piste de sous-titres webvtt
//  et on la nettoie en texte lisible. Renvoie aussi la description.
//
//  Non bloquant : si pas de sous-titres (vidéo sans CC, privée…), on renvoie ce
//  qu'on a (desc) avec ok=false pour que le client retombe sur le collage manuel.
//  Clé 100% côté serveur (LAMATOK_API_KEY).
// ═══════════════════════════════════════════════════════════

const LAMA_BASE = 'https://api.lamatok.com';
const MAX_TRANSCRIPT = 6000; // borne le texte envoyé ensuite à l'IA

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

// Une URL clairement média (image / vidéo / audio) n'est JAMAIS un sous-titre.
// (la réponse du détail vidéo contient des couvertures JPEG, l'URL du .mp4, etc.)
function estUrlMedia(u) {
  // Prudent : uniquement les signaux FORTS (extension de fichier média, ou
  // marqueurs d'image TikTok tplv). La vraie garde reste estSousTitreTexte sur
  // le contenu téléchargé, pour ne jamais exclure à tort une piste valide.
  return /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp|mp4|mov|m4v|webm|m4a|mp3|aac|ogg)(\?|#|$)/i.test(u)
    || /tplv-|~tplv/i.test(u);
}

// Le contenu téléchargé est-il un VRAI sous-titre texte (et pas du binaire) ?
function estSousTitreTexte(txt) {
  if (!txt || txt.length < 10) return false;
  // Signatures binaires (image/vidéo) en tête → rejet immédiat.
  const c0 = txt.charCodeAt(0), c1 = txt.charCodeAt(1);
  if (c0 === 0xFF && c1 === 0xD8) return false;             // JPEG
  if (c0 === 0x89 && txt.slice(1, 4) === 'PNG') return false; // PNG
  if (txt.slice(0, 4) === 'RIFF' || txt.slice(0, 4) === 'GIF8') return false;
  if (txt.slice(4, 8) === 'ftyp') return false;             // MP4
  // Trop de caractères non imprimables / de remplacement sur le début → binaire.
  const ech = txt.slice(0, 800);
  const nonImpr = (ech.match(/[\x00-\x08\x0E-\x1F�]/g) || []).length;
  if (nonImpr > 15) return false;
  // Doit ressembler à un sous-titre (webvtt/srt) ou au moins à du texte lisible.
  return /WEBVTT|-->|\d{1,2}:\d{2}/.test(txt) || (ech.match(/[A-Za-zÀ-ÿ]{3,}/g) || []).length >= 5;
}

// Récupère les URLs de sous-titres, en préférant le français si repérable.
function urlsSousTitres(obj) {
  const found = []; // { url, fr }
  const vus = new Set();
  (function scan(o, ctxFr, ctxSub, prof) {
    if (!o || typeof o !== 'object' || prof > 9 || vus.has(o)) return;
    vus.add(o);
    // Pré-pass : cet objet est-il un contexte « sous-titres » et/ou déclare-t-il
    // le français ? (les clés langue et url sont souvent SŒURS, donc il faut
    // les connaître AVANT de pousser l'url, quel que soit l'ordre des clés).
    let objSub = ctxSub, objFr = ctxFr;
    for (const k of Object.keys(o)) {
      const kl = k.toLowerCase();
      if (/subtitle|caption|cla_info|clainfo|(^|_)cc(_|$)/i.test(kl)) objSub = true;
      const v = o[k];
      if (/lang/i.test(kl) && typeof v === 'string' && /^fr/i.test(v)) objFr = true;
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v) && (objSub || /\.vtt|webvtt|subtitle|caption/i.test(v))
          && !estUrlMedia(v)) { // jamais une URL d'image/vidéo, même en contexte sous-titres
        found.push({ url: v, fr: objFr || /fra|fr-|_fr/i.test(v) });
      }
      if (v && typeof v === 'object') scan(v, objFr, objSub, prof + 1);
    }
  })(obj, false, false, 0);
  // français d'abord, puis le reste ; dédoublonné
  const uniq = [];
  const seen = new Set();
  found.sort((a, b) => (b.fr ? 1 : 0) - (a.fr ? 1 : 0));
  for (const f of found) { if (!seen.has(f.url)) { seen.add(f.url); uniq.push(f.url); } }
  return uniq.slice(0, 5);
}

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

// Convertit un webvtt (ou srt) en texte lisible : retire l'entête, les
// numéros de cue, les timecodes et les balises, dédoublonne les lignes
// consécutives identiques (fréquent sur les auto-captions).
function nettoyerWebvtt(txt) {
  if (!txt) return '';
  const lignes = String(txt).replace(/\r/g, '').split('\n');
  const out = [];
  let prev = null;
  for (let l of lignes) {
    l = l.trim();
    if (!l) continue;
    if (/^WEBVTT/i.test(l)) continue;
    if (/^\d+$/.test(l)) continue;                      // numéro de cue
    if (/-->/.test(l)) continue;                        // timecode
    if (/^(NOTE|STYLE|REGION)\b/i.test(l)) continue;
    l = l.replace(/<[^>]+>/g, '').trim();               // balises <c>, <00:00:01.000>
    if (!l) continue;
    if (l === prev) continue;                           // doublon consécutif
    out.push(l);
    prev = l;
  }
  return out.join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_TRANSCRIPT);
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

    // 2) Détail de la vidéo via LamaTok.
    const rep = await fetch(LAMA_BASE + '/v1/media/by/id?id=' + encodeURIComponent(id),
      { headers: { accept: 'application/json', 'x-access-key': lamaKey } });
    const data = await rep.json();
    if (!rep.ok) {
      const message = (data && (data.message || data.error)) || 'Vidéo introuvable ou privée';
      return res.status(rep.status).json({ error: { message } });
    }

    const desc = extraireDesc(data);
    const urls = urlsSousTitres(data);

    // 3) Télécharger la première piste de sous-titres RÉELLEMENT texte. On essaie
    //    chaque candidat, on rejette tout ce qui n'est pas du sous-titre texte
    //    (image/vidéo, binaire) : jamais on ne renvoie du binaire comme transcript.
    let transcript = '';
    for (const u of urls) {
      try {
        const st = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!st.ok) continue;
        const ct = (st.headers.get('content-type') || '').toLowerCase();
        if (/image|video|audio|application\/octet-stream/.test(ct)) continue; // pas du texte
        const brut = await st.text();
        if (!estSousTitreTexte(brut)) continue;      // garde-fou anti-binaire
        const propre = nettoyerWebvtt(brut);
        if (propre && propre.length > 20) { transcript = propre; break; }
      } catch (e) { /* piste suivante */ }
    }

    return res.status(200).json({
      ok: !!transcript,
      transcript,
      description: desc || '',
      // Message d'aide si pas de transcript : le client bascule sur le manuel.
      raison: transcript ? null : (urls.length ? 'sous-titres illisibles' : 'pas de sous-titres sur cette vidéo')
    });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

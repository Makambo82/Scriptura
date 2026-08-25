// ═══════════════════════════════════════════════════════════
//  /api/montage-media, REGROUPE 4 routes du montage qui étaient chacune
//  leur propre fonction serverless (montage-download, montage-voices,
//  montage-tts, montage-images) : le plan Vercel Hobby plafonne à 12
//  fonctions serverless par déploiement, dépassé silencieusement (voir
//  api/data.js pour le détail de l'incident). Consolidation mécanique,
//  comportement de chaque route inchangé : un champ `action` (query pour
//  toutes, GET comme POST) sélectionne la route d'origine.
//
//  action=download | voices | tts | images
// ═══════════════════════════════════════════════════════════

import { resoudreDroits } from './_lib/acces.js';

// ═══ DOWNLOAD (voir l'ancien api/montage-download.js) ═══

const HOTES_AUTORISES = [/^nlkfqxllunbvppulpnzl\.supabase\.co$/i];

async function handleDownload(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const cible = req.query?.url;
  if (!cible || typeof cible !== 'string') {
    return res.status(400).json({ error: { message: 'Paramètre url manquant' } });
  }

  let hote;
  try { hote = new URL(cible).hostname; } catch (e) {
    return res.status(400).json({ error: { message: 'URL invalide' } });
  }
  if (!HOTES_AUTORISES.some(re => re.test(hote))) {
    return res.status(403).json({ error: { message: 'Hôte non autorisé' } });
  }

  try {
    const rep = await fetch(cible);
    if (!rep.ok || !rep.body) {
      return res.status(502).json({ error: { message: 'Vidéo introuvable côté serveur distant' } });
    }
    res.setHeader('Content-Type', rep.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="scriptura-montage.mp4"');
    const buffer = Buffer.from(await rep.arrayBuffer());
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ VOIX (partagé entre voices et tts, voir les anciens api/montage-voices.js / api/montage-tts.js) ═══

function obtenirVoixDisponibles() {
  const brut = process.env.ELEVENLABS_VOICES;
  if (brut) {
    try {
      const liste = JSON.parse(brut);
      if (Array.isArray(liste) && liste.length && liste.every(v => v && v.id)) {
        return liste.map(v => ({ id: String(v.id).trim(), label: String(v.label || v.name || v.id).trim() }));
      }
    } catch (e) { /* tombe sur le repli ci-dessous */ }
  }
  const idUnique = (process.env.ELEVENLABS_VOICE_ID || '').trim();
  return idUnique ? [{ id: idUnique, label: 'Voix par défaut' }] : [];
}

async function handleVoices(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  return res.status(200).json({ voices: obtenirVoixDisponibles() });
}

// ═══ TTS (voir l'ancien api/montage-tts.js) ═══

function retirerMinuterie(texte) {
  return texte
    .replace(/^\s*[([]?\s*\d+\s*(?:à|-|–)\s*\d+\s*(?:sec(?:ondes?)?)?\s*[)\]]?\s*[:\-–,]?\s*/i, '')
    .replace(/^\s*[([]?\s*\d{1,2}:\d{2}(?:\s*(?:à|-|–)\s*\d{1,2}:\d{2})?\s*[)\]]?\s*[:\-–,]?\s*/i, '')
    .trim();
}

async function handleTts(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (ELEVENLABS_API_KEY)' } });
  const voixDisponibles = obtenirVoixDisponibles();
  if (!voixDisponibles.length) {
    return res.status(500).json({ error: { message: 'Voix absente côté serveur (ELEVENLABS_VOICE_ID ou ELEVENLABS_VOICES), choisis-en une dans ta bibliothèque de voix ElevenLabs et copie son ID.' } });
  }

  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Réservé au fondateur', code: 'ACCES_REFUSE' } });
  }

  // Un plafond trop bas ici causait un vrai bug silencieux : le montage
  // manuel (js/montage-manuel.js) peut avoir bien plus de 40 images/lignes
  // (retour direct : 53 images, bouton "Démarrer le montage" resté grisé
  // sans aucune explication). L'ancien code TRONQUAIT silencieusement les
  // segments au-delà de MAX_SEGMENTS, renvoyant donc moins de durées que
  // d'images attendues côté client, qui ne validait jamais cette égalité.
  // Refuser clairement AVANT de tronquer, plutôt que de corrompre l'état.
  const MAX_SEGMENTS = 200;
  const segmentsBruts = Array.isArray(body?.segments) ? body.segments : [];
  if (segmentsBruts.length > MAX_SEGMENTS) {
    return res.status(400).json({ error: { message: `Trop de plans pour une seule voix off (${segmentsBruts.length}, max ${MAX_SEGMENTS}).` } });
  }
  const segments = segmentsBruts.map(s => retirerMinuterie(String(s || '').trim()));
  if (!segments.length || segments.every(s => !s)) {
    return res.status(400).json({ error: { message: 'Aucun texte à narrer' } });
  }

  const voixDemandee = typeof body?.voiceId === 'string' ? body.voiceId : '';
  const voixChoisie = voixDisponibles.find(v => v.id === voixDemandee) || voixDisponibles[0];
  const voiceId = voixChoisie.id;

  const debutsCaracteres = [];
  let curseur = 0;
  for (const s of segments) {
    debutsCaracteres.push(curseur);
    curseur += s.length + 1;
  }
  const texteComplet = segments.join(' ');

  try {
    const rep = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '/with-timestamps',
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texteComplet, model_id: 'eleven_multilingual_v2' })
      }
    );
    const data = await rep.json();
    if (!rep.ok) {
      const message = data?.detail?.message || data?.message || 'La voix off n\'a pas pu être générée';
      return res.status(502).json({ error: { message } });
    }

    const align = data?.alignment;
    if (!data?.audio_base64 || !align || !Array.isArray(align.character_start_times_seconds)) {
      return res.status(502).json({ error: { message: 'Réponse ElevenLabs inattendue (pas d\'horodatage)' } });
    }
    const debutsTemps = align.character_start_times_seconds;
    const finsTemps = align.character_end_times_seconds;
    const nbCaracteres = debutsTemps.length;

    const dureeTotale = finsTemps[finsTemps.length - 1] || 0;
    let durations;
    if (nbCaracteres === texteComplet.length) {
      durations = segments.map((s, i) => {
        const debut = debutsTemps[debutsCaracteres[i]] ?? 0;
        const fin = (i < segments.length - 1)
          ? (debutsTemps[debutsCaracteres[i + 1]] ?? dureeTotale)
          : dureeTotale;
        return Math.max(0.5, Math.round((fin - debut) * 100) / 100);
      });
    } else {
      const totalCaracteres = segments.reduce((s, t) => s + t.length, 0) || 1;
      durations = segments.map(s => Math.max(0.5, Math.round((s.length / totalCaracteres) * dureeTotale * 100) / 100));
    }

    if (durations.length && dureeTotale > 0) {
      durations[durations.length - 1] = Math.round((durations[durations.length - 1] + 0.3) * 100) / 100;
    }

    return res.status(200).json({
      audioBase64: data.audio_base64,
      mimeType: 'audio/mpeg',
      durations,
      totalDuration: dureeTotale
    });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ IMAGES (voir l'ancien api/montage-images.js) ═══

const CONCURRENCE_MAX = 1;
const TENTATIVES_MAX = 3;
// GPT Image 2 (via Together) : testé à la suite de FLUX.1-schnell (instable
// côté Together), GPT Image 1.5 et Gemini 3 Pro Image, en modèle principal,
// pour comparer coût et fiabilité réels. Tailles héritées des tests
// précédents (carré/portrait/paysage fixes) : à ajuster si Together les
// refuse pour ce modèle précis, l'erreur remontée par genererUneImage le dira.
const MODELE = 'openai/gpt-image-2';
const DIMENSIONS_FORMAT = {
  '9:16': { w: 1024, h: 1536 },
  '16:9': { w: 1536, h: 1024 },
  '1:1':  { w: 1024, h: 1024 },
};

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

function versionSure(prompt) {
  const sansFormat = prompt.replace(/\s*9:16\s*$/i, '').trim();
  return sansFormat + '. Safe-for-work, tasteful and dignified, non-explicit, no nudity, no gore, no graphic violence, fully clothed, respectful fine-art composition. 9:16';
}

function estBlocageNSFW(message) {
  return /nsfw|not safe|safety|flagged|content policy|may contain|moderat/i.test(String(message));
}

async function genererUneImage(apiKey, prompt, dims) {
  let promptCourant = prompt;
  let dejaSecurise = false;
  for (let tentative = 1; tentative <= TENTATIVES_MAX; tentative++) {
    const rep = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELE, prompt: promptCourant, width: dims.w, height: dims.h, response_format: 'base64' })
    });
    const data = await rep.json();
    if (rep.ok) {
      const image = (data.data || [])[0];
      const b64 = image && (image.b64_json || image.base64);
      if (!b64) throw new Error('Aucune image renvoyée par Together AI');
      return { base64: b64, mimeType: 'image/png' };
    }
    const message = data?.error?.message || data?.error || 'Échec de génération (statut ' + rep.status + ')';
    if (estBlocageNSFW(message) && !dejaSecurise && tentative < TENTATIVES_MAX) {
      promptCourant = versionSure(prompt);
      dejaSecurise = true;
      continue;
    }
    const limiteDebit = rep.status === 429 || /rate.?limit/i.test(String(message));
    if (limiteDebit && tentative < TENTATIVES_MAX) { await attendre(1500 * tentative); continue; }
    throw new Error(message);
  }
}

async function handleImages(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (TOGETHER_API_KEY)' } });

  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Réservé au fondateur', code: 'ACCES_REFUSE' } });
  }

  const MAX_PROMPTS = 40;
  const prompts = Array.isArray(body?.prompts) ? body.prompts.slice(0, MAX_PROMPTS).map(p => String(p || '').trim()) : [];
  if (!prompts.length || prompts.every(p => !p)) {
    return res.status(400).json({ error: { message: 'Aucun prompt à générer' } });
  }
  const dims = DIMENSIONS_FORMAT[body?.format] || DIMENSIONS_FORMAT['9:16'];

  const resultats = new Array(prompts.length).fill(null);
  const erreurs = new Array(prompts.length).fill(null);

  let curseur = 0;
  async function travailleur() {
    while (curseur < prompts.length) {
      const i = curseur++;
      if (!prompts[i]) { erreurs[i] = 'Prompt vide'; continue; }
      try { resultats[i] = await genererUneImage(apiKey, prompts[i], dims); }
      catch (e) { erreurs[i] = e.message || 'Erreur inconnue'; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCE_MAX, prompts.length) }, travailleur));

  return res.status(200).json({ images: resultats, erreurs });
}

// ═══ POINT D'ENTRÉE COMMUN ═══

export default async function handler(req, res) {
  const action = req.query?.action;

  if (action === 'download') return handleDownload(req, res);
  if (action === 'voices') return handleVoices(req, res);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (action === 'tts') return handleTts(req, res, body);
  if (action === 'images') return handleImages(req, res, body);

  return res.status(400).json({ error: { message: 'action inconnue' } });
}

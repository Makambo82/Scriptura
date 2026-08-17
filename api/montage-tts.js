// ═══════════════════════════════════════════════════════════
//  /api/montage-tts, Génère la voix off du montage via ElevenLabs, à
//  partir du texte déjà présent dans le storyboard (un segment par plan).
//  Utilise l'endpoint "with-timestamps" : la réponse contient l'audio ET un
//  horodatage précis caractère par caractère, ce qui permet de connaître la
//  durée EXACTE de chaque plan, plus besoin d'estimer ni de mesurer un
//  fichier après coup (voir js/montage.js calculerDureesImages, remplacé).
//
//  Réservé au fondateur (bouton visible uniquement en body.is-admin), la
//  clé ELEVENLABS_API_KEY reste entièrement côté serveur.
// ═══════════════════════════════════════════════════════════

import { resoudreDroits } from './_lib/acces.js';

// Mêmes voix que /api/montage-voices (voir ce fichier pour le format de
// ELEVENLABS_VOICES), dupliqué plutôt qu'importé : chaque fonction
// serverless de ce projet reste autonome, aucun module partagé entre elles.
// Filet de sécurité : l'IA rédactrice a parfois tendance à répéter en tête
// de segment le minutage qu'elle produit par ailleurs dans un champ séparé
// (ex: "0-3 sec : ...", "(0:00-0:03) ..."), malgré la structure JSON qui les
// sépare déjà. Ne retire QUE ce motif en DÉBUT de segment (jamais une
// mention de durée au milieu d'une phrase, pour ne pas mutiler un vrai récit
// qui parlerait légitimement de secondes).
function retirerMinuterie(texte) {
  return texte
    .replace(/^\s*[([]?\s*\d+\s*(?:à|-|–)\s*\d+\s*(?:sec(?:ondes?)?)?\s*[)\]]?\s*[:\-–,]?\s*/i, '')
    .replace(/^\s*[([]?\s*\d{1,2}:\d{2}(?:\s*(?:à|-|–)\s*\d{1,2}:\d{2})?\s*[)\]]?\s*[:\-–,]?\s*/i, '')
    .trim();
}

function obtenirVoixDisponibles() {
  const brut = process.env.ELEVENLABS_VOICES;
  if (brut) {
    try {
      const liste = JSON.parse(brut);
      if (Array.isArray(liste) && liste.length && liste.every(v => v && v.id)) {
        // .trim() : un espace ou un retour à la ligne collé par erreur en
        // copiant l'ID dans Vercel suffit à faire échouer ElevenLabs avec
        // "The string did not match the expected pattern", mieux vaut
        // nettoyer ici que de dépendre d'une saisie parfaite.
        return liste.map(v => ({ id: String(v.id).trim(), label: String(v.label || v.name || v.id).trim() }));
      }
    } catch (e) { /* tombe sur le repli ci-dessous */ }
  }
  const idUnique = (process.env.ELEVENLABS_VOICE_ID || '').trim();
  return idUnique ? [{ id: idUnique, label: 'Voix par défaut' }] : [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Clé API absente côté serveur (ELEVENLABS_API_KEY)' } });
  }
  const voixDisponibles = obtenirVoixDisponibles();
  if (!voixDisponibles.length) {
    return res.status(500).json({ error: { message: 'Voix absente côté serveur (ELEVENLABS_VOICE_ID ou ELEVENLABS_VOICES), choisis-en une dans ta bibliothèque de voix ElevenLabs et copie son ID.' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  // Réservé au fondateur (voir en-tête de fichier) : jusqu'ici seulement
  // vérifié côté CSS (body.is-admin), donc contournable par un appel direct.
  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Réservé au fondateur', code: 'ACCES_REFUSE' } });
  }

  const segments = Array.isArray(body?.segments) ? body.segments.map(s => retirerMinuterie(String(s || '').trim())) : [];
  if (!segments.length || segments.every(s => !s)) {
    return res.status(400).json({ error: { message: 'Aucun texte à narrer' } });
  }

  // La voix demandée doit faire partie de la liste configurée côté serveur
  // (jamais un ID arbitraire envoyé par le client), même logique que pour
  // toute entrée utilisateur touchant une clé API tierce.
  const voixDemandee = typeof body?.voiceId === 'string' ? body.voiceId : '';
  const voixChoisie = voixDisponibles.find(v => v.id === voixDemandee) || voixDisponibles[0];
  const voiceId = voixChoisie.id;

  // Un seul appel pour tout le script (narration continue et naturelle),
  // les plans séparés par un espace, on retient l'index de caractère où
  // chaque plan démarre dans ce texte concaténé pour retrouver ensuite son
  // horodatage exact dans la réponse d'ElevenLabs.
  const debutsCaracteres = [];
  let curseur = 0;
  for (const s of segments) {
    debutsCaracteres.push(curseur);
    curseur += s.length + 1; // +1 pour l'espace séparateur
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

    // Repli si l'horodatage ne correspond pas exactement au texte envoyé
    // (espaces normalisés différemment, etc.) : répartition proportionnelle
    // sur la durée totale réelle plutôt qu'un plantage.
    const dureeTotale = finsTemps[finsTemps.length - 1] || 0;
    let durations;
    if (nbCaracteres === texteComplet.length) {
      // Durée d'un segment = du DÉBUT de sa phrase jusqu'au DÉBUT de la phrase
      // suivante (la dernière allant jusqu'à la fin de l'audio). Crucial : cela
      // INCLUT la pause/le silence entre deux segments. En mesurant "fin - début"
      // du seul texte du segment (ancienne méthode), ces pauses n'étaient
      // comptées nulle part → sur 15-20 plans, ~4s de silence perdus, donc la
      // vidéo finissait avant la voix off et chaque image se décalait. Ici la
      // somme des durées = durée totale exacte (télescopage), et chaque image
      // reste à l'écran pendant sa phrase + la micro-pause qui suit.
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

    // Petite marge de sécurité sur le dernier plan : le MP3 ré-encodé peut
    // dépasser de quelques centièmes la fin indiquée par ElevenLabs. Le service
    // de rendu recale de toute façon la vidéo sur la durée RÉELLE du fichier
    // audio (voir dureeAudio dans render-service), donc une petite marge suffit.
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
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

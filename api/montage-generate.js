// ═══════════════════════════════════════════════════════════
//  /api/montage-generate — Lance un rendu vidéo via JSON2Video à partir
//  d'images + d'un audio déjà uploadés dans Supabase Storage (bucket
//  "montages", voir js/montage.js). Le rendu est asynchrone côté
//  JSON2Video : cette fonction renvoie juste l'identifiant du projet,
//  à suivre ensuite via /api/montage-status.
//
//  Réservé au fondateur (bouton visible uniquement en body.is-admin,
//  voir css/style.css) — la clé JSON2VIDEO_API_KEY reste entièrement
//  côté serveur, jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.JSON2VIDEO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Clé API absente côté serveur (JSON2VIDEO_API_KEY)' }
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const images = Array.isArray(body?.images) ? body.images : [];
  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl : '';
  if (!images.length || !audioUrl) {
    return res.status(400).json({ error: { message: 'Images ou audio manquant' } });
  }

  // Liste resserrée sur demande, à des effets sobres et confirmés : fondu,
  // fondu au noir, mélange (dissolve), fondu lent (même fondu, transition
  // plus longue) et cut net (aucune transition — juste une coupe franche).
  // "Reflet" et "bogue" ont été laissés de côté : aucun nom de transition
  // correspondant n'existe dans la liste vérifiée de JSON2Video (basée sur
  // les transitions xfade de FFmpeg, sur lequel JSON2Video s'appuie) — les
  // inventer risquerait de refaire échouer le rendu, comme l'a fait "zoom"
  // en décimal la dernière fois.
  const TRANSITIONS = [
    { style: 'fade', duration: 0.5 },      // fondu
    null,                                   // cut net (pas de transition)
    { style: 'fadeblack', duration: 0.5 }, // fondu au noir
    { style: 'dissolve', duration: 0.5 },  // mélange
    { style: 'fade', duration: 1.2 }       // fondu lent
  ];
  const PANS = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  // zoom doit être un ENTIER côté JSON2Video. Juste agrandissement/rétrécissement,
  // en alternance — pas d'amplitudes multiples (demande de resserrer l'effet).
  const ZOOMS = [3, -3];
  const scenes = images.map((img, i) => {
    const transition = TRANSITIONS[i % TRANSITIONS.length];
    const scene = {
      duration: Math.max(1, Number(img.duration) || 2),
      elements: [{
        type: 'image',
        src: img.url,
        resize: 'cover',
        zoom: ZOOMS[i % ZOOMS.length],
        pan: PANS[i % PANS.length]
      }]
    };
    if (transition) scene.transition = transition;
    return scene;
  });

  const payload = {
    resolution: 'custom',
    width: 1080,
    height: 1920,
    quality: 'high',
    scenes,
    elements: [{ type: 'audio', src: audioUrl, duration: -1 }]
  };

  try {
    const rendu = await fetch('https://api.json2video.com/v2/movies', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await rendu.json();
    if (!rendu.ok || data?.success === false || !data?.project) {
      const message = data?.message || 'Le montage n\'a pas pu démarrer côté JSON2Video';
      return res.status(502).json({ error: { message } });
    }
    return res.status(200).json({ project: data.project });
  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

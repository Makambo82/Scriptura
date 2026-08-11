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

  // Transitions variées entre les plans + zoom/panoramique (effet Ken Burns)
  // dont l'amplitude et la direction changent à chaque plan : sur un montage
  // à 15-20 images, répéter le même fondu + les 2 mêmes niveaux de zoom
  // devient vite monotone. On fait tourner plusieurs styles de transition et
  // plusieurs combinaisons zoom/panoramique, jamais deux fois la même de
  // suite (chaque tableau a une longueur première entre elles, donc les
  // motifs ne se resynchronisent pas avant longtemps).
  const TRANSITIONS = ['fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'circleopen', 'smoothleft', 'smoothright', 'dissolve'];
  const PANS = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const ZOOMS = [2, -2, 3, -1.5, 1.5, -3, 2.5, -2.5];
  const scenes = images.map((img, i) => ({
    duration: Math.max(1, Number(img.duration) || 2),
    transition: { style: TRANSITIONS[i % TRANSITIONS.length], duration: 0.5 },
    elements: [{
      type: 'image',
      src: img.url,
      resize: 'cover',
      zoom: ZOOMS[i % ZOOMS.length],
      pan: PANS[i % PANS.length]
    }]
  }));

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

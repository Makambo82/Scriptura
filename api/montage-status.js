// ═══════════════════════════════════════════════════════════
//  /api/montage-status — Suit l'avancement d'un rendu JSON2Video lancé
//  par /api/montage-generate. js/montage.js interroge cette route toutes
//  les quelques secondes jusqu'à statut "done" (ou "error").
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.JSON2VIDEO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Clé API absente côté serveur (JSON2VIDEO_API_KEY)' }
    });
  }

  const project = req.query?.project;
  if (!project || typeof project !== 'string') {
    return res.status(400).json({ error: { message: 'Paramètre project manquant' } });
  }

  try {
    const rep = await fetch(
      'https://api.json2video.com/v2/movies?project=' + encodeURIComponent(project),
      { headers: { 'x-api-key': apiKey } }
    );
    const data = await rep.json();
    if (!rep.ok) {
      const message = data?.message || 'Statut du rendu introuvable';
      return res.status(rep.status).json({ error: { message } });
    }
    const movie = data?.movie || {};
    return res.status(200).json({
      status: movie.status || 'unknown',
      url: movie.url || null,
      message: movie.message || ''
    });
  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

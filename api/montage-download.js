// ═══════════════════════════════════════════════════════════
//  /api/montage-download, Proxy de téléchargement pour la vidéo rendue.
//  Un fetch() JS direct vers le CDN Supabase échoue souvent à cause du CORS
//  (même quand <video src> fonctionne très bien, la lecture du corps de la
//  réponse via fetch, elle, l'exige), ce qui faisait retomber js/montage.js
//  sur l'ouverture brute de la vidéo au lieu du partage natif. En transitant
//  par ce proxy (même origine que Scriptura), plus de CORS côté client.
//
//  Restreint au seul hôte de confiance connu (le projet Supabase de
//  Scriptura) pour ne jamais servir de proxy ouvert vers une URL arbitraire
//  (SSRF).
// ═══════════════════════════════════════════════════════════

const HOTES_AUTORISES = [/^nlkfqxllunbvppulpnzl\.supabase\.co$/i];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

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
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

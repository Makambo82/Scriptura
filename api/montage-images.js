// ═══════════════════════════════════════════════════════════
//  /api/montage-images — Génère les images du montage via l'Inference API
//  Hugging Face (FLUX.1-schnell), à partir des prompts visuels déjà écrits
//  par Scriptura pour chaque plan du storyboard (voir js/storyboard.js
//  genererVisuelsParLots) — rien à écrire de plus pour l'utilisateur.
//
//  Choisi pour son palier gratuit accessible SANS carte bancaire (Gemini
//  exige un compte de facturation même pour un quota nul à zéro, voir la
//  version précédente de ce fichier) — au prix d'un débit plus limité et de
//  "cold starts" (le modèle met parfois quelques secondes à démarrer s'il
//  n'a pas tourné récemment, réponse 503 le temps qu'il charge).
//
//  Chaque prompt est traité indépendamment (échec d'un plan ≠ échec des
//  autres, même logique que genererVisuelsParLots côté texte).
//
//  Réservé au fondateur — la clé HUGGINGFACE_API_KEY reste entièrement côté
//  serveur, jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

const CONCURRENCE_MAX = 3; // limite les appels simultanés (palier gratuit)
const MODELE = 'black-forest-labs/FLUX.1-schnell';
// 768×1344 ≈ 9:16, dimensions multiples de 8 (contrainte des modèles de diffusion).
const LARGEUR = 768, HAUTEUR = 1344;

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

async function genererUneImage(apiKey, prompt, tentative) {
  // L'ancien domaine api-inference.huggingface.co est décommissionné
  // (renvoie désormais une erreur réseau, jamais une réponse HTTP) — Hugging
  // Face route tout via router.huggingface.co depuis sa migration vers
  // "Inference Providers".
  const rep = await fetch(
    'https://router.huggingface.co/hf-inference/models/' + MODELE,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { width: LARGEUR, height: HAUTEUR } })
    }
  );

  const typeContenu = rep.headers.get('content-type') || '';
  if (!rep.ok || typeContenu.includes('application/json')) {
    const data = await rep.json().catch(() => ({}));
    // Cold start : le modèle charge, HF indique le temps d'attente estimé —
    // on retente une fois plutôt que d'échouer directement dessus.
    if (rep.status === 503 && data?.estimated_time && tentative < 2) {
      await attendre(Math.min(data.estimated_time * 1000, 20000));
      return genererUneImage(apiKey, prompt, tentative + 1);
    }
    throw new Error(data?.error || 'Échec de génération (statut ' + rep.status + ')');
  }

  const tampon = Buffer.from(await rep.arrayBuffer());
  return { base64: tampon.toString('base64'), mimeType: typeContenu || 'image/jpeg' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Clé API absente côté serveur (HUGGINGFACE_API_KEY)' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const prompts = Array.isArray(body?.prompts) ? body.prompts.map(p => String(p || '').trim()) : [];
  if (!prompts.length || prompts.every(p => !p)) {
    return res.status(400).json({ error: { message: 'Aucun prompt à générer' } });
  }

  const resultats = new Array(prompts.length).fill(null);
  const erreurs = new Array(prompts.length).fill(null);

  let curseur = 0;
  async function travailleur() {
    while (curseur < prompts.length) {
      const i = curseur++;
      if (!prompts[i]) { erreurs[i] = 'Prompt vide'; continue; }
      try { resultats[i] = await genererUneImage(apiKey, prompts[i], 0); }
      catch (e) { erreurs[i] = e.message || 'Erreur inconnue'; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCE_MAX, prompts.length) }, travailleur));

  return res.status(200).json({ images: resultats, erreurs });
}

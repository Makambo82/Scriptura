// ═══════════════════════════════════════════════════════════
//  /api/montage-images — Génère les images du montage via Together AI
//  (FLUX.1-schnell-Free), à partir des prompts visuels déjà écrits par
//  Scriptura pour chaque plan du storyboard (voir js/storyboard.js
//  genererVisuelsParLots) — rien à écrire de plus pour l'utilisateur.
//
//  Historique de cette fonction (pour ne pas retenter les mêmes pistes) :
//  Gemini → quota à zéro sans facturation. Hugging Face (hf-inference) →
//  FLUX.1-schnell puis FLUX.2-dev refusés ("model deprecated"), puis
//  stable-diffusion-3-medium fonctionnel mais crédit mensuel gratuit vite
//  épuisé. Together AI propose un modèle spécifiquement gratuit ET illimité
//  (FLUX.1-schnell-Free, distinct du modèle payant black-forest-labs/FLUX.1-schnell)
//  via un partenariat avec Black Forest Labs.
//
//  Chaque prompt est traité indépendamment (échec d'un plan ≠ échec des
//  autres, même logique que genererVisuelsParLots côté texte).
//
//  Réservé au fondateur — la clé TOGETHER_API_KEY reste entièrement côté
//  serveur, jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

const CONCURRENCE_MAX = 3;
const MODELE = 'black-forest-labs/FLUX.1-schnell-Free';
const LARGEUR = 768, HAUTEUR = 1344; // ≈ 9:16

async function genererUneImage(apiKey, prompt) {
  const rep = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELE,
      prompt,
      width: LARGEUR,
      height: HAUTEUR,
      steps: 4, // FLUX schnell est conçu pour très peu d'étapes (rapide)
      n: 1,
      response_format: 'base64'
    })
  });
  const data = await rep.json();
  if (!rep.ok) {
    throw new Error(data?.error?.message || data?.error || 'Échec de génération (statut ' + rep.status + ')');
  }
  const image = (data.data || [])[0];
  const b64 = image && (image.b64_json || image.base64);
  if (!b64) throw new Error('Aucune image renvoyée par Together AI');
  return { base64: b64, mimeType: 'image/png' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Clé API absente côté serveur (TOGETHER_API_KEY)' } });
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
      try { resultats[i] = await genererUneImage(apiKey, prompts[i]); }
      catch (e) { erreurs[i] = e.message || 'Erreur inconnue'; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCE_MAX, prompts.length) }, travailleur));

  return res.status(200).json({ images: resultats, erreurs });
}

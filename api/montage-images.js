// ═══════════════════════════════════════════════════════════
//  /api/montage-images — Génère les images du montage via Together AI
//  (FLUX.1-schnell, modèle serverless payant), à partir des prompts visuels
//  déjà écrits par Scriptura pour chaque plan du storyboard (voir
//  js/storyboard.js genererVisuelsParLots) — rien à écrire de plus pour
//  l'utilisateur.
//
//  Historique de cette fonction (pour ne pas retenter les mêmes pistes) :
//  Gemini → quota à zéro sans facturation. Hugging Face (hf-inference) →
//  FLUX.1-schnell puis FLUX.2-dev refusés ("model deprecated"), puis
//  stable-diffusion-3-medium fonctionnel mais crédit mensuel gratuit vite
//  épuisé. Together AI FLUX.1-schnell-Free (gratuit) → refusé, ce n'est PAS
//  un modèle serverless standard (exige un point de terminaison dédié créé
//  à la main dans leur dashboard). Le modèle payant (sans "-Free") est un
//  vrai modèle serverless, facturé à l'image, sans instance à gérer.
//
//  Chaque prompt est traité indépendamment (échec d'un plan ≠ échec des
//  autres, même logique que genererVisuelsParLots côté texte).
//
//  Réservé au fondateur — la clé TOGETHER_API_KEY reste entièrement côté
//  serveur, jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

// Un seul appel à la fois : en parallèle (3 avant), Together AI renvoyait
// une erreur de limite de débit sur une partie des appels (l'API refusait
// la génération "en bloc" alors qu'une régénération individuelle, forcément
// séquentielle, passait toujours) — le compte n'autorise apparemment qu'une
// requête d'image à la fois. En plus du séquentiel, on retente automatique-
// ment une erreur de type limite de débit (429) avant d'abandonner ce plan.
const CONCURRENCE_MAX = 1;
const TENTATIVES_MAX = 3;
// FLUX.1-schnell-Free n'est PAS un modèle serverless standard côté Together
// AI : il exige un point de terminaison dédié (instance GPU à créer et faire
// tourner soi-même dans leur dashboard), pas un simple appel API — d'où
// l'erreur "Unable to access non-serverless model". La version payante
// (sans "-Free") est un vrai modèle serverless, facturée à l'image.
//
// FLUX.1-schnell (4 étapes, distillé pour la vitesse) produisait des images
// plates d'à peine ~500 Ko. FLUX1.1-pro donnait une belle qualité mais coûtait
// ~15× plus cher à l'unité ET consommait beaucoup plus de "pixel-step tokens"
// (25+ étapes internes) — soit ~50-80× le coût par image de schnell. On retient
// FLUX.1-dev : nettement plus détaillé que schnell, mais 2-3× moins cher que pro.
// Le nombre d'étapes est réglable ici : 20 offre un bon rendu tout en limitant
// la facturation (facturée au "pixel × étape").
const MODELE = 'black-forest-labs/FLUX.1-dev';
const ETAPES = 20;
// Dimensions par format (multiples de 16, requis par FLUX). Le client envoie
// le format choisi ; à défaut, vertical 9:16.
const DIMENSIONS_FORMAT = {
  '9:16': { w: 768,  h: 1344 },
  '16:9': { w: 1344, h: 768 },
  '1:1':  { w: 1024, h: 1024 },
};
// Plus de style figé ici : le style graphique choisi par le créateur est déjà
// présent dans le prompt reçu (footer ajouté côté client par appliquerStyleVisuel,
// js/api.js) — un préfixe "peinture à l'huile" en dur écraserait ce choix.

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

// Le filtre de sécurité de Together/FLUX bloque parfois une image par FAUX
// POSITIF (scène dramatique, politique, tendue…). On réessaie alors avec le
// même prompt encadré de termes de sécurité explicites : ça encadre la
// composition sans changer le sujet, et passe le filtre dans la grande
// majorité des cas. On retire d'abord le footer 9:16 pour le remettre après.
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
      body: JSON.stringify({
        model: MODELE,
        prompt: promptCourant,
        width: dims.w,
        height: dims.h,
        steps: ETAPES,
        n: 1,
        response_format: 'base64'
      })
    });
    const data = await rep.json();
    if (rep.ok) {
      const image = (data.data || [])[0];
      const b64 = image && (image.b64_json || image.base64);
      if (!b64) throw new Error('Aucune image renvoyée par Together AI');
      return { base64: b64, mimeType: 'image/png' };
    }
    const message = data?.error?.message || data?.error || 'Échec de génération (statut ' + rep.status + ')';
    // Faux positif NSFW : reformule une fois en version sûre et réessaie.
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

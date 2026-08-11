// ═══════════════════════════════════════════════════════════
//  /api/montage-images — Génère les images du montage via Gemini
//  (gemini-2.5-flash-image), à partir des prompts visuels déjà écrits par
//  Scriptura pour chaque plan du storyboard (voir js/storyboard.js
//  genererVisuelsParLots) — rien à écrire de plus pour l'utilisateur.
//
//  Chaque prompt est traité indépendamment (échec d'un plan ≠ échec des
//  autres, comme genererVisuelsParLots côté texte) : un sujet sensible
//  (personnalité politique réelle, par exemple) peut être bloqué par les
//  filtres de sécurité de Gemini sans faire échouer tout le lot.
//
//  Réservé au fondateur — la clé GEMINI_API_KEY reste entièrement côté
//  serveur, jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

const CONCURRENCE_MAX = 3; // limite les appels simultanés (quota du palier gratuit)

async function genererUneImage(apiKey, prompt) {
  const rep = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['Image'], imageConfig: { aspectRatio: '9:16' } }
      })
    }
  );
  const data = await rep.json();
  if (!rep.ok) {
    throw new Error(data?.error?.message || 'Échec de génération');
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  // Casse du champ non garantie selon la version de l'API (inlineData vs
  // inline_data) : on gère les deux plutôt que de parier sur une seule.
  const partImage = parts.find(p => p.inlineData || p.inline_data);
  const inline = partImage && (partImage.inlineData || partImage.inline_data);
  if (!inline || !inline.data) {
    const raisonBlocage = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error(raisonBlocage ? 'Bloqué par Gemini (' + raisonBlocage + ')' : 'Aucune image renvoyée');
  }
  return { base64: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/png' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Clé API absente côté serveur (GEMINI_API_KEY)' } });
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

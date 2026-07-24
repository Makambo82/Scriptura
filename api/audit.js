// ═══════════════════════════════════════════════════════════
//  /api/audit — Fonction dédiée au mode "Analyse mon compte TikTok"
//  Reçoit des captures d'écran (images) + un prompt, les transmet
//  à l'API Anthropic, renvoie la réponse.
//
//  Fichier INDÉPENDANT : ne touche pas aux autres modes de Scriptura.
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // Seules les requêtes POST sont acceptées
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Clé API absente côté serveur (ANTHROPIC_API_KEY)' }
    });
  }

  try {
    const { model, max_tokens, images, prompt } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: { message: 'Prompt manquant' } });
    }

    // Construction du contenu : les images d'abord, le texte ensuite.
    // (L'API Anthropic recommande cet ordre pour l'analyse visuelle.)
    const content = [];

    if (Array.isArray(images)) {
      for (const img of images) {
        if (!img || !img.base64) continue;
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType || 'image/jpeg',
            data: img.base64
          }
        });
      }
    }

    content.push({ type: 'text', text: prompt });

    // Appel à l'API Anthropic
    const reponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 4000,
        messages: [{ role: 'user', content: content }]
      })
    });

    const data = await reponse.json();

    if (!reponse.ok) {
      return res.status(reponse.status).json(data);
    }

    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

// api/generate.js — Fonction serverless Vercel
// Garde la clé API secrète et relaie les requêtes vers Anthropic

export default async function handler(req, res) {
  // Autoriser uniquement POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  try {
    const { model, max_tokens, messages } = req.body;

    // Appel à l'API Anthropic avec la clé stockée dans les variables d'environnement Vercel
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 4000,
        messages: messages
      })
    });

    const data = await response.json();

    // Renvoyer la réponse (ou l'erreur) au navigateur
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + error.message } });
  }
}

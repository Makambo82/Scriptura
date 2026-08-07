// ═══════════════════════════════════════════════════════════
//  /api/username-scan — Diagnostic sommaire via @nom d'utilisateur TikTok
//  Récupère le profil PUBLIC d'un compte via LamaTok (service tiers,
//  non-officiel) et renvoie les données brutes telles quelles : c'est
//  js/diagnostic-sommaire.js (côté client) qui les transmet ensuite à
//  l'IA pour en tirer un diagnostic.
//
//  La clé LamaTok reste entièrement côté serveur (LAMATOK_API_KEY) :
//  jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.LAMATOK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' }
    });
  }

  try {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: { message: "Nom d'utilisateur manquant" } });
    }
    // Nettoie le @ éventuel et les espaces
    const propre = username.trim().replace(/^@+/, '');

    const url = 'https://api.lamatok.com/v1/user/by/username?username=' + encodeURIComponent(propre);
    const reponse = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-access-key': apiKey
      }
    });

    const data = await reponse.json();

    if (!reponse.ok) {
      // Profil introuvable / privé / erreur LamaTok : on relaie un message clair
      const message = (data && (data.message || data.error)) || 'Profil introuvable ou privé';
      return res.status(reponse.status).json({ error: { message } });
    }

    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

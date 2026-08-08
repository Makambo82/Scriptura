// ═══════════════════════════════════════════════════════════
//  /api/username-scan — Diagnostic sommaire via @nom d'utilisateur TikTok
//  Récupère le profil PUBLIC d'un compte via LamaTok (service tiers,
//  non-officiel) et renvoie ces données brutes telles quelles : c'est
//  js/diagnostic-sommaire.js (côté client) qui les transmet ensuite à
//  l'IA pour en tirer un diagnostic.
//
//  Volontairement PROFIL SEUL : LamaTok n'expose aucun endpoint pour
//  lister les vidéos d'un compte (vérifié sur leur documentation Swagger
//  complète — v1/user, v1/media, v1/hashtag, v2 — rien de ce type
//  n'existe). Les dimensions qui ont besoin de données par vidéo
//  (régularité, viralité, portée réelle) sont donc structurellement hors
//  de portée de ce diagnostic sommaire ; seules celles calculables à
//  partir des totaux du profil le sont (voir js/diagnostic-sommaire.js).
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
    const headers = { accept: 'application/json', 'x-access-key': apiKey };

    const repProfil = await fetch(
      'https://api.lamatok.com/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers }
    );
    const profil = await repProfil.json();

    if (!repProfil.ok) {
      const message = (profil && (profil.message || profil.error)) || 'Profil introuvable ou privé';
      return res.status(repProfil.status).json({ error: { message } });
    }

    return res.status(200).json({ profil });

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

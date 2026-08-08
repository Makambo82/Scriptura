// ═══════════════════════════════════════════════════════════
//  /api/username-scan — Diagnostic sommaire via @nom d'utilisateur TikTok
//  Récupère le profil PUBLIC d'un compte, PLUS ses dernières vidéos
//  (vues/likes/commentaires/partages/date), via LamaTok (service tiers,
//  non-officiel), et renvoie ces données brutes telles quelles : c'est
//  js/diagnostic-sommaire.js (côté client) qui les transmet ensuite à
//  l'IA pour en tirer un diagnostic (score, engagement, régularité,
//  viralité, niche, bio...).
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

    // 1) Profil public
    const repProfil = await fetch(
      'https://api.lamatok.com/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers }
    );
    const profil = await repProfil.json();

    if (!repProfil.ok) {
      const message = (profil && (profil.message || profil.error)) || 'Profil introuvable ou privé';
      return res.status(repProfil.status).json({ error: { message } });
    }

    // 2) Dernières vidéos (vues/likes/commentaires/partages/date) — nécessaire
    //    pour calculer engagement, régularité et viralité. Best-effort : si
    //    cet appel échoue (endpoint/paramètre différent de ce qui est
    //    documenté publiquement, compte sans vidéo, etc.), on renvoie quand
    //    même le profil seul plutôt que de faire échouer tout le diagnostic.
    let medias = [];
    let mediasErreur = null;
    try {
      const repMedias = await fetch(
        'https://api.lamatok.com/v1/user/medias?username=' + encodeURIComponent(propre) + '&count=20',
        { headers }
      );
      const dataMedias = await repMedias.json();
      if (repMedias.ok) {
        medias = Array.isArray(dataMedias) ? dataMedias
               : Array.isArray(dataMedias?.medias) ? dataMedias.medias
               : Array.isArray(dataMedias?.data) ? dataMedias.data
               : [];
      } else {
        mediasErreur = dataMedias?.message || dataMedias?.error || 'liste des vidéos indisponible';
      }
    } catch (e) {
      mediasErreur = e.message || 'liste des vidéos indisponible';
    }

    return res.status(200).json({ profil, medias, medias_erreur: mediasErreur });

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

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
    const urlMedias = 'https://api.lamatok.com/v1/user/medias?username=' + encodeURIComponent(propre) + '&count=20';
    try {
      const repMedias = await fetch(urlMedias, { headers });
      const texteBrut = await repMedias.text();
      let dataMedias = null;
      try { dataMedias = JSON.parse(texteBrut); } catch (e) { /* réponse non-JSON, traitée ci-dessous */ }

      if (!repMedias.ok) {
        // Diagnostic complet : statut HTTP + un aperçu du corps de la réponse,
        // pour comprendre EXACTEMENT pourquoi (mauvais endpoint, mauvais
        // paramètre, quota LamaTok épuisé...) plutôt que d'échouer en silence.
        const message = (dataMedias && (dataMedias.message || dataMedias.error)) || texteBrut.slice(0, 200) || 'réponse vide';
        mediasErreur = `HTTP ${repMedias.status} sur ${urlMedias} — ${message}`;
      } else {
        medias = Array.isArray(dataMedias) ? dataMedias
               : Array.isArray(dataMedias?.medias) ? dataMedias.medias
               : Array.isArray(dataMedias?.data) ? dataMedias.data
               : Array.isArray(dataMedias?.items) ? dataMedias.items
               : Array.isArray(dataMedias?.aweme_list) ? dataMedias.aweme_list
               : Array.isArray(dataMedias?.videos) ? dataMedias.videos
               : Array.isArray(dataMedias?.posts) ? dataMedias.posts
               : Array.isArray(dataMedias?.result) ? dataMedias.result
               : [];
        // Réponse 200 mais aucune des formes connues ne contient de tableau :
        // on garde les clés reçues pour comprendre la vraie forme de la réponse.
        if (!medias.length && dataMedias && typeof dataMedias === 'object') {
          mediasErreur = `Réponse 200 mais forme inattendue — clés reçues : ${Object.keys(dataMedias).join(', ') || 'aucune'}`;
        }
      }
    } catch (e) {
      mediasErreur = 'Appel réseau échoué vers ' + urlMedias + ' — ' + (e.message || 'inconnue');
    }

    return res.status(200).json({ profil, medias, medias_erreur: mediasErreur });

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

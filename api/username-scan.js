// ═══════════════════════════════════════════════════════════
//  /api/username-scan — Diagnostic sommaire via @nom d'utilisateur TikTok
//  Récupère le PROFIL PUBLIC d'un compte via LamaTok (service tiers,
//  non-officiel) et le renvoie tel quel : c'est js/diagnostic-sommaire.js
//  (côté client) qui en tire ensuite un diagnostic (calculs + IA).
//
//  LIMITE CONFIRMÉE de LamaTok (catalogue OpenAPI vérifié le 15/08/2026,
//  23 routes) : aucun endpoint ne liste les vidéos d'un COMPTE. Les seules
//  routes "média" sont par id/url d'une vidéo précise, ou par hashtag —
//  jamais "toutes les vidéos de @pseudo". Les dimensions qui ont besoin de
//  données par vidéo (Portée, Régularité, Viralité) sont donc hors de portée
//  avec ce fournisseur ; seul l'Engagement (calculé sur les totaux du profil)
//  est disponible. Pour les débloquer il faudrait un fournisseur qui expose
//  la liste des vidéos d'un compte (TikAPI, EnsembleData, ScrapTik…) : ce
//  serait ici qu'on ajouterait ce 2e appel, en renvoyant `medias` peuplé.
//
//  La clé LamaTok reste entièrement côté serveur (LAMATOK_API_KEY) :
//  jamais exposée au navigateur.
// ═══════════════════════════════════════════════════════════

const BASE = 'https://api.lamatok.com';

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
      BASE + '/v1/user/by/username?username=' + encodeURIComponent(propre),
      { headers }
    );
    const profil = await repProfil.json();

    if (!repProfil.ok) {
      const message = (profil && (profil.message || profil.error)) || 'Profil introuvable ou privé';
      return res.status(repProfil.status).json({ error: { message } });
    }

    // medias:null — LamaTok ne liste pas les vidéos d'un compte (voir en-tête).
    // Le client gère ce cas : diagnostic limité à l'Engagement.
    return res.status(200).json({ profil, medias: null });

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

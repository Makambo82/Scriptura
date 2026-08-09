// ═══════════════════════════════════════════════════════════
//  /api/verify-code — Vérifie si un code est le code fondateur/admin, ou
//  un code de secours illimité/mensuel, SANS jamais exposer ces codes au
//  navigateur.
//
//  AVANT cette fonction, ces codes (SCRIPTURA-CELINE, SCRIPTURA-JUIL-2026…)
//  étaient codés en dur dans js/api.js et js/abonnement.js — n'importe qui
//  ouvrant les outils de développement ou lisant le JS servi par le site
//  pouvait les lire et se les attribuer gratuitement (accès Pro illimité,
//  voire le Tableau de bord fondateur). Ils vivent maintenant uniquement
//  dans des variables d'environnement Vercel, jamais envoyées au client.
//
//  Les abonnements normaux (payants, avec ligne dans la table Supabase
//  `abonnes`) continuent d'être vérifiés directement par le client contre
//  Supabase (voir js/auth.js verifyCode()) : ce fichier ne couvre que les
//  codes qui n'ont pas — ou pas besoin d'avoir — de ligne Supabase.
//
//  Variables d'environnement attendues (à définir sur Vercel) :
//  - CODE_ADMIN     : un seul code, donne accès au Tableau de bord + illimité.
//  - CODES_ILLIMITES: codes VIP séparés par des virgules, illimité SANS Tableau de bord.
//  - CODES_SECOURS  : codes de secours (accès Pro classique) séparés par des virgules,
//                      à faire tourner régulièrement — remplace l'ancien CODES_VALIDES.
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // Diagnostic (GET) : confirme si les variables d'environnement sont bien
  // reçues par le serveur, SANS jamais révéler leur valeur — seulement leur
  // présence et leur longueur (utile pour repérer un guillemet ou un espace
  // collé par erreur dans Vercel, sans exposer le code lui-même). Voir
  // aussi js/auth.js — TEMPORAIRE, à retirer une fois le diagnostic terminé.
  if (req.method === 'GET') {
    const codeAdminRaw = process.env.CODE_ADMIN || '';
    const codesIllimitesRaw = process.env.CODES_ILLIMITES || '';
    const codesSecoursRaw = process.env.CODES_SECOURS || '';
    return res.status(200).json({
      diagnostic: true,
      CODE_ADMIN: { defini: !!codeAdminRaw, longueur: codeAdminRaw.length },
      CODES_ILLIMITES: { defini: !!codesIllimitesRaw, longueur: codesIllimitesRaw.length },
      CODES_SECOURS: { defini: !!codesSecoursRaw, longueur: codesSecoursRaw.length }
    });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const code = String(body?.code || '').trim().toUpperCase();
  if (!code) {
    return res.status(200).json({ valid: false, isAdmin: false, illimite: false });
  }

  const codeAdmin = (process.env.CODE_ADMIN || '').trim().toUpperCase();
  const codesIllimites = (process.env.CODES_ILLIMITES || '')
    .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const codesSecours = (process.env.CODES_SECOURS || '')
    .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

  if (codeAdmin && code === codeAdmin) {
    return res.status(200).json({ valid: true, isAdmin: true, illimite: true, plan: 'pro' });
  }
  if (codesIllimites.includes(code)) {
    return res.status(200).json({ valid: true, isAdmin: false, illimite: true, plan: 'pro' });
  }
  if (codesSecours.includes(code)) {
    return res.status(200).json({ valid: true, isAdmin: false, illimite: false, plan: 'pro' });
  }
  return res.status(200).json({ valid: false, isAdmin: false, illimite: false });
}

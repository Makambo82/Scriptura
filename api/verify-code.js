// ═══════════════════════════════════════════════════════════
//  /api/verify-code, Vérifie un code d'accès et renvoie les droits réels :
//  admin/VIP/secours (variables d'environnement Vercel, jamais exposées au
//  navigateur), OU abonné normal / jeton (ligne Supabase `abonnes`, relue
//  ici avec la clé service_role pour fonctionner même une fois la RLS
//  verrouillée sur cette table, voir supabase/abonnes_rls.sql).
//
//  AVANT cette fonction, les codes admin/VIP (SCRIPTURA-CELINE,
//  SCRIPTURA-JUIL-2026…) étaient codés en dur dans js/api.js et
//  js/abonnement.js, lisibles par n'importe qui ouvrant les outils de
//  développement. Puis les abonnements normaux étaient vérifiés en
//  interrogeant Supabase DIRECTEMENT depuis le navigateur (clé anon) : une
//  fois la RLS verrouillée sur `abonnes`, ce n'est plus possible, tout passe
//  maintenant par cette seule route (voir js/auth.js verifyCode()).
//
//  Variables d'environnement attendues (à définir sur Vercel) :
//  - CODE_ADMIN     : un seul code, donne accès au Tableau de bord + illimité.
//  - CODES_ILLIMITES: codes VIP séparés par des virgules, illimité SANS Tableau de bord.
//  - CODES_SECOURS  : codes de secours (accès Pro classique) séparés par des virgules.
//  - SUPABASE_SERVICE_ROLE_KEY : lecture de `abonnes` malgré la RLS verrouillée.
// ═══════════════════════════════════════════════════════════

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

// Relit la ligne Supabase d'un code (abonnement payant OU jeton seul).
// Renvoie null si absente, indisponible, ou si le compte est désactivé/expiré.
async function ligneAbonne(code) {
  const cfg = config();
  if (!cfg) return { indisponible: true };
  try {
    const r = await fetch(
      cfg.url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code) + '&select=actif,expire_le,plan,jetons_audit',
      { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
    );
    // Erreur Supabase (clé invalide, schéma, RLS, quota API…) : sans cette
    // vérification, une panne était traitée exactement comme "code inconnu"
    // (rows.length===0 par défaut de r.json() en erreur), donc "code
    // invalide" affiché à un abonné réel à la moindre erreur d'API.
    if (!r.ok) return { indisponible: true };
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch (e) { return { indisponible: true }; }
}

export default async function handler(req, res) {
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

  // Ni admin ni VIP : abonnement normal, ou jeton, ou code invalide.
  const ligne = await ligneAbonne(code);
  if (!ligne) {
    return res.status(200).json({ valid: false, isAdmin: false, illimite: false });
  }
  if (ligne.indisponible) {
    // Panne réseau/Supabase, ou clé service role pas encore configurée : ne
    // jamais enfermer un abonné dehors pour ça (même filet qu'ailleurs).
    return res.status(200).json({ valid: false, isAdmin: false, illimite: false, indisponible: true });
  }
  if (ligne.actif === false) {
    return res.status(200).json({ valid: false, isAdmin: false, illimite: false, raison: 'compte désactivé' });
  }
  if (ligne.expire_le) {
    const s = String(ligne.expire_le).split('T')[0].split(' ')[0].replace(/\//g, '-');
    const p = s.split('-');
    if (p.length === 3) {
      const exp = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 23, 59, 59, 999);
      if (!isNaN(exp.getTime()) && exp < new Date()) {
        return res.status(200).json({ valid: false, isAdmin: false, illimite: false, raison: 'abonnement expiré' });
      }
    }
  }
  const planBrut = String(ligne.plan || '').trim().toLowerCase();
  const jetons = parseInt(ligne.jetons_audit, 10) || 0;
  return res.status(200).json({
    valid: true,
    isAdmin: false,
    illimite: false,
    plan: planBrut || undefined,
    jeton: planBrut === 'jeton',
    jetons,
    expireLe: ligne.expire_le || null
  });
}

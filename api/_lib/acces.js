// ═══════════════════════════════════════════════════════════
//  api/_lib/acces.js, MODULE SERVEUR PARTAGÉ : le SERVEUR devient la source
//  de vérité pour les droits d'accès (plan, jetons, admin) et les quotas
//  mensuels par mode. Importé par les routes /api/* qui consomment une
//  ressource payante ou une fonctionnalité réservée. N'est PAS une route
//  (le préfixe _lib fait que Vercel l'ignore comme endpoint).
//
//  Utilise SUPABASE_SERVICE_ROLE_KEY (variable d'environnement Vercel,
//  JAMAIS envoyée au navigateur, à récupérer dans Supabase > Réglages > API
//  > "service_role") pour lire/écrire malgré le verrou RLS posé sur
//  `abonnes` (voir supabase/abonnes_rls.sql). Tant que cette clé n'est pas
//  configurée sur Vercel, les fonctions ci-dessous se dégradent en laissant
//  passer (comme le comportement d'avant cette passe de sécurisation) :
//  aucune régression immédiate, mais rien n'est réellement vérifié tant
//  qu'elle n'est pas ajoutée.
//
//  Les limites doivent rester synchronisées avec LIMITES_MOIS /
//  MAX_SOMMAIRE_GRATUIT / MAX_VIRAL_GRATUIT (js/api.js) et MAX_FREE
//  (js/abonnement.js) : dupliquées ici comme nettoyerCle l'est déjà entre
//  plusieurs fichiers api/*.js, le serveur ne peut pas importer un fichier
//  pensé pour le navigateur.
// ═══════════════════════════════════════════════════════════

const LIMITES_MOIS = {
  creator: { creation: 40, audit: 0, diagnosticSommaire: 10, analyseVirale: 6 },
  pro:     { creation: 70, audit: 5, diagnosticSommaire: 25, analyseVirale: 15 }
};
const PLAN_PAR_DEFAUT = 'creator';
const MAX_FREE = 5;                // création, code jeton/inconnu (à vie)
const MODES_GRATUIT_UNIQUE = { diagnosticSommaire: 1, analyseVirale: 1 }; // à vie
const MODES_JETON = { audit: true, diagnosticSommaire: true, analyseVirale: true, creation: false };

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

// Codes admin/VIP/secours : mêmes variables d'environnement que
// api/verify-code.js, jamais de ligne Supabase pour ceux-là.
function codesEnv() {
  return {
    admin: (process.env.CODE_ADMIN || '').trim().toUpperCase(),
    illimites: (process.env.CODES_ILLIMITES || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
    secours: (process.env.CODES_SECOURS || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
  };
}

// Résout les droits RÉELS d'un code_acces, en relisant Supabase soi-même
// (jamais une valeur envoyée par le client). Sans code : visiteur anonyme,
// pas de plan (le filet IP est un appel séparé, voir verifierLimiteAnonyme).
async function resoudreDroits(code) {
  if (!code) return { ok: true, anonyme: true, isAdmin: false, illimite: false, plan: null, jetons: 0 };

  const codeUpper = String(code).trim().toUpperCase();
  const { admin, illimites, secours } = codesEnv();
  if (admin && codeUpper === admin) return { ok: true, anonyme: false, isAdmin: true, illimite: true, plan: 'pro', jetons: Infinity };
  if (illimites.includes(codeUpper)) return { ok: true, anonyme: false, isAdmin: false, illimite: true, plan: 'pro', jetons: Infinity };
  if (secours.includes(codeUpper)) return { ok: true, anonyme: false, isAdmin: false, illimite: false, plan: 'pro', jetons: Infinity };

  const cfg = config();
  if (!cfg) {
    // Clé service role absente : dégradation (voir en-tête de fichier),
    // on ne bloque personne mais rien n'est réellement vérifié ici.
    return { ok: true, anonyme: false, isAdmin: false, illimite: false, plan: PLAN_PAR_DEFAUT, jetons: 0, nonConfigure: true };
  }

  try {
    const r = await fetch(
      cfg.url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code) + '&select=actif,expire_le,plan,jetons_audit',
      { headers: entetes(cfg.key) }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      // Code absent de Supabase (et pas admin/VIP) : traité comme non-abonné,
      // jamais comme un accès Pro par défaut.
      return { ok: true, anonyme: false, isAdmin: false, illimite: false, plan: null, jetons: 0, codeInconnu: true };
    }
    const ab = rows[0];
    const jetons = parseInt(ab.jetons_audit, 10) || 0;
    if (ab.actif === false) return { ok: false, raison: 'compte désactivé' };
    if (ab.expire_le) {
      const s = String(ab.expire_le).split('T')[0].split(' ')[0].replace(/\//g, '-');
      const p = s.split('-');
      if (p.length === 3) {
        const exp = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 23, 59, 59, 999);
        if (!isNaN(exp.getTime()) && exp < new Date()) return { ok: false, raison: 'abonnement expiré' };
      }
    }
    const planBrut = String(ab.plan || '').trim().toLowerCase();
    // "jeton" = achat à l'unité, sans abonnement : pas un plan Creator/Pro réel.
    const plan = (planBrut === 'creator' || planBrut === 'pro') ? planBrut : null;
    return { ok: true, anonyme: false, isAdmin: false, illimite: false, plan, jetons };
  } catch (e) {
    // Panne réseau/Supabase : ne jamais enfermer un abonné dehors pour ça
    // (même filet que le comportement d'avant cette passe).
    return { ok: true, anonyme: false, isAdmin: false, illimite: false, plan: PLAN_PAR_DEFAUT, jetons: 0, panne: true };
  }
}

// Compte les générations d'un code pour un mode donné, depuis Supabase
// (service role). depuisISO=null → comptage à VIE (codes sans plan reconnu).
async function compterGenerations(cfg, code, mode, depuisISO) {
  let url = cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) + '&select=id';
  url += (mode === 'creation')
    ? '&mode=not.in.(audit,diagnosticSommaire,analyseVirale)'
    : '&mode=eq.' + encodeURIComponent(mode);
  if (depuisISO) url += '&cree_le=gte.' + encodeURIComponent(depuisISO);
  const r = await fetch(url, { headers: entetes(cfg.key) });
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

// Décompte UN jeton pour ce code (service role). Renvoie true si décompté.
async function consommerJetonServeur(code, cfgArg) {
  const cfg = cfgArg || config();
  if (!cfg || !code) return false;
  try {
    const r = await fetch(cfg.url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code) + '&select=jetons_audit', { headers: entetes(cfg.key) });
    const rows = await r.json();
    const actuel = (Array.isArray(rows) && rows[0]) ? (parseInt(rows[0].jetons_audit, 10) || 0) : 0;
    if (actuel <= 0) return false;
    const rep = await fetch(cfg.url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code), {
      method: 'PATCH',
      headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
      body: JSON.stringify({ jetons_audit: actuel - 1 })
    });
    return rep.ok;
  } catch (e) { return false; }
}

// Vérifie le quota pour un mode donné, avec repli jeton si prévu pour ce
// mode. `code` peut être null (anonyme). Renvoie { ok, viaJeton?, raison? }.
async function verifierQuota(droits, mode, code) {
  if (droits.isAdmin || droits.illimite) return { ok: true };

  if (droits.anonyme) {
    // L'audit détaillé n'a jamais été accessible sans code (Pro ou jeton
    // requis) : un anonyme n'a ni l'un ni l'autre, jamais de repli gratuit.
    if (mode === 'audit') return { ok: false, raison: 'acces_requis' };
    return { ok: true }; // creation/diagnosticSommaire/analyseVirale : filet IP géré à part (verifierLimiteAnonyme)
  }

  const cfg = config();
  if (!cfg) return { ok: true }; // clé service role absente : dégradation, voir resoudreDroits

  const limitePlan = droits.plan ? (LIMITES_MOIS[droits.plan] || {})[mode] : null;
  const aUnPlanReconnu = limitePlan != null;

  try {
    if (aUnPlanReconnu) {
      const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
      const n = await compterGenerations(cfg, code, mode, debutMois.toISOString());
      if (n < limitePlan) return { ok: true };
    } else {
      const plafondGratuit = mode === 'creation' ? MAX_FREE : (MODES_GRATUIT_UNIQUE[mode] || 0);
      const n = await compterGenerations(cfg, code, mode, null);
      if (n < plafondGratuit) return { ok: true };
    }
  } catch (e) {
    return { ok: true }; // panne de comptage : ne jamais bloquer un abonné légitime pour ça
  }

  if (MODES_JETON[mode] && droits.jetons > 0) {
    const consomme = await consommerJetonServeur(code, cfg);
    if (consomme) return { ok: true, viaJeton: true };
  }
  return { ok: false, raison: 'quota' };
}

// ── Filet best-effort pour les appels VRAIMENT anonymes (aucun code) ──
// Réutilise la table `quotas` déjà en place (ref/used), pilotée ici par
// l'IP VUE PAR VERCEL (x-forwarded-for), jamais une IP auto-déclarée par le
// client. La date est encodée directement dans `ref` (repart à zéro chaque
// jour), pas besoin de nouvelle colonne sur la table existante.
function ipDuRequest(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  const brut = Array.isArray(xff) ? xff[0] : String(xff || '');
  const ip = brut.split(',')[0].trim();
  return ip || (req.socket && req.socket.remoteAddress) || 'inconnue';
}
// Hash non cryptographique (juste pour ne pas stocker l'IP en clair) : pas
// un usage sécurité, uniquement une clé de compteur.
function hashCourt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'h' + Math.abs(h).toString(36);
}
async function verifierLimiteAnonyme(req, fonction, plafond) {
  const cfg = config();
  if (!cfg) return { ok: true }; // clé service role absente : dégradation
  const jour = new Date().toISOString().slice(0, 10);
  const ref = 'anon_' + fonction + '_' + jour + '_' + hashCourt(ipDuRequest(req));
  try {
    const r = await fetch(cfg.url + '/rest/v1/quotas?ref=eq.' + encodeURIComponent(ref) + '&select=used', { headers: entetes(cfg.key) });
    const rows = await r.json();
    const dejaUtilises = (Array.isArray(rows) && rows[0]) ? (rows[0].used || 0) : 0;
    if (dejaUtilises >= plafond) return { ok: false, raison: 'limite_anonyme' };
    await fetch(cfg.url + '/rest/v1/quotas', {
      method: 'POST',
      headers: { ...entetes(cfg.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ref, used: dejaUtilises + 1, maj_le: new Date().toISOString() })
    });
    return { ok: true };
  } catch (e) { return { ok: true }; } // ne jamais bloquer sur une panne du filet
}

// Accès réservé Pro OU jeton (audit détaillé, mode Série) : mêmes règles
// que aAccesMode('audit'/'serie') + moyenAudit/moyenSerie côté client.
async function verifierAccesProOuJeton(droits, code) {
  if (droits.isAdmin || droits.illimite) return { ok: true };
  if (droits.plan === 'pro') return { ok: true };
  if (droits.jetons > 0) {
    const consomme = await consommerJetonServeur(code, config());
    if (consomme) return { ok: true, viaJeton: true };
  }
  return { ok: false, raison: 'acces_requis' };
}

export {
  resoudreDroits,
  verifierQuota,
  verifierLimiteAnonyme,
  verifierAccesProOuJeton,
  consommerJetonServeur,
  LIMITES_MOIS
};

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
  // tendances : réservé au Pro, 1 analyse/mois, comme Vervox lui-même
  // limite son propre benchmark de niche (~50 vidéos scannées et
  // transcrites, bien plus lourd que les autres modes).
  creator: { creation: 40, audit: 0, diagnosticSommaire: 10, analyseVirale: 6, tendances: 0 },
  pro:     { creation: 70, audit: 5, diagnosticSommaire: 25, analyseVirale: 15, tendances: 1 }
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
      cfg.url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(codeUpper) + '&select=actif,expire_le,plan,jetons_audit',
      { headers: entetes(cfg.key) }
    );
    if (!r.ok) {
      // Erreur Supabase (clé invalide, schéma, RLS, quota API…) : SANS cette
      // distinction, une simple panne était auparavant traitée exactement
      // comme "code inconnu" (rows.length===0 par défaut de r.json() en
      // erreur), ce qui plafonnait TOUT abonné réel à 5 générations gratuites
      // à vie au lieu de son quota mensuel réel, à la moindre erreur d'API.
      return { ok: true, anonyme: false, isAdmin: false, illimite: false, plan: PLAN_PAR_DEFAUT, jetons: 0, panne: true };
    }
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

// Appelle une fonction Postgres (RPC) exposée par PostgREST, avec la clé
// service_role. Utilisé pour les décomptes ATOMIQUES (voir
// supabase/usage_serveur.sql) : un lire-puis-écrire fait depuis Node n'est
// pas protégé contre deux requêtes strictement simultanées qui liraient
// toutes les deux "encore disponible" avant que l'une des deux n'écrive.
// Ces fonctions font la vérification du plafond ET l'écriture en une seule
// instruction SQL côté Postgres, atomique par construction.
// Renvoie true/false (résultat réel de la fonction SQL), ou null si la
// fonction n'existe pas encore (supabase/usage_serveur.sql pas exécuté) ou
// en cas de panne réseau/Supabase : null est un état INDÉTERMINÉ, jamais
// traité comme "refusé" par les appelants (voir plus bas), même philosophie
// que le reste de ce module : ne jamais enfermer un abonné légitime dehors
// à cause d'une panne d'infrastructure ou d'une migration pas encore faite.
async function appelerRpc(cfg, fonction, params) {
  try {
    const r = await fetch(cfg.url + '/rest/v1/rpc/' + fonction, {
      method: 'POST',
      headers: entetes(cfg.key),
      body: JSON.stringify(params)
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data === 'boolean' ? data : null;
  } catch (e) { return null; }
}

// Incrémente le compteur d'usage `ref` de 1 SI encore sous `plafond` (table
// usage_serveur, jamais exposée au client, voir supabase/usage_serveur.sql).
// Remplace l'ancien comptage des lignes `generations` : ces lignes restent
// supprimables par le client depuis "Mes générations" (RLS ouverte,
// fonctionnalité normale de suppression d'historique), donc les compter
// pour le quota permettait de supprimer son historique pour regagner du
// quota à volonté. Ce compteur, lui, n'est accessible qu'au service_role.
// Renvoie true (consommé), false (plafond atteint), ou null (indéterminé).
async function consommerUsage(cfg, ref, plafond) {
  return await appelerRpc(cfg, 'consommer_usage', { p_ref: ref, p_plafond: plafond });
}

// Clé de période pour le compteur d'usage : mensuelle (plans Creator/Pro
// reconnus, se recharge chaque mois) ou à vie (codes jeton/inconnus, jamais
// remise à zéro), voir supabase/usage_serveur.sql.
function cleUsage(code, mode, aVie) {
  if (aVie) return 'usage_' + code + '_' + mode + '_avie';
  const d = new Date();
  return 'usage_' + code + '_' + mode + '_' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Décompte UN jeton pour ce code, de façon ATOMIQUE (voir decrementer_jeton,
// supabase/usage_serveur.sql) : l'ancien lire-puis-écrire permettait à deux
// requêtes simultanées de lire le même solde avant que l'une des deux
// n'écrive, et de consommer deux fois le même jeton. Renvoie true si décompté.
// Renvoie true (décompté), false (plus de jeton), ou null (indéterminé,
// voir appelerRpc).
async function consommerJetonServeur(code, cfgArg) {
  const cfg = cfgArg || config();
  if (!cfg || !code) return null;
  return await appelerRpc(cfg, 'decrementer_jeton', { p_code: code });
}

// Vérifie le quota pour un mode donné, avec repli jeton si prévu pour ce
// mode. `code` peut être null (anonyme). Renvoie { ok, viaJeton?, raison? }.
async function verifierQuota(droits, mode, code) {
  if (droits.isAdmin || droits.illimite) return { ok: true };

  if (droits.anonyme) {
    // L'audit détaillé et le mode Tendances n'ont jamais été accessibles
    // sans code (Pro ou jeton requis pour l'audit, Pro obligatoire pour
    // Tendances) : un anonyme n'a ni l'un ni l'autre, jamais de repli gratuit.
    if (mode === 'audit' || mode === 'tendances') return { ok: false, raison: 'acces_requis' };
    return { ok: true }; // creation/diagnosticSommaire/analyseVirale : filet IP géré à part (verifierLimiteAnonyme)
  }

  const cfg = config();
  if (!cfg) return { ok: true }; // clé service role absente : dégradation, voir resoudreDroits

  const limitePlan = droits.plan ? (LIMITES_MOIS[droits.plan] || {})[mode] : null;
  const aUnPlanReconnu = limitePlan != null;

  const plafond = aUnPlanReconnu ? limitePlan : (mode === 'creation' ? MAX_FREE : (MODES_GRATUIT_UNIQUE[mode] || 0));
  const ref = cleUsage(code, mode, !aUnPlanReconnu);
  const consomme = await consommerUsage(cfg, ref, plafond);
  if (consomme === true) return { ok: true };
  if (consomme === null) return { ok: true }; // fonction SQL pas encore installée ou panne : dégradation

  if (MODES_JETON[mode] && droits.jetons > 0) {
    const viaJeton = await consommerJetonServeur(code, cfg);
    if (viaJeton === true) return { ok: true, viaJeton: true };
    if (viaJeton === null) return { ok: true }; // même dégradation
  }
  return { ok: false, raison: 'quota' };
}

// ── Filet best-effort pour les appels VRAIMENT anonymes (aucun code) ──
// Compte par l'IP VUE PAR VERCEL (x-forwarded-for), jamais une IP
// auto-déclarée par le client. Écrit dans `usage_serveur` (voir plus haut),
// PAS dans `quotas` : `quotas` reste en écriture ouverte au client pour
// l'ancien compteur d'affichage multi-appareil (fetchServerQuota/
// bumpServerQuota, js/api.js, purement informatif), et un anonyme aurait pu
// y écrire directement la même clé pour remettre son propre compteur à
// zéro. `usage_serveur` est fermée au rôle anon dès sa création.
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
// `sansExpiration` : true pour un plafond "à vie" (jamais remis à zéro,
// ex. les 5 générations gratuites d'un visiteur qui n'a jamais tapé de
// code), false pour un plafond journalier classique (repart à zéro chaque
// jour, ex. le filet anti-abus des routes coûteuses).
async function verifierLimiteAnonyme(req, fonction, plafond, sansExpiration) {
  const cfg = config();
  if (!cfg) return { ok: true }; // clé service role absente : dégradation
  const cle = sansExpiration ? 'avie' : new Date().toISOString().slice(0, 10);
  const ref = 'anon_' + fonction + '_' + cle + '_' + hashCourt(ipDuRequest(req));
  const consomme = await consommerUsage(cfg, ref, plafond);
  // false = plafond réellement atteint. true ou null (indéterminé) : on
  // laisse passer, jamais bloquer un visiteur pour une panne ou une
  // migration pas encore faite.
  return consomme === false ? { ok: false, raison: 'limite_anonyme' } : { ok: true };
}

// Accès réservé Pro OU jeton (audit détaillé, mode Série) : mêmes règles
// que aAccesMode('audit'/'serie') + moyenAudit/moyenSerie côté client.
async function verifierAccesProOuJeton(droits, code) {
  if (droits.isAdmin || droits.illimite) return { ok: true };
  if (droits.plan === 'pro') return { ok: true };
  if (droits.jetons > 0) {
    const consomme = await consommerJetonServeur(code, config());
    if (consomme === true) return { ok: true, viaJeton: true };
    if (consomme === null) return { ok: true }; // indéterminé : dégradation
  }
  return { ok: false, raison: 'acces_requis' };
}

export {
  resoudreDroits,
  verifierQuota,
  verifierLimiteAnonyme,
  verifierAccesProOuJeton,
  consommerJetonServeur,
  LIMITES_MOIS,
  MAX_FREE
};

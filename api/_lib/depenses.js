// ═══════════════════════════════════════════════════════════════════════
//  DÉPENSES API : MESURE ET ESTIMATION DU SOLDE RESTANT
//
//  Pourquoi : Anthropic et Together ne donnent AUCUN moyen de lire leur solde
//  par programme (seulement sur leur console). Le seul signal automatique
//  était l'alerte « Solde API épuisé », qui n'apparaît qu'APRÈS que des
//  appels ont été refusés. Ici, chaque appel réel est compté au passage, et
//  le propriétaire saisit son solde à chaque recharge : le tableau de bord
//  en déduit un solde ESTIMÉ et prévient avant la panne.
//
//  Aucune table à créer : tout vit dans `usage_serveur` (fermée au client,
//  service_role seulement, voir supabase/usage_serveur.sql), via la fonction
//  atomique consommer_usage déjà installée.
//
//  Lignes écrites (toutes préfixées pour ne jamais croiser les quotas) :
//    depense_anthropic_<modèle>_<type>_<AAAA-MM>   jetons / recherches web
//    depense_together_<image|video>_<AAAA-MM>      nombre d'appels réussis
//    credits_solde_<fournisseur>                   solde saisi, en centimes
//                                                  de dollar (maj_le = date)
//    credits_base_<fournisseur>                    dépense mesurée au moment
//                                                  de la saisie, en centimes
//    credits_prix_together_<image|video>           prix unitaire, micro-dollars
//
//  Mensuelles et non cumulées à vie : la colonne `used` est un entier 32 bits,
//  un compteur à vie finirait par déborder et cesser de compter en silence.
//
//  JAMAIS bloquant : une panne de comptage ne doit pas faire échouer une
//  génération. Toute erreur est avalée, le délai est plafonné.
// ═══════════════════════════════════════════════════════════════════════

const PLAFOND_COMPTEUR = 2000000000;
const DELAI_ECRITURE_MS = 2000;

// Dollars par MILLION de jetons (tarifs publics Anthropic). Un modèle absent
// de cette table est facturé au tarif Sonnet, le plus cher des deux : mieux
// vaut surestimer la dépense (alerte trop tôt) que la sous-estimer (panne).
const PRIX_ANTHROPIC = {
  'claude-haiku-4-5-20251001': { entree: 1, sortie: 5, cachelu: 0.1, cacheecrit: 1.25 },
  'claude-sonnet-4-6': { entree: 3, sortie: 15, cachelu: 0.3, cacheecrit: 3.75 }
};
const PRIX_ANTHROPIC_INCONNU = PRIX_ANTHROPIC['claude-sonnet-4-6'];
const PRIX_RECHERCHE_WEB_USD = 0.01; // 10 $ les 1 000 recherches

// Prix unitaires Together PAR DÉFAUT, en dollars. Ils dépendent du modèle
// choisi (TOGETHER_IMAGE_MODEL, voir api/montage-media.js) : le propriétaire
// les règle depuis le tableau de bord d'après sa facture, ces valeurs ne
// servent qu'au premier affichage.
const PRIX_TOGETHER_DEFAUT_USD = { image: 0.04, video: 0.08 };

const TYPES_ANTHROPIC = ['entree', 'sortie', 'cachelu', 'cacheecrit', 'recherches'];

function moisCourant(date) {
  const d = date || new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function config() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function incrementer(ref, n) {
  const cfg = config();
  if (!cfg || !Number.isInteger(n) || n <= 0 || n > PLAFOND_COMPTEUR) return false;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_ECRITURE_MS);
  try {
    const r = await fetch(cfg.url + '/rest/v1/rpc/consommer_usage', {
      method: 'POST',
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ref: ref, p_plafond: PLAFOND_COMPTEUR, p_increment: n }),
      signal: ctrl.signal
    });
    return r.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

// À appeler APRÈS un appel Anthropic réussi, avec le champ `usage` de sa
// réponse. À attendre (await) : sur Vercel, une promesse laissée en suspens
// peut être coupée dès que la réponse est envoyée.
async function noterDepenseAnthropic(modele, usage, date) {
  try {
    if (!usage || typeof usage !== 'object') return;
    const m = String(modele || '').replace(/[^A-Za-z0-9.-]/g, '').slice(0, 60);
    if (!m) return;
    const mois = moisCourant(date);
    const valeurs = {
      entree: usage.input_tokens,
      sortie: usage.output_tokens,
      cachelu: usage.cache_read_input_tokens,
      cacheecrit: usage.cache_creation_input_tokens,
      recherches: usage.server_tool_use && usage.server_tool_use.web_search_requests
    };
    await Promise.all(TYPES_ANTHROPIC
      .filter(t => Number.isInteger(valeurs[t]) && valeurs[t] > 0)
      .map(t => incrementer('depense_anthropic_' + m + '_' + t + '_' + mois, valeurs[t])));
  } catch (e) { /* jamais bloquant */ }
}

async function noterDepenseTogether(type, nombre, date) {
  try {
    if (type !== 'image' && type !== 'video') return;
    await incrementer('depense_together_' + type + '_' + moisCourant(date), Number.isInteger(nombre) ? nombre : 1);
  } catch (e) { /* jamais bloquant */ }
}

// ───────── calculs purs (testés sans réseau) ─────────

const RE_ANTHROPIC = /^depense_anthropic_(.+)_(entree|sortie|cachelu|cacheecrit|recherches)_(\d{4}-\d{2})$/;
const RE_TOGETHER = /^depense_together_(image|video)_(\d{4}-\d{2})$/;

// Dépense Anthropic cumulée, en centimes de dollar, à partir des lignes
// `usage_serveur` ({ ref, used }).
function depenseAnthropicCentimes(lignes) {
  let usd = 0;
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const m = RE_ANTHROPIC.exec(String(l && l.ref || ''));
    if (!m || !(l.used > 0)) continue;
    const [, modele, type] = m;
    if (type === 'recherches') { usd += l.used * PRIX_RECHERCHE_WEB_USD; continue; }
    const prix = PRIX_ANTHROPIC[modele] || PRIX_ANTHROPIC_INCONNU;
    usd += (l.used / 1e6) * prix[type];
  }
  return Math.round(usd * 100);
}

// Dépense Together cumulée en centimes. `prixUsd` : { image, video }.
function depenseTogetherCentimes(lignes, prixUsd) {
  const prix = { ...PRIX_TOGETHER_DEFAUT_USD, ...(prixUsd || {}) };
  let usd = 0;
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const m = RE_TOGETHER.exec(String(l && l.ref || ''));
    if (!m || !(l.used > 0)) continue;
    usd += l.used * prix[m[1]];
  }
  return Math.round(usd * 100);
}

// Solde estimé = solde saisi - (dépense mesurée maintenant - dépense mesurée
// au moment de la saisie). `niveau` pilote l'alerte : « bas » à 20 % du solde
// saisi OU moins de 5 jours au rythme observé, « critique » à 10 %.
function estimerSolde({ soldeSaisiCentimes, baseCentimes, depenseTotaleCentimes, saisiLe, maintenant }) {
  if (!(soldeSaisiCentimes >= 0) || !saisiLe) return null;
  const now = maintenant instanceof Date ? maintenant.getTime() : (maintenant || Date.now());
  const depuis = Math.max(0, depenseTotaleCentimes - (baseCentimes || 0));
  const restant = soldeSaisiCentimes - depuis;
  const jours = Math.max(0, (now - new Date(saisiLe).getTime()) / 86400000);
  // Rythme : seulement fiable après un peu de recul, sinon une seule grosse
  // génération juste après la saisie ferait croire à une panne imminente.
  const rythme = jours >= 1 ? depuis / jours : null;
  const joursRestants = rythme && rythme > 0 ? restant / rythme : null;
  const part = soldeSaisiCentimes > 0 ? restant / soldeSaisiCentimes : 0;
  let niveau = 'ok';
  if (restant <= 0) niveau = 'epuise';
  else if (part <= 0.1) niveau = 'critique';
  else if (part <= 0.2 || (joursRestants !== null && joursRestants < 5)) niveau = 'bas';
  return {
    restantCentimes: Math.max(0, Math.round(restant)),
    depuisCentimes: Math.round(depuis),
    soldeSaisiCentimes: Math.round(soldeSaisiCentimes),
    joursDepuisSaisie: Math.floor(jours),
    rythmeParJourCentimes: rythme === null ? null : Math.round(rythme),
    joursRestants: joursRestants === null ? null : Math.floor(joursRestants),
    pourcentRestant: Math.max(0, Math.round(part * 100)),
    niveau
  };
}

export {
  noterDepenseAnthropic,
  noterDepenseTogether,
  depenseAnthropicCentimes,
  depenseTogetherCentimes,
  estimerSolde,
  moisCourant,
  PRIX_ANTHROPIC,
  PRIX_TOGETHER_DEFAUT_USD,
  PRIX_RECHERCHE_WEB_USD
};

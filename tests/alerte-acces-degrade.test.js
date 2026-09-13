// Faille signalée dans l'analyse produit, puis choisie par le propriétaire :
// quand Supabase est absent ou en panne, resoudreDroits accordait un accès
// Creator à N'IMPORTE QUEL code, y compris inventé, avec pour seule trace un
// console.error, c'est-à-dire une ligne dans les journaux Vercel que
// personne ne lit.
//
// LOT 2, AUDIT A6 : ce comportement a été affiné. Un code JAMAIS VALIDÉ avec
// succès par cette instance (CAS 2, ex. un code inventé) n'obtient PLUS
// aucun accès pendant une panne — avant, il recevait le même Creator gratuit
// qu'un vrai abonné. Un code qui avait été validé avec succès juste avant la
// panne (CAS 1) continue lui de fonctionner, mais seulement pendant une
// fenêtre de grâce bornée (30 min, voir GRACE_DUREE_MS, api/_lib/acces.js),
// jamais prolongée par un accès en mode dégradé. Voir
// tests/grace-acces-degrade.test.js pour les tests dédiés à ce mécanisme de
// grâce (CAS 1/2/3/4, expiration, non-prolongation).
//
// Ce que CE fichier verrouille encore :
//  - une dégradation lève une ALERTE visible dans la carte du Tableau de bord ;
//  - elle est ÉTRANGLÉE : en panne, chaque appel d'API passe par là, et sans
//    limite une heure de panne écrirait des milliers de lignes, noierait la
//    carte et coûterait cher sans rien apprendre de plus ;
//  - un accès NORMAL n'alerte jamais, sinon l'alerte ne voudrait plus rien
//    dire ;
//  - et surtout, l'alerte ne casse JAMAIS la requête qu'elle observe.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST-DEGRADE'
};

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

// `alertes` collecte ce qui part réellement vers la table d'incidents.
// `abonnesEnPanne` simule Supabase qui répond mal sur la lecture des abonnés.
function poserFetchMock({ alertes, abonnesEnPanne, abonnesJette, abonneRows }) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/erreurs_generation')) {
      if (alertes && opts && opts.body) alertes.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes('/rest/v1/abonnes')) {
      if (abonnesJette) throw new Error('getaddrinfo ENOTFOUND');
      if (abonnesEnPanne) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

// Import frais à chaque test : le compteur d'étranglement vit dans le module,
// le réutiliser d'un test à l'autre fausserait les suivants.
const importerAcces = () => import('../api/_lib/acces.js?t=' + Date.now() + Math.random());
const laisserPasser = () => new Promise(r => setTimeout(r, 20));

test('Supabase en panne, code JAMAIS VALIDÉ : aucun accès (LOT 2 A6), MAIS une alerte est levée', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonnesEnPanne: true });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-TOTALEMENT-INVENTE');
    await laisserPasser();

    // LOT 2 A6 : un code jamais validé (CAS 2) n'obtient plus de Creator
    // gratuit pendant une panne, contrairement à avant. `ok` reste true
    // (jamais un refus dur type "compte désactivé"), mais sans plan.
    assert.equal(droits.ok, true, 'jamais un refus dur, juste aucun accès');
    assert.equal(droits.plan, null, 'REGRESSION A6 : un code jamais validé ne doit plus recevoir de Creator gratuit pendant une panne');
    assert.equal(droits.panne, true);

    // Mais il ne doit plus être silencieux.
    assert.equal(alertes.length, 1, 'REGRESSION : la fuite d\'accès payant redevenait invisible');
    assert.equal(alertes[0].mode, 'acces-degrade');
    assert.match(alertes[0].detail, /SANS vérification/, alertes[0].detail);
    assert.match(alertes[0].detail, /500/, 'la cause exacte doit être dite : ' + alertes[0].detail);
    assert.equal(alertes[0].code_acces, null,
      'jamais le code : il n\'a JUSTEMENT pas été vérifié, l\'attribuer induirait en erreur');
  } finally { restaurer(); }
});

test('panne réseau (exception), code jamais validé : même alerte, avec sa propre cause, toujours aucun accès', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonnesJette: true });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-INVENTE');
    await laisserPasser();

    assert.equal(droits.panne, true);
    assert.equal(droits.plan, null, 'LOT 2 A6 : toujours aucun accès pour un code jamais validé');
    assert.equal(alertes.length, 1);
    assert.match(alertes[0].detail, /panne réseau/, alertes[0].detail);
  } finally { restaurer(); }
});

test('l\'alerte est ÉTRANGLÉE : une panne ne noie pas la carte sous des milliers de lignes', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonnesEnPanne: true });
  try {
    const { resoudreDroits } = await importerAcces();
    // 25 appels d'affilée, comme pendant une vraie panne où CHAQUE requête
    // d'API passe par là.
    for (let i = 0; i < 25; i++) await resoudreDroits('CODE-' + i);
    await laisserPasser();

    assert.equal(alertes.length, 1,
      'une seule alerte par fenêtre : sans ça, une heure de panne écrirait des milliers de lignes pour '
      + 'ne rien apprendre de plus (' + alertes.length + ' écrites)');
  } finally { restaurer(); }
});

test('un accès NORMAL n\'alerte jamais, sinon l\'alerte ne veut plus rien dire', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-PRO-REEL');
    await laisserPasser();

    assert.equal(droits.plan, 'pro');
    assert.ok(!droits.panne, 'aucune dégradation ici');
    assert.deepEqual(alertes, [], 'aucun bruit quand tout va bien');
  } finally { restaurer(); }
});

test('un code INCONNU sur un Supabase sain n\'alerte pas non plus (ce n\'est pas une panne)', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonneRows: [] });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-QUI-N-EXISTE-PAS');
    await laisserPasser();

    assert.equal(droits.plan, null, 'un code inconnu reste un non-abonné, jamais un Creator');
    assert.deepEqual(alertes, [], 'un refus normal n\'est pas un incident');
  } finally { restaurer(); }
});

test('l\'alerte ne casse JAMAIS la requête, même si l\'écriture échoue elle aussi', async () => {
  const restaurer = poserEnv();
  // Pire cas réaliste : Supabase est tellement en panne que même l'écriture
  // de l'alerte jette. La requête ne doit jamais planter pour autant (même
  // si, LOT 2 A6, ce code jamais validé n'obtient plus d'accès).
  global.fetch = async (url) => {
    if (String(url).includes('/rest/v1/erreurs_generation')) throw new Error('Supabase injoignable');
    return { ok: false, status: 503, json: async () => ({}) };
  };
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-PENDANT-LA-PANNE');
    await laisserPasser();

    assert.equal(droits.ok, true,
      'journaliser une panne avec l\'outil en panne ne doit jamais retourner l\'échec contre l\'utilisateur');
    assert.equal(droits.plan, null, 'LOT 2 A6 : code jamais validé, aucun accès même dans ce pire cas');
  } finally { restaurer(); }
});

test('sans configuration Supabase, rien n\'est tenté : il n\'y a rien à quoi écrire', async () => {
  const restaurer = poserEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  const alertes = [];
  poserFetchMock({ alertes });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('N-IMPORTE-QUOI');
    await laisserPasser();

    assert.equal(droits.nonConfigure, true);
    assert.deepEqual(alertes, [],
      'aucune écriture possible sans clé ; ce cas se signale autrement, le Tableau de bord lui-même devient vide');
  } finally { restaurer(); }
});

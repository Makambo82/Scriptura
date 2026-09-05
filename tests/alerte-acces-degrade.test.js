// Faille signalée dans l'analyse produit, puis choisie par le propriétaire :
// quand Supabase est absent ou en panne, resoudreDroits accorde un accès
// Creator à N'IMPORTE QUEL code, y compris inventé. Le choix est assumé (ne
// jamais enfermer dehors un abonné qui a payé, à cause d'une panne qui n'est
// pas la sienne), mais il ne laissait qu'un console.error, c'est-à-dire une
// ligne dans les journaux Vercel que personne ne lit.
//
// En production, ça peut donc durer des jours : tout le monde a l'accès
// payant gratuitement, et rien ne le signale. C'est une fuite de revenu
// silencieuse, exactement le genre de chose qu'on ne découvre qu'en lisant sa
// facture ou son chiffre d'affaires.
//
// Ce que ces tests verrouillent :
//  - une dégradation lève une ALERTE visible dans la carte du Tableau de bord ;
//  - elle est ÉTRANGLÉE : en panne, chaque appel d'API passe par là, et sans
//    limite une heure de panne écrirait des milliers de lignes, noierait la
//    carte et coûterait cher sans rien apprendre de plus ;
//  - un accès NORMAL n'alerte jamais, sinon l'alerte ne voudrait plus rien
//    dire ;
//  - et surtout, l'alerte ne casse JAMAIS la requête qu'elle observe : un
//    abonné doit continuer à travailler pendant la panne, c'est tout l'intérêt
//    de la dégradation.
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

test('Supabase en panne : l\'accès est accordé, MAIS une alerte est levée', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonnesEnPanne: true });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-TOTALEMENT-INVENTE');
    await laisserPasser();

    // Le comportement dégradé lui-même reste inchangé, c'est un choix assumé.
    assert.equal(droits.ok, true, 'un abonné ne doit jamais être enfermé dehors par une panne');
    assert.equal(droits.plan, 'creator');
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

test('panne réseau (exception) : même alerte, avec sa propre cause', async () => {
  const restaurer = poserEnv();
  const alertes = [];
  poserFetchMock({ alertes, abonnesJette: true });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-INVENTE');
    await laisserPasser();

    assert.equal(droits.panne, true);
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
  // de l'alerte jette. L'abonné doit continuer à travailler.
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
    assert.equal(droits.plan, 'creator');
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

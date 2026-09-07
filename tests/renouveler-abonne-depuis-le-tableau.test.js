// Demande du propriétaire, et elle vient d'un constat très concret : tant que
// le paiement passe par WhatsApp et Mobile Money, c'est LUI qui encaisse, et
// il lui restait à rouvrir Supabase pour repousser la date à la main. Sur un
// téléphone, ça veut dire quitter l'app, trouver la bonne ligne et taper une
// date au bon format. Personne ne le fait deux fois.
//
// LA VRAIE QUESTION DE CETTE FONCTIONNALITÉ, celle qui décide si un abonné se
// sent volé ou pas : à partir de QUELLE date on repart.
//   * abonnement encore valide → on repart de SA date de fin, sinon renouveler
//     trois jours avant l'échéance lui ferait perdre ces trois jours payés ;
//   * abonnement déjà expiré → on repart d'AUJOURD'HUI, sinon on lui offre un
//     mois déjà écoulé, donc quelques jours d'accès seulement.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST-RENOUV'
};

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  return res;
}

function poserEnv() {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE);
  return () => { process.env = avant; };
}

const jourISO = (decalageJours) =>
  new Date(Date.now() + decalageJours * 86400000).toISOString().split('T')[0];

// `patchs` collecte ce qui part vraiment vers la table : c'est la seule preuve
// de la date réellement écrite, le corps de la réponse pouvant très bien
// annoncer autre chose.
function poserFetchMock({ ligne, patchs, patchOk = true }) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    const methode = (opts && opts.method) || 'GET';
    if (u.includes('/rest/v1/abonnes') && methode === 'PATCH') {
      if (patchs && opts.body) patchs.push(JSON.parse(opts.body));
      return { ok: patchOk, json: async () => ({}) };
    }
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (ligne ? [ligne] : []) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

async function renouveler(code, ligne, patchs, patchOk) {
  poserFetchMock({ ligne, patchs, patchOk });
  const { default: handler } = await import('../api/data.js?t=' + Date.now() + Math.random());
  const req = {
    method: 'POST',
    body: {
      resource: 'admin-stats', action: 'renouveler-abonne',
      code_acces: ENV_BASE.CODE_ADMIN, code, mois: 1
    }
  };
  const res = creerRes();
  await handler(req, res);
  return res;
}

test('un abonnement encore valide est PROLONGÉ, il ne repart pas de zéro', async () => {
  const restaurer = poserEnv();
  const patchs = [];
  try {
    // Il lui reste 10 jours et il paie d'avance : il doit obtenir 10 + 30, pas 30.
    const res = await renouveler('CODE-A', { code: 'CODE-A', plan: 'creator', expire_le: jourISO(10) }, patchs);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(res.corpsRecu.ok, true, JSON.stringify(res.corpsRecu));
    assert.equal(patchs.length, 1, 'une seule écriture');

    const attendu = jourISO(40);
    assert.equal(patchs[0].expire_le, attendu,
      'REGRESSION : renouveler avant l\'échéance fait PERDRE les jours restants. Un abonné qui paie en '
      + 'avance serait puni de l\'avoir fait, et il ne le dirait pas, il attendrait juste la dernière '
      + 'minute la fois suivante. Écrit : ' + patchs[0].expire_le + ', attendu : ' + attendu);
  } finally { restaurer(); }
});

test('un abonnement expiré repart d\'AUJOURD\'HUI, jamais d\'une date passée', async () => {
  const restaurer = poserEnv();
  const patchs = [];
  try {
    // Expiré depuis 45 jours : repartir de son ancienne date lui donnerait un
    // mois déjà écoulé, donc un abonnement mort-né.
    const res = await renouveler('CODE-B', { code: 'CODE-B', plan: 'pro', expire_le: jourISO(-45) }, patchs);
    assert.equal(res.corpsRecu.ok, true, JSON.stringify(res.corpsRecu));

    const attendu = jourISO(30);
    assert.equal(patchs[0].expire_le, attendu,
      'REGRESSION : un abonné expiré depuis longtemps repartirait d\'une date passée. Il paierait un '
      + 'mois pour recevoir un accès déjà terminé, et le fondateur ne le verrait qu\'au moment de sa '
      + 'réclamation. Écrit : ' + patchs[0].expire_le + ', attendu : ' + attendu);
  } finally { restaurer(); }
});

test('renouveler RÉACTIVE le code, sinon la date ne sert à rien', async () => {
  const restaurer = poserEnv();
  const patchs = [];
  try {
    await renouveler('CODE-C', { code: 'CODE-C', plan: 'creator', expire_le: jourISO(-3) }, patchs);
    assert.equal(patchs[0].actif, true,
      'REGRESSION : un abonné désactivé se retrouve avec une date valide sur un compte qui refuse '
      + 'toujours l\'accès. Il a payé, il est à jour, et il reste bloqué sans que personne ne '
      + 'comprenne pourquoi.');
  } finally { restaurer(); }
});

test('un code jeton ne se renouvelle pas, et l\'app le dit au lieu d\'écrire une date', async () => {
  const restaurer = poserEnv();
  const patchs = [];
  try {
    const res = await renouveler('CODE-JETON', { code: 'CODE-JETON', plan: 'jeton', expire_le: null }, patchs);
    assert.equal(res.corpsRecu.ok, false, JSON.stringify(res.corpsRecu));
    assert.equal(res.corpsRecu.erreur, 'plan_jeton', JSON.stringify(res.corpsRecu));
    assert.equal(patchs.length, 0,
      'REGRESSION : on écrit une date de fin sur un code jeton. Un jeton n\'est pas un abonnement, il '
      + 'n\'expire pas : la date n\'aurait aucun effet, mais l\'écran annoncerait un renouvellement '
      + 'qui n\'a rien renouvelé.');
  } finally { restaurer(); }
});

test('un code introuvable ne fait rien et le dit', async () => {
  const restaurer = poserEnv();
  const patchs = [];
  try {
    const res = await renouveler('CODE-FANTOME', null, patchs);
    assert.equal(res.corpsRecu.ok, false, JSON.stringify(res.corpsRecu));
    assert.equal(res.corpsRecu.erreur, 'code_introuvable', JSON.stringify(res.corpsRecu));
    assert.equal(patchs.length, 0, 'aucune écriture sur un code qui n\'existe pas');
  } finally { restaurer(); }
});

test('une écriture refusée ne fait JAMAIS croire à un renouvellement réussi', async () => {
  const restaurer = poserEnv();
  const patchs = [];
  try {
    const res = await renouveler('CODE-D', { code: 'CODE-D', plan: 'pro', expire_le: jourISO(5) }, patchs, false);
    assert.notEqual(res.corpsRecu.ok, true,
      'REGRESSION : le serveur annonce un renouvellement alors que la base a refusé l\'écriture. Le '
      + 'fondateur croirait avoir encaissé et prolongé, et son abonné serait coupé le lendemain : '
      + JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

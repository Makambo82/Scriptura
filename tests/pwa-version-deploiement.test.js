// Retour propriétaire (18 novembre) : la bannière « nouvelle version » doit
// apparaître pour N'IMPORTE QUELLE modification du dépôt, y compris quand le
// ?v= de index.html ne bouge pas (api/, doc, tests). Signal : le SHA du commit
// déployé, lu via /api/data?resource=version et comparé à celui vu à l'ouverture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function appeler(handler, req) {
  return new Promise(resolve => {
    const entetes = {};
    const res = {
      setHeader: (k, v) => { entetes[k.toLowerCase()] = v; },
      status(code) { this.code = code; return this; },
      json(corps) { resolve({ code: this.code, corps, entetes }); }
    };
    handler(req, res);
  });
}

test('resource=version renvoie le SHA du commit déployé, jamais en cache, GET seulement', async () => {
  const { default: handler } = await import('../api/data.js');
  const avant = { sha: process.env.VERCEL_GIT_COMMIT_SHA, dep: process.env.VERCEL_DEPLOYMENT_ID };
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def4567890abc123def4567890abc123de';
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_xyz';
    let r = await appeler(handler, { method: 'GET', query: { resource: 'version' }, body: undefined });
    assert.equal(r.code, 200);
    assert.equal(r.corps.deploiement, 'abc123def4567890abc123def4567890abc123de');
    assert.equal(r.entetes['cache-control'], 'no-store');

    delete process.env.VERCEL_GIT_COMMIT_SHA;
    r = await appeler(handler, { method: 'GET', query: { resource: 'version' }, body: undefined });
    assert.equal(r.corps.deploiement, 'dpl_xyz', 'repli sur l\'identifiant du déploiement');

    delete process.env.VERCEL_DEPLOYMENT_ID;
    r = await appeler(handler, { method: 'GET', query: { resource: 'version' }, body: undefined });
    assert.equal(r.corps.deploiement, null, 'hors Vercel : rien à comparer');

    r = await appeler(handler, { method: 'POST', query: {}, body: { resource: 'version' } });
    assert.equal(r.code, 405);
  } finally {
    if (avant.sha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA; else process.env.VERCEL_GIT_COMMIT_SHA = avant.sha;
    if (avant.dep === undefined) delete process.env.VERCEL_DEPLOYMENT_ID; else process.env.VERCEL_DEPLOYMENT_ID = avant.dep;
  }
});

async function ouvrir(navigateur, baseUrl, etat) {
  const page = await navigateur.newPage();
  await poserMocksReseau(page);
  // Posé APRÈS les mocks : la dernière route enregistrée est consultée en premier.
  await page.route('**/api/data?resource=version*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deploiement: etat.sha }) }));
  // index.html en ligne : MÊME ?v= que la page ouverte (seul le SHA bouge).
  await page.route('**/index.html', route => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  return page;
}

test('même ?v= mais nouveau commit déployé : la bannière apparaît ; « Plus tard » la fait taire jusqu\'au commit suivant', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const etat = { sha: 'aaaa111' };
    const page = await ouvrir(navigateur, baseUrl, etat);
    const banniere = () => page.evaluate(() => !!document.getElementById('majBanner'));
    await page.waitForTimeout(300); // la référence est lue à l'ouverture

    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), false, 'même commit : aucune bannière');

    etat.sha = 'bbbb222'; // un commit qui ne touche que api/ ou la doc
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), true, 'un nouveau commit déployé doit prévenir, même sans changement de ?v=');

    await page.click('#majFermerBtn');
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), false, '« Plus tard » : pas de harcèlement pour le même commit');

    etat.sha = 'cccc333';
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), true, 'un commit encore plus récent rouvre la bannière');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('référence prise à la première vérification si la lecture d\'ouverture a échoué, et aucune bannière si l\'identité est indisponible', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const etat = { sha: null };
    const page = await ouvrir(navigateur, baseUrl, etat);
    const banniere = () => page.evaluate(() => !!document.getElementById('majBanner'));
    await page.waitForTimeout(300);

    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), false, 'identité indisponible (hors Vercel) : jamais de fausse alerte');

    etat.sha = 'aaaa111';
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), false, 'la première identité lue devient la référence, sans bannière');

    etat.sha = 'bbbb222';
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), true);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

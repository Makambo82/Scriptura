// Retour propriétaire (27/09) : « pourquoi quand on est sur une page donnée
// (par exemple écrire un script) et qu'on recharge la page, ça revient
// automatiquement sur la page d'accueil ? »
//
// AUCUN test ne verrouillait la fonctionnalité d'adresse propre par page
// (ROUTES_PAGES, js/app.js + CHEMIN_PAR_ECRAN/synchroniserAdresseEcran,
// js/navigation.js) avant ce fichier - c'est précisément pour ça que cette
// régression est passée inaperçue à travers plusieurs suites complètes
// vertes.
//
// LA VRAIE CAUSE, trouvée en reproduisant le signalement : l'appel initial
// de synchroniserAdresseEcran() (js/navigation.js) s'exécutait de façon
// SYNCHRONE, hors DOMContentLoaded. Ce fichier est chargé AVANT app.js (voir
// l'ordre des <script>, index.html), qui n'ouvre l'écran demandé par
// l'adresse (ouvrirDepuisAdressePropre/ROUTES_PAGES) qu'une fois le DOM
// chargé. À ce stade précoce, l'accueil est encore le SEUL écran visible :
// currentScreen() renvoyait "homePage", et l'appel réécrivait alors
// IMMÉDIATEMENT l'adresse demandée (ex. /script) en "/", AVANT même
// qu'app.js ait pu ouvrir le bon écran. Un lien direct ou un simple
// rechargement sur n'importe quelle page retombait donc toujours à
// l'accueil. Corrigé en différant cet appel après TOUS les écouteurs
// DOMContentLoaded (setTimeout(0) à l'intérieur du DOMContentLoaded, voir
// le commentaire dans js/navigation.js pour le détail).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'CELINE7F2A';

async function ouvrirEtDeverrouiller(navigateur, baseUrl, chemin) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  // Le code d'accès doit être posé AVANT le premier chargement : ouvrir
  // directement sur /tableau-de-bord exige CODE_ADMIN, /script et /idees
  // fonctionnent aussi bien pour un visiteur non abonné.
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((code) => {
    localStorage.setItem('scriptura_code', code);
    localStorage.setItem('scriptura_unlocked', 'true');
  }, CODE);
  await page.goto(baseUrl + chemin, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return page;
}

test('REGRESSION : un lien direct vers /script ouvre vraiment l\'écran script, sans retomber sur l\'accueil', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirEtDeverrouiller(navigateur, baseUrl, '/script');
    assert.equal(await page.evaluate(() => window.location.pathname), '/script',
      'REGRESSION : l\'adresse ne doit jamais être réécrite en "/" avant que chooseMode ait pu ouvrir l\'écran');
    assert.equal(await page.evaluate(() => document.getElementById('flow').style.display), 'block');
    assert.equal(await page.evaluate(() => document.getElementById('homePage').style.display), 'none');
  } finally { await navigateur.close(); await arreter(); }
});

test('REGRESSION : écrire un script PUIS recharger la page reste sur l\'écran script (le signalement exact du propriétaire)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate((code) => {
      localStorage.setItem('scriptura_code', code);
      localStorage.setItem('scriptura_unlocked', 'true');
      unlocked = true;
      document.body.classList.add('is-unlocked');
    }, CODE);
    await page.evaluate(() => chooseMode('script'));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.location.pathname), '/script', 'l\'adresse doit suivre l\'écran ouvert EN NAVIGATION INTERNE');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.location.pathname), '/script',
      'REGRESSION : recharger la page doit rester sur l\'écran script, pas retomber sur l\'accueil');
    assert.equal(await page.evaluate(() => document.getElementById('flow').style.display), 'block');
    assert.equal(await page.evaluate(() => document.getElementById('homePage').style.display), 'none');
  } finally { await navigateur.close(); await arreter(); }
});

test('REGRESSION : même chose pour Idées, Récit et Mes générations (pas seulement Script)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const cas = [
    ['/idees', 'ideasFlow'],
    ['/recit', 'storyFlow'],
    ['/mes-generations', 'historyFlow']
  ];
  try {
    for (const [chemin, idEcran] of cas) {
      const page = await ouvrirEtDeverrouiller(navigateur, baseUrl, chemin);
      assert.equal(await page.evaluate(() => window.location.pathname), chemin, chemin + ' : adresse clobbérisée');
      assert.equal(await page.evaluate((id) => document.getElementById(id).style.display, idEcran), 'block', chemin + ' : écran pas ouvert');
      await page.close();
    }
  } finally { await navigateur.close(); await arreter(); }
});

test('une adresse SANS écran dédié (racine "/") ouvre bien l\'accueil, sans régression sur le cas normal', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.location.pathname), '/');
    // homePage n'a pas de "block" inline par défaut (seul goHome() le pose
    // explicitement) - sur un premier chargement, "pas masqué" (jamais
    // 'none') suffit à prouver qu'aucun écran n'a été ouvert par erreur.
    assert.notEqual(await page.evaluate(() => document.getElementById('homePage').style.display), 'none');
    assert.equal(await page.evaluate(() => document.getElementById('flow').style.display), 'none', 'REGRESSION : aucun écran de mode ne doit s\'ouvrir sur "/"');
  } finally { await navigateur.close(); await arreter(); }
});

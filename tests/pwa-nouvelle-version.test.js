// Bannière « nouvelle version » à chaque mise en ligne Vercel (retour
// propriétaire du 18 novembre). js/pwa.js compare le ?v= de ses propres
// scripts à celui de la page en ligne : différent = un déploiement a eu lieu.
// La page « en ligne » est simulée en interceptant la relecture de
// /index.html faite par le script (jamais la navigation elle-même).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const VERSION = HTML.match(/js\/pwa\.js\?v=([^"]+)"/)[1];

test('une mise en ligne affiche la bannière, « Plus tard » la fait taire, « Recharger » recharge', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    let versionEnLigne = VERSION;
    await page.route('**/index.html', route => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      return route.fulfill({ status: 200, contentType: 'text/html', body: HTML.replace(/\?v=[0-9-]+"/g, `?v=${versionEnLigne}"`) });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    const banniere = () => page.evaluate(() => { const b = document.getElementById('majBanner'); return b ? b.textContent : null; });

    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), null, 'même version en ligne : aucune bannière');

    versionEnLigne = '29991231-9';
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.match(await banniere() || '', /nouvelle version de Scriptura est prête/,
      'une mise en ligne (nouveau ?v=) doit afficher la bannière');

    await page.click('#majFermerBtn');
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.equal(await banniere(), null, '« Plus tard » : la même version ne doit pas revenir toutes les 10 minutes');

    versionEnLigne = '29991231-10';
    await page.evaluate(() => verifierNouvelleVersion(true));
    assert.ok(await banniere(), 'une mise en ligne encore plus récente rouvre la bannière');

    // Après « Recharger », la page chargée EST la version en ligne.
    versionEnLigne = VERSION;
    await Promise.all([page.waitForEvent('load'), page.click('#majRechargerBtn')]);
    assert.equal(await banniere(), null,
      'REGRESSION : « Recharger » fermait la bannière sans recharger quand aucun service worker n\'attendait');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une vérification ratée (réseau pas revenu) ne bloque pas la suivante, et un retour sur l\'app relance la vérification', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    let mode = 'panne';
    let appels = 0;
    await page.route('**/index.html', route => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      appels++;
      if (mode === 'panne') return route.abort('internetdisconnected');
      return route.fulfill({ status: 200, contentType: 'text/html', body: HTML.replace(/\?v=[0-9-]+"/g, '?v=29991231-9"') });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
    const banniere = () => page.evaluate(() => !!document.getElementById('majBanner'));

    // Retour d'une app endormie : le réseau n'est pas encore là, la vérification échoue.
    await page.evaluate(() => verifierNouvelleVersion(false));
    assert.equal(await banniere(), false);
    const avant = appels;

    // Le réseau revient quelques secondes plus tard : ce signal NON forcé doit
    // repartir aussitôt, sans attendre le délai minimal ni les 3 minutes.
    mode = 'ok';
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await page.waitForSelector('#majBanner', { timeout: 5000 });
    assert.ok(appels > avant, 'la vérification doit être repartie après l\'échec');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

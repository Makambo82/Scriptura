// Invitation à installer l'app : iPhone (Safari et Chrome iOS) et Chrome
// Android. Rien ne prévenait les créateurs qu'une app existait : Safari ne
// propose jamais l'installation, et sur Android seul un bouton discret
// apparaissait dans le menu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const UA = {
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1',
  tiktokIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.1.0 JsSdk/2.0 NetType/WIFI',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  chromeBureau: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

async function ouvrir(navigateur, baseUrl, userAgent, { standalone = false } = {}) {
  const contexte = await navigateur.newContext({ userAgent, viewport: { width: 390, height: 800 } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await poserMocksReseau(page);
  await page.addInitScript((st) => {
    window.SCRIPTURA_DELAI_INVITATION_MS = 200;
    if (st) Object.defineProperty(navigator, 'standalone', { get: () => true });
  }, standalone);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  return { page, contexte, erreurs };
}
const banniere = page => page.evaluate(() => { const b = document.getElementById('installBanner'); return b ? b.textContent : null; });
const boutonMenuVisible = page => page.evaluate(() => getComputedStyle(document.querySelector('[data-install-app]')).display !== 'none');
const evenementInstallable = page => page.evaluate(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  window.__promptAppele = 0;
  e.prompt = () => { window.__promptAppele++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
});

test('iPhone Safari : la bulle explique le geste, la croix la ferme pour de bon, le menu la rappelle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page, erreurs } = await ouvrir(navigateur, baseUrl, UA.safariIphone);
    await page.waitForSelector('#installBanner', { timeout: 5000 });
    assert.match(await banniere(page), /Installe Scriptura sur ton écran d'accueil.*Partager.*Sur l'écran d'accueil/);
    assert.ok(!/—/.test(await banniere(page)), 'jamais de tiret cadratin côté utilisateur');
    assert.equal(await boutonMenuVisible(page), true, 'le bouton du menu doit exister sur iPhone');

    await page.click('#installFermerBtn');
    assert.equal(await banniere(page), null);
    // Même après une nouvelle session (sessionStorage vidé), la croix tient.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(900);
    assert.equal(await banniere(page), null, 'fermée pour de bon : pas de harcèlement');

    // Le créateur la redemande lui-même depuis le menu : le guide revient.
    await page.evaluate(() => document.querySelector('[data-install-app]').click());
    assert.match(await banniere(page) || '', /Partager/);
    if (erreurs.length) throw new Error('Exceptions JS : ' + erreurs.join(' | '));
  } finally { await navigateur.close(); await arreter(); }
});

test('Chrome sur iPhone : même guide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page } = await ouvrir(navigateur, baseUrl, UA.chromeIphone);
    await page.waitForSelector('#installBanner', { timeout: 5000 });
    assert.match(await banniere(page), /Sur l'écran d'accueil/);
  } finally { await navigateur.close(); await arreter(); }
});

test('navigateur intégré de TikTok (lien en bio) : aucune consigne fausse, rien d\'affiché', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page } = await ouvrir(navigateur, baseUrl, UA.tiktokIphone);
    await page.waitForTimeout(900);
    assert.equal(await banniere(page), null);
    assert.equal(await boutonMenuVisible(page), false);
  } finally { await navigateur.close(); await arreter(); }
});

test('app déjà installée (écran d\'accueil iPhone) : aucune invitation', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page } = await ouvrir(navigateur, baseUrl, UA.safariIphone, { standalone: true });
    await page.waitForTimeout(900);
    assert.equal(await banniere(page), null);
    assert.equal(await boutonMenuVisible(page), false);
  } finally { await navigateur.close(); await arreter(); }
});

test('Chrome Android : la bulle attend que Chrome dise « installable », et « Installer » lance le vrai prompt', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page, erreurs } = await ouvrir(navigateur, baseUrl, UA.chromeAndroid);
    await page.waitForTimeout(700);
    assert.equal(await banniere(page), null, 'pas installable pour Chrome : rien à proposer');

    await evenementInstallable(page);
    await page.waitForSelector('#installBanner', { timeout: 5000 });
    assert.match(await banniere(page), /Installe Scriptura sur ton téléphone/);

    await page.click('#installBtn');
    await page.waitForFunction(() => !document.getElementById('installBanner'));
    assert.equal(await page.evaluate(() => window.__promptAppele), 1, 'le prompt natif doit être lancé');
    if (erreurs.length) throw new Error('Exceptions JS : ' + erreurs.join(' | '));
  } finally { await navigateur.close(); await arreter(); }
});

test('ordinateur : le bouton du menu suffit, pas de bulle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page } = await ouvrir(navigateur, baseUrl, UA.chromeBureau);
    await evenementInstallable(page);
    await page.waitForTimeout(700);
    assert.equal(await banniere(page), null);
    assert.equal(await boutonMenuVisible(page), true);
  } finally { await navigateur.close(); await arreter(); }
});

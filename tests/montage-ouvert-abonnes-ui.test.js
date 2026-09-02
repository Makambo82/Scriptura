// Retour propriétaire : le montage vidéo (voix off, musique, images, rendu)
// est désormais ouvert aux abonnés Creator et Pro côté serveur (voir
// verifierAccesMontage, api/_lib/acces.js), mais les boutons déclencheurs
// ("Générer la vidéo" sur un plan, "Monter une vidéo" sur l'accueil)
// restaient invisibles pour eux (CSS body.is-admin uniquement). Ce test
// vérifie le vrai câblage client : body.montage-actif est posé pour un
// abonné Creator/Pro (pas pour un non-abonné), et les boutons deviennent
// réellement visibles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Un abonné Creator voit désormais le bouton "Monter une vidéo" (accueil), auparavant réservé au fondateur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MONTAGEOUVERT-CREATOR', plan: 'creator' });
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const btn = document.getElementById('outilsMontageHomeBtn');
      return {
        classePosee: document.body.classList.contains('montage-actif'),
        boutonVisible: btn ? getComputedStyle(btn).display !== 'none' : false
      };
    });
    assert.equal(etat.classePosee, true, 'body.montage-actif doit être posé pour un abonné Creator');
    assert.equal(etat.boutonVisible, true, 'le bouton "Monter une vidéo" doit être visible pour un abonné Creator');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Un abonné Pro voit aussi le bouton "Monter une vidéo"', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MONTAGEOUVERT-PRO', plan: 'pro' });
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const boutonVisible = await page.evaluate(() => {
      const btn = document.getElementById('outilsMontageHomeBtn');
      return btn ? getComputedStyle(btn).display !== 'none' : false;
    });
    assert.equal(boutonVisible, true, 'le bouton "Monter une vidéo" doit être visible pour un abonné Pro');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Un non-abonné (jamais connecté) ne voit PAS le bouton "Monter une vidéo", comportement inchangé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const btn = document.getElementById('outilsMontageHomeBtn');
      return {
        classePosee: document.body.classList.contains('montage-actif'),
        boutonVisible: btn ? getComputedStyle(btn).display !== 'none' : false
      };
    });
    assert.equal(etat.classePosee, false, 'body.montage-actif ne doit jamais être posé pour un non-abonné');
    assert.equal(etat.boutonVisible, false, 'le bouton doit rester invisible pour un non-abonné');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire : le rendu vidéo (api/montage-render.js) n'est plus
// réservé au fondateur, son coût réel mesuré est négligeable. Ce test
// verrouille le CÔTÉ VISIBLE de cette ouverture : les deux boutons qui
// menaient au montage (« Générer la vidéo » sous un storyboard, et
// « Monter une vidéo » sur l'accueil) étaient masqués par CSS pour tout le
// monde sauf body.is-admin (voir css/style.css). Sans un test qui ouvre
// vraiment une session Creator/Pro et regarde le RENDU RÉEL (pas juste la
// présence de la classe CSS), ce genre de bouton oublié en dur derrière
// body.is-admin peut rester invisible indéfiniment sans que personne ne le
// remarque : un abonné qui a payé ne verrait jamais l'entrée d'un outil
// qu'il a le droit d'utiliser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Mesure le RENDU réel des deux boutons, pas la seule classe CSS (même
// piège documenté dans tests/bouton-creation-flottant.test.js : une classe
// posée sans effet visuel resterait invisible à un test qui se contente de
// classList.contains).
async function boutonsMontageVisibles(page) {
  return page.evaluate(() => {
    const rendu = (el) => {
      if (!el) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden';
    };
    return {
      classeMontage: document.body.classList.contains('peut-monter-video'),
      outilsMontageHome: rendu(document.getElementById('outilsMontageHomeBtn'))
    };
  });
}

test('un abonné Creator voit désormais "Monter une vidéo" sur l\'accueil', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'CODE-CREATOR', plan: 'creator' });
    await page.waitForTimeout(300);

    const vu = await boutonsMontageVisibles(page);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.classeMontage, true, 'body.peut-monter-video devrait être posée pour un Creator');
    assert.equal(vu.outilsMontageHome, true, 'REGRESSION : "Monter une vidéo" doit être visible pour un Creator');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un abonné Pro voit aussi "Monter une vidéo"', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'CODE-PRO', plan: 'pro' });
    await page.waitForTimeout(300);

    const vu = await boutonsMontageVisibles(page);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.classeMontage, true);
    assert.equal(vu.outilsMontageHome, true, 'REGRESSION : "Monter une vidéo" doit être visible pour un Pro');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un visiteur non connecté ne voit toujours pas "Monter une vidéo"', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await boutonsMontageVisibles(page);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.classeMontage, false, 'un visiteur non connecté ne doit jamais obtenir la classe');
    assert.equal(vu.outilsMontageHome, false, 'toujours masqué pour un non-abonné : le rendu reste payant');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le fondateur (isAdmin) continue de voir "Monter une vidéo", comportement inchangé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_unlocked', 'true');
      localStorage.setItem('scriptura_code', 'CODE-ADMIN');
      localStorage.setItem('scriptura_is_admin', 'true');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await boutonsMontageVisibles(page);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.outilsMontageHome, true, 'le fondateur doit toujours voir "Monter une vidéo"');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

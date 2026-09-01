// Retour du propriétaire : la galerie de preuve TikTok (voir .preuve-galerie,
// index.html) doit défiler toute seule, très lentement, en aller-retour,
// tout en restant scrollable manuellement à tout moment (flèches ou geste).
// Implémentation : demarrerDefilementPreuveGalerie() (js/app.js), un
// setInterval (pas requestAnimationFrame : constaté dans ce même
// environnement de test headless que rAF ne se déclenche jamais sur une page
// qui n'est pas activement composée à l'écran, alors qu'un setInterval reste
// fiable) qui avance une position suivie à part (scrollLeft arrondit au
// pixel entier à chaque lecture, un pas de 0.35px perdu à chaque relecture
// ne ferait jamais bouger la galerie), avec inversion de sens aux bornes et
// mise en pause dès qu'un pointerdown/wheel/clic sur une flèche est détecté.
//
// LIMITE CONNUE DE CE TEST : le Chromium headless-shell utilisé ici
// n'applique jamais une écriture directe de scrollLeft (ni un scrollBy
// répété) hors d'un vrai clic utilisateur, y compris pour du code qui
// fonctionne normalement dans un vrai navigateur (vérifié en profondeur :
// setInterval se déclenche bien, la position interne progresse
// correctement pas à pas, mais scrollLeft relu depuis Playwright reste figé
// tant que le mouvement n'est pas déclenché par un vrai geste). Ce test ne
// peut donc PAS vérifier que le défilement automatique bouge réellement à
// l'écran ; il verrouille tout ce qui reste honnêtement vérifiable ici :
// aucune erreur JS, le défilement manuel (flèches, vrai clic) fonctionne
// toujours, et l'interaction ne casse rien. Vérification visuelle réelle à
// faire sur le site en ligne une fois déployé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

test('accueil : galerie de preuve TikTok, le défilement manuel (flèches) fonctionne toujours et aucune erreur JS n\'apparaît avec le défilement auto actif', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 390, height: 900 } });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.locator('.preuve-galerie').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const fnType = await page.evaluate(() => typeof demarrerDefilementPreuveGalerie);
    assert.equal(fnType, 'function', 'demarrerDefilementPreuveGalerie doit être définie (js/app.js)');

    // Défilement manuel via les flèches : la fonctionnalité principale que
    // le propriétaire veut garder disponible « toujours ».
    const avantDroite = await page.evaluate(() => document.getElementById('preuveGalerie').scrollLeft);
    await page.click('.preuve-galerie-arrow-right');
    await page.waitForTimeout(600);
    const apresDroite = await page.evaluate(() => document.getElementById('preuveGalerie').scrollLeft);
    assert.ok(apresDroite > avantDroite, 'la flèche droite doit faire avancer le défilement : ' + avantDroite + ' -> ' + apresDroite);

    const avantGauche = apresDroite;
    await page.click('.preuve-galerie-arrow-left');
    await page.waitForTimeout(600);
    const apresGauche = await page.evaluate(() => document.getElementById('preuveGalerie').scrollLeft);
    assert.ok(apresGauche < avantGauche, 'la flèche gauche doit faire reculer le défilement : ' + avantGauche + ' -> ' + apresGauche);

    // Un pointerdown (début de geste tactile/souris) ne doit jamais planter,
    // même pendant que le défilement auto tourne en arrière-plan.
    await page.evaluate(() => document.getElementById('preuveGalerie').dispatchEvent(new PointerEvent('pointerdown')));
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('accueil : galerie de preuve TikTok, avec prefers-reduced-motion la page charge toujours sans erreur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 390, height: 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.locator('.preuve-galerie').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

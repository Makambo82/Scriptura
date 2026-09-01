// Retour du propriétaire : la galerie de preuve TikTok (voir .preuve-galerie,
// index.html) doit défiler toute seule, très lentement, en aller-retour,
// tout en restant scrollable manuellement à tout moment (flèches ou geste).
// Implémentation : demarrerDefilementPreuveGalerie() (js/app.js), un
// requestAnimationFrame avec pas basé sur le temps réel écoulé, qui avance
// une position suivie à part (scrollLeft arrondit au pixel entier à chaque
// lecture, un pas sous 1px perdu à chaque relecture ne ferait jamais bouger
// la galerie), avec inversion de sens aux bornes et mise en pause dès qu'un
// pointerdown/wheel/clic sur une flèche est détecté.
//
// 2e passe (retour propriétaire : le défilement ne s'appliquait PAS du tout
// sur iOS Safari en prod, un vrai bug, pas seulement une limite de test) :
// cause identifiée, `-webkit-overflow-scrolling:touch` sur .preuve-galerie
// entrait en conflit avec des écritures programmatiques de scrollLeft sur
// iOS, propriété de toute façon inutile depuis iOS 13 (défilement inertiel
// natif par défaut), retirée du CSS. Passage de setInterval à
// requestAnimationFrame au passage (plus idiomatique pour une animation
// visuelle, se met en pause tout seul sur un onglet en arrière-plan).
//
// LIMITE CONNUE DE CE TEST : le Chromium headless-shell utilisé ici
// n'applique jamais une écriture directe de scrollLeft (ni un scrollBy
// répété, ni une frame rAF) hors d'un vrai clic utilisateur, y compris pour
// du code qui fonctionne normalement dans un vrai navigateur. Ce test ne
// peut donc PAS vérifier que le défilement automatique bouge réellement à
// l'écran ; il verrouille tout ce qui reste honnêtement vérifiable ici :
// aucune erreur JS, le défilement manuel (flèches, vrai clic) fonctionne
// toujours, et l'interaction ne casse rien. Vérification visuelle réelle
// faite par le propriétaire sur le site en ligne.
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

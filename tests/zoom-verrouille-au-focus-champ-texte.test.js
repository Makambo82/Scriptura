// Audit du 3 septembre 2026 : au clic dans une zone de saisie, l'app faisait
// un "petit zoom avant" visible avant de revenir à la normale. Cause : le
// verrouillage du zoom (maximum-scale=1, user-scalable=no) n'était appliqué
// qu'à la PERTE de focus d'un champ, jamais à sa PRISE de focus, laissant le
// temps au zoom automatique natif de certains navigateurs mobiles (Safari
// iOS notamment, malgré le 16px déjà en place sur tous les champs) de
// s'appliquer avant d'être corrigé. verrouillerZoom() verrouille désormais
// dès le focusin, avant que ce zoom natif ait le temps de s'appliquer, et
// reinitialiserZoom() continue de redéverrouiller normalement à la sortie
// du champ pour ne jamais bloquer le pincement une fois le champ quitté.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('Zoom mobile : verrouillé dès le focus d\'un champ texte, redéverrouillé à la sortie', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    const contenuOriginal = await page.evaluate(() =>
      document.querySelector('meta[name="viewport"]').getAttribute('content'));

    const pendantFocus = await page.evaluate(() => {
      document.getElementById('historyFlow').style.display = 'block';
      document.getElementById('historyCodeInput').focus();
      return document.querySelector('meta[name="viewport"]').getAttribute('content');
    });
    assert.match(pendantFocus, /maximum-scale=1\.0/, 'le focus doit verrouiller maximum-scale=1.0 immédiatement, avant tout zoom natif');
    assert.match(pendantFocus, /user-scalable=no/, 'le focus doit verrouiller user-scalable=no immédiatement');

    await page.evaluate(() => document.getElementById('historyCodeInput').blur());
    await page.waitForTimeout(250);
    const apresBlur = await page.evaluate(() =>
      document.querySelector('meta[name="viewport"]').getAttribute('content'));
    assert.equal(apresBlur, contenuOriginal, 'après la perte de focus (et le délai de réinitialisation), le viewport doit revenir exactement au réglage d\'origine, pour ne jamais bloquer le pincement');

    // Une case à cocher ne doit jamais déclencher le verrouillage : inutile
    // (pas de clavier, donc pas de zoom natif) et gênant en sélection multiple.
    const pendantCheckbox = await page.evaluate(() => {
      document.getElementById('flow').style.display = 'block';
      const c = document.getElementById('montageSousTitresCheckbox');
      c.focus();
      return document.querySelector('meta[name="viewport"]').getAttribute('content');
    });
    assert.equal(pendantCheckbox, contenuOriginal, 'une case à cocher ne doit jamais déclencher le verrouillage du zoom');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

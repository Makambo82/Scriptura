// Retour propriétaire, capture à l'appui : en mode Script, le bouton
// « ← Retour » était très bas sous l'en-tête, alors qu'en mode Récit il se
// posait juste dessous. Deux écrans du même produit, deux respirations
// différentes, ça se voit tout de suite.
//
// CAUSE EXACTE : #results portait un margin-top:56px hérité de l'époque où il
// s'affichait à la SUITE des étapes du formulaire. Ce n'est plus le cas :
// renderResults (js/generation.js) retire la classe "active" des étapes 1 et 2
// avant d'afficher le résultat, #results est alors le seul bloc visible de
// #flow. Ces 56px ne séparaient donc plus de rien, ils creusaient juste un vide
// entre l'en-tête fixe et le bouton de retour. Mesuré : 209px sous l'en-tête
// côté Script contre 153px côté Récit.
//
// Ce test verrouille l'ALIGNEMENT, pas une valeur en dur : si demain le
// padding haut des écrans change, les deux doivent bouger ensemble. Un chiffre
// figé se serait contenté de casser au premier ajustement de design.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('le mode Script commence à la même hauteur que le mode Récit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      const hauteurEntete = document.querySelector('nav').getBoundingClientRect().height;
      // Distance entre le BAS de l'en-tête fixe et le haut du bouton retour :
      // c'est exactement le vide que voit le créateur.
      const ecarts = {};
      const montrer = idEcran => {
        document.querySelectorAll('section,[id$="Flow"],#flow')
          .forEach(e => { e.style.display = 'none'; });
        document.getElementById(idEcran).style.display = 'block';
      };

      // Mode Script : le résultat affiché, aucune étape active, exactement
      // l'état produit par renderResults.
      montrer('flow');
      document.querySelectorAll('#flow .step').forEach(s => s.classList.remove('active'));
      const resultats = document.getElementById('results');
      resultats.style.display = 'block';
      ecarts.script = Math.round(
        resultats.querySelector('.btn-back').getBoundingClientRect().top - hauteurEntete);

      // Mode Récit : la référence voulue par le propriétaire.
      montrer('storyFlow');
      ecarts.recit = Math.round(
        document.querySelector('#storyFlow .btn-back').getBoundingClientRect().top - hauteurEntete);

      ecarts.entete = Math.round(hauteurEntete);
      return ecarts;
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.entete > 0, 'l\'en-tête doit avoir une hauteur mesurable : ' + vu.entete);
    assert.ok(vu.recit > 0, 'le mode Récit doit laisser respirer sous l\'en-tête : ' + vu.recit);
    assert.ok(Math.abs(vu.script - vu.recit) <= 2,
      'REGRESSION : le mode Script repart plus bas que le mode Récit (Script ' +
      vu.script + 'px, Récit ' + vu.recit + 'px sous l\'en-tête)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

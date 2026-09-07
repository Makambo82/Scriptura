// Demande du propriétaire : « au lieu de GÉNÉRER MON CONTENU SCRIPTURA, mets
// juste GÉNÉRER MON CONTENU ». Le nom de l'app est déjà écrit trois fois à
// l'écran (logo, texte d'attente, pied de page) : le répéter sur le bouton
// n'apprend rien et allonge une ligne déjà large en capitales.
//
// LE PIÈGE, ET C'EST TOUT L'OBJET DE CE TEST : ce libellé est écrit à DEUX
// endroits. index.html le pose au chargement, et setLoading (js/generation.js)
// le REPOSE à la fin de chaque génération. Ne changer que le HTML donnerait un
// bouton correct à l'ouverture, qui reprendrait l'ancien texte tout seul dès
// la première génération terminée. Personne ne le verrait avant d'avoir
// généré, c'est-à-dire jamais pendant qu'on relit son code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const ATTENDU = 'Générer mon contenu';

test('le bouton dit « Générer mon contenu », à l\'ouverture ET après une génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      const lire = () => document.getElementById('btnText').textContent.trim();
      const depart = lire();
      // On rejoue le cycle réel d'une génération : le bouton passe en attente,
      // puis revient au repos. C'est CE retour au repos qui réécrit le texte.
      setLoading(true);
      const pendant = lire();
      setLoading(false);
      return { depart: depart, pendant: pendant, apres: lire() };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    assert.equal(vu.depart, ATTENDU,
      'REGRESSION : le libellé posé dans index.html n\'est pas le bon. Vu : « ' + vu.depart + ' »');

    assert.match(vu.pendant, /génère/i,
      'pendant la génération, le bouton doit dire ce qui se passe : « ' + vu.pendant + ' »');

    assert.equal(vu.apres, ATTENDU,
      'REGRESSION : après une génération, le bouton reprend un AUTRE texte que celui de l\'ouverture. '
      + 'Ce libellé est écrit à deux endroits (index.html et setLoading, js/generation.js) et les deux '
      + 'doivent dire la même chose, sinon le bouton change tout seul au premier usage et personne ne '
      + 'le voit avant d\'avoir généré. Vu : « ' + vu.apres + ' » au lieu de « ' + ATTENDU + ' »');

    assert.equal(vu.depart, vu.apres,
      'les deux sources du libellé doivent rester d\'accord : « ' + vu.depart + ' » contre « '
      + vu.apres + ' »');

    assert.doesNotMatch(vu.apres, /Scriptura/,
      'REGRESSION : le nom de l\'app est revenu dans le libellé. Il est déjà écrit trois fois à '
      + 'l\'écran, et en capitales espacées il allongeait le bouton pour rien.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Audit du 2 septembre 2026 : la recommandation IA est affichée à 3
// endroits (accueil "accueilPremium", fin d'audit détaillé
// "auditOpportunites", diagnostic sommaire "diagSommaireOpportunites"), qui
// coexistent dans le DOM (écrans masqués, pas détruits, comme le reste de
// l'app). Une seule variable globale (_recommandations) partagée entre les
// trois faisait que le DERNIER écran rendu écrasait le tableau des autres :
// cliquer "Créer le script" sur une carte d'un écran plus ancien encore
// visible pouvait pré-remplir le récapitulatif avec UNE AUTRE
// recommandation que celle réellement affichée sur cette carte.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('creerScriptDepuisRecommandation : deux écrans de recommandation affichés en même temps restent isolés l\'un de l\'autre', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    // Rend DEUX écrans de recommandation avec des données bien distinctes,
    // dans l'ordre "accueil d'abord, audit ensuite" (le cas réel : l'accueil
    // est déjà dans le DOM quand un audit se termine et rend sa propre
    // section "Et maintenant ?").
    await page.evaluate(() => {
      const zoneAccueil = document.createElement('div');
      zoneAccueil.id = 'accueilPremium';
      document.body.appendChild(zoneAccueil);
      const zoneAudit = document.createElement('div');
      zoneAudit.id = 'auditOpportunites';
      document.body.appendChild(zoneAudit);

      rendreRecommandations('accueilPremium', {
        recommandations: [{ titre: 'Idée ACCUEIL', angle: 'Angle accueil' }],
        niveau_confiance: 'haute'
      }, '', false);
      rendreRecommandations('auditOpportunites', {
        recommandations: [{ titre: 'Idée AUDIT', angle: 'Angle audit' }],
        niveau_confiance: 'haute'
      }, '', false);
    });
    await page.waitForTimeout(100);

    // La carte accueil, rendue AVANT la carte audit, est toujours visible à
    // l'écran (écrans masqués, pas détruits) : cliquer sur SON bouton doit
    // pré-remplir avec SA propre recommandation, pas celle de l'audit rendu
    // ensuite.
    const sujetApresClicAccueil = await page.evaluate(() => {
      document.getElementById('flow').style.display = 'none'; // état de départ propre
      creerScriptDepuisRecommandation('accueilPremium', 0);
      return document.getElementById('sujet').value;
    });
    assert.match(sujetApresClicAccueil, /Idée ACCUEIL/, 'le bouton de la carte accueil doit utiliser SA PROPRE recommandation : ' + sujetApresClicAccueil);

    const sujetApresClicAudit = await page.evaluate(() => {
      creerScriptDepuisRecommandation('auditOpportunites', 0);
      return document.getElementById('sujet').value;
    });
    assert.match(sujetApresClicAudit, /Idée AUDIT/, 'le bouton de la carte audit doit utiliser SA PROPRE recommandation : ' + sujetApresClicAudit);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

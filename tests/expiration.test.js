// Non-régression : l'espace abonné (js/abonnement.js, notification "ton
// abonnement expire dans...") et le tableau de bord fondateur (js/admin.js,
// carte "Expirent bientôt") calculaient autrefois les jours restants avec
// deux formules différentes sur le même champ expire_le (écart de dates
// civiles minuit à minuit d'un côté, compte depuis l'instant présent
// jusqu'à la fin du jour d'expiration de l'autre) : pour un même abonné au
// même moment, l'un affichait "3 jours", l'autre "2 j". Les deux passent
// maintenant par joursRestantsAvantExpiration (js/historique.js), ce test
// vérifie qu'ils restent d'accord.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('le nombre de jours avant expiration est identique côté abonné et côté admin', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    const resultat = await page.evaluate(() => {
      const dansDeuxJours = new Date();
      dansDeuxJours.setDate(dansDeuxJours.getDate() + 2);
      const expireLe = dansDeuxJours.toISOString().slice(0, 10);

      const coteAbonne = joursRestantsAvantExpiration(expireLe);

      _codesAbonnesAdmin = [{ code: 'FIFA', plan: 'creator', actif: true, expire_le: expireLe }];
      const carteAdmin = carteExpirationsAdmin();
      const matchAdmin = carteAdmin.match(/Expire dans (\d+) j/);
      const coteAdmin = matchAdmin ? parseInt(matchAdmin[1], 10) : null;

      return { coteAbonne, coteAdmin };
    });

    assert.notEqual(resultat.coteAdmin, null, 'la carte admin doit afficher un nombre de jours');
    assert.equal(resultat.coteAbonne, resultat.coteAdmin, 'les deux écrans doivent afficher le même nombre de jours pour le même expire_le');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Test de fumée : la page se charge sans erreur console/page, et les
// fonctions clés utilisées par le reste de la suite existent bien dans le
// scope global. Sert de garde-fou générique contre une erreur de syntaxe ou
// un script cassé qui empêcherait TOUT le reste de l'app de fonctionner.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('la page charge sans erreur et les fonctions clés existent', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreurs = [];
    page.on('pageerror', (err) => erreurs.push(err.message));

    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    assert.deepEqual(erreurs, [], 'aucune erreur JS ne doit survenir au chargement');

    const fonctionsClesPresentes = await page.evaluate(() => ({
      generate: typeof generate === 'function',
      envoyerPresence: typeof envoyerPresence === 'function',
      joursRestantsAvantExpiration: typeof joursRestantsAvantExpiration === 'function',
      genererRecommandations: typeof genererRecommandations === 'function',
      afficherDiagnosticSommaireResultat: typeof afficherDiagnosticSommaireResultat === 'function'
    }));
    assert.deepEqual(fonctionsClesPresentes, {
      generate: true,
      envoyerPresence: true,
      joursRestantsAvantExpiration: true,
      genererRecommandations: true,
      afficherDiagnosticSommaireResultat: true
    });

    const titre = await page.title();
    assert.match(titre, /Scriptura/i);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

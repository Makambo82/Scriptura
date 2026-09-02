// Audit du 2 septembre 2026 : basculerVersCompteConnu() (js/auth.js) n'avait
// aucun verrou anti-double-appel. Cliquer vite sur deux comptes connus
// d'affilée lançait deux vérifications serveur en parallèle ; celle qui
// répond EN DERNIER gagnait l'écriture localStorage (scriptura_code...),
// pas forcément le compte réellement cliqué en dernier par l'utilisateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('basculerVersCompteConnu : un 2e appel pendant qu\'un premier est en cours est ignoré, pas de bascule concurrente', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // /api/verify-code répond lentement pour le compte A (afin de laisser le
    // temps à un 2e appel de se déclencher pendant que le 1er est en vol),
    // immédiatement pour le compte B.
    await page.route('**/api/verify-code', async route => {
      const corps = JSON.parse(route.request().postData() || '{}');
      if (corps.code === 'CODE-LENT') await new Promise(r => setTimeout(r, 400));
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ valid: true, isAdmin: false, illimite: false, plan: 'creator' })
      });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    // Empêche le reload (qui casserait le test) : on observe juste combien
    // de fois localStorage.scriptura_code a été écrit et avec quelle valeur
    // AVANT le reload déclenché par le 1er appel qui aboutit.
    const nbAppelsVerifyCode = await page.evaluate(async () => {
      let appels = 0;
      const fetchOriginal = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes('/api/verify-code')) appels++;
        return fetchOriginal(...args);
      };
      basculerVersCompteConnu('CODE-LENT'); // ne pas attendre : simule le clic utilisateur
      basculerVersCompteConnu('CODE-RAPIDE'); // 2e clic immédiat, doit être ignoré
      // Volontairement AVANT que CODE-LENT n'aboutisse (mock 400ms, voir
      // ci-dessus) et déclenche son reload : on vérifie seulement qu'un
      // seul appel réseau est parti, pas d'attendre le reload lui-même.
      await new Promise(r => setTimeout(r, 150));
      return appels;
    });
    assert.equal(nbAppelsVerifyCode, 1, 'un seul appel réseau doit partir, le 2e doit être bloqué par le verrou : ' + nbAppelsVerifyCode);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

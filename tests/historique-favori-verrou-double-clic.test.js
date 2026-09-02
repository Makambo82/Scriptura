// Audit du 2 septembre 2026 : deux clics rapprochés sur la même étoile
// favori envoyaient deux requêtes aux valeurs opposées (mettre en favori
// puis retirer), sans garantie que l'état final en base corresponde au
// dernier clic visible à l'écran (course possible selon l'ordre de
// résolution réseau). toggleFavori() verrouille désormais l'id le temps de
// la persistance : un 2e clic pendant ce délai est ignoré.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('toggleFavori : un 2e clic pendant que le 1er persiste encore est ignoré', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    let debloquer;
    const attente = new Promise(resolve => { debloquer = resolve; });
    let appelsFavori = 0;
    await page.route('**/api/data', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'favori') {
        appelsFavori++;
        await attente;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.continue();
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    await page.evaluate(() => {
      window._historyDataAll = [{ id: 'g1', mode: 'script', titre: 'A', favori: false }];
      window._historySeriesAll = [];
    });

    const etatPendant = await page.evaluate(() => {
      toggleFavori('g1'); // 1er clic : lance la persistance (reste en vol)
      const favoriApres1erClic = window._historyDataAll.find(g => g.id === 'g1').favori;
      toggleFavori('g1'); // 2e clic immédiat : doit être ignoré (verrou)
      const favoriApres2eClic = window._historyDataAll.find(g => g.id === 'g1').favori;
      return { favoriApres1erClic, favoriApres2eClic };
    });
    assert.equal(etatPendant.favoriApres1erClic, true, 'le 1er clic doit passer le favori à true (maj optimiste)');
    assert.equal(etatPendant.favoriApres2eClic, true, 'le 2e clic doit être ignoré tant que le 1er persiste encore : le favori doit rester à true, jamais repasser à false par ce 2e appel');

    debloquer();
    await page.waitForTimeout(200);
    assert.equal(appelsFavori, 1, 'un seul appel réseau doit être parti au total : ' + appelsFavori);

    // Une fois la persistance terminée, un nouveau clic doit fonctionner normalement.
    const apresLibere = await page.evaluate(() => {
      toggleFavori('g1');
      return window._historyDataAll.find(g => g.id === 'g1').favori;
    });
    assert.equal(apresLibere, false, 'une fois le verrou libéré, un nouveau clic doit fonctionner normalement');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

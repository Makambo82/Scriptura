// Audit du 2 septembre 2026 : toggleFavori()/favoriSelected() (js/historique.js)
// mettaient l'étoile à jour de façon optimiste, mais un échec réel de
// l'enregistrement (/api/data, action=favori) restait totalement silencieux
// côté UI (juste un console.warn) : l'étoile continuait d'afficher un
// favori jamais réellement enregistré côté serveur. Vérifie que l'étoile
// revient à son état précédent quand l'enregistrement échoue vraiment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('toggleFavori : un échec réel d\'enregistrement fait revenir l\'étoile à son état précédent', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await page.route('**/api/data', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.resource === 'generations' && body.action === 'favori') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'panne simulée' } }) });
      }
      return route.continue();
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FIFA', plan: 'creator' });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('historyFlow').style.display = 'block';
      document.getElementById('historyToolbar').style.display = 'flex';
      window._historyDataAll = [{ id: 'g1', mode: 'script', titre: 'A', favori: false }];
      window._historySeriesAll = [];
      dessinerHistorique();
    });
    await page.waitForTimeout(150);

    const favoriApresClic = await page.evaluate(() => {
      toggleFavori('g1');
      return document.querySelector('.history-fav').classList.contains('actif');
    });
    assert.equal(favoriApresClic, true, 'l\'étoile doit devenir dorée immédiatement (maj optimiste)');

    // Laisse le temps à la réponse 500 (mockée ci-dessus) d'être traitée et
    // au rollback de s'exécuter.
    await page.waitForTimeout(300);

    const etatApresEchec = await page.evaluate(() => ({
      favoriDansCache: window._historyDataAll.find(g => g.id === 'g1').favori,
      etoileActive: document.querySelector('.history-fav').classList.contains('actif')
    }));
    assert.equal(etatApresEchec.favoriDansCache, false, 'un échec réel doit remettre le favori à son état précédent dans le cache : ' + JSON.stringify(etatApresEchec));
    assert.equal(etatApresEchec.etoileActive, false, 'l\'étoile ne doit plus apparaître dorée une fois l\'échec confirmé : ' + JSON.stringify(etatApresEchec));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

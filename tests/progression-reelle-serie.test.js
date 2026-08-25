// Série (js/serie.js) : l'écriture d'un épisode (genererEpisode) suit le
// même schéma que Script/Récit (écriture EN FLUX + contrôle de durée), mais
// pilotait encore sa barre de % avec createProgress (estimation de temps).
// Vérifie que GEN_POIDS.serie_episode + creerProgressionReelle branchent
// désormais un % réel ici aussi (même moteur, déjà validé pour Script et
// Récit dans progression-reelle-script.test.js / progression-reelle-recit.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Ma série', concept: 'Un concept', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Dramatique', nb_episodes: 5,
  bible: { premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R', arc: [{ episode: 1, fonction: 'ouvrir', tension_finale: 'T' }], duree_episode: '45 à 60 secondes', format: 'Face caméra' },
  episodes: [], episode_courant: 0, statut: 'en_cours'
};
// Épisode assez long pour tomber dans la fourchette de mots attendue pour
// "45 à 60 secondes" et ne pas boucler indéfiniment sur le contrôle de durée.
const SCRIPT_EP = Array.from({ length: 25 }, (_, i) => `Phrase numéro ${i} du script de cet épisode, assez longue pour compter dans le total.`).join(' ');
const EP_FAKE = { titre: 'Épisode 1', script: SCRIPT_EP, voix_off_propre: SCRIPT_EP, directives: 'Filme en gros plan.' };

test('Série : le % de la barre de génération d\'épisode progresse réellement (flux + jalon), jamais figé sur un minuteur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // Deux motifs nécessaires (voir tests/helpers/mocks.js) : le glob
    // Playwright '**/api/data' ne matche pas une URL avec une chaîne de
    // requête derrière (?resource=series&...), utilisée par _serieGet.
    const gererDataSerie = async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'GET' && url.searchParams.get('resource') === 'series') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: SERIE_FAKE }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'gen-test', data: [] }) });
    };
    await page.unroute('**/api/data');
    await page.unroute('**/api/data?**');
    await page.route('**/api/data', gererDataSerie);
    await page.route('**/api/data?**', gererDataSerie);

    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await new Promise((r) => setTimeout(r, 180));
      if (body.max_tokens === 3000) {
        // Étape en flux réel (comme Script/Récit) : content-type text/plain.
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(EP_FAKE) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(EP_FAKE) }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROGSERIE1', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      serieCouranteId = 'serie-test';
      document.body.insertAdjacentHTML('beforeend', `
        <button id="serieEpBtn"></button>
        <span id="serieEpSpinner"></span>
        <div id="serieEpTxt"></div>
        <div id="serieDetailError" style="display:none"></div>`);
    });

    await page.evaluateHandle(() => {
      const releves = [];
      const id = setInterval(() => {
        const el = document.getElementById('genProgressPct');
        if (el) releves.push(el.textContent);
      }, 60);
      window.__releves = releves;
      window.__arreterReleve = () => clearInterval(id);
      return true;
    });

    const genererPromise = page.evaluate(() => genererEpisode());
    await page.waitForTimeout(2500);
    await genererPromise;
    await page.evaluate(() => window.__arreterReleve());
    const suiviPct = await page.evaluate(() => window.__releves.map(t => parseInt(t, 10)));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const estDeterminee = await page.evaluate(() => {
      const fill = document.getElementById('genProgressFill');
      const bar = fill && fill.closest('.sb-progress-bar');
      return !!bar && bar.classList.contains('determinee');
    });
    assert.equal(estDeterminee, true, 'la barre principale doit afficher un % pour le mode Série');

    assert.ok(suiviPct.length >= 2, 'plusieurs valeurs de % doivent avoir été relevées : ' + JSON.stringify(suiviPct));
    for (let i = 1; i < suiviPct.length; i++) {
      assert.ok(suiviPct[i] >= suiviPct[i - 1], 'le % ne doit jamais reculer : ' + JSON.stringify(suiviPct));
    }
    const valeursDistinctes = new Set(suiviPct);
    assert.ok(valeursDistinctes.size >= 2, 'le % doit vraiment progresser, pas rester figé : ' + JSON.stringify(suiviPct));

    const pctFinal = await page.evaluate(() => document.getElementById('genProgressPct').textContent);
    assert.equal(pctFinal, '100%', 'une fois l\'épisode généré, le % doit être exactement 100%');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

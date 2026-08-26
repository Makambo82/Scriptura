// Trouvé par une revue de code indépendante (pas un retour du propriétaire) :
// saveGeneration (js/historique.js) s'appuie sur `currentGenId`, une
// variable GLOBALE unique partagée par TOUTE l'app (Script, Récit, Idées...)
// pour savoir QUELLE ligne d'historique une régénération gratuite doit
// mettre à jour en place. Ça marche pour ces autres modes : un seul élément
// "courant" à la fois. Mais depuis l'ajout du bouton "↻ Régénérer" par
// épisode (cette même session), la Série a PLUSIEURS épisodes qui coexistent,
// chacun avec sa propre ligne d'historique.
//
// Séquence à risque : générer l'épisode 1 (nouvelle ligne A, currentGenId=A),
// puis l'épisode 2 (nouvelle ligne B, currentGenId=B). Cliquer "Régénérer"
// sur l'épisode 1 pendant qu'il reste des régénérations gratuites : sans
// correctif, currentGenId vaut encore B (celui de l'épisode 2), donc la mise
// à jour "gratuite" en place écraserait la ligne d'historique de l'épisode 2
// avec le contenu de l'épisode 1 régénéré — une corruption croisée invisible.
//
// Corrigé : chaque épisode mémorise son propre `historyId` ; avant d'appeler
// saveGeneration, `currentGenId` est réaligné sur le historyId de l'épisode
// RÉELLEMENT en cours de régénération, jamais sur le dernier épisode généré.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SCRIPT_EP1 = Array.from({ length: 9 }, (_, i) => `Texte ${i} de l'épisode un, assez long pour compter dans le total.`).join(' ');
const SCRIPT_EP2 = Array.from({ length: 9 }, (_, i) => `Texte ${i} de l'épisode deux, assez long pour compter dans le total.`).join(' ');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Le Casse', concept: 'Un braquage', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Dramatique', nb_episodes: 5,
  bible: { premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R', arc: [{ episode: 1 }, { episode: 2 }], duree_episode: '45 à 60 secondes', format: 'Face caméra' },
  episodes: [
    { num: 1, titre: 'Épisode 1', script: SCRIPT_EP1, voix_off_propre: SCRIPT_EP1, historyId: 'hist-ep1' },
    { num: 2, titre: 'Épisode 2', script: SCRIPT_EP2, voix_off_propre: SCRIPT_EP2, historyId: 'hist-ep2' }
  ],
  episode_courant: 2, statut: 'en_cours'
};

const VOIX_OFF_REGEN = Array.from({ length: 9 }, (_, i) => `Nouveau texte ${i} de l'épisode un régénéré, assez long pour compter.`).join(' ');
const EP_REGENERE = { titre: 'Épisode 1 (régénéré)', script: VOIX_OFF_REGEN, voix_off_propre: VOIX_OFF_REGEN };

test('Série : régénérer un épisode met à jour SA PROPRE ligne d\'historique, jamais celle d\'un autre épisode généré depuis', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    let appelSaveRegen = null;
    let patchFinal = null;
    const gererDataSerie = async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'GET' && url.searchParams.get('resource') === 'series') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: SERIE_FAKE }) });
      }
      if (req.method() === 'POST') {
        let body = {};
        try { body = JSON.parse(req.postData()); } catch (e) { /* ignore */ }
        if (body.action === 'save-regen') appelSaveRegen = body;
        if (body.action === 'update' && body.patch && body.patch.episodes) patchFinal = body.patch;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'gen-nouveau', data: [] }) });
    };
    await page.unroute('**/api/data');
    await page.unroute('**/api/data?**');
    await page.route('**/api/data', gererDataSerie);
    await page.route('**/api/data?**', gererDataSerie);

    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 3000) {
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(EP_REGENERE) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIEHIST1', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      serieCouranteId = 'serie-test';
      // Simule l'état réaliste : episode 2 vient d'être généré en dernier,
      // currentGenId (variable globale de js/historique.js) pointe donc
      // encore sur SA ligne à lui au moment où on régénère l'épisode 1.
      currentGenId = 'hist-ep2';
    });

    // Régénère l'ÉPISODE 1 (pas le dernier généré).
    await page.evaluate(() => genererEpisode(1));
    await page.waitForTimeout(500);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(appelSaveRegen, 'la régénération (gratuite, dans le quota REGEN_GRATUITES) doit mettre à jour une ligne d\'historique existante, pas en créer une nouvelle');
    assert.equal(appelSaveRegen.id, 'hist-ep1', 'la mise à jour doit cibler la ligne d\'historique de l\'ÉPISODE 1, pas celle de l\'épisode 2 (dernier généré) : reçu ' + JSON.stringify(appelSaveRegen));

    assert.ok(patchFinal && Array.isArray(patchFinal.episodes), 'l\'épisode régénéré doit être enregistré : ' + JSON.stringify(patchFinal));
    const ep1 = patchFinal.episodes.find(e => e.num === 1);
    const ep2 = patchFinal.episodes.find(e => e.num === 2);
    assert.equal(ep1.historyId, 'hist-ep1', 'l\'épisode 1 garde son propre historyId après régénération');
    assert.equal(ep2.historyId, 'hist-ep2', 'l\'épisode 2 (non touché) garde le sien, intact');
    assert.equal(ep2.script, SCRIPT_EP2, 'le contenu de l\'épisode 2 ne doit jamais être écrasé par la régénération de l\'épisode 1');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

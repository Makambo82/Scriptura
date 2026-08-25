// Retour direct du propriétaire (3 captures d'écran) : le bloc "Storyboard
// visuel" d'un épisode (style/format + bouton) restait toujours déplié,
// alourdissant chaque épisode. Doit devenir une carte repliable identique à
// celle déjà utilisée pour Script/Récit (js/generation.js, js/storytelling.js :
// .out-card + toggleCard), avec le même "+" qui devient un "×" (rotation
// CSS) une fois ouverte.
//
// Piège évité : le résultat déjà généré (renderSerieStoryboardContenu) et le
// résultat construit EN DIRECT pendant la génération (genererStoryboardEpisode)
// étaient chacun leur PROPRE carte .out-card complète. Les envelopper toutes
// les deux dans une carte supplémentaire aurait empilé deux cartes imbriquées
// (deux fois le titre "Storyboard visuel", deux fois le "+"). Ce test vérifie
// donc qu'il n'y a jamais qu'UNE seule carte .out-card pour le storyboard
// d'un épisode, avant ET après génération.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SCRIPT_EP1 = Array.from({ length: 9 }, (_, i) => `Texte ${i} de l'épisode un, assez long pour compter dans le total, avec un peu plus de mots pour bien remplir la carte.`).join(' ');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Le Casse', concept: 'Un braquage', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Dramatique', nb_episodes: 5,
  bible: { premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R', arc: [{ episode: 1 }], duree_episode: '45 à 60 secondes', format: 'Faceless' },
  episodes: [{ num: 1, titre: 'Minuit moins une heure', script: SCRIPT_EP1, voix_off_propre: SCRIPT_EP1 }],
  episode_courant: 1, statut: 'en_cours'
};

test('Série : le storyboard d\'un épisode est une carte repliable (une seule, jamais imbriquée), ouverte après génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

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
      const texteMessage = JSON.stringify(body.messages || '');
      if (texteMessage.includes('MINIATURE')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ miniature: 'Un prompt de miniature 9:16' }) }] }) });
      }
      const nbEntrees = (texteMessage.match(/\\n\d+\.\s/g) || []).length || 1;
      const visuels = Array.from({ length: nbEntrees }, (_, i) => 'Prompt visuel généré ' + i + ' 9:16');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ visuels }) }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECARTE1', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => ouvrirSerie('serie-test'));
    await page.waitForTimeout(200);

    // 1) Avant toute génération : une carte, REPLIÉE, régénérer masqué.
    const etatAvant = await page.evaluate(() => {
      const cartes = document.querySelectorAll('#serieDetail .out-card');
      const carte = cartes[0];
      return {
        nbCartes: cartes.length,
        ouverte: carte.classList.contains('open'),
        corpsVisible: getComputedStyle(carte.querySelector('.out-body')).display !== 'none',
        regenVisible: getComputedStyle(document.getElementById('serieSbRegenBtn1')).display !== 'none',
        titre: carte.querySelector('.out-title').textContent.trim()
      };
    });
    assert.equal(etatAvant.nbCartes, 1, 'une seule carte doit exister avant génération');
    assert.equal(etatAvant.titre, 'Storyboard visuel');
    assert.equal(etatAvant.ouverte, false, 'la carte doit être repliée par défaut avant génération');
    assert.equal(etatAvant.corpsVisible, false, 'le contenu doit être masqué tant que la carte est repliée');
    assert.equal(etatAvant.regenVisible, false, 'le bouton Régénérer ne doit pas apparaître avant qu\'un storyboard existe');

    // 2) Clic sur l'en-tête : la carte s'ouvre, comme sur la capture (image 2 → image 3).
    await page.evaluate(() => document.querySelector('#serieDetail .out-card .out-header').click());
    const etatOuvert = await page.evaluate(() => {
      const carte = document.querySelectorAll('#serieDetail .out-card')[0];
      return {
        ouverte: carte.classList.contains('open'),
        corpsVisible: getComputedStyle(carte.querySelector('.out-body')).display !== 'none',
        description: carte.querySelector('.out-body p') ? carte.querySelector('.out-body p').textContent : null
      };
    });
    assert.equal(etatOuvert.ouverte, true, 'cliquer sur l\'en-tête doit ouvrir la carte');
    assert.equal(etatOuvert.corpsVisible, true, 'le contenu doit devenir visible une fois la carte ouverte');
    assert.match(etatOuvert.description || '', /découpage visuel plan par plan/);

    // 3) Génération : à la fin, le formulaire laisse place au résultat, le
    // bouton Régénérer apparaît dans l'en-tête, et il n'y a TOUJOURS qu'une
    // seule carte (pas de carte imbriquée dans la zone de résultat).
    await page.evaluate(() => genererStoryboardEpisode(1));
    await page.waitForTimeout(400);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etatApres = await page.evaluate(() => {
      const cartes = document.querySelectorAll('#serieDetail .out-card');
      const carte = cartes[0];
      return {
        nbCartes: cartes.length,
        cartesImbriquees: carte.querySelectorAll('.out-card').length,
        ouverte: carte.classList.contains('open'),
        formVisible: getComputedStyle(document.getElementById('serieSbForm1')).display !== 'none',
        regenVisible: getComputedStyle(document.getElementById('serieSbRegenBtn1')).display !== 'none',
        plans: document.querySelectorAll('#serieSbZone1 .sb-segment').length
      };
    });
    assert.equal(etatApres.nbCartes, 1, 'toujours une seule carte après génération, jamais deux imbriquées');
    assert.equal(etatApres.cartesImbriquees, 0, 'aucune carte .out-card ne doit être imbriquée dans la carte du storyboard');
    assert.equal(etatApres.ouverte, true, 'la carte reste ouverte après génération (déjà ouverte par le clic)');
    assert.equal(etatApres.formVisible, false, 'le formulaire (bouton + options) doit disparaître une fois le storyboard généré');
    assert.equal(etatApres.regenVisible, true, 'le bouton Régénérer doit apparaître une fois le storyboard généré');
    assert.ok(etatApres.plans > 0, 'les plans générés doivent être affichés : ' + etatApres.plans);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Série : après un rechargement complet (ouvrirSerie), un storyboard déjà généré reste dans UNE carte ouverte, sans imbrication', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    const serieAvecStoryboard = Object.assign({}, SERIE_FAKE, {
      episodes: [Object.assign({}, SERIE_FAKE.episodes[0], {
        storyboard: [{ segment: '0-3s', texte_dit: 'Un plan.', prompt_visuel: 'Un prompt visuel 9:16' }],
        miniature: 'Une miniature 9:16'
      })]
    });
    const gererDataSerie = async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'GET' && url.searchParams.get('resource') === 'series') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: serieAvecStoryboard }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'gen-test', data: [] }) });
    };
    await page.unroute('**/api/data');
    await page.unroute('**/api/data?**');
    await page.route('**/api/data', gererDataSerie);
    await page.route('**/api/data?**', gererDataSerie);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECARTE2', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => ouvrirSerie('serie-test'));
    await page.waitForTimeout(200);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const cartes = document.querySelectorAll('#serieDetail .out-card');
      const carte = cartes[0];
      return {
        nbCartes: cartes.length,
        cartesImbriquees: carte.querySelectorAll('.out-card').length,
        ouverte: carte.classList.contains('open'),
        regenVisible: getComputedStyle(document.getElementById('serieSbRegenBtn1')).display !== 'none',
        formVisible: getComputedStyle(document.getElementById('serieSbForm1')).display !== 'none',
        // .sb-miniature porte AUSSI la classe .sb-segment (carte de couverture,
        // même gabarit) : exclue ici pour ne compter que les vrais plans.
        plans: document.querySelectorAll('#serieSbZone1 .sb-segment:not(.sb-miniature)').length
      };
    });
    assert.equal(etat.nbCartes, 1, 'une seule carte pour un storyboard déjà généré, chargé au rendu initial');
    assert.equal(etat.cartesImbriquees, 0);
    assert.equal(etat.ouverte, true, 'un storyboard déjà là doit être visible sans clic supplémentaire');
    assert.equal(etat.regenVisible, true);
    assert.equal(etat.formVisible, false);
    assert.equal(etat.plans, 1);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

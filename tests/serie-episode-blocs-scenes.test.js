// Retour direct du propriétaire (2 captures comparées) : le script d'un
// épisode de série s'affichait en UN SEUL bloc de texte compact, alors que
// le mode Script affiche chaque scène/idée dans son propre paragraphe,
// séparé par un saut de ligne (et une fine bordure entre chaque bloc).
// "Fais de même pour série" : réutilise exactement le même gabarit visuel
// (.script-block/.script-row/.script-text, déjà utilisé par le mode Script)
// pour le script d'un épisode.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SCRIPT_EN_PARAGRAPHES = [
  '22h47. Quatre heures avant l\'aube. Quatre heures pour voler quarante millions de dollars au cœur du Strip.',
  'Marcus est le cerveau. Trois mois de reconnaissance. Il a étudié chaque caméra, chaque couloir.',
  'Mais à trois kilomètres de là, au poste de sécurité centrale, quelque chose a changé.'
].join('\n\n');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Le Casse', concept: 'Un braquage', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Dramatique', nb_episodes: 5,
  bible: { premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R', arc: [{ episode: 1 }], duree_episode: '45 à 60 secondes', format: 'Face caméra' },
  episodes: [
    { num: 1, titre: 'Le premier coup d\'œil', script: SCRIPT_EN_PARAGRAPHES, voix_off_propre: SCRIPT_EN_PARAGRAPHES },
    { num: 2, titre: 'Épisode sans coupure (rétro-compat)', script: 'Un texte compact sans aucun saut de ligne, généré avant ce correctif.', voix_off_propre: 'Un texte compact sans aucun saut de ligne, généré avant ce correctif.' }
  ],
  episode_courant: 2, statut: 'en_cours'
};

test('Série : le script d\'un épisode s\'affiche en blocs séparés par scène/idée, comme le mode Script', async () => {
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

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIEBLOCS1', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => ouvrirSerie('serie-test'));
    await page.waitForTimeout(200);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const episodes = document.querySelectorAll('.serie-episode');
      const lireBlocs = (episode) => Array.from(episode.querySelectorAll('.script-block .script-row .script-text')).map(el => el.textContent.trim());
      return {
        nbEpisodes: episodes.length,
        blocsEp1: lireBlocs(episodes[0]),
        blocsEp2: lireBlocs(episodes[1]),
        // Le script ne doit plus jamais atterrir dans l'ancien conteneur compact.
        aUnAncienBloc: !!episodes[0].querySelector('.serie-episode-txt')
      };
    });

    assert.equal(etat.nbEpisodes, 2);
    assert.equal(etat.blocsEp1.length, 3, 'l\'épisode 1 (3 paragraphes dans le texte source) doit produire 3 blocs distincts : ' + JSON.stringify(etat.blocsEp1));
    assert.match(etat.blocsEp1[0], /22h47/);
    assert.match(etat.blocsEp1[1], /Marcus est le cerveau/);
    assert.match(etat.blocsEp1[2], /poste de sécurité centrale/);
    assert.equal(etat.aUnAncienBloc, false, 'le script ne doit plus être affiché dans l\'ancien conteneur .serie-episode-txt compact');

    // Rétro-compatibilité : un épisode SANS saut de ligne (généré avant ce
    // correctif) doit quand même s'afficher, dans un seul bloc, jamais cassé.
    assert.equal(etat.blocsEp2.length, 1, 'un texte sans saut de ligne doit se replier sur un seul bloc, sans planter');
    assert.match(etat.blocsEp2[0], /texte compact/);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

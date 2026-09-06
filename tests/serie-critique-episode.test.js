// Seconde moitié de l'angle mort du mode Série : il n'avait pas non plus de
// CRITIQUE. Script et Récit ont depuis longtemps un agent indépendant qui
// cherche activement les raisons de décrocher, puis un Réviseur qui corrige
// ce qu'il signale. En Série, le premier jet partait tel quel.
//
// Le test principal du Critique de série n'est PAS celui du mode Script.
// Script demande « pourquoi ferait-on défiler avant la fin de la vidéo ».
// Série doit aussi demander « pourquoi ne reviendrait-on pas voir l'épisode
// suivant », qui est la seule question qui décide de la vie d'une série. Ce
// test verrouille cette différence, la révision qui suit, et le fait qu'un
// épisode jugé bon ne paie pas d'appel de révision pour rien.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Le Casse', concept: 'Un braquage', niche: 'Business & Entrepreneuriat',
  style: 'sobre et tendu', genre: 'Dramatique', nb_episodes: 5,
  bible: {
    premisse: 'P', univers: 'U', ton: 'sobre et tendu', regle_recurrente: 'une porte qui claque à la fin',
    arc: [{ episode: 1, fonction: 'ouvrir', tension_finale: 'qui a ouvert le coffre' }],
    duree_episode: '45 à 60 secondes', format: 'Faceless'
  },
  episodes: [], episode_courant: 0, statut: 'en_cours'
};

// 10 phrases de 13 mots = 130 mots parlés, soit pile dans la cible de
// "45 à 60 secondes" (113-150). C'est délibéré : si le texte sortait de la
// cible, le contrôle de durée se déclencherait et remplacerait le texte, ce
// qui brouillerait complètement ce que ce test mesure.
const corps = (etiquette) => Array.from({ length: 10 },
  (_, i) => `${etiquette} phrase ${i} de la voix off, écrite pour compter dans le total.`).join(' ');
const EP_INITIAL = { titre: 'Épisode 1', script: corps('Initiale'), voix_off_propre: corps('Initiale'), directives: 'Plans serrés.' };
const EP_REVISE = { script: corps('Révisée'), voix_off_propre: corps('Révisée') };

// Chaque appel du mode a son propre budget de tokens, ce qui les rend
// distinguables ici : écriture 3000, critique 2000, révision 3200,
// durée 2500, juge 1400.
async function jouerEpisode(page, { critique }) {
  const vus = { ecriture: 0, critique: 0, revision: 0, duree: 0, juge: 0 };
  const prompts = {};
  let patchFinal = null;

  const gererDataSerie = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.searchParams.get('resource') === 'series') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: SERIE_FAKE }) });
    }
    if (req.method() === 'POST') {
      try {
        const body = JSON.parse(req.postData());
        if (body.action === 'update' && body.patch && body.patch.episodes) patchFinal = body.patch;
      } catch (e) { /* ignore */ }
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
    const txt = String(body.prompt || body.messages && JSON.stringify(body.messages) || '');
    const rendre = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(o) }] }) });
    if (body.max_tokens === 3000) { vus.ecriture++; prompts.ecriture = txt; return rendre(EP_INITIAL); }
    if (body.max_tokens === 2000) { vus.critique++; prompts.critique = txt; return rendre(critique); }
    if (body.max_tokens === 3200) { vus.revision++; prompts.revision = txt; return rendre(EP_REVISE); }
    if (body.max_tokens === 2500) { vus.duree++; return rendre({ script: corps('Durée'), voix_off_propre: corps('Durée') }); }
    if (body.max_tokens === 1400) { vus.juge++; return rendre({}); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
  });

  await page.evaluate(() => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    serieCouranteId = 'serie-test';
    document.querySelectorAll('#serieEpBtn,#serieEpSpinner,#serieEpTxt,#serieDetailError').forEach(e => e.remove());
    document.body.insertAdjacentHTML('beforeend', `
      <button id="serieEpBtn"></button>
      <span id="serieEpSpinner"></span>
      <div id="serieEpTxt"></div>
      <div id="serieDetailError" style="display:none"></div>`);
  });
  await page.evaluate(() => genererEpisode());
  await page.waitForTimeout(900);
  return { vus, prompts, patchFinal };
}

test('le Critique de série cherche l\'abandon de la SÉRIE, pas seulement de la vidéo', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT1', plan: 'pro' });
    await page.waitForTimeout(200);

    const r = await jouerEpisode(page, { critique: { verdict: 'excellent', raisons_d_abandon: [], faiblesses: [], ton_tenu: true, signature_presente: true } });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(r.vus.critique, 1, 'REGRESSION : aucun Critique n\'est appelé sur un épisode de série');

    const p = r.prompts.critique;
    assert.match(p, /ne reviendrait PAS voir le suivant|épisode suivant/i,
      'REGRESSION : le Critique ne cherche pas les raisons de ne pas revenir à l\'épisode suivant. '
      + 'C\'est la seule question qui décide de la vie d\'une série.');
    assert.match(p, /sobre et tendu/, 'le ton exigé par le créateur doit être vérifié explicitement');
    assert.match(p, /une porte qui claque à la fin/, 'la signature récurrente de la bible aussi');
    assert.match(p, /qui a ouvert le coffre/, 'la tension finale prévue par l\'arc doit être connue du Critique');
    assert.ok(!/Tu écris l'épisode/.test(p),
      'REGRESSION : le Critique reçoit les consignes d\'écriture. Il doit juger un texte fini, pas relire sa propre recette.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un épisode jugé bon ne paie aucun appel de révision', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT2', plan: 'pro' });
    await page.waitForTimeout(200);

    const r = await jouerEpisode(page, { critique: { verdict: 'excellent', raisons_d_abandon: [], faiblesses: [], ton_tenu: true, signature_presente: true } });

    assert.equal(r.vus.revision, 0,
      'REGRESSION : une révision est facturée alors que le Critique n\'a rien trouvé. '
      + 'Chaque appel inutile coûte au créateur et allonge l\'attente.');
    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep && /Initiale/.test(ep.voix_off_propre), 'le texte d\'origine doit être conservé tel quel');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une raison d\'abandon déclenche la révision, et le texte révisé est bien celui qui est gardé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT3', plan: 'pro' });
    await page.waitForTimeout(200);

    const r = await jouerEpisode(page, {
      critique: {
        verdict: 'à améliorer',
        raisons_d_abandon: ['la fin referme tout, il ne reste aucune question'],
        faiblesses: ['le milieu traîne'],
        ton_tenu: false,
        signature_presente: false,
        instructions_revision: 'rouvre une question à la toute fin'
      }
    });

    assert.equal(r.vus.revision, 1, 'REGRESSION : une raison d\'abandon ne déclenche aucune révision');
    const p = r.prompts.revision;
    assert.match(p, /la fin referme tout/, 'le Réviseur doit recevoir la raison d\'abandon à faire disparaître');
    assert.match(p, /le milieu traîne/, 'et les autres faiblesses');
    assert.match(p, /LE TON N'EST PAS TENU/, 'un ton non tenu doit être signalé explicitement au Réviseur');
    assert.match(p, /LA SIGNATURE DE LA SÉRIE MANQUE/, 'une signature absente aussi');
    assert.match(p, /AUCUNE étiquette ni minutage/,
      'le Réviseur doit garder l\'interdiction des étiquettes, sinon il les réintroduit');

    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep, 'l\'épisode doit être enregistré');
    assert.ok(/Révisée|Durée/.test(ep.voix_off_propre),
      'REGRESSION : le texte révisé est jeté et l\'épisode d\'origine est enregistré');
    assert.ok(!/Initiale/.test(ep.voix_off_propre), 'le premier jet ne doit plus être celui qu\'on garde');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un Critique en échec ne casse jamais la livraison de l\'épisode', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT4', plan: 'pro' });
    await page.waitForTimeout(200);

    // Réponse du Critique volontairement illisible.
    const r = await jouerEpisode(page, { critique: 'pas du json du tout' });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep && ep.voix_off_propre,
      'REGRESSION : un Critique muet empêche l\'épisode d\'être livré. Le contrôle qualité ne doit '
      + 'jamais coûter au créateur le texte qu\'il a déjà payé.');
    assert.equal(r.vus.revision, 0, 'sans verdict exploitable, on ne lance pas de révision au hasard');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

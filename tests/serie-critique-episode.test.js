// Seconde moitié de l'angle mort du mode Série : il n'avait pas non plus de
// CRITIQUE. Script et Récit ont depuis longtemps un agent indépendant qui
// cherche activement les raisons de décrocher, puis un Réviseur qui corrige
// ce qu'il signale. En Série, le premier jet partait tel quel.
//
// AUDIT ARCHITECTURAL "Fusion Critique+Reviewer" : contrairement à Script et
// Récit, Série n'a ni boucle de passes ni Second Draft à protéger d'une
// correction prématurée, donc rien n'empêche de diagnostiquer ET corriger
// dans le MÊME appel (voir js/serie.js). Le Critique et le Réviseur de série
// ne sont donc plus deux appels séparés (2000 puis 3200 jetons), mais un
// seul appel fusionné (4000 jetons) qui porte le diagnostic (TEMPS 1) et,
// s'il trouve un problème, la correction (TEMPS 2) dans la même réponse.
//
// Le test principal du Critique de série n'est PAS celui du mode Script.
// Script demande « pourquoi ferait-on défiler avant la fin de la vidéo ».
// Série doit aussi demander « pourquoi ne reviendrait-on pas voir l'épisode
// suivant », qui est la seule question qui décide de la vie d'une série. Ce
// fichier verrouille cette différence, l'application de la correction issue
// du même appel, et le fait qu'un épisode jugé bon ne paie qu'un seul appel.
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

// Chaque appel du mode a son propre budget de tokens, ce qui les rend
// distinguables ici : écriture 3000, critique+révision fusionnés 4000,
// durée 2500, juge 1400.
async function jouerEpisode(page, { fusion }) {
  const vus = { ecriture: 0, fusion: 0, duree: 0, juge: 0 };
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
    const rendre = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: typeof o === 'string' ? o : JSON.stringify(o) }] }) });
    if (body.max_tokens === 3000) { vus.ecriture++; prompts.ecriture = txt; return rendre(EP_INITIAL); }
    if (body.max_tokens === 4000) { vus.fusion++; prompts.fusion = txt; return rendre(fusion); }
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

test('le Critique-Réviseur de série cherche l\'abandon de la SÉRIE, pas seulement de la vidéo', async () => {
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

    const r = await jouerEpisode(page, {
      fusion: { verdict: 'excellent', raisons_d_abandon: [], faiblesses: [], ton_tenu: true, signature_presente: true, script_corrige: '', voix_off_propre_corrige: '' }
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(r.vus.fusion, 1, 'REGRESSION : aucun appel Critique+Réviseur n\'est effectué sur un épisode de série');

    const p = r.prompts.fusion;
    assert.match(p, /ne reviendrait PAS voir le suivant|épisode suivant/i,
      'REGRESSION : le diagnostic ne cherche pas les raisons de ne pas revenir à l\'épisode suivant. '
      + 'C\'est la seule question qui décide de la vie d\'une série.');
    assert.match(p, /sobre et tendu/, 'le ton exigé par le créateur doit être vérifié explicitement');
    assert.match(p, /une porte qui claque à la fin/, 'la signature récurrente de la bible aussi');
    assert.match(p, /qui a ouvert le coffre/, 'la tension finale prévue par l\'arc doit être connue du diagnostic');
    assert.ok(!/Tu écris l'épisode/.test(p),
      'REGRESSION : l\'appel reçoit les consignes d\'écriture. Il doit juger un texte fini, pas relire sa propre recette.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un épisode jugé bon ne paie qu\'un seul appel, et le texte d\'origine est conservé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT2', plan: 'pro' });
    await page.waitForTimeout(200);

    const r = await jouerEpisode(page, {
      fusion: { verdict: 'excellent', raisons_d_abandon: [], faiblesses: [], ton_tenu: true, signature_presente: true, script_corrige: '', voix_off_propre_corrige: '' }
    });

    assert.equal(r.vus.fusion, 1,
      'REGRESSION : plus d\'un appel est facturé pour un seul passage de qualité. '
      + 'Chaque appel inutile coûte au créateur et allonge l\'attente.');
    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep && /Initiale/.test(ep.voix_off_propre), 'le texte d\'origine doit être conservé tel quel');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une raison d\'abandon déclenche une correction dans le même appel, et le texte corrigé est bien celui qui est gardé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT3', plan: 'pro' });
    await page.waitForTimeout(200);

    const r = await jouerEpisode(page, {
      fusion: {
        verdict: 'à améliorer',
        raisons_d_abandon: ['la fin referme tout, il ne reste aucune question'],
        faiblesses: ['le milieu traîne'],
        ton_tenu: false,
        signature_presente: false,
        instructions_revision: 'rouvre une question à la toute fin',
        script_corrige: corps('Révisée'),
        voix_off_propre_corrige: corps('Révisée')
      }
    });

    assert.equal(r.vus.fusion, 1, 'REGRESSION : la correction doit tenir dans le même appel que le diagnostic, jamais un second appel séparé');
    const p = r.prompts.fusion;
    assert.match(p, /AUCUNE étiquette ni minutage/,
      'la consigne de correction doit interdire les étiquettes, sinon un texte corrigé les réintroduit');
    assert.match(p, /ton/i, 'la consigne doit rappeler que le ton doit être tenu');
    assert.match(p, /signature/i, 'la consigne doit rappeler que la signature récurrente doit apparaître');

    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep, 'l\'épisode doit être enregistré');
    assert.ok(/Révisée|Durée/.test(ep.voix_off_propre),
      'REGRESSION : le texte corrigé par l\'appel fusionné est jeté et l\'épisode d\'origine est enregistré');
    assert.ok(!/Initiale/.test(ep.voix_off_propre), 'le premier jet ne doit plus être celui qu\'on garde');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un diagnostic "excellent" mais accompagné (à tort) d\'une correction ne modifie jamais l\'épisode', async () => {
  // Robustesse propre à la fusion (§14 de l'audit, "correction prématurée") :
  // un modèle qui renverrait malgré tout un script_corrige alors que son
  // propre verdict est "excellent" ne doit JAMAIS pouvoir modifier l'épisode.
  // Seul le diagnostic (verdict/raisons_d_abandon/faiblesses/ton_tenu/
  // signature_presente) décide, jamais la simple présence d'un champ de
  // correction.
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIECRIT5', plan: 'pro' });
    await page.waitForTimeout(200);

    const r = await jouerEpisode(page, {
      fusion: {
        verdict: 'excellent', raisons_d_abandon: [], faiblesses: [], ton_tenu: true, signature_presente: true,
        script_corrige: corps('CorrectionNonAutorisee'), voix_off_propre_corrige: corps('CorrectionNonAutorisee')
      }
    });

    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep && /Initiale/.test(ep.voix_off_propre),
      'REGRESSION : une correction non diagnostiquée par le verdict a quand même été appliquée');
    assert.ok(!/CorrectionNonAutorisee/.test(ep.voix_off_propre));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un Critique-Réviseur en échec ne casse jamais la livraison de l\'épisode', async () => {
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

    // Réponse volontairement illisible.
    const r = await jouerEpisode(page, { fusion: 'pas du json du tout' });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    const ep = r.patchFinal && r.patchFinal.episodes && r.patchFinal.episodes[0];
    assert.ok(ep && ep.voix_off_propre,
      'REGRESSION : un appel muet empêche l\'épisode d\'être livré. Le contrôle qualité ne doit '
      + 'jamais coûter au créateur le texte qu\'il a déjà payé.');
    assert.ok(/Initiale/.test(ep.voix_off_propre), 'sans réponse exploitable, le premier jet doit être conservé');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

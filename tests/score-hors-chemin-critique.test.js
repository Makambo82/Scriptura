// Décision produit du propriétaire (4 septembre 2026) : sortir le score du
// chemin critique.
//
// Le juge indépendant est le SEUL appel du pipeline qui ne touche pas un mot du
// contenu, il ne produit que les cinq barres. Il tournait pourtant en DERNIER
// et en bloquant : le créateur attendait une réponse qui n'avait aucune
// influence sur ce qu'il allait lire. Désormais le script (ou le récit) part à
// l'écran dès qu'il est prêt, et le score vient remplir sa carte ensuite.
//
// Ce que ces tests verrouillent, parce que c'est exactement là que ça peut
// casser :
//  - le contenu s'affiche AVANT que le juge ait répondu (le gain de temps est
//    réel, pas théorique) ;
//  - la méthode de calcul est rigoureusement inchangée (mêmes signaux, mêmes
//    citations vérifiées, même score déterministe), seul son moment change ;
//  - le score arrive bien dans la carte déjà affichée, sans re-rendu du reste ;
//  - il est rattaché à la ligne d'historique, sinon une réouverture perdrait le
//    score puisque la ligne est enregistrée avant la réponse du juge ;
//  - le drapeau d'attente n'est JAMAIS persisté : une réouverture ne doit pas
//    rester bloquée sur un "calcul en cours" que plus rien n'alimente ;
//  - un score en retard n'écrase jamais un autre contenu affiché entre-temps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const DELAI_JUGE_MS = 1500; // délai artificiel, franchement supérieur au reste

const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };

const SCRIPT_OK = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [
    { temps: '0-2 sec', texte: 'Behanzin a refusé de disparaître.', visuel: 'Gros plan' },
    { temps: '2-25 sec', texte: "Behanzin, roi du Dahomey, a combattu la France tant qu'il a pu. Il savait qu'il allait perdre, mais il n'a pas plié. Il s'est rendu en négociant, pas en capitulant. Il avait un plan précis : sauver son peuple et préserver l'honneur de son royaume. Les Français croyaient avoir vaincu un roi. Ils venaient de créer une légende.", visuel: 'Plan poitrine' },
    { temps: '25-49 sec', texte: "Ce bateau ? Un piège. On l'envoyait en Martinique, à 8000 km de là. Douze ans d'exil forcé, seul, sans négociation possible, sans retour envisagé. Pendant ce temps, la France dévorait son empire, ses terres, ses richesses culturelles. Behanzin ne reverrait jamais son royaume. Mais il refusait de se soumettre mentalement. Chaque jour d'exil était un acte de résistance.", visuel: 'Plan large' },
    { temps: '49-56 sec', texte: "La France pensait l'effacer de l'histoire. Quatre siècles plus tard, on ne parle que de Behanzin.", visuel: 'Regard caméra' }
  ],
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};

// Toutes les citations existent mot pour mot dans SCRIPT_OK : sans ça les
// signaux retomberaient à false et le score ne prouverait rien.
const JUGEMENT_VALIDE = {
  hook_fort: { present: true, preuve: 'Behanzin a refusé de disparaître.' },
  pattern_interrupt: { present: true, preuve: 'Behanzin a refusé de disparaître.' },
  boucle_ouverte: { present: true, preuve_ouverture: 'Behanzin a refusé de disparaître.', preuve_cloture: 'on ne parle que de Behanzin' },
  details_concrets: { present: true, preuve: 'Douze ans d\'exil forcé' },
  emotion_forte: { present: true, preuve: 'Behanzin ne reverrait jamais son royaume' },
  cta_clair: { present: true, preuve: 'on ne parle que de Behanzin' },
  originalite: { present: true, preuve: 'Ils venaient de créer une légende.' },
  promesse_tenue: { present: true, preuve_ouverture: 'Behanzin a refusé de disparaître.', preuve_cloture: 'Quatre siècles plus tard' }
};

const estAppelJugeScript = (body) => body.max_tokens === 1200 && /critique EXT/.test(JSON.stringify(body.messages || []));

async function preparerPage(page, { delaiJuge = DELAI_JUGE_MS, jugement = JUGEMENT_VALIDE } = {}) {
  const vu = { jugeAppele: false, patchs: [] };
  await poserMocksReseau(page);
  // On observe ce qui part vers /api/data sans changer son traitement.
  await page.route('**/api/data**', async (route) => {
    try {
      const b = JSON.parse(route.request().postData() || '{}');
      if (b && b.resource === 'generations') vu.patchs.push({ action: b.action, champs: b.champs || null, contenu: b.contenu || null });
    } catch (e) { /* corps non JSON */ }
    return route.fallback();
  });
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (estAppelJugeScript(body)) {
      vu.jugeAppele = true;
      await new Promise(r => setTimeout(r, delaiJuge));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(jugement) }] }) });
    }
    if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
    if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_OK) }] }) });
    if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
  });
  return vu;
}

async function lancerScript(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'HORSCRIT' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('niche').value = 'Histoire';
    document.getElementById('sujet').value = 'Behanzin';
    ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
    state.depart = 'un sujet précis';
    selectedDuree = '1 minute';
  });
  await page.evaluate(() => generate());
}

const etatCarte = () => {
  const carte = document.querySelector('#outputList .score-card');
  return {
    presente: !!carte,
    texte: carte ? carte.innerText : '',
    barresChiffrees: document.querySelectorAll('#outputList .metric-fill[data-width]').length,
    scriptAffiche: document.querySelectorAll('#outputList .out-section').length > 0,
    scriptEnMemoire: (typeof currentScript !== 'undefined' && currentScript) ? currentScript.length : 0
  };
};

test('Script : le script s\'affiche AVANT la réponse du juge, le score arrive ensuite', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const vu = await preparerPage(page);
    await lancerScript(page, baseUrl);

    // Le contenu est là dès que le pipeline d'écriture a fini, sans attendre
    // le juge (qui met DELAI_JUGE_MS à répondre).
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
    const pendant = await page.evaluate(etatCarte);

    assert.equal(pendant.scriptEnMemoire, 4, 'le script complet est livré');
    assert.ok(pendant.scriptAffiche, 'et bien rendu à l\'écran');
    assert.ok(pendant.presente, 'la carte de score est déjà là, à sa place définitive');
    assert.match(pendant.texte, /calcul en cours/i, 'annoncée comme en cours, jamais avec un chiffre provisoire');
    assert.equal(pendant.barresChiffrees, 0,
      'REGRESSION : aucune barre chiffrée tant que le juge n\'a pas répondu, un score jamais mesuré ne s\'affiche pas');

    // Puis le score arrive et remplit la carte déjà affichée.
    await page.waitForFunction(() => document.querySelectorAll('#outputList .metric-fill[data-width]').length === 5, null, { timeout: 25000 });
    const apres = await page.evaluate(etatCarte);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.jugeAppele, 'le juge a bien tourné, il n\'a pas été supprimé');
    assert.ok(!/calcul en cours/i.test(apres.texte), 'la mention d\'attente disparaît');
    // Méthode de calcul inchangée : jugement complet et cité mot pour mot,
    // donc les dimensions purement IA sont à 100, jamais au 50 du repli.
    assert.match(apres.texte, /100\s*\/\s*100/, 'le score reste calculé exactement comme avant');
    assert.ok(apres.scriptAffiche, 'et le reste du résultat n\'a pas été re-rendu par-dessus');
    assert.equal(apres.scriptEnMemoire, 4, 'le script en mémoire est intact');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : le score est rattaché à l\'historique, et l\'attente n\'est jamais enregistrée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const vu = await preparerPage(page, { delaiJuge: 400 });
    await lancerScript(page, baseUrl);
    await page.waitForFunction(() => document.querySelectorAll('#outputList .metric-fill[data-width]').length === 5, null, { timeout: 25000 });
    await page.waitForTimeout(600); // laisse partir le patch d'historique

    assert.deepEqual(erreursJs, []);

    const save = vu.patchs.find(p => p.action === 'save');
    assert.ok(save, 'la génération doit être enregistrée');
    assert.ok(!('scoreEnCours' in (save.contenu || {})),
      'REGRESSION : le drapeau d\'attente ne doit JAMAIS être persisté, sinon une réouverture reste bloquée sur "calcul en cours"');

    const patch = vu.patchs.find(p => p.action === 'patch' && p.champs && p.champs.score);
    assert.ok(patch, 'le score doit être rattaché à la ligne, sinon il serait perdu à la réouverture : ' + JSON.stringify(vu.patchs.map(p => p.action)));
    assert.equal(patch.champs.scoreEnCours, false, 'et le drapeau d\'attente explicitement refermé');
    assert.equal(typeof patch.champs.score.viral, 'number');
    assert.equal(patch.champs.evaluationIndisponible, null, 'aucun message d\'indisponibilité quand le juge a répondu');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : un score en retard n\'écrase jamais un autre contenu affiché entre-temps', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparerPage(page, { delaiJuge: 2500 });
    await lancerScript(page, baseUrl);
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });

    // Pendant que le juge réfléchit encore, le créateur rouvre un autre
    // contenu : currentScript pointe alors ailleurs.
    await page.evaluate(() => {
      currentScript = [{ temps: '0-3 sec', texte: 'Un tout autre script, rouvert depuis l\'historique.', visuel: 'V' }];
      renderResults({ score: null, analyse: 'autre', hooks: [{ style: 'x', texte: 'Autre hook' }], script: currentScript, legende: 'L', hashtags: ['#b'] }, 'Autre niche', 'Autre sujet');
    });
    const avant = await page.evaluate(etatCarte);
    assert.ok(!avant.presente, 'ce contenu-là n\'a pas de score, donc pas de carte');

    // On laisse largement le temps au juge de revenir.
    await page.waitForTimeout(3500);
    const apres = await page.evaluate(etatCarte);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(!apres.presente,
      'REGRESSION : le score du script précédent ne doit jamais venir se coller sur le contenu affiché à sa place');
    assert.equal(apres.scriptEnMemoire, 1, 'le contenu rouvert reste intact');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : même comportement, le récit s\'affiche avant le juge et le score suit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const SEGMENTS = Array.from({ length: 10 }, (_, i) => ({
      segment: 'Segment ' + i,
      texte: 'Phrase numéro ' + i + ' avec assez de mots pour peser correctement dans le compte total de ce récit ici.'
    }));
    const RECIT = { titre: 'Titre', ton: 'Dramatique', modele_utilise: 'inconnu', hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })), recit: SEGMENTS, legende: 'L', hashtags: ['#a'] };
    let jugeAppele = false;

    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const texteBody = JSON.stringify(body.messages || []);
      if (body.max_tokens === 400) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ titres: [] }) }] }) });
      if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(RECIT) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      // Juge du récit : budget propre (1400), distinct de la complétion des
      // hooks du récit (1200).
      if (body.max_tokens === 1400 && /critique EXT/.test(texteBody)) {
        jugeAppele = true;
        await new Promise(r => setTimeout(r, DELAI_JUGE_MS));
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ content: [{ text: JSON.stringify({
            accroche_forte: { present: true, preuve: SEGMENTS[0].texte },
            rupture_attente: { present: true, preuve: SEGMENTS[1].texte }
          }) }] })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HORSREC' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('storyInput').value = 'Une histoire vraie à raconter';
      storyFormat = 'court';
      storyDuree = '1 minute';
    });
    await page.evaluate(() => generateStory());
    await page.waitForFunction(() => typeof currentStory !== 'undefined' && currentStory, null, { timeout: 30000 });

    const pendant = await page.evaluate(() => {
      const carte = document.querySelector('#storyOutput .score-card');
      return {
        texte: carte ? carte.innerText : '',
        barresChiffrees: document.querySelectorAll('#storyOutput .metric-fill[data-width]').length,
        segments: (currentStory.recit || []).length
      };
    });
    assert.equal(pendant.segments, 10, 'le récit complet est livré sans attendre le juge');
    assert.match(pendant.texte, /calcul en cours/i);
    assert.equal(pendant.barresChiffrees, 0, 'aucune barre chiffrée avant la réponse du juge');

    await page.waitForFunction(() => document.querySelectorAll('#storyOutput .metric-fill[data-width]').length === 5, null, { timeout: 25000 });
    const apres = await page.evaluate(() => ({
      texte: (document.querySelector('#storyOutput .score-card') || {}).innerText || '',
      segments: (currentStory.recit || []).length
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(jugeAppele, 'le juge du récit a bien tourné');
    assert.ok(!/calcul en cours/i.test(apres.texte), 'la mention d\'attente disparaît');
    assert.equal(apres.segments, 10, 'le récit est intact');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

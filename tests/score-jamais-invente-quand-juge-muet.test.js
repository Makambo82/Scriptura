// Retour terrain du 3 septembre 2026 : un script solide (Behanzin, 139 mots
// pour une cible "1 minute" de 130-155, blocs bien répartis) affiché à
// 50/100 avec QUATRE dimensions à exactement 50. Ce n'était pas une note,
// c'était l'ABSENCE de note.
//
// Mécanique exacte : les 8 signaux "viral / hook / émotion" et une partie de
// "engagement" viennent d'un 2e appel IA indépendant (evaluerScriptGenere).
// Quand il ne répond pas (réseau, ou JSON illisible), il renvoie null, tous
// ses signaux sont ABSENTS, et le crédit neutre de 0,5 par signal absent de
// _genScoreDimension produit mécaniquement 50 partout. Le repli défensif de
// la fonction de score est bon en soi (il évite un faux 0), mais l'appelant
// affichait le résultat comme un score MESURÉ, ce qui contredit frontalement
// le pilier du produit : le score est déterministe et se calcule sur des
// signaux réels, il ne s'invente jamais.
//
// Deux réponses, testées ici. Une SECONDE tentative du juge (l'appel le moins
// cher du pipeline, 1200 tokens : une réponse illisible ne doit pas coûter son
// score au créateur). Et, s'il reste muet, aucun chiffre fabriqué : le score
// n'est pas calculé et l'app le dit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };

// 4 blocs, 139 mots : dans la cible "1 minute" (130-155) et sous le plafond
// par bloc, donc ni correction de durée ni redécoupage ne se déclenchent. Le
// seul appel qui reste en jeu est celui du juge indépendant.
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

// Jugement complet et citable mot pour mot dans le texte ci-dessus : chaque
// signal doit passer la vérification de citation pour compter (voir
// _genValiderCitation), sinon il retombe à false et le score ne prouve rien.
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

// Le juge indépendant du mode Script se reconnaît à son prompt, jamais à son
// seul budget de tokens : la complétion des hooks utilise LE MÊME (1200).
const estAppelJuge = (body) => body.max_tokens === 1200 && /critique EXT/.test(JSON.stringify(body.messages || []));

async function genererScript(page, baseUrl, reponseJuge) {
  const appelsJuge = { n: 0, modeles: [], journal: [] };
  await poserMocksReseau(page);
  // Journal d'erreurs : on observe ce qui part vraiment vers /api/data sans
  // rien changer à son traitement (route.fallback rend la main aux mocks).
  await page.route('**/api/data**', async (route) => {
    try {
      const b = JSON.parse(route.request().postData() || '{}');
      if (b && b.resource === 'erreur') appelsJuge.journal.push({ mode: b.mode, detail: b.detail });
    } catch (e) { /* corps non JSON : rien à observer */ }
    return route.fallback();
  });
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (estAppelJuge(body)) {
      appelsJuge.n++;
      appelsJuge.modeles.push(body.model);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: reponseJuge(appelsJuge.n) }] }) });
    }
    if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
    if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_OK) }] }) });
    if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'JUGE' + Math.round(Math.random() * 1e6), plan: 'creator' });
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
  await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
  await page.waitForTimeout(300);
  return appelsJuge;
}

test('Script : juge indépendant muet deux fois, aucun 50 fabriqué, l\'app le dit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // Réponse illisible : le juge "répond" mais son JSON ne parse pas, cas
    // réellement observé (le modèle rapide bavarde autour du JSON).
    const appels = await genererScript(page, baseUrl, () => 'Voici mon évaluation, mais pas en JSON.');

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appels.n, 2, 'le juge doit être retenté une seconde fois avant de renoncer');
    // Réessayer sur le MÊME modèle retenterait exactement ce qui vient
    // d'échouer : les deux modèles de callAI sont le même (Haiku) et son repli
    // automatique ne s'applique pas au juge.
    assert.notEqual(appels.modeles[1], appels.modeles[0],
      'la seconde tentative doit passer par un modèle réellement différent : ' + appels.modeles.join(' puis '));

    const vu = await page.evaluate(() => {
      const carte = document.querySelector('#outputList .score-card');
      return {
        carte: !!carte,
        texte: carte ? carte.innerText : '',
        barres: document.querySelectorAll('#outputList .metric-fill').length,
        chiffres: carte ? (carte.innerText.match(/\b\d+\s*\/\s*100\b/g) || []) : null
      };
    });

    assert.ok(vu.carte, 'la carte de score reste affichée, pour que le créateur sache que le score existe');
    assert.equal(vu.barres, 0, 'REGRESSION : aucune barre ne doit être dessinée à partir de signaux jamais mesurés');
    assert.deepEqual(vu.chiffres, [], 'aucun score sur 100 ne doit être affiché quand rien n\'a été mesuré');
    assert.match(vu.texte, /non calcul/i, 'le créateur doit lire que le score n\'a pas été calculé');
    assert.match(vu.texte, /n'a pas répondu|n.a pas r.pondu/i, 'et pourquoi');

    // L'échec doit laisser une trace exploitable : sans elle, impossible de
    // savoir après coup pourquoi un créateur s'est retrouvé sans score.
    const entree = appels.journal.find(e => e.mode === 'score-script');
    assert.ok(entree, 'l\'échec du juge doit être journalisé sous son propre mode, jamais sous "script" (ce n\'est pas un échec de génération) : ' + JSON.stringify(appels.journal));
    assert.match(entree.detail, /illisible/, 'le journal doit dire POURQUOI le juge est resté muet : ' + entree.detail);
    assert.match(entree.detail, /2e tentative/, 'et couvrir les deux tentatives');
    assert.ok(!appels.journal.some(e => e.mode === 'script'),
      'le compteur d\'échecs de génération ne doit pas être pollué : le script a bien été livré');

    // Le script, lui, reste complet et intact : un juge muet ne dégrade jamais
    // le contenu livré.
    const script = await page.evaluate(() => currentScript.map(b => b.texte));
    assert.deepEqual(script, SCRIPT_OK.script.map(b => b.texte), 'le script livré est intact, mot pour mot');
    const motsLivres = script.join(' ').split(/\s+/).filter(Boolean).length;
    assert.ok(motsLivres >= 130 && motsLivres <= 155, 'et toujours dans la cible "1 minute" : ' + motsLivres + ' mots');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : une réponse illisible du juge est rattrapée par la seconde tentative, le score est bien mesuré', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const appels = await genererScript(page, baseUrl, (n) => n === 1 ? 'pas du JSON du tout' : JSON.stringify(JUGEMENT_VALIDE));

    assert.deepEqual(erreursJs, []);
    assert.equal(appels.n, 2, 'la première réponse illisible doit déclencher exactement une seconde tentative');
    assert.ok(!appels.journal.some(e => String(e.mode).startsWith('score-')),
      'rien à journaliser quand le juge a fini par répondre : ' + JSON.stringify(appels.journal));

    const vu = await page.evaluate(() => {
      const carte = document.querySelector('#outputList .score-card');
      return { texte: carte ? carte.innerText : '', barres: document.querySelectorAll('#outputList .metric-fill').length };
    });
    assert.equal(vu.barres, 5, 'les 5 dimensions doivent être affichées normalement');
    assert.ok(!/non calcul/i.test(vu.texte), 'aucun message d\'indisponibilité quand le juge a fini par répondre');
    // Signaux tous vrais et citations toutes valides : les dimensions
    // purement IA (viral, hook, émotion) sont à 100, jamais au 50 du repli.
    assert.match(vu.texte, /100\s*\/\s*100/, 'un jugement complet et cité doit produire de vraies notes, pas un 50 neutre');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : même garde-fou, aucun score inventé quand le juge ne répond pas', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const RECIT = {
      titre: 'Titre', ton: 'Dramatique', modele_utilise: 'inconnu',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      recit: Array.from({ length: 10 }, (_, i) => ({ segment: 'Segment ' + i, texte: 'Phrase numéro ' + i + ' avec assez de mots pour peser correctement dans le compte total de ce récit de test ici.' })),
      legende: 'L', hashtags: ['#a']
    };
    let appelsJuge = 0;
    const modelesJuge = [];
    const journal = [];

    await poserMocksReseau(page);
    await page.route('**/api/data**', async (route) => {
      try {
        const b = JSON.parse(route.request().postData() || '{}');
        if (b && b.resource === 'erreur') journal.push({ mode: b.mode, detail: b.detail });
      } catch (e) { /* corps non JSON */ }
      return route.fallback();
    });
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const texteBody = JSON.stringify(body.messages || []);
      if (body.max_tokens === 400) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ titres: [] }) }] }) });
      if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(RECIT) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      // Le juge du récit a son propre budget (1400), distinct de celui du
      // mode Script (1200) et de la complétion des hooks du récit (1200).
      if (body.max_tokens === 1400 && /critique EXT/.test(texteBody)) {
        appelsJuge++;
        modelesJuge.push(body.model);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'réponse illisible' }] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'JUGEREC' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('storyInput').value = 'Une histoire vraie à raconter';
      storyFormat = 'court';
      storyDuree = '1 minute';
    });
    await page.evaluate(() => generateStory());
    await page.waitForFunction(() => typeof currentStory !== 'undefined' && currentStory, null, { timeout: 30000 });
    await page.waitForTimeout(400);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appelsJuge, 2, 'le juge du récit doit lui aussi être retenté une fois');
    assert.notEqual(modelesJuge[1], modelesJuge[0], 'et sur un modèle réellement différent : ' + modelesJuge.join(' puis '));
    const entreeRecit = journal.find(e => e.mode === 'score-story');
    assert.ok(entreeRecit, 'l\'échec doit être journalisé sous son propre mode : ' + JSON.stringify(journal));
    assert.match(entreeRecit.detail, /illisible/);

    const vu = await page.evaluate(() => {
      const carte = document.querySelector('#storyOutput .score-card');
      return {
        carte: !!carte,
        texte: carte ? carte.innerText : '',
        barres: document.querySelectorAll('#storyOutput .metric-fill').length
      };
    });
    assert.ok(vu.carte, 'la carte de score reste affichée');
    assert.equal(vu.barres, 0, 'REGRESSION : aucune barre à partir de signaux jamais mesurés');
    assert.match(vu.texte, /non calcul/i);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour terrain du 4 septembre 2026, sur un script hors cible affiché SANS
// aucun avertissement : quand le juge indépendant est muet, la carte de score
// n'affichait plus que son message d'indisponibilité et laissait tomber
// l'avertissement de DURÉE, pourtant présent dans les deux autres états de la
// carte. Or cet avertissement est calculé en CODE, il ne dépend pas du juge,
// et c'est justement quand le score manque qu'il devient le seul repère
// objectif du créateur. Un script deux fois trop court passait donc totalement
// inaperçu dès que le juge échouait, exactement le cumul le plus pénalisant.
test('Script : juge muet ET script hors cible, les DEUX informations restent affichées', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DEUXINFOS' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    const rendu = await page.evaluate(() => {
      const d = {
        score: null,
        evaluationIndisponible: 'Score non calculé : l\'évaluation indépendante n\'a pas répondu cette fois.',
        avertissementDuree: 'Ce script fait 190 mots, plus court que les 270-310 mots visés pour 2 minutes.'
      };
      const conteneur = document.createElement('div');
      conteneur.innerHTML = carteScoreScriptHTML(d);
      const conteneurRecit = document.createElement('div');
      conteneurRecit.innerHTML = carteScoreRecitHTML(d);
      return { script: conteneur.textContent, recit: conteneurRecit.textContent };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(rendu.script, /n'a pas répondu/, 'le créateur doit toujours savoir que le score manque');
    assert.match(rendu.script, /190 mots/,
      'REGRESSION : l\'avertissement de durée est calculé en code, il ne dépend pas du juge et doit rester visible');
    assert.match(rendu.script, /270-310 mots visés pour 2 minutes/, 'avec la cible réellement visée');
    // Le mode Récit avait rigoureusement le même trou.
    assert.match(rendu.recit, /n'a pas répondu/);
    assert.match(rendu.recit, /190 mots/, 'REGRESSION : même trou côté Récit');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

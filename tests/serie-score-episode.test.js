// Angle mort signalé au propriétaire, puis choisi par lui : le mode Série
// était le SEUL à n'avoir ni juge ni score. Un épisode sortait sans qu'aucune
// mesure ne dise s'il tenait debout, alors qu'une série vit entièrement sur
// l'envie de revenir à l'épisode suivant, donc exactement sur l'accroche et
// la rétention.
//
// Ce test verrouille la même doctrine que les autres modes, sans exception :
// c'est le CODE qui calcule, l'IA ne fait que cocher des cases sur un texte
// fini, chaque case exige une citation vérifiée mot pour mot, et mêmes
// données donnent toujours le même score. Il verrouille aussi la dimension
// propre à la série, « Envie de voir la suite » : un bon épisode isolé qui ne
// donne aucune envie de voir le suivant est un échec de série, alors que ce
// serait un succès en mode Script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

const SRC_SERIE = fs.readFileSync(path.join(__dirname, '..', 'js', 'serie.js'), 'utf8');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  return page;
}

const TOUS_VRAIS = {
  accroche_forte: true, pattern_interrupt: true, originalite: true,
  tension_maintenue: true, details_concrets: true, emotion_forte: true,
  cliffhanger_final: true, promesse_episode: true, ton_respecte: true,
  regle_recurrente_tenue: true, rythme_soutenu: true
};

test('le score de l\'épisode est calculé en CODE, et il est déterministe', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate((tousVrais) => {
      const wt = { min: 113, max: 150 };
      const tousFaux = {};
      Object.keys(tousVrais).forEach(k => { tousFaux[k] = false; });
      const a = scorerEpisodeSerie(tousVrais, 130, wt, 8);
      const b = scorerEpisodeSerie(tousVrais, 130, wt, 8);
      return {
        max: a,
        repete: b,
        min: scorerEpisodeSerie(tousFaux, 130, wt, 8),
        // Un chiffre fourni par l'IA ne doit avoir AUCUNE prise sur le score.
        avecChiffreIA: scorerEpisodeSerie(Object.assign({ score: 12, note: 3 }, tousVrais), 130, wt, 8)
      };
    }, TOUS_VRAIS);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(r.repete, r.max, 'REGRESSION : deux appels identiques donnent deux scores différents');
    assert.deepEqual(r.avecChiffreIA, r.max,
      'REGRESSION : un chiffre glissé par l\'IA influence le score. Le code seul doit noter.');
    Object.keys(r.max).forEach(dim => {
      assert.equal(r.max[dim], 100, 'tous les signaux vrais doivent donner 100 sur ' + dim);
      assert.ok(r.min[dim] <= 40, 'tous les signaux faux doivent effondrer ' + dim + ' (lu : ' + r.min[dim] + ')');
    });
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la dimension « suite » existe et mesure vraiment l\'envie de voir l\'épisode suivant', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate((tousVrais) => {
      const wt = { min: 113, max: 150 };
      // Un épisode excellent EN SOI, mais qui referme tout à la fin : c'est
      // un succès en mode Script, un échec en mode Série.
      const refermeTout = Object.assign({}, tousVrais, { cliffhanger_final: false, promesse_episode: false });
      const complet = scorerEpisodeSerie(tousVrais, 130, wt, 8);
      const sansSuite = scorerEpisodeSerie(refermeTout, 130, wt, 8);
      return { complet: complet, sansSuite: sansSuite, dimensions: Object.keys(complet) };
    }, TOUS_VRAIS);

    assert.ok(r.dimensions.includes('suite'), 'la dimension propre à la série doit exister');
    assert.equal(r.sansSuite.suite, 0,
      'REGRESSION : un épisode qui referme tout garde une note de « suite » (' + r.sansSuite.suite + ')');
    assert.equal(r.sansSuite.hook, r.complet.hook,
      'refermer la fin ne doit rien changer à l\'accroche : les dimensions doivent rester indépendantes');
    assert.equal(r.sansSuite.emotion, r.complet.emotion, 'ni à l\'émotion');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('accroche et durée réelles pèsent sur la note, pas seulement les cases cochées', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate((tousVrais) => {
      const wt = { min: 113, max: 150 };
      const accrocheCourte = 'Il est revenu.';
      const accrocheLongue = 'Ce que je vais te raconter dans cet épisode va sans doute te surprendre énormément parce que personne ne le dit.';
      return {
        motsCourte: motsAccrocheSerie(accrocheCourte + ' La suite plus tard.'),
        motsLongue: motsAccrocheSerie(accrocheLongue),
        hookCourt: scorerEpisodeSerie(tousVrais, 130, wt, motsAccrocheSerie(accrocheCourte)).hook,
        hookLong: scorerEpisodeSerie(tousVrais, 130, wt, motsAccrocheSerie(accrocheLongue)).hook,
        sansMesure: scorerEpisodeSerie(tousVrais, 130, wt).hook,
        retentionDansCible: scorerEpisodeSerie(tousVrais, 130, wt, 8).retention,
        retentionHorsCible: scorerEpisodeSerie(tousVrais, 40, wt, 8).retention,
        rythmeCourt: _serieDetecterRythmeSoutenu('Il revient. Elle recule. Tout bascule.'),
        rythmeLong: _serieDetecterRythmeSoutenu(
          'Il revient dans la pièce alors que tout le monde pensait sincèrement qu il avait quitté la ville depuis plusieurs semaines sans laisser la moindre adresse.')
      };
    }, TOUS_VRAIS);

    assert.equal(r.motsCourte, 3, 'l\'accroche d\'un épisode, c\'est sa PREMIÈRE PHRASE, pas tout le texte');
    assert.ok(r.motsLongue > 12, 'l\'accroche longue doit bien être mesurée au-dessus du plafond');
    assert.ok(r.hookLong < r.hookCourt,
      'REGRESSION : une accroche de ' + r.motsLongue + ' mots est notée comme une accroche de 3 mots');
    assert.equal(r.sansMesure, 100,
      'sans mesure (ancien épisode rouvert), la note reste celle des seuls signaux, on n\'invente pas');
    assert.ok(r.retentionHorsCible < r.retentionDansCible,
      'REGRESSION : un épisode très hors durée garde la même rétention qu\'un épisode dans la cible');
    assert.equal(r.rythmeCourt, true, 'des phrases courtes tiennent le rythme');
    assert.equal(r.rythmeLong, false, 'une phrase interminable ne le tient pas');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le juge est indépendant : une citation introuvable invalide le signal', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(async () => {
      const texte = 'Il est revenu. Personne ne l\'avait vu depuis trois ans. Ce soir, il frappe à la porte.';
      // Juge simulé : il coche TOUT, mais ne cite correctement que deux
      // signaux. Le reste doit tomber à faux malgré "present":true.
      const faux = { present: true, preuve: 'une phrase que le texte ne contient absolument pas' };
      const vrai = { present: true, preuve: 'Il est revenu.' };
      window.callAI = async () => JSON.stringify({
        accroche_forte: vrai,
        pattern_interrupt: faux,
        originalite: faux,
        tension_maintenue: { present: true, preuve_ouverture: 'Il est revenu.', preuve_cloture: 'il frappe à la porte' },
        details_concrets: faux,
        emotion_forte: faux,
        cliffhanger_final: faux,
        promesse_episode: faux,
        ton_respecte: faux,
        regle_recurrente_tenue: faux
      });
      const signaux = await evaluerEpisodeSerie(texte, { ton: 'tendu', regleRecurrente: 'une porte à la fin' });

      // Et l'ORDRE compte : une "clôture" placée avant l'"ouverture" n'est pas
      // une tension qui tient dans la durée.
      window.callAI = async () => JSON.stringify({
        accroche_forte: vrai, pattern_interrupt: vrai, originalite: vrai,
        tension_maintenue: { present: true, preuve_ouverture: 'il frappe à la porte', preuve_cloture: 'Il est revenu.' },
        details_concrets: vrai, emotion_forte: vrai, cliffhanger_final: vrai,
        promesse_episode: vrai, ton_respecte: vrai, regle_recurrente_tenue: vrai
      });
      const ordreInverse = await evaluerEpisodeSerie(texte, {});
      return { signaux: signaux, tensionOrdreInverse: ordreInverse && ordreInverse.tension_maintenue };
    });

    assert.ok(r.signaux, 'le juge doit renvoyer des signaux');
    assert.equal(r.signaux.accroche_forte, true, 'une citation exacte valide le signal');
    assert.equal(r.signaux.tension_maintenue, true, 'deux citations exactes et dans l\'ordre valident le signal');
    assert.equal(r.signaux.originalite, false,
      'REGRESSION : une citation introuvable dans le texte laisse le signal à vrai');
    assert.equal(r.signaux.cliffhanger_final, false, 'même règle pour tous les signaux');
    assert.equal(r.tensionOrdreInverse, false,
      'REGRESSION : une tension dont la « suite » précède l\'ouverture est acceptée');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le score voyage avec l\'épisode, il n\'est jamais recalculé à la réouverture', () => {
  // Persistance : sans ces deux points, le score disparaîtrait à la
  // réouverture de la série, ou pire, serait recalculé et changerait tout
  // seul d'une consultation à l'autre.
  assert.match(SRC_SERIE, /const episodeFinal = \{[\s\S]*?score: ep\.score \|\| null/,
    'REGRESSION : le score n\'est plus persisté avec l\'épisode');
  assert.match(SRC_SERIE, /\$\{carteScoreEpisodeSerieHTML\(ep\)\}/,
    'REGRESSION : la carte de score n\'est plus affichée sous l\'épisode');
  const debutAffichage = SRC_SERIE.indexOf('async function ouvrirSerie');
  const finAffichage = SRC_SERIE.indexOf('async function genererStoryboardEpisode');
  assert.ok(debutAffichage > 0 && finAffichage > debutAffichage, 'les deux repères doivent exister dans js/serie.js');
  const codeAffichage = SRC_SERIE.slice(debutAffichage, finAffichage);
  assert.ok(!/scorerEpisodeSerie\(|evaluerEpisodeSerie\(/.test(codeAffichage),
    'REGRESSION : le score est calculé à l\'AFFICHAGE de la série. Il changerait d\'une ouverture à '
    + 'l\'autre, et chaque consultation coûterait un appel IA. Il doit être mesuré une fois, à la '
    + 'génération, puis seulement relu.');
});

test('juge muet : aucun chiffre inventé, et on le dit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(async () => {
      window.callAI = async () => { throw new Error('juge indisponible'); };
      const muet = await evaluerEpisodeSerie('Un texte quelconque.', {});
      window.callAI = async () => 'ceci n\'est pas du JSON';
      const illisible = await evaluerEpisodeSerie('Un texte quelconque.', {});
      const carte = carteScoreEpisodeSerieHTML({ score: null, evaluationIndisponible: 'Score non calculé : test.' });
      return { muet: muet, illisible: illisible, carte: carte };
    });

    assert.equal(r.muet, null, 'un juge en échec ne doit produire AUCUN signal');
    assert.equal(r.illisible, null, 'une réponse illisible non plus');
    assert.match(r.carte, /Score non calculé/,
      'REGRESSION : quand le score manque, la carte doit le dire plutôt qu\'afficher une note approximative');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

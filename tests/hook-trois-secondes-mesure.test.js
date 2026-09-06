// Le hook et la rétention font la force d'un script. Le moteur était déjà
// bâti là-dessus (stratégie de hook et de rétention séparées dans le brief,
// 5 hooks testés contre une liste de clichés, un Critique dont le test
// principal est « trouve toutes les raisons de faire défiler avant la fin »,
// et deux dimensions de score sur cinq consacrées au hook et à la rétention).
//
// MAIS il restait un trou, trouvé en relisant le pipeline : la règle des
// 3 SECONDES DE HOOK n'existait QUE dans les prompts. On demandait au modèle
// de compter ses propres mots, or compter des mots est précisément ce qu'un
// modèle de langage fait mal, et rien ne vérifiait derrière. Le TOTAL du
// script, lui, avait sa boucle de correction en code depuis longtemps. Le
// hook, c'est-à-dire la partie qui décide si la vidéo est regardée, était la
// seule promesse de durée laissée à la parole de l'IA.
//
// Ce test verrouille la mesure : le découpage réel du premier bloc, la
// préservation stricte des mots (le score et l'avertissement de durée en
// dépendent), et le fait qu'un hook trop long coûte des points.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  return page;
}

test('un hook trop long est recoupé à la frontière de phrase, sans toucher un mot', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      // 8 mots, puis 17 : le bloc entier fait 25 mots, très au-dessus des
      // 3 secondes, mais sa première phrase est un vrai hook.
      const script = [
        { temps: '0-3 sec', texte: 'Personne ne te dira jamais cette vérité. Et pourtant, elle explique pourquoi ton compte stagne depuis six mois entiers alors que tu publies tous les jours.', visuel: 'Gros plan visage' },
        { temps: '3-20 sec', texte: 'Voici ce qui se passe vraiment.', visuel: 'Plan large' }
      ];
      const motsAvant = script.map(s => s.texte).join(' ').split(/\s+/).filter(Boolean).length;
      const sortie = degagerHookTropLong(script, 'Change de plan ici');
      const motsApres = sortie.map(s => s.texte).join(' ').split(/\s+/).filter(Boolean).length;
      return {
        plafond: HOOK_MOTS_MAX,
        nbBlocs: sortie.length,
        hook: sortie[0].texte,
        motsHook: motsDuHook(sortie),
        deuxieme: sortie[1].texte,
        visuelDeuxieme: sortie[1].visuel,
        motsAvant: motsAvant,
        motsApres: motsApres,
        derniereIntacte: sortie[sortie.length - 1].texte
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(r.nbBlocs, 3, 'le bloc trop long doit devenir deux blocs, les autres intacts');
    assert.ok(r.motsHook <= r.plafond,
      'REGRESSION : le hook fait encore ' + r.motsHook + ' mots (plafond ' + r.plafond + ')');
    assert.equal(r.hook, 'Personne ne te dira jamais cette vérité.', 'le hook garde sa première phrase entière');
    assert.equal(r.motsApres, r.motsAvant,
      'REGRESSION : le découpage a changé le nombre de mots (' + r.motsAvant + ' → ' + r.motsApres + '). '
      + 'Le compte de mots nourrit le score ET l\'avertissement de durée, il doit rester exact.');
    assert.ok(r.deuxieme.startsWith('Et pourtant'), 'le reste part dans le bloc suivant, sans être réécrit');
    assert.match(r.visuelDeuxieme, /Change de plan ici/, 'le nouveau bloc reçoit une consigne de plan');
    assert.equal(r.derniereIntacte, 'Voici ce qui se passe vraiment.', 'les blocs suivants ne bougent pas');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un hook déjà court n\'est jamais touché', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      const script = [
        { temps: '0-3 sec', texte: 'Ton compte stagne pour une seule raison.', visuel: 'A' },
        { temps: '3-20 sec', texte: 'Et elle est simple.', visuel: 'B' }
      ];
      const sortie = degagerHookTropLong(script, 'Change de plan ici');
      return { nb: sortie.length, hook: sortie[0].texte, mots: motsDuHook(sortie) };
    });
    assert.equal(r.nb, 2, 'REGRESSION : un hook conforme est découpé pour rien');
    assert.equal(r.hook, 'Ton compte stagne pour une seule raison.');
    assert.ok(r.mots <= 12);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une phrase unique interminable n\'est pas mutilée, mais elle coûte des points', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      const longue = 'Ce que je vais te raconter maintenant va sans doute te surprendre parce que personne dans ta niche ne le dit jamais vraiment';
      const script = [{ temps: '0-3 sec', texte: longue, visuel: 'A' }];
      const sortie = degagerHookTropLong(script, 'Change de plan ici');
      const wt = { min: 100, max: 150 };
      const tousVrais = {
        hook_fort: true, pattern_interrupt: true, boucle_ouverte: true, deuxieme_personne: true,
        rythme_soutenu: true, details_concrets: true, emotion_forte: true, cta_clair: true,
        originalite: true, promesse_tenue: true
      };
      return {
        intacte: sortie.length === 1 && sortie[0].texte === longue,
        motsHook: motsDuHook(sortie),
        hookCourt: scorerScriptGenere(tousVrais, 125, wt, 8).hook,
        hookLong: scorerScriptGenere(tousVrais, 125, wt, motsDuHook(sortie)).hook,
        sansMesure: scorerScriptGenere(tousVrais, 125, wt).hook,
        // Deux appels identiques doivent donner le même chiffre : pilier du
        // score déterministe (voir CLAUDE.md).
        repete: scorerScriptGenere(tousVrais, 125, wt, 22).hook === scorerScriptGenere(tousVrais, 125, wt, 22).hook
      };
    });

    assert.equal(r.intacte, true,
      'REGRESSION : une phrase unique est coupée en plein milieu. Mieux vaut la laisser et le dire.');
    assert.ok(r.hookLong < r.hookCourt,
      'REGRESSION : un hook de ' + r.motsHook + ' mots est noté comme un hook de 8 mots ('
      + r.hookLong + ' contre ' + r.hookCourt + '). La longueur doit peser sur la note.');
    assert.equal(r.sansMesure, 100,
      'sans mesure de longueur (ancien script rouvert), la note reste celle des seuls signaux');
    assert.equal(r.repete, true, 'REGRESSION : le score du hook n\'est pas déterministe');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

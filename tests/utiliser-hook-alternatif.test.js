// Demande du propriétaire : « on ajoute sous chaque hook alternatif un bouton
// "utiliser ce hook". Si le hook du script ne convient pas et qu'un hook des
// alternatives lui convient, l'app remplace automatiquement celui du script ».
//
// L'app proposait cinq accroches et laissait le créateur les recopier à la
// main dans son script, à la souris, en espérant ne pas se tromper de bloc.
//
// C'EST UN ÉCHANGE, PAS UN REMPLACEMENT, et c'est ce qui rend le geste sans
// risque : l'ancienne accroche prend la place de celle qu'on vient d'utiliser
// dans la liste. Rien n'est perdu, la liste garde ses propositions, et un
// second appui remet exactement l'état précédent. Aucun bouton « annuler » à
// inventer, aucun état caché à mémoriser.
//
// CE QUE CE FICHIER VERROUILLE, ce sont les trois choses qui suivent le texte
// sans qu'on les voie : le minutage des blocs, le texte copié/partagé (qui
// sert aussi de point de départ au storyboard), et l'avertissement de durée,
// qui mentirait s'il restait tel quel après un changement d'accroche.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage();
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  return page;
}

test('Script : l\'accroche choisie entre dans le script, l\'ancienne prend sa place', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      currentScript = [
        { temps: '0-5 sec', texte: 'Ancienne accroche beaucoup plus longue que la nouvelle, vraiment.' },
        { temps: '5-20 sec', texte: 'Un bloc du milieu, avec assez de mots pour durer un moment.' },
        { temps: '20-25 sec', texte: 'Clique le lien en bio.' }
      ];
      currentHooks = [{ style: 'Choc', texte: 'Tu perds ton argent.' }, { style: 'Question', texte: 'Et si ?' }];
      copyTexts = ['a', 'b', 'ancien texte'];
      _dureeCibleScript = { min: 138, max: 163, desc: '1 minute', hardMin: 124, hardMax: 179 };
      document.getElementById('results').innerHTML =
        '<div id="scriptText0"></div><div id="hookText0"></div>'
        + '<div class="hook-echange-note" id="hookEchangeNote" style="display:none"></div>';
      const tempsAvant = currentScript.map(s => s.temps).join('|');

      utiliserHookAlternatifScript(0, null);
      const apres = {
        blocScript: currentScript[0].texte,
        alternative: currentHooks[0].texte,
        domScript: document.getElementById('scriptText0').textContent,
        domAlt: document.getElementById('hookText0').textContent,
        copie: copyTexts[2],
        tempsChange: currentScript.map(s => s.temps).join('|') !== tempsAvant,
        noteVisible: document.getElementById('hookEchangeNote').style.display !== 'none',
        note: document.getElementById('hookEchangeNote').textContent
      };
      utiliserHookAlternatifScript(0, null);
      return {
        apres,
        retour: { blocScript: currentScript[0].texte, alternative: currentHooks[0].texte },
        // Deuxième alternative intacte : on ne touche qu'à celle qu'on utilise.
        autreAlternative: currentHooks[1].texte
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.apres.blocScript, 'Tu perds ton argent.',
      'REGRESSION : l\'accroche choisie n\'entre pas dans le script. C\'est toute la fonctionnalité.');
    assert.match(vu.apres.alternative, /^Ancienne accroche/,
      'REGRESSION : l\'ancienne accroche est PERDUE au lieu de prendre la place de celle qu\'on utilise. '
      + 'Le créateur ne pourrait plus revenir en arrière, et la liste perdrait une proposition.');
    assert.equal(vu.apres.domScript, 'Tu perds ton argent.', 'le script affiché suit');
    assert.match(vu.apres.domAlt, /^Ancienne accroche/, 'la liste affichée suit aussi');
    assert.match(vu.apres.copie, /Tu perds ton argent/,
      'REGRESSION : Copier et Partager renverraient l\'ANCIENNE accroche. Le créateur collerait dans '
      + 'TikTok un script qui n\'est pas celui qu\'il a sous les yeux.');
    assert.equal(vu.apres.tempsChange, true,
      'REGRESSION : le minutage des blocs n\'est pas recalculé. Une accroche plus courte décale tout ce '
      + 'qui suit, et la timeline afficherait le découpage de l\'accroche précédente.');
    assert.equal(vu.apres.noteVisible, true, 'le créateur doit savoir ce qui vient de se passer');
    assert.match(vu.apres.note, /Score/,
      'REGRESSION : la note ne dit plus que le score date de l\'accroche PRÉCÉDENTE. Le laisser croire '
      + 'valide serait mentir sur le seul chiffre auquel le créateur se fie.');

    assert.match(vu.retour.blocScript, /^Ancienne accroche/,
      'REGRESSION : un second appui ne remet pas l\'état d\'avant. L\'échange doit être réversible sans '
      + 'aucun bouton « annuler » à inventer.');
    assert.equal(vu.retour.alternative, 'Tu perds ton argent.', 'et la liste revient elle aussi');
    assert.equal(vu.autreAlternative, 'Et si ?', 'les autres propositions ne bougent jamais');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : l\'avertissement de durée est recalculé, il ne ment plus', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      // Accroche de 15 mots : au-dessus du plafond de 12, donc l'app affiche
      // « ton accroche fait 15 mots ». Après l'échange contre une accroche de
      // 4 mots, cette phrase devient fausse.
      currentScript = [
        { temps: '0-6 sec', texte: 'Personne ne te dira jamais la vérité sur ce que tu crois savoir aujourd hui' },
        { temps: '6-20 sec', texte: 'Un bloc du milieu.' }
      ];
      currentHooks = [{ style: 'Choc', texte: 'Tu perds ton argent.' }];
      copyTexts = ['a', 'b', 'c'];
      _dureeCibleScript = { min: 138, max: 163, desc: '1 minute', hardMin: 124, hardMax: 179 };
      const avant = avertissementDureeScript(currentScript);
      document.getElementById('results').innerHTML =
        '<div class="duree-avertissement">⏱ ' + avant + '</div>'
        + '<div id="scriptText0"></div><div id="hookText0"></div>'
        + '<div class="hook-echange-note" id="hookEchangeNote" style="display:none"></div>';
      utiliserHookAlternatifScript(0, null);
      return { avant, apres: document.querySelector('#results .duree-avertissement').textContent };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(vu.avant, /accroche fait 15 mots/, 'au départ, l\'app signale bien une accroche trop longue');
    assert.ok(!/accroche fait/.test(vu.apres),
      'REGRESSION : après avoir raccourci son accroche, le créateur lit encore « ton accroche fait 15 '
      + 'mots », juste sous le score, à l\'endroit le plus lu de l\'écran. L\'app lui reproche un défaut '
      + 'qu\'il vient de corriger. Message affiché : ' + vu.apres);
    assert.match(vu.apres, /mots/,
      'la partie sur le total, elle, reste calculée et affichée : le script est toujours trop court');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : même geste, et le texte qui part au storyboard suit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      currentStory = {
        recit: [{ segment: 'Hook', texte: 'Ancienne accroche du récit.' }, { segment: 'Suite', texte: 'La suite.' }],
        hooks: [{ style: 'Choc', texte: 'Nouvelle accroche.' }]
      };
      currentStoryText = 'Ancienne accroche du récit.\n\nLa suite.';
      const out = document.getElementById('storyOutput');
      out.innerHTML = '<div id="storySegText0"></div><div id="storyHookText0"></div>'
        + '<div class="hook-echange-note" id="storyHookEchangeNote" style="display:none"></div>';
      out.dataset.fulltext = currentStoryText;
      utiliserHookAlternatifRecit(0, null);
      const apres = {
        segment: currentStory.recit[0].texte,
        alternative: currentStory.hooks[0].texte,
        dom: document.getElementById('storySegText0').textContent,
        fulltext: out.dataset.fulltext,
        texteGlobal: currentStoryText
      };
      utiliserHookAlternatifRecit(0, null);
      return { apres, retourFulltext: out.dataset.fulltext };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.apres.segment, 'Nouvelle accroche.', 'le premier segment du récit EST son accroche');
    assert.equal(vu.apres.alternative, 'Ancienne accroche du récit.', 'et l\'échange vaut aussi ici');
    assert.equal(vu.apres.dom, 'Nouvelle accroche.', 'le récit affiché suit');
    assert.match(vu.apres.fulltext, /^Nouvelle accroche\./,
      'REGRESSION : le texte complet garde l\'ancienne accroche. Copier, Partager ET le storyboard '
      + 'partent de ce texte : le créateur remplacerait son accroche à l\'écran, puis construirait tout '
      + 'son storyboard sur l\'ancienne, sans que rien ne le signale.');
    assert.equal(vu.apres.texteGlobal, vu.apres.fulltext, 'les deux copies du texte restent d\'accord');
    assert.match(vu.retourFulltext, /^Ancienne accroche du récit\./, 'et le retour en arrière suit aussi');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

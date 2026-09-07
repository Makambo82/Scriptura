// Demande du propriétaire, et c'est sa réponse au problème de durée : « juste
// en bas du score, mettre une information très importante : si le créateur
// trouve certaines parties du script trop courtes, il peut utiliser les
// boutons en bas de chaque partie pour rallonger, raccourcir ou reformuler ».
//
// Ces quatre boutons EXISTENT depuis longtemps sous chaque passage du script
// et chaque segment de récit, mais rien ne les annonçait : on les découvrait
// par hasard, ou jamais. Or ils sont exactement l'outil qui manque quand la
// durée ne tombe pas juste. L'app corrige déjà le TOTAL toute seule, jusqu'à
// trois passes ; ce que le code ne saura jamais faire, c'est décider QUEL
// passage mérite d'être allongé. Seul le créateur le sait, encore faut-il
// qu'il sache qu'il peut.
//
// CE QUE CE FICHIER VERROUILLE, et c'est le point qui compte : le rappel ne
// doit JAMAIS promettre des boutons qui n'existent pas. Un mode d'emploi faux
// est pire que pas de mode d'emploi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('le rappel est sous le score, dans TOUS les états de la carte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      const score = { viral: 70, hook: 75, engagement: 90, emotion: 60, retention: 74 };
      const compter = (html) => (html.match(/rappel-edition/g) || []).length;
      const html = carteScoreScriptHTML({ score, avertissementDuree: 'Ton script fait 95 mots.' });
      return {
        avecAvertissement: compter(html),
        sansAvertissement: compter(carteScoreScriptHTML({ score })),
        // Le score arrive APRÈS le script : le créateur lit déjà son texte
        // pendant ce temps, le rappel doit donc être là aussi.
        enAttente: compter(carteScoreScriptHTML({ scoreEnCours: true })),
        // Et surtout quand le juge est muet : c'est là que le créateur est le
        // plus démuni, sans score pour se repérer.
        sansJuge: compter(carteScoreScriptHTML({ evaluationIndisponible: 'Le juge n\'a pas répondu.' })),
        recit: compter(carteScoreRecitHTML({ score })),
        carteVide: compter(carteScoreScriptHTML({})),
        // L'ordre compte : l'avertissement dit le problème, le rappel dit quoi
        // faire. L'inverse n'aurait aucun sens à la lecture.
        apresAvertissement: html.indexOf('rappel-edition') > html.indexOf('duree-avertissement'),
        texteScript: (carteScoreScriptHTML({ score }).match(/Un passage[^<]*/) || [''])[0],
        texteRecit: (carteScoreRecitHTML({ score }).match(/Un segment[^<]*/) || [''])[0]
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    ['avecAvertissement', 'sansAvertissement', 'enAttente', 'sansJuge', 'recit'].forEach(cas => {
      assert.equal(vu[cas], 1,
        'REGRESSION : le rappel est absent ou en double dans l\'état « ' + cas + ' » (' + vu[cas] + '). '
        + 'Les boutons d\'édition existent, mais personne ne les découvre tout seul.');
    });
    assert.equal(vu.carteVide, 0,
      'REGRESSION : le rappel s\'affiche sur une carte sans score ni script. Il parlerait de passages '
      + 'qui n\'existent pas encore.');
    assert.equal(vu.apresAvertissement, true,
      'REGRESSION : le rappel passe AVANT l\'avertissement de durée. L\'un dit le problème, l\'autre dit '
      + 'quoi faire : dans l\'autre sens, la réponse arrive avant la question.');
    assert.match(vu.texteScript, /allonger.*raccourcir.*reformuler.*simplifier/,
      'les quatre actions réellement disponibles doivent être nommées : ' + vu.texteScript);
    assert.match(vu.texteScript, /sans tout régénérer/,
      'REGRESSION : le rappel ne dit plus l\'essentiel, qu\'on rattrape la durée SANS repayer une '
      + 'génération entière');
    assert.match(vu.texteRecit, /segment/,
      'le mode Récit parle de SEGMENTS, le mot que le créateur voit à l\'écran, pas de « passages »');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Le garde-fou qui compte : ce rappel promet quatre boutons. Le jour où
// quelqu'un les retire, ou en renomme un, le rappel deviendrait un mensonge
// affiché sous le score, à l'endroit le plus lu de l'écran.
test('les quatre boutons promis existent VRAIMENT, dans les deux modes', () => {
  const ACTIONS = ['reformuler', 'raccourcir', 'allonger', 'simplifier'];
  const manquants = [];
  [['js/generation.js', 'microEditerBlocScript'], ['js/storytelling.js', 'microEditerSegmentRecit']]
    .forEach(([fichier, fonction]) => {
      const src = lire(fichier);
      ACTIONS.forEach(a => {
        if (!src.includes(fonction + '(${i},\'' + a + '\'')) manquants.push(fichier + ' → ' + a);
      });
    });
  assert.deepEqual(manquants, [],
    'REGRESSION : ' + manquants.join(', ') + '. Le rappel affiché sous le score promet ces quatre '
    + 'boutons : sans eux, il envoie le créateur chercher quelque chose qui n\'existe pas.');
});

// Le mode Série n'a PAS de boutons par passage : son épisode est un texte
// continu, pas une suite de segments. Le rappel n'y est donc volontairement
// pas affiché, et ce test fige ce choix pour qu'on ne l'y colle pas un jour
// « par cohérence » sans avoir d'abord ajouté les boutons.
test('le mode Série n\'affiche pas un rappel qu\'il ne peut pas tenir', () => {
  const src = lire('js/serie.js');
  assert.ok(!src.includes('rappelEditionParPassageHTML'),
    'REGRESSION : le rappel apparaît dans le mode Série, qui n\'a aucun bouton d\'édition par passage. '
    + 'Un épisode y est un texte continu. Le créateur chercherait des boutons inexistants.');
  assert.ok(!src.includes('script-edit-btn'),
    'si des boutons d\'édition arrivent un jour dans la Série, ce test doit tomber pour qu\'on pense à '
    + 'y afficher le rappel aussi');
});

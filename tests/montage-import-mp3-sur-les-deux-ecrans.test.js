// Retour du propriétaire, en une phrase : « et où est le bouton ajouter une
// musique ? ». Il ne le trouvait pas, et il avait raison de ne pas le trouver.
//
// L'APP A DEUX ÉCRANS DE MONTAGE, et je n'avais livré l'import MP3 que sur un
// seul :
//   1. le montage qui suit un storyboard (js/montage.js), atteint après avoir
//      généré un script ou un récit ;
//   2. le montage manuel (js/montage-manuel.js), atteint depuis la carte
//      « Monter une vidéo » de l'accueil. C'est le plus évident des deux, et
//      c'est celui qui n'avait rien.
//
// CE QUE J'AI CRU TROUVER EN PLUS, ET QUI ÉTAIT FAUX : j'ai d'abord annoncé un
// second défaut, l'écran manuel n'appelant pas son rendu de zone musique à
// l'ouverture. La vérification de morsure m'a démenti : omRenderVoixZone
// l'appelle déjà, dans ses deux branches. Il n'y avait qu'un seul défaut, le
// bouton absent. C'est écrit ici pour que personne ne reparte de ma version
// fausse.
//
// LE TEST OUVRE DONC VRAIMENT LES ÉCRANS plutôt que de lire le rendu isolé :
// c'est la seule façon de couvrir aussi cette chaîne d'appels, qui est réelle
// même si elle n'était pas cassée.
//
// LES DEUX ÉCRANS SONT TESTÉS ENSEMBLE, VOLONTAIREMENT. Le défaut n'était pas
// « un bouton manquant », c'était « deux écrans qui font la même chose et qui
// divergent ». Un test par écran, écrit séparément, aurait laissé revenir
// exactement le même écart.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrirApp(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page;
}

// Les deux écrans, décrits par ce qui les distingue vraiment : leur zone
// musique et la fonction qui les ouvre.
const ECRANS = [
  {
    nom: 'montage après storyboard',
    zone: 'montageMusiqueZone',
    ouvrir: () => ouvrirMontage([{ text: 'Un plan de test.', visuel: 'un décor' }], null)
  },
  {
    nom: 'montage manuel (carte « Monter une vidéo » de l\'accueil)',
    zone: 'omMusiqueZone',
    ouvrir: () => ouvrirMontageManuelAccueil()
  }
];

test('les DEUX écrans de montage proposent d\'importer un MP3, dès l\'ouverture', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    for (const ecran of ECRANS) {
      const vu = await page.evaluate((zoneId) => {
        const zone = document.getElementById(zoneId);
        return { trouvee: !!zone, html: zone ? zone.innerHTML : '' };
      }, ecran.zone);

      // Avant même de regarder le contenu : la zone doit exister. Sans ça le
      // test resterait vert en ne vérifiant plus rien.
      assert.equal(vu.trouvee, true,
        'REGRESSION : la zone musique #' + ecran.zone + ' a disparu ou changé '
        + 'd\'identifiant sur l\'écran « ' + ecran.nom + ' ». Ce test ne vérifierait '
        + 'plus rien, en restant vert.');
    }

    for (const ecran of ECRANS) {
      // On ouvre RÉELLEMENT l'écran, plutôt que de lire le HTML de départ :
      // c'est précisément l'écart entre les deux qui a caché le bouton.
      await page.evaluate(new Function('return (' + ecran.ouvrir.toString() + ')()'));
      await page.waitForTimeout(150);

      const html = await page.evaluate((zoneId) => {
        const z = document.getElementById(zoneId);
        return z ? z.innerHTML : '';
      }, ecran.zone);

      assert.match(html, /Importer un fichier/,
        'REGRESSION : aucun bouton d\'import à l\'ouverture de l\'écran « '
        + ecran.nom + ' ». Le créateur qui a déjà sa piste, ou une musique imposée par '
        + 'sa niche, n\'a pas d\'autre choix que d\'en faire générer une dont il ne veut '
        + 'pas, en y laissant du quota. Vu : ' + html.slice(0, 300));

      assert.match(html, /accept="audio\/mpeg,\.mp3"/,
        'REGRESSION : le sélecteur de fichier de l\'écran « ' + ecran.nom + ' » ne filtre '
        + 'plus sur le MP3. Sur téléphone, le créateur se voit alors proposer toute sa '
        + 'bibliothèque, choisit un fichier, et se fait refuser après coup.');

      assert.match(html, /MP3 uniquement, 15 Mo maximum/,
        'REGRESSION : le format attendu n\'est plus annoncé sur « ' + ecran.nom + ' ». '
        + 'Le bouton dit « Importer un fichier » et ne le dit donc plus lui-même : sans '
        + 'cette ligne, le créateur ouvre sa bibliothèque, choisit un WAV, et ne '
        + 'découvre le refus qu\'après. Vu : ' + html.slice(0, 300));

      assert.match(html, /Générer avec l'IA/,
        'et la génération reste proposée à côté, sur « ' + ecran.nom + ' » : l\'import '
        + 's\'ajoute à ce chemin, il ne le remplace pas.');
    }

    assert.deepEqual(erreursJs, [], 'aucune erreur JS en ouvrant les deux écrans');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une seule validation sert aux deux écrans', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    // C'EST LE CŒUR DU DÉFAUT D'ORIGINE : deux montages qui posent la même
    // question au même fichier doivent y répondre pareil. Recopier le bloc,
    // c'est se garantir qu'un jour la limite changera d'un seul côté.
    const vu = await page.evaluate(() => {
      const faire = (nom, type, octets) => {
        const f = new File([new Uint8Array(8)], nom, type ? { type } : undefined);
        Object.defineProperty(f, 'size', { value: octets, configurable: true });
        return f;
      };
      const cas = [
        ['Ma prod.mp3', 'audio/mpeg', 3 * 1024 * 1024],
        ['musique.wav', 'audio/wav', 2 * 1024 * 1024],
        ['concert.mp3', 'audio/mpeg', 40 * 1024 * 1024],
        ['piste.mp3', '', 1024 * 1024]
      ];
      return {
        existe: typeof validerMusiqueImportee === 'function',
        // Une seule fonction, appelée par les deux : on vérifie ses verdicts,
        // et on vérifie plus bas que les deux écrans l'appellent VRAIMENT.
        verdicts: typeof validerMusiqueImportee === 'function'
          ? cas.map(c => validerMusiqueImportee(faire(c[0], c[1], c[2])).ok) : null,
        importManuelExiste: typeof omImporterMusique === 'function',
        importStoryboardExiste: typeof importerMusiqueMontage === 'function'
      };
    });

    assert.equal(vu.existe, true,
      'REGRESSION : validerMusiqueImportee a disparu. Si chaque montage revalide le '
      + 'fichier dans son coin, les deux écrans finiront par accepter des choses '
      + 'différentes sans que personne ne s\'en aperçoive.');
    assert.equal(vu.importManuelExiste, true, 'omImporterMusique doit exister');
    assert.equal(vu.importStoryboardExiste, true, 'importerMusiqueMontage doit exister');

    assert.deepEqual(vu.verdicts, [true, false, false, true],
      'REGRESSION : les verdicts ont changé. Attendu : MP3 normal accepté, WAV refusé, '
      + 'MP3 de 40 Mo refusé, .mp3 sans type déclaré accepté (plusieurs téléphones ne '
      + 'déclarent aucun type, et refuser serait incompréhensible). Vu : '
      + JSON.stringify(vu.verdicts));

    // Les deux écrans appellent-ils vraiment la fonction partagée ? Sinon
    // l'assertion ci-dessus ne prouverait rien sur ce qu'ils font, eux.
    const sources = await page.evaluate(() => ({
      manuel: omImporterMusique.toString(),
      storyboard: importerMusiqueMontage.toString()
    }));
    for (const [ecran, source] of Object.entries(sources)) {
      assert.match(source, /validerMusiqueImportee\(/,
        'REGRESSION : l\'import du montage « ' + ecran + ' » n\'appelle plus la '
        + 'validation partagée. Il a donc sa propre copie des règles, et c\'est '
        + 'exactement la divergence qui avait fait disparaître le bouton d\'un écran.');
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

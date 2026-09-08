// Retour du propriétaire, capture à l'appui, sur le montage manuel : les deux
// bascules de la VOIX OFF s'écrivaient en minuscules (« Importer un fichier »,
// « Générer avec l'IA ») juste au-dessus des deux boutons de la MUSIQUE, qui
// eux étaient en capitales espacées et disaient autre chose (« Générer une
// musique de fond », « Importer un MP3 »).
//
// Deux rangées de boutons empilées sur le même écran, qui offrent exactement
// les deux mêmes chemins (mon fichier / l'IA), écrites différemment et rangées
// dans l'ordre inverse l'une de l'autre. On croit avoir affaire à quatre
// choix, pas à deux fois deux.
//
// CE TEST NE VÉRIFIE PAS DES LIBELLÉS EN DUR, il COMPARE les deux rangées
// entre elles. C'est ce qui compte : le jour où on renommera « Générer avec
// l'IA », il faudra que les deux suivent, et c'est ce test qui le dira. Un
// test écrit sur la valeur attendue aurait laissé les rangées diverger dès
// qu'on aurait changé la bonne moitié.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const normaliser = (s) => String(s || '')
  .replace(/\s+/g, ' ')
  .replace(/^[↻+\s]+/, '')   // les pictogrammes de tête ne font pas partie du mot
  .trim()
  .toLowerCase();

test('voix off et musique proposent les mêmes chemins, avec les mêmes mots', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      ouvrirMontageManuelAccueil();
      const zone = document.getElementById('omMusiqueZone');
      // Dans la zone musique : le label porte l'import, le bouton la génération.
      const importMusique = zone && zone.querySelector('label');
      const genMusique = zone && zone.querySelector('button.btn-montage-primary');
      const importVoix = document.getElementById('omModeUploadBtn');
      const genVoix = document.getElementById('omModeIaBtn');
      const lire = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          texte: el.textContent,
          casse: getComputedStyle(el).textTransform,
          // Géométrie : pour comparer l'ORDRE de lecture des deux rangées, et
          // vérifier qu'elles occupent bien la même place à l'écran.
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height)
        };
      };
      return {
        importMusique: lire(importMusique), genMusique: lire(genMusique),
        importVoix: lire(importVoix), genVoix: lire(genVoix)
      };
    });

    for (const [cle, el] of Object.entries(vu)) {
      assert.ok(el, 'REGRESSION : « ' + cle + ' » est introuvable sur l\'écran de montage '
        + 'manuel. Ce test ne comparerait plus rien, en restant vert.');
    }

    // 1. LES MÊMES MOTS, des deux côtés.
    assert.equal(normaliser(vu.importMusique.texte), normaliser(vu.importVoix.texte),
      'REGRESSION : le bouton d\'import de la MUSIQUE ne dit plus la même chose que celui '
      + 'de la VOIX OFF, juste au-dessus. Musique : « ' + vu.importMusique.texte.trim()
      + ' », voix off : « ' + vu.importVoix.texte.trim() + ' ». Deux formulations pour le '
      + 'même geste, sur le même écran, font croire à deux fonctions différentes.');

    assert.equal(normaliser(vu.genMusique.texte), normaliser(vu.genVoix.texte),
      'REGRESSION : le bouton de génération de la MUSIQUE ne dit plus la même chose que '
      + 'celui de la VOIX OFF. Musique : « ' + vu.genMusique.texte.trim() + ' », voix off : '
      + '« ' + vu.genVoix.texte.trim() + ' ».');

    // 2. LA MÊME CASSE. C'est le point précis du retour : les bascules de la
    //    voix off se lisaient en minuscules au-dessus de capitales espacées.
    assert.equal(vu.importVoix.casse, vu.importMusique.casse,
      'REGRESSION : les bascules de la voix off ne s\'écrivent plus comme les boutons de '
      + 'la musique. Voix off : ' + vu.importVoix.casse + ', musique : '
      + vu.importMusique.casse + '. Deux rangées empilées ne peuvent pas être écrites '
      + 'autrement l\'une que l\'autre.');
    assert.equal(vu.genVoix.casse, vu.genMusique.casse, 'idem pour le second bouton');
    assert.equal(vu.importVoix.casse, 'uppercase',
      'et les deux rangées sont en capitales, comme le reste des boutons de l\'app. Vu : '
      + vu.importVoix.casse);

    // 3. LE MÊME ORDRE. Des mots identiques rangés à l'envers forcent à relire.
    //    L'ordre se lit en SENS DE LECTURE (la ligne d'abord, la colonne
    //    ensuite) et non sur la seule abscisse : quand une rangée passe à la
    //    ligne, les deux boutons ont la même abscisse et une comparaison
    //    horizontale seule ne veut plus rien dire. C'est exactement le piège
    //    dans lequel ce test est tombé en premier jet.
    const avant = (a, b) => (a.y !== b.y ? a.y < b.y : a.x < b.x);
    const ordreVoix = avant(vu.importVoix, vu.genVoix);
    const ordreMusique = avant(vu.importMusique, vu.genMusique);
    assert.equal(ordreMusique, ordreVoix,
      'REGRESSION : les deux rangées sont rangées dans l\'ordre INVERSE l\'une de l\'autre. '
      + 'Voix off : import ' + (ordreVoix ? 'à gauche' : 'à droite') + ', musique : import '
      + (ordreMusique ? 'à gauche' : 'à droite') + '. Les mêmes mots dans le désordre '
      + 'coûtent plus cher qu\'ils ne rapportent : on relit au lieu de reconnaître.');

    // 4. LA MÊME PLACE À L'ÉCRAN, et pas seulement les mêmes mots. Mesuré au
    //    premier jet : la rangée musique ne tenait pas sur 414px, son second
    //    bouton passait à la ligne et s'étalait sur toute la largeur. Deux
    //    boutons empilés en face de deux boutons côte à côte, avec les mêmes
    //    mots : on croit les avoir alignés, l'écran dit le contraire.
    assert.equal(vu.importMusique.y === vu.genMusique.y, vu.importVoix.y === vu.genVoix.y,
      'REGRESSION : une rangée tient sur une ligne et l\'autre passe à deux. Voix off : '
      + (vu.importVoix.y === vu.genVoix.y ? 'une ligne' : 'deux lignes') + ', musique : '
      + (vu.importMusique.y === vu.genMusique.y ? 'une ligne' : 'deux lignes') + '. Les deux '
      + 'rangées se suivent sur le même écran, elles ne peuvent pas être disposées '
      + 'autrement l\'une que l\'autre.');

    const ecartLargeur = Math.abs(vu.importMusique.w - vu.genMusique.w);
    assert.ok(ecartLargeur <= 6,
      'REGRESSION : les deux boutons de la musique n\'ont plus la même largeur ('
      + vu.importMusique.w + 'px contre ' + vu.genMusique.w + 'px). Ce sont deux chemins à '
      + 'égalité, comme la rangée de la voix off juste au-dessus : le plus large passe pour '
      + 'le choix attendu.');

    // 5. LA CIBLE TACTILE NE PAIE PAS LA COHÉRENCE. La police des bascules a
    //    baissé pour rejoindre celle des boutons musique : c'est l'ÉCRITURE
    //    qui devait s'aligner, jamais la zone à toucher.
    for (const [cle, el] of Object.entries(vu)) {
      assert.ok(el.h >= 38,
        'REGRESSION : « ' + cle + ' » ne fait plus que ' + el.h + 'px de haut. En réduisant '
        + 'la police pour aligner les deux rangées, on a rétréci le bouton : sur téléphone '
        + 'il se rate, et on aurait payé la cohérence avec des gestes manqués.');
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

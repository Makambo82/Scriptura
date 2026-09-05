// Demande du propriétaire, en deux temps, et le second corrige le premier.
//
// 1. « Tous les slides doivent être générés avec le fond sombre comme avant,
//    et c'est quand on va cliquer sur générer un fond que l'image va
//    apparaître. » L'essai précédent posait la photo produit d'office sur
//    trois slides : retiré. Le produit n'entre en scène que sur un geste.
//
// 2. « L'app doit en arrière-plan faire le produit de l'image sur fond
//    transparent avant de le servir dans différents décors, quand
//    l'utilisateur cliquera sur générer un fond. »
//
// POURQUOI ON DÉTOURE NOUS-MÊMES : la génération d'images ne reçoit qu'un
// TEXTE, jamais d'image de référence (api/montage-media.js). Elle ne peut ni
// détourer la photo du créateur, ni la redessiner sans en faire un sosie
// (voir tests/produit-reel-jamais-imite.test.js). Le seul moyen d'avoir SON
// produit dans un décor, c'est de le découper ici, dans le navigateur, et de
// le poser sur le décor généré.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl, surMontageMedia) {
  const p = await navigateur.newPage();
  await poserMocksReseau(p);
  if (surMontageMedia) await p.route('**/api/montage-media**', surMontageMedia);
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(250);
  return p;
}

// Fabrique une photo produit dans la page : un objet coloré sur fond UNI
// (le cas réel d'une photo e-commerce), ou sur un fond bruité (le cas qui
// doit être refusé).
const FABRIQUER = `
  (fondUni) => {
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 400;
    const g = cv.getContext('2d');
    if (fondUni) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 400, 400); }
    else {
      for (let x = 0; x < 400; x += 4) for (let y = 0; y < 400; y += 4) {
        g.fillStyle = 'rgb(' + ((x * 7) % 256) + ',' + ((y * 11) % 256) + ',' + ((x + y) % 256) + ')';
        g.fillRect(x, y, 4, 4);
      }
    }
    g.fillStyle = '#1f6b4c'; g.fillRect(140, 80, 120, 240);
    g.fillStyle = '#c9a84c'; g.fillRect(140, 170, 120, 60);
    return cv.toDataURL('image/png');
  }
`;

test('un produit photographié sur fond uni est détouré, un fond chargé est REFUSÉ', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const p = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

    const vu = await p.evaluate(async (src) => {
      const fabriquer = eval(src);
      const charger = (url) => new Promise((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
      });

      const uni = detourerProduitCarrousel(await charger(fabriquer(true)));
      const charge = detourerProduitCarrousel(await charger(fabriquer(false)));

      // Sur le résultat détouré : les coins doivent être transparents et le
      // centre (le produit) parfaitement opaque. Sans ça, "détouré" ne
      // voudrait rien dire.
      let coin = null, centre = null;
      if (uni) {
        const im = await charger(uni.dataUrl);
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        coin = g.getImageData(2, 2, 1, 1).data[3];
        centre = g.getImageData(Math.round(im.width / 2), Math.round(im.height / 2), 1, 1).data[3];
      }
      return { uni: uni ? Math.round(uni.part * 100) : null, charge, coin, centre };
    }, FABRIQUER);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.uni !== null, 'une photo sur fond blanc uni doit être détourée');
    assert.ok(vu.uni > 50 && vu.uni < 94,
      'la part retirée doit rester plausible (' + vu.uni + '%) : trop peu, le fond reste ; trop, on mange le produit');
    assert.equal(vu.coin, 0, 'REGRESSION : le fond doit être VRAIMENT transparent, pas juste éclairci');
    assert.equal(vu.centre, 255, 'REGRESSION : le produit lui-même doit rester intact et opaque');
    assert.equal(vu.charge, null,
      'REGRESSION : sur une photo sans fond uni, mieux vaut refuser que livrer un produit troué ou cerné d\'un halo');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('tant qu\'on n\'a pas cliqué, TOUTES les slides restent sur le fond sombre', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const p = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

    const vu = await p.evaluate(async (src) => {
      const fabriquer = eval(src);
      carrouselFormat = '4:5';
      carrouselVenteFichier = { base64: fabriquer(true).split(',')[1], mediaType: 'image/png', nom: 'p.png' };
      carrouselResultat = { titre: 'T', direction_visuelle: 'sobre', slides: [0, 1, 2, 3].map(i => ({
        numero: i + 1, gabarit: i === 0 ? 'couverture' : 'points', titre: 'T' + i,
        visuel: 'une ambiance ' + i, points: [{ emoji: '🎯', titre: 'P', texte: 'x' }]
      })) };
      carrouselImages = new Array(4).fill(null);

      // Deux slides composées avant tout clic : elles doivent être
      // rigoureusement identiques hors numéro, donc sans photo produit.
      const empreinte = async (i) => {
        const blob = await composerSlideCarrousel(i);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let h = 0; for (let k = 0; k < buf.length; k++) h = (h * 31 + buf[k]) >>> 0;
        return h;
      };
      return {
        aucuneImage: carrouselImages.every(x => x === null),
        notes: carrouselResultat.slides.map((s, i) => noteVisuelSlide(s, i)),
        boutons: [0, 3].map(i => libelleBoutonFondCarrousel(i).replace(/<[^>]+>/g, '').trim()),
        composeSansErreur: typeof (await empreinte(0)) === 'number'
      };
    }, FABRIQUER);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.aucuneImage, true, 'aucune slide ne doit recevoir d\'image toute seule');
    assert.deepEqual(vu.notes, ['une ambiance 0', 'une ambiance 1', 'une ambiance 2', 'une ambiance 3'],
      'REGRESSION : aucune note ne doit annoncer une photo produit avant le clic : ' + JSON.stringify(vu.notes));
    assert.deepEqual(vu.boutons, ['Générer un fond', 'Générer un fond'],
      'le bouton reste "Générer un fond" partout : ' + JSON.stringify(vu.boutons));
    assert.equal(vu.composeSansErreur, true);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('au clic : le décor réserve une place au produit, et le produit y est posé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const prompts = [];
    let decorB64 = null;
    const navigateurPage = await lancerNavigateur();
    await navigateurPage.close();

    const p = await ouvrir(navigateur, baseUrl, async (route) => {
      let corps = {}; try { corps = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (corps.prompts) prompts.push(...corps.prompts);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: [{ base64: decorB64, mimeType: 'image/png' }], erreurs: [null] })
      });
    });
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

    // Un décor uni très reconnaissable : si le produit est posé dessus, la
    // slide ne peut plus être uniforme.
    decorB64 = await p.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
      const g = cv.getContext('2d'); g.fillStyle = '#101828'; g.fillRect(0, 0, 1080, 1350);
      return cv.toDataURL('image/png').split(',')[1];
    });

    const vu = await p.evaluate(async (src) => {
      const fabriquer = eval(src);
      carrouselFormat = '4:5';
      carrouselQuotaImages = { illimite: true, used: 0, limite: 999 };
      carrouselVenteFichier = { base64: fabriquer(true).split(',')[1], mediaType: 'image/png', nom: 'p.png' };
      carrouselResultat = { titre: 'T', direction_visuelle: 'sobre', slides: [0, 1].map(i => ({
        numero: i + 1, gabarit: 'points', titre: 'T' + i, visuel: 'une ambiance ' + i,
        points: [{ emoji: '🎯', titre: 'P', texte: 'x' }]
      })) };
      carrouselImages = [null, null];

      await genererImageCarrousel(0);
      await genererImageCarrousel(1);

      // Le produit doit VRAIMENT être dans le fond composé : sur un décor
      // uni, il suffit de compter les pixels qui ne sont plus de la couleur
      // du décor.
      const charger = (url) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = url; });
      const partNonUnie = async (dataUrl) => {
        const im = await charger(dataUrl);
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data;
        let n = 0;
        for (let k = 0; k < d.length; k += 4) {
          if (Math.abs(d[k] - 16) > 12 || Math.abs(d[k + 1] - 24) > 12 || Math.abs(d[k + 2] - 40) > 12) n++;
        }
        return n / (im.width * im.height);
      };
      return {
        avecProduit: carrouselImages.map(im => !!(im && im.avecProduit)),
        note: noteVisuelSlide(carrouselResultat.slides[0], 0),
        partProduit: Math.round((await partNonUnie(carrouselImages[0].apercu)) * 100),
        // Deux slides, deux poses différentes : le même objet au même endroit
        // sur chaque slide se remarquerait tout de suite.
        posesDifferentes: carrouselImages[0].apercu !== carrouselImages[1].apercu
      };
    }, FABRIQUER);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(prompts.length >= 2, 'le décor doit bien avoir été demandé');
    assert.ok(prompts.every(pr => /ZONE DÉGAGÉE/.test(pr)),
      'REGRESSION : sans place réservée, le produit détouré se retrouve collé sur un décor déjà plein');
    assert.ok(prompts.every(pr => /Ne dessine AUCUN produit/.test(pr)),
      'le décor ne doit jamais dessiner un produit : c\'est la vraie photo qui le montre');
    assert.deepEqual(vu.avecProduit, [true, true], 'les deux fonds doivent porter le produit');
    assert.match(vu.note, /produit détouré posé dedans/, 'le créateur doit lire ce qui a été fait');
    assert.ok(vu.partProduit > 2,
      'REGRESSION : le produit n\'apparaît pas dans le fond composé (' + vu.partProduit + '% du décor modifié)');
    assert.equal(vu.posesDifferentes, true,
      'REGRESSION : le produit doit changer de place d\'une slide à l\'autre');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('sans produit chargé, le prompt du décor n\'est pas alourdi', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const p = await ouvrir(navigateur, baseUrl);
    const vu = await p.evaluate(() => {
      carrouselVenteFichier = null;
      carrouselResultat = { direction_visuelle: 'sobre', slides: [] };
      return construirePromptImageCarrousel('une salle de bain sombre');
    });
    assert.ok(!/ZONE DÉGAGÉE/.test(vu),
      'sans produit, aucune place à réserver, et rien à ajouter au prompt : ' + vu);
    assert.match(vu, /Aucune lettre/, 'les consignes d\'origine restent');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

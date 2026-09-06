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
// Une photo de test RÉALISTE, et c'est important : la première version de ce
// test utilisait un rectangle net sur un blanc parfait, ce qu'aucune photo
// n'est. Le détourage passait donc le test tout en produisant, sur une vraie
// photo, un liseré blanc et une flaque d'ombre. Ici : fond légèrement dégradé
// (vignettage studio), OMBRE PORTÉE douce, et bords LISSÉS par des courbes.
const FABRIQUER = `
  (fondUni) => {
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 600;
    const g = cv.getContext('2d');
    if (fondUni) {
      const grd = g.createRadialGradient(300, 260, 60, 300, 300, 430);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#eceae6');
      g.fillStyle = grd; g.fillRect(0, 0, 600, 600);
      g.save(); g.filter = 'blur(16px)';
      g.fillStyle = 'rgba(120,118,112,0.55)';
      g.beginPath(); g.ellipse(300, 470, 130, 26, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    } else {
      for (let x = 0; x < 600; x += 4) for (let y = 0; y < 600; y += 4) {
        g.fillStyle = 'rgb(' + ((x * 7) % 256) + ',' + ((y * 11) % 256) + ',' + ((x + y) % 256) + ')';
        g.fillRect(x, y, 4, 4);
      }
    }
    g.beginPath();
    g.moveTo(230, 460); g.lineTo(230, 200);
    g.quadraticCurveTo(230, 150, 300, 150);
    g.quadraticCurveTo(370, 150, 370, 200);
    g.lineTo(370, 460);
    g.quadraticCurveTo(370, 480, 300, 480);
    g.quadraticCurveTo(230, 480, 230, 460);
    g.closePath();
    const gp = g.createLinearGradient(230, 0, 370, 0);
    gp.addColorStop(0, '#134534'); gp.addColorStop(0.5, '#2a8a63'); gp.addColorStop(1, '#0f3527');
    g.fillStyle = gp; g.fill();
    g.fillStyle = '#c9a84c'; g.fillRect(232, 290, 136, 76);
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
      let mesures = null;
      if (uni) {
        const im = await charger(uni.dataUrl);
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data;
        const e = im.width / 600;
        const alpha = (x, y) => d[((Math.round(y * e) * im.width) + Math.round(x * e)) * 4 + 3];
        // Halo : des pixels restés opaques ET très clairs, alors que le
        // produit est vert sombre et doré. C'est la signature du liseré blanc.
        let halo = 0, opaques = 0;
        for (let k = 0; k < d.length; k += 4) {
          if (d[k + 3] > 200) { opaques++; if (d[k] > 215 && d[k + 1] > 215 && d[k + 2] > 210) halo++; }
        }
        mesures = {
          coin: alpha(5, 5),
          ombreGauche: alpha(190, 472),
          ombreDroite: alpha(410, 472),
          produit: alpha(300, 250),
          etiquette: alpha(300, 330),
          haloPourMille: Math.round((halo / Math.max(1, opaques)) * 1000)
        };
      }
      return { uni: uni ? Math.round(uni.part * 100) : null, charge, mesures };
    }, FABRIQUER);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.uni !== null, 'une photo sur fond blanc uni doit être détourée');
    assert.ok(vu.uni > 50 && vu.uni < 94,
      'la part retirée doit rester plausible (' + vu.uni + '%) : trop peu, le fond reste ; trop, on mange le produit');
    const m = vu.mesures;
    assert.equal(m.coin, 0, 'REGRESSION : le fond doit être VRAIMENT transparent, pas juste éclairci');
    assert.equal(m.produit, 255, 'REGRESSION : le produit lui-même doit rester intact et opaque');
    assert.equal(m.etiquette, 255, 'l\'étiquette aussi : c\'est elle qu\'on vend');
    assert.equal(m.ombreGauche, 0,
      'REGRESSION : l\'ombre portée restait collée sous le produit, comme une flaque grise');
    assert.equal(m.ombreDroite, 0, 'des deux côtés');
    assert.equal(m.haloPourMille, 0,
      'REGRESSION : le liseré blanc du contour (' + m.haloPourMille + '‰ des pixels opaques) se voit '
      + 'd\'autant plus que le décor est sombre');
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

// Demande du propriétaire : « si un utilisateur génère un fond mais voudrait
// revenir sur le fond initial (noir), il peut cliquer sur le bouton qui lui a
// servi à générer le fond. Après génération du fond, ce bouton doit être
// désormais "Rétablir". »
//
// Le bouton "Refaire le fond" qu'il remplace était un piège : quelqu'un qui
// veut simplement annuler cliquait dessus et dépensait une image de plus.
//
// Un fond écarté n'est pas jeté : il a été généré et payé. On le garde, et le
// bouton propose de le REMETTRE sans repayer. Sans ça, changer deux fois
// d'avis coûterait deux images pour le même visuel.
test('après génération, le bouton rétablit le fond sombre, et sait le remettre gratuitement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    let decorB64 = null;
    let appels = 0;
    const p = await ouvrir(navigateur, baseUrl, async (route) => {
      appels++;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: [{ base64: decorB64, mimeType: 'image/png' }], erreurs: [null] })
      });
    });
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

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
      carrouselResultat = { titre: 'T', direction_visuelle: 'sobre', slides: [{
        numero: 1, gabarit: 'points', titre: 'T', visuel: 'une ambiance',
        points: [{ emoji: '🎯', titre: 'P', texte: 'x' }]
      }] };
      carrouselImages = [null];
      const etiquette = () => libelleBoutonFondCarrousel(0).replace(/<[^>]+>/g, '').trim();

      const avant = etiquette();
      await genererImageCarrousel(0);
      const apresGeneration = { bouton: etiquette(), aUnFond: !!carrouselImages[0] };
      const fondGenere = carrouselImages[0].apercu;

      basculerFondCarrousel(0);
      const apresRetablir = { bouton: etiquette(), aUnFond: !!carrouselImages[0] };

      basculerFondCarrousel(0);
      const apresRemise = {
        bouton: etiquette(),
        aUnFond: !!carrouselImages[0],
        memeImage: carrouselImages[0] && carrouselImages[0].apercu === fondGenere
      };
      return { avant, apresGeneration, apresRetablir, apresRemise };
    }, FABRIQUER);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(vu.avant, /Générer un fond/, 'au départ, le bouton génère');
    assert.equal(vu.apresGeneration.aUnFond, true);
    assert.match(vu.apresGeneration.bouton, /^Rétablir$/,
      'REGRESSION : après génération le bouton doit dire "Rétablir", pas "Refaire le fond" '
      + '(refaire dépensait une image de plus) : ' + vu.apresGeneration.bouton);

    assert.equal(vu.apresRetablir.aUnFond, false,
      'REGRESSION : "Rétablir" doit vraiment ramener la slide sur le fond sombre');
    assert.match(vu.apresRetablir.bouton, /Remettre le fond/,
      'le fond écarté est gardé : proposer "Générer un fond" ferait repayer ce qu\'on a déjà : '
      + vu.apresRetablir.bouton);

    assert.equal(vu.apresRemise.aUnFond, true, '"Remettre le fond" doit le remettre');
    assert.equal(vu.apresRemise.memeImage, true, 'et remettre EXACTEMENT le même, pas un nouveau');
    assert.equal(appels, 1,
      'REGRESSION : aller-retour sur le fond ne doit coûter QU\'UNE seule image générée, pas trois ('
      + appels + ')');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

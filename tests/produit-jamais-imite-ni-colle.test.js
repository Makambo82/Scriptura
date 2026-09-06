// DÉCISION DU PROPRIÉTAIRE, après trois essais et deux captures à l'appui :
// « si l'app ne peut pas parfaitement détourer le produit et le mettre dans
// des décors, comme un homme le tenant en main, le produit posé comme un
// objet de valeur, on va laisser tomber cette partie : intégrer coûte que
// coûte l'image produit dans le fond. L'enlever aussi du storyboard du mode
// Script. »
//
// CE QUI A ÉTÉ ESSAYÉ, ET POURQUOI CHAQUE ESSAI A ÉCHOUÉ. À garder écrit :
// c'est ce qui évitera de recommencer.
//
// 1. La vraie photo posée en fond de slide, recadrée en plan large / serré /
//    décalé. Refusée : le produit doit apparaître sur un geste du créateur,
//    pas d'office.
// 2. Le détourage local (remplissage par diffusion depuis les bords) puis la
//    mise en décor. Sa photo réelle est prise sur un sol d'atelier : il
//    n'existe AUCUN fond uni à retirer. La diffusion n'avait rien à quoi
//    s'accrocher, et le garde-fou (entre 6 % et 94 % de pixels retirés) était
//    bien trop permissif : il a laissé passer un découpage qui n'en était pas
//    un, et le rectangle brut de la photo s'est retrouvé collé sur le décor,
//    par-dessus le texte des slides.
//
// LA LIMITE DE FOND n'a pas bougé : la génération d'images ne reçoit qu'un
// TEXTE, aucune image de référence (api/montage-media.js). Elle ne peut donc
// ni détourer une photo, ni la redessiner. « Un homme tenant CE produit »
// demanderait un modèle image-vers-image, que Scriptura n'a pas.
//
// CE QUI RESTE, ET QUI VAUT PAR SOI-MÊME : l'interdiction de DESSINER une
// imitation du produit. Une image générée en produirait un sosie, logo faux
// et étiquette en charabia ; sur un contenu de vente, un sosie est pire que
// rien, le client qui reçoit le vrai produit voit la différence.
//
// Ces tests verrouillent les deux moitiés de la décision :
//   - aucune photo produit n'est plus collée dans un visuel, nulle part ;
//   - aucune image générée n'a le droit de représenter le produit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

const SRC_STORYBOARD = lire('storyboard.js');
// eslint-disable-next-line no-eval
const regleProduit = eval('(' + SRC_STORYBOARD.match(/function regleProduitReelVisuels[\s\S]*?\n}/)[0]
  .replace('function regleProduitReelVisuels', 'function') + ')');

test('la règle anti-imitation existe toujours, et SEULEMENT si un produit est chargé', () => {
  assert.equal(regleProduit(false), '', 'sans produit, aucune consigne ne doit alourdir le prompt');
  const avec = regleProduit(true);
  assert.match(avec, /ne doit le représenter/, avec.slice(0, 160));
  assert.match(avec, /emballage/, 'les formes concrètes du produit doivent être nommées, pas seulement "le produit"');
  assert.match(avec, /logo/, 'le logo est justement ce qu\'une imitation rate toujours');
  assert.match(avec, /un sosie est pire que rien/,
    'la raison doit rester écrite dans le prompt : c\'est elle qui tient devant des consignes créatives insistantes');
});

test('le storyboard ne demande PLUS de marquer des plans pour la photo produit', () => {
  const avec = regleProduit(true);
  assert.ok(!/"produit": true/.test(avec),
    'REGRESSION : ce marquage servait à insérer la vraie photo, retirée à la demande du propriétaire');
  assert.ok(!/prompt de secours/.test(avec),
    'plus de prompt de secours à demander : il n\'existe plus de prompt principal contenant le produit');
  // Le format de réponse redevient une simple liste de chaînes.
  assert.ok(!/"produit":false/.test(SRC_STORYBOARD),
    'le gabarit JSON ne doit plus proposer la forme {prompt, produit}');
});

test('plus AUCUN code ne colle la photo produit dans un visuel', () => {
  for (const fichier of ['montage.js', 'carrousel.js', 'storyboard.js']) {
    const src = lire(fichier);
    for (const trace of ['injecterPhotoProduitMontage', 'detourerProduitCarrousel',
      'composerFondProduitCarrousel', 'photoProduitCarrousel', 'produitReel', 'photoProduit:']) {
      assert.ok(!src.includes(trace),
        'REGRESSION dans js/' + fichier + ' : "' + trace + '" fait revenir l\'insertion du produit, '
        + 'que le propriétaire a explicitement fait retirer');
    }
  }
});

test('le carrousel garde son fond sombre, et son fond généré ne contient que le décor', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    let decorB64 = null;
    let appels = 0;
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    const prompts = [];
    await page.route('**/api/montage-media**', async (route) => {
      appels++;
      let corps = {}; try { corps = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (corps.prompts) prompts.push(...corps.prompts);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: [{ base64: decorB64, mimeType: 'image/png' }], erreurs: [null] })
      });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);

    // Un décor PARFAITEMENT uni : si quoi que ce soit était collé dessus, le
    // fond reçu ne serait plus uniforme.
    decorB64 = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
      const g = cv.getContext('2d'); g.fillStyle = '#101828'; g.fillRect(0, 0, 1080, 1350);
      return cv.toDataURL('image/png').split(',')[1];
    });

    const vu = await page.evaluate(async () => {
      carrouselFormat = '4:5';
      carrouselQuotaImages = { illimite: true, used: 0, limite: 999 };
      // Un produit BIEN chargé : c'est tout l'objet du test, il ne doit
      // atterrir dans aucun visuel.
      carrouselVenteFichier = { base64: 'aW1hZ2U=', mediaType: 'image/png', nom: 'produit.png' };
      carrouselResultat = { titre: 'T', direction_visuelle: 'sobre', slides: [{
        numero: 1, gabarit: 'points', titre: 'T', visuel: 'une salle de sport sombre',
        points: [{ emoji: '🎯', titre: 'P', texte: 'x' }]
      }] };
      carrouselImages = [null];

      const avantClic = !!carrouselImages[0];
      await genererImageCarrousel(0);

      const charger = (url) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = url; });
      const im = await charger(carrouselImages[0].apercu);
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, im.width, im.height).data;
      let horsDecor = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (Math.abs(d[k] - 16) > 10 || Math.abs(d[k + 1] - 24) > 10 || Math.abs(d[k + 2] - 40) > 10) horsDecor++;
      }
      return {
        avantClic,
        partHorsDecor: Math.round((horsDecor / (im.width * im.height)) * 100),
        note: noteVisuelSlide(carrouselResultat.slides[0], 0)
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.avantClic, false, 'aucune slide ne reçoit d\'image toute seule');
    assert.equal(vu.partHorsDecor, 0,
      'REGRESSION : le fond reçu doit être EXACTEMENT le décor généré. ' + vu.partHorsDecor
      + '% des pixels en diffèrent, donc quelque chose y a été collé.');
    assert.match(vu.note, /une salle de sport sombre/,
      'la note doit décrire le visuel demandé, sans parler d\'un produit posé dedans');
    assert.ok(!prompts.some(p => /ZONE DÉGAGÉE/.test(p)),
      'REGRESSION : plus rien ne doit être posé dans le décor, donc plus de place à lui réserver');
    assert.equal(appels, 1, 'une image générée, une seule');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le bouton Rétablir survit au retrait : il n\'avait rien à voir avec le produit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    let decorB64 = null;
    let appels = 0;
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media**', async (route) => {
      appels++;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: [{ base64: decorB64, mimeType: 'image/png' }], erreurs: [null] })
      });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    decorB64 = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = 200; cv.height = 250;
      const g = cv.getContext('2d'); g.fillStyle = '#101828'; g.fillRect(0, 0, 200, 250);
      return cv.toDataURL('image/png').split(',')[1];
    });

    const vu = await page.evaluate(async () => {
      carrouselFormat = '4:5';
      carrouselQuotaImages = { illimite: true, used: 0, limite: 999 };
      carrouselVenteFichier = null;
      carrouselResultat = { titre: 'T', direction_visuelle: 'sobre', slides: [{
        numero: 1, gabarit: 'points', titre: 'T', visuel: 'une ambiance',
        points: [{ emoji: '🎯', titre: 'P', texte: 'x' }]
      }] };
      carrouselImages = [null];
      const etiquette = () => libelleBoutonFondCarrousel(0).replace(/<[^>]+>/g, '').trim();
      const avant = etiquette();
      await genererImageCarrousel(0);
      const apresGen = { bouton: etiquette(), aUnFond: !!carrouselImages[0] };
      const fond = carrouselImages[0].apercu;
      basculerFondCarrousel(0);
      const apresRetablir = { bouton: etiquette(), aUnFond: !!carrouselImages[0] };
      basculerFondCarrousel(0);
      const apresRemise = { aUnFond: !!carrouselImages[0], memeImage: carrouselImages[0].apercu === fond };
      return { avant, apresGen, apresRetablir, apresRemise };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(vu.avant, /Générer un fond/);
    assert.match(vu.apresGen.bouton, /^Rétablir$/,
      'après génération, le bouton ramène au fond sombre : ' + vu.apresGen.bouton);
    assert.equal(vu.apresRetablir.aUnFond, false, '"Rétablir" ramène vraiment la slide sur le fond sombre');
    assert.match(vu.apresRetablir.bouton, /Remettre le fond/,
      'le fond écarté est gardé : le regénérer ferait repayer ce qu\'on a déjà');
    assert.equal(vu.apresRemise.memeImage, true, 'et il revient à l\'identique');
    assert.equal(appels, 1, 'un aller-retour ne coûte QU\'UNE image générée');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

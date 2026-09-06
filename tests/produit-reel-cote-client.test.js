// Le maillon client de la photo produit (voir tests/produit-reel-dans-les-
// images.test.js pour le maillon serveur). C'est ici qu'une régression
// passerait SANS BRUIT : si le marquage d'un plan se perd en route, ou si la
// photo n'est plus jointe à l'appel, l'app ne casse pas, ne dit rien, et
// livre simplement des images sans le produit. Le créateur ne le découvre
// qu'en regardant ses images, c'est-à-dire trop tard.
//
// Les trois fonctions verrouillées ici sont les trois endroits où la chaîne
// peut se rompre :
//   photoProduitPourVisuels()  la photo est-elle utilisable comme référence
//   corpsImagesMontage()       part-elle avec les bons plans
//   corpsImageCarrousel()      idem côté carrousel
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

test('la photo produit ne part que si c\'est une IMAGE, jamais un PDF', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      const essai = (fichier) => {
        venteFichier = fichier;
        const p = photoProduitPourVisuels();
        return p ? p.mediaType : null;
      };
      return {
        photo: essai({ base64: 'AAAA', mediaType: 'image/jpeg', nom: 'produit.jpg' }),
        png: essai({ base64: 'AAAA', mediaType: 'image/png', nom: 'produit.png' }),
        pdf: essai({ base64: 'JVBER', mediaType: 'application/pdf', nom: 'brochure.pdf' }),
        rien: essai(null)
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(r.photo, 'image/jpeg', 'une photo de produit est utilisable');
    assert.equal(r.png, 'image/png', 'un PNG aussi');
    assert.equal(r.pdf, null,
      'REGRESSION : un PDF est retenu comme photo de produit. Une brochure nourrit très bien '
      + 'l\'écriture du script, mais elle ne se met pas dans la main de quelqu\'un : les plans seraient '
      + 'marqués « montre le produit » sans qu\'aucune photo ne parte, et le modèle inventerait un objet.');
    assert.equal(r.rien, null, 'sans fichier, rien à envoyer');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le montage joint la photo aux plans marqués, et à eux seuls', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      venteFichier = { base64: 'PHOTOPRODUIT', mediaType: 'image/jpeg', nom: 'montre.jpg' };
      const marque = { text: 'plan 1', visuel: 'a wrist wearing the product 9:16', produit: true };
      const ordinaire = { text: 'plan 2', visuel: 'a city at dawn 9:16', produit: false };
      const avec = corpsImagesMontage(['p1', 'p2'], '9:16', [marque, ordinaire]);
      const sansAucunMarquage = corpsImagesMontage(['p2'], '9:16', [ordinaire]);
      venteFichier = null;
      const sansPhoto = corpsImagesMontage(['p1'], '9:16', [marque]);
      return { avec, sansAucunMarquage, sansPhoto };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(r.avec.produit && r.avec.produit.base64 === 'PHOTOPRODUIT',
      'REGRESSION : la photo du produit ne part plus avec le lot. Toute la fonctionnalité tient à ça.');
    assert.deepEqual(r.avec.avecProduit, [true, false],
      'REGRESSION : le marquage envoyé ne correspond plus aux plans. Reçu : '
      + JSON.stringify(r.avec.avecProduit));

    assert.ok(!r.sansAucunMarquage.produit,
      'REGRESSION : la photo part alors qu\'AUCUN plan ne montre le produit. C\'est de l\'argent dépensé '
      + 'et une requête alourdie pour rien.');
    assert.ok(!r.sansPhoto.produit && !r.sansPhoto.avecProduit,
      'REGRESSION : un plan marqué part sans photo. Le prompt réclame « le produit de l\'image de '
      + 'référence » : sans référence, le modèle en invente un, et le créateur reçoit un faux produit.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le carrousel suit exactement la même règle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      carrouselVenteFichier = { base64: 'PHOTOSLIDE', mediaType: 'image/png', nom: 'creme.png' };
      const avec = corpsImageCarrousel(['p'], [{ produit: true }]);
      const sans = corpsImageCarrousel(['p'], [{ produit: false }]);
      carrouselVenteFichier = { base64: 'JVBER', mediaType: 'application/pdf', nom: 'ebook.pdf' };
      const pdf = corpsImageCarrousel(['p'], [{ produit: true }]);
      carrouselVenteFichier = null;
      return { avec, sans, pdf, usage: avec.usage };
    });

    assert.equal(r.usage, 'carrousel', 'le budget images du carrousel reste bien séparé de celui du montage');
    assert.ok(r.avec.produit && r.avec.produit.base64 === 'PHOTOSLIDE',
      'REGRESSION : une slide marquée part sans la photo du produit');
    assert.deepEqual(r.avec.avecProduit, [true]);
    assert.ok(!r.sans.produit, 'REGRESSION : la photo part sur une slide non marquée');
    assert.ok(!r.pdf.produit,
      'REGRESSION : un PDF part comme référence côté carrousel alors que le mode Script s\'en protège. '
      + 'Une garde qui n\'existe que d\'un côté finit toujours par manquer de l\'autre.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un storyboard sans produit ne marque jamais un plan', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    // Le modèle peut très bien renvoyer un plan marqué alors qu'aucune photo
    // n'a été chargée (il suit ses habitudes, pas notre état). Le marquage
    // doit alors être ignoré, sinon le prompt réclamerait une référence
    // inexistante.
    const r = await page.evaluate(async () => {
      window.callAI = async () => JSON.stringify({
        visuels: [{ prompt: 'a hand holding the product shown in the reference image 9:16', produit: true }]
      });
      const sansProduit = [{ text: 'un plan' }];
      await genererVisuelsParLots(sansProduit, 'TikTok', null, false);
      const avecProduit = [{ text: 'un plan' }];
      await genererVisuelsParLots(avecProduit, 'TikTok', null, true);
      return { sans: !!sansProduit[0].produit, avec: !!avecProduit[0].produit };
    });

    assert.equal(r.sans, false,
      'REGRESSION : un plan est marqué « montre le produit » alors qu\'aucune photo n\'a été chargée. '
      + 'Le prompt demanderait le produit d\'une image de référence qui n\'existe pas.');
    assert.equal(r.avec, true,
      'REGRESSION : le marquage du modèle est perdu alors qu\'une photo est bien là. Sans lui, aucune '
      + 'image ne montrera jamais le produit du créateur.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

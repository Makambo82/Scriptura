// Demande du propriétaire : « que le produit soit représenté exactement dans
// les slides et dans le montage, parce que c'est un produit à vendre ».
//
// LA LIMITE TECHNIQUE, vérifiée dans le code avant de promettre quoi que ce
// soit : la génération d'images n'envoie qu'un TEXTE au modèle (voir
// api/montage-media.js, aucune image de référence n'est transmise). Même avec
// la description la plus rigoureuse, elle produira un produit RESSEMBLANT,
// jamais celui du créateur : logo faux, étiquette en charabia, proportions
// différentes. Sur une vidéo ou un carrousel de VENTE, un sosie est pire que
// rien : le client qui reçoit le vrai produit voit la différence.
//
// D'où la décision, validée par le propriétaire : la vraie photo aux moments
// clés, et INTERDICTION aux images générées de représenter le produit. Elles
// filment la scène, le geste, l'émotion, le décor. Aucun sosie n'apparaît
// donc nulle part.
//
// Ce que ces tests verrouillent :
//  - la règle d'interdiction part bien aux deux générateurs de visuels
//    (storyboard du mode Script, et carrousel) QUAND un produit est chargé,
//    et seulement dans ce cas ;
//  - la vraie photo est posée sur les plans marqués, AVANT toute génération ;
//  - ces plans-là ne consomment PAS de quota d'images (le piège : la
//    génération remettait tout à zéro et refabriquait un faux produit) ;
//  - une image choisie à la main par le créateur n'est jamais écrasée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const SRC_STORYBOARD = fs.readFileSync(path.join(__dirname, '..', 'js', 'storyboard.js'), 'utf8');
// eslint-disable-next-line no-eval
const regleProduit = eval(SRC_STORYBOARD.match(/function regleProduitReelVisuels[\s\S]*?\n}/)[0]
  .replace('function regleProduitReelVisuels', 'function') && '(' + SRC_STORYBOARD.match(/function regleProduitReelVisuels[\s\S]*?\n}/)[0].replace('function regleProduitReelVisuels', 'function') + ')');

test('la règle anti-imitation n\'existe QUE si un produit est chargé', () => {
  assert.equal(regleProduit(false), '', 'sans produit, aucune consigne ne doit alourdir le prompt');
  const avec = regleProduit(true);
  assert.match(avec, /ne doit donc représenter ce produit/, avec.slice(0, 120));
  assert.match(avec, /emballage/, 'les formes concrètes du produit doivent être nommées, pas seulement "le produit"');
  assert.match(avec, /logo/, 'le logo est justement ce qu\'une imitation rate toujours');
});

test('la règle demande de MARQUER les plans qui devraient montrer le produit', () => {
  const avec = regleProduit(true);
  assert.match(avec, /"produit": true/,
    'sans marquage, on devrait deviner quels plans reçoivent la vraie photo');
  assert.match(avec, /prompt de secours/,
    'un prompt sans produit reste nécessaire si la photo devient indisponible');
});

test('le carrousel porte la même interdiction, et seulement avec un produit', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'carrousel.js'), 'utf8');
  assert.match(src, /PRODUIT RÉEL, RÈGLE ABSOLUE/,
    'le carrousel doit interdire lui aussi les imitations : ses slides vendent le produit');
  assert.match(src, /ctx\.venteFichier \? `/,
    'et cette consigne ne doit exister que si un produit est réellement chargé');
});

test('la vraie photo est posée sur les plans marqués, et JAMAIS générée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      // Un produit chargé, et un storyboard dont le plan 2 doit le montrer.
      venteFichier = { base64: 'ZmF1c3NlLXBob3Rv', mediaType: 'image/png', nom: 'produit.png' };
      ouvrirMontage([
        { text: 'Le problème vécu', visuel: 'a woman in a bathroom', produitReel: false },
        { text: 'Voici la solution', visuel: 'a hand reaching out', produitReel: true },
        { text: 'Passe à l\'action', visuel: 'morning light', produitReel: false }
      ], null);
      return {
        plans: montagePlans.map(p => !!p.produitReel),
        images: montageImages.map(im => (im && im.photoProduit) ? 'PHOTO PRODUIT' : (im ? 'autre' : 'vide'))
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(vu.plans, [false, true, false], 'le marquage du storyboard doit survivre à l\'ouverture du montage');
    assert.deepEqual(vu.images, ['vide', 'PHOTO PRODUIT', 'vide'],
      'REGRESSION : la vraie photo doit être posée d\'emblée sur le plan marqué, avant toute génération');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un plan servi par la vraie photo ne consomme AUCUN quota d\'images', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const promptsImages = [];
    await poserMocksReseau(page);
    await page.route('**/api/montage-media**', async (route) => {
      let corps = {};
      try { corps = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (corps && corps.prompts) promptsImages.push(...corps.prompts);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: (corps.prompts || []).map(() => ({ base64: 'ZmF1eA==', mimeType: 'image/png' })) })
      });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    await page.evaluate(async () => {
      venteFichier = { base64: 'ZmF1c3NlLXBob3Rv', mediaType: 'image/png', nom: 'produit.png' };
      ouvrirMontage([
        { text: 'Le problème', visuel: 'PROMPT SANS PRODUIT A', produitReel: false },
        { text: 'La solution', visuel: 'PROMPT DE SECOURS PRODUIT', produitReel: true }
      ], null);
      await genererImagesMontage();
    });
    await page.waitForTimeout(500);

    const etat = await page.evaluate(() => montageImages.map(im => (im && im.photoProduit) ? 'PHOTO PRODUIT' : (im ? 'generee' : 'vide')));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(!promptsImages.some(p => /SECOURS PRODUIT/.test(p)),
      'REGRESSION : le plan du produit repartait en génération, ce qui dépensait du quota POUR FABRIQUER UN FAUX PRODUIT : '
      + JSON.stringify(promptsImages));
    assert.deepEqual(etat, ['generee', 'PHOTO PRODUIT'],
      'la vraie photo doit survivre à la génération, qui remettait tout à zéro : ' + JSON.stringify(etat));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une image choisie À LA MAIN n\'est jamais remplacée par la photo produit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const etat = await page.evaluate(() => {
      venteFichier = { base64: 'ZmF1c3NlLXBob3Rv', mediaType: 'image/png', nom: 'produit.png' };
      ouvrirMontage([{ text: 'La solution', visuel: 'x', produitReel: true }], null);
      // Le créateur pose SA propre image sur ce plan, après coup.
      const octets = Uint8Array.from([1, 2, 3]);
      _assignerImageMontage(0, new File([octets], 'a-moi.png', { type: 'image/png' }));
      // Puis une nouvelle injection a lieu (ouverture, génération...).
      injecterPhotoProduitMontage();
      return montageImages.map(im => (im && im.photoProduit) ? 'photo produit' : (im && im.verrouilleParCreateur ? 'CHOIX DU CREATEUR' : 'autre'));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(etat, ['CHOIX DU CREATEUR'],
      'le geste du créateur est plus récent et plus intentionnel que notre règle automatique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

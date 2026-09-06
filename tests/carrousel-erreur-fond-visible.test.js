// Retour du propriétaire, premier vrai test de la photo produit : « quand
// j'ai généré un fond, le bouton devait passer à Rétablir, mais non ».
//
// Le bouton avait raison : il ne passe à « Rétablir » que si un fond existe,
// et la génération avait échoué. LE VRAI DÉFAUT EST QUE PERSONNE NE LE
// DISAIT. Le mode Carrousel n'avait qu'une seule boîte d'erreur, et elle vit
// DANS LE FORMULAIRE, que l'écran de résultat masque (voir renderCarrousel).
// Chaque message écrit dedans partait donc dans un élément invisible.
//
// Ce n'est pas un défaut de la photo produit : il touchait DÉJÀ le quota
// d'images épuisé, l'accès refusé et toute panne de génération. Un appui sur
// « Générer un fond » pouvait échouer en silence complet, ne laissant qu'un
// bouton qui ne changeait pas. C'est le pire genre de bug : l'app a l'air
// cassée sans jamais dire pourquoi, et le créateur recommence en pensant
// avoir mal cliqué.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrirResultats(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    chooseMode('carrousel');
    carrouselFormat = '4:5';
    carrouselQuotaImages = { illimite: true, used: 0, limite: 99 };
    carrouselResultat = normaliserResultatCarrousel({
      titre: 'T', direction_visuelle: 'sobre',
      slides: [{ numero: 1, gabarit: 'contenu', titre: 'X', visuel: 'une ambiance' }]
    });
    carrouselImages = [null];
    document.getElementById('carrouselResults').style.display = 'block';
    renderCarrousel();
  });
  await page.waitForTimeout(150);
}

// « Vu » au sens de l'utilisateur : présent, affiché, ET pas dans un parent
// masqué. offsetParent à null attrape précisément le cas de ce bug, une boîte
// correctement remplie à l'intérieur d'un formulaire caché.
const EST_VU = `(id) => {
  const e = document.getElementById(id);
  return !!(e && e.offsetParent !== null && e.style.display !== 'none' && e.textContent.trim());
}`;

test('un échec de génération de fond est VU sur l\'écran de résultat', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 430, height: 900 } });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media**', async (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ images: [null], erreurs: ['Panne du générateur d\'images'] })
    }));
    await ouvrirResultats(page, baseUrl);

    const vu = await page.evaluate(async (estVu) => {
      await genererImageCarrousel(0);
      const voir = eval('(' + estVu + ')');
      const boite = document.getElementById('carrouselErrorBoxResultats');
      return {
        visible: voir('carrouselErrorBoxResultats'),
        texte: boite ? boite.textContent : '',
        bouton: libelleBoutonFondCarrousel(0).replace(/<[^>]+>/g, '').trim()
      };
    }, EST_VU);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.visible, true,
      'REGRESSION : la génération a échoué et RIEN ne s\'affiche. Le créateur ne voit qu\'un bouton qui '
      + 'ne change pas, et croit que l\'app est cassée. Message posé : "' + vu.texte + '"');
    assert.match(vu.texte, /Panne du générateur/,
      'le message doit porter la VRAIE raison remontée, pas un texte générique : ' + vu.texte);
    assert.match(vu.texte, /Slide 1/, 'et dire de quelle slide il s\'agit');
    assert.equal(vu.bouton, 'Générer un fond',
      'le bouton reste sur "Générer un fond" : il n\'y a pas de fond à rétablir, c\'est correct');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le message survit au rendu qui suit immédiatement l\'échec', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 430, height: 900 } });
    await poserMocksReseau(page);
    await page.route('**/api/montage-media**', async (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ images: [null], erreurs: ['Quota atteint'] })
    }));
    await ouvrirResultats(page, baseUrl);

    // Toute génération finit par un renderCarrousel qui reconstruit la zone.
    // Un message posé seulement dans le DOM disparaîtrait une milliseconde
    // après son affichage : c'est le même piège que le bug d'origine, en plus
    // discret, et il serait indétectable à l'œil.
    const vu = await page.evaluate(async (estVu) => {
      await genererImageCarrousel(0);
      renderCarrousel();
      renderCarrousel();
      const voir = eval('(' + estVu + ')');
      return { apresRendus: voir('carrouselErrorBoxResultats') };
    }, EST_VU);

    assert.equal(vu.apresRendus, true,
      'REGRESSION : le message disparaît au premier rendu de la zone. Or CHAQUE génération se termine '
      + 'par un rendu : le créateur n\'aurait jamais le temps de le lire.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une nouvelle tentative efface le message précédent', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 430, height: 900 } });
    await poserMocksReseau(page);
    let echouer = true;
    await page.route('**/api/montage-media**', async (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: echouer
        ? JSON.stringify({ images: [null], erreurs: ['Panne passagère'] })
        : JSON.stringify({ images: [{ base64: 'iVBORw0KGgo=', mimeType: 'image/png' }], erreurs: [null] })
    }));
    await ouvrirResultats(page, baseUrl);

    await page.evaluate(async () => { await genererImageCarrousel(0); });
    echouer = false;
    const vu = await page.evaluate(async (estVu) => {
      await genererImageCarrousel(0);
      const voir = eval('(' + estVu + ')');
      return {
        messageEncoreLa: voir('carrouselErrorBoxResultats'),
        bouton: libelleBoutonFondCarrousel(0).replace(/<[^>]+>/g, '').trim()
      };
    }, EST_VU);

    assert.equal(vu.messageEncoreLa, false,
      'REGRESSION : l\'erreur de la tentative précédente reste affichée alors que la suivante a réussi. '
      + 'Le créateur croirait que son fond n\'est pas là alors qu\'il vient d\'arriver.');
    assert.equal(vu.bouton, 'Rétablir',
      'REGRESSION : le fond est arrivé mais le bouton ne propose pas de revenir en arrière. C\'est '
      + 'exactement le symptôme signalé par le propriétaire, cette fois sans excuse.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

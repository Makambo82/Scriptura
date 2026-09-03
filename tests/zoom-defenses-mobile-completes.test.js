// Retour créateur du 3 septembre 2026 : le "petit zoom avant" au clic dans
// un champ persistait malgré le correctif précédent (verrouillage de la
// balise viewport au focus, voir js/navigation.js). Recherche faite avant de
// recorriger à l'aveugle : la technique de bascule dynamique de la balise
// viewport est documentée comme non fiable sur les navigateurs mobiles
// actuels (Safari et Chrome l'ignorent de plus en plus, pour des raisons
// d'accessibilité). La vraie cause documentée et vérifiable est le
// font-size < 16px sur le champ ciblé, déjà correct partout ici (vérifié à
// nouveau ci-dessous par mesure réelle, pas juste une lecture du CSS
// source), plus deux causes annexes réelles et jusque-là absentes :
//   1. text-size-adjust:100% manquant : sans lui, WebKit peut appliquer sa
//      propre inflation automatique du texte sur mobile, qui fait varier la
//      taille RENDUE d'un champ indépendamment de son font-size déclaré.
//   2. interactive-widget=resizes-content manquant sur la balise viewport :
//      sans lui, l'ouverture du clavier virtuel ne redimensionne QUE le
//      "visual viewport" (jamais la mise en page), ce qui donne souvent une
//      impression de zoom (rétrécissement + recentrage automatique) même
//      quand il n'y a pas de vrai zoom de page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Mobile : text-size-adjust verrouillé à 100% sur <html>, pas d\'inflation automatique WebKit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);
    const valeur = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return cs.webkitTextSizeAdjust || cs.textSizeAdjust || '';
    });
    assert.equal(valeur, '100%', 'text-size-adjust doit être verrouillé à 100% sur <html>, pour empêcher l\'inflation automatique de texte de WebKit sur mobile');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Mobile : la balise viewport déclare interactive-widget=resizes-content dès le chargement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);
    const contenu = await page.evaluate(() => document.querySelector('meta[name="viewport"]').getAttribute('content'));
    assert.match(contenu, /interactive-widget=resizes-content/,
      'la mise en page doit se redimensionner avec le clavier virtuel, pour éviter l\'impression de zoom due au rétrécissement du visual viewport');
    assert.match(contenu, /width=device-width/, 'ne doit jamais perdre le réglage de largeur de base en ajoutant interactive-widget');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Mobile : tous les champs de saisie de l\'app rendent à 16px ou plus (seuil réel anti-zoom iOS/Chrome)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    // Viewport et pixel ratio d'un vrai téléphone : une mesure sur viewport
    // desktop pourrait passer une media query qui échouerait sur mobile.
    const page = await navigateur.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'ZOOMFONTAUDIT1', plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.body.classList.add('is-admin'));

    const champsSousLeSeuil = await page.evaluate(() => {
      // Révèle tous les écrans ET tous les sous-panneaux masqués par défaut,
      // pour mesurer chaque champ dans son état réel de rendu (un champ
      // caché par display:none peut fausser getComputedStyle).
      TOUS_LES_ECRANS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('display', 'block', 'important');
      });
      document.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach(el => {
        el.style.setProperty('display', 'block', 'important');
      });

      return Array.from(document.querySelectorAll('input, textarea, select'))
        .filter(el => !['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].includes(el.type))
        .map(el => ({ id: el.id || '(sans id)', classe: el.className || '', fontSizePx: parseFloat(getComputedStyle(el).fontSize) }))
        .filter(r => r.fontSizePx < 16);
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.deepEqual(champsSousLeSeuil, [],
      'tout champ sous 16px déclenche le zoom automatique natif au focus (iOS ET Chrome) : ' + JSON.stringify(champsSousLeSeuil));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

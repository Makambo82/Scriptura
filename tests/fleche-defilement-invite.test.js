// Décision du propriétaire, prise après avoir comparé trois rendus en
// captures : « la flèche nue avec ombre portée, mais pas statique. La flèche
// fait de petits bonds bas-haut pour signifier à l'utilisateur qu'il y a des
// choses intéressantes à découvrir en scrollant. Mais la flèche devient figée
// quand elle pointe vers le haut. »
//
// CE QUI L'A AMENÉ LÀ, et pourquoi c'est juste. La flèche était un disque
// doré plein, du même poids visuel que le bouton de création : deux ors
// pleins côte à côte, l'œil ne savait plus lequel portait l'action. Material
// ne prévoit qu'UNE action principale par écran, c'est le « + ».
//
// Et la règle des deux états rejoint exactement ce que dit la recherche :
//  - VERS LE BAS, la flèche est un signifiant contre le faux fond. Un héro
//    plein écran fait croire que la page s'arrête là (l'illusion de
//    complétude du Nielsen Norman Group), et c'est mesuré ici : le bouton
//    « Commence gratuitement » est hors écran à l'arrivée sur tous les
//    téléphones testés. Le mouvement est ce qui attire l'œil vers le bas ;
//  - VERS LE HAUT, elle se fige. Le NN/g demande explicitement qu'un bouton
//    de retour en haut reste IMMOBILE une fois affiché, un élément qui bouge
//    captant l'attention en continu alors qu'il ne propose plus rien.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const lireFleche = () => {
  const btn = document.getElementById('scrollTopBtn');
  const ico = document.getElementById('scrollTopIcon');
  const st = getComputedStyle(ico);
  const stBtn = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    invite: btn.classList.contains('invite'),
    animation: st.animationName,
    rotation: ico.style.transform || '',
    largeur: Math.round(r.width),
    hauteur: Math.round(r.height),
    fond: stBtn.backgroundColor,
    bordure: stBtn.borderTopWidth,
    ombre: stBtn.filter,
    atteignable: !!dessus && (dessus === btn || btn.contains(dessus)),
    titre: btn.getAttribute('title')
  };
};

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  return page;
}

test('vers le BAS elle invite : elle bondit, sans rotation', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(lireFleche);
    // Amplitude RÉELLE du bond, mesurée sur douze instants : une classe CSS
    // posée sans que rien ne bouge passerait un test qui ne lit que la classe.
    const positions = [];
    for (let i = 0; i < 12; i++) {
      positions.push(await page.evaluate(
        () => Math.round(document.getElementById('scrollTopIcon').getBoundingClientRect().top * 10) / 10));
      await page.waitForTimeout(160);
    }
    const amplitude = Math.max(...positions) - Math.min(...positions);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.invite, true, 'à l\'arrivée, la flèche pointe vers le bas et doit inviter');
    assert.equal(vu.animation, 'flecheInvite', 'l\'animation d\'invitation doit tourner');
    assert.equal(vu.rotation, '', 'vers le bas, aucune rotation : c\'est le sens naturel du dessin');
    assert.ok(amplitude >= 3,
      'REGRESSION : la flèche ne bouge pas réellement (amplitude mesurée ' + amplitude.toFixed(1) + ' px). '
      + 'Une classe posée sans mouvement ne signifie rien pour le créateur.');
    assert.match(vu.titre, /Descendre/);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('vers le HAUT elle se fige, comme le demande la recherche', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 1200)); // on remonte
    await page.waitForTimeout(500);

    const vu = await page.evaluate(lireFleche);
    const positions = [];
    for (let i = 0; i < 8; i++) {
      positions.push(await page.evaluate(
        () => Math.round(document.getElementById('scrollTopIcon').getBoundingClientRect().top * 10) / 10));
      await page.waitForTimeout(160);
    }
    const amplitude = Math.max(...positions) - Math.min(...positions);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.invite, false, 'en pointant vers le haut, elle n\'invite plus à rien');
    assert.equal(vu.animation, 'none',
      'REGRESSION : un bouton de retour en haut qui bouge distrait en continu');
    assert.equal(vu.rotation, 'rotate(180deg)', 'et elle doit bien pointer vers le haut');
    assert.equal(amplitude, 0, 'REGRESSION : elle doit être parfaitement immobile, mesuré : ' + amplitude);
    assert.match(vu.titre, /Remonter/);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('nue et ombrée, mais toujours aussi facile à viser au pouce', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const vu = await page.evaluate(lireFleche);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    // Le fond disparaît, le contour aussi : c'est tout l'objet du changement.
    assert.match(vu.fond, /rgba\(0, 0, 0, 0\)|transparent/,
      'REGRESSION : le disque doré revenu ferait de nouveau concurrence au bouton de création');
    assert.equal(vu.bordure, '0px', 'ni disque, ni contour');
    assert.match(vu.ombre, /drop-shadow/,
      'REGRESSION : sans ombre, la flèche disparaît sur les sections illustrées (vérifié sur la '
      + 'galerie de vidéos de l\'accueil, elle atterrissait sur un visage)');
    // LA borne à ne jamais franchir : 44 px, minimum recommandé par Apple
    // comme par Material. Seul le DESSIN a rétréci, pas la zone tactile.
    assert.ok(vu.largeur >= 44 && vu.hauteur >= 44,
      'REGRESSION : zone tactile tombée à ' + vu.largeur + 'x' + vu.hauteur
      + ', sous le minimum de 44 px. La flèche deviendrait pénible à viser au pouce.');
    assert.equal(vu.atteignable, true,
      'un doigt posé au centre doit atteindre la flèche, pas un calque au-dessus');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mouvement réduit demandé par le système : plus aucun bond', () => {
  // Vérifié sur la feuille de style plutôt qu'en navigateur : Playwright sait
  // émuler prefers-reduced-motion, mais la garantie qui compte est que la
  // règle soit ÉCRITE sous la bonne condition, comme les 22 autres animations
  // de l'app.
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const i = css.indexOf('#scrollTopBtn.invite');
  assert.ok(i > 0, 'la règle d\'animation doit exister');
  const avant = css.slice(Math.max(0, i - 400), i);
  assert.match(avant, /@media\(prefers-reduced-motion:no-preference\)\s*\{[^}]*$/,
    'REGRESSION : l\'animation doit rester sous prefers-reduced-motion, comme le reste de l\'app');
});

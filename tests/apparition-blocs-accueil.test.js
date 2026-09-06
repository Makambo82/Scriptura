// Retour du propriétaire : « Ce que j'avais en tête c'est accentuer l'effet
// d'apparition des blocs de la page d'accueil. Actuellement c'est trop subtil
// donc très peu visible. »
//
// DEUX CAUSES, mesurées dans un vrai navigateur avant de toucher au CSS :
//  1. la course était courte (18 px vers le haut, 36 px sur les côtés) et,
//     sur une carte de 300 px de large, un déplacement de 18 px ne se voit
//     pas : l'oeil lit un fondu, pas une arrivée ;
//  2. surtout, le déclencheur était posé à 40 px du bas de l'écran. Un bloc
//     commençait donc son animation alors qu'il touchait à peine le bord
//     bas : le temps que le défilement l'amène là où on le regarde, elle
//     était déjà terminée. L'animation existait, personne ne la voyait.
//
// Ce test verrouille les deux : la course réelle (mesurée sur l'animation
// figée, pas lue dans le CSS) et le fait que l'apparition se déclenche
// DANS l'écran et pas à son bord.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  return page;
}

test('un bloc ARRIVE vraiment : course ample et léger passage d\'échelle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // On fige l'animation à son tout début (currentTime = 0) plutôt que de
    // lire le CSS : c'est ce que le navigateur applique réellement.
    const debut = await page.evaluate(() => {
      const e = document.querySelector('.how-step');
      e.classList.remove('visible');
      void document.body.offsetHeight;
      e.classList.add('visible');
      const anims = e.getAnimations();
      anims.forEach(a => { a.pause(); a.currentTime = 0; });
      const cs = getComputedStyle(e);
      const m = new DOMMatrix(cs.transform);
      return { anims: anims.length, opacite: cs.opacity, y: Math.abs(m.m42), echelle: m.m11 };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(debut.anims, 1, 'le bloc doit bien porter une animation d\'apparition');
    assert.equal(debut.opacite, '0', 'il part invisible');
    assert.ok(debut.y >= 36,
      'REGRESSION : course verticale de ' + Math.round(debut.y) + ' px seulement. '
      + 'En dessous de 36 px, le créateur voit un fondu, pas un bloc qui arrive.');
    assert.ok(debut.echelle <= 0.96 && debut.echelle >= 0.9,
      'REGRESSION : le passage d\'échelle (mesuré ' + debut.echelle + ') doit rester '
      + 'entre 0,90 et 0,96 : en dessous ça devient un zoom, au-dessus ça ne se sent plus.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la cascade entre blocs voisins reste lisible', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const decalages = await page.evaluate(() => {
      const lis = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        e.classList.add('visible');
        return parseFloat(getComputedStyle(e).animationDelay) || 0;
      };
      return { d1: lis('.reveal-d1'), d2: lis('.reveal-d2') };
    });

    assert.ok(decalages.d1 >= 0.1,
      'REGRESSION : cascade de ' + decalages.d1 + ' s entre deux blocs. En dessous de '
      + '0,1 s ils arrivent quasi ensemble et la cascade ne se lit plus.');
    assert.ok(decalages.d2 > decalages.d1, 'la cascade doit bien s\'échelonner');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'apparition se joue DANS l\'écran, pas à son bord', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);

    // On amène un bloc encore jamais révélé à un endroit précis : assez
    // dépassé du bas pour que l'ANCIEN réglage (déclencheur à 40 px du bord,
    // seuil 0,15) l'aurait déjà lancé, mais encore trop bas pour le nouveau.
    // C'est ce qui rend ce test discriminant : posé plus haut ou plus bas, il
    // passerait avec les deux réglages et ne garantirait rien.
    const prepare = await page.evaluate(() => {
      const e = Array.from(document.querySelectorAll('.how-step'))
        .find(el => !el.classList.contains('visible'));
      if (!e) return null;
      e.id = 'blocTemoinReveal';
      const r = e.getBoundingClientRect();
      const expose = 0.3 * r.height; // 30 % du bloc au-dessus de l'ancienne ligne
      window.scrollTo(0, window.scrollY + r.top - (window.innerHeight - 40 - expose));
      return { hauteur: r.height, ecran: window.innerHeight };
    });
    assert.ok(prepare, 'il faut un bloc non encore révélé pour mesurer le déclencheur');
    // Sans cette marge, la position choisie ne distinguerait plus les deux
    // réglages et le test deviendrait un faux témoin.
    assert.ok(prepare.hauteur < prepare.ecran * 0.46,
      'bloc témoin trop haut (' + Math.round(prepare.hauteur) + ' px) pour départager '
      + 'les deux réglages : il faut en choisir un autre plutôt que de faire semblant.');
    await page.waitForTimeout(400);

    const auBord = await page.evaluate(
      () => document.getElementById('blocTemoinReveal').classList.contains('visible'));
    assert.equal(auBord, false,
      'REGRESSION : le bloc s\'anime alors qu\'il dépasse à peine du bas de l\'écran. '
      + 'L\'animation sera finie avant que le créateur la regarde.');

    // Puis franchement dans l'écran : là, il doit apparaître.
    await page.evaluate(() => {
      const e = document.getElementById('blocTemoinReveal');
      window.scrollTo(0, window.scrollY + e.getBoundingClientRect().top - window.innerHeight * 0.55);
    });
    await page.waitForTimeout(500);
    const dansEcran = await page.evaluate(
      () => document.getElementById('blocTemoinReveal').classList.contains('visible'));
    assert.equal(dansEcran, true,
      'REGRESSION : le bloc reste invisible alors qu\'il est bien dans l\'écran. '
      + 'Un contenu caché est bien pire qu\'une animation trop discrète.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

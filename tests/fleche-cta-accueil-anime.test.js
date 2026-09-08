// Demande du propriétaire, capture à l'appui : « que la flèche pointant vers
// la droite fasse de petits mouvements gauche-droite comme le fait le bouton
// de défilement ».
//
// LE TEST MESURE LE DÉPLACEMENT RÉEL sur un cycle complet, il ne se contente
// pas de lire le nom de l'animation. Une règle @keyframes peut exister, être
// bien nommée, et ne rien déplacer du tout : keyframes vide, propriété non
// animable, ou transform écrasé par une règle plus spécifique. Ce qui compte,
// c'est que la flèche bouge à l'écran.
//
// TROIS CHOSES SONT VERROUILLÉES, et chacune vient d'un choix :
//   1. la FLÈCHE bouge, son DISQUE BLANC non ;
//   2. le rythme est celui du bouton de défilement, comparé à lui plutôt qu'à
//      une valeur écrite en dur ;
//   3. rien ne bouge sous prefers-reduced-motion.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrirAccueil(navigateur, baseUrl, options = {}) {
  const page = await navigateur.newPage(
    Object.assign({ viewport: { width: 414, height: 900 } }, options));
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return page;
}

// Échantillonne une position sur un cycle complet (1.9s) : douze relevés
// espacés de 160ms couvrent l'aller ET le retour.
async function amplitudeX(page, selecteur) {
  const xs = [];
  for (let i = 0; i < 12; i++) {
    xs.push(await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().left : null;
    }, selecteur));
    await page.waitForTimeout(160);
  }
  assert.ok(xs.every(x => x !== null), 'élément introuvable : ' + selecteur);
  return Math.max(...xs) - Math.min(...xs);
}

test('la flèche du bouton d\'accueil va et vient, son disque reste en place', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const bougeFleche = await amplitudeX(page, '.hero-cta-arrow svg');
    assert.ok(bougeFleche >= 2,
      'REGRESSION : la flèche du bouton d\'accueil ne se déplace plus que de '
      + Math.round(bougeFleche * 100) / 100 + 'px sur un cycle complet. Une règle @keyframes peut '
      + 'exister, être bien nommée, et ne rien déplacer : keyframes vide, ou transform écrasé par '
      + 'une règle plus spécifique. C\'est le mouvement à l\'écran qui était demandé.');

    assert.ok(bougeFleche <= 8,
      'REGRESSION : la flèche parcourt ' + Math.round(bougeFleche * 100) / 100 + 'px. Le '
      + 'propriétaire a demandé de PETITS mouvements : au-delà, ce n\'est plus une invitation, '
      + 'c\'est un élément qui gigote et qui capte l\'attention en continu.');

    // Le disque blanc fait 42px dans une pilule de 46 : le faire glisser
    // l'aurait fait paraître mal fixé. C'est la flèche qui bouge à l'intérieur.
    const bougeDisque = await amplitudeX(page, '.hero-cta-arrow');
    assert.ok(bougeDisque < 0.5,
      'REGRESSION : c\'est le DISQUE BLANC qui se déplace (' + Math.round(bougeDisque * 100) / 100
      + 'px), et pas la flèche à l\'intérieur. Le disque remplit presque toute la hauteur de la '
      + 'pilule : le voir glisser donne l\'impression qu\'il est mal fixé.');

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('elle bat au même rythme que la flèche de défilement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl);

    // COMPARÉ À L'AUTRE FLÈCHE, jamais à « 1.9s » écrit en dur : c'est
    // précisément ce que le propriétaire a demandé (« comme le fait le bouton
    // de défilement »). Le jour où l'une des deux changera de rythme, l'autre
    // devra suivre, et c'est ce test qui le dira.
    const vu = await page.evaluate(() => {
      const lire = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { duree: s.animationDuration, timing: s.animationTimingFunction,
          iter: s.animationIterationCount, nom: s.animationName };
      };
      return { cta: lire('.hero-cta-arrow svg'), defilement: lire('#scrollTopIcon') };
    });

    assert.ok(vu.cta && vu.defilement, 'les deux flèches doivent exister sur l\'accueil');
    assert.equal(vu.cta.duree, vu.defilement.duree,
      'REGRESSION : les deux flèches de l\'accueil ne battent plus au même rythme (' + vu.cta.duree
      + ' contre ' + vu.defilement.duree + '). Deux mouvements de cadences différentes sur le même '
      + 'écran se disputent l\'attention au lieu de la guider.');
    assert.equal(vu.cta.timing, vu.defilement.timing,
      'REGRESSION : les deux flèches n\'ont plus la même courbe d\'accélération (' + vu.cta.timing
      + ' contre ' + vu.defilement.timing + ').');
    assert.equal(vu.cta.iter, 'infinite',
      'REGRESSION : la flèche du bouton d\'accueil ne bat plus en continu (' + vu.cta.iter + ').');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('rien ne bouge quand le système demande moins de mouvement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, { reducedMotion: 'reduce' });

    // prefers-reduced-motion n'est pas une préférence de goût : des gens
    // l'activent pour des vertiges ou des migraines. Le bouton reste
    // parfaitement compréhensible immobile.
    const vu = await page.evaluate(() => ({
      cta: getComputedStyle(document.querySelector('.hero-cta-arrow svg')).animationName,
      defilement: getComputedStyle(document.getElementById('scrollTopIcon')).animationName
    }));

    assert.equal(vu.cta, 'none',
      'REGRESSION : la flèche du bouton d\'accueil continue de bouger alors que le système demande '
      + 'de réduire les animations. Vu : ' + vu.cta);
    assert.equal(vu.defilement, 'none',
      'et la flèche de défilement respecte la même règle : ' + vu.defilement);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('elle se fige quand le panneau « créer » est ouvert', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl);

    // Même règle que la flèche de défilement, déjà en place : à cet instant le
    // bouton d'accueil est derrière un fond assombri. Ce qui n'invite plus se
    // fige, sinon ça ne fait que disputer l'attention au panneau ouvert.
    const vu = await page.evaluate(() => {
      const avant = getComputedStyle(document.querySelector('.hero-cta-arrow svg')).animationName;
      document.body.classList.add('creer-ouvert');
      const pendant = getComputedStyle(document.querySelector('.hero-cta-arrow svg')).animationName;
      document.body.classList.remove('creer-ouvert');
      const apres = getComputedStyle(document.querySelector('.hero-cta-arrow svg')).animationName;
      return { avant, pendant, apres };
    });

    assert.notEqual(vu.avant, 'none', 'la flèche doit bouger quand le panneau est fermé');
    assert.equal(vu.pendant, 'none',
      'REGRESSION : la flèche continue de battre derrière le panneau « créer » ouvert, sous un '
      + 'fond assombri. Elle n\'invite plus à rien à cet instant, les modes sont déjà affichés : '
      + 'elle ne fait que disputer l\'attention au panneau. Vu : ' + vu.pendant);
    assert.equal(vu.apres, vu.avant,
      'et elle repart quand on referme le panneau : ' + vu.apres);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

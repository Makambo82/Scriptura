// Retour du propriétaire : « le bouton qui déploie les boutons du héro
// n'apparaît sur l'accueil que quand le scroll dépasse le bouton qui ouvre le
// héro. Un utilisateur déjà habitué à l'app voudra commencer à créer sans
// avoir à scroller. Ça crée de la friction. Que le bouton + soit visible dès
// qu'on monte sur l'app. »
//
// MESURÉ EN NAVIGATEUR AVANT DE TOUCHER À QUOI QUE CE SOIT, et c'était pire
// que décrit : le bouton « Commence gratuitement » du héro se trouve à 1024 px
// du haut, sur des écrans de 780 à 932 px. Il est donc HORS ÉCRAN à l'arrivée
// sur les trois appareils testés. Un créateur qui ouvrait l'app n'avait
// AUCUN point d'entrée visible vers la création.
//
// L'intention d'origine de la règle restait valable (ne pas proposer un
// raccourci vers les modes quand les modes sont déjà là) mais elle était trop
// large : elle cachait aussi le bouton quand rien n'était affiché. On teste
// donc exactement la bonne condition, et rien de plus.
//
// LE CHEVAUCHEMENT, l'autre moitié du problème. Un bouton fixe survole
// forcément le contenu, à toutes les positions de défilement : au repos il
// tombait pile sur la carte du compteur et la tranchait (4 px sur iPhone 14,
// 11 px sur un Android compact). Deux pistes essayées puis ÉCARTÉES, notées
// ici pour qu'on ne les refasse pas :
//   - remonter le compteur : le bouton se posait alors sur le TEXTE du
//     sous-titre, 38 px en plein milieu d'une phrase. Pire ;
//   - resserrer les espaces du héro : mieux, mais 8 px restaient sur petit
//     écran, pour un rythme de héro abîmé.
// Retenu, après avoir montré les trois rendus au propriétaire : on ne déplace
// RIEN, le bas de l'écran s'assombrit en dégradé. Le contenu s'y efface au
// lieu d'être coupé net.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrirAccueil(navigateur, baseUrl, w, h) {
  const page = await navigateur.newPage({ viewport: { width: w, height: h } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return page;
}

const etat = () => ({
  plus: document.getElementById('creerBtn').classList.contains('visible'),
  fondu: document.body.classList.contains('creer-visible')
});

test('le « + » est là DÈS L\'ARRIVÉE sur l\'accueil, sans avoir à scroller', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    for (const [w, h] of [[390, 844], [360, 780]]) {
      const page = await ouvrirAccueil(navigateur, baseUrl, w, h);
      const erreursJs = [];
      page.on('pageerror', e => erreursJs.push(e.message));

      const vu = await page.evaluate((f) => {
        const e = eval('(' + f + ')')();
        const btn = document.getElementById('creerBtn');
        const r = btn.getBoundingClientRect();
        return Object.assign(e, {
          scroll: window.scrollY,
          dansLEcran: r.bottom <= innerHeight + 1 && r.top >= 0,
          // Le bouton du héro, lui, est bien hors écran : c'est le constat qui
          // a motivé tout ça, et il doit rester vrai tant que le héro n'a pas
          // été raccourci.
          ctaHeroHorsEcran: document.getElementById('heroCta').getBoundingClientRect().top > innerHeight
        });
      }, etat.toString());

      assert.deepEqual(erreursJs, [], 'aucune erreur JS en ' + w + 'px');
      assert.equal(vu.scroll, 0, 'on doit bien être en haut de page');
      assert.equal(vu.plus, true,
        'REGRESSION en ' + w + 'px : le bouton de création doit être visible sans scroller');
      assert.equal(vu.dansLEcran, true, 'et entièrement dans l\'écran');
      assert.equal(vu.fondu, true,
        'le fondu bas accompagne le bouton : sans lui, le bouton tranche la carte du compteur');
      assert.equal(vu.ctaHeroHorsEcran, true,
        'constat de départ en ' + w + 'px : le bouton du héro est hors écran à l\'arrivée, '
        + 'c\'est bien pour ça que le « + » doit être là');
      await page.close();
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('il s\'efface UNIQUEMENT pendant que les modes du héro sont à l\'écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 390, 844);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const avant = await page.evaluate((f) => eval('(' + f + ')')(), etat.toString());
    await page.evaluate(() => revelerModes());
    await page.waitForTimeout(500);
    const pendant = await page.evaluate((f) => eval('(' + f + ')')(), etat.toString());
    // On redescend loin sous les modes : le raccourci redevient utile.
    await page.evaluate(() => window.scrollTo(0, 2400));
    await page.waitForTimeout(400);
    const apres = await page.evaluate((f) => eval('(' + f + ')')(), etat.toString());

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(avant.plus, true, 'visible à l\'arrivée');
    assert.equal(pendant.plus, false,
      'REGRESSION : proposer un raccourci vers les modes pendant que les modes sont à l\'écran '
      + 'ne sert à rien et les recouvre');
    assert.equal(pendant.fondu, false, 'et le fondu s\'en va avec lui, rien à protéger');
    assert.equal(apres.plus, true,
      'REGRESSION : une fois les modes passés, le raccourci redevient utile');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le fondu ne bloque aucun geste et reste sous les boutons', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 390, 844);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const st = getComputedStyle(document.body, '::after');
      const btn = getComputedStyle(document.getElementById('creerBtn'));
      const r = document.getElementById('creerBtn').getBoundingClientRect();
      return {
        pointerEvents: st.pointerEvents,
        zFondu: parseInt(st.zIndex, 10),
        zBouton: parseInt(btn.zIndex, 10),
        // Le point au centre du bouton doit bien atteindre le bouton, pas le
        // fondu : c'est le vrai test, pas la valeur CSS.
        // closest : au centre du bouton on tombe sur le SVG du « + », pas sur
        // le <button> lui-même. Ce qui compte est qu'on soit DANS le bouton.
        cible: (() => {
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!el) return 'rien';
          return el.closest('#creerBtn') ? 'creerBtn' : (el.id || el.tagName);
        })()
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.pointerEvents, 'none',
      'REGRESSION : un fondu qui intercepte les gestes rendrait le bas de l\'écran mort');
    assert.ok(vu.zFondu < vu.zBouton,
      'le fondu doit rester SOUS les boutons flottants (' + vu.zFondu + ' vs ' + vu.zBouton + ')');
    assert.equal(vu.cible, 'creerBtn',
      'un doigt au centre du bouton doit atteindre le bouton, pas le fondu : ' + vu.cible);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

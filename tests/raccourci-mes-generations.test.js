// Demande du propriétaire : un bouton « Mes générations » à côté de celui du
// panneau latéral, réservé aux abonnés (Creator, Pro) et au fondateur, et
// SANS cadre contrairement au bouton du tiroir.
//
// C'est l'écran que les abonnés rouvrent le plus souvent, et il était à deux
// gestes : ouvrir le tiroir, puis viser la première entrée.
//
// CE QUE CES TESTS VERROUILLENT :
//   1. il n'apparaît QUE pour un abonné. Un non-abonné n'a rien à y
//      retrouver, et un porteur de jeton n'est pas un abonné ;
//   2. il ouvre bien l'historique, et en respectant la pile de retour ;
//   3. il n'est PAS encadré, alors que son voisin l'est. C'est la demande
//      explicite, et c'est ce qui garde le tiroir comme repère principal ;
//   4. sa cible tactile reste la même que celle du tiroir : un bouton
//      visuellement plus léger mais plus petit à toucher serait raté.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'CELINE7F2A';

async function ouvrir(navigateur, baseUrl, abonne) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(({ code, abonne }) => {
    if (abonne) {
      localStorage.setItem('scriptura_code', code);
      localStorage.setItem('scriptura_unlocked', 'true');
      unlocked = true;
      document.body.classList.add('is-unlocked');
    } else {
      localStorage.removeItem('scriptura_code');
      localStorage.setItem('scriptura_unlocked', 'false');
      unlocked = false;
      document.body.classList.remove('is-unlocked');
    }
  }, { code: CODE, abonne: abonne });
  await page.waitForTimeout(150);
  return page;
}

const mesures = (page) => page.evaluate(() => {
  const btn = document.getElementById('navGenerationsBtn');
  const menu = document.getElementById('menuToggleBtn');
  if (!btn || !menu) return { absent: true };
  const s = getComputedStyle(btn);
  const sm = getComputedStyle(menu);
  const r = btn.getBoundingClientRect();
  const rm = menu.getBoundingClientRect();
  return {
    visible: s.display !== 'none' && r.width > 0,
    // Le CADRE : c'est la demande explicite du propriétaire. On lit la
    // largeur de bordure calculée, pas la déclaration CSS.
    bordure: parseFloat(s.borderTopWidth) || 0,
    bordureVoisin: parseFloat(sm.borderTopWidth) || 0,
    largeur: Math.round(r.width), hauteur: Math.round(r.height),
    largeurVoisin: Math.round(rm.width), hauteurVoisin: Math.round(rm.height),
    // Le raccourci est-il bien À CÔTÉ du bouton du tiroir, et à sa gauche ?
    aGaucheDuMenu: r.left < rm.left,
    ecart: Math.round(rm.left - r.right)
  };
});

test('un abonné le voit, sans cadre, et à la même taille que le bouton du tiroir', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, true);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const vu = await mesures(page);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(!vu.absent, 'les deux boutons doivent exister dans la barre');

    assert.equal(vu.visible, true,
      'REGRESSION : un abonné ne voit pas le raccourci. C\'est précisément pour lui qu\'il existe.');

    assert.equal(vu.bordure, 0,
      'REGRESSION : le raccourci est ENCADRÉ. Le propriétaire l\'a demandé sans cadre, et pour une '
      + 'bonne raison : deux boutons encadrés côte à côte se disputent l\'attention, et le cadre doit '
      + 'rester au bouton qui ouvre tout le reste. Bordure lue : ' + vu.bordure + 'px');
    assert.ok(vu.bordureVoisin > 0,
      'le bouton du tiroir, lui, GARDE son cadre : c\'est le contraste entre les deux qui fait sens. '
      + 'Bordure du voisin : ' + vu.bordureVoisin + 'px');

    assert.equal(vu.largeur, vu.largeurVoisin,
      'REGRESSION : la cible tactile n\'est plus la même que celle du tiroir (' + vu.largeur + 'px '
      + 'contre ' + vu.largeurVoisin + 'px). C\'est la DÉCORATION qui devait être plus légère, pas la '
      + 'zone à toucher : sur téléphone, un bouton plus petit se rate.');
    assert.equal(vu.hauteur, vu.hauteurVoisin,
      'même hauteur attendue : ' + vu.hauteur + ' contre ' + vu.hauteurVoisin);

    assert.equal(vu.aGaucheDuMenu, true,
      'REGRESSION : le raccourci est passé à droite du tiroir. Le bouton du menu doit rester le plus '
      + 'à droite, c\'est là que le pouce va le chercher depuis toujours.');
    assert.ok(vu.ecart >= 0 && vu.ecart < 40,
      'les deux doivent rester côte à côte, écart mesuré : ' + vu.ecart + 'px');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un non-abonné ne le voit pas du tout', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, false);
    const vu = await mesures(page);
    assert.equal(vu.visible, false,
      'REGRESSION : un non-abonné voit le raccourci « Mes générations ». Il n\'a rien à y retrouver, '
      + 'et un porteur de jeton n\'est pas un abonné non plus : le raccourci le mènerait à un écran '
      + 'vide, juste à côté du bouton qui lui propose de payer.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('il ouvre bien l\'historique, et sans casser le retour', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, true);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // On part d'un mode ouvert, pour que le retour ait quelque chose à faire :
    // un raccourci qui ouvre l'historique mais perd l'écran d'où l'on vient
    // renverrait le créateur à l'accueil, ce que la pile navBack existe
    // justement pour éviter.
    await page.evaluate(() => chooseMode('script'));
    await page.waitForTimeout(250);

    await page.click('#navGenerationsBtn');
    await page.waitForTimeout(400);
    const apres = await page.evaluate(() => ({
      historique: document.getElementById('historyFlow').style.display,
      script: document.getElementById('flow').style.display
    }));

    await page.evaluate(() => { if (typeof navBack === 'function') navBack(); });
    await page.waitForTimeout(400);
    const retour = await page.evaluate(() => ({
      historique: document.getElementById('historyFlow').style.display,
      script: document.getElementById('flow').style.display
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres.historique, 'block',
      'REGRESSION : le raccourci n\'ouvre pas l\'historique. C\'est sa seule raison d\'être.');
    assert.equal(apres.script, 'none', 'et il referme l\'écran précédent');

    assert.equal(retour.script, 'block',
      'REGRESSION : le retour ne ramène plus à l\'écran d\'où l\'on venait, mais ailleurs. Le raccourci '
      + 'doit empiler la navigation comme les autres entrées, sinon il renvoie le créateur à l\'accueil '
      + 'et lui fait perdre ce qu\'il était en train de faire.');
    assert.equal(retour.historique, 'none', 'et l\'historique se referme');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Demande du propriétaire : un bouton flottant en bas d'écran, centré, dans
// l'esprit du bouton de création de TikTok, pour rejoindre directement le choix
// des modes depuis n'importe quel endroit de la page d'accueil.
//
// Le besoin est réel : sans lui, un visiteur descendu bas dans l'accueil doit
// remonter TOUT en haut, PUIS appuyer sur "Commence gratuitement", avant de
// pouvoir générer quoi que ce soit. Deux étapes pour une intention immédiate.
//
// Comportement précisé ensuite par le propriétaire : le bouton n'emmène plus
// vers le hero, il DÉPLIE un panneau depuis le bas de l'écran, par-dessus la
// page d'accueil. Fond transparent, pour entrevoir l'accueil entre les
// boutons. Un second appui replie le panneau, et le "+" devient "−" pendant
// qu'il est ouvert.
//
// Ce que ces tests verrouillent :
//  - les boutons du panneau sont CLONÉS du hero, jamais recopiés : une seule
//    source de vérité, et surtout aucun identifiant dupliqué dans la page ;
//  - le panneau laisse vraiment voir l'accueil derrière lui ;
//  - sur l'ACCUEIL, le bouton n'apparaît qu'une fois le hero dépassé : tant que
//    les modes sont déjà à l'écran, un raccourci vers les modes n'a aucun sens.
//
// ÉLARGISSEMENT DEMANDÉ ENSUITE : le bouton doit être présent DANS TOUS LES
// MODES. Le besoin est réel : en entrant dans un mode puis en changeant d'avis,
// il fallait ressortir de l'écran et remonter jusqu'aux modes pour en choisir un
// autre. Ma restriction initiale à l'accueil était trop prudente, choisir un
// mode depuis le panneau passe exactement par le même chemin que depuis
// l'accueil, et un résultat déjà affiché est enregistré dans l'historique.
//
// LA SEULE VRAIE PRÉCAUTION EST CONSERVÉE, et testée : le bouton disparaît
// pendant qu'une génération tourne. Là, partir ailleurs abandonnerait un travail
// en cours qui, lui, n'est enregistré nulle part.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

async function ouvrirAccueil(page, baseUrl) {
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
}

const etatBouton = () => {
  const btn = document.getElementById('creerBtn');
  const panneau = document.getElementById('creerPanneau');
  return {
    existe: !!btn,
    visible: !!btn && btn.classList.contains('visible'),
    ouvert: !!panneau && panneau.classList.contains('ouvert'),
    ariaOuvert: btn ? btn.getAttribute('aria-expanded') : null,
    modesDansPanneau: panneau ? panneau.querySelectorAll('.hero-mode-btn').length : 0,
    modesAffiches: (document.getElementById('heroModes') || {}).style ? document.getElementById('heroModes').style.display !== 'none' : false,
    scrollY: Math.round(window.scrollY)
  };
};

test('le bouton n\'apparaît qu\'une fois le hero dépassé, jamais par-dessus les modes', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);

    const enHaut = await page.evaluate(etatBouton);
    assert.ok(enHaut.existe, 'le bouton doit être présent dans la page');
    assert.equal(enHaut.visible, false, 'inutile tant que le hero est à l\'écran');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const enBas = await page.evaluate(etatBouton);
    assert.equal(enBas.visible, true, 'visible une fois descendu dans la page');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const revenuEnHaut = await page.evaluate(etatBouton);
    assert.equal(revenuEnHaut.visible, false, 'et il disparaît en remontant, il n\'a plus rien à raccourcir');

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un appui déplie le panneau, un second le replie, et le + devient −', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const avant = await page.evaluate(etatBouton);
    assert.equal(avant.ouvert, false, 'replié au départ');
    assert.equal(avant.ariaOuvert, 'false');

    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForTimeout(700);
    const ouvert = await page.evaluate(etatBouton);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(ouvert.ouvert, true, 'le panneau doit se déplier');
    assert.equal(ouvert.ariaOuvert, 'true');
    assert.ok(ouvert.modesDansPanneau >= 6, 'tous les modes du hero doivent s\'y retrouver : ' + ouvert.modesDansPanneau);

    // La barre verticale du "+" se rétracte : il devient "−".
    const barre = await page.evaluate(() => {
      const el = document.getElementById('creerBtnBarre');
      const r = el.getBoundingClientRect();
      return { hauteur: Math.round(r.height), corps: document.body.classList.contains('creer-ouvert') };
    });
    assert.equal(barre.corps, true);
    assert.ok(barre.hauteur <= 2, 'la barre verticale doit être rétractée, le bouton affiche un "−" : ' + barre.hauteur + 'px');

    // Le panneau reste par-dessus la page d'accueil, sans la remplacer.
    const accueilToujoursLa = await page.evaluate(() => {
      const home = document.getElementById('homePage');
      return !!home && home.style.display !== 'none';
    });
    assert.equal(accueilToujoursLa, true, 'la page d\'accueil reste en place derrière le panneau');

    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForTimeout(700);
    const referme = await page.evaluate(etatBouton);
    assert.equal(referme.ouvert, false, 'un second appui replie le panneau');
    assert.equal(referme.ariaOuvert, 'false');
    const barreRevenue = await page.evaluate(() => Math.round(document.getElementById('creerBtnBarre').getBoundingClientRect().height));
    assert.ok(barreRevenue > 5, 'et le "−" redevient un "+" : ' + barreRevenue + 'px');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le panneau laisse voir l\'accueil derrière lui, et ne duplique aucun identifiant', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForTimeout(700);

    const vu = await page.evaluate(() => {
      const panneau = document.getElementById('creerPanneau');
      const fond = getComputedStyle(panneau).backgroundColor;
      // Un identifiant présent en double casserait getElementById ailleurs
      // dans l'app (le badge "Commence ici" vit dans un bouton de mode).
      const idsDupliques = Array.from(document.querySelectorAll('[id]'))
        .map(e => e.id)
        .filter((id, i, tab) => id && tab.indexOf(id) !== i);
      return { fond, idsDupliques, idsDansPanneau: panneau.querySelectorAll('[id]').length };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(vu.fond),
      'le panneau lui-même n\'a aucun fond, on voit l\'accueil entre les boutons : ' + vu.fond);
    assert.equal(vu.idsDansPanneau, 0, 'aucun identifiant recopié dans les clones');
    assert.deepEqual(vu.idsDupliques, [],
      'REGRESSION : un id en double ferait renvoyer n\'importe lequel des deux par getElementById');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('choisir un mode referme le panneau, il ne reste jamais par-dessus l\'écran suivant', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await connecterAbonne(page, { code: 'PANNEAU' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#creerPanneau .hero-mode-btn'));
      const cible = btns.find(b => /Écris-moi un script/.test(b.textContent)) || btns[0];
      cible.click();
    });
    await page.waitForTimeout(700);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal((await page.evaluate(etatBouton)).ouvert, false,
      'REGRESSION : le panneau resterait déplié par-dessus l\'écran de génération');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le bouton reste disponible DANS les modes, pour en changer sans ressortir', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await connecterAbonne(page, { code: 'CREERBTN' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    // On entre dans un mode, en haut de l'écran : sur l'accueil le bouton
    // serait caché à cette position, dans un mode il doit être là.
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('flow').style.display = 'block';
      window.scrollTo(0, 0);
      updateScrollBtn();
    });
    await page.waitForTimeout(250);
    const dansLeMode = await page.evaluate(etatBouton);
    assert.equal(dansLeMode.visible, true,
      'REGRESSION : sans lui, changer de mode oblige à ressortir de l\'écran et à remonter jusqu\'aux modes');

    // Et le panneau s'y déplie normalement, avec tous les modes.
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });
    const ouvert = await page.evaluate(etatBouton);
    assert.ok(ouvert.modesDansPanneau >= 6, 'tous les modes sont proposés : ' + ouvert.modesDansPanneau);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mais il disparaît pendant qu\'une génération tourne', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await connecterAbonne(page, { code: 'CREERGEN' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('flow').style.display = 'block';
      updateScrollBtn();
    });
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(etatBouton)).visible, true, 'présent avant de lancer');

    // Panneau déplié PUIS génération lancée : le pire cas, il doit se refermer.
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });
    await page.evaluate(() => startGenAnimation('script'));
    await page.waitForTimeout(300);

    const pendant = await page.evaluate(etatBouton);
    assert.equal(pendant.visible, false,
      'REGRESSION : partir ailleurs pendant une génération abandonnerait le seul travail qui n\'est enregistré nulle part');
    assert.equal(pendant.ouvert, false, 'et un panneau resté ouvert doit se refermer avec lui');

    // Une fois la génération finie, il revient.
    await page.evaluate(() => stopGenAnimation());
    await page.waitForTimeout(900);
    assert.equal((await page.evaluate(etatBouton)).visible, true, 'et il revient une fois la génération terminée');
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le bouton reste dans la palette Scriptura et au-dessus de la zone sûre du téléphone', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      const btn = document.getElementById('creerBtn');
      const st = getComputedStyle(btn);
      const r = btn.getBoundingClientRect();
      const scroll = document.getElementById('scrollTopBtn').getBoundingClientRect();
      const chevauche = !(r.right < scroll.left || r.left > scroll.right || r.bottom < scroll.top || r.top > scroll.bottom);
      return {
        fond: st.backgroundColor,
        plus: getComputedStyle(document.getElementById('creerBtnBarre')).stroke,
        bordGauche: st.borderLeftColor, largeurGauche: st.borderLeftWidth,
        bordDroit: st.borderRightColor, largeurDroite: st.borderRightWidth,
        centre: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2),
        basAuDessusDuBord: window.innerHeight - r.bottom,
        chevauche
      };
    });

    // Doré Scriptura (#C9A84C), jamais le cyan/rose de TikTok qui jurerait
    // avec le reste de l'app.
    assert.equal(vu.fond, 'rgb(201, 168, 76)', 'fond doré Scriptura : ' + vu.fond);
    assert.equal(vu.plus, 'rgb(0, 0, 0)', 'le "+" est noir : ' + vu.plus);
    // Émeraude clair Scriptura (#3E9B75) sur les deux arêtes, jamais le
    // cyan/rose de TikTok. Les bordures plutôt qu'un pseudo-élément décalé :
    // le bouton est en position:fixed, donc un z-index:-1 disparaîtrait
    // derrière son propre fond.
    assert.equal(vu.bordGauche, 'rgb(62, 155, 117)', 'arête gauche émeraude : ' + vu.bordGauche);
    assert.equal(vu.bordDroit, 'rgb(62, 155, 117)', 'arête droite émeraude : ' + vu.bordDroit);
    assert.ok(parseFloat(vu.largeurGauche) >= 3 && parseFloat(vu.largeurDroite) >= 3,
      'assez épaisses pour se voir : ' + vu.largeurGauche + ' / ' + vu.largeurDroite);
    assert.ok(vu.centre < 2, 'centré horizontalement, écart de ' + vu.centre + 'px');
    assert.ok(vu.basAuDessusDuBord >= 16,
      'décollé du bord bas, sinon il passe sous la barre d\'adresse du navigateur mobile : ' + vu.basAuDessusDuBord + 'px');
    assert.equal(vu.chevauche, false,
      'REGRESSION : il ne doit jamais chevaucher le bouton de navigation déjà présent en bas à droite');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire : dans le hero, les icônes des modes pulsent doucement,
// et cette pulsation avait disparu dans le panneau. Cause exacte : elle est
// ciblée par l'identifiant #heroModes, or les clones du panneau sont
// volontairement dépouillés de leurs identifiants (sinon la page se retrouve
// avec des id en double). Le sélecteur ne les atteignait donc plus.
test('les icônes du panneau pulsent comme celles du hero', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });

    const vu = await page.evaluate(() => {
      const icones = Array.from(document.querySelectorAll('#creerPanneau .mode-icon svg'));
      const heroIcone = document.querySelector('#heroModes .mode-icon svg');
      return {
        nb: icones.length,
        animations: icones.map(i => getComputedStyle(i).animationName),
        decalages: Array.from(new Set(icones.map(i => getComputedStyle(i).animationDelay))),
        hero: heroIcone ? getComputedStyle(heroIcone).animationName : null
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.nb >= 6, 'toutes les icônes doivent être là : ' + vu.nb);
    assert.ok(vu.animations.every(a => a === 'howIconPulse'),
      'REGRESSION : chaque icône du panneau doit pulser comme dans le hero : ' + JSON.stringify(vu.animations));
    assert.equal(vu.hero, 'howIconPulse', 'et le hero garde évidemment la sienne');
    assert.ok(vu.decalages.length > 1,
      'la pulsation reste décalée en cascade, jamais toutes les icônes à l\'unisson : ' + JSON.stringify(vu.decalages));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

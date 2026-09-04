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

// `visible` mesure le RENDU RÉEL, pas la présence de la classe CSS. La
// première version de ces tests se contentait de classList.contains('visible')
// : elle serait restée verte même avec une règle CSS cassée laissant le bouton
// à opacity:0, c'est-à-dire un bouton posé nulle part pour le créateur.
// Et surtout, PAS offsetParent, le réflexe habituel pour "est-ce affiché" : il
// vaut TOUJOURS null pour un élément en position:fixed, il ne prouve rien ici.
// On ajoute donc le test de survol au point central (elementFromPoint) : c'est
// la seule vérification qui dit qu'un doigt posé sur le bouton l'atteint
// vraiment, et pas un calque au-dessus.
const etatBouton = () => {
  const btn = document.getElementById('creerBtn');
  const panneau = document.getElementById('creerPanneau');
  let rendu = { opacite: 0, visibilite: 'hidden', affichage: 'none', dansEcran: false, cliquable: false };
  if (btn) {
    const st = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    rendu = {
      opacite: parseFloat(st.opacity),
      visibilite: st.visibility,
      affichage: st.display,
      dansEcran: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
      cliquable: !!dessus && (dessus === btn || btn.contains(dessus))
    };
  }
  return {
    existe: !!btn,
    classe: !!btn && btn.classList.contains('visible'),
    visible: !!btn && rendu.opacite > 0.9 && rendu.visibilite === 'visible' && rendu.affichage !== 'none' && rendu.dansEcran,
    rendu,
    ouvert: !!panneau && panneau.classList.contains('ouvert'),
    ariaOuvert: btn ? btn.getAttribute('aria-expanded') : null,
    modesDansPanneau: panneau ? panneau.querySelectorAll('.hero-mode-btn').length : 0,
    modesAffiches: (document.getElementById('heroModes') || {}).style ? document.getElementById('heroModes').style.display !== 'none' : false,
    scrollY: Math.round(window.scrollY)
  };
};

// L'apparition et la disparition sont des transitions de 0,3s : une simple
// attente fixe frôle la limite et rend les tests instables. On attend l'état
// STABILISÉ, ce qui laisse aussi le droit à l'animation de se terminer.
async function attendreBouton(page, doitEtreVisible) {
  await page.waitForFunction(attendu => {
    const b = document.getElementById('creerBtn');
    if (!b) return false;
    const st = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    const vu = parseFloat(st.opacity) > 0.9 && st.visibility === 'visible' && st.display !== 'none' && r.height > 0;
    const cache = parseFloat(st.opacity) < 0.05 || st.visibility === 'hidden' || st.display === 'none';
    return attendu ? vu : cache;
  }, doitEtreVisible, { timeout: 8000 });
}

// Ouvre un écran de premier niveau comme le fait l'app, en repassant par
// masquerTousLesEcrans (source de vérité unique) puis par la mise à jour des
// boutons flottants.
async function ouvrirEcran(page, id) {
  await page.evaluate(i => {
    masquerTousLesEcrans();
    document.getElementById(i).style.display = 'block';
    window.scrollTo(0, 0);
    updateScrollBtn();
  }, id);
}

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
    assert.equal(enHaut.rendu.cliquable, false, 'et il ne doit surtout pas rester cliquable en étant invisible');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await attendreBouton(page, true);
    const enBas = await page.evaluate(etatBouton);
    assert.equal(enBas.visible, true, 'visible une fois descendu dans la page');
    assert.equal(enBas.rendu.cliquable, true,
      'REGRESSION : un bouton présent dans le DOM mais qu\'aucun doigt n\'atteint ne sert à rien : ' + JSON.stringify(enBas.rendu));

    await page.evaluate(() => window.scrollTo(0, 0));
    await attendreBouton(page, false);
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
    await ouvrirEcran(page, 'flow');
    await attendreBouton(page, true);
    const dansLeMode = await page.evaluate(etatBouton);
    assert.equal(dansLeMode.visible, true,
      'REGRESSION : sans lui, changer de mode oblige à ressortir de l\'écran et à remonter jusqu\'aux modes');
    assert.equal(dansLeMode.rendu.cliquable, true, 'et il est réellement atteignable : ' + JSON.stringify(dansLeMode.rendu));

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

// Demande explicite du propriétaire, après coup : "un utilisateur peut être
// dans l'historique et décider de créer un script. Il est obligé de sortir
// carrément de l'historique et d'aller appuyer sur le bouton pour voir
// afficher le héros. Ce n'est pas bon. Pour le fondateur aussi dans le tableau
// de bord." Ces deux écrans ne sont pas des modes de création, il aurait été
// facile de les oublier : ce test balaie donc TOUS les écrans de premier
// niveau de l'app, l'historique et le tableau de bord compris, plutôt que de
// nommer une liste qui divergera au prochain écran ajouté.
test('le bouton est là sur tous les écrans, historique et tableau de bord compris', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await connecterAbonne(page, { code: 'PARTOUT' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    const ecrans = await page.evaluate(() => TOUS_LES_ECRANS.filter(id => id !== 'homePage' && document.getElementById(id)));
    assert.ok(ecrans.includes('historyFlow'), 'l\'historique fait partie du balayage');
    assert.ok(ecrans.includes('adminFlow'), 'le tableau de bord aussi');
    assert.ok(ecrans.length >= 10, 'et tous les autres écrans avec : ' + ecrans.length);

    const manquants = [];
    for (const id of ecrans) {
      await ouvrirEcran(page, id);
      try {
        await attendreBouton(page, true);
      } catch (e) {
        manquants.push(id + ' (jamais affiché)');
        continue;
      }
      const vu = await page.evaluate(etatBouton);
      if (!vu.rendu.cliquable) manquants.push(id + ' ' + JSON.stringify(vu.rendu));
    }

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(manquants, [],
      'REGRESSION : sur ces écrans, le créateur doit ressortir complètement pour changer de mode');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Et pas seulement affiché : depuis l'historique, il doit VRAIMENT emmener
// dans un mode de création, sans laisser le panneau par-dessus.
test('depuis l\'historique, le panneau emmène directement dans un mode', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);
    await connecterAbonne(page, { code: 'HISTCREE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);
    await ouvrirEcran(page, 'historyFlow');
    await attendreBouton(page, true);

    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#creerPanneau .hero-mode-btn'));
      const cible = btns.find(b => /Écris-moi un script/.test(b.textContent)) || btns[0];
      cible.click();
    });
    await page.waitForTimeout(700);

    const vu = await page.evaluate(() => ({
      panneauOuvert: document.getElementById('creerPanneau').classList.contains('ouvert'),
      historiqueEncoreLa: document.getElementById('historyFlow').style.display !== 'none',
      modeOuvert: document.getElementById('flow').style.display !== 'none'
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.modeOuvert, true, 'le mode Script s\'ouvre bien depuis l\'historique');
    assert.equal(vu.historiqueEncoreLa, false, 'et l\'historique se referme, il ne reste pas empilé dessous');
    assert.equal(vu.panneauOuvert, false, 'le panneau ne reste pas déplié par-dessus');
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
    await ouvrirEcran(page, 'flow');
    await attendreBouton(page, true);
    assert.equal((await page.evaluate(etatBouton)).visible, true, 'présent avant de lancer');

    // Panneau déplié PUIS génération lancée : le pire cas, il doit se refermer.
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });
    await page.evaluate(() => startGenAnimation('script'));
    await attendreBouton(page, false);

    const pendant = await page.evaluate(etatBouton);
    assert.equal(pendant.visible, false,
      'REGRESSION : partir ailleurs pendant une génération abandonnerait le seul travail qui n\'est enregistré nulle part');
    assert.equal(pendant.ouvert, false, 'et un panneau resté ouvert doit se refermer avec lui');

    // Une fois la génération finie, il revient.
    await page.evaluate(() => stopGenAnimation());
    await attendreBouton(page, true);
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

// Retour propriétaire : "quand je clique sur le bouton +, il se passe quelques
// secondes avant que les boutons se déploient".
//
// CAUSE EXACTE, et elle était invisible en lisant le code trop vite :
// l'ouverture ATTENDAIT aFaitAnalyseCompte(), qui fait DEUX LECTURES RÉSEAU,
// uniquement pour décider d'afficher ou non le badge "Commence ici". Mesuré à
// 1231 ms avec une lecture à 1,2 s, et bien plus sur un téléphone en 3G. Un
// panneau qui met deux secondes à répondre à un appui passe pour cassé.
//
// Le badge part désormais masqué et n'apparaît qu'une fois la réponse revenue.
// Le sens compte : un badge qui apparaît en retard se remarque à peine, un
// badge qui disparaît sous les yeux donne l'impression d'un bug.
test('le panneau part au doigt, sans jamais attendre le réseau', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await poserMocksReseau(page);
    // Réseau volontairement très lent : c'est la seule façon de distinguer un
    // panneau qui attend une réponse d'un panneau qui ne l'attend pas.
    await page.route('**/api/data?**', async (route) => {
      await new Promise(r => setTimeout(r, 3000));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PANDELAI' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(400);
    await ouvrirEcran(page, 'flow');
    await attendreBouton(page, true);

    const vu = await page.evaluate(() => {
      const t0 = performance.now();
      document.getElementById('creerBtn').click();
      // Ce que mesure ce chiffre : la durée du GESTE, du clic jusqu'au retour
      // de la main au navigateur. Une attente réseau s'y verrait aussitôt.
      return {
        dureeHandler: performance.now() - t0,
        boutonsPrets: document.querySelectorAll('#creerPanneau .hero-mode-btn').length
      };
    });

    assert.ok(vu.dureeHandler < 120,
      'REGRESSION : l\'ouverture attend une réponse réseau, le panneau met des secondes à répondre à l\'appui (' + Math.round(vu.dureeHandler) + ' ms avec un réseau à 3 s)');
    assert.ok(vu.boutonsPrets >= 6,
      'et tous les modes sont déjà clonés, pas seulement promis : ' + vu.boutonsPrets);

    // Le panneau s'ouvre bien pour de vrai, largement avant la réponse réseau.
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 2000 });
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

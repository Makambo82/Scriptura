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
//  - le bouton n'a de sens que sur la page d'accueil, hero dépassé. Sur un
//    écran de génération, un appui malheureux ferait quitter un résultat en
//    cours ; le panneau doit donc aussi se refermer tout seul dans ce cas.
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

test('le bouton disparaît dès qu\'on quitte l\'accueil pour un écran de génération', async () => {
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

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate(etatBouton)).visible, true, 'visible sur l\'accueil, en bas');
    // Le remplissage du panneau attend une vérification de profil (badge
    // "Commence ici") : on attend l'état, jamais un délai fixe.
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForFunction(() => document.getElementById('creerPanneau').classList.contains('ouvert'), null, { timeout: 8000 });

    // Un écran de génération prend la place de l'accueil.
    await page.evaluate(() => { masquerTousLesEcrans(); document.getElementById('flow').style.display = 'block'; updateScrollBtn(); });
    await page.waitForTimeout(200);
    const surEcran = await page.evaluate(etatBouton);
    assert.equal(surEcran.visible, false,
      'REGRESSION : sur un écran de génération, un appui malheureux ferait quitter un travail en cours');
    assert.equal(surEcran.ouvert, false, 'et un panneau resté ouvert doit se refermer avec lui');

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
        centre: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2),
        basAuDessusDuBord: window.innerHeight - r.bottom,
        chevauche
      };
    });

    // Doré Scriptura (#C9A84C), jamais le cyan/rose de TikTok qui jurerait
    // avec le reste de l'app.
    assert.equal(vu.fond, 'rgb(201, 168, 76)', 'fond doré Scriptura : ' + vu.fond);
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

// Demande du propriétaire : un bouton flottant en bas d'écran, centré, dans
// l'esprit du bouton de création de TikTok, pour rejoindre directement le choix
// des modes depuis n'importe quel endroit de la page d'accueil.
//
// Le besoin est réel : sans lui, un visiteur descendu bas dans l'accueil doit
// remonter TOUT en haut, PUIS appuyer sur "Commence gratuitement", avant de
// pouvoir générer quoi que ce soit. Deux étapes pour une intention immédiate.
//
// Deux détails ont façonné l'implémentation, et ce sont eux que ces tests
// verrouillent :
//  - les modes sont MASQUÉS par défaut (#heroModes en display:none, révélés
//    par revelerModes()). Un bouton qui se contenterait de remonter en haut
//    déposerait le visiteur devant un hero sans aucun mode visible : le
//    raccourci ne raccourcirait rien ;
//  - le bouton n'a de sens que sur la page d'accueil, hero dépassé. Sur un
//    écran de génération, un appui malheureux ferait quitter un résultat en
//    cours, et tant que les modes sont déjà à l'écran il ne sert à rien.
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
  return {
    existe: !!btn,
    visible: !!btn && btn.classList.contains('visible'),
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

test('un appui révèle les modes ET remonte, en une seule fois', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);

    const avant = await page.evaluate(etatBouton);
    assert.equal(avant.modesAffiches, false, 'au départ les modes sont bien masqués, c\'est tout l\'enjeu');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForTimeout(500);

    const apres = await page.evaluate(etatBouton);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres.modesAffiches, true,
      'REGRESSION : sans révéler les modes, le visiteur atterrit sur un hero vide et doit encore appuyer sur "Commence gratuitement"');
    assert.ok(apres.scrollY < 80, 'et il est bien remonté en haut : ' + apres.scrollY);

    // Les modes sont réellement cliquables, pas juste "display" changé.
    const modesVisibles = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('#heroModes .hero-mode-btn'));
      return btns.filter(b => b.offsetParent !== null).length;
    });
    assert.ok(modesVisibles >= 6, 'les boutons de mode doivent être réellement visibles : ' + modesVisibles);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un second appui, modes déjà révélés, se contente de remonter', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirAccueil(page, baseUrl);

    await page.evaluate(() => revelerModes());
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('creerBtn').click());
    await page.waitForTimeout(400);

    const apres = await page.evaluate(etatBouton);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres.modesAffiches, true, 'les modes restent révélés');
    assert.ok(apres.scrollY < 80, 'et on est bien remonté : ' + apres.scrollY);
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

    // Un écran de génération prend la place de l'accueil.
    await page.evaluate(() => { masquerTousLesEcrans(); document.getElementById('flow').style.display = 'block'; updateScrollBtn(); });
    await page.waitForTimeout(200);
    const surEcran = await page.evaluate(etatBouton);
    assert.equal(surEcran.visible, false,
      'REGRESSION : sur un écran de génération, un appui malheureux ferait quitter un travail en cours');

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

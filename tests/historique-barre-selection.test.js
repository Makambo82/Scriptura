// Retour direct du propriétaire, en deux temps.
//
// 1er retour (capture d'écran, cadre vert) : en mode sélection de
// l'historique, la barre d'outils flottante en bas de l'écran débordait de
// son propre contour arrondi (le bouton "Supprimer" coupé au bord de
// l'écran), et son libellé n'était pas bien aligné avec l'icône poubelle.
// Corrigé : seuil de masquage des libellés relevé de 400px à 600px (couvre
// tous les téléphones en portrait), overflow-x défensif sur la pilule, et
// même gabarit d'icône (taille/alignement) pour Favoris et Supprimer.
//
// 2e retour, affinage explicite du comportement voulu : le libellé
// "Supprimer" doit rester visible juste après avoir cliqué "Sélectionner"
// (rien encore choisi, n=0 — le créateur découvre le bouton), puis
// disparaître (icône seule) dès qu'on COMMENCE à sélectionner des
// générations (n>0) — quelle que soit la largeur d'écran, pas seulement en
// dessous de 600px.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

async function ouvrirBarreSelection(page, { n, total }) {
  await page.evaluate(({ n, total }) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('historyFlow').style.display = 'block';
    document.getElementById('historyToolbar').style.display = 'flex';
    window._historyData = Array.from({ length: total }, (_, i) => ({ id: 'g' + i }));
    window._historySeries = [];
    _selectMode = true;
    _selectedIds = new Set(window._historyData.slice(0, n).map(g => g.id));
    updateHistoryToolbar();
  }, { n, total });
  await page.waitForTimeout(120);
}

function lireEtatToolbar(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('historyToolbar');
    const barRect = bar.getBoundingClientRect();
    const debordeVisible = Array.from(bar.querySelectorAll('button, span.hist-tool-count')).some(el => {
      const r = el.getBoundingClientRect();
      return r.right > barRect.right + 1 || r.left < barRect.left - 1;
    });
    const supprimerBtn = bar.querySelector('.hist-tool-btn.danger');
    const libelleSupprimer = supprimerBtn ? supprimerBtn.querySelector('.hist-tool-lbl') : null;
    return {
      debordeVisible,
      contenuScrollable: bar.scrollWidth,
      largeurVisible: bar.clientWidth,
      overflowXSecurise: getComputedStyle(bar).overflowX === 'auto',
      supprimerVisible: supprimerBtn ? getComputedStyle(supprimerBtn).display !== 'none' : false,
      libelleSupprimerPresent: !!libelleSupprimer,
      libelleSupprimerVisible: libelleSupprimer ? getComputedStyle(libelleSupprimer).display !== 'none' : false
    };
  });
}

test('Historique : la barre de sélection ne déborde jamais de son contour, avant ou après avoir commencé à sélectionner', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // Largeur logique d'un iPhone Pro Max courant.
    await page.setViewportSize({ width: 430, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTBARRE1', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirBarreSelection(page, { n: 0, total: 39 });
    const avant = await lireEtatToolbar(page);
    await ouvrirBarreSelection(page, { n: 5, total: 39 });
    const apres = await lireEtatToolbar(page);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    for (const [nom, etat] of [['avant sélection', avant], ['après sélection', apres]]) {
      assert.equal(etat.overflowXSecurise, true, nom + ' : la barre doit avoir un défilement horizontal défensif');
      assert.equal(etat.debordeVisible, false, nom + ' : aucun bouton ne doit visuellement dépasser le contour de la barre');
      assert.ok(etat.contenuScrollable <= etat.largeurVisible + 1, nom + ' : le contenu doit tenir entièrement dans la largeur visible');
      assert.equal(etat.supprimerVisible, true, nom + ' : le bouton Supprimer doit rester accessible');
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : le libellé "Supprimer" apparaît juste après "Sélectionner" (rien choisi), puis disparaît dès la première sélection', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // Écran large (desktop), où le seuil de largeur ne masque jamais les
    // libellés à lui seul : ce test isole bien le comportement piloté par
    // l'état de sélection (n), pas par la largeur d'écran.
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTBARRE2', plan: 'pro' });
    await page.waitForTimeout(200);

    // n = 0 : on vient de cliquer "Sélectionner", rien encore choisi.
    await ouvrirBarreSelection(page, { n: 0, total: 5 });
    const avant = await lireEtatToolbar(page);

    // n = 2 : on commence à sélectionner des générations.
    await ouvrirBarreSelection(page, { n: 2, total: 5 });
    const apres = await lireEtatToolbar(page);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(avant.libelleSupprimerPresent, true, 'avant toute sélection, le libellé "Supprimer" doit être présent');
    assert.equal(avant.libelleSupprimerVisible, true, 'avant toute sélection, le libellé "Supprimer" doit être visible');
    assert.equal(apres.libelleSupprimerPresent, false, 'dès la première sélection, le libellé "Supprimer" ne doit plus être rendu du tout (icône seule)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : sur un écran large, l\'icône Supprimer (avant sélection, avec libellé) a le même gabarit que l\'icône Favoris', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTBARRE3', plan: 'pro' });
    await page.waitForTimeout(200);
    await ouvrirBarreSelection(page, { n: 0, total: 5 });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const lireGabarit = (selecteur) => {
        const svg = document.querySelector(selecteur + ' svg');
        const cs = getComputedStyle(svg);
        return { largeur: cs.width, hauteur: cs.height, alignement: cs.verticalAlign };
      };
      return {
        favVisible: getComputedStyle(document.querySelector('.hist-tool-btn.fav .hist-tool-lbl')).display !== 'none',
        supprimerVisible: getComputedStyle(document.querySelector('.hist-tool-btn.danger .hist-tool-lbl')).display !== 'none',
        fav: lireGabarit('.hist-tool-btn.fav'),
        supprimer: lireGabarit('.hist-tool-btn.danger')
      };
    });

    assert.equal(etat.favVisible, true, 'sur grand écran, le libellé Favoris doit être visible');
    assert.equal(etat.supprimerVisible, true, 'avant toute sélection, le libellé Supprimer doit être visible');
    assert.deepEqual(etat.supprimer, etat.fav, 'l\'icône Supprimer doit avoir la même taille et le même alignement vertical que l\'icône Favoris : ' + JSON.stringify(etat));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

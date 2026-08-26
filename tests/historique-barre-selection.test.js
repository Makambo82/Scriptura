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
//
// 3e retour (captures d'un vrai téléphone, scriptura-v1.vercel.app) : le
// réglage précédent ne se voyait jamais en pratique sur mobile. La règle
// CSS @media(max-width:600px) qui masque .hist-tool-lbl s'appliquait à
// TOUS les libellés de la barre flottante, y compris Supprimer — elle
// écrasait donc en permanence, sur téléphone, le rendu conditionnel piloté
// par l'état de sélection (n) ajouté au 2e retour. Résultat réel constaté :
// libellé "Supprimer" invisible à n=0 sur téléphone, contrairement au
// visuel demandé. Corrigé : la règle de largeur ne concerne plus que
// Favoris ; Supprimer reste entièrement piloté par n, sur toutes les
// largeurs d'écran.
//
// 4e retour (2 captures comparées) : Favoris doit suivre exactement le
// même comportement que Supprimer — libellé visible à n=0, icône seule dès
// n>0 — au lieu d'afficher son libellé en permanence sur grand écran (et
// jamais sur téléphone, seuil de largeur retiré ici aussi). Conséquence
// assumée : à n=0 sur les téléphones les plus étroits (390px), les DEUX
// libellés affichés ensemble peuvent dépasser légèrement la largeur
// visible de la pilule — c'est exactement le rôle du défilement horizontal
// défensif (overflow-x:auto, voir 1er retour) : la pilule elle-même ne
// touche jamais les bords de l'écran, seul son contenu interne devient
// scrollable si besoin, jamais visuellement cassé.
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
    // Le seul invariant qui compte réellement (voir bug d'origine, 1er
    // retour) : la PILULE elle-même ne doit jamais toucher/dépasser les
    // bords de l'écran. Que son CONTENU interne dépasse sa propre largeur
    // visible est acceptable et géré proprement par overflow-x:auto (voir
    // 4e retour) — ce n'est pas un débordement visuel cassé, juste un
    // défilement interne à la pilule.
    const pilulDansEcran = barRect.left >= -1 && barRect.right <= window.innerWidth + 1;
    const supprimerBtn = bar.querySelector('.hist-tool-btn.danger');
    const libelleSupprimer = supprimerBtn ? supprimerBtn.querySelector('.hist-tool-lbl') : null;
    const favBtn = bar.querySelector('.hist-tool-btn.fav');
    const libelleFav = favBtn ? favBtn.querySelector('.hist-tool-lbl') : null;
    return {
      pilulDansEcran,
      contenuScrollable: bar.scrollWidth,
      largeurVisible: bar.clientWidth,
      overflowXSecurise: getComputedStyle(bar).overflowX === 'auto',
      supprimerVisible: supprimerBtn ? getComputedStyle(supprimerBtn).display !== 'none' : false,
      libelleSupprimerPresent: !!libelleSupprimer,
      libelleSupprimerVisible: libelleSupprimer ? getComputedStyle(libelleSupprimer).display !== 'none' : false,
      favoriVisible: favBtn ? getComputedStyle(favBtn).display !== 'none' : false,
      libelleFavoriPresent: !!libelleFav,
      libelleFavoriVisible: libelleFav ? getComputedStyle(libelleFav).display !== 'none' : false
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
      assert.equal(etat.pilulDansEcran, true, nom + ' : la pilule elle-même ne doit jamais toucher/dépasser les bords de l\'écran');
      assert.ok(etat.contenuScrollable <= etat.largeurVisible + 1, nom + ' : sur cette largeur (430px), le contenu doit tenir entièrement sans défilement interne : ' + JSON.stringify(etat));
      assert.equal(etat.supprimerVisible, true, nom + ' : le bouton Supprimer doit rester accessible');
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : les libellés "Supprimer" et "Favoris" apparaissent juste après "Sélectionner" (rien choisi), puis disparaissent tous les deux dès la première sélection', async () => {
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
    assert.equal(avant.libelleFavoriPresent, true, 'avant toute sélection, le libellé "Favoris" doit être présent');
    assert.equal(avant.libelleFavoriVisible, true, 'avant toute sélection, le libellé "Favoris" doit être visible');
    assert.equal(apres.libelleFavoriPresent, false, 'dès la première sélection, le libellé "Favoris" ne doit plus être rendu du tout (icône seule)');
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

test('Historique : sur téléphone, les libellés "Supprimer" et "Favoris" sont bien visibles à n=0 (pas seulement présents dans le DOM), et disparaissent tous les deux dès n>0, sans jamais faire dépasser la pilule des bords de l\'écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // Largeur logique d'un iPhone courant, sous le seuil de 600px : c'est
    // précisément la largeur où la règle CSS de masquage des libellés
    // écrasait, avant ce correctif, le rendu piloté par l'état (n).
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTBARRE4', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirBarreSelection(page, { n: 0, total: 39 });
    const avant = await lireEtatToolbar(page);
    await ouvrirBarreSelection(page, { n: 3, total: 39 });
    const apres = await lireEtatToolbar(page);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(avant.libelleSupprimerPresent, true, 'sur téléphone, à n=0, le libellé "Supprimer" doit être présent dans le DOM');
    assert.equal(avant.libelleSupprimerVisible, true, 'sur téléphone, à n=0, le libellé "Supprimer" doit être visible (pas juste présent puis masqué par CSS)');
    assert.equal(avant.libelleFavoriPresent, true, 'sur téléphone, à n=0, le libellé "Favoris" doit être présent dans le DOM');
    assert.equal(avant.libelleFavoriVisible, true, 'sur téléphone, à n=0, le libellé "Favoris" doit être visible (pas juste présent puis masqué par CSS)');
    // À n=0, les DEUX libellés ensemble peuvent dépasser légèrement la
    // largeur visible sur les téléphones les plus étroits (390px) : c'est
    // acceptable, absorbé par le défilement interne défensif. Ce qui ne
    // doit JAMAIS arriver, c'est que la pilule elle-même touche/dépasse les
    // bords physiques de l'écran (le bug d'origine, cadre vert).
    assert.equal(avant.pilulDansEcran, true, 'à n=0 sur téléphone, la pilule elle-même ne doit jamais toucher/dépasser les bords de l\'écran, même avec les deux libellés affichés');
    assert.equal(avant.overflowXSecurise, true, 'à n=0 sur téléphone, le défilement horizontal défensif doit être actif si le contenu ne tient pas');

    assert.equal(apres.libelleSupprimerPresent, false, 'sur téléphone, dès n>0, le libellé "Supprimer" ne doit plus être rendu du tout');
    assert.equal(apres.libelleFavoriPresent, false, 'sur téléphone, dès n>0, le libellé "Favoris" ne doit plus être rendu du tout');
    assert.equal(apres.pilulDansEcran, true, 'à n>0 sur téléphone, la pilule ne doit jamais toucher/dépasser les bords de l\'écran');
    assert.ok(apres.contenuScrollable <= apres.largeurVisible + 1, 'à n>0 (icônes seules), le contenu doit tenir entièrement sans défilement interne : ' + JSON.stringify(apres));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

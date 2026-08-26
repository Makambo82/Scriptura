// Retour direct du propriétaire (capture d'écran, cadre vert) : en mode
// sélection de l'historique, la barre d'outils flottante en bas de l'écran
// débordait de son propre contour arrondi (le bouton "Supprimer" coupé au
// bord de l'écran), et le libellé "Supprimer" n'était pas bien aligné avec
// l'icône poubelle à côté.
//
// Cause réelle : la barre (5 boutons : Annuler, Tout/Aucun, compteur,
// Favoris, Supprimer) masquait ses libellés texte en dessous de 400px de
// large — un seuil trop bas : beaucoup de téléphones courants en portrait
// (ex. 430px, iPhone Pro Max) restent AU-DESSUS de ce seuil, gardent donc
// les libellés complets, et peuvent déborder de la pilule flottante selon
// le rendu exact des polices. Relevé à 600px pour couvrir tous les
// téléphones en portrait ; un overflow-x défensif ajouté en plus, pour ne
// plus jamais dépendre uniquement de ce seuil. Et le SVG du bouton
// Supprimer n'avait jamais reçu la même règle de taille/alignement que
// celui du bouton Favoris juste à côté.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Historique : sur un téléphone standard, la barre de sélection reste en icônes compactes et ne déborde jamais de son contour', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // Largeur logique d'un iPhone Pro Max courant : au-dessus de l'ancien
    // seuil de 400px (donc gardait les libellés complets avant ce correctif,
    // le cas exact signalé sur la capture), toujours en dessous du nouveau
    // seuil de 600px.
    await page.setViewportSize({ width: 430, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTBARRE1', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('historyFlow').style.display = 'block';
      document.getElementById('historyToolbar').style.display = 'flex';
      window._historyData = Array.from({ length: 39 }, (_, i) => ({ id: 'g' + i }));
      window._historySeries = [];
      _selectMode = true;
      _selectedIds = new Set(window._historyData.map(g => g.id));
      updateHistoryToolbar();
    });
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
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
        supprimerVisible: supprimerBtn ? getComputedStyle(supprimerBtn).display !== 'none' : false,
        // Le mécanisme réel du correctif : le libellé texte doit être masqué
        // sur un téléphone (icône seule), pas juste "ne pas déborder par
        // coïncidence" selon le rendu exact des polices.
        libelleSupprimerMasque: libelleSupprimer ? getComputedStyle(libelleSupprimer).display === 'none' : false,
        // Filet de sécurité (overflow-x) : doit être en place même si, par
        // coïncidence de rendu, le contenu tenait déjà à cette largeur précise.
        overflowXSecurise: getComputedStyle(bar).overflowX === 'auto'
      };
    });

    assert.equal(etat.libelleSupprimerMasque, true, 'sur un téléphone (430px, sous le nouveau seuil de 600px), le libellé "Supprimer" doit être masqué (icône seule)');
    assert.equal(etat.overflowXSecurise, true, 'la barre doit avoir un défilement horizontal défensif, jamais un débordement visuel qui casse son contour');
    assert.equal(etat.debordeVisible, false, 'aucun bouton ne doit visuellement dépasser le contour de la barre flottante');
    assert.ok(etat.contenuScrollable <= etat.largeurVisible + 1, 'le contenu doit tenir entièrement dans la largeur visible (' + etat.contenuScrollable + ' vs ' + etat.largeurVisible + ')');
    assert.equal(etat.supprimerVisible, true, 'le bouton Supprimer doit rester accessible');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : sur un écran large (desktop), l\'icône et le libellé "Supprimer" ont le même gabarit que "Favoris"', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTBARRE2', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('historyFlow').style.display = 'block';
      document.getElementById('historyToolbar').style.display = 'flex';
      window._historyData = [{ id: 'g1' }];
      window._historySeries = [];
      _selectMode = true;
      _selectedIds = new Set(['g1']);
      updateHistoryToolbar();
    });
    await page.waitForTimeout(150);

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
    assert.equal(etat.supprimerVisible, true, 'sur grand écran, le libellé Supprimer doit être visible');
    assert.deepEqual(etat.supprimer, etat.fav, 'l\'icône Supprimer doit avoir la même taille et le même alignement vertical que l\'icône Favoris : ' + JSON.stringify(etat));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

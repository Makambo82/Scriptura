// Retour propriétaire : la notification "preuve sociale" (fixe en bas à
// gauche, voir js/preuve-sociale.js) peut recouvrir la barre flottante de
// sélection de l'historique sur petit écran. Demande : un appui long sur la
// barre doit permettre de la déplacer. Voir js/historique.js
// (_initGlisserBarreOutils, _appliquerPositionBarre) et css/style.css
// (.history-toolbar.flottant.glisser).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

async function etatSelection(page, actif) {
  await page.evaluate((actif) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('historyFlow').style.display = 'block';
    document.getElementById('historyToolbar').style.display = 'flex';
    window._historyData = Array.from({ length: 5 }, (_, i) => ({ id: 'g' + i }));
    window._historySeries = [];
    _selectMode = actif;
    _selectedIds = new Set();
    updateHistoryToolbar();
  }, actif);
  await page.waitForTimeout(100);
}

async function ouvrirPage(navigateur, { largeur = 390 } = {}) {
  const page = await navigateur.newPage();
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  return { page, erreursJs };
}

test('Historique : un appui long sur la barre flottante la fait glisser, et sa position se mémorise', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page, erreursJs } = await ouvrirPage(navigateur);
    await poserMocksReseau(page);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTGLISSER1', plan: 'pro' });
    await page.waitForTimeout(200);
    await etatSelection(page, true);

    // Toute la séquence (appui, attente du seuil, mouvement, relâchement)
    // s'exécute dans UN SEUL page.evaluate, avec de vrais PointerEvent
    // synthétiques et un setTimeout en page : aucun aller-retour CDP entre
    // chaque étape, donc aucune course possible contre le temps réel côté
    // hôte, même sous forte charge (suite complète en parallèle). Seul
    // l'ordre relatif des deux minuteurs (le nôtre à 600ms > le seuil de
    // l'appli à 450ms, tous deux posés côté page au même instant) compte,
    // pas leur précision absolue.
    const resultat = await page.evaluate(async () => {
      const bar = document.getElementById('historyToolbar');
      const r0 = bar.getBoundingClientRect();
      const cx = r0.left + 20, cy = r0.top + r0.height / 2;
      const base = { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true };
      bar.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: cx, clientY: cy }, base)));
      await new Promise(r => setTimeout(r, 600)); // dépasse le seuil d'appui long (450ms)
      const pendantAppui = bar.classList.contains('glisser');
      bar.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: cx + 60, clientY: cy - 200 }, base)));
      await new Promise(r => setTimeout(r, 50));
      bar.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: cx + 60, clientY: cy - 200 }, base)));
      await new Promise(r => setTimeout(r, 80));
      const r1 = bar.getBoundingClientRect();
      return {
        avant: { left: r0.left, top: r0.top },
        apres: { left: r1.left, top: r1.top },
        pendantAppui,
        glisserApres: bar.classList.contains('glisser'),
        sauvegarde: JSON.parse(localStorage.getItem('scriptura_hist_toolbar_pos') || 'null')
      };
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(resultat.pendantAppui, true, 'après 600ms d\'appui immobile, la barre doit passer en mode glisser (retour visuel)');
    assert.ok(Math.abs(resultat.apres.top - resultat.avant.top) > 50, 'la barre doit avoir réellement changé de position verticale après le glissement : ' + JSON.stringify(resultat));
    assert.equal(resultat.glisserApres, false, 'le mode glisser doit se désactiver au relâchement');
    assert.ok(resultat.sauvegarde && typeof resultat.sauvegarde.left === 'number' && typeof resultat.sauvegarde.top === 'number', 'la nouvelle position doit être mémorisée (localStorage)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : un tapotement court sur un bouton de la barre fonctionne normalement (pas de glisser accidentel)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page, erreursJs } = await ouvrirPage(navigateur);
    await poserMocksReseau(page);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTGLISSER2', plan: 'pro' });
    await page.waitForTimeout(200);
    await etatSelection(page, true);

    const bouton = await page.$('#historyToolbar button.hist-tool-btn:not(.fav):not(.danger)');
    assert.ok(bouton, 'le bouton "Annuler" doit exister dans la barre');
    const box = await bouton.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(90); // bien sous le seuil d'appui long
    await page.mouse.up();
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const modeSelectionApres = await page.evaluate(() => _selectMode);
    assert.equal(modeSelectionApres, false, 'un tapotement court sur "Annuler" doit toujours quitter le mode sélection normalement');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : bouger tout de suite (avant le seuil) annule l\'appui long, pour ne pas gêner un geste de défilement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page, erreursJs } = await ouvrirPage(navigateur);
    await poserMocksReseau(page);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTGLISSER3', plan: 'pro' });
    await page.waitForTimeout(200);
    await etatSelection(page, true);

    // Même principe qu'au 1er test : séquence entière dans un seul
    // page.evaluate. Le pointerdown puis le pointermove s'exécutent dans le
    // même tick JS (aucune attente réelle entre les deux) : le minuteur de
    // 450ms de l'appli n'a mathématiquement pas pu se déclencher entre les
    // deux, le mouvement l'annule donc forcément AVANT qu'il n'ait eu la
    // moindre chance de se déclencher, sans course possible contre le CPU.
    const glisserDeclenche = await page.evaluate(async () => {
      const bar = document.getElementById('historyToolbar');
      const r = bar.getBoundingClientRect();
      const cx = r.left + 20, cy = r.top + r.height / 2;
      const base = { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true };
      bar.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: cx, clientY: cy }, base)));
      bar.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: cx + 30, clientY: cy }, base))); // mouvement > seuil d'annulation (10px)
      // Attente généreuse : si l'annulation n'avait pas fonctionné, le
      // minuteur aurait largement eu le temps de se déclencher ici.
      await new Promise(r => setTimeout(r, 700));
      bar.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: cx + 30, clientY: cy }, base)));
      return bar.classList.contains('glisser');
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(glisserDeclenche, false, 'un mouvement avant le seuil doit annuler l\'appui long, pas déclencher le glissement');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Historique : la position glissée est mémorisée par appareil, bornée à l\'écran, et réinitialisée en sortant du mode sélection', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const { page, erreursJs } = await ouvrirPage(navigateur);
    await poserMocksReseau(page);
    // Cette partie teste la logique de mémorisation/bornage elle-même, pas
    // le fait qu'un téléphone étroit tienne tout le contenu (déjà couvert
    // ailleurs) : largeur généreuse pour que la position sauvegardée
    // (left:40) ne soit jamais elle-même bornée par la largeur de la barre
    // à n=0 (Favoris + Supprimer tous deux libellés, ~381px de contenu).
    await page.setViewportSize({ width: 600, height: 850 });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'HISTGLISSER4', plan: 'pro' });
    await page.waitForTimeout(200);

    // Position mémorisée d'une session précédente.
    await page.evaluate(() => localStorage.setItem('scriptura_hist_toolbar_pos', JSON.stringify({ left: 40, top: 120 })));
    await etatSelection(page, true);
    const rect1 = await page.evaluate(() => document.getElementById('historyToolbar').getBoundingClientRect().toJSON());

    await etatSelection(page, false);
    const stylesHorsSelection = await page.evaluate(() => {
      const b = document.getElementById('historyToolbar');
      return { left: b.style.left, top: b.style.top, bottom: b.style.bottom, transform: b.style.transform };
    });

    await etatSelection(page, true);
    const rect2 = await page.evaluate(() => document.getElementById('historyToolbar').getBoundingClientRect().toJSON());

    // Position obsolète hors-écran (ex. après une rotation) : doit être bornée.
    await page.evaluate(() => localStorage.setItem('scriptura_hist_toolbar_pos', JSON.stringify({ left: 9999, top: -500 })));
    await etatSelection(page, false);
    await etatSelection(page, true);
    const rect3 = await page.evaluate(() => document.getElementById('historyToolbar').getBoundingClientRect().toJSON());

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(rect1.left, 40, 'la position sauvegardée doit être réappliquée à l\'ouverture du mode sélection');
    assert.equal(rect1.top, 120, 'la position sauvegardée doit être réappliquée à l\'ouverture du mode sélection');
    assert.deepEqual(stylesHorsSelection, { left: '', top: '', bottom: '', transform: '' }, 'en sortant du mode sélection, la barre doit revenir à la position par défaut pilotée par le CSS');
    assert.equal(rect2.left, 40, 'la position mémorisée doit revenir à la ré-entrée en mode sélection');
    assert.equal(rect2.top, 120, 'la position mémorisée doit revenir à la ré-entrée en mode sélection');
    assert.ok(rect3.left >= 0 && rect3.right <= 600 && rect3.top >= 0 && rect3.bottom <= 850, 'une position sauvegardée hors-écran doit être bornée à l\'intérieur de la fenêtre : ' + JSON.stringify(rect3));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

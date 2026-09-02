// Retour propriétaire (capture à l'appui) : après la disposition "premium"
// en cartes du panneau de montage (.montage-section), les menus déroulants
// maison (choix de voix, volume de la musique) s'ouvraient DANS la carte et
// se retrouvaient coupés, impossibles à faire défiler pour voir les autres
// choix. Cause : .montage-section avait overflow:hidden (pour un dégradé
// décoratif en haut de carte), qui clippe aussi tout descendant positionné
// en absolu dépassant la carte, dont .custom-select-panel (voir js/ui.js,
// initCustomSelect). Fixé en retirant overflow:hidden (le dégradé s'estompe
// déjà vers transparent à ses extrémités, jamais eu besoin d'un clip pour
// rester propre sur des coins arrondis, même codex que .context-card).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : le menu déroulant "Choisis une voix..." n\'est pas coupé par la carte "Voix off" (overflow visible, panneau entier accessible)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        voices: [
          { id: 'v-adrien', label: 'Adrien' },
          { id: 'v-melanie', label: 'Melanie' }
        ]
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MENUSNONCOUPES1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Plan.', visuel: 'x' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      document.getElementById('montageModal').classList.add('active');
      chargerVoixMontage();
      renderMontageEtat();
    });
    await page.waitForTimeout(150);

    // Aucune carte parente ne doit clipper le contenu qui en déborde : sinon
    // le menu déroulant (positionné en absolu par rapport à la carte) se
    // retrouve coupé net à la bordure de la carte.
    const overflowCarte = await page.evaluate(() => {
      const carte = document.getElementById('montageVoixSelect').closest('.montage-section');
      return getComputedStyle(carte).overflow;
    });
    assert.notEqual(overflowCarte, 'hidden', 'la carte ne doit jamais avoir overflow:hidden, ça coupe les menus déroulants qui en débordent');

    await page.evaluate(() => {
      document.getElementById('montageVoixSelect').closest('.custom-select').scrollIntoView({ block: 'center' });
    });
    await page.evaluate(() => {
      document.getElementById('montageVoixSelect').closest('.custom-select').querySelector('.custom-select-trigger').click();
    });
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const rects = await page.evaluate(() => {
      const wrap = document.getElementById('montageVoixSelect').closest('.custom-select');
      const panel = wrap.querySelector('.custom-select-panel');
      const carte = wrap.closest('.montage-section');
      const rPanel = panel.getBoundingClientRect();
      const rCarte = carte.getBoundingClientRect();
      return { panelHeight: rPanel.height, panelBottom: rPanel.bottom, carteBottom: rCarte.bottom };
    });
    // Le panneau ouvert (2 options + l'option "Choisis une voix...") a une
    // vraie hauteur visible, et dépasse la carte qui le contient : la preuve
    // qu'il n'est plus rogné à la bordure de la carte.
    assert.ok(rects.panelHeight > 50, 'le panneau ouvert doit avoir une hauteur visible réelle : ' + JSON.stringify(rects));
    assert.ok(rects.panelBottom > rects.carteBottom, 'le panneau doit pouvoir déborder de la carte "Voix off" (pas de clip) : ' + JSON.stringify(rects));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : le menu déroulant "Volume de la musique" n\'est pas coupé par sa carte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MENUSNONCOUPES2', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(150);

    const overflowCarte = await page.evaluate(() => {
      const carte = document.getElementById('omMusiqueVolumeSelect').closest('.montage-section');
      return getComputedStyle(carte).overflow;
    });
    assert.notEqual(overflowCarte, 'hidden', 'la carte "Musique" du montage manuel ne doit jamais avoir overflow:hidden');

    await page.evaluate(() => {
      document.getElementById('omMusiqueVolumeSelect').closest('.custom-select').scrollIntoView({ block: 'center' });
    });
    await page.evaluate(() => {
      document.getElementById('omMusiqueVolumeSelect').closest('.custom-select').querySelector('.custom-select-trigger').click();
    });
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const rects = await page.evaluate(() => {
      const wrap = document.getElementById('omMusiqueVolumeSelect').closest('.custom-select');
      const panel = wrap.querySelector('.custom-select-panel');
      const carte = wrap.closest('.montage-section');
      const rPanel = panel.getBoundingClientRect();
      const rCarte = carte.getBoundingClientRect();
      return { panelHeight: rPanel.height, panelBottom: rPanel.bottom, carteBottom: rCarte.bottom };
    });
    assert.ok(rects.panelHeight > 50, 'le panneau ouvert (10 choix de volume) doit avoir une hauteur visible réelle : ' + JSON.stringify(rects));
    assert.ok(rects.panelBottom > rects.carteBottom, 'le panneau doit pouvoir déborder de la carte "Musique" (pas de clip) : ' + JSON.stringify(rects));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

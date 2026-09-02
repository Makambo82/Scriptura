// Retour propriétaire, section Images du panneau de montage (storyboard IA) :
// 1) un style graphique choisi AU MONTAGE prime sur celui déjà présent dans
//    les prompts du storyboard (utile si le créateur change d'avis après
//    avoir généré son storyboard) - mais SEULEMENT s'il choisit un style ici,
//    sinon les prompts du storyboard partent inchangés ;
// 2) un bouton "supprimer" (icône seule) à côté de "Tout sélectionner" pour
//    retirer les images cochées d'un coup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const PROMPT_ORIGINAL = 'A cat sitting. Rendered as a classic oil painting with visible brushstrokes and canvas texture, a painterly fine-art illustration, not a photograph. 9:16';

async function ouvrirPanneauAvecUnPlan(page) {
  await page.evaluate((prompt) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.body.classList.add('is-admin');
    montagePlans = [{ text: 'Un plan.', visuel: prompt }];
    montageImages = [null];
    document.getElementById('montageModal').classList.add('active');
    // Reproduit ce que fait ouvrirMontage() pour ce menu précis (jamais
    // appelé ici directement, ce test cible juste la section Images).
    const sel = document.getElementById('montageStyleSelect');
    sel.innerHTML = stylesVisuelsOptionsHTML('');
    sel.value = '';
    chargerVoixMontage();
    renderMontageEtat();
  }, PROMPT_ORIGINAL);
  await page.waitForTimeout(100);
}

test('Montage : sans toucher au style, le prompt du storyboard part inchangé (style + ratio d\'origine)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    const appels = [];
    await page.route('**/api/montage-media?action=images', route => {
      appels.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [{ base64: 'eA==', mimeType: 'image/png' }], erreurs: [null] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'STYLEMONTAGE1', plan: 'creator' });
    await page.waitForTimeout(150);
    await ouvrirPanneauAvecUnPlan(page);

    await page.evaluate(() => genererImagesMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(appels.length, 1);
    assert.equal(appels[0].prompts[0], PROMPT_ORIGINAL, 'le prompt doit partir strictement inchangé sans choix de style au montage : ' + JSON.stringify(appels[0]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage : choisir un style ici remplace le médium du prompt du storyboard, sans jamais toucher le ratio', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    const appels = [];
    await page.route('**/api/montage-media?action=images', route => {
      appels.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [{ base64: 'eA==', mimeType: 'image/png' }], erreurs: [null] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'STYLEMONTAGE2', plan: 'creator' });
    await page.waitForTimeout(150);
    await ouvrirPanneauAvecUnPlan(page);

    await page.evaluate(() => {
      const sel = document.getElementById('montageStyleSelect');
      sel.value = 'aquarelle';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => genererImagesMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(appels.length, 1);
    const prompt = appels[0].prompts[0];
    assert.ok(!prompt.includes('oil painting'), 'l\'ancien style (storyboard) ne doit plus apparaître : ' + prompt);
    assert.ok(prompt.includes('watercolor'), 'le nouveau style choisi au montage doit apparaître : ' + prompt);
    assert.ok(prompt.trim().endsWith('9:16'), 'le ratio du plan (9:16) ne doit jamais changer avec le style : ' + prompt);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage : changer de style invalide les images déjà générées (elles reflétaient l\'ancien choix)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'STYLEMONTAGE3', plan: 'creator' });
    await page.waitForTimeout(150);
    await ouvrirPanneauAvecUnPlan(page);

    await page.evaluate(() => {
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      renderMontageEtat();
    });
    await page.evaluate(() => {
      const sel = document.getElementById('montageStyleSelect');
      sel.value = 'bd';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(100);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    const images = await page.evaluate(() => montageImages);
    assert.deepEqual(images, [null], 'l\'image déjà générée (ancien style) doit être invalidée par le changement de style : ' + JSON.stringify(images));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage : "Tout sélectionner" puis le bouton supprimer retire les images cochées (remises à null)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SUPPRIMAGES1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Plan 1.', visuel: 'x 9:16' }, { text: 'Plan 2.', visuel: 'y 9:16' }];
      montageImages = [
        { blob: new Blob(['a']), apercu: 'data:image/png;base64,a' },
        { blob: new Blob(['b']), apercu: 'data:image/png;base64,b' }
      ];
      document.getElementById('montageModal').classList.add('active');
      renderMontageEtat();
    });
    await page.waitForTimeout(100);

    const desactiveAvantSelection = await page.evaluate(() => document.getElementById('montageDelSelectionBtn').disabled);
    assert.equal(desactiveAvantSelection, true, 'le bouton supprimer doit être désactivé tant que rien n\'est sélectionné');

    await page.evaluate(() => toggleToutSelectionnerImages());
    const activeApresSelection = await page.evaluate(() => document.getElementById('montageDelSelectionBtn').disabled);
    assert.equal(activeApresSelection, false, 'le bouton supprimer doit devenir actif une fois une sélection faite');

    await page.evaluate(() => supprimerImagesSelectionnees());
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    const imagesApres = await page.evaluate(() => montageImages);
    assert.deepEqual(imagesApres, [null, null], 'les deux images sélectionnées doivent être supprimées : ' + JSON.stringify(imagesApres));
    const selectionApres = await page.evaluate(() => montageImagesSelection.size);
    assert.equal(selectionApres, 0, 'la sélection doit être vidée après suppression');
    const desactiveApresSuppression = await page.evaluate(() => document.getElementById('montageDelSelectionBtn').disabled);
    assert.equal(desactiveApresSuppression, true, 'le bouton supprimer doit redevenir désactivé, plus rien à supprimer');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire : sélecteur de vitesse de lecture de la voix off
// (0,5x à 1,5x), côté client. Ce test vérifie le CÂBLAGE UI dans les deux
// flux de montage : le menu déroulant existe, change bien la vitesse
// mémorisée, et cette vitesse part dans la requête /api/montage-media
// (action=tts) au clic sur "Générer la voix off" — sans casser le reste du
// montage. Voir tests/montage-vitesse-voix-off.test.js pour la vérification
// serveur (transmission à ElevenLabs, bornage 0.5-1.5).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : le sélecteur de vitesse transmet la valeur choisie à la génération de la voix off', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    const appelsTts = [];
    await page.route('**/api/montage-media?action=tts', route => {
      appelsTts.push(JSON.parse(route.request().postData()));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [2], captions: [] })
      });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VITESSECASE1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Un seul plan.', visuel: 'Un décor 9:16' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      // Le panneau n'est affiché (donc interactif pour selectOption) qu'une
      // fois .active posé, normalement fait par ouvrirMontage() : ce test se
      // branche directement sur l'état pour rester ciblé sur la vitesse,
      // sans repasser par tout le flux d'ouverture depuis un storyboard.
      document.getElementById('montageModal').classList.add('active');
      renderMontageEtat();
    });

    // Par défaut, 1x (normal) : un montage lancé sans y toucher ne doit
    // jamais envoyer une vitesse surprenante.
    const vitesseParDefaut = await page.evaluate(() => document.getElementById('montageVitesseSelect').value);
    assert.equal(vitesseParDefaut, '1', 'la vitesse par défaut doit être 1x (normal)');

    await page.evaluate(() => genererVoixOffMontage());
    await page.waitForTimeout(150);
    if (erreursJs.length) throw new Error('Exceptions JS (vitesse par défaut) : ' + erreursJs.join(' | '));
    assert.equal(appelsTts.length, 1);
    assert.equal(appelsTts[0].speed, 1, 'la vitesse par défaut doit être envoyée telle quelle : ' + JSON.stringify(appelsTts[0]));

    // Changement de vitesse via le sélecteur (déclenche bien onchange, comme
    // un vrai choix utilisateur, pas juste .value posé en JS).
    await page.selectOption('#montageVitesseSelect', '0.7');
    await page.evaluate(() => genererVoixOffMontage());
    await page.waitForTimeout(150);
    if (erreursJs.length) throw new Error('Exceptions JS (vitesse changée) : ' + erreursJs.join(' | '));
    assert.equal(appelsTts.length, 2);
    assert.equal(appelsTts[1].speed, 0.7, 'la vitesse choisie (0.7) doit partir dans la requête de génération : ' + JSON.stringify(appelsTts[1]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : le sélecteur de vitesse (mode IA) transmet la valeur choisie à la génération de la voix off', async () => {
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-vitesse-manuel-'));
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));
    const appelsTts = [];
    await page.route('**/api/montage-media?action=tts', route => {
      appelsTts.push(JSON.parse(route.request().postData()));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [2], captions: [] })
      });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VITESSECASE2', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(100);

    const cheminImg = path.join(dossierTmp, 'img1.png');
    fs.writeFileSync(cheminImg, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex'));
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg]);
    await page.waitForTimeout(100);

    await page.evaluate(() => omChoisirModeVoix('ia'));
    await page.waitForTimeout(100);

    // Le sélecteur de vitesse n'existe qu'en mode IA (aucun sens pour un
    // fichier uploadé, dont la vitesse n'est pas modifiable par l'app).
    const vitesseParDefaut = await page.evaluate(() => document.getElementById('omVitesseSelect')?.value);
    assert.equal(vitesseParDefaut, '1', 'la vitesse par défaut doit être 1x (normal)');

    await page.evaluate(() => {
      const t = document.getElementById('omTexteNarration');
      t.value = 'Une seule ligne.';
      t.dispatchEvent(new Event('input'));
    });
    await page.selectOption('#omVitesseSelect', '1.3');
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(150);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(appelsTts.length, 1);
    assert.equal(appelsTts[0].speed, 1.3, 'la vitesse choisie (1.3) doit partir dans la requête de génération : ' + JSON.stringify(appelsTts[0]));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

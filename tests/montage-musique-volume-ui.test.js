// Retour propriétaire : réglage du volume de la musique de fond (5% à 50%,
// relatif à la voix off qui reste à 100%), câblé côté client dans les deux
// flux de montage. Ce test vérifie que la valeur choisie dans le menu part
// bien dans musicVolume au moment du rendu, par défaut 15%, sans jamais
// dépendre de si la musique a déjà été générée ou non (contrairement à la
// vitesse de la voix off, changer le volume ne régénère jamais rien : c'est
// un réglage de mélange appliqué au rendu, voir render-service/server.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : le volume de la musique choisi dans le menu part dans musicVolume au rendu', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    const appelsRender = [];
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/test.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VOLUMECASE1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Un seul plan.', visuel: 'Un décor 9:16' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      montageVoixOff = { blob: new Blob(['audio']), url: 'blob:x', durations: [2], captions: [] };
      supabaseClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } }) }) }
      };
      document.getElementById('montageModal').classList.add('active');
      renderMontageEtat();
    });

    // Par défaut 15%, même sans musique générée (une musique de fond n'est
    // jamais obligatoire, le champ part quand même au cas où le fondateur en
    // ajoute une plus tard sans relancer le montage).
    const volumeParDefaut = await page.evaluate(() => document.getElementById('montageMusiqueVolumeSelect').value);
    assert.equal(volumeParDefaut, '0.15', 'le volume par défaut doit être 15%');

    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (volume par défaut) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.equal(appelsRender[0].musicVolume, 0.15, 'le volume par défaut doit partir dans la requête de rendu : ' + JSON.stringify(appelsRender[0]));

    // Changement de volume via le menu (vrai événement change, pas juste
    // .value posé en JS).
    await page.selectOption('#montageMusiqueVolumeSelect', '0.35');
    await page.evaluate(() => { montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }]; });
    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (volume changé) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.equal(appelsRender[1].musicVolume, 0.35, 'le volume choisi (35%) doit partir dans la requête de rendu : ' + JSON.stringify(appelsRender[1]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : le volume de la musique choisi dans le menu part dans musicVolume au rendu', async () => {
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-volume-manuel-'));
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
    const appelsRender = [];
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VOLUMECASE2', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      supabaseClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } }) }) }
      };
    });
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(100);

    const cheminImg = path.join(dossierTmp, 'img1.png');
    fs.writeFileSync(cheminImg, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex'));
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg]);
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      omAudio = { blob: new Blob(['x']), url: 'blob:x', duree: 3, nom: 'voix.mp3', source: 'upload' };
      omDureesManuelles = [3];
      omRenderVoixZone();
      omMajBoutonLancer();
    });

    await page.selectOption('#omMusiqueVolumeSelect', '0.25');
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.equal(appelsRender[0].musicVolume, 0.25, 'le volume choisi (25%) doit partir dans la requête de rendu : ' + JSON.stringify(appelsRender[0]));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

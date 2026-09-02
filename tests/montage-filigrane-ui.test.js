// Retour propriétaire : filigrane "Scriptura" discret (coin bas, semi-
// transparent), activable/désactivable via une case à cocher, cochée par
// défaut (bénéfice de reconnaissance de marque). Ce test vérifie le câblage
// côté client dans les deux flux de montage : coché par défaut, envoie
// watermark:true au rendu ; décocher envoie watermark:false.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : "Filigrane Scriptura" coché par défaut, décocher envoie watermark:false', async () => {
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
    await connecterAbonne(page, { code: 'FILIGRANECASE1', plan: 'creator' });
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

    const cocheParDefaut = await page.evaluate(() => document.getElementById('montageFiligraneCheckbox').checked);
    assert.equal(cocheParDefaut, true, 'le filigrane doit être coché par défaut (bénéfice de reconnaissance de marque)');

    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (coché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.equal(appelsRender[0].watermark, true, 'coché (défaut) : watermark:true attendu : ' + JSON.stringify(appelsRender[0]));

    await page.evaluate(() => {
      document.getElementById('montageFiligraneCheckbox').checked = false;
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
    });
    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (décoché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.equal(appelsRender[1].watermark, false, 'décoché : watermark:false attendu : ' + JSON.stringify(appelsRender[1]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : "Filigrane Scriptura" coché par défaut, décocher envoie watermark:false', async () => {
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-filigrane-manuel-'));
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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FILIGRANECASE2', plan: 'creator' });
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
      omAudio = { blob: new Blob(['x']), url: 'blob:x', duree: 2, nom: 'voix.mp3', source: 'upload' };
      omDureesManuelles = [2];
      omRenderVoixZone();
      omMajBoutonLancer();
    });

    const cocheParDefaut = await page.evaluate(() => document.getElementById('omFiligraneCheckbox').checked);
    assert.equal(cocheParDefaut, true, 'le filigrane doit être coché par défaut');

    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (coché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.equal(appelsRender[0].watermark, true, 'coché (défaut) : watermark:true attendu : ' + JSON.stringify(appelsRender[0]));

    await page.evaluate(() => { document.getElementById('omFiligraneCheckbox').checked = false; });
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (décoché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.equal(appelsRender[1].watermark, false, 'décoché : watermark:false attendu : ' + JSON.stringify(appelsRender[1]));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

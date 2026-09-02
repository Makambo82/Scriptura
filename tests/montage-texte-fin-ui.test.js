// Retour propriétaire ("en tant que pro CapCut, quelles améliorations") :
// carton de fin (appel à l'action) dans les 2,5 dernières secondes, texte
// saisi par le créateur avant de lancer le montage, facultatif. Ce test
// vérifie le câblage côté client dans les deux flux de montage : le champ
// existe, sa valeur part dans endCardText au rendu, et un champ vide envoie
// une chaîne vide (jamais undefined, jamais bloquant).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : le texte de fin saisi part dans endCardText au rendu, vide par défaut', async () => {
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
    await connecterAbonne(page, { code: 'TEXTEFINCASE1', plan: 'creator' });
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

    // Vide par défaut : lancer sans y toucher ne doit jamais bloquer ni
    // envoyer autre chose qu'une chaîne vide.
    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (champ vide) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.equal(appelsRender[0].endCardText, '', 'un champ vide doit envoyer une chaîne vide : ' + JSON.stringify(appelsRender[0]));

    // Texte saisi : doit partir tel quel au prochain montage.
    await page.fill('#montageTexteFin', 'Suis pour plus de contenu comme ça');
    await page.evaluate(() => { montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }]; });
    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (texte saisi) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.equal(appelsRender[1].endCardText, 'Suis pour plus de contenu comme ça', 'le texte saisi doit partir dans la requête de rendu : ' + JSON.stringify(appelsRender[1]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : le texte de fin saisi part dans endCardText au rendu', async () => {
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-texte-fin-manuel-'));
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
    await connecterAbonne(page, { code: 'TEXTEFINCASE2', plan: 'creator' });
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

    await page.fill('#omTexteFin', 'Abonne-toi !');
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.equal(appelsRender[0].endCardText, 'Abonne-toi !', 'le texte saisi doit partir dans la requête de rendu : ' + JSON.stringify(appelsRender[0]));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

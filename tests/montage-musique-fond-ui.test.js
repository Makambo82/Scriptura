// Retour propriétaire : montage Scriptura "pas assez premium" face à un
// montage CapCut fait à la main, cause identifiée : aucune musique de fond
// dans le pipeline. Ce test vérifie le câblage CÔTÉ CLIENT (les deux flux de
// montage, storyboard IA et manuel) : générer une musique de fond l'inclut
// dans le rendu (musicUrl), "Retirer" l'exclut sans casser le reste du
// montage, et le bouton "Générer une musique de fond" reste désactivé tant
// qu'aucune voix off n'est prête (la durée demandée à Eleven Music se cale
// dessus, voir js/montage.js/genererMusiqueMontage).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : "Générer une musique de fond" inclut musicUrl au rendu, "Retirer" l\'exclut', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    const appelsMusique = [];
    await page.route('**/api/montage-media?action=music', route => {
      appelsMusique.push(JSON.parse(route.request().postData()));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('fausse-musique').toString('base64'), mimeType: 'audio/mpeg' })
      });
    });
    const appelsRender = [];
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/test.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MUSIQUECASE1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Un seul plan.', visuel: 'Un décor 9:16' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      supabaseClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } }) }) }
      };
      renderMontageEtat();
    });

    // Aucune voix off prête : le bouton musique doit rester désactivé (la
    // durée demandée à Eleven Music dépend de la durée de la voix off).
    const desactiveSansVoix = await page.evaluate(() => {
      const btn = document.querySelector('#montageMusiqueZone button');
      return btn ? btn.disabled : null;
    });
    assert.equal(desactiveSansVoix, true, 'sans voix off générée, le bouton "Générer une musique de fond" doit rester désactivé');

    await page.evaluate(() => {
      montageVoixOff = { blob: new Blob(['audio']), url: 'blob:x', durations: [2], captions: [] };
      renderMontageEtat();
    });

    await page.evaluate(() => genererMusiqueMontage());
    await page.waitForTimeout(150);
    if (erreursJs.length) throw new Error('Exceptions JS (génération musique) : ' + erreursJs.join(' | '));
    assert.equal(appelsMusique.length, 1);
    assert.equal(appelsMusique[0].dureeMs, 2000, 'la durée demandée à Eleven Music doit être calée sur la durée de la voix off (2s) : ' + JSON.stringify(appelsMusique[0]));

    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (rendu avec musique) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.match(appelsRender[0].musicUrl, /^https:\/\/x\.example\/montages\//, 'la musique générée doit être uploadée et son URL envoyée au rendu : ' + JSON.stringify(appelsRender[0]));
    assert.equal(appelsRender[0].images.length, 1, 'ajouter une musique de fond ne doit pas empêcher le reste du montage de partir normalement');

    // "Retirer" : le prochain montage ne doit plus inclure de musique.
    await page.evaluate(() => {
      retirerMusiqueMontage();
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
    });
    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (retrait musique) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.equal(appelsRender[1].musicUrl, '', 'après "Retirer", aucune musique ne doit être envoyée au rendu : ' + JSON.stringify(appelsRender[1]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : "Générer une musique de fond" inclut musicUrl au rendu (voix off uploadée)', async () => {
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-musique-manuel-'));
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
    const appelsMusique = [];
    await page.route('**/api/montage-media?action=music', route => {
      appelsMusique.push(JSON.parse(route.request().postData()));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('fausse-musique').toString('base64'), mimeType: 'audio/mpeg' })
      });
    });
    const appelsRender = [];
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MUSIQUECASE2', plan: 'creator' });
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

    // Voix off uploadée (source 'upload') : la musique doit se caler sur
    // omAudio.duree quelle que soit la source, pas seulement en mode IA.
    const cheminAudio = path.join(dossierTmp, 'voix.mp3');
    fs.writeFileSync(cheminAudio, Buffer.from('faux-mp3'));
    await page.evaluate(() => {
      // omLireDureeAudio dépend du décodage réel du fichier (impossible à
      // truquer facilement en test headless) : on injecte directement l'état
      // comme le ferait omAudioFichierChoisi, pour rester ciblé sur le
      // câblage musique testé ici.
      omAudio = { blob: new Blob(['x']), url: 'blob:x', duree: 3, nom: 'voix.mp3', source: 'upload' };
      omDureesManuelles = [3];
      omRenderVoixZone();
      omMajBoutonLancer();
    });

    await page.evaluate(() => omGenererMusique());
    await page.waitForTimeout(150);
    if (erreursJs.length) throw new Error('Exceptions JS (génération musique) : ' + erreursJs.join(' | '));
    assert.equal(appelsMusique.length, 1);
    assert.equal(appelsMusique[0].dureeMs, 3000, 'la durée demandée doit être calée sur omAudio.duree (3s), même pour une voix off uploadée : ' + JSON.stringify(appelsMusique[0]));

    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (rendu avec musique) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.match(appelsRender[0].musicUrl, /^https:\/\/x\.example\/montages\//, 'la musique générée doit être uploadée et son URL envoyée au rendu : ' + JSON.stringify(appelsRender[0]));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

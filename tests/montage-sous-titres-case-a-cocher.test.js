// Retour propriétaire : "que l'utilisateur ait la possibilité d'activer et
// de désactiver les sous-titres avant de lancer le montage". Case à cocher
// #montageSousTitresCheckbox (montage depuis un storyboard IA, js/montage.js)
// et #omSousTitresCheckbox (montage manuel, js/montage-manuel.js),
// cochées par défaut (retour propriétaire précédent : sans sous-titres, un
// montage TikTok "ne se sent pas fini"). Ce test vérifie que décocher
// empêche bien l'envoi des sous-titres au rendu, sans casser le montage
// lui-même (les images/audio doivent partir pareil).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CAPTIONS_TEST = [{ texte: 'Ceci est un test', debut: 0, fin: 0.8 }];

test('Montage (storyboard IA) : décocher "Sous-titres incrustés" envoie captions:[] au rendu, coché par défaut envoie les sous-titres', async () => {
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
    await connecterAbonne(page, { code: 'SOUSTITRESCASE1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate((captionsTest) => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Un seul plan.', visuel: 'Un décor 9:16' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      montageVoixOff = { blob: new Blob(['audio']), url: 'blob:x', durations: [2], captions: captionsTest };
      supabaseClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } }) }) }
      };
    }, CAPTIONS_TEST);

    // Cochée par défaut (voir l'attribut "checked" dans index.html) : un
    // montage lancé sans y toucher doit envoyer les sous-titres.
    const cocheParDefaut = await page.evaluate(() => document.getElementById('montageSousTitresCheckbox').checked);
    assert.equal(cocheParDefaut, true, 'la case doit être cochée par défaut (retour propriétaire : un montage sans sous-titres "ne se sent pas fini")');

    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (coché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.deepEqual(appelsRender[0].captions, CAPTIONS_TEST, 'coché (défaut) : les sous-titres doivent être envoyés au rendu : ' + JSON.stringify(appelsRender[0]));

    // Décochée : le prochain montage ne doit PLUS envoyer de sous-titres,
    // même si montageVoixOff.captions existe toujours côté client.
    await page.evaluate(() => {
      document.getElementById('montageSousTitresCheckbox').checked = false;
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
    });
    await page.evaluate(() => lancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (décoché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.deepEqual(appelsRender[1].captions, [], 'décoché : aucun sous-titre ne doit être envoyé au rendu : ' + JSON.stringify(appelsRender[1]));
    // Le montage lui-même (images/audio) ne doit pas être affecté par ce choix.
    assert.equal(appelsRender[1].images.length, 1, 'décocher les sous-titres ne doit pas empêcher le reste du montage de partir normalement');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : décocher "Sous-titres incrustés" envoie captions:[] au rendu, coché par défaut envoie les sous-titres (voix IA)', async () => {
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-sous-titres-manuel-'));
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
    await page.route('**/api/montage-media?action=tts', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [2], captions: CAPTIONS_TEST })
    }));
    const appelsRender = [];
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SOUSTITRESCASE2', plan: 'creator' });
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

    await page.evaluate(() => omChoisirModeVoix('ia'));
    await page.evaluate(() => {
      const t = document.getElementById('omTexteNarration');
      t.value = 'Une seule ligne.';
      t.dispatchEvent(new Event('input'));
    });
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(150);

    const cocheParDefaut = await page.evaluate(() => document.getElementById('omSousTitresCheckbox').checked);
    assert.equal(cocheParDefaut, true, 'la case doit être cochée par défaut');

    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (coché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 1);
    assert.deepEqual(appelsRender[0].captions, CAPTIONS_TEST, 'coché (défaut) : les sous-titres doivent être envoyés : ' + JSON.stringify(appelsRender[0]));

    // Décochée : le prochain montage (même image, même voix off déjà prête)
    // ne doit plus envoyer de sous-titres.
    await page.evaluate(() => { document.getElementById('omSousTitresCheckbox').checked = false; });
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS (décoché) : ' + erreursJs.join(' | '));
    assert.equal(appelsRender.length, 2);
    assert.deepEqual(appelsRender[1].captions, [], 'décoché : aucun sous-titre ne doit être envoyé : ' + JSON.stringify(appelsRender[1]));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

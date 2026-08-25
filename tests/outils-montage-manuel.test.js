// « Monter une vidéo » (Outils TikTok) : variante du montage vidéo qui ne
// part pas d'un storyboard généré par l'IA, l'utilisateur uploade ses
// propres images + sa voix off (fichier existant ou texte à transformer via
// ElevenLabs). Réservé au fondateur (voir js/montage-manuel.js, css/style.css
// .outils-montage-btn). Ce test couvre : le verrouillage admin du bouton, le
// flux complet jusqu'au rendu (durées réparties également entre images,
// format déduit des proportions de la première image), et le garde-fou sur
// une durée audio invalide (jamais de montage lancé sur des données nulles).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Outils TikTok : "Monter une vidéo" est réservé au fondateur, visible seulement en body.is-admin', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'ABONNETEST', plan: 'creator' });
    await page.waitForTimeout(150);

    const visiblePourAbonne = await page.evaluate(() => {
      const btn = document.getElementById('outilsMontageOuvrirBtn');
      return btn && getComputedStyle(btn).display !== 'none';
    });
    assert.equal(visiblePourAbonne, false, 'un abonné non-fondateur ne doit jamais voir ce bouton');

    await page.evaluate(() => document.body.classList.add('is-admin'));
    const visiblePourAdmin = await page.evaluate(() => {
      const btn = document.getElementById('outilsMontageOuvrirBtn');
      return btn && getComputedStyle(btn).display !== 'none';
    });
    assert.equal(visiblePourAdmin, true, 'le fondateur doit voir le bouton "Monter une vidéo"');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Outils TikTok : montage manuel complet (images + voix off IA) jusqu\'au rendu', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-test-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const appelsRender = [];
    // Enregistrés APRÈS poserMocksReseau : Playwright évalue les routes dans
    // l'ordre INVERSE d'enregistrement (voir tests/erreurs-dependances-
    // externes.test.js), donc ceux-ci passent avant le filet générique.
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }, { id: 'v2', label: 'Fifa' }] })
    }));
    await page.route('**/api/montage-media?action=tts', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [12.5] })
    }));
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);

    // Stub Supabase Storage (upload/getPublicUrl) : pas de vrai backend en test.
    await page.evaluate(() => {
      supabaseClient = {
        storage: {
          from: () => ({
            upload: async () => ({ error: null }),
            getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } })
          })
        }
      };
    });

    await page.evaluate(() => { if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans(); ouvrirOutilsMontage(); });
    await page.waitForTimeout(100);

    const cheminImg1 = path.join(dossierTmp, 'img1.png');
    const cheminImg2 = path.join(dossierTmp, 'img2.png');
    const pngMinuscule = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex');
    fs.writeFileSync(cheminImg1, pngMinuscule);
    fs.writeFileSync(cheminImg2, pngMinuscule);
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg1, cheminImg2]);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => omImages.length), 2, 'les 2 images ajoutées doivent apparaître');

    assert.equal(
      await page.evaluate(() => document.getElementById('omLancerBtn').disabled),
      true,
      'le bouton doit rester désactivé tant qu\'il n\'y a pas de voix off'
    );

    await page.evaluate(() => omChoisirModeVoix('ia'));
    await page.evaluate(() => {
      const t = document.getElementById('omTexteNarration');
      t.value = 'Narration de test.';
      t.dispatchEvent(new Event('input'));
      omChangerVoix('v2');
    });
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => omAudio && omAudio.source), 'ia');
    assert.equal(await page.evaluate(() => omAudio && omAudio.duree), 12.5);
    assert.equal(await page.evaluate(() => document.getElementById('omLancerBtn').disabled), false);

    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);

    assert.equal(appelsRender.length, 1, '/api/montage-render doit être appelé une fois');
    const corps = appelsRender[0];
    assert.equal(corps.images.length, 2);
    // Durée réelle de la voix off répartie également entre les images (pas
    // de découpage narratif possible sans plans, voir js/montage-manuel.js).
    assert.equal(corps.images[0].duration, 6.25);
    assert.equal(corps.images[1].duration, 6.25);
    assert.ok(corps.audioUrl, 'audioUrl doit être transmis');
    assert.equal(corps.code_acces, 'FONDATEURTEST');
    assert.equal(corps.format, '9:16');

    const resultatHtml = await page.evaluate(() => document.getElementById('omResultat').innerHTML);
    assert.match(resultatHtml, /manuel\.mp4/, 'la vidéo rendue doit s\'afficher dans le résultat');

    assert.deepEqual(erreursJs, [], 'aucune exception JS pendant tout le flux');
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

test('Outils TikTok : détection de format (ratio image) + garde-fou sur une durée audio invalide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-test2-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST2', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);

    // Détection de format à partir des proportions : isolée de la vraie
    // décoexploded d'image en simulant naturalWidth/naturalHeight.
    const formats = await page.evaluate(async () => {
      const OriginalImage = window.Image;
      function fauxImage(w, h) {
        return { set src(v) { setTimeout(() => { this.naturalWidth = w; this.naturalHeight = h; this.onload && this.onload(); }, 0); }, onload: null, onerror: null };
      }
      omImages = [{ url: 'x' }];
      const cas = [];
      window.Image = function () { return fauxImage(1080, 1920); };
      cas.push(await omDetecterFormat());
      window.Image = function () { return fauxImage(1920, 1080); };
      cas.push(await omDetecterFormat());
      window.Image = function () { return fauxImage(1000, 1000); };
      cas.push(await omDetecterFormat());
      window.Image = OriginalImage;
      omImages = [];
      return cas;
    });
    assert.deepEqual(formats, ['9:16', '16:9', '1:1'], 'portrait/paysage/carré doivent donner le format le plus proche');

    // Fichier audio invalide (pas un vrai codec) : la durée lue doit être 0,
    // donc le montage ne doit jamais pouvoir démarrer avec des données nulles.
    await page.evaluate(() => ouvrirOutilsMontage());
    await page.waitForTimeout(100);
    const fauxAudio = path.join(dossierTmp, 'faux-audio.mp3');
    fs.writeFileSync(fauxAudio, Buffer.from('ceci-nest-pas-un-vrai-mp3'));
    await (await page.$('#omAudioInput')).setInputFiles(fauxAudio);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => omAudio && omAudio.duree), 0);
    assert.equal(
      await page.evaluate(() => document.getElementById('omLancerBtn').disabled),
      true,
      'un fichier audio à durée nulle/invalide ne doit jamais débloquer le montage'
    );

    assert.deepEqual(erreursJs, [], 'aucune exception JS pendant ce flux');
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

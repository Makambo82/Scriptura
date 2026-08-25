// « Monter une vidéo » (carte sur l'accueil, section "Services annexes",
// à côté de "Storyboard d'un script" et "Transcrire ou télécharger une
// vidéo") : variante du montage vidéo qui ne part pas d'un storyboard
// généré par l'IA, l'utilisateur uploade ses propres images + sa voix off
// (fichier existant ou texte à transformer via ElevenLabs). Réservé au
// fondateur (voir js/montage-manuel.js, css/style.css .outils-montage-home-btn).
//
// Point central testé ici : la SYNCHRO image/voix (retour direct du
// propriétaire : « il y aura un problème de synchronisation voix/image »).
// - Voix IA : une ligne de narration par image devient un segment
//   ElevenLabs séparé, avec sa vraie durée (pas une moyenne globale).
// - Voix uploadée : aucun découpage n'est devinable depuis un simple
//   fichier audio, donc la durée de chaque image reste réglable à la main
//   (pré-remplie à parts égales).
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
      const btn = document.getElementById('outilsMontageHomeBtn');
      return btn && getComputedStyle(btn).display !== 'none';
    });
    assert.equal(visiblePourAbonne, false, 'un abonné non-fondateur ne doit jamais voir ce bouton');

    await page.evaluate(() => document.body.classList.add('is-admin'));
    const visiblePourAdmin = await page.evaluate(() => {
      const btn = document.getElementById('outilsMontageHomeBtn');
      return btn && getComputedStyle(btn).display !== 'none';
    });
    assert.equal(visiblePourAdmin, true, 'le fondateur doit voir le bouton "Monter une vidéo"');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Outils TikTok : voix IA calée par image (une ligne = un segment = une vraie durée)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-test-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const appelsTts = [];
    const appelsRender = [];
    // Enregistrés APRÈS poserMocksReseau : Playwright évalue les routes dans
    // l'ordre INVERSE d'enregistrement (voir tests/erreurs-dependances-
    // externes.test.js), donc ceux-ci passent avant le filet générique.
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));
    await page.route('**/api/montage-media?action=tts', route => {
      const body = JSON.parse(route.request().postData());
      appelsTts.push(body);
      // Durées volontairement DIFFÉRENTES pour prouver que ce n'est pas une
      // moyenne : la ligne la plus longue dure plus longtemps.
      const durations = body.segments.map((s) => Math.round(s.length * 0.1 * 10) / 10);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations })
      });
    });
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);

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

    // ouvrirOutilsTikTok() affiche d'abord l'écran #tiktokOutilsFlow qui
    // contient tout ce qui suit (ouvrirOutilsMontage() ne fait que basculer
    // entre ses deux sous-blocs, il suppose l'écran déjà visible, comme au
    // clic réel sur le bouton "Monter une vidéo") : sans cet appel, les
    // champs restent en display:none hérité, invisibles pour Playwright
    // bien qu'ils existent dans le DOM.
    // Même point d'entrée que la carte "Monter une vidéo" de l'accueil.
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(100);

    const cheminImg1 = path.join(dossierTmp, 'img1.png');
    const cheminImg2 = path.join(dossierTmp, 'img2.png');
    const pngMinuscule = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex');
    fs.writeFileSync(cheminImg1, pngMinuscule);
    fs.writeFileSync(cheminImg2, pngMinuscule);
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg1, cheminImg2]);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => omImages.length), 2);

    await page.evaluate(() => omChoisirModeVoix('ia'));

    // Nombre de lignes ≠ nombre d'images : doit être refusé avec un message clair.
    await page.evaluate(() => {
      const t = document.getElementById('omTexteNarration');
      t.value = 'Une seule ligne';
      t.dispatchEvent(new Event('input'));
    });
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(100);
    const erreurLignes = await page.evaluate(() => document.getElementById('omErreur').textContent);
    assert.match(erreurLignes, /une ligne de narration par image/i, 'doit expliquer qu\'il faut une ligne par image');
    assert.equal(appelsTts.length, 0, 'ne doit jamais appeler ElevenLabs avec un nombre de lignes incorrect');

    // Le bon nombre de lignes, de longueurs différentes.
    await page.evaluate(() => {
      const t = document.getElementById('omTexteNarration');
      t.value = 'Courte.\nUne phrase beaucoup plus longue pour cette seconde image.';
      t.dispatchEvent(new Event('input'));
    });
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(150);

    assert.equal(appelsTts.length, 1);
    assert.deepEqual(appelsTts[0].segments, ['Courte.', 'Une phrase beaucoup plus longue pour cette seconde image.']);
    const durations = await page.evaluate(() => omAudio.durations);
    assert.equal(durations.length, 2);
    assert.notEqual(durations[0], durations[1], 'les deux images ne doivent pas partager une durée moyenne identique');

    assert.equal(await page.evaluate(() => document.getElementById('omLancerBtn').disabled), false);
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);

    assert.equal(appelsRender.length, 1);
    const corps = appelsRender[0];
    assert.equal(corps.images.length, 2);
    // Les durées envoyées au rendu doivent être EXACTEMENT celles renvoyées
    // par ElevenLabs pour chaque segment, pas une moyenne recalculée.
    assert.deepEqual(corps.images.map(im => im.duration), durations);

    assert.deepEqual(erreursJs, []);
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

test('Outils TikTok : voix uploadée, durée de chaque image réglable à la main', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-test2-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const appelsRender = [];
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ voices: [] })
    }));
    await page.route('**/api/montage-render', route => {
      appelsRender.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel2.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST3', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);

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

    // ouvrirOutilsTikTok() affiche d'abord l'écran #tiktokOutilsFlow qui
    // contient tout ce qui suit (ouvrirOutilsMontage() ne fait que basculer
    // entre ses deux sous-blocs, il suppose l'écran déjà visible, comme au
    // clic réel sur le bouton "Monter une vidéo") : sans cet appel, les
    // champs restent en display:none hérité, invisibles pour Playwright
    // bien qu'ils existent dans le DOM.
    // Même point d'entrée que la carte "Monter une vidéo" de l'accueil.
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(100);

    const cheminImg1 = path.join(dossierTmp, 'img1.png');
    const cheminImg2 = path.join(dossierTmp, 'img2.png');
    const pngMinuscule = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex');
    fs.writeFileSync(cheminImg1, pngMinuscule);
    fs.writeFileSync(cheminImg2, pngMinuscule);
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg1, cheminImg2]);
    await page.waitForTimeout(100);

    // Fichier "audio" factice : la vraie durée ne peut pas être lue par le
    // décodeur (pas un vrai codec), on force donc une durée directement en
    // mémoire pour tester le réglage manuel indépendamment du décodage.
    const fauxAudio = path.join(dossierTmp, 'voix.mp3');
    fs.writeFileSync(fauxAudio, Buffer.from('faux-mp3'));
    await (await page.$('#omAudioInput')).setInputFiles(fauxAudio);
    await page.waitForTimeout(200);
    await page.evaluate(() => { omAudio.duree = 20; omInitDureesManuelles(); omRenderDureesManuelles(); omMajBoutonLancer(); });

    const dureesInitiales = await page.evaluate(() => omDureesManuelles.slice());
    assert.deepEqual(dureesInitiales, [10, 10], 'parts égales par défaut (20s / 2 images)');

    const champsDuree = await page.$$('#omDureesZone input[type="number"]');
    assert.equal(champsDuree.length, 2, 'un champ de durée par image');

    // Réglage manuel : la première image dure plus longtemps que la seconde.
    await champsDuree[0].fill('14');
    await champsDuree[0].dispatchEvent('input');
    await champsDuree[1].fill('6');
    await champsDuree[1].dispatchEvent('input');
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => omDureesManuelles), [14, 6]);

    assert.equal(await page.evaluate(() => document.getElementById('omLancerBtn').disabled), false);
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(200);

    assert.equal(appelsRender.length, 1);
    const corps = appelsRender[0];
    assert.deepEqual(corps.images.map(im => im.duration), [14, 6], 'les durées manuelles doivent être transmises telles quelles, pas une moyenne');

    assert.deepEqual(erreursJs, []);
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

test('Outils TikTok : détection de format (ratio image) + garde-fou sur une durée audio invalide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-test4-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST4', plan: 'creator' });
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
    // Même point d'entrée que la carte "Monter une vidéo" de l'accueil.
    await page.evaluate(() => ouvrirMontageManuelAccueil());
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

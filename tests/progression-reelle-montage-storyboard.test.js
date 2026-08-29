// Montage depuis un storyboard généré par l'IA (js/montage.js, distinct du
// montage manuel js/montage-manuel.js déjà couvert par
// tests/montage-echecs-journalises.test.js) : 3 barres de progression
// n'affichaient encore AUCUN pourcentage avant ce chantier :
// - génération des images (une par une, séquentielle) : montageImagesLoader,
//   sans aucun span de %. Corrigée en % RÉEL (montageImageIndexEnCours /
//   montagePlans.length est déjà connu avec certitude à chaque appel).
// - génération de la voix off (ElevenLabs, appel unique non flux) et rendu
//   FFmpeg (Railway ou repli local, appel unique) : pas de signal réel
//   disponible, converties en estimation de temps chiffrée (createProgress),
//   même mécanisme déjà en place pour js/montage-manuel.js, au lieu d'une
//   simple bande rayée dorée sans aucun chiffre.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : % réel sur la génération d\'images, % estimé chiffré sur la voix off et le rendu', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    const pngMinuscule64 = '89504e470d0a1a0a0000000d49484452000000010000000108020000009077';
    await page.route('**/api/montage-media?action=images', async (route) => {
      await new Promise((r) => setTimeout(r, 150));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [{ base64: Buffer.from(pngMinuscule64, 'hex').toString('base64'), mimeType: 'image/png' }] }) });
    });
    await page.route('**/api/montage-media?action=tts', async (route) => {
      await new Promise((r) => setTimeout(r, 250));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [2, 2, 2] }) });
    });
    await page.route('**/api/montage-render', async (route) => {
      await new Promise((r) => setTimeout(r, 250));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/test.mp4' }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROGMONTAGE1', plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [
        { text: 'Premier plan du montage.', visuel: 'Un décor 9:16' },
        { text: 'Deuxième plan du montage.', visuel: 'Un autre décor 9:16' },
        { text: 'Troisième plan du montage.', visuel: 'Encore un décor 9:16' }
      ];
      montageImages = new Array(montagePlans.length).fill(null);
      montageVoixOff = null;
    });

    // 1) Génération des images : % RÉEL, doit avancer avec l'index réel.
    // (montageImageIndexEnCours passe à 0 AVANT même le 1er appel réseau,
    // donc le % reste à 0 tant que la 1ère image n'est pas terminée : marge
    // large ici, 400ms pour un mock de 150ms/image, pour rester fiable même
    // sous charge CI où plusieurs suites tournent en parallèle, constaté en
    // usage réel avec 200ms, marge alors trop juste.)
    const genImgPromise = page.evaluate(() => genererImagesMontage());
    await page.waitForTimeout(400);
    const etatImg = await page.evaluate(() => {
      const el = document.getElementById('montageImagesLoaderPct');
      return el ? { pct: parseInt(el.textContent, 10), visible: getComputedStyle(el).display !== 'none' } : { pct: null, visible: false };
    });
    await genImgPromise;
    if (erreursJs.length) throw new Error('Exceptions JS (images) : ' + erreursJs.join(' | '));
    // Visible pour de vrai, pas seulement présent dans le DOM (voir
    // css/style.css : un vrai bug caché a longtemps masqué ce chiffre par
    // CSS, invisible à un test qui ne vérifie que le texte).
    assert.equal(etatImg.visible, true, 'le % des images doit être visible à l\'écran, pas masqué par CSS');
    assert.ok(etatImg.pct !== null && etatImg.pct > 0, '% réel doit avoir avancé pendant la génération des images (index/total déjà connu) : ' + etatImg.pct);
    const pctImgFinal = await page.evaluate(() => document.getElementById('montageImagesLoader').style.display);
    assert.equal(pctImgFinal, 'none', 'la barre d\'images doit disparaître une fois toutes les images obtenues');

    // 2) Génération de la voix off : barre + % (estimé, chiffré) visibles pendant l'attente.
    const genVoixPromise = page.evaluate(() => genererVoixOffMontage());
    await page.waitForTimeout(150);
    const etatVoix = await page.evaluate(() => {
      const bar = document.getElementById('montageVoixProgBar');
      const pct = document.getElementById('montageVoixProgPct');
      return {
        visible: !!bar,
        pctVisible: !!pct && getComputedStyle(pct).display !== 'none',
        pct: pct ? pct.textContent : null
      };
    });
    await genVoixPromise;
    if (erreursJs.length) throw new Error('Exceptions JS (voix off) : ' + erreursJs.join(' | '));
    assert.equal(etatVoix.visible, true, 'la barre de progression de la voix off doit être visible pendant l\'attente');
    assert.equal(etatVoix.pctVisible, true, 'le % de la voix off doit être visible à l\'écran, pas masqué par CSS');
    assert.ok(etatVoix.pct && etatVoix.pct !== '0%', 'le % de la voix off doit avoir commencé à progresser : ' + etatVoix.pct);
    const voixPrete = await page.evaluate(() => !!montageVoixOff);
    assert.equal(voixPrete, true, 'la voix off doit être prête après un appel réussi');

    // 3) Rendu (upload images/audio + FFmpeg) : barre + % visibles, texte de
    // statut simple (plus de bande rayée décorative imbriquée en double).
    await page.evaluate(() => {
      supabaseClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } }) }) }
      };
    });
    const lancerPromise = page.evaluate(() => lancerMontage());
    await page.waitForTimeout(150);
    const etatRendu = await page.evaluate(() => {
      const bar = document.getElementById('montageProgBar');
      const pct = document.getElementById('montageProgPct');
      const statutHtml = document.getElementById('montageStatut').innerHTML;
      return {
        visible: bar ? getComputedStyle(bar).display !== 'none' : false,
        pctVisible: !!pct && getComputedStyle(pct).display !== 'none',
        statutHtml
      };
    });
    await lancerPromise;
    if (erreursJs.length) throw new Error('Exceptions JS (rendu) : ' + erreursJs.join(' | '));
    assert.equal(etatRendu.visible, true, 'la barre de progression du rendu doit être visible pendant l\'attente');
    assert.equal(etatRendu.pctVisible, true, 'le % du rendu doit être visible à l\'écran, pas masqué par CSS');
    assert.ok(!etatRendu.statutHtml.includes('sb-progress-bar'), 'le texte de statut ne doit plus imbriquer de barre décorative en double : ' + etatRendu.statutHtml);

    const videoAffichee = await page.evaluate(() => !!document.querySelector('#montageResultat video'));
    assert.equal(videoAffichee, true, 'la vidéo rendue doit être affichée à la fin');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

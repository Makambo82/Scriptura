// Retour direct du propriétaire, après un vrai crash FFmpeg (OOM Railway,
// "code null") jamais vu dans le Tableau de bord : "Pourquoi cet échec est
// pas apparu dans le tableau de bord". Cause réelle : la carte "Échecs de
// génération" n'est alimentée que par un fetch('/api/data', {resource:
// 'erreur', ...}) câblé dans callAI (js/api.js) et, depuis cette session,
// dans le diagnostic sommaire / l'analyse virale. Le montage vidéo appelle
// directement /api/montage-media et /api/montage-render, jamais callAI :
// un échec (voix off ElevenLabs, rendu FFmpeg) restait invisible côté
// fondateur, silencieux dans #omErreur uniquement.
// Ce test vérifie que les deux étapes du montage manuel journalisent bien
// leur échec (mode 'montageVoixOff' / 'montageRendu'), et qu'au passage,
// #omStatut n'imbrique plus la bande rayée décorative de montageStatutHTML
// (js/montage.js) EN PLUS de la vraie barre de progression #omMontageProgBar
// (ajoutée juste avant dans cette même session) : les deux ensemble
// donnaient deux barres empilées pour une seule attente (signalé sur
// capture d'écran).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage manuel : un échec de voix off ou de rendu est journalisé pour le Tableau de bord, une seule barre de progression pendant le rendu', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'montage-echecs-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));

    const appelsData = [];
    await page.route('**/api/data', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        try { appelsData.push(JSON.parse(req.postData())); } catch (e) { /* ignore */ }
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // 1) La génération de la voix off échoue → doit journaliser montageVoixOff.
    await page.route('**/api/montage-media?action=tts', route => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'ElevenLabs indisponible' } })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      supabaseClient = {
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (chemin) => ({ data: { publicUrl: 'https://x.example/montages/' + chemin } }) }) }
      };
    });
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(100);

    const cheminImg1 = path.join(dossierTmp, 'img1.png');
    const pngMinuscule = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077', 'hex');
    fs.writeFileSync(cheminImg1, pngMinuscule);
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg1]);
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      omChoisirModeVoix('ia');
      document.getElementById('omTexteNarration').value = 'Une ligne.';
      document.getElementById('omTexteNarration').dispatchEvent(new Event('input'));
    });
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(300);

    const appelVoix = appelsData.find(a => a.resource === 'erreur' && a.mode === 'montageVoixOff');
    assert.ok(appelVoix, 'un échec de génération de la voix off doit être journalisé (mode montageVoixOff) : reçu ' + JSON.stringify(appelsData));

    // 2) La voix off réussit, le rendu échoue (message imitant le vrai crash
    // FFmpeg signalé) → doit journaliser montageRendu, et une seule barre de
    // progression (la vraie, avec pourcentage) doit rester visible pendant
    // "Envoi des fichiers…".
    await page.unroute('**/api/montage-media?action=tts');
    await page.route('**/api/montage-media?action=tts', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [3] })
    }));
    await page.route('**/api/montage-render', async route => {
      await new Promise(r => setTimeout(r, 500));
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Erreur de rendu : FFmpeg a été interrompu par le système (signal SIGKILL)' } }) });
    });

    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(300);
    const boutonActif = await page.evaluate(() => !document.getElementById('omLancerBtn').disabled);
    assert.equal(boutonActif, true, 'le bouton "Démarrer le montage" doit être actif après une voix off générée avec succès');

    const clicMontage = page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(250);

    const statutHtml = await page.evaluate(() => document.getElementById('omStatut').innerHTML);
    assert.ok(!statutHtml.includes('sb-progress-bar'), 'le texte de statut ne doit plus imbriquer de barre décorative en double : ' + statutHtml);

    const barreVisible = await page.evaluate(() => getComputedStyle(document.getElementById('omMontageProgBar')).display !== 'none');
    assert.equal(barreVisible, true, 'la vraie barre de progression doit rester visible pendant le rendu');

    await clicMontage;
    await page.waitForTimeout(100);

    const appelRendu = appelsData.find(a => a.resource === 'erreur' && a.mode === 'montageRendu');
    assert.ok(appelRendu, 'un échec de rendu doit être journalisé (mode montageRendu) : reçu ' + JSON.stringify(appelsData));
    assert.match(appelRendu.detail, /SIGKILL/, 'le détail journalisé doit conserver le vrai message d\'erreur');

    assert.deepEqual(erreursJs, [], 'aucune exception JS ne doit survenir : ' + erreursJs.join(' | '));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

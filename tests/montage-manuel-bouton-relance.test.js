// Retour direct du propriétaire (avec capture d'écran) : après un montage
// manuel réussi, le bouton restait affiché "Démarrer le montage", comme
// s'il ne s'était rien passé. Il doit désormais devenir "Monter une autre
// vidéo" et repartir d'un montage vide au clic. Vérifie aussi qu'un
// changement après coup (nouvelle image) invalide le résultat affiché et
// remet le bouton dans son état d'origine, plutôt que de laisser une
// ancienne vidéo affichée à côté de réglages qui ne lui correspondent plus.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage manuel : le bouton devient "Monter une autre vidéo" après un montage réussi, et repart à zéro au clic', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'montage-relance-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));
    await page.route('**/api/montage-media?action=tts', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [3] })
    }));
    await page.route('**/api/montage-render', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://x.example/montages/rendus/manuel.mp4' })
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
    await page.waitForTimeout(200);

    const avantLabel = await page.evaluate(() => document.getElementById('omLancerBtn').textContent.trim());
    assert.equal(avantLabel, 'Démarrer le montage', 'avant tout montage, le libellé doit rester inchangé');

    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const apresLabel = await page.evaluate(() => document.getElementById('omLancerBtn').textContent.trim());
    assert.equal(apresLabel, 'Monter une autre vidéo', 'après un montage réussi, le bouton doit inviter à en monter une autre');
    const videoAffichee = await page.evaluate(() => !!document.querySelector('#omResultat video'));
    assert.equal(videoAffichee, true, 'la vidéo rendue doit être affichée');

    // Ajouter une nouvelle image après coup : le résultat affiché ne
    // correspond plus aux réglages actuels, il doit disparaître et le
    // bouton redevenir "Démarrer le montage" (jamais une vidéo obsolète
    // affichée à côté d'un bouton qui prétend pouvoir en refaire une autre).
    const cheminImg2 = path.join(dossierTmp, 'img2.png');
    fs.writeFileSync(cheminImg2, pngMinuscule);
    await (await page.$('#omImagesInput')).setInputFiles([cheminImg2]);
    await page.waitForTimeout(100);

    const labelApresAjout = await page.evaluate(() => document.getElementById('omLancerBtn').textContent.trim());
    assert.equal(labelApresAjout, 'Démarrer le montage', 'ajouter une image après coup doit invalider l\'ancien résultat et le libellé');
    const videoEncoreLa = await page.evaluate(() => !!document.querySelector('#omResultat video'));
    assert.equal(videoEncoreLa, false, 'l\'ancienne vidéo ne doit plus être affichée une fois les réglages changés');

    // Retire l'image ajoutée, régénère la voix off, relance : on revérifie
    // qu'un clic sur "Monter une autre vidéo" repart bien d'un état vide.
    await page.evaluate(() => omRetirerImage(1));
    await page.waitForTimeout(100);
    await page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(200);
    await page.evaluate(() => omLancerMontage());
    await page.waitForTimeout(300);
    const labelRelance = await page.evaluate(() => document.getElementById('omLancerBtn').textContent.trim());
    assert.equal(labelRelance, 'Monter une autre vidéo');

    await page.evaluate(() => omNouveauMontage());
    await page.waitForTimeout(100);
    const etatApresReset = await page.evaluate(() => ({
      label: document.getElementById('omLancerBtn').textContent.trim(),
      disabled: document.getElementById('omLancerBtn').disabled,
      images: omImages.length,
      resultatVide: document.getElementById('omResultat').innerHTML.trim() === ''
    }));
    assert.equal(etatApresReset.label, 'Démarrer le montage', 'après clic sur "Monter une autre vidéo", le libellé doit repartir à zéro');
    assert.equal(etatApresReset.disabled, true, 'le bouton doit redevenir désactivé (aucune image, aucune voix off)');
    assert.equal(etatApresReset.images, 0, 'les images doivent être vidées');
    assert.equal(etatApresReset.resultatVide, true, 'le résultat précédent doit être vidé');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

// Audit du 2 septembre 2026 : rien n'empêchait d'ajouter/retirer une image
// pendant qu'une voix IA était en cours de génération. Si le nombre
// d'images retombait par coïncidence sur la même valeur au moment où la
// voix devenait "prête", elle pouvait correspondre à un texte désynchronisé
// des images réellement affichées, sans aucun signal. Vérifie que l'ajout
// et le retrait d'image sont bloqués pendant la génération, et redeviennent
// possibles une fois terminée.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage manuel : images verrouillées pendant la génération de la voix IA, redéverrouillées ensuite', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'montage-verrou-images-'));
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ voices: [{ id: 'v1', label: 'Adrien' }] })
    }));
    // La génération TTS reste en attente jusqu'à ce que le test la débloque
    // explicitement, pour observer l'état PENDANT la génération.
    let debloquerTts;
    const attenteTts = new Promise(resolve => { debloquerTts = resolve; });
    await page.route('**/api/montage-media?action=tts', async route => {
      await attenteTts;
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('faux-audio').toString('base64'), mimeType: 'audio/mpeg', durations: [3] })
      });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FONDATEURTEST', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);
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
    // Lance la génération SANS attendre (reste en cours grâce au blocage TTS).
    page.evaluate(() => omGenererVoixOff());
    await page.waitForTimeout(150);

    const pendantGeneration = await page.evaluate(() => {
      const cheminImg2 = null; // pas de vrai fichier ici, on teste juste le verrou de la fonction
      const nbAvant = omImages.length;
      omRetirerImage(0); // doit être un no-op pendant omVoixEnCours
      return {
        voixEnCours: omVoixEnCours,
        nbImagesInchange: omImages.length === nbAvant,
        boutonAjouterDesactive: document.getElementById('omAjouterImagesBtn').disabled,
        boutonRetirerDesactive: document.querySelector('.audit-thumb-del').disabled
      };
    });
    assert.equal(pendantGeneration.voixEnCours, true, 'la génération doit être en cours au moment de ce contrôle');
    assert.equal(pendantGeneration.nbImagesInchange, true, 'omRetirerImage doit être un no-op pendant la génération de la voix');
    assert.equal(pendantGeneration.boutonAjouterDesactive, true, 'le bouton "Ajouter des images" doit être désactivé pendant la génération');
    assert.equal(pendantGeneration.boutonRetirerDesactive, true, 'le bouton de retrait d\'image doit être désactivé pendant la génération');

    // Débloque la génération TTS et laisse le temps au finally de s'exécuter.
    debloquerTts();
    await page.waitForTimeout(300);

    const apresGeneration = await page.evaluate(() => {
      const nbAvant = omImages.length;
      omRetirerImage(0); // doit fonctionner normalement une fois la génération terminée
      return {
        voixEnCours: omVoixEnCours,
        imageRetiree: omImages.length === nbAvant - 1,
        boutonAjouterReactive: !document.getElementById('omAjouterImagesBtn').disabled
      };
    });
    assert.equal(apresGeneration.voixEnCours, false, 'la génération doit être terminée');
    assert.equal(apresGeneration.imageRetiree, true, 'le retrait d\'image doit fonctionner à nouveau une fois la génération terminée');
    assert.equal(apresGeneration.boutonAjouterReactive, true, 'le bouton "Ajouter des images" doit être réactivé une fois la génération terminée');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    fs.rmSync(dossierTmp, { recursive: true, force: true });
    await navigateur.close();
    await arreter();
  }
});

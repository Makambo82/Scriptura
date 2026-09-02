// Retour propriétaire : "je voudrais que l'animation de génération de la
// musique soit comme celle de la voix off" - avant, la génération de
// musique affichait un simple texte statique "Génération de la musique…"
// pendant que la voix off montrait une vraie barre de progression animée
// (%). Ce test vérifie que la musique utilise désormais le même moteur
// (createProgress, voir js/montage.js/js/montage-manuel.js) : une barre
// avec un pourcentage qui progresse réellement pendant l'appel réseau, pas
// juste un texte figé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Montage (storyboard IA) : la génération de musique affiche une barre de progression animée, comme la voix off', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=music', async route => {
      await new Promise(r => setTimeout(r, 1500));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ audioBase64: Buffer.from('fausse-musique').toString('base64'), mimeType: 'audio/mpeg' })
      });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MUSIQUEPROGRESS1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Plan.', visuel: 'x' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      montageVoixOff = { blob: new Blob(['audio']), url: 'blob:x', durations: [2], captions: [] };
      document.getElementById('montageModal').classList.add('active');
      renderMontageEtat();
    });
    await page.waitForTimeout(150);

    // Ne surtout pas attendre la promesse (async) : sinon Playwright bloque
    // jusqu'à la fin de la génération, la barre "en cours" ne serait jamais
    // observable dans ce test.
    await page.evaluate(() => { genererMusiqueMontage(); });
    await page.waitForTimeout(500);

    const pctInitial = await page.evaluate(() => document.getElementById('montageMusiqueProgPct')?.textContent);
    assert.ok(pctInitial, 'une pastille de pourcentage doit exister pendant la génération (pas un simple texte figé) : ' + pctInitial);
    assert.notEqual(pctInitial, '0%', 'le pourcentage doit avoir progressé après 500ms, pas rester bloqué à 0% : ' + pctInitial);

    await page.waitForTimeout(400);
    const pctPlusTard = await page.evaluate(() => document.getElementById('montageMusiqueProgPct')?.textContent);
    assert.notEqual(pctPlusTard, pctInitial, 'le pourcentage doit continuer à augmenter avec le temps, comme la barre de la voix off : ' + JSON.stringify({ pctInitial, pctPlusTard }));

    await page.waitForTimeout(1000);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    const musiquePrete = await page.evaluate(() => !!document.querySelector('#montageMusiqueZone .montage-audio-preview'));
    assert.equal(musiquePrete, true, 'la génération doit bien aboutir à un aperçu audio une fois terminée');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

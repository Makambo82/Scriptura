// Non-régression pour un vrai trou trouvé cette session : seules les
// générations IA (callAI, js/api.js) journalisaient leurs échecs pour le
// Tableau de bord. Les dépendances externes non-IA — LamaTok/TikHub
// (diagnostic sommaire), TikHub/ElevenLabs (analyse virale) — pouvaient
// tomber en panne sans AUCUNE visibilité : ni badge, ni carte d'alerte,
// rien. Ce test vérifie que ces deux flux journalisent bien leurs pannes
// techniques réelles, sous leur propre mode, distinct de la génération IA.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('diagnostic sommaire : une panne LamaTok/TikHub est journalisée sous mode diagnosticSommaire', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursEnvoyees = [];
    // Enregistré APRÈS poserMocksReseau : Playwright exécute les routes
    // dans l'ordre INVERSE d'enregistrement, celle-ci doit donc passer
    // avant le filet générique de poserMocksReseau pour /api/username-scan.
    await poserMocksReseau(page, {
      data: (body) => { if (body.resource === 'erreur') erreursEnvoyees.push(body); return undefined; }
    });
    await page.route('**/api/username-scan', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { message: 'LamaTok indisponible (502)' } }) }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'EXTFAILTEST1', plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('diagSommaireFlow').style.display = 'block';
      document.getElementById('diagSommaireInput').value = 'unusername';
    });
    await page.evaluate(() => lancerDiagnosticSommaire());
    await page.waitForTimeout(500);

    assert.equal(erreursEnvoyees.length, 1, 'la panne doit être journalisée une fois');
    assert.equal(erreursEnvoyees[0].mode, 'diagnosticSommaire');
    assert.match(erreursEnvoyees[0].detail, /LamaTok/, 'le vrai détail technique doit être transmis, pas un message générique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('analyse virale : une panne TikHub/ElevenLabs est journalisée avec le vrai détail, même sous un message utilisateur convivial', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursEnvoyees = [];
    // Même remarque que le test précédent : enregistré APRÈS poserMocksReseau.
    await poserMocksReseau(page, {
      data: (body) => { if (body.resource === 'erreur') erreursEnvoyees.push(body); return undefined; }
    });
    await page.route('**/api/tiktok-video**', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { message: 'TikHub indisponible (502)' } }) }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VIRALFAILTEST1', plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
      if (flow) flow.style.display = 'block';
      document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
    });
    await page.evaluate(() => lancerAnalyseVirale());
    await page.waitForTimeout(800);

    assert.equal(erreursEnvoyees.length, 1, 'la panne doit être journalisée une fois');
    assert.equal(erreursEnvoyees[0].mode, 'analyseVirale');
    assert.match(erreursEnvoyees[0].detail, /TikHub/, 'le vrai détail technique doit survivre au message convivial affiché à l\'utilisateur');

    const messageUtilisateur = await page.evaluate(() => document.getElementById('viralAnaError').textContent);
    assert.match(messageUtilisateur, /Colle son texte à la main/, 'l\'utilisateur doit voir un message actionnable, pas le détail technique brut');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Non-régression : le message "Scriptura regarde ce qui marche en ce moment dans
// ta niche sur TikTok" ne doit JAMAIS s'afficher (ni déclencher d'appel IA)
// pour un utilisateur dont on ne connaît encore rien (aucune niche, aucun
// diagnostic, aucune génération) : ça sonnerait faussement commercial. Un
// message d'onboarding honnête doit s'afficher à la place. Dès qu'une
// mémoire minimale existe (ex. niche déclarée), le vrai message doit
// réapparaître et déclencher la génération.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SIX_RECOS = { niveau_confiance: 'élevée', recommandations: [1, 2, 3, 4, 5, 6].map(i => ({ titre: 'T' + i, angle: 'A', justifications: ['J1'], potentiel: 'Élevé', ton_conseille: 'Storytelling', hook: 'H', source: 'diagnostic' })) };

test('aucune fausse promesse de recherche dans la niche pour un abonné dont on ne sait rien', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    let appelsGenerate = 0;
    await poserMocksReseau(page, {
      // Léger délai volontaire : laisse une fenêtre pour observer le message
      // d'attente avant que la génération (mockée) ne se résolve.
      generate: async () => { appelsGenerate++; await new Promise(r => setTimeout(r, 400)); return { content: [{ text: JSON.stringify(SIX_RECOS) }] }; }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'ONBOARDBLANC1', plan: 'creator' });
    await page.waitForTimeout(200);

    const avant = appelsGenerate;
    await page.evaluate(() => initAccueilPremium());
    await page.waitForTimeout(300);
    const etatBlanc = await page.evaluate(() => document.getElementById('accueilPremium').textContent);

    assert.equal(etatBlanc.toLowerCase().includes('scriptura regarde ce qui marche'), false, 'ne doit jamais prétendre chercher dans la niche si elle est inconnue');
    assert.equal(etatBlanc.includes('à la fin de ton diagnostic'), true, 'doit afficher le message d\'onboarding honnête');
    assert.equal(appelsGenerate - avant, 0, 'aucun appel IA ne doit être déclenché sans mémoire minimale');

    // Avec une niche déclarée : le vrai message doit apparaître et
    // déclencher la génération.
    await page.evaluate(async () => {
      await mettreAJourProfilCreateur({ declare: { niche_principale: 'Histoire' } });
    });
    const avant2 = appelsGenerate;
    // Appel "fire-and-forget" côté navigateur (flèche à corps de bloc, sans
    // retourner la promesse) : contrairement à `() => initAccueilPremium()`,
    // page.evaluate ne doit PAS attendre la fin de l'appel async, sinon on
    // ne pourrait jamais observer l'état intermédiaire "chargement" avant
    // que le mock (délayé de 400ms ci-dessus) ne se résolve.
    await page.evaluate(() => { initAccueilPremium(); });
    await page.waitForTimeout(150);
    const etatPendant = await page.evaluate(() => document.getElementById('accueilPremium').textContent);
    assert.equal(etatPendant.toLowerCase().includes('scriptura regarde ce qui marche'), true, 'doit chercher dans la niche dès qu\'une mémoire minimale existe');

    await page.waitForTimeout(1500);
    const etatFinal = await page.evaluate(() => document.getElementById('accueilPremium').textContent);
    assert.equal(etatFinal.includes('T1'), true, 'la recommandation générée doit bien être rendue au final');
    assert.ok(appelsGenerate > avant2, 'doit déclencher un appel IA avec une mémoire minimale');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

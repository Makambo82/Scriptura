// Non-régression : `mode` (le paramètre de callAI, js/api.js) sert au
// quota serveur, où Idées/Script/Récit partagent VOLONTAIREMENT un même
// quota "creation" (un seul quota mensuel pour les trois). Avant ce
// correctif, la carte "Échecs de génération" du Tableau de bord (voir
// carteErreursAdmin, js/admin.js) utilisait ce même `mode` pour la
// journalisation : un échec Idées, Script ou Récit apparaissait donc
// TOUJOURS sous l'étiquette générique "creation", impossible à distinguer
// (retour utilisateur direct : "ça a signalé l'échec mais on sait pas
// où"). Le nouveau paramètre `contexte` (10e argument de callAI) journalise
// désormais le vrai mode, indépendamment du quota. Ce test vérifie que
// chaque mode envoie bien SON PROPRE libellé au serveur, jamais le
// générique partagé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

test('chaque mode journalise ses échecs sous son propre libellé, jamais le "creation" générique partagé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursEnvoyees = [];
    // /api/generate renvoie systématiquement une panne technique
    // récupérable (503), pour déclencher la journalisation d'échec après
    // épuisement des tentatives (voir tryOnce, js/api.js).
    await page.route('**/api/generate', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'surchargé' }) }));
    await page.route('**/api/data', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.resource === 'erreur') erreursEnvoyees.push(body);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/**', route => {
      const url = route.request().url();
      if (url.includes('/api/data') || url.includes('/api/generate')) return route.fallback();
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 0 }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    const modes = ['ideas', 'script', 'story', 'serie', 'recommandation'];
    for (const m of modes) {
      await page.evaluate(async (mode) => {
        try { await callAI('claude-haiku-4-5-20251001', 100, 'test', 1, false, undefined, undefined, undefined, undefined, mode); } catch (e) {}
      }, m);
    }
    await page.waitForTimeout(400);

    assert.equal(erreursEnvoyees.length, modes.length, 'chaque échec doit être journalisé');
    assert.deepEqual(erreursEnvoyees.map(e => e.mode), modes, 'le serveur doit recevoir le vrai mode, dans l\'ordre, pour chaque appel');
    assert.equal(new Set(erreursEnvoyees.map(e => e.mode)).size, modes.length, 'tous les modes doivent rester distincts entre eux');
    assert.ok(!erreursEnvoyees.some(e => e.mode === 'creation'), 'aucun ne doit retomber sur le libellé générique partagé "creation"');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Audit du 2 septembre 2026 : chargerCarteModes() (js/admin.js) remettait
// _erreursTotal/_erreursParMode/_erreursRecentes à zéro dans son bloc catch,
// à la moindre panne réseau de CETTE requête précise. Comme
// carteErreursAdmin() n'affiche la carte d'alerte "Échecs de génération"
// que si _erreursTotal est non nul, une panne transitoire faisait
// DISPARAÎTRE silencieusement cette alerte, même si de vrais échecs avaient
// été chargés lors d'un appel précédent réussi. Vérifie que l'état déjà
// connu est conservé après un échec de la requête.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('chargerCarteModes : une panne réseau sur un appel ultérieur ne remet pas à zéro les échecs déjà connus', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_unlocked', 'true');
      localStorage.setItem('scriptura_code', 'ADMINTEST');
      localStorage.setItem('scriptura_plan', 'creator');
      localStorage.setItem('scriptura_is_admin', 'true');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    // 1er appel : réussit, avec de vrais échecs récents.
    await page.route('**/api/data', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.resource === 'admin-stats') {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            codesActifsRecents: ['CODE-ACTIF'],
            erreursParMode: { script: 3 },
            erreursTotal: 3,
            erreursRecentes: [{ mode: 'script', detail: 'panne test', cree_le: new Date().toISOString(), code_acces: 'CODE-X' }],
            parModePlan: { fondateur: {}, pro: {}, creator: {}, nonAbonne: {} }
          })
        });
      }
      return route.continue();
    });
    await page.evaluate(async () => { await chargerCarteModes(); });
    const apresPremierAppel = await page.evaluate(() => ({ total: _erreursTotal, carte: carteErreursAdmin() }));
    assert.equal(apresPremierAppel.total, 3, 'le 1er appel réussi doit charger les échecs réels');
    assert.ok(apresPremierAppel.carte.length > 0, 'la carte d\'alerte doit être générée après un chargement réussi avec des échecs');

    // 2e appel : panne réseau simulée (réponse HTTP en erreur).
    await page.unroute('**/api/data');
    await page.route('**/api/data', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.resource === 'admin-stats') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'panne simulée' } }) });
      }
      return route.continue();
    });
    await page.evaluate(async () => { await chargerCarteModes(); });
    const apresPanne = await page.evaluate(() => ({ total: _erreursTotal, carte: carteErreursAdmin() }));

    assert.equal(apresPanne.total, 3, 'une panne sur un appel ultérieur ne doit JAMAIS effacer le compteur d\'échecs déjà connu : ' + JSON.stringify(apresPanne));
    assert.ok(apresPanne.carte.length > 0, 'la carte d\'alerte "Échecs de génération" doit rester visible malgré la panne de CETTE requête : ' + JSON.stringify(apresPanne));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Finding distinct mais lié (même artefact d'audit) : marquerErreursVues/
// marquerErreursVuesLe étaient appelées SANS CONDITION dans
// chargerTableauDeBord(), même si le chargement avait échoué. Une visite où
// rien n'a pu s'afficher (panne réseau) était quand même enregistrée comme
// "vue" : une erreur toute nouvelle, jamais réellement consultée par le
// fondateur, pouvait perdre son badge rouge pour de bon.
test('chargerTableauDeBord : une visite en panne ne marque PAS les erreurs comme vues', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_unlocked', 'true');
      localStorage.setItem('scriptura_code', 'ADMINTEST2');
      localStorage.setItem('scriptura_plan', 'creator');
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.removeItem('scriptura_erreurs_vues_total');
      localStorage.removeItem('scriptura_erreurs_vues_le');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    // chargerTableauDeBord() sort tôt si supabaseClient est vide (voir
    // js/admin.js) : stub minimal couvrant compterNonAbonnesEnLigne
    // (chaîne from().select().eq().gte()), seul appel Supabase de ce flux.
    await page.evaluate(() => {
      supabaseClient = { from: () => ({ select: () => ({ eq: () => ({ gte: () => Promise.resolve({ count: 0, error: null }) }) }) }) };
    });

    // Toute requête admin-stats échoue : simule une panne complète du
    // Tableau de bord dès la première ouverture.
    await page.route('**/api/data', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.resource === 'admin-stats') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'panne simulée' } }) });
      }
      return route.continue();
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(300);

    const apresPanne = await page.evaluate(() => ({
      vuesTotal: localStorage.getItem('scriptura_erreurs_vues_total'),
      vuesLe: localStorage.getItem('scriptura_erreurs_vues_le')
    }));
    assert.equal(apresPanne.vuesTotal, null, 'une visite en panne ne doit PAS marquer les erreurs comme vues : ' + JSON.stringify(apresPanne));
    assert.equal(apresPanne.vuesLe, null, 'une visite en panne ne doit pas non plus avancer l\'horodatage de dernière consultation : ' + JSON.stringify(apresPanne));

    // Un chargement qui réussit ENSUITE doit, lui, marquer normalement.
    await page.unroute('**/api/data');
    await page.route('**/api/data', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.resource === 'admin-stats') {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, codes: [], codesActifsRecents: [], erreursParMode: {}, erreursTotal: 0, erreursRecentes: [], parModePlan: { fondateur: {}, pro: {}, creator: {}, nonAbonne: {} } })
        });
      }
      return route.continue();
    });
    await page.evaluate(() => chargerTableauDeBord());
    await page.waitForTimeout(300);
    const apresSucces = await page.evaluate(() => ({
      vuesTotal: localStorage.getItem('scriptura_erreurs_vues_total'),
      vuesLe: localStorage.getItem('scriptura_erreurs_vues_le')
    }));
    assert.equal(apresSucces.vuesTotal, '0', 'un chargement réussi doit, lui, marquer normalement : ' + JSON.stringify(apresSucces));
    assert.ok(apresSucces.vuesLe, 'l\'horodatage de consultation doit être posé après un chargement réussi : ' + JSON.stringify(apresSucces));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

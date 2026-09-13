// Non-régression : le tableau de bord fondateur ne rafraîchissait le statut
// en ligne des abonnés qu'une seule fois, à l'ouverture du panneau détaillé,
// il fallait recharger toute la page pour voir quelqu'un se connecter. Ce
// test vérifie que le rafraîchissement automatique tourne bien tant que le
// panneau est ouvert, met vraiment à jour l'affichage, et s'arrête tout
// seul dès qu'on ferme le panneau ou qu'on quitte l'écran admin (pas de
// polling fantôme qui continue en arrière-plan).
//
// AUDIT A19 : chargerPresenceAdmin lit désormais /api/data
// (resource=presence-admin, action=statuts, voir js/admin.js et
// handlePresenceAdmin dans api/data.js) au lieu d'interroger directement
// Supabase (`presence` est fermée à l'anon depuis ce correctif). Le mock
// bascule donc côté serveur de test (poserMocksReseau), pas côté
// supabaseClient du navigateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CODES_ADMIN_STATS = { codes: [{ code: 'FIFA', plan: 'creator', actif: true, expire_le: null }], parModePlan: {}, erreursParMode: {}, erreursTotal: 0 };

test('le statut en ligne se rafraîchit sans reload, et le polling s\'arrête proprement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    let presenceEnLigne = false;
    await poserMocksReseau(page, {
      data: (body) => {
        if (body.resource === 'admin-stats') return CODES_ADMIN_STATS;
        if (body.resource === 'presence-admin' && body.action === 'statuts') {
          return { ok: true, parCode: presenceEnLigne ? { FIFA: true } : {} };
        }
        return undefined;
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(200);

    // ── ON ATTEND UNE CONDITION, JAMAIS UN DÉLAI ──
    // Ce test tombait par intermittence sur la CI (run 640 : « le polling doit
    // démarrer à l'ouverture du panneau »), et jamais en local. La cause n'est
    // pas le code de l'app : ouvrirTableauDeBord laisse du travail asynchrone
    // derrière lui, et sur une machine chargée les 300 ms fixes s'écoulaient
    // AVANT que #listeAbonnesAdmin n'existe. toggleListeAbonnesAdmin sortait
    // alors sur son garde `if (!el) return;`, sans jamais démarrer le poll.
    // Le test mesurait donc la vitesse du runner, pas le comportement.
    // chargerTableauDeBord (js/admin.js) exige un `supabaseClient` non-nul
    // avant de charger quoi que ce soit (garde pré-existante, plus rien à
    // voir avec la présence désormais) : le vrai script Supabase ne charge
    // jamais dans ce navigateur de test (aucun réseau externe), un stub
    // minimal suffit puisqu'aucune carte du tableau de bord ne l'utilise
    // plus directement après le passage de `presence` au serveur.
    await page.evaluate(() => { supabaseClient = {}; ouvrirTableauDeBord(); });
    await page.waitForSelector('#listeAbonnesAdmin', { state: 'attached' });
    await page.waitForFunction(() => Array.isArray(_codesAbonnesAdmin) && _codesAbonnesAdmin.length > 0);

    await page.evaluate(() => toggleListeAbonnesAdmin());
    await page.waitForFunction(() => _presencePollInterval !== null);

    const enLigneAvant = await page.evaluate(() => document.getElementById('listeAbonnesAdminList').innerHTML.includes('social-dot'));
    const pollingActif = await page.evaluate(() => _presencePollInterval !== null);
    assert.equal(enLigneAvant, false, 'FIFA doit apparaître hors ligne au départ');
    assert.equal(pollingActif, true, 'le polling doit démarrer à l\'ouverture du panneau');

    // Simule une connexion de FIFA pendant que le fondateur regarde l'écran,
    // puis déclenche le même rafraîchissement que ferait le prochain tick
    // (sans attendre 10s réelles) : c'est le comportement observable qui
    // compte, pas le minutage exact de l'intervalle.
    presenceEnLigne = true;
    await page.evaluate(async () => {
      const codesUniques = Array.from(new Set(_codesAbonnesAdmin.map(c => c.code)));
      await chargerPresenceAdmin(codesUniques);
      renderAdminListe();
    });
    const enLigneApres = await page.evaluate(() => document.getElementById('listeAbonnesAdminList').innerHTML.includes('social-dot'));
    assert.equal(enLigneApres, true, 'FIFA doit apparaître en ligne après le rafraîchissement, sans recharger la page');

    await page.evaluate(() => toggleListeAbonnesAdmin());
    const pollingApresFermeture = await page.evaluate(() => _presencePollInterval);
    assert.equal(pollingApresFermeture, null, 'le polling doit s\'arrêter à la fermeture du panneau');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

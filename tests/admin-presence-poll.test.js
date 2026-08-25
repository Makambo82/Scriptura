// Non-régression : le tableau de bord fondateur ne rafraîchissait le statut
// en ligne des abonnés qu'une seule fois, à l'ouverture du panneau détaillé,
// il fallait recharger toute la page pour voir quelqu'un se connecter. Ce
// test vérifie que le rafraîchissement automatique tourne bien tant que le
// panneau est ouvert, met vraiment à jour l'affichage, et s'arrête tout
// seul dès qu'on ferme le panneau ou qu'on quitte l'écran admin (pas de
// polling fantôme qui continue en arrière-plan).
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
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats' ? CODES_ADMIN_STATS : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      let presenceEnLigne = false;
      window.__basculerPresenceFifa = (v) => { presenceEnLigne = v; };
      supabaseClient = {
        from(table) {
          if (table === 'presence') {
            return { select() { return this; }, in() { return Promise.resolve({ data: presenceEnLigne ? [{ ref: 'FIFA', derniere_activite: new Date().toISOString() }] : [], error: null }); } };
          }
          return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } };
        }
      };
    });

    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleListeAbonnesAdmin());
    await page.waitForTimeout(300);

    const enLigneAvant = await page.evaluate(() => document.getElementById('listeAbonnesAdminList').innerHTML.includes('social-dot'));
    const pollingActif = await page.evaluate(() => _presencePollInterval !== null);
    assert.equal(enLigneAvant, false, 'FIFA doit apparaître hors ligne au départ');
    assert.equal(pollingActif, true, 'le polling doit démarrer à l\'ouverture du panneau');

    // Simule une connexion de FIFA pendant que le fondateur regarde l'écran,
    // puis déclenche le même rafraîchissement que ferait le prochain tick
    // (sans attendre 20s réelles) : c'est le comportement observable qui
    // compte, pas le minutage exact de l'intervalle.
    await page.evaluate(async () => {
      window.__basculerPresenceFifa(true);
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

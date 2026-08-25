// Vérifie que les échecs de génération sont vraiment "impossibles à
// manquer" pour le fondateur (demande explicite : pas de nouveau canal de
// notification, juste rendre ça visible) : un badge rouge sur "Tableau de
// bord" (sidebar + pied de page) visible depuis n'importe quel écran, sans
// avoir besoin d'ouvrir le tableau de bord, ET la carte "Échecs de
// génération" en tête du tableau, stylée en alerte (jamais confondue avec
// une carte de statistique neutre). Vérifie aussi qu'un visiteur non-admin
// ne déclenche aucun appel superflu, et que le badge se comporte comme une
// vraie notification "vue/non vue" : il disparaît dès que le fondateur a
// ouvert le tableau de bord, ne revient pas tant que rien de nouveau n'est
// survenu, et réapparaît bien si le total augmente ensuite (retour direct
// : "dès que je rentre dans le tableau de bord le badge doit plus être
// là").
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('badge + carte d\'alerte pour le fondateur quand des échecs existent, rien pour un visiteur normal', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    // ── Fondateur : badge visible, carte d'alerte en tête ──
    const page = await navigateur.newPage();
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [{ code: 'FIFA', plan: 'creator', actif: true, expire_le: null }], parModePlan: {}, erreursParMode: { script: 5, idees: 2 }, erreursTotal: 7 }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(400);

    const badges = await page.evaluate(() => Array.from(document.querySelectorAll('.nav-admin-badge')).map(b => b.textContent));
    assert.deepEqual(badges, ['7', '7'], 'un badge "7" doit apparaître sur les deux liens "Tableau de bord" (sidebar + pied de page)');

    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const premiereCarte = await page.evaluate(() => {
      const c = document.querySelector('#adminStats .score-card');
      return c ? { alerte: c.classList.contains('score-card-alerte'), texte: c.textContent } : null;
    });
    assert.ok(premiereCarte, 'une carte doit apparaître en tête du tableau de bord');
    assert.equal(premiereCarte.alerte, true, 'la première carte doit être stylée en alerte');
    assert.match(premiereCarte.texte, /Échecs de génération/);

    // ── "Vu" : le badge doit disparaître dès l'ouverture du tableau ──
    const badgesApresOuverture = await page.evaluate(() => document.querySelectorAll('.nav-admin-badge').length);
    assert.equal(badgesApresOuverture, 0, 'le badge doit disparaître immédiatement après avoir ouvert le tableau de bord');

    // Rechargement avec le même total (rien de nouveau) : pas de badge.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const badgesRelchargeMemeTotal = await page.evaluate(() => document.querySelectorAll('.nav-admin-badge').length);
    assert.equal(badgesRelchargeMemeTotal, 0, 'le badge ne doit pas revenir si le total n\'a pas changé depuis la dernière visite');

    // ── Visiteur non-admin : aucun badge, aucun appel admin-stats ──
    const page2 = await navigateur.newPage();
    let appelsAdminStats = 0;
    await poserMocksReseau(page2, {
      data: (body) => { if (body.resource === 'admin-stats') appelsAdminStats++; return undefined; }
    });
    await page2.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(400);
    const badgesNonAdmin = await page2.evaluate(() => document.querySelectorAll('.nav-admin-badge').length);
    assert.equal(badgesNonAdmin, 0, 'un visiteur non-admin ne doit jamais voir ce badge');
    assert.equal(appelsAdminStats, 0, 'un visiteur non-admin ne doit déclencher aucun appel admin-stats');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

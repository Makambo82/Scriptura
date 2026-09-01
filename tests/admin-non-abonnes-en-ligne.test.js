// Retour du propriétaire, suite de la carte "Abonnés actifs" (Tableau de
// bord fondateur) : demande d'ajouter un compte des NON-abonnés en ligne
// maintenant, même mécanique que le point vert/rouge des abonnés (table
// `presence`, seuil 2 minutes, voir chargerPresenceAdmin), mais un simple
// nombre plutôt qu'une liste : un identifiant anonyme
// (anon_<horodatage>_<alea>, voir getUserRef, js/api.js) n'a rien de
// lisible à afficher un par un. `abonne=false` couvre tous les visiteurs
// sans code_acces (envoyerPresence, js/app.js, envoie abonne:!!unlocked
// pour CHAQUE visiteur, pas seulement les abonnés).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CODES_ADMIN_STATS = { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0 };

// Mock minimal mais fidèle à l'API supabase-js réellement utilisée ici :
// .select('ref').in(...) pour la présence par code (déjà existant), ET
// .select('ref', {count,head}).eq('abonne', false).gte('derniere_activite', seuil)
// pour le nouveau compte des non-abonnés en ligne.
function poserMockPresence(page, nbNonAbonnesEnLigne) {
  return page.evaluate((n) => {
    supabaseClient = {
      from(table) {
        if (table !== 'presence') return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } };
        return {
          select(_cols, opts) {
            if (opts && opts.count) {
              // Chaîne .eq().gte() -> Promise{count, error}
              return { eq() { return { gte() { return Promise.resolve({ count: n, error: null }); } }; } };
            }
            // Chaîne .in() -> Promise{data, error}
            return { in() { return Promise.resolve({ data: [], error: null }); } };
          }
        };
      }
    };
  }, nbNonAbonnesEnLigne);
}

test('Tableau de bord : la carte "Abonnés actifs" affiche aussi le nombre de non-abonnés en ligne maintenant', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, { data: (body) => body.resource === 'admin-stats' ? CODES_ADMIN_STATS : undefined });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(200);

    await poserMockPresence(page, 3);
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const texte = await page.evaluate(() => document.getElementById('adminNonAbonnesEnLigne')?.textContent || '');
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.match(texte, /3 non-abonnés en ligne maintenant/, 'le compte de non-abonnés en ligne doit être affiché : ' + texte);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Tableau de bord : au singulier avec un seul non-abonné en ligne, et rien d\'affiché si le compte est indisponible', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page, { data: (body) => body.resource === 'admin-stats' ? CODES_ADMIN_STATS : undefined });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(200);

    await poserMockPresence(page, 1);
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const singulier = await page.evaluate(() => document.getElementById('adminNonAbonnesEnLigne')?.textContent || '');
    assert.match(singulier, /1 non-abonné en ligne maintenant/, 'accord au singulier attendu : ' + singulier);
    assert.ok(!/non-abonnés/.test(singulier), 'pas de "s" au singulier : ' + singulier);

    // La requête de présence échoue (table/RLS indisponible) : jamais un
    // zéro trompeur, la ligne ne doit simplement pas apparaître.
    await page.evaluate(() => {
      supabaseClient = {
        from(table) {
          if (table !== 'presence') return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } };
          return { select(_cols, opts) {
            if (opts && opts.count) return { eq() { return { gte() { return Promise.resolve({ count: null, error: new Error('RLS') }); } }; } };
            return { in() { return Promise.resolve({ data: [], error: null }); } };
          } };
        }
      };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const indisponible = await page.evaluate(() => document.getElementById('adminNonAbonnesEnLigne'));
    assert.equal(indisponible, null, 'aucune ligne ne doit apparaître quand le compte est indisponible (jamais un faux zéro)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

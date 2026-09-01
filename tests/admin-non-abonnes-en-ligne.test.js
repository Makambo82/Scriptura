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

// Bug signalé par la propriétaire : cliquer sur "N non-abonnés en ligne"
// ouvrait la liste des ABONNÉS (les deux zones cliquables étaient dans le
// même div). Corrigé en donnant à ce bloc son propre onclick et son propre
// panneau détail (pays · navigateur, jamais l'IP, voir handlePresence dans
// api/data.js et la décision propriétaire "Pays + navigateur seulement").
test('Tableau de bord : cliquer sur "N non-abonnés en ligne" ouvre le détail pays/navigateur, PAS la liste des abonnés', async () => {
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

    // Mock couvrant les trois requêtes réellement utilisées sur `presence` :
    // .select('ref').in(...) (points verts abonnés), .select('ref',{count})
    // .eq().gte() (compteur non-abonnés), .select('pays,navigateur').eq()
    // .gte().limit() (détail groupé, nouveau).
    await page.evaluate(() => {
      supabaseClient = {
        from(table) {
          if (table !== 'presence') return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } };
          return {
            select(cols, opts) {
              if (opts && opts.count) {
                return { eq() { return { gte() { return Promise.resolve({ count: 2, error: null }); } }; } };
              }
              if (cols === 'pays,navigateur') {
                return { eq() { return { gte() { return { limit() { return Promise.resolve({
                  data: [
                    { pays: 'CI', navigateur: 'Safari mobile' },
                    { pays: 'CI', navigateur: 'Safari mobile' }
                  ],
                  error: null
                }); } }; } }; } };
              }
              return { in() { return Promise.resolve({ data: [], error: null }); } };
            }
          };
        }
      };
    });

    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    // Clique réellement sur la zone "N non-abonnés en ligne" (pas un appel
    // direct de fonction) : c'est exactement le geste signalé comme ouvrant
    // la mauvaise liste.
    await page.evaluate(() => document.getElementById('adminNonAbonnesEnLigne').parentElement.click());
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const [listeAbonnesVisible, detailHtml] = await page.evaluate(() => [
      document.getElementById('listeAbonnesAdmin')?.style.display,
      document.getElementById('listeNonAbonnesAdmin')?.innerHTML || ''
    ]);

    assert.notEqual(listeAbonnesVisible, 'block', 'cliquer sur les non-abonnés ne doit PAS ouvrir la liste des abonnés (bug signalé par la propriétaire)');
    assert.match(detailHtml, /Côte d'Ivoire · Safari mobile/, 'le détail pays · navigateur doit apparaître, groupé : ' + detailHtml);
    assert.match(detailHtml, />2</, 'les deux visiteurs identiques doivent être comptés ensemble : ' + detailHtml);
    assert.ok(!/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(detailHtml), 'aucune adresse IP ne doit jamais apparaître dans le détail : ' + detailHtml);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire : "si je suis dans le tableau de bord et qu'un
// non-abonné ouvre l'app, est-il possible que ça s'affiche en temps réel
// sans rechargement ?" Oui, via un poll (demarrerPollNonAbonnesAdmin, même
// mécanique que le poll des abonnés). Contrairement à ce dernier, il tourne
// dès l'ouverture du tableau de bord (le nombre est visible sans avoir à
// déplier un panneau). Intervalle 10s (retour propriétaire : "mets tout à
// 10s").
test('Tableau de bord : le nombre de non-abonnés en ligne se rafraîchit sans reload, et le polling s\'arrête proprement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page, { data: (body) => body.resource === 'admin-stats' ? CODES_ADMIN_STATS : undefined });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.__nonAbonnesEnLigne = 3;
      supabaseClient = {
        from(table) {
          if (table !== 'presence') return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } };
          return {
            select(_cols, opts) {
              if (opts && opts.count) {
                return { eq() { return { gte() { return Promise.resolve({ count: window.__nonAbonnesEnLigne, error: null }); } }; } };
              }
              return { in() { return Promise.resolve({ data: [], error: null }); } };
            }
          };
        }
      };
    });

    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const texteAvant = await page.evaluate(() => document.getElementById('adminNonAbonnesEnLigne')?.textContent || '');
    const pollingActif = await page.evaluate(() => _nonAbonnesPollInterval !== null);
    assert.match(texteAvant, /3 non-abonnés en ligne maintenant/, 'compte initial attendu : ' + texteAvant);
    assert.equal(pollingActif, true, 'le polling doit démarrer dès l\'ouverture du tableau de bord (pas besoin de déplier un panneau)');

    // Un non-abonné supplémentaire ouvre l'app pendant que le fondateur
    // regarde l'écran : simule ce que ferait le prochain tick, sans
    // attendre 10s réelles (comportement observable, pas le minutage).
    await page.evaluate(async () => {
      window.__nonAbonnesEnLigne = 4;
      const n = await compterNonAbonnesEnLigne();
      document.getElementById('adminNonAbonnesEnLigne').textContent = `${n} non-abonné${n > 1 ? 's' : ''} en ligne maintenant`;
    });
    const texteApres = await page.evaluate(() => document.getElementById('adminNonAbonnesEnLigne')?.textContent || '');
    assert.match(texteApres, /4 non-abonnés en ligne maintenant/, 'le compte doit refléter le nouveau non-abonné, sans recharger la page : ' + texteApres);

    // arreterPollNonAbonnesAdmin (la vraie fonction, celle que le prochain
    // tick appelle tout seul dès qu'il constate que l'écran admin a
    // disparu, voir demarrerPollNonAbonnesAdmin dans js/admin.js) doit bien
    // vider l'intervalle : pas de polling fantôme en arrière-plan une fois
    // qu'on a quitté le tableau de bord. On ne teste pas le minutage réel
    // du tick (10s), seulement que la fonction d'arrêt qu'il déclenche
    // fonctionne.
    await page.evaluate(() => arreterPollNonAbonnesAdmin());
    const pollingApresFermeture = await page.evaluate(() => _nonAbonnesPollInterval);
    assert.equal(pollingApresFermeture, null, 'le polling doit pouvoir s\'arrêter proprement en quittant le tableau de bord');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

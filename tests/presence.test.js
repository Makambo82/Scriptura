// Test de non-régression pour un vrai bug de prod trouvé et corrigé cette
// session : supabase-js ne déclenche sa requête qu'au moment où on appelle
// .then()/await sur le "query builder" qu'il retourne (c'est un thenable
// paresseux). `envoyerPresence` (js/app.js) n'attendait pas cet appel :
// aucune ligne n'était jamais écrite dans `presence`, pour personne,
// silencieusement, depuis la création de la fonctionnalité. Ce test échoue
// si quelqu'un retire l'`await` un jour, avant même besoin d'un test manuel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('envoyerPresence écrit réellement (attend le thenable supabase-js)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    const ecrituresReelles = await page.evaluate(async () => {
      let compteur = 0;
      // Mock fidèle au comportement réel de supabase-js : upsert() renvoie
      // un objet "thenable" dont le .then() ne s'exécute (et n'enregistre
      // l'écriture) que si on l'attend vraiment. Un simple appel sans await
      // ne doit RIEN enregistrer, exactement comme le bug d'origine.
      supabaseClient = {
        from(table) {
          return {
            upsert(data, opts) {
              return {
                then(resolve) {
                  compteur++; // la requête "part" seulement ici
                  resolve({ error: null });
                }
              };
            }
          };
        }
      };
      await envoyerPresence();
      return compteur;
    });

    assert.equal(ecrituresReelles, 1, 'envoyerPresence doit réellement attendre son upsert, pas seulement l\'appeler');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

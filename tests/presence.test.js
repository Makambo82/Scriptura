// Historique : `envoyerPresence` écrivait directement dans Supabase depuis
// le client (bug de non-régression trouvé et corrigé : supabase-js ne
// déclenche sa requête qu'au .then()/await, un appel sans await n'écrivait
// jamais rien, silencieusement, pour personne). Refonte depuis (retour
// propriétaire : voir le pays/navigateur des non-abonnés en ligne) :
// l'écriture passe maintenant par /api/data (resource=presence), le
// SERVEUR lit pays/navigateur depuis des en-têtes de confiance
// (x-vercel-ip-country, user-agent) que le client ne peut pas falsifier,
// jamais un upsert Supabase direct depuis le navigateur. Ce test vérifie
// que le signal part bien, avec les bons champs, vers la bonne route.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('envoyerPresence envoie bien un signal à /api/data (resource=presence), avec ref et abonne', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const appelsPresence = [];
    await poserMocksReseau(page, {
      data: (body) => {
        if (body.resource === 'presence') appelsPresence.push(body);
        return undefined;
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    await connecterAbonne(page, { code: 'PRESENCETEST', plan: 'creator' });
    await page.waitForTimeout(200);

    // Le chargement de page (DOMContentLoaded) envoie déjà un signal
    // automatique (et connecterAbonne recharge la page, donc un deuxième) :
    // on ne garde que l'appel explicite ci-dessous pour isoler ce qu'on teste.
    appelsPresence.length = 0;
    await page.evaluate(async () => { await envoyerPresence(); });

    assert.equal(appelsPresence.length, 1, 'un seul signal de présence doit partir par appel : ' + JSON.stringify(appelsPresence));
    assert.equal(appelsPresence[0].resource, 'presence');
    assert.equal(appelsPresence[0].ref, 'PRESENCETEST', 'ref doit être le code d\'accès pour un abonné connecté : ' + JSON.stringify(appelsPresence[0]));
    assert.equal(appelsPresence[0].abonne, true, 'abonne doit refléter le statut réel du visiteur : ' + JSON.stringify(appelsPresence[0]));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('envoyerPresence ne fait rien quand l\'onglet n\'est pas visible', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const appelsPresence = [];
    await poserMocksReseau(page, {
      data: (body) => {
        if (body.resource === 'presence') appelsPresence.push(body);
        return undefined;
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    // Le chargement de page envoie déjà un signal automatique (onglet
    // visible) : on l'ignore pour isoler l'appel explicite ci-dessous.
    appelsPresence.length = 0;
    await page.evaluate(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      await envoyerPresence();
    });

    assert.equal(appelsPresence.length, 0, 'aucun signal ne doit partir quand l\'onglet est en arrière-plan : ' + JSON.stringify(appelsPresence));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

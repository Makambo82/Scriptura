// Mocks réseau réutilisés par la plupart des tests : bloque tout appel
// réel vers Supabase/les routes /api/* pendant les tests (aucune clé, aucun
// coût IA, résultats déterministes), tout en laissant chaque test personnaliser
// les réponses de /api/data et /api/generate qui l'intéressent vraiment.

// Réponse par défaut pour /api/data (utilisée si le test ne fournit pas son
// propre gestionnaire pour une requête donnée).
//
// AUDIT A3 : resource=montage-storage (voir handleMontageStorage,
// api/data.js) a besoin d'un défaut réaliste, sans quoi TOUS les tests de
// montage existants (qui simulaient jusqu'ici supabaseClient.storage
// directement) échoueraient d'un coup : uploaderAssetMontage/
// obtenirUrlsLectureMontage (js/api.js) attendent {ok:true, uploadUrl} et
// {ok:true, urls}. `uploadUrl` pointe vers une route /api/* quelconque
// (jamais /api/data ni /api/generate) : le filet générique de
// poserMocksReseau, plus bas, répond 200 à n'importe quel PUT dessus.
function reponseDataParDefaut(method, body) {
  if (body && body.resource === 'montage-storage') {
    if (body.action === 'upload-url') {
      return { ok: true, chemin: body.chemin, uploadUrl: '/api/__mock-montage-upload__' };
    }
    if (body.action === 'read-url') {
      const urls = {};
      (Array.isArray(body.chemins) ? body.chemins : []).forEach(c => { urls[c] = 'https://x.example/montages/' + c; });
      return { ok: true, urls };
    }
  }
  return method === 'GET'
    ? { ok: true, data: [] }
    : { ok: true, id: 'gen-test', data: [] };
}

// `gestionnaires.data(body, method)` et `gestionnaires.generate(body)`,
// optionnels : s'ils renvoient `undefined`, la réponse par défaut est
// utilisée. Sinon leur valeur de retour est envoyée telle quelle en JSON.
async function poserMocksReseau(page, gestionnaires = {}) {
  const gererApiData = async (route) => {
    const method = route.request().method();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const reponse = gestionnaires.data ? await gestionnaires.data(body, method) : undefined;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reponse !== undefined ? reponse : reponseDataParDefaut(method, body))
    });
  };
  // Deux motifs nécessaires : le glob Playwright '**/api/data' ne matche PAS
  // une URL avec une chaîne de requête derrière (ex. /api/data?resource=...,
  // utilisé par toutes les lectures GET : profil créateur, générations,
  // séries, quotas...), seulement l'URL exacte sans "?". Sans le second
  // motif, ces lectures échappaient à ce mock et retombaient vraiment sur le
  // serveur de fichiers statique de test (404 "Introuvable"), un bug resté
  // invisible partout ailleurs seulement parce que ces lectures sont déjà
  // non bloquantes (échec silencieux, try/catch), jusqu'à un test qui, lui,
  // dépend vraiment d'une de ces lectures GET pour réussir.
  await page.route('**/api/data', gererApiData);
  await page.route('**/api/data?**', gererApiData);

  await page.route('**/api/generate', async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const reponse = gestionnaires.generate ? await gestionnaires.generate(body) : undefined;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reponse !== undefined ? reponse : { content: [{ text: '{}' }] })
    });
  });

  // Aucun accès réel à Supabase pendant les tests : le test remplace
  // directement la variable globale `supabaseClient` (voir js/api.js) par un
  // mock JS quand il en a besoin, plutôt que d'intercepter du réseau ici.
  await page.route('**supabase.co/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // Filet pour toute autre route /api/* non couverte explicitement
  // ci-dessus (quotas anonymes, etc.) : ne bloque jamais un test sur un
  // appel annexe non pertinent pour lui.
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/data') || url.includes('/api/generate')) return route.fallback();
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 0, ok: true }) });
  });
}

// Connecte un code d'accès (abonné) dans le localStorage puis recharge, pour
// démarrer un test dans l'état "abonné connecté" comme le ferait un vrai
// utilisateur après /api/verify-code.
async function connecterAbonne(page, { code, plan = 'creator' } = {}) {
  await page.evaluate(({ code, plan }) => {
    localStorage.setItem('scriptura_unlocked', 'true');
    localStorage.setItem('scriptura_code', code);
    localStorage.setItem('scriptura_plan', plan);
  }, { code, plan });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

module.exports = { poserMocksReseau, connecterAbonne };

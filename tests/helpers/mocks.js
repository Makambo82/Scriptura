// Mocks réseau réutilisés par la plupart des tests : bloque tout appel
// réel vers Supabase/les routes /api/* pendant les tests (aucune clé, aucun
// coût IA, résultats déterministes), tout en laissant chaque test personnaliser
// les réponses de /api/data et /api/generate qui l'intéressent vraiment.

// Réponse par défaut pour /api/data (utilisée si le test ne fournit pas son
// propre gestionnaire pour une requête donnée).
function reponseDataParDefaut(method) {
  return method === 'GET'
    ? { ok: true, data: [] }
    : { ok: true, id: 'gen-test', data: [] };
}

// `gestionnaires.data(body, method)` et `gestionnaires.generate(body)`,
// optionnels : s'ils renvoient `undefined`, la réponse par défaut est
// utilisée. Sinon leur valeur de retour est envoyée telle quelle en JSON.
async function poserMocksReseau(page, gestionnaires = {}) {
  await page.route('**/api/data', async (route) => {
    const method = route.request().method();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const reponse = gestionnaires.data ? await gestionnaires.data(body, method) : undefined;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reponse !== undefined ? reponse : reponseDataParDefaut(method))
    });
  });

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

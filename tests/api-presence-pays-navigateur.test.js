// Retour du propriétaire : voir le pays/navigateur des non-abonnés en
// ligne (jamais l'IP, donnée personnelle identifiante hors de propos ici,
// choix explicite du propriétaire). L'écriture de présence est passée du
// client (upsert Supabase direct, ref/abonne fournis tels quels par le
// visiteur) au serveur (/api/data, resource=presence, voir handlePresence)
// pour que pays/navigateur viennent d'en-têtes DE CONFIANCE
// (x-vercel-ip-country, injecté par la plateforme ; user-agent) qu'un
// visiteur ne peut pas falsifier lui-même. Ce test appelle directement le
// handler, comme tests/api-data-toggle-supprimer-casse-mixte.test.js,
// avec un faux fetch qui capture le corps réellement envoyé à Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

test('handlePresence (resource=presence) écrit pays + navigateur depuis les en-têtes, jamais l\'IP', async () => {
  const fetchAppels = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    fetchAppels.push({ url: url.toString(), method: (opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    return { ok: true, status: 200, json: async () => null };
  };

  try {
    const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
    const handler = handlerModule.default;

    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { 'x-vercel-ip-country': 'CI', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'x-forwarded-for': '203.0.113.42' },
      body: { resource: 'presence', ref: 'anon_1234_abcd', abonne: false }
    }, res);

    assert.equal(res._json?.ok, true, 'la réponse doit être un succès : ' + JSON.stringify(res._json));
    assert.equal(fetchAppels.length, 1, 'un seul appel Supabase attendu : ' + JSON.stringify(fetchAppels));
    const appel = fetchAppels[0];
    assert.ok(appel.url.includes('/rest/v1/presence'), 'doit écrire dans la table presence : ' + appel.url);
    assert.ok(appel.url.includes('on_conflict=ref'), 'doit upserter sur ref (même sémantique que l\'ancien upsert client) : ' + appel.url);
    const ligne = Array.isArray(appel.body) ? appel.body[0] : appel.body;
    assert.equal(ligne.ref, 'anon_1234_abcd');
    assert.equal(ligne.abonne, false);
    assert.equal(ligne.pays, 'CI', 'le pays doit venir de x-vercel-ip-country : ' + JSON.stringify(ligne));
    assert.equal(ligne.navigateur, 'Safari mobile', 'le navigateur doit être détecté depuis user-agent : ' + JSON.stringify(ligne));
    assert.ok(ligne.derniere_activite, 'derniere_activite doit être renseignée');

    // Jamais d'IP nulle part dans ce qui part vers Supabase (décision
    // propriétaire explicite), même si x-forwarded-for est présent dans la
    // requête entrante.
    const texteEnvoye = JSON.stringify(ligne);
    assert.ok(!texteEnvoye.includes('203.0.113.42'), 'l\'IP ne doit jamais apparaître dans ce qui est stocké : ' + texteEnvoye);
    assert.ok(!('ip' in ligne), 'aucun champ ip ne doit exister sur la ligne écrite : ' + JSON.stringify(ligne));
  } finally {
    global.fetch = fetchOriginal;
  }
});

test('handlePresence détecte correctement plusieurs navigateurs, et se dégrade proprement sans en-têtes', async () => {
  const fetchOriginal = global.fetch;
  let dernierCorps = null;
  global.fetch = async (url, opts = {}) => { dernierCorps = JSON.parse(opts.body || '{}'); return { ok: true, status: 200, json: async () => null }; };

  try {
    const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
    const handler = handlerModule.default;

    const cas = [
      { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', attendu: 'Chrome' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0', attendu: 'Firefox' },
      { ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', attendu: 'Chrome mobile' }
    ];
    for (const c of cas) {
      await handler({ method: 'POST', headers: { 'user-agent': c.ua, 'x-vercel-ip-country': 'SN' }, body: { resource: 'presence', ref: 'anon_x', abonne: false } }, mockRes());
      assert.equal(dernierCorps[0].navigateur, c.attendu, `pour "${c.ua}" -> attendu "${c.attendu}", eu "${dernierCorps[0].navigateur}"`);
    }

    // Aucun en-tête pays/navigateur (dev local, proxy inconnu) : jamais de
    // plantage, juste des valeurs nulles plutôt qu'inventées.
    await handler({ method: 'POST', headers: {}, body: { resource: 'presence', ref: 'anon_y', abonne: true } }, mockRes());
    assert.equal(dernierCorps[0].pays, null);
    assert.equal(dernierCorps[0].navigateur, null);
    assert.equal(dernierCorps[0].abonne, true);
  } finally {
    global.fetch = fetchOriginal;
  }
});

test('handlePresence refuse silencieusement une requête sans ref (jamais de plantage)', async () => {
  const fetchOriginal = global.fetch;
  let appele = false;
  global.fetch = async () => { appele = true; return { ok: true, status: 200, json: async () => null }; };
  try {
    const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
    const handler = handlerModule.default;
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { resource: 'presence' } }, res);
    assert.equal(res._json?.ok, false, 'sans ref, la réponse doit signaler un échec propre : ' + JSON.stringify(res._json));
    assert.equal(appele, false, 'aucun appel Supabase ne doit partir sans ref');
  } finally {
    global.fetch = fetchOriginal;
  }
});

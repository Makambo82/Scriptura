// Audit du 2 septembre 2026 : le compteur "N/5 générations gratuites"
// affiché côté client (js/api.js, fetchServerQuota) suivait une table à
// part (`quotas`, écrite en clair par le navigateur), jamais la table qui
// bloque réellement une génération anonyme (usage_serveur, voir
// verifierLimiteAnonyme, api/generate.js) : deux systèmes qui pouvaient
// diverger (IP partagée, cache vidé...). Ce test couvre le nouvel endpoint
// en lecture seule (api/data.js, resource=quotaGenerationGratuite) qui lit
// directement usage_serveur, LA MÊME source que le vrai verrou.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test'
};

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  return res;
}

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

test('quotaGenerationGratuite : renvoie le VRAI compteur usage_serveur (celui qui bloque réellement), pas 0 par défaut', async () => {
  const restaurer = poserEnv();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/usage_serveur')) {
      assert.match(u, /anon_generate_creation_avie_/, 'la clé lue doit être EXACTEMENT celle utilisée par verifierLimiteAnonyme pour le vrai blocage');
      return { ok: true, json: async () => [{ used: 3 }] };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const req = { method: 'GET', query: { resource: 'quotaGenerationGratuite' }, headers: { 'x-forwarded-for': '203.0.113.7' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.used, 3);
  } finally { restaurer(); }
});

test('quotaGenerationGratuite : sans Supabase configuré, ok:false plutôt qu\'un 0 trompeur', async () => {
  const restaurer = poserEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  global.fetch = async () => { throw new Error('aucun appel réseau attendu, Supabase non configuré'); };
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const req = { method: 'GET', query: { resource: 'quotaGenerationGratuite' }, headers: {} };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, false, 'sans source fiable, ne jamais prétendre "0 générations utilisées"');
  } finally { restaurer(); }
});

test('quotaGenerationGratuite : deux IP différentes lisent des clés différentes (pas de fuite entre visiteurs)', async () => {
  const restaurer = poserEnv();
  const refsVues = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/usage_serveur')) {
      refsVues.push(u);
      return { ok: true, json: async () => [{ used: 5 }] };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    await handler({ method: 'GET', query: { resource: 'quotaGenerationGratuite' }, headers: { 'x-forwarded-for': '203.0.113.7' } }, creerRes());
    await handler({ method: 'GET', query: { resource: 'quotaGenerationGratuite' }, headers: { 'x-forwarded-for': '198.51.100.42' } }, creerRes());
    assert.equal(refsVues.length, 2);
    assert.notEqual(refsVues[0], refsVues[1], 'deux IP différentes doivent produire deux clés de compteur différentes : ' + JSON.stringify(refsVues));
  } finally { restaurer(); }
});

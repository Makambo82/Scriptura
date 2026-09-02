// Audit du 2 septembre 2026 : /api/verify-code n'avait AUCUNE limite. Le
// code admin (CODE_ADMIN, accès Tableau de bord + illimité) est comparé en
// simple chaîne de caractères, avant même Supabase : rien n'empêchait de
// bombarder cette route pour le deviner par force brute. Un filet minimal
// (IP, généreux) protège désormais cette route, même mécanisme que
// verifierLimiteAnonyme déjà utilisé ailleurs (voir
// audit-classify-limite-anonyme.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');

test('/api/verify-code refuse (429) une fois la limite IP anonyme atteinte, sans même comparer le code', async () => {
  const envAvant = { ...process.env };
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.CODE_ADMIN = 'SCRIPTURA-ADMIN-TEST';

  const fetchOriginal = global.fetch;
  let abonnesInterroge = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => false }; // limite déjà atteinte
    if (u.includes('/rest/v1/abonnes')) { abonnesInterroge = true; return { ok: true, json: async () => [] }; }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/verify-code.js?t=' + Date.now());
    const req = { method: 'POST', body: { code: 'SCRIPTURA-ADMIN-TEST' } };
    let statutRecu = null, jsonRecu = null;
    const res = { status(c) { statutRecu = c; return this; }, json(o) { jsonRecu = o; return this; } };
    await handler(req, res);

    assert.equal(statutRecu, 429, 'la limite atteinte doit refuser la requête : ' + JSON.stringify(jsonRecu));
    assert.equal(abonnesInterroge, false, 'Supabase ne doit même pas être interrogé une fois la limite atteinte');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/verify-code fonctionne normalement dans la limite (code admin valide)', async () => {
  const envAvant = { ...process.env };
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.CODE_ADMIN = 'SCRIPTURA-ADMIN-TEST';

  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => true }; // dans la limite
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/verify-code.js?t=' + Date.now());
    const req = { method: 'POST', body: { code: 'scriptura-admin-test' } };
    let statutRecu = null, jsonRecu = null;
    const res = { status(c) { statutRecu = c; return this; }, json(o) { jsonRecu = o; return this; } };
    await handler(req, res);

    assert.equal(statutRecu, 200);
    assert.equal(jsonRecu.valid, true);
    assert.equal(jsonRecu.isAdmin, true);
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/verify-code : Supabase non configuré (clé service role absente) ne bloque jamais un visiteur pour la limite', async () => {
  const envAvant = { ...process.env };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CODE_ADMIN = 'SCRIPTURA-ADMIN-TEST';

  const fetchOriginal = global.fetch;
  global.fetch = async () => { throw new Error('aucun appel réseau attendu, Supabase non configuré'); };

  try {
    const { default: handler } = await import('../api/verify-code.js?t=' + Date.now());
    const req = { method: 'POST', body: { code: 'scriptura-admin-test' } };
    let statutRecu = null, jsonRecu = null;
    const res = { status(c) { statutRecu = c; return this; }, json(o) { jsonRecu = o; return this; } };
    await handler(req, res);

    assert.equal(statutRecu, 200, 'sans Supabase configuré, jamais de blocage 429 : ' + JSON.stringify(jsonRecu));
    assert.equal(jsonRecu.valid, true);
    assert.equal(jsonRecu.isAdmin, true);
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

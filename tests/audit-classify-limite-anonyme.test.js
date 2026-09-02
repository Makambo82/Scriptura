// Non-régression pour une vraie faille trouvée lors de l'audit complet du
// 2 septembre 2026 : le mode "classify" de /api/audit (reconnaissance du
// type de chaque capture au chargement) répondait AVANT tout contrôle
// d'accès (resoudreDroits/verifierQuota), n'importe qui pouvait déclencher
// des appels Claude Haiku à volonté, sans code d'accès ni limite. Un filet
// minimal (IP, généreux) protège désormais cette branche.
const test = require('node:test');
const assert = require('node:assert/strict');

test('/api/audit mode=classify refuse une fois la limite IP anonyme atteinte, sans jamais appeler Anthropic', async () => {
  const envAvant = { ...process.env };
  process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';

  const fetchOriginal = global.fetch;
  let anthropicAppele = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => false }; // limite déjà atteinte
    if (u.includes('api.anthropic.com')) { anthropicAppele = true; return { ok: true, json: async () => ({ content: [{ text: '{}' }] }) }; }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/audit.js');
    const req = {
      method: 'POST',
      body: { mode: 'classify', images: [{ base64: 'ZmFrZQ==', mediaType: 'image/jpeg' }] }
    };
    let statusRecu = null, jsonRecu = null;
    const res = { status(c) { statusRecu = c; return this; }, json(o) { jsonRecu = o; return this; } };
    await handler(req, res);

    assert.equal(statusRecu, 403, 'la limite atteinte doit refuser la requête : ' + JSON.stringify(jsonRecu));
    assert.equal(anthropicAppele, false, 'Anthropic ne doit JAMAIS être appelé une fois la limite atteinte (c\'était tout le problème : aucun filet avant ce correctif)');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/audit mode=classify fonctionne normalement dans la limite', async () => {
  const envAvant = { ...process.env };
  process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';

  const fetchOriginal = global.fetch;
  let anthropicAppele = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => true }; // dans la limite
    if (u.includes('api.anthropic.com')) { anthropicAppele = true; return { ok: true, json: async () => ({ content: [{ text: '{"type":"probleme"}' }] }) }; }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/audit.js');
    const req = {
      method: 'POST',
      body: { mode: 'classify', images: [{ base64: 'ZmFrZQ==', mediaType: 'image/jpeg' }] }
    };
    let statusRecu = null, jsonRecu = null;
    const res = { status(c) { statusRecu = c; return this; }, json(o) { jsonRecu = o; return this; } };
    await handler(req, res);

    assert.equal(statusRecu, 200, 'une requête dans la limite doit passer normalement : ' + JSON.stringify(jsonRecu));
    assert.equal(anthropicAppele, true, 'Anthropic doit être appelé normalement dans la limite');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

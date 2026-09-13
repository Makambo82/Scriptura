// LOT 4A, AUDIT ID 2 (Gate Phase 2) — /api/generate.js, contournement de `mode`.
//
// Avant ce correctif : microEditScript/microEditRecit/detectionNiche
// n'étaient bridés que par un filet journalier générique (A13,
// verifierLimiteGenerique), jamais par la TAILLE réelle de l'appel : un
// client pouvait envoyer mode:'microEditScript' avec max_tokens:16000,
// web_search:true et model:'claude-sonnet-4-6', obtenant une génération
// complète jusqu'à 100 fois/jour, sans jamais toucher au quota mensuel
// `creation`. Correctif : PLAFONDS_MODE_LEGER (api/generate.js) impose côté
// serveur, pour ces trois modes uniquement, le max_tokens et le modèle
// réellement utilisés par le client légitime (js/generation.js:3514,
// js/storytelling.js:1667, js/niche-auto.js:296,433), et ignore
// systématiquement web_search.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  ANTHROPIC_API_KEY: 'cle-anthropic-test',
  CODE_ADMIN: 'ADMIN-TEST'
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

// Capture le DERNIER corps envoyé à Anthropic, sans jamais faire de vrai
// appel réseau : c'est la seule chose qui compte pour ces tests (quels
// paramètres le serveur a réellement transmis), pas la réponse elle-même.
function poserFetchMock({ quotaOk = true } = {}) {
  const appels = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      return { ok: true, json: async () => quotaOk };
    }
    if (u.includes('api.anthropic.com')) {
      appels.push(JSON.parse(opts.body));
      return {
        ok: true, status: 200,
        json: async () => ({ content: [{ text: 'réponse de test' }], usage: { input_tokens: 10, output_tokens: 10 } })
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  return appels;
}

test('1. microEdit normal (300 tokens, sans recherche web) => PASS, transmis tel quel', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'microEditScript', max_tokens: 300, model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'Reformule : bonjour' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels.length, 1);
    assert.equal(appels[0].max_tokens, 300);
  } finally { restaurer(); }
});

test('2. detectionNiche normale (jusqu\'à 700 tokens) => PASS, transmis tel quel', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'detectionNiche', max_tokens: 700, messages: [{ role: 'user', content: 'niche ?' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 700);
  } finally { restaurer(); }
});

test('3. microEdit + max_tokens excessif (16000) => plafonné à 300 côté serveur', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'microEditScript', max_tokens: 16000, messages: [{ role: 'user', content: 'x'.repeat(50) }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 300, 'max_tokens demandé par le client ne doit JAMAIS dépasser le plafond réel du mode : ' + JSON.stringify(appels[0]));
  } finally { restaurer(); }
});

test('4. microEdit + web_search forcé (true) => ignoré, aucun outil transmis à Anthropic', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'microEditScript', max_tokens: 300, web_search: true, web_search_max_uses: 3, messages: [{ role: 'user', content: 'x' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].tools, undefined, 'web_search=true ne doit jamais activer d\'outil sur ce mode : ' + JSON.stringify(appels[0]));
  } finally { restaurer(); }
});

test('5. detectionNiche + paramètres excessifs (max_tokens 16000 + web_search) => limité et ignoré', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'detectionNiche', max_tokens: 16000, web_search: true, messages: [{ role: 'user', content: 'x' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 700);
    assert.equal(appels[0].tools, undefined);
  } finally { restaurer(); }
});

test('6. appel direct sans frontend (anonyme, sans code_acces) => même protection', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'microEditScript', max_tokens: 16000, web_search: true, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'x' }] } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 300, 'la protection ne doit pas dépendre d\'un code_acces : elle s\'applique aussi à un appel totalement anonyme');
    assert.equal(appels[0].tools, undefined);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001');
  } finally { restaurer(); }
});

test('7. répétition jusqu\'à la limite journalière (A13) => rate-limit toujours actif', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ quotaOk: false }); // simule le plafond déjà atteint (verifierLimiteGenerique)
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'microEditScript', max_tokens: 300, messages: [{ role: 'user', content: 'x' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT', 'le plafond A13 (verifierLimiteGenerique) doit rester actif, ce correctif ne le remplace pas');
  } finally { restaurer(); }
});

test('8. payload de génération complète maquillé en mode microEditScript => impossible d\'obtenir les caractéristiques d\'une génération complète', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({
      method: 'POST',
      body: {
        mode: 'microEditScript', max_tokens: 16000, model: 'claude-sonnet-4-6',
        web_search: true, web_search_max_uses: 3,
        messages: [{ role: 'user', content: 'Écris un script TikTok complet de 60 secondes sur...' }],
        code_acces: 'CODE-PRO'
      }
    }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 300);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001');
    assert.equal(appels[0].tools, undefined);
  } finally { restaurer(); }
});

test('9. payload de génération complète maquillé en mode detectionNiche => impossible d\'obtenir les caractéristiques d\'une génération complète', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({
      method: 'POST',
      body: {
        mode: 'detectionNiche', max_tokens: 16000, model: 'claude-sonnet-4-6',
        web_search: true, web_search_max_uses: 3,
        messages: [{ role: 'user', content: 'Écris un script TikTok complet de 60 secondes sur...' }],
        code_acces: 'CODE-PRO'
      }
    }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 700);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001');
    assert.equal(appels[0].tools, undefined);
  } finally { restaurer(); }
});

test('10. les autres modes (creation) restent inchangés : plafonds globaux, pas ceux du mode léger', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({
      method: 'POST',
      body: { mode: 'creation', max_tokens: 16000, web_search: true, messages: [{ role: 'user', content: 'x' }], code_acces: 'CODE-PRO' }
    }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].max_tokens, 16000, 'le mode creation ne doit JAMAIS être bridé par les plafonds micro-edit/detection-niche : ' + JSON.stringify(appels[0]));
    assert.ok(appels[0].tools, 'web_search doit rester disponible pour une vraie génération : ' + JSON.stringify(appels[0]));
  } finally { restaurer(); }
});

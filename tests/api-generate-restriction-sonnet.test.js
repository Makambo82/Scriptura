// LOT 4B, AUDIT ID 4 (Gate Phase 2B) — /api/generate.js, Sonnet sans restriction serveur.
//
// Avant ce correctif : MODELES_AUTORISES acceptait déjà claude-sonnet-4-6,
// mais RIEN ne vérifiait ensuite QUI avait le droit de le demander -
// n'importe quel appelant identifié pouvait envoyer model:'claude-sonnet-4-6'
// sur n'importe quel appel (rédaction complète à 16000 jetons comprise), pour
// un coût bien supérieur à Haiku, jamais prévu pour aucun palier.
//
// Sonnet n'a QUE deux usages légitimes dans le produit (voir js/api.js) :
//  1. juge de secours (MODEL_JUGE_SECOURS), pour N'IMPORTE QUEL compte,
//     jamais plus de 1200-1400 jetons ;
//  2. essai à l'aveugle Critique/Révision du récit (MODELES_ESSAI_RECIT),
//     STRICTEMENT réservé à l'admin, jusqu'à 8000 jetons.
// Correctif : Sonnet n'est transmis à Anthropic que si droits.isAdmin, OU si
// max_tokens (déjà plafonné côté serveur) reste ≤ MAX_TOKENS_SONNET_NON_ADMIN
// (1400, voir le commentaire de cette constante dans api/generate.js pour le
// résidu explicitement signalé plutôt que fermé par une règle inventée).
// Sinon, retombe sur MODELE_DEFAUT (Haiku), même convention que tout modèle
// hors liste.
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

function poserFetchMock({ plan = 'creator' } = {}) {
  const appelsAnthropic = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => [{ actif: true, plan, jetons_audit: 0 }] };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      return { ok: true, json: async () => true };
    }
    if (u.includes('/rest/v1/rpc/rembourser_usage')) {
      return { ok: true, json: async () => true };
    }
    if (u.includes('api.anthropic.com')) {
      appelsAnthropic.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ content: [{ text: 'réponse de test' }], usage: { input_tokens: 5, output_tokens: 5 } }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  return appelsAnthropic;
}

test('1. admin + Sonnet, gros max_tokens (essai à l\'aveugle Révision du récit, 8000) => autorisé tel quel', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ plan: 'pro' });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'creation', max_tokens: 8000, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'révision du récit' }], code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].model, 'claude-sonnet-4-6', 'l\'essai à l\'aveugle admin doit garder Sonnet, il n\'a pas d\'autre voie légitime');
  } finally { restaurer(); }
});

test('2. compte Creator/Pro non-admin + Sonnet, gros max_tokens (rédaction complète, 16000) => refusé, rebasculé sur Haiku', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ plan: 'pro' });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'creation', max_tokens: 16000, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'écris un script complet' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001', 'un compte Pro non-admin ne doit jamais obtenir Sonnet sur un appel de la taille d\'une rédaction complète');
  } finally { restaurer(); }
});

test('3. tentative directe hors frontend (sans code_acces, anonyme) + Sonnet + gros payload => contournement impossible', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'creation', max_tokens: 16000, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'écris un script complet' }] } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001', 'un appel direct sans compte ne doit jamais obtenir Sonnet, quel que soit le modèle demandé dans le corps');
  } finally { restaurer(); }
});

test('4. micro-édition (microEditScript) + Sonnet demandé => toujours Haiku (plafond LOT 4A inchangé)', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ plan: 'pro' });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'microEditScript', max_tokens: 300, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'reformule' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001', 'PLAFONDS_MODE_LEGER (LOT 4A) doit continuer à forcer MODELE_DEFAUT, y compris pour un admin');
  } finally { restaurer(); }
});

test('5. detectionNiche + Sonnet demandé => toujours Haiku (plafond LOT 4A inchangé)', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ plan: 'pro' });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { mode: 'detectionNiche', max_tokens: 700, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'niche ?' }], code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001');
  } finally { restaurer(); }
});

test('6. comportement existant inchangé : création standard en Haiku (non-admin) et juge de secours (Sonnet, ≤1400 jetons, non-admin) toujours servis', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ plan: 'creator' });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    // 6a. création standard, modèle Haiku demandé (comportement historique) : inchangé.
    const res1 = creerRes();
    await handler({ method: 'POST', body: { mode: 'creation', max_tokens: 2000, model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'idée de script' }], code_acces: 'CODE-CREATOR' } }, res1);
    assert.equal(res1.statutRecu, 200);
    assert.equal(appels[0].model, 'claude-haiku-4-5-20251001');

    // 6b. juge de secours (voir evaluerScriptGenere, js/generation.js : modeleJuge
    // passé à MODEL_JUGE_SECOURS, mode reste undefined => 'creation', 1200-1400
    // jetons) déclenché pour un compte Creator non-admin : doit continuer à
    // fonctionner, c'est le seul usage non-admin légitime de Sonnet.
    const res2 = creerRes();
    await handler({ method: 'POST', body: { max_tokens: 1400, model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'juge le script' }], code_acces: 'CODE-CREATOR' } }, res2);
    assert.equal(res2.statutRecu, 200);
    assert.equal(appels[1].model, 'claude-sonnet-4-6', 'le juge de secours (≤1400 jetons) doit rester utilisable par un compte non-admin, sinon on casse un mécanisme légitime existant');
  } finally { restaurer(); }
});

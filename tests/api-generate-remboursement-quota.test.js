// LOT 4B, AUDIT ID 3 (Gate Phase 2B) — /api/generate.js, quota jamais remboursé.
//
// Avant ce correctif : verifierQuota décomptait déjà un slot de quota AVANT
// l'appel Anthropic (nécessaire pour rester atomique, voir consommer_usage,
// supabase/usage_serveur.sql), mais rien ne le rendait si l'appel échouait
// ensuite (erreur Anthropic, panne réseau, exception) - un créateur perdait
// un slot de quota mensuel pour une génération qu'il n'a jamais reçue.
// Correctif : rembourserQuotaSiNecessaire (api/generate.js), appelée sur les
// 3 points de sortie en échec APRÈS consommation (flux non-ok, appel
// classique non-ok, exception), réutilise rembourserUsage (déjà existante,
// api/_lib/acces.js) sur EXACTEMENT la référence débitée, jamais deux fois,
// jamais pour un appel qui n'a jamais rien consommé (quota déjà atteint,
// admin/illimité/anonyme) ni pour un appel réellement réussi.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  ANTHROPIC_API_KEY: 'cle-anthropic-test',
  CODE_ADMIN: 'ADMIN-TEST'
};

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null, fluxEcrit: '', fin: false, entetesEcrites: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  res.writeHead = (s, h) => { res.statutRecu = s; res.entetesEcrites = h; return res; };
  res.write = (c) => { res.fluxEcrit += c; return true; };
  res.end = () => { res.fin = true; return res; };
  return res;
}

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

// `anthropic(appelNumero)` décide de la réponse Anthropic à CHAQUE appel
// (permet de distinguer un premier appel raté d'un éventuel second, même si
// ce fichier n'en déclenche jamais qu'un par requête - api/generate.js ne
// retente rien lui-même, voir la RAPPORT pour la distinction avec les
// retries CÔTÉ CLIENT de js/api.js, hors de portée de ce module).
function poserFetchMock({ plan = 'creator', consommerOk = true, rembourserOk = true, anthropic } = {}) {
  const appelsAnthropic = [];
  const appelsRembourse = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => [{ actif: true, plan, jetons_audit: 0 }] };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      return { ok: true, json: async () => consommerOk };
    }
    if (u.includes('/rest/v1/rpc/rembourser_usage')) {
      appelsRembourse.push(JSON.parse(opts.body));
      return { ok: true, json: async () => rembourserOk };
    }
    if (u.includes('api.anthropic.com')) {
      appelsAnthropic.push(JSON.parse(opts.body));
      if (typeof anthropic === 'function') return anthropic(appelsAnthropic.length);
      return { ok: true, status: 200, json: async () => ({ content: [{ text: 'réponse de test' }], usage: { input_tokens: 5, output_tokens: 5 } }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  return { appelsAnthropic, appelsRembourse };
}

const CORPS_DE_BASE = { mode: 'creation', max_tokens: 500, model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'idée de script' }], code_acces: 'CODE-CREATOR' };

test('1. génération réussie => AUCUN remboursement, le slot consommé reste consommé', async () => {
  const restaurer = poserEnv();
  const { appelsRembourse } = poserFetchMock();
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(appelsRembourse.length, 0, 'un appel réussi ne doit jamais déclencher de remboursement');
  } finally { restaurer(); }
});

test('2. erreur Anthropic APRÈS consommation (ex. 529 surchargé) => remboursé UNE fois', async () => {
  const restaurer = poserEnv();
  const { appelsRembourse } = poserFetchMock({
    anthropic: () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'surchargé' } }) })
  });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res);
    assert.equal(res.statutRecu, 529);
    assert.equal(appelsRembourse.length, 1, 'une erreur Anthropic après consommation doit rembourser exactement une fois');
  } finally { restaurer(); }
});

test('3. quota déjà atteint AVANT toute consommation => aucun remboursement (rien n\'a été débité)', async () => {
  const restaurer = poserEnv();
  const { appelsAnthropic, appelsRembourse } = poserFetchMock({ consommerOk: false });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.equal(appelsAnthropic.length, 0, 'Anthropic ne doit jamais être appelé si le quota est déjà atteint');
    assert.equal(appelsRembourse.length, 0, 'rien n\'a été consommé : rembourser fabriquerait du quota qui n\'a jamais existé');
  } finally { restaurer(); }
});

test('4. plusieurs points d\'échec dans la même requête (non-ok PUIS JSON illisible) => jamais plus d\'UN remboursement', async () => {
  const restaurer = poserEnv();
  const { appelsRembourse } = poserFetchMock({
    anthropic: () => ({ ok: false, status: 500, json: async () => { throw new Error('corps illisible'); } })
  });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res);
    // Le chemin non-ok rembourse une première fois, puis response.json() lève
    // et fait tomber dans le catch général : le garde-fou quotaRembourse doit
    // empêcher un second appel RPC.
    assert.equal(appelsRembourse.length, 1, 'deux points d\'échec traversés dans la même requête ne doivent produire qu\'un seul remboursement');
  } finally { restaurer(); }
});

test('4b. même scénario en mode flux (stream:true) => jamais plus d\'UN remboursement', async () => {
  const restaurer = poserEnv();
  const { appelsRembourse } = poserFetchMock({
    anthropic: () => ({ ok: false, status: 500, body: null, json: async () => { throw new Error('corps illisible'); } })
  });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { ...CORPS_DE_BASE, stream: true } }, res);
    assert.equal(appelsRembourse.length, 1, 'même garde-fou attendu sur le chemin flux');
  } finally { restaurer(); }
});

test('5. le remboursement lui-même échoue => l\'erreur ORIGINALE reste renvoyée au client, jamais masquée', async () => {
  const restaurer = poserEnv();
  const { appelsRembourse } = poserFetchMock({
    rembourserOk: false, // la RPC répond, mais rend false (ex. ligne déjà à zéro)
    anthropic: () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'surchargé' } }) })
  });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res);
    assert.equal(res.statutRecu, 529, 'un remboursement raté ne doit jamais changer la réponse renvoyée au créateur');
    assert.equal(res.corpsRecu.error.message, 'surchargé');
    assert.equal(appelsRembourse.length, 1, 'la tentative de remboursement doit avoir lieu même si elle échoue ensuite');
  } finally { restaurer(); }
});

test('6. réessai CÔTÉ CLIENT (callAI, js/api.js) après un premier échec => chaque appel HTTP est remboursé indépendamment, jamais 0 ni plus de 2', async () => {
  // Ce module ne retente jamais lui-même un appel Anthropic (voir handler,
  // api/generate.js) : le seul "réessai du même appel" qui existe dans ce
  // produit est CÔTÉ CLIENT (callAI, js/api.js), une DEUXIÈME requête HTTP
  // indépendante vers /api/generate. Ce test vérifie qu'aucun état ne fuit
  // d'une invocation du handler à l'autre (pas de compteur/drapeau partagé
  // au niveau du module) : deux requêtes qui échouent toutes les deux après
  // consommation doivent produire EXACTEMENT deux remboursements, ni un
  // remboursement "oublié" par l'une à cause de l'autre, ni un remboursement
  // fabriqué en trop.
  const restaurer = poserEnv();
  const { appelsRembourse } = poserFetchMock({
    anthropic: () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'surchargé' } }) })
  });
  try {
    const { default: handler } = await import('../api/generate.js?t=' + Date.now());
    const res1 = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res1);
    const res2 = creerRes();
    await handler({ method: 'POST', body: CORPS_DE_BASE }, res2);
    assert.equal(res1.statutRecu, 529);
    assert.equal(res2.statutRecu, 529);
    assert.equal(appelsRembourse.length, 2, 'deux requêtes indépendantes ayant chacune consommé puis échoué doivent produire exactement deux remboursements, aucun état ne doit fuir entre elles');
  } finally { restaurer(); }
});

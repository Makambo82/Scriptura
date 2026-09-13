// LOT 2, AUDIT A13 — Contrôle du volume des appels IA sur /api/generate.
//
// Deux familles de modes (microEditScript/microEditRecit, detectionNiche
// pour un appelant identifié) répondaient `{ok:true}` INCONDITIONNELLEMENT,
// sans la moindre vérification serveur — y compris pour un appelant
// totalement anonyme dans le cas des micro-éditions. Le seul plafond
// (MICRO_EDIT_MAX_PAR_SCRIPT=20, js/generation.js) n'existe QUE côté
// client, trivialement contourné par un appel direct à cette route. Ce
// fichier verrouille le nouveau filet journalier (verifierLimiteGenerique,
// api/_lib/acces.js), généreux mais réel, appliqué CÔTÉ SERVEUR.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

async function appeler(body, headers = {}) {
  const handlerModule = await import(path.join(__dirname, '..', 'api', 'generate.js') + '?t=' + Date.now() + '-' + Math.random());
  const handler = handlerModule.default;
  const res = mockRes();
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}

const REPONSE_ANTHROPIC_OK = { content: [{ type: 'text', text: 'Texte retouché.' }], usage: { input_tokens: 10, output_tokens: 5 } };

// Simule le compteur RÉEL de consommer_usage (usage_serveur) pour la clé de
// limite générique (voir refLimiteGenerique) : incrémente tant que sous le
// plafond, renvoie false une fois dépassé. `abonnesRows` permet de simuler
// un code_acces réel (sinon resoudreDroits le traite comme inconnu, ce qui
// n'affecte pas ce garde-fou, purement journalier, indépendant du plan).
function poserFetch({ plafond = Infinity, abonnesRows = [] } = {}) {
  const compteurs = new Map();
  const appelsAnthropic = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('api.anthropic.com')) {
      appelsAnthropic.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => REPONSE_ANTHROPIC_OK };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      const params = JSON.parse(opts.body);
      const n = (compteurs.get(params.p_ref) || 0) + (params.p_increment || 1);
      if (n > plafond) return { ok: true, json: async () => false };
      compteurs.set(params.p_ref, n);
      return { ok: true, json: async () => true };
    }
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => abonnesRows };
    return { ok: true, json: async () => ({}) };
  };
  return { appelsAnthropic, restaurer: () => { global.fetch = fetchOriginal; } };
}

test('A13-1 : comportement normal, microEditScript avec un code_acces fonctionne', async () => {
  poserEnv();
  const { appelsAnthropic, restaurer } = poserFetch({ abonnesRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }] });
  try {
    const r = await appeler({ mode: 'microEditScript', code_acces: 'UNABO1N2', messages: [{ role: 'user', content: 'Reformule.' }] });
    assert.equal(r._status, 200, JSON.stringify(r._json));
    assert.equal(appelsAnthropic.length, 1);
  } finally { restaurer(); retirerEnv(); }
});

test('A13-2 : appel direct SANS frontend, totalement anonyme : fonctionne sous le plafond (comportement voulu, pas cassé)', async () => {
  poserEnv();
  const { appelsAnthropic, restaurer } = poserFetch();
  try {
    const r = await appeler({ mode: 'microEditRecit', messages: [{ role: 'user', content: 'Raccourcis.' }] });
    assert.equal(r._status, 200, JSON.stringify(r._json));
    assert.equal(appelsAnthropic.length, 1, 'un usage anonyme légitime (micro-édition sur son propre récit) ne doit pas être bloqué');
  } finally { restaurer(); retirerEnv(); }
});

test('A13-3 : appels répétés (spam) au-delà du plafond journalier sont bloqués, jamais illimités', async () => {
  poserEnv();
  const PLAFOND = 100;
  const { appelsAnthropic, restaurer } = poserFetch({ plafond: PLAFOND });
  try {
    let derniere;
    for (let i = 0; i < PLAFOND + 5; i++) {
      derniere = await appeler({ mode: 'microEditScript', code_acces: 'SPAMMEUR1', messages: [{ role: 'user', content: 'x' }] });
    }
    assert.equal(derniere._status, 403, JSON.stringify(derniere._json));
    assert.equal(derniere._json?.error?.code, 'QUOTA_ATTEINT');
    assert.equal(appelsAnthropic.length, PLAFOND, 'exactement le plafond d\'appels Anthropic doit avoir eu lieu, jamais plus : ' + appelsAnthropic.length);
  } finally { restaurer(); retirerEnv(); }
});

test('A13-4 : detectionNiche pour un appelant IDENTIFIÉ (non-anonyme) est désormais bornée, plus jamais illimitée', async () => {
  poserEnv();
  const PLAFOND = 60;
  const { appelsAnthropic, restaurer } = poserFetch({ plafond: PLAFOND, abonnesRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] });
  try {
    let derniere;
    for (let i = 0; i < PLAFOND + 3; i++) {
      derniere = await appeler({ mode: 'detectionNiche', code_acces: 'UNABONNEPRO', messages: [{ role: 'user', content: 'Détecte la niche.' }] });
    }
    assert.equal(derniere._status, 403, JSON.stringify(derniere._json));
    assert.equal(appelsAnthropic.length, PLAFOND, 'REGRESSION A13 : detectionNiche identifiée était `{ok:true}` inconditionnel avant ce correctif');
  } finally { restaurer(); retirerEnv(); }
});

test('A13-5 : deux identités DIFFÉRENTES (codes distincts) ont chacune leur propre plafond', async () => {
  poserEnv();
  const { appelsAnthropic, restaurer } = poserFetch({ plafond: 2 });
  try {
    // Code A consomme tout son plafond.
    await appeler({ mode: 'microEditScript', code_acces: 'CODE-A', messages: [{ role: 'user', content: 'x' }] });
    await appeler({ mode: 'microEditScript', code_acces: 'CODE-A', messages: [{ role: 'user', content: 'x' }] });
    const aBloque = await appeler({ mode: 'microEditScript', code_acces: 'CODE-A', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(aBloque._status, 403);

    // Code B, jamais appelé avant, doit encore fonctionner.
    const bOk = await appeler({ mode: 'microEditScript', code_acces: 'CODE-B', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(bOk._status, 200, 'un autre code ne doit jamais hériter du plafond épuisé d\'un autre : ' + JSON.stringify(bOk._json));
    assert.equal(appelsAnthropic.length, 3);
  } finally { restaurer(); retirerEnv(); }
});

test('A13-6 : fournisseur (Anthropic) indisponible : erreur propre, jamais de plantage, comportement inchangé par le nouveau filet', async () => {
  poserEnv();
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (url.toString().includes('api.anthropic.com')) throw new Error('Anthropic injoignable');
    if (url.toString().includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => true };
    return { ok: true, json: async () => ([]) };
  };
  try {
    const r = await appeler({ mode: 'microEditScript', code_acces: 'UNCODE', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r._status, 500);
    assert.match(r._json.error.message, /Anthropic injoignable/);
  } finally { global.fetch = fetchOriginal; retirerEnv(); }
});

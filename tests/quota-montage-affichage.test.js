// Retour propriétaire (capture d'écran du panneau "Ton accès Scriptura") :
// le quota d'images de montage doit apparaître dans ce panneau comme les
// autres compteurs (Générations, Diagnostic sommaire...), pour tous les
// abonnés Creator et Pro. Impossible de réutiliser le mécanisme existant
// (comptage des lignes `generations`, voir countMonthGenerations côté
// client) : les images de montage n'y sont jamais insérées, seule la table
// `usage_serveur` (service_role uniquement, voir supabase/usage_serveur.sql)
// connaît le vrai décompte. Ce test couvre le nouvel endpoint en lecture
// seule (api/data.js, resource=quotaMontage) qui l'expose au client.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST-QUOTA-MONTAGE'
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

function poserFetchMock({ abonneRows, usageRows }) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    if (u.includes('/rest/v1/usage_serveur')) {
      return { ok: true, json: async () => (usageRows != null ? usageRows : []) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

test('quotaMontage : un abonné Pro voit son décompte réel (usage_serveur), pas 0/60 par défaut', async () => {
  const restaurer = poserEnv();
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    usageRows: [{ used: 17 }]
  });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const req = { method: 'GET', query: { resource: 'quotaMontage', code: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.concerne, true);
    assert.equal(res.corpsRecu.used, 17);
    assert.equal(res.corpsRecu.plafond, 60, 'plafond Pro = 60 images/mois');
  } finally { restaurer(); }
});

test('quotaMontage : un abonné Creator voit le plafond 20, à 0 s\'il n\'a encore rien consommé ce mois-ci', async () => {
  const restaurer = poserEnv();
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    usageRows: [] // aucune ligne usage_serveur pour ce mois : jamais utilisé
  });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const req = { method: 'GET', query: { resource: 'quotaMontage', code: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.concerne, true);
    assert.equal(res.corpsRecu.used, 0);
    assert.equal(res.corpsRecu.plafond, 20, 'plafond Creator = 20 images/mois');
  } finally { restaurer(); }
});

test('quotaMontage : un non-abonné (code inconnu/jeton) reçoit concerne:false, jamais un faux 0/0', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [] });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const req = { method: 'GET', query: { resource: 'quotaMontage', code: 'CODE-INCONNU' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.concerne, false);
  } finally { restaurer(); }
});

test('quotaMontage : sans code => concerne:false, jamais d\'appel Supabase', async () => {
  const restaurer = poserEnv();
  let appele = false;
  global.fetch = async () => { appele = true; return { ok: true, json: async () => ([]) }; };
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const req = { method: 'GET', query: { resource: 'quotaMontage' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.concerne, false);
    assert.equal(appele, false);
  } finally { restaurer(); }
});

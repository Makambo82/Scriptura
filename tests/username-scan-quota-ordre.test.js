// Non-régression pour une vraie faille trouvée lors de l'audit complet du
// 2 septembre 2026 : le quota de diagnostics sommaires était décompté AVANT
// même de savoir si le profil TikTok demandé existait/était accessible. Un
// pseudo privé, introuvable, ou une panne TikHub décomptait quand même le
// quota du mois pour un résultat qui n'arrivait jamais à l'écran. Le quota
// n'est désormais consommé qu'APRÈS confirmation que le profil est trouvable
// (voir api/username-scan.js).
const test = require('node:test');
const assert = require('node:assert/strict');

function poserFetchMock(scenario) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (scenario.custom) {
      const r = await scenario.custom(u, opts);
      if (r) return r;
    }
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (scenario.abonneRows != null ? scenario.abonneRows : []) };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      return { ok: true, json: async () => (scenario.quotaOk != null ? scenario.quotaOk : true) };
    }
    if (u.includes('fetch_user_profile')) {
      if (scenario.profilEchec) {
        return { ok: false, status: 404, json: async () => ({ message: 'Profil introuvable ou privé' }) };
      }
      return { ok: true, json: async () => ({ data: { userInfo: { user: { id: '1', secUid: 'sec1' }, stats: { followerCount: 1000, heartCount: 5000 } } } }) };
    }
    if (u.includes('fetch_user_post')) {
      return { ok: true, json: async () => ({ data: { itemList: [] } }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

function poserEnv() {
  const avant = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://exemple.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
    TIKHUB_API_KEY: 'cle-tikhub-test',
    CODE_ADMIN: 'ADMIN-TEST'
  });
  return () => { process.env = avant; };
}

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  return res;
}

test('username-scan : un profil introuvable/privé NE consomme PAS le quota du mois', async () => {
  const restaurer = poserEnv();
  let consommeAppele = false;
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    profilEchec: true,
    custom(u) { if (u.includes('/rest/v1/rpc/consommer_usage')) consommeAppele = true; return null; }
  });
  try {
    const { default: handler } = await import('../api/username-scan.js?t=' + Date.now());
    const req = { method: 'POST', body: { username: 'compte-prive-ou-inconnu', code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 404);
    assert.ok(res.corpsRecu.error);
    assert.equal(consommeAppele, false, 'un profil introuvable ne doit jamais décompter le quota : l\'utilisateur doit pouvoir réessayer avec un autre pseudo sans avoir perdu un diagnostic');
  } finally { restaurer(); }
});

test('username-scan : le quota déjà épuisé ne se manifeste qu\'APRÈS confirmation du profil', async () => {
  const restaurer = poserEnv();
  const ordreAppels = [];
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    quotaOk: false,
    custom(u) {
      if (u.includes('fetch_user_profile')) ordreAppels.push('profil');
      if (u.includes('/rest/v1/rpc/consommer_usage')) ordreAppels.push('quota');
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/username-scan.js?t=' + Date.now());
    const req = { method: 'POST', body: { username: 'un-compte-valide', code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.deepEqual(ordreAppels, ['profil', 'quota'], 'le profil doit être confirmé AVANT toute tentative de décompte du quota : ' + JSON.stringify(ordreAppels));
  } finally { restaurer(); }
});

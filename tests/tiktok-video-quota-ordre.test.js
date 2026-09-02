// Non-régression pour une vraie faille trouvée lors de l'audit complet du
// 2 septembre 2026 : le quota d'analyses vidéo (mode analyseVirale) était
// décompté AVANT de savoir si le lien était reconnu ou la vidéo réellement
// téléchargeable, sur la transcription ET le téléchargement. Un lien mal
// formé ou une vidéo privée/supprimée décomptait quand même le quota du
// mois. Le quota n'est désormais consommé qu'APRÈS confirmation que la
// vidéo a été réellement téléchargée (voir api/tiktok-video.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_VALIDE = 'https://www.tiktok.com/@createur/video/7123456789012345678';
const URL_MEDIA = 'https://cdn.exemple.com/video.mp4';
const GROS_BUFFER = Buffer.alloc(60000, 1); // > MIN_VIDEO (50 Ko), voir _lib/tiktok-media.js

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
    if (u.includes('fetch_post_detail')) {
      if (scenario.videoIntrouvable) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({ data: { video: { play_addr: { url_list: [URL_MEDIA] } } } }) };
    }
    if (u === URL_MEDIA) {
      if (scenario.mediaIndisponible) return { ok: false, status: 502, headers: { get: () => '' } };
      return {
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : '') },
        arrayBuffer: async () => GROS_BUFFER.buffer.slice(GROS_BUFFER.byteOffset, GROS_BUFFER.byteOffset + GROS_BUFFER.byteLength)
      };
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
    ELEVENLABS_API_KEY: 'cle-eleven-test',
    CODE_ADMIN: 'ADMIN-TEST'
  });
  return () => { process.env = avant; };
}

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null, headers: {} };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.send = (b) => { res.corpsRecu = b; return res; };
  return res;
}

// ── Transcription ──

test('transcription : un lien TikTok mal formé NE consomme PAS le quota', async () => {
  const restaurer = poserEnv();
  let consommeAppele = false;
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    custom(u) { if (u.includes('/rest/v1/rpc/consommer_usage')) consommeAppele = true; return null; }
  });
  try {
    const { default: handler } = await import('../api/tiktok-video.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'transcription' }, body: { url: 'https://exemple.com/pas-un-lien-tiktok', code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 422);
    assert.equal(consommeAppele, false, 'un lien mal formé ne doit jamais décompter le quota');
  } finally { restaurer(); }
});

test('transcription : une vidéo indisponible au téléchargement NE consomme PAS le quota', async () => {
  const restaurer = poserEnv();
  let consommeAppele = false;
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    mediaIndisponible: true,
    custom(u) { if (u.includes('/rest/v1/rpc/consommer_usage')) consommeAppele = true; return null; }
  });
  try {
    const { default: handler } = await import('../api/tiktok-video.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'transcription' }, body: { url: URL_VALIDE, code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, false);
    assert.equal(res.corpsRecu.raison, 'video_indisponible');
    assert.equal(consommeAppele, false, 'une vidéo indisponible ne doit jamais décompter le quota');
  } finally { restaurer(); }
});

test('transcription : une vidéo réellement téléchargée MAIS quota déjà épuisé => QUOTA_ATTEINT, quota vérifié seulement après le téléchargement', async () => {
  const restaurer = poserEnv();
  const ordreAppels = [];
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    quotaOk: false,
    custom(u) {
      if (u === URL_MEDIA) ordreAppels.push('media');
      if (u.includes('/rest/v1/rpc/consommer_usage')) ordreAppels.push('quota');
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tiktok-video.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'transcription' }, body: { url: URL_VALIDE, code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.deepEqual(ordreAppels, ['media', 'quota'], 'le téléchargement doit être confirmé AVANT toute tentative de décompte du quota : ' + JSON.stringify(ordreAppels));
  } finally { restaurer(); }
});

// ── Téléchargement ──

test('download : un lien TikTok mal formé NE consomme PAS le quota', async () => {
  const restaurer = poserEnv();
  let consommeAppele = false;
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    custom(u) { if (u.includes('/rest/v1/rpc/consommer_usage')) consommeAppele = true; return null; }
  });
  try {
    const { default: handler } = await import('../api/tiktok-video.js?t=' + Date.now());
    const req = { method: 'GET', query: { action: 'download', url: 'https://exemple.com/pas-un-lien-tiktok', code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 422);
    assert.equal(consommeAppele, false, 'un lien mal formé ne doit jamais décompter le quota');
  } finally { restaurer(); }
});

test('download : une vidéo réellement téléchargée MAIS quota déjà épuisé => QUOTA_ATTEINT, quota vérifié seulement après le téléchargement', async () => {
  const restaurer = poserEnv();
  const ordreAppels = [];
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    quotaOk: false,
    custom(u) {
      if (u === URL_MEDIA) ordreAppels.push('media');
      if (u.includes('/rest/v1/rpc/consommer_usage')) ordreAppels.push('quota');
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tiktok-video.js?t=' + Date.now());
    const req = { method: 'GET', query: { action: 'download', url: URL_VALIDE, code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.deepEqual(ordreAppels, ['media', 'quota'], 'le téléchargement doit être confirmé AVANT toute tentative de décompte du quota : ' + JSON.stringify(ordreAppels));
  } finally { restaurer(); }
});

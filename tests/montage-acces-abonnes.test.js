// Retour propriétaire : le montage vidéo (voix off, musique, images) était
// jusqu'ici réservé à isAdmin uniquement, aucun abonné réel (Creator/Pro) ne
// pouvait l'utiliser. Ouverture aux deux plans, différenciés seulement par un
// quota MENSUEL D'IMAGES (pas un quota de montages : une vidéo de 10 images
// et une de 30 n'ont pas le même coût, voir LIMITES_MOIS.montageImages,
// api/_lib/acces.js). Le rendu vidéo final (api/montage-render.js) reste à
// part, encore réservé au fondateur (non concerné par ces tests).
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  TOGETHER_API_KEY: 'cle-together-test',
  ELEVENLABS_API_KEY: 'cle-eleven-test',
  ELEVENLABS_VOICE_ID: 'voix-test',
  CODE_ADMIN: 'ADMIN-TEST-MONTAGE'
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

// `rpcAppels` (optionnel) collecte chaque corps envoyé à consommer_usage,
// pour vérifier l'increment (nombre d'images) réellement transmis.
function poserFetchMock({ abonneRows, quotaOk = true, rpcAppels }) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      if (rpcAppels && opts && opts.body) rpcAppels.push(JSON.parse(opts.body));
      return { ok: true, json: async () => quotaOk };
    }
    if (u.includes('api.together.xyz/v1/images/generations')) {
      return { ok: true, json: async () => ({ data: [{ b64_json: 'ZmFrZS1pbWFnZQ==' }] }) };
    }
    if (u.includes('elevenlabs.io/v1/text-to-speech')) {
      return {
        ok: true,
        json: async () => ({
          audio_base64: 'ZmFrZS1hdWRpbw==',
          alignment: {
            character_start_times_seconds: [0],
            character_end_times_seconds: [0.5]
          }
        })
      };
    }
    if (u.includes('elevenlabs.io/v1/music')) {
      return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => Buffer.alloc(100).buffer };
    }
    return { ok: true, json: async () => ({}) };
  };
}

test('images : un abonné Creator (plan reconnu) passe le mur d\'accès, jusqu\'ici réservé au fondateur', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }] });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'images' }, body: { code_acces: 'CODE-CREATOR', prompts: ['un chat 9:16'], format: '9:16' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.ok(res.corpsRecu.images[0], 'une image aurait dû être générée pour un Creator');
  } finally { restaurer(); }
});

test('images : un abonné Pro passe aussi le mur d\'accès', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'images' }, body: { code_acces: 'CODE-PRO', prompts: ['un chat 9:16'], format: '9:16' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

test('images : un code sans plan reconnu (jeton/inconnu) reste refusé, comme avant', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [] });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'images' }, body: { code_acces: 'CODE-INCONNU', prompts: ['un chat 9:16'], format: '9:16' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
  } finally { restaurer(); }
});

test('images : anonyme (sans code_acces) reste refusé', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'images' }, body: { prompts: ['un chat 9:16'], format: '9:16' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
  } finally { restaurer(); }
});

test('images : le fondateur (isAdmin) continue de passer, comportement inchangé', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'images' }, body: { code_acces: ENV_BASE.CODE_ADMIN, prompts: ['un chat 9:16'], format: '9:16' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

test('images : le quota est décompté en NOMBRE D\'IMAGES du lot, pas en 1 par requête (retour propriétaire : unité de mesure)', async () => {
  const restaurer = poserEnv();
  const rpcAppels = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }], rpcAppels });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = {
      method: 'POST', query: { action: 'images' },
      body: { code_acces: 'CODE-PRO', prompts: ['plan 1', 'plan 2', 'plan 3'], format: '9:16' }
    };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    const appelMontage = rpcAppels.find(a => String(a.p_ref || '').includes('montageImages'));
    assert.ok(appelMontage, 'un appel consommer_usage pour montageImages était attendu : ' + JSON.stringify(rpcAppels));
    assert.equal(appelMontage.p_increment, 3, '3 prompts envoyés => increment de 3, pas 1 : ' + JSON.stringify(appelMontage));
    assert.equal(appelMontage.p_plafond, 60, 'plafond Pro = 60 images/mois (voir LIMITES_MOIS)');
  } finally { restaurer(); }
});

test('images : quota du mois atteint => 403 QUOTA_ATTEINT, AUCUN appel à Together (jamais dépenser au-delà du plafond)', async () => {
  const restaurer = poserEnv();
  let togetherAppele = false;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [{ actif: true, plan: 'creator', jetons_audit: 0 }] };
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => false };
    if (u.includes('api.together.xyz')) { togetherAppele = true; return { ok: true, json: async () => ({ data: [{ b64_json: 'x' }] }) }; }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'images' }, body: { code_acces: 'CODE-CREATOR', prompts: ['un chat 9:16'], format: '9:16' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.equal(togetherAppele, false, 'Together ne doit jamais être appelé une fois le quota atteint');
  } finally { restaurer(); }
});

test('tts : un abonné Creator passe désormais le mur d\'accès (jusqu\'ici réservé au fondateur)', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }] });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'tts' }, body: { code_acces: 'CODE-CREATOR', segments: ['Bonjour le monde'], voiceId: 'voix-test' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

test('music : un abonné Pro passe désormais le mur d\'accès (jusqu\'ici réservé au fondateur)', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const req = { method: 'POST', query: { action: 'music' }, body: { code_acces: 'CODE-PRO', dureeMs: 5000 } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

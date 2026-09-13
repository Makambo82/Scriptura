// LOT 2, AUDIT A7 — Quotas sur le rendu vidéo et les appels ElevenLabs.
//
// Avant ce correctif, /api/montage-render (rendu Railway) et
// /api/montage-media (action=tts / action=music, ElevenLabs) ne vérifiaient
// QUE le plan (Creator/Pro), jamais aucun compteur d'usage : un appel direct
// et répété à l'une de ces routes coûtait à volonté. Ce fichier verrouille
// les nouveaux quotas mensuels dédiés (montageRendus, montageVoix,
// montageMusique, voir LIMITES_MOIS dans api/_lib/acces.js), le
// remboursement en cas d'échec du fournisseur, et le fait que la RPC
// atomique existante (consommer_usage) est réutilisée, jamais remplacée par
// une lecture-puis-écriture JS.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// Convention du dépôt (voir tests/reponse-fournisseur-illisible.test.js et
// tests/helpers/fetch-fidele.js) : tout test qui pose son propre fetch pour
// appeler montage-media doit passer par ce helper, sans quoi un mock
// incomplet (sans .text()/.status) validerait du code qui ne fonctionne
// qu'avec lui. Nos mocks fournissent déjà .text() explicitement pour les
// réponses ElevenLabs, ce helper les laisse alors intactes.
require('./helpers/fetch-fidele').rendreLesMocksFideles();

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.MONTAGE_RENDER_URL = 'https://service-de-rendu-test.example/';
  process.env.ELEVENLABS_API_KEY = 'cle-elevenlabs-test';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test-1';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MONTAGE_RENDER_URL;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
}

// Simule consommer_usage/rembourser_usage sur le VRAI compteur en mémoire,
// par ref : incrémente/décrémente comme le ferait la RPC Postgres réelle.
function poserFetchQuota({ plafondRendus = Infinity, plafondVoix = Infinity, plafondMusique = Infinity, renduEchoue = false, elevenLabsEchoue = false } = {}) {
  const compteurs = new Map();
  const appelsRenduExterne = [];
  const appelsElevenLabs = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      const p = JSON.parse(opts.body);
      const plafond = p.p_ref.includes('_montageRendus_') ? plafondRendus
        : p.p_ref.includes('_montageVoix_') ? plafondVoix
        : p.p_ref.includes('_montageMusique_') ? plafondMusique : Infinity;
      const n = (compteurs.get(p.p_ref) || 0) + (p.p_increment || 1);
      if (n > plafond) return { ok: true, json: async () => false };
      compteurs.set(p.p_ref, n);
      return { ok: true, json: async () => true };
    }
    if (u.includes('/rest/v1/rpc/rembourser_usage')) {
      const p = JSON.parse(opts.body);
      compteurs.set(p.p_ref, Math.max(0, (compteurs.get(p.p_ref) || 0) - (p.p_montant || 1)));
      return { ok: true, json: async () => true };
    }
    if (u.includes('service-de-rendu-test.example')) {
      appelsRenduExterne.push(JSON.parse(opts.body));
      if (renduEchoue) return { ok: false, status: 500, json: async () => ({ error: { message: 'panne render-service' } }) };
      return { ok: true, json: async () => ({ url: 'https://exemple.supabase.co/storage/v1/object/sign/montages/rendus/x.mp4?token=t' }) };
    }
    if (u.includes('api.elevenlabs.io/v1/text-to-speech')) {
      appelsElevenLabs.push('tts');
      // lireJsonOuNull (api/montage-media.js) lit .text(), jamais .json()
      // directement (pour tolérer une passerelle qui répondrait du HTML).
      const corps = elevenLabsEchoue
        ? { detail: { message: 'panne ElevenLabs' } }
        : { audio_base64: 'ZmFrZQ==', alignment: { character_start_times_seconds: [0], character_end_times_seconds: [0.5] } };
      return { ok: !elevenLabsEchoue, status: elevenLabsEchoue ? 500 : 200, text: async () => JSON.stringify(corps) };
    }
    if (u.includes('api.elevenlabs.io/v1/music')) {
      appelsElevenLabs.push('music');
      if (elevenLabsEchoue) {
        return { ok: false, status: 500, text: async () => JSON.stringify({ detail: { message: 'panne ElevenLabs Music' } }) };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('audio-factice').buffer };
    }
    if (u.includes('/rest/v1/abonnes')) {
      // Un abonné Creator réel (jamais admin/illimité, qui court-circuiterait
      // verifierQuota et empêcherait de tester la consommation elle-même).
      return { ok: true, json: async () => ([{ actif: true, plan: 'creator', jetons_audit: 0 }]) };
    }
    return { ok: true, json: async () => ([]) };
  };
  return { compteurs, appelsRenduExterne, appelsElevenLabs, restaurer: () => { global.fetch = fetchOriginal; } };
}

test('A7-1 : le rendu vidéo consomme bien le quota montageRendus (avant, aucun quota n\'était vérifié)', async () => {
  poserEnv();
  const { compteurs, restaurer } = poserFetchQuota();
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { code_acces: 'UNABONNE1', images: [{ url: 'https://x.example/a.jpg', duration: 2 }], audioUrl: 'https://x.example/a.mp3' }
    }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    const cle = Array.from(compteurs.keys()).find(k => k.includes('_montageRendus_'));
    assert.ok(cle, 'REGRESSION A7 : aucun compteur montageRendus consommé');
    assert.equal(compteurs.get(cle), 1);
  } finally { restaurer(); retirerEnv(); }
});

test('A7-2 : quota montageRendus épuisé → 403, jamais de rendu déclenché', async () => {
  poserEnv();
  const { appelsRenduExterne, restaurer } = poserFetchQuota({ plafondRendus: 0 });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { code_acces: 'UNABONNE2', images: [{ url: 'https://x.example/a.jpg', duration: 2 }], audioUrl: 'https://x.example/a.mp3' }
    }, res);
    assert.equal(res._status, 403);
    assert.equal(res._json.error.code, 'QUOTA_ATTEINT');
    assert.equal(appelsRenduExterne.length, 0, 'le service de rendu externe ne doit jamais être contacté quota épuisé');
  } finally { restaurer(); retirerEnv(); }
});

test('A7-3 : rendu remboursé si le service externe échoue (jamais de double pénalité)', async () => {
  poserEnv();
  const { compteurs, restaurer } = poserFetchQuota({ renduEchoue: true });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { code_acces: 'UNABONNE3', images: [{ url: 'https://x.example/a.jpg', duration: 2 }], audioUrl: 'https://x.example/a.mp3' }
    }, res);
    assert.equal(res._status, 502);
    const cle = Array.from(compteurs.keys()).find(k => k.includes('_montageRendus_'));
    assert.equal(compteurs.get(cle), 0, 'le quota débité doit être remboursé après un échec du service externe : ' + compteurs.get(cle));
  } finally { restaurer(); retirerEnv(); }
});

test('A7-4 : la voix off (ElevenLabs TTS) consomme le quota montageVoix, remboursé si ElevenLabs échoue', async () => {
  poserEnv();
  const { compteurs, restaurer } = poserFetchQuota();
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'tts' }, body: { code_acces: 'UNABONNE4', segments: ['Bonjour le monde.'] } }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    const cle = Array.from(compteurs.keys()).find(k => k.includes('_montageVoix_'));
    assert.ok(cle, 'REGRESSION A7 : aucun compteur montageVoix consommé');
    assert.equal(compteurs.get(cle), 1);
  } finally { restaurer(); retirerEnv(); }
});

test('A7-5 : quota montageVoix épuisé → 403, jamais d\'appel ElevenLabs', async () => {
  poserEnv();
  const { appelsElevenLabs, restaurer } = poserFetchQuota({ plafondVoix: 0 });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'tts' }, body: { code_acces: 'UNABONNE5', segments: ['Bonjour.'] } }, res);
    assert.equal(res._status, 403);
    assert.equal(appelsElevenLabs.length, 0);
  } finally { restaurer(); retirerEnv(); }
});

test('A7-6 : la musique (ElevenLabs Music) consomme le quota montageMusique, remboursé si ElevenLabs échoue', async () => {
  poserEnv();
  const { compteurs, restaurer } = poserFetchQuota({ elevenLabsEchoue: true });
  try {
    const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'music' }, body: { code_acces: 'UNABONNE6', dureeMs: 5000 } }, res);
    assert.equal(res._status, 502);
    const cle = Array.from(compteurs.keys()).find(k => k.includes('_montageMusique_'));
    assert.equal(compteurs.get(cle), 0, 'échec ElevenLabs Music : le quota débité doit être remboursé');
  } finally { restaurer(); retirerEnv(); }
});

test('A7-7 : une panne de la RPC de quota est journalisée (avant : totalement silencieuse)', async () => {
  poserEnv();
  const alertes = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: false, status: 500, json: async () => ({}) };
    if (u.includes('/rest/v1/erreurs_generation')) { alertes.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({}) }; }
    if (u.includes('service-de-rendu-test.example')) return { ok: true, json: async () => ({ url: 'https://x/rendu.mp4' }) };
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => ([{ actif: true, plan: 'creator', jetons_audit: 0 }]) };
    return { ok: true, json: async () => ([]) };
  };
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { code_acces: 'UNABONNE7', images: [{ url: 'https://x.example/a.jpg', duration: 2 }], audioUrl: 'https://x.example/a.mp3' }
    }, res);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(res._status, 200, 'une panne RPC doit laisser passer (dégradation), jamais bloquer : ' + JSON.stringify(res._json));
    assert.equal(alertes.length, 1, 'REGRESSION A7 : une panne de la RPC de quota doit être journalisée, plus jamais silencieuse');
    assert.equal(alertes[0].mode, 'quota-degrade');
    assert.match(alertes[0].detail, /consommer_usage/);
  } finally { global.fetch = fetchOriginal; retirerEnv(); }
});

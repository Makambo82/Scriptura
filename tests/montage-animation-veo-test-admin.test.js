// Retour propriétaire (27/09) : remplace la piste Agnes AI (retirée plus tôt
// dans ce même chantier, faute de fiabilité et de quota) par Together AI /
// Veo 3.1 - 0,08 $ par animation, image + texte vers vidéo. PHASE 1
// SEULEMENT : un bouton de test isolé, réservé admin/illimité, jamais mêlé
// au rendu final (voir api/montage-media.js, action=animate-create/animate-poll,
// et js/montage.js, testerAnimationImage()).
//
// Le format exact de la réponse Together n'a pas pu être vérifié contre leur
// documentation officielle depuis cet environnement (domaines bloqués) :
// ces tests verrouillent donc surtout le CONTRAT côté Scriptura (droits,
// garde d'URL, propagation d'erreur brute) plutôt que de prétendre connaître
// la forme exacte de chaque réponse Together avec certitude.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/fetch-fidele').rendreLesMocksFideles();

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.TOGETHER_API_KEY = 'cle-together-test';
  process.env.CODE_ADMIN = 'ADMIN-TEST';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.TOGETHER_API_KEY;
  delete process.env.CODE_ADMIN;
}

async function appelerMontageMedia(action, body, comptes) {
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) {
      const code = (new URL(u).searchParams.get('code') || '').replace(/^eq\./, '');
      const compte = comptes && comptes[code];
      return { ok: true, json: async () => (compte ? [compte] : []) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await mod.default({ method: 'POST', query: { action }, body }, res);
    return res;
  } finally { global.fetch = fetchOriginal; }
}

const IMAGE_URL_VALIDE = 'https://exemple.supabase.co/storage/v1/object/sign/montages/test-anime-1/image.jpg?token=abc';

test('animate-create : refusé pour un non-admin/non-illimité', async () => {
  poserEnv();
  try {
    const res = await appelerMontageMedia('animate-create', { imageUrl: IMAGE_URL_VALIDE, code_acces: 'ABONNE-CREATOR' }, {
      'ABONNE-CREATOR': { actif: true, plan: 'creator', jetons_audit: 0 }
    });
    assert.equal(res._status, 403);
  } finally { retirerEnv(); }
});

test('animate-create : refusé pour une URL qui n\'est pas une image Storage approuvée', async () => {
  poserEnv();
  try {
    const res = await appelerMontageMedia('animate-create', { imageUrl: 'https://exemple-quelconque.com/photo.jpg', code_acces: 'ADMIN-TEST' });
    assert.equal(res._status, 400);
  } finally { retirerEnv(); }
});

test('animate-create : refuse une URL qui n\'appartient pas au bucket montages (même garde que le reste du fichier)', async () => {
  poserEnv();
  try {
    const res = await appelerMontageMedia('animate-create', {
      imageUrl: 'https://exemple.supabase.co/rest/v1/generations',
      code_acces: 'ADMIN-TEST'
    });
    assert.equal(res._status, 400);
  } finally { retirerEnv(); }
});

test('animate-create : TOGETHER_API_KEY absente => erreur explicite, jamais un appel externe', async () => {
  poserEnv();
  delete process.env.TOGETHER_API_KEY;
  try {
    const res = await appelerMontageMedia('animate-create', { imageUrl: IMAGE_URL_VALIDE, code_acces: 'ADMIN-TEST' });
    assert.equal(res._status, 500);
    assert.match(res._json.error.message, /TOGETHER_API_KEY/);
  } finally { retirerEnv(); }
});

test('animate-create : succès => renvoie l\'id Together, avec le bon modèle/image/format dans la requête', async () => {
  poserEnv();
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  const appels = [];
  global.fetch = async (url, opts) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    if (u === 'https://api.together.xyz/v2/videos') {
      appels.push({ url: u, corps: JSON.parse(opts.body), auth: opts.headers.Authorization });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'veo-job-123', status: 'queued' }) };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await mod.default({ method: 'POST', query: { action: 'animate-create' }, body: { imageUrl: IMAGE_URL_VALIDE, code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.id, 'veo-job-123');
    assert.equal(appels.length, 1);
    assert.equal(appels[0].corps.model, 'google/veo-3.1');
    assert.equal(appels[0].corps.image_url, IMAGE_URL_VALIDE);
    assert.equal(appels[0].auth, 'Bearer cle-together-test');
    assert.ok(appels[0].corps.prompt, 'un prompt par défaut doit être envoyé même sans en fournir un');
  } finally { global.fetch = fetchOriginal; retirerEnv(); }
});

test('animate-create : Together refuse => le texte brut de la réponse remonte (jamais un message générique qui masque la vraie cause)', async () => {
  poserEnv();
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    if (u === 'https://api.together.xyz/v2/videos') {
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'invalid model google/veo-3.1' } }) };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await mod.default({ method: 'POST', query: { action: 'animate-create' }, body: { imageUrl: IMAGE_URL_VALIDE, code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 502);
    assert.match(res._json.error.message, /invalid model google\/veo-3\.1/,
      'REGRESSION : la vraie cause Together doit être visible, jamais avalée par un message générique (leçon d\'Agnes AI)');
  } finally { global.fetch = fetchOriginal; retirerEnv(); }
});

test('animate-create : TOGETHER_VIDEO_ENDPOINT (Vercel) permet de changer l\'adresse sans redéployer, même convention que TOGETHER_IMAGE_MODEL', async () => {
  poserEnv();
  process.env.TOGETHER_VIDEO_ENDPOINT = 'https://exemple-autre-adresse.together.xyz/v3/videos';
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  const appels = [];
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    appels.push(u);
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'veo-job-999' }) };
  };
  try {
    await mod.default({ method: 'POST', query: { action: 'animate-create' }, body: { imageUrl: IMAGE_URL_VALIDE, code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 200);
    assert.equal(appels[0], 'https://exemple-autre-adresse.together.xyz/v3/videos',
      'REGRESSION : TOGETHER_VIDEO_ENDPOINT doit être respecté, pas l\'adresse codée en dur');
  } finally { global.fetch = fetchOriginal; retirerEnv(); delete process.env.TOGETHER_VIDEO_ENDPOINT; }
});

test('animate-poll : refusé pour un non-admin/non-illimité', async () => {
  poserEnv();
  try {
    const res = await appelerMontageMedia('animate-poll', { id: 'veo-job-123', code_acces: 'ABONNE-CREATOR' }, {
      'ABONNE-CREATOR': { actif: true, plan: 'creator', jetons_audit: 0 }
    });
    assert.equal(res._status, 403);
  } finally { retirerEnv(); }
});

test('animate-poll : id manquant => 400, jamais d\'appel externe', async () => {
  poserEnv();
  try {
    const res = await appelerMontageMedia('animate-poll', { code_acces: 'ADMIN-TEST' });
    assert.equal(res._status, 400);
  } finally { retirerEnv(); }
});

test('animate-poll : vidéo prête => statut + url renvoyés', async () => {
  poserEnv();
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    if (u === 'https://api.together.xyz/v2/videos/veo-job-123') {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ id: 'veo-job-123', status: 'completed', outputs: { video_url: 'https://cdn.together.xyz/videos/veo-job-123.mp4', cost: 0.08 } })
      };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await mod.default({ method: 'POST', query: { action: 'animate-poll' }, body: { id: 'veo-job-123', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.statut, 'completed');
    assert.equal(res._json.videoUrl, 'https://cdn.together.xyz/videos/veo-job-123.mp4');
    assert.equal(res._json.erreur, null);
  } finally { global.fetch = fetchOriginal; retirerEnv(); }
});

test('animate-poll : job en échec côté Together => l\'erreur remonte, jamais avalée', async () => {
  poserEnv();
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    if (u === 'https://api.together.xyz/v2/videos/veo-job-456') {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ id: 'veo-job-456', status: 'failed', error: { message: 'content policy violation', code: 'moderation' } })
      };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await mod.default({ method: 'POST', query: { action: 'animate-poll' }, body: { id: 'veo-job-456', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.statut, 'failed');
    assert.equal(res._json.videoUrl, null);
    assert.match(res._json.erreur, /content policy violation/);
  } finally { global.fetch = fetchOriginal; retirerEnv(); }
});

test('animate-poll : un code de la liste CODES_ILLIMITES (pas seulement CODE_ADMIN) a aussi accès', async () => {
  poserEnv();
  process.env.CODES_ILLIMITES = 'ILLIMITE-1';
  const mod = await import('../api/montage-media.js?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    if (u === 'https://api.together.xyz/v2/videos/veo-job-789') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'veo-job-789', status: 'queued' }) };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await mod.default({ method: 'POST', query: { action: 'animate-poll' }, body: { id: 'veo-job-789', code_acces: 'ILLIMITE-1' } }, res);
    assert.equal(res._status, 200);
  } finally { global.fetch = fetchOriginal; retirerEnv(); delete process.env.CODES_ILLIMITES; }
});

// ═══ Écran réel : le bouton de test doit rester caché pour tout le monde
// sauf le fondateur (retour propriétaire, 27/09) ═══
//
// Bug réel trouvé en testant : le conteneur portait un style inline
// "display:none" - une classe CSS ne peut JAMAIS l'emporter sur un style
// inline, quel que soit body.is-admin. Le bouton restait donc invisible
// même pour le fondateur. Corrigé en déplaçant le "display:none" par
// défaut dans la feuille de style elle-même (voir css/style.css), jamais
// en inline sur l'élément.
test('le bouton de test Veo reste masqué pour un abonné normal, visible seulement pour le fondateur', async () => {
  const { demarrerServeur } = require('./helpers/serveur');
  const { lancerNavigateur } = require('./helpers/navigateur');
  const { poserMocksReseau } = require('./helpers/mocks');
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_code', 'CREATOR1');
      localStorage.setItem('scriptura_unlocked', 'true');
      unlocked = true;
      document.body.classList.add('is-unlocked', 'peut-monter-video');
      document.body.classList.remove('is-admin');
    });
    const visibleNonAdmin = await page.evaluate(() => {
      const el = document.querySelector('.montage-animer-test');
      return el ? getComputedStyle(el).display : 'absent';
    });
    assert.equal(visibleNonAdmin, 'none', 'REGRESSION : un abonné normal ne doit jamais voir ce bouton de test');

    await page.evaluate(() => document.body.classList.add('is-admin'));
    const visibleAdmin = await page.evaluate(() => {
      const el = document.querySelector('.montage-animer-test');
      return el ? getComputedStyle(el).display : 'absent';
    });
    assert.equal(visibleAdmin, 'block', 'REGRESSION : le fondateur doit voir ce bouton (un style inline avait gagné contre la règle CSS)');
  } finally { await navigateur.close(); await arreter(); }
});

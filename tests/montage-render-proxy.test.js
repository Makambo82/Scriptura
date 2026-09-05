// Non-régression pour une vraie faille trouvée cette session : le navigateur
// appelait directement le service de rendu vidéo externe (Railway), URL et
// jeton visibles dans le JS servi au client, donc publics, l'auth serveur
// (isAdmin) était contournée de fait. /api/montage-render est désormais le
// SEUL point d'entrée, il proxie lui-même vers le service externe si
// MONTAGE_RENDER_URL (variable d'environnement Vercel, jamais exposée au
// client) est réglée, avec le jeton ajouté ICI, côté serveur uniquement.
// Ce test vérifie ce proxy en isolant l'API (pas de navigateur nécessaire).
const test = require('node:test');
const assert = require('node:assert/strict');

test('/api/montage-render proxie vers le service externe avec le jeton serveur, jamais exposé au client', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MONTAGE';
  process.env.MONTAGE_RENDER_URL = 'https://service-de-rendu-test.example/';
  process.env.MONTAGE_RENDER_TOKEN = 'jeton-secret-test';

  const fetchOriginal = global.fetch;
  let requeteProxy = null;
  global.fetch = async (url, options) => {
    requeteProxy = { url, options };
    return {
      ok: true,
      json: async () => ({ url: 'https://supabase.example/montages/rendus/test.mp4' })
    };
  };

  try {
    const { default: handler } = await import('../api/montage-render.js');
    const req = {
      method: 'POST',
      body: {
        code_acces: 'TESTADMIN_MONTAGE',
        images: [{ url: 'https://x.example/a.jpg', duration: 2 }],
        audioUrl: 'https://x.example/audio.mp3',
        format: '9:16',
        captions: [{ texte: 'Ceci est un', debut: 0, fin: 0.55 }]
      }
    };
    let statusRecu = null, jsonRecu = null;
    const res = {
      status(code) { statusRecu = code; return this; },
      json(obj) { jsonRecu = obj; return this; }
    };

    await handler(req, res);

    assert.equal(statusRecu, 200, 'la réponse doit être 200 quand le service externe répond correctement');
    assert.deepEqual(jsonRecu, { url: 'https://supabase.example/montages/rendus/test.mp4' });

    assert.ok(requeteProxy, 'le proxy doit avoir appelé fetch vers le service externe');
    assert.equal(requeteProxy.url, 'https://service-de-rendu-test.example/render', 'doit appeler /render sur le service configuré');
    assert.equal(requeteProxy.options.headers['x-montage-token'], 'jeton-secret-test', 'le jeton serveur doit être envoyé au service externe');
    const corpsEnvoye = JSON.parse(requeteProxy.options.body);
    assert.deepEqual(corpsEnvoye.images, req.body.images);
    assert.equal(corpsEnvoye.audioUrl, req.body.audioUrl);
    assert.equal(corpsEnvoye.format, '9:16');
    assert.deepEqual(corpsEnvoye.captions, req.body.captions, 'les sous-titres (retour propriétaire) doivent être transmis au service externe : ' + JSON.stringify(corpsEnvoye));
    assert.equal('code_acces' in corpsEnvoye, false, 'le code d\'accès du créateur ne doit jamais être envoyé au service externe (hors de notre contrôle)');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-render transmet musicUrl et musicVolume au service externe (retour propriétaire : réglage du volume de la musique de fond)', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MONTAGE_VOLUME';
  process.env.MONTAGE_RENDER_URL = 'https://service-de-rendu-test.example/';

  const fetchOriginal = global.fetch;
  let requeteProxy = null;
  global.fetch = async (url, options) => {
    requeteProxy = { url, options };
    return { ok: true, json: async () => ({ url: 'https://supabase.example/montages/rendus/test.mp4' }) };
  };

  try {
    const { default: handler } = await import('../api/montage-render.js');
    const req = {
      method: 'POST',
      body: {
        code_acces: 'TESTADMIN_MONTAGE_VOLUME',
        images: [{ url: 'https://x.example/a.jpg', duration: 2 }],
        audioUrl: 'https://x.example/audio.mp3',
        musicUrl: 'https://x.example/musique.mp3',
        musicVolume: 0.3
      }
    };
    const res = { status() { return this; }, json() { return this; } };
    await handler(req, res);

    assert.ok(requeteProxy, 'le proxy doit avoir appelé fetch vers le service externe');
    const corpsEnvoye = JSON.parse(requeteProxy.options.body);
    assert.equal(corpsEnvoye.musicUrl, 'https://x.example/musique.mp3');
    assert.equal(corpsEnvoye.musicVolume, 0.3, 'le volume choisi doit être transmis tel quel au service externe : ' + JSON.stringify(corpsEnvoye));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-render transmet watermark au service externe (retour propriétaire : filigrane Scriptura décochable)', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MONTAGE_FILIGRANE';
  process.env.MONTAGE_RENDER_URL = 'https://service-de-rendu-test.example/';

  const fetchOriginal = global.fetch;
  let requetes = [];
  global.fetch = async (url, options) => {
    requetes.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ url: 'https://supabase.example/montages/rendus/test.mp4' }) };
  };

  try {
    const { default: handler } = await import('../api/montage-render.js');
    const corpsBase = {
      code_acces: 'TESTADMIN_MONTAGE_FILIGRANE',
      images: [{ url: 'https://x.example/a.jpg', duration: 2 }],
      audioUrl: 'https://x.example/audio.mp3'
    };
    const res = { status() { return this; }, json() { return this; } };
    await handler({ method: 'POST', body: { ...corpsBase, watermark: true } }, res);
    await handler({ method: 'POST', body: { ...corpsBase, watermark: false } }, res);

    assert.equal(requetes.length, 2);
    assert.equal(requetes[0].watermark, true, 'watermark:true doit être transmis tel quel : ' + JSON.stringify(requetes[0]));
    assert.equal(requetes[1].watermark, false, 'watermark:false (décoché) doit être transmis tel quel : ' + JSON.stringify(requetes[1]));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-render refuse un code non-abonné avant même de songer à un rendu', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MONTAGE2';
  process.env.MONTAGE_RENDER_URL = 'https://service-de-rendu-test.example/';
  // SUPABASE_URL/SERVICE_ROLE_KEY réglées ici (absentes dans les tests
  // précédents de ce fichier, qui n'en avaient pas besoin avec un code
  // admin) : sans elles, resoudreDroits dégrade en accès Creator gratuit
  // pour N'IMPORTE QUEL code (voir api/_lib/acces.js) - un vrai risque en
  // prod, mais qui aurait aussi rendu ce test faussement vert pour la
  // mauvaise raison (un code "refusé" par accident de configuration, pas
  // par une vraie vérification).
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';

  // Deux appels réseau bien distincts derrière ce seul test : la lecture
  // Supabase de l'abonné (toujours nécessaire pour SAVOIR qu'il faut
  // refuser), et le proxy vers le service de rendu externe (qui ne doit,
  // lui, jamais être contacté). `appeleProxy` ne doit noter QUE le second.
  const fetchOriginal = global.fetch;
  let appeleProxy = false;
  global.fetch = async (url) => {
    if (String(url).includes('service-de-rendu-test.example')) appeleProxy = true;
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/montage-render.js');
    const req = { method: 'POST', body: { code_acces: 'PAS_LE_FONDATEUR', images: [{ url: 'x', duration: 1 }], audioUrl: 'x' } };
    let statusRecu = null, jsonRecu = null;
    const res = { status(code) { statusRecu = code; return this; }, json(obj) { jsonRecu = obj; return this; } };

    await handler(req, res);

    assert.equal(statusRecu, 403, 'un code inconnu (jamais abonné) doit être refusé');
    assert.equal(jsonRecu.error && jsonRecu.error.code, 'ACCES_REFUSE');
    assert.equal(appeleProxy, false, 'le service externe ne doit jamais être contacté pour une requête refusée');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

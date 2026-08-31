// Le mode Tendances (api/tendances.js) est un endpoit purement serveur, sans
// équivalent testable via le harnais Playwright existant (qui mock les
// appels /api/* du NAVIGATEUR, pas les appels sortants que le serveur
// lui-même fait vers TikHub/Supabase/ElevenLabs/Anthropic). On teste donc le
// handler directement, en mockant global.fetch selon l'URL appelée.
//
// Couvre surtout le point corrigé pendant cette passe : un Creator (plafond
// tendances = 0/mois) ne doit JAMAIS voir "tu as déjà utilisé ton analyse ce
// mois-ci" (message qui suppose un accès qu'il n'a jamais eu), mais
// "réservé au plan Pro". Voir verifierQuota, api/_lib/acces.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  TIKHUB_API_KEY: 'cle-tikhub-test',
  CODE_ADMIN: 'ADMIN-TEST'
};

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  return res;
}

// Dispatch par URL : chaque scénario fournit juste les réponses qui
// l'intéressent, tout le reste renvoie une réponse "vide" raisonnable.
// `scenario.custom(url, opts)` (optionnel) est vérifié en premier, pour les
// tests qui ont besoin de mocker des URLs arbitraires (CDN vidéo, ElevenLabs).
function poserFetchMock(scenario) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (scenario.custom) {
      const r = await scenario.custom(u, opts);
      if (r) return r;
    }
    if (u.includes('/rest/v1/abonnes')) {
      const rows = scenario.abonneRows != null ? scenario.abonneRows : [];
      return { ok: true, json: async () => rows };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      return { ok: true, json: async () => (scenario.quotaOk != null ? scenario.quotaOk : true) };
    }
    if (u.includes('fetch_general_search')) {
      const page = (scenario.pagesRecherche || []).shift();
      return { ok: true, json: async () => (page || { data: { data: [], cursor: null, has_more: false } }) };
    }
    if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'POST') {
      return { ok: true, json: async () => [{ id: 'job-test-1' }] };
    }
    if (u.includes('/rest/v1/tendances_niche') && (!opts || !opts.method || opts.method === 'GET')) {
      return { ok: true, json: async () => (scenario.jobRow ? [scenario.jobRow] : []) };
    }
    if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'PATCH') {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

test('lancer : Creator (plafond 0) reçoit "réservé au plan Pro", jamais "déjà utilisé"', async () => {
  const restaurer = poserEnv();
  // Plafond Creator = 0/mois (voir LIMITES_MOIS, acces.js) : la vraie RPC
  // consommer_usage renverrait toujours false ici, jamais true.
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], quotaOk: false });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
    assert.match(res.corpsRecu.error.message, /réservé au plan Pro/);
    assert.doesNotMatch(res.corpsRecu.error.message, /déjà utilisé/);
  } finally { restaurer(); }
});

test('lancer : anonyme (sans code_acces) reçoit aussi "réservé au plan Pro"', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.match(res.corpsRecu.error.message, /réservé au plan Pro/);
  } finally { restaurer(); }
});

test('lancer : Pro ayant déjà consommé son quota du mois reçoit le message "déjà utilisé"', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }], quotaOk: false });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.match(res.corpsRecu.error.message, /déjà utilisé/);
  } finally { restaurer(); }
});

test('lancer : Pro avec quota dispo mais moins de 5 vidéos trouvées => pas_assez_de_videos', async () => {
  const restaurer = poserEnv();
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    quotaOk: true,
    pagesRecherche: [{ data: { data: [], cursor: null, has_more: false } }]
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'niche-vide-test', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, false);
    assert.equal(res.corpsRecu.raison, 'pas_assez_de_videos');
  } finally { restaurer(); }
});

test('POST action inconnue => 400', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'autre-chose' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 400);
  } finally { restaurer(); }
});

test('GET debug sans code admin => 403', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }] });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'GET', query: { mot: 'cuisine', debug: '1', code_acces: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
  } finally { restaurer(); }
});

test('lancer : ne garde que les vidéos les MIEUX VUES de la réserve, pas juste les premières rencontrées', async () => {
  // Constat réel en prod (retour du propriétaire) : les médianes de vues/
  // likes étaient trop basses pour un mode censé montrer "ce qui cartonne",
  // parce que fetch_general_search ne trie pas par performance et qu'on
  // gardait les 5 premières vidéos rencontrées, cartons ou pas. Une seule
  // page de 20 vidéos, vues très hétérogènes (de 100 à 900000) : le job créé
  // ne doit contenir QUE les 5 mieux vues (mode test, cible=5), jamais les
  // 5 premières de la page.
  const restaurer = poserEnv();
  const items = Array.from({ length: 20 }, (_, i) => ({
    item: {
      id: 'v' + i,
      desc: 'test',
      createTime: Math.floor(Date.now() / 1000),
      stats: { playCount: (i + 1) * 100 }, // v0=100 ... v19=2000, toutes faibles SAUF les 2 dernières
      author: {}, authorStats: {}
    }
  }));
  // Les 2 vraies "cartons" sont placées AU DÉBUT de la page, mais avec un
  // faible playCount : seules celles en fin de tableau ont un vrai gros score.
  items[18].item.stats.playCount = 850000;
  items[19].item.stats.playCount = 900000;
  let corpsInsere = null;
  poserFetchMock({
    pagesRecherche: [{ data: { data: items, cursor: 20, has_more: false } }],
    custom: async (u, opts) => {
      if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'POST') {
        corpsInsere = JSON.parse(opts.body);
        return { ok: true, json: async () => [{ id: 'job-tri-test' }] };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: ENV_BASE.CODE_ADMIN, test: true } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.total, 5);
    assert.ok(corpsInsere, 'la ligne Supabase aurait dû être créée');
    const vuesGardees = corpsInsere.videos.map(v => v.stats.vues).sort((a, b) => b - a);
    assert.deepEqual(vuesGardees, [900000, 850000, 1800, 1700, 1600], 'seules les vidéos les mieux vues doivent être gardées, pas les 5 premières rencontrées');
  } finally { restaurer(); }
});

test('lancer : une vidéo à énormément de vues mais SANS engagement est écartée au profit d\'une vidéo qui cartonne vraiment (vues ET engagement)', async () => {
  // Demande explicite du propriétaire : le tri doit combiner vues ET
  // engagement, pas les vues seules (voir classerParPerformance,
  // api/tendances.js). Ce test le prouve avec un cas net : une vidéo
  // "vitrine" à 1 million de vues mais 0 interaction (compte pub, vue
  // achetée...) ne doit PAS ressortir dans le top 5, alors qu'une vidéo à
  // seulement 5 000 vues mais 60% d'engagement (un vrai carton) doit y être.
  const restaurer = poserEnv();
  const items = [
    { item: { id: 'mega-vues-zero-engagement', desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000000, diggCount: 0, commentCount: 0, shareCount: 0 }, author: {}, authorStats: {} } },
    { item: { id: 'vrai-carton', desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 5000, diggCount: 2500, commentCount: 300, shareCount: 200 }, author: {}, authorStats: {} } },
    ...Array.from({ length: 13 }, (_, i) => ({
      item: { id: 'filler' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000, diggCount: 40, commentCount: 5, shareCount: 5 }, author: {}, authorStats: {} }
    }))
  ];
  let corpsInsere = null;
  poserFetchMock({
    pagesRecherche: [{ data: { data: items, cursor: 15, has_more: false } }],
    custom: async (u, opts) => {
      if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'POST') {
        corpsInsere = JSON.parse(opts.body);
        return { ok: true, json: async () => [{ id: 'job-engagement-test' }] };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: ENV_BASE.CODE_ADMIN, test: true } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    const idsGardes = corpsInsere.videos.map(v => v.id);
    assert.ok(idsGardes.includes('vrai-carton'), 'la vidéo à fort engagement doit être gardée : ' + idsGardes.join(','));
    assert.ok(!idsGardes.includes('mega-vues-zero-engagement'), 'la vidéo à 1M de vues mais 0 engagement ne doit PAS être gardée : ' + idsGardes.join(','));
  } finally { restaurer(); }
});

test('lancer : mode test (admin) limite l\'échantillon à 5 vidéos', async () => {
  const restaurer = poserEnv();
  const pages = [{
    data: {
      data: Array.from({ length: 20 }, (_, i) => ({
        item: { id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: {}, author: {}, authorStats: {} }
      })),
      cursor: 20, has_more: false
    }
  }];
  poserFetchMock({ pagesRecherche: pages });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: ENV_BASE.CODE_ADMIN, test: true } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.total, 5);
  } finally { restaurer(); }
});

test('lancer : mode test ignoré pour un non-admin (reste sur l\'échantillon complet)', async () => {
  const restaurer = poserEnv();
  const pages = [{
    data: {
      data: Array.from({ length: 20 }, (_, i) => ({
        item: { id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: {}, author: {}, authorStats: {} }
      })),
      cursor: 20, has_more: false
    }
  }];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }], quotaOk: true, pagesRecherche: pages });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: 'CODE-PRO', test: true } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.total, 20);
  } finally { restaurer(); }
});

test('avancer : résout une URL fraîche via fetch_post_detail avant de télécharger (plutôt que l\'URL périmée de la recherche)', async () => {
  const restaurer = poserEnv({ ELEVENLABS_API_KEY: 'cle-eleven-test' });
  const urlsAppelees = [];
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-1',
      statut: 'en_cours',
      niche: 'cuisine',
      index_suivant: 0,
      videos: [{
        id: 'v1', desc: 'test', createTime: Math.floor(Date.now() / 1000),
        auteur: { uniqueId: 'auteur1' }, stats: { vues: 1000, likes: 10, commentaires: 1, partages: 1 },
        hashtags: [], urlsCandidates: ['https://cdn-perimee.example/vieux.mp4'],
        transcript: null, transcriptEchec: false
      }]
    },
    custom: async (u, opts) => {
      urlsAppelees.push(u);
      if (u.includes('fetch_post_detail')) {
        return { ok: true, json: async () => ({ item: { video: { playAddr: 'https://cdn-fraiche.example/frais.mp4' } } }) };
      }
      if (u.includes('cdn-fraiche.example')) {
        return {
          ok: true, status: 200,
          headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : '') },
          arrayBuffer: async () => Buffer.alloc(60000).buffer
        };
      }
      if (u.includes('cdn-perimee.example')) {
        // L'ancienne URL périmée : si le code l'appelle encore, le test doit
        // le voir dans urlsAppelees pour révéler la régression.
        return { ok: false, status: 403, headers: { get: () => '' } };
      }
      if (u.includes('elevenlabs.io')) {
        return { ok: true, text: async () => JSON.stringify({ text: 'Bonjour ceci est une transcription de test.' }) };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-1', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.ok(urlsAppelees.some(u => u.includes('fetch_post_detail')), 'fetch_post_detail aurait dû être appelé pour résoudre une URL fraîche');
    assert.ok(urlsAppelees.some(u => u.includes('cdn-fraiche.example')), 'la vidéo aurait dû être téléchargée depuis l\'URL fraîche');
    assert.ok(!urlsAppelees.some(u => u.includes('cdn-perimee.example')), 'l\'URL périmée de la recherche ne devrait plus être utilisée quand la résolution fraîche réussit');
  } finally { restaurer(); }
});

test('GET debug avec code admin => 200, sonde TikHub appelée', async () => {
  const restaurer = poserEnv();
  poserFetchMock({
    pagesRecherche: [{ data: { data: [{ item: { id: '1' } }], cursor: 1, has_more: false } }]
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'GET', query: { mot: 'cuisine', debug: '1', code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.ok(res.corpsRecu._debug.tikhubKeyPresent);
    assert.ok(Array.isArray(res.corpsRecu._debug.candidats));
  } finally { restaurer(); }
});

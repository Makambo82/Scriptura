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
      // Simule le verrou optimiste (Prefer: return=representation, voir
      // supabaseUpdateSiInchange, api/tendances.js) : une ligne "appliquée"
      // par défaut, sauf si le scénario veut explicitement simuler une
      // écriture concurrente perdante (scenario.patchAppliquee === false).
      return { ok: true, json: async () => (scenario.patchAppliquee === false ? [] : [{ id: 'job-test-1' }]) };
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

// Audit du 2 septembre 2026 : niche/zone en texte libre étaient concaténées
// telles quelles dans le prompt Claude et la requête TikHub, sans aucun
// plafond de longueur.
test('lancer : une niche trop longue est refusée avant tout appel réseau', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'x'.repeat(200), code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 400);
    assert.match(res.corpsRecu.error.message, /trop longue/);
  } finally { restaurer(); }
});

test('lancer : une zone géographique trop longue est refusée avant tout appel réseau', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', zone: 'y'.repeat(200), code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 400);
    assert.match(res.corpsRecu.error.message, /trop longue/);
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

// Bug corrigé (retour terrain, audit du 2 septembre 2026) : le quota était
// auparavant décompté AVANT la recherche TikHub, un Pro sur une niche trop
// pointue perdait son unique analyse du mois pour un résultat vide. Le
// quota n'est désormais consommé qu'APRÈS confirmation qu'assez de vidéos
// ont été trouvées (voir api/tendances.js, action=lancer) : ce test fournit
// donc 5 vidéos valides pour que la recherche réussisse, et vérifie que
// c'est SEULEMENT à ce moment-là que le quota déjà épuisé se manifeste.
function video5FillerItems() {
  return Array.from({ length: 5 }, (_, i) => ({
    item: {
      id: 'video-quota-test-' + i,
      desc: 'test', createTime: Math.floor(Date.now() / 1000),
      stats: { playCount: 1000, diggCount: 100, commentCount: 10, shareCount: 5 },
      author: {}, authorStats: {}
    }
  }));
}

test('lancer : Pro ayant déjà consommé son quota du mois reçoit le message "déjà utilisé" (une fois la recherche réussie)', async () => {
  const restaurer = poserEnv();
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    quotaOk: false,
    pagesRecherche: [{ data: { data: video5FillerItems(), cursor: null, has_more: false } }]
  });
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

test('lancer : Pro sur une niche trop pointue (moins de 5 vidéos) NE consomme PAS son quota du mois', async () => {
  const restaurer = poserEnv();
  let consommeAppele = false;
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    quotaOk: true,
    pagesRecherche: [{ data: { data: [], cursor: null, has_more: false } }],
    custom(u) {
      if (u.includes('/rest/v1/rpc/consommer_usage')) consommeAppele = true;
      return null; // laisse poserFetchMock répondre normalement ensuite
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.raison, 'pas_assez_de_videos');
    assert.equal(consommeAppele, false, 'le quota ne doit JAMAIS être décompté quand la recherche ne trouve pas assez de vidéos : le Pro doit pouvoir réessayer sans avoir perdu son analyse du mois');
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
    // Retour du propriétaire : "pourquoi ça plafonne ?" doit toujours avoir
    // une réponse honnête, même quand l'échantillon est insuffisant. Ce mock
    // renvoie cursor:null (pas de page suivante identifiable) : la raison
    // la plus précise est "cursor_absent", pas une supposition sur hasMore.
    assert.equal(res.corpsRecu.pagesParcourues, 1);
    assert.equal(res.corpsRecu.raisonArret, 'cursor_absent');
  } finally { restaurer(); }
});

test('lancer : rapporte honnêtement pourquoi l\'échantillon final est plus petit que la cible (TikHub à court de résultats)', async () => {
  // Retour du propriétaire : "on avait parlé de 50 vidéos, pourquoi ça
  // plafonne à 15 ?" Ici, TikHub n'a que 12 vidéos pertinentes pour cette
  // niche (has_more=false dès la 1ère page) : l'échantillon final doit
  // rester honnêtement à 12 (pas gonflé à 50), avec la raison exposée.
  const restaurer = poserEnv();
  const items = Array.from({ length: 12 }, (_, i) => ({
    item: {
      id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000),
      stats: { playCount: (i + 1) * 1000 }, author: {}, authorStats: {}
    }
  }));
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    quotaOk: true,
    pagesRecherche: [{ data: { data: items, cursor: 12, has_more: false } }]
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'niche-etroite-test', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.total, 12, 'l\'échantillon final ne doit JAMAIS être gonflé au-delà de ce que TikHub a réellement renvoyé');
    assert.equal(res.corpsRecu.reserveTrouvee, 12);
    assert.equal(res.corpsRecu.pagesParcourues, 1);
    assert.equal(res.corpsRecu.raisonArret, 'plus_de_resultats_tikhub', 'la raison doit distinguer "TikHub à court de résultats" d\'un plafond de pages ou d\'une réserve atteinte');
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

// Audit du 2 septembre 2026 : deux appels concurrents "avancer" sur le
// même job (ex. deux onglets) traiteraient deux fois le même lot, la
// DERNIÈRE écriture écrasant silencieusement les transcriptions de
// l'autre. Le PATCH est désormais conditionné à index_suivant inchangé
// (verrou optimiste, supabaseUpdateSiInchange). Ce test simule le PATCH
// perdant (aucune ligne appliquée, scenario.patchAppliquee:false) et
// vérifie que la réponse reflète l'état RÉEL relu en base (celui du
// concurrent gagnant), jamais le résultat local qui vient d'être abandonné.
test('avancer : un PATCH concurrent perdant (verrou optimiste) fait relire l\'état réel plutôt que de l\'écraser', async () => {
  const restaurer = poserEnv();
  const cinqVideos = Array.from({ length: 5 }, (_, i) => ({
    id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000),
    auteur: { uniqueId: 'a' + i }, stats: { vues: 100, likes: 1, commentaires: 0, partages: 0 },
    hashtags: [], urlsCandidates: [], transcript: 'texte', transcriptEchec: false
  }));
  let appelsGet = 0;
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: { id: 'job-concurrent', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: cinqVideos },
    patchAppliquee: false,
    custom: async (u, opts) => {
      if (u.includes('/rest/v1/tendances_niche') && (!opts || !opts.method || opts.method === 'GET')) {
        appelsGet++;
        // 1er GET : lecture initiale normale du job (avant tout traitement).
        // 2e GET (relecture après l'échec du PATCH, notre verrou optimiste) :
        // simule l'état déjà avancé par le concurrent gagnant entre-temps.
        if (appelsGet === 1) return null; // laisse poserFetchMock répondre avec jobRow
        return {
          ok: true, json: async () => [{
            id: 'job-concurrent', statut: 'termine', niche: 'cuisine', index_suivant: 5, videos: cinqVideos,
            resultat: { niche: 'cuisine', marqueurConcurrentGagnant: true }
          }]
        };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-concurrent', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine', 'doit refléter l\'état réel (concurrent gagnant), pas le calcul local abandonné (en_cours) : ' + JSON.stringify(res.corpsRecu));
    assert.equal(res.corpsRecu.traitees, 5, 'doit refléter index_suivant réel (5), pas le nouvelIndex local abandonné (3) : ' + JSON.stringify(res.corpsRecu));
    assert.ok(res.corpsRecu.resultat && res.corpsRecu.resultat.marqueurConcurrentGagnant, 'le résultat renvoyé doit être celui du concurrent gagnant, jamais écrasé : ' + JSON.stringify(res.corpsRecu));
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

test('avancer : la synthèse finale donne à chaque créateur un lien vers SA vidéo la plus performante de l\'échantillon', async () => {
  // Retour du propriétaire : le rapport donnait le nom d'un créateur mais
  // jamais quelle vidéo précise regarder. Un créateur avec 2 vidéos, l'une
  // très faible, l'autre qui cartonne : meilleureVideo doit pointer sur la
  // seconde, pas juste la première rencontrée, et le lien TikTok doit être
  // construit à partir de son id + du uniqueId de l'auteur.
  const restaurer = poserEnv();
  const maintenant = Math.floor(Date.now() / 1000);
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-liens',
      statut: 'en_cours',
      niche: 'cuisine',
      index_suivant: 0,
      videos: [
        {
          id: 'v-faible', desc: 'Sa vidéo la plus faible', createTime: maintenant,
          auteur: { uniqueId: 'chef1', nickname: 'Chef Un' },
          stats: { vues: 1000, likes: 10, commentaires: 1, partages: 1 },
          hashtags: [], urlsCandidates: [], transcript: 'texte', transcriptEchec: false
        },
        {
          id: 'v-forte', desc: 'Sa vidéo qui cartonne', createTime: maintenant,
          auteur: { uniqueId: 'chef1', nickname: 'Chef Un' },
          stats: { vues: 500000, likes: 40000, commentaires: 2000, partages: 1500 },
          hashtags: [], urlsCandidates: [], transcript: 'texte', transcriptEchec: false
        }
      ]
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-liens', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine');
    const chef1 = (res.corpsRecu.resultat.topCreateurs || []).find(c => c.uniqueId === 'chef1');
    assert.ok(chef1, 'le créateur doit apparaître dans le classement');
    assert.equal(chef1.meilleureVideo.id, 'v-forte', 'la vidéo la plus performante doit être retenue, pas la première rencontrée');
    assert.equal(chef1.meilleureVideo.lien, 'https://www.tiktok.com/@chef1/video/v-forte');
    assert.equal(chef1.vuesCumulees, 501000);
    // Retour du propriétaire (photo de profil) : la carte doit porter aussi
    // les stats détaillées de la vidéo phare (likes/commentaires/partages),
    // pas seulement les vues, pour le bandeau de stats compact.
    assert.equal(chef1.meilleureVideo.likes, 40000);
    assert.equal(chef1.meilleureVideo.commentaires, 2000);
    assert.equal(chef1.meilleureVideo.partages, 1500);
  } finally { restaurer(); }
});

// Audit du 2 septembre 2026 : quand la synthèse QUALITATIVE échoue (ex.
// Anthropic renvoie une réponse vide/invalide), synthetiser() dégrade
// proprement le résultat (registre/durée/patterns absents, les chiffres
// déterministes restent) — un comportement voulu, à garder. Mais cette
// panne n'était journalisée NULLE PART, ni logs serveur ni trace admin :
// invisible même si elle devenait fréquente (clé Anthropic expirée...).
// Vérifie qu'un log serveur identifiable apparaît désormais.
test('avancer : un échec de la synthèse qualitative (Anthropic) est journalisé, même si le rapport se termine quand même', async () => {
  const restaurer = poserEnv();
  const maintenant = Math.floor(Date.now() / 1000);
  const logsErreur = [];
  const consoleErrorOriginal = console.error;
  console.error = (...args) => { logsErreur.push(args.join(' ')); };
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-synthese-qualitative-echec',
      statut: 'en_cours',
      niche: 'cuisine',
      index_suivant: 0,
      // Au moins 3 vidéos avec transcript : sous ce seuil, synthetiser()
      // n'appelle même pas l'IA (voir avecTranscript.length >= 3), ce qui
      // ne teste rien de ce correctif.
      videos: Array.from({ length: 3 }, (_, i) => ({
        id: 'v' + i, desc: 'test', createTime: maintenant,
        auteur: { uniqueId: 'chef' + i }, stats: { vues: 1000, likes: 10, commentaires: 1, partages: 1 },
        hashtags: [], urlsCandidates: [], transcript: 'Un vrai transcript de test suffisamment long.', transcriptEchec: false
      }))
    },
    custom: async (u) => {
      if (u.includes('api.anthropic.com')) {
        // Réponse sans contenu exploitable : appelClaudeDirect lève
        // "Réponse IA vide ou invalide".
        return { ok: true, json: async () => ({ content: [] }) };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-synthese-qualitative-echec', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine', 'le rapport doit rester utilisable malgré la panne IA (chiffres déterministes intacts)');
    assert.equal(res.corpsRecu.resultat.registre, undefined, 'sans IA fonctionnelle, la section qualitative reste absente (comportement existant, inchangé)');
    assert.ok(logsErreur.some(l => l.includes('tendances') && l.includes('cuisine')), 'la panne de synthèse qualitative doit désormais être journalisée : ' + JSON.stringify(logsErreur));
  } finally { console.error = consoleErrorOriginal; restaurer(); }
});

test('lancer : capture la photo de profil de l\'auteur (avatarLarger) depuis l\'item de recherche', async () => {
  // Retour du propriétaire : une vraie photo de profil plutôt qu'une
  // initiale seule. TikHub porte l'avatar sous author.avatarLarger.urlList
  // (même forme que les autres champs media, voir urlsVideo).
  const restaurer = poserEnv();
  const items = [
    {
      item: {
        id: 'v-avec-avatar', desc: 'test', createTime: Math.floor(Date.now() / 1000),
        stats: { playCount: 50000, diggCount: 2000, commentCount: 50, shareCount: 30 },
        author: { uniqueId: 'chef.photo', nickname: 'Chef Photo', avatarLarger: { urlList: ['https://p16-sign.tiktokcdn.com/avatar-chef.jpeg'] } },
        authorStats: { followerCount: 15000 }
      }
    },
    // Reserve minimale de 5 vidéos exigée par lancer() (voir reserve.size <
    // 5 => "pas_assez_de_videos") : ces vidéos de remplissage n'ont pas
    // d'avatar, seule la première est vérifiée ci-dessous.
    ...Array.from({ length: 4 }, (_, i) => ({
      item: {
        id: 'filler' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000),
        stats: { playCount: 100, diggCount: 1, commentCount: 0, shareCount: 0 },
        author: {}, authorStats: {}
      }
    }))
  ];
  let corpsInsere = null;
  poserFetchMock({
    pagesRecherche: [{ data: { data: items, cursor: 1, has_more: false } }],
    custom: async (u, opts) => {
      if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'POST') {
        corpsInsere = JSON.parse(opts.body);
        return { ok: true, json: async () => [{ id: 'job-avatar-recherche' }] };
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
    assert.ok(corpsInsere, 'la ligne Supabase aurait dû être créée');
    assert.equal(corpsInsere.videos[0].auteur.avatarUrl, 'https://p16-sign.tiktokcdn.com/avatar-chef.jpeg');
  } finally { restaurer(); }
});

test('avancer : complète la photo de profil manquante via le détail du post, et la propage au créateur', async () => {
  // Même repli que pour le uniqueId (retour du propriétaire) : l'item de
  // recherche ne porte pas toujours la photo, le détail du post si.
  const restaurer = poserEnv({ ELEVENLABS_API_KEY: 'cle-eleven-test' });
  const maintenant = Math.floor(Date.now() / 1000);
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-avatar-manquant',
      statut: 'en_cours',
      niche: 'cuisine',
      index_suivant: 0,
      videos: [{
        id: 'v-sans-avatar', desc: 'Une astuce', createTime: maintenant,
        auteur: { uniqueId: 'chef.sans.photo', nickname: 'Chef Sans Photo', avatarUrl: null },
        stats: { vues: 200000, likes: 10000, commentaires: 300, partages: 200 },
        hashtags: [], urlsCandidates: [], transcript: null, transcriptEchec: false
      }]
    },
    custom: async (u, opts) => {
      if (u.includes('fetch_post_detail')) {
        return {
          ok: true, json: async () => ({
            item: {
              video: { playAddr: 'https://cdn-fraiche.example/frais.mp4' },
              author: { uniqueId: 'chef.sans.photo', nickname: 'Chef Sans Photo', avatarLarger: { urlList: ['https://p16-sign.tiktokcdn.com/avatar-complete.jpeg'] } }
            }
          })
        };
      }
      if (u.includes('cdn-fraiche.example')) {
        return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : '') }, arrayBuffer: async () => Buffer.alloc(60000).buffer };
      }
      if (u.includes('elevenlabs.io')) {
        return { ok: true, text: async () => JSON.stringify({ text: 'Une astuce pratique pour la cuisine de tous les jours.' }) };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-avatar-manquant', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine');
    const createur = (res.corpsRecu.resultat.topCreateurs || [])[0];
    assert.ok(createur, 'le créateur doit apparaître dans le classement');
    assert.equal(createur.avatarUrl, 'https://p16-sign.tiktokcdn.com/avatar-complete.jpeg', 'la photo complétée via fetch_post_detail doit être propagée au créateur');
  } finally { restaurer(); }
});

test('avancer : complète le uniqueId manquant de l\'auteur via le détail du post, pour que le lien vidéo existe quand même', async () => {
  // Retour du propriétaire : sur des niches aux correspondances plus rares
  // ("finance", "actualité"), les cartes créateurs n'avaient AUCUN lien
  // "voir cette vidéo". Cause probable : fetch_general_search ne renvoie
  // pas toujours le uniqueId de l'auteur dans l'item de recherche (surtout
  // pour des résultats moins pertinents). Le détail complet du post
  // (fetch_post_detail), déjà appelé pour rafraîchir l'URL de téléchargement,
  // le contient : on le réutilise pour compléter v.auteur.uniqueId avant la
  // synthèse finale, sans appel TikHub supplémentaire.
  const restaurer = poserEnv({ ELEVENLABS_API_KEY: 'cle-eleven-test' });
  const maintenant = Math.floor(Date.now() / 1000);
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-uniqueid-manquant',
      statut: 'en_cours',
      niche: 'finance',
      index_suivant: 0,
      videos: [{
        id: 'v-sans-uniqueid', desc: 'Une astuce pour épargner.', createTime: maintenant,
        auteur: { id: 'auteur-numerique-123', uniqueId: null, nickname: 'Conseils Finance' },
        stats: { vues: 300000, likes: 20000, commentaires: 500, partages: 400 },
        hashtags: [], urlsCandidates: [], transcript: null, transcriptEchec: false
      }]
    },
    custom: async (u, opts) => {
      if (u.includes('fetch_post_detail')) {
        return {
          ok: true, json: async () => ({
            item: {
              video: { playAddr: 'https://cdn-fraiche.example/frais.mp4' },
              author: { uniqueId: 'conseils.finance.reel', nickname: 'Conseils Finance' }
            }
          })
        };
      }
      if (u.includes('cdn-fraiche.example')) {
        return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : '') }, arrayBuffer: async () => Buffer.alloc(60000).buffer };
      }
      if (u.includes('elevenlabs.io')) {
        return { ok: true, text: async () => JSON.stringify({ text: 'Voici comment épargner efficacement chaque mois.' }) };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-uniqueid-manquant', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine');
    const createur = (res.corpsRecu.resultat.topCreateurs || [])[0];
    assert.ok(createur, 'le créateur doit apparaître dans le classement même sans uniqueId au départ');
    assert.equal(createur.meilleureVideo.lien, 'https://www.tiktok.com/@conseils.finance.reel/video/v-sans-uniqueid', 'le uniqueId complété via fetch_post_detail doit servir à construire le lien');
  } finally { restaurer(); }
});

test('avancer : même sans AUCUN handle trouvable (ni recherche, ni détail du post), le lien vidéo existe quand même (repli sur l\'ID)', async () => {
  // Retour du propriétaire (2e passe) : toujours aucun lien affiché, y
  // compris après le correctif de complétion via fetch_post_detail. Constat
  // en prod : pour certaines niches (finance, actualité...), NI l'item de
  // recherche NI le détail du post ne portent de uniqueId exploitable.
  // Le lien doit rester utilisable : TikTok route une page /@x/video/{id}
  // sur l'ID de la vidéo, pas sur le handle, donc un handle générique en
  // repli donne un lien fonctionnel plutôt qu'aucun lien du tout.
  const restaurer = poserEnv({ ELEVENLABS_API_KEY: 'cle-eleven-test' });
  const maintenant = Math.floor(Date.now() / 1000);
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-sans-handle-du-tout',
      statut: 'en_cours',
      niche: 'finance',
      index_suivant: 0,
      videos: [{
        id: 'v-sans-handle-nulle-part', desc: 'Placer son argent intelligemment.', createTime: maintenant,
        auteur: { id: 'auteur-numerique-999', uniqueId: null, nickname: 'Page Finance' },
        stats: { vues: 150000, likes: 9000, commentaires: 200, partages: 150 },
        hashtags: [], urlsCandidates: [], transcript: null, transcriptEchec: false
      }]
    },
    custom: async (u, opts) => {
      if (u.includes('fetch_post_detail')) {
        // Détail renvoyé mais SANS uniqueId nulle part (cas réel constaté) :
        // extraireAuteurUsername doit renvoyer null, pas planter.
        return { ok: true, json: async () => ({ item: { video: { playAddr: 'https://cdn-fraiche.example/frais.mp4' }, author: { id: 'auteur-numerique-999', nickname: 'Page Finance' } } }) };
      }
      if (u.includes('cdn-fraiche.example')) {
        return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : '') }, arrayBuffer: async () => Buffer.alloc(60000).buffer };
      }
      if (u.includes('elevenlabs.io')) {
        return { ok: true, text: async () => JSON.stringify({ text: 'Placer son argent intelligemment chaque mois.' }) };
      }
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-sans-handle-du-tout', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine');
    const createur = (res.corpsRecu.resultat.topCreateurs || [])[0];
    assert.ok(createur, 'le créateur doit apparaître même sans handle (clé = auteur.id)');
    assert.equal(createur.meilleureVideo.lien, 'https://www.tiktok.com/@video/video/v-sans-handle-nulle-part', 'un lien fonctionnel (repli sur l\'ID) doit exister même sans aucun handle trouvable');
    assert.equal(res.corpsRecu.resultat.videosSansHandle, 1);
    assert.equal(res.corpsRecu.resultat.videosAvecHandle, 0);
  } finally { restaurer(); }
});

test('lancer : la zone géographique est ajoutée au mot-clé envoyé à TikHub, la niche seule reste stockée', async () => {
  // Retour du propriétaire : "ajouter la zone géographique... et surtout il
  // faut que l'app prenne cela en compte dans la recherche des tendances".
  // TikHub n'a aucun vrai filtre pays/région (voir motRechercheAvecZone) :
  // le seul levier honnête est de l'ajouter au mot-clé de recherche.
  const restaurer = poserEnv();
  const items = Array.from({ length: 5 }, (_, i) => ({
    item: { id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000 }, author: {}, authorStats: {} }
  }));
  let motsRecherches = [];
  let corpsInsere = null;
  poserFetchMock({
    custom: async (u, opts) => {
      if (u.includes('fetch_general_search')) {
        const url = new URL(u);
        motsRecherches.push(url.searchParams.get('keyword'));
      }
      if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'POST') {
        corpsInsere = JSON.parse(opts.body);
        return { ok: true, json: async () => [{ id: 'job-zone-test' }] };
      }
      return null;
    },
    pagesRecherche: [{ data: { data: items, cursor: 5, has_more: false } }]
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'lancer', niche: 'cuisine', zone: "Côte d'Ivoire", code_acces: ENV_BASE.CODE_ADMIN, test: true } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.ok(motsRecherches.some(m => m === "cuisine Côte d'Ivoire"), 'le mot-clé envoyé à TikHub doit combiner niche + zone : ' + JSON.stringify(motsRecherches));
    assert.ok(corpsInsere, 'la ligne Supabase aurait dû être créée');
    assert.equal(corpsInsere.niche, 'cuisine', 'la niche stockée doit rester "propre", sans la zone mélangée dedans');
    assert.equal(corpsInsere.zone, "Côte d'Ivoire");
  } finally { restaurer(); }
});

test('lancer : "monde entier" (et équivalents) n\'est JAMAIS ajouté au mot-clé de recherche', async () => {
  // Retour du propriétaire : "monde entier" doit vouloir dire aucun filtre,
  // pas un "&"-like littéral qui abîmerait la pertinence de la recherche
  // (même piège déjà corrigé pour les niches de la liste déroulante).
  const restaurer = poserEnv();
  const items = Array.from({ length: 5 }, (_, i) => ({
    item: { id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000 }, author: {}, authorStats: {} }
  }));
  let motsRecherches = [];
  poserFetchMock({
    custom: async (u) => {
      if (u.includes('fetch_general_search')) {
        motsRecherches.push(new URL(u).searchParams.get('keyword'));
      }
      return null;
    },
    pagesRecherche: [{ data: { data: items, cursor: 5, has_more: false } }]
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    // "histoire" plutôt que "cuisine" : aucun synonyme mappé (voir
    // SYNONYMES_NICHE, api/tendances.js), pour tester la gestion de la zone
    // isolément, sans la recherche multi-mots-clés (couverte par d'autres
    // tests dédiés).
    const req = { method: 'POST', body: { action: 'lancer', niche: 'histoire', zone: 'Monde entier', code_acces: ENV_BASE.CODE_ADMIN, test: true } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.ok(motsRecherches.every(m => m === 'histoire'), '"monde entier" ne doit jamais apparaître dans le mot-clé : ' + JSON.stringify(motsRecherches));
  } finally { restaurer(); }
});

test('avancer : la zone géographique du job est transmise à la synthèse finale et ressort dans le résultat', async () => {
  const restaurer = poserEnv({ ELEVENLABS_API_KEY: 'cle-eleven-test' });
  const maintenant = Math.floor(Date.now() / 1000);
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    jobRow: {
      id: 'job-avec-zone',
      statut: 'en_cours',
      niche: 'cuisine',
      zone: 'Afrique',
      index_suivant: 0,
      videos: [{
        id: 'v1', desc: 'Une recette locale.', createTime: maintenant,
        auteur: { uniqueId: 'chef.afrique', nickname: 'Chef Afrique' },
        stats: { vues: 80000, likes: 6000, commentaires: 100, partages: 50 },
        hashtags: [], urlsCandidates: [], transcript: null, transcriptEchec: false
      }]
    },
    custom: async (u) => {
      if (u.includes('fetch_post_detail')) return { ok: true, json: async () => null };
      if (u.includes('elevenlabs.io')) return { ok: true, text: async () => JSON.stringify({ text: 'Une recette locale expliquée en détail.' }) };
      return null;
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'POST', body: { action: 'avancer', id: 'job-avec-zone', code_acces: 'CODE-PRO' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine');
    assert.equal(res.corpsRecu.resultat.zone, 'Afrique', 'la zone doit ressortir dans le résultat final, pour l\'affichage côté client');
  } finally { restaurer(); }
});

test('GET debug avec zone : le mot-clé combiné est utilisé pour la sonde ET le diagnostic de réserve', async () => {
  const restaurer = poserEnv();
  const items = Array.from({ length: 3 }, (_, i) => ({
    item: { id: 'v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000 }, author: {}, authorStats: {} }
  }));
  let motsRecherches = [];
  poserFetchMock({
    custom: async (u) => {
      if (u.includes('fetch_general_search')) motsRecherches.push(new URL(u).searchParams.get('keyword'));
      return null;
    },
    pagesRecherche: [
      { data: { data: items, cursor: 3, has_more: false } },
      { data: { data: items, cursor: 3, has_more: false } }
    ]
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    // "histoire" : aucun synonyme mappé (voir SYNONYMES_NICHE), pour isoler
    // la combinaison zone+mot-clé de la recherche multi-mots-clés (testée à
    // part).
    const req = { method: 'GET', query: { mot: 'histoire', zone: 'Europe', debug: '1', code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu._debug.motRecherche, 'histoire Europe');
    assert.ok(motsRecherches.every(m => m === 'histoire Europe'), 'tous les appels recherche de la sonde doivent utiliser le mot-clé combiné : ' + JSON.stringify(motsRecherches));
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
    // Retour du propriétaire : la sonde doit aussi dire pourquoi l'échantillon
    // plafonne (rejoue la vraie phase de recherche de lancer(), sans job ni
    // coût de téléchargement/transcription).
    const r = res.corpsRecu._debug.reserve;
    assert.ok(r, 'le diagnostic de réserve doit être présent');
    assert.equal(typeof r.trouvees, 'number');
    assert.equal(typeof r.pagesParcourues, 'number');
    assert.ok(['reserve_cible_atteinte', 'plus_de_resultats_tikhub', 'plafond_pages_atteint', 'recherche_tikhub_echouee', 'cursor_absent', 'stagnation_doublons'].includes(r.raisonArret));
  } finally { restaurer(); }
});

test('GET debug : arrêt anticipé si 3 pages d\'affilée n\'apportent AUCUNE vidéo nouvelle (retour propriétaire : 89% de doublons observés sur "cuisine", pas la peine de payer les pages suivantes)', async () => {
  // Constat réel en prod : sur 20 pages payées, 231 des ~258 vidéos brutes
  // étaient des doublons de pages précédentes. Ici, 1 page utile (5 vidéos
  // neuves) suivie de 3 pages qui reboublent exactement les mêmes 5 : la
  // recherche doit s'arrêter à la 4e page (page utile + 3 stagnantes),
  // JAMAIS continuer jusqu'au plafond de 20 pages pour un résultat déjà
  // acquis.
  const restaurer = poserEnv();
  const cinqVideos = Array.from({ length: 5 }, (_, i) => ({
    item: { id: 'stagn-v' + i, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000 }, author: {}, authorStats: {} }
  }));
  // La sonde GET ?debug=1 lance EN PARALLÈLE construireReserve() (pagination
  // par curseur, ce qu'on teste ici) ET testerCandidat() ×2 (sondes fixes
  // sans curseur, pour comparer sort_type) : les deux tapent
  // fetch_general_search, donc un simple tableau consommé au fil de l'eau
  // (pagesRecherche) mélangerait les deux et fausserait ce test. On
  // distingue par la présence du paramètre cursor (toujours envoyé par
  // rechercherVideos, jamais par testerCandidat) et on répond selon SA
  // VALEUR, indépendamment de l'ordre d'arrivée concurrent.
  poserFetchMock({
    custom: async (u) => {
      if (!u.includes('cursor=')) return { ok: true, json: async () => ({ data: { data: [], cursor: 0, has_more: false } }) };
      const cursor = new URL(u).searchParams.get('cursor');
      const parPage = {
        '0': { data: { data: cinqVideos, cursor: 1, has_more: true } },   // page 1 : 5 nouvelles
        '1': { data: { data: cinqVideos, cursor: 2, has_more: true } },   // page 2 : 0 nouvelle (stagnation 1)
        '2': { data: { data: cinqVideos, cursor: 3, has_more: true } },   // page 3 : 0 nouvelle (stagnation 2)
        '3': { data: { data: cinqVideos, cursor: 4, has_more: true } }    // page 4 : 0 nouvelle (stagnation 3) => arrêt ici
      };
      const page = parPage[cursor];
      return { ok: true, json: async () => (page || { data: { data: [], cursor: null, has_more: false } }) };
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'GET', query: { mot: 'niche-stagnante-test', debug: '1', code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    const r = res.corpsRecu._debug.reserve;
    assert.equal(r.raisonArret, 'stagnation_doublons', 'doit reconnaître la stagnation, pas attendre le plafond de 20 pages : ' + JSON.stringify(r));
    assert.equal(r.pagesParcourues, 4, 'doit s\'arrêter juste après la 3e page stagnante d\'affilée, pas continuer : ' + JSON.stringify(r));
    assert.equal(r.trouvees, 5, 'les 5 vidéos trouvées à la 1ère page restent dans l\'échantillon (l\'arrêt anticipé ne perd rien) : ' + JSON.stringify(r));
    assert.equal(r.doublons, 15, '3 pages de 5 doublons chacune : ' + JSON.stringify(r));
  } finally { restaurer(); }
});

test('GET debug : une niche avec synonyme mappé ("finance") cherche aussi le 2e mot-clé ("argent"), sans compter deux fois une vidéo trouvée par les deux', async () => {
  // Retour propriétaire, "refaire le code sur les 50" : Tendances n'a
  // qu'1 analyse/mois en Pro, mieux vaut chercher un 2e mot-clé apparenté
  // (voir SYNONYMES_NICHE) que plafonner l'échantillon sur un seul terme.
  // "finance" (menu déroulant "Finance & Argent") doit donc aussi chercher
  // "argent", et une vidéo qui ressort dans les deux recherches ne doit
  // jamais être comptée deux fois dans l'échantillon final.
  const restaurer = poserEnv();
  const video = (id) => ({ item: { id, desc: 'test', createTime: Math.floor(Date.now() / 1000), stats: { playCount: 1000 }, author: {}, authorStats: {} } });
  const partagee = video('fin-v0'); // même id que la 1ère vidéo de "finance", retrouvée aussi via "argent"

  poserFetchMock({
    custom: async (u) => {
      if (!u.includes('cursor=')) return { ok: true, json: async () => ({ data: { data: [], cursor: 0, has_more: false } }) }; // sondes testerCandidat (sort_type), hors sujet ici
      const params = new URL(u).searchParams;
      const keyword = params.get('keyword');
      const cursor = params.get('cursor');
      if (keyword === 'finance' && cursor === '0') {
        return { ok: true, json: async () => ({ data: { data: [video('fin-v0'), video('fin-v1'), video('fin-v2')], cursor: 1, has_more: false } }) };
      }
      if (keyword === 'argent' && cursor === '0') {
        return { ok: true, json: async () => ({ data: { data: [partagee, video('arg-v1'), video('arg-v2')], cursor: 1, has_more: false } }) };
      }
      return { ok: true, json: async () => ({ data: { data: [], cursor: null, has_more: false } }) };
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const req = { method: 'GET', query: { mot: 'finance', debug: '1', code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    const r = res.corpsRecu._debug.reserve;
    assert.equal(r.trouvees, 5, '3 vidéos de "finance" + 3 de "argent" - 1 doublon partagé = 5 : ' + JSON.stringify(r));
    assert.equal(r.doublons, 1, 'la vidéo trouvée par les deux mots-clés compte comme UN SEUL doublon, jamais deux vidéos : ' + JSON.stringify(r));
    assert.equal(r.pagesParcourues, 2, '1 page par mot-clé (chacun a has_more:false dès la 1ère page) : ' + JSON.stringify(r));
    assert.ok(Array.isArray(r.variantes) && r.variantes.length === 2, 'le détail doit lister les deux mots-clés cherchés : ' + JSON.stringify(r));
    assert.equal(r.variantes[0].mot, 'finance');
    assert.equal(r.variantes[1].mot, 'argent');
  } finally { restaurer(); }
});

test('GET debug : une niche SANS synonyme mappé ne cherche qu\'un seul mot-clé, comportement inchangé', async () => {
  const restaurer = poserEnv();
  let appelsAvecCursor = 0;
  poserFetchMock({
    custom: async (u) => {
      if (!u.includes('cursor=')) return { ok: true, json: async () => ({ data: { data: [], cursor: 0, has_more: false } }) };
      appelsAvecCursor++;
      return { ok: true, json: async () => ({ data: { data: [], cursor: null, has_more: false } }) };
    }
  });
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    // "histoire" : aucune entrée dans SYNONYMES_NICHE.
    const req = { method: 'GET', query: { mot: 'histoire', debug: '1', code_acces: ENV_BASE.CODE_ADMIN } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    const r = res.corpsRecu._debug.reserve;
    assert.equal(r.variantes.length, 1, 'une seule variante attendue pour une niche sans synonyme mappé : ' + JSON.stringify(r));
    assert.equal(r.variantes[0].mot, 'histoire');
    assert.equal(appelsAvecCursor, 1, 'un seul appel de pagination réelle attendu (hors sondes sort_type) : ' + appelsAvecCursor);
  } finally { restaurer(); }
});

// LOT 4A, AUDIT ID 1 (Gate Phase 2) — action=avancer (api/tendances.js).
//
// Avant ce correctif : `avancer` ne vérifiait ni que `code_acces` correspond
// au `job.code_acces`, ni aucun rate-limit, ni aucune protection contre deux
// requêtes concurrentes traitant le même lot en double (le verrou existant,
// `supabaseUpdateSiInchange`, ne protège que l'ÉCRITURE finale, APRÈS que le
// travail payant - téléchargement TikHub + transcription ElevenLabs - a déjà
// été fait). Correctif : vérification de propriété, filet journalier
// générique réutilisé (A13, `verifierLimiteGenerique`), et surtout un verrou
// ATOMIQUE côté Postgres (`verrou_expire_le`, voir
// supabase/tendances_niche_verrou.sql) acquis AVANT tout appel payant.
//
// Ce fichier teste le handler directement (comme tests/tendances-lancer.test.js),
// en mockant global.fetch. Les tests de concurrence (5) lancent réellement
// deux appels à `avancer` SANS attendre le premier avant de démarrer le
// second (Promise.all), pas deux appels séquentiels : le mock simule
// l'atomicité réelle de Postgres (check-and-set synchrone, JS étant
// mono-thread par tick).
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  TIKHUB_API_KEY: 'cle-tikhub-test',
  ELEVENLABS_API_KEY: 'cle-eleven-test',
  CODE_ADMIN: 'ADMIN-TEST'
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

function video(id) {
  return {
    id, desc: 'test', createTime: Math.floor(Date.now() / 1000),
    auteur: { uniqueId: 'auteur-' + id }, stats: { vues: 1000, likes: 10, commentaires: 1, partages: 1 },
    hashtags: [], urlsCandidates: ['https://cdn.example/' + id + '.mp4'],
    transcript: null, transcriptEchec: false
  };
}

// Simule une base Supabase EN MÉMOIRE, avec un vrai état partagé mutable
// pour `verrou_expire_le` (le point exact que ce correctif protège) :
// un état JS partagé entre "deux requêtes" reproduit fidèlement l'atomicité
// Postgres réelle, tant que le check-and-set reste synchrone (jamais
// d'`await` entre la lecture et l'écriture de `verrou_expire_le` ci-dessous).
function creerBaseMemoire(jobs) {
  const base = new Map(jobs.map(j => [j.id, { ...j, videos: j.videos.map(v => ({ ...v })) }]));
  let compteurTikHub = 0, compteurEleven = 0;
  const appelsExternes = { tikhub: () => compteurTikHub, eleven: () => compteurEleven };

  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => [{ actif: true, plan: 'pro', jetons_audit: 0 }] };
    }
    if (u.includes('/rest/v1/tendances_niche') && opts && opts.method === 'PATCH') {
      const idMatch = /id=eq\.([^&]+)/.exec(u);
      const id = idMatch && decodeURIComponent(idMatch[1]);
      const job = base.get(id);
      if (!job) return { ok: true, json: async () => [] };
      const patch = JSON.parse(opts.body);
      if (!u.includes('index_suivant=eq.')) {
        // PATCH d'ACQUISITION du verrou (ou de sa libération, qui ne relit
        // jamais le résultat). Check-and-set SYNCHRONE : reproduit
        // l'atomicité réelle d'une seule transaction Postgres.
        const maintenant = Date.now();
        const verrouOccupe = job.verrou_expire_le && new Date(job.verrou_expire_le).getTime() > maintenant;
        if (verrouOccupe && patch.verrou_expire_le) {
          return { ok: true, json: async () => [] }; // verrou déjà pris : PAS acquis
        }
        job.verrou_expire_le = patch.verrou_expire_le;
        return { ok: true, json: async () => [{ id }] };
      }
      // PATCH de l'écriture finale (verrou optimiste historique, condition
      // sur index_suivant) : comportement inchangé.
      const debutAttendu = Number(/index_suivant=eq\.(\d+)/.exec(u)[1]);
      if (job.index_suivant !== debutAttendu) return { ok: true, json: async () => [] };
      Object.assign(job, patch);
      return { ok: true, json: async () => [{ id }] };
    }
    if (u.includes('/rest/v1/tendances_niche') && (!opts || !opts.method || opts.method === 'GET')) {
      const idMatch = /id=eq\.([^&]+)/.exec(u);
      const id = idMatch && decodeURIComponent(idMatch[1]);
      const job = base.get(id);
      return { ok: true, json: async () => (job ? [{ ...job }] : []) };
    }
    if (u.includes('fetch_post_detail')) {
      compteurTikHub++;
      return { ok: true, json: async () => ({ item: { video: { playAddr: 'https://cdn-fraiche.example/frais.mp4' } } }) };
    }
    if (u.includes('cdn.example') || u.includes('cdn-fraiche.example')) {
      // >= MIN_VIDEO (50 Ko, api/_lib/tiktok-media.js) : sous ce seuil,
      // telechargerMedia rejette le "média" comme trop petit avant même
      // d'atteindre ElevenLabs, ce qui aurait rendu ce test faussement vert.
      return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'video/mp4' : '') }, arrayBuffer: async () => Buffer.alloc(60000).buffer };
    }
    if (u.includes('elevenlabs.io')) {
      compteurEleven++;
      return { ok: true, text: async () => JSON.stringify({ text: 'Un transcript de test suffisamment long pour compter.' }) };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      return { ok: true, json: async () => true };
    }
    if (u.includes('/rest/v1/erreurs_generation')) {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };
  return { base, appelsExternes };
}

test('1. job valide + propriétaire valide => succès', async () => {
  const restaurer = poserEnv();
  creerBaseMemoire([{ id: 'j1', code_acces: 'CODE-PRO', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('v1')] }]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j1', code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.statut, 'termine');
  } finally { restaurer(); }
});

test('2. mauvais code => refus, jamais d\'appel externe', async () => {
  const restaurer = poserEnv();
  const { appelsExternes } = creerBaseMemoire([{ id: 'j2', code_acces: 'CODE-PRO', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('v1')] }]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j2', code_acces: 'CODE-AUTRE-CREATEUR' } }, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
    assert.equal(appelsExternes.tikhub(), 0, 'aucun appel TikHub ne doit avoir lieu pour un code qui n\'est pas le propriétaire');
    assert.equal(appelsExternes.eleven(), 0);
  } finally { restaurer(); }
});

test('3. job inexistant => refus (404)', async () => {
  const restaurer = poserEnv();
  creerBaseMemoire([]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'introuvable', code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 404);
  } finally { restaurer(); }
});

test('4. requêtes répétées au-delà du plafond journalier => rate-limit', async () => {
  const restaurer = poserEnv();
  // Job déjà terminé pour ne consommer aucun appel externe réel pendant le
  // test : seul le comportement du filet journalier est vérifié ici.
  const { base } = creerBaseMemoire([{ id: 'j4', code_acces: 'CODE-PRO', statut: 'termine', niche: 'cuisine', index_suivant: 3, videos: [video('v1')], resultat: { niche: 'cuisine' } }]);
  // Simule un plafond déjà atteint : la RPC consommer_usage renvoie false
  // pour la clé du filet 'tendances-avancer' dès le prochain appel.
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      const p = JSON.parse(opts.body);
      return { ok: true, json: async () => !p.p_ref.includes('tendances-avancer') };
    }
    return fetchOriginal(url, opts);
  };
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j4', code_acces: 'CODE-PRO' } }, res);
    // Job déjà 'termine' : le filet ne s'applique qu'aux jobs 'en_cours'
    // (voir avancer()), donc ce cas précis reste 200 - reproduit ci-dessous
    // avec un job réellement en_cours pour vérifier le vrai refus.
    assert.equal(res.statutRecu, 200);
    base.set('j5', { id: 'j5', code_acces: 'CODE-PRO', statut: 'en_cours', index_suivant: 0, niche: 'cuisine', videos: [video('v1')] });
    const res2 = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j5', code_acces: 'CODE-PRO' } }, res2);
    assert.equal(res2.statutRecu, 403);
    assert.equal(res2.corpsRecu.error.code, 'QUOTA_ATTEINT');
  } finally { global.fetch = fetchOriginal; restaurer(); }
});

test('5. deux requêtes VRAIMENT simultanées => un seul traitement externe', async () => {
  const restaurer = poserEnv();
  const { base, appelsExternes } = creerBaseMemoire([
    { id: 'j6', code_acces: 'CODE-PRO', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('v1'), video('v2'), video('v3')] }
  ]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res1 = creerRes(), res2 = creerRes();
    // Promise.all, PAS deux appels séquentiels : les deux handlers démarrent
    // avant que l'un ou l'autre n'ait terminé son premier `await`.
    await Promise.all([
      handler({ method: 'POST', body: { action: 'avancer', id: 'j6', code_acces: 'CODE-PRO' } }, res1),
      handler({ method: 'POST', body: { action: 'avancer', id: 'j6', code_acces: 'CODE-PRO' } }, res2)
    ]);
    // Un seul des deux a dû réellement transcrire (3 vidéos => 3 appels
    // ElevenLabs), l'autre doit avoir vu le verrou déjà pris.
    assert.equal(appelsExternes.eleven(), 3, 'un seul traitement du lot doit avoir appelé ElevenLabs, jamais 6 (2x3) : ' + appelsExternes.eleven());
    const dejaEnCours = [res1, res2].filter(r => r.corpsRecu && r.corpsRecu.dejaEnCours);
    assert.equal(dejaEnCours.length, 1, 'exactement une des deux réponses doit signaler "déjà en cours" : ' + JSON.stringify([res1.corpsRecu, res2.corpsRecu]));
    assert.equal(base.get('j6').verrou_expire_le, null, 'le verrou doit être libéré après le traitement');
  } finally { restaurer(); }
});

test('6. erreur pendant TikHub => le verrou est libéré (un appel suivant peut retraiter)', async () => {
  const restaurer = poserEnv();
  const { base } = creerBaseMemoire([{ id: 'j7', code_acces: 'CODE-PRO', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('v1')] }]);
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('fetch_post_detail')) return { ok: false, status: 500, json: async () => ({}) };
    if (u.includes('cdn.example')) return { ok: false, status: 403, headers: { get: () => '' } };
    return fetchOriginal(url, opts);
  };
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j7', code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200, 'une panne TikHub dégrade proprement (transcriptEchec), ne casse jamais la requête');
    assert.equal(base.get('j7').verrou_expire_le, null, 'le verrou doit être libéré même après un échec TikHub');
  } finally { global.fetch = fetchOriginal; restaurer(); }
});

test('7. erreur pendant ElevenLabs => le verrou est libéré', async () => {
  const restaurer = poserEnv();
  const { base } = creerBaseMemoire([{ id: 'j8', code_acces: 'CODE-PRO', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('v1')] }]);
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('elevenlabs.io')) return { ok: false, text: async () => JSON.stringify({ detail: 'panne' }) };
    return fetchOriginal(url, opts);
  };
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j8', code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(base.get('j8').verrou_expire_le, null, 'le verrou doit être libéré même après un échec ElevenLabs');
  } finally { global.fetch = fetchOriginal; restaurer(); }
});

test('8. verrou expiré (simule un crash/timeout précédent) => récupérable par un nouvel appel', async () => {
  const restaurer = poserEnv();
  const { base } = creerBaseMemoire([{
    id: 'j9', code_acces: 'CODE-PRO', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('v1')],
    // Verrou déjà EXPIRÉ (dans le passé) : simule un crash pendant un appel
    // précédent qui n'a jamais atteint son `finally` de libération.
    verrou_expire_le: new Date(Date.now() - 60000).toISOString()
  }]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j9', code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.ok(!res.corpsRecu.dejaEnCours, 'un verrou EXPIRÉ doit pouvoir être ré-acquis, pas bloquer indéfiniment : ' + JSON.stringify(res.corpsRecu));
    assert.equal(res.corpsRecu.statut, 'termine');
  } finally { restaurer(); }
});

test('9. résultat déjà traité (statut=termine) => aucun nouvel appel externe', async () => {
  const restaurer = poserEnv();
  const { appelsExternes } = creerBaseMemoire([{
    id: 'j10', code_acces: 'CODE-PRO', statut: 'termine', niche: 'cuisine', index_suivant: 1, videos: [video('v1')],
    resultat: { niche: 'cuisine', dejaLa: true }
  }]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { action: 'avancer', id: 'j10', code_acces: 'CODE-PRO' } }, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.statut, 'termine');
    assert.ok(res.corpsRecu.resultat.dejaLa);
    assert.equal(appelsExternes.tikhub(), 0);
    assert.equal(appelsExternes.eleven(), 0);
  } finally { restaurer(); }
});

test('10. plusieurs jobs légitimes distincts => fonctionnement indépendant', async () => {
  const restaurer = poserEnv();
  creerBaseMemoire([
    { id: 'ja', code_acces: 'CODE-PRO-A', statut: 'en_cours', niche: 'cuisine', index_suivant: 0, videos: [video('va')] },
    { id: 'jb', code_acces: 'CODE-PRO-B', statut: 'en_cours', niche: 'finance', index_suivant: 0, videos: [video('vb')] }
  ]);
  try {
    const { default: handler } = await import('../api/tendances.js?t=' + Date.now());
    const resA = creerRes(), resB = creerRes();
    await Promise.all([
      handler({ method: 'POST', body: { action: 'avancer', id: 'ja', code_acces: 'CODE-PRO-A' } }, resA),
      handler({ method: 'POST', body: { action: 'avancer', id: 'jb', code_acces: 'CODE-PRO-B' } }, resB)
    ]);
    assert.equal(resA.statutRecu, 200);
    assert.equal(resB.statutRecu, 200);
    assert.equal(resA.corpsRecu.statut, 'termine');
    assert.equal(resB.corpsRecu.statut, 'termine');
    assert.ok(!resA.corpsRecu.dejaEnCours && !resB.corpsRecu.dejaEnCours, 'deux jobs DIFFÉRENTS ne doivent jamais se bloquer l\'un l\'autre : ' + JSON.stringify([resA.corpsRecu, resB.corpsRecu]));
  } finally { restaurer(); }
});

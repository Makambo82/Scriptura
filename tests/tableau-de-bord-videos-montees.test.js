// Demande du propriétaire, après l'ouverture du montage vidéo aux abonnés
// Creator et Pro : savoir combien de vidéos sont réellement montées.
//
// Le quota d'IMAGES était déjà compté (usage_serveur, montageImages), mais le
// rendu lui-même ne l'était nulle part. Impossible, donc, de répondre à la
// seule question qui compte pour piloter : est-ce que cette fonctionnalité
// sert vraiment, et à quel palier d'abonnement ?
//
// Ce que ces tests verrouillent :
//  - chaque rendu réussi laisse une trace mesurée (plan, plans, durées,
//    options), et AUCUNE donnée de contenu ;
//  - un rendu refusé n'en laisse jamais, sinon les chiffres compteraient des
//    vidéos qui n'existent pas ;
//  - et surtout, LA MESURE NE DOIT JAMAIS CASSER CE QU'ELLE MESURE : si la
//    table n'existe pas ou si Supabase répond mal, la vidéo doit quand même
//    être livrée au créateur, qui vient d'attendre une minute pour l'avoir.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST-MESURE',
  MONTAGE_RENDER_URL: 'https://render.exemple.test',
  MONTAGE_RENDER_TOKEN: 'jeton-test'
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

// `journal` collecte ce qui est réellement envoyé à la table montages_rendus.
// `rendusEnEchec` simule une table absente (le cas normal tant que le
// propriétaire n'a pas exécuté supabase/montages_rendus.sql).
function poserFetchMock({ abonneRows, journal, journalEnEchec }) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    if (u.includes('/rest/v1/montages_rendus')) {
      if (journal && opts && opts.body) journal.push(JSON.parse(opts.body));
      if (journalEnEchec) throw new Error('relation "montages_rendus" does not exist');
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes('render.exemple.test')) {
      return { ok: true, json: async () => ({ url: 'https://exemple.supabase.co/storage/v1/object/public/montages/rendus/x.mp4' }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

const CORPS_MONTAGE = {
  images: [
    { url: 'https://exemple.test/img-0.jpg', duration: 3 },
    { url: 'https://exemple.test/img-1.jpg', duration: 4.5 }
  ],
  audioUrl: 'https://exemple.test/audio.mp3',
  format: '9:16',
  captions: [{ texte: 'Bonjour', debut: 0, fin: 1 }],
  musicUrl: 'https://exemple.test/musique.mp3',
  watermark: true
};

// Le journal part sans await (voir journaliserMontage, api/montage-render.js) :
// on laisse la boucle d'événements tourner un instant avant de le lire.
const laisserPasser = () => new Promise(r => setTimeout(r, 20));

test('un rendu réussi laisse une mesure exploitable, sans aucune donnée de contenu', async () => {
  const restaurer = poserEnv();
  const journal = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }], journal });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { code_acces: 'CODE-PRO', ...CORPS_MONTAGE } }, res);
    await laisserPasser();

    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(journal.length, 1, 'un rendu réussi doit laisser exactement une ligne : ' + JSON.stringify(journal));
    const l = journal[0];
    assert.equal(l.plan, 'pro', 'le plan sert justement à voir si le montage pousse à l\'abonnement Pro');
    assert.equal(l.nb_plans, 2);
    assert.equal(l.duree_video_s, 7.5, 'la durée vidéo est la somme réelle des plans, pas une estimation');
    assert.equal(l.format, '9:16');
    assert.equal(l.sous_titres, true);
    assert.equal(l.musique, true);
    assert.equal(l.filigrane, true);
    assert.ok(Number.isFinite(l.duree_rendu_ms) && l.duree_rendu_ms >= 0, 'la durée de rendu doit être mesurée : ' + l.duree_rendu_ms);

    // Aucune donnée de contenu : ni URL d'image, ni audio, ni sous-titres.
    const brut = JSON.stringify(l);
    assert.ok(!brut.includes('img-0.jpg'), 'aucune URL d\'image ne doit être enregistrée : ' + brut);
    assert.ok(!brut.includes('audio.mp3'), 'aucune URL audio ne doit être enregistrée : ' + brut);
    assert.ok(!brut.includes('Bonjour'), 'aucun texte de sous-titre ne doit être enregistré : ' + brut);
  } finally { restaurer(); }
});

test('le fondateur est enregistré à part, pour pouvoir le retrancher de l\'usage réel', async () => {
  const restaurer = poserEnv();
  const journal = [];
  poserFetchMock({ journal });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { code_acces: ENV_BASE.CODE_ADMIN, ...CORPS_MONTAGE } }, res);
    await laisserPasser();

    assert.equal(res.statutRecu, 200);
    assert.equal(journal[0].plan, 'fondateur',
      'sans ça, les propres essais du fondateur gonfleraient les chiffres des abonnés : ' + JSON.stringify(journal[0]));
  } finally { restaurer(); }
});

test('un accès refusé ne laisse AUCUNE mesure : jamais compter une vidéo qui n\'existe pas', async () => {
  const restaurer = poserEnv();
  const journal = [];
  poserFetchMock({ abonneRows: [], journal });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { code_acces: 'CODE-INCONNU', ...CORPS_MONTAGE } }, res);
    await laisserPasser();

    assert.equal(res.statutRecu, 403);
    assert.deepEqual(journal, [], 'aucune ligne ne doit être écrite pour un rendu refusé');
  } finally { restaurer(); }
});

test('LA MESURE NE CASSE JAMAIS LE MONTAGE : table absente, la vidéo est livrée quand même', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], journalEnEchec: true });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { code_acces: 'CODE-CREATOR', ...CORPS_MONTAGE } }, res);
    await laisserPasser();

    assert.equal(res.statutRecu, 200,
      'le créateur vient d\'attendre une minute pour sa vidéo : une table de mesure absente ne doit JAMAIS la lui coûter');
    assert.ok(res.corpsRecu.url, 'l\'URL de la vidéo doit revenir normalement');
  } finally { restaurer(); }
});

test('Supabase non configuré : rien n\'est journalisé, et le montage passe quand même', async () => {
  const restaurer = poserEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  const journal = [];
  poserFetchMock({ journal });
  try {
    // Sans configuration Supabase, resoudreDroits accorde un accès Creator
    // dégradé (comportement documenté, voir api/_lib/acces.js) : le montage
    // passe donc, et c'est justement le cas où la journalisation doit se
    // taire au lieu d'échouer bruyamment.
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', body: { code_acces: 'PEU-IMPORTE', ...CORPS_MONTAGE } }, res);
    await laisserPasser();

    assert.equal(res.statutRecu, 200);
    assert.deepEqual(journal, [], 'sans clé Supabase, aucune écriture ne doit être tentée');
  } finally { restaurer(); }
});

test('le Tableau de bord remonte les montages, et reste debout si la table n\'existe pas', async () => {
  const restaurer = poserEnv();
  const lignesTable = [
    { plan: 'pro', nb_plans: 11, duree_video_s: 55, duree_rendu_ms: 35400, format: '9:16', sous_titres: true, musique: true, filigrane: true, cree_le: new Date().toISOString() }
  ];
  let tableAbsente = false;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/montages_rendus')) {
      if (tableAbsente) return { ok: false, json: async () => ({ message: 'relation does not exist' }) };
      return { ok: true, json: async () => lignesTable };
    }
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, headers: { get: () => '0-0/0' }, json: async () => [] };
    }
    return { ok: true, headers: { get: () => '0-0/0' }, json: async () => [] };
  };
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    const res = creerRes();
    await handler({ method: 'POST', query: {}, body: { resource: 'admin-stats', code_acces: ENV_BASE.CODE_ADMIN } }, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(res.corpsRecu.montages.length, 1, 'les montages doivent remonter au Tableau de bord');
    assert.equal(res.corpsRecu.montages[0].plan, 'pro');

    // Table absente : le reste des statistiques doit continuer de fonctionner.
    tableAbsente = true;
    const res2 = creerRes();
    const { default: handler2 } = await import('../api/data.js?t=' + Date.now() + 'b');
    await handler2({ method: 'POST', query: {}, body: { resource: 'admin-stats', code_acces: ENV_BASE.CODE_ADMIN } }, res2);
    assert.equal(res2.statutRecu, 200, 'le Tableau de bord ne doit jamais tomber parce qu\'une table optionnelle manque');
    assert.deepEqual(res2.corpsRecu.montages, [], 'sans table, simplement aucune vidéo remontée');
  } finally { restaurer(); }
});

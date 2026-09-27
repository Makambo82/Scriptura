// Retour propriétaire (27/09) : quota Storage Supabase dépassé (134% du
// plan gratuit sur le projet réel), aucun nettoyage n'existait pour le
// passif accumulé AVANT que render-service/server.js supprime
// automatiquement les assets intermédiaires (voir
// tests/montage-nettoyage-storage-apres-usage.test.js). Ce fichier verrouille
// les deux nouvelles actions admin (resource=admin-stats) qui purgent ce
// passif depuis le Tableau de bord (voir js/admin.js) :
//   - stockage-montages-etat   : lecture seule, compte les dossiers à purger
//   - stockage-montages-purger : purge réelle, jamais le dossier `rendus/`
//     (vidéos finales, régies par leur propre règle de rétention)
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/fetch-fidele').rendreLesMocksFideles();

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Simule le bucket `montages` : `racine` = dossiers de premier niveau
// (+ `rendus`, toujours présent, jamais purgé), `fichiersParDossier` = le
// contenu de chaque dossier.
function poserFetchStorage({ racine = [], fichiersParDossier = {}, comptes = { 'ADMIN-TEST': null } } = {}) {
  const appelsRemove = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => [] };
    if (u.endsWith('/storage/v1/object/list/montages')) {
      const p = JSON.parse(opts.body);
      if (p.prefix === '') {
        const debut = p.offset || 0;
        const page = racine.slice(debut, debut + p.limit);
        return { ok: true, json: async () => page };
      }
      const dossier = p.prefix.replace(/\/$/, '');
      const fichiers = fichiersParDossier[dossier] || [];
      const debut = p.offset || 0;
      const page = fichiers.slice(debut, debut + p.limit).map(nom => ({ name: nom, id: 'x' }));
      return { ok: true, json: async () => page };
    }
    if (u.endsWith('/storage/v1/object/remove/montages')) {
      const p = JSON.parse(opts.body);
      appelsRemove.push(p.prefixes);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ([]) };
  };
  return { appelsRemove, restaurer: () => { global.fetch = fetchOriginal; } };
}

function dossier(nom) { return { name: nom, id: null, metadata: null }; }

async function importerHandler() {
  const { default: handler } = await import('../api/data.js?t=' + Date.now() + Math.random());
  return handler;
}

test('non-admin refusé sur les deux actions', async () => {
  poserEnv();
  const { restaurer } = poserFetchStorage({ racine: [dossier('montage-1'), dossier('rendus')] });
  try {
    const handler = await importerHandler();
    const res1 = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-etat', code_acces: 'PAS-ADMIN' } }, res1);
    assert.equal(res1._status, 403);
    const res2 = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-purger', code_acces: 'PAS-ADMIN' } }, res2);
    assert.equal(res2._status, 403);
  } finally { restaurer(); retirerEnv(); }
});

test('stockage-montages-etat : compte les dossiers, exclut toujours rendus/ (vidéos finales)', async () => {
  poserEnv();
  process.env.CODE_ADMIN = 'ADMIN-TEST';
  const { restaurer } = poserFetchStorage({ racine: [dossier('montage-1'), dossier('montage-2'), dossier('rendus')] });
  try {
    const handler = await importerHandler();
    const res = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-etat', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.dossiers, 2, 'REGRESSION : rendus/ ne doit jamais être compté comme un dossier à purger');
  } finally { restaurer(); retirerEnv(); delete process.env.CODE_ADMIN; }
});

test('stockage-montages-purger : supprime les fichiers des dossiers sources, jamais ceux de rendus/', async () => {
  poserEnv();
  process.env.CODE_ADMIN = 'ADMIN-TEST';
  const { appelsRemove, restaurer } = poserFetchStorage({
    racine: [dossier('montage-1'), dossier('montage-2'), dossier('rendus')],
    fichiersParDossier: {
      'montage-1': ['img-0.jpg', 'img-1.jpg', 'voix-off.mp3'],
      'montage-2': ['img-0.jpg', 'musique.mp3']
    }
  });
  try {
    const handler = await importerHandler();
    const res = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-purger', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.dossiers, 2);
    assert.equal(res._json.fichiers, 5);
    const tousLesChemins = appelsRemove.flat();
    assert.deepEqual(tousLesChemins.sort(), [
      'montage-1/img-0.jpg', 'montage-1/img-1.jpg', 'montage-1/voix-off.mp3',
      'montage-2/img-0.jpg', 'montage-2/musique.mp3'
    ].sort());
    assert.ok(!tousLesChemins.some(c => c.startsWith('rendus/')), 'REGRESSION CRITIQUE : une vidéo finale ne doit jamais être supprimée par cette purge');
  } finally { restaurer(); retirerEnv(); delete process.env.CODE_ADMIN; }
});

test('stockage-montages-etat : pagine correctement au-delà d\'une page (plus de 1000 dossiers)', async () => {
  poserEnv();
  process.env.CODE_ADMIN = 'ADMIN-TEST';
  const racine = [];
  for (let i = 0; i < 1200; i++) racine.push(dossier('montage-' + i));
  racine.push(dossier('rendus'));
  const { restaurer } = poserFetchStorage({ racine });
  try {
    const handler = await importerHandler();
    const res = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-etat', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._json.dossiers, 1200, 'REGRESSION : la pagination doit couvrir toutes les pages, pas seulement la première (limite 1000)');
  } finally { restaurer(); retirerEnv(); delete process.env.CODE_ADMIN; }
});

test('stockage-montages-purger : un dossier de plus de 200 fichiers est retiré en plusieurs lots', async () => {
  poserEnv();
  process.env.CODE_ADMIN = 'ADMIN-TEST';
  const fichiers = [];
  for (let i = 0; i < 450; i++) fichiers.push('img-' + i + '.jpg');
  const { appelsRemove, restaurer } = poserFetchStorage({
    racine: [dossier('gros-montage')],
    fichiersParDossier: { 'gros-montage': fichiers }
  });
  try {
    const handler = await importerHandler();
    const res = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-purger', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._json.fichiers, 450);
    assert.equal(appelsRemove.length, 3, 'REGRESSION : 450 fichiers en lots de 200 doit faire 3 appels (200+200+50)');
  } finally { restaurer(); retirerEnv(); delete process.env.CODE_ADMIN; }
});

test('stockage-montages-purger : aucun dossier à purger => réponse propre, aucun appel de retrait', async () => {
  poserEnv();
  process.env.CODE_ADMIN = 'ADMIN-TEST';
  const { appelsRemove, restaurer } = poserFetchStorage({ racine: [dossier('rendus')] });
  try {
    const handler = await importerHandler();
    const res = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'stockage-montages-purger', code_acces: 'ADMIN-TEST' } }, res);
    assert.equal(res._json.dossiers, 0);
    assert.equal(res._json.fichiers, 0);
    assert.equal(appelsRemove.length, 0);
  } finally { restaurer(); retirerEnv(); delete process.env.CODE_ADMIN; }
});

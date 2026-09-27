// Retour propriétaire (27/09), deux gaps distincts sur la vidéo finale d'un
// montage :
//
//  1. « Supprimer après 3 jours » : le correctif précédent (voir
//     tests/montage-nettoyage-storage-apres-usage.test.js) ne supprimait la
//     vidéo QUE si elle était téléchargée - jamais téléchargée, elle
//     s'accumulait pour toujours dans le Storage. api/cron-nettoyage-montages.js
//     (Vercel Cron quotidien, voir vercel.json) ferme ce trou : purge à 3
//     jours, téléchargée ou non.
//
//  2. « Elle n'est jamais présente dans l'historique via Mes générations » :
//     même une fois rendue, la vidéo n'existait QUE dans la mémoire du
//     navigateur qui l'avait rendue - fermer l'onglet avant de cliquer sur
//     « Télécharger » la rendait introuvable, alors que le fichier existait
//     encore. `montages_video` (voir supabase/montages_video.sql) enregistre
//     chaque rendu réussi ; api/data.js (resource=montages-video) le liste
//     pour js/historique.js ; la ligne est supprimée dès qu'elle n'a plus
//     lieu d'être (téléchargée ou purgée par le cron ci-dessus).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/fetch-fidele').rendreLesMocksFideles();

function mockRes() {
  return { _status: 200, _json: null, _headers: {}, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

// ═══ 1. api/montage-render.js : enregistrement pour l'historique ═══

function poserEnvRender() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.MONTAGE_RENDER_URL = 'https://service-de-rendu-test.example/';
  process.env.MONTAGE_RENDER_TOKEN = 'jeton-de-test-jamais-un-secret-reel';
}
function retirerEnvRender() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MONTAGE_RENDER_URL;
  delete process.env.MONTAGE_RENDER_TOKEN;
}

function poserFetchRender({ urlRendue = 'https://exemple.supabase.co/storage/v1/object/sign/montages/rendus/x.mp4?token=t' } = {}) {
  const appelsMontagesVideo = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => true };
    if (u.includes('/rest/v1/rpc/rembourser_usage')) return { ok: true, json: async () => true };
    if (u.includes('service-de-rendu-test.example')) return { ok: true, json: async () => ({ url: urlRendue }) };
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => ([{ actif: true, plan: 'creator', jetons_audit: 0 }]) };
    if (u.includes('/rest/v1/montages_video')) {
      appelsMontagesVideo.push({ url: u, corps: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes('/rest/v1/montages_rendus')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ([]) };
  };
  return { appelsMontagesVideo, restaurer: () => { global.fetch = fetchOriginal; } };
}

test('un rendu réussi enregistre la vidéo dans montages_video (sinon perdue si jamais téléchargée)', async () => {
  poserEnvRender();
  const { appelsMontagesVideo, restaurer } = poserFetchRender();
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now() + Math.random());
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { code_acces: 'UNABONNE-HIST', format: '9:16', images: [{ url: 'https://x.example/a.jpg', duration: 2 }], audioUrl: 'https://x.example/a.mp3' }
    }, res);
    assert.equal(res._status, 200, JSON.stringify(res._json));
    // Laisse le fire-and-forget se résoudre (aucun await dans le code testé).
    await new Promise(r => setTimeout(r, 0));
    assert.equal(appelsMontagesVideo.length, 1, 'REGRESSION : la vidéo doit être enregistrée pour Mes générations');
    assert.equal(appelsMontagesVideo[0].corps.code_acces, 'UNABONNE-HIST');
    assert.equal(appelsMontagesVideo[0].corps.url, res._json.url);
    assert.equal(appelsMontagesVideo[0].corps.format, '9:16');
  } finally { restaurer(); retirerEnvRender(); }
});

test('un rendu ÉCHOUÉ n\'enregistre jamais de ligne montages_video (rien n\'a été produit)', async () => {
  poserEnvRender();
  const fetchOriginal = global.fetch;
  const appelsMontagesVideo = [];
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/rpc/consommer_usage')) return { ok: true, json: async () => true };
    if (u.includes('/rest/v1/rpc/rembourser_usage')) return { ok: true, json: async () => true };
    if (u.includes('service-de-rendu-test.example')) return { ok: false, status: 500, json: async () => ({ error: { message: 'panne' } }) };
    if (u.includes('/rest/v1/abonnes')) return { ok: true, json: async () => ([{ actif: true, plan: 'creator', jetons_audit: 0 }]) };
    if (u.includes('/rest/v1/montages_video')) { appelsMontagesVideo.push(1); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ([]) };
  };
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now() + Math.random());
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { code_acces: 'UNABONNE-HIST2', images: [{ url: 'https://x.example/a.jpg', duration: 2 }], audioUrl: 'https://x.example/a.mp3' }
    }, res);
    assert.equal(res._status, 502);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(appelsMontagesVideo.length, 0);
  } finally { global.fetch = fetchOriginal; retirerEnvRender(); }
});

// ═══ 2. api/data.js (resource=montages-video) : listage pour l'historique ═══

function creerReq({ method, query, body, ip = '9.9.9.9' }) {
  return { method, query: query || {}, body: body || {}, headers: { 'x-forwarded-for': ip } };
}

function poserEnvData() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
}
function retirerEnvData() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function poserFetchData({ comptes = {}, lignesMontagesVideo = [] } = {}) {
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/abonnes') {
      const code = (u.searchParams.get('code') || '').replace(/^eq\./, '');
      const compte = comptes[code];
      return { ok: true, json: async () => (compte ? [compte] : []) };
    }
    if (u.pathname === '/rest/v1/rpc/consommer_usage') return { ok: true, json: async () => true };
    if (u.pathname === '/rest/v1/montages_video') {
      const code = (u.searchParams.get('code_acces') || '').replace(/^eq\./, '');
      return { ok: true, json: async () => lignesMontagesVideo.filter(l => l.code_acces === code) };
    }
    return { ok: true, json: async () => ([]) };
  };
  return { restaurer: () => { global.fetch = fetchOriginal; } };
}

test('resource=montages-video liste bien les vidéos du code_acces demandé, triées récentes en premier', async () => {
  poserEnvData();
  const { restaurer } = poserFetchData({
    comptes: { 'CODE-VID': { actif: true, plan: 'creator', jetons_audit: 0 } },
    lignesMontagesVideo: [
      { id: 1, code_acces: 'CODE-VID', url: 'https://x/a.mp4', format: '9:16', cree_le: '2026-09-24T00:00:00Z' },
      { id: 2, code_acces: 'AUTRE', url: 'https://x/b.mp4', format: '9:16', cree_le: '2026-09-25T00:00:00Z' }
    ]
  });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now() + Math.random());
    const res = mockRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'montages-video', code: 'CODE-VID' } }), res);
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.data.length, 1, 'REGRESSION : ne doit jamais renvoyer la vidéo d\'un autre code_acces');
    assert.equal(res._json.data[0].id, 1);
  } finally { restaurer(); retirerEnvData(); }
});

test('resource=montages-video sans code => liste vide, jamais d\'erreur', async () => {
  poserEnvData();
  const { restaurer } = poserFetchData();
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now() + Math.random());
    const res = mockRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'montages-video', code: '' } }), res);
    assert.equal(res._status, 200);
    assert.deepEqual(res._json.data, []);
  } finally { restaurer(); retirerEnvData(); }
});

test('resource=montages-video : compte désactivé refusé, même règle que generations/series', async () => {
  poserEnvData();
  const { restaurer } = poserFetchData({ comptes: { 'CODE-OFF': { actif: false, plan: 'creator', jetons_audit: 0 } } });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now() + Math.random());
    const res = mockRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'montages-video', code: 'CODE-OFF' } }), res);
    assert.equal(res._status, 403);
  } finally { restaurer(); retirerEnvData(); }
});

// ═══ 3. api/cron-nettoyage-montages.js : purge à 3 jours ═══

function poserEnvCron() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.CRON_SECRET = 'secret-cron-test';
}
function retirerEnvCron() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CRON_SECRET;
}

async function importerCron() {
  const { default: handler } = await import('../api/cron-nettoyage-montages.js?t=' + Date.now() + Math.random());
  return handler;
}

test('cron : refuse tout appel sans le bon secret (401), jamais de purge sans authentification', async () => {
  poserEnvCron();
  try {
    const handler = await importerCron();
    const res = mockRes();
    await handler({ headers: { authorization: 'Bearer mauvais-secret' } }, res);
    assert.equal(res._status, 401);
  } finally { retirerEnvCron(); }
});

test('cron : CRON_SECRET absente => refuse de fonctionner plutôt qu\'une purge non protégée', async () => {
  poserEnvCron();
  delete process.env.CRON_SECRET;
  try {
    const handler = await importerCron();
    const res = mockRes();
    await handler({ headers: { authorization: 'Bearer nimporte-quoi' } }, res);
    assert.equal(res._status, 500);
  } finally { retirerEnvCron(); }
});

test('cron : purge les vidéos de plus de 3 jours (Storage + ligne), laisse les récentes intactes', async () => {
  poserEnvCron();
  const appelsRemove = [];
  const appelsDelete = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/montages_video?cree_le=lt.')) {
      // Seules les vieilles lignes sont renvoyées par ce filtre (simulé ici :
      // le mock ne fait pas de vraie comparaison de date, il retourne
      // directement ce qu'on veut voir purgé).
      return {
        ok: true,
        json: async () => ([
          { id: 5, url: 'https://exemple.supabase.co/storage/v1/object/sign/montages/rendus/vieille.mp4?token=a' },
          { id: 6, url: 'https://exemple.supabase.co/storage/v1/object/sign/montages/rendus/vieille2.mp4?token=b' }
        ])
      };
    }
    if (u.endsWith('/storage/v1/object/remove/montages')) {
      appelsRemove.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes('/rest/v1/montages_video?id=in.')) {
      appelsDelete.push(u);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const handler = await importerCron();
    const res = mockRes();
    await handler({ headers: { authorization: 'Bearer secret-cron-test' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.purgees, 2);
    assert.equal(appelsRemove.length, 1, 'un seul appel groupé, pas un par fichier');
    assert.deepEqual(appelsRemove[0].prefixes.sort(), ['rendus/vieille.mp4', 'rendus/vieille2.mp4']);
    assert.equal(appelsDelete.length, 1);
    assert.ok(appelsDelete[0].includes('5') && appelsDelete[0].includes('6'), 'les deux id purgés doivent être retirés de la table');
  } finally { global.fetch = fetchOriginal; retirerEnvCron(); }
});

test('cron : requête la table avec un seuil de 3 jours, ni plus ni moins (la consigne du propriétaire)', async () => {
  poserEnvCron();
  let seuilRecu = null;
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/montages_video?cree_le=lt.')) {
      const m = /cree_le=lt\.([^&]+)/.exec(u);
      seuilRecu = decodeURIComponent(m[1]);
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const handler = await importerCron();
    const res = mockRes();
    const avant = Date.now();
    await handler({ headers: { authorization: 'Bearer secret-cron-test' } }, res);
    assert.ok(seuilRecu, 'le seuil doit être transmis à Supabase');
    const ecartJours = (avant - new Date(seuilRecu).getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(ecartJours - 3) < 0.01, 'REGRESSION : le seuil doit être exactement 3 jours, valeur reçue = ' + ecartJours);
  } finally { global.fetch = fetchOriginal; retirerEnvCron(); }
});

test('cron : aucune ligne à purger => aucun appel Storage, réponse propre', async () => {
  poserEnvCron();
  const appelsRemove = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = url.toString();
    if (u.includes('/rest/v1/montages_video?cree_le=lt.')) return { ok: true, json: async () => [] };
    if (u.endsWith('/storage/v1/object/remove/montages')) { appelsRemove.push(1); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({}) };
  };
  try {
    const handler = await importerCron();
    const res = mockRes();
    await handler({ headers: { authorization: 'Bearer secret-cron-test' } }, res);
    assert.equal(res._status, 200);
    assert.equal(res._json.purgees, 0);
    assert.equal(appelsRemove.length, 0);
  } finally { global.fetch = fetchOriginal; retirerEnvCron(); }
});

// ═══ 4. js/historique.js : section « Vidéos montées » ═══

const SOURCE_HIST = fs.readFileSync(path.join(__dirname, '..', 'js', 'historique.js'), 'utf8');
const SOURCE_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('historique.js : la section vidéos montées est chargée à l\'ouverture ET après synchronisation par code', () => {
  const blocOpen = SOURCE_HIST.slice(SOURCE_HIST.indexOf('async function openHistory('), SOURCE_HIST.indexOf('async function syncHistory('));
  assert.ok(/chargerVideosMonteesDisponibles\(\)/.test(blocOpen), 'REGRESSION : openHistory doit charger les vidéos montées disponibles');
  const blocSync = SOURCE_HIST.slice(SOURCE_HIST.indexOf('async function syncHistory('));
  const finSync = blocSync.indexOf('\n}\n');
  assert.ok(/chargerVideosMonteesDisponibles\(\)/.test(blocSync.slice(0, finSync)), 'REGRESSION : syncHistory (changement de code) doit recharger la liste, sinon elle resterait celle de l\'ancien code');
});

test('historique.js : le conteneur #historyVideosMontees existe dans index.html, au-dessus de la liste principale', () => {
  const iVideos = SOURCE_HTML.indexOf('id="historyVideosMontees"');
  const iListe = SOURCE_HTML.indexOf('id="historyList"');
  assert.ok(iVideos > -1, 'REGRESSION : conteneur manquant, la section ne peut jamais s\'afficher');
  assert.ok(iVideos < iListe, 'la vidéo est éphémère (3 jours), elle doit rester visible avant la liste permanente');
});

test('historique.js : le téléchargement d\'une vidéo montée recharge la liste, sans exposer l\'URL signée dans un attribut HTML', () => {
  assert.ok(!/onclick="partagerVideoMontage\(this, ['"]/.test(SOURCE_HIST),
    'REGRESSION : l\'URL signée ne doit jamais transiter en clair dans un attribut onclick');
  const blocPont = SOURCE_HIST.slice(SOURCE_HIST.indexOf('async function partagerVideoMontee('));
  assert.ok(/await partagerVideoMontage\(btn, v\.url\)/.test(blocPont));
  assert.ok(/chargerVideosMonteesDisponibles\(\)/.test(blocPont.slice(0, blocPont.indexOf('\n}'))));
});

// AUDIT A3 — Tests de sécurité dédiés au correctif.
//
// Le bucket `montages` était PUBLIC (supabase/montage_storage.sql) avec une
// policy d'écriture `with check(true)` : n'importe qui, avec la seule clé
// publique déjà présente dans le JS servi, pouvait déposer des fichiers
// arbitraires dans ce bucket ou lire n'importe quel objet, sans jamais
// passer par verifierAccesMontage (réservé aux abonnés Creator/Pro).
//
// Correctif : bucket privé (supabase/montage_storage_rls.sql), RLS anon
// fermée en lecture ET écriture, et une route serveur authentifiée
// (handleMontageStorage, resource=montage-storage, api/data.js) mint des
// URLs Supabase Storage SIGNÉES (upload et lecture), après avoir vérifié
// verifierAccesMontage. Ce fichier verrouille les cinq exigences de
// l'audit : upload anonyme refusé, lecture anonyme refusée, utilisateur
// autorisé toujours fonctionnel, le render-service peut encore récupérer
// les assets (via l'URL signée renvoyée par read-url, acceptée par
// urlAssetApprouvee, voir render-service/server.js et l'audit A1), et le
// chemin est validé strictement (pas de traversal).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

async function appeler(body) {
  const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now() + '-' + Math.random());
  const handler = handlerModule.default;
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body }, res);
  return res;
}

function poserFetchStorage() {
  const appels = { storage: [] };
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url.toString());
    if (u.pathname.startsWith('/storage/v1/object/upload/sign/') || u.pathname.startsWith('/storage/v1/object/sign/')) {
      appels.storage.push({ url: u.toString(), opts });
      return { ok: true, status: 200, json: async () => ({ url: u.pathname + '?token=jeton-signe-test' }) };
    }
    // Résolution du code_acces (table abonnes) pour resoudreDroits : réponse
    // neutre, sans intérêt pour ces tests.
    return { ok: true, status: 200, json: async () => ([]), headers: { get: () => null } };
  };
  return { appels, restaurer: () => { global.fetch = fetchOriginal; } };
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.CODE_ADMIN = 'SCRIPTURA-CELINE';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CODE_ADMIN;
}

const CHEMIN_VALIDE = 'montage-1700000000000/img-1.jpg';

test('A3-1 : upload-url refuse un appel anonyme (ou non-abonné), jamais de fetch Storage', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchStorage();
  try {
    const sansCode = await appeler({ resource: 'montage-storage', action: 'upload-url', chemin: CHEMIN_VALIDE });
    assert.equal(sansCode._status, 403, JSON.stringify(sansCode._json));
    assert.equal(sansCode._json?.ok, false);

    const codeInconnu = await appeler({ resource: 'montage-storage', action: 'upload-url', chemin: CHEMIN_VALIDE, code_acces: 'INCONNU123' });
    assert.equal(codeInconnu._status, 403, JSON.stringify(codeInconnu._json));

    assert.equal(appels.storage.length, 0, 'aucun appel Supabase Storage ne doit partir sans autorisation Creator/Pro : ' + JSON.stringify(appels.storage));
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A3-2 : read-url refuse un appel anonyme (ou non-abonné), jamais de fetch Storage', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchStorage();
  try {
    const sansCode = await appeler({ resource: 'montage-storage', action: 'read-url', chemins: [CHEMIN_VALIDE] });
    assert.equal(sansCode._status, 403, JSON.stringify(sansCode._json));
    assert.equal(appels.storage.length, 0, 'aucune URL de lecture ne doit être mintée sans autorisation : ' + JSON.stringify(appels.storage));
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A3-3 : un abonné Creator/Pro (ou le fondateur) obtient bien ses URLs signées, upload ET lecture', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchStorage();
  try {
    const upload = await appeler({ resource: 'montage-storage', action: 'upload-url', chemin: CHEMIN_VALIDE, code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(upload._status, 200, JSON.stringify(upload._json));
    assert.equal(upload._json.ok, true);
    assert.ok(upload._json.uploadUrl.includes('/storage/v1/object/upload/sign/montages/' + CHEMIN_VALIDE), upload._json.uploadUrl);
    assert.ok(upload._json.uploadUrl.includes('token=jeton-signe-test'), upload._json.uploadUrl);

    const lecture = await appeler({ resource: 'montage-storage', action: 'read-url', chemins: [CHEMIN_VALIDE], code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(lecture._status, 200, JSON.stringify(lecture._json));
    assert.equal(lecture._json.ok, true);
    const url = lecture._json.urls[CHEMIN_VALIDE];
    assert.ok(url && url.includes('/storage/v1/object/sign/montages/' + CHEMIN_VALIDE), JSON.stringify(lecture._json));
    assert.ok(url.includes('token=jeton-signe-test'), url);

    assert.ok(appels.storage.length >= 2, 'les deux mints (upload + lecture) doivent avoir réellement appelé Supabase Storage');
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A3-4 : l\'URL de lecture renvoyée est bien de la forme que le render-service accepte (urlAssetApprouvee, audit A1)', async () => {
  poserEnv();
  const { restaurer } = poserFetchStorage();
  try {
    const lecture = await appeler({ resource: 'montage-storage', action: 'read-url', chemins: [CHEMIN_VALIDE], code_acces: 'SCRIPTURA-CELINE' });
    const url = lecture._json.urls[CHEMIN_VALIDE];
    const { urlAssetApprouvee } = require('../render-service/server.js');
    // Le render-service valide contre SA PROPRE variable SUPABASE_URL (voir
    // render-service/server.js) : on la fixe à la même origine ici pour
    // vérifier la FORME de l'URL, pas la config de déploiement.
    process.env.SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
    assert.equal(urlAssetApprouvee(url), true, 'le render-service doit accepter l\'URL de lecture mintée pour un abonné autorisé : ' + url);
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A3-5 : un chemin invalide (traversal, absolu, hors convention) est rejeté même pour un abonné autorisé', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchStorage();
  try {
    for (const chemin of ['../../etc/passwd', '/etc/passwd', 'sans-dossier.jpg', 'a/b/c.jpg', '', 'montage-1/../../x.jpg']) {
      const r = await appeler({ resource: 'montage-storage', action: 'upload-url', chemin, code_acces: 'SCRIPTURA-CELINE' });
      assert.equal(r._status, 400, `chemin "${chemin}" aurait dû être rejeté : ` + JSON.stringify(r._json));
    }
    assert.equal(appels.storage.length, 0, 'aucun chemin invalide ne doit atteindre Supabase Storage : ' + JSON.stringify(appels.storage));
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A3-6 : une action inconnue est refusée proprement (400), jamais un fetch Storage', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchStorage();
  try {
    const r = await appeler({ resource: 'montage-storage', action: 'supprimer-tout', code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(r._status, 400, JSON.stringify(r._json));
    assert.equal(appels.storage.length, 0);
  } finally {
    restaurer();
    retirerEnv();
  }
});

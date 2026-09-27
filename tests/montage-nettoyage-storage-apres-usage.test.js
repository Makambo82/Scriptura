// Retour propriétaire (27/09) : rien, nulle part, ne supprimait jamais les
// fichiers uploadés dans le bucket Storage `montages` (images, voix off,
// musique intermédiaires côté render-service ; vidéo finale côté
// api/montage-media.js) - exactement le risque qui a bloqué le projet
// Supabase gratuit d'un abonné (500 Mo/projet, blocage total y compris
// l'API une fois dépassé). Deux correctifs distincts, verrouillés ici :
//
//  1. render-service supprime les assets INTERMÉDIAIRES (images/voix
//     off/musique) juste après un rendu réussi - ils ne servent plus à
//     rien une fois la vidéo finale produite.
//  2. api/montage-media.js supprime la vidéo FINALE seulement quand le
//     créateur l'a VRAIMENT téléchargée (action=confirmer-telechargement,
//     appelée uniquement depuis partagerVideoMontage, jamais depuis le
//     préchargement automatique prechargerVideoMontage - voir js/montage.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('./helpers/fetch-fidele').rendreLesMocksFideles();

const SOURCE_RENDER = require('fs').readFileSync(path.join(__dirname, '..', 'render-service', 'server.js'), 'utf8');

test('render-service : nettoyerAssetsIntermediaires existe et est appelée après un rendu réussi, jamais avant', () => {
  assert.ok(/async function nettoyerAssetsIntermediaires\(/.test(SOURCE_RENDER),
    'la fonction de nettoyage doit exister dans render-service/server.js');
  // Doit être appelée APRÈS uploaderVersSupabase (le rendu est déjà en
  // sécurité) et AVANT le retour de la réponse - jamais avant l'upload
  // (un nettoyage prématuré sur un rendu qui échoue ensuite perdrait les
  // sources sans jamais avoir produit de vidéo).
  const iUpload = SOURCE_RENDER.indexOf('const urlPublique = await uploaderVersSupabase(');
  // Cherche l'APPEL (après la déclaration de la fonction, qui contient elle
  // aussi la sous-chaîne "nettoyerAssetsIntermediaires(" dans son en-tête).
  const iNettoyage = SOURCE_RENDER.indexOf('nettoyerAssetsIntermediaires(', iUpload);
  const iReponse = SOURCE_RENDER.indexOf('return res.status(200).json({ url: urlPublique })', iUpload);
  assert.ok(iUpload > -1 && iNettoyage > iUpload, 'REGRESSION : le nettoyage doit avoir lieu APRÈS l\'upload du rendu final');
  assert.ok(iReponse > iNettoyage, 'REGRESSION : le nettoyage doit avoir lieu AVANT la réponse au client');
  // Jamais un `await` sur cet appel précis : ne doit jamais retarder la
  // réponse envoyée au créateur, qui vient d'attendre son rendu.
  const ligneAppel = SOURCE_RENDER.slice(iNettoyage - 20, iNettoyage + 40);
  assert.ok(!/await\s+nettoyerAssetsIntermediaires/.test(ligneAppel),
    'REGRESSION : nettoyerAssetsIntermediaires ne doit jamais être attendue (await), elle retarderait la réponse au client');
});

test('render-service : cheminDepuisUrlStorage extrait le bon chemin et rejette le reste', () => {
  // Fonction pure : extraite ici en la ré-évaluant depuis la source (le
  // fichier n'exporte pas cette fonction précise, pas besoin de le faire
  // pour une seule regex - test direct sur le motif au lieu d'un import).
  const m = /function cheminDepuisUrlStorage\(valeur\) \{[\s\S]*?\n\}/.exec(SOURCE_RENDER);
  assert.ok(m, 'cheminDepuisUrlStorage doit exister');
  // eslint-disable-next-line no-new-func
  const cheminDepuisUrlStorage = new Function('valeur', m[0].replace(/^function cheminDepuisUrlStorage\(valeur\) \{/, '').replace(/\}$/, ''));
  const base = 'https://exemple.supabase.co';
  assert.equal(
    cheminDepuisUrlStorage(base + '/storage/v1/object/sign/montages/montage-123/img-0.jpg?token=abc'),
    'montage-123/img-0.jpg',
    'doit extraire le chemin exact, sans le token'
  );
  assert.equal(cheminDepuisUrlStorage(base + '/rest/v1/generations'), null, 'REGRESSION : une autre route Supabase ne doit jamais être acceptée');
  assert.equal(cheminDepuisUrlStorage('pas-une-url'), null, 'une valeur non-URL ne doit jamais planter, juste être rejetée');
  assert.equal(cheminDepuisUrlStorage(''), null, 'une valeur vide ne doit jamais planter');
});

test('render-service : nettoyerAssetsIntermediaires appelle bien le retrait en masse Storage, avec les bons chemins', async () => {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-test';
  const appels = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    appels.push({ url: url.toString(), corps: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    delete require.cache[require.resolve('../render-service/server.js')];
    const { nettoyerAssetsIntermediaires } = require('../render-service/server.js');
    await nettoyerAssetsIntermediaires([
      'https://exemple.supabase.co/storage/v1/object/sign/montages/montage-1/img-0.jpg?token=a',
      'https://exemple.supabase.co/storage/v1/object/sign/montages/montage-1/img-1.jpg?token=b',
      'https://exemple.supabase.co/storage/v1/object/sign/montages/montage-1/voix-off.mp3?token=c',
      '', // valeur vide (ex. pas de musique) : jamais plantée, juste ignorée
      undefined
    ]);
    // DELETE .../object/montages est tentée en premier (forme du SDK JS
    // officiel, voir retirerObjetsStorage) : elle réussit ici (mock ok:true),
    // donc un seul appel groupé, jamais le repli POST /object/remove.
    assert.equal(appels.length, 1, 'un seul appel groupé (bulk remove), pas un par fichier');
    assert.ok(appels[0].url.endsWith('/storage/v1/object/montages'), 'doit cibler le bon endpoint Storage');
    assert.deepEqual(
      appels[0].corps.prefixes.sort(),
      ['montage-1/img-0.jpg', 'montage-1/img-1.jpg', 'montage-1/voix-off.mp3'].sort(),
      'doit transmettre exactement les chemins extraits, rien d\'autre'
    );
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}
async function appelerMontageMedia(req) {
  const mod = await import(path.join(__dirname, '..', 'api', 'montage-media.js') + '?t=' + Date.now() + '-' + Math.random());
  const res = mockRes();
  await mod.default(req, res);
  return res;
}

test('confirmer-telechargement : refuse une URL qui ne pointe pas vers le bucket montages', async () => {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-test';
  try {
    const res = await appelerMontageMedia({
      method: 'POST',
      query: { action: 'confirmer-telechargement' },
      body: { url: 'https://exemple.supabase.co/rest/v1/generations' }
    });
    assert.equal(res._status, 403, 'REGRESSION : une URL hors Storage/montages doit être refusée');
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('confirmer-telechargement : supprime bien l\'objet visé pour une URL valide', async () => {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-test';
  const appels = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    appels.push({ url: url.toString(), corps: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const res = await appelerMontageMedia({
      method: 'POST',
      query: { action: 'confirmer-telechargement' },
      body: { url: 'https://exemple.supabase.co/storage/v1/object/sign/montages/rendus/montage-9.mp4?token=xyz' }
    });
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(appels.length, 2, 'un appel Storage (suppression du fichier) + un appel de retrait de la ligne montages_video');
    // DELETE .../object/montages tentée en premier (voir retirerObjetsStorage,
    // api/montage-media.js) : réussit ici (mock ok:true), pas de repli POST.
    assert.ok(appels[0].url.endsWith('/storage/v1/object/montages'));
    assert.deepEqual(appels[0].corps.prefixes, ['rendus/montage-9.mp4']);
    assert.ok(
      appels[1].url.includes('/rest/v1/montages_video?url=eq.') && appels[1].url.includes(encodeURIComponent('montages/rendus/montage-9.mp4')),
      'REGRESSION : la ligne montages_video correspondant à cette vidéo doit être retirée, sinon un lien mort resterait listé dans Mes générations'
    );
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('js/montage.js : confirmerTelechargementVideo n\'est appelée que depuis partagerVideoMontage, jamais depuis prechargerVideoMontage', () => {
  const SOURCE_CLIENT = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'montage.js'), 'utf8');
  // Borne la tranche à la déclaration de confirmerTelechargementVideo elle-même
  // (placée entre les deux), sinon sa propre signature de fonction contient la
  // sous-chaîne recherchée et fausserait le test.
  const blocPrecharger = SOURCE_CLIENT.slice(
    SOURCE_CLIENT.indexOf('function prechargerVideoMontage('),
    SOURCE_CLIENT.indexOf('function confirmerTelechargementVideo(')
  );
  assert.ok(!/confirmerTelechargementVideo/.test(blocPrecharger),
    'REGRESSION : le préchargement automatique ne doit JAMAIS confirmer un téléchargement - la vidéo serait supprimée avant même que le créateur voie le bouton "Télécharger"');
  const blocPartager = SOURCE_CLIENT.slice(SOURCE_CLIENT.indexOf('function partagerVideoMontage('));
  assert.ok(/confirmerTelechargementVideo\(url\)/.test(blocPartager),
    'partagerVideoMontage doit confirmer le téléchargement');
  // La confirmation ne doit JAMAIS avoir lieu dans le cas d'une annulation
  // (AbortError) : elle doit rester dans le "if" qui l'exclut.
  const blocCatch = blocPartager.slice(blocPartager.indexOf('} catch'), blocPartager.indexOf('} finally'));
  assert.ok(/AbortError[\s\S]*confirmerTelechargementVideo/.test(blocCatch),
    'REGRESSION : la confirmation après le repli window.open doit rester conditionnée à "pas une annulation"');
});

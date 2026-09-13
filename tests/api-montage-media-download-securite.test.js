// LOT 4B, AUDIT ID 6 (Gate Phase 2B) — /api/montage-media.js?action=download.
//
// Flux reconstitué avant correctif (voir le commentaire complet dans
// api/montage-media.js, section DOWNLOAD) : render-service (Railway) rend la
// vidéo, l'upload dans le bucket Storage privé `montages`, la SIGNE, et
// renvoie cette URL signée telle quelle à /api/montage-render puis au
// navigateur. `?action=download` ne fait que PROXIER cette URL (fetch
// serveur, évite CORS) - elle ne reçoit jamais `code_acces`.
//
// Ancien contrôle : HOTES_AUTORISES ne vérifiait que le NOM D'HÔTE, jamais
// dérivé de SUPABASE_URL. Un projet Supabase sert plusieurs API sous le même
// hôte (Storage, REST, Auth...) : une url du type https://<même hôte>/rest/v1/
// <table> passait ce contrôle sans pointer vers un objet Storage.
//
// Correctif : urlStorageMontageApprouvee (même contrôle qu'urlAssetApprouvee,
// déjà audité côté render-service, audit A1) - origine EXACTE dérivée de
// SUPABASE_URL ET chemin sous /storage/v1/object/(public|sign)/montages/.
//
// LIMITE ASSUMÉE ET DOCUMENTÉE (pas une régression de ce correctif) : cette
// route ne peut PAS vérifier qu'une URL valide appartient bien à l'appelant,
// puisque render-service ne reçoit jamais code_acces et ne peut donc jamais
// l'inscrire dans le chemin de l'objet qu'il signe. Le test 3 ci-dessous
// documente EXACTEMENT cette limite plutôt que de prétendre la fermer.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/fetch-fidele').rendreLesMocksFideles();

const ENV_BASE = { SUPABASE_URL: 'https://nlkfqxllunbvppulpnzl.supabase.co' };

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null, entetes: {}, corpsEnvoye: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  res.setHeader = (k, v) => { res.entetes[k] = v; };
  res.send = (b) => { res.corpsEnvoye = b; return res; };
  return res;
}

function poserFetchMock(reponseParUrl) {
  const appels = [];
  global.fetch = async (url) => {
    appels.push(String(url));
    const rep = typeof reponseParUrl === 'function' ? reponseParUrl(String(url)) : reponseParUrl;
    return rep;
  };
  return appels;
}

const VIDEO_BON = 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/sign/montages/montage-1735689600000/rendu.mp4?token=abc123';

async function importerHandler() {
  const { default: handler } = await import('../api/montage-media.js?t=' + Date.now());
  return handler;
}

test('1. téléchargement légitime (URL Storage signée du bucket montages) => OK, vidéo relayée', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ ok: true, body: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => Buffer.from('faux-mp4').buffer });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: VIDEO_BON } }, res);
    assert.equal(res.statutRecu, 200);
    assert.ok(res.corpsEnvoye, 'la vidéo doit être relayée au client');
  } finally { restaurer(); }
});

test('2. URL signée valide avec ses paramètres (token) => transmise SANS altération au fetch amont', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ ok: true, body: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => Buffer.from('x').buffer });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: VIDEO_BON } }, res);
    assert.equal(appels[0], VIDEO_BON, 'le token signé doit atteindre Supabase intact, jamais tronqué ni modifié');
  } finally { restaurer(); }
});

test('3. LIMITE ASSUMÉE : une URL de même forme valide ne peut pas être rattachée à un appelant précis (render-service ne reçoit jamais code_acces) - documenté, pas une régression', async () => {
  const restaurer = poserEnv();
  // Cette URL est structurellement IDENTIQUE à celle d'un appelant légitime
  // (même origine, même préfixe Storage) : rien dans son contenu ne permet
  // de savoir à qui elle appartient réellement, donc rien ne permet de la
  // distinguer d'une URL qui appartiendrait "à quelqu'un d'autre". Ce test
  // verrouille ce FAIT (déjà signalé au Gate Phase 2B comme risque FAIBLE,
  // aucun accès nouveau délivré), il ne prétend pas qu'elle est refusée.
  const urlAutreCreateur = 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/sign/montages/montage-9999999999999/rendu.mp4?token=xyz789';
  poserFetchMock({ ok: true, body: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => Buffer.from('x').buffer });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: urlAutreCreateur } }, res);
    assert.equal(res.statutRecu, 200, 'attendu et documenté : la forme seule de l\'URL ne permet aucune vérification d\'appartenance sans changer le contrat (voir le commentaire ID6, api/montage-media.js)');
  } finally { restaurer(); }
});

test('4. URL externe non autorisée (même hôte, autre route Supabase, OU domaine totalement étranger) => refusée', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ ok: true, body: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => Buffer.from('x').buffer });
  try {
    const handler = await importerHandler();

    // Même hôte Supabase, mais route REST (pas Storage) : c'était exactement
    // le trou que HOTES_AUTORISES (vérification par nom d'hôte seul) laissait passer.
    const resRest = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: 'https://nlkfqxllunbvppulpnzl.supabase.co/rest/v1/abonnes?select=*' } }, resRest);
    assert.equal(resRest.statutRecu, 403);

    // Domaine complètement étranger.
    const resExterne = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: 'https://exemple-cdn-legitime.com/video.mp4' } }, resExterne);
    assert.equal(resExterne.statutRecu, 403);

    assert.equal(appels.length, 0, 'aucune de ces deux URL ne doit jamais atteindre un fetch() réel');
  } finally { restaurer(); }
});

test('5. URL expirée (token périmé, Supabase répond en erreur) => refusée (502), jamais servie comme un succès', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ ok: false, status: 401, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: VIDEO_BON } }, res);
    assert.equal(res.statutRecu, 502);
    assert.ok(!res.corpsEnvoye, 'un token expiré ne doit jamais renvoyer un corps vidéo');
  } finally { restaurer(); }
});

test('6. paramètres manipulés (traversée de chemin, hôte dans le userinfo) => refusés, jamais un contournement du préfixe Storage', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock({ ok: true, body: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => Buffer.from('x').buffer });
  try {
    const handler = await importerHandler();

    // Traversée de chemin : new URL() normalise les ".." AVANT le test de
    // préfixe, mais on verrouille explicitement que ça reste refusé.
    const resTraversee = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/sign/montages/../../rest/v1/abonnes?select=*' } }, resTraversee);
    assert.equal(resTraversee.statutRecu, 403);

    // Astuce userinfo (@) : l'hôte AVANT le @ n'est PAS le vrai hôte cible.
    const resUserinfo = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: 'https://nlkfqxllunbvppulpnzl.supabase.co@evil.example/storage/v1/object/sign/montages/x.mp4' } }, resUserinfo);
    assert.equal(resUserinfo.statutRecu, 403);

    // Protocole non-https.
    const resHttp = creerRes();
    await handler({ method: 'GET', query: { action: 'download', url: 'http://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/sign/montages/x.mp4' } }, resHttp);
    assert.equal(resHttp.statutRecu, 403);

    assert.equal(appels.length, 0);
  } finally { restaurer(); }
});

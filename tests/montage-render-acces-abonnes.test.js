// Retour propriétaire : le rendu vidéo final (api/montage-render.js) était
// réservé à isAdmin uniquement, le temps de mesurer le coût réel du service
// de rendu externe (Railway, facturé à la seconde de vCPU et de Go-RAM).
// C'est fait : sur un montage réel de 55 s (11 plans, sous-titres, musique,
// filigrane), 35,4 s de calcul et un pic de 91 Mo de RAM, soit quelques
// millièmes de dollar. Le rendu suit désormais la MÊME règle que le reste du
// montage (verifierAccesMontage, api/_lib/acces.js) : Creator ET Pro, pas
// seulement le fondateur — sans ça, un abonné pouvait préparer ses images et
// sa voix off sans jamais pouvoir obtenir la vidéo finale.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST-RENDER',
  MONTAGE_RENDER_URL: 'https://render.exemple.test',
  MONTAGE_RENDER_TOKEN: 'jeton-render-test'
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

// `renduAppele` (optionnel) note si le service de rendu externe a bien été
// contacté : jamais le cas quand l'accès est refusé, c'est justement ce
// qu'on veut vérifier (pas de coût engagé pour une requête qui n'aurait
// jamais dû passer).
function poserFetchMock({ abonneRows, renduAppele }) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    if (u.includes('render.exemple.test')) {
      if (renduAppele) renduAppele.appele = true;
      return { ok: true, json: async () => ({ url: 'https://exemple.supabase.co/storage/v1/object/public/montages/rendus/x.mp4' }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

const CORPS_MONTAGE = {
  images: [{ url: 'https://exemple.test/img-0.jpg', duration: 2 }],
  audioUrl: 'https://exemple.test/audio.mp3'
};

test('un abonné Creator (plan reconnu) obtient sa vidéo, jusqu\'ici réservé au fondateur', async () => {
  const restaurer = poserEnv();
  const renduAppele = {};
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], renduAppele });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const req = { method: 'POST', body: { code_acces: 'CODE-CREATOR', ...CORPS_MONTAGE } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.ok(res.corpsRecu.url, 'une URL de vidéo aurait dû revenir pour un Creator');
    assert.equal(renduAppele.appele, true, 'le service de rendu externe aurait dû être contacté');
  } finally { restaurer(); }
});

test('un abonné Pro obtient aussi sa vidéo', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const req = { method: 'POST', body: { code_acces: 'CODE-PRO', ...CORPS_MONTAGE } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

test('le fondateur (isAdmin) continue de passer, comportement inchangé', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const req = { method: 'POST', body: { code_acces: ENV_BASE.CODE_ADMIN, ...CORPS_MONTAGE } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
  } finally { restaurer(); }
});

test('un code sans plan reconnu (jeton/inconnu) reste refusé, jamais de rendu lancé pour rien', async () => {
  const restaurer = poserEnv();
  const renduAppele = {};
  poserFetchMock({ abonneRows: [], renduAppele });
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const req = { method: 'POST', body: { code_acces: 'CODE-INCONNU', ...CORPS_MONTAGE } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
    assert.ok(!renduAppele.appele, 'le service de rendu externe ne doit jamais être contacté pour un accès refusé');
  } finally { restaurer(); }
});

test('anonyme (sans code_acces) reste refusé', async () => {
  const restaurer = poserEnv();
  poserFetchMock({});
  try {
    const { default: handler } = await import('../api/montage-render.js?t=' + Date.now());
    const req = { method: 'POST', body: { ...CORPS_MONTAGE } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
  } finally { restaurer(); }
});

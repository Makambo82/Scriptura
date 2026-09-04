// Décision du propriétaire : le carrousel a son PROPRE budget d'images,
// séparé de celui du montage vidéo (15 en Creator, 40 en Pro).
//
// LE CHIFFRE QUI A MOTIVÉ CETTE DÉCISION : partagés, un carrousel de 15
// slides aurait consommé 15 des 20 images mensuelles d'un Creator, soit 75%
// de son budget, et il ne lui serait plus rien resté pour le montage vidéo.
// Un abonné forcé d'arbitrer entre deux fonctions qu'il a déjà payées est un
// abonné qui résilie.
//
// CE QUE CES TESTS VERROUILLENT, et c'est une régression SILENCIEUSE si elle
// arrive : une génération de carrousel qui repartirait sur `montageImages`
// viderait le budget de montage sans que rien ne le signale, ni au créateur
// ni dans les journaux. Seule la clé envoyée au compteur serveur permet de
// le voir, on la vérifie donc directement.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  TOGETHER_API_KEY: 'cle-together-test',
  CODE_ADMIN: 'ADMIN-TEST-CARROUSEL'
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

// `rpcAppels` collecte le corps envoyé à consommer_usage : c'est là, et
// nulle part ailleurs, qu'on voit QUEL compteur est réellement décrémenté.
function poserFetchMock({ abonneRows, quotaOk = true, rpcAppels, usageRows }) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      if (rpcAppels && opts && opts.body) rpcAppels.push(JSON.parse(opts.body));
      return { ok: true, json: async () => quotaOk };
    }
    if (u.includes('/rest/v1/usage_serveur')) {
      return { ok: true, json: async () => (usageRows != null ? usageRows : []) };
    }
    if (u.includes('api.together.xyz/v1/images/generations')) {
      return { ok: true, json: async () => ({ data: [{ b64_json: 'ZmFrZS1pbWFnZQ==' }] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

async function appelerImages(body) {
  const { default: handler } = await import('../api/montage-media.js?t=' + Date.now() + Math.random());
  const req = { method: 'POST', query: { action: 'images' }, body };
  const res = creerRes();
  await handler(req, res);
  return res;
}

test('le carrousel décompte carrouselImages, JAMAIS le budget du montage vidéo', async () => {
  const restaurer = poserEnv();
  const rpcAppels = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], rpcAppels });
  try {
    const res = await appelerImages({
      code_acces: 'CODE-CREATOR',
      usage: 'carrousel',
      prompts: ['un portefeuille vide, aucune lettre 9:16'],
      format: '9:16'
    });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(rpcAppels.length, 1, 'un seul décompte pour le lot');
    const ref = JSON.stringify(rpcAppels[0]);
    assert.match(ref, /carrouselImages/,
      'REGRESSION SILENCIEUSE : le carrousel viderait le quota de montage vidéo sans que rien ne le signale : ' + ref);
    assert.doesNotMatch(ref, /montageImages/, 'et surtout pas celui du montage : ' + ref);
  } finally { restaurer(); }
});

test('le montage vidéo garde exactement son comportement d\'avant', async () => {
  const restaurer = poserEnv();
  const rpcAppels = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], rpcAppels });
  try {
    // Aucun `usage` transmis : c'est l'appel tel que le montage le fait
    // depuis toujours (js/montage.js), il ne doit rien changer.
    const res = await appelerImages({ code_acces: 'CODE-CREATOR', prompts: ['un chat 9:16'], format: '9:16' });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    const ref = JSON.stringify(rpcAppels[0]);
    assert.match(ref, /montageImages/,
      'REGRESSION : le montage doit continuer à décompter son propre budget : ' + ref);
    assert.doesNotMatch(ref, /carrouselImages/, ref);
  } finally { restaurer(); }
});

test('un usage inconnu retombe sur le montage, jamais sur un budget deviné', async () => {
  const restaurer = poserEnv();
  const rpcAppels = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }], rpcAppels });
  try {
    const res = await appelerImages({ code_acces: 'CODE-PRO', usage: 'nimporte-quoi', prompts: ['un chat 9:16'] });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.match(JSON.stringify(rpcAppels[0]), /montageImages/,
      'une valeur inattendue ne doit jamais ouvrir un budget par erreur');
  } finally { restaurer(); }
});

test('quota carrousel épuisé : refus explicite, et le message parle du carrousel', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], quotaOk: false });
  try {
    const res = await appelerImages({ code_acces: 'CODE-CREATOR', usage: 'carrousel', prompts: ['un chat'] });
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'QUOTA_ATTEINT');
    assert.match(res.corpsRecu.error.message, /carrousel/i,
      'un abonné à court d\'images de carrousel ne doit pas lire un message sur le montage vidéo : ' + res.corpsRecu.error.message);
  } finally { restaurer(); }
});

test('un non-abonné reste refusé, avec un message qui parle bien du carrousel', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ abonneRows: [] });
  try {
    const res = await appelerImages({ code_acces: 'CODE-INCONNU', usage: 'carrousel', prompts: ['un chat'] });
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ACCES_REFUSE');
    assert.match(res.corpsRecu.error.message, /carrousel/i, res.corpsRecu.error.message);
  } finally { restaurer(); }
});

test('les plafonds sont bien 15 en Creator et 40 en Pro, sans toucher au montage', async () => {
  const restaurer = poserEnv();
  try {
    const { LIMITES_MOIS } = await import('../api/_lib/acces.js?t=' + Date.now() + Math.random());
    assert.equal(LIMITES_MOIS.creator.carrouselImages, 15);
    assert.equal(LIMITES_MOIS.pro.carrouselImages, 40);
    // Les budgets du montage n'ont pas bougé d'un cheveu : c'est la garantie
    // que la séparation n'a rien pris à l'existant.
    assert.equal(LIMITES_MOIS.creator.montageImages, 20);
    assert.equal(LIMITES_MOIS.pro.montageImages, 60);
  } finally { restaurer(); }
});

test('la lecture du quota carrousel renvoie le vrai compteur serveur, pas un compteur local', async () => {
  const restaurer = poserEnv();
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }],
    usageRows: [{ used: 4 }]
  });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now() + Math.random());
    const req = { method: 'GET', query: { resource: 'quotaCarrousel', code: 'CODE-CREATOR' } };
    const res = creerRes();
    await handler(req, res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.concerne, true);
    assert.equal(res.corpsRecu.plafond, 15, 'le plafond du plan Creator');
    assert.equal(res.corpsRecu.used, 4,
      'REGRESSION : un compteur local repartirait à zéro à chaque rechargement et promettrait des images que le serveur refuserait ensuite');
  } finally { restaurer(); }
});

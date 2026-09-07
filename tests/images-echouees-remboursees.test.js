// Le quota d'images est réservé pour TOUT le lot AVANT de générer : c'est la
// seule façon de le décompter de façon atomique, et il faut bien décider
// avant de dépenser chez Together.
//
// Mais rien ne le rendait ensuite. Un lot de 8 fonds dont 3 échouent
// décomptait 8 images à un créateur qui n'en a reçu que 5. Il payait de son
// quota mensuel des images qu'il n'a jamais eues, sans aucun moyen de le
// savoir ni de les récupérer, et c'est typiquement ce qui finit en message
// furieux sur WhatsApp.
//
// LES TROIS PIÈGES DE CE GENRE DE CORRECTIF, et c'est ce que ces tests
// verrouillent, parce qu'ils fabriquent tous du quota à partir de rien :
//   1. rembourser les prompts VIDES, qui n'ont jamais été réservés ;
//   2. rembourser un compte ADMIN/illimité, dont le compteur n'a jamais bougé ;
//   3. rembourser un lot entièrement RÉUSSI.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  TOGETHER_API_KEY: 'cle-together-test',
  CODE_ADMIN: 'ADMIN-TEST-REMB'
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

// `echecs` : indices (dans l'ordre des appels à Together) qui doivent échouer.
// `remboursements` collecte ce qui part vers rembourser_usage : c'est la SEULE
// preuve directe que le quota est rendu, et de combien.
function poserFetchMock({ abonneRows, echecs = [], remboursements, consommations, quotaIndetermine }) {
  let appelImage = 0;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => (abonneRows != null ? abonneRows : []) };
    }
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      if (consommations && opts && opts.body) consommations.push(JSON.parse(opts.body));
      // Réponse non booléenne = indéterminé côté appelerRpc (fonction SQL pas
      // encore installée, ou panne) : le quota passe SANS rien décompter.
      return { ok: true, json: async () => (quotaIndetermine ? null : true) };
    }
    if (u.includes('/rest/v1/rpc/rembourser_usage')) {
      if (remboursements && opts && opts.body) remboursements.push(JSON.parse(opts.body));
      return { ok: true, json: async () => true };
    }
    if (u.includes('/rest/v1/usage_serveur')) {
      return { ok: true, json: async () => [] };
    }
    if (u.includes('api.together.xyz/v1/images/generations')) {
      const n = appelImage++;
      if (echecs.indexOf(n) !== -1) {
        return { ok: false, json: async () => ({ error: { message: 'panne simulée' } }) };
      }
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

test('les images qui échouent sont rendues au quota, pas facturées', async () => {
  const restaurer = poserEnv();
  const remboursements = [];
  const consommations = [];
  // CONCURRENCE : l'ordre d'arrivée chez Together n'est pas garanti, on ne
  // teste donc PAS quel prompt échoue, seulement COMBIEN.
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    echecs: [0, 1, 2],
    remboursements, consommations
  });
  try {
    const res = await appelerImages({
      code_acces: 'CODE-PRO',
      prompts: ['a 9:16', 'b 9:16', 'c 9:16', 'd 9:16', 'e 9:16', 'f 9:16', 'g 9:16', 'h 9:16'],
      format: '9:16'
    });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));

    assert.equal(consommations.length, 1, 'le lot reste réservé en UN seul appel atomique');
    assert.equal(consommations[0].p_increment, 8, 'les 8 prompts sont bien réservés d\'avance');

    const livrees = (res.corpsRecu.images || []).filter(Boolean).length;
    assert.equal(livrees, 5, 'cinq images livrées sur huit demandées');

    assert.equal(remboursements.length, 1,
      'REGRESSION : aucun remboursement. Le créateur perd 3 images de son quota mensuel pour des '
      + 'images qu\'il n\'a jamais reçues, sans aucun moyen de le savoir.');
    assert.equal(remboursements[0].p_montant, 3,
      'REGRESSION : le montant rendu ne correspond pas aux échecs. Rendu : '
      + JSON.stringify(remboursements[0]));
    assert.match(String(remboursements[0].p_ref), /montageImages/,
      'le remboursement doit viser le MÊME compteur que la réservation, sinon il part dans le vide : '
      + remboursements[0].p_ref);
  } finally { restaurer(); }
});

test('un lot entièrement réussi ne rembourse rien', async () => {
  const restaurer = poserEnv();
  const remboursements = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }], remboursements });
  try {
    const res = await appelerImages({ code_acces: 'CODE-PRO', prompts: ['a 9:16', 'b 9:16'], format: '9:16' });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(remboursements.length, 0,
      'REGRESSION : un lot sans le moindre échec rend quand même du quota. C\'est du quota fabriqué à '
      + 'partir de rien, et il se cumulerait à chaque génération réussie.');
  } finally { restaurer(); }
});

test('un prompt vide n\'est ni facturé ni remboursé', async () => {
  const restaurer = poserEnv();
  const remboursements = [];
  const consommations = [];
  poserFetchMock({ abonneRows: [{ actif: true, plan: 'creator', jetons_audit: 0 }], remboursements, consommations });
  try {
    // Deux prompts réels, deux vides : le carrousel en envoie couramment,
    // les slides sans fond à générer.
    const res = await appelerImages({
      code_acces: 'CODE-CREATOR', usage: 'carrousel',
      prompts: ['a 9:16', '', 'b 9:16', ''], format: '9:16'
    });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(consommations[0].p_increment, 2,
      'seuls les prompts non vides sont réservés, comme avant');
    assert.equal(remboursements.length, 0,
      'REGRESSION : les prompts vides sont remboursés alors qu\'ils n\'ont jamais été réservés. Chaque '
      + 'slide sans fond fabriquerait du quota, et un carrousel de 15 slides dont 13 vides en '
      + 'fabriquerait 13 d\'un coup.');
  } finally { restaurer(); }
});

// LE CAS QUE `quota.consomme` PROTÈGE VRAIMENT, et il n'est pas évident :
// quand la fonction SQL est absente ou en panne, le quota est accordé PAR
// DÉGRADATION, sans rien décompter (voir verifierQuota, api/_lib/acces.js).
// L'abonné a un plan reconnu et la clé service est là, donc rien dans
// rembourserUsage ne l'arrêterait : sans ce garde-fou, une panne du compteur
// se mettrait à RENDRE du quota jamais pris, et à chaque lot en échec. Le
// compteur repartirait à zéro tout seul, silencieusement.
test('quota accordé par dégradation : rien n\'est décompté, donc rien n\'est rendu', async () => {
  const restaurer = poserEnv();
  const remboursements = [];
  const consommations = [];
  poserFetchMock({
    abonneRows: [{ actif: true, plan: 'pro', jetons_audit: 0 }],
    echecs: [0, 1], quotaIndetermine: true,
    remboursements, consommations
  });
  try {
    const res = await appelerImages({
      code_acces: 'CODE-PRO', prompts: ['a 9:16', 'b 9:16', 'c 9:16'], format: '9:16'
    });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(consommations.length, 1, 'la tentative de décompte a bien eu lieu');
    assert.equal(remboursements.length, 0,
      'REGRESSION : le quota est rendu alors que rien n\'a été décompté (compteur en panne, accès '
      + 'accordé par dégradation). Chaque lot en échec ferait alors DESCENDRE un compteur déjà à '
      + 'l\'arrêt, et le quota se rechargerait tout seul sans que personne ne le voie.');
  } finally { restaurer(); }
});

test('un compte admin, dont le compteur n\'a jamais bougé, n\'est jamais remboursé', async () => {
  const restaurer = poserEnv();
  const remboursements = [];
  const consommations = [];
  poserFetchMock({ abonneRows: [], echecs: [0, 1], remboursements, consommations });
  try {
    const res = await appelerImages({
      code_acces: ENV_BASE.CODE_ADMIN,
      prompts: ['a 9:16', 'b 9:16', 'c 9:16'], format: '9:16'
    });
    assert.equal(res.statutRecu, 200, JSON.stringify(res.corpsRecu));
    assert.equal(consommations.length, 0, 'un admin ne consomme aucun quota, c\'est le point de départ');
    assert.equal(remboursements.length, 0,
      'REGRESSION : on rembourse un compte qui n\'a jamais rien consommé. Le compteur partirait en '
      + 'négatif, ou rendrait du quota à un autre compte partageant la référence.');
  } finally { restaurer(); }
});

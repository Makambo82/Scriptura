// AUDIT A20 — Tests de sécurité dédiés au correctif de /api/patterns.
//
// La route n'avait AUCUNE vérification d'identité ni de rate-limit avant ce
// correctif (seul le score recalculé, voir tests/patterns-score-securise.test.js,
// protégeait contre un score fabriqué). Un script pouvait appeler
// POST /api/patterns en boucle, avec des signaux tous à `true` (score
// garanti au-dessus du seuil), pour noyer la mémoire virale partagée sous
// de faux leviers, sans jamais être ralenti.
//
// DÉCISION DE PÉRIMÈTRE (à documenter dans le rapport final) : « Analyser
// une vidéo virale » reste accessible SANS code d'accès (1 analyse gratuite
// à vie, voir MODES_GRATUIT_UNIQUE, api/_lib/acces.js) — exiger un
// abonnement pour /api/patterns casserait donc un dépôt légitime venant
// d'un visiteur non-abonné. Le correctif réutilise verifierLimiteAnonyme
// (même filet IP + jour que /api/verify-code, /api/generate...) plutôt que
// d'exiger une authentification complète : un appel anonyme OCCASIONNEL
// reste accepté (comportement voulu), seul un VOLUME anormal depuis la même
// IP est bloqué. C'est pourquoi ces tests vérifient la LIMITATION plutôt
// qu'un simple refus 401/403 systématique de tout appel anonyme.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

const SIGNAUX_COMPLETS = {
  hook_fort: true, boucle_ouverte: true, cliffhanger: true, deuxieme_personne: true,
  details_concrets: true, escalade: true, question_rhetorique: true, archetypes: true,
  appel_action: true, angle_original: true, sujet_precis: true, authenticite: true,
  hook_visuel: true, execution_visuelle: true
};

async function appeler(body, headers = {}) {
  const handlerModule = await import(path.join(__dirname, '..', 'api', 'patterns.js') + '?t=' + Date.now() + '-' + Math.random());
  const handler = handlerModule.default;
  const res = mockRes();
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://supabase-test.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Simule le compteur RÉEL de consommer_usage (usage_serveur) : incrémente
// tant que sous le plafond, renvoie false une fois dépassé, exactement le
// contrat utilisé par verifierLimiteAnonyme.
function poserFetchAvecCompteur(plafond) {
  const appelsEcriture = [];
  let used = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = url.toString();
    if (u.includes('/rest/v1/rpc/consommer_usage')) {
      used += 1;
      return { ok: true, json: async () => (used <= plafond) };
    }
    if (u.includes('/rest/v1/patterns_viraux')) {
      appelsEcriture.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };
  return { appelsEcriture, restaurer: () => { global.fetch = fetchOriginal; } };
}

test('A20-1 : un appel anonyme OCCASIONNEL (sous le plafond) fonctionne normalement, comme pour un visiteur sans code', async () => {
  poserEnv();
  const { appelsEcriture, restaurer } = poserFetchAvecCompteur(20);
  try {
    const r = await appeler({ niche: 'finance', hook_technique: 'question choc', signaux: SIGNAUX_COMPLETS, frameDisponible: true });
    assert.equal(r._json?.ok, true, 'un dépôt anonyme légitime (1 analyse gratuite à vie) ne doit pas être bloqué : ' + JSON.stringify(r._json));
    assert.equal(appelsEcriture.length, 1);
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A20-2 : le spam répété depuis la même IP est limité une fois le plafond du jour dépassé', async () => {
  poserEnv();
  const PLAFOND = 20;
  const { appelsEcriture, restaurer } = poserFetchAvecCompteur(PLAFOND);
  try {
    let derniereReponse;
    for (let i = 0; i < PLAFOND + 5; i++) {
      derniereReponse = await appeler({ niche: 'finance', hook_technique: 'x', signaux: SIGNAUX_COMPLETS, frameDisponible: true });
    }
    assert.equal(derniereReponse._json?.ok, false, 'au-delà du plafond, le dépôt doit être refusé : ' + JSON.stringify(derniereReponse._json));
    assert.equal(derniereReponse._json?.raison, 'limite_anonyme');
    assert.equal(appelsEcriture.length, PLAFOND, 'exactement le plafond de dépôts doit avoir atteint Supabase, jamais plus : ' + appelsEcriture.length);
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A20-3 : un abonné (code_acces valide) reste fonctionnel, même filet que l\'anonyme (pas de double système)', async () => {
  poserEnv();
  const { appelsEcriture, restaurer } = poserFetchAvecCompteur(20);
  try {
    const r = await appeler({ niche: 'cuisine', hook_technique: 'promesse', signaux: SIGNAUX_COMPLETS, frameDisponible: true, code_acces: 'UNABO1N2' });
    assert.equal(r._json?.ok, true, JSON.stringify(r._json));
    assert.equal(appelsEcriture.length, 1);
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A20-4 : un payload sans signaux valides est rejeté proprement (jamais de plantage, jamais d\'écriture)', async () => {
  poserEnv();
  const { appelsEcriture, restaurer } = poserFetchAvecCompteur(20);
  try {
    for (const body of [
      {}, // rien du tout
      { signaux: null },
      { signaux: 'pas-un-objet' },
      { niche: 12345, hook_technique: { objet: true }, signaux: {} }
    ]) {
      const r = await appeler(body);
      assert.equal(r._status, 200, 'jamais de plantage HTTP sur un payload invalide : ' + JSON.stringify(body));
      assert.equal(r._json?.ok, false, 'un payload sans signaux valides ne doit jamais passer le garde-fou : ' + JSON.stringify(r._json));
    }
    assert.equal(appelsEcriture.length, 0, 'aucune insertion ne doit avoir lieu pour ces payloads invalides : ' + JSON.stringify(appelsEcriture));
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A20-4bis : des sous-champs malformés (leviers/principes/squelette pas des tableaux) sont ignorés sans planter, quand les signaux, eux, sont réels', async () => {
  poserEnv();
  const { appelsEcriture, restaurer } = poserFetchAvecCompteur(20);
  try {
    const r = await appeler({
      niche: 12345, hook_technique: { objet: true },
      leviers: 'pas-un-tableau', principes: 12345, squelette: { pas: 'un tableau' },
      signaux: SIGNAUX_COMPLETS, frameDisponible: true
    });
    assert.equal(r._status, 200);
    assert.equal(r._json?.ok, true, 'des signaux réellement complets doivent quand même passer le garde-fou : ' + JSON.stringify(r._json));
    assert.equal(appelsEcriture.length, 1);
    const ligne = appelsEcriture[0];
    assert.deepEqual(ligne.leviers, [], 'un champ leviers malformé doit être ignoré, jamais planter : ' + JSON.stringify(ligne));
    assert.deepEqual(ligne.principes, []);
    assert.deepEqual(ligne.squelette, []);
    assert.equal(ligne.niche, null, 'un niche non-string doit être ignoré, jamais planter');
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A20-5 : une insertion légitime (score réel au-dessus du seuil) est toujours enregistrée, longueurs bornées', async () => {
  poserEnv();
  const { appelsEcriture, restaurer } = poserFetchAvecCompteur(20);
  try {
    const r = await appeler({
      niche: 'finance personnelle',
      hook_technique: 'question choc',
      leviers: Array.from({ length: 50 }, (_, i) => 'levier-' + i), // au-delà de la limite (12)
      principes: Array.from({ length: 20 }, (_, i) => ({ titre: 't' + i, detail: 'd'.repeat(500) })),
      squelette: Array.from({ length: 20 }, (_, i) => ({ temps: '0-' + i + 's', titre: 'titre' + i })),
      signaux: SIGNAUX_COMPLETS,
      frameDisponible: true
    });
    assert.equal(r._json?.ok, true, JSON.stringify(r._json));
    assert.equal(appelsEcriture.length, 1, 'un dépôt légitime doit toujours être enregistré : ' + JSON.stringify(appelsEcriture));
    const ligne = appelsEcriture[0];
    assert.ok(ligne.leviers.length <= 12, 'les leviers doivent rester bornés : ' + ligne.leviers.length);
    assert.ok(ligne.principes.length <= 6, 'les principes doivent rester bornés : ' + ligne.principes.length);
    assert.ok(ligne.squelette.length <= 8, 'le squelette doit rester borné : ' + ligne.squelette.length);
  } finally {
    restaurer();
    retirerEnv();
  }
});

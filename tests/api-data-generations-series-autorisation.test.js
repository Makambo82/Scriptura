// LOT 4B, AUDIT ID 5 (Gate Phase 2B) — /api/data.js, resource=generations|series|profil.
//
// Avant ce correctif : handleGenerations/handleSeries/handleProfil ne
// vérifiaient QUE « code non vide », jamais que l'appelant était réellement
// autorisé pour CE code précis (aucun appel à resoudreDroits nulle part).
//
// CE QUE CE CORRECTIF FERME RÉELLEMENT (voir verifierAppelantAutoriseGenerationsSeries,
// api/data.js) :
//  1. un compte désactivé ou expiré (droits.ok === false) perd l'accès à SON
//     PROPRE historique, exactement comme il perd déjà l'accès à une
//     génération (api/generate.js) ou au montage - même si le code lui-même
//     est parfaitement connu/correct.
//  2. un filet IP journalier (PLAFOND_LECTURE_CROISEE_JOUR) rend un essai
//     automatisé de nombreux codes différents depuis une même IP impraticable.
//
// CE QUE CE CORRECTIF NE FERME PAS, ASSUMÉ ET DOCUMENTÉ DANS LE RAPPORT DE CE
// LOT : Scriptura n'a AUCUNE session séparée du code_acces lui-même (c'est le
// modèle d'accès de toute l'app, pas une négligence de cette route). Un tiers
// qui connaît DÉJÀ un code_acces réel et ACTIF (fuite, ingénierie sociale)
// garde donc un accès en lecture à l'historique associé : aucune primitive
// existante ne permet de distinguer « le titulaire légitime du code » d'
// « un tiers qui a appris ce même code », et en inventer une (session, mot
// de passe) sort du périmètre de ce lot (interdiction explicite de remplacer
// l'authentification de Scriptura). Ce test ne prétend donc PAS prouver
// qu'un code actif tiers connu est bloqué : ce serait un test malhonnête vu
// ce qui précède. Il prouve exactement les deux mécanismes listés ci-dessus.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST'
};

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  return res;
}

function creerReq({ method, query, body, ip = '1.2.3.4' }) {
  return { method, query: query || {}, body: body || {}, headers: { 'x-forwarded-for': ip } };
}

// Simule Supabase pour /rest/v1/abonnes (resoudreDroits), /rest/v1/rpc/consommer_usage
// (verifierLimiteAnonyme, filet IP) et /rest/v1/generations|series|profils_createurs
// (les vraies données). `comptes` : { CODE: {actif, plan, expire_le} }.
function poserFetchMock({ comptes = {}, plafondIp = 300 } = {}) {
  const generations = [];
  const series = [];
  let compteurIp = 0;
  let idAuto = 1;

  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = (opts.method || 'GET').toUpperCase();

    if (u.pathname === '/rest/v1/abonnes') {
      const codeParam = u.searchParams.get('code') || '';
      const code = codeParam.replace(/^eq\./, '');
      const compte = comptes[code];
      return { ok: true, json: async () => (compte ? [compte] : []) };
    }

    if (u.pathname === '/rest/v1/rpc/consommer_usage') {
      compteurIp++;
      return { ok: true, json: async () => compteurIp <= plafondIp };
    }

    if (u.pathname === '/rest/v1/generations') {
      if (method === 'HEAD') {
        const code = (u.searchParams.get('code_acces') || '').replace(/^eq\./, '');
        const n = generations.filter(g => g.code_acces === code).length;
        return { ok: true, headers: { get: (h) => h === 'content-range' ? ('0-0/' + n) : null } };
      }
      if (method === 'GET') {
        const code = (u.searchParams.get('code_acces') || '').replace(/^eq\./, '');
        const idParam = u.searchParams.get('id');
        let rows = generations.filter(g => g.code_acces === code);
        if (idParam) { const id = idParam.replace(/^eq\./, ''); rows = generations.filter(g => String(g.id) === id); }
        return { ok: true, json: async () => rows };
      }
      if (method === 'POST') {
        const corps = JSON.parse(opts.body);
        const ligne = { id: idAuto++, ...corps };
        generations.push(ligne);
        return { ok: true, json: async () => [ligne] };
      }
      if (method === 'PATCH' || method === 'DELETE') {
        // Deux formes réelles : soit id=eq.<id> SEUL (action=patch/save-regen,
        // l'appartenance a déjà été vérifiée en amont par
        // ligneGenerationAppartientA, pas de re-filtre code_acces ici), soit
        // code_acces=eq.<code>&id=in.(...) (action=favori/delete, le filtre
        // PostgREST fait la double vérification en une requête).
        const idParam = u.searchParams.get('id') || '';
        const codeParam = u.searchParams.has('code_acces') ? (u.searchParams.get('code_acces') || '').replace(/^eq\./, '') : null;
        let ids;
        const mIn = /^in\.\((.*)\)$/.exec(idParam);
        if (mIn) ids = mIn[1].split(',').map(decodeURIComponent);
        else ids = [idParam.replace(/^eq\./, '')];
        const corps = method === 'PATCH' ? JSON.parse(opts.body) : null;
        for (const g of generations) {
          if (ids.includes(String(g.id)) && (codeParam === null || g.code_acces === codeParam)) {
            if (method === 'PATCH') Object.assign(g, corps);
          }
        }
        if (method === 'DELETE') {
          for (let i = generations.length - 1; i >= 0; i--) {
            const g = generations[i];
            if (ids.includes(String(g.id)) && (codeParam === null || g.code_acces === codeParam)) generations.splice(i, 1);
          }
        }
        return { ok: true, json: async () => [] };
      }
    }

    if (u.pathname === '/rest/v1/series') {
      if (method === 'GET') {
        const code = (u.searchParams.get('code_acces') || '').replace(/^eq\./, '');
        return { ok: true, json: async () => series.filter(s => s.code_acces === code) };
      }
      if (method === 'POST') {
        const corps = JSON.parse(opts.body);
        const ligne = { id: idAuto++, ...corps };
        series.push(ligne);
        return { ok: true, json: async () => [ligne] };
      }
    }

    if (u.pathname === '/rest/v1/profils_createurs') {
      return { ok: true, json: async () => [] };
    }

    return { ok: true, json: async () => ({}) };
  };

  return { generations, series };
}

async function importerHandler() {
  const { default: handler } = await import('../api/data.js?t=' + Date.now());
  return handler;
}

test('1. un compte actif accède à ses PROPRES générations (list/count/last) => OK', async () => {
  const restaurer = poserEnv();
  const { generations } = poserFetchMock({ comptes: { 'CODE-A': { actif: true, plan: 'creator', jetons_audit: 0 } } });
  generations.push({ id: 1, code_acces: 'CODE-A', mode: 'creation', titre: 'x', contenu: {}, cree_le: '2026-01-01' });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'list', code: 'CODE-A' } }), res);
    assert.equal(res.statutRecu, 200);
    assert.equal(res.corpsRecu.ok, true);
    assert.equal(res.corpsRecu.data.length, 1, 'un compte actif doit voir SA propre génération');
  } finally { restaurer(); }
});

test('2. compte DÉSACTIVÉ : refusé sur generations ET series, même avec le code exact et correct', async () => {
  const restaurer = poserEnv();
  const { generations } = poserFetchMock({ comptes: { 'CODE-B': { actif: false, plan: 'creator', jetons_audit: 0 } } });
  generations.push({ id: 1, code_acces: 'CODE-B', mode: 'creation', titre: 'x', contenu: {}, cree_le: '2026-01-01' });
  try {
    const handler = await importerHandler();
    const resGen = creerRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'list', code: 'CODE-B' } }), resGen);
    assert.equal(resGen.statutRecu, 403, 'un compte désactivé ne doit plus accéder à son propre historique, comme pour toute autre route payante');
    assert.equal(resGen.corpsRecu.ok, false);

    const resSerie = creerRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'series', action: 'list', code: 'CODE-B' } }), resSerie);
    assert.equal(resSerie.statutRecu, 403);
  } finally { restaurer(); }
});

test('3. abonnement EXPIRÉ : refusé de la même façon', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ comptes: { 'CODE-C': { actif: true, plan: 'pro', jetons_audit: 0, expire_le: '2020-01-01' } } });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'count', code: 'CODE-C', type: 'creation' } }), res);
    assert.equal(res.statutRecu, 403);
    assert.equal(res.corpsRecu.error.code, 'ABONNEMENT_EXPIRE');
  } finally { restaurer(); }
});

test('4. code vide => refusé (comportement déjà existant, inchangé)', async () => {
  const restaurer = poserEnv();
  poserFetchMock();
  try {
    const handler = await importerHandler();
    const resGet = creerRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'list', code: '' } }), resGet);
    assert.equal(resGet.corpsRecu.ok, false);
    assert.deepEqual(resGet.corpsRecu.data, []);

    const resPost = creerRes();
    await handler(creerReq({ method: 'POST', body: { resource: 'generations', action: 'save', code: '', mode: 'creation', contenu: {} } }), resPost);
    assert.equal(resPost.statutRecu, 400);
  } finally { restaurer(); }
});

test('5. paramètres manipulés (code non-chaîne, ex. tableau) => traité comme non autorisé, jamais un contournement', async () => {
  const restaurer = poserEnv();
  poserFetchMock({ comptes: { 'CODE-A': { actif: true, plan: 'creator', jetons_audit: 0 } } });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    // Un tableau ['CODE-A'] est TRUTHY en JS (le garde-fou "if (!code)" ne
    // l'arrête pas), mais ne doit jamais atteindre resoudreDroits/Supabase
    // avec une valeur qui n'est PAS la chaîne attendue et pourrait fabriquer
    // une URL Supabase inattendue.
    await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'list', code: ['CODE-A', 'CODE-B'] } }), res);
    // Le comportement attendu est un refus propre (403) ou un traitement sûr
    // (jamais une exception non gérée, jamais les données d'un autre code).
    assert.notEqual(res.statutRecu, 500, 'une valeur manipulée ne doit jamais faire planter la route');
  } finally { restaurer(); }
});

test('6. essais automatisés de nombreux codes différents depuis UNE IP => bloqués au-delà du plafond journalier', async () => {
  const restaurer = poserEnv();
  const comptes = {};
  for (let i = 0; i < 5; i++) comptes['GUESS' + i] = { actif: true, plan: 'creator', jetons_audit: 0 };
  poserFetchMock({ comptes, plafondIp: 3 });
  try {
    const handler = await importerHandler();
    const statuts = [];
    for (let i = 0; i < 5; i++) {
      const res = creerRes();
      await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'count', code: 'GUESS' + i, type: 'creation' } }), res);
      statuts.push(res.statutRecu);
    }
    assert.equal(statuts.slice(0, 3).every(s => s === 200), true, 'les 3 premiers essais (sous le plafond) doivent passer');
    assert.equal(statuts.slice(3).every(s => s === 429), true, 'au-delà du plafond IP, tout nouveau code essayé doit être bloqué, qu\'il soit valide ou non');
  } finally { restaurer(); }
});

test('7. opérations légitimes existantes (save/patch/favori/delete) restent OK pour un compte actif', async () => {
  const restaurer = poserEnv();
  const { generations } = poserFetchMock({ comptes: { 'CODE-A': { actif: true, plan: 'creator', jetons_audit: 0 } } });
  try {
    const handler = await importerHandler();

    const resSave = creerRes();
    await handler(creerReq({ method: 'POST', body: { resource: 'generations', action: 'save', code: 'CODE-A', mode: 'creation', titre: 't', contenu: { a: 1 } } }), resSave);
    assert.equal(resSave.corpsRecu.ok, true);
    const id = resSave.corpsRecu.id;

    const resPatch = creerRes();
    await handler(creerReq({ method: 'POST', body: { resource: 'generations', action: 'patch', code: 'CODE-A', id, champs: { b: 2 } } }), resPatch);
    assert.equal(resPatch.corpsRecu.ok, true);
    assert.equal(generations.find(g => g.id === id).contenu.b, 2);

    const resFavori = creerRes();
    await handler(creerReq({ method: 'POST', body: { resource: 'generations', action: 'favori', code: 'CODE-A', ids: [id], valeur: true } }), resFavori);
    assert.equal(resFavori.corpsRecu.ok, true);

    const resDelete = creerRes();
    await handler(creerReq({ method: 'POST', body: { resource: 'generations', action: 'delete', code: 'CODE-A', ids: [id] } }), resDelete);
    assert.equal(resDelete.corpsRecu.ok, true);
    assert.equal(generations.length, 0);
  } finally { restaurer(); }
});

test('8. aucune régression sur l\'historique existant : visiteur anonyme (identifiant local anon_...) garde son historique gratuit', async () => {
  const restaurer = poserEnv();
  // Un identifiant anon_... n'existe JAMAIS dans `abonnes` (aucune ligne
  // créée pour lui) : c'est le cas `codeInconnu` de resoudreDroits, qui doit
  // rester `ok:true` pour ne pas casser l'historique des générations
  // gratuites, la fonctionnalité la plus utilisée par un nouveau visiteur.
  const { generations } = poserFetchMock({ comptes: {} });
  const codeAnonyme = 'anon_1735689600000_ab12cd';
  generations.push({ id: 1, code_acces: codeAnonyme, mode: 'creation', titre: 'x', contenu: {}, cree_le: '2026-01-01' });
  try {
    const handler = await importerHandler();
    const res = creerRes();
    await handler(creerReq({ method: 'GET', query: { resource: 'generations', action: 'list', code: codeAnonyme } }), res);
    assert.equal(res.statutRecu, 200, 'un visiteur non-abonné (identifiant local anon_...) ne doit jamais être bloqué par le correctif ID5');
    assert.equal(res.corpsRecu.data.length, 1);
  } finally { restaurer(); }
});

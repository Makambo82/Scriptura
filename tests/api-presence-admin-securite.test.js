// AUDIT A19 — Tests de sécurité dédiés au correctif.
//
// Faille corrigée : la table `presence` (supabase/presence.sql) était
// lisible en clair par le rôle anon (RLS grande ouverte, `using(true)`), et
// `ref` vaut le CODE D'ACCÈS brut de l'abonné connecté (voir getUserRef,
// js/api.js, et envoyerPresence, js/app.js). N'importe qui, avec la seule
// clé publique déjà présente dans le JS servi, pouvait lister tous les
// codes d'accès actuellement en ligne (`abonne=true`) : une usurpation de
// compte payant sans mot de passe, en une seule requête.
//
// Correctif : RLS anon fermée en lecture ET écriture (supabase/presence_rls.sql),
// écriture de présence passée sur SUPABASE_SERVICE_ROLE_KEY (handlePresence),
// lecture réservée à une route serveur authentifiée réservée au fondateur
// (handlePresenceAdmin, resource=presence-admin, vérifie droits.isAdmin) qui
// ne renvoie jamais `ref` ni de date brute, seulement des booléens/comptes/
// pays-navigateur dérivés.
//
// Les quatre tests ci-dessous correspondent un à un aux quatre exigences du
// correctif : requête anonyme interdite, utilisateur autorisé toujours
// fonctionnel, aucune fuite de code d'accès, impossibilité d'énumérer les
// utilisateurs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

async function appeler(body, headers = {}) {
  const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now() + '-' + Math.random());
  const handler = handlerModule.default;
  const res = mockRes();
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

// Fetch factice : ne suit QUE les appels vers /rest/v1/presence (ce qu'on
// cherche à protéger), renvoie une réponse neutre pour tout le reste
// (résolution du code_acces via /rest/v1/abonnes, generations, etc.) pour
// que resoudreDroits() se termine sans jamais dépendre d'une vraie base.
function poserFetchPresence() {
  const appels = { presence: [] };
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url.toString());
    if (u.pathname === '/rest/v1/presence') {
      appels.presence.push({ url: u.toString(), opts });
      const select = u.searchParams.get('select') || '';
      // Reflète ce que PostgREST renverrait réellement pour chaque `select`
      // demandé par handlePresenceAdmin (le serveur ne fait AUCUN filtrage de
      // champs lui-même, c'est Supabase qui ne renvoie que les colonnes
      // demandées) : un mock qui renverrait `ref` pour un `select=pays,
      // navigateur` fausserait le test en simulant une fuite qui n'existe
      // pas côté vrai Supabase.
      const lignes = select === 'pays,navigateur'
        ? [{ pays: 'CI', navigateur: 'Safari mobile' }, { pays: 'SN', navigateur: 'Chrome' }]
        : [
            { ref: 'A3M8', derniere_activite: new Date().toISOString() },
            { ref: 'B7X2', derniere_activite: new Date(Date.now() - 3600_000).toISOString() }
          ];
      return {
        ok: true, status: 200,
        json: async () => lignes,
        headers: { get: (h) => h.toLowerCase() === 'content-range' ? '*/' + lignes.length : null }
      };
    }
    return { ok: true, status: 200, json: async () => ([]), headers: { get: () => null } };
  };
  return { appels, restaurer: () => { global.fetch = fetchOriginal; } };
}

function poserEnv() {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.CODE_ADMIN = 'SCRIPTURA-CELINE';
}
function retirerEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CODE_ADMIN;
}

test('A19-1 : une requête anonyme (ou un code d\'abonné ordinaire) sur presence-admin est refusée, jamais les données', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchPresence();
  try {
    for (const action of ['statuts', 'compte-non-abonnes', 'detail-non-abonnes']) {
      const sansCode = await appeler({ resource: 'presence-admin', action, codes: ['A3M8'] });
      assert.equal(sansCode._status, 403, `sans code_acces, action=${action} doit être refusée (403) : ` + JSON.stringify(sansCode._json));
      assert.equal(sansCode._json?.ok, false);

      const codeOrdinaire = await appeler({ resource: 'presence-admin', action, codes: ['A3M8'], code_acces: 'A3M8' });
      assert.equal(codeOrdinaire._status, 403, `un code d'abonné ordinaire ne doit pas accéder à action=${action} : ` + JSON.stringify(codeOrdinaire._json));
      assert.equal(codeOrdinaire._json?.ok, false);
    }
    assert.equal(appels.presence.length, 0, 'aucune requête Supabase vers `presence` ne doit partir sans autorisation admin : ' + JSON.stringify(appels.presence));
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A19-2 : le fondateur (code_acces == CODE_ADMIN) peut toujours effectuer les trois opérations légitimes', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchPresence();
  try {
    const statuts = await appeler({ resource: 'presence-admin', action: 'statuts', codes: ['A3M8', 'B7X2'], code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(statuts._status, 200);
    assert.equal(statuts._json?.ok, true, JSON.stringify(statuts._json));
    assert.ok(statuts._json.parCode, 'parCode doit être présent : ' + JSON.stringify(statuts._json));

    const compte = await appeler({ resource: 'presence-admin', action: 'compte-non-abonnes', code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(compte._status, 200);
    assert.equal(compte._json?.ok, true, JSON.stringify(compte._json));

    const detail = await appeler({ resource: 'presence-admin', action: 'detail-non-abonnes', code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(detail._status, 200);
    assert.equal(detail._json?.ok, true, JSON.stringify(detail._json));

    assert.ok(appels.presence.length >= 3, 'les trois actions doivent bien interroger `presence` côté serveur pour un fondateur authentifié : ' + appels.presence.length);
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A19-3 : aucune fuite de code d\'accès ni de date brute dans les réponses presence-admin', async () => {
  poserEnv();
  const { restaurer } = poserFetchPresence();
  try {
    const statuts = await appeler({ resource: 'presence-admin', action: 'statuts', codes: ['A3M8', 'B7X2'], code_acces: 'SCRIPTURA-CELINE' });
    const texteStatuts = JSON.stringify(statuts._json);
    for (const cle of Object.keys(statuts._json.parCode || {})) {
      assert.equal(typeof statuts._json.parCode[cle], 'boolean', 'chaque valeur doit être un simple booléen, jamais une date ou un objet : ' + texteStatuts);
    }
    assert.ok(!/derniere_activite/.test(texteStatuts), 'aucun horodatage brut ne doit sortir de cette route : ' + texteStatuts);

    const compte = await appeler({ resource: 'presence-admin', action: 'compte-non-abonnes', code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(typeof compte._json.count, 'number', 'compte-non-abonnes ne doit renvoyer qu\'un nombre : ' + JSON.stringify(compte._json));
    assert.ok(!('parCode' in compte._json) && !('data' in compte._json), 'aucune liste de codes ne doit accompagner le compte : ' + JSON.stringify(compte._json));

    const detail = await appeler({ resource: 'presence-admin', action: 'detail-non-abonnes', code_acces: 'SCRIPTURA-CELINE' });
    const texteDetail = JSON.stringify(detail._json);
    assert.ok(!/\bref\b/.test(texteDetail), 'le détail pays/navigateur ne doit jamais inclure `ref` (le code d\'accès) : ' + texteDetail);
    assert.ok(!/A3M8|B7X2/.test(texteDetail), 'aucun code d\'accès ne doit apparaître en clair dans le détail : ' + texteDetail);
  } finally {
    restaurer();
    retirerEnv();
  }
});

test('A19-4 : impossible d\'énumérer les abonnés, ni via un accès non autorisé, ni via une liste de codes forgée', async () => {
  poserEnv();
  const { appels, restaurer } = poserFetchPresence();
  try {
    // Un attaquant sans droits ne peut pas se servir d'une grosse liste de
    // codes devinés pour sonder qui existe : l'authentification bloque
    // avant même de lire le payload utile.
    const codesDevines = Array.from({ length: 50 }, (_, i) => 'CODE' + i);
    const tentative = await appeler({ resource: 'presence-admin', action: 'statuts', codes: codesDevines });
    assert.equal(tentative._status, 403, 'une liste de codes forgée ne doit pas contourner l\'authentification : ' + JSON.stringify(tentative._json));
    assert.equal(appels.presence.length, 0, 'aucune requête ne doit partir vers `presence` pour une tentative non authentifiée');

    // Même pour le fondateur, la liste envoyée à Supabase reste bornée
    // (PRESENCE_ADMIN_MAX_CODES) : pas de balayage massif en un seul appel.
    const enorme = Array.from({ length: 900 }, (_, i) => 'CODE' + i);
    const statuts = await appeler({ resource: 'presence-admin', action: 'statuts', codes: enorme, code_acces: 'SCRIPTURA-CELINE' });
    assert.equal(statuts._status, 200);
    const dernierAppel = appels.presence[appels.presence.length - 1];
    const nbCodesEnvoyes = (decodeURIComponent(dernierAppel.url).match(/CODE\d+/g) || []).length;
    assert.ok(nbCodesEnvoyes <= 500, 'la requête Supabase doit rester bornée même pour une très grosse liste : ' + nbCodesEnvoyes);

    // La route d'écriture publique (`resource: 'presence'`) ne renvoie
    // jamais de données, seulement un booléen de succès : impossible de
    // s'en servir pour lire l'état de qui que ce soit.
    const ecriture = await appeler({ resource: 'presence', ref: 'anon_test', abonne: false });
    assert.deepEqual(Object.keys(ecriture._json || {}), ['ok'], 'la route d\'écriture ne doit jamais exposer de données : ' + JSON.stringify(ecriture._json));
  } finally {
    restaurer();
    retirerEnv();
  }
});

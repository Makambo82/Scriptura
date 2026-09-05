// BUG SIGNALÉ PAR LE PROPRIÉTAIRE : « je viens de faire une génération avec
// un compte creator et ça n'est pas marqué dans creator », avec la vraie
// question derrière : « je me demande même si le tableau est bien configuré
// pour faire le travail demandé ».
//
// La réponse honnête était NON, et pour deux raisons distinctes.
//
// 1. LE PLAN N'ÉTAIT PAS NORMALISÉ. Le code d'accès l'était déjà (correctif
//    précédent : une ligne `abonnes` créée à la main en casse mixte). Le
//    PLAN, lui, était recopié brut puis comparé strictement à 'creator' /
//    'pro'. Un plan enregistré "Creator", "CREATOR" ou "creator " (espace
//    final invisible) ne matchait donc rien, et TOUTES les générations de cet
//    abonné disparaissaient du tableau. api/verify-code.js normalise déjà ce
//    même champ avec .trim().toLowerCase(), précisément parce que le cas
//    existe : c'est ici qu'on avait oublié de le faire.
//
// 2. LE TABLEAU AVAIT UN TROU PAR CONSTRUCTION. Toute génération qui n'était
//    ni fondateur, ni anonyme, ni Creator, ni Pro ne tombait dans AUCUNE
//    colonne : jeton, code désactivé, code expiré, code effacé de `abonnes`.
//    Elle était comptée nulle part, en silence, et le tableau prétendait
//    quand même répertorier tout le monde. Un tableau de bord qui perd des
//    lignes sans le dire est pire qu'un tableau vide.
//
// LA GARANTIE VERROUILLÉE ICI, et elle vaut mieux que n'importe quel cas
// particulier : LA SOMME DES COLONNES EST TOUJOURS ÉGALE AU NOMBRE RÉEL DE
// GÉNÉRATIONS. Tant que ce test passe, aucune ligne ne peut se perdre, quelle
// que soit la forme du code ou du plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CODE_FONDATEUR = 'SCRIPTURA-CELINE';

const ABONNES = [
  // Le cas du propriétaire : un vrai compte Creator.
  { code: 'CREA1', plan: 'creator', actif: true, expire_le: null },
  // Les trois façons dont le plan peut être "sale" dans Supabase, toutes
  // rencontrées sur des lignes créées à la main.
  { code: 'CREA2', plan: 'Creator', actif: true, expire_le: null },
  { code: 'CREA3', plan: 'CREATOR ', actif: true, expire_le: null },
  { code: 'PRO1', plan: ' pro', actif: true, expire_le: null },
  // Code avec un espace final : même effacement silencieux si on ne trime pas.
  { code: 'CREA4 ', plan: 'creator', actif: true, expire_le: null },
  // Un jeton : ni Creator ni Pro, mais ses générations existent et doivent
  // se voir quelque part.
  { code: 'JET1', plan: 'jeton', actif: true, expire_le: null },
  // Un ancien Creator désactivé depuis : ses générations de la période ont
  // bel et bien été faites EN TANT QUE Creator, elles comptent donc là, pas
  // dans "Autre". "Autre" veut dire "non attribuable", pas "plus abonné".
  { code: 'VIEUX1', plan: 'creator', actif: false, expire_le: null }
];

const GENERATIONS = [
  { mode: 'script', code_acces: 'CREA1', cree_le: new Date().toISOString() },
  { mode: 'script', code_acces: 'CREA2', cree_le: new Date().toISOString() },
  { mode: 'script', code_acces: 'CREA3', cree_le: new Date().toISOString() },
  { mode: 'story', code_acces: 'CREA4', cree_le: new Date().toISOString() },
  { mode: 'script', code_acces: 'PRO1', cree_le: new Date().toISOString() },
  { mode: 'ideas', code_acces: 'JET1', cree_le: new Date().toISOString() },
  { mode: 'ideas', code_acces: 'VIEUX1', cree_le: new Date().toISOString() },
  // Un code qui n'existe plus du tout dans `abonnes` (abonné supprimé) :
  // sa génération reste dans la table, elle doit rester visible.
  { mode: 'serie', code_acces: 'DISPARU9', cree_le: new Date().toISOString() },
  { mode: 'script', code_acces: CODE_FONDATEUR, cree_le: new Date().toISOString() },
  { mode: 'ideas', code_acces: 'anon_1735689600000_ab12cd', cree_le: new Date().toISOString() }
];

function mockRes() {
  return { _json: null, status() { return this; }, json(o) { this._json = o; return this; } };
}

async function stats() {
  const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
  const res = mockRes();
  await handlerModule.default({ method: 'POST', body: { resource: 'admin-stats', code_acces: CODE_FONDATEUR } }, res);
  return res._json;
}

test('aucune génération ne peut disparaître : la somme des colonnes vaut le total', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.CODE_ADMIN = CODE_FONDATEUR;

  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    const ok = (rows) => ({ ok: true, status: 200, json: async () => rows,
      headers: { get: (h) => h.toLowerCase() === 'content-range' ? '*/0' : null } });
    if (u.pathname === '/rest/v1/abonnes' && method === 'HEAD') return ok(null);
    if (u.pathname === '/rest/v1/abonnes') return ok(ABONNES);
    if (u.pathname === '/rest/v1/generations') {
      const select = u.searchParams.get('select') || '';
      return ok(select.includes('mode') ? GENERATIONS : GENERATIONS.map(g => ({ code_acces: g.code_acces })));
    }
    return ok([]);
  };

  try {
    const data = await stats();
    const p = data.parModePlan;
    assert.ok(p, 'la réponse doit porter la répartition par plan : ' + JSON.stringify(data));

    const somme = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0);

    // LE CAS EXACT DU PROPRIÉTAIRE, plus ses trois variantes sales.
    assert.equal(somme(p.creator), 5,
      'REGRESSION : un plan "Creator"/"CREATOR "/un code à espace final faisait disparaître '
      + 'toutes les générations de l\'abonné (les 4 Creator, plus l\'ancien Creator désactivé, '
      + 'qui a bien généré en tant que Creator) : ' + JSON.stringify(p.creator));
    assert.equal(somme(p.pro), 1,
      'REGRESSION : un plan " pro" doit compter en Pro : ' + JSON.stringify(p.pro));
    assert.equal(somme(p.fondateur), 1);
    assert.equal(somme(p.nonAbonne), 1);

    // Jeton + code disparu de `abonnes` : deux lignes qui ne tombaient nulle
    // part. Elles ont maintenant une colonne.
    assert.equal(somme(p.autre), 2,
      'REGRESSION : ces générations n\'étaient comptées NULLE PART, en silence : ' + JSON.stringify(p.autre));

    // LA GARANTIE QUI COMPTE VRAIMENT.
    const totalColonnes = somme(p.fondateur) + somme(p.pro) + somme(p.creator) + somme(p.nonAbonne) + somme(p.autre);
    assert.equal(totalColonnes, GENERATIONS.length,
      'REGRESSION : la somme des colonnes doit valoir le nombre réel de générations ('
      + totalColonnes + ' vs ' + GENERATIONS.length + ') : ' + JSON.stringify(p));
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CODE_ADMIN;
  }
});

test('la colonne Autre existe aussi à l\'écran, sinon le trou reste invisible', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const i = src.indexOf('admin-modes-header');
  const entete = src.slice(i, i + 400);
  for (const col of ['Fondateur', 'Pro', 'Creator', 'Non-abonné', 'Autre']) {
    assert.ok(entete.includes('<span>' + col + '</span>'),
      'la colonne "' + col + '" doit exister dans l\'en-tête : ' + entete.slice(0, 200));
  }
  assert.match(src, /parModePlan\.autre/,
    'les valeurs de la colonne Autre doivent être lues, pas seulement l\'en-tête affiché');

  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  assert.match(css, /grid-template-columns:minmax\(120px,1fr\) repeat\(5, 56px\)/,
    'la grille doit prévoir CINQ colonnes de chiffres, sinon la dernière se superpose');
});

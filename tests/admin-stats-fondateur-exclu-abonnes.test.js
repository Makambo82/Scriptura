// Reproduit le bug signalé par le propriétaire : le tableau de bord comptait
// le fondateur comme un abonné Creator/Pro (et ses propres générations
// tombaient dans la colonne Creator/Pro de "Générations par mode"), parce que
// son code personnel (SCRIPTURA-CELINE) a gardé une ligne héritée dans la
// table `abonnes` (plan 'creator') d'avant la mise en place de CODE_ADMIN.
// Résultat concret vu par le propriétaire : "Abonnés actifs" et "Creator"
// gonflés alors qu'il n'y a encore AUCUN vrai abonné, et la carte
// "Générations par mode" attribuait ses propres générations à Creator.
//
// Ce test appelle directement le handler /api/data (comme
// tests/api-data-toggle-supprimer-casse-mixte.test.js) avec un faux fetch
// simulant une table `abonnes` contenant CETTE ligne héritée du fondateur
// plus deux VRAIS codes de test (FIFA/Creator, BRADC8P6/Pro), et une table
// `generations` où la plupart des lignes ont été générées avec le code du
// fondateur lui-même (exactement le scénario décrit : "la plupart des
// générations sont faites par le fondateur").
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CODE_FONDATEUR = 'SCRIPTURA-CELINE';

const ABONNES = [
  { code: CODE_FONDATEUR, plan: 'creator', actif: true, expire_le: null },
  { code: 'FIFA', plan: 'creator', actif: true, expire_le: null },
  { code: 'BRADC8P6', plan: 'pro', actif: true, expire_le: null }
];

const GENERATIONS = [
  { mode: 'script', code_acces: CODE_FONDATEUR },
  { mode: 'script', code_acces: CODE_FONDATEUR },
  { mode: 'script', code_acces: CODE_FONDATEUR },
  { mode: 'serie', code_acces: CODE_FONDATEUR },
  { mode: 'serie', code_acces: CODE_FONDATEUR },
  { mode: 'script', code_acces: 'FIFA' },
  { mode: 'story', code_acces: 'BRADC8P6' },
  // Générations anonymes (quota gratuit, aucun code_acces, voir callAI,
  // js/api.js) : doivent tomber dans une colonne "Non-abonné" à part,
  // jamais silencieusement absentes du tableau (retour du propriétaire).
  { mode: 'ideas', code_acces: null },
  { mode: 'ideas', code_acces: null },
  { mode: 'script', code_acces: null }
];

function parseCodeFiltre(param) {
  if (!param) return null;
  if (param.startsWith('not.ilike.')) return { op: 'not.ilike', val: param.slice('not.ilike.'.length) };
  if (param.startsWith('ilike.')) return { op: 'ilike', val: param.slice('ilike.'.length) };
  if (param.startsWith('eq.')) return { op: 'eq', val: param.slice('eq.'.length) };
  return null;
}

function mockRes() {
  return {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(obj) { this._json = obj; return this; }
  };
}

test('le fondateur (ligne héritée dans `abonnes`) est exclu des comptages et de "Générations par mode", mais reste visible dans la liste des codes', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.CODE_ADMIN = CODE_FONDATEUR;

  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();

    if (u.pathname === '/rest/v1/abonnes' && method === 'HEAD') {
      let rows = ABONNES.slice();
      if (u.searchParams.get('actif') === 'eq.true') rows = rows.filter(r => r.actif === true);
      const planParam = u.searchParams.get('plan');
      if (planParam && planParam.startsWith('eq.')) {
        const val = planParam.slice(3);
        rows = rows.filter(r => r.plan === val);
      }
      const codeFiltre = parseCodeFiltre(u.searchParams.get('code'));
      if (codeFiltre && codeFiltre.op === 'not.ilike') {
        rows = rows.filter(r => r.code.toLowerCase() !== codeFiltre.val.toLowerCase());
      }
      return { ok: true, status: 200, headers: { get: (h) => h.toLowerCase() === 'content-range' ? ('*/' + rows.length) : null }, json: async () => null };
    }

    if (u.pathname === '/rest/v1/abonnes' && method === 'GET') {
      // Jamais filtrée sur le fondateur : l'UI (estFondateur, js/admin.js)
      // a besoin de voir cette ligne pour l'afficher à part.
      return { ok: true, status: 200, json: async () => ABONNES };
    }

    if (u.pathname === '/rest/v1/generations' && method === 'GET') {
      const select = u.searchParams.get('select') || '';
      if (select.includes('mode')) {
        return { ok: true, status: 200, json: async () => GENERATIONS };
      }
      return { ok: true, status: 200, json: async () => GENERATIONS.map(g => ({ code_acces: g.code_acces })) };
    }

    if (u.pathname === '/rest/v1/erreurs_generation') {
      return { ok: true, status: 200, json: async () => [] };
    }

    throw new Error('Appel fetch inattendu dans le mock : ' + method + ' ' + url);
  };

  try {
    const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
    const handler = handlerModule.default;

    const res = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', code_acces: CODE_FONDATEUR } }, res);
    const data = res._json;
    assert.ok(data, 'la réponse doit contenir les statistiques : ' + JSON.stringify(res));

    // ── Comptages : le fondateur ne doit compter nulle part comme abonné ──
    assert.equal(data.total, 2, 'total doit exclure la ligne fondateur : ' + data.total);
    assert.equal(data.actifs, 2, 'actifs doit exclure la ligne fondateur : ' + data.actifs);
    assert.equal(data.creator, 1, 'creator doit exclure la ligne fondateur (seul FIFA reste) : ' + data.creator);
    assert.equal(data.pro, 1, 'pro doit valoir 1 (BRADC8P6, inchangé) : ' + data.pro);

    // ── La ligne fondateur reste visible dans la liste des codes (pour
    //    l'affichage "Fondateur" verrouillé, voir estFondateur, js/admin.js) ──
    assert.equal(data.codes.length, 3, 'la liste des codes doit garder la ligne fondateur pour son affichage à part');
    assert.ok(data.codes.some(c => c.code === CODE_FONDATEUR), 'la ligne fondateur doit être présente dans `codes`');

    // ── Générations par mode : les générations du fondateur ne doivent
    //    JAMAIS tomber dans Creator/Pro, même si sa ligne `abonnes` porte
    //    plan:'creator' ──
    assert.deepEqual(data.parModePlan.fondateur, { script: 3, serie: 2 }, 'les générations du fondateur doivent être comptées à part : ' + JSON.stringify(data.parModePlan));
    assert.deepEqual(data.parModePlan.creator, { script: 1 }, 'seule la génération de FIFA doit compter en Creator : ' + JSON.stringify(data.parModePlan));
    assert.deepEqual(data.parModePlan.pro, { story: 1 }, 'seule la génération de BRADC8P6 doit compter en Pro : ' + JSON.stringify(data.parModePlan));
    // ── Retour du propriétaire : les générations anonymes (sans code_acces)
    //    doivent apparaître dans une colonne "Non-abonné" dédiée ──
    assert.deepEqual(data.parModePlan.nonAbonne, { ideas: 2, script: 1 }, 'les générations sans code_acces doivent compter en Non-abonné : ' + JSON.stringify(data.parModePlan));
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CODE_ADMIN;
  }
});

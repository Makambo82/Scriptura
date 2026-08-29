// Reproduit le bug signalé par le propriétaire : désactiver puis supprimer
// un code dont la casse en base n'est PAS majuscule (ex. "Tiktok-F18", créé
// à la main dans Supabase avant le générateur automatique) échouait avec
// "Ce code est introuvable ou encore actif.", alors même que le code était
// bien désactivé à l'écran juste avant. Cause racine : api/data.js forçait
// .toUpperCase() puis interrogeait Supabase avec code=eq.MAJUSCULE, qui ne
// matche jamais une ligne stockée en casse mixte (PostgREST eq est
// sensible à la casse). Le correctif passe à code=ilike (insensible à la
// casse). Ce test appelle directement le handler /api/data (pas de mock
// réseau côté client comme les autres tests admin : ceux-là ne peuvent pas
// détecter ce bug, il vit entièrement côté serveur) avec un faux fetch qui
// simule fidèlement la sémantique PostgREST eq/ilike sur une ligne stockée
// en casse mixte, pour prouver que le correctif fonctionne de bout en bout
// (bascule puis suppression) et que toute régression vers eq+toUpperCase
// ferait échouer ce test.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CODE_STOCKE = 'Tiktok-F18';

function parseOpVal(param) {
  if (!param) return null;
  const idx = param.indexOf('.');
  return { op: param.slice(0, idx), val: param.slice(idx + 1) };
}

function matchCode(param, stockeCode) {
  const parsed = parseOpVal(param);
  if (!parsed) return true;
  if (parsed.op === 'eq') return parsed.val === stockeCode;
  if (parsed.op === 'ilike') return parsed.val.toLowerCase() === stockeCode.toLowerCase();
  return false;
}

function matchActif(param, stockeActif) {
  const parsed = parseOpVal(param);
  if (!parsed) return true;
  return (parsed.val === 'true') === stockeActif;
}

function mockRes() {
  return {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(obj) { this._json = obj; return this; }
  };
}

test('toggle-actif puis supprimer-abonne réussissent sur un code stocké en casse mixte', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.CODE_ADMIN = 'ADMIN-TEST';

  const ligne = { code: CODE_STOCKE, plan: 'creator', actif: true, jetons_audit: 0 };
  const fetchAppels = [];
  const fetchOriginal = global.fetch;

  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    fetchAppels.push({ url: url.toString(), method });

    if (u.pathname === '/rest/v1/abonnes' && method === 'PATCH') {
      // Bascule actif/inactif (toggle-actif). Prefer: return=minimal, comme
      // en prod : PostgREST renvoie 204 même si 0 ligne matche, donc
      // l'update réel n'est appliqué à `ligne` que si le filtre matche
      // vraiment (c'est justement ce qui reproduit le bug si eq+majuscule).
      if (matchCode(u.searchParams.get('code'), ligne.code)) {
        const corps = JSON.parse(opts.body || '{}');
        if ('actif' in corps) ligne.actif = !!corps.actif;
      }
      return { ok: true, status: 204, json: async () => null };
    }

    if (u.pathname === '/rest/v1/abonnes' && method === 'DELETE') {
      const codeOk = matchCode(u.searchParams.get('code'), ligne.code);
      const actifOk = matchActif(u.searchParams.get('actif'), ligne.actif);
      if (codeOk && actifOk) {
        const supprimee = { ...ligne };
        ligne.supprimee = true;
        return { ok: true, status: 200, json: async () => [supprimee] };
      }
      return { ok: true, status: 200, json: async () => [] };
    }

    throw new Error('Appel fetch inattendu dans le mock : ' + method + ' ' + url);
  };

  try {
    const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
    const handler = handlerModule.default;

    // ── 1. Désactivation depuis le tableau de bord ──
    const resToggle = mockRes();
    await handler(
      { method: 'POST', body: { resource: 'admin-stats', action: 'toggle-actif', code_acces: 'ADMIN-TEST', code: CODE_STOCKE, actif: false } },
      resToggle
    );
    assert.equal(resToggle._json?.ok, true, 'toggle-actif doit réussir même sur un code en casse mixte : ' + JSON.stringify(resToggle._json));
    assert.equal(ligne.actif, false, 'la ligne stockée doit être réellement passée à actif=false (pas juste un succès HTTP muet)');

    // ── 2. Suppression définitive, juste après ──
    const resSupprimer = mockRes();
    await handler(
      { method: 'POST', body: { resource: 'admin-stats', action: 'supprimer-abonne', code_acces: 'ADMIN-TEST', code: CODE_STOCKE } },
      resSupprimer
    );
    assert.equal(resSupprimer._json?.ok, true, 'supprimer-abonne doit réussir sur ce même code : ' + JSON.stringify(resSupprimer._json));
    assert.notEqual(resSupprimer._json?.erreur, 'rien_a_supprimer', 'ne doit plus jamais renvoyer "rien_a_supprimer" pour un code réellement désactivé');
    assert.equal(ligne.supprimee, true, 'la ligne doit avoir été réellement supprimée côté "base"');

    // Vérifie que le correctif utilise bien ilike (et non plus eq) : preuve
    // directe que la régression testée est la bonne, pas un faux positif.
    const appelPatch = fetchAppels.find(a => a.method === 'PATCH');
    const appelDelete = fetchAppels.find(a => a.method === 'DELETE');
    assert.ok(appelPatch.url.includes('code=ilike.'), 'toggle-actif doit interroger avec code=ilike : ' + appelPatch.url);
    assert.ok(appelDelete.url.includes('code=ilike.'), 'supprimer-abonne doit interroger avec code=ilike : ' + appelDelete.url);
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CODE_ADMIN;
  }
});

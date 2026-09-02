// Non-régression pour une vraie faille trouvée lors de l'audit complet du
// 2 septembre 2026 : /api/patterns acceptait un `score` envoyé tel quel par
// le client (le garde-fou >= 85 était "re-vérifié" sur ce chiffre, jamais
// recalculé), n'importe qui pouvait donc empoisonner la mémoire virale
// partagée (utilisée dans TOUTES les générations Script/Idées/Récit) avec un
// score fabriqué. Le score est désormais calculé ICI, en code, à partir des
// signaux bruts (voir calculerScoreRecette, api/patterns.js), le client ne
// peut plus influencer que les signaux eux-mêmes (des booléens dont la
// combinaison doit rester cohérente pour espérer franchir le seuil).
const test = require('node:test');
const assert = require('node:assert/strict');

test('/api/patterns ignore un score fabriqué par le client : les signaux réels décident seuls', async () => {
  const envAvant = { ...process.env };
  process.env.SUPABASE_URL = 'https://supabase-test.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';

  const fetchOriginal = global.fetch;
  let requeteSupabase = null;
  global.fetch = async (url, options) => {
    requeteSupabase = { url, options };
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/patterns.js');
    const req = {
      method: 'POST',
      body: {
        niche: 'finance',
        hook_technique: 'question choc',
        // Score fabriqué, prétendant passer largement le seuil (85) :
        // doit être totalement ignoré.
        score: 999,
        // Signaux réels quasi tous absents : le vrai score recalculé doit
        // rester très en dessous du seuil.
        signaux: { hook_fort: false, angle_original: false },
        frameDisponible: false
      }
    };
    let statusRecu = null, jsonRecu = null;
    const res = {
      status(code) { statusRecu = code; return this; },
      json(obj) { jsonRecu = obj; return this; }
    };
    await handler(req, res);

    assert.equal(statusRecu, 200);
    assert.equal(jsonRecu.ok, false, 'un score fabriqué ne doit jamais suffire à passer le garde-fou : ' + JSON.stringify(jsonRecu));
    assert.equal(jsonRecu.raison, 'sous_seuil');
    assert.equal(requeteSupabase, null, 'aucune écriture Supabase ne doit partir si le score recalculé est sous le seuil');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/patterns accepte et stocke le score RECALCULÉ (pas celui envoyé) quand les signaux réels passent le seuil', async () => {
  const envAvant = { ...process.env };
  process.env.SUPABASE_URL = 'https://supabase-test.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';

  const fetchOriginal = global.fetch;
  let requeteSupabase = null;
  global.fetch = async (url, options) => {
    requeteSupabase = { url, options };
    return { ok: true, json: async () => ({}) };
  };

  try {
    const { default: handler } = await import('../api/patterns.js');
    const req = {
      method: 'POST',
      body: {
        niche: 'finance',
        hook_technique: 'question choc',
        // Score fabriqué délibérément DIFFÉRENT du vrai calcul (10), pour
        // prouver qu'il est bien ignoré et que 100 (le vrai calcul, tous les
        // signaux au maximum) est stocké à la place.
        score: 10,
        signaux: {
          hook_fort: true, boucle_ouverte: true, cliffhanger: true, deuxieme_personne: true,
          details_concrets: true, escalade: true, question_rhetorique: true, archetypes: true,
          appel_action: true, angle_original: true, sujet_precis: true, authenticite: true,
          hook_visuel: true, execution_visuelle: true
        },
        frameDisponible: true
      }
    };
    let statusRecu = null, jsonRecu = null;
    const res = {
      status(code) { statusRecu = code; return this; },
      json(obj) { jsonRecu = obj; return this; }
    };
    await handler(req, res);

    assert.equal(statusRecu, 200);
    assert.equal(jsonRecu.ok, true, 'des signaux réellement complets doivent passer le garde-fou : ' + JSON.stringify(jsonRecu));
    assert.ok(requeteSupabase, 'une écriture Supabase doit partir');
    const ligneEcrite = JSON.parse(requeteSupabase.options.body);
    assert.equal(ligneEcrite.score, 100, 'le score stocké doit être celui recalculé en code (100), jamais celui envoyé par le client (10) : ' + JSON.stringify(ligneEcrite));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

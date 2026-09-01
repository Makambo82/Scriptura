// Retour propriétaire : le montage Scriptura "pas assez premium" face à un
// montage CapCut fait à la main. Cause identifiée : aucune musique de fond
// nulle part dans le pipeline, juste la voix off en silence. Ajout d'une
// génération de musique instrumentale via l'API Eleven Music (même clé
// ELEVENLABS_API_KEY que la voix off, réservée aux comptes ElevenLabs
// payants avec l'accès Music activé).
//
// Particularité testée ici : contrairement à /text-to-speech/.../
// with-timestamps (JSON avec l'audio en base64), POST /v1/music renvoie
// l'AUDIO BRUT directement (pas de JSON en cas de succès) - le mock de
// fetch ci-dessous simule donc .arrayBuffer(), pas .json(), sur la réponse
// réussie, pour refléter fidèlement le vrai comportement de cet endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

test('/api/montage-media action=music appelle POST /v1/music avec la bonne clé, la durée demandée et force_instrumental, renvoie l\'audio en base64', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MUSIQUE';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';

  const fetchOriginal = global.fetch;
  let requeteRecue = null;
  const octetsAudio = Buffer.from('faux-audio-mp3-binaire');
  global.fetch = async (url, options) => {
    requeteRecue = { url, headers: options.headers, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => octetsAudio.buffer.slice(octetsAudio.byteOffset, octetsAudio.byteOffset + octetsAudio.byteLength)
    };
  };

  try {
    const { default: handler } = await import('../api/montage-media.js?musique-fond');
    const req = {
      method: 'POST', query: { action: 'music' },
      body: { code_acces: 'TESTADMIN_MUSIQUE', dureeMs: 45000 }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200, 'réponse attendue : ' + JSON.stringify(res._json));
    assert.equal(requeteRecue.url, 'https://api.elevenlabs.io/v1/music');
    assert.equal(requeteRecue.headers['xi-api-key'], 'faux-jeton', 'la clé API doit être transmise dans l\'en-tête xi-api-key (même mécanisme que la voix off)');
    assert.equal(requeteRecue.body.music_length_ms, 45000, 'la durée demandée doit être transmise telle quelle : ' + JSON.stringify(requeteRecue.body));
    assert.equal(requeteRecue.body.force_instrumental, true, 'jamais de voix chantée dans la musique de fond (masquerait la narration) : ' + JSON.stringify(requeteRecue.body));
    assert.equal(res._json.audioBase64, octetsAudio.toString('base64'), 'l\'audio brut reçu doit être renvoyé en base64 au client, comme pour la voix off');
    assert.equal(res._json.mimeType, 'audio/mpeg');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-media action=music cale la durée demandée sur les bornes de l\'API (3s à 10min) plutôt que d\'envoyer une valeur hors limites', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MUSIQUE_BORNES';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';

  const fetchOriginal = global.fetch;
  let dernieresDurees = [];
  global.fetch = async (url, options) => {
    dernieresDurees.push(JSON.parse(options.body).music_length_ms);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x').buffer };
  };

  try {
    const { default: handler } = await import('../api/montage-media.js?musique-bornes');
    // Trop court (moins de 3s) -> doit être remonté à 3000.
    await handler({ method: 'POST', query: { action: 'music' }, body: { code_acces: 'TESTADMIN_MUSIQUE_BORNES', dureeMs: 500 } }, mockRes());
    // Trop long (plus de 10min) -> doit être ramené à 600000.
    await handler({ method: 'POST', query: { action: 'music' }, body: { code_acces: 'TESTADMIN_MUSIQUE_BORNES', dureeMs: 900000 } }, mockRes());

    assert.deepEqual(dernieresDurees, [3000, 600000], 'les durées hors bornes doivent être ramenées à la limite la plus proche : ' + JSON.stringify(dernieresDurees));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-media action=music : erreur ElevenLabs (ex. accès Music non activé sur le compte) renvoyée clairement, jamais un plantage', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MUSIQUE_ERREUR';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';

  const fetchOriginal = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: { message: 'This account does not have access to the Music API' } })
  });

  try {
    const { default: handler } = await import('../api/montage-media.js?musique-erreur');
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'music' }, body: { code_acces: 'TESTADMIN_MUSIQUE_ERREUR', dureeMs: 30000 } }, res);

    assert.equal(res._status, 502);
    assert.match(res._json.error.message, /Music API/, 'le message d\'erreur ElevenLabs doit remonter tel quel : ' + JSON.stringify(res._json));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-media action=music refuse une requête sans durée, sans jamais appeler ElevenLabs', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_MUSIQUE_SANS_DUREE';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';

  const fetchOriginal = global.fetch;
  let appele = false;
  global.fetch = async () => { appele = true; return { ok: true, arrayBuffer: async () => Buffer.from('x').buffer }; };

  try {
    const { default: handler } = await import('../api/montage-media.js?musique-sans-duree');
    const res = mockRes();
    await handler({ method: 'POST', query: { action: 'music' }, body: { code_acces: 'TESTADMIN_MUSIQUE_SANS_DUREE' } }, res);

    assert.equal(res._status, 400);
    assert.equal(appele, false, 'ElevenLabs ne doit jamais être appelé sans durée valide');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

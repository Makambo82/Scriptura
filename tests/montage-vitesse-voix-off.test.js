// Retour propriétaire : un sélecteur de vitesse de lecture pour la voix off
// (0,5x à 1,5x), transmis à ElevenLabs via voice_settings.speed (voir
// api/montage-media.js, handleTts). Plage choisie après vérification de la
// doc ElevenLabs : l'API REST accepte 0.25-4.0, mais la qualité se dégrade
// nettement en dehors de 0.5-1.5 (voix déformée), d'où le sélecteur limité
// à cette plage côté client ET la même borne recalée ici côté serveur (au
// cas où l'API serait appelée directement, sans passer par l'UI).
const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

function mockFetchAvecHorodatage() {
  return async (url, options) => {
    const corps = JSON.parse(options.body);
    const nbCaracteres = corps.text.length;
    return {
      ok: true,
      json: async () => ({
        audio_base64: 'ZmF1eC1hdWRpbw==',
        alignment: {
          character_start_times_seconds: Array.from({ length: nbCaracteres }, (_, i) => i * 0.05),
          character_end_times_seconds: Array.from({ length: nbCaracteres }, (_, i) => (i + 1) * 0.05)
        }
      })
    };
  };
}

test('/api/montage-media action=tts transmet la vitesse choisie à ElevenLabs (voice_settings.speed)', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_VITESSE1';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test';

  const fetchOriginal = global.fetch;
  let requeteRecue = null;
  global.fetch = async (url, options) => {
    requeteRecue = JSON.parse(options.body);
    return mockFetchAvecHorodatage()(url, options);
  };

  try {
    const { default: handler } = await import('../api/montage-media.js?vitesse1');
    const res = mockRes();
    await handler({
      method: 'POST', query: { action: 'tts' },
      body: { code_acces: 'TESTADMIN_VITESSE1', segments: ['Un test.'], voiceId: 'voix-test', speed: 0.7 }
    }, res);

    assert.equal(res._status, 200, 'réponse attendue : ' + JSON.stringify(res._json));
    assert.equal(requeteRecue.voice_settings.speed, 0.7, 'la vitesse choisie doit être transmise telle quelle à ElevenLabs : ' + JSON.stringify(requeteRecue));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-media action=tts cale une vitesse hors plage (0.5-1.5) sur la borne la plus proche, jamais envoyée telle quelle', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_VITESSE2';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test';

  const fetchOriginal = global.fetch;
  const vitessesRecues = [];
  global.fetch = async (url, options) => {
    vitessesRecues.push(JSON.parse(options.body).voice_settings.speed);
    return mockFetchAvecHorodatage()(url, options);
  };

  try {
    const { default: handler } = await import('../api/montage-media.js?vitesse2');
    await handler({ method: 'POST', query: { action: 'tts' }, body: { code_acces: 'TESTADMIN_VITESSE2', segments: ['x'], voiceId: 'voix-test', speed: 0.1 } }, mockRes());
    await handler({ method: 'POST', query: { action: 'tts' }, body: { code_acces: 'TESTADMIN_VITESSE2', segments: ['x'], voiceId: 'voix-test', speed: 3 } }, mockRes());
    await handler({ method: 'POST', query: { action: 'tts' }, body: { code_acces: 'TESTADMIN_VITESSE2', segments: ['x'], voiceId: 'voix-test' } }, mockRes());

    assert.deepEqual(vitessesRecues, [0.5, 1.5, 1], 'les vitesses hors plage doivent être ramenées à 0.5/1.5, et 1 (normal) par défaut si absente : ' + JSON.stringify(vitessesRecues));
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

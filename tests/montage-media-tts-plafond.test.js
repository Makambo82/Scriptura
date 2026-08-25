// Retour direct : un fondateur avec 53 images/lignes voyait le bouton
// "Démarrer le montage" rester grisé sans explication. Cause réelle :
// api/montage-media.js (action=tts) tronquait SILENCIEUSEMENT les segments
// au-delà de MAX_SEGMENTS (40 à l'époque), renvoyant donc moins de durées
// que d'images attendues côté client (js/montage-manuel.js), qui ne
// vérifiait jamais cette égalité. Le plafond est monté à 200 et un dépassement
// est désormais refusé clairement AVANT tout appel ElevenLabs, plutôt que de
// tronquer en silence. Test pur Node (pas de navigateur), fetch stubbé.
const test = require('node:test');
const assert = require('node:assert/strict');

test('/api/montage-media action=tts refuse clairement un trop grand nombre de segments, sans jamais tronquer en silence', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_TTS_PLAFOND';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test';

  const fetchOriginal = global.fetch;
  let appeleElevenLabs = false;
  global.fetch = async () => { appeleElevenLabs = true; return { ok: true, json: async () => ({}) }; };

  try {
    const { default: handler } = await import('../api/montage-media.js?tts-plafond');
    const segmentsTropNombreux = Array.from({ length: 201 }, (_, i) => 'Ligne ' + (i + 1));
    const req = { method: 'POST', query: { action: 'tts' }, body: { code_acces: 'TESTADMIN_TTS_PLAFOND', segments: segmentsTropNombreux, voiceId: 'voix-test' } };
    let statusRecu = null, jsonRecu = null;
    const res = { status(code) { statusRecu = code; return this; }, json(obj) { jsonRecu = obj; return this; } };

    await handler(req, res);

    assert.equal(statusRecu, 400, 'un trop grand nombre de segments doit être refusé (400), pas tronqué en silence');
    assert.match(jsonRecu.error && jsonRecu.error.message, /201/, 'le message doit préciser le nombre de segments reçus');
    assert.equal(appeleElevenLabs, false, 'ElevenLabs ne doit jamais être appelé pour une requête refusée');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-media action=tts accepte 53 segments (cas réel signalé) sans les tronquer', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_TTS_53';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test';

  const fetchOriginal = global.fetch;
  let segmentsRecusParElevenLabs = null;
  global.fetch = async (url, options) => {
    const corps = JSON.parse(options.body);
    // Le serveur envoie le texte complet (segments joints), pas les segments
    // séparément à ElevenLabs (une seule requête TTS, horodatages ensuite
    // répartis par segment côté serveur) : on vérifie donc juste qu'aucune
    // troncature n'a eu lieu en comptant les points de segmentation attendus.
    segmentsRecusParElevenLabs = corps.text;
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

  try {
    const { default: handler } = await import('../api/montage-media.js?tts-53');
    const segments53 = Array.from({ length: 53 }, (_, i) => 'Ligne numéro ' + (i + 1) + '.');
    const req = { method: 'POST', query: { action: 'tts' }, body: { code_acces: 'TESTADMIN_TTS_53', segments: segments53, voiceId: 'voix-test' } };
    let statusRecu = null, jsonRecu = null;
    const res = { status(code) { statusRecu = code; return this; }, json(obj) { jsonRecu = obj; return this; } };

    await handler(req, res);

    assert.equal(statusRecu, 200, 'les 53 segments doivent être acceptés');
    assert.ok(segmentsRecusParElevenLabs, 'ElevenLabs doit avoir été appelé');
    assert.equal(jsonRecu.durations.length, 53, 'exactement 53 durées doivent être renvoyées, une par segment, aucune troncature');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

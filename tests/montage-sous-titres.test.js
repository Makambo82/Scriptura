// Retour propriétaire : le montage sans sous-titres "ne se sent pas fini"
// pour du TikTok. Ajout de sous-titres incrustés, groupés par "2 mots longs
// ou 3 mots courts" (choix explicite du propriétaire, ni un carton par plan
// ni le mot par mot façon karaoké). Construits à partir de l'horodatage
// caractère par caractère qu'ElevenLabs renvoie déjà (jusqu'ici jeté après
// avoir servi à caler la durée de chaque plan, voir api/montage-media.js).
// Ce test appelle directement le handler /api/montage-media (action=tts),
// comme tests/montage-media-tts-plafond.test.js, avec un faux fetch qui
// simule un horodatage ElevenLabs linéaire et prévisible (0,05s/caractère),
// pour vérifier le DÉCOUPAGE en groupes de mots avec des horodatages exacts.
const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

test('/api/montage-media action=tts regroupe les mots en sous-titres "2 mots longs ou 3 mots courts", avec les bons horodatages', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_SOUS_TITRES';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test';

  const fetchOriginal = global.fetch;
  global.fetch = async (url, options) => {
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

  try {
    const { default: handler } = await import('../api/montage-media.js?sous-titres');
    // Un seul segment, texte choisi pour un découpage prévisible (voir
    // commentaire ci-dessous pour le détail du regroupement attendu).
    const req = {
      method: 'POST', query: { action: 'tts' },
      body: { code_acces: 'TESTADMIN_SOUS_TITRES', segments: ['Ceci est un test de sous titres synchronises'], voiceId: 'voix-test' }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200, 'réponse attendue : ' + JSON.stringify(res._json));
    const captions = res._json.captions;
    assert.ok(Array.isArray(captions), 'captions doit être un tableau : ' + JSON.stringify(res._json));

    // "Ceci"(4) + "est"(3) -> 2 mots, 7 caractères, pas encore "long" (seuil
    // 10) -> "un"(2) rejoint le groupe pour atteindre 3 mots -> groupe plein.
    // "test"(4) + "de"(2) -> 2 mots, 6 caractères, pas assez long -> "sous"(4)
    // rejoint pour atteindre 3 mots -> groupe plein.
    // "titres"(6) + "synchronises"(12) -> 2 mots, 18 caractères, déjà "long"
    // (>= 10) dès 2 mots -> groupe plein sans un 3e mot.
    assert.deepEqual(captions.map(c => c.texte), ['Ceci est un', 'test de sous', 'titres synchronises'],
      'le découpage doit suivre la règle "2 mots longs ou 3 mots courts" : ' + JSON.stringify(captions));

    // Horodatage : "Ceci" commence au caractère 0 (0,05×0 = 0s) ; "un" finit
    // au caractère 10 ((10+1)×0,05 = 0,55s).
    assert.equal(captions[0].debut, 0, 'le premier sous-titre doit commencer à 0s : ' + JSON.stringify(captions[0]));
    assert.equal(captions[0].fin, 0.55, 'le premier sous-titre doit finir à la fin de "un" : ' + JSON.stringify(captions[0]));
    assert.equal(captions[1].debut, 0.6, 'le 2e sous-titre doit commencer au début de "test" : ' + JSON.stringify(captions[1]));
    assert.equal(captions[1].fin, 1.2, 'le 2e sous-titre doit finir à la fin de "sous" : ' + JSON.stringify(captions[1]));
    assert.equal(captions[2].debut, 1.25, 'le 3e sous-titre doit commencer au début de "titres" : ' + JSON.stringify(captions[2]));
    assert.equal(captions[2].fin, 2.2, 'le 3e sous-titre doit finir à la fin de "synchronises" : ' + JSON.stringify(captions[2]));

    // Aucun sous-titre ne doit jamais chevaucher le suivant, ni laisser un
    // trou négatif (fin > début du suivant) : verrouille l'ordre chronologique.
    for (let i = 1; i < captions.length; i++) {
      assert.ok(captions[i].debut >= captions[i - 1].fin, 'les sous-titres ne doivent jamais se chevaucher : ' + JSON.stringify(captions));
    }
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

test('/api/montage-media action=tts ne renvoie aucun sous-titre (plutôt qu\'un calage approximatif) si l\'horodatage ElevenLabs ne couvre pas tout le texte', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_SOUS_TITRES_MISMATCH';
  process.env.ELEVENLABS_API_KEY = 'faux-jeton';
  process.env.ELEVENLABS_VOICE_ID = 'voix-test';

  const fetchOriginal = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      audio_base64: 'ZmF1eC1hdWRpbw==',
      // Horodatage volontairement plus court que le texte réel (réponse
      // ElevenLabs incohérente, cas déjà géré pour `durations` : jamais un
      // sous-titre mal calé, un montage sans sous-titres reste utilisable).
      alignment: {
        character_start_times_seconds: [0, 0.05, 0.1],
        character_end_times_seconds: [0.05, 0.1, 0.15]
      }
    })
  });

  try {
    const { default: handler } = await import('../api/montage-media.js?sous-titres-mismatch');
    const req = {
      method: 'POST', query: { action: 'tts' },
      body: { code_acces: 'TESTADMIN_SOUS_TITRES_MISMATCH', segments: ['Un texte bien plus long que 3 caractères'], voiceId: 'voix-test' }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200);
    assert.deepEqual(res._json.captions, [], 'aucun sous-titre ne doit être renvoyé si l\'horodatage ne couvre pas tout le texte : ' + JSON.stringify(res._json));
    assert.ok(Array.isArray(res._json.durations) && res._json.durations.length, 'les durées par plan doivent quand même être renvoyées (dégradation partielle, pas totale)');
  } finally {
    global.fetch = fetchOriginal;
    process.env = envAvant;
  }
});

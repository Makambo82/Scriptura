// Retour propriétaire : le montage sans sous-titres "ne se sent pas fini"
// pour du TikTok. Ajout de sous-titres incrustés, groupés par petits
// paquets de mots (choix explicite du propriétaire, ni un carton par plan
// ni le mot par mot façon karaoké). Construits à partir de l'horodatage
// caractère par caractère qu'ElevenLabs renvoie déjà (jusqu'ici jeté après
// avoir servi à caler la durée de chaque plan, voir api/montage-media.js).
// 2e passe (retour propriétaire : "2 mots ça fait beau, ça peut aller
// jusqu'à 4 mots") : plafond remonté de 3 à 4 mots, avec des paliers de
// longueur à 2 et 3 mots pour ne pas systématiquement aller jusqu'à 4 si
// les mots sont déjà assez longs. Cette passe a aussi corrigé un vrai bug
// de découpage : un seuil de longueur en `>=` sur le nombre de mots (pas
// `===`) pouvait se déclencher APRÈS avoir déjà dépassé son propre palier,
// empêchant le seuil suivant (ou le plafond de 4 mots) de jamais s'appliquer.
// Ce test appelle directement le handler /api/montage-media (action=tts),
// comme tests/montage-media-tts-plafond.test.js, avec un faux fetch qui
// simule un horodatage ElevenLabs linéaire et prévisible (0,05s/caractère),
// pour vérifier le DÉCOUPAGE en groupes de mots avec des horodatages exacts.
const test = require('node:test');
const assert = require('node:assert/strict');

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

test('/api/montage-media action=tts regroupe les mots en sous-titres par paquets de 2 à 4 mots, avec les bons horodatages', async () => {
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

    // "Ceci"(4)+"est"(3) -> 2 mots, 7 caractères, sous le seuil 2-mots (10) ;
    // +"un"(2) -> 3 mots, 9 caractères, sous le seuil 3-mots (15) ; +"test"(4)
    // -> 4 mots, plafond dur atteint -> groupe plein.
    // "de"(2)+"sous"(4) -> 2 mots, 6 caractères, sous le seuil ; +"titres"(6)
    // -> 3 mots, 12 caractères, sous le seuil 3-mots (15) ; +"synchronises"(12)
    // -> 4 mots, plafond dur -> groupe plein.
    assert.deepEqual(captions.map(c => c.texte), ['Ceci est un test', 'de sous titres synchronises'],
      'le découpage doit former des paquets de 2 à 4 mots : ' + JSON.stringify(captions));

    // Horodatage : "Ceci" commence au caractère 0 (0,05×0 = 0s) ; "test" finit
    // au caractère 15 ((15+1)×0,05 = 0,8s).
    assert.equal(captions[0].debut, 0, 'le premier sous-titre doit commencer à 0s : ' + JSON.stringify(captions[0]));
    assert.equal(captions[0].fin, 0.8, 'le premier sous-titre doit finir à la fin de "test" : ' + JSON.stringify(captions[0]));
    assert.equal(captions[1].debut, 0.85, 'le 2e sous-titre doit commencer au début de "de" : ' + JSON.stringify(captions[1]));
    assert.equal(captions[1].fin, 2.2, 'le 2e sous-titre doit finir à la fin de "synchronises" : ' + JSON.stringify(captions[1]));

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

test('/api/montage-media action=tts : jamais plus de 4 mots par sous-titre même avec des mots très courts, et 2 mots suffisent si les mots sont longs', async () => {
  const envAvant = { ...process.env };
  process.env.CODE_ADMIN = 'TESTADMIN_SOUS_TITRES_PLAFOND';
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
    const { default: handler } = await import('../api/montage-media.js?sous-titres-plafond');
    const req = {
      method: 'POST', query: { action: 'tts' },
      body: {
        code_acces: 'TESTADMIN_SOUS_TITRES_PLAFOND',
        // 5 mots très courts (12 caractères en tout, bien sous les seuils de
        // longueur) : sans le plafond dur, ils tiendraient tous dans un seul
        // groupe, jamais voulu (retour propriétaire : jusqu'à 4 mots, pas plus).
        // Puis 2 mots très longs (33 caractères) : doivent former leur propre
        // groupe de 2 sans attendre un 3e ou 4e mot ("2 mots ça fait beau").
        segments: ['je le vois là moi internationalisation développement'],
        voiceId: 'voix-test'
      }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200, 'réponse attendue : ' + JSON.stringify(res._json));
    const captions = res._json.captions;
    captions.forEach(c => {
      const nbMots = c.texte.split(' ').length;
      assert.ok(nbMots <= 4, 'jamais plus de 4 mots par sous-titre : ' + JSON.stringify(c));
    });
    assert.deepEqual(captions.map(c => c.texte), ['je le vois là', 'moi internationalisation', 'développement'],
      'plafond à 4 mots pour les mots courts, 2 mots suffisent dès que c\'est long : ' + JSON.stringify(captions));
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

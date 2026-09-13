// LOT 2, AUDIT A9 — Limites de ressources du render-service.
//
// Avant ce correctif : aucun plafond sur le nombre d'images, la taille d'un
// fichier téléchargé, la taille cumulée d'un job, la concurrence des
// téléchargements (Promise.all libre) ni aucun timeout (par fichier ou pour
// le job entier). Un body JSON de 2 Mo ne protège en rien contre des URLs
// pointant vers de gros fichiers DISTANTS. Ce fichier verrouille les 8 cas
// exigés par l'audit : nombre d'images trop élevé, fichier trop gros, taille
// totale dépassée, timeout, plusieurs téléchargements simultanés, URL
// autorisée (déjà couvert par render-service-ssrf-assets-approuves), nettoyage
// après erreur, job normal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
// LOT 3, audit A2 : POST /render exige désormais toujours un jeton valide
// (voir jetonValide, render-service/server.js) : un jeton de TEST explicite,
// jamais un vrai secret, jamais une exception basée sur NODE_ENV.
const JETON_TEST = 'jeton-de-test-A9-jamais-un-secret-reel';
process.env.MONTAGE_TOKEN = JETON_TEST;
const BON = 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/public/montages/img.jpg';

function mockReponseAvecCorps(contenu, { status = 200, ok = true, contentLength, morceaux } = {}) {
  const listeMorceaux = morceaux || [contenu];
  return {
    ok, status,
    headers: { get: (nom) => (nom.toLowerCase() === 'content-length' ? (contentLength === undefined ? String(contenu.length) : (contentLength === null ? null : String(contentLength))) : null) },
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= listeMorceaux.length) return { done: true, value: undefined };
            return { done: false, value: listeMorceaux[i++] };
          },
          cancel: async () => {}
        };
      }
    }
  };
}

test('1. nombre d\'images trop élevé : rejeté (400) AVANT tout téléchargement', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  const { app, MAX_IMAGES } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  let appele = false;
  const fetchOriginal = global.fetch;
  global.fetch = async () => { appele = true; return mockReponseAvecCorps(Buffer.from('x')); };
  try {
    const images = Array.from({ length: MAX_IMAGES + 1 }, () => ({ url: BON, duration: 1 }));
    // fetchOriginal, PAS global.fetch (mocké juste au-dessus pour intercepter
    // les téléchargements INTERNES du service) : sinon cette requête de test
    // vers le serveur local serait, elle aussi, absorbée par le mock.
    const rep = await fetchOriginal('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-montage-token': JETON_TEST },
      body: JSON.stringify({ images, audioUrl: BON })
    });
    assert.equal(rep.status, 400);
    const data = await rep.json();
    assert.match(data.error.message, /Trop d.images/);
    assert.equal(appele, false, 'aucun téléchargement ne doit partir si le nombre d\'images dépasse le plafond');
  } finally {
    global.fetch = fetchOriginal;
    await new Promise(r => serveur.close(r));
  }
});

test('2. fichier trop gros (annoncé par Content-Length) : refusé avant même de lire le corps', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  const { telechargerVers, MAX_OCTETS_IMAGE } = require('../render-service/server.js');
  const fetchOriginal = global.fetch;
  global.fetch = async () => mockReponseAvecCorps(Buffer.alloc(10), { contentLength: MAX_OCTETS_IMAGE + 1 });
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'a9-'));
  try {
    await assert.rejects(
      telechargerVers(BON, path.join(dossier, 'x.jpg'), MAX_OCTETS_IMAGE, { octets: 0 }, undefined),
      /octets déclarés/
    );
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('2bis. fichier trop gros SANS Content-Length fiable : refusé pendant le flux (vraie garde)', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  const { telechargerVers } = require('../render-service/server.js');
  const plafond = 100; // petit plafond de test
  const morceau = Buffer.alloc(80, 'a');
  const fetchOriginal = global.fetch;
  // Content-Length absent (typique d'un flux/CDN) : deux morceaux de 80
  // octets dépassent le plafond de 100 seulement APRÈS le premier morceau.
  global.fetch = async () => mockReponseAvecCorps(null, { contentLength: null, morceaux: [morceau, morceau] });
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'a9-'));
  try {
    await assert.rejects(
      telechargerVers(BON, path.join(dossier, 'x.jpg'), plafond, { octets: 0 }, undefined),
      /dépasse .* octets en cours de téléchargement/
    );
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('3. taille TOTALE du job dépassée : le deuxième fichier fait basculer le cumul au-delà du plafond', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  const { telechargerVers, MAX_OCTETS_TOTAL } = require('../render-service/server.js');
  const moitiePlusUn = Buffer.alloc(Math.floor(MAX_OCTETS_TOTAL / 2) + 1);
  const fetchOriginal = global.fetch;
  global.fetch = async () => mockReponseAvecCorps(moitiePlusUn);
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'a9-'));
  const etatTotal = { octets: 0 };
  try {
    // Premier fichier : passe (sous le plafond PAR FICHIER, et sous le
    // cumul qui commence à 0).
    await telechargerVers(BON, path.join(dossier, 'a.jpg'), MAX_OCTETS_TOTAL, etatTotal, undefined);
    // Deuxième fichier identique : le cumul dépasse maintenant MAX_OCTETS_TOTAL.
    await assert.rejects(
      telechargerVers(BON, path.join(dossier, 'b.jpg'), MAX_OCTETS_TOTAL, etatTotal, undefined),
      /taille cumulée/
    );
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('4. timeout de téléchargement : une réponse qui ne finit jamais est interrompue', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TIMEOUT_TELECHARGEMENT_MS = '50'; // très court pour le test
  const { telechargerVers } = require('../render-service/server.js');
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            read: () => new Promise((resolve, reject) => {
              // Ne se résout jamais tout seul ; réagit à l'abandon du signal
              // combiné, exactement comme le ferait un vrai flux HTTP coupé.
              opts.signal.addEventListener('abort', () => reject(opts.signal.reason || new Error('aborted')));
            }),
            cancel: async () => {}
          };
        }
      }
    };
  };
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'a9-'));
  try {
    await assert.rejects(
      telechargerVers(BON, path.join(dossier, 'x.jpg'), 1000, { octets: 0 }, undefined),
      /Timeout/
    );
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.MONTAGE_TIMEOUT_TELECHARGEMENT_MS;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('5. plusieurs téléchargements simultanés : jamais plus que CONCURRENCE_TELECHARGEMENT en vol', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_CONCURRENCE_TELECHARGEMENT = '3';
  const { telechargerImagesEnPool, CONCURRENCE_TELECHARGEMENT } = require('../render-service/server.js');
  assert.equal(CONCURRENCE_TELECHARGEMENT, 3);
  let enVol = 0, picEnVol = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async () => {
    enVol++;
    picEnVol = Math.max(picEnVol, enVol);
    await new Promise(r => setTimeout(r, 20));
    enVol--;
    return mockReponseAvecCorps(Buffer.from('x'));
  };
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'a9-'));
  try {
    const images = Array.from({ length: 10 }, () => ({ url: BON }));
    await telechargerImagesEnPool(images, dossier, { octets: 0 }, undefined);
    assert.ok(picEnVol <= 3, 'jamais plus de CONCURRENCE_TELECHARGEMENT téléchargements en même temps, mesuré : ' + picEnVol);
    assert.ok(picEnVol > 1, 'les téléchargements doivent quand même se chevaucher (pas complètement séquentiel) : ' + picEnVol);
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.MONTAGE_CONCURRENCE_TELECHARGEMENT;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('6. URL autorisée : un job normal (peu d\'images, sous les plafonds) télécharge sans être bloqué', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  const { telechargerImagesEnPool } = require('../render-service/server.js');
  const fetchOriginal = global.fetch;
  let appels = 0;
  global.fetch = async () => { appels++; return mockReponseAvecCorps(Buffer.from('donnee')); };
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'a9-'));
  try {
    const images = [{ url: BON }, { url: BON }, { url: BON }];
    await telechargerImagesEnPool(images, dossier, { octets: 0 }, undefined);
    assert.equal(appels, 3);
    for (let i = 0; i < 3; i++) {
      const contenu = await fs.readFile(path.join(dossier, `img-${i}.jpg`));
      assert.equal(contenu.toString(), 'donnee');
    }
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('7. nettoyage garanti après erreur : le dossier temporaire disparaît même si le job échoue', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  const { app } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  const fetchOriginal = global.fetch;
  // Le téléchargement de l'image échoue (statut 500) : le job doit échouer
  // proprement, ET le dossier temporaire ne doit rester nulle part.
  global.fetch = async () => ({ ok: false, status: 500, headers: { get: () => null } });
  const dossiersAvant = new Set(await fs.readdir(os.tmpdir()).catch(() => []));
  try {
    // fetchOriginal, pas global.fetch (mocké au-dessus) : voir le test 1.
    const rep = await fetchOriginal('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-montage-token': JETON_TEST },
      body: JSON.stringify({ images: [{ url: BON, duration: 1 }], audioUrl: BON })
    });
    assert.equal(rep.status, 500);
    // Le nettoyage (finally { fs.rm(...) }) peut encore être en cours au
    // moment où la réponse HTTP arrive au client (écriture réseau et
    // nettoyage disque sont deux opérations async indépendantes) : on
    // laisse une marge courte avant de vérifier, le nettoyage n'a jamais
    // besoin d'être instantané, seulement garanti.
    await new Promise(r => setTimeout(r, 100));
    const dossiersApres = await fs.readdir(os.tmpdir()).catch(() => []);
    const nouveauxMontage = dossiersApres.filter(n => n.startsWith('montage-') && !dossiersAvant.has(n));
    assert.deepEqual(nouveauxMontage, [], 'aucun dossier temporaire de montage ne doit survivre à un job en échec : ' + JSON.stringify(nouveauxMontage));
  } finally {
    global.fetch = fetchOriginal;
    await new Promise(r => serveur.close(r));
  }
});

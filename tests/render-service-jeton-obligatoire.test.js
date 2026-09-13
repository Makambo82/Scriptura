// LOT 3, AUDIT A2 — MONTAGE_TOKEN devient obligatoire.
//
// Avant ce correctif : `if (MONTAGE_TOKEN && header !== MONTAGE_TOKEN)`
// dans render-service/server.js. Sans la variable d'environnement
// MONTAGE_TOKEN, cette condition est fausse quel que soit l'en-tête reçu :
// n'importe qui pouvait déclencher POST /render sans la moindre
// authentification (le rendu FFmpeg coûte du temps de calcul facturé par
// l'hébergeur). Correctif : le service REFUSE DE DÉMARRER sans
// MONTAGE_TOKEN (process.exit(1)), et la route /render exige TOUJOURS un
// jeton correct, comparé en temps constant, jamais un repli "personne
// configuré = tout le monde passe".
//
// Les tests 1-2 exercent le VRAI démarrage du processus (node server.js),
// seul moyen de vérifier un `process.exit()`. Les tests 3+ appellent le
// serveur importé comme bibliothèque (comme le reste de la suite),
// exactement le chemin qu'empruntent les tests A1/A9 existants.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const CHEMIN_SERVEUR = path.join(__dirname, '..', 'render-service', 'server.js');
const JETON_TEST = 'jeton-de-test-A2-jamais-un-secret-reel';
// Même origine que tests/render-service-ssrf-assets-approuves.test.js et
// tests/render-service-limites-ressources.test.js : urlAssetApprouvee()
// compare l'URL à process.env.SUPABASE_URL, qui doit donc être réglée AVANT
// tout require('../render-service/server.js') ci-dessous.
process.env.SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
const BON = 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/public/montages/img.jpg';

// Lance `node server.js` en vrai sous-processus, avec l'environnement donné.
// Résout dès que le process se termine tout seul (cas "démarrage refusé"),
// ou après avoir observé la ligne "à l'écoute" côté stdout (cas "démarrage
// normal") - le process est alors tué explicitement, sinon il tournerait
// pour toujours.
function lancerProcessus(env) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [CHEMIN_SERVEUR], {
      env: { ...process.env, PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    let etabli = false;
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (!etabli && /à l'écoute/.test(stdout)) {
        etabli = true;
        proc.kill('SIGTERM');
      }
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr, demarre: etabli }));
  });
}

test('1. MONTAGE_TOKEN absent : démarrage refusé (le processus se termine tout seul, jamais "à l\'écoute")', async () => {
  const env = { ...process.env };
  delete env.MONTAGE_TOKEN;
  const { code, stdout, stderr, demarre } = await lancerProcessus({ MONTAGE_TOKEN: '' });
  assert.equal(demarre, false, 'le service ne doit jamais atteindre app.listen() sans MONTAGE_TOKEN : ' + stdout);
  assert.notEqual(code, 0, 'le processus doit se terminer en erreur, jamais en succès silencieux');
  assert.match(stderr, /MONTAGE_TOKEN/, 'le message d\'erreur doit nommer la variable manquante : ' + stderr);
  assert.ok(!stderr.includes(JETON_TEST), 'la valeur d\'un jeton ne doit jamais apparaître, même dans ce message (ici : aucun jeton n\'est même configuré)');
});

test('2. MONTAGE_TOKEN présent : démarrage normal (le service atteint "à l\'écoute")', async () => {
  const { demarre, code } = await lancerProcessus({ MONTAGE_TOKEN: JETON_TEST });
  assert.equal(demarre, true, 'le service doit démarrer normalement quand MONTAGE_TOKEN est configuré');
  // Tué par SIGTERM une fois "à l'écoute" observé : code de sortie non nul
  // attendu ici, ce n'est PAS un signe d'échec (voir demarre === true).
  assert.notEqual(code, 0);
});

test('3. requête sans en-tête x-montage-token : 401', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { app } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  try {
    const rep = await fetch('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [{ url: BON, duration: 1 }], audioUrl: BON })
    });
    assert.equal(rep.status, 401);
    const corps = await rep.json();
    assert.ok(!JSON.stringify(corps).includes(JETON_TEST), 'le jeton ne doit jamais apparaître dans la réponse');
  } finally {
    await new Promise(r => serveur.close(r));
  }
});

test('4. mauvais jeton : 401', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { app } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  try {
    const rep = await fetch('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-montage-token': 'faux-jeton-devine' },
      body: JSON.stringify({ images: [{ url: BON, duration: 1 }], audioUrl: BON })
    });
    assert.equal(rep.status, 401);
  } finally {
    await new Promise(r => serveur.close(r));
  }
});

test('5. bon jeton : traitement normal (passe le contrôle A2, atteint la validation applicative ensuite)', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { app } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  try {
    // Payload volontairement incomplet (pas d'audioUrl) : on vérifie que le
    // jeton correct laisse passer jusqu'à la validation applicative (400,
    // "Images ou audio manquant"), jamais un 401. Un vrai rendu complet
    // nécessiterait FFmpeg + Supabase réels, hors de portée d'un test unitaire.
    const rep = await fetch('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-montage-token': JETON_TEST },
      body: JSON.stringify({ images: [{ url: BON, duration: 1 }] })
    });
    assert.notEqual(rep.status, 401, 'un jeton correct ne doit jamais être refusé');
    assert.equal(rep.status, 400);
    const corps = await rep.json();
    assert.match(corps.error.message, /Images ou audio manquant/);
  } finally {
    await new Promise(r => serveur.close(r));
  }
});

test('6. le jeton n\'apparaît jamais dans la réponse, quel que soit le résultat', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { app } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  try {
    for (const entete of [{}, { 'x-montage-token': 'mauvais' }, { 'x-montage-token': JETON_TEST }]) {
      const rep = await fetch('http://127.0.0.1:' + port + '/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...entete },
        body: JSON.stringify({})
      });
      const texte = await rep.text();
      assert.ok(!texte.includes(JETON_TEST), 'le jeton ne doit jamais apparaître dans une réponse : ' + texte);
    }
  } finally {
    await new Promise(r => serveur.close(r));
  }
});

test('7. le jeton n\'apparaît jamais dans les logs (console.error/console.log)', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { app } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  const logsOriginaux = { log: console.log, error: console.error };
  const captures = [];
  console.log = (...a) => captures.push(a.join(' '));
  console.error = (...a) => captures.push(a.join(' '));
  try {
    await fetch('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-montage-token': 'mauvais-jeton' },
      body: JSON.stringify({ images: [{ url: BON, duration: 1 }], audioUrl: BON })
    });
    assert.ok(!captures.some(l => l.includes(JETON_TEST)), 'le vrai jeton ne doit jamais être loggé : ' + JSON.stringify(captures));
    assert.ok(!captures.some(l => l.includes('mauvais-jeton')), 'même un jeton REÇU (invalide) ne doit jamais être loggé : ' + JSON.stringify(captures));
  } finally {
    console.log = logsOriginaux.log;
    console.error = logsOriginaux.error;
    await new Promise(r => serveur.close(r));
  }
});

test('8. les protections A1 (SSRF) restent actives derrière le nouveau contrôle de jeton', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { urlAssetApprouvee } = require('../render-service/server.js');
  assert.equal(urlAssetApprouvee('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(urlAssetApprouvee(BON), true);
});

test('9. les limites A9 (ressources) restent actives derrière le nouveau contrôle de jeton', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { app, MAX_IMAGES } = require('../render-service/server.js');
  const serveur = http.createServer(app);
  await new Promise(r => serveur.listen(0, r));
  const port = serveur.address().port;
  try {
    const images = Array.from({ length: MAX_IMAGES + 1 }, () => ({ url: BON, duration: 1 }));
    const rep = await fetch('http://127.0.0.1:' + port + '/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-montage-token': JETON_TEST },
      body: JSON.stringify({ images, audioUrl: BON })
    });
    assert.equal(rep.status, 400);
    const corps = await rep.json();
    assert.match(corps.error.message, /Trop d.images/);
  } finally {
    await new Promise(r => serveur.close(r));
  }
});

test('10. le workflow A3 (URLs Storage signées) reste fonctionnel au niveau du code', async () => {
  delete require.cache[require.resolve('../render-service/server.js')];
  process.env.MONTAGE_TOKEN = JETON_TEST;
  const { telechargerVers } = require('../render-service/server.js');
  const fetchOriginal = global.fetch;
  const contenu = Buffer.from('donnee-image-factice');
  global.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => String(contenu.length) },
    body: { getReader() { let lu = false; return { async read() { if (lu) return { done: true }; lu = true; return { done: false, value: contenu }; }, cancel: async () => {} }; } }
  });
  const os = require('os'), fs = require('fs').promises, path2 = require('path');
  const dossier = await fs.mkdtemp(path2.join(os.tmpdir(), 'a3-a2-'));
  try {
    // Un chemin Storage SIGNÉ (bucket privé, audit A3) reste une URL
    // approuvée pour le render-service (voir urlAssetApprouvee) : le
    // nouveau contrôle de jeton A2 ne touche à rien de ce flux, qui reste
    // entièrement fonctionnel au niveau du code.
    const urlSignee = 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/sign/montages/x.jpg?token=abc';
    await telechargerVers(urlSignee, path2.join(dossier, 'x.jpg'));
    const ecrit = await fs.readFile(path2.join(dossier, 'x.jpg'));
    assert.equal(ecrit.toString(), 'donnee-image-factice');
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

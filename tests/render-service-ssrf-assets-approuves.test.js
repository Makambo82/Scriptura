// AUDIT A1 — SSRF du service de rendu (render-service/server.js).
//
// telechargerVers() faisait un fetch(url) NON VÉRIFIÉ sur images[].url,
// audioUrl et musicUrl, trois valeurs qui viennent du client (proxiées
// telles quelles par api/montage-render.js). Un client aurait pu faire
// demander à ce serveur de récupérer localhost, un réseau privé, un
// endpoint de metadata cloud, etc. Correctif : urlAssetApprouvee() n'admet
// que les URLs de l'origine Supabase EXACTE du projet (SUPABASE_URL), sous
// le chemin Storage du bucket `montages`, jamais de résolution DNS ni de
// vérification textuelle du nom d'hôte (voir le commentaire dans
// render-service/server.js pour le détail du raisonnement). Ce fichier
// verrouille les sept cas exigés par l'audit.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
const { urlAssetApprouvee } = require('../render-service/server.js');

const BON = 'https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/public/montages/montage-1/img-0.jpg';

test('accepte une URL Supabase Storage légitime du bucket montages', () => {
  assert.equal(urlAssetApprouvee(BON), true);
  assert.equal(urlAssetApprouvee('https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/sign/montages/x.mp3'), true);
});

test('refuse localhost et 127.0.0.1', () => {
  assert.equal(urlAssetApprouvee('http://localhost:8080/secret'), false);
  assert.equal(urlAssetApprouvee('https://127.0.0.1/secret'), false);
  assert.equal(urlAssetApprouvee('http://0.0.0.0/'), false);
});

test('refuse les réseaux privés RFC1918 et link-local', () => {
  assert.equal(urlAssetApprouvee('http://10.0.0.5/interne'), false);
  assert.equal(urlAssetApprouvee('http://172.16.4.4/interne'), false);
  assert.equal(urlAssetApprouvee('http://192.168.1.1/interne'), false);
  assert.equal(urlAssetApprouvee('http://169.254.1.1/interne'), false);
});

test('refuse l\'endpoint de metadata cloud (169.254.169.254)', () => {
  assert.equal(urlAssetApprouvee('http://169.254.169.254/latest/meta-data/'), false);
});

test('refuse les représentations IPv6 locales/link-local', () => {
  assert.equal(urlAssetApprouvee('http://[::1]/secret'), false);
  assert.equal(urlAssetApprouvee('http://[fe80::1]/secret'), false);
  assert.equal(urlAssetApprouvee('http://[::ffff:127.0.0.1]/secret'), false);
});

test('refuse un domaine externe légitime mais qui n\'est pas le Storage du projet', () => {
  assert.equal(urlAssetApprouvee('https://exemple-cdn-legitime.com/audio.mp3'), false);
  // Un AUTRE projet Supabase (origine différente) n'est pas davantage approuvé.
  assert.equal(urlAssetApprouvee('https://un-autre-projet.supabase.co/storage/v1/object/public/montages/x.jpg'), false);
});

test('refuse la bonne origine mais un mauvais chemin (hors bucket montages)', () => {
  assert.equal(urlAssetApprouvee('https://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/public/autre-bucket/x.jpg'), false);
  assert.equal(urlAssetApprouvee('https://nlkfqxllunbvppulpnzl.supabase.co/rest/v1/abonnes'), false);
});

test('refuse une URL malformée sans planter', () => {
  assert.equal(urlAssetApprouvee('pas-une-url'), false);
  assert.equal(urlAssetApprouvee(''), false);
  assert.equal(urlAssetApprouvee(null), false);
  assert.equal(urlAssetApprouvee(undefined), false);
  assert.equal(urlAssetApprouvee(42), false);
});

test('refuse un schéma non-https même sur la bonne origine', () => {
  assert.equal(urlAssetApprouvee('ftp://nlkfqxllunbvppulpnzl.supabase.co/storage/v1/object/public/montages/x.jpg'), false);
});

// telechargerVers : comportement complet du vrai point de fetch(), avec un
// réseau factice (jamais de vrai accès réseau dans ce test).
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');
const { telechargerVers } = require('../render-service/server.js');

test('telechargerVers refuse une URL non approuvée SANS jamais appeler fetch', async () => {
  const fetchOriginal = global.fetch;
  let appele = false;
  global.fetch = async () => { appele = true; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; };
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'ssrf-test-'));
  try {
    await assert.rejects(
      telechargerVers('http://169.254.169.254/latest/meta-data/', path.join(dossier, 'x.jpg')),
      /URL de média refusée/
    );
    assert.equal(appele, false, 'aucune requête réseau ne doit partir pour une URL non approuvée');
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

test('telechargerVers refuse une redirection, même depuis l\'origine approuvée', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ ok: false, status: 302, headers: { get: () => '/vers-une-ip-privee' } });
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'ssrf-test-'));
  try {
    await assert.rejects(telechargerVers(BON, path.join(dossier, 'x.jpg')), /redirection non autorisée/);
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

// LOT 2, audit A9 : telechargerVers lit désormais la réponse EN FLUX
// (rep.body.getReader(), pour vérifier la taille au fur et à mesure) plutôt
// que d'attendre rep.arrayBuffer() d'un coup. Ce mock reproduit un vrai
// Response minimal (headers.get + body.getReader) plutôt que le raccourci
// arrayBuffer() utilisé avant.
function mockReponseAvecCorps(contenu, { status = 200, ok = true, contentLength } = {}) {
  return {
    ok, status,
    headers: { get: (nom) => (nom.toLowerCase() === 'content-length' ? String(contentLength ?? contenu.length) : null) },
    body: {
      getReader() {
        let livre = false;
        return {
          async read() {
            if (livre) return { done: true, value: undefined };
            livre = true;
            return { done: false, value: contenu };
          },
          cancel: async () => {}
        };
      }
    },
    arrayBuffer: async () => contenu.buffer.slice(contenu.byteOffset, contenu.byteOffset + contenu.byteLength)
  };
}

test('telechargerVers télécharge normalement une URL approuvée (non-régression du montage)', async () => {
  const fetchOriginal = global.fetch;
  const contenu = Buffer.from('donnee-image-factice');
  let urlAppelee = null, optsAppeles = null;
  global.fetch = async (url, opts) => {
    urlAppelee = url; optsAppeles = opts;
    return mockReponseAvecCorps(contenu);
  };
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'ssrf-test-'));
  try {
    const cible = path.join(dossier, 'img-0.jpg');
    await telechargerVers(BON, cible);
    assert.equal(urlAppelee, BON);
    assert.equal(optsAppeles.redirect, 'manual', 'les redirections ne doivent jamais être suivies automatiquement');
    const ecrit = await fs.readFile(cible);
    assert.equal(ecrit.toString(), 'donnee-image-factice', 'le fichier téléchargé doit être écrit tel quel, le montage ne doit pas casser');
  } finally {
    global.fetch = fetchOriginal;
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

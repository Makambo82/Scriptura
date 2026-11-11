// tests/pwa.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');

test('site.webmanifest : display standalone et icônes présentes', () => {
  const fichier = path.join(RACINE, 'site.webmanifest');
  assert.ok(fs.existsSync(fichier), 'site.webmanifest doit exister à la racine');
  const m = JSON.parse(fs.readFileSync(fichier, 'utf8'));

  assert.strictEqual(m.display, 'standalone',
    'display doit être "standalone", pas "browser" (sinon pas de PWA)');
  assert.strictEqual(m.start_url, '/');
  assert.strictEqual(m.scope, '/');
  assert.strictEqual(m.theme_color, '#1C1C1E');
  assert.strictEqual(m.background_color, '#1C1C1E');
  assert.ok(Array.isArray(m.icons) && m.icons.length >= 2,
    'au moins 2 icônes (192 + 512)');

  // Les fichiers d'icônes doivent exister physiquement
  for (const icon of m.icons) {
    const chemin = path.join(RACINE, icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(chemin),
      `icône manquante sur le disque : ${icon.src}`);
  }

  // Au moins une icône maskable (requis pour Android)
  assert.ok(m.icons.some(i => (i.purpose || '').includes('maskable')),
    'au moins une icône "maskable" (Android)');
});

test('sw.js : présent à la racine et contient VERSION', () => {
  const fichier = path.join(RACINE, 'sw.js');
  assert.ok(fs.existsSync(fichier), 'sw.js doit exister à la racine');
  const src = fs.readFileSync(fichier, 'utf8');
  assert.match(src, /^\/\/ VERSION=/m,
    'sw.js doit contenir une ligne // VERSION=... en tête');
  assert.match(src, /self\.addEventListener\(['"]message['"]/,
    'sw.js doit écouter le message SKIP_WAITING');
  assert.match(src, /url\.pathname\.startsWith\(['"]\/api\/['"]\)/,
    'sw.js doit exclure /api/ du cache');
});

test('js/pwa.js : enregistre le SW et gère beforeinstallprompt', () => {
  const fichier = path.join(RACINE, 'js/pwa.js');
  assert.ok(fs.existsSync(fichier));
  const src = fs.readFileSync(fichier, 'utf8');
  assert.match(src, /serviceWorker\.register\(['"]\/sw\.js['"]\)/);
  assert.match(src, /beforeinstallprompt/);
  assert.match(src, /SKIP_WAITING/);
});

test('index.html : pwa.js chargé avec ?v=', () => {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  assert.match(html, /js\/pwa\.js\?v=\d/,
    'pwa.js doit être chargé avec un ?v= (anti-cache)');
  // Chargé après app.js (dernier script)
  const posApp = html.indexOf('js/app.js');
  const posPwa = html.indexOf('js/pwa.js');
  assert.ok(posPwa > posApp,
    'pwa.js doit être chargé APRÈS app.js');
});

test('vercel.json : cache-control sur sw.js et site.webmanifest', () => {
  const v = JSON.parse(fs.readFileSync(path.join(RACINE, 'vercel.json'), 'utf8'));
  const headers = v.headers || [];
  const aSw = headers.some(h => h.source === '/sw.js'
    && h.headers.some(x => /must-revalidate/.test(x.value)));
  const aManifest = headers.some(h => h.source === '/site.webmanifest'
    && h.headers.some(x => /must-revalidate/.test(x.value)));
  assert.ok(aSw, 'vercel.json doit imposer Cache-Control sur /sw.js');
  assert.ok(aManifest, 'vercel.json doit imposer Cache-Control sur /site.webmanifest');
});

// Monogramme S + éclair (retour propriétaire du 9 octobre) : favicon,
// icônes iPhone/Android, image de partage WhatsApp et données structurées
// Google. Avant ce chantier, le site n'avait NI favicon NI image de partage :
// un lien Scriptura envoyé sur WhatsApp s'affichait sans aperçu, et
// /favicon.ico (demandé automatiquement par tous les navigateurs) tombait sur
// la réécriture de vercel.json et renvoyait la page HTML.
//
// Tests statiques (aucun navigateur) : ils lisent les vrais fichiers et les
// vraies balises, pour qu'une icône supprimée, renommée ou remplacée par un
// mauvais format casse ici plutôt qu'en silence chez les robots de partage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const TETE = HTML.slice(0, HTML.indexOf('</head>'));
const ORIGINE = 'https://scriiptura.vercel.app';

const fichier = (url) => path.join(RACINE, url.replace(ORIGINE, '').replace(/^\//, '').split('?')[0]);
const meta = (attr, nom) => { const m = TETE.match(new RegExp(`<meta ${attr}="${nom}" content="([^"]*)"`)); return m ? m[1] : null; };

function taillePng(buf) {
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', 'fichier PNG attendu');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function tailleJpeg(buf) {
  assert.ok(buf[0] === 0xFF && buf[1] === 0xD8, 'fichier JPEG attendu');
  let i = 2;
  while (i < buf.length) {
    const marqueur = buf[i + 1], long = buf.readUInt16BE(i + 2);
    if (marqueur >= 0xC0 && marqueur <= 0xC3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + long;
  }
  throw new Error('dimensions JPEG introuvables');
}

test('toutes les icônes déclarées dans <head> existent vraiment, au bon format', () => {
  const liens = [...TETE.matchAll(/<link rel="(icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map(m => [m[1], m[2]]);
  assert.ok(liens.length >= 5, 'favicon ICO, SVG, PNG, icône iPhone et manifeste attendus : ' + JSON.stringify(liens));
  for (const [, href] of liens) assert.ok(fs.existsSync(fichier(href)), 'REGRESSION : icône déclarée mais absente : ' + href);

  // favicon.ico à la RACINE : c'est l'adresse que les navigateurs demandent d'office
  const ico = fs.readFileSync(path.join(RACINE, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'favicon.ico doit être un vrai fichier ICO');
  const tailles = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i) || 256);
  assert.deepEqual(tailles.sort((a, b) => a - b), [16, 32, 48], 'favicon.ico doit contenir 16, 32 et 48 px');

  // SVG autonome : aucune police externe (un <text> retomberait sur une police
  // système dans l'onglet, le S ne ressemblerait plus au logo)
  const svg = fs.readFileSync(path.join(RACINE, 'favicon.svg'), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<text|font-family|<script/i, 'le favicon SVG doit être fait de tracés, sans police ni script');

  // Google n'affiche dans ses résultats qu'un favicon carré, multiple de 48 px
  assert.deepEqual(taillePng(fs.readFileSync(path.join(RACINE, 'favicon-96x96.png'))), [96, 96]);
  assert.deepEqual(taillePng(fs.readFileSync(path.join(RACINE, 'apple-touch-icon.png'))), [180, 180]);
});

test('le manifeste Android est valide et ses icônes existent (dont une maskable)', () => {
  const man = JSON.parse(fs.readFileSync(path.join(RACINE, 'site.webmanifest'), 'utf8'));
  assert.equal(man.short_name, 'Scriptura');
  assert.equal(man.start_url, '/');
  // "browser" et pas "standalone" : en mode standalone, iOS isole le
  // localStorage de celui de Safari, le créateur se retrouverait sans son
  // code d'accès ni son historique en ouvrant l'icône de l'écran d'accueil.
  assert.equal(man.display, 'browser', 'REGRESSION : passer en standalone isolerait le localStorage sur iOS');
  for (const ic of man.icons) {
    const [l, h] = taillePng(fs.readFileSync(fichier(ic.src)));
    assert.equal(`${l}x${h}`, ic.sizes, 'taille réelle ≠ taille déclarée pour ' + ic.src);
  }
  assert.ok(man.icons.some(i => i.purpose === 'maskable'), 'une icône maskable évite le S rogné dans un cercle sur Android');
});

test('aperçu de lien (WhatsApp, Facebook, X) : image absolue, existante, légère, aux bonnes dimensions', () => {
  const image = meta('property', 'og:image');
  assert.ok(image && image.startsWith(ORIGINE + '/'), 'REGRESSION : og:image doit être une URL ABSOLUE, les robots de partage ne résolvent pas les chemins relatifs : ' + image);
  const buf = fs.readFileSync(fichier(image));
  assert.ok(buf.length < 300 * 1024, 'au-delà de 300 Ko, WhatsApp peut ne pas afficher l\'aperçu : ' + buf.length + ' octets');
  const [l, h] = tailleJpeg(buf);
  assert.equal(String(l), meta('property', 'og:image:width'));
  assert.equal(String(h), meta('property', 'og:image:height'));
  assert.equal(meta('name', 'twitter:image'), image);
  // Le S seul, carré (choix du propriétaire) : vignette, pas grande bannière
  assert.equal(l, h, 'image de partage carrée attendue : le S + éclair seul, sans le mot SCRIPTURA');
  assert.equal(meta('name', 'twitter:card'), 'summary');
  for (const p of ['og:title', 'og:description', 'og:url', 'og:site_name', 'og:image:alt']) assert.ok(meta('property', p), 'balise manquante : ' + p);
  assert.equal(meta('property', 'og:locale'), 'fr_FR');
});

test('référencement : description à la bonne longueur, données structurées valides avec le logo', () => {
  const desc = meta('name', 'description');
  assert.ok(desc, 'REGRESSION : la meta description a disparu (Google en invente une à partir du contenu)');
  assert.ok(desc.length >= 70 && desc.length <= 160, 'description entre 70 et 160 caractères, Google coupe au-delà : ' + desc.length);
  assert.ok(!/—/.test(TETE), 'jamais de tiret cadratin côté utilisateur (charte d\'écriture)');

  const brut = TETE.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(brut, 'données structurées attendues');
  const graphe = JSON.parse(brut[1])['@graph'];
  const orga = graphe.find(n => n['@type'] === 'Organization');
  const site = graphe.find(n => n['@type'] === 'WebSite');
  assert.ok(orga && site, 'Organization et WebSite attendus');
  assert.equal(site.name, 'Scriptura');
  const [l, h] = taillePng(fs.readFileSync(fichier(orga.logo.url)));
  assert.ok(l >= 112 && h >= 112, 'Google exige un logo d\'au moins 112 px');
  assert.ok(!JSON.stringify(graphe).includes('aggregateRating'), 'aucune note inventée dans les données structurées');
});

test('le S de l\'interface pointe vers un fichier qui existe, sans fond (pour le fond sombre de l\'app)', () => {
  const srcs = [...HTML.matchAll(/<img class="logo-mark" src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(srcs.length, 4, 'les 4 emplacements du logo (en-tête, menu, écran de génération, pied de page)');
  const svg = fs.readFileSync(path.join(RACINE, srcs[0]), 'utf8');
  assert.doesNotMatch(svg, /url\(#tile\)/, 'le S de l\'interface ne doit pas avoir de carré de fond, il est posé sur le fond de l\'app');
  assert.doesNotMatch(svg, /<text|font-family/i);
});

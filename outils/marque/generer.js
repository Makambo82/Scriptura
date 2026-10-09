// Regénère TOUS les fichiers de la marque (monogramme S + éclair) depuis une
// seule source, icon.html (le dessin) :
//   node outils/marque/generer.js
// Écrit à la racine du site : favicon.ico (16/32/48), favicon.svg,
// favicon-96x96.png, apple-touch-icon.png, et dans assets/brand/ : icônes
// Android (dont maskable), s-mark.svg (le S sans fond de l'interface) et
// og-image-s.jpg (image de partage). Vérifié ensuite par tests/marque-icones-et-partage.test.js.
//
// ATTENTION, cache : assets/ est servi en cache "immutable" un an (voir
// vercel.json). Si le dessin change, RENOMMER les fichiers de assets/brand/
// (ex. og-image-2.jpg) et mettre à jour leurs références, sinon les
// navigateurs et WhatsApp garderont l'ancien.
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { lancerNavigateur } = require('../../tests/helpers/navigateur');
const FF = require('ffmpeg-static');
const RACINE = path.join(__dirname, '..', '..');

const srv = http.createServer((q, r) => {
  fs.readFile(path.join(RACINE, decodeURIComponent(q.url.split('?')[0])), (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; } r.end(d);
  });
}).listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/outils/marque/`;
  const b = await lancerNavigateur();
  const p = await b.newPage({ viewport: { width: 600, height: 600 } });
  const ecrire = (f) => path.join(RACINE, f);
  const png = async (qs, taille, f) => {
    await p.goto(base + 'icon.html?' + qs + '&s=' + taille);
    await p.locator('#ic').screenshot({ path: ecrire(f), omitBackground: true });
    return fs.readFileSync(ecrire(f));
  };
  const svg = async (qs, viewBox) => {
    await p.goto(base + 'icon.html?' + qs + '&s=512');
    let s = await p.evaluate(() => document.getElementById('ic').outerHTML);
    s = s.replace(/ id="ic"/, '').replace(/ width="512" height="512"/, '');
    if (viewBox) s = s.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`);
    return s.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  };
  try {
    // Favicons : géométrie "small" (découpe et éclair calibrés pour 16-48 px)
    const ico = [];
    for (const n of [16, 32, 48]) ico.push([n, await png('small=1', n, `favicon-${n}.tmp.png`)]);
    fs.writeFileSync(ecrire('favicon.svg'), await svg('small=1'));
    await png('', 96, 'favicon-96x96.png');
    // iPhone : carré plein cadre et opaque (iOS arrondit lui-même ; une
    // transparence dans les coins deviendrait noire)
    await png('bleed=1', 180, 'apple-touch-icon.png');
    fs.mkdirSync(ecrire('assets/brand'), { recursive: true });
    await png('', 192, 'assets/brand/icon-192.png');
    await png('', 512, 'assets/brand/icon-512.png');
    // maskable : contenu réduit à 85 % pour tenir dans le cercle de sécurité Android
    await png('bleed=1&zoom=0.85', 512, 'assets/brand/icon-maskable-512.png');
    fs.writeFileSync(ecrire('assets/brand/s-mark.svg'), await svg('bare=1', '116 92 280 326'));
    // Image de partage : le S + éclair SEUL (retour propriétaire du 9 octobre,
    // « pas tout SCRIPTURA »). Carrée 1200x1200, plein cadre et opaque (une
    // transparence deviendrait blanche ou noire selon l'appli), en JPG pour
    // rester sous les 300 Ko au-delà desquels WhatsApp peut ne rien afficher.
    await p.setViewportSize({ width: 1200, height: 1200 });
    const tmp = ecrire('og.tmp.png');
    await p.goto(base + 'icon.html?bleed=1&s=1200');
    await p.locator('#ic').screenshot({ path: tmp });
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-pix_fmt', 'yuvj420p', '-q:v', '3', ecrire('assets/brand/og-image-s.jpg')]);
    fs.unlinkSync(tmp);
    // favicon.ico multi-tailles, entrées PNG (lues par tous les navigateurs actuels)
    const tete = Buffer.alloc(6 + 16 * ico.length);
    tete.writeUInt16LE(0, 0); tete.writeUInt16LE(1, 2); tete.writeUInt16LE(ico.length, 4);
    let decalage = tete.length;
    ico.forEach(([n, d], i) => {
      const e = 6 + 16 * i;
      tete.writeUInt8(n, e); tete.writeUInt8(n, e + 1); tete.writeUInt16LE(1, e + 4); tete.writeUInt16LE(32, e + 6);
      tete.writeUInt32LE(d.length, e + 8); tete.writeUInt32LE(decalage, e + 12); decalage += d.length;
    });
    fs.writeFileSync(ecrire('favicon.ico'), Buffer.concat([tete, ...ico.map(x => x[1])]));
    for (const n of [16, 32, 48]) fs.unlinkSync(ecrire(`favicon-${n}.tmp.png`));
    console.log('Fichiers de marque regénérés.');
  } finally { await b.close(); srv.close(); }
});

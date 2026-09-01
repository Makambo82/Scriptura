// Sous-titres incrustés (retour propriétaire) : test des fonctions pures de
// construction du fichier ASS (server.js). Pas dans le dépôt principal
// (tests/) : ce service a son propre package.json/déploiement, séparé du
// site (voir README.md). Lancer avec : node render-service/test-sous-titres.js
const assert = require('node:assert/strict');
const { construireASS, versHorodatageASS, echapperTexteASS } = require('./server.js');

function test(nom, fn) {
  try {
    fn();
    console.log('ok - ' + nom);
  } catch (e) {
    console.error('PAS OK - ' + nom);
    console.error(e);
    process.exitCode = 1;
  }
}

test('versHorodatageASS formate correctement H:MM:SS.cc', () => {
  assert.equal(versHorodatageASS(0), '0:00:00.00');
  assert.equal(versHorodatageASS(0.55), '0:00:00.55');
  assert.equal(versHorodatageASS(65.5), '0:01:05.50');
  assert.equal(versHorodatageASS(3661.23), '1:01:01.23');
});

test('echapperTexteASS retire les accolades (balises de style inline ASS) et les retours à la ligne', () => {
  assert.equal(echapperTexteASS('Ceci est {un} test'), 'Ceci est un test');
  assert.equal(echapperTexteASS('ligne 1\nligne 2'), 'ligne 1 ligne 2');
});

test('construireASS déclare PlayResX/PlayResY = dimensions réelles de sortie (pas un défaut générique qui fausserait la position verticale)', () => {
  const ass = construireASS([{ texte: 'Ceci est un', debut: 0, fin: 0.55 }], 720, 1280);
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /PlayResY: 1280/);
});

test('construireASS produit une ligne Dialogue par sous-titre, avec les bons horodatages et le bon texte', () => {
  const captions = [
    { texte: 'Ceci est un', debut: 0, fin: 0.55 },
    { texte: 'test de sous', debut: 0.6, fin: 1.2 }
  ];
  const ass = construireASS(captions, 720, 1280);
  const lignesDialogue = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  assert.equal(lignesDialogue.length, 2, 'une ligne Dialogue par sous-titre : ' + ass);
  assert.ok(lignesDialogue[0].includes('0:00:00.00,0:00:00.55') && lignesDialogue[0].endsWith('Ceci est un'), lignesDialogue[0]);
  assert.ok(lignesDialogue[1].includes('0:00:00.60,0:00:01.20') && lignesDialogue[1].endsWith('test de sous'), lignesDialogue[1]);
});

test('construireASS met une taille de police et une marge proportionnelles à la résolution (pas une valeur fixe qui écraserait un format différent)', () => {
  const assVertical = construireASS([{ texte: 'x', debut: 0, fin: 1 }], 720, 1280);
  const assCarre = construireASS([{ texte: 'x', debut: 0, fin: 1 }], 1000, 1000);
  const tailleVertical = assVertical.match(/Default,DejaVu Sans,(\d+),/)[1];
  const tailleCarre = assCarre.match(/Default,DejaVu Sans,(\d+),/)[1];
  assert.notEqual(tailleVertical, tailleCarre, 'la taille de police doit varier avec la largeur de sortie');
});

test('construireASS gère une liste vide sans planter (aucun sous-titre à afficher)', () => {
  const ass = construireASS([], 720, 1280);
  assert.match(ass, /PlayResX: 720/);
  assert.ok(!ass.includes('Dialogue:'), 'aucune ligne Dialogue attendue : ' + ass);
});

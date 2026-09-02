// Sous-titres incrustés (retour propriétaire) : test des fonctions pures de
// construction du fichier ASS (server.js). Pas dans le dépôt principal
// (tests/) : ce service a son propre package.json/déploiement, séparé du
// site (voir README.md). Lancer avec : node render-service/test-sous-titres.js
const assert = require('node:assert/strict');
const {
  construireASS, versHorodatageASS, echapperTexteASS, mettreEnValeurChiffres,
  construireGrapheLot, resoudreVolumeMusique,
  MUSIQUE_VOLUME_DEFAUT, MUSIQUE_VOLUME_MIN, MUSIQUE_VOLUME_MAX,
  GRADE_CONTRASTE, GRADE_SATURATION
} = require('./server.js');

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

// Volume de la musique de fond (retour propriétaire), réglable par montage
// (musicVolume dans la requête /render, voir menu "Volume de la musique"
// côté client) : jamais une valeur hors plage (5%-50%) envoyée telle quelle
// à FFmpeg, la valeur par défaut sert seulement si le client n'en envoie pas.
test('resoudreVolumeMusique transmet la valeur demandée si elle est déjà dans la plage 5%-50%', () => {
  assert.equal(resoudreVolumeMusique(0.3), 0.3);
  assert.equal(resoudreVolumeMusique(MUSIQUE_VOLUME_MIN), MUSIQUE_VOLUME_MIN);
  assert.equal(resoudreVolumeMusique(MUSIQUE_VOLUME_MAX), MUSIQUE_VOLUME_MAX);
});

test('resoudreVolumeMusique cale une valeur hors plage sur la borne la plus proche', () => {
  assert.equal(resoudreVolumeMusique(0.01), MUSIQUE_VOLUME_MIN, 'trop bas -> remonté au minimum');
  assert.equal(resoudreVolumeMusique(1), MUSIQUE_VOLUME_MAX, 'trop haut -> ramené au maximum (la musique ne doit jamais pouvoir couvrir la voix)');
});

test('resoudreVolumeMusique retombe sur la valeur par défaut si rien n\'est envoyé (absent, non numérique)', () => {
  assert.equal(resoudreVolumeMusique(undefined), MUSIQUE_VOLUME_DEFAUT);
  assert.equal(resoudreVolumeMusique('pas-un-nombre'), MUSIQUE_VOLUME_DEFAUT);
});

// Mots-clés en couleur (retour propriétaire, "en tant que pro CapCut") :
// chiffres/statistiques colorés en doré dans les sous-titres.
test('mettreEnValeurChiffres entoure les chiffres/statistiques de balises de couleur ASS, jamais le reste du texte', () => {
  const resultat = mettreEnValeurChiffres('Gagne 73% de temps en 3 minutes');
  assert.equal(resultat, 'Gagne {\\c&H7AC8E2&}73%{\\c&HFFFFFF&} de temps en {\\c&H7AC8E2&}3 {\\c&HFFFFFF&}minutes', resultat);
});

test('mettreEnValeurChiffres laisse un texte sans chiffre totalement inchangé', () => {
  assert.equal(mettreEnValeurChiffres('Aucun chiffre ici'), 'Aucun chiffre ici');
});

test('construireASS applique la mise en couleur des chiffres aux sous-titres normaux', () => {
  const ass = construireASS([{ texte: '10 astuces', debut: 0, fin: 1 }], 720, 1280);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Default,,0,0,0,,\{\\c&H7AC8E2&\}10 \{\\c&HFFFFFF&\}astuces/, ass);
});

// Étalonnage (retour propriétaire, "en tant que pro CapCut") : contraste et
// saturation appliqués à chaque plan, pour un rendu moins plat que des
// images IA brutes.
test('construireGrapheLot applique le filtre d\'étalonnage (eq contrast/saturation) à chaque plan', () => {
  const graphe = construireGrapheLot([2, 3], 0, 720, 1280);
  const occurrences = (graphe.match(/eq=contrast=/g) || []).length;
  assert.equal(occurrences, 2, 'un filtre eq par plan attendu (2 plans) : ' + graphe);
  assert.ok(graphe.includes(`eq=contrast=${GRADE_CONTRASTE}:saturation=${GRADE_SATURATION}`), graphe);
});

// Filigrane Scriptura (retour propriétaire), facultatif (case à cocher côté
// client, cochée par défaut) : petit texte semi-transparent en coin bas-droit,
// présent toute la vidéo.
test('construireASS ajoute une ligne Dialogue "SCRIPTURA" (style Filigrane) sur toute la durée quand demandé', () => {
  const ass = construireASS([], 720, 1280, 42.5);
  assert.match(ass, /Style: Filigrane,/, 'le style Filigrane doit être déclaré : ' + ass);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:42\.50,Filigrane,,0,0,0,,SCRIPTURA/, ass);
});

test('construireASS n\'ajoute AUCUNE ligne de filigrane quand il n\'est pas demandé (facultatif, décochable)', () => {
  const ass = construireASS([{ texte: 'Un test', debut: 0, fin: 1 }], 720, 1280);
  assert.ok(!ass.includes(',Filigrane,'), 'aucune ligne de filigrane attendue sans le paramètre : ' + ass);
});

test('construireASS : le filigrane peut cohabiter avec les sous-titres, chacun sur sa propre ligne', () => {
  const ass = construireASS(
    [{ texte: 'Un test', debut: 0, fin: 1 }],
    720, 1280,
    10
  );
  assert.match(ass, /,Default,,0,0,0,,/, 'sous-titre présent : ' + ass);
  assert.match(ass, /,Filigrane,,0,0,0,,SCRIPTURA/, 'filigrane présent : ' + ass);
});

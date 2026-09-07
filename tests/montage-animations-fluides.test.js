// Retour d'un vrai utilisateur, dit publiquement dans une vidéo TikTok : « les
// zooms sont saccadés ». Il avait raison, et c'était pire que ça en avait
// l'air. Mesuré avec ffmpeg à la résolution réellement produite (720x1280) :
//   plan de  5 s : 51 % des images ne bougeaient pas du tout
//   plan de  8 s : 70 %
//   plan de 12 s : 80 %
//
// LA CAUSE : zoompan arrondit x, y et la taille de sa fenêtre à des pixels
// ENTIERS. L'image lui arrivait déjà à la résolution de sortie, or sur un plan
// de 5 s la fenêtre ne se déplace que de 120 px en 125 images, donc moins d'un
// pixel par image. L'arrondi transforme ce glissement en marches d'escalier.
//
// LE REMÈDE : donner à zoompan une image plus GRANDE que sa sortie, pour que
// l'arrondi se fasse sur des pixels plus petits que ceux de la vidéo finale.
//
// CE QUE CES TESTS VERROUILLENT :
//   1. l'image entre bien SUR-ÉCHANTILLONNÉE dans zoompan, et en ressort à la
//      taille de sortie : c'est toute la correction ;
//   2. le facteur SUIT LA DURÉE du plan. Un facteur fixe serait soit
//      insuffisant sur les plans longs, soit ruineux sur les courts ;
//   3. il reste PLAFONNÉ. Le 6x consommait 1,3 Go sur un lot de trois plans,
//      et ce conteneur a déjà connu l'OOM ;
//   4. rien d'autre ne bouge : mêmes durées, mêmes transitions, même sortie.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  construireGrapheLot, facteurSurEchantillonnage
} = require('../render-service/server.js');

const W = 720, H = 1280, FPS = 25;

test('l\'image entre plus grande dans zoompan, et en ressort à la bonne taille', () => {
  const graphe = construireGrapheLot([5], 0, W, H);

  // La taille d'ENTRÉE doit être un multiple de la sortie, jamais la sortie
  // elle-même : c'est exactement l'état d'avant, celui qui saccadait.
  const scale = /scale=(\d+):(\d+):force_original_aspect_ratio=increase/.exec(graphe);
  assert.ok(scale, 'le graphe doit commencer par une mise à l\'échelle : ' + graphe);
  const [, sw, sh] = scale.map(Number);

  assert.ok(sw > W && sh > H,
    'REGRESSION : l\'image entre dans zoompan à la taille de sortie (' + sw + 'x' + sh + '). C\'est '
    + 'exactement l\'état qui figeait la moitié des images : zoompan arrondit ses positions à des '
    + 'pixels entiers, et sur un plan de 5 s la fenêtre se déplace de moins d\'un pixel par image.');

  assert.equal(sw / W, sh / H,
    'REGRESSION : le sur-échantillonnage déforme l\'image (' + (sw / W) + 'x en largeur contre '
    + (sh / H) + 'x en hauteur). Le cadrage changerait avec la durée du plan.');

  // Et zoompan doit ramener lui-même à la taille de sortie, sinon toute la
  // suite du graphe (transitions, concaténation) travaillerait en géant.
  // Le motif vise ':s=LxH:' et non 'zoompan=[^,]*' : l'expression du zoom
  // contient elle-même des virgules (min(zoom+0.001,1.2)), un [^,]* s'arrête
  // donc avant d'atteindre le paramètre cherché et le test crie à tort.
  assert.match(graphe, new RegExp(':s=' + W + 'x' + H + ':fps='),
    'REGRESSION : zoompan ne ramène plus à la taille de sortie. Les transitions et l\'encodage se '
    + 'feraient sur l\'image sur-échantillonnée : mémoire et temps de rendu explosent.');

  assert.ok(!new RegExp('crop=' + W + ':' + H + ',').test(graphe),
    'REGRESSION : le recadrage se fait encore à la taille de sortie avant zoompan : ' + graphe);
});

test('le facteur suit la durée du plan, et reste plafonné', () => {
  const pour = (secondes) => facteurSurEchantillonnage(Math.round(secondes * FPS), W);

  const court = pour(5), moyen = pour(8), long = pour(20);

  // MESURÉ, pas supposé : à 720x1280, un plan de 5 s est propre dès 3x, un
  // plan de 8 s demande 4x. Un facteur qui ne monterait pas laisserait les
  // plans longs saccader ; un facteur fixe et haut ferait payer les courts.
  assert.ok(moyen > court,
    'REGRESSION : le facteur ne monte plus avec la durée (' + court + 'x à 5 s comme ' + moyen
    + 'x à 8 s). Un plan long étale la même course sur plus d\'images : il lui faut plus de finesse, '
    + 'sinon il saccade pendant que les plans courts paient pour rien.');

  assert.ok(court >= 2,
    'REGRESSION : un plan court descend sous 2x (' + court + 'x). Même les plans les plus rapides '
    + 'bougeaient de moins d\'un pixel par image avant la correction.');

  assert.ok(long <= 4,
    'REGRESSION : le facteur n\'est plus plafonné (' + long + 'x sur un plan de 20 s). Mesuré : le 6x '
    + 'consomme 1,3 Go sur un lot de trois plans, et ce conteneur a déjà connu l\'OOM. Mieux vaut un '
    + 'plan très long légèrement imparfait qu\'un rendu qui ne finit jamais.');

  // Une durée absurde ne doit pas produire un graphe absurde.
  assert.ok(facteurSurEchantillonnage(0, W) >= 2, 'durée nulle : on retombe sur le minimum');
  assert.ok(facteurSurEchantillonnage(1, W) >= 2, 'une seule image : idem');
});

test('rien d\'autre n\'a bougé : durées, transitions et sortie inchangées', () => {
  const durees = [4, 6, 5];
  const graphe = construireGrapheLot(durees, 0, W, H);

  // Les frontières de fondu sont la synchronisation avec la voix off : si
  // elles bougeaient, chaque image apparaîtrait à côté de ce qu'elle illustre.
  const offsets = [...graphe.matchAll(/xfade=[^\]]*offset=([\d.]+)/g)].map(m => Number(m[1]));
  assert.deepEqual(offsets, [4, 10],
    'REGRESSION : les frontières de transition ont changé. Elles portent la synchronisation avec la '
    + 'voix off, et chaque image apparaîtrait à côté de ce qu\'elle raconte. Vu : '
    + JSON.stringify(offsets));

  assert.equal([...graphe.matchAll(/zoompan=/g)].length, durees.length,
    'un zoompan par plan, comme avant');
  assert.match(graphe, /\[vout\]$/, 'le graphe sort toujours sur [vout]');

  // Le nombre d'images de chaque plan ne doit pas dépendre du facteur.
  // Même raison que plus haut : on vise ':d=N:s=' directement.
  const d = [...graphe.matchAll(/:d=(\d+):s=/g)].map(m => Number(m[1]));
  assert.deepEqual(d, durees.map(x => Math.round((x + 0.5) * FPS)),
    'REGRESSION : le nombre d\'images par plan a changé. La durée de la vidéo ne collerait plus à la '
    + 'voix off. Vu : ' + JSON.stringify(d));
});

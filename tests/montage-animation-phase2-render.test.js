// PHASE 2 (animation IA, Agnes AI, voir api/montage-media.js et
// js/montage.js) : un plan de montage peut arriver comme un clip DÉJÀ
// ANIMÉ plutôt qu'une image fixe. Ce fichier verrouille le comportement de
// construireGrapheLot pour ce cas (voir render-service/server.js) :
//
//   1. rétrocompatibilité : sans `types` (5e argument, optionnel), le
//      comportement est EXACTEMENT celui d'avant (Ken Burns partout) ;
//   2. un plan marqué 'video' n'a NI zoompan NI sur-échantillonnage (les
//      deux compensent l'arrondi entier de zoompan sur une image FIXE, un
//      clip déjà animé n'a pas ce défaut, et payer le coût mémoire du
//      sur-échantillonnage pour rien serait pur gaspillage) ;
//   3. un lot MIXTE (image + vidéo) applique la bonne règle à CHAQUE plan,
//      indépendamment des autres.
const test = require('node:test');
const assert = require('node:assert/strict');
const { construireGrapheLot } = require('../render-service/server.js');

const W = 1080, H = 1920;

test('sans `types`, rien ne change : toujours du Ken Burns (rétrocompatibilité)', () => {
  const graphe = construireGrapheLot([5], 0, W, H);
  assert.ok(/zoompan=/.test(graphe), 'le comportement historique (Ken Burns) doit rester le défaut');
});

test('un plan `video` n\'a ni zoompan ni sur-échantillonnage', () => {
  const graphe = construireGrapheLot([5], 0, W, H, ['video']);
  assert.ok(!/zoompan=/.test(graphe), 'REGRESSION : un clip déjà animé ne doit jamais repasser par zoompan');
  // Cadré DIRECTEMENT à W x H (pas de sur-échantillonnage à redescendre
  // ensuite) : la mise à l'échelle vise la taille de SORTIE, pas un
  // multiple.
  const scale = /scale=(\d+):(\d+):force_original_aspect_ratio=increase/.exec(graphe);
  assert.ok(scale, 'le graphe doit quand même cadrer le clip au format de sortie : ' + graphe);
  assert.equal(Number(scale[1]), W, 'REGRESSION : un clip vidéo ne doit pas être sur-échantillonné (largeur)');
  assert.equal(Number(scale[2]), H, 'REGRESSION : un clip vidéo ne doit pas être sur-échantillonné (hauteur)');
  // L'étalonnage (contraste/saturation) doit rester appliqué, comme pour
  // toute image : un clip animé ne doit pas paraître plus terne que le
  // reste du montage.
  assert.ok(/eq=contrast=/.test(graphe), 'l\'étalonnage doit s\'appliquer aussi aux plans vidéo');
});

test('lot mixte : chaque plan suit sa propre règle, indépendamment des autres', () => {
  const graphe = construireGrapheLot([4, 6, 5], 0, W, H, ['image', 'video', 'image']);
  // Un zoompan pour le plan 0, aucun pour le plan 1 (vidéo), un pour le
  // plan 2 : on vérifie par bloc [i:v]...[vI], pas juste un compte global,
  // pour être sûr que c'est le BON plan qui a ou n'a pas de zoompan.
  const bloc = (i) => {
    const debut = graphe.indexOf(`[${i}:v]`);
    const fin = graphe.indexOf(`[v${i}]`, debut) + `[v${i}]`.length;
    return graphe.slice(debut, fin);
  };
  assert.ok(/zoompan=/.test(bloc(0)), 'plan 0 (image) doit garder son Ken Burns');
  assert.ok(!/zoompan=/.test(bloc(1)), 'REGRESSION : plan 1 (vidéo) ne doit jamais avoir de zoompan');
  assert.ok(/zoompan=/.test(bloc(2)), 'plan 2 (image) doit garder son Ken Burns');
  // Les transitions entre plans (xfade) doivent rester intactes, un lot
  // mixte n'est pas un cas particulier pour l'enchaînement.
  const nbXfade = (graphe.match(/xfade=transition=/g) || []).length;
  assert.equal(nbXfade, 2, 'un lot de 3 plans doit toujours produire 2 transitions, mixte ou non');
});

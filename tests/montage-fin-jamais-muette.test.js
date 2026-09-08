// Demande du propriétaire : « que l'app coupe la musique proportionnellement à
// la durée de la voix off. Durée musique = durée voix off ».
//
// VÉRIFIÉ AVANT DE CODER, et c'était déjà le cas : le mélange audio se cale
// sur la voix (amix duration=first) et la musique boucle sous elle
// (-stream_loop -1). Mesuré sur un rendu réel : piste audio de 5,01 s pour une
// voix de 5 s. La musique ne déborde jamais.
//
// MAIS EN LE VÉRIFIANT, UN VRAI DÉFAUT EST APPARU. Sur ce même rendu, la VIDÉO
// durait 8,00 s pour 5,01 s d'audio : trois secondes de fin sans voix NI
// musique. Mesuré au décibel : signal à 1 s et 4 s, plus rien à 5,5 s et 7 s.
// Trois secondes de silence à la fin d'une vidéo TikTok, ça ne passe pas pour
// une intention, ça passe pour un bug.
//
// LA CAUSE : le calage vidéo/audio n'existait que dans UN sens. Quand l'audio
// dépassait la somme des plans, on allongeait la dernière image. Quand il était
// plus court, rien. Le commentaire d'origine promettait pourtant « la vidéo
// dure exactement la voix off ».
const test = require('node:test');
const assert = require('node:assert/strict');
const { calerDureesSurAudio } = require('../render-service/server.js');

const somme = (t) => Number(t.reduce((s, d) => s + d, 0).toFixed(3));

test('audio plus COURT que la vidéo : plus de fin muette', () => {
  // Écart RÉALISTE : les durées viennent des horodatages d'ElevenLabs, l'écart
  // est un silence de fin de quelques dixièmes, pas plusieurs secondes. Le cas
  // extrême est traité à part, plus bas, avec son plancher.
  const durees = [3, 2.5, 2.5];
  calerDureesSurAudio(durees, 7.2);

  assert.equal(somme(durees), 7.2,
    'REGRESSION : la vidéo dure encore plus longtemps que la voix off. Ces secondes-là n\'ont NI voix '
    + 'NI musique, puisque le mélange audio se cale sur la voix : le créateur publie une vidéo qui se '
    + 'termine sur un silence. Vidéo : ' + somme(durees) + 's pour 7,2s d\'audio.');

  assert.deepEqual(durees.slice(0, 2), [3, 2.5],
    'REGRESSION : les plans du milieu ont bougé. L\'écart vient d\'un silence de FIN, pas d\'une dérive '
    + 'régulière : chaque image doit rester alignée sur le segment de narration qu\'elle illustre, ce '
    + 'qui est tout l\'intérêt des horodatages reçus d\'ElevenLabs. Vu : ' + JSON.stringify(durees));
});

test('audio plus LONG que la vidéo : la narration n\'est jamais coupée', () => {
  // Comportement d'origine, qui doit survivre au correctif.
  const durees = [3, 2.5, 2.5];
  calerDureesSurAudio(durees, 9.4);

  assert.equal(somme(durees), 9.4,
    'REGRESSION : la vidéo est plus courte que la voix off, donc la narration est COUPÉE en plein '
    + 'milieu d\'une phrase. Vu : ' + somme(durees) + 's pour 9,4s d\'audio.');
  assert.deepEqual(durees.slice(0, 2), [3, 2.5], 'et seule la dernière image absorbe l\'écart');
});

test('un écart minuscule ne fait bouger personne', () => {
  const durees = [3, 2.5, 2.5];
  const avant = durees.slice();
  calerDureesSurAudio(durees, 8.02);
  assert.deepEqual(durees, avant,
    'REGRESSION : on retouche les durées pour deux centièmes de seconde. Chaque retouche décale une '
    + 'image par rapport à sa narration : elle doit servir à quelque chose.');
});

test('la dernière image ne se réduit jamais à un clignotement', () => {
  // Écart énorme : la dernière image devrait tomber à -6 s.
  const durees = [3, 2.5, 2.5];
  calerDureesSurAudio(durees, 2.0);

  assert.ok(durees[durees.length - 1] >= 1,
    'REGRESSION : la dernière image tombe à ' + durees[durees.length - 1] + 's. Une durée nulle ou '
    + 'négative produit un graphe FFmpeg invalide, et une durée de deux dixièmes produit un '
    + 'clignotement que personne ne comprend. Mieux vaut un reste de silence que ça.');
  assert.ok(durees.every(d => d > 0), 'aucune durée négative : ' + JSON.stringify(durees));
});

test('les entrées absurdes ne cassent rien', () => {
  assert.deepEqual(calerDureesSurAudio([], 5), [], 'aucun plan : rien à caler');
  const d = [4, 4];
  // Durée d'audio illisible (ffprobe muet) : on ne touche à rien plutôt que
  // de fabriquer une vidéo de zéro seconde.
  assert.deepEqual(calerDureesSurAudio(d.slice(), 0), d,
    'REGRESSION : une durée d\'audio nulle ou illisible écrase les durées. Le rendu produirait une '
    + 'vidéo vide alors que les plans, eux, étaient bons.');
  assert.deepEqual(calerDureesSurAudio(d.slice(), NaN), d, 'idem pour une valeur non numérique');
});

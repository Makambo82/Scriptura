// Retour du propriétaire : « pour la durée des scripts, récits et séries, je
// remarque qu'il y a toujours un écart, je me demande pourquoi ».
//
// ENQUÊTE. Les trois modes convertissent la durée choisie en une fourchette
// de mots, à 2,5 mots par seconde (MOTS_PAR_SEC_PARLE, js/storyboard.js).
// Cette fourchette était centrée SOUS la durée demandée : le milieu de
// 130-155 vaut 57 secondes, pas 60, et sur 30 secondes l'écart montait à 8 %.
//
// Or un modèle à qui on donne une fourchette atterrit presque toujours vers
// le bas. Les deux biais s'additionnaient, ce qui explique que l'écart soit
// CONSTANT et TOUJOURS DANS LE MÊME SENS : trop court, jamais trop long.
//
// CORRECTIF RETENU, et lui seul (le propriétaire a écarté pour l'instant le
// resserrement de la tolérance, qui déclencherait des passes IA
// supplémentaires) : chaque fourchette a désormais pour MILIEU le nombre de
// mots qui fait exactement la durée demandée. Largeur inchangée, tolérance
// inchangée, aucun appel IA de plus.
//
// Ce test calcule la durée réelle du milieu de chaque fourchette et la compare
// à la durée promise. Il tient donc tout seul si quelqu'un touche aux cibles
// ou au débit de référence : les deux sont relus dans les fichiers de l'app,
// jamais recopiés ici.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

// Le débit de référence vient du code, pas d'une constante répétée ici : si
// on le change un jour, ce test doit suivre automatiquement.
const MOTS_PAR_SEC = parseFloat(lire('storyboard.js').match(/const MOTS_PAR_SEC_PARLE = ([\d.]+)/)[1]);

function extraireCibles(source, nomTable) {
  const debut = source.indexOf(nomTable);
  assert.ok(debut > 0, 'table introuvable : ' + nomTable);
  const bloc = source.slice(debut, source.indexOf('};', debut));
  const cibles = {};
  const re = /'([^']+)':\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)/g;
  let m;
  while ((m = re.exec(bloc))) cibles[m[1]] = { min: +m[2], max: +m[3] };
  return cibles;
}

// Durée promise par un libellé, en secondes. Une fourchette annoncée ("45 à
// 60 secondes") promet son milieu.
function secondesPromises(libelle) {
  const nombres = (libelle.match(/\d+/g) || []).map(Number);
  const enMinutes = /minute/.test(libelle);
  if (!nombres.length) return null;
  const valeurs = nombres.map(n => (enMinutes ? n * 60 : n));
  return valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
}

const ECART_MAX = 0.01; // 1 % : au-delà, la promesse n'est plus tenue

function verifier(cibles, nom) {
  const lignes = [];
  for (const [libelle, { min, max }] of Object.entries(cibles)) {
    const promis = secondesPromises(libelle);
    assert.ok(promis, nom + ' : durée illisible dans le libellé "' + libelle + '"');
    const reelle = ((min + max) / 2) / MOTS_PAR_SEC;
    const ecart = (reelle - promis) / promis;
    lignes.push(`${libelle} : milieu ${(min + max) / 2} mots = ${reelle.toFixed(1)} s pour ${promis} s promises (${(ecart * 100).toFixed(1)} %)`);
    assert.ok(Math.abs(ecart) <= ECART_MAX,
      nom + ' : la fourchette n\'est pas centrée sur la durée demandée. ' + lignes[lignes.length - 1]);
    assert.ok(min < max, nom + ' : fourchette vide ou inversée pour ' + libelle);
  }
  return lignes;
}

test('mode Script : chaque fourchette de mots est centrée sur la durée demandée', () => {
  const cibles = extraireCibles(lire('generation.js'), 'const wordTargets = {');
  assert.equal(Object.keys(cibles).length, 5, 'les cinq durées doivent être couvertes');
  verifier(cibles, 'Script');
});

test('mode Récit : mêmes cibles, mêmes garanties', () => {
  const script = extraireCibles(lire('generation.js'), 'const wordTargets = {');
  const recit = extraireCibles(lire('storytelling.js'), 'const wordTargets = {');
  verifier(recit, 'Récit');
  // Les deux modes promettent les mêmes durées au créateur : leurs cibles ne
  // doivent pas diverger, sinon "1 minute" ne veut plus dire la même chose
  // d'un mode à l'autre.
  for (const [libelle, v] of Object.entries(recit)) {
    assert.deepEqual({ min: v.min, max: v.max }, { min: script[libelle].min, max: script[libelle].max },
      'Script et Récit doivent viser la même chose pour "' + libelle + '"');
  }
});

test('mode Série : les fourchettes d\'épisode tiennent aussi leur promesse', () => {
  const cibles = extraireCibles(lire('serie.js'), 'const WORD_TARGETS_SERIE = {');
  assert.equal(Object.keys(cibles).length, 4);
  verifier(cibles, 'Série');
});

// Le recentrage ne devait PAS resserrer la fenêtre de correction : le
// propriétaire a écarté cette option pour l'instant, parce qu'elle
// déclencherait des passes IA supplémentaires. La largeur des fourchettes est
// donc restée celle d'avant, à un mot près d'arrondi.
test('le recentrage n\'a PAS resserré les fourchettes, donc aucun appel IA de plus', () => {
  const largeursAvant = { '30 secondes': 18, '1 minute': 25, '2 minutes': 40, '3 minutes': 50, '5 minutes': 100 };
  const cibles = extraireCibles(lire('generation.js'), 'const wordTargets = {');
  for (const [libelle, avant] of Object.entries(largeursAvant)) {
    const maintenant = cibles[libelle].max - cibles[libelle].min;
    assert.ok(maintenant >= avant - 1,
      'REGRESSION : la fourchette de "' + libelle + '" est passée de ' + avant + ' à ' + maintenant
      + ' mots. Resserrer déclenche plus de corrections, donc plus d\'appels IA, ce que le propriétaire n\'a pas demandé.');
  }
});

// « Par rapport à la durée des plans qui sont trop longs, je crois que le
// problème doit être réglé à la base depuis la génération du script/récit/
// série. S'il y a des phrases longues les plans seront longs. » (propriétaire)
//
// Il a raison, et le découpeur ne peut pas y suppléer : une proposition de
// dix-huit mots sans ponctuation reste un plan long, quoi qu'on fasse en aval.
// Ce fichier verrouille donc le versant AMONT, en trois points :
//
//  1. LE SIGNAL DE SCORE REGARDE UN MAXIMUM, PAS SEULEMENT UNE MOYENNE.
//     « Un maximum, pas seulement une moyenne » : une moyenne se tient très
//     bien avec cinq phrases de quatre mots et une de trente, et c'est la
//     phrase de trente qui donne le plan que le spectateur subit.
//  2. LES TROIS MODES PARTAGENT LA MÊME RÈGLE. Ils en avaient chacun une copie
//     identique, avec un commentaire affirmant « même seuil et même calcul » :
//     une promesse qu'aucun code ne tenait.
//  3. LA CONSIGNE PART AUSSI À LA RÉVISION. Sans ça, la passe de correction
//     rallonge tranquillement les phrases qu'elle réécrit et annule le travail
//     de l'écriture. C'est le risque que j'avais signalé, il est testé ici.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const SOURCE_STORYBOARD = lire('storyboard.js');

function charger(source) {
  const bac = { setTimeout, clearTimeout, console };
  vm.createContext(bac);
  try { vm.runInContext(source || SOURCE_STORYBOARD, bac); } catch (e) {}
  // Les `const` de haut niveau vivent dans la portée lexicale du contexte,
  // pas sur l'objet du bac : une seconde évaluation les récupère.
  return Object.assign(bac, vm.runInContext(
    '({ DUREE_MAX, DUREE_PLAFOND, MOTS_PAR_SEC_PARLE, RYTHME_MOTS_PHRASE_MAX, RYTHME_MOTS_PHRASE_CIBLE, CONSIGNE_PHRASES_COURTES })',
    bac
  ));
}

// Moyenne de 8,2 mots (elle passerait le seuil de l'ancien calcul), mais une
// phrase de 30 mots dedans, soit un plan de 12 secondes.
const MOYENNE_OK_MAIS_UNE_PHRASE_ENORME =
  'Il court. Il tombe. Il se relève. Il repart. '
  + 'Puis, alors que tout le monde dans les tribunes pensait sincèrement que la course était finie '
  + 'depuis longtemps et que plus rien ne pouvait vraiment arriver ce jour-là, il a franchi la ligne.';

const MODES = [
  { nom: 'Script', fichier: 'generation.js', detecteur: '_genDetecterRythmeSoutenu' },
  { nom: 'Récit', fichier: 'storytelling.js', detecteur: '_genDetecterRythmeSoutenuRecit' },
  { nom: 'Série', fichier: 'serie.js', detecteur: '_serieDetecterRythmeSoutenu' }
];

test('les seuils de longueur de phrase sont DÉRIVÉS des durées de plan', () => {
  const bac = charger();
  assert.equal(bac.RYTHME_MOTS_PHRASE_MAX, Math.floor(bac.DUREE_PLAFOND * bac.MOTS_PAR_SEC_PARLE),
    'le maximum de mots par phrase doit valoir le plafond de plan en mots (6 s = 15 mots)');
  assert.equal(bac.RYTHME_MOTS_PHRASE_CIBLE, Math.floor(bac.DUREE_MAX * bac.MOTS_PAR_SEC_PARLE),
    'la cible de mots par phrase doit valoir la cible de plan en mots (5 s = 12 mots)');

  // Le vrai intérêt de la dérivation : un seul réglage suffit. On rejoue le
  // moteur avec un plafond différent et les seuils doivent suivre tout seuls.
  const autre = charger(SOURCE_STORYBOARD.replace('const DUREE_PLAFOND = 6;', 'const DUREE_PLAFOND = 8;'));
  assert.equal(autre.RYTHME_MOTS_PHRASE_MAX, 20,
    'REGRESSION : le seuil de mots par phrase est redevenu un nombre écrit en dur. '
    + 'Changer la durée d\'un plan ne changerait plus la consigne envoyée au modèle, '
    + 'et les deux se contrediraient au premier réglage.');
});

test('le signal de rythme refuse une phrase trop longue, même si la MOYENNE est bonne', () => {
  const bac = charger();
  assert.equal(bac.detecterRythmeSoutenu('Il court. Il tombe. Il se relève. Il repart.'), true,
    'des phrases courtes doivent toujours valider le signal');
  assert.equal(bac.detecterRythmeSoutenu(MOYENNE_OK_MAIS_UNE_PHRASE_ENORME), false,
    'REGRESSION : le signal ne regarde à nouveau que la moyenne. « Un maximum, pas seulement '
    + 'une moyenne » : ici la moyenne est de 8 mots et une phrase en fait 30, soit un plan de 12 s.');
  assert.equal(bac.detecterRythmeSoutenu(''), false, 'un texte vide ne vaut pas un bon rythme');
});

test('les trois modes appellent la MÊME règle, aucun n\'en garde une copie', () => {
  for (const m of MODES) {
    const src = lire(m.fichier);
    const corps = src.slice(src.indexOf('function ' + m.detecteur));
    const fin = corps.indexOf('\n}');
    const fonction = corps.slice(0, fin);
    assert.ok(/return detecterRythmeSoutenu\(/.test(fonction),
      'REGRESSION (' + m.nom + ') : ' + m.detecteur + ' ne délègue plus à la règle partagée.');
    assert.ok(!/\/ phrases\.length\)? <=|motsTotal|const mots = phrases\.reduce/.test(fonction),
      'REGRESSION (' + m.nom + ') : le calcul a été recopié dans le mode. C\'est exactement '
      + 'comme ça que les trois se sont mis à noter la même chose différemment.');
  }
});

test('la consigne de longueur de phrase existe, chiffrée, et explique POURQUOI', () => {
  const { CONSIGNE_PHRASES_COURTES: c, RYTHME_MOTS_PHRASE_MAX: max } = charger();
  assert.equal(typeof c, 'string');
  assert.ok(c.includes(String(max)),
    'la consigne doit annoncer le maximum réel (' + max + ' mots), pas un chiffre décoratif');
  assert.ok(/RÈGLE ABSOLUE/.test(c), 'la consigne doit se présenter comme une règle, pas une préférence');
  assert.ok(/plan|image/i.test(c),
    'la consigne doit dire POURQUOI (le texte devient des plans) : une contrainte sans raison est '
    + 'la première qu\'un modèle relâche.');
});

test('la consigne part à l\'ÉCRITURE et à la RÉVISION, dans les trois modes', () => {
  const manquants = [];
  for (const m of MODES) {
    const occurrences = (lire(m.fichier).match(/\$\{CONSIGNE_PHRASES_COURTES\}/g) || []).length;
    if (occurrences < 2) manquants.push(m.nom + ' (' + occurrences + ' insertion(s))');
  }
  assert.deepEqual(manquants, [],
    'REGRESSION : ' + manquants.join(', ') + '. Chaque mode doit injecter la consigne DEUX fois, '
    + 'à l\'écriture ET à la révision. Sans elle à la révision, la passe de correction rallonge '
    + 'les phrases qu\'elle réécrit et annule le travail de l\'écriture.');
});

// Un ${...} écrit dans une chaîne entre apostrophes ne proteste pas : il part
// tel quel au modèle, qui lit « ${CONSIGNE_PHRASES_COURTES} » et n'apprend
// rien. Le défaut est donc invisible, et c'est bien pour ça qu'il mérite un
// test.
//
// L'ORACLE : on rend l'intérieur des accolades SYNTAXIQUEMENT INVALIDE. Dans un
// littéral gabarit, ce qu'il y a entre ${ et } est du CODE : le fichier cesse
// de se parser. Dans une chaîne ordinaire, c'est du texte : le fichier se parse
// toujours. Pas d'analyse approximative, c'est l'analyseur de Node qui répond.
test('la consigne est bien INTERPOLÉE, pas écrite en toutes lettres dans une chaîne simple', () => {
  for (const m of MODES) {
    const src = lire(m.fichier);
    const marque = '${CONSIGNE_PHRASES_COURTES}';
    let i = -1, n = 0;
    while ((i = src.indexOf(marque, i + 1)) !== -1) {
      n++;
      const abime = src.slice(0, i) + '${ , }' + src.slice(i + marque.length);
      let parse = true;
      try { new vm.Script(abime); } catch (e) { parse = false; }
      assert.equal(parse, false,
        'REGRESSION (' + m.nom + ') : l\'insertion n° ' + n + ' de la consigne n\'est pas dans un '
        + 'littéral gabarit. Elle partirait au modèle sous la forme littérale « ' + marque + ' », '
        + 'et le modèle n\'apprendrait rien du tout.');
    }
    assert.ok(n >= 2, m.nom + ' : insertions introuvables');
  }
});

// ── CONTRÔLE DE MORSURE ──
test('contrôle de morsure : chaque règle tombe quand on réintroduit son défaut', () => {
  const mordu = (verif) => {
    try { verif(); return false; } catch (e) { return true; }
  };

  // 1. Retour au calcul par moyenne seule.
  const parMoyenne = charger(SOURCE_STORYBOARD.replace(
    '  return moyenne <= RYTHME_MOTS_PHRASE_CIBLE && Math.max.apply(null, longueurs) <= RYTHME_MOTS_PHRASE_MAX;',
    '  return moyenne <= RYTHME_MOTS_PHRASE_CIBLE;'
  ));
  assert.ok(mordu(() => {
    assert.equal(parMoyenne.detecterRythmeSoutenu(MOYENNE_OK_MAIS_UNE_PHRASE_ENORME), false);
  }), 'le test du maximum ne mord pas : le calcul par moyenne seule repasserait.');

  // 2. Seuil écrit en dur au lieu d'être dérivé.
  const enDur = charger(SOURCE_STORYBOARD
    .replace('const RYTHME_MOTS_PHRASE_MAX = Math.floor(DUREE_PLAFOND * MOTS_PAR_SEC_PARLE);', 'const RYTHME_MOTS_PHRASE_MAX = 15;')
    .replace('const DUREE_PLAFOND = 6;', 'const DUREE_PLAFOND = 8;'));
  assert.ok(mordu(() => {
    assert.equal(enDur.RYTHME_MOTS_PHRASE_MAX, 20);
  }), 'le test de la dérivation ne mord pas.');

  // 3. Une insertion de la consigne retirée d'un mode.
  assert.ok(mordu(() => {
    const src = lire('serie.js').replace('${CONSIGNE_PHRASES_COURTES}', '');
    assert.ok((src.match(/\$\{CONSIGNE_PHRASES_COURTES\}/g) || []).length >= 2);
  }), 'le test des deux insertions ne mord pas.');

  // 4. Une insertion sortie du littéral gabarit : le fichier se parse encore,
  //    et c'est exactement ce que l'oracle doit refuser.
  assert.ok(mordu(() => {
    const faux = 'const a = \'texte ${CONSIGNE_PHRASES_COURTES} suite\';';
    const abime = faux.replace('${CONSIGNE_PHRASES_COURTES}', '${ , }');
    let parse = true;
    try { new vm.Script(abime); } catch (e) { parse = false; }
    assert.equal(parse, false);
  }), 'le test de l\'interpolation ne mord pas : une consigne dans une chaîne simple passerait.');

  // …et il ne se déclenche pas à tort sur une vraie interpolation.
  let parseVrai = true;
  try { new vm.Script('const a = `texte ${ , } suite`;'); } catch (e) { parseVrai = false; }
  assert.equal(parseVrai, false, 'l\'oracle doit bien refuser une interpolation abîmée');
});

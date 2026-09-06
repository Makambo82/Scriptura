// Retour du propriétaire, PDF à l'appui : « on a toujours le problème de
// durée ». Le script livré faisait 117 mots pour une cible de 138-163
// (« 1 minute »), après les trois tentatives de correction prévues, et
// l'avertissement s'affichait bien. Le contrôle marchait donc, mais la
// CORRECTION, elle, échouait.
//
// Deux causes distinctes, mesurées dans le code plutôt que supposées.
//
// 1. L'ancien prompt de correction disait « atteins 138 à 163 mots au total,
//    compte tes mots ». Il demandait au modèle l'exercice qu'il rate le plus,
//    compter, et sur quatre blocs à la fois, alors que le CODE connaissait
//    déjà le compte exact de chaque bloc et le nombre de mots manquants. Il
//    donne désormais des cibles PAR BLOC, en chiffres.
//
// 2. Plus grave : une tentative de correction écrasait la précédente SANS
//    vérifier qu'elle était meilleure. Une tentative ratée éloignait donc le
//    script de la cible, et la suivante repartait de cette version dégradée.
//    Le créateur pouvait recevoir un script PLUS mauvais que le premier jet,
//    après avoir payé trois corrections pour ça.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'generation.js'), 'utf8');

// planDureeParBloc et ecartCibleDuree vivent dans la portée de generate() :
// on les extrait et on leur injecte leurs dépendances réelles, comme le fait
// déjà tests/script-repartition-blocs-et-promesse-chiffree.test.js.
function charger({ wt, plafondSecondes }) {
  const plan = SRC.match(/ {4}function planDureeParBloc[\s\S]*?\n {4}}/);
  const ecart = SRC.match(/ {4}function ecartCibleDuree[\s\S]*?\n {4}}/);
  assert.ok(plan, 'planDureeParBloc doit exister dans js/generation.js');
  assert.ok(ecart, 'ecartCibleDuree doit exister dans js/generation.js');
  // eslint-disable-next-line no-eval
  return eval('(function(){'
    + 'const MOTS_PAR_SEC_PARLE = 2.5;\n'
    + 'const HOOK_MOTS_MAX = 12;\n'
    + 'const wt = ' + JSON.stringify(wt) + ';\n'
    + 'function plafondDureeBloc(){ return ' + plafondSecondes + '; }\n'
    + plan[0] + '\n' + ecart[0]
    + '\nreturn { planDureeParBloc: planDureeParBloc, ecartCibleDuree: ecartCibleDuree };})()');
}

const WT_1MIN = { min: 138, max: 163, blocs: '4', desc: '1 minute' };
// Le script réellement livré au propriétaire, bloc par bloc.
const SCRIPT_BARDAHL = [
  { texte: '100.000 km sans vidange. Mon moteur respire encore.' },
  { texte: 'La Renault de mon cousin, quinze ans, cinquante mille km au compteur. Consommation qui montait, performances qui chutaient. J\'ai flippé. Puis j\'ai testé le produit. Les résultats ? Incroyables. La consommation s\'est stabilisée, le moteur a retrouvé sa puissance.' },
  { texte: 'Avant, je changeais l\'huile tous les mille cinq cents km, stressé à chaque vidange. Avec ce produit, j\'ai attendu cent mille km. Indicateur toujours vert. Pas une goutte perdue. Le moteur ronronnait enfin, sans ce bruit de friction qu\'on entendait avant. Et là, le vrai choc : la facture de maintenance a chuté de moitié.' },
  { texte: 'Le produit est en bio. Les stocks fondent, les prix montent. Si tu veux tester, c\'est maintenant.' }
];

test('le plan dit au modèle combien de mots ajouter, et DANS QUEL bloc', () => {
  const { planDureeParBloc } = charger({ wt: WT_1MIN, plafondSecondes: 25 });
  const plan = planDureeParBloc(SCRIPT_BARDAHL);

  assert.equal(plan.compte.length, 4, 'les quatre blocs doivent être comptés');
  assert.match(plan.lignes, /Bloc 0 \(le hook\)[^\n]*GARDE-LE TEL QUEL/,
    'REGRESSION : le hook n\'est pas protégé. On ne comble jamais un manque en gonflant le hook, '
    + 'ce serait recréer le défaut qu\'on vient de corriger ailleurs.');
  assert.match(plan.lignes, /Bloc 3 \(la chute\)[^\n]*GARDE-LA TELLE QUELLE/, 'la chute est protégée aussi');

  // Les deux blocs du milieu doivent recevoir une cible CHIFFRÉE et un delta.
  const lignesMilieu = plan.lignes.split('\n').filter(l => /^- Bloc [12] :/.test(l));
  assert.equal(lignesMilieu.length, 2, 'les deux blocs du milieu doivent avoir leur consigne');
  lignesMilieu.forEach(l => {
    assert.match(l, /\d+ mots aujourd'hui, vise \d+ mots/,
      'REGRESSION : la consigne ne donne pas de cible chiffrée : ' + l);
    assert.match(l, /ajoute environ \d+ mots|retire environ \d+ mots|déjà à sa cible/,
      'REGRESSION : la consigne ne dit pas combien de mots ajouter : ' + l);
  });

  // Et la somme des cibles doit bien viser le centre de la fourchette.
  const cibles = lignesMilieu.map(l => parseInt(l.match(/vise (\d+) mots/)[1], 10));
  const total = plan.compte[0] + plan.compte[3] + cibles.reduce((a, b) => a + b, 0);
  assert.ok(total >= WT_1MIN.min && total <= WT_1MIN.max,
    'REGRESSION : en appliquant le plan à la lettre, on obtiendrait ' + total + ' mots, hors de la '
    + 'cible ' + WT_1MIN.min + '-' + WT_1MIN.max + '. Un plan qui ne mène pas à la cible ne sert à rien.');
});

test('aucune cible de bloc ne dépasse le plafond de durée par bloc', () => {
  // Un plan qui demanderait 90 mots dans un bloc respecterait le total mais
  // violerait la règle de répartition, et le redécoupage automatique couperait
  // ensuite ce bloc en deux, changeant la structure sans prévenir.
  const { planDureeParBloc } = charger({ wt: { min: 700, max: 800, blocs: '7', desc: '5 minutes' }, plafondSecondes: 25 });
  const court = Array.from({ length: 7 }, () => ({ texte: 'Trois mots ici.' }));
  const plan = planDureeParBloc(court);
  const cibles = plan.lignes.split('\n')
    .map(l => (l.match(/vise (\d+) mots/) || [])[1]).filter(Boolean).map(Number);
  assert.ok(cibles.length >= 1, 'il doit y avoir des cibles');
  cibles.forEach(c => assert.ok(c <= plan.plafondMots,
    'REGRESSION : une cible de ' + c + ' mots dépasse le plafond de ' + plan.plafondMots + ' mots par bloc'));
});

test('un script de 2 blocs ne casse pas le plan', () => {
  const { planDureeParBloc } = charger({ wt: WT_1MIN, plafondSecondes: 25 });
  const plan = planDureeParBloc([{ texte: 'Un hook.' }, { texte: 'Une chute.' }]);
  assert.equal(plan.lignes, '', 'sans bloc du milieu, aucun plan n\'est proposé plutôt qu\'un plan absurde');
  assert.deepEqual(plan.compte, [2, 2], 'les blocs restent comptés');
});

test('la MEILLEURE version est livrée, jamais simplement la dernière', () => {
  const { ecartCibleDuree } = charger({ wt: WT_1MIN, plafondSecondes: 25 });
  assert.equal(ecartCibleDuree(150), 0, 'dans la fourchette, l\'écart est nul');
  assert.equal(ecartCibleDuree(117), 21, 'trop court : la distance au minimum');
  assert.equal(ecartCibleDuree(200), 37, 'trop long : la distance au maximum');
  assert.ok(ecartCibleDuree(130) < ecartCibleDuree(117),
    '130 mots est plus proche de la cible que 117, la comparaison doit le dire');

  // Le garde-fou lui-même, lu dans le code : sans lui, une tentative ratée
  // écrase une meilleure version et le créateur reçoit le pire des essais.
  const boucle = SRC.slice(SRC.indexOf('async function corrigerDureeScript'));
  assert.match(boucle, /if \(ecartCibleDuree\(wordCount\) < ecartCibleDuree\(meilleurCount\)\)/,
    'REGRESSION : la boucle ne retient plus la meilleure version rencontrée');
  assert.match(boucle, /On livre la MEILLEURE version obtenue, jamais simplement la dernière/,
    'REGRESSION : la sortie de boucle ne restaure plus la meilleure version');
});

// Retour direct du propriétaire : la grande barre de progression (Script,
// Idées, Récit, Storyboard, Série…) affichait un % soit masqué (choix
// précédent : bande rayée indéterminée, sauf l'Audit), soit calculé par une
// pure estimation de temps (createProgress, js/storyboard.js) qui montait
// toute seule même si le serveur était bloqué. "Que le pourcentage progresse
// réellement au rythme réel du travail de génération en cours" : nouveau
// moteur creerProgressionReelle (js/storyboard.js), qui combine des jalons
// RÉELS (une étape atomique qui vient VRAIMENT de se terminer, voir
// etapeTerminee) et une progression CONTINUE basée sur les caractères
// RÉELLEMENT reçus du modèle en flux (etapeFluxProgres), jamais un minuteur.
// Ce test vérifie le moteur en isolation (pas de navigateur nécessaire, pas
// de dépendance au DOM ni au reste de generation.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function chargerModule() {
  const code = fs.readFileSync(require.resolve('../js/storyboard.js'), 'utf8');
  // setTimeout/clearTimeout : creerProgressionReelle en a besoin pour son
  // fluage entre deux jalons (voir js/storyboard.js), une dépendance de
  // timer JS standard, pas du DOM, donc sans contradiction avec l'isolation
  // recherchée ici.
  const sandbox = { setTimeout, clearTimeout };
  vm.createContext(sandbox);
  // Le fichier référence plein d'autres globales absentes ici (DOM, autres
  // fonctions de l'app) : sans effet, seules creerProgressionReelle et
  // fractionFlux nous intéressent, toutes deux des fonctions pures.
  try { vm.runInContext(code, sandbox); } catch (e) {}
  return sandbox;
}

test('creerProgressionReelle : jalons réels + flux continu, jamais un minuteur', () => {
  const { creerProgressionReelle } = chargerModule();
  assert.equal(typeof creerProgressionReelle, 'function');

  const valeurs = [];
  // Poids inspirés du pipeline Script réel (GEN_POIDS.script, js/generation.js) :
  // brief(1+1) / écriture EN FLUX(16) / critique(2.5) / révision(8) / durée(8) / finalisation(1).
  const prog = creerProgressionReelle((p) => valeurs.push(p), [1, 1, 16, 2.5, 8, 8, 1]);
  prog.start();
  assert.equal(valeurs.at(-1), 0, 'start() doit remettre à 0');

  prog.etapeTerminee(1); // brief terminé (jalon réel)
  const apresBrief = valeurs.at(-1);
  assert.ok(apresBrief > 0 && apresBrief < 15, 'après le brief, un petit pourcentage réel, pas un saut arbitraire : ' + apresBrief);

  prog.etapeFluxProgres(2, 0.25); // 25% du texte de l'écriture reçu
  const quart = valeurs.at(-1);
  prog.etapeFluxProgres(2, 0.75); // 75% reçu
  const troisQuarts = valeurs.at(-1);
  assert.ok(troisQuarts > quart, 'le % doit avancer avec le texte réellement reçu, pas rester figé : ' + quart + ' → ' + troisQuarts);

  // Un flux qui recule (ne devrait jamais arriver, mais robustesse) ne fait
  // jamais reculer le %.
  prog.etapeFluxProgres(2, 0.4);
  assert.ok(valeurs.at(-1) >= troisQuarts, 'jamais en arrière même si la fraction de flux redescend');

  assert.ok(valeurs.every(v => v < 100), 'jamais 100% avant finish() : ' + JSON.stringify(valeurs));

  prog.etapeTerminee(6); // toutes les étapes suivantes terminées d'un coup
  const avantFinish = valeurs.at(-1);
  assert.ok(avantFinish >= 90 && avantFinish < 100, 'juste avant finish(), proche de 100 sans l\'atteindre : ' + avantFinish);

  prog.finish();
  assert.equal(valeurs.at(-1), 100, 'finish() doit forcer exactement 100%');
});

test('creerProgressionReelle : une étape qui ne se produit jamais (branche conditionnelle sautée) ne bloque pas la barre', () => {
  const { creerProgressionReelle } = chargerModule();
  const valeurs = [];
  const prog = creerProgressionReelle((p) => valeurs.push(p), [2, 16, 2.5, 8, 8, 1.2, 2]);
  prog.start();
  prog.etapeTerminee(0);
  prog.etapeFluxProgres(1, 1);
  // Directement à l'étape 6 (les étapes 2 à 5, conditionnelles, n'ont jamais
  // été exécutées pour ce pipeline précis) : un saut direct doit rester
  // parfaitement valide, jamais une valeur NaN ou une erreur.
  prog.etapeTerminee(6);
  assert.ok(Number.isFinite(valeurs.at(-1)), 'le % doit rester un nombre valide même après un grand saut : ' + valeurs.at(-1));
  prog.finish();
  assert.equal(valeurs.at(-1), 100);
});

test('fractionFlux : plafonnée à [0,1], proportionnelle aux caractères reçus', () => {
  const { fractionFlux } = chargerModule();
  assert.equal(typeof fractionFlux, 'function');
  assert.equal(fractionFlux(0, 1000), 0);
  assert.equal(fractionFlux(999999, 1000), 1, 'jamais au-delà de 1 même très au-delà de l\'estimation');
  const texteCourt = fractionFlux(300, 16000);
  const texteLong = fractionFlux(30000, 16000);
  assert.ok(texteLong > texteCourt, 'un texte plus long déjà reçu doit donner une fraction plus grande : ' + texteCourt + ' vs ' + texteLong);
});

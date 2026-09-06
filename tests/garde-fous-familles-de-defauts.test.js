// Question du propriétaire : « en ta qualité de développeur pro tu peux pas
// scanner le code afin qu'on n'ait plus à déplorer ces erreurs ? L'app sera
// utilisée par des centaines d'utilisateurs. »
//
// Il a raison, et un test ciblé ne suffit pas pour ça : il verrouille UN
// endroit, pas une FAMILLE. Chaque défaut trouvé cette session existait en
// plusieurs exemplaires, et on ne s'en apercevait qu'en tombant dessus un par
// un, en production, sur un PDF envoyé par le propriétaire.
//
// Ce fichier fait l'inverse : il SCANNE le code et échoue dès qu'un endroit
// oublie une règle que les autres respectent. C'est le seul moyen qu'un
// nouveau mode, écrit demain, ne réintroduise pas silencieusement un défaut
// déjà corrigé ailleurs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const CSS = lire('css/style.css');
const MODES = [
  { nom: 'Script', fichier: 'js/generation.js' },
  { nom: 'Récit', fichier: 'js/storytelling.js' },
  { nom: 'Série', fichier: 'js/serie.js' }
];

// ── FAMILLE 1 : une correction ratée ne doit jamais dégrader le résultat ──
// Trouvé dans le mode Script (script livré à 117 mots), puis retrouvé À
// L'IDENTIQUE dans Récit et Série en scannant. Les trois boucles de
// correction de durée écrasaient la version précédente sans jamais vérifier
// qu'elles l'amélioraient : après trois corrections payantes, le créateur
// pouvait recevoir PIRE que le premier jet.
test('les trois modes gardent la MEILLEURE version, jamais la dernière', () => {
  const manquants = MODES.filter(({ fichier }) => {
    const src = lire(fichier);
    const aUneMesure = /ecartCible(Duree|Recit|Serie)/.test(src);
    const aUneMemoire = /meilleur(Script|Count|Recit|Episode)/.test(src);
    const restaure = /On livre la MEILLEURE version obtenue, jamais simplement la dernière/.test(src);
    return !(aUneMesure && aUneMemoire && restaure);
  }).map(m => m.nom);

  assert.deepEqual(manquants, [],
    'REGRESSION : ' + manquants.join(', ') + ' ne retien(nen)t plus la meilleure version obtenue. '
    + 'Une tentative de correction ratée y dégraderait le résultat livré, et la suivante repartirait '
    + 'de cette version dégradée.');
});

// ── FAMILLE 2 : ne jamais faire confiance à un modèle pour compter ──
// Deux bugs de cette session avaient la même racine : on demandait à l'IA de
// compter ses mots (le hook de 3 secondes, puis la durée totale) sans que le
// code vérifie derrière. Compter est précisément ce qu'un modèle de langage
// rate le plus. Chaque promesse de durée doit donc être adossée à une mesure
// EN CODE, jamais à une consigne de prompt seule.
test('toute promesse de durée est adossée à une mesure en code', () => {
  const sansFilet = [];
  MODES.forEach(({ nom, fichier }) => {
    const src = lire(fichier);
    // Le mode promet-il une durée au modèle ?
    const promet = /[Cc]ompte tes mots|[Cc]ompte les mots|COMPTE les mots/.test(src);
    if (!promet) return;
    // Alors il doit COMPTER lui-même, et corriger.
    const compteEnCode = /countScriptWords|countStoryWords|countWordsSerie/.test(src);
    const corrige = /corrigerDuree(Script|Recit)|correctionAttempts(Serie)?/.test(src);
    if (!(compteEnCode && corrige)) sansFilet.push(nom);
  });

  assert.deepEqual(sansFilet, [],
    'REGRESSION : ' + sansFilet.join(', ') + ' demande(nt) au modèle de compter ses mots sans que le '
    + 'CODE ne vérifie derrière. C\'est exactement ce qui a livré un script de 117 mots pour une cible '
    + 'de 138-163.');
});

// Le mode Script promet QUATRE choses de structure, pas une. Le total de mots
// avait son filet depuis longtemps, le hook et le plafond par bloc l'ont eu
// ce matin, et la chute était la dernière encore laissée à la seule parole du
// modèle : un script « 30 secondes » est sorti avec un total parfait (73
// mots), un hook parfait (8 mots) et une chute de 27 mots, soit près de 11
// secondes pour une règle de 5 à 10. Ce test empêche qu'une cinquième
// promesse arrive demain sans son filet.
test('les quatre promesses de structure du mode Script ont chacune leur filet en code', () => {
  const src = lire('js/generation.js');
  const filets = {
    'hook, 0-3 s': 'degagerHookTropLong',
    'plafond par bloc du milieu': 'decouperBlocsTropLongs',
    'chute, 5-10 s': 'degagerChuteTropLongue',
    'total de mots': 'corrigerDureeScript'
  };
  const sans = Object.keys(filets).filter(nom => !src.includes(filets[nom] + '('));
  assert.deepEqual(sans, [],
    'REGRESSION : ' + sans.join(', ') + ' n\'a plus de filet en code et repose seulement sur une '
    + 'consigne de prompt. Toutes les autres promesses de structure en ont un.');

  // Et chaque filet doit être BRANCHÉ dans le pipeline, pas seulement défini :
  // une fonction jamais appelée est pire qu'absente, elle donne l'illusion
  // d'une protection.
  const branches = ['degagerHookTropLong(parsed.script', 'degagerChuteTropLongue(parsed.script',
    'decouperBlocsTropLongs(parsed.script'];
  const nonBranches = branches.filter(b => !src.includes(b));
  assert.deepEqual(nonBranches, [],
    'REGRESSION : ' + nonBranches.join(', ') + ' est défini mais jamais appelé sur le script livré.');
});

// ── FAMILLE 3 : une règle CSS sur une balise nue fuit dans les composants ──
// C'est ce qui a cassé la croix de fermeture du menu : le tiroir utilise un
// <nav>, il héritait donc du position:fixed de la BARRE DU HAUT et se posait
// par-dessus son propre en-tête. Un appui sur la croix ouvrait l'historique.
// La règle générale reste légitime, mais tout autre élément de la même balise
// doit explicitement l'annuler, sinon le piège se reproduit.
test('aucune balise nue stylée n\'impose sa mise en page à un autre élément', () => {
  const BALISES = ['nav', 'header', 'footer', 'main', 'section', 'article', 'aside', 'form'];
  const RISQUE = /(^|;)\s*(position|display|justify-content|flex-direction|padding|background|border-bottom|z-index)\s*:/;

  const pieges = [];
  BALISES.forEach(balise => {
    // Le drapeau 'm' se passe en argument : JavaScript ne connaît pas la
    // syntaxe (?m) en ligne, contrairement à Python.
    const regle = CSS.match(new RegExp('^' + balise + '\\s*\\{([^}]*)\\}', 'm'));
    if (!regle || !RISQUE.test(regle[1])) return;
    // Cette balise porte une règle générale à risque. Combien d'éléments de
    // ce type existent dans l'app, et sont-ils tous protégés ?
    const sources = ['index.html', 'js/generation.js', 'js/storytelling.js', 'js/serie.js',
      'js/carrousel.js', 'js/montage.js', 'js/montage-manuel.js', 'js/ui.js', 'js/audit.js'];
    const classes = [];
    sources.forEach(f => {
      let src;
      try { src = lire(f); } catch (e) { return; }
      const re = new RegExp('<' + balise + '\\b([^>]*)>', 'g');
      let m;
      while ((m = re.exec(src))) {
        const cls = /class="([^"]*)"/.exec(m[1]);
        classes.push(cls ? cls[1].split(/\s+/)[0] : '');
      }
    });
    // Chaque élément QUI PORTE UNE CLASSE est un composant à part : il doit
    // neutraliser explicitement la règle générale.
    classes.filter(Boolean).forEach(c => {
      const regleComposant = CSS.match(new RegExp('\\.' + c + '\\s*\\{([^}]*)\\}'));
      const neutralise = regleComposant && /position\s*:\s*(static|relative|absolute)/.test(regleComposant[1]);
      if (!neutralise) pieges.push('<' + balise + ' class="' + c + '">');
    });
  });

  assert.deepEqual(pieges, [],
    'REGRESSION : ' + pieges.join(', ') + ' hérite(nt) d\'une règle CSS posée sur la balise nue et ne '
    + 'l\'annule(nt) pas. C\'est exactement le piège qui a fait qu\'un appui sur la croix de fermeture '
    + 'du menu ouvrait « Mes générations ».');
});

// ── FAMILLE 4 : ce qui est déterministe doit le rester ──
// Pilier du produit (voir CLAUDE.md) : mêmes données, même score, toujours.
// Un mode qui laisserait l'IA choisir un chiffre casserait la crédibilité de
// toutes les notes de l'app, pas seulement des siennes.
test('aucun score ne vient d\'un chiffre choisi par l\'IA', () => {
  const suspects = [];
  MODES.concat([{ nom: 'Carrousel', fichier: 'js/carrousel.js' }]).forEach(({ nom, fichier }) => {
    const src = lire(fichier);
    // Un score lu directement dans la réponse du modèle, sans passer par une
    // fonction de calcul : c'est la forme exacte du défaut à interdire.
    if (/parsed\.score\s*=\s*(parsed|jug|raw|reponse)\b/.test(src)
        || /score\s*:\s*(jug|reponse)\.(score|note)/.test(src)) suspects.push(nom);
  });
  assert.deepEqual(suspects, [],
    'REGRESSION : ' + suspects.join(', ') + ' recopie(nt) un score fourni par l\'IA. Deux générations '
    + 'identiques donneraient alors deux notes différentes.');
});

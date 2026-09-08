// « Chaque phrase courte = nouveau plan mental = nouveau prompt dans le
// storyboard. » (propriétaire)
//
// LE DÉFAUT QUE ÇA CORRIGE, MESURÉ : le rédacteur écrivait bien des phrases
// courtes, une par image, et le découpeur les RECOLLAIT derrière lui. Sur un
// script réel, 10 phrases écrites donnaient 6 plans, dont un qui écrasait
// « Une étude de Cambridge l'a montré en 2013. Trois cents likes suffisent.
// Trois cents. » en une seule image, alors que ce sont trois temps distincts.
// Tout le travail fait à la génération était donc annulé juste après.
//
// Le regroupement était piloté par un score de rupture qui devinait l'image
// mentale à partir de listes de mots écrites à la main (« brûle|meurt|explose »
// pour les actions, « dakar|paris|londres » pour les lieux). Sur un sujet
// qu'aucune liste ne couvre, il ne voyait aucune rupture et collait tout. Il a
// été supprimé : une phrase EST une image mentale, c'est vrai par construction.
//
// DEUX EXCEPTIONS SEULEMENT, et ce fichier vérifie qu'elles restent les seules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync(require.resolve('../js/storyboard.js'), 'utf8');

function charger(source) {
  const bac = { setTimeout, clearTimeout, console };
  vm.createContext(bac);
  try { vm.runInContext(source || SOURCE, bac); } catch (e) {}
  return Object.assign(bac, vm.runInContext(
    '({ DUREE_MAX, DUREE_PLAFOND, DUREE_PLAN_SEUL_MIN, MOTS_PAR_SEC_PARLE })', bac));
}

// Le script exact qui a servi à mesurer le défaut.
const PUNCHY = 'Tu crois que ton téléphone t\'écoute. Il fait bien pire. Il n\'a pas besoin du micro. '
  + 'Il regarde ton clavier. Il regarde ton heure de coucher. Il regarde ta vitesse de scroll. '
  + 'Et avec ça, il devine. Une étude de Cambridge l\'a montré en 2013. Trois cents likes suffisent.';

test('une phrase courte donne UN plan, jamais recollée à sa voisine', () => {
  const bac = charger();
  const phrases = bac.splitIntoSentences(PUNCHY);
  const plans = bac.segmentNarrativeStoryboard(PUNCHY);

  assert.equal(plans.length, phrases.length,
    'REGRESSION : ' + phrases.length + ' phrases écrites, ' + plans.length + ' plans produits. '
    + 'Le découpeur recolle les phrases courtes et annule le travail fait à la génération. '
    + 'Plans obtenus :\n  ' + plans.map(p => p.text).join('\n  '));

  // Et chaque plan est bien LA phrase, pas un morceau ni un assemblage.
  plans.forEach((p, i) => assert.equal(p.text, phrases[i],
    'le plan ' + (i + 1) + ' ne correspond pas à la phrase ' + (i + 1)));
});

test('le score de rupture par listes de mots a bien été SUPPRIMÉ', () => {
  assert.ok(!/computeNarrativeBreakScore/.test(SOURCE),
    'REGRESSION : le score de rupture est revenu. Il décidait du regroupement à partir de '
    + 'vocabulaire écrit en dur, donc il se trompait sur tout sujet hors de ses listes, et '
    + 'c\'est lui qui recollait les phrases courtes.');
});

// ── EXCEPTION 1 : la phrase ne porte pas d'image à elle seule ──
test('une subordonnée ou un fragment reste avec la phrase qu\'il prolonge', () => {
  const bac = charger();
  const cas = [
    {
      texte: 'Le vieil homme a ouvert la porte. Qui grinçait depuis vingt ans.',
      pourquoi: 'une subordonnée seule ne se filme pas'
    },
    {
      texte: 'Paris, 1925. Le photographe installe son trépied devant la gare.',
      pourquoi: 'un cartouche de lieu et date n\'est pas une image à lui seul'
    }
  ];
  for (const c of cas) {
    const plans = bac.segmentNarrativeStoryboard(c.texte);
    assert.equal(plans.length, 1,
      'REGRESSION : ' + c.pourquoi + ', ces deux phrases doivent rester un seul plan. '
      + 'Obtenu : ' + JSON.stringify(plans.map(p => p.text)));
  }
});

// ── EXCEPTION 2 : sous une seconde, l'image n'a pas le temps d'être vue ──
test('une phrase de moins d\'une seconde rejoint sa voisine', () => {
  const bac = charger();
  // « Silence. » (0,4 s) est le bon cas de test, et il a fallu le chercher :
  // « Trois cents. » est déjà retenue par l'exception 1 (fragment sans sujet
  // ni action visuels), donc elle ne prouverait rien sur le plancher. Ici
  // « Silence. » est classée comme une RÉVÉLATION, que l'exception 1 laisse
  // volontairement ouvrir son propre plan : seul le plancher la retient.
  const plans = bac.segmentNarrativeStoryboard('Il a poussé la porte du grenier. Silence.');
  assert.equal(plans.length, 1,
    'REGRESSION : « Silence. » (0,4 s) devient un plan à elle seule. Sous le plancher de '
    + bac.DUREE_PLAN_SEUL_MIN + ' s, l\'image n\'a pas le temps d\'être vue (même plancher que le '
    + 'service de rendu) : on paierait 0,05 € et une unité de quota pour un flash. '
    + 'Obtenu : ' + JSON.stringify(plans.map(p => p.text)));

  // Mais une phrase de quatre mots (1,6 s), elle, a bien droit à son plan :
  // une phrase courte reste une image, contrairement à un fragment découpé
  // dans une phrase (qui, lui, a un plancher à DUREE_MIN).
  const courtes = bac.segmentNarrativeStoryboard('Il regarde ton clavier. Mieux que ta mère.');
  assert.equal(courtes.length, 2,
    'REGRESSION : une phrase entière de 1,6 s doit garder son plan. Obtenu : '
    + JSON.stringify(courtes.map(p => p.text)));
});

// UNE EXCEPTION NE DOIT PAS SERVIR À RALLONGER UN PLAN SANS LIMITE : cinq
// subordonnées à la suite prolongent bien la même image, mais pas pendant
// quinze secondes.
//
// HONNÊTETÉ SUR CE TEST : le plafond posé dans la boucle de regroupement fait
// DOUBLON avec la découpe finale, qui ramènerait de toute façon le plan sous
// le plafond (vérifié : en retirant le plafond de la boucle, aucun plan ne
// dépasse quand même). Il est gardé quand même, pour que la boucle tienne son
// invariant elle-même au lieu de le sous-traiter, mais ce test-ci ne mord pas
// si on le retire : c'est la découpe finale qui protège vraiment, et c'est
// tests/plans-jamais-trop-longs.test.js qui la verrouille.
test('cinq subordonnées d\'affilée ne font pas un plan interminable', () => {
  const bac = charger();
  const plans = bac.segmentNarrativeStoryboard(
    'Il a poussé la porte. Qui grinçait. Qui résistait. Qui refusait de céder. Qui tenait bon.');
  for (const p of plans) {
    assert.ok(bac.dureeParleeDe(p.text) <= bac.DUREE_PLAFOND + 0.001,
      'REGRESSION : un enchaînement d\'exceptions dépasse le plafond dur. « ' + p.text + ' »');
  }
  assert.ok(plans.length >= 2, 'ces cinq phrases ne peuvent pas tenir en un seul plan');
});

// ── CONTRÔLE DE MORSURE ──
test('contrôle de morsure : chaque règle tombe quand on réintroduit son défaut', () => {
  const mordu = (verif) => { try { verif(); return false; } catch (e) { return true; } };

  // 1. Regroupement par défaut (l'ancien comportement) : les phrases courtes
  //    se recollent dès qu'elles tiennent sous le plafond.
  const recolle = charger(SOURCE.replace(
    '    if (exception && rentre) {',
    '    if (rentre) {'
  ));
  assert.ok(mordu(() => {
    assert.equal(recolle.segmentNarrativeStoryboard(PUNCHY).length,
      recolle.splitIntoSentences(PUNCHY).length);
  }), 'le test « une phrase = un plan » ne mord pas : le regroupement par défaut repasserait.');

  // 2. Sans l'exception de continuité, une subordonnée devient un plan à elle
  //    seule, et l'image porterait sur « Qui grinçait depuis vingt ans. »
  const sansContinuite = charger(SOURCE.replace(
    '      || prolongeLaMemeImage(prev, cur)',
    '      || false'
  ));
  assert.ok(mordu(() => {
    assert.equal(sansContinuite.segmentNarrativeStoryboard(
      'Le vieil homme a ouvert la porte. Qui grinçait depuis vingt ans.').length, 1);
  }), 'le test de la subordonnée ne mord pas.');

  // 3. Sans le plancher de visibilité, « Silence. » (0,4 s) devient un plan.
  const sansPlancher = charger(SOURCE.replace(
    'const DUREE_PLAN_SEUL_MIN = 1;', 'const DUREE_PLAN_SEUL_MIN = 0;'));
  assert.ok(mordu(() => {
    assert.equal(sansPlancher.segmentNarrativeStoryboard(
      'Il a poussé la porte du grenier. Silence.').length, 1);
  }), 'le test du plancher de visibilité ne mord pas.');

  // PAS DE CONTRÔLE 4 POUR LE PLAFOND DE REGROUPEMENT, et c'est délibéré : en
  // le retirant, aucun plan ne dépasse quand même, parce que la découpe finale
  // rattrape. Écrire un contrôle qui ne mord pas donnerait l'illusion d'une
  // protection à cet endroit. La vraie protection est ailleurs, et elle est
  // testée là-bas (tests/plans-jamais-trop-longs.test.js).
});

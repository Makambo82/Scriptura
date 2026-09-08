// Retour d'un vrai utilisateur, confirmé puis chiffré par le propriétaire :
// « les plans par image sont trop longs […] Maxi 5 secondes, du moins entre
// 4-6 secondes max rigoureusement. Si tu peux forcer l'app à faire comme ça
// c'est bien. »
//
// Ce que ce fichier verrouille, et POURQUOI chaque règle existe :
//
//  1. AUCUN PLAN AU-DESSUS DU PLAFOND. Avant, le découpeur ne savait couper
//     qu'aux frontières de phrases : une phrase seule de trente mots restait
//     un plan de douze secondes, déclaré incassable.
//  2. AUCUNE MIETTE. La première correction coupait « à la ponctuation la plus
//     proche du milieu », ce qui fabriquait « Chaque nuit, » (0,8 s),
//     « Le jour, » (0,8 s), « À la place, » (1,2 s). Chacune de ces miettes est
//     une image générée, facturée 0,05 € et décomptée du quota mensuel, pour
//     un texte qui ne décrit rien.
//  3. AUCUNE COUPE QUI CASSE UN GROUPE DE MOTS. Mesuré aussi : « les allées /
//     et venues », « j'ai publié une vidéo / par jour ». Le texte d'un plan
//     sert à écrire son prompt visuel : un bout de phrase donne une image
//     ratée, et elle est payée quand même.
//
// Les durées sont comptées au rythme RÉELLEMENT PARLÉ (MOTS_PAR_SEC_PARLE),
// jamais au seuil interne de découpage : c'est la seconde que le spectateur
// vit qui compte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync(require.resolve('../js/storyboard.js'), 'utf8');

// Le fichier référence quantité de globales absentes ici (DOM, autres modules).
// Sans effet : le moteur de découpage est purement fonctionnel.
//
// Les `const` de haut niveau n'atterrissent PAS sur l'objet du bac à sable
// (contrairement aux déclarations de fonction) : elles vivent dans
// l'environnement lexical global du contexte. On les récupère donc avec une
// seconde évaluation DANS le même contexte, qui, elle, les voit.
function charger(source) {
  const bac = { setTimeout, clearTimeout, console };
  vm.createContext(bac);
  try { vm.runInContext(source || SOURCE, bac); } catch (e) {}
  const constantes = vm.runInContext(
    '({ DUREE_MIN, DUREE_MAX, DUREE_PLAFOND, MOTS_INTERDITS_EN_FIN, MOTS_DE_COUPE, POIDS_TROP_COURT })',
    bac
  );
  return Object.assign(bac, constantes);
}

// Trois écritures réelles, les trois que l'app produit vraiment : un récit à
// phrases longues (le cas qui cassait), un script punchy à phrases courtes
// (celui où le REGROUPEMENT pouvait rallonger), un script de vente moyen.
const SCRIPTS = {
  recit: `En 1994, dans un petit village du nord du Rwanda, un instituteur de trente-deux ans nommé Emmanuel a caché quarante-sept enfants dans le faux plafond de sa salle de classe pendant près de trois mois, sans que personne du village ne s'en doute une seule seconde. Chaque nuit, il traversait deux kilomètres de brousse avec un sac de riz sur le dos, en évitant les barrages, et il remontait les vivres par une trappe qu'il avait découpée lui-même dans le bois. Le jour, il continuait à faire cours à une classe vide pour que les allées et venues paraissent normales, et il écrivait au tableau des leçons que personne ne lisait. Quand les soldats sont venus fouiller l'école pour la troisième fois, un des enfants a toussé, et Emmanuel a immédiatement renversé une table en hurlant sur un élève imaginaire pour couvrir le bruit. Aucun des quarante-sept enfants n'est mort.`,
  punchy: `Tu crois que ton téléphone t'écoute. Il fait bien pire. Il n'a pas besoin du micro. Il regarde ton clavier. Il regarde ton heure de coucher. Il regarde ta vitesse de scroll. Et avec ça, il devine. Une étude de Cambridge l'a montré en 2013. Trois cents likes suffisent. Trois cents. Avec ça, l'algorithme te connaît mieux que ton conjoint. Mieux que ta mère.`,
  vente: `J'ai vendu pour quarante mille euros de formation en six semaines, sans une seule publicité payante. Voici exactement ce que j'ai fait. D'abord, j'ai arrêté de parler de mon produit pendant trente jours. À la place, j'ai publié une vidéo par jour sur le problème que mon produit résout, sans jamais citer son nom. Les commentaires ont explosé. Le jour trente et un, j'ai ouvert les inscriptions pendant quarante-huit heures seulement.`
};

// Phrase qui, SANS la règle du mot-outil final, se fait couper devant « qu'il »
// et laisse un plan qui se termine par « et ».
const PHRASE_A_MOT_OUTIL = 'Il a compris ce soir-là que la vérité ne servirait à personne et qu\'il valait mieux se taire pour que sa famille reste en vie encore quelques mois.';

function plansDe(bac, texte) {
  return bac.segmentNarrativeStoryboard(texte).map(p => ({
    texte: p.text,
    duree: bac.dureeParleeDe(p.text),
    label: p.duree
  }));
}

test('deux seuils : une cible de regroupement STRICTEMENT sous le plafond dur', () => {
  const { DUREE_MAX, DUREE_PLAFOND, DUREE_MIN } = charger();
  assert.equal(DUREE_MAX, 5, 'la cible de regroupement doit rester à 5 s (« maxi 5 secondes »)');
  assert.equal(DUREE_PLAFOND, 6, 'le plafond dur doit rester à 6 s (« entre 4-6 secondes max »)');
  assert.ok(DUREE_MAX < DUREE_PLAFOND,
    'REGRESSION : avec un seul seuil, on casse un plan de 5,6 s en 3,6 + 2,0 pour gagner une '
    + 'demi-seconde. Chaque plan de plus est une image facturée.');
  assert.ok(DUREE_MIN >= 2, 'le plancher d\'un plan filmable doit rester à 2 s au moins');
});

test('aucun plan ne dépasse le plafond dur, sur les trois écritures réelles', () => {
  const bac = charger();
  const { DUREE_PLAFOND } = bac;
  for (const [nom, texte] of Object.entries(SCRIPTS)) {
    const trop = plansDe(bac, texte).filter(p => p.duree > DUREE_PLAFOND + 0.001);
    // Array.from : les tableaux nés dans le bac à sable ont un AUTRE prototype,
    // et deepStrictEqual compare les prototypes ([] != [] entre deux realms).
    assert.deepEqual(Array.from(trop, p => p.duree.toFixed(1) + 's : ' + p.texte), [],
      'REGRESSION (' + nom + ') : un plan dépasse ' + DUREE_PLAFOND + ' s parlées. '
      + 'C\'est exactement ce que l\'utilisateur a signalé.');
  }
});

test('une proposition longue SANS ponctuation interne est quand même coupée', () => {
  const bac = charger();
  // 25 mots, une seule virgule tout à la fin : l'ancien découpeur la déclarait
  // incassable et livrait un plan de 10 s.
  const dur = 'un instituteur de trente-deux ans nommé Emmanuel a caché quarante-sept enfants dans le faux plafond de sa salle de classe pendant près de trois mois.';
  const morceaux = bac.decouperPlanTropLong(dur);
  assert.ok(morceaux.length >= 2,
    'REGRESSION : une proposition sans virgule interne redevient incassable (plan de '
    + bac.dureeParleeDe(dur).toFixed(1) + ' s).');
  for (const m of morceaux) {
    assert.ok(bac.dureeParleeDe(m) <= bac.DUREE_PLAFOND + 0.001, 'morceau trop long : ' + m);
  }
});

test('le découpeur ne fabrique jamais de miette sous le plancher', () => {
  const bac = charger();
  const { DUREE_MIN } = bac;
  // Cette phrase est LE cas qui produisait « Chaque nuit, » seul (0,8 s).
  const phrase = 'Chaque nuit, il traversait deux kilomètres de brousse avec un sac de riz sur le dos, en évitant les barrages, et il remontait les vivres par une trappe qu\'il avait découpée lui-même dans le bois.';
  const miettes = Array.from(bac.decouperPlanTropLong(phrase)).filter(m => bac.dureeParleeDe(m) < DUREE_MIN);
  assert.deepEqual(miettes, [],
    'REGRESSION : le découpeur produit un plan sous ' + DUREE_MIN + ' s. Une miette comme '
    + '« Chaque nuit, » n\'est pas une image : elle coûte 0,05 € et une unité de quota pour rien.');
});

// L'ARBITRAGE ASSUMÉ, ET IL FAUT LE DIRE : quand la seule coupe disponible
// fabriquerait une miette, on garde le plan un peu trop long. Ici 6,4 s au lieu
// de « Le soir, » (0,8 s) + 5,6 s. Une image de plus sur un texte qui ne décrit
// rien coûte plus cher, au quota comme au résultat, que 0,4 s de dépassement.
// C'est aussi la limite honnête du découpage : au-delà, c'est au TEXTE d'être
// écrit plus court (consignes de génération), pas au découpeur de bricoler.
test('plutôt un plan un peu long qu\'une miette, quand aucune coupe propre n\'existe', () => {
  const bac = charger();
  const phrase = 'Le soir, les habitants du village se rassemblaient autour du feu et racontaient des histoires anciennes.';
  const morceaux = Array.from(bac.decouperPlanTropLong(phrase));
  assert.deepEqual(morceaux, [phrase],
    'REGRESSION : le découpeur préfère désormais fabriquer une miette (« Le soir, », 0,8 s) '
    + 'plutôt que de garder un plan à 6,4 s. Obtenu : ' + JSON.stringify(morceaux));
});

test('aucune coupe ne casse un groupe de mots, aucun plan ne finit sur un mot-outil', () => {
  const bac = charger();
  // Les deux cassures mesurées, à ne jamais revoir.
  const INTERDITS = [
    { debut: 'et venues', pourquoi: '« les allées / et venues » : la conjonction reliait deux noms' },
    { debut: 'par jour', pourquoi: '« une vidéo / par jour » : « par » colle au mot d\'avant' }
  ];
  for (const [nom, texte] of Object.entries(SCRIPTS)) {
    for (const p of plansDe(bac, texte)) {
      for (const i of INTERDITS) {
        assert.ok(!p.texte.toLowerCase().startsWith(i.debut),
          'REGRESSION (' + nom + ') : ' + i.pourquoi + '. Plan : « ' + p.texte + ' »');
      }
      const dernier = p.texte.trim().split(/\s+/).pop();
      assert.ok(!bac.MOTS_INTERDITS_EN_FIN.has(bac._motNu(dernier)),
        'REGRESSION (' + nom + ') : un plan se termine sur le mot-outil « ' + dernier + ' ». '
        + 'Ce texte sert à écrire le prompt visuel du plan. Plan : « ' + p.texte + ' »');
    }
  }

  // Le cas précis qui exposait le défaut : sans la règle, cette phrase donnait
  // « Il a compris ce soir-là que la vérité ne servirait à personne ET ».
  for (const m of bac.decouperPlanTropLong(PHRASE_A_MOT_OUTIL)) {
    const dernier = String(m).trim().split(/\s+/).pop();
    assert.ok(!bac.MOTS_INTERDITS_EN_FIN.has(bac._motNu(dernier)),
      'REGRESSION : plan terminé sur « ' + dernier + ' » → « ' + m + ' »');
  }
});

test('la durée affichée ENCADRE la durée réelle, elle ne l\'arrondit pas', () => {
  const bac = charger();
  for (const [nom, texte] of Object.entries(SCRIPTS)) {
    for (const p of plansDe(bac, texte)) {
      const [bas, haut] = p.label.replace(' sec', '').split('-').map(Number);
      assert.ok(p.duree <= haut + 0.001,
        'REGRESSION (' + nom + ') : plan de ' + p.duree.toFixed(1) + ' s annoncé « ' + p.label
        + ' ». La borne haute est SOUS la durée réelle : l\'app promet plus court que ce qu\'elle livre.');
      // La borne basse est plafonnée à DUREE_MIN : un plan plus court existe
      // (une phrase de quatre mots), mais l'app ne descend pas sous 2 s dans
      // son affichage. Seul ce cas-là autorise un écart.
      if (bas !== bac.DUREE_MIN) {
        assert.ok(p.duree >= bas - 0.001,
          'REGRESSION (' + nom + ') : plan de ' + p.duree.toFixed(1) + ' s annoncé « ' + p.label + ' ».');
      }
    }
  }
});

// ── CONTRÔLE DE MORSURE ──
// Un test qui ne tombe pas quand on réintroduit le défaut ne protège rien.
// Chaque règle ci-dessus est ici rejouée sur une version VOLONTAIREMENT
// abîmée du moteur, et doit échouer.
test('contrôle de morsure : chaque règle tombe quand on réintroduit son défaut', () => {
  const mordu = (source, verif) => {
    let aMordu = false;
    try { verif(charger(source)); } catch (e) { aMordu = true; }
    return aMordu;
  };

  // 1. Plafond desserré : les plans longs repassent.
  assert.ok(mordu(SOURCE.replace('const DUREE_PLAFOND = 6;', 'const DUREE_PLAFOND = 20;'), (bac) => {
    for (const t of Object.values(SCRIPTS)) {
      for (const p of plansDe(bac, t)) assert.ok(p.duree <= 6.001);
    }
  }), 'le test du plafond ne mord pas : desserrer DUREE_PLAFOND passe inaperçu.');

  // 2. Une proposition sans ponctuation interne redevient incassable.
  assert.ok(mordu(SOURCE.replace(
    '  const mots = String(plan).split(/\\s+/).filter(Boolean);',
    '  if (splitIntoSentences(plan).length < 2) return [plan];\n  const mots = String(plan).split(/\\s+/).filter(Boolean);'
  ), (bac) => {
    const dur = 'un instituteur de trente-deux ans nommé Emmanuel a caché quarante-sept enfants dans le faux plafond de sa salle de classe pendant près de trois mois.';
    assert.ok(bac.decouperPlanTropLong(dur).length >= 2);
  }), 'le test de la phrase incassable ne mord pas.');

  // 3. Sans pénalité de miette, le découpeur refabrique des « Le soir, » (0,8 s).
  //    C'est ce cas-là qui fait travailler POIDS_TROP_COURT : sur une phrase
  //    riche en virgules, le prix fixe d'un plan de plus suffit déjà à écarter
  //    les miettes ; ici la seule coupe disponible EST une miette, et seul le
  //    plancher la refuse.
  assert.ok(mordu(SOURCE.replace('const POIDS_TROP_COURT = 6;', 'const POIDS_TROP_COURT = 0;'), (bac) => {
    const phrase = 'Le soir, les habitants du village se rassemblaient autour du feu et racontaient des histoires anciennes.';
    assert.deepEqual(Array.from(bac.decouperPlanTropLong(phrase)), [phrase]);
  }), 'le test de la miette ne mord pas : POIDS_TROP_COURT peut être annulé sans rien casser.');

  // 4. Sans la règle du sujet derrière la conjonction, « les allées / et venues » revient.
  assert.ok(mordu(SOURCE.replace(
    '    if (SUJETS.has(_motNu(suivant))) return true;\n    return /^[A-ZÀ-Ý]/.test(suivant);   // nom propre',
    '    return true;'
  ), (bac) => {
    for (const p of plansDe(bac, SCRIPTS.recit)) {
      assert.ok(!p.texte.toLowerCase().startsWith('et venues'));
    }
  }), 'le test de la conjonction ne mord pas : la règle du sujet peut sauter sans rien casser.');

  // 5. Sans la règle du mot-outil final, un plan se termine par « et ».
  assert.ok(mordu(SOURCE.replace(
    '  const finPropre = !MOTS_INTERDITS_EN_FIN.has(_motNu(motPrecedent));',
    '  const finPropre = true;'
  ), (bac) => {
    for (const m of bac.decouperPlanTropLong(PHRASE_A_MOT_OUTIL)) {
      const dernier = String(m).trim().split(/\s+/).pop();
      assert.ok(!bac.MOTS_INTERDITS_EN_FIN.has(bac._motNu(dernier)), m);
    }
  }), 'le test du mot-outil final ne mord pas.');

  // 6. Avec un arrondi, l'étiquette n'encadre plus la durée réelle.
  assert.ok(mordu(SOURCE.replace(
    '  const bas = Math.max(DUREE_MIN, Math.floor(sec));\n  const haut = Math.max(bas + 1, Math.ceil(sec));',
    '  const bas = Math.max(DUREE_MIN, Math.round(sec));\n  const haut = Math.max(bas + 1, Math.round(sec) + 1);'
  ), (bac) => {
    for (const t of Object.values(SCRIPTS)) {
      for (const p of plansDe(bac, t)) {
        const [b, h] = p.label.replace(' sec', '').split('-').map(Number);
        assert.ok(p.duree >= b - 0.001 && p.duree <= h + 0.001);
      }
    }
  }), 'le test de l\'étiquette ne mord pas : l\'arrondi peut revenir sans rien casser.');
});

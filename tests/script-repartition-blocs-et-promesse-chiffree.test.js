// Retour terrain du 3 septembre 2026, sur un script "1 minute" pourtant noté
// 92/100 et parfaitement calibré en durée (150 mots = 60,0 secondes pile).
// Deux défauts structurels que rien dans le code ne détectait :
//
// 1. RÉPARTITION. Le script tenait en 4 blocs de 9 / 117 / 18 / 6 mots : UN
//    bloc portait 78% du script, soit 47 secondes d'un seul tenant. La règle
//    de répartition du prompt bornait le PREMIER bloc (hook, 7-10 mots) et le
//    DERNIER (CTA/chute, 12-25 mots), mais laissait "les blocs du milieu se
//    partagent tout le reste" SANS AUCUN MAXIMUM. Le modèle empile donc au
//    milieu. Conséquences réelles : la timeline affichée ne donne plus aucun
//    repère de rythme, et le champ "visuel" doit couvrir 47 secondes avec une
//    seule direction de tournage alors que l'app prescrit elle-même de changer
//    de plan avant 15-25 secondes.
//    Corrigé à trois niveaux : plafond chiffré dans les prompts (écriture,
//    correction de durée, critique, révision) ET filet DÉTERMINISTE en code
//    (decouperBlocsTropLongs) qui redécoupe aux frontières de phrases sans
//    toucher un seul mot.
//
// 2. PROMESSE CHIFFRÉE NON TENUE. Le hook annonçait "l'erreur numéro trois",
//    le corps énumérait cinq erreurs, et la révélation présentait comme
//    "erreur trois" celle qui occupait le 5e rang. Le spectateur qui compte
//    décroche pile au moment de la révélation, là où il devait rester.
//    Corrigé par une détection MÉCANIQUE du rang promis
//    (_genDetecterPromesseRang) qui déclenche un contrôle ciblé du Critique
//    indépendant et une consigne au Réviseur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SRC_GENERATION = fs.readFileSync(path.join(__dirname, '..', 'js', 'generation.js'), 'utf8');

// Charge les fonctions telles qu'elles sont RÉELLEMENT écrites dans
// js/generation.js (jamais une copie qui pourrait diverger), même principe
// que tests/duree-coherente-script-recit.test.js.
function chargerDetecteurPromesseRang() {
  const parties = ['_GEN_NOMS_RANG', '_GEN_NOMBRES_RANG', '_GEN_ORDINAUX_RANG'].map(nom => {
    const m = SRC_GENERATION.match(new RegExp('const ' + nom + ' = "[^"]*";'));
    assert.ok(m, nom + ' doit exister dans js/generation.js');
    return m[0];
  });
  const fn = SRC_GENERATION.match(/function _genDetecterPromesseRang[\s\S]*?\n}/);
  assert.ok(fn, '_genDetecterPromesseRang doit exister dans js/generation.js');
  // eslint-disable-next-line no-eval
  return eval('(function(){' + parties.join('\n') + '\n' + fn[0] + '\nreturn _genDetecterPromesseRang;})()');
}

// decouperBlocsTropLongs vit dans la portée de generate() : on l'extrait et on
// lui injecte ses dépendances réelles (splitIntoSentences et dureeParleeDe de
// js/storyboard.js), pour tester le VRAI code de découpage.
function chargerDecoupage({ plafond, faceless = false }) {
  const bloc = SRC_GENERATION.match(/ {4}function decouperBlocsTropLongs[\s\S]*?\n {4}}\n/);
  assert.ok(bloc, 'decouperBlocsTropLongs doit exister dans js/generation.js');
  const srcStory = fs.readFileSync(path.join(__dirname, '..', 'js', 'storyboard.js'), 'utf8');
  const split = srcStory.match(/function splitIntoSentences[\s\S]*?\n}/);
  const duree = srcStory.match(/function dureeParleeDe[\s\S]*?\n}/);
  assert.ok(split && duree, 'js/storyboard.js doit fournir splitIntoSentences et dureeParleeDe');
  // eslint-disable-next-line no-eval
  return eval('(function(){'
    + 'const MOTS_PAR_SEC_PARLE = 2.5;\n'
    + split[0] + '\n' + duree[0] + '\n'
    + 'const estFaceless = ' + JSON.stringify(faceless) + ';\n'
    + 'function plafondDureeBloc(){ return ' + plafond + '; }\n'
    + bloc[0]
    + '\nreturn decouperBlocsTropLongs;})()');
}

const mots = t => (String(t || '').match(/\S+/g) || []).length;

// ── 1. Détection mécanique de la promesse chiffrée ──

test('promesse chiffrée : les formulations réellement utilisées par les hooks sont détectées', () => {
  const detecter = chargerDetecteurPromesseRang();
  const cas = [
    "Neuf débutants SaaS sur dix font l'erreur numéro trois.", // le cas réel du terrain
    "Personne ne parle du secret n°2.",
    "Tout se joue sur la 3e raison.",
    "La troisième erreur ruine 90% des lancements.",
    "L'astuce 4 change tout.",
    "Le piège numéro 5, personne ne le voit venir."
  ];
  for (const texte of cas) {
    assert.ok(detecter(texte), 'rang à vérifier attendu dans : ' + JSON.stringify(texte));
  }
});

test('promesse chiffrée : pas de faux positif sur de la prose ordinaire', () => {
  const detecter = chargerDetecteurPromesseRang();
  const cas = [
    "Tu as trois secondes pour convaincre.",
    "J'ai lancé cinq produits en deux ans.",
    "Voici comment j'ai doublé mon chiffre d'affaires.",
    "Ça m'a pris 6 mois et 3 échecs pour comprendre.",
    "Arrête de croire que tout se joue en une seule vidéo."
  ];
  for (const texte of cas) {
    assert.equal(detecter(texte), '', 'aucun rang ne doit être détecté dans : ' + JSON.stringify(texte));
  }
});

test('promesse chiffrée : entrée vide ou absente ne casse jamais la détection', () => {
  const detecter = chargerDetecteurPromesseRang();
  for (const entree of [undefined, null, '', 0, {}]) {
    assert.equal(detecter(entree), '');
  }
});

// ── 2. Découpage déterministe des blocs trop longs ──

test('découpage : le bloc de 47 secondes du script terrain est coupé, sans qu\'un seul mot change', () => {
  const decouper = chargerDecoupage({ plafond: 25 });
  const script = [
    { temps: '0-4 sec', texte: "Neuf débutants SaaS sur dix font l'erreur numéro trois.", visuel: 'Gros plan' },
    { temps: '4-50 sec', texte: "Tu lances avant de tester avec dix vraies personnes. Trop rapide. Puis tu vises tout le monde au lieu d'une niche. Trop large. Ensuite tu construis seul, zéro feedback externe. Trop isolé. Tu dépenses en features avant de monétiser. Trop cher. Et tu fais un produit parfait que personne ne connaît. Trop invisible. Mais ce qui tue vraiment ? C'est pas une erreur qui te tue. C'est le combo qui te tue. Parce que tu crois que chaque étape est isolée. Que tu peux corriger une erreur sans adresser les quatre autres. C'est faux. Elles se renforcent. L'isolation te pousse à dépenser plus. La perfection te pousse à rester invisible plus longtemps. Et l'invisibilité tue la monétisation.", visuel: 'Plan poitrine, énergie montante' },
    { temps: '50-58 sec', texte: "L'erreur trois ? Attendre la perfection avant de montrer à quelqu'un. À ce moment, tu es déjà mort.", visuel: 'Gros plan' },
    { temps: '58-60 sec', texte: "Lancer sale. Vendre d'abord. Construire après.", visuel: 'Regard caméra' }
  ];
  const avant = mots(script.map(b => b.texte).join(' '));
  const apres = decouper(script);

  assert.ok(apres.length > script.length, 'le bloc de 47 secondes doit avoir été coupé');
  assert.equal(mots(apres.map(b => b.texte).join(' ')), avant,
    'REGRESSION : le découpage ne doit ajouter, retirer ni modifier AUCUN mot (la durée et le score en dépendent)');
  for (const bloc of apres) {
    assert.ok(mots(bloc.texte) / 2.5 <= 25 + 0.001,
      'aucun bloc ne doit rester au-dessus du plafond : ' + mots(bloc.texte) + ' mots');
  }
  // Les blocs conformes ne sont jamais touchés (hook, révélation, chute).
  assert.equal(apres[0].texte, script[0].texte);
  assert.equal(apres[0].visuel, script[0].visuel);
  assert.equal(apres[apres.length - 1].texte, script[3].texte);
});

test('découpage : coupe uniquement aux frontières de phrases, jamais en plein milieu', () => {
  const decouper = chargerDecoupage({ plafond: 25 });
  const phrases = [];
  for (let i = 0; i < 12; i++) phrases.push('Phrase numéro ' + i + ' avec assez de mots pour peser dans le compte.');
  const apres = decouper([
    { temps: '0-3 sec', texte: 'Hook court et net.', visuel: 'V' },
    { temps: '3-60 sec', texte: phrases.join(' '), visuel: 'V' },
    { temps: '60-65 sec', texte: 'Chute qui referme proprement le propos ici.', visuel: 'V' }
  ]);
  for (const bloc of apres) {
    assert.ok(/[.!?…]$/.test(bloc.texte.trim()),
      'chaque bloc doit se terminer sur une ponctuation forte : ' + JSON.stringify(bloc.texte.slice(-40)));
  }
});

test('découpage : un bloc long d\'UNE SEULE phrase n\'est jamais amputé', () => {
  const decouper = chargerDecoupage({ plafond: 5 });
  const uneSeulePhrase = 'Un très long souffle sans aucune ponctuation forte qui dépasse largement le plafond retenu ici pour ce test précis';
  const apres = decouper([
    { temps: '0-3 sec', texte: 'Hook.', visuel: 'V' },
    { temps: '3-60 sec', texte: uneSeulePhrase, visuel: 'V' }
  ]);
  assert.equal(apres.length, 2, 'mieux vaut un bloc long qu\'une phrase coupée en deux');
  assert.equal(apres[1].texte, uneSeulePhrase);
});

test('découpage : les blocs déjà conformes traversent la fonction inchangés (aucune régression)', () => {
  const decouper = chargerDecoupage({ plafond: 25 });
  const script = [
    { temps: '0-3 sec', texte: 'Hook court et net.', visuel: 'A' },
    { temps: '3-25 sec', texte: 'Un corps raisonnable. Deux phrases seulement.', visuel: 'B' },
    { temps: '25-32 sec', texte: 'Une chute qui dit quoi faire maintenant.', visuel: 'C' }
  ];
  assert.deepEqual(decouper(script), script);
  // Entrées dégradées : jamais d'exception.
  assert.equal(decouper(null), null);
  assert.deepEqual(decouper([]), []);
  assert.deepEqual(decouper([{ temps: '0-3 sec' }, { texte: null }]), [{ temps: '0-3 sec' }, { texte: null }]);
});

test('découpage : la suite d\'un bloc coupé porte une consigne de changement de plan adaptée au format', () => {
  const long = Array.from({ length: 10 }, (_, i) => 'Phrase ' + i + ' avec un nombre de mots suffisant pour peser ici.').join(' ');
  const script = [{ temps: '0-60 sec', texte: long, visuel: 'Plan poitrine' }];

  const faceCamera = chargerDecoupage({ plafond: 25, faceless: false })(script);
  assert.ok(faceCamera.length > 1);
  assert.equal(faceCamera[0].visuel, 'Plan poitrine', 'le premier morceau garde le visuel d\'origine');
  assert.match(faceCamera[1].visuel, /cadrage|plan d'illustration/i);
  assert.match(faceCamera[1].visuel, /Plan poitrine/, 'la direction d\'origine reste lisible');

  const faceless = chargerDecoupage({ plafond: 25, faceless: true })(script);
  assert.match(faceless[1].visuel, /Change de visuel/i);
  assert.ok(!/cadrage/i.test(faceless[1].visuel), 'aucun vocabulaire face caméra en mode faceless');
});

// ── 3. Le plafond est bien relatif au format choisi ──

test('plafond : relatif à la durée choisie, jamais un 25 secondes uniforme', () => {
  const bloc = SRC_GENERATION.match(/ {2}function plafondDureeBloc[\s\S]*?\n {2}}/);
  assert.ok(bloc, 'plafondDureeBloc doit exister dans js/generation.js');
  const cibles = {
    '30 secondes': { min: 60, max: 78, blocs: '3' },
    '1 minute': { min: 130, max: 155, blocs: '4' },
    '2 minutes': { min: 270, max: 310, blocs: '5' },
    '5 minutes': { min: 680, max: 780, blocs: '7-8' }
  };
  const plafondPour = (wt) => {
    // eslint-disable-next-line no-eval
    return eval('(function(){const MOTS_PAR_SEC_PARLE=2.5;const DUREE_BLOC_TOLERANCE=1.5;const DUREE_BLOC_PLANCHER=25;'
      + 'const wt=' + JSON.stringify(wt) + ';' + bloc[0] + '\nreturn plafondDureeBloc();})()');
  };
  // Plancher à 25 s (le seuil de plan fixe déjà retenu par l'app) sur les
  // formats courts, puis un plafond qui suit la structure "peu de blocs
  // longs" des formats longs.
  assert.equal(Math.round(plafondPour(cibles['30 secondes'])), 25);
  assert.equal(Math.round(plafondPour(cibles['1 minute'])), 25);
  assert.equal(Math.round(plafondPour(cibles['2 minutes'])), 35);
  assert.equal(Math.round(plafondPour(cibles['5 minutes'])), 63);
  // wt dégradé : jamais d'exception, on retombe sur le plancher.
  assert.equal(plafondPour(null), 25);
  assert.equal(plafondPour({ min: 0, max: 0, blocs: '' }), 25);
});

// ── 4. Bout en bout, dans le vrai navigateur ──

test('bout en bout : un script livré avec un bloc de 47 secondes est redécoupé, à durée et à mots identiques', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
    const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };
    // Reproduit exactement la forme du script terrain : total dans la cible
    // "1 minute" (130-155 mots), mais un bloc du milieu qui pèse 78%.
    const CORPS = "Tu lances avant de tester avec dix vraies personnes. Trop rapide. Puis tu vises tout le monde au lieu d'une niche. Trop large. Ensuite tu construis seul, zéro feedback externe. Trop isolé. Tu dépenses en features avant de monétiser. Trop cher. Et tu fais un produit parfait que personne ne connaît. Trop invisible. Mais ce qui tue vraiment ? C'est pas une erreur qui te tue. C'est le combo qui te tue. Parce que tu crois que chaque étape est isolée. Que tu peux corriger une erreur sans adresser les quatre autres. C'est faux. Elles se renforcent. L'isolation te pousse à dépenser plus. La perfection te pousse à rester invisible plus longtemps. Et l'invisibilité tue la monétisation.";
    const SCRIPT_DESEQUILIBRE = {
      analyse: 'ok',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      script: [
        { temps: '0-4 sec', texte: "Neuf débutants SaaS sur dix font l'erreur numéro trois.", visuel: 'Gros plan' },
        { temps: '4-50 sec', texte: CORPS, visuel: 'Plan poitrine' },
        { temps: '50-58 sec', texte: "L'erreur trois ? Attendre la perfection avant de montrer à quelqu'un. À ce moment, tu es déjà mort.", visuel: 'Gros plan' },
        { temps: '58-60 sec', texte: "Lancer sale. Vendre d'abord. Construire après.", visuel: 'Regard caméra' }
      ],
      legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
    };

    await poserMocksReseau(page);
    const promptsVus = [];
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      promptsVus.push(JSON.stringify(body.messages || []));
      if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
      if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_DESEQUILIBRE) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'BLOC' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Développement personnel';
      document.getElementById('sujet').value = 'Lancer un SaaS';
      ['audience', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      document.getElementById('format').value = '';
      state.depart = 'un sujet précis';
      selectedDuree = '1 minute';
    });
    await page.evaluate(() => generate());
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });

    const resultat = await page.evaluate(() => currentScript.map(b => ({ texte: b.texte, temps: b.temps, visuel: b.visuel })));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS pendant la génération');
    assert.ok(resultat.length > 4, 'le bloc de 47 secondes doit avoir été redécoupé (obtenu : ' + resultat.length + ' blocs)');

    const motsAvant = mots(SCRIPT_DESEQUILIBRE.script.map(b => b.texte).join(' '));
    assert.equal(mots(resultat.map(b => b.texte).join(' ')), motsAvant,
      'REGRESSION : le redécoupage ne doit changer AUCUN mot, donc aucune durée ni aucun score');

    for (const bloc of resultat) {
      assert.ok(mots(bloc.texte) / 2.5 <= 25.5, 'aucun bloc au-dessus du plafond : ' + mots(bloc.texte) + ' mots');
    }
    // Le minutage recalculé porte bien sur le découpage FINAL : blocs
    // contigus, sans trou ni chevauchement, jusqu'à la durée choisie.
    let attendu = 0;
    for (const bloc of resultat) {
      const [d, f] = bloc.temps.replace(' sec', '').split('-').map(Number);
      assert.equal(d, attendu, 'chaque bloc démarre où le précédent s\'arrête');
      attendu = f;
    }
    assert.ok(attendu >= 55 && attendu <= 65, 'la timeline finale doit tomber sur la minute choisie (obtenu : ' + attendu + ' s)');

    // Le hook promet "l'erreur numéro trois" : le contrôle ciblé doit avoir
    // été injecté dans le prompt du Critique indépendant.
    const promptCritique = promptsVus.find(p => /Critique .ditorial de Scriptura/.test(p));
    assert.ok(promptCritique, 'le Critique indépendant doit avoir été appelé');
    assert.match(promptCritique, /CONTRÔLE DE LA PROMESSE CHIFFRÉE/,
      'le rang promis par le hook doit déclencher le contrôle de cohérence');
    assert.match(promptCritique, /erreur numéro trois/i, 'le rang réellement détecté doit être cité au Critique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('bout en bout : un script sans promesse chiffrée n\'alourdit pas le prompt du Critique', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
    const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };
    const SCRIPT_SIMPLE = {
      analyse: 'ok',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      script: [
        { temps: '0-3 sec', texte: 'Personne ne te dira ça sur le lancement.', visuel: 'Gros plan' },
        { temps: '3-30 sec', texte: 'Tu construis pendant des mois. Personne ne t\'attend. Le marché ne sait même pas que tu existes. Et pendant ce temps, ton concurrent vend déjà. Il vend une version bancale, mais il vend. Toi tu peaufines. Lui il encaisse. La différence tient à une seule décision.', visuel: 'Plan poitrine' },
        { temps: '30-45 sec', texte: 'Montre ton produit avant qu\'il soit prêt. Encaisse avant de construire. C\'est inconfortable, et c\'est exactement pour ça que ça marche.', visuel: 'Gros plan' },
        { temps: '45-55 sec', texte: 'Dis-moi en commentaire ce que tu repousses depuis trop longtemps.', visuel: 'Regard caméra' }
      ],
      legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
    };

    await poserMocksReseau(page);
    const promptsVus = [];
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      promptsVus.push(JSON.stringify(body.messages || []));
      if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
      if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_SIMPLE) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'NORANG' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Développement personnel';
      document.getElementById('sujet').value = 'Lancer un SaaS';
      ['audience', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      document.getElementById('format').value = '';
      state.depart = 'un sujet précis';
      selectedDuree = '1 minute';
    });
    await page.evaluate(() => generate());
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });

    const resultat = await page.evaluate(() => currentScript.map(b => b.texte));
    assert.deepEqual(erreursJs, []);
    // Aucun bloc au-dessus du plafond : le script traverse le découpage sans
    // être touché (les textes restent identiques, dans le même ordre).
    assert.deepEqual(resultat, SCRIPT_SIMPLE.script.map(b => b.texte),
      'un script déjà équilibré ne doit jamais être redécoupé');

    const promptCritique = promptsVus.find(p => /Critique .ditorial de Scriptura/.test(p));
    assert.ok(promptCritique);
    assert.ok(!/CONTRÔLE DE LA PROMESSE CHIFFRÉE/.test(promptCritique),
      'sans rang promis, le contrôle ne doit pas être injecté (consigne du Critique non diluée)');
    // Le plafond par bloc, lui, est toujours rappelé.
    assert.match(promptCritique, /aucun ne doit dépasser \d+ mots/i);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

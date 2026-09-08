// « 8 générations et 5 € sont finis, les 40 générations du plan Creator me
// coûteront combien ? » (propriétaire, tableau de bord à l'appui)
//
// Personne ne pouvait répondre autrement qu'en estimant, et une estimation ne
// permet de décider ni d'un prix ni d'un quota. Pourtant Anthropic renvoie
// l'usage en jetons à CHAQUE appel : l'app le jetait, des deux côtés.
//   - chemin en flux (écriture Script/Récit/Série, l'appel le plus cher) :
//     api/generate.js ne relayait que le texte et laissait tomber
//     `message_start` et `message_delta`, qui portent l'usage ;
//   - chemin classique (brief, critique, révision, correction, juge, prompts
//     visuels) : le serveur renvoyait bien `usage`, personne ne le lisait.
//
// Ce fichier verrouille la mesure, et le fait qu'elle reste PASSIVE : aucun
// appel IA de plus, aucune donnée de contenu, aucune décision changée.
//
// Il verrouille aussi la seconde mesure demandée : ce que le PREMIER critique
// a déclaré. Le second brouillon complet part dans 85 % des générations, et
// deux lectures opposées restent possibles tant qu'on ne mesure pas (premiers
// jets vraiment faibles, ou déclencheurs mal posés).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRC_API = lire('js/api.js');
const SRC_GENERATE = lire('api/generate.js');
const SRC_DATA = lire('api/data.js');

// js/api.js référence quantité de globales de navigateur : sans effet ici,
// seules les fonctions de mesure nous intéressent et elles sont pures.
function chargerApi(source) {
  const bac = { setTimeout, clearTimeout, console, localStorage: { getItem: () => null } };
  vm.createContext(bac);
  try { vm.runInContext(source || SRC_API, bac); } catch (e) {}
  return Object.assign(bac, vm.runInContext('({ SEPARATEUR_JETONS })', bac));
}

test('le séparateur de relevé est le MÊME des deux côtés, et c\'est un caractère de contrôle', () => {
  const client = SRC_API.match(/const SEPARATEUR_JETONS = '(.*)';/);
  const serveur = SRC_GENERATE.match(/const SEPARATEUR_JETONS = '(.*)';/);
  assert.ok(client && serveur, 'les deux fichiers doivent définir le séparateur');
  assert.equal(client[1], serveur[1],
    'REGRESSION : le séparateur diffère entre le client et le serveur. Un écart d\'un seul '
    + 'caractère et le relevé de jetons est pris pour du texte de génération, donc affiché au '
    + 'créateur et collé dans le JSON à analyser.');
  assert.equal(client[1].codePointAt(0), 0x1E,
    'REGRESSION : le séparateur n\'est plus U+001E. Il doit rester un caractère de CONTRÔLE, '
    + 'qu\'un modèle n\'écrit jamais dans du texte ni dans du JSON. Un caractère imprimable '
    + 'pourrait apparaître au milieu d\'une génération et couper la réponse en deux.');
  assert.equal(client[1].length, 1, 'un seul caractère, pas une chaîne');
});

test('le serveur lit l\'usage sur les DEUX événements qui le portent', () => {
  assert.ok(/evt\.type === 'message_start'/.test(SRC_GENERATE),
    'REGRESSION : message_start n\'est plus lu. C\'est lui qui porte les jetons d\'ENTRÉE, '
    + 'c\'est-à-dire le prompt, la moitié la plus grosse d\'une passe de correction.');
  assert.ok(/evt\.type === 'message_delta'/.test(SRC_GENERATE),
    'REGRESSION : message_delta n\'est plus lu. C\'est lui qui porte le total des jetons de SORTIE.');
  assert.ok(/res\.write\(SEPARATEUR_JETONS \+ JSON\.stringify\(jetons\)\)/.test(SRC_GENERATE),
    'REGRESSION : le relevé n\'est plus envoyé en fin de flux.');
});

test('le relevé est détaché AVANT l\'aperçu affiché au créateur', () => {
  // L'ordre compte : si onApercu voit le tampon brut, le créateur regarde
  // passer du JSON de mesure à la fin de sa génération.
  const bloc = SRC_API.slice(SRC_API.indexOf('const estFluxDirect'));
  const corps = bloc.slice(0, bloc.indexOf('raw = buffer;'));
  const posCoupe = corps.indexOf('buffer.indexOf(SEPARATEUR_JETONS)');
  const posApercu = corps.indexOf('onApercu(');
  assert.ok(posCoupe >= 0 && posApercu >= 0, 'les deux doivent être présents dans la boucle de flux');
  assert.ok(posCoupe < posApercu,
    'REGRESSION : l\'aperçu est appelé avant que le relevé ne soit détaché. Le créateur verrait '
    + 'le JSON de mesure s\'afficher à la fin de sa génération.');
  assert.ok(/onApercu\(coupe >= 0 \? buffer\.slice\(0, coupe\) : buffer\)/.test(corps),
    'REGRESSION : l\'aperçu ne reçoit plus le tampon tronqué au séparateur.');
});

test('le chemin SANS flux lit enfin l\'usage qu\'il recevait déjà', () => {
  assert.ok(/if \(res\.ok && data && data\.usage\) noterJetons\(data\.usage, useModel\)/.test(SRC_API),
    'REGRESSION : `usage` du chemin classique n\'est plus lu. C\'est la majorité des appels '
    + 'd\'une génération (brief, critique, révision, correction, juge, prompts visuels).');
});

test('le compteur additionne les deux formes de relevé et reste à zéro sans démarrage', () => {
  const bac = chargerApi();

  // Sans démarrage explicite : rien n'est mesuré, volontairement. Une mesure
  // qui traîne d'une génération à l'autre donnerait des totaux faux.
  assert.equal(bac.lireMesureJetons(), null,
    'aucune mesure ne doit courir tant que demarrerMesureJetons n\'a pas été appelé');
  bac.noterJetons({ input_tokens: 999, output_tokens: 999 }, 'x');
  assert.equal(bac.lireMesureJetons(), null, 'un relevé hors mesure ne doit rien accumuler');

  bac.demarrerMesureJetons();
  // Forme Anthropic (chemin sans flux)
  bac.noterJetons({ input_tokens: 4000, output_tokens: 2500, cache_read_input_tokens: 0 }, 'haiku');
  // Forme courte du relevé de fin de flux (api/generate.js)
  bac.noterJetons('{"entree":6000,"sortie":3000,"cache_lu":0,"cache_ecrit":0}', 'haiku');
  const m = bac.lireMesureJetons();
  assert.equal(m.appels, 2, 'les deux formes doivent compter comme deux appels');
  assert.equal(m.entree, 10000, 'les jetons d\'entrée des deux formes doivent s\'additionner');
  assert.equal(m.sortie, 5500);
  assert.equal(m.modeles.haiku, 2, 'le modèle utilisé doit être compté');

  // Un JSON illisible ne doit jamais casser une génération.
  bac.noterJetons('pas du json', 'haiku');
  assert.equal(bac.lireMesureJetons().appels, 2, 'un relevé illisible est ignoré, pas compté');

  bac.demarrerMesureJetons();
  assert.equal(bac.lireMesureJetons().entree, 0, 'un nouveau démarrage repart de zéro');
});

test('les signaux du critique sont ceux du PREMIER critique, jamais des suivants', () => {
  const bac = chargerApi();
  const mesure = { verdict: '', ia_generique: null, raisons_scroll: 0, viralite_moyenne: null };

  bac.mesurerSignauxCritique(mesure, {
    verdict: 'à améliorer', ia_generique: true,
    raisons_de_scroll: ['a', 'b'],
    viralite: { hook: 10, curiosite: 12, rythme: 11 }
  });
  assert.equal(mesure.verdict, 'à améliorer');
  assert.equal(mesure.ia_generique, true);
  assert.equal(mesure.raisons_scroll, 2);
  assert.equal(mesure.viralite_moyenne, 11);

  // Le second critique juge un texte DÉJÀ réécrit : il répond à une autre
  // question, il ne doit pas écraser la mesure qui explique la décision.
  bac.mesurerSignauxCritique(mesure, { verdict: 'excellent', ia_generique: false, raisons_de_scroll: [] });
  assert.equal(mesure.verdict, 'à améliorer',
    'REGRESSION : un critique ultérieur écrase le premier. On mesurerait alors le jugement porté '
    + 'APRÈS la réécriture, pas celui qui l\'a déclenchée.');

  // Aucune exception sur une réponse partielle ou absente.
  const vide = { verdict: '', ia_generique: null, raisons_scroll: 0, viralite_moyenne: null };
  bac.mesurerSignauxCritique(vide, null);
  bac.mesurerSignauxCritique(vide, {});
  assert.equal(vide.verdict, '', 'un critique absent ou vide ne remplit rien');
});

test('les deux modes branchent la mesure, et le récit la démarre AVANT son écriture', () => {
  for (const [nom, fichier] of [['Script', 'js/generation.js'], ['Récit', 'js/storytelling.js']]) {
    const src = lire(fichier);
    assert.ok(/demarrerMesureJetons\(\)/.test(src), nom + ' doit démarrer la mesure');
    assert.ok(/mesurerSignauxCritique\(/.test(src), nom + ' doit mesurer les signaux du critique');
    assert.ok(/lireMesureJetons\(\)/.test(src), nom + ' doit envoyer le relevé');
  }

  // Le piège réel : dans le récit, la déclaration des mesures de passes se
  // trouve APRÈS le premier appel IA. Y poser le démarrage aurait raté
  // l'écriture, l'appel le plus cher de tout le pipeline.
  const recit = lire('js/storytelling.js');
  const debut = recit.indexOf('demarrerMesureJetons()');
  const premierAppel = recit.indexOf('callAI(MODEL_CREATIF, 16000, storyPrompt');
  assert.ok(debut >= 0 && premierAppel >= 0);
  assert.ok(debut < premierAppel,
    'REGRESSION : le compteur du récit démarre APRÈS son écriture. L\'appel le plus cher de la '
    + 'génération ne serait pas compté, et le total mentirait par défaut.');
});

test('le serveur enregistre les nouvelles colonnes, et survit si la migration n\'est pas lancée', () => {
  assert.ok(/jetons_entree|jetons_sortie/.test(SRC_DATA), 'les jetons doivent être enregistrés');
  assert.ok(/critique_verdict|critique_ia_generique/.test(SRC_DATA), 'les signaux du critique aussi');
  assert.ok(/if \(!rep\.ok\) await envoyer\(ligne\)/.test(SRC_DATA),
    'REGRESSION : plus de repli sans les nouvelles colonnes. Tant que supabase/mesure_jetons.sql '
    + 'n\'est pas lancé, PostgREST refuse TOUTE la ligne, et on perdrait aussi la mesure des '
    + 'passes, qui fonctionne pourtant déjà.');
  const sql = lire('supabase/mesure_jetons.sql');
  for (const col of ['jetons_entree', 'jetons_sortie', 'appels_ia', 'critique_verdict', 'critique_viralite']) {
    assert.ok(sql.includes(col), 'la migration doit créer la colonne ' + col);
  }
  assert.ok(/add column if not exists/.test(sql), 'la migration doit pouvoir être relancée sans casse');
});

test('la mesure reste PASSIVE : aucun appel IA de plus, aucune donnée de contenu', () => {
  const bac = chargerApi();
  bac.demarrerMesureJetons();
  bac.noterJetons({ input_tokens: 10, output_tokens: 20 }, 'haiku');
  const releve = bac.lireMesureJetons();
  const serialise = JSON.stringify(releve);
  // Rien qui puisse contenir du texte de script : que des nombres et des noms
  // de modèles. C'est la garantie donnée au créateur.
  for (const [cle, val] of Object.entries(releve)) {
    if (cle === 'modeles') continue;
    assert.equal(typeof val, 'number', 'le relevé ne doit contenir que des nombres, or ' + cle + ' ne l\'est pas');
  }
  assert.ok(!/prompt|texte|script|sujet/i.test(serialise), 'le relevé ne doit porter aucun contenu');
});

// ── CONTRÔLE DE MORSURE ──
test('contrôle de morsure : chaque règle tombe quand on réintroduit son défaut', () => {
  const mordu = (verif) => { try { verif(); return false; } catch (e) { return true; } };

  // 1. Aperçu qui reçoit le tampon BRUT : le créateur verrait le JSON de
  //    mesure s'afficher à la fin de sa génération. C'est la troncature qui
  //    protège, pas la simple position de l'appel : vérifier l'ordre seul ne
  //    mordait pas, puisque le calcul de la coupe restait au-dessus.
  assert.ok(mordu(() => {
    const abime = SRC_API.replace(
      'if (onApercu) onApercu(coupe >= 0 ? buffer.slice(0, coupe) : buffer);',
      'if (onApercu) onApercu(buffer);'
    );
    const bloc = abime.slice(abime.indexOf('const estFluxDirect'));
    const corps = bloc.slice(0, bloc.indexOf('raw = buffer;'));
    assert.ok(/onApercu\(coupe >= 0 \? buffer\.slice\(0, coupe\) : buffer\)/.test(corps));
  }), 'le test de la troncature de l\'aperçu ne mord pas.');

  // 2. Séparateur imprimable : il pourrait apparaître dans une génération.
  assert.ok(mordu(() => {
    const abime = SRC_API.replace(/const SEPARATEUR_JETONS = '.*';/, "const SEPARATEUR_JETONS = '#';");
    const m = abime.match(/const SEPARATEUR_JETONS = '(.*)';/);
    assert.equal(m[1].codePointAt(0), 0x1E);
  }), 'le test du caractère de contrôle ne mord pas.');

  // 3. Un critique ultérieur écrase le premier.
  assert.ok(mordu(() => {
    const bac = chargerApi(SRC_API.replace(
      'if (!mesure || !critique || mesure.verdict) return;',
      'if (!mesure || !critique) return;'
    ));
    const m = { verdict: '', ia_generique: null, raisons_scroll: 0, viralite_moyenne: null };
    bac.mesurerSignauxCritique(m, { verdict: 'à améliorer', ia_generique: true, raisons_de_scroll: ['a'] });
    bac.mesurerSignauxCritique(m, { verdict: 'excellent', ia_generique: false, raisons_de_scroll: [] });
    assert.equal(m.verdict, 'à améliorer');
  }), 'le test du premier critique ne mord pas.');

  // 4. Compteur qui accumule sans démarrage explicite.
  assert.ok(mordu(() => {
    const bac = chargerApi(SRC_API.replace(
      'let _jetonsGeneration = null;   // null = aucune mesure en cours',
      'let _jetonsGeneration = { appels: 0, entree: 0, sortie: 0, cache_lu: 0, cache_ecrit: 0, modeles: {} };'
    ));
    assert.equal(bac.lireMesureJetons(), null);
  }), 'le test du démarrage explicite ne mord pas.');

  // 5. Repli serveur retiré : une migration non lancée ferait tout perdre.
  assert.ok(mordu(() => {
    const abime = SRC_DATA.replace('if (!rep.ok) await envoyer(ligne);', '');
    assert.ok(/if \(!rep\.ok\) await envoyer\(ligne\)/.test(abime));
  }), 'le test du repli ne mord pas.');

  // 6. Démarrage du récit déplacé après son écriture.
  assert.ok(mordu(() => {
    const recit = lire('js/storytelling.js')
      .replace(/  if \(typeof demarrerMesureJetons === 'function'\) demarrerMesureJetons\(\);\n/, '');
    const debut = recit.indexOf('demarrerMesureJetons()');
    const premierAppel = recit.indexOf('callAI(MODEL_CREATIF, 16000, storyPrompt');
    assert.ok(debut >= 0 && debut < premierAppel);
  }), 'le test de l\'ordre dans le récit ne mord pas.');
});

// ── TEST DE COMPORTEMENT, DANS UN VRAI NAVIGATEUR ──
// Tout ce qui précède lit la source. Celui-ci fait tourner le VRAI callAI sur
// un flux qui porte un relevé, et vérifie ce qui compte pour de bon : le
// créateur ne voit jamais le séparateur, l'analyse JSON ne le voit pas non
// plus, et le relevé est bien compté.
//
// Le séparateur est écrit  et jamais en clair : un caractère de contrôle
// posé littéralement dans un fichier source est invisible à la relecture et se
// perd au premier copier-coller.
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const SEP = '';

test('bout en bout : le relevé est compté, et il ne fuit ni dans l\'aperçu ni dans le texte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      // Exactement ce que relaie api/generate.js en mode flux : le texte
      // généré, puis le séparateur, puis le relevé de jetons.
      const corps = '{"resultat":"bonjour"}' + SEP
        + JSON.stringify({ entree: 4321, sortie: 1234, cache_lu: 0, cache_ecrit: 0 });
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: corps });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof callAI === 'function' && typeof demarrerMesureJetons === 'function');

    const r = await page.evaluate(async () => {
      demarrerMesureJetons();
      const vus = [];
      const raw = await callAI('claude-haiku-4-5-20251001', 16000, 'peu importe',
        undefined, false, undefined, undefined, undefined, (b) => vus.push(b), 'script');
      return { raw, vus, mesure: lireMesureJetons() };
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(!r.raw.includes(SEP),
      'REGRESSION : le séparateur reste dans le texte rendu par callAI. Il partirait tel quel '
      + 'dans l\'analyse JSON du script.');
    assert.ok(!r.raw.includes('4321'),
      'REGRESSION : le relevé de jetons reste collé au texte de la génération.');
    assert.equal(r.raw.trim(), '{"resultat":"bonjour"}', 'le texte généré doit être rendu intact');

    assert.ok(r.vus.length > 0, 'l\'aperçu doit avoir été appelé');
    for (const vu of r.vus) {
      assert.ok(!vu.includes(SEP) && !vu.includes('4321'),
        'REGRESSION : le créateur voit passer le relevé de mesure dans son aperçu de génération. '
        + 'Reçu : ' + JSON.stringify(vu));
    }

    assert.equal(r.mesure.entree, 4321, 'les jetons d\'entrée doivent être comptés');
    assert.equal(r.mesure.sortie, 1234, 'les jetons de sortie doivent être comptés');
    assert.equal(r.mesure.appels, 1, 'un appel doit être compté');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

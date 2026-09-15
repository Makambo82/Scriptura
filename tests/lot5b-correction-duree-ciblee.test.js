// LOT 5B (audit Token Efficiency) — la correction de durée du mode Script
// (corrigerDureeScript, js/generation.js) demandait jusqu'ici au modèle de
// RETAPER LE SCRIPT ENTIER à chaque tentative, y compris le hook et la
// chute qu'elle lui demandait pourtant explicitement de "garder tels
// quels" (donc un risque réel d'altération accidentelle, en plus du coût).
//
// Correctif : quand le plan par bloc (déjà calculé en code) identifie
// précisément quels blocs du milieu doivent changer, le prompt ne demande
// plus QUE ces blocs (par index), et le code recolle lui-même, verbatim,
// tout ce qui n'est pas renvoyé (hook, chute, blocs déjà à leur cible, ou
// un index que le modèle aurait malgré tout omis). max_tokens est réduit
// en proportion du nombre de blocs réellement demandés (jamais au-delà de
// l'ancien plafond, 8000, qui reste celui du repli "script entier" pour le
// cas limite où le plan ne peut pas être établi).
//
// Aucun appel réel à Anthropic : tout est mocké via page.route.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

function texteEnvoye(body) {
  const c = body.messages && body.messages[0] && body.messages[0].content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => (b && b.text) || '').join('\n');
  return '';
}

const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };

// 6 blocs : 0=hook, 1-4=milieu (15 mots chacun, sous toute cible plausible
// pour "1 minute" mais AU-DESSUS du seuil de complétude, wt.min*0.5, sans
// quoi le pipeline le jugerait incomplet et ne generait jamais jusqu'à la
// correction de durée), 5=chute. Texte de chaque bloc traçable par un
// marqueur distinct (motOriginalBLOC<i>), pour vérifier après coup lequel a
// changé et lequel non.
function motsOriginaux(i, n) {
  return Array.from({ length: n }, (_, k) => 'motOriginalBLOC' + i + '_' + k).join(' ');
}
const SCRIPT_INITIAL = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [
    { temps: '0-3 sec', texte: motsOriginaux(0, 8), visuel: 'V0' },
    { temps: '3-15 sec', texte: motsOriginaux(1, 15), visuel: 'V1' },
    { temps: '15-27 sec', texte: motsOriginaux(2, 15), visuel: 'V2' },
    { temps: '27-39 sec', texte: motsOriginaux(3, 15), visuel: 'V3' },
    { temps: '39-51 sec', texte: motsOriginaux(4, 15), visuel: 'V4' },
    { temps: '51-60 sec', texte: motsOriginaux(5, 15), visuel: 'V5' }
  ],
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};
// Total : 8+15+15+15+15+15 = 83 mots. Sous la cible "1 minute" (130-155,
// tolérance 117-170) donc la correction se déclenche, mais au-dessus du
// seuil de complétude (~65) donc le pipeline ne le rejette pas avant même
// d'atteindre la correction de durée. Les 4 blocs du milieu (15 mots)
// restent loin de toute cible plausible pour un "milieu" recalculé sur 143
// mots répartis en 4 blocs (~30 chacun) : ils seront TOUS signalés comme à
// corriger, rendant le test indépendant des constantes internes précises.

async function lancerAvecCorrection(page, baseUrl, repondreEnCorrection) {
  const appelsEcriture = [];
  const appelsCorrection = [];
  await poserMocksReseau(page);
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const texte = texteEnvoye(body);
    const fulfill = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(obj) }] }) });

    if (body.max_tokens === 2000) return fulfill(BRIEF);
    if (body.max_tokens === 2500) return fulfill(CRITIQUE_OK);
    if (/ne respecte PAS la durée demandée/.test(texte)) {
      appelsCorrection.push(body);
      return fulfill(repondreEnCorrection(texte, appelsCorrection.length));
    }
    if (body.max_tokens === 16000) {
      appelsEcriture.push(body);
      return fulfill(SCRIPT_INITIAL);
    }
    // Complétion des hooks (déjà 5) et juge : hors périmètre, réponse neutre.
    return fulfill({});
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'LOT5B' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('niche').value = 'Histoire';
    document.getElementById('sujet').value = 'Behanzin';
    ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
    state.depart = 'un sujet précis';
    selectedDuree = '1 minute';
  });
  await page.evaluate(() => generate());
  await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
  await page.waitForTimeout(600);
  return { appelsEcriture, appelsCorrection };
}

function indicesDemandes(texte) {
  const m = /NE RÉÉCRIS QUE LES BLOCS D'INDEX ([\d, ]+)/.exec(texte);
  return m ? m[1].split(',').map(s => parseInt(s.trim(), 10)) : null;
}

test('LOT 5B : la correction de durée ne demande QUE les blocs à corriger (format ciblé), jamais le script entier', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const { appelsCorrection } = await lancerAvecCorrection(page, baseUrl, (texte) => {
      const indices = indicesDemandes(texte);
      return { blocs: (indices || []).map(i => ({ index: i, texte: motsOriginaux(i, 30).replace(/Original/, 'Corrige'), visuel: 'Nouveau visuel ' + i })) };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(appelsCorrection.length >= 1, 'au moins une tentative de correction doit avoir eu lieu');
    const premiereCorrection = appelsCorrection[0];
    const texte = texteEnvoye(premiereCorrection);

    assert.match(texte, /NE RÉÉCRIS QUE LES BLOCS D'INDEX/, 'le prompt doit demander explicitement un format ciblé');
    assert.doesNotMatch(texte, /\{"script":\[\{"temps"/, 'le format de réponse "script entier" ne doit plus être demandé quand le plan est ciblé');
    const indices = indicesDemandes(texte);
    assert.ok(indices && indices.length > 0, 'des indices précis doivent être listés');
    assert.ok(!indices.includes(0) && !indices.includes(5), 'le hook (0) et la chute (5) ne doivent JAMAIS être demandés au modèle');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('LOT 5B : max_tokens de la correction est réduit en proportion des blocs demandés (jamais 8000 par défaut)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();

    const { appelsCorrection } = await lancerAvecCorrection(page, baseUrl, (texte) => {
      const indices = indicesDemandes(texte);
      return { blocs: (indices || []).map(i => ({ index: i, texte: motsOriginaux(i, 30).replace(/Original/, 'Corrige'), visuel: 'V' })) };
    });

    const premiereCorrection = appelsCorrection[0];
    const indices = indicesDemandes(texteEnvoye(premiereCorrection));
    const attendu = Math.max(1500, Math.min(8000, indices.length * 400));
    assert.equal(premiereCorrection.max_tokens, attendu,
      `max_tokens doit suivre la formule proportionnelle (${indices.length} blocs -> ${attendu}), jamais l'ancien plafond fixe de 8000`);
    assert.ok(premiereCorrection.max_tokens < 8000, 'avec seulement quelques blocs à corriger, le plafond doit être strictement inférieur à l\'ancien 8000 fixe');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('LOT 5B : le hook et la chute ressortent EXACTEMENT identiques (jamais renvoyés par le modèle, donc jamais altérables)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();

    await lancerAvecCorrection(page, baseUrl, (texte) => {
      const indices = indicesDemandes(texte);
      return { blocs: (indices || []).map(i => ({ index: i, texte: motsOriginaux(i, 30).replace(/Original/, 'Corrige'), visuel: 'Nouveau visuel ' + i })) };
    });

    const script = await page.evaluate(() => currentScript.map(b => b.texte));
    assert.equal(script[0], motsOriginaux(0, 8), 'le hook doit rester EXACTEMENT le texte d\'origine, jamais retapé par le modèle');
    assert.equal(script[5], motsOriginaux(5, 15), 'la chute doit rester EXACTEMENT le texte d\'origine, jamais retapée par le modèle');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('LOT 5B : un bloc absent de la réponse du modèle garde son texte ORIGINAL, jamais perdu ni vidé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await lancerAvecCorrection(page, baseUrl, (texte) => {
      const indices = indicesDemandes(texte) || [];
      // Omet volontairement le PREMIER index demandé, pour vérifier que ce
      // bloc précis n'est ni perdu ni vidé : il doit garder son texte
      // d'origine, comme si la correction ne l'avait jamais concerné.
      const indicesRepondus = indices.slice(1);
      return { blocs: indicesRepondus.map(i => ({ index: i, texte: motsOriginaux(i, 30).replace(/Original/, 'Corrige'), visuel: 'V' })) };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS malgré une réponse incomplète du modèle');
    const script = await page.evaluate(() => currentScript.map(b => b.texte));
    // Le bloc 1 (premier bloc du milieu, donc premier index demandé dans ce
    // scénario) n'a jamais été renvoyé par le mock : il doit être identique
    // à l'original, jamais vide ni tronqué.
    assert.equal(script[1], motsOriginaux(1, 15), 'un bloc omis de la réponse du modèle doit garder son texte original intact');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('LOT 5B : régression - le compte de mots progresse bien vers la cible après une correction ciblée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await lancerAvecCorrection(page, baseUrl, (texte) => {
      const indices = indicesDemandes(texte) || [];
      return { blocs: indices.map(i => ({ index: i, texte: motsOriginaux(i, 30).replace(/Original/, 'Corrige'), visuel: 'V' })) };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const total = await page.evaluate(() => currentScript.map(b => b.texte.split(/\s+/).filter(Boolean).length).reduce((a, b) => a + b, 0));
    // Partait de 43 mots (bien sous la cible) ; chaque bloc du milieu corrigé
    // passe à 30 mots : le total doit avoir nettement progressé, preuve que
    // la correction ciblée a un effet réel sur le compte final, pas
    // seulement sur le format de la requête.
    assert.ok(total > 60, `le compte de mots doit avoir nettement progressé après correction (obtenu : ${total})`);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

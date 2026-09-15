// LOT 5A (audit Token Efficiency) — le second brouillon complet (Script ET
// Récit) réutilisait jusqu'ici writePrompt/storyPrompt À L'IDENTIQUE du
// premier essai, sans jamais lire le diagnostic déjà payé du Critique
// (jusqu'à 2500 jetons de sortie). Correctif : syntheseDiagnosticSecondBrouillon
// (js/generation.js) / syntheseDiagnosticSecondBrouillonRecit
// (js/storytelling.js) injectent une synthèse COMPACTE du diagnostic
// UNIQUEMENT dans le prompt du second brouillon, jamais dans writePrompt/
// storyPrompt eux-mêmes (le premier essai et son retry technique restent
// inchangés). Ce fichier verrouille : le diagnostic atteint bien le second
// brouillon, les champs non retenus (segments_faibles, verdict/note brute)
// n'y sont PAS recopiés, le premier essai n'est pas affecté, et le
// comportement reste inchangé quand le second brouillon n'est pas déclenché.
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

// ════════════════════════════════════════════
//  SCRIPT (js/generation.js)
// ════════════════════════════════════════════

const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const bloc = (i, mots) => ({ temps: '0-3 sec', texte: Array.from({ length: mots }, (_, k) => 'mot' + i + k).join(' '), visuel: 'V' + i });
// 4 blocs x 36 mots = 144 mots : dans la cible "1 minute" (130-155).
const SCRIPT_OK = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [0, 1, 2, 3].map(i => bloc(i, 36)),
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};

const CRITIQUE_FONDAMENTAL_SCRIPT = {
  verdict: 'à améliorer',
  ia_generique: true,
  justification_ia_generique: 'MARQUEUR_JUSTIFICATION_IA_SCRIPT',
  raisons_de_scroll: ['MARQUEUR_RAISON_SCROLL_SCRIPT'],
  instructions_revision: 'MARQUEUR_INSTRUCTIONS_REVISION_SCRIPT',
  points_forts: ['MARQUEUR_POINT_FORT_SCRIPT'],
  // Volontairement présent mais NE DOIT PAS apparaître dans le prompt du
  // second brouillon (index qui ne correspondront plus au nouveau texte,
  // contenu redondant avec raisons_de_scroll/instructions_revision).
  segments_faibles: [{ index: 0, probleme: 'MARQUEUR_SEGMENT_FAIBLE_INTERDIT_SCRIPT' }],
  note_globale: 12
};
const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };
// Problème réel mais PAS fondamental (ia_generique faux, pas de viralite
// basse) : doit passer par le Réviseur, jamais par le second brouillon.
const CRITIQUE_NON_FONDAMENTAL = {
  verdict: 'à améliorer',
  ia_generique: false,
  segments_faibles: [{ index: 0, probleme: 'un peu faible' }],
  raisons_de_scroll: []
};

async function lancerScript(page, baseUrl, premiereCritique) {
  const appelsEcriture = [];
  const appelsCritique = [];
  await poserMocksReseau(page);
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
    if (body.max_tokens === 16000) {
      appelsEcriture.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_OK) }] }) });
    }
    if (body.max_tokens === 2500) {
      appelsCritique.push(body);
      const critique = appelsCritique.length === 1 ? premiereCritique : CRITIQUE_OK;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(critique) }] }) });
    }
    // Hook completion, correction de durée, juge : hors périmètre de ce lot,
    // réponse neutre (le script est déjà à 5 hooks et dans la cible).
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'LOT5A' + Math.round(Math.random() * 1e6), plan: 'creator' });
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
  return { appelsEcriture, appelsCritique };
}

test('Script : le second brouillon reçoit une synthèse du diagnostic du Critique (raisons de scroll, instructions, justification IA générique, points forts)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const { appelsEcriture, appelsCritique } = await lancerScript(page, baseUrl, CRITIQUE_FONDAMENTAL_SCRIPT);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appelsCritique.length, 2, 'le critique doit repasser une 2e fois sur le nouveau brouillon');
    assert.equal(appelsEcriture.length, 2, 'exactement 1er brouillon + second brouillon, pas de 3e écriture');

    const texteSecond = texteEnvoye(appelsEcriture[1]);
    assert.match(texteSecond, /MARQUEUR_RAISON_SCROLL_SCRIPT/, 'les raisons de décrochage doivent atteindre le second brouillon');
    assert.match(texteSecond, /MARQUEUR_INSTRUCTIONS_REVISION_SCRIPT/, 'les instructions du critique doivent atteindre le second brouillon');
    assert.match(texteSecond, /MARQUEUR_JUSTIFICATION_IA_SCRIPT/, 'la justification "IA générique" doit atteindre le second brouillon');
    assert.match(texteSecond, /MARQUEUR_POINT_FORT_SCRIPT/, 'ce qui fonctionnait déjà doit être signalé (rien n\'est préservé par défaut dans une réécriture complète)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : les champs non retenus (segments_faibles brut) ne sont PAS recopiés dans le second brouillon', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();

    const { appelsEcriture } = await lancerScript(page, baseUrl, CRITIQUE_FONDAMENTAL_SCRIPT);
    const texteSecond = texteEnvoye(appelsEcriture[1]);

    assert.doesNotMatch(texteSecond, /MARQUEUR_SEGMENT_FAIBLE_INTERDIT_SCRIPT/,
      'segments_faibles brut ne doit pas être recopié : redondant avec raisons_de_scroll/instructions_revision, et ses index ne correspondent plus au nouveau texte');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : le PREMIER brouillon reste strictement inchangé (aucun diagnostic, puisqu\'aucune critique n\'existe encore à ce stade)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();

    const { appelsEcriture } = await lancerScript(page, baseUrl, CRITIQUE_FONDAMENTAL_SCRIPT);
    const textePremier = texteEnvoye(appelsEcriture[0]);

    assert.doesNotMatch(textePremier, /DIAGNOSTIC DU CRITIQUE/, 'le 1er brouillon ne doit jamais contenir de bloc diagnostic');
    assert.doesNotMatch(textePremier, /MARQUEUR_/, 'aucun marqueur de test ne doit fuiter dans le 1er brouillon');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : comportement inchangé quand le problème n\'est PAS fondamental (Réviseur ciblé, pas de second brouillon)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const { appelsEcriture } = await lancerScript(page, baseUrl, CRITIQUE_NON_FONDAMENTAL);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appelsEcriture.length, 1, 'un problème non fondamental ne doit JAMAIS déclencher de second brouillon (comportement d\'avant ce lot, inchangé)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// ════════════════════════════════════════════
//  RÉCIT (js/storytelling.js)
// ════════════════════════════════════════════

const RECIT_OK = {
  titre: 'Un titre', ton: 'sobre', modele_utilise: '',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  recit: Array.from({ length: 8 }, (_, i) => ({ segment: 'Segment ' + i, texte: 'Phrase numéro ' + i + ' avec plusieurs mots pour peser correctement dans le récit final ici présent.' })),
  legende: 'Légende', hashtags: ['#a']
};
const CRITIQUE_FONDAMENTAL_RECIT = {
  verdict: 'à améliorer',
  ia_generique: true,
  raisons_de_scroll: ['MARQUEUR_RAISON_SCROLL_RECIT'],
  instructions_revision: 'MARQUEUR_INSTRUCTIONS_REVISION_RECIT',
  segments_faibles: [{ index: 0, probleme: 'MARQUEUR_SEGMENT_FAIBLE_INTERDIT_RECIT' }]
};
const CRITIQUE_OK_RECIT = { verdict: 'excellent', segments_faibles: [], raisons_de_scroll: [], ia_generique: false };
const CRITIQUE_NON_FONDAMENTAL_RECIT = {
  verdict: 'à améliorer',
  ia_generique: false,
  segments_faibles: [{ index: 0, probleme: 'un peu faible' }],
  raisons_de_scroll: []
};

async function lancerRecit(page, baseUrl, premiereCritique) {
  const appelsEcriture = [];
  const appelsCritique = [];
  await poserMocksReseau(page);
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.max_tokens === 16000) {
      appelsEcriture.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(RECIT_OK) }] }) });
    }
    if (body.max_tokens === 2500) {
      appelsCritique.push(body);
      const critique = appelsCritique.length === 1 ? premiereCritique : CRITIQUE_OK_RECIT;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(critique) }] }) });
    }
    // Choix sémantique de modèle (400), hooks/ouverture/clôture/révision/
    // correction de durée/juge : hors périmètre de ce lot, réponse neutre.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'LOT5AR' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('storyInput').value = 'Un fait historique marquant à raconter';
    storyFormat = 'long';
    storyDuree = '';
    storyTon = '';
  });
  await page.evaluate(() => generateStory());
  await page.waitForFunction(() => typeof currentStory !== 'undefined' && currentStory && currentStory.recit && currentStory.recit.length, null, { timeout: 25000 });
  await page.waitForTimeout(600);
  return { appelsEcriture, appelsCritique };
}

test('Récit : le second brouillon reçoit une synthèse du diagnostic du Critique (raisons de scroll, instructions)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const { appelsEcriture, appelsCritique } = await lancerRecit(page, baseUrl, CRITIQUE_FONDAMENTAL_RECIT);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appelsCritique.length, 2, 'le critique doit repasser une 2e fois sur le nouveau brouillon');
    assert.equal(appelsEcriture.length, 2, 'exactement 1er brouillon + second brouillon');

    const texteSecond = texteEnvoye(appelsEcriture[1]);
    assert.match(texteSecond, /MARQUEUR_RAISON_SCROLL_RECIT/, 'les raisons de décrochage doivent atteindre le second brouillon');
    assert.match(texteSecond, /MARQUEUR_INSTRUCTIONS_REVISION_RECIT/, 'les instructions du critique doivent atteindre le second brouillon');
    assert.doesNotMatch(texteSecond, /MARQUEUR_SEGMENT_FAIBLE_INTERDIT_RECIT/, 'segments_faibles brut ne doit pas être recopié (schéma du critique Récit, sans points_forts ni justification_ia_generique)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : le PREMIER brouillon reste strictement inchangé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();

    const { appelsEcriture } = await lancerRecit(page, baseUrl, CRITIQUE_FONDAMENTAL_RECIT);
    const textePremier = texteEnvoye(appelsEcriture[0]);

    assert.doesNotMatch(textePremier, /DIAGNOSTIC DU CRITIQUE/, 'le 1er brouillon ne doit jamais contenir de bloc diagnostic');
    assert.doesNotMatch(textePremier, /MARQUEUR_/, 'aucun marqueur de test ne doit fuiter dans le 1er brouillon');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : comportement inchangé quand le problème n\'est PAS fondamental (pas de second brouillon)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const { appelsEcriture } = await lancerRecit(page, baseUrl, CRITIQUE_NON_FONDAMENTAL_RECIT);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appelsEcriture.length, 1, 'un problème non fondamental ne doit jamais déclencher de second brouillon');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Après avoir étudié le générateur de scripts Vervox (PDF envoyé par le
// propriétaire), leur "Éditeur IA intégré" est mis en avant comme le vrai
// différenciateur face à ChatGPT : sélectionner UN passage du script déjà
// écrit et demander à l'IA de le reformuler/raccourcir/allonger/simplifier,
// réécrit en 2 secondes SANS tout refaire. Chez Scriptura, le script généré
// était strictement en lecture seule (seul "✎ Modifier" existait, et il
// relance TOUT depuis les critères de départ). Corrigé par
// microEditerBlocScript (js/generation.js).
//
// Ce test verrouille : un clic sur une action de micro-édition envoie un
// appel IA ciblé sur CE SEUL passage (le texte des autres blocs n'apparaît
// pas dans le prompt), remplace le texte du bloc concerné SANS toucher aux
// autres, et ne déclenche AUCUNE écriture dans l'historique des générations
// (gratuit, hors quota, contrairement à une vraie génération de script).
// Un second test verrouille le plafond anti-abus (MICRO_EDIT_MAX_PAR_SCRIPT).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const BRIEF_FAKE = { analyse_strategique: 'A', angle_choisi: 'Angle X', pourquoi_cet_angle: 'P', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const SCRIPT_FAKE = {
  score: { viral: 90, hook: 90, engagement: 90, emotion: 90, retention: 90 },
  analyse: 'ok',
  hooks: [{ style: 'x', texte: 'Hook 1' }],
  script: [
    { temps: '0-3 sec', texte: 'Premier bloc du script, le hook.', visuel: 'Visuel 1' },
    { temps: '3-10 sec', texte: 'Deuxième bloc du script, le développement.', visuel: 'Visuel 2' }
  ],
  legende: 'Légende', hashtags: ['#a'], variantes_titre: ['T1']
};

async function genererScriptEtOuvrirResultat(page) {
  const requetesGenerations = []; // POST /api/data resource=generations (saveGeneration)
  const appelsIA = [];
  await poserMocksReseau(page, {
    generate: (body) => {
      appelsIA.push(body);
      if (body.max_tokens === 2000) return { content: [{ text: JSON.stringify(BRIEF_FAKE) }] };
      if (body.max_tokens === 16000) return { content: [{ text: JSON.stringify(SCRIPT_FAKE) }] };
      // Micro-édition (max_tokens 300) : réponse par défaut minimale, les
      // tests qui en ont besoin fournissent leur propre gestionnaire "generate"
      // et n'appellent donc jamais cette fonction partagée pour cette partie.
      return { content: [{ text: 'Texte réécrit.' }] };
    },
    data: (body, method) => {
      if (method === 'POST' && body && body.resource === 'generations') requetesGenerations.push(body);
      return undefined;
    }
  });
  await connecterAbonne(page, { code: 'SCRIPTEDIT' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('niche').value = 'Business & Entrepreneuriat';
    document.getElementById('sujet').value = 'Comment lancer une petite entreprise';
    document.getElementById('audience').value = '';
    document.getElementById('format').value = '';
    document.getElementById('venteDescription').value = '';
    document.getElementById('viralVideo').value = '';
    if (typeof state !== 'undefined') state.depart = 'un sujet précis';
  });
  await page.evaluate(() => generate());
  await page.waitForTimeout(2000);
  return { requetesGenerations, appelsIA };
}

test('éditeur IA par passage : reformule UN SEUL bloc du script, sans toucher aux autres, sans consommer de génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const { requetesGenerations } = await genererScriptEtOuvrirResultat(page);
    assert.equal(requetesGenerations.length, 1, 'la génération initiale du script doit avoir écrit UNE fois dans l\'historique');

    const texteAvant = await page.evaluate(() => ({
      b0: document.getElementById('scriptText0')?.textContent,
      b1: document.getElementById('scriptText1')?.textContent
    }));
    assert.match(texteAvant.b1, /Deuxième bloc/);

    // Remplace le mock "generate" pour capturer précisément l'appel de
    // micro-édition déclenché par le clic sur "Raccourcir" (bloc 1).
    let promptEdition = null;
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      promptEdition = body;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'Bloc raccourci.' }] }) });
    });

    await page.evaluate(() => {
      const btn = document.querySelector('#scriptEditToolbar1 .script-edit-btn');
      // 2e bouton = "Raccourcir" (ordre : Reformuler, Raccourcir, Allonger, Simplifier)
      const boutons = document.querySelectorAll('#scriptEditToolbar1 .script-edit-btn');
      boutons[1].click();
    });
    await page.waitForTimeout(500);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(promptEdition, 'l\'appel IA de micro-édition doit avoir eu lieu');
    assert.equal(promptEdition.max_tokens, 300, 'la micro-édition doit utiliser un plafond de tokens réduit, volontairement léger');
    const promptTexte = JSON.stringify(promptEdition.messages);
    assert.match(promptTexte, /Deuxième bloc du script, le développement/, 'le prompt doit contenir le texte du bloc ciblé');
    assert.ok(!promptTexte.includes('Premier bloc du script, le hook'), 'le prompt ne doit PAS contenir le texte des AUTRES blocs : ' + promptTexte.slice(0, 300));
    assert.match(promptTexte, /Raccourcis nettement ce passage/, 'la consigne "raccourcir" doit être présente dans le prompt');

    const texteApres = await page.evaluate(() => ({
      b0: document.getElementById('scriptText0')?.textContent,
      b1: document.getElementById('scriptText1')?.textContent
    }));
    assert.equal(texteApres.b1, 'Bloc raccourci.', 'le bloc édité doit afficher le nouveau texte');
    assert.equal(texteApres.b0, texteAvant.b0, 'le bloc NON édité doit rester strictement identique');

    // Aucune nouvelle écriture dans l'historique des générations suite à la
    // micro-édition : gratuit, hors quota (contrairement à une vraie génération,
    // qui en aurait ajouté une). Le gestionnaire "data" posé par
    // genererScriptEtOuvrirResultat reste actif : requetesGenerations n'a pas
    // pu grossir depuis l'assertion précédente sans qu'on le revoie ici.
    assert.equal(requetesGenerations.length, 1, 'la micro-édition ne doit écrire AUCUNE nouvelle génération dans l\'historique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('éditeur IA par passage : le plafond anti-abus par script est respecté', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    await genererScriptEtOuvrirResultat(page);

    let nbAppelsEdition = 0;
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 300) nbAppelsEdition++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'Texte ' + nbAppelsEdition + '.' }] }) });
    });

    // 21 clics sur "Reformuler" du bloc 0 : le plafond (20) doit stopper les
    // appels IA au 21e, avec un message d'erreur clair plutôt qu'un appel de plus.
    for (let i = 0; i < 21; i++) {
      await page.evaluate(() => document.querySelectorAll('#scriptEditToolbar0 .script-edit-btn')[0].click());
      await page.waitForTimeout(120);
    }

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(nbAppelsEdition, 20, 'le 21e clic ne doit PAS déclencher un nouvel appel IA, le plafond doit l\'arrêter avant');
    const erreurAffichee = await page.evaluate(() => document.getElementById('scriptEditError')?.textContent || '');
    assert.match(erreurAffichee, /limite de retouches/, 'un message clair doit expliquer pourquoi le 21e clic n\'a rien fait : ' + erreurAffichee);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

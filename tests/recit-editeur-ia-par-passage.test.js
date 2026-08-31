// Porté du mode Script (voir tests/script-editeur-ia-par-passage.test.js et
// microEditerBlocScript, js/generation.js) vers le mode Récit, à la demande
// du propriétaire après avoir revu le rendu du mode Script : l'éditeur IA
// par passage (Reformuler/Raccourcir/Allonger/Simplifier) manquait côté
// Récit alors que la mécanique (segments indexés, currentStory.recit) est
// identique. Voir microEditerSegmentRecit, js/storytelling.js.
//
// Mêmes garanties verrouillées ici : un clic sur une action de micro-édition
// cible UN SEUL segment (le texte des autres n'apparaît pas dans le prompt),
// remplace uniquement le texte du segment concerné, et n'écrit AUCUNE
// génération dans l'historique (gratuit, hors quota). Un second test
// verrouille le plafond anti-abus (réutilise MICRO_EDIT_MAX_PAR_SCRIPT).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const RECIT_FAKE = {
  titre: 'Un titre', ton: 'sobre', modele_utilise: '',
  score: { viral: 90, narration: 90, engagement: 90, emotion: 90, retention: 90 },
  hooks: [{ style: 'x', texte: 'Hook 1' }],
  recit: [
    { segment: 'Hook', texte: 'Premier segment du récit, le hook.' },
    { segment: 'Ouverture', texte: 'Deuxième segment du récit, l\'ouverture.' }
  ],
  legende: 'Légende', hashtags: ['#a']
};

async function genererRecitEtOuvrirResultat(page) {
  const requetesGenerations = [];
  await poserMocksReseau(page, {
    generate: (body) => {
      if (body.max_tokens === 16000) return { content: [{ text: JSON.stringify(RECIT_FAKE) }] };
      // Micro-édition (max_tokens 300) ou autre passe du pipeline : réponse
      // par défaut minimale, les tests qui en ont besoin posent leur propre
      // gestionnaire "generate" pour cette partie précise.
      return { content: [{ text: '{}' }] };
    },
    data: (body, method) => {
      if (method === 'POST' && body && body.resource === 'generations') requetesGenerations.push(body);
      return undefined;
    }
  });
  await connecterAbonne(page, { code: 'RECITEDIT' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('storyInput').value = 'Un fait marquant à raconter';
    storyFormat = 'long'; storyDuree = ''; storyTon = '';
  });
  await page.evaluate(() => generateStory());
  await page.waitForTimeout(2500);
  return { requetesGenerations };
}

test('Récit, éditeur IA par passage : reformule UN SEUL segment, sans toucher aux autres, sans consommer de génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const { requetesGenerations } = await genererRecitEtOuvrirResultat(page);
    assert.equal(requetesGenerations.length, 1, 'la génération initiale du récit doit avoir écrit UNE fois dans l\'historique');

    const texteAvant = await page.evaluate(() => ({
      s0: document.getElementById('storySegText0')?.textContent,
      s1: document.getElementById('storySegText1')?.textContent
    }));
    assert.match(texteAvant.s1, /Deuxième segment/);

    let promptEdition = null;
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      promptEdition = body;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'Segment raccourci.' }] }) });
    });

    await page.evaluate(() => {
      // 2e bouton = "Raccourcir" (ordre : Reformuler, Raccourcir, Allonger, Simplifier)
      document.querySelectorAll('#storySegToolbar1 .script-edit-btn')[1].click();
    });
    await page.waitForTimeout(500);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(promptEdition, 'l\'appel IA de micro-édition doit avoir eu lieu');
    assert.equal(promptEdition.max_tokens, 300, 'la micro-édition doit utiliser un plafond de tokens réduit');
    const promptTexte = JSON.stringify(promptEdition.messages);
    assert.match(promptTexte, /Deuxième segment du récit, l'ouverture/, 'le prompt doit contenir le texte du segment ciblé');
    assert.ok(!promptTexte.includes('Premier segment du récit, le hook'), 'le prompt ne doit PAS contenir le texte des AUTRES segments : ' + promptTexte.slice(0, 300));
    assert.match(promptTexte, /Raccourcis nettement ce passage/, 'la consigne "raccourcir" doit être présente dans le prompt');

    const texteApres = await page.evaluate(() => ({
      s0: document.getElementById('storySegText0')?.textContent,
      s1: document.getElementById('storySegText1')?.textContent
    }));
    assert.equal(texteApres.s1, 'Segment raccourci.', 'le segment édité doit afficher le nouveau texte');
    assert.equal(texteApres.s0, texteAvant.s0, 'le segment NON édité doit rester strictement identique');

    // Le texte complet (copier/partager, entrée du storyboard) doit refléter
    // l'édition, sinon copyStory/shareStory renverraient l'ancien texte.
    const fulltextApres = await page.evaluate(() => document.getElementById('storyOutput').dataset.fulltext);
    assert.match(fulltextApres, /Segment raccourci\./, 'le texte complet reconstruit doit contenir le nouveau segment');

    assert.equal(requetesGenerations.length, 1, 'la micro-édition ne doit écrire AUCUNE nouvelle génération dans l\'historique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit, éditeur IA par passage : le plafond anti-abus est respecté', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    await genererRecitEtOuvrirResultat(page);

    let nbAppelsEdition = 0;
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 300) nbAppelsEdition++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'Texte ' + nbAppelsEdition + '.' }] }) });
    });

    // 21 clics sur "Reformuler" du segment 0 : le plafond (20, partagé avec
    // le mode Script) doit stopper les appels IA au 21e.
    for (let i = 0; i < 21; i++) {
      await page.evaluate(() => document.querySelectorAll('#storySegToolbar0 .script-edit-btn')[0].click());
      await page.waitForTimeout(120);
    }

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(nbAppelsEdition, 20, 'le 21e clic ne doit PAS déclencher un nouvel appel IA, le plafond doit l\'arrêter avant');
    const erreurAffichee = await page.evaluate(() => document.getElementById('storyEditError')?.textContent || '');
    assert.match(erreurAffichee, /limite de retouches/, 'un message clair doit expliquer pourquoi le 21e clic n\'a rien fait : ' + erreurAffichee);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

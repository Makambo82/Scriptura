// Retour terrain du 4 septembre 2026, remonté par le journal ajouté la veille.
// La carte "Échecs de génération" affichait enfin la vraie cause des scores non
// calculés :
//
//   "score non calculé : appel au juge impossible : (400) Your credit balance
//    is too low to access the Anthropic API. Please go to Plans & Billing to
//    upgrade or purchase cr | 2e tentative (autre modèle) : (400) Your credit
//    balance is too low..."
//
// Rien à voir avec un modèle bavard ou une surcharge : le solde de crédits du
// compte était épuisé. Cette ligne a révélé deux vrais défauts.
//
// 1. UN REFUS DÉFINITIF ÉTAIT RETENTÉ COMME UNE PANNE PASSAGÈRE. Un 400 de ce
//    type ne passera jamais, sur aucun modèle. Le code enchaînait pourtant
//    3 tentatives, puis 3 de plus sur l'autre modèle pour le juge du score :
//    6 allers-retours perdus, et autant d'attente imposée au créateur avant
//    d'annoncer un échec connu dès la première réponse.
//
// 2. LE MESSAGE DU FOURNISSEUR SERAIT REMONTÉ TEL QUEL AU CRÉATEUR. Une
//    génération complète qui échoue pour la même raison affiche son message
//    dans le formulaire : un abonné francophone aurait lu mot pour mot une
//    phrase anglaise parlant du solde de crédits et de la page de facturation
//    d'Anthropic. Le détail technique reste indispensable au journal, il ne
//    doit simplement jamais servir d'affichage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const REFUS_CREDIT = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

async function pagePrete(page, baseUrl, code) {
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: code + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(250);
}

test('un refus définitif du fournisseur n\'est pas retenté en boucle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await pagePrete(page, baseUrl, 'REFUS');

    let appels = 0;
    await page.route('**/api/generate', async (route) => {
      appels++;
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: REFUS_CREDIT } }) });
    });

    const res = await page.evaluate(async () => {
      try {
        await callAI(MODEL_RAPIDE, 1200, 'peu importe', undefined, undefined, undefined, undefined, undefined, undefined, 'script');
        return { jete: false };
      } catch (e) {
        return { jete: true, message: e.message, detail: e.detailTechnique, fatal: !!e.fatal };
      }
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(res.jete, 'l\'appel doit échouer');
    assert.equal(appels, 1,
      'REGRESSION : un solde épuisé ou un compte refusé ne passera sur AUCUN modèle, une seule tentative suffit (obtenu : ' + appels + ')');
    assert.equal(res.fatal, true, 'l\'erreur doit se signaler comme définitive, pour que les appelants n\'insistent pas non plus');
    assert.match(res.detail, /credit balance/, 'le détail technique brut reste attaché, le journal en a besoin');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le message du fournisseur ne s\'affiche jamais tel quel au créateur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await pagePrete(page, baseUrl, 'MSGINFRA');

    await page.route('**/api/generate', async (route) => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: REFUS_CREDIT } })
    }));

    const res = await page.evaluate(async () => {
      try {
        await callAI(MODEL_RAPIDE, 1200, 'peu importe', undefined, undefined, undefined, undefined, undefined, undefined, 'script');
        return null;
      } catch (e) { return { message: e.message, detail: e.detailTechnique }; }
    });

    assert.deepEqual(erreursJs, []);
    assert.ok(!/credit balance|Plans & Billing|Anthropic/i.test(res.message),
      'REGRESSION : un abonné francophone ne doit jamais lire un message de facturation en anglais : ' + res.message);
    assert.match(res.message, /Scriptura ne peut pas générer pour le moment/, 'il lit une phrase claire, en français');
    assert.match(res.detail, /credit balance/, 'et le détail brut reste disponible pour le journal du fondateur');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une panne ordinaire garde son message réel, elle n\'est pas noyée dans un message générique', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await pagePrete(page, baseUrl, 'MSGNORMAL');

    await page.route('**/api/generate', async (route) => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'panne simulée pour le test' } })
    }));

    const res = await page.evaluate(async () => {
      try {
        await callAI(MODEL_RAPIDE, 1200, 'peu importe', undefined, undefined, undefined, undefined, undefined, undefined, 'script');
        return null;
      } catch (e) { return { message: e.message }; }
    });

    assert.match(res.message, /panne simulée pour le test/,
      'seuls les messages d\'infrastructure sont neutralisés, les autres restent utiles au diagnostic');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le juge du score n\'insiste pas sur un refus définitif, et le journal garde la vraie cause', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
    const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };
    const SCRIPT_OK = {
      analyse: 'ok',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      script: [
        { temps: '0-3 sec', texte: 'Behanzin a refusé de disparaître.', visuel: 'A' },
        { temps: '3-30 sec', texte: 'Il règne sur le Dahomey en 1890. Il refuse de plier devant la France. Il brûle son propre trésor. Les archives partent en flammes. Les généraux proposent un accord. Behanzin refuse encore. Un roi qui négocie avec son envahisseur devient un pantin.', visuel: 'B' },
        { temps: '30-52 sec', texte: 'Il savait qu il perdrait la guerre. Il savait que les Français le savaient. Accepter l humiliation ou tout perdre. Il choisit de tout perdre. Perdre en restant libre, c est garder quelque chose.', visuel: 'C' },
        { temps: '52-60 sec', texte: 'On oublie toujours le vrai pouvoir au profit du faux.', visuel: 'D' }
      ],
      legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
    };

    let appelsJuge = 0;
    const journal = [];
    await poserMocksReseau(page);
    await page.route('**/api/data**', async (route) => {
      try {
        const b = JSON.parse(route.request().postData() || '{}');
        if (b && b.resource === 'erreur') journal.push({ mode: b.mode, detail: b.detail });
      } catch (e) { /* corps non JSON */ }
      return route.fallback();
    });
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const texteBody = JSON.stringify(body.messages || []);
      if (body.max_tokens === 1200 && /critique EXT/.test(texteBody)) {
        appelsJuge++;
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: REFUS_CREDIT } }) });
      }
      if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
      if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_OK) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'JUGEFATAL' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(250);
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
    await page.waitForTimeout(1200);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(appelsJuge, 1,
      'REGRESSION : sur un refus définitif, le juge ne doit être appelé qu\'UNE fois, ni réessai ni bascule de modèle (obtenu : ' + appelsJuge + ')');

    const entree = journal.find(e => e.mode === 'score-script');
    assert.ok(entree, 'l\'échec doit rester journalisé : ' + JSON.stringify(journal));
    assert.match(entree.detail, /credit balance/,
      'et le journal doit porter la cause TECHNIQUE exacte, pas le message neutralisé montré au créateur : ' + entree.detail);
    assert.ok(!/2e tentative/.test(entree.detail), 'aucune seconde tentative à journaliser puisqu\'elle n\'a pas lieu');

    // Le script, lui, reste livré et complet.
    const script = await page.evaluate(() => currentScript.map(b => b.texte));
    assert.equal(script.length, 4);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Même vérification que tests/progression-reelle-script.test.js, pour le
// mode Récit (js/storytelling.js) : ce mode pilotait déjà ses ÉTAPES
// TEXTUELLES sur les vraies phases serveur (avancerEtapeGen), mais pas
// encore le %, resté une pure estimation de temps (createProgress) et
// masqué (bande rayée indéterminée). Vérifie que GEN_POIDS.story +
// creerProgressionReelle (js/generation.js / js/storyboard.js) branchent
// désormais le % RÉEL sur ces mêmes jalons, avec une progression continue
// pendant l'écriture (flux).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const RECIT_FAKE = {
  titre: 'Un titre', ton: 'sobre', modele_utilise: '',
  score: { viral: 90, narration: 90, engagement: 90, emotion: 90, retention: 90 },
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  recit: [
    { segment: 'Hook', texte: 'Un hook percutant en deux phrases courtes.' },
    { segment: 'Ouverture', texte: "Aujourd'hui, on parle de quelque chose d'important." },
    { segment: 'Contexte', texte: 'Un peu de contexte ici pour poser les enjeux du récit.' },
    { segment: 'Immersion', texte: 'On plonge vraiment dans le sujet avec des détails concrets.' },
    { segment: 'Tension', texte: 'La tension monte progressivement jusqu\'à un sommet net.' },
    { segment: 'Clôture', texte: 'Alors, que retenir ? Que ceci ? Que cela ? Ou que tout ? Moi, je t\'ai pas raconté une histoire. Je t\'ai montré un miroir.' }
  ],
  legende: 'Légende', hashtags: ['#a']
};

test('Récit : le % de la barre principale est visible et progresse réellement (jalons + flux), jamais figé sur un minuteur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      // Léger délai avant chaque réponse, pour laisser le temps au relevé du
      // % ci-dessous d'observer plusieurs états réels distincts.
      await new Promise((r) => setTimeout(r, 150));
      if (body.max_tokens === 16000) {
        // Étape en flux réel (voir api/generate.js, mode stream) : content-type
        // text/plain, comme pour le mode Script (même mécanisme côté client,
        // js/api.js callAI).
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(RECIT_FAKE) });
      }
      // Toutes les autres passes (critique, hook/ouverture, anti-plagiat,
      // choix sémantique du modèle...) : réponse vide valide, suffisante
      // pour que chacune se termine sans problème détecté et sans erreur,
      // sans avoir à répliquer chaque prompt exact ici.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROGRECIT1', plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('storyInput').value = 'Un fait historique marquant à raconter';
      storyFormat = 'long'; // pas de contrôle de durée à mocker en plus
      storyDuree = '';
      storyTon = '';
    });

    await page.evaluateHandle(() => {
      const releves = [];
      const id = setInterval(() => {
        const el = document.getElementById('genProgressPct');
        if (el) releves.push(el.textContent);
      }, 60);
      window.__releves = releves;
      window.__arreterReleve = () => clearInterval(id);
      return true;
    });

    const genererPromise = page.evaluate(() => generateStory());
    await page.waitForTimeout(2500);
    await genererPromise;
    await page.evaluate(() => window.__arreterReleve());
    const suiviPct = await page.evaluate(() => window.__releves.map(t => parseInt(t, 10)));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const estDeterminee = await page.evaluate(() => {
      const fill = document.getElementById('genProgressFill');
      const bar = fill && fill.closest('.sb-progress-bar');
      return !!bar && bar.classList.contains('determinee');
    });
    assert.equal(estDeterminee, true, 'la barre principale doit afficher un % pour le mode Récit');

    assert.ok(suiviPct.length >= 2, 'plusieurs valeurs de % doivent avoir été relevées : ' + JSON.stringify(suiviPct));
    for (let i = 1; i < suiviPct.length; i++) {
      assert.ok(suiviPct[i] >= suiviPct[i - 1], 'le % ne doit jamais reculer : ' + JSON.stringify(suiviPct));
    }
    const valeursDistinctes = new Set(suiviPct);
    assert.ok(valeursDistinctes.size >= 3, 'le % doit vraiment progresser par étapes réelles : ' + JSON.stringify(suiviPct));

    const pctFinal = await page.evaluate(() => document.getElementById('genProgressPct').textContent);
    assert.equal(pctFinal, '100%', 'une fois le résultat affiché, le % doit être exactement 100%');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

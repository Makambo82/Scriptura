// Après avoir étudié le vrai mécanisme de génération d'idées de Vervox (PDF
// envoyé par le propriétaire), leur FAQ précise que l'IA combine "tendances
// de niche" + "profil déclaré" + "tes analyses éventuelles (audit de compte,
// benchmark, analyses concurrents)". Scriptura avait déjà les deux premières
// sources, mais ignorait totalement la troisième : le prompt du mode Idées
// promettait déjà des idées fondées sur les "leçons d'audit" (voir
// js/generation.js, étape 1 "OPPORTUNITÉS") sans qu'aucune donnée d'audit ne
// soit jamais réellement transmise à l'IA.
//
// Ce test verrouille : quand le créateur a déjà un audit complet et/ou un
// diagnostic sommaire DE SON compte enregistrés, generateIdeas() va les
// chercher (_signauxAnalysesPropresIdees) et injecte dans le prompt un bloc
// listant ses points faibles/forts déjà observés et ses leviers déjà
// identifiés, avec une consigne d'exploitation directe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Audit complet : Engagement volontairement TRÈS FAIBLE (3/20), le reste
// "correct" (ignoré par le seuillage, ni faible ni fort). Ancien format
// tiktok_score (pas de "mesures"), pour ne pas dépendre de calculerScores.
const AUDIT_FAKE = {
  tiktok_score: { engagement: 3, retention: 14, storytelling: 13, sujets: 12, regularite: 11 },
  axes_prioritaires: [
    { titre: 'Améliore ta régularité', pourquoi: 'Rythme irrégulier.', action: 'Publie 4x par semaine.' },
    { titre: "Renforce l'accroche", pourquoi: 'Hook trop mou.', action: 'Soigne les 3 premières secondes.' }
  ]
};

// Diagnostic sommaire DE SON compte : Viralité volontairement FORTE (9/10),
// le reste soit "correct" soit non disponible.
const SOMMAIRE_FAKE = {
  username: 'creatricetest',
  estMonCompte: true,
  diagnostic: {
    engagement: { score: 20, disponible: true },
    vues_moyennes: { score: 15, disponible: true },
    regularite: { score: null, disponible: false },
    croissance_abonnes: { score: null, disponible: false },
    viralite: { score: 9, disponible: true },
    leviers_prioritaires: [
      { titre: 'Sous-titre chaque vidéo', detail: 'Améliore la rétention silencieuse.' },
      { titre: 'Poster à heure fixe', detail: 'Stabilise la découverte algorithmique.' }
    ]
  }
};

const IDEES_FAKE = { idees: Array.from({ length: 10 }, (_, i) => ({
  titre: 'Idée test ' + (i + 1), angle: 'Angle test', pourquoi: 'Pourquoi test', hook: 'Hook test ' + (i + 1)
})) };

test('mode Idées : les signaux issus des propres analyses du créateur (audit + diagnostic sommaire) alimentent le prompt', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let promptRecu = null;

    await poserMocksReseau(page, {
      generate: (body) => {
        promptRecu = body?.messages?.[0]?.content;
        return { content: [{ text: JSON.stringify(IDEES_FAKE) }] };
      }
    });
    // Enregistré APRÈS poserMocksReseau (ordre d'exécution Playwright inversé) :
    // répond différemment selon le "mode" demandé par _derniereGenerationDe /
    // _recentesGenerationsDe (voir js/diagnostic-fusion.js), toutes deux des
    // lectures GET sur /api/data?resource=generations&action=last&mode=...
    await page.route('**/api/data?**', route => {
      const url = new URL(route.request().url());
      const mode = url.searchParams.get('mode');
      if (mode === 'audit') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { contenu: AUDIT_FAKE, cree_le: new Date().toISOString() } }) });
      }
      if (mode === 'diagnosticSommaire') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [{ contenu: SOMMAIRE_FAKE, cree_le: new Date().toISOString() }] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'IDEESSIGNAUX' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('ideasFlow').style.display = 'block';
      document.getElementById('ideaNiche').value = 'Cuisine & Food';
      document.getElementById('ideaTheme').value = 'des recettes rapides pour étudiants';
    });
    await page.evaluate(() => generateIdeas());
    await page.waitForTimeout(1500);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(typeof promptRecu === 'string' && promptRecu.length > 100, 'le prompt doit avoir été capturé : ' + JSON.stringify(promptRecu).slice(0, 200));

    assert.match(promptRecu, /SIGNAUX ISSUS DE TES PROPRES ANALYSES/, 'le bloc de signaux doit apparaître dans le prompt');
    assert.match(promptRecu, /Engagement \(très faible, audit complet\)/, 'le point faible de l\'audit complet doit être injecté tel quel');
    assert.match(promptRecu, /Viralité \(fort, diagnostic sommaire\)/, 'le point fort du diagnostic sommaire doit être injecté tel quel');
    assert.match(promptRecu, /Améliore ta régularité/, 'les leviers déjà identifiés par l\'audit doivent apparaître');
    assert.match(promptRecu, /Sous-titre chaque vidéo/, 'les leviers déjà identifiés par le diagnostic sommaire doivent apparaître');
    assert.match(promptRecu, /au moins 2 des 10 idées doivent répondre DIRECTEMENT à un point faible observé/i, 'la consigne d\'exploitation directe doit être présente');

    // Le rendu doit s'afficher normalement, aucune régression du flux.
    const nbCartes = await page.evaluate(() => document.querySelectorAll('#ideasList .idea-card').length);
    assert.equal(nbCartes, 10, 'les 10 idées doivent bien être rendues malgré les signaux ajoutés au prompt');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mode Idées : sans aucun audit ni diagnostic sommaire préalable, le bloc de signaux reste absent (aucune invention)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let promptRecu = null;

    await poserMocksReseau(page, {
      generate: (body) => {
        promptRecu = body?.messages?.[0]?.content;
        return { content: [{ text: JSON.stringify(IDEES_FAKE) }] };
      }
      // Pas de gestionnaire "data" dédié : réponse par défaut ({ok:true,data:[]}),
      // simule un créateur sans aucun audit ni diagnostic sommaire enregistré.
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'IDEESSANSSIGNAUX' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('ideasFlow').style.display = 'block';
      document.getElementById('ideaNiche').value = 'Cuisine & Food';
      document.getElementById('ideaTheme').value = 'des recettes rapides pour étudiants';
    });
    await page.evaluate(() => generateIdeas());
    await page.waitForTimeout(1500);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(typeof promptRecu === 'string' && promptRecu.length > 100, 'le prompt doit avoir été capturé');
    assert.ok(!/SIGNAUX ISSUS DE TES PROPRES ANALYSES/.test(promptRecu), 'sans audit ni diagnostic, aucun bloc de signaux ne doit apparaître (jamais inventer une analyse inexistante) : ' + promptRecu.slice(0, 300));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

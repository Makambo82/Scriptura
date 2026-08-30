// Refonte totale de l'analyse vidéo, demandée par le propriétaire : le
// système maison de portée/flop/viral/performance réelle (vues ÷ abonnés)
// n'était basé sur AUCUNE pratique du secteur, juste inventé en interne. Le
// propriétaire a demandé de s'aligner rigoureusement sur la méthode réelle
// de Vervox et BeViral : un score de RECETTE (contenu seul, jamais croisé
// avec les vraies stats), sur 5 dimensions pondérées 25/20/20/20/15 comme
// Vervox, mais avec le vocabulaire propre à Scriptura (pas une traduction
// de leurs intitulés).
//
// Ce test verrouille : le score ne s'appelle plus jamais "SCORE DE
// VIRALITÉ" ni "SCORE DE PERFORMANCE RÉELLE", aucune étiquette flop/viral
// ni verdict "Recette ou coup de chance" ne doit réapparaître, les vraies
// stats restent affichées mais comme un simple contexte informatif (jamais
// un jugement), et les libellés de section ("Pourquoi ça fonctionne",
// "Comment l'améliorer") sont désormais FIXES, jamais conditionnés par la
// performance réelle de la vidéo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const RAPPORT = {
  niche: 'test', sujet: 'sujet test',
  hook: { technique: 'test', verbatim: 'test', pourquoi: 'test' },
  recette: [{ temps: '0-8s', titre: 'test', detail: 'test' }],
  modele: [{ temps: '0-8s', gabarit: 'test' }],
  pourquoi_viral: ['point fort 1'],
  a_reprendre: [{ titre: 'levier 1', detail: 'detail 1' }],
  signaux: { hook_fort: true, boucle_ouverte: true, cliffhanger: false, deuxieme_personne: true, details_concrets: true, escalade: true, question_rhetorique: false, archetypes: true, appel_action: false, angle_original: true, sujet_precis: true, authenticite: true, hook_visuel: false }
};

// Deux scénarios volontairement opposés (vues énormes ET vues quasi nulles) :
// dans les deux cas, aucune trace de flop/viral/verdict ne doit apparaître,
// seul le score de recette (identique dans les deux cas, mêmes signaux) doit
// changer d'apparence.
for (const [nom, stats] of [
  ['vues massives (ex-scénario "viral")', { vues: 5000000, likes: 400000, commentaires: 20000, partages: 10000, abonnesAuteur: 10000 }],
  ['vues quasi nulles (ex-scénario "flop")', { vues: 120, likes: 2, commentaires: 0, partages: 0, abonnesAuteur: 500000 }]
]) {
  test('analyse virale : ' + nom + ' — aucune étiquette flop/viral/verdict, score de recette identique et neutre', async () => {
    const { baseUrl, arreter } = await demarrerServeur();
    const navigateur = await lancerNavigateur();
    try {
      const page = await navigateur.newPage();
      const erreursJs = [];
      page.on('pageerror', e => erreursJs.push(e.message));

      await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT) }] }) });
      await page.route('**/api/tiktok-video**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, transcript: 'Transcript de test assez long pour passer le seuil minimal requis.', description: '', stats, langue: 'fr', frame_hook: null })
      }));

      await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
      await connecterAbonne(page, { code: 'REFONTEVERVOX' + Math.round(Math.random() * 1e6), plan: 'creator' });
      await page.waitForTimeout(200);

      await page.evaluate(() => {
        if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
        const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
        if (flow) flow.style.display = 'block';
        document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
      });
      await page.evaluate(() => lancerAnalyseVirale());
      await page.waitForTimeout(1800);

      const texte = await page.evaluate(() => document.getElementById('viralAnaResults')?.textContent || '');

      assert.ok(/SCORE DE LA RECETTE/.test(texte), 'le score doit toujours s\'appeler "SCORE DE LA RECETTE" : ' + texte.slice(0, 200));
      assert.ok(!/SCORE DE VIRALITÉ|SCORE DE PERFORMANCE RÉELLE/.test(texte), 'aucun autre libellé de score ne doit exister');
      assert.ok(!/flop|floppé|a percé|Pourquoi ça n'a pas marché|Comment la transformer en virale|Recette ou coup de chance|coup de chance|portée bridée|Formule reproductible/i.test(texte),
        'aucune trace du système flop/viral/verdict retiré ne doit subsister : ' + texte.slice(0, 400));

      // Libellés de section toujours fixes, jamais conditionnés par la performance.
      assert.ok(/Pourquoi ça fonctionne/.test(texte), 'le libellé de section doit être fixe : ' + texte.slice(0, 400));
      assert.ok(/Comment l.améliorer/.test(texte), 'le libellé de section doit être fixe : ' + texte.slice(0, 400));

      // Les 5 dimensions, alignées sur la répartition Vervox (25/20/20/20/15),
      // avec le vocabulaire propre à Scriptura.
      for (const dim of ['Accroche', 'Sujet & angle', 'Structure & rythme', 'Sincérité', 'Connexion & CTA']) {
        assert.ok(texte.includes(dim), 'dimension attendue absente : ' + dim);
      }

      // Les vraies stats restent visibles, en simple contexte.
      assert.ok(/vues/.test(texte), 'les vues doivent rester affichées, en contexte : ' + texte.slice(0, 400));

      if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    } finally {
      await navigateur.close();
      await arreter();
    }
  });
}

test('analyse virale : le score de recette est calculé exactement selon les nouveaux poids (25/20/20/20/15)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT) }] }) });
    await page.route('**/api/tiktok-video**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, transcript: 'Transcript de test assez long pour passer le seuil minimal requis.', description: '', stats: null, langue: 'fr', frame_hook: null })
    }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'REFONTEVERVOXSCORE', plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
      if (flow) flow.style.display = 'block';
      document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
    });
    await page.evaluate(() => lancerAnalyseVirale());
    await page.waitForTimeout(1800);

    // Signaux du RAPPORT : Accroche [hook_fort:true, question_rhetorique:false,
    // hook_visuel:non mesurable (pas de frame)] -> 1/2 * 25 = 13 (arrondi).
    // Sujet & angle [angle_original:true, sujet_precis:true] -> 20/20.
    // Structure & rythme [boucle_ouverte:true, cliffhanger:false, escalade:true,
    // archetypes:true] -> 3/4 * 20 = 15.
    // Sincérité [details_concrets:true, authenticite:true] -> 20/20.
    // Connexion & CTA [deuxieme_personne:true, appel_action:false] -> 1/2 * 15 = 8 (arrondi).
    // Total attendu : 13 + 20 + 15 + 20 + 8 = 76.
    const scoreNum = await page.evaluate(() => parseInt(document.getElementById('viralScoreNum')?.textContent || 'NaN', 10));
    assert.equal(scoreNum, 76, 'score de recette attendu selon les nouveaux poids Vervox (25/20/20/20/15)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

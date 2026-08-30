// Retour du propriétaire sur une vraie analyse (compte MAKAMBO, 266 K
// abonnés) : une vidéo à seulement 296 vues affichait un "SCORE DE LA
// RECETTE" à 59/100, et il voulait que les vues comptent dans le score.
//
// Décision produit (le propriétaire a choisi "Deux scores séparés") : le
// score de recette reste 100% structure (il sert de seuil pour la mémoire
// partagée qui nourrit les générations de TOUS les abonnés, un script moyen
// boosté par l'algo ne doit jamais franchir ce seuil à la place d'une vraie
// bonne structure). Un second score, "SCORE DE PERFORMANCE RÉELLE",
// entièrement déterministe (portée + engagement, jamais l'IA), s'affiche à
// côté avec le même poids visuel. Voir scorePerformanceReelle (js/viral.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const RAPPORT = {
  niche: 'test', sujet: 'sujet test',
  hook: { technique: 'test', verbatim: 'test', pourquoi: 'test' },
  recette: [{ temps: '0-5s', titre: 'test', detail: 'test' }],
  modele: [{ temps: '0-5s', gabarit: 'test' }],
  pourquoi_viral: ['test'],
  a_reprendre: [{ titre: 'test', detail: 'test' }],
  signaux: { hook_fort: true, boucle_ouverte: false, cliffhanger: false, deuxieme_personne: true, details_concrets: true, escalade: false, question_rhetorique: false, archetypes: true, appel_action: false, angle_original: true, sujet_precis: true, hook_visuel: false }
};

test('analyse virale : le score de performance réelle (vues) est séparé du score de recette, jamais mélangé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT) }] }) });
    await page.route('**/api/tiktok-video**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, transcript: 'Transcript de test assez long pour passer le seuil minimal requis.',
        description: '',
        // Chiffres réels du propriétaire : 296 vues, 266 K abonnés, 12,5%
        // d'engagement (37 interactions / 296 vues).
        stats: { vues: 296, abonnesAuteur: 266000, likes: 30, commentaires: 5, partages: 2 },
        langue: 'fr', frame_hook: null
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PERFSCORETEST1', plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
      if (flow) flow.style.display = 'block';
      document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
    });
    await page.evaluate(() => lancerAnalyseVirale());
    // L'anneau du score s'anime sur ~1300ms (voir animerScoreViral) : il faut
    // attendre la fin de l'animation avant de lire le chiffre final affiché.
    await page.waitForTimeout(1800);

    const texte = await page.evaluate(() => document.body.textContent);

    // Le score de recette ne doit plus jamais s'appeler "SCORE DE VIRALITÉ"
    // (source de confusion : il ne mesure que la structure, jamais le
    // résultat), et un second score, distinct, doit être présent.
    assert.ok(/SCORE DE LA RECETTE/.test(texte), 'le score de structure doit s\'appeler "SCORE DE LA RECETTE" : ' + texte.slice(0, 200));
    assert.ok(!/SCORE DE VIRALITÉ/.test(texte), 'l\'ancien libellé "SCORE DE VIRALITÉ" ne doit plus jamais apparaître (confusion avec le vrai résultat)');
    assert.ok(/SCORE DE PERFORMANCE RÉELLE/.test(texte), 'un second score, séparé, doit mesurer la vraie performance : ' + texte.slice(0, 400));

    // Le score de performance doit refléter les vrais chiffres (portée quasi
    // nulle sur un si gros compte, malgré un bon engagement) : ni 0 ni 100,
    // une vraie note intermédiaire calculée, jamais devinée par l'IA.
    const scorePerfNum = await page.evaluate(() => parseInt(document.getElementById('viralPerfScoreNum')?.textContent || 'NaN', 10));
    assert.equal(scorePerfNum, 48, 'score de performance attendu : portée niveau 1/4 (18 pts/70) + engagement niveau 4/4 (30 pts/30) = 48');

    // Les chiffres réels doivent être visibles (vues, engagement, portée),
    // pas juste un score abstrait.
    assert.ok(/296/.test(texte) && /12,5/.test(texte), 'les vraies stats (296 vues, 12,5% d\'engagement) doivent être affichées : ' + texte.slice(0, 400));

    // Le verdict croisé existant ne doit pas avoir régressé : recette
    // perfectible + portée quasi nulle = "Peu à reprendre".
    assert.ok(/Peu à reprendre/.test(texte), 'le verdict croisé recette/performance doit rester correct : ' + texte.slice(0, 400));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('analyse virale : sans abonnés connus ni engagement tranché, les vraies stats restent visibles même sans anneau de performance', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT) }] }) });
    await page.route('**/api/tiktok-video**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, transcript: 'Transcript de test assez long pour passer le seuil minimal requis.',
        description: '',
        // Vues connues, mais ni abonnés ni engagement décisif (~4,5%,
        // "normal", ni exceptionnel ni faible) : verdictCroiseViral refuse
        // déjà de juger la portée dans ce cas, le score de performance doit
        // faire pareil (null), sans cacher les chiffres bruts connus.
        stats: { vues: 5000, likes: 200, commentaires: 20, partages: 5 },
        langue: 'fr', frame_hook: null
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PERFSCORETEST2', plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
      if (flow) flow.style.display = 'block';
      document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
    });
    await page.evaluate(() => lancerAnalyseVirale());
    await page.waitForTimeout(600);

    const texte = await page.evaluate(() => document.body.textContent);
    const scorePerfEl = await page.evaluate(() => document.getElementById('viralPerfScoreNum'));
    assert.equal(scorePerfEl, null, 'aucun anneau de performance ne doit être affiché quand le jugement n\'est pas fiable');
    assert.ok(/SCORE DE PERFORMANCE RÉELLE/.test(texte), 'la carte doit quand même exister pour montrer les chiffres bruts');
    assert.ok(/5\s*K|5000/.test(texte), 'les vues réelles doivent rester visibles même sans score calculable : ' + texte.slice(0, 400));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

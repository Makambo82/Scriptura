// Signalé par le propriétaire (capture d'écran) : une vidéo à plus d'1
// million de vues affichait la section "Pourquoi ça n'a pas marché", un
// contresens qui casse la crédibilité de Scriptura pour quiconque lit le
// rapport, même sans connaître le contexte du compte (abonnés, niche).
//
// Cause : posturePerf (js/viral.js) ne connaissait que la portée relative
// (vues ÷ abonnés) ou, à défaut d'abonnés connus, le taux d'engagement brut.
// Sans les abonnés de l'auteur, un engagement sous 3% suffisait à qualifier
// "flop", quel que soit le volume ABSOLU de vues, un taux d'engagement bas
// est pourtant normal, mécanique même, sur une portée aussi large (trafic
// froid). Corrigé : au-delà de SEUIL_VUES_JAMAIS_FLOP (500 000 vues), la
// posture ne peut plus jamais retomber à "flop", quel que soit l'engagement
// ou la portée relative.
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
  pourquoi_viral: ['test'],
  a_reprendre: [{ titre: 'test', detail: 'test' }],
  signaux: { hook_fort: true, boucle_ouverte: false, cliffhanger: false, deuxieme_personne: true, details_concrets: true, escalade: false, question_rhetorique: false, archetypes: true, appel_action: false, angle_original: true, sujet_precis: true, hook_visuel: false }
};

test('analyse virale : plus d\'1 million de vues ne peut jamais être qualifié de "flop", même avec un engagement bas et sans abonnés connus', async () => {
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
        // Plus d'1 million de vues, engagement bas (2%, normal sur un tel
        // volume), et surtout AUCUN abonnesAuteur connu (le scénario exact
        // du bug : rien pour calculer une vraie portée relative).
        stats: { vues: 1200000, likes: 20000, commentaires: 2000, partages: 2000 },
        langue: 'fr', frame_hook: null
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'JAMAISFLOPTEST1', plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
      if (flow) flow.style.display = 'block';
      document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
    });
    await page.evaluate(() => lancerAnalyseVirale());
    await page.waitForTimeout(1800);

    // Scopé au conteneur du rapport uniquement (pas document.body) : la page
    // d'accueil contient par ailleurs un exemple marketing statique qui peut
    // légitimement employer des mots comme "flop"/"floppé" dans son propre
    // texte, sans rapport avec CE rapport d'analyse.
    const texte = await page.evaluate(() => document.getElementById('viralAnaResults')?.textContent || '');

    assert.ok(!/Pourquoi ça n'a pas marché/.test(texte), 'une vidéo à plus d\'1M de vues ne doit JAMAIS afficher "Pourquoi ça n\'a pas marché" : ' + texte.slice(0, 300));
    assert.ok(!/floppé|a floppé/.test(texte), 'le mot "floppé" ne doit jamais qualifier une vidéo à plus d\'1M de vues : ' + texte.slice(0, 300));
    assert.ok(/1,2\s*M|1200000|1\.2\s*M/.test(texte), 'les vraies vues (1,2M) doivent rester visibles : ' + texte.slice(0, 300));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

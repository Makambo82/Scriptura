// Retour propriétaire : sur l'analyse d'un compte CONCURRENT (diagnostic
// sommaire), il ne doit pas y avoir de section "recommandation" (RECOMMANDATION
// IA, 6 idées de scripts, même mécanisme que partout ailleurs dans l'app) —
// à la place, "des choses intéressantes dans le compte que l'utilisateur peut
// implémenter sur son compte". Ce rôle est déjà tenu par "Tes leviers
// prioritaires" (Ce que tu peux reprendre et adapter) et "Sa faille, ton
// opportunité", tous deux issus directement du diagnostic, sans second appel
// IA. Voir js/diagnostic-sommaire.js (opportuniteHtml, afficherOpportuniteDiagSommaire).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const DIAG_CONCURRENT = {
  engagement: { disponible: true, score: 24, constat: 'Très bon engagement.' },
  portee: { disponible: true, score: 20, constat: 'Portée large.' },
  regularite: { disponible: true, score: 15, constat: 'Publications régulières.' },
  viralite: { disponible: true, score: 12, constat: 'Bonne viralité.' },
  abonnes: 320000,
  verdict_inspiration: { modele: 'oui', constat: 'Un vrai modèle, la recette est reproductible.' },
  faille_exploiter: 'Il ne couvre jamais les astuces de conservation, un angle libre à prendre.',
  niche: { disponible: true, etat: 'claire', nom: 'Cuisine rapide' },
  leviers_prioritaires: [
    { titre: 'Hook en moins de 2 secondes', detail: 'Reprends son ouverture ultra-directe.' },
    { titre: 'Sous-titres percutants', detail: 'Adapte son usage de mots-clés en gras à l\'écran.' },
    { titre: 'Rythme de coupe rapide', detail: 'Reprends son montage nerveux sur les 5 premières secondes.' },
    { titre: 'Bio orientée bénéfice', detail: 'Adapte sa formulation centrée résultat, pas activité.' },
    { titre: 'Publication quotidienne', detail: 'Reprends son rythme pour rester dans l\'algorithme.' }
  ]
};

const DIAG_MOI = Object.assign({}, DIAG_CONCURRENT, {
  verdict_inspiration: undefined,
  faille_exploiter: undefined,
  bio: { etat: 'claire', actuelle: 'Bio claire', critique: 'Bien.' }
});

async function ouvrirDiagnostic(page, { d, moi }) {
  await page.evaluate(({ d, moi }) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('diagSommaireFlow').style.display = 'block';
    afficherDiagnosticSommaireResultat(d, 'creatricecuisine', moi);
  }, { d, moi });
  await page.waitForTimeout(200);
}

test('Diagnostic sommaire : sur un CONCURRENT, aucune section "recommandation" (les leviers et la faille en tiennent déjà lieu)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**jspdf**', route => route.abort());
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSCONC1', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, { d: DIAG_CONCURRENT, moi: false });
    await page.waitForTimeout(400); // laisse le temps à un éventuel appel IA de fond de démarrer

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const results = document.getElementById('diagSommaireResults');
      return {
        opportuniteExiste: !!document.getElementById('diagSommaireOpportunites'),
        contientRecommandationIA: results.innerHTML.includes('RECOMMANDATION IA'),
        leviersPresents: results.innerHTML.includes('Ce que tu peux reprendre et adapter'),
        failleContenu: results.innerHTML.includes('Il ne couvre jamais les astuces de conservation'),
        verdictContenu: results.innerHTML.includes('Un vrai modèle, la recette est reproductible')
      };
    });

    assert.equal(etat.opportuniteExiste, false, 'sur un concurrent, la zone de recommandation ne doit même plus exister dans le DOM');
    assert.equal(etat.contientRecommandationIA, false, 'sur un concurrent, aucun libellé "RECOMMANDATION IA" ne doit apparaître');
    assert.equal(etat.leviersPresents, true, 'les leviers prioritaires ("choses à implémenter") doivent rester affichés');
    assert.equal(etat.failleContenu, true, 'la faille à exploiter doit rester affichée');
    assert.equal(etat.verdictContenu, true, 'le verdict d\'inspiration doit rester affiché');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Diagnostic sommaire : sur MON COMPTE, la section "recommandation" existe toujours (comportement inchangé)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**jspdf**', route => route.abort());
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSCONC2', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, { d: DIAG_MOI, moi: true });
    await page.waitForTimeout(200);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const opportuniteExiste = await page.evaluate(() => !!document.getElementById('diagSommaireOpportunites'));
    assert.equal(opportuniteExiste, true, 'sur mon propre compte, la zone de recommandation doit toujours exister');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Diagnostic sommaire : le prompt du diagnostic demande davantage de leviers ("choses intéressantes") pour un concurrent', async () => {
  const fs = require('fs');
  const contenu = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'diagnostic-sommaire.js'), 'utf8');
  assert.match(contenu, /5 à 8 choses intéressantes et concrètes/, 'le prompt doit demander plusieurs choses intéressantes concrètes, pas juste 3 leviers génériques');
});

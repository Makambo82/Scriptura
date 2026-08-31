// Retour propriétaire : prévoir les boutons Copier / Partager / Télécharger
// en bas du diagnostic sommaire, comme c'est déjà le cas de l'analyse
// détaillée (js/audit.js). Télécharger exporte tout le diagnostic en PDF,
// même mise en page que l'analyse détaillée (telechargerAuditPDF).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const DIAG_FAKE = {
  engagement: { disponible: true, score: 22, constat: 'Bon taux de likes rapporté aux vues.' },
  vues_moyennes: { disponible: true, score: 15, constat: 'Vues moyennes correctes mais irrégulières.' },
  regularite: { disponible: true, score: 12, constat: 'Publications espacées.' },
  croissance_abonnes: { disponible: true, score: 8, constat: 'Croissance modeste sur les 30 derniers jours.' },
  viralite: { disponible: true, score: 4, constat: 'Peu de pics viraux.' },
  abonnes: 45210,
  likesCumules: 812400,
  bio: {
    etat: 'floue',
    actuelle: 'Créateur de contenu | Passionné',
    critique: 'Ne dit pas ce que tu fais concrètement.',
    suggestions: ['Précise ta niche', 'Ajoute un appel à l\'action clair']
  },
  niche: {
    disponible: true,
    etat: 'claire',
    nom: 'Cuisine rapide du quotidien',
    analyse: ['Contenu cohérent sur la durée', 'Public bien ciblé']
  },
  top_videos: [
    { sujet: 'Pâtes en 5 minutes', vues: 850000, constat: 'Hook très efficace dès la 1re seconde.' },
    { sujet: 'Astuce riz parfait', vues: 620000, constat: 'Bonne rétention.' }
  ],
  flop_videos: [
    { sujet: 'Vlog du dimanche', vues: 4200, constat: 'Hors sujet par rapport à la niche.' }
  ],
  concepts_recurrents: ['Recette en 60 secondes', 'Astuce anti-gaspi'],
  leviers_prioritaires: [
    { titre: 'Régularité', detail: 'Publier au moins 4x par semaine pour stabiliser la portée.' }
  ],
  evolution: {
    constat: 'Changement de cap net il y a 3 mois.',
    pivot: true,
    avant: 'Vlogs génériques',
    apres: 'Recettes rapides ciblées',
    formule_gagnante: 'Recette + astuce en moins de 30 secondes'
  }
};

async function ouvrirDiagnostic(page, { moi = true } = {}) {
  await page.evaluate(({ d, moi }) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('diagSommaireFlow').style.display = 'block';
    afficherDiagnosticSommaireResultat(d, 'creatricecuisine', moi);
  }, { d: DIAG_FAKE, moi });
  await page.waitForTimeout(200);
}

// Fausse implémentation minimale de jsPDF (même surface que celle utilisée
// par telechargerDiagSommairePDF/telechargerAuditPDF), injectée AVANT le
// chargement de la page : le vrai script vient d'un CDN externe, injoignable
// depuis cet environnement de test. Enregistre les appels utiles pour
// vérifier que l'export PDF s'exécute jusqu'au bout sans exception.
const FAUX_JSPDF_INIT = `
window.__pdfAppels = [];
function FauxJsPDF(opts) {
  window.__pdfAppels.push(['new', opts]);
  this.internal = { getNumberOfPages: () => 1 };
}
FauxJsPDF.prototype.setFillColor = function(){};
FauxJsPDF.prototype.rect = function(){};
FauxJsPDF.prototype.roundedRect = function(){};
FauxJsPDF.prototype.setFont = function(){};
FauxJsPDF.prototype.setFontSize = function(){};
FauxJsPDF.prototype.setTextColor = function(){};
FauxJsPDF.prototype.setDrawColor = function(){};
FauxJsPDF.prototype.setLineWidth = function(){};
FauxJsPDF.prototype.line = function(){};
FauxJsPDF.prototype.addPage = function(){};
FauxJsPDF.prototype.setPage = function(){};
FauxJsPDF.prototype.getTextWidth = function(txt){ return String(txt).length * 2; };
FauxJsPDF.prototype.splitTextToSize = function(txt){ return [String(txt)]; };
FauxJsPDF.prototype.text = function(){};
FauxJsPDF.prototype.save = function(nom){ window.__pdfAppels.push(['save', nom]); };
window.jspdf = { jsPDF: FauxJsPDF };
`;

// Bloque le VRAI jsPDF (CDN jsdelivr, voir index.html) : injoignable dans le
// sandbox local (échoue vite, la fausse implémentation ci-dessus est alors
// la seule présente), mais bel et bien joignable en CI (GitHub Actions, vrai
// accès internet) — sans ce blocage, le vrai script y écrase la fausse
// implémentation avant que le test ne s'exécute, et les assertions sur
// window.__pdfAppels échouent alors qu'aucun bug réel n'est en cause.
async function bloquerCdnJsPDF(page) {
  await page.route('**jspdf**', route => route.abort());
}

test('Diagnostic sommaire : les boutons Copier, Partager et Télécharger apparaissent en bas du résultat', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await bloquerCdnJsPDF(page);
    await page.addInitScript(FAUX_JSPDF_INIT);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSACTIONS1', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, { moi: true });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const zone = document.querySelector('#diagSommaireResults .sb-actions-fin');
      if (!zone) return { zoneExiste: false };
      const boutons = Array.from(zone.querySelectorAll('button.icon-btn'));
      return {
        zoneExiste: true,
        nb: boutons.length,
        titres: boutons.map(b => b.title),
        aDesIcones: boutons.every(b => b.querySelector('svg'))
      };
    });

    assert.equal(etat.zoneExiste, true, 'la zone de boutons de fin de diagnostic doit exister');
    assert.equal(etat.nb, 3, 'il doit y avoir exactement 3 boutons (Copier, Partager, Télécharger)');
    assert.deepEqual(etat.titres, ['Copier le diagnostic', 'Partager le diagnostic', 'Télécharger en PDF']);
    assert.equal(etat.aDesIcones, true, 'chaque bouton doit avoir son icône');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Diagnostic sommaire : le bouton Copier copie un texte fidèle au diagnostic (score, dimensions, niche, leviers…)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await bloquerCdnJsPDF(page);
    await page.addInitScript(FAUX_JSPDF_INIT);
    // Presse-papier simulé (l'API réelle exige une permission/contexte
    // sécurisé peu fiable en headless) : on capture juste ce qui y est écrit.
    await page.addInitScript(() => {
      window.__presseAppels = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t) => { window.__presseAppels.push(t); return Promise.resolve(); } },
        configurable: true
      });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSACTIONS2', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, { moi: true });

    const boutonCopier = await page.$('#diagSommaireResults .sb-actions-fin button.icon-btn');
    await boutonCopier.click();
    await page.waitForTimeout(150);

    const resultat = await page.evaluate(() => ({
      appels: window.__presseAppels,
      libelleBouton: document.querySelector('#diagSommaireResults .sb-actions-fin button.icon-btn').textContent.trim()
    }));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.equal(resultat.appels.length, 1, 'le presse-papier doit être appelé exactement une fois');
    const texte = resultat.appels[0];
    assert.match(texte, /DIAGNOSTIC SOMMAIRE/, 'le texte copié doit identifier le type de diagnostic');
    assert.match(texte, /Score\s*:\s*\d+\/100/, 'le texte copié doit contenir le score global');
    assert.match(texte, /Engagement/, 'le texte copié doit lister les dimensions');
    assert.match(texte, /Cuisine rapide du quotidien/, 'le texte copié doit contenir la niche détectée');
    assert.match(texte, /Régularité/, 'le texte copié doit contenir les leviers prioritaires');
    assert.equal(resultat.libelleBouton, '✓ Copié !', 'le bouton doit confirmer visuellement la copie');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Diagnostic sommaire : le bouton Télécharger exporte tout le diagnostic en PDF (même mécanisme que l\'analyse détaillée)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await bloquerCdnJsPDF(page);
    await page.addInitScript(FAUX_JSPDF_INIT);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSACTIONS3', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, { moi: true });

    const boutons = await page.$$('#diagSommaireResults .sb-actions-fin button.icon-btn');
    await boutons[2].click(); // Télécharger
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const appels = await page.evaluate(() => window.__pdfAppels);
    const appelCreation = appels.find(a => a[0] === 'new');
    const appelSauvegarde = appels.find(a => a[0] === 'save');

    assert.ok(appelCreation, 'un document PDF doit être créé (new jsPDF)');
    assert.ok(appelSauvegarde, 'le PDF doit être sauvegardé (doc.save)');
    assert.match(appelSauvegarde[1], /^Diagnostic-Sommaire-Scriptura-\d{4}-\d{2}-\d{2}\.pdf$/, 'le nom de fichier doit identifier clairement le diagnostic sommaire, daté : ' + appelSauvegarde[1]);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Diagnostic sommaire : sur un concurrent, le texte copié et le PDF distinguent bien "son" diagnostic du mien', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await bloquerCdnJsPDF(page);
    await page.addInitScript(FAUX_JSPDF_INIT);
    await page.addInitScript(() => {
      window.__presseAppels = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t) => { window.__presseAppels.push(t); return Promise.resolve(); } },
        configurable: true
      });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSACTIONS4', plan: 'pro' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, { moi: false });

    const boutonCopier = await page.$('#diagSommaireResults .sb-actions-fin button.icon-btn');
    await boutonCopier.click();
    await page.waitForTimeout(150);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const texte = await page.evaluate(() => window.__presseAppels[0]);
    assert.match(texte, /ANALYSE CONCURRENT/, 'sur un concurrent, l\'en-tête du texte copié doit le préciser, pas "DIAGNOSTIC SOMMAIRE" générique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

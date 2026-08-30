// Retour du propriétaire (captures comparées) : dans le diagnostic sommaire,
// chaque dimension (Engagement, Portée...) est accompagnée d'un paragraphe
// expliquant le score. Dans l'audit détaillé, les mêmes cartes de dimension
// (Engagement, Rétention, Accroche & rythme, Choix des sujets, Régularité)
// n'affichaient qu'un badge nu, sans un mot d'explication, alors que c'est
// censé être LE rapport détaillé. Ces constats sont désormais rédigés
// directement à partir des mêmes mesures brutes qui servent au calcul du
// score (voir constatDimension, js/audit.js), jamais par l'IA : ils ne
// peuvent donc jamais contredire la note affichée juste à côté.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const AUDIT_AVEC_MESURES = {
  mesures: {
    engagement: { vues: 150100, likes: 6200, commentaires: 410, partages: 890 },
    retention_meilleure: { taux_moyen_pct: 42, completion_pct: 18 },
    retention_pire: { taux_moyen_pct: 22, completion_pct: 6 },
    storytelling: { hook_present: 'OUI', faible_chute_debut: 'PARTIEL', retention_stable: 'NON', bonne_fin: 'NON' },
    sujets: { themes_repetes: 'OUI', coherence_editoriale: 'OUI', adequation_objectif: 'PARTIEL', performances_homogenes: 'NON' },
    regularite: { nb_videos_periode: 16, periode_jours: 56, plus_long_trou_jours: 9 }
  },
  captures_reconnues: [],
  piliers: {},
  axes_prioritaires: []
};

// Audit enregistré avant l'introduction du moteur de scoring (voir
// commentaire dans renderAudit, js/audit.js) : seul l'ancien champ
// tiktok_score existe, pas de mesures brutes. Le constat doit rester absent
// sans planter, jamais afficher un paragraphe inventé sans donnée réelle.
const AUDIT_SANS_MESURES = {
  tiktok_score: { engagement: 12, retention: 10, storytelling: 8, sujets: 15, regularite: 11, global: 56 },
  piliers: {},
  axes_prioritaires: []
};

async function ouvrirAudit(page, fixture) {
  await page.evaluate((audit) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    const ecran = document.getElementById('auditFlow');
    if (ecran) ecran.style.display = 'block';
    renderAudit(audit);
  }, fixture);
  await page.waitForTimeout(200);
}

test('audit détaillé : chaque dimension du score affiche un constat, comme le diagnostic sommaire', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FIFA', plan: 'creator' });
    await page.waitForTimeout(300);

    await ouvrirAudit(page, AUDIT_AVEC_MESURES);

    // Ciblé sur #auditOutput : la page d'accueil affiche aussi ses propres
    // .ds-dim-card d'exemple (voir index.html, section "Exemple concret"),
    // un querySelectorAll global sur tout le document compterait les deux.
    const cartes = await page.evaluate(() => Array.from(document.querySelectorAll('#auditOutput .ds-dim-card')).map(c => ({
      nom: c.querySelector('.ds-dim-name')?.textContent || '',
      texte: c.querySelector('.ds-dim-text')?.textContent || ''
    })));

    assert.equal(cartes.length, 5, 'les 5 dimensions doivent être rendues');
    cartes.forEach(c => {
      assert.ok(c.texte && c.texte.length > 10, 'la dimension "' + c.nom + '" doit avoir un constat non vide : ' + JSON.stringify(c));
    });

    const engagement = cartes.find(c => c.nom.includes('Engagement'));
    assert.ok(engagement.texte.includes('%'), 'le constat Engagement doit citer un pourcentage : ' + engagement.texte);
    const accroche = cartes.find(c => c.nom.includes('Accroche'));
    assert.ok(/fort|travailler/i.test(accroche.texte), 'le constat Accroche & rythme doit relever un point fort ou à travailler : ' + accroche.texte);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('audit détaillé sans mesures brutes (ancien format) : pas de constat, pas de plantage', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FIFA', plan: 'creator' });
    await page.waitForTimeout(300);

    await ouvrirAudit(page, AUDIT_SANS_MESURES);

    // Ciblé sur #auditOutput, même raison que le test précédent : la page
    // d'accueil a aussi ses propres .ds-dim-card d'exemple.
    const cartes = await page.evaluate(() => Array.from(document.querySelectorAll('#auditOutput .ds-dim-card')).map(c => ({
      nom: c.querySelector('.ds-dim-name')?.textContent || '',
      texte: c.querySelector('.ds-dim-text')
    })));
    assert.equal(cartes.length, 5, 'les 5 dimensions doivent quand même être rendues (scores de tiktok_score)');
    cartes.forEach(c => assert.equal(c.texte, null, 'sans mesures brutes, aucun constat inventé pour "' + c.nom + '"'));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

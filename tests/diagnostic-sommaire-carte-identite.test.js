// Retour du propriétaire (raisons commerciales et d'attractivité, capture
// d'un outil concurrent) : le diagnostic sommaire (mon compte ET concurrent)
// doit ouvrir sur une carte "source" (vraie photo de profil, pseudo, @handle,
// abonnés, j'aime cumulés), même style que la transcription/le téléchargement
// TikTok (.outils-source-*, voir js/tiktok-outils.js). En dessous, la carte
// de score ne garde plus que l'anneau, le pourcentage et la santé du compte,
// l'identité du compte n'y vit plus.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// 1x1 PNG transparent, pour simuler une vraie photo de profil sans dépendre
// du réseau (bac à sable sans accès Internet, voir CLAUDE.md).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// Vidéos minimales, juste assez pour que le diagnostic se calcule sans planter.
const MAINTENANT = Math.floor(Date.now() / 1000);
const MEDIAS = Array.from({ length: 5 }, (_, i) => ({
  vues: 1000 + i * 100, likes: 50, commentaires: 5, partages: 2,
  date: MAINTENANT - i * 5 * 86400, desc: 'vidéo de test ' + i
}));

// Forme réelle confirmée côté serveur (voir extraireIds, api/username-scan.js) :
// profil.userInfo.user = { uniqueId, nickname, avatarLarger, ... }, stats
// (followerCount/heartCount) à une profondeur voisine mais pas forcément le
// même sous-objet.
const PROFIL_AVEC_IDENTITE = {
  userInfo: {
    user: { uniqueId: 'makambo82', nickname: 'Makambo', avatarLarger: { urlList: ['https://cdn-test.example/avatar-makambo.jpg'] } },
    stats: { followerCount: 264484, heartCount: 4200000 }
  }
};

const RAPPORT_IA = {
  profil_trouve: true, compte_verifie: null,
  engagement: { score: null, disponible: true, constat: 'placeholder' },
  vues_moyennes: { score: null, disponible: true, constat: 'placeholder' },
  regularite: { score: null, disponible: true, constat: 'placeholder' },
  croissance_abonnes: { score: null, disponible: false, constat: 'pas d\'historique' },
  viralite: { score: null, disponible: true, constat: 'placeholder' },
  sante_compte: 'Bonne',
  bio: { actuelle: 'Créatrice de contenu test', etat: 'claire', critique: 'Bio correcte.', suggestions: [] },
  niche: { disponible: true, nom: 'Niche test', etat: 'claire', analyse: [] },
  top_videos: [], flop_videos: [], concepts_recurrents: [],
  evolution: { pivot: false, constat: null, avant: null, apres: null, formule_gagnante: null },
  leviers_prioritaires: []
};

async function ouvrirDiagnostic(page, username) {
  await page.evaluate((u) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('diagSommaireFlow').style.display = 'block';
    document.getElementById('diagSommaireInput').value = u;
  }, username);
  await page.evaluate(() => lancerDiagnosticSommaire());
  await page.waitForTimeout(1800);
}

test('Diagnostic sommaire : carte source en tête (vraie photo, pseudo, @handle, abonnés, j\'aime), score épuré en dessous', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT_IA) }] }) });
    await page.route('**/api/username-scan', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ profil: PROFIL_AVEC_IDENTITE, medias: MEDIAS })
    }));
    await page.route('https://cdn-test.example/avatar-makambo.jpg', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSIDENTITE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, 'makambo82');
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    await page.waitForSelector('#diagSommaireResults .outils-source-card', { timeout: 5000 });
    const carte = await page.evaluate(() => {
      const c = document.querySelector('#diagSommaireResults .outils-source-card');
      const img = c?.querySelector('.outils-source-avatar-img');
      const stats = Array.from(c?.querySelectorAll('.ds-stats-row .ds-stat-num') || []).map(e => e.textContent);
      return c ? {
        nom: c.querySelector('.outils-source-nom')?.textContent,
        handle: c.querySelector('.outils-source-handle')?.textContent,
        avatarSrc: img?.getAttribute('src'),
        avatarCharge: img ? img.complete && img.naturalWidth > 0 : false,
        stats,
        // La carte source doit être le TOUT PREMIER élément du résultat
        // (retour du propriétaire : "ajouter en haut une carte").
        estPremiere: document.getElementById('diagSommaireResults')?.firstElementChild === c
      } : null;
    });
    assert.ok(carte, 'la carte source doit apparaître en tête du diagnostic');
    assert.match(carte.nom, /Makambo/);
    assert.match(carte.handle, /@makambo82/);
    assert.equal(carte.avatarSrc, 'https://cdn-test.example/avatar-makambo.jpg');
    assert.equal(carte.avatarCharge, true, 'la vraie photo de profil doit se charger (pas une image cassée)');
    assert.ok(carte.stats.some(s => /264.484|264 484/.test(s)), 'les abonnés doivent apparaître dans la carte source : ' + carte.stats.join(','));
    assert.ok(carte.stats.some(s => /4.200.000|4 200 000/.test(s)), 'les j\'aime cumulés doivent apparaître dans la carte source : ' + carte.stats.join(','));
    assert.equal(carte.estPremiere, true, 'la carte source doit être en tête du résultat, avant la carte de score');

    // La carte de score, elle, ne garde plus que l'anneau/pourcentage/santé :
    // ni abonnés ni j'aime cumulés ne doivent s'y trouver en double.
    const carteScore = await page.evaluate(() => {
      const el = document.querySelector('#diagSommaireResults .ds-score-card');
      return el ? el.textContent : '';
    });
    assert.doesNotMatch(carteScore, /264.484|264 484/, 'les abonnés ne doivent plus apparaître dans la carte de score : ' + carteScore);
    assert.doesNotMatch(carteScore, /Abonnés/, 'le libellé "Abonnés" ne doit plus apparaître dans la carte de score : ' + carteScore);
    assert.match(carteScore, /Santé du compte/, 'la santé du compte doit rester dans la carte de score');
  } finally { await navigateur.close(); await arreter(); }
});

test('Diagnostic sommaire : carte source SANS uniqueId/nickname/avatar (profil minimal) ne plante jamais, replie sur @nom saisi', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT_IA) }] }) });
    await page.route('**/api/username-scan', route => route.fulfill({
      status: 200, contentType: 'application/json',
      // Profil plat, sans userInfo.user (ancien format ou source différente) :
      // seuls les abonnés/j'aime sont mesurables, jamais l'identité.
      body: JSON.stringify({ profil: { followerCount: 8000, heartCount: 50000 }, medias: MEDIAS })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSIDENTITEMIN' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    await ouvrirDiagnostic(page, 'compte.minimal');
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const carte = await page.evaluate(() => {
      const c = document.querySelector('#diagSommaireResults .outils-source-card');
      return c ? { nom: c.querySelector('.outils-source-nom')?.textContent } : null;
    });
    assert.ok(carte, 'la carte doit tout de même apparaître (repli sur le @nom saisi)');
    assert.match(carte.nom, /@compte\.minimal/);
  } finally { await navigateur.close(); await arreter(); }
});

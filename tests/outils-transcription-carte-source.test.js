// Retour du propriétaire (référence visuelle d'un outil concurrent) : le
// résultat d'une transcription TikTok doit montrer la SOURCE (auteur, date,
// description, stats de la vidéo), pas juste le texte brut. Vérifie que la
// nouvelle carte source + la ligne de contrôles (langue, nombre de mots,
// export .txt, copier) s'affichent avec les vraies données renvoyées par
// /api/tiktok-video (voir extraireAuteurInfo/extraireCreateTime,
// api/_lib/tiktok-media.js), sans jamais planter si certains champs manquent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const REPONSE_COMPLETE = {
  ok: true,
  transcript: 'Ceci est une phrase de test. En voici une deuxième. Et une troisième pour faire bonne mesure.',
  description: 'Une description de vidéo TikTok pour le test.',
  stats: { vues: 736200, likes: 31200, commentaires: 129, partages: 2379 },
  auteur: { uniqueId: 'yamo.la.cuisine', nickname: 'Yamo La Cuisine' },
  createTime: 1785650330,
  langue: 'fr'
};

async function ouvrirEtTranscrire(page, reponse) {
  await page.route('**/api/tiktok-video?action=transcription', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reponse) }));
  await page.evaluate(() => { if (typeof ouvrirOutilsTikTok === 'function') ouvrirOutilsTikTok(); });
  await page.waitForTimeout(150);
  await page.fill('#outilsLien', 'https://www.tiktok.com/@yamo.la.cuisine/video/7669309697672908064');
  await page.click('#outilsTranscriptionBtn');
  await page.waitForSelector('#outilsResults', { state: 'visible', timeout: 10000 });
  const extrait = String(reponse.transcript || '').slice(0, 15);
  await page.waitForFunction((e) => (document.getElementById('outilsResults').textContent || '').includes(e), extrait, { timeout: 10000 });
}

test('Transcription TikTok : la carte source affiche auteur, date, description et stats de la vraie vidéo', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-TEST', plan: 'pro' });
    await ouvrirEtTranscrire(page, REPONSE_COMPLETE);

    const texte = await page.evaluate(() => document.getElementById('outilsResults').textContent);
    assert.match(texte, /Yamo La Cuisine/);
    assert.match(texte, /@yamo\.la\.cuisine/);
    assert.match(texte, /736.200|736 200/); // vues formatées
    assert.match(texte, /31.200|31 200/); // likes formatés
    assert.match(texte, /Français/);
    assert.match(texte, /17 mots extraits/); // compte réel du transcript de test, pas un chiffre inventé
    assert.match(texte, /\.txt/);
    assert.match(texte, /Copier/);
    assert.match(texte, /Une description de vidéo TikTok pour le test/);
    assert.match(texte, /phrase de test/);

    // La date (1785650330 -> 1 avril 2026) doit être formatée, pas le nombre brut.
    assert.doesNotMatch(texte, /1785650330/);

    assert.deepEqual(erreursJs, []);
  } finally { await navigateur.close(); await arreter(); }
});

test('Transcription TikTok : aucun plantage si auteur/stats/date manquent (repli propre)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-TEST2', plan: 'pro' });
    await ouvrirEtTranscrire(page, {
      ok: true, transcript: 'Texte minimal sans aucune métadonnée.',
      description: null, stats: null, auteur: null, createTime: null, langue: null
    });

    const texte = await page.evaluate(() => document.getElementById('outilsResults').textContent);
    assert.match(texte, /Texte minimal sans aucune métadonnée/);
    assert.match(texte, /mot(s)? extrait/);
    assert.deepEqual(erreursJs, []);
  } finally { await navigateur.close(); await arreter(); }
});

test('Téléchargement TikTok : même carte source (auteur, date, stats) que la transcription, retour du propriétaire', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    // Métadonnées passées par en-tête (X-Scriptura-Meta, base64), le corps
    // reste le flux vidéo brut (voir handleDownload, api/tiktok-video.js).
    const meta = {
      description: 'Une vidéo de cuisine à télécharger.',
      stats: { vues: 120000, likes: 8000, commentaires: 42, partages: 15 },
      auteur: { uniqueId: 'makambo82', nickname: 'Makambo' },
      createTime: 1785650330
    };
    const metaBase64 = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
    await page.route('**/api/tiktok-video?action=download**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'video/mp4', 'X-Scriptura-Meta': metaBase64 },
        body: Buffer.from('faux-contenu-video-pour-le-test')
      }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-DL-TEST', plan: 'pro' });
    await page.evaluate(() => { if (typeof ouvrirOutilsTikTok === 'function') ouvrirOutilsTikTok(); });
    await page.waitForTimeout(150);
    await page.fill('#outilsLien', 'https://www.tiktok.com/@makambo82/video/7669309697672908064');
    await page.click('#outilsTelechargementBtn');
    await page.waitForSelector('#outilsResults', { state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => (document.getElementById('outilsResults').textContent || '').includes('Makambo'), null, { timeout: 10000 });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const carte = await page.evaluate(() => {
      const c = document.querySelector('#outilsResults .outils-source-card');
      return c ? {
        avatar: c.querySelector('.outils-source-avatar')?.textContent,
        nom: c.querySelector('.outils-source-nom')?.textContent,
        handle: c.querySelector('.outils-source-handle')?.textContent,
        desc: c.querySelector('.outils-source-desc')?.textContent
      } : null;
    });
    assert.ok(carte, 'la carte source doit apparaître aussi pour le téléchargement, même style que la transcription');
    assert.equal(carte.avatar, 'M');
    assert.match(carte.nom, /Makambo/);
    assert.match(carte.handle, /@makambo82/);
    assert.match(carte.desc, /vidéo de cuisine/);

    // Le bouton de téléchargement doit toujours être là, la carte source
    // vient s'ajouter, pas remplacer le flux existant.
    const boutonPresent = await page.evaluate(() => !!document.getElementById('outilsDlBtn'));
    assert.equal(boutonPresent, true);
  } finally { await navigateur.close(); await arreter(); }
});

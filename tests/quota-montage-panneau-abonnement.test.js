// Retour propriétaire (capture d'écran du panneau "Ton accès Scriptura") :
// le quota d'images de montage doit apparaître dans ce panneau, comme les
// autres compteurs (Générations, Diagnostic sommaire...), pour Creator ET
// Pro. Ce test couvre le vrai rendu client (js/abonnement.js,
// ouvrirInfosAbonne), pas seulement l'endpoint serveur (voir
// quota-montage-affichage.test.js pour ça).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Panneau "Ton accès Scriptura" : la ligne "Montage vidéo (images)" affiche le vrai décompte pour un abonné Pro', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {
      data: () => ({ ok: true, concerne: true, used: 5, plafond: 60, count: 0 })
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'QUOTAMONTAGE-PRO', plan: 'pro' });
    await page.waitForTimeout(150);

    await page.evaluate(() => ouvrirInfosAbonne());
    await page.waitForTimeout(200);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const texte = await page.evaluate(() => document.getElementById('infosAbonneCorps').textContent);
    assert.match(texte, /Montage vidéo \(images\)/, 'la ligne doit être présente : ' + texte);
    assert.match(texte, /5\s*\/\s*60/, 'le décompte réel (5/60), pas un 0/60 par défaut : ' + texte);
    assert.match(texte, /55\s*restantes/, 'le reste (60-5=55) doit être calculé correctement : ' + texte);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Panneau "Ton accès Scriptura" : rien n\'est affiché pour la ligne montage si le serveur dit "non concerné" (dégradation silencieuse)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {
      data: () => ({ ok: true, concerne: false, count: 0 })
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'QUOTAMONTAGE-CREATOR', plan: 'creator' });
    await page.waitForTimeout(150);

    await page.evaluate(() => ouvrirInfosAbonne());
    await page.waitForTimeout(200);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const texte = await page.evaluate(() => document.getElementById('infosAbonneCorps').textContent);
    assert.doesNotMatch(texte, /Montage vidéo/, 'aucune ligne montage ne doit apparaître quand le serveur dit "non concerné" : ' + texte);
    assert.match(texte, /Générations/, 'le reste du panneau doit rester intact malgré une réponse dégradée : ' + texte);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

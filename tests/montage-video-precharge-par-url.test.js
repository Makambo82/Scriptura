// Audit : montageVideoFichierPromise était une seule variable globale
// partagée entre le flux montage depuis storyboard (js/montage.js) et le
// flux montage manuel (js/montage-manuel.js). Rendre une vidéo dans un flux
// écrasait la vidéo préchargée de l'autre : cliquer "Télécharger" pouvait
// alors partager/télécharger la MAUVAISE vidéo. Le correctif remplace la
// variable par une Map indexée par URL (montageVideoFichierPromiseParUrl).
// Ce test vérifie que deux vidéos préchargées coexistent sans s'écraser, et
// que partagerVideoMontage() récupère bien le fichier correspondant à
// l'URL demandée, quel que soit l'ordre de préchargement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('Montage : deux vidéos préchargées (storyboard + manuel) ne s\'écrasent pas, chaque flux récupère sa propre vidéo', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=download*', route => {
      const u = new URL(route.request().url());
      const cible = decodeURIComponent(u.searchParams.get('url') || '');
      const contenu = cible.includes('video-a') ? 'contenu-video-a' : 'contenu-video-b';
      route.fulfill({ status: 200, contentType: 'video/mp4', body: contenu });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    // Simule le préchargement des deux flux, dans l'ordre où ils
    // arriveraient si l'utilisateur montait d'abord depuis le storyboard
    // (video-a) puis relançait un montage manuel (video-b) sans jamais
    // recharger la page.
    const contenus = await page.evaluate(async () => {
      const urlA = 'https://x.example/montages/rendus/video-a.mp4';
      const urlB = 'https://x.example/montages/rendus/video-b.mp4';
      montageVideoFichierPromiseParUrl.set(urlA, prechargerVideoMontage(urlA));
      montageVideoFichierPromiseParUrl.set(urlB, prechargerVideoMontage(urlB));
      const fichierA = await montageVideoFichierPromiseParUrl.get(urlA);
      const fichierB = await montageVideoFichierPromiseParUrl.get(urlB);
      return { a: await fichierA.text(), b: await fichierB.text() };
    });

    assert.equal(contenus.a, 'contenu-video-a', 'la vidéo A préchargée doit garder son propre contenu');
    assert.equal(contenus.b, 'contenu-video-b', 'la vidéo B préchargée ne doit pas écraser celle de A');

    // partagerVideoMontage(url) doit récupérer le fichier qui correspond à
    // l'URL demandée, pas le dernier préchargement en date.
    const partages = await page.evaluate(async () => {
      const urlA = 'https://x.example/montages/rendus/video-a.mp4';
      const urlB = 'https://x.example/montages/rendus/video-b.mp4';
      const captures = [];
      navigator.canShare = () => true;
      navigator.share = async ({ files }) => { captures.push(await files[0].text()); };
      await partagerVideoMontage(null, urlB);
      await partagerVideoMontage(null, urlA);
      return captures;
    });

    assert.deepEqual(partages, ['contenu-video-b', 'contenu-video-a'],
      'chaque appel à partagerVideoMontage doit partager le fichier de SA propre URL, jamais celui de l\'autre flux');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

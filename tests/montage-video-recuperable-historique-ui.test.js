// Smoke test du FLUX RÉEL (retour propriétaire, 27/09) : une vidéo montée
// jamais téléchargée doit apparaître dans « Mes générations », avec un bouton
// qui déclenche vraiment le téléchargement/partage ET la confirmation
// serveur (voir js/historique.js, api/data.js resource=montages-video).
// Les tests unitaires (tests/montage-video-recuperable-historique.test.js)
// couvrent déjà la logique serveur en détail ; celui-ci vérifie que ça
// s'affiche et se déclenche vraiment dans un navigateur, pas seulement « ça
// compile ».
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'CELINE7F2A';
const URL_VIDEO = 'https://exemple.supabase.co/storage/v1/object/sign/montages/rendus/demo.mp4?token=abc';

test('une vidéo montée jamais téléchargée apparaît dans Mes générations, et le bouton déclenche bien le téléchargement + la confirmation serveur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    const appelsConfirmation = [];
    const appelsListe = [];
    await poserMocksReseau(page);
    // resource=montages-video arrive en GET, ses paramètres vivent dans la
    // query string (jamais dans le corps) : poserMocksReseau ne les expose
    // pas à `gestionnaires.data` (voir tests/helpers/mocks.js), donc route
    // dédiée ici, enregistrée APRÈS pour être essayée en premier.
    await page.route('**/api/data?**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('resource') !== 'montages-video') return route.fallback();
      appelsListe.push(1);
      // Une seule fois la vidéo : simule qu'elle a été retirée côté serveur
      // après le téléchargement (voir confirmerTelechargementVideo).
      const donnees = appelsConfirmation.length ? [] : [{ id: 1, url: URL_VIDEO, format: '9:16', cree_le: new Date().toISOString() }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: donnees }) });
    });
    // Le téléchargement passe par /api/montage-media (download puis
    // confirmer-telechargement, voir js/montage.js partagerVideoMontage) :
    // intercepté séparément du filet /api/data générique ci-dessus.
    await page.route('**/api/montage-media**', async (route) => {
      const url = route.request().url();
      if (url.includes('action=confirmer-telechargement')) {
        appelsConfirmation.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      if (url.includes('action=download')) {
        return route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('faux-mp4') });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate((code) => {
      localStorage.setItem('scriptura_code', code);
      localStorage.setItem('scriptura_unlocked', 'true');
      unlocked = true;
      document.body.classList.add('is-unlocked', 'peut-monter-video');
    }, CODE);
    await page.evaluate(() => openHistory());
    await page.waitForTimeout(500);

    const contenu = await page.locator('#historyVideosMontees').innerText();
    assert.match(contenu, /9:16/, 'REGRESSION : le format de la vidéo doit être affiché');
    assert.match(contenu, /Disponible encore|Expire aujourd/, 'REGRESSION : le délai avant expiration doit être affiché');
    assert.equal(appelsListe.length >= 1, true, 'la liste doit être chargée à l\'ouverture de Mes générations');

    const bouton = page.locator('#historyVideosMontees button', { hasText: 'Télécharger' });
    await assert.doesNotReject(bouton.waitFor({ state: 'visible', timeout: 3000 }));

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      bouton.click()
    ]);
    await page.waitForTimeout(500);

    assert.equal(appelsConfirmation.length, 1, 'REGRESSION : le clic doit confirmer le téléchargement côté serveur (sinon la vidéo ne sera jamais purgée du Storage)');
    assert.equal(appelsConfirmation[0].url, URL_VIDEO);

    // La liste se recharge après le clic (voir partagerVideoMontee) : le mock
    // renvoie désormais [] puisque appelsConfirmation n'est plus vide, la
    // carte doit donc disparaître de l'écran.
    await page.waitForTimeout(400);
    const contenuApres = await page.locator('#historyVideosMontees').innerText();
    assert.equal(contenuApres.trim(), '', 'REGRESSION : une fois téléchargée, la vidéo ne doit plus apparaître dans la liste');

    const erreursConsole = [];
    page.on('console', (msg) => { if (msg.type() === 'error') erreursConsole.push(msg.text()); });
    assert.equal(erreursConsole.length, 0);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

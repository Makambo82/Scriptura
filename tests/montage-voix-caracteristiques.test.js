// Retour propriétaire : afficher la caractéristique de chaque voix (ex.
// "voix masculine française, 40 ans, grave et naturelle" pour Adrien) sous
// son nom au moment de la choisir, pour un montage avec jusqu'à 10 voix.
// La description vient de la même variable d'environnement Vercel déjà
// utilisée pour id/label (ELEVENLABS_VOICES, voir obtenirVoixDisponibles,
// api/montage-media.js), jamais codée en dur côté serveur ou client.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('/api/montage-media action=voices renvoie la description de chaque voix depuis ELEVENLABS_VOICES', async () => {
  const envAvant = { ...process.env };
  process.env.ELEVENLABS_VOICES = JSON.stringify([
    { id: 'v-adrien', label: 'Adrien', description: 'Voix masculine française, 40 ans, grave et naturelle' },
    { id: 'v-melanie', label: 'Melanie', description: 'Voix féminine française, chaleureuse, claire et captivante' }
  ]);

  try {
    const { default: handler } = await import('../api/montage-media.js?voix-caracteristiques');
    let jsonRecu = null;
    const res = { status() { return this; }, json(o) { jsonRecu = o; return this; } };
    await handler({ method: 'GET', query: { action: 'voices' } }, res);

    assert.deepEqual(jsonRecu.voices, [
      { id: 'v-adrien', label: 'Adrien', description: 'Voix masculine française, 40 ans, grave et naturelle' },
      { id: 'v-melanie', label: 'Melanie', description: 'Voix féminine française, chaleureuse, claire et captivante' }
    ], 'la description de chaque voix doit être transmise telle quelle : ' + JSON.stringify(jsonRecu));
  } finally {
    process.env = envAvant;
  }
});

test('/api/montage-media action=voices : une voix sans description renvoie une chaîne vide plutôt qu\'un champ manquant ou planté', async () => {
  const envAvant = { ...process.env };
  process.env.ELEVENLABS_VOICES = JSON.stringify([{ id: 'v-sans-desc', label: 'Sans description' }]);

  try {
    const { default: handler } = await import('../api/montage-media.js?voix-sans-description');
    let jsonRecu = null;
    const res = { status() { return this; }, json(o) { jsonRecu = o; return this; } };
    await handler({ method: 'GET', query: { action: 'voices' } }, res);

    assert.equal(jsonRecu.voices[0].description, '', 'une voix sans description doit renvoyer une chaîne vide : ' + JSON.stringify(jsonRecu));
  } finally {
    process.env = envAvant;
  }
});

test('Montage (storyboard IA) : la caractéristique de chaque voix s\'affiche sous son nom dans le menu de choix', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        voices: [
          { id: 'v-adrien', label: 'Adrien', description: 'Voix masculine française, 40 ans, grave et naturelle' },
          { id: 'v-melanie', label: 'Melanie', description: 'Voix féminine française, chaleureuse, claire et captivante' }
        ]
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VOIXCARAC1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.evaluate(() => chargerVoixMontage());
    await page.waitForTimeout(100);

    // Ouvre le menu déroulant maison (voir initCustomSelect, js/ui.js) en
    // cliquant sur son déclencheur visible, comme le ferait réellement
    // l'utilisateur (pas un accès direct au <select> caché).
    const trigger = await page.$('#montageVoixSelect');
    const wrap = await page.evaluateHandle(el => el.closest('.custom-select'), trigger);
    await page.evaluate(w => w.querySelector('.custom-select-trigger').click(), wrap);
    await page.waitForTimeout(100);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const descriptions = await page.evaluate(w =>
      Array.from(w.querySelectorAll('.custom-select-option .cs-option-desc')).map(el => el.textContent),
      wrap
    );
    assert.deepEqual(descriptions, [
      'Voix masculine française, 40 ans, grave et naturelle',
      'Voix féminine française, chaleureuse, claire et captivante'
    ], 'chaque voix doit afficher sa caractéristique sous son nom dans le menu ouvert : ' + JSON.stringify(descriptions));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

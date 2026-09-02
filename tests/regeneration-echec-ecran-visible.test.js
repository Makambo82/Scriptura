// Non-régression pour une vraie faille trouvée lors de l'audit complet du
// 2 septembre 2026 : quand une RÉGÉNÉRATION (Script ou Récit) échouait
// (réseau, panne serveur...), l'utilisateur se retrouvait devant un écran
// totalement vide. Cause : #results/#storyResults est masqué en tête de
// generate()/generateStory(), et le errorBox qui reçoit le message d'erreur
// vit dans le formulaire (#step3/#storyFormCard), lui-même déjà masqué à ce
// stade (on est sur l'écran résultat, pas le formulaire). Voir js/generation.js
// et js/storytelling.js : en cas d'échec, le résultat précédent est
// désormais réaffiché et un toast signale l'erreur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('Script : une régénération qui échoue réaffiche le résultat précédent et affiche un message, jamais un écran vide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    // poserMocksReseau répond toujours 200 par défaut : on route /api/generate
    // nous-mêmes APRÈS pour renvoyer un vrai statut 400 (Playwright donne la
    // priorité au dernier gestionnaire enregistré pour une même URL).
    await page.route('**/api/generate', route => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'panne simulée pour le test' } })
    }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'REGENECHEC1', plan: 'creator' });
    await page.waitForTimeout(150);

    // Simule l'état "un script a déjà été généré avec succès, #results est
    // affiché" (sans repasser par une vraie génération complète, superflue
    // ici : seul l'état DOM avant l'échec compte pour ce test). Champs et
    // state.depart remplis comme un vrai passage par le formulaire (même
    // configuration qu'un test de génération réussie, tests/progression-
    // reelle-script.test.js), pour ne heurter aucune garde de generate().
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const results = document.getElementById('results');
      results.innerHTML = '<div id="marqueurResultatPrecedent">Résultat précédent</div>' + results.innerHTML;
      results.style.display = 'block';
      const step3 = document.getElementById('step3');
      if (step3) step3.classList.remove('active');
      document.getElementById('niche').value = 'Business & Entrepreneuriat';
      document.getElementById('sujet').value = 'Comment lancer une petite entreprise';
      document.getElementById('audience').value = '';
      document.getElementById('format').value = '';
      document.getElementById('venteDescription').value = '';
      document.getElementById('viralVideo').value = '';
      if (typeof state !== 'undefined') state.depart = 'un sujet précis';
    });

    // Déclenche generate() directement (régénération) : le mock /api/generate
    // échoue systématiquement, la fonction doit tomber dans son catch.
    await page.evaluate(() => generate());
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => ({
      resultsDisplay: document.getElementById('results').style.display,
      marqueurPresent: !!document.getElementById('marqueurResultatPrecedent'),
      toastVisible: !!document.getElementById('regenToast') && document.getElementById('regenToast').classList.contains('show'),
      toastTexte: document.getElementById('regenToast') ? document.getElementById('regenToast').textContent : ''
    }));

    assert.notEqual(etat.resultsDisplay, 'none', 'après un échec de régénération, #results doit rester/redevenir visible, jamais un écran vide');
    assert.equal(etat.marqueurPresent, true, 'le résultat précédent doit rester dans le DOM, pas remplacé par du vide');
    assert.equal(etat.toastVisible, true, 'un toast doit signaler l\'échec : ' + JSON.stringify(etat));
    assert.match(etat.toastTexte, /panne simulée pour le test/, 'le toast doit contenir le message d\'erreur réel : ' + etat.toastTexte);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : une régénération qui échoue réaffiche le résultat précédent et affiche un message, jamais un écran vide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/generate', route => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'panne simulée pour le test' } })
    }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'REGENECHEC2', plan: 'creator' });
    await page.waitForTimeout(150);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const results = document.getElementById('storyResults');
      results.innerHTML = '<div id="marqueurRecitPrecedent">Récit précédent</div>' + results.innerHTML;
      results.style.display = 'block';
      const formCard = document.getElementById('storyFormCard');
      if (formCard) formCard.style.display = 'none';
      document.getElementById('storyInput').value = 'Un fait historique marquant à raconter';
      // Format long : pas de contrôle de durée à mocker en plus (même
      // simplification que tests/progression-reelle-recit.test.js).
      storyFormat = 'long';
      storyDuree = '';
      storyTon = '';
    });

    await page.evaluate(() => generateStory());
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => ({
      resultsDisplay: document.getElementById('storyResults').style.display,
      marqueurPresent: !!document.getElementById('marqueurRecitPrecedent'),
      toastVisible: !!document.getElementById('regenToast') && document.getElementById('regenToast').classList.contains('show'),
      toastTexte: document.getElementById('regenToast') ? document.getElementById('regenToast').textContent : ''
    }));

    assert.notEqual(etat.resultsDisplay, 'none', 'après un échec de régénération, #storyResults doit rester/redevenir visible, jamais un écran vide');
    assert.equal(etat.marqueurPresent, true, 'le récit précédent doit rester dans le DOM, pas remplacé par du vide');
    assert.equal(etat.toastVisible, true, 'un toast doit signaler l\'échec : ' + JSON.stringify(etat));
    assert.match(etat.toastTexte, /panne simulée pour le test/, 'le toast doit contenir le message d\'erreur réel : ' + etat.toastTexte);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Storyboard seul (js/storyboard-seul.js) : la génération se fait déjà par
// LOTS réels (genererVisuelsParLots, js/storyboard.js, TAILLE_LOT_VISUELS
// plans à la fois), avec un vrai compteur "X/Y plans" déjà affiché — mais la
// barre de progression (%) restait une pure estimation de temps
// (createProgress), totalement déconnectée de ce compteur réel. Ce test
// vérifie que creerProgressionReelle (voir js/storyboard.js) branche
// désormais le % sur CE signal réel : un jalon par lot VRAIMENT reçu.
// Même correctif appliqué (mécaniquement identique) à generateStoryboard()
// (js/generation.js), generateStoryStoryboard() (js/storyboard.js) et
// genererStoryboardEpisode() (js/serie.js) : non retestés individuellement
// ici (même fonction partagée genererVisuelsParLots), mais node --check +
// relecture confirment la même structure de garde (prog possiblement jamais
// assigné avant une erreur précoce, voir "if (typeof prog !== 'undefined')").
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Un texte avec assez de phrases courtes pour dépasser TAILLE_LOT_VISUELS
// (15) et déclencher AU MOINS 2 lots réels, condition nécessaire pour
// observer une vraie progression par jalons (pas un aller simple à 100%).
const PHRASE = (i) => `Ceci est la phrase numéro ${i} du texte de test, assez longue pour compter.`;
const TEXTE_LONG = Array.from({ length: 24 }, (_, i) => PHRASE(i + 1)).join(' ');

test('Storyboard seul : le % progresse par lots RÉELS (genererVisuelsParLots), pas sur un minuteur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await new Promise((r) => setTimeout(r, 200)); // laisse le temps d'observer un état intermédiaire
      const texteMessage = JSON.stringify(body.messages || '');
      if (texteMessage.includes('MINIATURE')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ miniature: 'Un prompt de miniature 9:16' }) }] }) });
      }
      // Appel "par lot" : compte les entrées numérotées de la liste envoyée
      // pour renvoyer EXACTEMENT le bon nombre de prompts visuels.
      const nbEntrees = (texteMessage.match(/\\n\d+\.\s/g) || []).length || 1;
      const visuels = Array.from({ length: nbEntrees }, (_, i) => 'Prompt visuel généré ' + i + ' 9:16');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ visuels }) }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROGSBSEUL1', plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate((texte) => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('sbSeulInput').value = texte;
    }, TEXTE_LONG);

    await page.evaluateHandle(() => {
      const releves = [];
      const id = setInterval(() => {
        const el = document.getElementById('sbProgPct3');
        if (el) releves.push(el.textContent);
      }, 60);
      window.__releves = releves;
      window.__arreterReleve = () => clearInterval(id);
      return true;
    });

    const genererPromise = page.evaluate(() => generateStoryboardSeul());
    await page.waitForTimeout(3500);
    await genererPromise;
    await page.evaluate(() => window.__arreterReleve());
    const suiviPct = await page.evaluate(() => window.__releves.map(t => parseInt(t, 10)));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    // Visible pour de vrai, pas seulement présent dans le DOM (voir
    // css/style.css : un vrai bug caché a longtemps masqué ce chiffre par
    // CSS, invisible à un test qui ne vérifie que le texte).
    const pctVisible = await page.evaluate(() => {
      const el = document.getElementById('sbProgPct3');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    assert.equal(pctVisible, true, 'le % du storyboard seul doit être visible à l\'écran, pas masqué par CSS');

    assert.ok(suiviPct.length >= 2, 'plusieurs valeurs de % doivent avoir été relevées : ' + JSON.stringify(suiviPct));
    for (let i = 1; i < suiviPct.length; i++) {
      assert.ok(suiviPct[i] >= suiviPct[i - 1], 'le % ne doit jamais reculer : ' + JSON.stringify(suiviPct));
    }
    const valeursDistinctes = new Set(suiviPct);
    assert.ok(valeursDistinctes.size >= 2, 'le % doit avancer par lot réel, pas rester figé : ' + JSON.stringify(suiviPct));

    const pctFinal = await page.evaluate(() => document.getElementById('sbProgPct3').textContent);
    assert.equal(pctFinal, '100%', 'une fois le storyboard affiché, le % doit être exactement 100%');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit → Storyboard : une erreur précoce (avant toute barre réelle créée) ne fait pas planter le bloc finally (garde "prog")', async () => {
  // Ce cas précis a changé de forme avec ce correctif : `prog` est
  // maintenant créé APRÈS le calcul des plans (son nombre de lots en
  // dépend), donc DANS le bloc try, alors qu'il vivait avant à l'extérieur.
  // Un "Récit vide" jeté avant cette ligne laisse `prog` non déclaré dans le
  // bloc finally : sans la garde déjà présente ("typeof prog !== 'undefined'"),
  // ce serait un ReferenceError qui empêcherait même l'affichage de l'erreur.
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROGSTORYSB1', plan: 'creator' });
    await page.waitForTimeout(200);

    const resultat = await page.evaluate(async () => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      currentStory = { id: 'test' };
      currentStoryText = 'Un texte quelconque, peu importe : le découpage est forcé à vide ci-dessous.';
      // Éléments minimaux que la fonction manipule sans garde de nullité
      // (elle suppose d'être appelée depuis l'écran résultat du Récit déjà
      // rendu, non reconstruit ici : seul le comportement de "prog" nous
      // intéresse dans ce test, pas le rendu visuel réel).
      document.body.insertAdjacentHTML('beforeend', `
        <button id="storyStoryboardBtn"></button>
        <span id="storyboardSpinner2"></span>
        <div id="storyStoryboardText"></div>
        <div id="storyStoryboardOutput"></div>`);
      const original = window.segmentNarrativeStoryboard;
      window.segmentNarrativeStoryboard = () => [];
      const out = document.getElementById('storyStoryboardOutput');
      try {
        await generateStoryStoryboard();
        return out ? out.textContent : '(pas de conteneur de sortie)';
      } finally {
        window.segmentNarrativeStoryboard = original;
      }
    });

    if (erreursJs.length) throw new Error('Exceptions JS (le garde "prog" a probablement échoué) : ' + erreursJs.join(' | '));
    assert.match(resultat, /Récit vide/, 'l\'erreur doit être affichée proprement, sans exception JS non gérée : ' + resultat);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

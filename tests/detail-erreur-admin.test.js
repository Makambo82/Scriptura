// Vérifie que le fondateur peut voir ce qui s'est réellement passé pour un
// échec, pas seulement un compte par mode (retour direct : "eske ces
// possible quand on clique sur une erreur de voir ce qui s'est réellement
// passé ?"). Chaque ligne de mode dans la carte "Échecs de génération" est
// cliquable et déplie le détail (message technique, quand, sur quel code)
// des échecs de CE mode, indépendamment des autres. Vérifie aussi que le
// total affiché reste exact (requête séparée du détail, voir
// handleAdminStats, api/data.js) et que le clic est un simple bascule
// (ouvre puis referme).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('cliquer un mode déplie le détail réel des échecs (message, quand, code)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const maintenant = Date.now();
    const erreursRecentes = [
      { mode: 'script', detail: '(529) surchargé, réessaie dans un instant', code_acces: 'FIFA', cree_le: new Date(maintenant - 10 * 60000).toISOString() },
      { mode: 'script', detail: 'réponse vide', code_acces: 'BRAD-A3M8', cree_le: new Date(maintenant - 3 * 3600000).toISOString() },
      { mode: 'ideas', detail: 'délai dépassé (55s)', code_acces: null, cree_le: new Date(maintenant - 25 * 3600000).toISOString() }
    ];
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: { script: 2, ideas: 1 }, erreursTotal: 3, erreursRecentes }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const avant = await page.evaluate(() => document.getElementById('detailErreurs_script').style.display);
    assert.equal(avant, 'none', 'le détail doit être fermé par défaut');

    await page.evaluate(() => {
      const ligne = Array.from(document.querySelectorAll('.erreur-mode-ligne')).find(l => l.textContent.includes('Script'));
      ligne.click();
    });
    await page.waitForTimeout(150);
    const apres = await page.evaluate(() => {
      const el = document.getElementById('detailErreurs_script');
      return { display: el.style.display, texte: el.textContent };
    });
    assert.equal(apres.display, 'block', 'le détail doit s\'ouvrir au clic');
    assert.match(apres.texte, /surchargé/, 'doit montrer le vrai message technique du 1er échec');
    assert.match(apres.texte, /réponse vide/, 'doit montrer le vrai message technique du 2e échec');
    assert.match(apres.texte, /FIFA/, 'doit montrer le code concerné');
    assert.match(apres.texte, /BRAD-A3M8/, 'doit montrer le code du 2e échec');
    assert.doesNotMatch(apres.texte, /55s/, 'ne doit PAS mélanger le détail d\'un autre mode (Idées)');

    const total = await page.evaluate(() => document.querySelector('.score-card-alerte .score-global-num').textContent);
    assert.equal(total, '3', 'le total affiché doit rester exact, indépendant de la requête de détail');

    await page.evaluate(() => {
      const ligne = Array.from(document.querySelectorAll('.erreur-mode-ligne')).find(l => l.textContent.includes('Script'));
      ligne.click();
    });
    await page.waitForTimeout(150);
    const refermee = await page.evaluate(() => document.getElementById('detailErreurs_script').style.display);
    assert.equal(refermee, 'none', 'un second clic doit refermer le détail');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire : "dans le tableau de bord, au niveau des échecs de
// génération, il n'y a pas score-script ou score-story". Vérification faite,
// rien ne les filtrait : la carte affiche TOUS les modes remontés, un mode
// inconnu du dictionnaire de libellés s'affichant brut (c'est le cas de
// "montageRendu" sur sa capture). L'absence venait donc simplement du fait
// qu'aucun juge n'avait échoué depuis la mise en ligne de ce journal.
// Ce test verrouille les deux choses qui, elles, méritaient d'être garanties :
// ces deux modes s'affichent bel et bien avec un libellé lisible, et ils
// restent COMPTÉS À PART de 'script'/'story' (le script est livré complet,
// seul le score manque, les mélanger fausserait la santé du service).
test('un score non calculé apparaît dans la carte, avec son libellé, sans être confondu avec un échec de génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const maintenant = Date.now();
    const erreursRecentes = [
      { mode: 'script', detail: '(529) serveur occupé', code_acces: 'ABC', cree_le: new Date(maintenant - 20 * 60000).toISOString() },
      { mode: 'score-script', detail: 'score non calculé : réponse du juge illisible (aucun JSON exploitable) | 2e tentative (autre modèle) : appel au juge impossible : (529) serveur occupé', code_acces: 'ABC', cree_le: new Date(maintenant - 15 * 60000).toISOString() },
      { mode: 'score-story', detail: 'score non calculé : appel au juge impossible : délai dépassé (55s)', code_acces: 'DEF', cree_le: new Date(maintenant - 5 * 60000).toISOString() }
    ];
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: { script: 1, 'score-script': 1, 'score-story': 1 }, erreursTotal: 3, erreursRecentes }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const lignes = await page.evaluate(() => Array.from(document.querySelectorAll('.erreur-mode-ligne')).map(l => l.textContent.trim()));
    assert.ok(lignes.some(l => /Score non calculé \(Script\)/.test(l)),
      'le mode score-script doit apparaître avec un libellé lisible, jamais brut : ' + JSON.stringify(lignes));
    assert.ok(lignes.some(l => /Score non calculé \(Récit\)/.test(l)),
      'idem pour score-story : ' + JSON.stringify(lignes));
    // Comptés à part : la ligne "Script" reste à 1, elle n'absorbe pas le
    // score non calculé qui l'a suivi sur la même génération.
    const ligneScript = lignes.find(l => /^Script/.test(l));
    assert.ok(ligneScript && /1$/.test(ligneScript),
      'le compteur d\'échecs de génération ne doit pas être gonflé par un score non calculé : ' + ligneScript);

    // Et le détail reste consultable, avec la cause en clair.
    await page.evaluate(() => toggleDetailErreursMode('score-script'));
    await page.waitForTimeout(150);
    const detail = await page.evaluate(() => {
      const el = document.getElementById('detailErreurs_score-script');
      return { display: el ? el.style.display : null, texte: el ? el.textContent : '' };
    });
    assert.equal(detail.display, 'block', 'le détail doit s\'ouvrir malgré le tiret dans le nom du mode');
    assert.match(detail.texte, /illisible/, 'la cause doit être lisible telle qu\'elle a été journalisée');
    assert.match(detail.texte, /2e tentative/, 'et couvrir les deux tentatives');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

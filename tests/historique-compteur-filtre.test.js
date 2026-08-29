// Retour du propriétaire : quand on ouvre le menu de filtre par type dans
// "Mes générations" et qu'on choisit un type (Script, Idées, etc.), le
// nombre de générations correspondantes doit s'afficher dans la puce
// sélectionnée, ex. "Script (3)". Le compteur n'apparaît QUE sur la puce
// active (pas sur les 7 autres), et respecte les filtres favoris/recherche
// déjà en cours (voir _compterHistoriquePourMode, js/historique.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('puce de filtre sélectionnée : affiche le nombre de générations correspondantes', async () => {
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

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('historyFlow').style.display = 'block';
      document.getElementById('historyToolbar').style.display = 'flex';
      window._historyDataAll = [
        { id: 'g1', mode: 'script', titre: 'A', favori: false },
        { id: 'g2', mode: 'script', titre: 'B', favori: true },
        { id: 'g3', mode: 'script', titre: 'C', favori: false },
        { id: 'g4', mode: 'ideas', titre: 'D', favori: false },
        { id: 'g5', mode: 'story', titre: 'E', favori: false }
      ];
      window._historySeriesAll = [];
      dessinerHistorique();
    });
    await page.waitForTimeout(150);

    // Menu fermé : pas encore de puces à l'écran.
    const puceAvantOuverture = await page.evaluate(() => document.querySelectorAll('.hist-chip').length);
    assert.equal(puceAvantOuverture, 0, 'les puces ne doivent apparaître qu\'après ouverture du menu filtre');

    await page.evaluate(() => toggleFilterMenu());
    await page.waitForTimeout(100);

    // "Tous" est le filtre par défaut : sa puce doit déjà porter le total.
    const puceTous = await page.evaluate(() => document.querySelector('.hist-chip.actif')?.textContent);
    assert.equal(puceTous, 'Tous (5)', 'la puce "Tous" doit afficher le total : ' + puceTous);

    await page.evaluate(() => setModeFilter('script'));
    await page.waitForTimeout(150);

    const puces = await page.evaluate(() => Array.from(document.querySelectorAll('.hist-chip')).map(b => ({ texte: b.textContent.trim(), actif: b.classList.contains('actif') })));
    const puceScript = puces.find(p => p.actif);
    assert.equal(puceScript.texte.includes('(3)'), true, 'la puce Script sélectionnée doit afficher "(3)" : ' + puceScript.texte);
    const autresAvecCompte = puces.filter(p => !p.actif && /\(\d+\)/.test(p.texte));
    assert.equal(autresAvecCompte.length, 0, 'seule la puce sélectionnée doit afficher un compteur : ' + JSON.stringify(puces));

    // Combiné avec le filtre Favoris (1 seul script favori) : le compteur
    // doit refléter l'intersection, pas juste le mode seul.
    await page.evaluate(() => toggleFavFilter());
    await page.waitForTimeout(150);
    const puceScriptFav = await page.evaluate(() => document.querySelector('.hist-chip.actif')?.textContent.trim());
    assert.equal(puceScriptFav.includes('(1)'), true, 'combiné à "Favoris", le compteur doit refléter l\'intersection : ' + puceScriptFav);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

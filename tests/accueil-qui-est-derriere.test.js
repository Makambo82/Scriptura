// Retour du propriétaire, dans la continuité de l'audit du parcours d'un
// visiteur non connecté : sans vrais abonnés à ce jour, impossible d'ajouter
// des témoignages ou un nombre d'utilisateurs sans les inventer. À la place,
// une section "Qui est derrière Scriptura" raconte l'histoire fondatrice
// réelle (la galère à trouver des idées de contenu) plutôt qu'un nom
// personnel, entre "Pourquoi Scriptura" et les tarifs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

test('accueil : section "qui est derrière Scriptura" présente entre "pourquoi Scriptura" et les tarifs', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const ordre = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('section')).map(s => s.className);
      return { idxWhy: sections.indexOf('why'), idxAbout: sections.indexOf('about'), idxPricing: sections.indexOf('pricing') };
    });
    assert.ok(ordre.idxAbout > ordre.idxWhy, 'la section "qui est derrière" doit venir après "pourquoi Scriptura"');
    assert.ok(ordre.idxAbout < ordre.idxPricing, 'la section "qui est derrière" doit venir avant les tarifs');

    const texte = await page.evaluate(() => document.querySelector('.about')?.textContent || '');
    assert.ok(texte.length > 40, 'la section doit avoir un vrai contenu, pas un bloc vide');
    // Aucun nom personnel : reste volontairement sur une histoire, pas une
    // identité (voir la décision du propriétaire : marque/équipe, pas de
    // prénom affiché).
    assert.ok(!/Céline/i.test(texte), 'aucun nom personnel ne doit apparaître dans ce bloc');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

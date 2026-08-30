// Retour du propriétaire, dans la continuité de l'audit du parcours d'un
// visiteur non connecté : sans vrais abonnés à ce jour, impossible d'ajouter
// des témoignages ou un nombre d'utilisateurs sans les inventer. À la place,
// une section "Qui est derrière Scriptura" raconte l'histoire fondatrice
// réelle (la galère à trouver des idées de contenu) plutôt qu'un nom
// personnel, entre "Pourquoi Scriptura" et les tarifs.
//
// Complété ensuite par une vraie preuve : le propriétaire utilise lui-même
// Scriptura (mode Storytelling) pour sa propre marque de contenu, avec des
// résultats réels (jusqu'à 93,6K vues sur certaines histoires). Décision du
// propriétaire : ne PAS nommer la marque (reste anonyme comme choisi plus
// haut), et montrer une fourchette honnête plutôt que le seul pic isolé,
// pour ne pas donner une attente irréaliste.
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
    // Aucun nom de marque non plus : décision explicite de rester anonyme
    // même pour la preuve des résultats réels obtenus avec Scriptura.
    assert.ok(!/makambo/i.test(texte), 'le nom de la marque ne doit pas apparaître dans ce bloc');

    const preuve = await page.evaluate(() => document.querySelector('.about-proof')?.textContent || '');
    assert.ok(preuve.length > 20, 'la preuve de résultats réels doit être présente');
    // Fourchette honnête, pas juste le pic isolé (93,6K) : au moins deux
    // signaux différents (un haut, un plus modeste).
    assert.ok(/90.000|90000/.test(preuve), 'doit citer le résultat haut : ' + preuve);
    assert.ok(/quelques centaines/.test(preuve), 'doit citer aussi les résultats plus modestes, pas que le pic : ' + preuve);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

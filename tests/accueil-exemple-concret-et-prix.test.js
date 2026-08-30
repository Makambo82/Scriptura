// Retour du propriétaire, après audit du parcours d'un visiteur non connecté
// ("en tant que créateur exigeant, saurais-tu quoi faire et t'abonner ?") :
// la page d'accueil n'avait ni exemple concret de génération, ni prix avant
// l'argumentaire "Pourquoi Scriptura". Ajout d'une section "Exemple concret"
// entre "Comment ça marche" et "Pourquoi Scriptura" : un exemple réel dans le
// MÊME format que le vrai rendu d'une génération (.hooks-list/.hook-item/
// .script-block, voir js/generation.js), plus un prix teaser qui renvoie vers
// la section tarifs complète.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

test('accueil : section "exemple concret" présente entre "comment ça marche" et "pourquoi Scriptura", avec prix et lien vers les tarifs', async () => {
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
      return {
        idxHow: sections.indexOf('how'),
        idxExample: sections.indexOf('example'),
        idxWhy: sections.indexOf('why')
      };
    });
    assert.ok(ordre.idxExample > ordre.idxHow, 'la section exemple doit venir après "comment ça marche"');
    assert.ok(ordre.idxExample < ordre.idxWhy, 'la section exemple doit venir avant "pourquoi Scriptura"');

    // Reprend bien le format RÉEL d'une génération (mêmes classes que
    // js/generation.js), pas une maquette isolée.
    const contenu = await page.evaluate(() => {
      const ex = document.querySelector('.example');
      return {
        aHook: !!ex.querySelector('.hooks-list .hook-item'),
        aScript: !!ex.querySelector('.script-block .script-row'),
        note: ex.querySelector('.example-note')?.textContent || ''
      };
    });
    assert.equal(contenu.aHook, true, 'l\'exemple doit inclure un vrai hook (.hook-item)');
    assert.equal(contenu.aScript, true, 'l\'exemple doit inclure un vrai script (.script-row)');
    assert.ok(/FCFA/.test(contenu.note), 'le prix doit être visible dans la section exemple : ' + contenu.note);

    // Le lien "Voir les tarifs" doit réellement amener à la section tarifs.
    await page.click('.example-cta');
    await page.waitForTimeout(500);
    const tarifsVisibles = await page.evaluate(() => {
      const r = document.getElementById('pricingSection').getBoundingClientRect();
      return r.top >= -50 && r.top < window.innerHeight;
    });
    assert.equal(tarifsVisibles, true, 'cliquer sur "Voir les tarifs" doit amener la section tarifs à l\'écran');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour du propriétaire, après audit du parcours d'un visiteur non connecté
// ("en tant que créateur exigeant, saurais-tu quoi faire et t'abonner ?") :
// la page d'accueil n'avait ni exemple concret de génération, ni prix avant
// l'argumentaire "Pourquoi Scriptura". Ajout d'une section "Exemple concret"
// entre "Comment ça marche" et "Pourquoi Scriptura" : un exemple réel dans le
// MÊME format que le vrai rendu d'une génération (.hooks-list/.hook-item/
// .script-block, voir js/generation.js), plus un prix teaser qui renvoie vers
// la section tarifs complète. Complété ensuite (pas de vrais abonnés à cette
// date, donc pas de témoignages possibles sans les inventer) par un extrait
// du diagnostic TikTok, même classes que le vrai rendu (.ds-dim-card, voir
// js/diagnostic-sommaire.js), pour prouver la qualité sans avoir besoin de
// preuve sociale qui n'existe pas encore.
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
    // js/generation.js) et d'un diagnostic (mêmes classes que
    // js/diagnostic-sommaire.js), pas une maquette isolée.
    const contenu = await page.evaluate(() => {
      const ex = document.querySelector('.example');
      const dims = Array.from(ex.querySelectorAll('.ds-dim-card')).map(c => ({
        badge: c.querySelector('.score-badge')?.textContent || '',
        texte: c.querySelector('.ds-dim-text')?.textContent || ''
      }));
      return {
        aHook: !!ex.querySelector('.hooks-list .hook-item'),
        aScript: !!ex.querySelector('.script-block .script-row'),
        note: ex.querySelector('.example-note')?.textContent || '',
        dims
      };
    });
    assert.equal(contenu.aHook, true, 'l\'exemple doit inclure un vrai hook (.hook-item)');
    assert.equal(contenu.aScript, true, 'l\'exemple doit inclure un vrai script (.script-row)');
    assert.ok(/FCFA/.test(contenu.note), 'le prix doit être visible dans la section exemple : ' + contenu.note);
    assert.equal(contenu.dims.length, 2, 'l\'exemple de diagnostic doit avoir 2 dimensions (Engagement, Portée)');
    contenu.dims.forEach(d => {
      assert.ok(d.badge && d.badge.length > 0, 'chaque dimension du diagnostic doit avoir un score visible');
      assert.ok(d.texte && d.texte.length > 10, 'chaque dimension du diagnostic doit avoir un constat explicatif : ' + JSON.stringify(d));
    });

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

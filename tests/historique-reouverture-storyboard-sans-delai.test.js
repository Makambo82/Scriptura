// Audit du 2 septembre 2026 : reopenGeneration() (js/historique.js)
// réaffichait un storyboard déjà généré via setTimeout(fn, 200), un délai
// arbitraire sans commentaire expliquant ce qu'il protégeait. renderResults/
// renderStory sont pourtant entièrement synchrones (aucun await), donc le
// storyboard peut être réaffiché directement, sans délai ni race possible.
// Ce test couvre un chemin jusqu'ici non testé (réouverture avec storyboard
// sauvegardé) et vérifie que le storyboard apparaît immédiatement, sans
// attendre.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('reopenGeneration (mode script) : un storyboard déjà généré réapparaît immédiatement, sans délai', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    const contenuStoryboard = await page.evaluate(() => {
      window._historyData = [{
        id: 'g1',
        mode: 'script',
        titre: 'Sujet de test',
        contenu: {
          script: [{ temps: '0-3s', texte: 'Bonjour tout le monde.' }],
          hooks: [{ style: 'choc', texte: 'Accroche de test' }],
          niche: 'test',
          storyboard_genere: {
            storyboard: [{ segment: '0-3s', texte_dit: 'Bonjour tout le monde.', prompt_visuel: 'Plan large sur un créateur qui parle caméra' }]
          }
        }
      }];
      reopenGeneration(0);
      // Lu IMMÉDIATEMENT après l'appel, sans aucune attente : si un délai
      // était encore nécessaire, le storyboard serait absent à ce stade.
      return document.getElementById('storyboardContainer').innerHTML;
    });

    assert.match(contenuStoryboard, /Plan large sur un créateur qui parle caméra/, 'le storyboard sauvegardé doit être réaffiché immédiatement, sans délai : ' + contenuStoryboard.slice(0, 200));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

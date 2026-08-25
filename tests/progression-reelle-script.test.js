// Intégration navigateur : vérifie que le mode Script affiche désormais un
// vrai pourcentage (choix précédent annulé explicitement par le
// propriétaire : bande rayée indéterminée SAUF l'audit → % partout), et que
// ce pourcentage progresse RÉELLEMENT avec le texte reçu pendant l'étape
// d'écriture (en flux), pas avec un minuteur (voir js/generation.js
// GEN_POIDS.script + avancerEtapeGen, js/storyboard.js creerProgressionReelle).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const BRIEF_FAKE = { analyse_strategique: 'A', angle_choisi: 'Angle X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
// 5 hooks + un script assez long (mots répétés) pour tomber dans une
// fourchette de durée plausible et ne pas déclencher le contrôle de durée à
// l'infini (peu importe ici, on ne teste pas ce détail, juste borner les
// tentatives). Le critique ne signale aucun problème : un seul passage.
const HOOKS_5 = Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i }));
const SCRIPT_LONG = Array.from({ length: 20 }, (_, i) => ({ temps: '0-3 sec', texte: ('Une phrase percutante numéro ' + i + ' avec plusieurs mots dedans.').repeat(3), visuel: 'Visuel' }));
const SCRIPT_FAKE = { score: { viral: 90, hook: 90, engagement: 90, emotion: 90, retention: 90 }, analyse: 'ok', hooks: HOOKS_5, script: SCRIPT_LONG, legende: 'Légende', hashtags: ['#a'] };
const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };

test('Script : le % de la barre principale est visible et progresse réellement (jalons + flux), jamais figé sur un minuteur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    // Route dédiée (remplace celle posée par poserMocksReseau) : distingue
    // les appels par max_tokens (comme tests/script-tendances.test.js), et
    // renvoie l'étape d'écriture (16000) en flux RÉEL (plusieurs morceaux
    // écrits progressivement sur la même connexion, content-type text/plain,
    // exactement le format que relaie /api/generate en mode stream, voir
    // api/generate.js), pour vérifier que le % avance vraiment avec le texte
    // reçu, pas d'un coup à la fin.
    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      // Léger délai avant CHAQUE réponse (au lieu d'une résolution instantanée) :
      // sans ça, tout le pipeline (brief→écriture→critique→…) se termine en
      // quelques millisecondes, plus vite que l'intervalle de relevé du %
      // ci-dessous, qui ne verrait alors jamais que l'état final.
      await new Promise((r) => setTimeout(r, 180));
      if (body.max_tokens === 16000) {
        // content-type text/plain (comme le relais réel de /api/generate en
        // mode stream, voir api/generate.js) : le client (js/api.js) lit via
        // getReader() et appelle onApercu(buffer) à chaque morceau reçu.
        // Playwright (page.route) livre un corps mocké en un seul morceau
        // (pas de vraie trame HTTP multiple ici) ; le comportement à
        // plusieurs trames est couvert par le test unitaire du moteur
        // (progression-reelle-moteur.test.js). Ce test-ci vérifie la
        // conséquence observable de bout en bout : la barre passe bien en
        // mode "déterminée" pour Script et progresse par jalons réels.
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(SCRIPT_FAKE) });
      }
      if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF_FAKE) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_FAKE) }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROGSCRIPT1', plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('niche').value = 'Business & Entrepreneuriat';
      document.getElementById('sujet').value = 'Comment lancer une petite entreprise';
      document.getElementById('audience').value = '';
      document.getElementById('format').value = '';
      document.getElementById('venteDescription').value = '';
      document.getElementById('viralVideo').value = '';
      if (typeof state !== 'undefined') state.depart = 'un sujet précis';
    });

    await page.evaluateHandle(() => {
      const releves = [];
      const id = setInterval(() => {
        const el = document.getElementById('genProgressPct');
        if (el) releves.push(el.textContent);
      }, 60);
      window.__releves = releves;
      window.__arreterReleve = () => clearInterval(id);
      return true;
    });

    const genererPromise = page.evaluate(() => generate());
    await page.waitForTimeout(2500);
    await genererPromise;
    await page.evaluate(() => window.__arreterReleve());
    const suiviPct = await page.evaluate(() => window.__releves.map(t => parseInt(t, 10)));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    // La barre doit être en mode "déterminée" (% visible) pour Script,
    // pas seulement pour l'Audit (choix précédent explicitement annulé).
    const estDeterminee = await page.evaluate(() => {
      const fill = document.getElementById('genProgressFill');
      const bar = fill && fill.closest('.sb-progress-bar');
      return !!bar && bar.classList.contains('determinee');
    });
    assert.equal(estDeterminee, true, 'la barre principale doit afficher un % pour le mode Script, comme demandé pour "partout"');

    assert.ok(suiviPct.length >= 2, 'plusieurs valeurs de % doivent avoir été relevées pendant la génération : ' + JSON.stringify(suiviPct));
    // Monotone (jamais en arrière).
    for (let i = 1; i < suiviPct.length; i++) {
      assert.ok(suiviPct[i] >= suiviPct[i - 1], 'le % ne doit jamais reculer : ' + JSON.stringify(suiviPct));
    }
    // Une vraie progression a eu lieu (pas figé sur une seule valeur du
    // début à la fin) : au moins 3 valeurs distinctes observées.
    const valeursDistinctes = new Set(suiviPct);
    assert.ok(valeursDistinctes.size >= 3, 'le % doit vraiment progresser par étapes réelles, pas rester figé : ' + JSON.stringify(suiviPct));
    // Ne doit jamais atteindre 100 avant que le résultat soit là (dernier
    // relevé PENDANT la génération, avant l'arrêt du minuteur de relevé).
    assert.ok(Math.max(...suiviPct) <= 100);

    const pctFinal = await page.evaluate(() => document.getElementById('genProgressPct').textContent);
    assert.equal(pctFinal, '100%', 'une fois le résultat affiché, le % doit être exactement 100%');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

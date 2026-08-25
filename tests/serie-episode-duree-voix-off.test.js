// Retour direct du propriétaire (capture d'écran) : un épisode de série
// demandé en "45 à 60 secondes" ne durait en réalité qu'une vingtaine de
// secondes une fois lu à voix haute. Cause réelle, une régression entre deux
// commits antérieurs à cette session (voir js/serie.js) :
//
// - Le contrôle de durée (commit "Rend genre et durée rigoureusement
//   respectés") compte les mots de `ep.script` pour décider si l'épisode
//   respecte la cible.
// - `voix_off_propre` a été introduit PLUS TARD (commit "separer le texte
//   parle... pour que le storyboard/la voix off ne lisent plus VOIX OFF/
//   TEXTE À L'ÉCRAN/le minutage") pour séparer le texte réellement PARLÉ du
//   script complet. En format Faceless, `script` contient toujours les
//   étiquettes VOIX OFF / TEXTE À L'ÉCRAN et le texte à l'écran (jamais lu
//   par la voix off), donc plus de mots que ce qui est réellement prononcé.
//
// Résultat : un épisode dont la voix off ne fait QUE 30 mots (~12 secondes)
// pouvait passer le contrôle de durée sans correction, simplement parce que
// le texte à l'écran gonflait le compte de `script` au-dessus du minimum.
// Ce test vérifie que la correction se déclenche bien sur le texte
// RÉELLEMENT PARLÉ (voix_off_propre), pas sur le script complet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Le Casse', concept: 'Un braquage', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Dramatique', nb_episodes: 5,
  bible: { premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R', arc: [{ episode: 1, fonction: 'ouvrir', tension_finale: 'T' }], duree_episode: '45 à 60 secondes', format: 'Faceless' },
  episodes: [], episode_courant: 0, statut: 'en_cours'
};

// Voix off volontairement TROP COURTE (70 mots, sous le minimum ~99 mots
// pour "45 à 60 secondes"), mais un script complet dont le total (voix off +
// texte à l'écran) tombe lui bien DANS la cible (144 mots, entre 99 et 165) :
// exactement le cas qui doit déclencher la correction avec la bonne mesure
// (voix_off_propre) mais PAS avec l'ancienne mesure buguée (script complet),
// qui l'aurait laissé passer sans correction.
const VOIX_OFF_COURTE = Array.from({ length: 7 }, (_, i) => `Phrase courte ${i} de la voix off, à peine assez.`).join(' ');
const TEXTE_ECRAN_PADDING = Array.from({ length: 10 }, (_, i) => `[TEXTE À L'ÉCRAN] Étape ${i} du plan.`).join('\n');
const SCRIPT_GONFLE = `[0-3s] VOIX OFF : ${VOIX_OFF_COURTE}\n${TEXTE_ECRAN_PADDING}`;
const EP_TROP_COURT = { titre: 'Épisode 1', script: SCRIPT_GONFLE, voix_off_propre: VOIX_OFF_COURTE, directives: 'Plans serrés.' };

// Épisode corrigé, vraiment dans la cible (~120 mots parlés).
const VOIX_OFF_CORRIGEE = Array.from({ length: 9 }, (_, i) => `Phrase numéro ${i} du texte réellement parlé, assez longue pour compter dans le total.`).join(' ');
const EP_CORRIGE = { script: `[0-50s] VOIX OFF : ${VOIX_OFF_CORRIGEE}`, voix_off_propre: VOIX_OFF_CORRIGEE };

test('Série (Faceless) : la correction de durée se déclenche sur le texte PARLÉ, pas sur le script complet gonflé par le texte à l\'écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    let appelsCorrection = 0;
    let patchFinal = null;
    const gererDataSerie = async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'GET' && url.searchParams.get('resource') === 'series') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: SERIE_FAKE }) });
      }
      if (req.method() === 'POST') {
        try {
          const body = JSON.parse(req.postData());
          if (body.action === 'update' && body.patch && body.patch.episodes) patchFinal = body.patch;
        } catch (e) { /* ignore */ }
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'gen-test', data: [] }) });
    };
    await page.unroute('**/api/data');
    await page.unroute('**/api/data?**');
    await page.route('**/api/data', gererDataSerie);
    await page.route('**/api/data?**', gererDataSerie);

    await page.unroute('**/api/generate');
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 3000) {
        // Écriture initiale : voix off trop courte, script gonflé par le texte à l'écran.
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(EP_TROP_COURT) });
      }
      if (body.max_tokens === 2500) {
        // Appel de correction de durée : doit être déclenché par ce test.
        appelsCorrection++;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(EP_CORRIGE) }] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIEDUREE1', plan: 'pro' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      serieCouranteId = 'serie-test';
      document.body.insertAdjacentHTML('beforeend', `
        <button id="serieEpBtn"></button>
        <span id="serieEpSpinner"></span>
        <div id="serieEpTxt"></div>
        <div id="serieDetailError" style="display:none"></div>`);
    });

    await page.evaluate(() => genererEpisode());
    await page.waitForTimeout(600);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(appelsCorrection >= 1, 'la correction de durée doit se déclencher : la voix off ne fait que ~30 mots, bien sous la cible de "45 à 60 secondes", même si le script complet (avec texte à l\'écran) semble plus long');

    assert.ok(patchFinal && Array.isArray(patchFinal.episodes) && patchFinal.episodes.length === 1, 'l\'épisode corrigé doit être enregistré : ' + JSON.stringify(patchFinal));
    const episodeEnregistre = patchFinal.episodes[0];
    const motsVoixOff = episodeEnregistre.voix_off_propre.split(/\s+/).filter(Boolean).length;
    assert.ok(motsVoixOff >= 99 && motsVoixOff <= 165, 'la voix off enregistrée doit être dans la cible (45-60s, tolérance 10%) après correction : ' + motsVoixOff + ' mots');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

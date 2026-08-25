// Retour direct du propriétaire (capture d'écran, cadre vert) : un bouton
// "Régénérer" doit apparaître en haut de chaque épisode déjà écrit, au même
// endroit que pour le storyboard d'épisode ou les autres modes (Script,
// Récit, Idées). Jusqu'ici, seul le storyboard visuel d'un épisode pouvait
// être régénéré (genererStoryboardEpisode(numEp, true)) : le TEXTE de
// l'épisode, lui, ne pouvait être qu'écrit une fois (genererEpisode()
// n'écrivait toujours que le PROCHAIN épisode, jamais un épisode existant).
//
// Vérifie que genererEpisode(numEp) :
// - affiche le bouton "↻ Régénérer" dans l'en-tête de chaque épisode déjà
//   écrit (juste à côté de "Épisode X sur Y", là où le propriétaire a
//   encadré en vert) ;
// - remplace l'épisode À SA PLACE (même position, même numéro), sans ajouter
//   un nouvel épisode ni changer episode_courant/statut ;
// - invalide le storyboard/la miniature/le guide de montage déjà générés
//   pour l'ANCIEN texte (ils ne correspondraient plus au nouveau texte, même
//   principe que l'invalidation du montage manuel après un changement
//   d'image) ;
// - laisse les AUTRES épisodes inchangés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SCRIPT_EP1_ANCIEN = Array.from({ length: 9 }, (_, i) => `Ancien texte ${i} de l'épisode un, assez long pour compter dans le total.`).join(' ');
const SCRIPT_EP2 = Array.from({ length: 9 }, (_, i) => `Texte ${i} de l'épisode deux, assez long pour compter dans le total.`).join(' ');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Le Casse', concept: 'Un braquage', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Dramatique', nb_episodes: 5,
  bible: {
    premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R',
    arc: [{ episode: 1, fonction: 'ouvrir', tension_finale: 'T1' }, { episode: 2, fonction: 'creuser', tension_finale: 'T2' }],
    duree_episode: '45 à 60 secondes', format: 'Faceless'
  },
  episodes: [
    { num: 1, titre: 'Ancien titre', script: SCRIPT_EP1_ANCIEN, voix_off_propre: SCRIPT_EP1_ANCIEN, storyboard: [{ segment: '0-3s', texte_dit: 'x', prompt_visuel: 'y' }], miniature: 'Une miniature', guideMontage: 'Un guide CapCut' },
    { num: 2, titre: 'Épisode 2', script: SCRIPT_EP2, voix_off_propre: SCRIPT_EP2 }
  ],
  episode_courant: 2, statut: 'en_cours'
};

const VOIX_OFF_NOUVELLE = Array.from({ length: 9 }, (_, i) => `Nouveau texte ${i} de l'épisode un, régénéré et assez long pour compter.`).join(' ');
const EP_REGENERE = { titre: 'Nouveau titre', script: VOIX_OFF_NOUVELLE, voix_off_propre: VOIX_OFF_NOUVELLE, directives: 'Nouvelles directives.' };

test('Série : le bouton "↻ Régénérer" d\'un épisode remplace son texte à sa place et invalide son storyboard', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

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
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(EP_REGENERE) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIEREGEN1', plan: 'pro' });
    await page.waitForTimeout(200);

    await page.evaluate(() => ouvrirSerie('serie-test'));
    await page.waitForTimeout(200);

    // Le bouton doit exister pour CHAQUE épisode déjà écrit, dans l'en-tête,
    // à côté du numéro (là où le propriétaire a encadré en vert).
    const etatBoutons = await page.evaluate(() => ({
      ep1: !!document.getElementById('serieEpRegenBtn1'),
      ep2: !!document.getElementById('serieEpRegenBtn2'),
      texteEp1: document.getElementById('serieEpRegenBtn1').textContent.trim()
    }));
    assert.equal(etatBoutons.ep1, true, 'le bouton Régénérer doit exister pour l\'épisode 1');
    assert.equal(etatBoutons.ep2, true, 'le bouton Régénérer doit exister pour l\'épisode 2');
    assert.match(etatBoutons.texteEp1, /Régénérer/);

    await page.evaluate(() => genererEpisode(1));
    await page.waitForTimeout(600);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(patchFinal && Array.isArray(patchFinal.episodes), 'la mise à jour doit être envoyée : ' + JSON.stringify(patchFinal));
    assert.equal(patchFinal.episodes.length, 2, 'régénérer ne doit PAS ajouter un nouvel épisode, juste remplacer l\'existant');
    assert.equal(patchFinal.episode_courant, undefined, 'régénérer ne doit pas changer le compteur d\'épisodes de la série');
    assert.equal(patchFinal.statut, undefined, 'régénérer ne doit pas changer le statut de la série');

    const ep1Regen = patchFinal.episodes.find(e => e.num === 1);
    const ep2Inchange = patchFinal.episodes.find(e => e.num === 2);
    assert.equal(ep1Regen.titre, 'Nouveau titre', 'le titre de l\'épisode 1 doit être remplacé');
    assert.equal(ep1Regen.script, VOIX_OFF_NOUVELLE, 'le script de l\'épisode 1 doit être remplacé');
    assert.equal(ep1Regen.storyboard, null, 'le storyboard de l\'ancien texte doit être invalidé');
    assert.equal(ep1Regen.miniature, null, 'la miniature de l\'ancien texte doit être invalidée');
    assert.equal(ep1Regen.guideMontage, null, 'le guide de montage de l\'ancien texte doit être invalidé');
    assert.equal(ep2Inchange.titre, 'Épisode 2', 'l\'épisode 2 ne doit pas être touché par la régénération de l\'épisode 1');
    assert.equal(ep2Inchange.script, SCRIPT_EP2, 'le script de l\'épisode 2 ne doit pas changer');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

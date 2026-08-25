// Retour direct du propriétaire (capture d'écran) : un épisode de série en
// format Faceless s'affichait truffé d'étiquettes techniques ("VOIX OFF",
// "TEXTE À L'ÉCRAN", "ÉCRAN NOIR", minutages entre crochets), très éloigné
// du rendu propre d'un script après génération (js/generation.js : juste le
// texte, sans aucune étiquette). Deux causes cumulées :
//
// 1. Le prompt d'écriture demandait EXPLICITEMENT ces étiquettes pour le
//    format Faceless ("Écris en DEUX temps clairement séparés : la VOIX OFF
//    ... et le TEXTE À L'ÉCRAN..."). Corrigé : "script" est désormais
//    toujours une voix off continue, sans étiquette ni minutage, quel que
//    soit le format ; le texte à l'écran éventuel va dans "directives".
// 2. Même en cas de non-respect de la consigne par l'IA (ça arrive), rien
//    ne nettoyait le résultat après coup. Ajout d'un filet déterministe
//    (nettoyerEtiquettesEpisodeSerie) qui retire toute étiquette résiduelle
//    de "script" ET "voix_off_propre", jamais dépendant uniquement du bon
//    vouloir du prompt.
//
// Ce test simule une réponse IA qui, malgré la consigne, contient encore
// des étiquettes façon capture d'écran (cas réel), et vérifie que l'épisode
// ENREGISTRÉ n'en garde aucune trace.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const SERIE_FAKE = {
  id: 'serie-test', titre: 'Derrière les barreaux', concept: 'Un innocent en prison', niche: 'Business & Entrepreneuriat',
  style: 'sobre', genre: 'Enquête et révélation', nb_episodes: 5,
  bible: { premisse: 'P', univers: 'U', ton: 'sobre', regle_recurrente: 'R', arc: [{ episode: 1 }], duree_episode: '45 à 60 secondes', format: 'Faceless' },
  episodes: [], episode_courant: 0, statut: 'en_cours'
};

// Réponse IA volontairement NON conforme (comme sur la capture réelle) :
// étiquettes, minutages entre crochets, écran noir. ~132 mots de voix off
// réelle (dans la cible 110-150, aucune correction de durée nécessaire :
// ce test isole le nettoyage des étiquettes, pas la correction de durée).
const SCRIPT_AVEC_ETIQUETTES = `[0-3s] VOIX OFF : Déjà 147 exonérations en 2024 aux États-Unis. Des innocents sortis de prison après des décennies d'une vie volée. À chacun, un système entier s'est refermé. Bienvenue dans la première affaire. Épisode 1 sur 5.

[TEXTE À L'ÉCRAN]
1994. Accusation

[3-15s] VOIX OFF : Un crime. Une petite fille assassinée. La police se ferme sur un suspect. Pas d'antécédent. Pas d'alibi solide. Les deux témoins le désignent. Marcus est arrêté, jugé en trois mois. Coupable sur identification. Dix-huit ans plus tard, une avocate reprend le dossier. Elle découvre l'impossible : le second témoin était en prison le jour du crime. Comment identifier quelqu'un quand on est incarcéré ? Elle retrouve les archives oubliées. Des photos qui pourraient tout changer. Mais en les ouvrant, elle découvre une date qui fait arrêter son cœur. Y a-t-il encore une chance de sortir Marcus de là ?

[ÉCRAN NOIR]`;
const EP_AVEC_ETIQUETTES = { titre: 'L\'accusation qui commence', script: SCRIPT_AVEC_ETIQUETTES, voix_off_propre: SCRIPT_AVEC_ETIQUETTES, directives: 'Archives judiciaires, portrait de Marcus, gros plan sur les documents.' };

test('Série (Faceless) : l\'épisode enregistré ne contient plus jamais d\'étiquette VOIX OFF/TEXTE À L\'ÉCRAN/ÉCRAN NOIR ni de minutage, même si l\'IA en a mis', async () => {
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
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify(EP_AVEC_ETIQUETTES) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SERIEPROPRE1', plan: 'pro' });
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

    assert.ok(patchFinal && Array.isArray(patchFinal.episodes) && patchFinal.episodes.length === 1, 'l\'épisode doit être enregistré : ' + JSON.stringify(patchFinal));
    const episode = patchFinal.episodes[0];

    const motifsInterdits = /VOIX OFF|TEXTE\s*(À|A)\s*L'?[ÉE]CRAN|[ÉE]CRAN NOIR|\[\d{1,3}\s*-\s*\d{1,3}\s*s\]/i;
    assert.ok(!motifsInterdits.test(episode.script), 'aucune étiquette ne doit rester dans "script" : ' + JSON.stringify(episode.script));
    assert.ok(!motifsInterdits.test(episode.voix_off_propre), 'aucune étiquette ne doit rester dans "voix_off_propre" : ' + JSON.stringify(episode.voix_off_propre));

    // Le vrai contenu (les phrases elles-mêmes) doit rester intact, pas juste vidé.
    assert.match(episode.script, /147 exonérations/);
    assert.match(episode.script, /Marcus est arrêté/);
    assert.match(episode.voix_off_propre, /147 exonérations/);

    // script et voix_off_propre doivent être identiques désormais (les deux
    // formats écrivent uniquement la voix off dans "script").
    assert.equal(episode.script, episode.voix_off_propre);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

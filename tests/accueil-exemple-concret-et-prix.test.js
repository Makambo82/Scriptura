// Retour du propriétaire, après audit du parcours d'un visiteur non connecté
// ("en tant que créateur exigeant, saurais-tu quoi faire et t'abonner ?") :
// la page d'accueil n'avait ni exemple concret de génération, ni prix avant
// l'argumentaire "Pourquoi Scriptura". Ajout d'une section "Exemple concret"
// entre "Comment ça marche" et "Pourquoi Scriptura", plus un prix teaser qui
// renvoie vers la section tarifs complète.
// 2e passe (retour propriétaire) : remplacement des deux maquettes statiques
// (script figé, dimensions de diagnostic figées) par deux VRAIES captures
// vidéo de l'app en action (assets/demos/demo-script.mp4 et
// demo-sommaire.mp4, enregistrées via Playwright en pilotant la vraie
// interface avec des réponses IA simulées, jamais de fausses stats
// inventées à la main dans du HTML statique), en autoplay muet en boucle.
// 3e passe (retour propriétaire, pavé blanc constaté sur iOS Safari le
// temps du chargement, "pas pro") : chaque vidéo a désormais un poster
// (vraie capture de l'app, assets/demos/poster-*.jpg), et le conteneur
// réserve sa hauteur via aspect-ratio avec un fond sombre, jamais de blanc
// visible même avant que l'affiche ou la vidéo n'aient fini de charger.
// 4e passe (retour propriétaire : toujours le même blanc, ET aucun
// défilement auto sur 3 appareils différents malgré un déploiement Vercel
// confirmé "Ready" pour le bon commit) : suspicion d'un cache CDN Vercel
// périmé sur ces chemins (en plus du fix Cache-Control déjà posé côté
// vercel.json), qui sert la même vieille copie à tout le monde peu importe
// l'appareil ou le mode navigation privée. Fichiers renommés avec un
// suffixe de version (`-v2`), une URL jamais requêtée avant ne peut être
// périmée dans AUCUN cache, navigateur ou CDN. Les regex ci-dessous
// tolèrent un suffixe `-vN` optionnel pour ne pas casser ce test à la
// prochaine renumérotation.
// 5e passe (retour propriétaire : le blanc dure longtemps même avec des
// URLs neuves, donc pas du cache) : preload="auto" + autoplay forçait le
// téléchargement immédiat des DEUX vidéos dès l'ouverture de la page, en
// concurrence avec tout le reste (45 images de galerie, scripts, polices),
// alors que la section est plus bas, pas visible tout de suite. Retiré
// l'autoplay HTML et preload="none" : la vidéo ne commence à charger
// qu'au moment où elle entre réellement dans l'écran (IntersectionObserver,
// voir forcerLectureVideosExemple, js/app.js), plus de concurrence avec le
// chargement initial de la page.
// 6e passe (retour propriétaire, capture vidéo à l'appui : blanc de 8 à 14s
// TOUJOURS présent, alors que l'en-tête de la page s'affichait déjà
// normalement, donc pas un problème de chargement global) : l'attribut
// poster sur <video> ne suffisait pas, Safari peut peindre son propre
// rectangle blanc par défaut pour une <video> sans frame décodée,
// par-dessus poster ET le fond CSS. L'affiche est désormais une <img>
// classique séparée (.example-video-poster), toujours visible en dessous ;
// la <video> reste invisible (opacity:0 en CSS) jusqu'à l'évènement natif
// "playing" (classe .est-lancee ajoutée alors, voir js/app.js).
// 7e passe (retour propriétaire, 2e capture vidéo à l'appui : le blanc
// revenait EN COURS DE LECTURE, à chaque boucle) : preload="none" ne
// gardait quasiment rien en mémoire après la première lecture, donc un
// retéléchargement/redécodage à chaque retour au début (`loop`), plusieurs
// secondes de blanc à chaque tour. Repassé à preload="auto" : le chargement
// différé jusqu'à l'entrée dans l'écran reste assuré par l'IntersectionObserver
// (forcerLectureVideosExemple, js/app.js), preload="auto" ne fait plus que
// garder toute la vidéo (~350 Ko) en mémoire une fois chargée.
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

    // Deux vraies vidéos de démo (script + diagnostic), pas une maquette
    // HTML statique : muettes, en boucle, lisibles sans interaction, PAS en
    // autoplay HTML (le chargement est différé à l'entrée réelle dans
    // l'écran via IntersectionObserver, pour ne jamais concurrencer le
    // chargement initial de la page), mais preload="auto" (7e passe) pour
    // que la vidéo reste en mémoire d'une boucle à l'autre.
    const contenu = await page.evaluate(() => {
      const ex = document.querySelector('.example');
      const videos = Array.from(ex.querySelectorAll('video.example-video')).map(v => ({
        srcs: Array.from(v.querySelectorAll('source')).map(s => s.getAttribute('src') || ''),
        posterAttr: v.getAttribute('poster') || '',
        posterImg: v.closest('.example-video-wrap')?.querySelector('img.example-video-poster')?.getAttribute('src') || '',
        preload: v.getAttribute('preload') || '',
        autoplay: v.autoplay, muted: v.muted, loop: v.loop, playsInline: v.playsInline
      }));
      return {
        note: ex.querySelector('.example-note')?.textContent || '',
        videos
      };
    });
    // LIMITE CONNUE : ce test ne peut pas vérifier l'absence de blanc à
    // chaque boucle (bug réel constaté par la propriétaire sur iOS Safari,
    // 7e passe) — c'est un comportement de gestion mémoire propre aux
    // navigateurs mobiles réels sous contrainte, qu'un Chromium headless en
    // localhost, sans pression mémoire ni réseau réel, ne reproduit pas. Ce
    // test verrouille seulement l'attribut preload="auto" qui corrige la
    // cause identifiée ; la vérification réelle reste le test terrain.
    assert.ok(/FCFA/.test(contenu.note), 'le prix doit être visible dans la section exemple : ' + contenu.note);
    assert.equal(contenu.videos.length, 2, 'deux vidéos de démo doivent être présentes (script + diagnostic) : ' + JSON.stringify(contenu.videos));
    assert.ok(contenu.videos.some(v => v.srcs.some(s => /demo-script(-v\d+)?\.(webm|mp4)/.test(s))), 'la démo de génération de script doit être présente : ' + JSON.stringify(contenu.videos));
    assert.ok(contenu.videos.some(v => v.srcs.some(s => /demo-sommaire(-v\d+)?\.(webm|mp4)/.test(s))), 'la démo de l\'analyse sommaire doit être présente : ' + JSON.stringify(contenu.videos));
    contenu.videos.forEach(v => {
      assert.equal(v.autoplay, false, 'chaque vidéo de démo ne doit PAS avoir l\'autoplay HTML (chargement différé via IntersectionObserver à la place) : ' + JSON.stringify(v));
      // preload="auto" (7e passe, pas "none") : le chargement différé est
      // déjà assuré par l'IntersectionObserver (qui ne lance .play() qu'à
      // l'entrée dans l'écran), "auto" garde la vidéo en mémoire d'une
      // boucle à l'autre au lieu de la retélécharger à chaque tour.
      assert.equal(v.preload, 'auto', 'chaque vidéo de démo doit rester en mémoire pour boucler sans blanc : ' + JSON.stringify(v));
      assert.equal(v.muted, true, 'chaque vidéo de démo doit être muette (autoplay navigateur l\'exige de toute façon) : ' + JSON.stringify(v));
      assert.equal(v.loop, true, 'chaque vidéo de démo doit boucler : ' + JSON.stringify(v));
      assert.equal(v.playsInline, true, 'chaque vidéo de démo doit jouer inline (pas de plein écran forcé sur mobile) : ' + JSON.stringify(v));
      // Jamais de pavé blanc pendant le chargement (retour propriétaire,
      // iOS Safari, 6e passe) : l'affiche est une <img> séparée, pas
      // l'attribut poster de <video> (peu fiable sur Safari).
      assert.equal(v.posterAttr, '', 'la vidéo ne doit plus avoir d\'attribut poster (remplacé par une <img>, 6e passe) : ' + JSON.stringify(v));
      assert.ok(/poster-(script|sommaire)(-v\d+)?\.jpg/.test(v.posterImg), 'chaque vidéo de démo doit avoir une <img class="example-video-poster"> associée : ' + JSON.stringify(v));
    });

    // Le chargement différé se déclenche vraiment à l'entrée dans l'écran
    // (IntersectionObserver, forcerLectureVideosExemple, js/app.js) : après
    // avoir scrollé la section en vue, .play() doit avoir été appelé.
    await page.locator('.example').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const lecture = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.example video.example-video')).map(v => v.paused));
    assert.ok(lecture.every(p => p === false), 'les vidéos doivent démarrer leur lecture une fois entrées dans l\'écran : ' + JSON.stringify(lecture));

    // La classe est-lancee (opacity:1, révèle la vidéo par-dessus l'affiche)
    // doit apparaître une fois la lecture réellement démarrée (évènement
    // natif "playing", pas juste .play() appelé).
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.example video.example-video')).every(v => v.classList.contains('est-lancee')),
      { timeout: 5000 }
    );

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

// Retour du propriétaire, après audit du parcours d'un visiteur non connecté
// ("en tant que créateur exigeant, saurais-tu quoi faire et t'abonner ?") :
// la page d'accueil n'avait ni exemple concret de génération, ni prix avant
// l'argumentaire "Pourquoi Scriptura". Ajout d'une section "Exemple concret"
// entre "Comment ça marche" et "Pourquoi Scriptura", plus un prix teaser qui
// renvoie vers la section tarifs complète.
//
// Historique (résumé) : les deux démos "En pratique" ont été une <video> en
// boucle, avec un blanc récurrent jamais résolu par les correctifs de
// chargement (affiche séparée, cache, mémoire tampon), remplacées un temps
// par un diaporama d'images le temps de trouver la vraie cause. Cause
// réelle, trouvée en deux temps en examinant les fichiers eux-mêmes : (1)
// les 10-11 premières secondes des DEUX enregistrements captaient un écran
// vide (coupées au montage, fichiers -v3) ; (2) le fichier était tagué avec
// un espace colorimétrique inhabituel (bt470bg, un standard TV très
// ancien) que le lecteur natif d'iPhone rendait en blanc au lieu du vrai
// contenu — confirmé en testant les fichiers en dehors du site
// (téléchargés dans la galerie photo, toujours blancs). Réencodé en bt709
// (standard du web) et remis en <video>, avec tout ce qu'on a appris entre
// temps : preload="auto" (jamais "none", qui vidait la mémoire tampon et
// causait un blanc à chaque boucle), chargement différé à l'entrée réelle
// dans l'écran (IntersectionObserver), et une <img> séparée pour l'affiche
// (voir .example-video-poster, css/style.css), qui reste visible jusqu'à
// l'évènement natif "playing".
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
    // autoplay HTML (chargement différé à l'entrée réelle dans l'écran via
    // IntersectionObserver), preload="auto" pour rester en mémoire d'une
    // boucle à l'autre, et une affiche en <img> séparée (pas l'attribut
    // poster de <video>, peu fiable sur Safari).
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
    assert.ok(/FCFA/.test(contenu.note), 'le prix doit être visible dans la section exemple : ' + contenu.note);
    assert.equal(contenu.videos.length, 2, 'deux vidéos de démo doivent être présentes (script + diagnostic) : ' + JSON.stringify(contenu.videos));
    assert.ok(contenu.videos.some(v => v.srcs.some(s => /demo-script-v\d+\.(webm|mp4)/.test(s))), 'la démo de génération de script doit être présente : ' + JSON.stringify(contenu.videos));
    assert.ok(contenu.videos.some(v => v.srcs.some(s => /demo-sommaire-v\d+\.(webm|mp4)/.test(s))), 'la démo de l\'analyse sommaire doit être présente : ' + JSON.stringify(contenu.videos));
    contenu.videos.forEach(v => {
      assert.equal(v.autoplay, false, 'chaque vidéo de démo ne doit PAS avoir l\'autoplay HTML (chargement différé via IntersectionObserver à la place) : ' + JSON.stringify(v));
      assert.equal(v.preload, 'auto', 'chaque vidéo de démo doit rester en mémoire pour boucler sans blanc : ' + JSON.stringify(v));
      assert.equal(v.muted, true, 'chaque vidéo de démo doit être muette (autoplay navigateur l\'exige de toute façon) : ' + JSON.stringify(v));
      assert.equal(v.loop, true, 'chaque vidéo de démo doit boucler : ' + JSON.stringify(v));
      assert.equal(v.playsInline, true, 'chaque vidéo de démo doit jouer inline (pas de plein écran forcé sur mobile) : ' + JSON.stringify(v));
      assert.equal(v.posterAttr, '', 'la vidéo ne doit pas avoir d\'attribut poster (remplacé par une <img> séparée) : ' + JSON.stringify(v));
      assert.ok(/poster-(script|sommaire)-v\d+\.jpg/.test(v.posterImg), 'chaque vidéo de démo doit avoir une <img class="example-video-poster"> associée : ' + JSON.stringify(v));
    });

    // Le chargement différé se déclenche vraiment à l'entrée dans l'écran
    // (IntersectionObserver, forcerLectureVideosExemple, js/app.js) : après
    // avoir scrollé la section en vue, .play() doit avoir été appelé, et
    // la classe est-lancee (opacity:1, révèle la vidéo par-dessus
    // l'affiche) doit apparaître une fois la lecture réellement démarrée
    // (évènement natif "playing").
    await page.locator('.example').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const lecture = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.example video.example-video')).map(v => v.paused));
    assert.ok(lecture.every(p => p === false), 'les vidéos doivent démarrer leur lecture une fois entrées dans l\'écran : ' + JSON.stringify(lecture));

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

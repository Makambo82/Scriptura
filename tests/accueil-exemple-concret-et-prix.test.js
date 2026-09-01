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
    // HTML statique : autoplay muet en boucle, lisibles sans interaction.
    const contenu = await page.evaluate(() => {
      const ex = document.querySelector('.example');
      const videos = Array.from(ex.querySelectorAll('video.example-video')).map(v => ({
        srcs: Array.from(v.querySelectorAll('source')).map(s => s.getAttribute('src') || ''),
        poster: v.getAttribute('poster') || '',
        autoplay: v.autoplay, muted: v.muted, loop: v.loop, playsInline: v.playsInline
      }));
      return {
        note: ex.querySelector('.example-note')?.textContent || '',
        videos
      };
    });
    assert.ok(/FCFA/.test(contenu.note), 'le prix doit être visible dans la section exemple : ' + contenu.note);
    assert.equal(contenu.videos.length, 2, 'deux vidéos de démo doivent être présentes (script + diagnostic) : ' + JSON.stringify(contenu.videos));
    assert.ok(contenu.videos.some(v => v.srcs.some(s => /demo-script\.(webm|mp4)/.test(s))), 'la démo de génération de script doit être présente : ' + JSON.stringify(contenu.videos));
    assert.ok(contenu.videos.some(v => v.srcs.some(s => /demo-sommaire\.(webm|mp4)/.test(s))), 'la démo de l\'analyse sommaire doit être présente : ' + JSON.stringify(contenu.videos));
    contenu.videos.forEach(v => {
      assert.equal(v.autoplay, true, 'chaque vidéo de démo doit être en autoplay : ' + JSON.stringify(v));
      assert.equal(v.muted, true, 'chaque vidéo de démo doit être muette (autoplay navigateur l\'exige de toute façon) : ' + JSON.stringify(v));
      assert.equal(v.loop, true, 'chaque vidéo de démo doit boucler : ' + JSON.stringify(v));
      assert.equal(v.playsInline, true, 'chaque vidéo de démo doit jouer inline (pas de plein écran forcé sur mobile) : ' + JSON.stringify(v));
      // Jamais de pavé blanc pendant le chargement (retour propriétaire,
      // iOS Safari) : une affiche doit toujours être déclarée.
      assert.ok(/poster-(script|sommaire)\.jpg/.test(v.poster), 'chaque vidéo de démo doit avoir une affiche (poster) : ' + JSON.stringify(v));
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

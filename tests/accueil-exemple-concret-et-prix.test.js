// Retour du propriétaire, après audit du parcours d'un visiteur non connecté
// ("en tant que créateur exigeant, saurais-tu quoi faire et t'abonner ?") :
// la page d'accueil n'avait ni exemple concret de génération, ni prix avant
// l'argumentaire "Pourquoi Scriptura". Ajout d'une section "Exemple concret"
// entre "Comment ça marche" et "Pourquoi Scriptura", plus un prix teaser qui
// renvoie vers la section tarifs complète.
//
// Historique (résumé) : les deux démos "En pratique" ont été une <video> en
// boucle, avec plusieurs correctifs successifs contre un pavé blanc
// récurrent (affiche séparée, Cache-Control, mémoire tampon), sans jamais
// l'éliminer complètement malgré chaque cause corrigée étant réelle. Cause
// finale trouvée en examinant le fichier vidéo lui-même image par image :
// les 10 à 11 premières secondes des DEUX enregistrements captaient un
// écran vide (l'app n'avait pas fini de charger côté capture), pas un
// problème de lecture, de réseau ou de rendu. Décision propriétaire :
// remplacer la <video> par un diaporama de vraies captures fixes de l'app
// (démarrerDiaporamaExemples, js/app.js), tirées des mêmes enregistrements
// mais uniquement des instants où il y a vraiment quelque chose à montrer.
// Une <img> n'a par construction aucun des à-côtés spécifiques au rendu
// vidéo sur Safari (affiche, préchargement, décodage, mémoire tampon), le
// type d'élément le plus fiable du web : plus de classe de bug possible.
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

    // Deux diaporamas de démo (script + diagnostic), pas une maquette HTML
    // statique : de vraies captures de l'app, plusieurs images par
    // diaporama listées dans data-frames.
    const contenu = await page.evaluate(() => {
      const ex = document.querySelector('.example');
      const diaporamas = Array.from(ex.querySelectorAll('img.example-slideshow')).map(img => ({
        src: img.getAttribute('src') || '',
        frames: (img.dataset.frames || '').split(',').filter(Boolean),
        loading: img.getAttribute('loading') || ''
      }));
      return {
        note: ex.querySelector('.example-note')?.textContent || '',
        diaporamas
      };
    });
    assert.ok(/FCFA/.test(contenu.note), 'le prix doit être visible dans la section exemple : ' + contenu.note);
    assert.equal(contenu.diaporamas.length, 2, 'deux diaporamas de démo doivent être présents (script + diagnostic) : ' + JSON.stringify(contenu.diaporamas));
    assert.ok(contenu.diaporamas.some(d => d.frames.some(f => /slide-script-\d+\.webp/.test(f))), 'le diaporama de génération de script doit être présent : ' + JSON.stringify(contenu.diaporamas));
    assert.ok(contenu.diaporamas.some(d => d.frames.some(f => /slide-sommaire-\d+\.webp/.test(f))), 'le diaporama de l\'analyse sommaire doit être présent : ' + JSON.stringify(contenu.diaporamas));
    contenu.diaporamas.forEach(d => {
      assert.ok(d.frames.length >= 2, 'un diaporama doit avoir au moins 2 images pour qu\'il y ait un vrai effet : ' + JSON.stringify(d));
      assert.ok(d.frames.includes(d.src), 'la première image affichée doit faire partie de la liste des images du diaporama : ' + JSON.stringify(d));
      assert.equal(d.loading, 'eager', 'la première image doit charger tout de suite (visible dès l\'arrivée sur la page) : ' + JSON.stringify(d));
    });

    // Le diaporama démarre vraiment à l'entrée dans l'écran
    // (IntersectionObserver, demarrerDiaporamaExemples, js/app.js) : après
    // avoir scrollé la section en vue et attendu un cycle, l'image affichée
    // doit avoir changé.
    await page.locator('.example').scrollIntoViewIfNeeded();
    const premiereImage = await page.evaluate(() => document.querySelector('.example img.example-slideshow').getAttribute('src'));
    await page.waitForFunction(
      (premiere) => document.querySelector('.example img.example-slideshow').getAttribute('src') !== premiere,
      premiereImage,
      { timeout: 3000 }
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

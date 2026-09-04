// Demande du propriétaire : "quand on clique sur n'importe quel bouton
// télécharger de l'app, que s'ouvre la fenêtre de partage où on voit
// enregistrer l'image, enregistrer dans Fichiers, etc."
//
// LE BESOIN EST RÉEL, pas cosmétique. Sur iPhone, un téléchargement classique
// atterrit dans les fichiers du navigateur, où beaucoup de créateurs ne le
// retrouvent jamais. La feuille de partage native est le SEUL chemin qui
// propose "Enregistrer l'image" (donc la pellicule), "Enregistrer dans
// Fichiers", AirDrop, Messages.
//
// DEUX PIÈGES, que ces tests verrouillent tous les deux :
//
// 1. LE GESTE UTILISATEUR. Safari iOS retire l'autorisation de partage natif
//    si une attente asynchrone a lieu entre le clic et l'appel à
//    navigator.share. Composer la slide AU MOMENT du clic ferait donc perdre
//    le geste, et le créateur retomberait silencieusement sur un
//    téléchargement classique. Les slides déjà affichées à l'écran sont donc
//    mémorisées, et le téléchargement les réutilise SANS attendre.
//
// 2. L'ANNULATION. Si le créateur ferme la feuille de partage, l'API lève une
//    AbortError. Retomber alors sur un téléchargement classique lui
//    enregistrerait de force le fichier qu'il vient de refuser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CARROUSEL_IA = {
  titre: 'Test partage',
  direction_visuelle: 'sobre',
  slides: [
    { gabarit: 'couverture', eyebrow: 'Thème', titre: 'Un titre de couverture', titre_accent: 'couverture', bandeau: 'Un bandeau.', visuel: 'v' },
    { gabarit: 'contenu', badge: 'Point 1 / 2', emoji: '💧', titre: 'Un point du milieu', points: [{ emoji: '💧', titre: 'Une carte', texte: 'Un texte de carte assez court.' }], bandeau: 'Une chute.', visuel: 'v' },
    { gabarit: 'recap', eyebrow: 'À toi', titre: 'Commente pour recevoir la suite', titre_accent: 'Commente', points: [{ emoji: '💬', titre: 'Commente', texte: 'Je réponds.' }], bandeau: 'Fin.', visuel: 'v' }
  ],
  legende: 'Et toi ?', hashtags: ['#test'], son_suggere: 'nappe calme'
};

// Simule un téléphone qui gère le partage de fichiers, et espionne LES DEUX
// chemins : la feuille de partage et le téléchargement classique. C'est en
// vérifiant qu'un seul des deux se produit qu'on prouve le comportement.
const poserEspions = (page) => page.evaluate(() => {
  window.__partages = [];
  window.__telechargements = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    window.__partages.push({ nb: d.files.length, noms: d.files.map(f => f.name), types: d.files.map(f => f.type) });
  };
  const creerOrigine = document.createElement.bind(document);
  document.createElement = (t) => {
    const el = creerOrigine(t);
    if (t === 'a') {
      const clicOrigine = el.click.bind(el);
      el.click = () => { if (el.download) window.__telechargements.push(el.download); clicOrigine(); };
    }
    return el;
  };
});

async function carrouselPret(page, baseUrl) {
  await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(CARROUSEL_IA) }] }) });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'PART' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(300);
  await poserEspions(page);
  await page.evaluate(() => chooseMode('carrousel'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('carrouselSujet').value = 'test partage';
    return genererCarrousel();
  });
  // Les aperçus se composent en arrière-plan : on attend qu'ils soient tous
  // là, c'est justement ce qui rend le téléchargement synchrone.
  await page.waitForFunction(() => {
    const v = Array.from(document.querySelectorAll('#carrouselResults .car-slide-visuel'));
    return v.length > 0 && v.every(x => x.querySelector('img'));
  }, null, { timeout: 20000 });
}

test('télécharger une slide ouvre la feuille de partage, sans aucune attente', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await carrouselPret(page, baseUrl);

    const vu = await page.evaluate(() => {
      window.__partages = []; window.__telechargements = [];
      // Appelé SANS await, exactement comme le fait le bouton : si la
      // fonction attendait quoi que ce soit avant de partager, le geste
      // serait perdu sur iPhone et rien ne se passerait ici.
      telechargerSlideCarrousel(0);
      return new Promise(r => setTimeout(() => r({
        partages: window.__partages,
        telechargements: window.__telechargements
      }), 400));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.partages.length, 1,
      'REGRESSION : la feuille de partage ne s\'ouvre pas, le fichier atterrit dans les fichiers du navigateur où le créateur ne le retrouve pas');
    assert.equal(vu.partages[0].nb, 1, 'une seule slide partagée');
    assert.match(vu.partages[0].noms[0], /slide-01\.png$/, 'nommée clairement : ' + vu.partages[0].noms[0]);
    assert.equal(vu.partages[0].types[0], 'image/png',
      'le type doit être renseigné, sinon iOS ne propose pas "Enregistrer l\'image"');
    assert.deepEqual(vu.telechargements, [],
      'et surtout PAS de téléchargement classique en plus : le créateur recevrait le fichier deux fois');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('télécharger toutes les slides n\'ouvre QU\'UNE feuille, avec tous les fichiers', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await carrouselPret(page, baseUrl);

    const vu = await page.evaluate(() => {
      window.__partages = []; window.__telechargements = [];
      telechargerToutesSlidesCarrousel();
      return new Promise(r => setTimeout(() => r({
        partages: window.__partages,
        telechargements: window.__telechargements
      }), 800));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.partages.length, 1,
      'REGRESSION : une feuille de partage PAR SLIDE serait impraticable, et le navigateur bloquerait les suivantes dès la première');
    assert.equal(vu.partages[0].nb, CARROUSEL_IA.slides.length,
      'toutes les slides dans la même feuille ("Enregistrer 3 images" sur iOS) : ' + vu.partages[0].nb);
    const noms = vu.partages[0].noms;
    assert.equal(new Set(noms).size, noms.length, 'et chacune porte un nom distinct : ' + JSON.stringify(noms));
    assert.deepEqual(vu.telechargements, [], 'aucun téléchargement classique en doublon');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('annuler la feuille de partage n\'enregistre RIEN de force', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await carrouselPret(page, baseUrl);

    const vu = await page.evaluate(() => {
      window.__partages = []; window.__telechargements = [];
      // L'utilisateur ferme la feuille : l'API lève une AbortError.
      navigator.share = async () => { const e = new Error('annulé'); e.name = 'AbortError'; throw e; };
      telechargerSlideCarrousel(1);
      return new Promise(r => setTimeout(() => r({ telechargements: window.__telechargements }), 400));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(vu.telechargements, [],
      'REGRESSION : retomber sur un téléchargement classique après une annulation enregistrerait de force le fichier que le créateur vient de refuser');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('sur ordinateur, sans partage natif, le téléchargement classique reprend la main', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await carrouselPret(page, baseUrl);

    const vu = await page.evaluate(() => {
      window.__partages = []; window.__telechargements = [];
      delete navigator.canShare;
      navigator.share = undefined;
      telechargerSlideCarrousel(2);
      return new Promise(r => setTimeout(() => r({ telechargements: window.__telechargements }), 400));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.telechargements.length, 1,
      'REGRESSION : sans repli, le bouton ne ferait plus rien du tout sur un ordinateur de bureau');
    assert.match(vu.telechargements[0], /slide-03\.png$/, vu.telechargements[0]);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// telechargerBlob est le point de passage de NEUF boutons de l'app (montage
// vidéo, images du montage, voix off, transcription, vidéo TikTok…). Le
// modifier les couvre tous d'un coup : ce test vérifie le passage lui-même,
// pour que la promesse "n'importe quel bouton télécharger" tienne au-delà du
// seul carrousel.
test('telechargerBlob ouvre la feuille de partage pour TOUS les boutons de l\'app', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'BLOB' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);
    await poserEspions(page);

    const vu = await page.evaluate(() => {
      window.__partages = []; window.__telechargements = [];
      // Un fichier de chaque nature réellement téléchargée par l'app.
      telechargerBlob(new Blob(['texte'], { type: 'text/plain' }), 'transcription-tiktok.txt');
      telechargerBlob(new Blob([new Uint8Array([0, 1, 2])], { type: 'video/mp4' }), 'scriptura-montage.mp4');
      telechargerBlob(new Blob([new Uint8Array([3, 4])], { type: 'audio/mpeg' }), 'scriptura-voix-off.mp3');
      return new Promise(r => setTimeout(() => r({
        partages: window.__partages,
        telechargements: window.__telechargements
      }), 500));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.partages.length, 3, 'les trois passent par la feuille de partage : ' + vu.partages.length);
    assert.deepEqual(vu.partages.map(p => p.noms[0]),
      ['transcription-tiktok.txt', 'scriptura-montage.mp4', 'scriptura-voix-off.mp3'],
      'chacun garde son nom de fichier');
    assert.deepEqual(vu.partages.map(p => p.types[0]),
      ['text/plain', 'video/mp4', 'audio/mpeg'],
      'REGRESSION : sans le type, iOS ne sait pas proposer "Enregistrer la vidéo" ou "Enregistrer l\'image"');
    assert.deepEqual(vu.telechargements, [], 'aucun doublon en téléchargement classique');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

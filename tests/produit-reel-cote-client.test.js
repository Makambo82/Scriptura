// Le maillon client de la photo produit (voir tests/produit-reel-dans-les-
// images.test.js pour le maillon serveur). C'est ici qu'une régression
// passerait SANS BRUIT : si le marquage d'un plan se perd en route, ou si la
// photo n'est plus jointe à l'appel, l'app ne casse pas, ne dit rien, et
// livre simplement des images sans le produit. Le créateur ne le découvre
// qu'en regardant ses images, c'est-à-dire trop tard.
//
// Les trois fonctions verrouillées ici sont les trois endroits où la chaîne
// peut se rompre :
//   photoProduitPourVisuels()  la photo est-elle utilisable comme référence
//   corpsImagesMontage()       part-elle avec les bons plans
//   corpsImageCarrousel()      idem côté carrousel
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage();
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  return page;
}

test('la photo produit ne part que si c\'est une IMAGE, jamais un PDF', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      const essai = (fichier) => {
        venteFichier = fichier;
        const p = photoProduitPourVisuels();
        return p ? p.mediaType : null;
      };
      return {
        photo: essai({ base64: 'AAAA', mediaType: 'image/jpeg', nom: 'produit.jpg' }),
        png: essai({ base64: 'AAAA', mediaType: 'image/png', nom: 'produit.png' }),
        pdf: essai({ base64: 'JVBER', mediaType: 'application/pdf', nom: 'brochure.pdf' }),
        rien: essai(null)
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(r.photo, 'image/jpeg', 'une photo de produit est utilisable');
    assert.equal(r.png, 'image/png', 'un PNG aussi');
    assert.equal(r.pdf, null,
      'REGRESSION : un PDF est retenu comme photo de produit. Une brochure nourrit très bien '
      + 'l\'écriture du script, mais elle ne se met pas dans la main de quelqu\'un : les plans seraient '
      + 'marqués « montre le produit » sans qu\'aucune photo ne parte, et le modèle inventerait un objet.');
    assert.equal(r.rien, null, 'sans fichier, rien à envoyer');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le montage joint la photo aux plans marqués, et à eux seuls', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      venteFichier = { base64: 'PHOTOPRODUIT', mediaType: 'image/jpeg', nom: 'montre.jpg' };
      const marque = { text: 'plan 1', visuel: 'a wrist wearing the product 9:16', produit: true };
      const ordinaire = { text: 'plan 2', visuel: 'a city at dawn 9:16', produit: false };
      const avec = corpsImagesMontage(['p1', 'p2'], '9:16', [marque, ordinaire]);
      const sansAucunMarquage = corpsImagesMontage(['p2'], '9:16', [ordinaire]);
      venteFichier = null;
      const sansPhoto = corpsImagesMontage(['p1'], '9:16', [marque]);
      return { avec, sansAucunMarquage, sansPhoto };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(r.avec.produit && r.avec.produit.base64 === 'PHOTOPRODUIT',
      'REGRESSION : la photo du produit ne part plus avec le lot. Toute la fonctionnalité tient à ça.');
    assert.deepEqual(r.avec.avecProduit, [true, false],
      'REGRESSION : le marquage envoyé ne correspond plus aux plans. Reçu : '
      + JSON.stringify(r.avec.avecProduit));

    assert.ok(!r.sansAucunMarquage.produit,
      'REGRESSION : la photo part alors qu\'AUCUN plan ne montre le produit. C\'est de l\'argent dépensé '
      + 'et une requête alourdie pour rien.');
    assert.ok(!r.sansPhoto.produit && !r.sansPhoto.avecProduit,
      'REGRESSION : un plan marqué part sans photo. Le prompt réclame « le produit de l\'image de '
      + 'référence » : sans référence, le modèle en invente un, et le créateur reçoit un faux produit.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le carrousel suit exactement la même règle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      carrouselVenteFichier = { base64: 'PHOTOSLIDE', mediaType: 'image/png', nom: 'creme.png' };
      const avec = corpsImageCarrousel(['p'], [{ produit: true }]);
      const sans = corpsImageCarrousel(['p'], [{ produit: false }]);
      carrouselVenteFichier = { base64: 'JVBER', mediaType: 'application/pdf', nom: 'ebook.pdf' };
      const pdf = corpsImageCarrousel(['p'], [{ produit: true }]);
      carrouselVenteFichier = null;
      return { avec, sans, pdf, usage: avec.usage };
    });

    assert.equal(r.usage, 'carrousel', 'le budget images du carrousel reste bien séparé de celui du montage');
    assert.ok(r.avec.produit && r.avec.produit.base64 === 'PHOTOSLIDE',
      'REGRESSION : une slide marquée part sans la photo du produit');
    assert.deepEqual(r.avec.avecProduit, [true]);
    assert.ok(!r.sans.produit, 'REGRESSION : la photo part sur une slide non marquée');
    assert.ok(!r.pdf.produit,
      'REGRESSION : un PDF part comme référence côté carrousel alors que le mode Script s\'en protège. '
      + 'Une garde qui n\'existe que d\'un côté finit toujours par manquer de l\'autre.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// « L'utilisateur peut charger une photo de son produit qui n'est pas sur
// fond blanc, ni noir, ni transparent. C'est à toi de savoir détecter le
// produit à vendre. » La détection est faite par l'IA qui regarde déjà la
// photo pour deviner la niche : aucun appel de plus, aucun coût de plus. Ce
// qu'elle reconnaît est ATTACHÉ AU FICHIER, pour que l'identification suive
// la photo partout où elle circule.
test('ce que l\'IA reconnaît sur la photo reste attaché à la photo', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      const photo = { base64: 'AAAA', mediaType: 'image/jpeg', nom: 'bracelet.jpg' };
      poserIdentificationProduit(photo, {
        niche: 'Beauté & Mode',
        produit_visuel: 'a brown leather bracelet',
        usages: ["worn on a woman's wrist", 'laid on a wooden table', '', null, 'held in a hand', 'un cinquième']
      });
      // Un document : rien à montrer en usage, donc rien à nommer.
      const doc = { base64: 'JVBER', mediaType: 'application/pdf', nom: 'ebook.pdf' };
      poserIdentificationProduit(doc, { niche: 'Business & Entrepreneuriat', produit_visuel: '', usages: [] });
      // Une réponse abîmée ne doit jamais casser le chargement du fichier.
      const cassee = { base64: 'BBBB', mediaType: 'image/png', nom: 'x.png' };
      poserIdentificationProduit(cassee, { niche: 'Autre' });
      return {
        nom: photo.produitNom, usages: photo.produitUsages,
        docNom: doc.produitNom, docUsages: doc.produitUsages,
        casseeNom: cassee.produitNom, casseeUsages: cassee.produitUsages
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(r.nom, 'a brown leather bracelet',
      'REGRESSION : le produit reconnu ne suit plus la photo. Sans son nom, le générateur d\'images ne '
      + 'sait pas quel objet garder dans une photo prise sur un sol d\'atelier.');
    assert.equal(r.usages.length, 4,
      'REGRESSION : ' + r.usages.length + ' usages retenus. Il en faut au plus 4, et jamais de valeur '
      + 'vide : une consigne vide dans une liste fait écrire une scène bancale au rédacteur.');
    assert.ok(r.usages.every(u => u && u.trim()), 'aucune situation vide ne passe : ' + JSON.stringify(r.usages));
    assert.equal(r.docNom, '', 'un ebook n\'a pas de produit à montrer en usage');
    assert.deepEqual(r.docUsages, []);
    assert.equal(r.casseeNom, '',
      'REGRESSION : une réponse sans les champs attendus doit laisser l\'identification vide, pas casser');
    assert.deepEqual(r.casseeUsages, []);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le rédacteur reçoit le produit nommé et ses vraies situations d\'usage', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => ({
      sans: regleProduitReelVisuels(null),
      nu: regleProduitReelVisuels(true),
      identifie: regleProduitReelVisuels({
        produitNom: 'a white cotton shirt',
        produitUsages: ['worn by a man walking in the street', 'held on a hanger']
      })
    }));

    assert.equal(r.sans, '', 'sans produit, aucune consigne n\'alourdit le prompt');
    assert.ok(r.nu.includes('MARQUE 2 à 4 plans'),
      'sans identification, la règle reste entièrement valable : elle parle du produit sans le nommer');
    assert.ok(!/CE QU'EST LE PRODUIT/.test(r.nu),
      'REGRESSION : une ligne « ce qu\'est le produit » part vide au rédacteur');
    assert.match(r.identifie, /a white cotton shirt/,
      'REGRESSION : le produit reconnu n\'arrive plus au rédacteur, qui écrira une mise en scène '
      + 'générique au lieu d\'une chemise portée');
    assert.match(r.identifie, /worn by a man walking in the street/,
      'REGRESSION : les situations d\'usage réelles n\'arrivent plus au rédacteur. C\'est ce qui fait la '
      + 'différence entre « une chemise » et « une chemise portée par un homme dans la rue ».');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le nom du produit part avec la photo, des deux côtés', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      venteFichier = { base64: 'P', mediaType: 'image/jpeg', produitNom: 'a small white cream tube' };
      const montage = corpsImagesMontage(['p'], '9:16', [{ produit: true }]);
      carrouselVenteFichier = { base64: 'C', mediaType: 'image/png', produitNom: 'a brown leather bracelet' };
      const carrousel = corpsImageCarrousel(['p'], [{ produit: true }]);
      venteFichier = null; carrouselVenteFichier = null;
      return { montage: montage.produit.nom, carrousel: carrousel.produit.nom };
    });
    assert.equal(r.montage, 'a small white cream tube',
      'REGRESSION : le montage envoie la photo sans le nom du produit');
    assert.equal(r.carrousel, 'a brown leather bracelet',
      'REGRESSION : le carrousel envoie la photo sans le nom du produit. Une garde qui n\'existe que '
      + 'd\'un côté finit toujours par manquer de l\'autre.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Manque relevé au PREMIER VRAI TEST du propriétaire : le marquage existait
// bien en mémoire, mais RIEN ne l'affichait. Impossible pour lui de vérifier
// que sa photo allait servir, impossible de choisir sur quelle slide dépenser
// une image de son quota. Une fonctionnalité invisible est une fonctionnalité
// qu'on croit cassée au premier doute.
test('l\'app dit sur quelles slides et quels plans le produit va apparaître', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      carrouselFormat = '4:5';
      carrouselQuotaImages = { illimite: true, used: 0, limite: 99 };
      carrouselVenteFichier = { base64: 'A', mediaType: 'image/png', produitNom: 'a white gel tube' };
      carrouselResultat = normaliserResultatCarrousel({
        titre: 'T', direction_visuelle: 'sobre',
        slides: [
          { numero: 1, gabarit: 'couverture', titre: 'Sans produit', visuel: 'un homme frustré' },
          { numero: 2, gabarit: 'contenu', titre: 'Avec produit', visuel: 'the product in a hand', produit: true }
        ]
      });
      carrouselImages = [null, null];
      renderCarrousel();
      const avecPhoto = Array.from(document.querySelectorAll('.car-slide-produit')).map(e => e.textContent.trim());
      carrouselVenteFichier = null;
      renderCarrousel();
      const sansPhoto = Array.from(document.querySelectorAll('.car-slide-produit'))
        .map(e => ({ classe: e.className, texte: e.textContent.trim() }));

      venteFichier = { base64: 'A', mediaType: 'image/jpeg', produitNom: 'a white gel tube' };
      ouvrirMontage([
        { text: 'p1', visuel: 'a bathroom 9:16' },
        { text: 'p2', visuel: 'the product in a hand 9:16', produit: true },
        { text: 'p3', visuel: 'a beach 9:16' },
        { text: 'p4', visuel: 'the product on a table 9:16', produit: true }
      ], null);
      const note = document.getElementById('montageNoteProduit');
      const montageAvec = { affiche: note.style.display !== 'none', texte: note.textContent };
      venteFichier = null;
      renderMontageEtat();
      const montageSans = { classe: note.className, texte: note.textContent };
      ouvrirMontage([{ text: 'p1', visuel: 'a beach 9:16' }], null);
      const montageAucun = note.style.display;
      return { avecPhoto, sansPhoto, montageAvec, montageSans, montageAucun };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    assert.equal(r.avecPhoto.length, 1,
      'REGRESSION : ' + r.avecPhoto.length + ' slide(s) annoncée(s). Une seule est marquée, et une '
      + 'slide ordinaire ne doit RIEN annoncer.');
    assert.match(r.avecPhoto[0], /apparaîtra sur cette slide/,
      'REGRESSION : la slide marquée ne dit plus que le produit y apparaîtra : ' + r.avecPhoto[0]);
    assert.match(r.avecPhoto[0], /a white gel tube/,
      'le produit reconnu est nommé, c\'est ce qui permet de vérifier que l\'app a bien vu LE bon objet');

    assert.match(r.sansPhoto[0].classe, /absent/,
      'REGRESSION : sans photo chargée, le message doit changer de ton, pas promettre la même chose');
    assert.match(r.sansPhoto[0].texte, /aucune photo/,
      'REGRESSION : le créateur n\'est plus prévenu que sa photo manque. Il paierait une image pour '
      + 'découvrir après coup que son produit n\'y est pas.');

    assert.equal(r.montageAvec.affiche, true, 'le panneau de montage annonce les plans concernés');
    assert.match(r.montageAvec.texte, /les plans 2 et 4/,
      'REGRESSION : les plans ne sont plus énumérés correctement (« 2 et 4 », jamais « 2, 4 ») : '
      + r.montageAvec.texte);
    assert.match(r.montageSans.classe, /absent/, 'même avertissement côté montage quand la photo manque');
    assert.equal(r.montageAucun, 'none',
      'REGRESSION : la ligne s\'affiche sur un montage SANS aucun plan produit. Hors objectif Ventes, '
      + 'rien ne doit apparaître.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Constat du propriétaire au deuxième test, celui qui a MARCHÉ : « sur six
// slides, le produit apparaît seulement sur un seul fond, est-ce que c'est
// bon ? » L'emplacement était le bon (la slide Solution), mais une seule est
// peu pour un contenu qui vend : c'est sur la DERNIÈRE, celle qui demande
// l'action, que le lecteur décide.
//
// Le vrai risque, lui, est le ZÉRO : un modèle qui oublie de marquer, et le
// créateur obtient un carrousel sans son produit alors qu'il a joint sa
// photo, sans qu'aucun message ne le dise. Une promesse produit ne peut pas
// reposer sur une consigne de prompt.
test('au moins une slide et un plan montrent le produit, même si le modèle oublie', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(async () => {
      const troisSlides = () => ({
        titre: 'T', direction_visuelle: 'sobre',
        slides: [
          { numero: 1, gabarit: 'couverture', titre: 'A', visuel: 'v1' },
          { numero: 2, gabarit: 'contenu', titre: 'B', visuel: 'v2' },
          { numero: 3, gabarit: 'recap', titre: 'C', visuel: 'v3' }
        ]
      });
      // Photo chargée, modèle qui n'a marqué AUCUNE slide.
      carrouselVenteFichier = { base64: 'A', mediaType: 'image/png', produitNom: 'a gel tube' };
      const rattrape = normaliserResultatCarrousel(troisSlides()).slides.map(s => !!s.produit);
      // Photo chargée, modèle qui a marqué la slide 2 : on ne redistribue rien.
      const choisi = troisSlides(); choisi.slides[1].produit = true;
      const respecte = normaliserResultatCarrousel(choisi).slides.map(s => !!s.produit);
      // Aucune photo : aucun marquage, sinon on promettrait un produit absent.
      carrouselVenteFichier = null;
      const sansPhoto = normaliserResultatCarrousel(troisSlides()).slides.map(s => !!s.produit);

      // Même filet côté storyboard du mode Script.
      window.callAI = async () => JSON.stringify({ visuels: ['p1 9:16', 'p2 9:16'] });
      const plansAvec = [{ text: 'a' }, { text: 'b' }];
      await genererVisuelsParLots(plansAvec, 'TikTok', null, { produitNom: 'a gel tube' });
      const plansSans = [{ text: 'a' }, { text: 'b' }];
      await genererVisuelsParLots(plansSans, 'TikTok', null, false);
      return {
        rattrape, respecte, sansPhoto,
        planAvec: plansAvec.map(p => !!p.produit), planSans: plansSans.map(p => !!p.produit)
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(r.rattrape, [false, false, true],
      'REGRESSION : aucune slide ne montre le produit alors qu\'une photo est chargée. Le créateur a '
      + 'joint sa photo pour ça, et rien ne lui dirait qu\'elle n\'a servi à rien. Le rattrapage vise la '
      + 'DERNIÈRE slide, celle qui demande l\'action. Obtenu : ' + JSON.stringify(r.rattrape));
    assert.deepEqual(r.respecte, [false, true, false],
      'REGRESSION : le filet écrase le choix du rédacteur. Il rattrape le zéro, il ne redistribue pas.');
    assert.deepEqual(r.sansPhoto, [false, false, false],
      'REGRESSION : une slide est marquée sans photo chargée. On promettrait un produit qui ne peut pas '
      + 'apparaître, et l\'image partirait sans référence.');
    assert.deepEqual(r.planAvec, [false, true],
      'REGRESSION : même oubli côté storyboard du mode Script, non rattrapé. Un défaut corrigé d\'un '
      + 'seul côté finit toujours par ressortir de l\'autre.');
    assert.deepEqual(r.planSans, [false, false], 'sans produit, aucun plan n\'est marqué');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un storyboard sans produit ne marque jamais un plan', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    // Le modèle peut très bien renvoyer un plan marqué alors qu'aucune photo
    // n'a été chargée (il suit ses habitudes, pas notre état). Le marquage
    // doit alors être ignoré, sinon le prompt réclamerait une référence
    // inexistante.
    const r = await page.evaluate(async () => {
      window.callAI = async () => JSON.stringify({
        visuels: [{ prompt: 'a hand holding the product shown in the reference image 9:16', produit: true }]
      });
      const sansProduit = [{ text: 'un plan' }];
      await genererVisuelsParLots(sansProduit, 'TikTok', null, false);
      const avecProduit = [{ text: 'un plan' }];
      await genererVisuelsParLots(avecProduit, 'TikTok', null, true);
      return { sans: !!sansProduit[0].produit, avec: !!avecProduit[0].produit };
    });

    assert.equal(r.sans, false,
      'REGRESSION : un plan est marqué « montre le produit » alors qu\'aucune photo n\'a été chargée. '
      + 'Le prompt demanderait le produit d\'une image de référence qui n\'existe pas.');
    assert.equal(r.avec, true,
      'REGRESSION : le marquage du modèle est perdu alors qu\'une photo est bien là. Sans lui, aucune '
      + 'image ne montrera jamais le produit du créateur.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

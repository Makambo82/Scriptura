// Décision produit du propriétaire : ajouter le format CARROUSEL (les
// publications à slides qu'on fait défiler du doigt), avec un curseur de 6 à
// 15 slides, la consigne visuelle de chaque slide, et la génération des
// images à la demande, dans la limite du plan.
//
// CE QUI EST VERROUILLÉ ICI, et pourquoi chaque point compte :
//
// 1. Le carrousel est un MODE À PART, pas une troisième option de "Format"
//    dans le mode Script. Un carrousel n'a pas de durée : greffé sur le
//    pipeline vidéo, il aurait hérité des cibles de mots par durée, du
//    plafond de secondes par bloc et d'une "Rétention estimée" calculée
//    contre une cible qui ne veut rien dire pour lui.
//
// 2. LE SCORE EST ENTIÈREMENT DÉTERMINISTE ET NE COÛTE RIEN. Aucun juge IA
//    n'est appelé, contrairement au Script et au Récit : tout ce qui fait la
//    performance d'un carrousel se COMPTE. Le pilier du produit est donc
//    respecté sans dépenser un seul token pour l'évaluation, et deux fois
//    les mêmes slides donnent deux fois le même score.
//
// 3. LE BUDGET D'IMAGES EST SÉPARÉ de celui du montage vidéo (décision du
//    propriétaire, 15 en Creator, 40 en Pro). Partagés, un carrousel de 15
//    slides aurait mangé 75% des 20 images mensuelles d'un Creator, le
//    laissant arbitrer entre deux fonctions qu'il a déjà payées.
//
// 4. LES IMAGES SONT GÉNÉRÉES SANS AUCUN TEXTE. Les modèles d'images écrivent
//    des lettres tordues et des fautes dès qu'on leur demande une phrase : le
//    texte est posé par-dessus par le code. Une régression ici rendrait
//    chaque slide inutilisable, et de façon silencieuse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CARROUSEL_IA = {
  titre: 'Les erreurs de budget',
  analyse: 'Un angle concret sur une douleur quotidienne.',
  direction_visuelle: 'photographie sobre, lumière rasante, tons chauds',
  slides: [
    { numero: 1, role: 'hook', texte: '3 erreurs qui ruinent ton budget', visuel: 'un portefeuille vide posé sur une table en bois' },
    { numero: 2, role: 'corps', texte: '1. Tu paies tes abonnements sans les compter…', visuel: 'une pile de tickets de caisse' },
    { numero: 3, role: 'corps', texte: '2. Tu épargnes ce qui reste, jamais l\'inverse…', visuel: 'une tirelire en contre-jour' },
    { numero: 4, role: 'corps', texte: '3. Tu confonds revenu et argent disponible…', visuel: 'un carnet de comptes ouvert' },
    { numero: 5, role: 'cta', texte: 'Enregistre ce carrousel et commente ton pire poste de dépense', visuel: 'une main qui referme un carnet' }
  ],
  legende: 'Et toi, tu es sur laquelle ?',
  hashtags: ['#budget', '#argent', '#finance'],
  son_suggere: 'une nappe calme et posée, sans percussion'
};

async function ouvrirCarrousel(page, baseUrl, gestionnaires) {
  await poserMocksReseau(page, gestionnaires || {});
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'CAR' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(300);
  await page.evaluate(() => chooseMode('carrousel'));
  await page.waitForTimeout(300);
}

test('le carrousel est un mode à part entière, avec son propre écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);

    const vu = await page.evaluate(() => ({
      ecranVisible: document.getElementById('carrouselFlow').style.display !== 'none',
      autresMasques: ['flow', 'storyFlow', 'ideasFlow'].every(id => document.getElementById(id).style.display === 'none'),
      dansListeUnique: TOUS_LES_ECRANS.includes('carrouselFlow'),
      boutonHero: !!Array.from(document.querySelectorAll('#heroModes .hero-mode-btn'))
        .find(b => /carrousel/i.test(b.textContent)),
      sujet: !!document.getElementById('carrouselSujet'),
      // Le mode Script n'a pas gagné une troisième option de format au
      // passage : le carrousel ne doit RIEN devoir au pipeline vidéo.
      formatsScript: Array.from(document.querySelectorAll('#format option')).map(o => o.value).filter(Boolean)
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.ecranVisible, true, 'le mode carrousel ouvre son propre écran');
    assert.equal(vu.autresMasques, true, 'et masque les autres, via masquerTousLesEcrans');
    assert.equal(vu.dansListeUnique, true,
      'REGRESSION : hors de TOUS_LES_ECRANS, l\'écran resterait visible sous le suivant');
    assert.equal(vu.boutonHero, true, 'le mode est proposé depuis l\'accueil');
    assert.ok(vu.sujet, 'le formulaire est là');
    assert.deepEqual(vu.formatsScript, ['Faceless', 'Face caméra'],
      'REGRESSION : un carrousel greffé sur le mode Script hériterait de la durée, des cibles de mots et d\'un score faux');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le curseur va de 6 à 15 slides, et c\'est bien sa valeur qui part dans le prompt', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let promptVu = '';
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: (body) => {
        promptVu = JSON.stringify(body.messages || '');
        return { content: [{ text: JSON.stringify(CARROUSEL_IA) }] };
      }
    });

    const bornes = await page.evaluate(() => {
      const c = document.getElementById('carrouselSlides');
      return { min: c.min, max: c.max, pas: c.step, defaut: c.value, type: c.type };
    });
    assert.equal(bornes.type, 'range', 'une ligne graduée qu\'on fait glisser, pas un menu');
    assert.equal(bornes.min, '6');
    assert.equal(bornes.max, '15');
    assert.equal(bornes.pas, '1');

    // On glisse jusqu'à 12 : l'affichage suit immédiatement.
    const affiche = await page.evaluate(() => {
      const c = document.getElementById('carrouselSlides');
      c.value = '12';
      c.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('carrouselSlidesVal').textContent;
    });
    assert.match(affiche, /12/, 'le nombre choisi s\'affiche : ' + affiche);

    // Et surtout, c'est ce nombre-là qui est demandé au modèle. Le piège
    // classique de l'app : un champ qui change à l'écran pendant qu'une
    // variable interne garde l'ancienne valeur.
    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'les erreurs de budget';
      return genererCarrousel();
    });
    await page.waitForTimeout(600);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(promptVu, /EXACTEMENT 12/,
      'REGRESSION : le curseur bougerait à l\'écran pendant que le prompt demanderait encore 8 slides');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le score est calculé par le CODE, jamais par l\'IA, et ne dépense aucun token', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let appelsIA = 0;
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: () => { appelsIA++; return { content: [{ text: JSON.stringify(CARROUSEL_IA) }] }; }
    });

    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'les erreurs de budget';
      return genererCarrousel();
    });
    await page.waitForTimeout(800);

    // UN SEUL appel : pas de critique, pas de réviseur, pas de juge. C'est
    // ce qui rend le mode carrousel nettement moins cher que le Script.
    assert.equal(appelsIA, 1,
      'REGRESSION : un juge ou un critique ajouté ici doublerait le coût du mode pour une note que le code sait déjà calculer seul');

    // Même entrée, même score, à chaque fois : c'est le pilier du produit.
    const vu = await page.evaluate(() => {
      const s1 = scoreCarrousel(carrouselResultat.slides, carrouselResultat.legende, carrouselResultat.hashtags);
      const s2 = scoreCarrousel(carrouselResultat.slides, carrouselResultat.legende, carrouselResultat.hashtags);
      // Un carrousel volontairement raté : slide 1 interminable, aucune
      // relance, deux idées par slide, aucun appel à l'action.
      const rate = scoreCarrousel([
        { texte: 'Dans cette publication je vais vous expliquer en détail toutes les différentes erreurs que beaucoup de personnes commettent très régulièrement quand elles gèrent leur budget mensuel' },
        { texte: 'La première chose. Il faut compter ses dépenses. Ensuite il faut aussi penser à épargner.' },
        { texte: 'Voilà c est tout pour aujourd hui.' }
      ], '', []);
      return { s1, identique: JSON.stringify(s1) === JSON.stringify(s2), rate: rate.global };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.identique, true,
      'REGRESSION : mêmes slides, même score, sinon le chiffre ne vaut rien');
    assert.ok(vu.s1.global >= 80, 'un bon carrousel est bien noté : ' + vu.s1.global);
    assert.ok(vu.rate <= 55,
      'et un carrousel raté est clairement sanctionné, sinon la note ne discrimine rien : ' + vu.rate);
    assert.ok(vu.s1.global - vu.rate >= 25,
      'l\'écart entre les deux doit rester net : ' + vu.s1.global + ' contre ' + vu.rate);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('chaque slide affiche son texte, son nombre de mots et sa consigne visuelle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: () => ({ content: [{ text: JSON.stringify(CARROUSEL_IA) }] })
    });

    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'les erreurs de budget';
      return genererCarrousel();
    });
    await page.waitForTimeout(800);

    const vu = await page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('#carrouselResults .car-slide'));
      return {
        nb: cartes.length,
        formulaireMasque: document.getElementById('carrouselForm').style.display === 'none',
        premiere: cartes[0] ? cartes[0].innerText : '',
        consignes: cartes.filter(c => /Visuel\s*:/.test(c.innerText)).length,
        mots: cartes.filter(c => /\d+\s+mots?/.test(c.innerText)).length,
        legende: document.getElementById('carrouselResults').innerText.includes('Et toi, tu es sur laquelle ?'),
        son: document.getElementById('carrouselResults').innerText.includes('nappe calme'),
        boutonsImage: document.querySelectorAll('#carrouselResults button[onclick^="genererImageCarrousel"]').length
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.nb, 5, 'une carte par slide');
    assert.equal(vu.formulaireMasque, true, 'le formulaire laisse la place au résultat');
    assert.match(vu.premiere, /3 erreurs qui ruinent ton budget/, 'le texte exact de la slide, prêt à copier');
    assert.equal(vu.consignes, 5, 'chaque slide porte sa consigne visuelle, c\'est le livrable demandé');
    assert.equal(vu.mots, 5,
      'et son nombre de mots : c\'est le seul défaut qu\'un créateur corrige en dix secondes, il doit se voir');
    assert.equal(vu.legende, true, 'la légende est là');
    assert.equal(vu.son, true, 'le son suggéré aussi, un carrousel muet perd sa portée');
    assert.equal(vu.boutonsImage, 5,
      'l\'image se génère SLIDE PAR SLIDE, jamais imposée en bloc : c\'est ce qui protège le quota');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'image est demandée SANS AUCUN TEXTE, et sur le budget carrousel', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: () => ({ content: [{ text: JSON.stringify(CARROUSEL_IA) }] })
    });

    let corpsImage = null;
    // 1x1 PNG transparent, suffisant : on teste la demande, pas le rendu.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await page.route('**/api/montage-media?action=images', async (route) => {
      try { corpsImage = JSON.parse(route.request().postData() || '{}'); } catch (e) { corpsImage = {}; }
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: [{ base64: PNG, mimeType: 'image/png' }], erreurs: [null] })
      });
    });

    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'les erreurs de budget';
      return genererCarrousel();
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => genererImageCarrousel(0));
    await page.waitForTimeout(600);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(corpsImage, 'la génération d\'image doit bien partir');
    assert.equal(corpsImage.usage, 'carrousel',
      'REGRESSION : sans ce marqueur, le carrousel viderait le quota d\'images du MONTAGE VIDÉO, que l\'abonné a payé pour autre chose');
    assert.equal(corpsImage.format, '9:16', 'format vertical, comme une slide TikTok');
    const prompt = String((corpsImage.prompts || [])[0] || '');
    assert.match(prompt, /portefeuille vide/, 'la consigne visuelle de la slide est bien transmise');
    assert.match(prompt, /Aucune lettre, aucun mot, aucun texte/,
      'REGRESSION : un modèle d\'images à qui on demande une phrase écrit des lettres tordues et des fautes, la slide devient inutilisable');
    assert.match(prompt, /photographie sobre/,
      'la direction artistique commune est reprise, sinon les slides n\'ont aucune cohérence entre elles');

    // L'image générée s'affiche bien à sa place.
    const affichee = await page.evaluate(() => {
      const img = document.querySelector('#carrouselResults .car-slide .car-slide-img');
      return !!img && img.getAttribute('src').startsWith('data:image');
    });
    assert.equal(affichee, true, 'et l\'image revenue s\'affiche sur sa slide');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une slide se télécharge finie, texte compris, même sans image générée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: () => ({ content: [{ text: JSON.stringify(CARROUSEL_IA) }] })
    });
    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'les erreurs de budget';
      return genererCarrousel();
    });
    await page.waitForTimeout(800);

    // Sans aucune image générée : la slide doit quand même être livrable, sur
    // fond sobre. C'est ce qui permet à un créateur à court de quota, ou qui
    // n'en veut pas, de publier quand même.
    const vu = await page.evaluate(async () => {
      const blob = await composerSlideCarrousel(0);
      return { type: blob.type, taille: blob.size };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.type, 'image/png');
    assert.ok(vu.taille > 2000,
      'REGRESSION : une image quasi vide signifierait que le texte n\'a pas été dessiné, et la slide serait inutilisable : ' + vu.taille + ' octets');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un carrousel rouvert depuis l\'historique retrouve ses slides et son score', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);

    const vu = await page.evaluate((contenu) => {
      // reopenGeneration prend un INDICE dans window._historyData, jamais
      // l'objet lui-même : on reproduit donc l'état réel de l'historique.
      window._historyData = [{ id: 'g1', mode: 'carrousel', titre: 'Les erreurs de budget', contenu }];
      reopenGeneration(0);
      const zone = document.getElementById('carrouselResults');
      return {
        ecran: document.getElementById('carrouselFlow').style.display !== 'none',
        slides: zone.querySelectorAll('.car-slide').length,
        // Les images ne sont pas réenregistrées (plusieurs Mo par carrousel) :
        // le tableau doit repartir vide À LA BONNE LONGUEUR, sinon une slide
        // afficherait l'image d'un carrousel précédent.
        imagesVides: carrouselImages.length === 5 && carrouselImages.every(i => i === null),
        score: zone.innerText.match(/(\d+)\s*\/\s*100/)
      };
    }, { resultat: CARROUSEL_IA, context: { niche: 'Finance & Argent', nbSlides: 5 } });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.ecran, true, 'le carrousel se rouvre sur son écran');
    assert.equal(vu.slides, 5, 'toutes ses slides sont là');
    assert.equal(vu.imagesVides, true,
      'REGRESSION : un tableau d\'images mal réinitialisé afficherait les images du carrousel précédent');
    assert.ok(vu.score, 'et le score est recalculé à la réouverture, jamais laissé vide');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

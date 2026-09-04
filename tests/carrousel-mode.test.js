// Décision produit du propriétaire : ajouter le format CARROUSEL (les
// publications à slides qu'on fait défiler du doigt), avec un curseur de 6 à
// 15 slides, un choix de format (1:1, 4:5, 9:16, 16:9), la consigne visuelle
// de chaque slide, et la génération des images à la demande dans la limite
// du plan.
//
// CE QUI EST VERROUILLÉ ICI, et pourquoi chaque point compte :
//
// 1. Le carrousel est un MODE À PART, pas une troisième option de "Format"
//    dans le mode Script. Un carrousel n'a pas de durée : greffé sur le
//    pipeline vidéo, il aurait hérité des cibles de mots par durée, du
//    plafond de secondes par bloc et d'une "Rétention estimée" calculée
//    contre une cible qui ne veut rien dire pour lui.
//
// 2. LA SLIDE EST UNE MISE EN PAGE, PAS UNE PHRASE SUR UNE PHOTO. Le
//    propriétaire a fourni des carrousels de référence après la première
//    version, et l'écart était sans appel. Le modèle rédige des slides
//    STRUCTURÉES (pastille, titre, définition, points, bandeau) et le code
//    les met en page sur canvas.
//
// 3. LE SCORE EST ENTIÈREMENT DÉTERMINISTE ET NE COÛTE RIEN. Aucun juge IA,
//    contrairement au Script et au Récit : tout ce qui fait la performance
//    d'un carrousel se COMPTE. Le pilier du produit est respecté sans
//    dépenser un seul token pour l'évaluation.
//
// 4. LE BUDGET D'IMAGES EST SÉPARÉ de celui du montage vidéo (15 en Creator,
//    40 en Pro). Partagés, un carrousel de 15 slides aurait mangé 75% des 20
//    images mensuelles d'un Creator.
//
// 5. LES IMAGES SONT GÉNÉRÉES SANS AUCUN TEXTE. Les modèles d'images écrivent
//    des lettres tordues dès qu'on leur demande une phrase : le texte est
//    posé par le code. Une régression ici rendrait chaque slide inutilisable,
//    et de façon silencieuse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CARROUSEL_IA = {
  titre: 'Compte ou marque',
  analyse: 'Un angle qui oppose deux statuts que tout le monde confond.',
  direction_visuelle: 'photographie sobre, lumière rasante, tons chauds',
  slides: [
    {
      numero: 1, gabarit: 'couverture',
      eyebrow: 'Entrepreneuriat digital', titre: 'Un compte qui vend n\'est pas une marque',
      titre_accent: 'marque', bandeau: 'Les 4 piliers qui transforment un compte en marque.',
      visuel: 'un portefeuille vide posé sur une table en bois'
    },
    {
      numero: 2, gabarit: 'contenu', badge: 'Pilier 1 / 3', emoji: '🎯',
      titre: 'Le positionnement clair',
      definition: 'Ce que tu es la seule à dire, de la façon dont tu le dis.',
      points: [
        { emoji: '🎯', titre: 'Trouve ton angle', texte: 'Pas "je parle d\'argent", mais "pour les mamans qui commencent".' },
        { emoji: '🚫', titre: 'Ce que tu refuses', texte: 'Une marque forte dit aussi non au contenu générique.' }
      ],
      bandeau: 'Un positionnement flou attire tout le monde et ne retient personne.',
      visuel: 'une boussole sur une table'
    },
    {
      numero: 3, gabarit: 'contenu', badge: 'Pilier 2 / 3', emoji: '📖',
      titre: 'Le storytelling personnel',
      definition: 'Montrer le parcours, pas seulement le résultat.',
      points: [{ emoji: '📖', titre: 'Partage tes débuts', texte: 'Les gens se connectent à ton parcours, pas à ta perfection.' }],
      bandeau: 'On ne s\'attache pas à un produit, on s\'attache à une histoire.',
      visuel: 'un carnet ouvert'
    },
    {
      numero: 4, gabarit: 'recap', eyebrow: 'Prochaine étape',
      titre: 'Ta première vente commence ici', titre_accent: 'première vente',
      points: [
        { emoji: '📌', titre: 'Épingle ce carrousel', texte: 'Les 3 prérequis sont dedans.' },
        { emoji: '💬', titre: 'Commente ton sujet', texte: 'Je te dis si c\'est viable.' }
      ],
      bandeau: 'Série Gagner de l\'argent sur TikTok.',
      visuel: 'une porte entrouverte vers la lumière'
    }
  ],
  legende: 'Tu es dans quelle catégorie ?',
  hashtags: ['#marque', '#tiktok', '#entrepreneuriat'],
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

async function genererDepuisMock(page) {
  await page.evaluate(() => {
    document.getElementById('carrouselSujet').value = 'compte contre marque';
    return genererCarrousel();
  });
  await page.waitForTimeout(900);
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
      return { min: c.min, max: c.max, pas: c.step, type: c.type };
    });
    assert.equal(bornes.type, 'range', 'une ligne graduée qu\'on fait glisser, pas un menu');
    assert.equal(bornes.min, '6');
    assert.equal(bornes.max, '15');
    assert.equal(bornes.pas, '1');

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
    await genererDepuisMock(page);
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
    await genererDepuisMock(page);

    // UN SEUL appel : pas de critique, pas de réviseur, pas de juge. C'est ce
    // qui rend le mode carrousel nettement moins cher que le Script.
    assert.equal(appelsIA, 1,
      'REGRESSION : un juge ou un critique ajouté ici doublerait le coût du mode pour une note que le code sait calculer seul');

    const vu = await page.evaluate(() => {
      const s1 = scoreCarrousel(carrouselResultat.slides);
      const s2 = scoreCarrousel(carrouselResultat.slides);
      // Un carrousel volontairement raté : titre d'accroche interminable,
      // aucune numérotation, points bien trop longs, aucun appel à l'action.
      const rate = scoreCarrousel([
        { gabarit: 'couverture', titre: 'Dans cette publication je vais vous expliquer en détail toutes les différentes erreurs que beaucoup de personnes commettent régulièrement', points: [] },
        { gabarit: 'contenu', badge: 'Suite', titre: 'La première chose à savoir absolument avant de commencer quoi que ce soit', points: [
          { titre: 'Un titre de point beaucoup trop long pour être lu', texte: 'Un texte qui continue encore et encore sans jamais s\'arrêter, ce qui fait que personne ne le lit jamais en entier sur un téléphone.' }
        ] },
        { gabarit: 'recap', titre: 'Voilà c est tout pour aujourd hui', points: [] }
      ]);
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

test('chaque slide affiche sa structure, son nombre de mots et sa consigne visuelle', async () => {
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
    await genererDepuisMock(page);

    const vu = await page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('#carrouselResults .car-slide'));
      const tout = document.getElementById('carrouselResults').innerText;
      return {
        nb: cartes.length,
        formulaireMasque: document.getElementById('carrouselForm').style.display === 'none',
        premiere: cartes[0] ? cartes[0].innerText : '',
        consignes: cartes.filter(c => /Visuel\s*:/.test(c.innerText)).length,
        mots: cartes.filter(c => /\d+\s+mots?/.test(c.innerText)).length,
        points: document.querySelectorAll('#carrouselResults .car-slide-points li').length,
        legende: tout.includes('Tu es dans quelle catégorie ?'),
        son: tout.includes('nappe calme'),
        boutonsImage: document.querySelectorAll('#carrouselResults button[onclick^="genererImageCarrousel"]').length
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.nb, 4, 'une carte par slide');
    assert.equal(vu.formulaireMasque, true, 'le formulaire laisse la place au résultat');
    assert.match(vu.premiere, /Un compte qui vend n'est pas une marque/, 'le titre exact de la slide');
    assert.equal(vu.consignes, 4, 'chaque slide porte sa consigne visuelle, c\'est le livrable demandé');
    assert.equal(vu.mots, 4, 'et son nombre de mots');
    assert.equal(vu.points, 5,
      'REGRESSION : sans les points, la slide redevient une phrase posée sur un fond, ce que le propriétaire a explicitement refusé');
    assert.equal(vu.legende, true, 'la légende est là');
    assert.equal(vu.son, true, 'le son suggéré aussi, un carrousel muet perd sa portée');
    assert.equal(vu.boutonsImage, 4,
      'le fond se génère SLIDE PAR SLIDE, jamais imposé en bloc : c\'est ce qui protège le quota');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Demande explicite du propriétaire, après les carrousels de référence :
// "Prévoir aussi le format des carrousels (1:1, 4:5, 9:16, 16:9)".
test('les quatre formats existent, et chacun produit vraiment ses dimensions', async () => {
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

    // Menu déroulant depuis le retour du propriétaire : le format est un
    // réglage secondaire, quatre cartes lui donnaient autant de place à
    // l'écran qu'à l'objectif, qui est LE choix structurant du mode.
    const menu = await page.evaluate(() => {
      const el = document.getElementById('carrouselFormat');
      return { balise: el.tagName, valeurs: Array.from(el.options).map(o => o.value), valeur: el.value };
    });
    assert.equal(menu.balise, 'SELECT', 'le format se choisit dans un menu déroulant');
    assert.deepEqual(menu.valeurs, ['1:1', '4:5', '9:16', '16:9'], 'les quatre formats sont proposés');
    assert.equal(menu.valeur, '4:5', 'le portrait 4:5 est le choix par défaut, c\'est celui qui performe');

    // Et c'est bien la valeur DU CHAMP qui est lue, pas une variable interne
    // laissée derrière : c'est exactement le piège qui a produit un script de
    // 48 secondes pendant que le formulaire affichait 2 minutes.
    const suitLeChamp = await page.evaluate(() => {
      const el = document.getElementById('carrouselFormat');
      el.value = '16:9';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return lireFormatCarrousel();
    });
    assert.equal(suitLeChamp, '16:9',
      'REGRESSION : le menu changerait à l\'écran pendant que la génération partirait sur l\'ancien format');
    await page.evaluate(() => {
      const el = document.getElementById('carrouselFormat');
      el.value = '4:5';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await genererDepuisMock(page);

    // Chaque format doit produire une image aux VRAIES dimensions, pas un
    // simple libellé. Une slide dont la proportion ne suit pas le format
    // choisi serait rognée par TikTok au moment de la publication.
    const mesures = await page.evaluate(async () => {
      const attendus = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920], '16:9': [1920, 1080] };
      const resultats = {};
      for (const f of Object.keys(attendus)) {
        carrouselFormat = f;
        const blob = await composerSlideCarrousel(1);
        const bitmap = await createImageBitmap(blob);
        resultats[f] = [bitmap.width, bitmap.height, blob.size];
      }
      return resultats;
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(mesures['1:1'].slice(0, 2), [1080, 1080]);
    assert.deepEqual(mesures['4:5'].slice(0, 2), [1080, 1350]);
    assert.deepEqual(mesures['9:16'].slice(0, 2), [1080, 1920]);
    assert.deepEqual(mesures['16:9'].slice(0, 2), [1920, 1080]);
    Object.keys(mesures).forEach(f => {
      assert.ok(mesures[f][2] > 10000,
        'une slide quasi vide en ' + f + ' signifierait que la mise en page n\'a pas été dessinée : ' + mesures[f][2] + ' octets');
    });
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// LE PIÈGE DU 16:9, trouvé en regardant le rendu et non en lisant le code :
// l'unité d'échelle partait de la seule LARGEUR, donc un 1920x1080 dessinait
// tout 1,78 fois trop grand pour une hauteur deux fois moindre, et la mise en
// page débordait hors du cadre. Sans erreur, sans avertissement.
test('aucun format ne laisse la mise en page déborder hors du cadre', async () => {
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
    await genererDepuisMock(page);

    const debordements = await page.evaluate(() => {
      const mauvais = [];
      const fmts = ['1:1', '4:5', '9:16', '16:9'];
      for (const f of fmts) {
        carrouselFormat = f;
        const fmt = CAR_FORMATS[f];
        const c = document.createElement('canvas').getContext('2d');
        const u = Math.min(fmt.l / 1080, fmt.h / 1350);
        const marge = 30 * u;
        const dispoL = fmt.l - (marge + 52 * u) * 2;
        const zone = { x: 0, l: Math.min(dispoL, 1180 * u) };
        const haut = marge + 28 * u + 6 * u + 44 * u;
        const dispo = (fmt.h - marge - 40 * u) - haut;
        // La slide la plus dense du carrousel : c'est elle qui déborde en
        // premier, donc c'est elle qu'il faut mesurer.
        const slide = carrouselResultat.slides[1];
        const blocs = carrouselBlocs(slide, carrouselAccent(1));
        const e = carrouselEchelleQuiTient(c, blocs, zone, carrouselAccent(1), dispo, u);
        const hauteur = carrouselDisposer(c, blocs, zone, e, carrouselAccent(1), false, 0);
        if (hauteur > dispo) mauvais.push(f + ' : ' + Math.round(hauteur) + 'px pour ' + Math.round(dispo) + 'px disponibles');
      }
      return mauvais;
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(debordements, [],
      'REGRESSION : la mise en page sort du cadre, silencieusement, et la slide est inutilisable');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le fond est demandé SANS AUCUN TEXTE, sur le budget carrousel et au bon format', async () => {
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
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await page.route('**/api/montage-media?action=images', async (route) => {
      try { corpsImage = JSON.parse(route.request().postData() || '{}'); } catch (e) { corpsImage = {}; }
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ images: [{ base64: PNG, mimeType: 'image/png' }], erreurs: [null] })
      });
    });

    await genererDepuisMock(page);
    await page.evaluate(() => { carrouselFormat = '9:16'; return genererImageCarrousel(0); });
    await page.waitForTimeout(700);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(corpsImage, 'la génération d\'image doit bien partir');
    assert.equal(corpsImage.usage, 'carrousel',
      'REGRESSION SILENCIEUSE : le carrousel viderait le quota d\'images du MONTAGE VIDÉO, que l\'abonné a payé pour autre chose');
    assert.equal(corpsImage.format, '9:16',
      'le fond doit être demandé au format réellement choisi, sinon il est rogné à la composition');
    const prompt = String((corpsImage.prompts || [])[0] || '');
    assert.match(prompt, /portefeuille vide/, 'la consigne visuelle de la slide est bien transmise');
    assert.match(prompt, /Aucune lettre, aucun mot, aucun texte/,
      'REGRESSION : un modèle d\'images à qui on demande une phrase écrit des lettres tordues et des fautes, la slide devient inutilisable');
    assert.match(prompt, /photographie sobre/,
      'la direction artistique commune est reprise, sinon les slides n\'ont aucune cohérence entre elles');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une slide se télécharge finie, mise en page comprise, même sans fond généré', async () => {
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
    await genererDepuisMock(page);

    // Sans aucun fond généré : la slide doit être livrable telle quelle. Les
    // carrousels de référence du propriétaire n'ont AUCUNE photo, c'est donc
    // le cas normal, pas un cas dégradé.
    const vu = await page.evaluate(async () => {
      const blob = await composerSlideCarrousel(1);
      return { type: blob.type, taille: blob.size, aucunFond: carrouselImages.every(i => i === null) };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.aucunFond, true, 'aucune image générée dans ce test');
    assert.equal(vu.type, 'image/png');
    assert.ok(vu.taille > 10000,
      'REGRESSION : une image quasi vide signifierait que la mise en page n\'a pas été dessinée : ' + vu.taille + ' octets');
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
      window._historyData = [{ id: 'g1', mode: 'carrousel', titre: 'Compte ou marque', contenu }];
      reopenGeneration(0);
      const zone = document.getElementById('carrouselResults');
      return {
        ecran: document.getElementById('carrouselFlow').style.display !== 'none',
        slides: zone.querySelectorAll('.car-slide').length,
        // Les fonds ne sont pas réenregistrés (plusieurs Mo par carrousel) :
        // le tableau doit repartir vide À LA BONNE LONGUEUR, sinon une slide
        // afficherait le fond d'un carrousel précédent.
        imagesVides: carrouselImages.length === 4 && carrouselImages.every(i => i === null),
        score: zone.innerText.match(/(\d+)\s*\/\s*100/)
      };
    }, { resultat: CARROUSEL_IA, context: { niche: 'Business & Entrepreneuriat', nbSlides: 4 } });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.ecran, true, 'le carrousel se rouvre sur son écran');
    assert.equal(vu.slides, 4, 'toutes ses slides sont là');
    assert.equal(vu.imagesVides, true,
      'REGRESSION : un tableau mal réinitialisé afficherait les fonds du carrousel précédent');
    assert.ok(vu.score, 'et le score est recalculé à la réouverture, jamais laissé vide');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Compatibilité : les carrousels générés AVANT la refonte de la mise en page
// n'ont qu'un champ `texte` par slide. Ils doivent continuer de se rouvrir,
// sinon la refonte détruit silencieusement l'historique des créateurs.
test('un carrousel de l\'ancienne forme se rouvre sans rien perdre', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);

    const vu = await page.evaluate(async () => {
      const ancien = {
        titre: 'Ancien carrousel',
        slides: [
          { numero: 1, role: 'hook', texte: '3 erreurs qui ruinent ton budget', visuel: 'un portefeuille' },
          { numero: 2, role: 'corps', texte: '1. Tu paies tes abonnements sans les compter…', visuel: 'des tickets' },
          { numero: 3, role: 'cta', texte: 'Enregistre ce carrousel et commente', visuel: 'un carnet' }
        ],
        legende: 'Et toi ?', hashtags: ['#budget']
      };
      window._historyData = [{ id: 'g0', mode: 'carrousel', titre: 'Ancien', contenu: { resultat: ancien } }];
      reopenGeneration(0);
      const blob = await composerSlideCarrousel(0);
      return {
        slides: document.querySelectorAll('#carrouselResults .car-slide').length,
        // L'ancien `texte` devient le `titre` de la slide : rien n'est perdu.
        premierTitre: carrouselResultat.slides[0].titre,
        score: !!scoreCarrousel(carrouselResultat.slides),
        taille: blob.size
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.slides, 3, 'les trois slides sont là');
    assert.match(vu.premierTitre, /3 erreurs qui ruinent ton budget/,
      'REGRESSION : la refonte effacerait le contenu des carrousels déjà enregistrés');
    assert.equal(vu.score, true, 'le score se recalcule sur l\'ancienne forme');
    assert.ok(vu.taille > 10000, 'et la slide se compose quand même : ' + vu.taille + ' octets');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire, capture à l'appui : sur l'écran de résultat, le titre,
// les boutons, la barre de format et le paragraphe d'analyse collaient aux
// deux bords de l'écran, et le bouton Retour passait sous l'en-tête fixe.
// CAUSE EXACTE : #carrouselFlow ne figurait pas dans la règle CSS groupée qui
// pose ces marges pour TOUS les autres écrans de mode. Le propriétaire a
// fourni le mode Script comme modèle, c'est donc contre LUI qu'on mesure, et
// pas contre une valeur recopiée à la main qui divergerait au premier
// changement de charte.
test('l\'écran de résultat respecte les mêmes marges que les autres modes', async () => {
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
    await genererDepuisMock(page);

    const vu = await page.evaluate(() => {
      const bords = el => {
        const b = el.getBoundingClientRect();
        return { gauche: Math.round(b.left), droite: Math.round(window.innerWidth - b.right), haut: Math.round(b.top) };
      };
      const zone = document.getElementById('carrouselResults');
      const mesure = {
        retour: bords(zone.querySelector('.btn-back')),
        titre: bords(zone.querySelector('.results-heading')),
        formats: bords(zone.querySelector('.car-formats-barre')),
        analyse: bords(zone.querySelector('.ctx-note')),
        slide: bords(zone.querySelector('.car-slide'))
      };
      // La référence : l'écran de résultat du mode Script, désigné par le
      // propriétaire comme le modèle de marges.
      masquerTousLesEcrans();
      document.getElementById('flow').style.display = 'block';
      document.getElementById('results').style.display = 'block';
      const ref = bords(document.querySelector('#results .btn-back'));
      masquerTousLesEcrans();
      document.getElementById('carrouselFlow').style.display = 'block';
      return { mesure, refGauche: ref.gauche };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    Object.keys(vu.mesure).forEach(cle => {
      assert.equal(vu.mesure[cle].gauche, vu.refGauche,
        'REGRESSION : "' + cle + '" colle au bord gauche au lieu de suivre la marge du mode Script (' + vu.mesure[cle].gauche + ' au lieu de ' + vu.refGauche + ')');
    });
    ['formats', 'analyse', 'slide'].forEach(cle => {
      assert.equal(vu.mesure[cle].droite, vu.refGauche,
        'et la marge de DROITE aussi, pour "' + cle + '" : ' + vu.mesure[cle].droite);
    });
    assert.ok(vu.mesure.retour.haut > 80,
      'REGRESSION : le bouton Retour passait sous l\'en-tête fixe, il était inatteignable : ' + vu.mesure.retour.haut + 'px du haut');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Demande du propriétaire : copier et partager, en bas de la légende et des
// hashtags. C'est le bloc qu'on colle tel quel dans TikTok au moment de
// publier, donc les deux vont ensemble, jamais séparés en deux copies.
test('la légende et ses hashtags se copient et se partagent en un geste', async () => {
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
    await genererDepuisMock(page);

    const vu = await page.evaluate(() => {
      const boutons = Array.from(document.querySelectorAll('#carrouselResults .sb-actions-fin .icon-btn'));
      const cles = boutons.map(b => (b.getAttribute('onclick') || '').match(/__copykey_\d+/));
      return {
        nb: boutons.length,
        actions: boutons.map(b => (b.getAttribute('onclick') || '').split('(')[0]),
        // Le texte réellement copié, tel qu'il partira dans le presse-papier.
        texte: cles[0] ? window._copyStore[cles[0][0]] : null,
        // Placé APRÈS la légende et les hashtags, pas ailleurs dans la page.
        apresHashtags: !!document.querySelector('#carrouselResults .ctx-field + .sb-actions-fin, #carrouselResults .ctx-field ~ .sb-actions-fin')
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.nb, 2, 'un bouton Copier et un bouton Partager');
    assert.deepEqual(vu.actions, ['copyText', 'shareText'],
      'les helpers déjà utilisés partout ailleurs dans l\'app, pas une copie locale : ' + JSON.stringify(vu.actions));
    assert.ok(vu.texte, 'le texte à copier doit être enregistré, jamais injecté dans l\'attribut onclick où une apostrophe casserait tout');
    assert.match(vu.texte, /Tu es dans quelle catégorie/, 'la légende est dedans : ' + vu.texte);
    assert.match(vu.texte, /#marque/,
      'REGRESSION : sans les hashtags, il faudrait deux copies pour publier une seule fois');
    assert.equal(vu.apresHashtags, true, 'les boutons sont bien en bas du bloc légende et hashtags');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire, capture à l'appui : dans la tuile d'emoji, l'emoji et
// le titre n'étaient pas centrés verticalement. CAUSE EXACTE : le titre
// reprenait le décalage prévu pour un bloc partant du HAUT (0,78 de la taille
// de police) alors qu'il devait être CENTRÉ sur la tuile, ce qui le posait une
// trentaine de pixels trop bas ; et l'emoji était placé par un décalage
// deviné, alors que ses métriques n'ont rien à voir avec celles du texte.
//
// Ce défaut ne se voit QUE dans les pixels : aucune assertion sur le code
// n'aurait pu l'attraper. On mesure donc l'image produite.
test('dans la tuile, l\'emoji et le titre sont vraiment centrés verticalement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);

    const vu = await page.evaluate(async () => {
      // Une slide qui ne porte QUE la tuile et le titre : sans définition ni
      // points, tout ce qui est visible dans cette bande appartient à l'un ou
      // à l'autre, la mesure est donc sans ambiguïté.
      const seule = {
        titre: 'Test', slides: [{ gabarit: 'contenu', emoji: '💪', titre: 'Bouger ton corps' }],
        legende: '', hashtags: []
      };
      carrouselResultat = normaliserResultatCarrousel(seule);
      carrouselImages = [null];
      carrouselFormat = '4:5';
      const blob = await composerSlideCarrousel(0);
      const bitmap = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = bitmap.width; cv.height = bitmap.height;
      const c = cv.getContext('2d');
      c.drawImage(bitmap, 0, 0);
      const px = c.getImageData(0, 0, cv.width, cv.height).data;

      // Étendue verticale de ce qui est dessiné dans une bande de colonnes,
      // ENTRE deux lignes. Le bornage vertical n'est pas un détail : sans
      // lui, le balayage attrapait la barre de progression tout en haut et
      // la pagination tout en bas, et comparait donc deux repères de cadre
      // au lieu de l'emoji et du titre. Un test qui mesure la mauvaise chose
      // est pire qu'un test absent, il rassure à tort.
      const etendue = (x1, x2, y1, y2) => {
        let haut = -1, bas = -1;
        for (let y = y1; y < y2; y++) {
          let vu = false;
          for (let x = x1; x < x2; x += 2) {
            const i = (y * cv.width + x) * 4;
            // Nettement plus clair que le fond sombre de la slide.
            if (px[i] + px[i + 1] + px[i + 2] > 330) { vu = true; break; }
          }
          if (vu) { if (haut < 0) haut = y; bas = y; }
        }
        return haut < 0 ? null : { haut, bas, centre: (haut + bas) / 2 };
      };

      const u = Math.min(cv.width / 1080, cv.height / 1350);
      const marge = 30 * u;
      const dispoL = cv.width - (marge + 52 * u) * 2;
      const largeur = Math.min(dispoL, 1180 * u);
      const zx = (cv.width - largeur) / 2;
      const tuile = 96 * u;

      // La bande de contenu : sous la barre de progression, au-dessus de la
      // pagination.
      const y1 = Math.round(marge + 28 * u + 44 * u);
      const y2 = Math.round(cv.height - marge - 60 * u);

      return {
        // Le fond de la tuile est trop sombre pour franchir le seuil : ce
        // qu'on mesure ici, c'est l'EMOJI lui-même, ce qui tombe encore
        // mieux, puisque c'est bien lui que le propriétaire a vu de travers.
        tuile: etendue(Math.round(zx + 6), Math.round(zx + tuile - 6), y1, y2),
        titre: etendue(Math.round(zx + tuile + 40), Math.round(zx + largeur - 10), y1, y2),
        u
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.tuile, 'l\'emoji de la tuile doit être dessiné');
    assert.ok(vu.titre, 'le titre doit être dessiné');
    const ecart = Math.abs(vu.tuile.centre - vu.titre.centre);
    assert.ok(ecart <= 10 * vu.u,
      'REGRESSION : le titre n\'est pas centré sur sa tuile, écart de ' + Math.round(ecart) + 'px (tuile centrée en ' +
      Math.round(vu.tuile.centre) + ', titre en ' + Math.round(vu.titre.centre) + ')');
    // Et l'emoji doit tenir DANS sa tuile (96px de côté), pas déborder
    // au-dessus ou en dessous : c'est exactement ce que produit un décalage
    // deviné sur des métriques qui ne sont pas celles du texte latin.
    assert.ok(vu.tuile.bas - vu.tuile.haut <= 96 * vu.u,
      'l\'emoji déborde de sa tuile : ' + Math.round(vu.tuile.bas - vu.tuile.haut) + 'px de haut');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour propriétaire, capture à l'appui : dans les cartes d'objectif, le
// libellé et sa description étaient CÔTE À CÔTE. Un objectif un peu long
// ("Asseoir mon expertise") passait donc sur deux lignes pendant que ses
// voisins tenaient sur une, et les cartes n'avaient plus la même hauteur.
//
// La règle .choices-compact est PARTAGÉE avec le mode Script : ce test
// vérifie donc les DEUX écrans. Une correction qui n'aurait arrangé que le
// carrousel aurait laissé le même défaut ailleurs, et une future retouche du
// Script pourrait défaire celle-ci sans que rien ne le signale.
test('les libellés d\'objectif tiennent sur une ligne, description dessous', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);

    const mesurer = (ecran, selecteur) => page.evaluate(([ec, sel]) => {
      masquerTousLesEcrans();
      document.getElementById(ec).style.display = 'block';
      window.scrollTo(0, 0);
      return Array.from(document.querySelectorAll(sel + ' .choice')).map(c => {
        const lab = c.querySelector('.choice-label');
        const desc = c.querySelector('.choice-desc');
        const bl = lab.getBoundingClientRect();
        const bd = desc ? desc.getBoundingClientRect() : null;
        const hauteurLigne = parseFloat(getComputedStyle(lab).lineHeight) || parseFloat(getComputedStyle(lab).fontSize) * 1.3;
        return {
          texte: lab.textContent.trim(),
          lignes: Math.round(bl.height / hauteurLigne),
          // La description commence SOUS le libellé, jamais à côté.
          dessous: bd ? bd.top >= bl.bottom - 2 : true,
          hauteur: Math.round(c.getBoundingClientRect().height)
        };
      });
    }, [ecran, selecteur]);

    for (const [ecran, selecteur, nom] of [
      ['carrouselFlow', '#carrouselObjectifs', 'carrousel'],
      ['flow', '#choixObjectif', 'script']
    ]) {
      const cartes = await mesurer(ecran, selecteur);
      assert.equal(cartes.length, 4, 'quatre objectifs sur l\'écran ' + nom);
      cartes.forEach(c => {
        assert.equal(c.lignes, 1,
          'REGRESSION (' + nom + ') : "' + c.texte + '" repasse sur ' + c.lignes + ' lignes, le libellé n\'a plus toute la largeur de la carte');
        assert.equal(c.dessous, true,
          'REGRESSION (' + nom + ') : la description de "' + c.texte + '" est revenue à côté du libellé au lieu d\'être dessous');
      });
      const hauteurs = Array.from(new Set(cartes.map(c => c.hauteur)));
      assert.equal(hauteurs.length, 1,
        'les quatre cartes de ' + nom + ' doivent avoir la même hauteur, sinon la liste est bancale : ' + JSON.stringify(cartes.map(c => c.texte + ' ' + c.hauteur + 'px')));
    }

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

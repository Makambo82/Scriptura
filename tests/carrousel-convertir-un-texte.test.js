// Question du propriétaire : "et si un utilisateur a déjà un texte ou un
// script et qu'il veut en faire un carrousel ?"
//
// LE DÉFAUT EXISTAIT DÉJÀ, ET IL ÉTAIT SILENCIEUX. Le champ "Ton sujet" est
// une zone de texte : rien n'empêchait d'y coller un script entier. Mais le
// prompt l'annonçait comme "Sujet :", donc le modèle le traitait comme un
// THÈME à écrire de zéro, pas comme une MATIÈRE à convertir. Aucune erreur, un
// résultat plausible, mais à côté de la demande, et le créateur ne pouvait pas
// comprendre pourquoi son texte avait été ignoré.
//
// L'ARBITRAGE, et c'est le coeur de la fonctionnalité : FIDÉLITÉ SUR LES
// FAITS, LIBERTÉ SUR LA FORME. Une conversion trop fidèle recopie un texte
// parlé, qui se lit mal en slides. Une conversion trop libre réécrit à la
// place du créateur, et ce n'est plus son contenu. On interdit donc d'ajouter
// le moindre fait, et on autorise la réécriture complète de la formulation.
//
// LE NOMBRE DE SLIDES VIENT DE LA MATIÈRE, ET C'EST LE CODE QUI COMPTE, comme
// pour le score : si le texte porte 5 idées et que le curseur est resté sur
// 12, le modèle remplit du vide et le carrousel est dilué par un réglage que
// le créateur n'a même pas touché.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Un vrai script parlé, avec ses tics d'oral et ses cinq idées.
const SCRIPT_COLLE = `Beaucoup de gens croient qu'épargner c'est mettre de côté ce qui reste. C'est faux, et c'est exactement pour ça qu'ils n'y arrivent jamais.

La première erreur, c'est de payer tout le monde avant soi. Le loyer, les abonnements, les courses, et on épargne le reste. Sauf qu'il ne reste jamais rien.

La deuxième erreur, c'est de ne pas compter les petits abonnements. Quinze euros par-ci, huit euros par-là, tu vois, ça paraît rien, mais additionné sur l'année ça fait un mois de loyer.

La troisième erreur, c'est de confondre son revenu et son argent disponible. Ton salaire n'est pas ton budget, ton budget c'est ce qui reste une fois les charges fixes retirées.

Bref, si tu veux vraiment y arriver, inverse l'ordre : épargne d'abord, dépense ensuite. Dis-le-moi en commentaire juste en dessous si tu as déjà essayé.`;

const REPONSE_IA = {
  titre: 'Erreurs de budget',
  direction_visuelle: 'sobre',
  slides: [
    { gabarit: 'couverture', eyebrow: 'Argent', titre: 'Épargner ce qui reste ne marche jamais', titre_accent: 'jamais', bandeau: '3 erreurs.', visuel: 'v' },
    { gabarit: 'contenu', badge: 'Erreur 1 / 3', emoji: '💸', titre: 'Tu paies tout le monde avant toi', points: [{ emoji: '💸', titre: 'Le reste est toujours nul', texte: 'Loyer, abonnements, courses, puis on épargne le reste.' }], bandeau: 'Il ne reste jamais rien.', visuel: 'v' },
    { gabarit: 'recap', eyebrow: 'À toi', titre: 'Inverse l\'ordre', titre_accent: 'Inverse', points: [{ emoji: '💬', titre: 'Commente', texte: 'Si tu as déjà essayé.' }], bandeau: 'Épargne d\'abord.', visuel: 'v' }
  ],
  legende: 'Tu es sur laquelle ?',
  hashtags: ['#budget'],
  son_suggere: 'nappe calme'
};

async function ouvrir(page, baseUrl, gestionnaires) {
  await poserMocksReseau(page, gestionnaires || {});
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'CONV' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(300);
  await page.evaluate(() => chooseMode('carrousel'));
  await page.waitForTimeout(300);
}

const saisirSujet = (page, texte) => page.evaluate(t => {
  const c = document.getElementById('carrouselSujet');
  c.value = t;
  c.dispatchEvent(new Event('input', { bubbles: true }));
}, texte);

test('un sujet court ne déclenche RIEN : le mode normal reste le mode normal', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let prompt = '';
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl, {
      generate: (b) => { prompt = JSON.stringify(b.messages || ''); return { content: [{ text: JSON.stringify(REPONSE_IA) }] }; }
    });

    await saisirSujet(page, 'les erreurs de budget');
    const vu = await page.evaluate(() => ({
      note: document.getElementById('carrouselMatiereNote').style.display !== 'none',
      slides: document.getElementById('carrouselSlides').value
    }));
    assert.equal(vu.note, false, 'aucun message de conversion sur un sujet court');
    assert.equal(vu.slides, '8', 'et le curseur reste sur sa valeur par défaut');

    await page.evaluate(() => genererCarrousel());
    await page.waitForTimeout(900);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.doesNotMatch(prompt, /RÈGLES DE CONVERSION/,
      'REGRESSION : un simple sujet ne doit jamais partir avec les consignes de conversion');
    assert.match(prompt, /EXACTEMENT 8/, 'et le nombre de slides reste ferme en création');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un texte collé bascule en CONVERSION, et le créateur en est informé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let prompt = '';
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl, {
      generate: (b) => { prompt = JSON.stringify(b.messages || ''); return { content: [{ text: JSON.stringify(REPONSE_IA) }] }; }
    });

    await saisirSujet(page, SCRIPT_COLLE);
    const vu = await page.evaluate(() => ({
      noteVisible: document.getElementById('carrouselMatiereNote').style.display !== 'none',
      note: document.getElementById('carrouselMatiereNote').textContent
    }));
    assert.equal(vu.noteVisible, true,
      'REGRESSION : sans message, le créateur ne saurait ni que la conversion a lieu, ni qu\'elle n\'a pas lieu, et découvrirait l\'un ou l\'autre dans le résultat');
    assert.match(vu.note, /convertir/i, 'le message dit ce qui va se passer : ' + vu.note);

    await page.evaluate(() => genererCarrousel());
    await page.waitForTimeout(900);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    // Le texte est annoncé comme MATIÈRE, pas comme sujet : c'est ce seul mot
    // qui décide si le modèle convertit ou réécrit de zéro.
    assert.match(prompt, /MATIÈRE FOURNIE PAR LE CRÉATEUR, à convertir/,
      'REGRESSION SILENCIEUSE : le script serait traité comme un thème à écrire, et le texte du créateur purement ignoré');
    assert.match(prompt, /épargner c'est mettre de côté ce qui reste/,
      'et la matière elle-même arrive bien entière dans le prompt');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la conversion impose la fidélité sur les faits et la liberté sur la forme', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let prompt = '';
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl, {
      generate: (b) => { prompt = JSON.stringify(b.messages || ''); return { content: [{ text: JSON.stringify(REPONSE_IA) }] }; }
    });
    await saisirSujet(page, SCRIPT_COLLE);
    await page.evaluate(() => genererCarrousel());
    await page.waitForTimeout(900);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    // Sans cette interdiction, la conversion devient une seconde génération :
    // le créateur ne reconnaît plus son contenu, et pire, Scriptura lui
    // attribue des chiffres ou des exemples qu'il n'a jamais dits.
    assert.match(prompt, /FIDÉLITÉ SUR LES FAITS, ABSOLUE/,
      'REGRESSION : rien n\'empêcherait le modèle d\'inventer des faits au nom du créateur');
    assert.match(prompt, /N'ajoute JAMAIS un chiffre, un nom, une date/, 'et l\'interdiction est explicite');
    // Sans celle-ci, on recopie un texte PARLÉ dans des slides qui se LISENT :
    // les tics d'oral passent à l'écoute et sonnent faux à la lecture.
    assert.match(prompt, /LIBERTÉ SUR LA FORME, TOTALE/, 'la réécriture pour la lecture est autorisée');
    assert.match(prompt, /oral supprimé/, 'et les tics d\'oral explicitement visés');
    assert.match(prompt, /DÉCOUPE AUX FRONTIÈRES D'IDÉES/,
      'la découpe suit les idées, jamais un intervalle régulier');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le nombre de slides vient de la matière, compté par le CODE', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let prompt = '';
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl, {
      generate: (b) => { prompt = JSON.stringify(b.messages || ''); return { content: [{ text: JSON.stringify(REPONSE_IA) }] }; }
    });

    await saisirSujet(page, SCRIPT_COLLE);
    const vu = await page.evaluate(t => ({
      idees: carrouselCompterIdees(t),
      suggere: carrouselSlidesPourMatiere(t),
      curseur: document.getElementById('carrouselSlides').value,
      // Deux fois le même texte, deux fois le même compte : c'est le CODE qui
      // compte, jamais l'IA, comme pour le score.
      identique: carrouselCompterIdees(t) === carrouselCompterIdees(t)
    }), SCRIPT_COLLE);

    assert.equal(vu.identique, true, 'le comptage est déterministe');
    assert.equal(vu.idees, 5, 'les cinq idées du script sont comptées : ' + vu.idees);
    assert.equal(vu.suggere, 7, 'une couverture, une slide par idée, un récap : ' + vu.suggere);
    assert.equal(vu.curseur, '7', 'et le curseur se positionne dessus');

    await page.evaluate(() => genererCarrousel());
    await page.waitForTimeout(900);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    // En conversion, mieux vaut moins de slides que du remplissage : c'est la
    // règle qui protège le carrousel d'une matière plus courte que le réglage.
    assert.match(prompt, /FAIS-EN MOINS plutôt que de remplir/,
      'REGRESSION : le modèle diluerait le carrousel pour atteindre le compte demandé');
    assert.doesNotMatch(prompt, /EXACTEMENT 7 éléments/,
      'et le nombre n\'est plus un ordre ferme en conversion');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un curseur déplacé à la main n\'est JAMAIS écrasé par la suggestion', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl);

    // Le créateur choisit 11 slides, PUIS colle sa matière.
    await page.evaluate(() => {
      const c = document.getElementById('carrouselSlides');
      c.value = '11';
      c.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await saisirSujet(page, SCRIPT_COLLE);

    const apres = await page.evaluate(() => document.getElementById('carrouselSlides').value);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres, '11',
      'REGRESSION : écraser un choix explicite est exactement le défaut de la durée héritée, qui a produit un script de 48 secondes pendant que le formulaire affichait 2 minutes');

    // Et le message reste affiché : la conversion a bien lieu, seul le nombre
    // de slides reste celui du créateur.
    const note = await page.evaluate(() => document.getElementById('carrouselMatiereNote').style.display !== 'none');
    assert.equal(note, true, 'la conversion est toujours annoncée');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

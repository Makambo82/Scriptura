// Demande du propriétaire : pouvoir importer sa propre musique de fond, en
// MP3. Beaucoup de créateurs ont déjà leur piste, ou une musique imposée par
// leur niche : leur faire générer une musique dont ils ne veulent pas leur
// fait perdre du temps ET du quota.
//
// MP3 SEULEMENT, et son raisonnement tient : un WAV est de l'audio non
// compressé, ~10 Mo la minute contre ~1,4 Mo en MP3. Ce n'est pas tant la
// mémoire de FFmpeg (il décode au fil de l'eau) que le trajet du fichier :
// téléversement depuis un téléphone, stockage, re-téléchargement par le
// service de rendu. Trois minutes de musique, c'est 30 Mo contre 4.
//
// CE QUE CES TESTS VERROUILLENT :
//   1. un MP3 est accepté et devient la musique du montage ;
//   2. tout autre format est REFUSÉ, avec une raison lisible ;
//   3. « Régénérer » ne s'affiche JAMAIS sur une musique importée. Ce bouton
//      remplacerait le fichier du créateur par une musique inventée, sans
//      prévenir, en consommant son quota pour lui reprendre son choix ;
//   4. l'URL d'objet est LIBÉRÉE quand on change ou retire la musique. Sans
//      ça, chaque import garde le fichier entier en mémoire, sur un téléphone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrirMontage(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page;
}

// Simule un fichier choisi sans passer par un vrai sélecteur : on appelle la
// fonction avec un objet input factice, exactement comme le navigateur le
// ferait. C'est la DÉCISION qu'on teste, pas le composant natif.
const choisir = (page, nom, type, octets) => page.evaluate(({ nom, type, octets }) => {
  const err = document.getElementById('montageErreur');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  // Un VRAI File, pas un objet factice : createObjectURL n'accepte rien
  // d'autre, et c'est bien un File que le navigateur passe. La taille est
  // redéfinie sur l'instance pour tester le plafond sans allouer 40 Mo.
  const fichier = new File([new Uint8Array(8)], nom, type ? { type: type } : undefined);
  Object.defineProperty(fichier, 'size', { value: octets, configurable: true });
  const input = { files: [fichier], value: 'quelque-chose' };
  importerMusiqueMontage(input);
  return {
    valeurRemise: input.value,
    musique: montageMusique ? {
      importee: !!montageMusique.importee, nom: montageMusique.nom, aUneUrl: !!montageMusique.url
    } : null,
    erreur: err ? { texte: err.textContent, visible: err.style.display } : null
  };
}, { nom, type, octets });

test('un MP3 est accepté et devient la musique du montage', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirMontage(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await choisir(page, 'Ma prod afro.mp3', 'audio/mpeg', 3 * 1024 * 1024);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.musique, 'REGRESSION : un MP3 valide n\'est pas retenu comme musique du montage.');
    assert.equal(vu.musique.importee, true,
      'REGRESSION : la musique n\'est pas marquée comme importée. C\'est ce drapeau qui empêche le '
      + 'bouton « Régénérer » de la remplacer par une musique inventée.');
    assert.equal(vu.musique.nom, 'Ma prod afro', 'le nom du fichier est repris, sans son extension');
    assert.equal(vu.musique.aUneUrl, true, 'il faut une URL pour l\'écouter avant de monter');
    assert.equal(vu.erreur.visible, 'none', 'aucune erreur affichée : ' + vu.erreur.texte);

    assert.equal(vu.valeurRemise, '',
      'REGRESSION : le champ de fichier n\'est pas remis à zéro. Réimporter le MÊME fichier après '
      + 'l\'avoir retiré ne déclencherait alors aucun événement (le navigateur ne voit pas de '
      + 'changement) et le créateur croirait l\'app cassée.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('tout ce qui n\'est pas un MP3 est refusé, avec la raison', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirMontage(navigateur, baseUrl);

    const wav = await choisir(page, 'musique.wav', 'audio/wav', 2 * 1024 * 1024);
    assert.equal(wav.musique, null,
      'REGRESSION : un WAV est accepté. Non compressé, il pèse près de dix fois plus lourd pour la '
      + 'même durée, et il ferait ce trajet trois fois : téléversement, stockage, téléchargement par '
      + 'le service de rendu.');
    assert.equal(wav.erreur.visible, 'block', 'et le créateur doit savoir POURQUOI');
    assert.match(wav.erreur.texte, /MP3/, 'la raison doit nommer le format attendu : ' + wav.erreur.texte);

    // Trop lourd : un MP3 valide, mais démesuré pour une musique de fond.
    const enorme = await choisir(page, 'concert.mp3', 'audio/mpeg', 40 * 1024 * 1024);
    assert.equal(enorme.musique, null,
      'REGRESSION : un MP3 de 40 Mo passe. Rien ne borne alors ce qui transite par le stockage et par '
      + 'le service de rendu.');
    assert.match(enorme.erreur.texte, /r[ée]p[èe]te/i,
      'et le message doit dire pourquoi c\'est inutile : la musique se répète toute seule si elle est '
      + 'plus courte que la vidéo. Vu : ' + enorme.erreur.texte);

    // Un .mp3 dont le navigateur ne sait pas dire le type reste accepté :
    // certains téléphones renvoient un type vide, refuser serait absurde.
    const sansType = await choisir(page, 'piste.mp3', '', 1024 * 1024);
    assert.ok(sansType.musique,
      'REGRESSION : un fichier .mp3 dont le navigateur ne déclare pas le type est refusé. Plusieurs '
      + 'téléphones renvoient un type vide, et le créateur ne comprendrait pas le refus.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('« Régénérer » n\'apparaît jamais sur une musique importée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirMontage(navigateur, baseUrl);

    const vu = await page.evaluate(() => {
      const zone = document.getElementById('montageMusiqueZone');
      const rendre = () => { renderMontageEtat(); return zone ? zone.innerHTML : ''; };

      // Musique GÉNÉRÉE : « Régénérer » a du sens, elle vient de l'IA.
      montageMusique = { blob: {}, url: 'blob:generee' };
      const html1 = rendre();
      // Musique IMPORTÉE : le fichier vient du créateur.
      montageMusique = { blob: {}, url: 'blob:importee', importee: true, nom: 'Ma piste' };
      const html2 = rendre();
      return { generee: html1, importee: html2, zoneTrouvee: !!zone };
    });

    // JAMAIS de saut silencieux : un test qui s'esquive quand il ne trouve pas
    // sa cible passe au vert sans rien vérifier, et c'est pire que pas de test.
    assert.equal(vu.zoneTrouvee, true,
      'REGRESSION : la zone #montageMusiqueZone a disparu ou changé d\'identifiant. Ce test ne '
      + 'vérifierait plus rien du tout, en restant vert.');

    assert.match(vu.generee, /Régénérer/,
      'une musique générée garde son bouton Régénérer : ' + vu.generee.slice(0, 200));

    assert.doesNotMatch(vu.importee, /Régénérer/,
      'REGRESSION : « Régénérer » s\'affiche sur une musique IMPORTÉE. Un appui remplacerait le '
      + 'fichier du créateur par une musique inventée, sans prévenir, en consommant son quota pour lui '
      + 'reprendre exactement ce qu\'il venait de choisir.');
    assert.match(vu.importee, /Changer de MP3/,
      'il doit à la place pouvoir changer de fichier : ' + vu.importee.slice(0, 200));
    assert.match(vu.importee, /Ma piste/, 'et voir quel fichier est en place');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'URL du fichier importé est libérée quand on le remplace ou le retire', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirMontage(navigateur, baseUrl);

    const vu = await page.evaluate(() => {
      const liberees = [];
      const vraiRevoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (u) => { liberees.push(u); vraiRevoke(u); };
      try {
        montageMusique = { blob: {}, url: 'blob:premiere', importee: true, nom: 'A' };
        retirerMusiqueMontage();
        const apresRetrait = liberees.slice();

        // Une musique GÉNÉRÉE vient d'une URL distante : rien à libérer, et
        // révoquer une URL qui n'est pas un objet local n'aurait aucun sens.
        montageMusique = { blob: {}, url: 'https://exemple/musique.mp3' };
        retirerMusiqueMontage();
        return { apresRetrait: apresRetrait, apresGeneree: liberees.slice() };
      } finally { URL.revokeObjectURL = vraiRevoke; }
    });

    assert.deepEqual(vu.apresRetrait, ['blob:premiere'],
      'REGRESSION : l\'URL du fichier importé n\'est pas libérée. Elle retient le fichier ENTIER en '
      + 'mémoire tant qu\'elle vit : sur un téléphone, importer trois musiques de suite en garderait '
      + 'trois. Libérées : ' + JSON.stringify(vu.apresRetrait));

    assert.deepEqual(vu.apresGeneree, ['blob:premiere'],
      'REGRESSION : on tente de libérer l\'URL d\'une musique GÉNÉRÉE, qui est une adresse distante et '
      + 'non un objet local. Libérées : ' + JSON.stringify(vu.apresGeneree));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour terrain, journal d'erreurs à l'appui : sur SIX récits générés par le
// propriétaire, « citation refusée » est tombé 6 fois, dominé par
// coherence_factuelle (5 fois sur 6), puis originalite (2 fois).
//
// Ce n'était pas de la sévérité, c'était un défaut de conception. Le juge doit
// CITER un passage mot pour mot pour valider chaque case. Or trois des neuf
// signaux du récit demandaient de prouver une ABSENCE ou une propriété
// GLOBALE :
//   coherence_factuelle : « aucune contradiction de date ou de chiffre »
//   non_redondance      : « aucun segment ne reformule le précédent »
//   originalite         : « l'angle n'est pas un cliché »
// Aucune phrase ne prouve qu'il n'y a de contradiction NULLE PART. Le juge
// citait donc n'importe quoi, la vérification mécanique le rejetait, et le
// signal tombait à faux. À chaque fois.
//
// CE QUE ÇA COÛTAIT, ET C'EST LE PLUS GRAVE : ces trois signaux vivent dans
// TROIS dimensions DIFFÉRENTES du score, et chacun pèse un tiers de la sienne
// (voir GEN_DIMENSIONS_RECIT). Narration, Engagement et Viral étaient donc
// plafonnées à 67 sur 100, sur des récits qui méritaient peut-être 100.
//
// TROIS REMÈDES DIFFÉRENTS, parce que le défaut n'est pas le même :
//   non_redondance      → MESURÉ EN CODE (une redondance, ça se compte)
//   coherence_factuelle → POLARITÉ INVERSÉE (c'est le défaut qui se prouve)
//   originalite         → REFORMULÉ EN POSITIF (citer le passage original)
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage();
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page;
}

test('non_redondance est MESURÉ en code, plus jamais demandé au juge', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const seg = (t) => ({ segment: 'x', texte: t });
      return {
        // Il ne doit plus rien avoir à voir avec l'IA, comme rythme_soutenu.
        dansListeIA: GEN_SIGNAUX_JUGES_IA_RECIT.indexOf('non_redondance') !== -1,
        comptePourEngagement: GEN_DIMENSIONS_RECIT.engagement.indexOf('non_redondance') !== -1,

        // Un récit qui AVANCE : chaque segment apporte autre chose.
        recitSain: _genDetecterNonRedondanceRecit([
          seg('Le traité de Versailles est signé dans la galerie des Glaces.'),
          seg('L\'Allemagne doit payer cent trente-deux milliards de marks-or.'),
          seg('Personne autour de la table ne croit vraiment à ce chiffre.'),
          seg('Keynes claque la porte de la délégation britannique.')
        ]),

        // Le même segment redit avec d'autres mots : c'est ÇA, piétiner.
        recitQuiPietine: _genDetecterNonRedondanceRecit([
          seg('L\'Allemagne devait payer pendant des décennies entières.'),
          seg('Pendant des décennies entières, l\'Allemagne devait payer.')
        ]),

        // Deux segments qui parlent du même sujet SANS se répéter : ils
        // partagent forcément le nom du personnage et le lieu. C'est de la
        // continuité, et la punir serait pire que le défaut d'origine.
        continuite: _genDetecterNonRedondanceRecit([
          seg('Behanzin refuse de signer le traité que la France lui présente.'),
          seg('Behanzin rassemble alors ses guerriers et prépare la résistance.')
        ]),

        // Trop court pour conclure : on ne punit pas, on passe.
        tropCourt: _genDetecterNonRedondanceRecit([seg('Il refuse.'), seg('Il refuse.')]),
        vide: _genDetecterNonRedondanceRecit([])
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.dansListeIA, false,
      'REGRESSION : non_redondance est de retour dans la liste des signaux jugés par l\'IA. Le juge '
      + 'écraserait alors la mesure du code sans un bruit, et le signal retomberait à faux comme avant.');
    assert.equal(vu.comptePourEngagement, true,
      'il doit continuer de compter dans Engagement : on change sa VÉRIFICATION, pas le score');

    assert.equal(vu.recitSain, true,
      'REGRESSION : un récit qui avance normalement est déclaré redondant. C\'est exactement le défaut '
      + 'qu\'on corrige, reproduit autrement.');
    assert.equal(vu.recitQuiPietine, false,
      'REGRESSION : deux segments qui redisent la même chose avec les mots inversés passent pour '
      + 'distincts. Le détecteur ne détecte rien et le signal ne veut plus rien dire.');
    assert.equal(vu.continuite, true,
      'REGRESSION : deux segments qui partagent le nom du personnage et le lieu sont pris pour une '
      + 'redondance. C\'est de la continuité narrative, tous les récits en sont faits.');
    assert.equal(vu.tropCourt, true, 'trop court pour conclure : on ne punit pas');
    assert.equal(vu.vide, true, 'aucun segment : rien à reprocher');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('coherence_factuelle : c\'est la CONTRADICTION qui se prouve, pas son absence', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const texte = 'Le mur mesurait cinq cent quatre-vingts metres de haut. '
        + 'Les temoins parlent tous du meme chiffre. '
        + 'Pourtant les archives donnent sept cents metres exactement.';
      const norm = _genNormaliserTexteJugeRecit(texte);
      // LA VRAIE FONCTION, celle que la boucle de jugement appelle, jamais une
      // copie rejouée ici : un test qui réimplémente ce qu'il vérifie ne
      // vérifie que lui-même, et resterait vert le jour où le vrai code casse.
      const juger = (d) => _genJugerCoherenceFactuelleRecit(d, norm);
      return {
        inversee: GEN_SIGNAUX_POLARITE_INVERSEE_RECIT.indexOf('coherence_factuelle') !== -1,
        // Le cas normal, celui qui échouait 5 fois sur 6 : rien à signaler.
        rienASignaler: juger({ contradiction: false, preuve_contradiction_a: '', preuve_contradiction_b: '' }),
        // Le juge muet ou illisible ne doit plus coûter un tiers de Narration.
        jugeMuet: juger(undefined),
        jugeVide: juger({}),
        // Une contradiction RÉELLE, prouvée par deux passages retrouvés.
        contradictionProuvee: juger({
          contradiction: true,
          preuve_contradiction_a: 'cinq cent quatre-vingts metres de haut',
          preuve_contradiction_b: 'sept cents metres exactement'
        }),
        // Accusation non étayée : citations introuvables dans le texte.
        accusationEnLAir: juger({
          contradiction: true,
          preuve_contradiction_a: 'mille deux cents metres',
          preuve_contradiction_b: 'trois mille metres'
        }),
        // Deux fois LE MÊME passage : ça ne contredit rien.
        memePassageDeuxFois: juger({
          contradiction: true,
          preuve_contradiction_a: 'sept cents metres exactement',
          preuve_contradiction_b: 'sept cents metres exactement'
        })
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.inversee, true, 'le signal doit être déclaré à polarité inversée');

    assert.equal(vu.rienASignaler, true,
      'REGRESSION : un récit sans contradiction perd quand même son point. C\'est LE cas qui tombait '
      + '5 fois sur 6 et qui plafonnait la Narration à 67 sur 100.');
    assert.equal(vu.jugeMuet, true,
      'REGRESSION : un juge qui ne répond rien sur ce signal fait perdre un tiers de Narration. Un '
      + 'silence n\'est pas une contradiction.');
    assert.equal(vu.jugeVide, true, 'un objet vide non plus');

    assert.equal(vu.contradictionProuvee, false,
      'REGRESSION : une vraie contradiction, citée deux fois et retrouvée mot pour mot, ne coûte plus '
      + 'rien. Le signal ne sert alors plus à rien du tout.');

    assert.equal(vu.accusationEnLAir, true,
      'REGRESSION : une contradiction ANNONCÉE mais dont les citations sont introuvables fait perdre le '
      + 'point. Une accusation non étayée ne doit jamais peser sur une note, c\'est tout le principe de '
      + 'la vérification mécanique.');
    assert.equal(vu.memePassageDeuxFois, true,
      'REGRESSION : le même passage cité deux fois passe pour une contradiction. Un texte ne se '
      + 'contredit pas tout seul.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('originalite se prouve maintenant par une présence, pas par une absence', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const vu = await page.evaluate(() => {
      // Le prompt du juge est construit dans evaluerRecitGenere ; on lit la
      // source de la fonction, seul moyen d'attester ce qui est VRAIMENT
      // demandé au modèle sans payer un appel.
      const src = String(evaluerRecitGenere);
      return {
        demandeCitationPositive: /cite le passage PRÉCIS qui porte l'angle original/i.test(src),
        neDemandePlusLAbsence: !/pas un clich[ée] reconnaissable/i.test(src),
        // Les deux autres formulations improuvables doivent avoir disparu.
        plusDAucuneContradiction: !/aucune contradiction de date\/heure\/chiffre/i.test(src),
        plusDeNonRedondanceDansLePrompt: !/aucun segment cons[ée]cutif ne reformule/i.test(src),
        // Et le gabarit JSON doit refléter la nouvelle forme.
        gabaritContradiction: /"coherence_factuelle":\{"contradiction":false/.test(src),
        gabaritSansNonRedondance: !/"non_redondance":\{/.test(src)
      };
    });

    assert.equal(vu.demandeCitationPositive, true,
      'REGRESSION : le juge ne se voit plus demander de CITER le passage qui porte l\'angle original. '
      + 'Sans citation possible, le signal redevient invalidable à tort.');
    assert.equal(vu.neDemandePlusLAbsence, true,
      'REGRESSION : la formulation « pas un cliché » est revenue. Elle demande de prouver une absence, '
      + 'ce qu\'aucune citation ne peut faire.');
    assert.equal(vu.plusDAucuneContradiction, true,
      'REGRESSION : « aucune contradiction » est revenue dans le prompt. C\'est la formulation qui '
      + 'échouait 5 fois sur 6.');
    assert.equal(vu.plusDeNonRedondanceDansLePrompt, true,
      'REGRESSION : on redemande au juge de juger la redondance, alors qu\'elle se mesure en code.');
    assert.equal(vu.gabaritContradiction, true,
      'le gabarit JSON doit demander "contradiction", pas "present" : sinon le modèle répond dans '
      + 'l\'ancienne forme et la vérification ne trouve jamais ses citations');
    assert.equal(vu.gabaritSansNonRedondance, true,
      'REGRESSION : le gabarit réclame encore non_redondance au juge.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

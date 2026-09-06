// Retour du propriétaire, second PDF : la durée était enfin bonne (144 mots
// pour une cible de 138-163), mais le même script affichait FORCE
// ÉMOTIONNELLE 0 sur 100 alors qu'il est bourré de chiffres précis
// (« 150.000 km », « 800 euros », « 90 degrés »). La dimension émotion se
// calcule sur deux signaux, emotion_forte et details_concrets : à 0, les deux
// sont tombés à faux. Or « des chiffres précis plutôt que du vague », sur ce
// texte-là, c'est manifestement vrai.
//
// Cause : le juge doit CITER le passage qui prouve chaque signal, et la
// citation est vérifiée mot pour mot. Rien ne garantit qu'il recopie
// « 150.000 » plutôt que « 150 000 » ou « 150000 » : le français écrit les
// trois. La normalisation gérait déjà les apostrophes, les guillemets, les
// ellipses et les tirets, mais pas l'écriture des milliers. Un signal juste
// sur le fond était donc refusé sur la forme, et coûtait 50 points de force
// émotionnelle au créateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page;
}

test('une citation reste valide quelle que soit l\'écriture des milliers', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const r = await page.evaluate(() => {
      const texte = 'J\'ai roulé 150.000 km avec ce produit. Révision d\'urgence : 800 euros minimum.';
      const norm = _genNormaliserTexteJuge(texte);
      const essai = (citation) => _genValiderCitation(citation, norm).valide;
      return {
        memeEcriture: essai('150.000 km'),
        avecEspace: essai('150 000 km'),
        colle: essai('150000 km'),
        petitNombre: essai('800 euros'),
        // Le garde-fou doit rester strict : une citation réellement absente
        // ne doit pas devenir valide au passage.
        absente: essai('250.000 km'),
        inventee: essai('une phrase que ce texte ne contient pas')
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(r.memeEcriture, true, 'la citation à l\'identique doit évidemment passer');
    assert.equal(r.avecEspace, true,
      'REGRESSION : « 150 000 km » est refusé alors que le texte écrit « 150.000 km ». '
      + 'Le juge a raison sur le fond, c\'est notre comparaison qui le refuse sur la forme.');
    assert.equal(r.colle, true, 'REGRESSION : « 150000 km » est refusé pour la même raison');
    assert.equal(r.petitNombre, true, 'un nombre sans séparateur ne doit pas être abîmé');
    assert.equal(r.absente, false,
      'REGRESSION : un chiffre DIFFÉRENT devient valide. La souplesse sur la forme ne doit jamais '
      + 'devenir de la complaisance sur le fond.');
    assert.equal(r.inventee, false, 'une citation inventée reste rejetée');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les décimales ne sont jamais confondues avec des milliers', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      const n = (t) => _genNormaliserTexteJuge(t);
      return {
        decimaleVirgule: n('5,5 litres'),
        decimalePoint: n('0.7 point'),
        milliersPoint: n('150.000 km'),
        milliersEspace: n('150 000 km'),
        // Quatre chiffres après le séparateur : ce n'est pas un groupe de
        // milliers, on n'y touche pas.
        pasUnGroupe: n('12.3456')
      };
    });

    assert.equal(r.decimaleVirgule, '5,5 litres',
      'REGRESSION : une décimale est écrasée. « 5,5 » deviendrait « 55 ».');
    assert.equal(r.decimalePoint, '0.7 point', 'REGRESSION : « 0.7 » deviendrait « 07 »');
    assert.equal(r.pasUnGroupe, '12.3456', 'quatre chiffres ne forment pas un groupe de milliers');
    assert.equal(r.milliersPoint, r.milliersEspace, 'les deux écritures des milliers se rejoignent');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un signal refusé malgré un « présent » déclaré laisse une trace', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);

    const r = await page.evaluate(async () => {
      const journal = [];
      window.journaliserEchecEvaluation = (mode, detail) => journal.push({ mode, detail });
      const texte = 'Un texte court et parfaitement banal.';
      // Juge simulé : il coche tout, mais ne cite correctement qu'un signal.
      const vrai = { present: true, preuve: 'Un texte court' };
      const faux = { present: true, preuve: 'une citation absente du texte' };
      window.callAI = async () => JSON.stringify({
        hook_fort: vrai, pattern_interrupt: faux, boucle_ouverte: { present: true, preuve_ouverture: 'Un texte', preuve_cloture: 'banal' },
        details_concrets: faux, emotion_forte: faux, cta_clair: faux,
        originalite: faux, promesse_tenue: { present: false }
      });
      const signaux = await evaluerScriptGenere(texte, 'Générer des ventes');
      return { signaux: signaux, journal: journal };
    });

    assert.equal(r.signaux.hook_fort, true, 'une citation exacte valide le signal');
    assert.equal(r.signaux.details_concrets, false, 'une citation introuvable invalide le signal');
    assert.equal(r.journal.length, 1,
      'REGRESSION : ' + r.journal.length + ' entrée(s) de journal. Il en faut UNE, ni zéro (on ne '
      + 'saurait plus pourquoi un signal a été refusé) ni une par signal (ce serait du bruit).');
    assert.equal(r.journal[0].mode, 'citation-refusee-script');
    ['pattern_interrupt', 'details_concrets', 'emotion_forte', 'cta_clair', 'originalite'].forEach(cle => {
      assert.match(r.journal[0].detail, new RegExp(cle),
        'le journal doit nommer chaque signal refusé, sinon il ne sert à rien : ' + r.journal[0].detail);
    });
    assert.ok(!/hook_fort/.test(r.journal[0].detail),
      'un signal accepté n\'a rien à faire dans ce journal');
    assert.ok(!/promesse_tenue/.test(r.journal[0].detail),
      'un signal que le juge déclare ABSENT n\'est pas un refus de notre part, il ne doit pas y figurer');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

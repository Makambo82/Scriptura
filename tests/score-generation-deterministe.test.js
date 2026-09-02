// Non-régression pour une vraie faille trouvée lors de l'audit complet du
// 2 septembre 2026 : le "Scriptura Score" (Script ET Récit) venait
// directement de l'auto-évaluation de l'IA (un chiffre 0-100 par dimension
// choisi librement), deux générations identiques pouvaient afficher deux
// scores différents, contraire au pilier "mêmes données ⇒ même score,
// toujours" (voir CLAUDE.md). L'IA coche désormais des signaux booléens sur
// son propre texte, et scorerScriptGenere/scorerRecitGenere (js/generation.js,
// js/storytelling.js) calculent le score EN CODE à partir de ces cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('scorerScriptGenere (Script) : déterministe, et calculé à partir des signaux, jamais d\'un chiffre externe', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const resultats = await page.evaluate(() => {
      const wt = { min: 100, max: 150 };
      const tousVrais = { hook_fort: true, pattern_interrupt: true, boucle_ouverte: true, deuxieme_personne: true, rythme_soutenu: true, details_concrets: true, emotion_forte: true, cta_clair: true, originalite: true, promesse_tenue: true };
      const tousFaux = { hook_fort: false, pattern_interrupt: false, boucle_ouverte: false, deuxieme_personne: false, rythme_soutenu: false, details_concrets: false, emotion_forte: false, cta_clair: false, originalite: false, promesse_tenue: false };
      return {
        maxAuMilieu: scorerScriptGenere(tousVrais, 125, wt),
        minAuMilieu: scorerScriptGenere(tousFaux, 125, wt),
        appelRepete1: scorerScriptGenere(tousVrais, 125, wt),
        appelRepete2: scorerScriptGenere(tousVrais, 125, wt),
        sansSignaux: scorerScriptGenere(null, 125, wt),
        // Même signaux, mais un compte de mots très hors cible : la
        // rétention doit baisser, les autres dimensions doivent rester
        // IDENTIQUES (elles ne dépendent pas du compte de mots).
        horsCibleMots: scorerScriptGenere(tousVrais, 500, wt)
      };
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    // Tous les signaux cochés vrais => 100 sur chaque dimension basée sur signaux.
    assert.deepEqual(resultats.maxAuMilieu, { viral: 100, hook: 100, engagement: 100, emotion: 100, retention: 100 });
    // Tous les signaux cochés faux => 0 sur chaque dimension basée sur signaux.
    // Retention reste à 30 (pas 0) : mélangée à 30% avec le compte de mots
    // (125, dans la cible 100-150 => scoreMots=100), voir _genScoreRetention.
    assert.deepEqual(resultats.minAuMilieu, { viral: 0, hook: 0, engagement: 0, emotion: 0, retention: 30 });
    // Déterminisme : deux appels strictement identiques => résultat strictement identique.
    assert.deepEqual(resultats.appelRepete1, resultats.appelRepete2, 'mêmes signaux + mêmes données => même score, toujours (pilier de crédibilité)');
    // Signaux absents (repli défensif, jamais un plantage ni un score par défaut élevé) => 50 partout, sauf retention (mélangée au compte de mots).
    assert.equal(resultats.sansSignaux.viral, 50);
    assert.equal(resultats.sansSignaux.hook, 50);
    // Compte de mots très hors cible : la rétention baisse nettement sous 100
    // malgré des signaux parfaits, les 4 autres dimensions ne bougent pas
    // (elles ne dépendent jamais du compte de mots).
    assert.ok(resultats.horsCibleMots.retention < 100, 'un compte de mots très hors cible doit faire baisser la rétention : ' + JSON.stringify(resultats.horsCibleMots));
    assert.equal(resultats.horsCibleMots.viral, 100);
    assert.equal(resultats.horsCibleMots.hook, 100);
    assert.equal(resultats.horsCibleMots.engagement, 100);
    assert.equal(resultats.horsCibleMots.emotion, 100);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('scorerRecitGenere (Récit) : déterministe, et calculé à partir des signaux, jamais d\'un chiffre externe', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const resultats = await page.evaluate(() => {
      const wt = { min: 100, max: 150 };
      const tousVrais = { accroche_forte: true, rupture_attente: true, tension_maintenue: true, rythme_soutenu: true, details_concrets: true, emotion_forte: true, cloture_complete: true, coherence_factuelle: true, non_redondance: true, originalite: true };
      const tousFaux = { accroche_forte: false, rupture_attente: false, tension_maintenue: false, rythme_soutenu: false, details_concrets: false, emotion_forte: false, cloture_complete: false, coherence_factuelle: false, non_redondance: false, originalite: false };
      return {
        maxPartout: scorerRecitGenere(tousVrais, 125, wt),
        minPartout: scorerRecitGenere(tousFaux, 125, wt),
        appelRepete1: scorerRecitGenere(tousVrais, 125, wt),
        appelRepete2: scorerRecitGenere(tousVrais, 125, wt)
      };
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.deepEqual(resultats.maxPartout, { viral: 100, narration: 100, engagement: 100, emotion: 100, retention: 100 });
    // Retention reste à 30 (pas 0), même raison que pour le Script ci-dessus.
    assert.deepEqual(resultats.minPartout, { viral: 0, narration: 0, engagement: 0, emotion: 0, retention: 30 });
    assert.deepEqual(resultats.appelRepete1, resultats.appelRepete2, 'mêmes signaux + mêmes données => même score, toujours (pilier de crédibilité)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Renforcement (retour terrain, un score à 100% questionné à raison) :
// deuxieme_personne/rythme_soutenu sortent entièrement du jugement IA,
// détectés par du pur code (regex/statistique).
test('_genDetecterDeuxiemePersonne / _genDetecterRythmeSoutenu : détection 100% code, aucune IA', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const resultats = await page.evaluate(() => ({
      avecTu: _genDetecterDeuxiemePersonne('Tu vas voir ce que tu risques. Regarde bien.'),
      sansTu: _genDetecterDeuxiemePersonne('Il a vu ce qu\'il risquait. Il a bien regardé.'),
      unSeulTu: _genDetecterDeuxiemePersonne('Tu vois ça ? Il continue son chemin sans un mot.'),
      phrasesCourtes: _genDetecterRythmeSoutenu('Il court. Il tombe. Il se relève. Il repart.'),
      phrasesLongues: _genDetecterRythmeSoutenu('Après avoir longuement réfléchi à toutes les conséquences possibles de son choix, il décida finalement, non sans une certaine appréhension mêlée d\'espoir, de tenter malgré tout sa chance dans cette aventure incertaine.')
    }));

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(resultats.avecTu, true, 'au moins 2 occurrences de tu/vous => signal vrai');
    assert.equal(resultats.sansTu, false, 'aucune adresse directe => signal faux');
    assert.equal(resultats.unSeulTu, false, 'une seule occurrence isolée => pas assez pour déclencher le signal');
    assert.equal(resultats.phrasesCourtes, true, 'phrases courtes => rythme soutenu');
    assert.equal(resultats.phrasesLongues, false, 'phrase très longue => pas de rythme soutenu');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Renforcement (retour terrain) : le juge est un appel IA INDÉPENDANT qui
// doit citer un passage EXACT du texte pour chaque signal coché ; une
// citation qui n'existe pas mot pour mot dans le texte invalide le signal,
// même si l'IA a répondu "present":true.
test('evaluerScriptGenere : une citation introuvable dans le texte invalide le signal, même si "present":true', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const jugementFake = {
      hook_fort: { present: true, preuve: 'Ils ont promis de lâcher le pouvoir' }, // vraie citation, présente dans le texte
      pattern_interrupt: { present: true, preuve: 'une phrase totalement inventée qui ne figure nulle part' }, // fausse citation
      boucle_ouverte: { present: false, preuve: '' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      cta_clair: { present: true, preuve: 'Suis-moi pour la suite' }, // vraie citation
      originalite: { present: false, preuve: '' },
      promesse_tenue: { present: false, preuve: '' }
    };
    await poserMocksReseau(page, {
      generate: () => ({ content: [{ text: JSON.stringify(jugementFake) }] })
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const texte = 'Ils ont promis de lâcher le pouvoir. Trois ans plus tard, rien n\'a changé. Suis-moi pour la suite.';
    const signaux = await page.evaluate((t) => evaluerScriptGenere(t), texte);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.hook_fort, true, 'citation réellement présente dans le texte => signal validé');
    assert.equal(signaux.cta_clair, true, 'citation réellement présente dans le texte => signal validé');
    assert.equal(signaux.pattern_interrupt, false, 'citation introuvable dans le texte => signal invalidé malgré present:true : ' + JSON.stringify(signaux));
    assert.equal(signaux.boucle_ouverte, false);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

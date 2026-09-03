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

// Cas réel signalé par le propriétaire (script Niger/Tiani, noté 25/100 à
// tort) : boucle_ouverte et promesse_tenue décrivent une relation entre le
// DÉBUT et la FIN du texte, jamais une technique prouvable par une seule
// citation. Le hook et la chute reprenaient presque mot pour mot la même
// idée ("connaît chaque pas d'avance"), mais l'ancien schéma à une seule
// citation ("preuve") ne pouvait tout simplement pas exprimer "prouvé par
// DEUX passages" : ces deux signaux exigent désormais preuve_ouverture ET
// preuve_cloture, la clôture devant se situer chronologiquement après
// l'ouverture dans le texte.
test('evaluerScriptGenere : boucle_ouverte/promesse_tenue exigent deux citations (ouverture + clôture), jamais une seule', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Tiani le savait déjà. Sauf que le président connaît chaque pas d\'avance. Les rues restent muettes. Il se rend sans condition devant les forces du président. Regarde comment les putschs meurent avant de commencer, un président qui connaît chaque pas d\'avance.';

    const jugementValide = {
      hook_fort: { present: true, preuve: 'Tiani le savait déjà' },
      pattern_interrupt: { present: false, preuve: '' },
      boucle_ouverte: { present: true, preuve_ouverture: 'Les rues restent muettes', preuve_cloture: 'Il se rend sans condition devant les forces du président' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      cta_clair: { present: false, preuve: '' },
      originalite: { present: false, preuve: '' },
      promesse_tenue: { present: true, preuve_ouverture: 'le président connaît chaque pas d\'avance', preuve_cloture: 'un président qui connaît chaque pas d\'avance' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementValide) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signauxValides = await page.evaluate((t) => evaluerScriptGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signauxValides.boucle_ouverte, true, 'ouverture puis clôture, toutes deux réellement présentes dans le texte => signal validé : ' + JSON.stringify(signauxValides));
    assert.equal(signauxValides.promesse_tenue, true, 'hook et chute qui se répondent réellement => signal validé (le vrai bug terrain) : ' + JSON.stringify(signauxValides));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('evaluerScriptGenere : promesse_tenue refusée si la "clôture" citée précède l\'"ouverture" (pas une vraie boucle début→fin)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Le président connaît chaque pas d\'avance. Tiani le savait déjà.';
    const jugementOrdreInverse = {
      hook_fort: { present: false, preuve: '' },
      pattern_interrupt: { present: false, preuve: '' },
      boucle_ouverte: { present: false, preuve_ouverture: '', preuve_cloture: '' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      cta_clair: { present: false, preuve: '' },
      originalite: { present: false, preuve: '' },
      // Citations inversées par rapport à leur position réelle dans le texte.
      promesse_tenue: { present: true, preuve_ouverture: 'Tiani le savait déjà', preuve_cloture: 'Le président connaît chaque pas d\'avance' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementOrdreInverse) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signaux = await page.evaluate((t) => evaluerScriptGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.promesse_tenue, false, 'la "clôture" doit être chronologiquement APRÈS l\'"ouverture", sinon ce n\'est pas une vraie relation début→fin : ' + JSON.stringify(signaux));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Même correctif miroir côté Récit (voir GEN_SIGNAUX_DEUX_CITATIONS_RECIT,
// js/storytelling.js) : tension_maintenue (relation début→fin) et
// cloture_complete (DEUX éléments obligatoires : triple question miroir ET
// signature métapoétique) exigent chacun deux citations distinctes.
test('evaluerRecitGenere : tension_maintenue/cloture_complete exigent deux citations, jamais une seule', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Un général pense avoir tout préparé. La tension monte à chaque heure qui passe sans réponse. Le silence finit par tout révéler. Alors, que retenir de cette histoire ? Que le pouvoir se joue avant même le premier coup de feu ? Moi, je t\'ai pas raconté un putsch. Je t\'ai raconté une défaite écrite à l\'avance.';

    const jugementValide = {
      accroche_forte: { present: false, preuve: '' },
      rupture_attente: { present: false, preuve: '' },
      tension_maintenue: { present: true, preuve_ouverture: 'La tension monte à chaque heure qui passe sans réponse', preuve_cloture: 'Le silence finit par tout révéler' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      cloture_complete: {
        present: true,
        preuve_question: 'Alors, que retenir de cette histoire ? Que le pouvoir se joue avant même le premier coup de feu ?',
        preuve_signature: 'Moi, je t\'ai pas raconté un putsch. Je t\'ai raconté une défaite écrite à l\'avance.'
      },
      coherence_factuelle: { present: false, preuve: '' },
      non_redondance: { present: false, preuve: '' },
      originalite: { present: false, preuve: '' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementValide) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signaux = await page.evaluate((t) => evaluerRecitGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.tension_maintenue, true, 'ouverture puis clôture, toutes deux réellement présentes => signal validé : ' + JSON.stringify(signaux));
    assert.equal(signaux.cloture_complete, true, 'question miroir puis signature, toutes deux réellement présentes et dans le bon ordre => signal validé : ' + JSON.stringify(signaux));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('evaluerRecitGenere : cloture_complete refusée si la signature citée précède la question (mauvais ordre)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Moi, je t\'ai pas raconté un putsch. Je t\'ai raconté une défaite écrite à l\'avance. Alors, que retenir de cette histoire ?';
    const jugementOrdreInverse = {
      accroche_forte: { present: false, preuve: '' },
      rupture_attente: { present: false, preuve: '' },
      tension_maintenue: { present: false, preuve_ouverture: '', preuve_cloture: '' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      // Citations inversées par rapport à leur position réelle dans le texte.
      cloture_complete: {
        present: true,
        preuve_question: 'Alors, que retenir de cette histoire ?',
        preuve_signature: 'Moi, je t\'ai pas raconté un putsch'
      },
      coherence_factuelle: { present: false, preuve: '' },
      non_redondance: { present: false, preuve: '' },
      originalite: { present: false, preuve: '' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementOrdreInverse) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signaux = await page.evaluate((t) => evaluerRecitGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.cloture_complete, false, 'la signature doit se situer APRÈS la question dans le texte, sinon ce n\'est pas la vraie structure de clôture : ' + JSON.stringify(signaux));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour créateur : les dimensions "viral" et "émotion" tombaient souvent à
// 0% ou très bas sur des scripts pourtant solides, à cause de deux failles
// distinctes dans le juge indépendant.
//
// FAILLE 1 : le rédacteur et le juge sont deux appels IA SÉPARÉS (voulu,
// anti-complaisance), rien ne garantit qu'ils tapent la même apostrophe
// (' vs '), les mêmes guillemets, la même ellipse (... vs …) ou le même
// tiret. Une citation vraie en substance mais typographiée différemment
// était rejetée par un simple indexOf(), faisant tomber le signal à false
// alors que le juge avait raison sur le fond. _genNormaliserTexteJuge/
// _genValiderCitation normalisent désormais ces variantes des deux côtés
// avant comparaison.
test('evaluerScriptGenere : une citation reste valide malgré une apostrophe, une ellipse ou un tiret différents de ceux du texte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // Texte du script : apostrophe COURBE, ellipse unicode, tiret long.
    const texte = 'L’attitude positive n’est pas feinte… Un choix simple — rester ou partir. Suis-moi pour la suite.';

    const jugementFake = {
      hook_fort: { present: false, preuve: '' },
      pattern_interrupt: { present: false, preuve: '' },
      boucle_ouverte: { present: false, preuve: '' },
      details_concrets: { present: false, preuve: '' },
      // Citation retapée avec une apostrophe DROITE, alors que le texte a une apostrophe COURBE.
      emotion_forte: { present: true, preuve: 'L\'attitude positive n\'est pas feinte' },
      // Citation encadrée de guillemets français par le juge, retapée avec trois points et un tiret simple.
      cta_clair: { present: true, preuve: '«Un choix simple - rester ou partir»' },
      originalite: { present: false, preuve: '' },
      promesse_tenue: { present: false, preuve: '' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementFake) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signaux = await page.evaluate((t) => evaluerScriptGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.emotion_forte, true, 'apostrophe différente (courbe vs droite) => la citation doit rester valide : ' + JSON.stringify(signaux));
    assert.equal(signaux.cta_clair, true, 'guillemets ajoutés + ellipse/tiret différents => la citation doit rester valide : ' + JSON.stringify(signaux));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('evaluerScriptGenere : une citation réellement absente du texte reste rejetée malgré la normalisation', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Un texte tout à fait ordinaire, sans grande tension.';
    const jugementFake = {
      hook_fort: { present: false, preuve: '' },
      pattern_interrupt: { present: false, preuve: '' },
      boucle_ouverte: { present: false, preuve: '' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: true, preuve: 'ceci n\'apparaît nulle part dans le texte fourni' },
      cta_clair: { present: false, preuve: '' },
      originalite: { present: false, preuve: '' },
      promesse_tenue: { present: false, preuve: '' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementFake) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signaux = await page.evaluate((t) => evaluerScriptGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.emotion_forte, false, 'la normalisation ne doit jamais valider une citation qui n\'existe vraiment pas dans le texte : ' + JSON.stringify(signaux));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// FAILLE 2 : "cta_clair" (1/3 du score viral) demandait systématiquement un
// appel à l'action PARLÉ. Or pour l'objectif "Faire plus de vues", le script
// est volontairement écrit SANS CTA parlé (boucle chute→hook à la place,
// voir codesObjectifScript, js/generation.js) : le juge cherchait donc un
// CTA qui n'est plus censé exister, condamnant "viral" à plafonner à 2/3 sur
// cet objectif quelle que soit la qualité réelle. evaluerScriptGenere reçoit
// désormais l'objectif choisi (jamais le brief ni la stratégie, pour ne pas
// réintroduire de biais d'auto-complaisance) et adapte UNIQUEMENT ce critère.
test('evaluerScriptGenere : pour "Faire plus de vues", le juge vérifie la boucle chute→hook, jamais un CTA parlé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Tiani le savait déjà, 22h à Niamey. Et depuis ce soir-là, tout Niamey le sait aussi.';
    // Le juge coche cta_clair vrai en citant la BOUCLE (chute qui reprend
    // "Niamey" et "savait" du hook), jamais une phrase d'appel à l'action :
    // un script bien fait pour cet objectif n'en contient plus.
    const jugementBoucle = {
      hook_fort: { present: false, preuve: '' },
      pattern_interrupt: { present: false, preuve: '' },
      boucle_ouverte: { present: false, preuve: '' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      cta_clair: { present: true, preuve: 'Et depuis ce soir-là, tout Niamey le sait aussi' },
      originalite: { present: false, preuve: '' },
      promesse_tenue: { present: false, preuve: '' }
    };

    let dernierPrompt = '';
    await poserMocksReseau(page, {
      generate: (body) => {
        dernierPrompt = JSON.stringify(body.messages || []);
        return { content: [{ text: JSON.stringify(jugementBoucle) }] };
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const signauxVues = await page.evaluate(
      (t) => evaluerScriptGenere(t, 'Faire plus de vues et maximiser la portée'),
      texte
    );
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.match(dernierPrompt, /PORTÉE PURE/, 'le prompt du juge doit demander la boucle, pas un CTA parlé, pour cet objectif');
    assert.doesNotMatch(dernierPrompt, /un vrai appel à l'action qui dit précisément quoi faire/,
      'le critère CTA classique ne doit plus apparaître pour cet objectif');
    assert.equal(signauxVues.cta_clair, true,
      'une vraie boucle chute→hook doit valider cta_clair pour "Faire plus de vues", sans qu\'aucun CTA parlé n\'existe : ' + JSON.stringify(signauxVues));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('evaluerScriptGenere : pour les autres objectifs, le critère CTA classique reste inchangé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Un texte quelconque. Commente "OUI" pour recevoir le lien.';
    const jugementCtaClassique = {
      hook_fort: { present: false, preuve: '' },
      pattern_interrupt: { present: false, preuve: '' },
      boucle_ouverte: { present: false, preuve: '' },
      details_concrets: { present: false, preuve: '' },
      emotion_forte: { present: false, preuve: '' },
      cta_clair: { present: true, preuve: 'Commente "OUI" pour recevoir le lien' },
      originalite: { present: false, preuve: '' },
      promesse_tenue: { present: false, preuve: '' }
    };

    let dernierPrompt = '';
    await poserMocksReseau(page, {
      generate: (body) => {
        dernierPrompt = JSON.stringify(body.messages || []);
        return { content: [{ text: JSON.stringify(jugementCtaClassique) }] };
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

    const signauxVentes = await page.evaluate(
      (t) => evaluerScriptGenere(t, 'Générer des ventes via mon contenu'),
      texte
    );
    const signauxSansObjectif = await page.evaluate((t) => evaluerScriptGenere(t), texte);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.match(dernierPrompt, /un vrai appel à l'action qui dit précisément quoi faire/,
      'le critère CTA classique doit rester posé pour un objectif autre que "Faire plus de vues"');
    assert.doesNotMatch(dernierPrompt, /PORTÉE PURE/, 'le critère boucle ne doit apparaître QUE pour "Faire plus de vues"');
    assert.equal(signauxVentes.cta_clair, true, 'un vrai CTA parlé doit toujours valider cta_clair hors objectif "vues" : ' + JSON.stringify(signauxVentes));
    assert.equal(signauxSansObjectif.cta_clair, true, 'sans objectif transmis, le comportement par défaut reste le critère CTA classique : ' + JSON.stringify(signauxSansObjectif));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Même correctif de normalisation côté Récit (voir _genNormaliserTexteJugeRecit,
// js/storytelling.js), qui avait en plus une 3e copie divergente de la même
// logique en ligne dans evaluerRecitGenere : unifiée pour ne dépendre que
// d'un seul point de correction.
test('evaluerRecitGenere : une citation reste valide malgré une apostrophe ou des guillemets différents de ceux du texte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const texte = 'Il pensait avoir tout prévu… L’attente est devenue insoutenable. Personne ne l’a vu venir.';
    const jugementFake = {
      accroche_forte: { present: false, preuve: '' },
      rupture_attente: { present: false, preuve: '' },
      tension_maintenue: { present: false, preuve_ouverture: '', preuve_cloture: '' },
      details_concrets: { present: false, preuve: '' },
      // Ellipse retapée en trois points, apostrophe droite au lieu de courbe.
      emotion_forte: { present: true, preuve: 'Il pensait avoir tout prévu... L\'attente est devenue insoutenable' },
      cloture_complete: { present: false, preuve_question: '', preuve_signature: '' },
      coherence_factuelle: { present: false, preuve: '' },
      non_redondance: { present: false, preuve: '' },
      originalite: { present: false, preuve: '' }
    };
    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(jugementFake) }] }) });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const signaux = await page.evaluate((t) => evaluerRecitGenere(t), texte);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(signaux.emotion_forte, true, 'ellipse et apostrophe différentes => la citation doit rester valide : ' + JSON.stringify(signaux));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

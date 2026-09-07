// Retour du propriétaire, et c'est un bug qui BLOQUAIT des générations :
// « par défaut le choix est sur 1 minute. Mais quand on clique sur générer,
// l'app demande qu'on choisisse la durée, or la durée est déjà sur 1 minute.
// Ce que je fais souvent, c'est que je glisse vers l'avant, je glisse encore
// vers l'arrière pour remettre ça sur 1, et c'est à ce moment que
// l'application tient compte de la durée. »
//
// LA CAUSE : le reste de l'app ne lit pas le <select> au moment de générer, il
// garde une COPIE de sa valeur, mise à jour uniquement quand un 'change' passe
// (selectedDuree, storyDuree, serieDuree). Avec un menu déroulant, cette copie
// partait vide ET le champ aussi : les deux disaient la même chose, le défaut
// ne pouvait pas exister. Avec un curseur, le champ est TOUJOURS quelque part
// dès l'ouverture, la copie non. L'écran et la mémoire de l'app se sont mis à
// diverger en silence, et c'est l'écran qui avait raison.
//
// LE PIÈGE DE LA CORRECTION : les curseurs sont initialisés AVANT que
// l'écouteur du mode Script ne soit posé (js/app.js, initSlidersChoix ligne
// 273, écouteur ligne 292). Un envoi synchrone du 'change' arriverait avant
// que quiconque n'écoute et n'aurait corrigé que la Série. Ces tests vérifient
// donc les TROIS modes, pas seulement celui d'où venait le retour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);   // laisse passer l'envoi différé
  return page;
}

test('la valeur de départ du curseur est connue de l\'app, sans y toucher', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => ({
      // Ce que l'écran montre, et ce que l'app a retenu. Les deux doivent
      // dire la même chose SANS que personne n'ait bougé le curseur.
      script: { affiche: document.getElementById('dureeGrid').value, memorise: typeof selectedDuree !== 'undefined' ? selectedDuree : null },
      recit: { affiche: document.getElementById('storyDureeGrid').value, memorise: typeof storyDuree !== 'undefined' ? storyDuree : null },
      serie: { affiche: document.getElementById('serieDureeGrid').value, memorise: typeof serieDuree !== 'undefined' ? serieDuree : null },
      // Et personne n'a choisi : le pré-remplissage depuis le profil doit
      // continuer de pouvoir écrire dans ces champs.
      choisiScript: document.getElementById('dureeGrid').dataset.choisi || null
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    assert.ok(vu.script.affiche, 'le curseur du Script affiche bien une durée par défaut');
    assert.equal(vu.script.memorise, vu.script.affiche,
      'REGRESSION : l\'app ignore la durée affichée par le curseur du mode Script. C\'est LE bug remonté '
      + 'par le propriétaire : elle réclame une durée déjà visible à l\'écran, et il faut bouger le '
      + 'curseur puis le remettre où il était pour débloquer la génération. Affiché : '
      + vu.script.affiche + ', mémorisé : ' + JSON.stringify(vu.script.memorise));

    assert.equal(vu.recit.memorise, vu.recit.affiche,
      'REGRESSION : même bug sur le mode Récit. Affiché : ' + vu.recit.affiche
      + ', mémorisé : ' + JSON.stringify(vu.recit.memorise));

    assert.equal(vu.serie.memorise, vu.serie.affiche,
      'REGRESSION : même bug sur le mode Série. Affiché : ' + vu.serie.affiche
      + ', mémorisé : ' + JSON.stringify(vu.serie.memorise));

    assert.equal(vu.choisiScript, null,
      'REGRESSION : annoncer la valeur de départ a marqué le champ comme CHOISI. Le pré-remplissage '
      + 'depuis le profil du créateur ne remplit que les champs encore vides : sa durée habituelle ne '
      + 'serait plus jamais reposée, et il retomberait en silence sur la valeur par défaut.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('générer sans avoir touché au curseur ne réclame plus de durée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // On remplit tout SAUF la durée, qu'on laisse à sa valeur par défaut,
    // exactement comme le fait le propriétaire.
    const message = await page.evaluate(async () => {
      unlocked = true;
      chooseMode('script');
      document.getElementById('sujet').value = 'les empires africains';
      const boite = document.getElementById('errorBox');
      boite.textContent = ''; boite.style.display = 'none';
      try { await generate(); } catch (e) { /* l'appel IA est bouché par les mocks, seul le contrôle nous intéresse */ }
      return { texte: boite.textContent || '', visible: boite.style.display };
    });
    await page.waitForTimeout(300);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.doesNotMatch(message.texte, /dur[ée]e/i,
      'REGRESSION : l\'app réclame encore une durée alors que le curseur en affiche une depuis '
      + 'l\'ouverture. Message vu : « ' + message.texte + ' »');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('après une remise à zéro, l\'app suit le repli du curseur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(async () => {
      const el = document.getElementById('dureeGrid');
      // Le créateur choisit vraiment une autre durée…
      el.value = '5 minutes';
      await new Promise(r => setTimeout(r, 50));
      const apresChoix = { affiche: el.value, memorise: selectedDuree };
      // …puis une remise à zéro de formulaire écrit '' (c'est ce que font
      // plusieurs resets de l'app). Le curseur, lui, retombe sur son défaut.
      el.value = '';
      await new Promise(r => setTimeout(r, 50));
      return { apresChoix: apresChoix, apresReset: { affiche: el.value, memorise: selectedDuree } };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.apresChoix.memorise, '5 minutes', 'un vrai choix reste bien enregistré');

    assert.ok(vu.apresReset.affiche, 'le curseur retombe sur une valeur, il est toujours quelque part');
    assert.equal(vu.apresReset.memorise, vu.apresReset.affiche,
      'REGRESSION SILENCIEUSE, et c\'est la pire : après une remise à zéro, l\'écran affiche « '
      + vu.apresReset.affiche + ' » pendant que l\'app génère sur « ' + vu.apresReset.memorise
      + ' », la durée du script précédent. Personne ne peut le voir avant de compter les mots du '
      + 'résultat.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

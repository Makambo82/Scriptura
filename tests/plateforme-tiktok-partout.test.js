// Décision du propriétaire : supprimer le sélecteur de plateforme de TOUS les
// modes, et renforcer dans les prompts que la plateforme est TikTok.
//
// POURQUOI CE N'ÉTAIT PAS UN SIMPLE RETRAIT DE CHAMP. Le sélecteur n'était pas
// décoratif : il injectait des consignes CONCRÈTES dans les prompts (rythme,
// registre, format des hooks, codes de légende et de hashtags). Le retirer
// sans rien faire d'autre aurait fait basculer les prompts sur leur repli
// générique ("aucune plateforme précisée, reste généraliste"), c'est-à-dire
// AFFAIBLI les générations. La valeur est donc figée sur TikTok ET la
// consigne réécrite de façon directive, ce qui est meilleur qu'avant pour les
// créateurs qui laissaient le choix par défaut, c'est-à-dire presque tous.
//
// LE PIÈGE, trouvé en creusant et corrigé ici : la mémoire du profil
// enregistrait les plateformes observées et REPOSAIT LA PREMIÈRE dans l'état
// (js/recommandations.js). Sans correction, un créateur dont le profil avait
// mémorisé LinkedIn aurait continué à recevoir des scripts en registre
// professionnel, sans aucun moyen de le voir ni de le corriger puisque le
// champ avait disparu. Exactement le défaut de la durée héritée, qui a produit
// un script de 48 secondes pendant que le formulaire affichait 2 minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

async function ouvrir(page, baseUrl, gestionnaires) {
  await poserMocksReseau(page, gestionnaires || {});
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'PLAT' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(400);
}

test('plus aucun sélecteur de plateforme, dans aucun mode', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl);

    const vu = await page.evaluate(() => {
      // Tous les écrans révélés d'un coup : un champ caché derrière un repli
      // (le panneau "Affiner" des Idées, par exemple) compte quand même.
      TOUS_LES_ECRANS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.setProperty('display', 'block', 'important');
      });
      return {
        script: !!document.getElementById('platformPicker'),
        idees: !!document.getElementById('ideaPlatformGrid'),
        recit: !!document.getElementById('storyPlatformGrid'),
        storyboard: !!document.getElementById('sbSeulPlatformGrid'),
        // Aucun libellé "Plateforme" ne doit subsister dans un formulaire.
        libelles: Array.from(document.querySelectorAll('.ctx-label'))
          .filter(l => /plateforme/i.test(l.textContent))
          .map(l => l.textContent.trim())
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.script, false, 'le mode Script n\'a plus son sélecteur à logos');
    assert.equal(vu.idees, false, 'le mode Idées non plus');
    assert.equal(vu.recit, false, 'le mode Récit non plus');
    assert.equal(vu.storyboard, false, 'le Storyboard seul non plus');
    assert.deepEqual(vu.libelles, [],
      'REGRESSION : un libellé "Plateforme" subsiste, il promet un choix qui n\'existe plus : ' + JSON.stringify(vu.libelles));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la plateforme est figée sur TikTok partout dans le code', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl);

    const vu = await page.evaluate(() => ({
      etat: state.plateforme,
      idees: ideaPlatform,
      recit: storyPlatform,
      storyboard: sbSeulPlatform,
      constante: typeof PLATEFORME_SCRIPTURA !== 'undefined' ? PLATEFORME_SCRIPTURA : null
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.constante, 'TikTok', 'la décision est nommée dans le code, pas éparpillée en chaînes littérales');
    ['etat', 'idees', 'recit', 'storyboard'].forEach(cle => {
      assert.equal(vu[cle], 'TikTok',
        'REGRESSION (' + cle + ') : une valeur vide ferait basculer le prompt sur son repli générique, plus faible : ' + vu[cle]);
    });
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une plateforme mémorisée dans le profil ne s\'impose plus en douce', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl);

    const apres = await page.evaluate(() => {
      // Un créateur dont le profil a mémorisé LinkedIn, qui part d'une
      // recommandation : c'est LE chemin qui reposait la plateforme du profil.
      _profilCreateur = {
        declare: { niche_principale: '', objectifs: [] },
        observe: { plateformes: ['LinkedIn'] },
        preferences: {}
      };
      state.plateforme = 'LinkedIn';
      _recommandationsParContainer.set('_testReco', [{ titre: 'Un sujet', angle: 'un angle' }]);
      creerScriptDepuisRecommandation('_testReco', 0);
      return state.plateforme;
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres, 'TikTok',
      'REGRESSION : un profil ayant mémorisé une autre plateforme imposerait un registre que le créateur ne peut plus ni voir ni corriger');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les prompts affirment TikTok, et n\'ont plus de repli générique', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const prompts = [];
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrir(page, baseUrl, {
      generate: (body) => { prompts.push(JSON.stringify(body.messages || '')); return { content: [{ text: '{}' }] }; }
    });

    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('flow').style.display = 'block';
      state.objectif = 'Faire plus de vues et maximiser la portée';
      state.depart = 'un sujet précis';
      showStep(2);
      document.getElementById('niche').value = 'Histoire';
      document.getElementById('sujet').value = 'les empires africains';
      const d = document.getElementById('dureeGrid');
      d.value = '1 minute';
      d.dispatchEvent(new Event('change', { bubbles: true }));
      return generate();
    });
    await page.waitForTimeout(2500);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(prompts.length, 'un prompt doit avoir été envoyé');
    const p = prompts.join(' ');

    assert.match(p, /RÈGLE ABSOLUE : ce script est destiné à TIKTOK/,
      'REGRESSION : sans cette règle, le script perd le rythme rapide, le tutoiement direct et les coupes fréquentes');
    // La consigne doit rester CONCRÈTE, pas se réduire au nom de la
    // plateforme : c'est le contenu des codes qui fait la différence de
    // qualité, pas le mot "TikTok".
    assert.match(p, /hook qui frappe dès le premier mot/, 'la consigne reste concrète');
    assert.match(p, /tutoiement direct/, 'et directive');
    assert.doesNotMatch(p, /Aucune plateforme précisée/,
      'REGRESSION : le repli générique produisait des scripts moins ancrés, il ne doit plus jamais être atteignable');
    assert.doesNotMatch(p, /Plateforme\(s\) habituelle\(s\)/,
      'la ligne du profil n\'a plus lieu d\'être : tout le monde est sur TikTok, et chaque prompt le dit déjà');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

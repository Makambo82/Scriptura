// Retour terrain du 4 septembre 2026 : un script généré alors que le
// formulaire affichait « 2 minutes », mais écrit et calibré pour 1 minute
// (120 mots, 48 secondes de narration).
//
// Cause exacte, trouvée en remontant du score : la rétention affichée (98)
// n'est mathématiquement atteignable qu'avec la cible « 1 minute ». Avec la
// cible « 2 minutes », le même script donnait 83 ET un avertissement de durée
// visible. L'app avait donc bien calculé sur 1 minute pendant que le créateur
// lisait « 2 minutes » à l'écran.
//
// La mémoire du créateur (js/profil.js) pré-remplit les champs connus en
// posant `el.value` en code. Or plusieurs choix du formulaire ne vivent pas
// dans le <select> : ils sont recopiés dans une variable JS par un écouteur
// 'change' (selectedDuree, selectedTone, ideaTone), et c'est cette variable,
// jamais le champ, que la génération lit. Poser `el.value` ne déclenche aucun
// 'change'. Le menu déroulant maison, lui, intercepte le setter pour
// rafraîchir le bouton affiché : le créateur voyait donc bien son choix
// pré-rempli, pendant que la variable restait vide et que la génération
// retombait sur sa valeur par défaut.
//
// Deux dégâts silencieux, sur trois modes : la DURÉE pré-remplie était ignorée
// (script calibré 1 minute au lieu de la durée affichée) et le TON pré-rempli
// aussi (le bloc « TON, RÈGLE ABSOLUE » disparaissait du prompt).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('un choix pré-rempli depuis le profil est VRAIMENT pris en compte, pas seulement affiché', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROFIL' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      // Champs encore vierges, exactement l'état dans lequel la mémoire du
      // créateur pré-remplit.
      document.getElementById('dureeGrid').value = '';
      document.getElementById('tone').value = '';
      selectedDuree = '';
      selectedTone = '';

      preRemplirSiVide('dureeGrid', '2 minutes');
      preRemplirSiVide('tone', document.getElementById('tone').options[1].value);

      return {
        champDuree: document.getElementById('dureeGrid').value,
        variableDuree: selectedDuree,
        champTon: document.getElementById('tone').value,
        variableTon: selectedTone
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.champDuree, '2 minutes', 'le champ affiche bien la durée pré-remplie');
    assert.equal(vu.variableDuree, '2 minutes',
      'REGRESSION : c\'est CETTE variable que la génération lit, pas le champ. Vide ici, le script serait calibré sur la durée par défaut alors que le créateur lit "2 minutes" à l\'écran.');
    assert.ok(vu.champTon, 'le champ affiche bien le ton pré-rempli');
    assert.equal(vu.variableTon, vu.champTon,
      'REGRESSION : un ton pré-rempli mais non répercuté disparaît entièrement du prompt (bloc "TON, RÈGLE ABSOLUE")');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mode Idées : le ton pré-rempli atteint vraiment le prompt', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROFILID' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      document.getElementById('ideaTone').value = '';
      ideaTone = '';
      preRemplirSiVide('ideaTone', document.getElementById('ideaTone').options[1].value);
      return { champ: document.getElementById('ideaTone').value, variable: ideaTone };
    });

    assert.deepEqual(erreursJs, []);
    assert.ok(vu.champ);
    assert.equal(vu.variable, vu.champ,
      'REGRESSION : ideaTone vide retire toute la consigne de ton du prompt Idées');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la durée pré-remplie pilote réellement la cible de mots de la génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const promptsEcriture = [];
    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 16000) promptsEcriture.push(JSON.stringify(body.messages || []));
      if (body.max_tokens === 2000) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' }) }] }) });
      }
      // Réponse volontairement inexploitable ensuite : ce test ne s'intéresse
      // qu'au prompt d'écriture, pas au résultat.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROFILDUR' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Histoire';
      document.getElementById('sujet').value = 'Behanzin';
      ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      state.depart = 'un sujet précis';
      // La durée arrive UNIQUEMENT par le pré-remplissage, comme le fait la
      // mémoire du créateur à l'ouverture du mode.
      document.getElementById('dureeGrid').value = '';
      selectedDuree = '';
      preRemplirSiVide('dureeGrid', '2 minutes');
    });
    await page.evaluate(() => generate());
    await page.waitForTimeout(3000);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(promptsEcriture.length, 'le prompt d\'écriture doit avoir été envoyé');
    // Cible "2 minutes" = 280-320 mots (voir wordTargets, js/generation.js).
    // Recentrée le 6 septembre : le milieu de l'ancienne 270-310 valait 116
    // secondes, pas 120 (voir tests/duree-cibles-centrees.test.js).
    assert.match(promptsEcriture[0], /280 et 320 mots/,
      'REGRESSION : le script doit être commandé pour la durée AFFICHÉE au créateur, jamais pour la durée par défaut');
    assert.ok(!/138 et 163 mots/.test(promptsEcriture[0]),
      'la cible "1 minute" par défaut ne doit plus apparaître quand 2 minutes est pré-rempli');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Décision du propriétaire, après le retour terrain de la durée héritée :
// limiter le pré-remplissage aux TRAITS STABLES du créateur (sa niche, son
// format faceless ou face caméra) et ne plus pré-remplir les DÉCISIONS PAR
// VIDÉO (ton, durée, genre narratif, objectif). Hériter d'une durée ou d'un ton
// de la génération précédente revient à supposer que le créateur fait toujours
// exactement la même vidéo : ce n'est pas un service, c'est une surprise.
//
// À ne pas confondre avec une suppression de la mémoire du créateur : celle-ci
// continue d'alimenter la ligne de contexte des prompts, avec l'anti-répétition
// des angles, hooks et structures déjà produits. Seul le pré-remplissage du
// formulaire est concerné.
test('le pré-remplissage se limite aux traits stables : niche et format', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // Un profil bien rempli : TOUT est connu de ce créateur.
    const profil = {
      declare: {
        niche_principale: 'Histoire',
        style_contenu: 'Faceless',
        ton_prefere: 'Storytelling',
        duree_moyenne: '2 minutes',
        structure_narrative: 'Enquête',
        objectifs: ['Faire des vues']
      },
      observe: { themes_traites: [], themes_a_eviter: [], plateformes: [], hooks_recents: [], angles_recents: [], structures_recentes: [], nb_generations: 5 },
      lecons: { recommandations_permanentes: [], dernier_score_audit: null }
    };
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROFILSTABLE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    // chargerProfilCreateur renvoie ce cache tel quel : on teste la POLITIQUE
    // de pré-remplissage, pas le transport réseau (couvert ailleurs).
    const vu = await page.evaluate(async (profil) => {
      _profilCreateur = profil;
      ['niche', 'format', 'tone', 'dureeGrid'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
      selectedTone = ''; selectedDuree = '';
      await appliquerProfilCreateur('script');
      return {
        niche: document.getElementById('niche').value,
        format: document.getElementById('format').value,
        ton: document.getElementById('tone').value,
        duree: document.getElementById('dureeGrid').value,
        varTon: selectedTone,
        varDuree: selectedDuree
      };
    }, profil);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.niche, 'Histoire', 'la niche est un trait stable, elle reste pré-remplie');
    assert.ok(vu.format, 'le format aussi (faceless ou face caméra ne change pas d\'une vidéo à l\'autre) : ' + vu.format);
    assert.equal(vu.ton, '',
      'REGRESSION : le ton est une décision par vidéo, l\'hériter impose un choix que le créateur n\'a pas fait');
    assert.equal(vu.duree, '',
      'REGRESSION : c\'est exactement la durée héritée qui a produit un script de 48 secondes pour un formulaire affichant 2 minutes');
    assert.equal(vu.varTon, '', 'et rien ne part en douce dans la variable lue par la génération');
    assert.equal(vu.varDuree, '');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la mémoire du créateur reste vivante dans les prompts, elle n\'est pas supprimée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const profil = {
      declare: { niche_principale: 'Histoire', style_contenu: 'Faceless', ton_prefere: 'Storytelling', duree_moyenne: '2 minutes', structure_narrative: null, objectifs: [] },
      observe: { themes_traites: ['Behanzin'], themes_a_eviter: [], plateformes: [], hooks_recents: ['Un roi qui dit non'], angles_recents: ['La résistance impossible'], structures_recentes: [], nb_generations: 5 },
      lecons: { recommandations_permanentes: [], dernier_score_audit: null }
    };
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PROFILPROMPT' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    const ligne = await page.evaluate(async (profil) => {
      _profilCreateur = profil;
      return ligneProfilPourPrompt(await chargerProfilCreateur());
    }, profil);

    assert.match(ligne, /niche habituelle : Histoire/, 'le profil continue d\'informer les prompts');
    assert.match(ligne, /hooks déjà utilisés/, 'et surtout l\'anti-répétition reste en place');
    assert.match(ligne, /Un roi qui dit non/, 'avec les hooks réellement produits');
    assert.match(ligne, /angles déjà exploités/);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

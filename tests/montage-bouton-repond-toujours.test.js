// Retour propriétaire : « le bouton "Générer la vidéo" ne répond pas quand on
// clique dessus, mais quand on va dans Script depuis mes générations, ça
// marche ». Un clic sans le moindre effet, et sans la moindre erreur en
// console : le pire symptôme à diagnostiquer.
//
// CAUSE EXACTE, reproduite avant d'être corrigée. ouvrirMontage (js/montage.js)
// DÉPLACE le panneau #montageModal juste sous la ligne d'actions du storyboard,
// pour qu'il se lise comme sa suite plutôt que comme une fenêtre par-dessus. Le
// panneau ne vit donc plus dans le <body> mais DANS #storyboardContainer. Or la
// génération suivante vide ce conteneur (renderResults, js/generation.js, fait
// `sbCont.innerHTML = ''`) : le panneau part avec. getElementById renvoie alors
// null, ouvrirMontage sort en silence, et le bouton paraît mort pour toujours.
//
// Ce défaut n'a rien de nouveau : il préexistait à l'ouverture du montage aux
// abonnés. Seul le fondateur cliquait ce bouton, et il fallait enchaîner deux
// montages dans la même session pour tomber dessus.
//
// La parade tient à une référence gardée sur le nœud : vider un conteneur
// DÉTACHE son contenu du document mais ne le détruit pas tant qu'on le
// référence. On raccroche donc le panneau d'origine, plutôt que d'en
// reconstruire un second qui dupliquerait tous ses identifiants dans la page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

// Reproduit la ligne d'actions telle que la produisent les 4 modes de
// storyboard (voir .sb-actions-fin), puis rend le bouton "Générer la vidéo".
const SCENARIO = `
  // Posés sur window, jamais en const : une déclaration const dans un eval
  // reste enfermée dans sa propre portée et serait invisible juste après.
  window.plans = [{ text: 'Plan un', visuel: 'x' }, { text: 'Plan deux', visuel: 'y' }];
  window.poserBouton = () => {
    let grid = document.getElementById('storyboardContainer');
    if (!grid) { grid = document.createElement('div'); grid.id = 'storyboardContainer'; document.body.appendChild(grid); }
    grid.innerHTML = '<div class="sb-actions-fin">' + montageBoutonHTML('btnTest' + Date.now(), window.plans) + '</div>';
    return grid.querySelector('.montage-trigger-btn');
  };
`;

test('le bouton "Générer la vidéo" répond ENCORE après une nouvelle génération', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(async (scenario) => {
      // eslint-disable-next-line no-eval
      eval(scenario);
      const attendre = () => new Promise(r => setTimeout(r, 200));
      const res = {};

      // 1er montage : le panneau est déplacé dans le storyboard.
      poserBouton().click();
      await attendre();
      const m1 = document.getElementById('montageModal');
      res.premierClic = { ouvert: !!m1 && m1.classList.contains('active'), plans: montagePlans.length };

      // Nouvelle génération : le conteneur du storyboard est vidé, ce qui
      // ARRACHE le panneau du document (c'est là que tout se jouait).
      document.getElementById('storyboardContainer').innerHTML = '';
      res.panneauDansLeDocument = !!document.getElementById('montageModal');

      // 2e clic, sur le nouveau script : DOIT rouvrir le panneau.
      poserBouton().click();
      await attendre();
      const m2 = document.getElementById('montageModal');
      res.secondClic = {
        ouvert: !!m2 && m2.classList.contains('active'),
        plans: montagePlans.length,
        // Un seul panneau dans la page : jamais un deuxième reconstruit, qui
        // dupliquerait tous les identifiants qu'il contient.
        exemplaires: document.querySelectorAll('#montageModal').length
      };
      return res;
    }, SCENARIO);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.premierClic.ouvert, true, 'le premier montage doit évidemment s\'ouvrir');
    assert.equal(vu.premierClic.plans, 2);
    assert.equal(vu.panneauDansLeDocument, false,
      'le vidage du conteneur détache bien le panneau : c\'est la situation qu\'on doit savoir rattraper');
    assert.equal(vu.secondClic.ouvert, true,
      'REGRESSION : après une nouvelle génération, le bouton ne répondait plus du tout, en silence');
    assert.equal(vu.secondClic.plans, 2, 'et il doit rouvrir avec les plans du NOUVEAU storyboard');
    assert.equal(vu.secondClic.exemplaires, 1,
      'un seul panneau dans la page, jamais un doublon qui dupliquerait ses identifiants');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('trois montages d\'affilée : le bouton ne meurt jamais en cours de session', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const ouvertures = await page.evaluate(async (scenario) => {
      // eslint-disable-next-line no-eval
      eval(scenario);
      const attendre = () => new Promise(r => setTimeout(r, 150));
      const resultats = [];
      for (let i = 0; i < 3; i++) {
        poserBouton().click();
        await attendre();
        const m = document.getElementById('montageModal');
        resultats.push(!!m && m.classList.contains('active'));
        // Chaque nouvelle génération vide le conteneur, comme en vrai.
        document.getElementById('storyboardContainer').innerHTML = '';
      }
      return resultats;
    }, SCENARIO);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(ouvertures, [true, true, true],
      'le montage doit rester ouvrable indéfiniment dans une même session : ' + JSON.stringify(ouvertures));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour du propriétaire, capture d'un portable à l'appui : « normalement sur
// PC cette page doit pas s'afficher comme ça. Au lieu que ça soit empilé, le
// mettre sur la même ligne. Si deux ou trois peuvent rester la même ligne
// c'est bon. Et je crois qu'il doit en être pareil au niveau de toute l'app. »
//
// Il a raison, et la cause est structurelle : Scriptura est écrit pour le
// téléphone, donc en une colonne étroite. Sur un écran de portable, cette
// colonne laisse 300 à 400 px de vide de CHAQUE côté pendant qu'on fait
// défiler des blocs qui tiendraient largement côte à côte.
//
// Ce test fige les deux moitiés de la réponse, et surtout la CONTRAINTE qui
// va avec : gagner sur PC ne doit rien coûter au téléphone. Une mise en page
// à deux colonnes mal écrite (largeurs fixes, grille sans point de rupture)
// se paie toujours sur le petit écran, en débordement horizontal ou en champs
// devenus illisibles. On mesure donc les deux largeurs dans le même test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const PC = { width: 1366, height: 900 };
const TELEPHONE = { width: 390, height: 844 };

async function ouvrir(navigateur, baseUrl, viewport) {
  const page = await navigateur.newPage({ viewport });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return page;
}

// Deux éléments sont « sur la même ligne » quand leurs bandes verticales se
// chevauchent : c'est la définition visuelle, pas une comparaison de `top` au
// pixel près (deux cartes de hauteurs différentes commencent au même y mais
// une note ou un libellé peut décaler l'une de quelques pixels).
const RANGS = `(elements) => {
  const boites = elements.map(e => e.getBoundingClientRect());
  let paires = 0;
  for (let i = 0; i < boites.length; i++) {
    for (let j = i + 1; j < boites.length; j++) {
      const a = boites[i], b = boites[j];
      const chevauche = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 8;
      if (chevauche && Math.abs(a.left - b.left) > 20) paires++;
    }
  }
  return paires;
}`;

test('sur PC, les blocs de montage se rangent côte à côte ; sur téléphone ils restent empilés', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const mesures = {};
    for (const [nom, vp] of [['pc', PC], ['telephone', TELEPHONE]]) {
      const page = await ouvrir(navigateur, baseUrl, vp);
      const erreursJs = [];
      page.on('pageerror', e => erreursJs.push(e.message));

      await page.evaluate(() => ouvrirMontageManuelAccueil());
      await page.waitForTimeout(350);

      mesures[nom] = await page.evaluate((corpsRangs) => {
        const blocs = Array.from(document.querySelectorAll('#montageManuelFlow .montage-section'))
          .filter(e => e.getBoundingClientRect().width > 0);
        return {
          nombre: blocs.length,
          paires: eval('(' + corpsRangs + ')')(blocs),
          deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      }, RANGS);
      assert.deepEqual(erreursJs, [], 'aucune erreur JS en ' + nom);
      await page.close();
    }

    assert.ok(mesures.pc.nombre >= 3, 'le test doit voir au moins trois blocs de montage');
    assert.ok(mesures.pc.paires >= 1,
      'REGRESSION : sur un écran de 1366 px, les ' + mesures.pc.nombre + ' blocs de montage sont de '
      + 'nouveau EMPILÉS les uns sous les autres. C\'est exactement la capture envoyée par le '
      + 'propriétaire : une colonne étroite au milieu, du vide de chaque côté.');
    assert.equal(mesures.telephone.paires, 0,
      'REGRESSION : sur un iPhone, deux blocs se retrouvent sur la même ligne. La mise en page à deux '
      + 'colonnes ne doit vivre QUE au-dessus de 1024 px, sinon elle écrase le petit écran.');
    assert.equal(mesures.telephone.deborde, 0, 'aucun débordement horizontal sur téléphone');
    assert.equal(mesures.pc.deborde, 0, 'aucun débordement horizontal sur PC');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('sur PC, les champs courts des formulaires se rangent par deux, les champs de saisie gardent toute la largeur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const mesures = {};
    for (const [nom, vp] of [['pc', PC], ['telephone', TELEPHONE]]) {
      const page = await ouvrir(navigateur, baseUrl, vp);
      const erreursJs = [];
      page.on('pageerror', e => erreursJs.push(e.message));

      // Le formulaire du mode Script est à l'étape 3 : on révèle les étapes
      // plutôt que de simuler trois clics, la mise en page ne dépend pas du
      // chemin par lequel on est arrivé.
      await page.evaluate(() => {
        chooseMode('script');
        document.querySelectorAll('.step').forEach(s => s.classList.add('active'));
      });
      await page.waitForTimeout(350);

      mesures[nom] = await page.evaluate((corpsRangs) => {
        const carte = document.querySelector('#flow .context-card');
        const champs = Array.from(carte.querySelectorAll(':scope > .ctx-field'))
          .filter(e => e.getBoundingClientRect().width > 0);
        // La largeur DISPONIBLE, une fois le rembourrage de la carte retiré :
        // c'est à elle qu'on compare, pas à la largeur extérieure, sinon le
        // seuil dépend d'un rembourrage qui change entre téléphone et PC.
        const cs = getComputedStyle(carte);
        const largeurCarte = carte.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const sujet = document.getElementById('sujet').closest('.ctx-field');
        return {
          nombre: champs.length,
          paires: eval('(' + corpsRangs + ')')(champs),
          // Le champ où l'on ÉCRIT son sujet doit rester pleine largeur : le
          // couper en deux pour gagner une ligne serait une régression, pas
          // une amélioration.
          sujetPleineLargeur: sujet.getBoundingClientRect().width > largeurCarte * 0.9,
          deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      }, RANGS);
      assert.deepEqual(erreursJs, [], 'aucune erreur JS en ' + nom);
      await page.close();
    }

    assert.ok(mesures.pc.paires >= 2,
      'REGRESSION : sur PC, les listes déroulantes du formulaire (niche, audience, format, ton, durée) '
      + 'sont de nouveau empilées une par ligne. Elles tiennent à deux par rang sans rien perdre.');
    assert.equal(mesures.pc.sujetPleineLargeur, true,
      'REGRESSION : le champ « Ton sujet ou idée » a été réduit à une demi-largeur. Un champ où l\'on '
      + 'écrit plusieurs lignes garde toute la largeur, seules les listes déroulantes se rangent par deux.');
    assert.equal(mesures.telephone.paires, 0,
      'REGRESSION : sur un iPhone, deux champs partagent une ligne. À 390 px, deux colonnes donneraient '
      + 'des champs de 160 px, inutilisables.');
    assert.equal(mesures.telephone.sujetPleineLargeur, true, 'le champ sujet reste pleine largeur sur téléphone');
    assert.equal(mesures.pc.deborde, 0, 'aucun débordement horizontal sur PC');
    assert.equal(mesures.telephone.deborde, 0, 'aucun débordement horizontal sur téléphone');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

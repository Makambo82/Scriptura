// Demande du propriétaire : « remplacer pour tous les modes la durée
// (actuellement menu déroulant) par le glissable, comme le nombre de slides
// du carrousel ».
//
// Il a raison, et la raison est plus profonde qu'une question de goût : une
// durée est une ÉCHELLE, du plus court au plus long, pas une liste de choix
// sans rapport entre eux comme une niche ou un ton. Un menu déroulant cache
// cette échelle derrière un clic ; un curseur la montre d'un coup d'œil et se
// règle d'un pouce.
//
// CE QUE CE FICHIER VERROUILLE, et ce sont les deux endroits où un
// remplacement de composant casse silencieusement :
//   1. LE RESTE DU CODE LIT TOUJOURS LE <select>. La génération ne lit ni le
//      curseur ni l'affichage, mais une variable alimentée par un écouteur
//      'change' sur le <select> (selectedDuree, storyDuree, serieDuree). Un
//      curseur qui ne relaierait pas 'change' laisserait le créateur voir
//      « 3 minutes » pendant que la génération écrit 1 minute. C'est
//      exactement l'incident du 4 septembre, dans une autre forme.
//   2. « PAS ENCORE CHOISI » N'EXISTE PLUS TOUT SEUL. Un menu disait ça en
//      restant sur son option vide ; un curseur est toujours quelque part.
//      Sans drapeau, le champ paraîtrait choisi dès l'ouverture, et le
//      pré-remplissage depuis le profil, qui ne remplit que les champs
//      vides, ne reposerait plus jamais la durée du créateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const DUREES = [
  { id: 'dureeGrid', mode: 'Script', positions: 5, defaut: '1 minute' },
  { id: 'storyDureeGrid', mode: 'Récit', positions: 5, defaut: '1 minute' },
  { id: 'serieDureeGrid', mode: 'Série', positions: 4, defaut: '45 à 60 secondes' }
];

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 430, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return page;
}

test('les trois durées de l\'app sont des curseurs, plus des menus déroulants', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate((durees) => durees.map(d => {
      const s = document.getElementById(d.id);
      const wrap = s && s.closest('.choix-slider');
      const range = wrap && wrap.querySelector('input[type=range]');
      return {
        id: d.id,
        curseur: !!range,
        positions: range ? Number(range.max) + 1 : 0,
        valeur: s ? s.value : null,
        libelle: wrap ? (wrap.querySelector('.car-slider-val') || {}).textContent : null,
        bornes: wrap ? Array.from(wrap.querySelectorAll('.car-slider-bornes span')).map(e => e.textContent) : [],
        selectInvisible: !!s && getComputedStyle(s).opacity === '0',
        // Les trois mécanismes ne doivent JAMAIS se superposer sur le même
        // champ : un menu maison par-dessus un curseur donnerait deux
        // commandes contradictoires pour une seule valeur.
        menuMaison: !!(s && s.dataset.customInit === '1'),
        pastilles: !!(s && s.dataset.toggleInit === '1'),
        // Le libellé du champ remonte dans la ligne du haut, comme le
        // curseur du carrousel : titre à gauche, valeur à droite.
        labelDansLaLigne: !!(wrap && wrap.querySelector('.car-slider-top .ctx-label'))
      };
    }), DUREES);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    DUREES.forEach((d, i) => {
      const v = vu[i];
      assert.equal(v.curseur, true,
        'REGRESSION : la durée du mode ' + d.mode + ' n\'est plus un curseur.');
      assert.equal(v.positions, d.positions,
        'REGRESSION : ' + d.mode + ' a ' + v.positions + ' positions au lieu de ' + d.positions
        + '. Une durée disparue ou ajoutée par accident change ce que le créateur peut demander.');
      assert.equal(v.valeur, d.defaut,
        'REGRESSION : ' + d.mode + ' ne démarre plus sur « ' + d.defaut + ' » mais sur « ' + v.valeur + ' »');
      assert.ok(v.libelle && v.libelle.trim(),
        'REGRESSION : ' + d.mode + ' n\'affiche plus la durée choisie. Un curseur sans sa valeur écrite '
        + 'ne dit pas où on est.');
      assert.equal(v.bornes.length, 2,
        'REGRESSION : ' + d.mode + ' a perdu ses bornes. Elles disent l\'étendue de l\'échelle sans avoir '
        + 'à la parcourir.');
      assert.equal(v.selectInvisible, true,
        'REGRESSION : le <select> du mode ' + d.mode + ' redevient visible, en double du curseur');
      assert.equal(v.menuMaison, false,
        'REGRESSION : le mode ' + d.mode + ' porte AUSSI un menu maison. Deux commandes pour une seule '
        + 'valeur, et le balayage général des <select> a repris la main sur le curseur.');
      assert.equal(v.pastilles, false, 'REGRESSION : ' + d.mode + ' porte aussi des pastilles cliquables');
      assert.equal(v.labelDansLaLigne, true,
        'REGRESSION : ' + d.mode + ' n\'a plus son libellé dans la ligne du haut, à côté de la valeur');
    });
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('glisser le curseur pilote VRAIMENT la génération, pas seulement l\'affichage', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const glisser = (id, pos) => {
        const r = document.getElementById(id + 'Slider');
        r.value = String(pos);
        r.dispatchEvent(new Event('input', { bubbles: true }));
      };
      glisser('dureeGrid', 3);      // 3 minutes
      glisser('storyDureeGrid', 0); // 30 secondes
      glisser('serieDureeGrid', 3); // environ 2 minutes
      return {
        champScript: document.getElementById('dureeGrid').value,
        varScript: selectedDuree,
        champRecit: document.getElementById('storyDureeGrid').value,
        varRecit: typeof storyDuree !== 'undefined' ? storyDuree : '(absent)',
        champSerie: document.getElementById('serieDureeGrid').value,
        varSerie: typeof serieDuree !== 'undefined' ? serieDuree : '(absent)',
        libelleScript: document.querySelector('#dureeGrid').closest('.choix-slider')
          .querySelector('.car-slider-val').textContent
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.champScript, '3 minutes', 'le curseur pose bien la valeur sur le <select>');
    assert.equal(vu.varScript, '3 minutes',
      'REGRESSION : la variable lue par la génération ne suit pas le curseur (' + vu.varScript + '). Le '
      + 'créateur verrait « 3 minutes » pendant que son script serait écrit pour une autre durée : c\'est '
      + 'l\'incident du 4 septembre, sous une autre forme.');
    assert.equal(vu.champRecit, '30 secondes');
    assert.equal(vu.varRecit, '30 secondes', 'REGRESSION : mode Récit, la variable ne suit pas le curseur');
    assert.equal(vu.champSerie, 'environ 2 minutes');
    assert.equal(vu.varSerie, 'environ 2 minutes', 'REGRESSION : mode Série, la variable ne suit pas le curseur');
    assert.equal(vu.libelleScript.trim(), '3 min', 'et la valeur affichée suit aussi');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Défaut vu par le propriétaire sur son iPhone, capture à l'appui : le
// curseur était posé sur « 2 min », mais la barre dorée s'arrêtait au quart.
// Aucun navigateur ne sait colorer nativement la partie déjà parcourue d'un
// input range : c'est un dégradé coupé à --car-part, une variable que le CODE
// doit recalculer à chaque mouvement. Sans ça, la pastille avance et la barre
// reste derrière, et le créateur voit un réglage qui se contredit lui-même.
test('la barre dorée suit la pastille, à chaque position', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const range = document.getElementById('dureeGridSlider');
      const part = () => range.style.getPropertyValue('--car-part');
      const glisser = (p) => {
        range.value = String(p);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        return part();
      };
      const auChargement = part();
      const positions = [0, 1, 2, 3, 4].map(glisser);
      // Une remise à zéro replace la pastille : la barre doit suivre là aussi.
      document.getElementById('dureeGrid').value = '';
      return { auChargement, positions, apresRemiseAZero: part() };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.auChargement, '25%',
      'REGRESSION : au chargement, la barre ne correspond pas à la position de départ (deuxième cran '
      + 'sur cinq) mais à « ' + vu.auChargement + ' ». C\'est le défaut vu sur iPhone : le curseur affiche '
      + 'une durée, la barre en montre une autre.');
    assert.deepEqual(vu.positions, ['0%', '25%', '50%', '75%', '100%'],
      'REGRESSION : la barre ne suit plus la pastille sur toute l\'échelle. Mesuré : '
      + JSON.stringify(vu.positions));
    assert.equal(vu.apresRemiseAZero, '25%',
      'REGRESSION : après une remise à zéro, la pastille revient au défaut mais la barre reste où elle '
      + 'était (' + vu.apresRemiseAZero + ')');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('« pas encore choisi » survit à la disparition de l\'option vide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const el = document.getElementById('dureeGrid');
      const etat = () => ({ valeur: el.value, vide: estChampEncoreVide(el) });
      const auDepart = etat();

      // Le pré-remplissage depuis le profil ne remplit QUE les champs encore
      // vides. Il doit donc encore pouvoir poser la durée du créateur.
      preRemplirSiVide('dureeGrid', '2 minutes');
      const apresProfil = etat();
      const varApresProfil = selectedDuree;

      // Et il ne doit PAS écraser un choix déjà fait.
      preRemplirSiVide('dureeGrid', '5 minutes');
      const pasEcrase = etat();

      // Les remises à zéro de formulaire posent value = '' : le curseur
      // revient à son défaut ET redevient « pas encore choisi ».
      el.value = '';
      const apresRemiseAZero = etat();
      return { auDepart, apresProfil, varApresProfil, pasEcrase, apresRemiseAZero };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.auDepart.vide, true,
      'REGRESSION : à l\'ouverture, le curseur se déclare déjà choisi. Le pré-remplissage depuis le '
      + 'profil ne poserait plus jamais la durée habituelle du créateur, en silence.');
    assert.equal(vu.apresProfil.valeur, '2 minutes',
      'REGRESSION : le profil ne peut plus pré-remplir la durée (' + vu.apresProfil.valeur + ')');
    assert.equal(vu.varApresProfil, '2 minutes',
      'REGRESSION : le pré-remplissage n\'atteint plus la variable lue par la génération');
    assert.equal(vu.apresProfil.vide, false, 'une fois posé, le champ n\'est plus « encore vide »');
    assert.equal(vu.pasEcrase.valeur, '2 minutes',
      'REGRESSION : un second pré-remplissage écrase un choix déjà fait');
    assert.equal(vu.apresRemiseAZero.valeur, '1 minute',
      'après une remise à zéro, le curseur revient à son défaut, jamais sur une valeur vide impossible '
      + 'à afficher');
    assert.equal(vu.apresRemiseAZero.vide, true,
      'REGRESSION : après une remise à zéro, le champ reste marqué comme choisi. Le formulaire suivant '
      + 'hériterait silencieusement de la durée du précédent.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Demande du propriétaire, après le script de vente qui ne parlait pas du
// produit : « quand l'utilisateur charge son produit ou son PDF, que le
// système détermine automatiquement la niche ».
//
// L'argument est solide : le créateur vient de DONNER l'information, l'app
// n'a pas à la lui redemander. Et c'est encore plus vrai sur l'objectif
// Ventes, où le sujet saisi est souvent très pauvre (le cas réel qui a
// déclenché tout ça : « vendre un produit »). Les mots-clés n'ont alors rien
// à analyser, le fichier est la seule vraie matière.
//
// Ce que ces tests verrouillent, et c'est surtout une histoire de prudence :
//  - la niche se pose bien depuis le fichier, dans les DEUX modes qui en
//    acceptent un (Script et Carrousel) ;
//  - une niche choisie À LA MAIN n'est JAMAIS écrasée, y compris par cette
//    nouvelle détection. C'est le même verrou que pour le texte, désormais
//    porté par le champ lui-même pour que les deux le partagent ;
//  - le chargement du fichier n'ATTEND jamais la détection : joindre une
//    photo doit rester instantané ;
//  - et en cas de doute ou de panne, rien ne se pose.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

// Une vraie image minuscule (PNG 1x1) : le flux de lecture de fichier est
// exercé pour de bon, pas contourné.
const ANGLES = [
  'Le geste que tout le monde fait mal avec ce produit',
  'Ce que promet le marché, et ce qui se passe vraiment',
  'Trois jours avec ce produit, filmés sans filtre'
];
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function preparer(page, baseUrl, reponse) {
  await poserMocksReseau(page);
  await page.route('**/api/generate', async (route) => {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: typeof reponse === 'string' ? reponse : JSON.stringify(reponse) }] })
    });
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
}

// Simule le chargement d'un fichier produit sans passer par un vrai <input
// type=file>, en appelant le gestionnaire réel avec un objet File authentique.
const CHARGER = (fonction, mode) => `
  (async () => {
    const octets = Uint8Array.from(atob('${PNG_1x1}'), c => c.charCodeAt(0));
    const fichier = new File([octets], 'produit.png', { type: 'image/png' });
    await ${fonction}([fichier]);
  })()
`;

test('Script : la niche se déduit du produit chargé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ANGLES });

    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForFunction(() => document.getElementById('niche').value === 'Beauté & Mode', null, { timeout: 10000 });

    const vu = await page.evaluate(() => ({
      niche: document.getElementById('niche').value,
      note: document.getElementById('nicheAutoNoteScript').textContent,
      noteVisible: document.getElementById('nicheAutoNoteScript').style.display !== 'none'
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.niche, 'Beauté & Mode');
    assert.match(vu.note, /depuis ton produit/,
      'la détection doit DIRE d\'où elle vient, sinon un champ qui se remplit seul passe pour un bug');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Carrousel : même comportement, le produit chargé suffit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparer(page, baseUrl, { niche: 'Sport & Fitness', angles: ANGLES });

    await page.evaluate(CHARGER('chargerFichierVenteCarrousel', 'carrousel'));
    await page.waitForFunction(() => document.getElementById('carrouselNiche').value === 'Sport & Fitness', null, { timeout: 10000 });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une niche choisie À LA MAIN n\'est JAMAIS écrasée par le produit chargé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ANGLES });

    // Le créateur tranche AVANT de joindre sa photo, exactement comme le
    // propriétaire l'avait fait sur le cas réel. Le geste est simulé pour de
    // vrai (pointerdown sur le menu) : depuis le 5 septembre, un 'change' seul
    // ne vaut plus choix, sinon la niche recopiée du profil gelait le champ et
    // le produit chargé ne pouvait plus rien corriger.
    await page.dispatchEvent('#niche', 'pointerdown');
    await page.evaluate(() => {
      const n = document.getElementById('niche');
      n.value = 'Histoire';
      n.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForTimeout(2500); // largement le temps que la détection aurait eu

    const niche = await page.evaluate(() => document.getElementById('niche').value);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(niche, 'Histoire',
      'REGRESSION : le choix du créateur doit primer sur toute détection, celle-ci comprise');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le chargement du fichier n\'ATTEND pas la détection', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    // Réponse volontairement TRÈS lente : joindre une photo doit rester
    // instantané malgré tout.
    await page.route('**/api/generate', async (route) => {
      await new Promise(r => setTimeout(r, 4000));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ niche: 'Beauté & Mode', angles: ANGLES }) }] }) });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const duree = await page.evaluate(async () => {
      const octets = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      const fichier = new File([octets], 'produit.png', { type: 'image/png' });
      const t0 = performance.now();
      await chargerFichierVente([fichier]);
      return performance.now() - t0;
    });

    assert.ok(duree < 1500,
      'joindre une photo doit rendre la main tout de suite, la niche se posera après (' + Math.round(duree) + 'ms)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('réponse inutilisable : rien ne se pose, plutôt qu\'une niche fausse', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    // Le modèle ne reconnaît pas le produit, ou invente une catégorie qui
    // n'existe pas dans le menu : dans les deux cas, on ne pose RIEN.
    await preparer(page, baseUrl, { niche: 'AUCUNE', angles: ANGLES });
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForTimeout(2500);

    let niche = await page.evaluate(() => document.getElementById('niche').value);
    assert.equal(niche, '', 'sur AUCUNE, le champ doit rester vide');

    await preparer(page, baseUrl, { niche: 'Catégorie Inventée Qui N\'Existe Pas', angles: ANGLES });
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForTimeout(2500);
    niche = await page.evaluate(() => document.getElementById('niche').value);
    assert.equal(niche, '',
      'une valeur absente du menu ne doit jamais être posée : le champ resterait vide sans qu\'on comprenne pourquoi');
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// ── LES TROIS ANGLES ──
//
// Décision explicite du propriétaire, après discussion : « l'app te propose
// trois angles cliquables sous le champ sujet, tirés de ce qu'elle voit. Tu en
// cliques un, il se met dans le champ, tu le modifies si tu veux. »
//
// PROPOSER, jamais PRÉ-REMPLIR, et la nuance est tout le sujet. La niche est
// une case de rangement, il n'y a qu'une bonne réponse. Le sujet, lui, est
// l'ANGLE du créateur : une photo de crème ne dit pas s'il veut raconter sa
// transformation, démonter les promesses du marché ou faire une démo. Un champ
// pré-rempli serait accepté par facilité (tous les scripts de vente finiraient
// par se ressembler) et serait plus pénible à corriger qu'un champ vide.

test('les trois angles sont proposés, mais le champ sujet reste VIDE', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ANGLES });

    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForFunction(() => {
      const z = document.getElementById('anglesProduitScript');
      return z && z.style.display !== 'none' && z.querySelectorAll('button').length === 3;
    }, null, { timeout: 10000 });

    const vu = await page.evaluate(() => ({
      sujet: document.getElementById('sujet').value,
      propositions: Array.from(document.querySelectorAll('#anglesProduitScript button')).map(b => b.textContent)
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.sujet, '',
      'RÈGLE CENTRALE : on propose, on ne remplit pas. Le sujet reste l\'angle du créateur');
    assert.equal(vu.propositions.length, 3);
    assert.deepEqual(vu.propositions, ANGLES, 'les angles affichés sont ceux proposés : ' + JSON.stringify(vu.propositions));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('cliquer un angle le met dans le sujet, et les propositions disparaissent', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ANGLES });

    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForFunction(() => document.querySelectorAll('#anglesProduitScript button').length === 3, null, { timeout: 10000 });
    await page.evaluate(() => document.querySelectorAll('#anglesProduitScript button')[1].click());
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => ({
      sujet: document.getElementById('sujet').value,
      zoneVisible: document.getElementById('anglesProduitScript').style.display !== 'none',
      niche: document.getElementById('niche').value
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.sujet, ANGLES[1], 'l\'angle cliqué devient le sujet');
    assert.equal(vu.zoneVisible, false,
      'les propositions disparaissent : les laisser inviterait à écraser ce que le créateur vient de retoucher');
    // Le piège : remplir le sujet déclenche la détection par mots-clés, qui
    // aurait écrasé la niche déduite du VRAI produit par une moins bonne.
    assert.equal(vu.niche, 'Beauté & Mode',
      'REGRESSION : la niche venue du produit doit survivre au clic sur un angle');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le créateur reste libre : il peut modifier l\'angle cliqué, ou écrire le sien', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ANGLES });
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForFunction(() => document.querySelectorAll('#anglesProduitScript button').length === 3, null, { timeout: 10000 });

    const sujet = await page.evaluate(() => {
      document.querySelectorAll('#anglesProduitScript button')[0].click();
      const champ = document.getElementById('sujet');
      champ.value = champ.value + ', vu par un débutant';
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      return champ.value;
    });

    assert.match(sujet, /vu par un débutant/, 'rien ne doit empêcher de retoucher l\'angle repris');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('des angles absents ou inexploitables n\'affichent simplement rien', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    // Le modèle répond sans angles, ou avec des bribes inutilisables.
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ['ok', ''] });
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForTimeout(2500);

    const vu = await page.evaluate(() => ({
      zoneVisible: document.getElementById('anglesProduitScript').style.display !== 'none',
      boutons: document.querySelectorAll('#anglesProduitScript button').length,
      niche: document.getElementById('niche').value
    }));

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.boutons, 0, 'aucune proposition douteuse affichée');
    assert.equal(vu.zoneVisible, false);
    assert.equal(vu.niche, 'Beauté & Mode',
      'et la niche, elle, doit quand même se poser : les deux résultats sont indépendants');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// LE CAS RÉEL DU PROPRIÉTAIRE, 5 septembre : « malgré que j'ai chargé l'image
// et choisi un des trois sujets proposés, la niche n'a pas changé, c'est
// resté sur la niche pré-remplie ».
//
// Il n'avait rien choisi : c'est l'app qui avait recopié la niche principale
// de son profil (preRemplirSiVide, js/profil.js) en déclenchant un 'change'
// pour que les champs liés suivent. Ce 'change' passait pour un choix manuel,
// le verrou tombait, et la détection depuis le produit était refusée en
// silence, y compris quand la photo disait tout autre chose.
test('la niche recopiée du PROFIL n\'empêche pas le produit de la corriger', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await preparer(page, baseUrl, { niche: 'Beauté & Mode', angles: ANGLES });

    // Exactement ce que fait preRemplirSiVide au chargement du profil : aucun
    // geste du créateur, juste l'app qui pose sa niche habituelle.
    await page.evaluate(() => {
      const n = document.getElementById('niche');
      n.value = 'Histoire';
      n.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForTimeout(2500);

    const vu = await page.evaluate(() => ({
      niche: document.getElementById('niche').value,
      note: document.getElementById('nicheAutoNoteScript').textContent
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.niche, 'Beauté & Mode',
      'REGRESSION : la niche du profil bloquait la détection depuis le produit, en silence');
    assert.match(vu.note, /depuis ton produit/,
      'et le créateur doit lire d\'où vient cette niche, sinon le changement passe pour un bug');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

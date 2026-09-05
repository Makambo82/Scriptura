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
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function preparer(page, baseUrl, reponseNiche) {
  await poserMocksReseau(page);
  await page.route('**/api/generate', async (route) => {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: reponseNiche }] })
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
    await preparer(page, baseUrl, 'Beauté & Mode');

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
    await preparer(page, baseUrl, 'Sport & Fitness');

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
    await preparer(page, baseUrl, 'Beauté & Mode');

    // Le créateur tranche AVANT de joindre sa photo, exactement comme le
    // propriétaire l'avait fait sur le cas réel.
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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'Beauté & Mode' }] }) });
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
    await preparer(page, baseUrl, 'AUCUNE');
    await page.evaluate(CHARGER('chargerFichierVente', 'script'));
    await page.waitForTimeout(2500);

    let niche = await page.evaluate(() => document.getElementById('niche').value);
    assert.equal(niche, '', 'sur AUCUNE, le champ doit rester vide');

    await preparer(page, baseUrl, 'Catégorie Inventée Qui N\'Existe Pas');
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

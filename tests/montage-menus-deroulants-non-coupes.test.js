// Retour propriétaire (capture à l'appui) : après la disposition "premium"
// en cartes du panneau de montage (.montage-section), les menus déroulants
// maison (choix de voix, volume de la musique) s'ouvraient DANS la carte et
// se retrouvaient coupés, impossibles à faire défiler pour voir les autres
// choix. Cause : .montage-section avait overflow:hidden (pour un dégradé
// décoratif en haut de carte), qui clippe aussi tout descendant positionné
// en absolu dépassant la carte, dont .custom-select-panel (voir js/ui.js,
// initCustomSelect). Fixé en retirant overflow:hidden (le dégradé s'estompe
// déjà vers transparent à ses extrémités, jamais eu besoin d'un clip pour
// rester propre sur des coins arrondis, même codex que .context-card).
//
// Ce test vérifie la cause exacte plutôt qu'une géométrie de substitution :
// une 1ère version comparait la position du panneau ouvert à celle de sa
// carte (panelBottom > carteBottom), mais cette géométrie dépend de la
// taille relative carte/panneau (police système de repli si les polices
// distantes ne chargent pas en CI, etc.) - un signal environnement-dépendant
// qui a fait échouer le test en CI sans régression réelle. On vérifie
// maintenant directement, en remontant les ancêtres du menu, qu'AUCUN n'a
// overflow:hidden/clip (hors la propre liste défilante du menu, prévue
// pour ça) : c'est le mécanisme exact du bug, déterministe quel que soit
// l'environnement de rendu.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Renvoie la liste des ancêtres (entre le menu et <body>) dont l'overflow
// couperait le panneau ouvert, en excluant .custom-select-list elle-même
// (seule scrollable légitime du menu, voir css/style.css).
function ancetresQuiClippent(idSelect) {
  const wrap = document.getElementById(idSelect).closest('.custom-select');
  const listeLegitime = wrap.querySelector('.custom-select-list');
  const coupables = [];
  let el = wrap.parentElement;
  while (el && el !== document.body) {
    if (el !== listeLegitime) {
      const ov = getComputedStyle(el).overflow;
      const ovY = getComputedStyle(el).overflowY;
      if (ov === 'hidden' || ov === 'clip' || ovY === 'hidden' || ovY === 'clip') {
        coupables.push({ tag: el.tagName, classe: el.className });
      }
    }
    el = el.parentElement;
  }
  return coupables;
}

test('Montage (storyboard IA) : le menu déroulant "Choisis une voix..." n\'est coupé par aucun ancêtre (overflow visible de bout en bout)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.route('**/api/montage-media?action=voices', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        voices: [
          { id: 'v-adrien', label: 'Adrien' },
          { id: 'v-melanie', label: 'Melanie' }
        ]
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MENUSNONCOUPES1', plan: 'creator' });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.body.classList.add('is-admin');
      montagePlans = [{ text: 'Plan.', visuel: 'x' }];
      montageImages = [{ blob: new Blob(['x']), apercu: 'data:image/png;base64,x' }];
      document.getElementById('montageModal').classList.add('active');
      chargerVoixMontage();
      renderMontageEtat();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('montageVoixSelect').closest('.custom-select').querySelector('.custom-select-trigger').click();
    });
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const coupables = await page.evaluate(ancetresQuiClippent, 'montageVoixSelect');
    assert.deepEqual(coupables, [], 'aucun ancêtre du menu ne doit couper le panneau ouvert (dont la carte "Voix off") : ' + JSON.stringify(coupables));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Montage manuel : le menu déroulant "Volume de la musique" n\'est coupé par aucun ancêtre', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'MENUSNONCOUPES2', plan: 'creator' });
    await page.evaluate(() => document.body.classList.add('is-admin'));
    await page.waitForTimeout(150);
    await page.evaluate(() => ouvrirMontageManuelAccueil());
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('omMusiqueVolumeSelect').closest('.custom-select').querySelector('.custom-select-trigger').click();
    });
    await page.waitForTimeout(200);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const coupables = await page.evaluate(ancetresQuiClippent, 'omMusiqueVolumeSelect');
    assert.deepEqual(coupables, [], 'aucun ancêtre du menu ne doit couper le panneau ouvert (dont la carte "Musique") : ' + JSON.stringify(coupables));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

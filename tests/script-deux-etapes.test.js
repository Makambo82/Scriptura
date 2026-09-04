// Décision produit du propriétaire : passer le mode Script de trois étapes à
// deux, en fusionnant "Quel est ton objectif ?" et "Avec quoi commences-tu ?".
//
// Le diagnostic était juste : la seconde étape ne portait que DEUX cartes et un
// menu plateforme déjà pré-rempli sur TikTok. Elle ne méritait pas son propre
// écran.
//
// LE PIÈGE, et c'est lui que ces tests verrouillent : les deux étapes
// avançaient AUTOMATIQUEMENT au clic, donc les traverser coûtait exactement
// 2 gestes. Une fusion naïve aurait imposé un bouton "Continuer" après les deux
// choix, soit 3 gestes : moins d'écrans, mais plus de travail pour le créateur.
// L'écran fusionné avance donc tout seul dès que les DEUX choix sont posés.
//
// Le bouton "Continuer" existe quand même, invisible au premier passage. Il ne
// sert qu'au créateur qui REVIENT sur l'étape (les deux choix sont alors déjà
// faits, plus rien ne déclencherait l'avance automatique) : sans lui, changer
// sa seule plateforme obligerait à recliquer un point de départ pour repartir.
//
// Enfin, le propriétaire proposait des menus déroulants. Écarté pour
// l'objectif : c'est le choix le plus lourd de conséquences de toute l'app (il
// change la stratégie de chute, les instructions du corps du script, les
// contrôles du Critique et jusqu'au critère de notation du CTA), et ses
// descriptions sont ce qui rend le choix éclairé. Cartes compactes avec
// description d'une ligne, plutôt qu'un menu qui n'affiche rien tant qu'il est
// fermé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

async function ouvrirScript(page, baseUrl) {
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'ETAPES' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('flow').style.display = 'block';
    state.objectif = '';
    state.depart = '';
    showStep(1);
  });
  await page.waitForTimeout(200);
}

const etat = () => ({
  etapeActive: (document.querySelector('#flow .step.active') || {}).id,
  objectif: state.objectif,
  depart: state.depart,
  objectifsVisibles: document.querySelectorAll('#choixObjectif .choice').length,
  departsVisibles: document.querySelectorAll('#choixDepart .choice').length,
  objectifSelectionne: document.querySelectorAll('#choixObjectif .choice.selected').length,
  departSelectionne: document.querySelectorAll('#choixDepart .choice.selected').length,
  continuerVisible: document.getElementById('etape1Continuer').offsetParent !== null,
  plateformeVisible: document.getElementById('platformPicker').offsetParent !== null
});

test('deux étapes seulement, et les deux questions tiennent sur le premier écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirScript(page, baseUrl);

    const vu = await page.evaluate(etat);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.etapeActive, 'step1');
    assert.equal(vu.objectifsVisibles, 4, 'les 4 objectifs sont là');
    assert.equal(vu.departsVisibles, 2, 'et les 2 points de départ aussi, sur le MÊME écran');
    assert.equal(vu.plateformeVisible, true, 'la plateforme les rejoint');

    const etapes = await page.evaluate(() => ({
      nombre: document.querySelectorAll('#flow .step').length,
      libelles: Array.from(document.querySelectorAll('#flow .step-indicator span')).map(s => s.textContent.trim()),
      points: Array.from(document.querySelectorAll('#flow .step-dots')).map(d => d.children.length)
    }));
    assert.equal(etapes.nombre, 2, 'le mode Script ne compte plus que deux étapes');
    assert.deepEqual(etapes.libelles, ['Étape 1 sur 2', 'Étape 2 sur 2'], 'l\'indicateur suit : ' + JSON.stringify(etapes.libelles));
    assert.deepEqual(etapes.points, [2, 2], 'et les points de progression aussi');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('toujours 2 gestes pour traverser : l\'écran avance seul quand les deux choix sont posés', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirScript(page, baseUrl);

    // Geste 1 : l'objectif. On NE doit PAS avancer, la seconde question est
    // sur le même écran et n'a pas encore de réponse.
    await page.evaluate(() => document.querySelectorAll('#choixObjectif .choice')[0].click());
    await page.waitForTimeout(250);
    const apres1 = await page.evaluate(etat);
    assert.equal(apres1.etapeActive, 'step1', 'on reste sur l\'écran, la seconde question attend');
    assert.ok(apres1.objectif, 'l\'objectif est enregistré');
    assert.equal(apres1.objectifSelectionne, 1, 'et visuellement marqué comme choisi');
    assert.equal(apres1.departSelectionne, 0);
    assert.equal(apres1.continuerVisible, false, 'aucun bouton tant que les deux ne sont pas posés');

    // Geste 2 : le point de départ. L'écran doit avancer TOUT SEUL.
    await page.evaluate(() => document.querySelectorAll('#choixDepart .choice')[1].click());
    await page.waitForTimeout(400);
    const apres2 = await page.evaluate(etat);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres2.etapeActive, 'step2',
      'REGRESSION : sans avance automatique, la fusion coûterait un geste de plus qu\'avant');
    assert.ok(apres2.depart, 'le point de départ est enregistré');

    // Le résumé de l'étape suivante reprend bien les deux choix.
    const resume = await page.evaluate(() => document.getElementById('summaryTags').textContent);
    assert.match(resume, /vues|abonnés|ventes|expertise/i, 'l\'objectif est rappelé : ' + resume);
    assert.match(resume, /sujet précis|idée vague/i, 'et le point de départ aussi');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('en revenant sur l\'étape 1, les choix restent marqués et « Continuer » apparaît', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirScript(page, baseUrl);
    await page.evaluate(() => document.querySelectorAll('#choixObjectif .choice')[2].click());
    await page.evaluate(() => document.querySelectorAll('#choixDepart .choice')[0].click());
    await page.waitForTimeout(400);
    assert.equal((await page.evaluate(etat)).etapeActive, 'step2');

    await page.evaluate(() => goBack(1));
    await page.waitForTimeout(300);
    const retour = await page.evaluate(etat);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(retour.etapeActive, 'step1');
    assert.equal(retour.objectifSelectionne, 1, 'le créateur revoit ce qu\'il avait choisi');
    assert.equal(retour.departSelectionne, 1);
    assert.equal(retour.continuerVisible, true,
      'REGRESSION : sans ce bouton, changer sa seule plateforme obligerait à recliquer un point de départ pour repartir');

    // Et ce bouton fait bien repartir.
    await page.evaluate(() => document.getElementById('etape1Continuer').click());
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate(etat)).etapeActive, 'step2');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('changer d\'objectif en revenant repart directement, sans geste perdu', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await ouvrirScript(page, baseUrl);
    await page.evaluate(() => document.querySelectorAll('#choixObjectif .choice')[0].click());
    await page.evaluate(() => document.querySelectorAll('#choixDepart .choice')[0].click());
    await page.waitForTimeout(400);
    await page.evaluate(() => goBack(1));
    await page.waitForTimeout(300);

    // Les deux choix sont déjà posés : cliquer un AUTRE objectif doit le
    // remplacer ET faire repartir, en un seul geste.
    await page.evaluate(() => document.querySelectorAll('#choixObjectif .choice')[3].click());
    await page.waitForTimeout(400);
    const vu = await page.evaluate(etat);
    assert.equal(vu.etapeActive, 'step2', 'un seul geste suffit pour corriger et repartir');
    assert.match(vu.objectif, /expertise/i, 'et c\'est bien le nouvel objectif qui est retenu : ' + vu.objectif);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les descriptions des objectifs restent affichées, le choix reste éclairé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await ouvrirScript(page, baseUrl);

    const vu = await page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('#choixObjectif .choice'));
      return cartes.map(c => ({
        titre: (c.querySelector('.choice-label') || {}).textContent || '',
        desc: ((c.querySelector('.choice-desc') || {}).textContent || '').trim(),
        visible: c.offsetParent !== null
      }));
    });

    assert.equal(vu.length, 4);
    for (const carte of vu) {
      assert.ok(carte.visible, 'chaque objectif est visible sans avoir à ouvrir quoi que ce soit : ' + carte.titre);
      assert.ok(carte.desc.length > 10,
        'REGRESSION : sans description, la différence entre "faire des vues" et "gagner des abonnés" n\'est pas évidente, et c\'est le choix le plus structurant de l\'app : ' + carte.titre);
      assert.ok(carte.desc.length <= 60,
        'mais elle tient sur une ligne, c\'est ce qui permet la fusion : "' + carte.desc + '" (' + carte.desc.length + ' caractères)');
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les entrées directes vers l\'étape de contexte suivent la renumérotation', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirScript(page, baseUrl);

    // "Modifier les critères" depuis un résultat saute directement à l'étape
    // de contexte : elle porte maintenant le numéro 2, plus 3.
    await page.evaluate(() => modifierCriteresScript());
    await page.waitForTimeout(300);
    const vu = await page.evaluate(() => ({
      actif: (document.querySelector('#flow .step.active') || {}).id,
      niche: document.getElementById('niche').offsetParent !== null,
      sujet: document.getElementById('sujet').offsetParent !== null
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.actif, 'step2', 'REGRESSION : un showStep(3) oublié laisserait un écran vide');
    assert.ok(vu.niche && vu.sujet, 'et le formulaire de contexte est bien là');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

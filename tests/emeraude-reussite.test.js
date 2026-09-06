// Retour du propriétaire : « je trouve que la couleur vert émeraude n'est pas
// suffisamment présente dans l'app ».
//
// Constat en relisant la palette : elle ne l'était pas par accident, mais par
// règle. Le commentaire de --emerald (css/style.css) la réservait au palier
// Pro et aux niveaux verts du diagnostic, soit des écrans qu'un créateur voit
// rarement. Dans le flux quotidien (écrire, générer un storyboard, monter une
// vidéo), elle était absente.
//
// DOCTRINE RETENUE, et c'est elle que ces tests protègent, pas des teintes :
// le DORÉ dit "Scriptura, et ce que tu peux faire", l'ÉMERAUDE dit "c'est
// fait, c'est validé, c'est réussi". Les deux ne peuvent donc jamais se
// disputer un même élément, et l'émeraude gagne une vraie place dans le flux
// quotidien sans devenir de la décoration.
//
// Cinq endroits retenus, du plus vu au moins vu :
//   1. une barre de progression qui atteint 100 % ;
//   2. la confirmation "✓ Copié !" ;
//   3. la coche de l'option retenue dans les menus maison ;
//   4. les vignettes de plan dont l'image est prête ;
//   5. une génération allée jusqu'à la vidéo montée, dans l'historique.
//
// DEUX ESSAIS REFUSÉS PAR LE PROPRIÉTAIRE, consignés ici pour qu'on ne les
// refasse pas : le Scriptura Score en émeraude au-dessus du seuil vert, et le
// pourcentage des barres. « Le vert émeraude n'est pas beau » sur ces
// chiffres-là. La leçon tient en une phrase : l'émeraude porte les pastilles,
// les contours et les fils, jamais la typographie chiffrée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

test('la coche de l\'option retenue est émeraude, pas dorée', () => {
  const ligne = CSS.split('\n').find(l => l.includes('.custom-select-option .cs-check{'));
  assert.ok(ligne, 'la règle de la coche doit exister');
  assert.match(ligne, /--emerald-light/,
    'une coche marque un choix validé : c\'est de l\'émeraude, pas du doré');
});

test('les états émeraude existent tous en CSS, et aucun n\'utilise la teinte illisible', () => {
  // .sb-progress-bar-track.termine et non plus .sb-progress-bar-fill.termine :
  // depuis que la barre DÉFILE au lieu de se remplir (le remplissage n'est
  // plus affiché), c'est la PISTE qui porte la couleur de fin. L'intention est
  // inchangée, une barre terminée passe en émeraude, seul l'élément qui la
  // porte a bougé.
  for (const regle of ['.sb-progress-bar-track.termine', '.copie-ok',
    '.audit-thumb.montage-thumb-prete', '.history-montee']) {
    assert.ok(CSS.includes(regle), 'règle manquante : ' + regle);
  }
  // Les deux endroits refusés par le propriétaire : ils doivent RESTER dorés.
  assert.equal(CSS.includes('score-reussi'), false,
    'le Scriptura Score reste doré quel que soit le résultat (refus explicite)');
  assert.equal(CSS.includes('.sb-progress-bar-pct.termine'), false,
    'le pourcentage des barres reste doré (refus explicite)');
  // --emerald (#1F6B4C) ne donne que 2,65:1 sur le fond sombre : il ne peut
  // servir que de FOND derrière du texte clair, jamais de couleur de texte.
  // --emerald-light (#3E9B75) est à 5,0:1, lui passe pour du texte.
  // Le début de propriété est exigé (`;`, `{` ou un espace juste avant) :
  // sans ça, "background-color:var(--emerald)" déclencherait l'alerte, alors
  // que c'est précisément l'usage AUTORISÉ par la règle ci-dessus, l'émeraude
  // en fond derrière autre chose (la barre terminée, par exemple). L'ancienne
  // version cherchait la sous-chaîne nue et se serait donc trompée sur le
  // premier fond émeraude venu.
  const texteEnEmeraudeSombre = /(^|[;{\s])color:var\(--emerald\)/m.test(CSS);
  assert.equal(texteEnEmeraudeSombre, false,
    'REGRESSION : --emerald est trop sombre pour du texte (2,65:1), utiliser --emerald-light');
});

test('une barre qui atteint 100 % passe en émeraude, et repasse si elle redémarre', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(async () => {
      const zone = document.createElement('div');
      zone.innerHTML = '<div class="sb-progress-bar">'
        + '<div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="tFill"></div></div>'
        + '<div class="sb-progress-bar-pct" id="tPct">0%</div></div>';
      document.body.appendChild(zone);
      const fill = document.getElementById('tFill');
      const pct = document.getElementById('tPct');
      const attendre = () => new Promise(r => setTimeout(r, 60));
      const etat = () => ({ fill: fill.classList.contains('termine'), pct: pct.classList.contains('termine') });

      fill.style.width = '40%'; await attendre();
      const enCours = etat();
      fill.style.width = '100%'; await attendre();
      const fini = etat();
      // Une barre réutilisée pour une nouvelle génération repart à zéro : elle
      // ne doit pas rester verte, sinon elle annoncerait un succès qui n'a pas
      // encore eu lieu.
      fill.style.width = '0%'; await attendre();
      const relance = etat();
      return { enCours, fini, relance };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(vu.enCours, { fill: false, pct: false }, 'à 40 %, rien n\'est accompli, donc rien n\'est vert');
    assert.deepEqual(vu.fini, { fill: true, pct: false },
      'REGRESSION : à 100 %, le FIL passe en émeraude et le POURCENTAGE reste doré (refus explicite du propriétaire)');
    assert.deepEqual(vu.relance, { fill: false, pct: false },
      'REGRESSION : une barre relancée ne doit pas garder le vert de la fois d\'avant');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Essai livré puis RETIRÉ à la demande du propriétaire : « côté score et
// pourcentage, remets le doré, le vert émeraude n'est pas beau ». Le test
// reste, à l'envers : il garde la carte dorée quel que soit le score, pour
// qu'une bonne intention ne la reverdisse pas dans six mois.
test('le Scriptura Score reste doré, y compris sur un excellent score', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      const zone = document.createElement('div');
      zone.id = 'zoneScoreTest';
      zone.innerHTML = carteScoreScriptHTML({
        score: { viral: 92, hook: 90, engagement: 88, emotion: 94, retention: 86 }
      });
      document.body.appendChild(zone);
      return {
        couleurNum: getComputedStyle(zone.querySelector('.score-global-num')).color,
        fondBarre: getComputedStyle(zone.querySelector('.metric-fill')).backgroundImage
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    // --gold-light = #E2C87A = rgb(226, 200, 122).
    assert.equal(vu.couleurNum, 'rgb(226, 200, 122)',
      'REGRESSION : le chiffre du Scriptura Score doit rester doré : ' + vu.couleurNum);
    assert.ok(!/62, 155, 117|31, 107, 76/.test(vu.fondBarre),
      'REGRESSION : les barres du Scriptura Score doivent rester dorées : ' + vu.fondBarre);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les vignettes dont l\'image est prête portent le contour émeraude, les autres non', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      ouvrirMontage([
        { text: 'Le problème', visuel: 'a' },
        { text: 'La solution', visuel: 'b' }
      ], null);
      // Une image posée à la main sur le second plan : c'est désormais le seul
      // chemin par lequel un plan peut être pourvu sans génération (l'insertion
      // automatique de la photo produit a été retirée à la demande du
      // propriétaire, voir js/montage.js).
      _assignerImageMontage(1, new File([Uint8Array.from([1, 2, 3])], 'a-moi.png', { type: 'image/png' }));
      renderMontageEtat();
      return Array.from(document.querySelectorAll('#montageImagesThumbs .audit-thumb'))
        .map(t => t.classList.contains('montage-thumb-prete'));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(vu, [false, true],
      'REGRESSION : seul un plan dont l\'image est là porte le contour émeraude : ' + JSON.stringify(vu));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une génération montée en vidéo le dit dans l\'historique, les autres non', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const vu = await page.evaluate(() => {
      window._historySeriesAll = [];
      window._historyDataAll = [
        { id: 'a', mode: 'script', titre: 'Montée jusqu\'au bout', cree_le: new Date().toISOString(),
          contenu: { montee_video: true } },
        { id: 'b', mode: 'script', titre: 'Restée au script', cree_le: new Date().toISOString(),
          contenu: {} }
      ];
      dessinerHistorique();
      return Array.from(document.querySelectorAll('#historyList .history-card'))
        .map(c => ({ titre: c.querySelector('.history-title').textContent.trim(),
                     montee: !!c.querySelector('.history-montee') }));
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const parTitre = Object.fromEntries(vu.map(v => [v.titre, v.montee]));
    assert.equal(parTitre['Montée jusqu\'au bout'], true,
      'REGRESSION : aller jusqu\'à la vidéo est l\'aboutissement le plus fort, il doit se voir');
    assert.equal(parTitre['Restée au script'], false,
      'et une génération qui n\'est pas allée jusque-là ne doit surtout pas le prétendre');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// La marque de l'historique n'est posée QUE sur un rendu réellement revenu
// avec une URL : une intention de monter, un échec ou une annulation ne
// doivent jamais laisser croire à une vidéo qui n'existe pas.
test('la marque "montée en vidéo" n\'est écrite qu\'après un rendu réussi', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'montage.js'), 'utf8');
  const i = src.indexOf('updateGenerationMonteeVideo');
  assert.ok(i > 0, 'l\'appel doit exister dans le flux de montage');
  const avant = src.slice(0, i);
  const posDerniereVerif = avant.lastIndexOf('dataRender.url');
  const posCatch = avant.lastIndexOf('} catch (e) { throw new Error(\'Rendu de la vidéo');
  assert.ok(posDerniereVerif > 0 && posCatch > 0 && posDerniereVerif < i,
    'l\'appel doit se trouver après la vérification de l\'URL du rendu');
  assert.ok(posCatch < i,
    'REGRESSION : la marque doit être posée APRÈS le bloc qui relance en cas d\'échec du rendu');

  const hist = fs.readFileSync(path.join(__dirname, '..', 'js', 'historique.js'), 'utf8');
  assert.match(hist, /montee_video: true/, 'le champ persisté doit exister');
});

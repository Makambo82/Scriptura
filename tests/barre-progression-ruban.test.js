// Demande du propriétaire : « la barre de progression avec le pourcentage
// remplacée par une barre rayée qui défile indéfiniment, un peu moins large
// que le modèle ; et l'éclair dans son cercle remplacé par le pourcentage. On
// aura donc le pourcentage à l'intérieur d'un cercle qui tourne, et une barre
// qui défile. Partout où il y a une barre de progression. »
//
// LE POINT DÉLICAT, et c'est lui que ce test verrouille : « partout » veut
// dire TREIZE endroits, écrits en dur dans six fichiers. Un seul oublié et
// l'app afficherait deux styles de chargement différents selon l'écran. Le
// test compte donc les treize dans le code source, plutôt que de vérifier
// une seule barre et d'espérer pour les douze autres.
//
// Il vérifie aussi que le POURCENTAGE reste réel : la barre est devenue
// indéterminée (elle dit « ça travaille »), donc le chiffre dans le cercle
// est désormais la SEULE information d'avancement. S'il cessait d'être
// alimenté, le créateur n'aurait plus rien.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

const FICHIERS = ['index.html', 'js/generation.js', 'js/montage-manuel.js',
  'js/montage.js', 'js/serie.js', 'js/storytelling.js'];
const SOURCES = FICHIERS.map(f => ({ nom: f, src: fs.readFileSync(path.join(__dirname, '..', f), 'utf8') }));

test('les treize barres de l\'app ont toutes le pourcentage DANS le cercle', () => {
  let barres = 0, pctDansCercle = 0, eclairsRestants = 0, pctDehors = 0;
  SOURCES.forEach(({ src }) => {
    barres += (src.match(/class="sb-progress-bar"/g) || []).length;
    pctDansCercle += (src.match(/<div class="wait-badge"><span class="sb-progress-bar-pct"/g) || []).length;
    // L'ancien éclair : un SVG à l'intérieur du badge.
    eclairsRestants += (src.match(/class="wait-badge"[^>]*><svg/g) || []).length;
    // L'ancien pourcentage : un div frère, en dehors du cercle.
    pctDehors += (src.match(/<div class="sb-progress-bar-pct"/g) || []).length;
  });

  assert.equal(barres, 13, 'le compte de barres a changé (' + barres + ') : ce test doit être mis à jour avec');
  assert.equal(pctDansCercle, 13,
    'REGRESSION : seulement ' + pctDansCercle + ' barres sur ' + barres + ' portent le pourcentage dans '
    + 'leur cercle. Les autres afficheraient un style de chargement différent.');
  assert.equal(eclairsRestants, 0,
    'REGRESSION : ' + eclairsRestants + ' éclair(s) subsistent dans un cercle, à la place du pourcentage');
  assert.equal(pctDehors, 0,
    'REGRESSION : ' + pctDehors + ' pourcentage(s) sont restés en dehors du cercle');
});

test('le ruban défile vraiment, et le chiffre reste lisible au centre', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const vu = await page.evaluate(async () => {
      const bar = document.createElement('div');
      bar.className = 'sb-progress-bar';
      bar.innerHTML = '<div class="wait-badge"><span class="sb-progress-bar-pct" id="tPct">37%</span></div>'
        + '<div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="tFill"></div></div>';
      document.body.appendChild(bar);
      const piste = bar.querySelector('.sb-progress-bar-track');
      const badge = bar.querySelector('.wait-badge');
      const pct = document.getElementById('tPct');

      // Défilement RÉEL, lu sur la position du motif à plusieurs instants :
      // une animation déclarée mais immobile passerait un test qui ne lit
      // que le nom de l'animation.
      const positions = [];
      for (const t of [0, 200, 400, 600]) {
        piste.getAnimations().forEach(a => { a.pause(); a.currentTime = t; });
        positions.push(getComputedStyle(piste).backgroundPositionX);
      }

      const rBadge = badge.getBoundingClientRect();
      const rPct = pct.getBoundingClientRect();
      const dedans = rPct.left >= rBadge.left && rPct.right <= rBadge.right
        && rPct.top >= rBadge.top && rPct.bottom <= rBadge.bottom;

      return {
        positions: positions,
        animPiste: getComputedStyle(piste).animationName,
        animAnneau: getComputedStyle(badge, '::before').animationName,
        hauteurPiste: Math.round(piste.getBoundingClientRect().height),
        pctDedans: dedans,
        pctVisible: getComputedStyle(pct).display !== 'none' && pct.textContent.trim() === '37%',
        fillCache: getComputedStyle(document.getElementById('tFill')).display
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.animPiste, 'rubanDefile', 'la piste doit porter l\'animation de défilement');
    assert.equal(new Set(vu.positions).size > 1, true,
      'REGRESSION : le motif ne bouge pas réellement (positions lues : ' + vu.positions.join(', ')
      + '). Une animation déclarée mais immobile ne dit rien au créateur.');
    assert.equal(vu.animAnneau, 'dsLoadingSpin', 'l\'anneau autour du chiffre doit tourner');
    assert.ok(vu.hauteurPiste > 0 && vu.hauteurPiste <= 8,
      'REGRESSION : la barre fait ' + vu.hauteurPiste + ' px de haut. Le propriétaire l\'a demandée '
      + 'plus fine que le modèle : au-delà, ce n\'est plus une barre de progression mais un bandeau.');
    assert.equal(vu.pctDedans, true,
      'REGRESSION : le pourcentage déborde du cercle au lieu d\'être posé en son centre');
    assert.equal(vu.pctVisible, true, 'le pourcentage doit rester lisible : c\'est la SEULE information '
      + 'd\'avancement depuis que la barre est indéterminée');
    assert.equal(vu.fillCache, 'none', 'l\'ancien remplissage ne doit plus s\'afficher');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('à 100 %, tout s\'arrête et la barre passe en émeraude', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const vu = await page.evaluate(async () => {
      const bar = document.createElement('div');
      bar.className = 'sb-progress-bar';
      bar.innerHTML = '<div class="wait-badge"><span class="sb-progress-bar-pct">100%</span></div>'
        + '<div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="fFill"></div></div>';
      document.body.appendChild(bar);
      const fill = document.getElementById('fFill');
      const piste = bar.querySelector('.sb-progress-bar-track');

      const avant = {
        piste: getComputedStyle(piste).animationName,
        fond: getComputedStyle(piste).backgroundColor
      };
      // C'est la largeur écrite par les appelants qui déclenche tout : on la
      // pose comme ils le font, et on laisse l'observateur faire son travail.
      fill.style.width = '100%';
      await new Promise(r => setTimeout(r, 300));

      return {
        avantAnim: avant.piste,
        avantFond: avant.fond,
        apresAnim: getComputedStyle(piste).animationName,
        apresFond: getComputedStyle(piste).backgroundColor,
        apresImage: getComputedStyle(piste).backgroundImage,
        anneau: getComputedStyle(bar.querySelector('.wait-badge'), '::before').animationName,
        classePiste: piste.classList.contains('termine'),
        classeBarre: bar.classList.contains('termine')
      };
    });

    assert.equal(vu.avantAnim, 'rubanDefile', 'avant la fin, le ruban défile');
    assert.equal(vu.classePiste, true, 'REGRESSION : la piste ne reçoit pas la marque de fin');
    assert.equal(vu.classeBarre, true, 'REGRESSION : la barre entière ne reçoit pas la marque de fin');
    assert.equal(vu.apresAnim, 'none',
      'REGRESSION : le ruban continue de défiler alors que c\'est terminé. Il dirait le contraire '
      + 'de ce qui vient de se passer.');
    assert.equal(vu.anneau, 'none',
      'REGRESSION : l\'anneau tourne encore à côté d\'une barre verte');
    assert.equal(vu.apresImage, 'none', 'les rayures doivent disparaître à la fin');
    assert.notEqual(vu.apresFond, vu.avantFond, 'le fond doit changer à la fin');
    assert.match(vu.apresFond, /rgb\(/, 'et devenir une vraie couleur pleine (émeraude)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

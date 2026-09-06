// Demande du propriétaire : « que notre bouton + pulse, mais dès qu'on clique
// dessus et qu'il devient −, la pulsation s'arrête ».
//
// C'est exactement la règle déjà posée pour la flèche de défilement, et elle
// vaut : ce qui BOUGE invite. Un « + » invite à ouvrir. Un « − » ne propose
// plus que de refermer ce qu'on vient d'ouvrir, et continuer à pulser
// attirerait l'œil sur le bouton au lieu des modes qu'il vient d'afficher.
//
// DEUX PIÈGES que ce test verrouille, parce qu'ils ne se voient pas en lisant
// le CSS :
//  - ce bouton est CENTRÉ par son propre transform (translate(-50%,0)). Une
//    animation sur transform qui l'oublierait le ferait sauter à droite de
//    l'écran pendant toute la pulsation ;
//  - une animation infinie est prioritaire sur le transform d'une simple
//    pseudo-classe : sans la couper, l'enfoncement du bouton à l'appui
//    disparaîtrait, et le créateur perdrait le retour tactile.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

// Mesure RÉELLE du mouvement sur plusieurs instants : une classe CSS posée
// sans que rien ne bouge passerait un test qui ne lit que la classe.
const mesurer = async (page, n) => {
  const largeurs = [];
  const centres = [];
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(() => {
      const b = document.getElementById('creerBtn').getBoundingClientRect();
      return { l: Math.round(b.width * 10) / 10, c: Math.round((b.left + b.width / 2) * 10) / 10 };
    });
    largeurs.push(r.l);
    centres.push(r.c);
    await page.waitForTimeout(150);
  }
  return {
    amplitude: Math.max(...largeurs) - Math.min(...largeurs),
    derive: Math.max(...centres) - Math.min(...centres)
  };
};

// LA PULSATION SE DÉSIGNE PAR SON NOM, jamais par son rang.
// getAnimations() renvoie AUSSI les transitions CSS : au moment où le bouton
// reçoit sa classe .visible, sa transition d'apparition est en tête de liste,
// et [0] désignait donc une transition d'une seule itération. Le test
// annonçait alors « la pulsation n'est plus bornée à trois cycles » alors que
// le CSS était intact, uniquement quand la machine était chargée. Un rouge qui
// ment coûte plus cher qu'un test lent.
const PULSATION = `window.pulsationCreerBtn = () =>
  document.getElementById('creerBtn').getAnimations().find(a => a.animationName === 'creerPulse');`;

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  // On ATTEND que le bouton porte vraiment sa pulsation, au lieu de parier
  // sur un délai fixe. Sous charge (la suite complète fait tourner plusieurs
  // navigateurs à la fois), 800 ms ne suffisaient pas toujours : le bouton
  // n'avait pas encore sa classe .visible, getAnimations() renvoyait un
  // tableau vide, et le test échouait en annonçant une pulsation « plus
  // bornée à trois cycles » alors que le CSS était intact. Un rouge qui ne
  // dit pas la vérité coûte plus cher qu'un test lent.
  await page.waitForFunction(() => {
    const b = document.getElementById('creerBtn');
    return !!(b && b.getAnimations().some(a => a.animationName === 'creerPulse'));
  }, null, { timeout: 15000 });
  await page.evaluate(PULSATION);
  return page;
}

test('le « + » pulse vraiment, et il reste parfaitement centré', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const etat = await page.evaluate(() => ({
      visible: document.getElementById('creerBtn').classList.contains('visible'),
      anim: getComputedStyle(document.getElementById('creerBtn')).animationName
    }));
    const m = await mesurer(page, 14);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(etat.visible, true, 'le bouton doit être là dès l\'arrivée');
    assert.equal(etat.anim, 'creerPulse', 'l\'animation de pulsation doit tourner sur un « + »');
    assert.ok(m.amplitude >= 1.5,
      'REGRESSION : le bouton ne change pas réellement de taille (amplitude mesurée '
      + m.amplitude.toFixed(1) + ' px). Une classe posée sans mouvement n\'invite personne.');
    assert.ok(m.derive <= 0.6,
      'REGRESSION : le bouton DÉRIVE horizontalement de ' + m.derive.toFixed(1) + ' px pendant la '
      + 'pulsation. Les images-clés ont oublié le translate(-50%) qui le centre.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('devenu « − », il se fige, puis repulse quand on referme', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);

    await page.evaluate(() => basculerPanneauCreation());
    await page.waitForTimeout(600);

    const ouvertEtat = await page.evaluate(() => ({
      ouvert: document.body.classList.contains('creer-ouvert'),
      anim: getComputedStyle(document.getElementById('creerBtn')).animationName,
      // Le « − » : seule la barre verticale se rétracte.
      barre: getComputedStyle(document.getElementById('creerBtnBarre')).transform,
      fleche: getComputedStyle(document.getElementById('scrollTopIcon')).animationName
    }));
    const mOuvert = await mesurer(page, 10);

    assert.equal(ouvertEtat.ouvert, true, 'le panneau doit bien être déplié');
    assert.equal(ouvertEtat.anim, 'none',
      'REGRESSION : le bouton continue de pulser alors qu\'il montre un « − ». Il n\'invite plus '
      + 'à rien d\'autre que refermer, et il dispute l\'attention aux modes qu\'il vient d\'afficher.');
    assert.equal(mOuvert.amplitude, 0, 'REGRESSION : il bouge encore, mesuré : ' + mOuvert.amplitude);
    assert.match(ouvertEtat.barre, /matrix\(1, 0, 0, 0/, 'l\'icône doit bien être passée en « − »');
    assert.equal(ouvertEtat.fleche, 'none',
      'REGRESSION : la flèche de défilement continue de bondir PAR-DESSUS le panneau ouvert. '
      + 'Même règle : ce qui n\'invite plus se fige.');

    await page.evaluate(() => fermerPanneauCreation());
    await page.waitForTimeout(600);
    const refermeAnim = await page.evaluate(
      () => getComputedStyle(document.getElementById('creerBtn')).animationName);
    const mReferme = await mesurer(page, 12);

    assert.equal(refermeAnim, 'creerPulse', 'REGRESSION : la pulsation ne repart pas après fermeture');
    assert.ok(mReferme.amplitude >= 1.5,
      'REGRESSION : la pulsation est annoncée mais rien ne bouge après fermeture ('
      + mReferme.amplitude.toFixed(1) + ' px)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Choix du propriétaire après comparaison des deux rendus : la pulsation
// appelle pendant trois cycles, puis le bouton se pose. Une pulsation sans
// fin cesse d'être une invitation pour devenir du décor, et sur l'accueil
// elle cohabiterait en permanence avec la flèche qui bondit.
test('la pulsation s\'arrête d\'elle-même après trois cycles, et repart quand le bouton revient', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);

    const cadence = await page.evaluate(() => {
      const a = pulsationCreerBtn();
      const t = a && a.effect.getTiming();
      return { duree: t && t.duration, cycles: t && t.iterations };
    });
    assert.equal(cadence.cycles, 3, 'REGRESSION : la pulsation n\'est plus bornée à trois cycles');

    // On avance le temps de l'animation plutôt que d'attendre 8 secondes en
    // vrai : même résultat, sans allonger la suite pour rien.
    await page.evaluate(() => {
      pulsationCreerBtn().currentTime = 2.6 * 3 * 1000 + 200;
    });
    await page.waitForTimeout(200);
    const apres = await page.evaluate(() => {
      const b = document.getElementById('creerBtn');
      const a = pulsationCreerBtn();
      const r = b.getBoundingClientRect();
      return { etat: a && a.playState, largeur: Math.round(r.width * 10) / 10 };
    });
    const auRepos = await mesurer(page, 8);

    assert.equal(apres.etat, 'finished', 'REGRESSION : la pulsation tourne encore après trois cycles');
    assert.equal(auRepos.amplitude, 0,
      'REGRESSION : le bouton bouge encore une fois la pulsation terminée (' + auRepos.amplitude + ' px)');

    // Elle doit REPARTIR quand le bouton réapparaît, sinon l'invitation ne
    // vaudrait que pour les huit premières secondes de toute la session.
    await page.evaluate(() => basculerPanneauCreation());
    await page.waitForTimeout(500);
    await page.evaluate(() => fermerPanneauCreation());
    await page.waitForTimeout(400);
    const relance = await mesurer(page, 10);
    assert.ok(relance.amplitude >= 1.5,
      'REGRESSION : la pulsation ne repart pas quand le bouton réapparaît (' + relance.amplitude.toFixed(1)
      + ' px). L\'invitation ne vaudrait alors que pour les toutes premières secondes de la session.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'appui reste perceptible malgré l\'animation', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('creerBtn');
      // On lit la règle telle que le navigateur l'a réellement retenue pour
      // l'état :active, plutôt que de simuler un appui (impossible à figer).
      let coupe = false, enfonce = false;
      for (const feuille of document.styleSheets) {
        let regles;
        try { regles = feuille.cssRules; } catch (e) { continue; }
        for (const regle of regles) {
          if (regle.selectorText === '#creerBtn:active') {
            if (/none/.test(regle.style.animation || regle.style.animationName || '')) coupe = true;
            if (/translate\(-50%, ?2px\)/.test(regle.style.transform || '')) enfonce = true;
          }
        }
      }
      return { coupe: coupe, enfonce: enfonce, existe: !!btn };
    });

    assert.equal(r.existe, true);
    assert.equal(r.enfonce, true, 'l\'appui doit toujours enfoncer le bouton de 2 px');
    assert.equal(r.coupe, true,
      'REGRESSION : l\'animation n\'est pas coupée à l\'appui. Une animation infinie est prioritaire '
      + 'sur le transform d\'une pseudo-classe : le retour tactile disparaîtrait.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

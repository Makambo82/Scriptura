// Demande du propriétaire, capture à l'appui : « les titres des boutons du
// héro en majuscules, mais surtout en sorte qu'ils tiennent sur une ligne ».
//
// MISE À JOUR (refonte visuelle, nouvelle capture) : les titres passent de
// Playfair Display majuscules à Russo One (la police du logo) minuscules,
// puis (retour suivant, encore une capture) à Poppins GRAS minuscule. La
// demande de tenir sur une ligne, elle, n'a jamais changé, et le mécanisme
// de réduction (ajusterTexteUneLigne) mesure la largeur RÉELLEMENT rendue à
// chaque fois : peu importe la police en place, la marge de sécurité posée
// à l'origine pour des majuscules Playfair Display sert toujours de filet.
// Sans ajustement, « transcrire ou télécharger une vidéo » passerait à la
// ligne.
//
// LES ONZE CARTES EXISTENT EN DEUX EXEMPLAIRES, sur l'accueil et dans le
// panneau « Créer ». Les deux surfaces sont testées : celle du panneau était le
// piège, ses cartes ayant une largeur nulle tant qu'il est replié, donc
// impossibles à mesurer avant son ouverture.
//
// ATTENTION AUX MESURES DE LARGEUR ICI : l'environnement de développement ne
// charge pas les polices Google (requête sortante bloquée), la CI et la
// production si. Les largeurs mesurées sont donc celles d'une police de REPLI.
// Ce test reste valable parce qu'il ne vérifie aucune valeur absolue : il exige
// que le titre tienne, quelle que soit la police qui le rend.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const LARGEURS = [360, 390, 414, 430];

const SURFACES = [
  ['accueil', () => revelerModes()],
  ['panneau « Créer »', () => ouvrirPanneauCreation()]
];

async function ouvrirAccueil(navigateur, baseUrl, largeur) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(async () => { await document.fonts.ready; });
  return page;
}

function releverTitres(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.mode-label').forEach(el => {
      if (el.offsetParent === null || el.clientWidth < 2) return;
      const s = getComputedStyle(el);
      const px = parseFloat(s.fontSize);
      out.push({
        t: el.textContent.trim().slice(0, 40),
        px, casse: s.textTransform,
        coupe: el.scrollWidth > el.clientWidth + 1,
        // Une ligne mesure environ 1,3 fois la taille de police (line-height
        // 1.3 déclaré) ; deux lignes en font plus de 2,6. Le seuil de 1,9 les
        // sépare nettement. On ne lit PAS getComputedStyle().lineHeight quand
        // rien n'est déclaré : il vaut la chaîne « normal », dont parseFloat
        // fait NaN, et la comparaison devient fausse en silence.
        deuxLignes: el.getBoundingClientRect().height > px * 1.9
      });
    });
    return out;
  });
}

test('les titres des cartes sont en minuscules et tiennent sur une ligne', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const fautes = [];
    let mesures = 0;

    for (const largeur of LARGEURS) {
      const page = await ouvrirAccueil(navigateur, baseUrl, largeur);
      for (const [ou, ouvrir] of SURFACES) {
        await page.evaluate('(' + ouvrir.toString() + ')()');
        await page.waitForTimeout(450);
        const titres = await releverTitres(page);
        titres.forEach(x => {
          mesures++;
          if (x.casse !== 'lowercase') {
            fautes.push(largeur + 'px · ' + ou + ' · PAS EN MINUSCULES (' + x.casse + ') · « ' + x.t + ' »');
          }
          if (x.coupe) fautes.push(largeur + 'px · ' + ou + ' · COUPÉ à ' + x.px + 'px · « ' + x.t + ' »');
          if (x.deuxLignes) {
            fautes.push(largeur + 'px · ' + ou + ' · DEUX LIGNES à ' + x.px + 'px · « ' + x.t + ' »');
          }
        });
      }
      await page.close();
    }

    // Sans ce garde-fou, un renommage de classe viderait le test de son sens
    // sans le faire tomber.
    assert.ok(mesures >= 40,
      'REGRESSION : seulement ' + mesures + ' titres mesurés sur ' + LARGEURS.length + ' largeurs '
      + 'et ' + SURFACES.length + ' surfaces. La classe .mode-label ou les fonctions d\'ouverture '
      + 'ont dû changer : ce test ne vérifie plus rien, en restant vert.');

    assert.deepEqual(fautes, [],
      'REGRESSION : les titres des cartes de mode ne respectent plus la demande du propriétaire '
      + '(minuscules, et surtout une seule ligne) :\n  ' + fautes.join('\n  '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la description sous le titre n\'a PAS été emportée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 414);
    const vu = await page.evaluate(() => {
      revelerModes();
      const d = document.querySelector('.mode-desc');
      if (!d) return null;
      const s = getComputedStyle(d);
      return { casse: s.textTransform, nowrap: s.whiteSpace,
        txt: d.textContent.trim().slice(0, 40),
        hauteur: d.getBoundingClientRect().height, px: parseFloat(s.fontSize) };
    });

    assert.ok(vu, 'la description doit exister sous le titre');

    // C'est une PHRASE, pas un libellé : elle reste en minuscules et peut
    // occuper plusieurs lignes. Seul le titre était visé.
    assert.notEqual(vu.casse, 'uppercase',
      'REGRESSION : la description des cartes est passée en capitales. Ce sont des phrases '
      + '(« Scriptura apprend qui tu es pour te recommander quoi créer »), pas des libellés : en '
      + 'capitales elles crient et deviennent pénibles à lire. Vu : « ' + vu.txt + ' »');
    assert.notEqual(vu.nowrap, 'nowrap',
      'REGRESSION : la description ne peut plus revenir à la ligne. Elle serait rognée ou '
      + 'rapetissée pour rien : une phrase de deux lignes sous un titre, c\'est normal.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('titres et bouton d\'accueil partagent le MÊME ajustement', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 414);

    // « Une logique recopiée finit toujours par diverger » : le calcul qui fait
    // tenir un texte sur une ligne ne doit exister QU'UNE FOIS. S'il était
    // recopié pour les titres, la marge de sécurité ou le plancher partiraient
    // chacun de leur côté le jour où l'un des deux serait retouché.
    const vu = await page.evaluate(() => ({
      partageeExiste: typeof ajusterTexteUneLigne === 'function',
      cta: typeof ajusterHeroCta === 'function' ? ajusterHeroCta.toString() : '',
      titres: typeof ajusterTitresModes === 'function' ? ajusterTitresModes.toString() : ''
    }));

    assert.equal(vu.partageeExiste, true,
      'REGRESSION : ajusterTexteUneLigne a disparu. Si chaque endroit refait le calcul dans son '
      + 'coin, ils finiront par ne plus se comporter pareil.');
    assert.match(vu.cta, /ajusterTexteUneLigne\(/,
      'REGRESSION : le bouton d\'accueil n\'utilise plus l\'ajustement partagé, il en a donc une '
      + 'copie à lui.');
    assert.match(vu.titres, /ajusterTexteUneLigne\(/,
      'REGRESSION : les titres des cartes n\'utilisent plus l\'ajustement partagé.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// CE TEST EXISTE PARCE QU'UNE MORSURE NE MORDAIT PAS. En retirant l'appel à
// l'ajustement posé à l'ouverture du panneau « Créer », les trois tests
// ci-dessus restaient verts : avec la police de repli de cet environnement,
// aucun titre actuel n'a besoin d'être réduit, donc rien ne prouvait que
// l'ajustement était seulement branché. Sur la CI et en production, où la vraie
// police est plus large, il l'est.
//
// MISE À JOUR (passage à Russo One) : un titre réel fixe (« Transcrire ou
// télécharger une vidéo ») avait été calibré à la main pour être marginal
// avec Playfair Display. Le changement de police a suffi à le faire rentrer
// sans réduction dans CE test-ci, pas parce que le mécanisme d'ajustement
// s'est cassé (il est inchangé, voir js/ui.js), mais parce qu'un titre fixe,
// recopié pour une police précise, se périme dès que la police change. On ne
// recalibre plus à la main : le titre de test est désormais CONSTRUIT au vol
// dans la page, à partir de la largeur et de la police RÉELLEMENT mesurées à
// cet instant (canvas.measureText, indépendant de la mise en page), pour
// toujours déborder d'environ 25 % à la taille de référence, quelle que soit
// la police qui rend réellement le texte ici. Le plancher (0.62rem, voir
// MODE_TITRE_TAILLE_MIN dans js/ui.js) n'est jamais atteint à ce ratio.
test('un titre long est vraiment ajusté, sur les deux surfaces', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 414);

    for (const [ou, ouvrir] of SURFACES) {
      const vu = await page.evaluate(({ src }) => {
        // Taille et largeur de RÉFÉRENCE lues sur un élément JETABLE, jamais
        // recopiées à la main : la boucle réutilise les mêmes .mode-label
        // d'un tour à l'autre (les deux surfaces existent en même temps dans
        // le DOM), un élément déjà réduit au tour précédent donnerait une
        // fausse référence s'il était lu directement. Un span détaché, placé
        // dans la même structure de carte (même largeur imposée par
        // min-width:0/flex), ne porte aucune mutation passée.
        const carteRef = document.querySelector('.hero-mode-btn .mode-body') || document.body;
        const sonde = document.createElement('span');
        sonde.className = 'mode-label';
        sonde.style.visibility = 'hidden';
        sonde.textContent = 'x';
        carteRef.appendChild(sonde);
        const style = getComputedStyle(sonde);
        const refPx = parseFloat(style.fontSize);
        const dispo = sonde.parentElement.clientWidth || 260; // repli raisonnable si non mesurable
        const police = style.fontFamily;
        sonde.remove();

        // CONSTRUCTION DU TITRE : on double un mot réel de l'app jusqu'à
        // dépasser ~125 % de la largeur disponible, mesuré au vrai pixel près
        // avec la police et la taille RÉELLEMENT utilisées (canvas, pas une
        // estimation). Toujours un mot réel de l'interface, jamais une suite
        // de caractères inventée.
        const mot = 'Transcrire ';
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = refPx + 'px ' + police;
        let titre = mot;
        while (ctx.measureText(titre).width < dispo * 1.25 && titre.length < 600) {
          titre += mot;
        }
        titre = titre.trim();

        // On allonge le titre AVANT d'ouvrir la surface : c'est l'ouverture qui
        // doit déclencher l'ajustement, comme dans la vraie vie où les cartes
        // n'ont aucune largeur tant qu'elles sont masquées.
        document.querySelectorAll('.mode-label').forEach(el => {
          el.textContent = titre;
          el.style.fontSize = '';   // on repart de la taille du CSS
        });
        eval('(' + src + ')()');
        return { refPx, titreLongueur: titre.length };
      }, { src: ouvrir.toString() });

      assert.ok(vu.refPx, 'REGRESSION : impossible de lire la taille de référence de .mode-label.');
      assert.ok(vu.titreLongueur > 10 && vu.titreLongueur < 600,
        'REGRESSION : le titre de test construit au vol a une longueur suspecte (' + vu.titreLongueur
        + ' caractères) : la mesure canvas a dû échouer silencieusement.');

      await page.waitForTimeout(500);
      const titres = await releverTitres(page);
      const mauvais = titres.filter(x => x.coupe || x.deuxLignes);

      assert.ok(titres.length > 0,
        'REGRESSION : aucun titre visible sur « ' + ou + ' » : ce cas ne vérifie rien.');

      // LA PREUVE DU BRANCHEMENT : ce titre-là ne tient pas à la taille de
      // référence, il DOIT donc avoir été réduit. S'il est resté à cette
      // taille, c'est que l'ajustement n'a pas été déclenché quand cette
      // surface est devenue visible, et sur la CI comme en production, où la
      // police est plus large, tous les titres déborderaient.
      const nonReduits = titres.filter(x => x.px >= vu.refPx);
      assert.deepEqual(nonReduits.map(x => x.t), [],
        'REGRESSION : sur « ' + ou + ' », un titre trop long pour la carte est resté à sa taille '
        + 'de référence. L\'ajustement n\'est pas déclenché quand cette surface devient visible.');

      assert.deepEqual(mauvais.map(x => x.t + ' (' + x.px + 'px)'), [],
        'REGRESSION : sur « ' + ou + ' », ce titre long déborde ou passe à la ligne malgré '
        + 'l\'ajustement.');
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour du propriétaire : « de même que les boutons d'outils TikTok en bas de
// la page d'accueil ». Deux des trois cartes des Services annexes étaient déjà
// couvertes, partageant les mêmes classes. LA TROISIÈME NON, et c'est ce que la
// vérification a montré : « Monter une vidéo » est réservée aux abonnés, elle
// n'apparaît donc qu'APRÈS le chargement, APRÈS l'ajustement initial, et son
// titre n'était jamais mesuré. Mesuré alors : il restait à 1rem et se faisait
// rogner dès qu'il était un peu long.
//
// La correction n'a pas été d'ajouter un appel de plus à cet endroit : il y a
// d'autres moments où une carte apparaît, et il y en aura. C'est la LARGEUR qui
// est observée désormais, ce qui couvre le passage de zéro à la vraie largeur,
// d'où qu'il vienne.
test('une carte qui apparaît APRÈS le chargement voit son titre ajusté', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 360);

    // La carte réservée aux abonnés, encore masquée : on lui donne un titre
    // trop long pour sa largeur, afin que l'absence d'ajustement se voie.
    // Titre CONSTRUIT au vol (même technique que le test précédent, voir son
    // commentaire) : jamais une valeur figée qui se périme au prochain
    // changement de police.
    const avant = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.mode-label')]
        .find(e => /Monter une/i.test(e.textContent));
      if (!el) return null;
      const style = getComputedStyle(el);
      const refPx = parseFloat(style.fontSize);
      const police = style.fontFamily;
      const dispo = el.clientWidth || el.closest('.mode-body')?.clientWidth || 200;
      const mot = 'Transcrire ';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = refPx + 'px ' + police;
      let titre = mot;
      while (ctx.measureText(titre).width < dispo * 1.25 && titre.length < 600) titre += mot;
      titre = titre.trim();

      el.textContent = titre;
      el.style.fontSize = '';
      el.dataset.sonde = '1';
      return { visible: el.offsetParent !== null, refPx };
    });

    assert.ok(avant,
      'REGRESSION : la carte « Monter une vidéo » est introuvable dans les Services annexes.');
    assert.equal(avant.visible, false,
      'REGRESSION : cette carte est visible sans abonnement. Elle mène au montage vidéo, réservé '
      + 'à Creator et Pro : un visiteur cliquerait pour se faire refuser après coup.');

    // L'abonnement est reconnu : la carte apparaît.
    await page.evaluate(() => {
      document.body.classList.add('peut-monter-video', 'is-unlocked');
    });
    await page.waitForTimeout(400);

    const apres = await page.evaluate(() => {
      const el = document.querySelector('[data-sonde="1"]');
      const px = parseFloat(getComputedStyle(el).fontSize);
      return { visible: el.offsetParent !== null, px,
        coupe: el.scrollWidth > el.clientWidth + 1,
        deuxLignes: el.getBoundingClientRect().height > px * 1.9 };
    });

    assert.equal(apres.visible, true, 'la carte doit apparaître pour un abonné');
    assert.ok(apres.px < avant.refPx,
      'REGRESSION : le titre de cette carte est resté à sa taille de référence (' + apres.px
      + 'px) alors qu\'il est trop long pour elle. Les cartes qui apparaissent APRÈS le chargement '
      + 'ne sont plus ajustées : leur titre débordera dès qu\'il sera un peu long, et personne ne '
      + 'le verra venir puisque tout va bien au chargement.');
    assert.equal(apres.coupe, false, 'et il ne doit pas être rogné');
    assert.equal(apres.deuxLignes, false, 'ni passer sur deux lignes');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

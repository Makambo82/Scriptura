// Demande du propriétaire, deux captures à l'appui : « Commence gratuitement »
// tenait sur une ligne, « On fait grandir ton audience ? » passait sur deux, et
// le point d'interrogation se retrouvait seul en dessous. « Que la taille du
// texte s'adapte automatiquement au cadre du bouton, quelle qu'en soit la
// longueur, pour que le texte reste toujours sur une seule ligne. »
//
// LE TEST PASSE LES ONZE PHRASES, pas les deux de ses captures. Le libellé est
// tiré au hasard à chaque visite parmi dix invitations pour un abonné, plus
// celle du visiteur : ne vérifier que celles qu'on a sous les yeux, c'est
// laisser neuf cas se casser en silence chez d'autres utilisateurs.
//
// SUR LES LARGEURS QUE LE PROJET CIBLE VRAIMENT (360 à 430px), et pas une de
// plus. Mon premier jet testait 320px, que rien d'autre dans l'app ne couvre :
// c'était tenir cette seule fonctionnalité à un standard plus strict que le
// reste, sur une largeur dont personne n'a validé le rendu ailleurs.
//
// ATTENTION AUX MESURES DE LARGEUR DANS CES TESTS : l'environnement de
// développement ne charge pas les polices Google (requête sortante bloquée),
// la CI et la production si. Les largeurs de texte mesurées ici sont donc
// celles d'une police de REPLI. Ce test reste valable parce qu'il ne vérifie
// aucune valeur absolue : il exige que le texte tienne, quelle que soit la
// police avec laquelle il est rendu.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const LARGEURS = [360, 390, 414, 430];

async function ouvrirAccueil(navigateur, baseUrl, largeur) {
  const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  // Les polices arrivent APRÈS le premier rendu : mesurer avant, c'est mesurer
  // une police de repli, donc obtenir des largeurs fausses.
  await page.evaluate(async () => { await document.fonts.ready; });
  return page;
}

test('toutes les invitations tiennent sur UNE ligne, sur tous les écrans', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const fautes = [];
    let mesures = 0;

    for (const largeur of LARGEURS) {
      const page = await ouvrirAccueil(navigateur, baseUrl, largeur);
      const r = await page.evaluate(() => {
        const lbl = document.getElementById('heroCtaLabel');
        if (!lbl || typeof HERO_CTA_PHRASES_ABONNE === 'undefined') return null;
        // Les dix invitations d'abonné PLUS celle du visiteur : c'est la liste
        // complète de ce qui peut réellement s'afficher.
        const phrases = HERO_CTA_PHRASES_ABONNE.concat(['Commence gratuitement']);
        return phrases.map(t => {
          // ON PASSE PAR LE VRAI CHEMIN, majHeroCta, et non par un appel direct
          // à l'ajustement : c'est là que le libellé est posé dans l'app, et
          // c'est là que l'ajustement doit être déclenché. Un test qui appelle
          // lui-même ajusterHeroCta resterait vert même si plus personne ne
          // l'appelait, et le bouton serait cassé pour de vrai.
          if (t === 'Commence gratuitement') {
            unlocked = false;
          } else {
            unlocked = true;
            _heroCtaPhraseAbonne = t;   // fige le tirage au sort sur ce cas
          }
          majHeroCta();
          const r = lbl.getBoundingClientRect();
          const px = parseFloat(getComputedStyle(lbl).fontSize);
          return {
            t, px,
            texteAffiche: lbl.textContent,
            // Deux symptômes DIFFÉRENTS, et il faut les deux : le texte peut
            // être coupé (rogné par overflow) sans dépasser en hauteur, ou
            // passer sur deux lignes sans être coupé.
            coupe: lbl.scrollWidth > lbl.clientWidth + 1,
            hauteur: r.height,
            // LA HAUTEUR D'UNE LIGNE SE DÉDUIT DE LA POLICE, jamais de
            // getComputedStyle().lineHeight : sans line-height déclaré, celui-ci
            // renvoie la chaîne « normal », dont parseFloat fait NaN. Toute
            // comparaison devient alors fausse en silence, et la vérification
            // ne se déclenche jamais. C'est la morsure de contrôle qui l'a
            // révélé : le test restait vert avec un libellé sur deux lignes.
            deuxLignes: r.height > px * 1.9
          };
        });
      });

      assert.ok(r, 'REGRESSION : le libellé du bouton d\'accueil ou la liste des phrases est '
        + 'introuvable. Ce test ne vérifie plus rien, en restant vert.');

      r.forEach(x => {
        mesures++;
        if (x.texteAffiche !== x.t) {
          fautes.push(largeur + 'px · le bouton affiche « ' + x.texteAffiche + ' » au lieu de « ' + x.t + ' »');
          return;
        }
        if (x.coupe) fautes.push(largeur + 'px · COUPÉ à ' + x.px + 'px · « ' + x.t + ' »');
        // Une ligne mesure environ 1,2 fois la taille de police ; deux lignes
        // en font plus de 2,4. Le seuil de 1,9 les sépare nettement.
        if (x.deuxLignes) {
          fautes.push(largeur + 'px · DEUX LIGNES (' + Math.round(x.hauteur) + 'px de haut pour '
            + x.px + 'px de police) · « ' + x.t + ' »');
        }
      });
      await page.close();
    }

    assert.ok(mesures >= 40,
      'REGRESSION : seulement ' + mesures + ' mesures. La liste des phrases a dû être vidée ou '
      + 'renommée : ce test ne couvre plus les cas réels.');

    assert.deepEqual(fautes, [],
      'REGRESSION : le libellé du bouton d\'accueil ne tient plus sur une seule ligne. C\'était la '
      + 'demande exacte du propriétaire : le bouton a une largeur fixe, les phrases non, et la '
      + 'taille doit s\'adapter à la phrase. Cas fautifs :\n  ' + fautes.join('\n  '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le libellé ne rétrécit que s\'il le faut, et jamais en cascade', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 414);

    const vu = await page.evaluate(() => {
      const lbl = document.getElementById('heroCtaLabel');
      const taille = () => parseFloat(getComputedStyle(lbl).fontSize);

      // 1. Une phrase courte garde la taille de référence : on ne rapetisse
      //    pas un texte qui tenait déjà.
      lbl.textContent = "On s'y met ?";
      ajusterHeroCta();
      const courte = taille();

      // 2. Une phrase longue est réduite.
      lbl.textContent = "Qu'est-ce qu'on écrit aujourd'hui ?";
      ajusterHeroCta();
      const longue = taille();

      // 3. LE PIÈGE : rappeler l'ajustement plusieurs fois de suite sur la
      //    MÊME phrase ne doit pas la rétrécir un peu plus à chaque fois.
      //    majHeroCta est appelée souvent (après chaque génération, à chaque
      //    changement de quota) : sans remise à la taille de référence avant
      //    de mesurer, le libellé finirait minuscule sans que rien ne
      //    l'explique.
      ajusterHeroCta(); ajusterHeroCta(); ajusterHeroCta();
      const apresRappels = taille();

      // 4. Et revenir à une phrase courte REND la taille de référence.
      lbl.textContent = "On s'y met ?";
      ajusterHeroCta();
      const retour = taille();

      return { courte, longue, apresRappels, retour };
    });

    assert.ok(vu.longue < vu.courte,
      'REGRESSION : la phrase longue n\'est pas réduite (' + vu.longue + 'px contre ' + vu.courte
      + 'px pour la courte). L\'ajustement ne fait plus rien.');

    assert.equal(vu.apresRappels, vu.longue,
      'REGRESSION : le libellé rétrécit À CHAQUE appel de l\'ajustement (' + vu.longue + 'px puis '
      + vu.apresRappels + 'px). Or il est rappelé après chaque génération et chaque changement de '
      + 'quota : le texte finirait minuscule au fil de la session, sans que rien ne l\'explique. '
      + 'Il faut repartir de la taille de référence AVANT de mesurer.');

    assert.equal(vu.retour, vu.courte,
      'REGRESSION : après une phrase longue, une phrase courte ne retrouve pas la taille de '
      + 'référence (' + vu.retour + 'px contre ' + vu.courte + 'px). La réduction est restée '
      + 'collée au bouton au lieu de suivre le texte.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le libellé peut rétrécir : sans ça, tout le calcul est faux', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 414);

    // LE PIÈGE CLASSIQUE DU FLEX, et il mérite son propre test parce qu'il est
    // invisible : la largeur minimale d'un élément flexible vaut par défaut son
    // contenu, donc, en white-space:nowrap, la phrase ENTIÈRE. Sans min-width:0,
    // l'élément refuse de rétrécir, clientWidth vaut la largeur du TEXTE et non
    // la place disponible, le calcul conclut qu'il n'y a rien à réduire, et le
    // bouton déborde. Tout marche « en apparence », rien ne proteste.
    const vu = await page.evaluate(() => {
      const lbl = document.getElementById('heroCtaLabel');
      const s = getComputedStyle(lbl);
      lbl.textContent = "Qu'est-ce qu'on écrit aujourd'hui ?";
      ajusterHeroCta();
      const btn = document.getElementById('heroCta');
      return {
        minWidth: s.minWidth, nowrap: s.whiteSpace,
        // La preuve par le résultat : le libellé doit être PLUS ÉTROIT que le
        // bouton qui le contient.
        largeurLibelle: lbl.getBoundingClientRect().width,
        largeurBouton: btn.getBoundingClientRect().width,
        deborde: btn.scrollWidth > btn.clientWidth + 1
      };
    });

    assert.equal(vu.nowrap, 'nowrap',
      'REGRESSION : le libellé peut de nouveau revenir à la ligne (' + vu.nowrap + '). C\'est '
      + 'exactement ce que le propriétaire a demandé de supprimer.');
    assert.equal(vu.minWidth, '0px',
      'REGRESSION : min-width n\'est plus à 0 sur le libellé (' + vu.minWidth + '). En flex, la '
      + 'largeur minimale vaut alors le contenu, soit la phrase entière en nowrap : l\'élément '
      + 'refuse de rétrécir, la mesure de place disponible devient fausse, et le bouton déborde '
      + 'sans que rien ne le signale.');
    assert.ok(vu.largeurLibelle < vu.largeurBouton,
      'REGRESSION : le libellé (' + Math.round(vu.largeurLibelle) + 'px) est aussi large ou plus '
      + 'large que le bouton (' + Math.round(vu.largeurBouton) + 'px) : il ne rétrécit plus.');
    assert.equal(vu.deborde, false,
      'REGRESSION : le contenu déborde du bouton d\'accueil.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// CE TEST REPRODUIT L'ÉCHEC DE LA CI, qui n'était pas reproductible ici.
//
// La première version de l'ajustement calculait la taille en UNE passe, en
// supposant la largeur du texte exactement proportionnelle à la taille de
// police. Avec la police de repli de cet environnement, c'était assez vrai pour
// que tout passe. Avec la vraie police, non : la CI a renvoyé des libellés
// rognés à 11,6 et 13,4px, très au-dessus du plancher, donc pas à cause de lui.
//
// LA NON-PROPORTIONNALITÉ SE REPRODUIT À LA DEMANDE en donnant à l'élément un
// espacement de lettres en PIXELS au lieu d'em : cette part-là ne rétrécit pas
// avec la police, exactement comme l'arrondi des largeurs de glyphes. Une seule
// passe sous-corrige alors, et le texte reste trop large.
//
// C'est la seule façon honnête que j'aie trouvée de vérifier ici un correctif
// dont la cause n'existe qu'ailleurs.
test('l\'ajustement remesure : une seule passe ne suffit pas toujours', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirAccueil(navigateur, baseUrl, 414);

    const vu = await page.evaluate(() => {
      const lbl = document.getElementById('heroCtaLabel');
      lbl.textContent = "Qu'est-ce qu'on écrit aujourd'hui ?";
      // La part non proportionnelle : 2px par lettre, quelle que soit la
      // taille. Calibré pour qu'UNE passe ne suffise pas et que DEUX suffisent,
      // ce qui est exactement le régime où le défaut se manifestait. Plus fort,
      // aucune taille ne ferait tenir le texte et le test ne prouverait rien.
      lbl.style.letterSpacing = '2px';
      ajusterHeroCta();
      const px = parseFloat(getComputedStyle(lbl).fontSize);
      const resultat = {
        px, coupe: lbl.scrollWidth > lbl.clientWidth + 1,
        dispo: lbl.clientWidth, besoin: lbl.scrollWidth
      };
      lbl.style.letterSpacing = '';
      return resultat;
    });

    assert.equal(vu.coupe, false,
      'REGRESSION : l\'ajustement ne remesure plus après avoir réduit. Quand une part de la largeur '
      + 'ne rétrécit pas avec la police (arrondi des glyphes, espacement en pixels), une seule '
      + 'passe sous-corrige et le texte reste trop large : ' + vu.besoin + 'px pour ' + vu.dispo
      + 'px de place, à ' + vu.px + 'px de police. C\'est exactement ce qui a fait échouer la CI '
      + 'trois fois, sans être reproductible dans cet environnement.');

    assert.ok(vu.px < 16,
      'et le texte a bien été réduit (' + vu.px + 'px)');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

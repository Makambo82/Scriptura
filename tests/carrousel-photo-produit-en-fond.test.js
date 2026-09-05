// Demande du propriétaire, après avoir testé un carrousel avec sa photo
// produit : « normalement quand l'utilisateur charge une image produit,
// l'app doit utiliser cette image sous différents plans, posture, position,
// dans les images d'arrière-plan du carrousel ».
//
// Constat sur son test : le carrousel PARLAIT bien du produit (le correctif
// anti-dénigrement a tenu, l'offre est nommée et défendue), mais aucune slide
// ne le MONTRAIT. Ses fonds étaient des ambiances générées, et la vraie photo
// n'apparaissait nulle part. Sur un carrousel de VENTE, c'est ce qui manque
// le plus : on achète ce qu'on voit.
//
// CE QU'ON PEUT ET CE QU'ON NE PEUT PAS, vérifié dans le code avant de
// promettre quoi que ce soit. On ne peut pas fabriquer son produit « sous un
// autre angle » : la génération d'images ne reçoit qu'un TEXTE, aucune image
// de référence (api/montage-media.js), elle produirait un sosie, et sur un
// carrousel de vente un sosie est pire que rien (voir
// tests/produit-reel-jamais-imite.test.js). En revanche une photo se
// RECADRE : d'un même fichier on tire un plan large, un plan serré et un plan
// décalé. Trois arrière-plans réellement différents, avec le VRAI produit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Prépare un carrousel de `n` slides avec (ou sans) fichier produit chargé.
const PREPARER = (n, fichier) => `
  (() => {
    carrouselFormat = '4:5';
    carrouselVenteFichier = ${fichier};
    carrouselResultat = {
      titre: 'T', direction_visuelle: 'sobre',
      slides: Array.from({ length: ${n} }, (_, i) => ({
        numero: i + 1, gabarit: i === 0 ? 'couverture' : 'points',
        titre: 'Titre ' + (i + 1), visuel: 'une ambiance ' + (i + 1),
        points: [{ emoji: '🎯', titre: 'P', texte: 'x' }]
      }))
    };
    carrouselImages = new Array(${n}).fill(null);
  })()
`;
const IMAGE = `{ base64: '${PNG_1x1}', mediaType: 'image/png', nom: 'produit.png' }`;
const PDF = `{ base64: 'JVBERi0=', mediaType: 'application/pdf', nom: 'ebook.pdf' }`;

async function page(navigateur, baseUrl) {
  const p = await navigateur.newPage();
  await poserMocksReseau(p);
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(250);
  return p;
}

test('la photo produit se pose sur la couverture, l\'offre finale et une slide du milieu', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const p = await page(navigateur, baseUrl);
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

    const vu = await p.evaluate(({ prep6, prep2, prepSans, prepPdf }) => {
      const plan = (code, n) => {
        eval(code);
        return Array.from(slidesProduitCarrousel(n).entries()).map(([i, c]) => [i, c.nom]);
      };
      return {
        six: plan(prep6, 6),
        deux: plan(prep2, 2),
        sansProduit: plan(prepSans, 6),
        avecPdf: plan(prepPdf, 6)
      };
    }, {
      prep6: PREPARER(6, IMAGE), prep2: PREPARER(2, IMAGE),
      prepSans: PREPARER(6, 'null'), prepPdf: PREPARER(6, PDF)
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(vu.six, [[0, 'plan large'], [5, 'plan serré'], [3, 'plan décalé']],
      'couverture, offre finale, et une du milieu, avec TROIS cadrages différents : ' + JSON.stringify(vu.six));
    assert.deepEqual(vu.deux, [[0, 'plan large'], [1, 'plan serré']],
      'sur un carrousel court, pas de slide du milieu à inventer : ' + JSON.stringify(vu.deux));
    assert.deepEqual(vu.sansProduit, [], 'sans produit chargé, aucune slide ne doit être détournée');
    assert.deepEqual(vu.avecPdf, [],
      'un PDF n\'est pas un visuel de vente : il nourrit le texte, jamais le fond');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('trois cadrages donnent trois images RÉELLEMENT différentes, à partir du même fichier', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const p = await page(navigateur, baseUrl);
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

    const vu = await p.evaluate(async ({ prep }) => {
      eval(prep);
      // Une photo produit reconnaissable, asymétrique : sans ça, un recadrage
      // ne se verrait pas et le test passerait pour de mauvaises raisons.
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 600;
      const g = cv.getContext('2d');
      g.fillStyle = '#ddd'; g.fillRect(0, 0, 600, 600);
      g.fillStyle = '#1f6b4c'; g.fillRect(200, 90, 160, 380);
      g.fillStyle = '#c9a84c'; g.fillRect(40, 500, 220, 60);
      carrouselVenteFichier = { base64: cv.toDataURL('image/png').split(',')[1], mediaType: 'image/png', nom: 'p.png' };

      const empreinte = async (i) => {
        const blob = await composerSlideCarrousel(i);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let h = 0;
        for (let k = 0; k < buf.length; k++) h = (h * 31 + buf[k]) >>> 0;
        return { taille: buf.length, h };
      };
      const a = await empreinte(0); // plan large
      const b = await empreinte(3); // plan décalé
      const c = await empreinte(5); // plan serré
      const sansProduit = await empreinte(1);
      return { a, b, c, sansProduit, aucuneGeneree: carrouselImages.every(x => x === null) };
    }, { prep: PREPARER(6, IMAGE) });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const cles = [vu.a.h, vu.b.h, vu.c.h];
    assert.equal(new Set(cles).size, 3,
      'REGRESSION : les trois cadrages produisent la même image, le "plan large / serré / décalé" '
      + 'n\'est alors qu\'une promesse de libellé : ' + JSON.stringify(cles));
    assert.notEqual(vu.sansProduit.h, vu.a.h, 'une slide sans produit ne doit évidemment pas ressembler à une slide produit');
    assert.equal(vu.aucuneGeneree, true,
      'REGRESSION : poser la vraie photo ne doit consommer AUCUNE image générée');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un fond choisi par le créateur passe avant la photo produit, et le dit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const p = await page(navigateur, baseUrl);
    const erreursJs = [];
    p.on('pageerror', e => erreursJs.push(e.message));

    const vu = await p.evaluate(({ prep }) => {
      eval(prep);
      const avant = {
        note: noteVisuelSlide(carrouselResultat.slides[0], 0),
        bouton: libelleBoutonFondCarrousel(0).replace(/<[^>]+>/g, '').trim()
      };
      // Le créateur génère un fond pour la couverture : son geste est plus
      // récent et plus intentionnel que notre règle automatique.
      carrouselImages[0] = { apercu: 'data:image/png;base64,' + '__PNG__', blob: null };
      return {
        avant,
        apresCadrage: cadrageProduitSlide(0),
        apresNote: noteVisuelSlide(carrouselResultat.slides[0], 0),
        apresBouton: libelleBoutonFondCarrousel(0).replace(/<[^>]+>/g, '').trim(),
        noteSansProduit: noteVisuelSlide(carrouselResultat.slides[1], 1)
      };
    }, { prep: PREPARER(6, IMAGE) });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(vu.avant.note, /ta photo produit, plan large/,
      'le créateur doit LIRE que cette slide porte sa vraie photo, sinon il croit à un fond généré');
    assert.match(vu.avant.note, /aucun quota/, 'et savoir que ça ne lui coûte rien');
    assert.match(vu.avant.bouton, /Remplacer par un fond généré/,
      '"Générer un fond" laisserait croire qu\'on ajoute, alors qu\'on REMPLACE sa photo');
    assert.equal(vu.apresCadrage, null,
      'REGRESSION : une fois un fond généré posé, la photo produit ne doit plus l\'écraser');
    assert.match(vu.apresNote, /une ambiance 1/, 'la note repasse au visuel décrit');
    assert.match(vu.apresBouton, /Refaire le fond/);
    assert.match(vu.noteSansProduit, /une ambiance 2/, 'une slide sans produit garde sa note normale');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

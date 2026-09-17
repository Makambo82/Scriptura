// Retour du propriétaire, capture comparative à l'appui : « Cinzel n'est pas
// bien visible, ça ne se lit pas bien ». Les empattements de Cinzel
// s'épaississent aux extrémités, et sur le fond doré clair du bouton principal
// avec un texte foncé, les lettres se brouillent. On déchiffrait le bouton au
// lieu de le lire.
//
// Trois variantes comparées en image avant de trancher : Cinzel, Poppins
// minuscules, Poppins MAJUSCULES. Les majuscules l'emportent parce qu'elles
// gardent le registre de l'app, celui des libellés « TON & VOIX ». Poppins en
// minuscules était très lisible mais faisait perdre au bouton principal son
// autorité d'action.
//
// CE QUE CES TESTS VERROUILLENT, et ce sont trois pièges différents :
//   1. les boutons sont bien en Poppins, MESURÉ dans le navigateur et pas lu
//      dans la feuille de style : une règle peut exister et perdre en
//      spécificité contre une autre, auquel cas rien ne change à l'écran ;
//   2. le bouton principal reste en MAJUSCULES : c'est ce qui le distingue
//      d'un champ ordinaire, et c'était l'objet même de la comparaison ;
//   3. MISE À JOUR (refonte visuelle, capture de référence à l'appui) : le
//      point 3 disait que le logo et les libellés de section restaient en
//      Cinzel. Ce n'est plus vrai depuis la refonte : Cinzel est retiré de
//      toute l'app (voir css/style.css, bloc « POLICE DES BOUTONS » et
//      import de police dans index.html, Cinzel n'y est même plus chargé).
//      Les libellés de section passent en Poppins minuscule, comme le reste
//      de l'app. Le bouton principal, lui, reste en MAJUSCULES : c'est une
//      particularité du bouton, pas de l'identité générale, ce test-ci ne
//      change pas.
//   4. MISE À JOUR 2 (nouvelle capture de référence, le mot du logo cette
//      fois) : le mot "Scriptura" du logo a sa PROPRE police, Russo One,
//      identifiée par comparaison visuelle avec la capture fournie (voir
//      css/style.css, règle .logo, import Russo+One dans index.html), en
//      MAJUSCULES. Distincte à la fois de Poppins minuscule (le reste de
//      l'app) et de Poppins MAJUSCULES (les boutons) : le logo est la seule
//      identité visuelle de l'app, elle a le droit de ne ressembler à rien
//      d'autre.
//   5. MISE À JOUR 3 (retour propriétaire) : l'icône S séparée (SVG en
//      dégradé doré) a été retirée des 4 emplacements. Il ne reste plus que
//      le mot SCRIPTURA, avec "URA" en doré (voir .logo em et équivalents).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const familleDe = (v) => String(v || '').split(',')[0].replace(/['"]/g, '').trim();

async function ouvrirFormulaireScript(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(() => {
    unlocked = true;
    chooseMode('script');
    if (typeof showStep === 'function') showStep(2);
  });
  await page.waitForTimeout(400);
  return page;
}

test('les boutons se lisent en Poppins, et le principal garde ses majuscules', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirFormulaireScript(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const lire = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { famille: s.fontFamily, casse: s.textTransform, espacement: s.letterSpacing };
      };
      return { principal: lire('#generateBtn'), retour: lire('.btn-back') };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(vu.principal, 'le bouton principal doit exister');

    // MESURÉ dans le navigateur : une règle peut être écrite et perdre contre
    // une autre plus spécifique, la feuille de style dirait alors une chose et
    // l'écran une autre.
    assert.equal(familleDe(vu.principal.famille), 'Poppins',
      'REGRESSION : le bouton principal n\'est plus rendu en Poppins. Police calculée : '
      + vu.principal.famille + '. Attention, une règle peut exister dans la feuille de style et perdre '
      + 'en spécificité : c\'est le rendu qui compte, pas le CSS écrit.');

    assert.equal(vu.principal.casse, 'uppercase',
      'REGRESSION : le bouton principal est passé en minuscules. C\'est précisément la variante qui a '
      + 'été ÉCARTÉE après comparaison : très lisible, mais le bouton perd son autorité d\'action et se '
      + 'confond avec un champ ordinaire.');

    assert.ok(vu.retour, 'le bouton retour doit exister sur cet écran');
    assert.equal(familleDe(vu.retour.famille), 'Poppins',
      'REGRESSION : le bouton retour n\'est plus en Poppins : ' + vu.retour.famille);
    assert.equal(vu.retour.casse, 'none',
      'REGRESSION : le bouton retour repasse en MAJUSCULES. En capitales espacées, « ← RETOUR » pèse '
      + 'autant qu\'une action principale alors que ce n\'est qu\'un lien de navigation. C\'est le seul '
      + 'bouton que le propriétaire a voulu en minuscules.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'identité de Scriptura tient au mot SCRIPTURA en Russo One, avec URA doré', async () => {
  // Refonte visuelle (captures de référence successives du propriétaire) :
  // Cinzel est retiré de l'app entière (les libellés de champ passent en
  // Poppins minuscule, comme les autres libellés de section), et le mot
  // "Scriptura" du logo a sa PROPRE police, Russo One en majuscules,
  // identifiée par comparaison visuelle avec la capture fournie. L'icône S
  // séparée (SVG en dégradé doré) a ensuite été retirée sur demande du
  // propriétaire : il ne reste que le mot, "URA" en doré.
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirFormulaireScript(navigateur, baseUrl);

    const vu = await page.evaluate(() => {
      const style = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { famille: s.fontFamily, casse: s.textTransform };
      };
      const label = Array.from(document.querySelectorAll('.ctx-label'))
        .find(e => e.offsetParent !== null);
      const logoEl = document.querySelector('.logo');
      const em = logoEl ? logoEl.querySelector('em') : null;
      return {
        logo: style('.logo'),
        pasIcone: !!(logoEl && !logoEl.querySelector('svg')),
        uraColor: em ? getComputedStyle(em).color : null,
        libelle: label ? { famille: getComputedStyle(label).fontFamily, casse: getComputedStyle(label).textTransform } : null
      };
    });

    assert.ok(vu.logo, 'le logo doit exister');
    assert.equal(familleDe(vu.logo.famille), 'Russo One',
      'REGRESSION : le mot "Scriptura" du logo n\'est plus dans sa police dédiée (Russo One, capture de '
      + 'référence à l\'appui). Police calculée : ' + vu.logo.famille);
    assert.equal(vu.logo.casse, 'uppercase',
      'REGRESSION : le mot "Scriptura" du logo n\'est plus rendu en majuscules, comme sur la capture de '
      + 'référence. Casse calculée : ' + vu.logo.casse);
    assert.ok(vu.pasIcone,
      'REGRESSION : une icône SVG est réapparue dans le logo, le propriétaire a explicitement demandé de '
      + 'ne garder que le mot SCRIPTURA.');
    assert.equal(vu.uraColor, 'rgb(250, 148, 16)',
      'REGRESSION : "URA" n\'est plus dans la couleur dorée attendue. Couleur calculée : ' + vu.uraColor);

    if (vu.libelle) {
      assert.equal(familleDe(vu.libelle.famille), 'Poppins',
        'REGRESSION : les libellés de champ (« TON & VOIX », « DURÉE DE LA VIDÉO ») ne sont plus en '
        + 'Poppins. Police calculée : ' + vu.libelle.famille);
      assert.equal(vu.libelle.casse, 'lowercase',
        'REGRESSION : les libellés de champ ne sont plus en minuscules. Casse calculée : ' + vu.libelle.casse);
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('aucun bouton n\'est resté en arrière, sur aucun écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate(async () => { await document.fonts.ready; });

    // BALAYAGE DE TOUS LES BOUTONS VISIBLES, écran par écran, plutôt que de la
    // liste de sélecteurs qu'on croit avoir couverte : c'est justement cette
    // liste-là qui peut être incomplète, et elle l'ÉTAIT. Le bouton
    // « S'abonner » ne portait aucun nom en « btn », il est passé à travers
    // l'inventaire fait à la main et serait resté seul en Cinzel, au-dessus de
    // tous les autres. C'est ce test qui l'a rattrapé.
    //
    // Plusieurs écrans, parce qu'un seul ne prouve rien : les boutons d'un
    // mode ne sont pas ceux d'un autre.
    const ecrans = [
      ['accueil', () => { /* rien à ouvrir */ }],
      ['script', () => { chooseMode('script'); if (typeof showStep === 'function') showStep(2); }],
      ['idées', () => chooseMode('ideas')],
      ['récit', () => chooseMode('story')],
      ['carrousel', () => chooseMode('carrousel')],
      ['historique', () => openHistory()]
    ];

    const restes = [];
    for (const [nom, ouvrir] of ecrans) {
      await page.evaluate((code) => {
        unlocked = true;
        localStorage.setItem('scriptura_code', code);
        localStorage.setItem('scriptura_unlocked', 'true');
        document.body.classList.add('is-unlocked');
        if (typeof goHome === 'function') goHome();
      }, 'CELINE7F2A');
      await page.waitForTimeout(200);
      await page.evaluate('(' + ouvrir.toString() + ')()');
      await page.waitForTimeout(400);
      const trouves = await page.evaluate(() => {
        const dehors = [];
        document.querySelectorAll('button').forEach(b => {
          if (b.offsetParent === null) return;                 // invisible
          const famille = String(getComputedStyle(b).fontFamily || '')
            .split(',')[0].replace(/['"]/g, '').trim();
          if (famille === 'Cinzel') {
            dehors.push((b.className || b.id || b.tagName).toString().slice(0, 40)
              + ' · « ' + (b.textContent || '').trim().slice(0, 26) + ' »');
          }
        });
        return dehors;
      });
      trouves.forEach(t => restes.push(nom + ' → ' + t));
    }

    assert.deepEqual(restes, [],
      'REGRESSION : ces boutons VISIBLES sont encore en Cinzel alors que leurs voisins sont passés en '
      + 'Poppins. Un bouton oublié au milieu des autres se voit tout de suite et fait plus désordre que '
      + 'de n\'avoir rien changé :\n  ' + restes.join('\n  '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

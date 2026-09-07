// Retour du propriétaire : « lorsque l'utilisateur appuie sur le petit œil et
// que le code s'affiche, dès qu'il clique sur le code, ça copie
// automatiquement le code ».
//
// Avant ça, toucher le code AFFICHÉ le refermait. Et c'était le geste le plus
// naturel du monde : on ne regarde pas son code d'accès pour le plaisir, on le
// regarde parce qu'on veut le coller quelque part, donc on tape dessus. Il
// disparaissait. Il fallait rouvrir, viser l'œil, et espérer que la copie du
// premier appui tienne encore dans le presse-papier.
//
// DEUX ZONES, DEUX GESTES, désormais :
//   l'ŒIL masque et démasque, c'est son seul rôle, dans les deux sens ;
//   le CODE affiché se copie au toucher, autant de fois qu'on veut.
// Tant qu'il est masqué, n'importe quelle zone l'affiche ET le copie : à ce
// moment-là, le geste ne peut vouloir dire qu'une seule chose.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'SCRIPTURA-CELINE';

// Le presse-papier est remplacé par un mouchard : c'est la SEULE preuve
// directe qu'une copie a eu lieu. Le retour vert peut exister sans copie, et
// l'inverse aussi ; ne vérifier que la couleur laisserait passer une
// fonctionnalité qui ne copie plus rien.
async function preparer(navigateur, baseUrl, ouvrirTiroir) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate((code) => {
    localStorage.setItem('scriptura_code', code);
    localStorage.setItem('scriptura_unlocked', 'true');
    window._copies = [];
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t) => { window._copies.push(t); return Promise.resolve(); } },
        configurable: true
      });
    } catch (e) { /* le navigateur refuse : le test le dira en ne voyant aucune copie */ }
  }, CODE);
  if (ouvrirTiroir) {
    await page.evaluate(() => { unlocked = true; majBlocCompteSidebar(); openSidebar(); });
    await page.waitForTimeout(350);
  }
  return page;
}

test('menu : le code affiché se copie au toucher, et ne se referme plus tout seul', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await preparer(navigateur, baseUrl, true);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const lire = () => page.evaluate(() => {
      const el = document.getElementById('sidebarCompteCode');
      return {
        texte: el.querySelector('.sc-code-txt').textContent,
        revele: el.getAttribute('data-revele') === '1',
        vert: el.classList.contains('copie-ok'),
        copies: window._copies.slice(),
        titre: el.getAttribute('title') || ''
      };
    });

    const masque = await lire();
    await page.click('#sidebarCompteCodeTxt');
    await page.waitForTimeout(200);
    const premier = await lire();
    await page.click('#sidebarCompteCodeTxt');
    await page.waitForTimeout(200);
    const surLeCode = await lire();
    await page.click('#sidebarCompteCodeIcone');
    await page.waitForTimeout(200);
    const surLOeil = await lire();

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(masque.copies.length, 0, 'rien n\'est copié avant que le créateur ne touche quoi que ce soit');

    assert.equal(premier.revele, true, 'masqué, un appui sur le code l\'affiche');
    assert.deepEqual(premier.copies, [CODE],
      'REGRESSION : le premier appui n\'a rien copié. On ne regarde pas son code pour le plaisir.');

    assert.equal(surLeCode.revele, true,
      'REGRESSION : toucher le code AFFICHÉ le referme. C\'est le geste le plus naturel de tous, et il '
      + 'faisait disparaître ce que le créateur venait justement d\'ouvrir pour le lire.');
    assert.deepEqual(surLeCode.copies, [CODE, CODE],
      'REGRESSION : toucher le code affiché ne le copie pas. Copié : ' + JSON.stringify(surLeCode.copies));
    assert.equal(surLeCode.vert, true, 'et il le DIT, en émeraude, sinon rien ne prouve que la copie a eu lieu');
    assert.match(surLeCode.titre, /copier/i,
      'l\'infobulle doit annoncer les deux gestes, pas seulement le masquage : ' + surLeCode.titre);

    assert.equal(surLOeil.revele, false,
      'REGRESSION : l\'œil ne remasque plus. C\'est devenu son seul rôle, il doit le tenir.');
    assert.deepEqual(surLOeil.copies, [CODE, CODE],
      'REGRESSION : masquer copie aussi. Refermer son code n\'est pas demander à le coller quelque part.');
    assert.equal(surLOeil.vert, false,
      'le vert de la copie n\'a plus de sens sur un code qu\'on vient de refermer');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('fiche d\'abonnement : exactement le même geste', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await preparer(navigateur, baseUrl, false);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await page.evaluate(async () => { unlocked = true; await ouvrirInfosAbonne(); });
    await page.waitForTimeout(250);

    const lire = () => page.evaluate(() => {
      const el = document.getElementById('infosCode');
      return {
        revele: el.getAttribute('data-revele') === '1',
        copies: window._copies.slice()
      };
    });

    await page.click('#infosCode .sc-code-txt');
    await page.waitForTimeout(200);
    const affiche = await lire();
    await page.click('#infosCode .sc-code-txt');
    await page.waitForTimeout(200);
    const recopie = await lire();
    await page.click('#infosCode .sc-code-ico');
    await page.waitForTimeout(200);
    const referme = await lire();

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(affiche.revele, true, 'la fiche s\'ouvre masquée, un appui affiche');
    assert.deepEqual(recopie.copies, [CODE, CODE],
      'REGRESSION : la fiche d\'abonnement ne se comporte pas comme le tiroir. Deux endroits, deux '
      + 'comportements, c\'est exactement ce que la mécanique partagée devait empêcher. Copié : '
      + JSON.stringify(recopie.copies));
    assert.equal(recopie.revele, true, 'et le code reste affiché');
    assert.equal(referme.revele, false, 'l\'œil referme, ici aussi');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

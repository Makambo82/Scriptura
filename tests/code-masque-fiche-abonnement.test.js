// Retour du propriétaire, capture à l'appui : dans la fiche « Ton accès
// Scriptura », celle qui s'ouvre en touchant la bande de l'accueil, son code
// s'affichait EN CLAIR, en gros et en doré, tout en haut. « Au niveau du code
// en haut, qu'on masque le code, que ce soit comme dans la barre latérale. »
//
// Il a raison, et c'est la même raison qu'au menu : le code d'accès est la
// CLÉ du compte, il n'y a pas de mot de passe derrière. Cette fiche s'ouvre
// d'un doigt depuis l'accueil, donc souvent devant quelqu'un, et c'est
// typiquement l'écran qu'on capture pour l'envoyer au support.
//
// UNE SEULE MÉCANIQUE DANS L'APP, jamais deux : la fonction du tiroir a été
// paramétrée par l'élément plutôt que recopiée. Une seconde copie aurait
// divergé au premier ajustement, exactement comme la vérification des
// citations l'avait fait entre le mode Script et le mode Récit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'SCRIPTURA-CELINE';

async function ouvrirFiche(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate((code) => {
    localStorage.setItem('scriptura_code', code);
    localStorage.setItem('scriptura_unlocked', 'true');
  }, CODE);
  return page;
}

test('le code de la fiche d\'abonnement s\'ouvre MASQUÉ, et l\'œil est un interrupteur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirFiche(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(async (code) => {
      unlocked = true;
      await ouvrirInfosAbonne();
      const el = document.getElementById('infosCode');
      if (!el) return { absent: true };
      const lire = () => ({
        texte: el.querySelector('.sc-code-txt').textContent,
        // L'œil BARRÉ dit ce que fera le prochain appui : masquer.
        oeilBarre: /M4 20 20 4/.test(el.querySelector('.sc-code-ico').innerHTML),
        revele: el.getAttribute('data-revele') === '1'
      });
      const masque = lire();
      basculerCodeInfos(null);
      const revele = lire();
      basculerCodeInfos(null);
      const corps = document.getElementById('infosAbonneCorps');
      return { masque, revele, remasque: lire(), htmlFiche: corps ? corps.innerHTML : '' };
    }, CODE);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(!vu.absent, 'la ligne du code doit exister dans la fiche');

    assert.notEqual(vu.masque.texte, CODE,
      'REGRESSION : le code s\'affiche EN CLAIR à l\'ouverture de la fiche. C\'est la clé du compte, sur '
      + 'un écran qu\'on ouvre devant les gens et qu\'on capture pour le support.');
    assert.match(vu.masque.texte, /•/, 'il doit être masqué par des points : ' + vu.masque.texte);
    assert.ok(vu.masque.texte.startsWith('SCR') && vu.masque.texte.endsWith('NE'),
      'le début et la fin restent lisibles, de quoi reconnaître SON code sans le livrer : '
      + vu.masque.texte);
    assert.equal(vu.masque.oeilBarre, false, 'œil normal quand le code est caché');

    assert.equal(vu.revele.texte, CODE,
      'REGRESSION : un appui n\'affiche plus le code. On ne le regarde jamais pour le plaisir, on le '
      + 'regarde pour le coller quelque part.');
    assert.equal(vu.revele.oeilBarre, true,
      'REGRESSION : l\'icône ne change pas. Rien n\'indiquerait qu\'un second appui referme.');

    assert.equal(vu.remasque.texte, vu.masque.texte,
      'REGRESSION : le second appui ne remasque pas. L\'œil doit être un interrupteur, comme dans le '
      + 'tiroir, pas un aller simple.');

    // Le code ne figure dans le HTML que comme data-code, celui que l'œil
    // révélera : jamais posé en clair dans le texte affiché au chargement.
    const enClair = vu.htmlFiche.split('data-code="' + CODE + '"').join('');
    assert.ok(!enClair.includes(CODE),
      'REGRESSION : le code est écrit en clair dans le corps de la fiche. Il suffirait d\'une capture '
      + 'pour le lire, masquage ou pas.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Le garde-fou qui compte vraiment : deux masquages recopiés auraient fini par
// diverger, et l'un des deux aurait cessé de protéger sans que personne ne le
// remarque. C'est exactement ce qui s'est passé avec la vérification des
// citations entre Script et Récit.
test('il n\'existe qu\'UNE mécanique de masquage du code dans toute l\'app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'abonnement.js'), 'utf8');
  const definitions = (src.match(/function masquerCodeAcces\b/g) || []).length;
  assert.equal(definitions, 1,
    'REGRESSION : ' + definitions + ' fonctions de masquage. Une copie finit toujours par diverger de '
    + 'l\'original, et un correctif appliqué d\'un côté manque de l\'autre sans que personne ne le voie.');

  const appliques = (src.match(/function appliquerEtatCode\w*/g) || []);
  assert.equal(appliques.length, 1,
    'REGRESSION : ' + appliques.join(', ') + '. L\'état affiché/masqué doit se poser au même endroit '
    + 'pour le tiroir ET pour la fiche, sinon les deux se mettent à diverger.');
  assert.match(src, /function appliquerEtatCodeSidebar\(revele, racineId\)/,
    'REGRESSION : la fonction n\'est plus paramétrée par l\'élément. Elle ne peut donc plus servir aux '
    + 'deux endroits, et la copie va revenir.');
  assert.match(src, /function basculerCodeInfos/,
    'la fiche doit déléguer au même interrupteur, pas en écrire un second');
});

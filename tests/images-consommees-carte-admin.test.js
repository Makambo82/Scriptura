// Avant de toucher au quota d'images ou au prix du Pro, une seule question
// compte : le plafond est-il seulement approché ? Au PLAFOND, les 100 images
// d'un Pro pèsent 5,00 € sur 15,25 € encaissés, un tiers de l'abonnement. Mais
// un plafond n'est pas une prévision : si un Pro en consomme douze, raboter
// son quota ne ferait que l'agacer sans rien économiser.
//
// LE PIÈGE DE CE GENRE DE TABLEAU, et c'est ce que ces tests verrouillent :
// la MOYENNE ne dit rien du risque. Dix abonnés à 5 images et un seul à 100,
// ça fait une moyenne rassurante de 13 et un compte qui coûte à lui seul plus
// que ce qu'il rapporte. Le maximum doit donc apparaître à côté de la
// moyenne, sinon la carte endort au lieu d'alerter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('la carte additionne montage et carrousel par abonné, et montre le maximum', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      _codesAbonnesAdmin = [
        { code: 'PRO-SAGE', plan: 'pro' },
        { code: 'PRO-GOURMAND', plan: 'pro' },
        { code: 'CREA-UN', plan: 'creator' },
        { code: 'JETON-X', plan: 'jeton' }
      ];
      _imagesUsage = [
        // Un Pro tranquille : 4 + 2 = 6 images.
        { code: 'PRO-SAGE', mode: 'montageImages', used: 4 },
        { code: 'PRO-SAGE', mode: 'carrouselImages', used: 2 },
        // Un Pro qui va au bout : 55 + 35 = 90 sur 100. C'est LUI le sujet.
        { code: 'PRO-GOURMAND', mode: 'montageImages', used: 55 },
        { code: 'PRO-GOURMAND', mode: 'carrouselImages', used: 35 },
        { code: 'CREA-UN', mode: 'montageImages', used: 3 },
        // Un plan jeton : hors comparaison Creator/Pro, ne doit rien fausser.
        { code: 'JETON-X', mode: 'montageImages', used: 40 }
      ];
      const html = carteImagesConsommeesAdmin();
      const div = document.createElement('div');
      div.innerHTML = html;
      return { html, texte: div.textContent };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    // Moyenne Pro = (6 + 90) / 2 = 48 images.
    assert.match(vu.texte, /48[.,]0 images/,
      'REGRESSION : la moyenne Pro ne cumule pas montage ET carrousel par abonné. Un abonné ne paie '
      + 'pas deux abonnements, ses deux budgets sont un seul coût. Vu : ' + vu.texte);

    assert.match(vu.texte, /90 images/,
      'REGRESSION : le plus gros consommateur n\'apparaît pas. C\'est le SEUL chiffre qui dise s\'il '
      + 'existe déjà un abonné à perte ; sans lui la carte endort au lieu d\'alerter.');
    assert.match(vu.texte, /90%/, 'et sa part du plafond doit être dite : ' + vu.texte);
    assert.match(vu.texte, /4,50 €/,
      'REGRESSION : le coût en euros du plus gros consommateur n\'est pas chiffré. 90 images à 0,05 € '
      + 'font 4,50 €, et c\'est ça qu\'on compare au prix de l\'abonnement. Vu : ' + vu.texte);
    assert.match(vu.texte, /30% de son abonnement/,
      'REGRESSION : la part de l\'abonnement mangée par les images n\'est pas dite. 4,50 € sur 15,25 € '
      + 'font 30%, c\'est LE chiffre de la décision. Vu : ' + vu.texte);

    assert.match(vu.texte, /Creator/, 'le Creator doit avoir son bloc');
    assert.doesNotMatch(vu.texte, /JETON-X/, 'les plans jeton restent hors de la comparaison');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('sans aucune donnée, la carte disparaît au lieu d\'afficher des zéros', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const vide = await page.evaluate(() => {
      _imagesUsage = [];
      return carteImagesConsommeesAdmin();
    });
    // Même choix que carteErreursAdmin et cartePassesAdmin : une carte vide en
    // permanence prend de la place et n'apprend rien. Et surtout, « 0 image en
    // moyenne » se lirait comme « personne n'en consomme », alors que ça veut
    // seulement dire que la mesure n'a encore rien vu.
    assert.equal(vide, '',
      'REGRESSION : la carte s\'affiche sans donnée. Des zéros se lisent comme un constat, alors '
      + 'qu\'ils ne disent que l\'absence de mesure, et c\'est exactement sur cette confusion qu\'on '
      + 'prendrait une mauvaise décision de tarif.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

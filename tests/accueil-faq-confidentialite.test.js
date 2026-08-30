// Point 2 de l'audit du parcours d'achat : le diagnostic demande un
// @nom d'utilisateur ou des captures de statistiques privées, un créateur
// prudent se demande où partent ces données et si c'est supprimable. Ajout
// d'une question dans la FAQ, juste après "Comment fonctionne le diagnostic
// TikTok ?", avec une réponse fidèle au fonctionnement réel : les captures
// (voir api/audit.js) sont envoyées à l'IA le temps de l'analyse, jamais
// écrites sur disque ni dans la base ; seul le résultat (le diagnostic
// texte) est enregistré comme une génération normale, donc supprimable
// depuis "Mes générations" (voir deleteGenerations, js/historique.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

test('FAQ : question sur la confidentialité des captures, juste après le diagnostic TikTok', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const resultat = await page.evaluate(() => {
      const sommaires = Array.from(document.querySelectorAll('.faq-item summary')).map(s => s.textContent.replace('▾', '').trim());
      const idxDiag = sommaires.indexOf('Comment fonctionne le diagnostic TikTok ?');
      const idxConf = sommaires.indexOf('Mes captures et mes données sont-elles en sécurité ?');
      const item = Array.from(document.querySelectorAll('.faq-item')).find(d => d.querySelector('summary').textContent.includes('sécurité'));
      return { idxDiag, idxConf, reponse: item ? item.querySelector('.faq-a').textContent : '' };
    });

    assert.ok(resultat.idxConf >= 0, 'la question de confidentialité doit exister dans la FAQ');
    assert.equal(resultat.idxConf, resultat.idxDiag + 1, 'elle doit suivre directement "Comment fonctionne le diagnostic TikTok ?"');
    assert.ok(/jamais stockées/.test(resultat.reponse), 'doit préciser que les captures ne sont pas conservées : ' + resultat.reponse);
    assert.ok(/supprimer.*Mes générations/.test(resultat.reponse), 'doit indiquer que le résultat est supprimable depuis "Mes générations" : ' + resultat.reponse);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

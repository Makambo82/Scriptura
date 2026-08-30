// Retour du propriétaire (point 3 de l'audit du parcours d'achat) : le
// paiement Mobile Money via WhatsApp est moins rassurant qu'un paiement
// automatisé par carte pour un visiteur exigeant. Précision du délai réel
// ("quelques minutes", confirmé par le propriétaire) aux 3 endroits où
// l'abonné hésite juste avant de payer : le paywall, la fenêtre de choix
// des plans, et la FAQ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');

test('délai du code d\'accès WhatsApp visible au paywall, dans la fenêtre de plans, et dans la FAQ', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    await page.evaluate(() => document.getElementById('paywall').classList.add('active'));
    await page.waitForTimeout(100);
    const paywallDelai = await page.evaluate(() => document.querySelector('#paywall .wa-delai')?.textContent || '');
    assert.ok(/quelques minutes/.test(paywallDelai), 'le paywall doit préciser le délai : ' + paywallDelai);

    await page.evaluate(() => { document.getElementById('paywall').classList.remove('active'); openPlans('abonnement'); });
    await page.waitForTimeout(100);
    const plansDelai = await page.evaluate(() => document.querySelector('#plansOverlay .wa-delai')?.textContent || '');
    assert.ok(/quelques minutes/.test(plansDelai), 'la fenêtre de plans doit préciser le délai : ' + plansDelai);

    const faqTexte = await page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('.faq-item')).find(d => d.querySelector('summary')?.textContent.includes('Comment fonctionne'));
      return item ? item.querySelector('.faq-a').textContent : '';
    });
    assert.ok(/quelques minutes/.test(faqTexte), 'la FAQ doit préciser le délai : ' + faqTexte);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Audit du 2 septembre 2026 : la bannière "ton abonnement expire dans..."
// mémorisait sa fermeture pour la journée SANS distinguer le compte
// (cleNotifCompteJour, js/abonnement.js). Sur un appareil partagé où
// plusieurs codes sont utilisés le même jour (bascule rapide de compte,
// voir js/auth.js), fermer la bannière pour un compte la masquait aussi
// pour tout autre compte, y compris une vraie alerte jamais vue par lui.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('Bannière compte : fermer l\'alerte pour un compte ne masque pas la même alerte pour un autre compte le même jour', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    const dansTroisJours = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    // Compte A : abonnement expire dans 3 jours, la bannière doit apparaître
    // puis rester fermée pour LUI après un clic.
    const etatCompteA = await page.evaluate(async (expire) => {
      localStorage.setItem('scriptura_code', 'CODE-COMPTE-A');
      localStorage.setItem('scriptura_expire', expire);
      unlocked = true;
      await verifierNotifCompte();
      const visibleAvant = document.getElementById('notifCompteBar').classList.contains('visible');
      fermerNotifCompte();
      const visibleApresFermeture = document.getElementById('notifCompteBar').classList.contains('visible');
      return { visibleAvant, visibleApresFermeture };
    }, dansTroisJours);
    assert.equal(etatCompteA.visibleAvant, true, 'la bannière doit apparaître pour un abonnement qui expire dans 3 jours');
    assert.equal(etatCompteA.visibleApresFermeture, false, 'la bannière doit disparaître après la fermeture');

    // Compte B, même appareil, même jour, même situation d'expiration :
    // la bannière doit réapparaître, PAS rester masquée à cause de la
    // fermeture du compte A.
    const etatCompteB = await page.evaluate(async (expire) => {
      localStorage.setItem('scriptura_code', 'CODE-COMPTE-B');
      localStorage.setItem('scriptura_expire', expire);
      document.getElementById('notifCompteBar').classList.remove('visible'); // état avant re-vérification
      await verifierNotifCompte();
      return document.getElementById('notifCompteBar').classList.contains('visible');
    }, dansTroisJours);
    assert.equal(etatCompteB, true, 'un autre compte, sur le même appareil et le même jour, doit voir SA PROPRE alerte, pas hériter de la fermeture du compte A');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

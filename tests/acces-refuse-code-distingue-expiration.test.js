// Audit du 2 septembre 2026 : un refus 403 (compte désactivé, accès jamais
// accordé...) autre qu'une vraie expiration d'abonnement déclenchait quand
// même gererAbonnementExpire() côté client (_outilsGererErreurReponse,
// js/tiktok-outils.js ; même correctif appliqué à js/api.js et js/audit.js).
// Ça déconnectait l'abonné localement et affichait "ton abonnement a
// expiré, renouvelle" pour une raison qui n'a rien à voir. Le serveur
// distingue désormais le code ABONNEMENT_EXPIRE des autres refus
// (codeAccesRefuse, api/_lib/acces.js) : ce test vérifie que SEUL ce code
// précis déclenche la déconnexion locale.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('_outilsGererErreurReponse : seul le code ABONNEMENT_EXPIRE déconnecte l\'abonné, pas un autre refus 403', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    await page.evaluate(() => {
      unlocked = true;
      localStorage.setItem('scriptura_unlocked', 'true');
    });

    // 1) Compte désactivé (raison différente d'une expiration) : ne doit
    // JAMAIS déconnecter localement ni afficher le message d'expiration.
    const apresCompteDesactive = await page.evaluate(async () => {
      const faux = { status: 403, json: async () => ({ error: { message: 'Accès refusé : compte désactivé', code: 'ACCES_REFUSE' } }) };
      let messageErreur = null;
      try { await _outilsGererErreurReponse(faux); } catch (e) { messageErreur = e.message; }
      return { unlockedApres: unlocked, messageErreur };
    });
    assert.equal(apresCompteDesactive.unlockedApres, true, 'un refus "compte désactivé" ne doit pas déconnecter localement l\'abonné');
    assert.equal(apresCompteDesactive.messageErreur, 'Accès refusé : compte désactivé', 'le vrai message serveur doit remonter, pas un message générique trompeur');

    // 2) Vraie expiration : doit déconnecter et afficher le bon message.
    const apresExpiration = await page.evaluate(async () => {
      const faux = { status: 403, json: async () => ({ error: { message: 'Accès refusé : abonnement expiré', code: 'ABONNEMENT_EXPIRE' } }) };
      let messageErreur = null;
      try { await _outilsGererErreurReponse(faux); } catch (e) { messageErreur = e.message; }
      return { unlockedApres: unlocked, messageErreur };
    });
    assert.equal(apresExpiration.unlockedApres, false, 'une vraie expiration doit déconnecter localement l\'abonné');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

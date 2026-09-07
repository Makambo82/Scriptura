// Demande du propriétaire : « pour tous les abonnés y compris le fondateur,
// chaque lundi la salutation doit être Heureuse semaine [Prénom], et cela
// toute la journée du lundi ».
//
// Le lundi tombait jusqu'ici dans le groupe des jours ordinaires, donc
// « Bonjour » le matin et « Bonsoir » le soir, comme un mardi. Or c'est le
// jour où l'on souhaite une bonne semaine, et une seule fois : le lundi soir,
// « Bonsoir » ne dit plus rien de particulier.
//
// CE QUE CES TESTS VERROUILLENT VRAIMENT, et c'est le piège de toute règle
// « toute la journée » : elle doit tenir à 00h00 comme à 23h59. Une règle
// posée au mauvais endroit (après la lecture de l'heure, par exemple) donne
// « Heureuse semaine » le matin et « Bonsoir » le soir, et personne ne le voit
// avant un lundi soir.
//
// Les jours voisins sont testés AUSSI : c'est la seule façon de savoir qu'on
// a ajouté un cas sans en écraser un autre. Une condition trop large
// (jour <= 1) aurait avalé le dimanche et supprimé « Bon week-end » sans que
// le test du lundi, lui, ne bronche.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'CELINE7F2A';   // format standard : prénom + 4 caractères

// Le temps est FIGÉ dans la page avant d'appeler la salutation : sans ça, le
// test dirait seulement ce qu'il se trouve être aujourd'hui, et passerait ou
// tomberait selon le jour où on le lance.
async function salutationAu(page, isoLocal) {
  return page.evaluate((iso) => {
    const VraieDate = Date;
    const fige = new VraieDate(iso);
    // eslint-disable-next-line no-global-assign
    Date = class extends VraieDate {
      constructor(...args) {
        if (!args.length) return new VraieDate(fige.getTime());
        return new VraieDate(...args);
      }
      static now() { return fige.getTime(); }
    };
    try {
      return salutationAccueil();
    } finally {
      // eslint-disable-next-line no-global-assign
      Date = VraieDate;
    }
  }, isoLocal);
}

test('lundi : « Heureuse semaine » du premier au dernier instant de la journée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.evaluate((c) => { localStorage.setItem('scriptura_code', c); }, CODE);

    // 2026-09-07 est un lundi. Heures locales, comme les lit getDay/getHours.
    const minuit = await salutationAu(page, '2026-09-07T00:00:00');
    const matin = await salutationAu(page, '2026-09-07T08:30:00');
    const apresMidi = await salutationAu(page, '2026-09-07T14:00:00');
    const soir = await salutationAu(page, '2026-09-07T23:59:00');

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    for (const [quand, texte] of [['minuit', minuit], ['le matin', matin],
      ['l\'après-midi', apresMidi], ['le soir', soir]]) {
      assert.match(texte, /Heureuse semaine/,
        'REGRESSION : lundi ' + quand + ', la salutation n\'est pas « Heureuse semaine ». La règle doit '
        + 'valoir TOUTE la journée : posée au mauvais endroit, elle donne « Heureuse semaine » le matin '
        + 'et « Bonsoir » le soir, et personne ne le voit avant un lundi soir. Vu : ' + texte);
    }

    assert.match(matin, /Heureuse semaine Celine/,
      'REGRESSION : le prénom ne suit plus la salutation. Il vient du code d\'accès et vaut pour tout '
      + 'le monde, fondateur compris. Vu : ' + matin);
    assert.doesNotMatch(soir, /Bonsoir/,
      'REGRESSION : « Bonsoir » revient le lundi soir. Vu : ' + soir);
    assert.doesNotMatch(matin, /Bonjour/,
      'REGRESSION : « Bonjour » revient le lundi matin. Vu : ' + matin);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les autres jours ne sont pas écrasés au passage', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.evaluate((c) => { localStorage.setItem('scriptura_code', c); }, CODE);

    // Semaine du 6 au 13 septembre 2026 : dimanche 6, lundi 7, mardi 8,
    // vendredi 11, samedi 12.
    const dimanche = await salutationAu(page, '2026-09-06T10:00:00');
    const mardiMatin = await salutationAu(page, '2026-09-08T08:00:00');
    const mardiMidi = await salutationAu(page, '2026-09-08T14:00:00');
    const mardiSoir = await salutationAu(page, '2026-09-08T20:00:00');
    const vendredi = await salutationAu(page, '2026-09-11T09:00:00');
    const samedi = await salutationAu(page, '2026-09-12T09:00:00');

    // Le voisin de gauche du lundi : une condition trop large l'aurait avalé.
    assert.match(dimanche, /Bon week-end/,
      'REGRESSION : le dimanche a perdu son « Bon week-end ». Une condition trop large sur le lundi '
      + '(jour <= 1) avale le dimanche, et le test du lundi ne bronche pas. Vu : ' + dimanche);

    // Le voisin de droite : le mardi doit RETROUVER les trois tranches
    // horaires que le lundi vient de quitter.
    assert.match(mardiMatin, /Bonjour/, 'le mardi matin reste « Bonjour » : ' + mardiMatin);
    assert.match(mardiMidi, /Bon après-midi/, 'le mardi après-midi est inchangé : ' + mardiMidi);
    assert.match(mardiSoir, /Bonsoir/,
      'REGRESSION : les tranches horaires ont disparu pour tous les jours ordinaires, pas seulement '
      + 'pour le lundi. Vu : ' + mardiSoir);
    assert.doesNotMatch(mardiMatin, /Heureuse semaine/,
      'REGRESSION : « Heureuse semaine » déborde sur le mardi. Elle ne se souhaite qu\'une fois, le '
      + 'jour où la semaine commence. Vu : ' + mardiMatin);

    assert.match(vendredi, /Bon vendredi/, 'le vendredi est inchangé : ' + vendredi);
    assert.match(samedi, /Bon week-end/, 'le samedi est inchangé : ' + samedi);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

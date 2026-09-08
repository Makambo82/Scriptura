// Retour du propriétaire : « “abonné creator”, “abonné pro” et “fondateur”
// selon le cas, et de même “aucun compte requis • 5 générations offertes”, en
// majuscules à la même taille que l'image » — la même référence que les
// boutons des modes.
//
// POURQUOI CES DEUX-LÀ AVAIENT ÉTÉ OUBLIÉS : ce ne sont pas des boutons. La
// pastille dit un ÉTAT (qui je suis), la ligne gratuite une PROMESSE. Elles
// étaient donc hors du périmètre de l'unification précédente, alors que ce
// sont les deux premières choses qu'on lit, juste au-dessus du bouton
// principal, et les seules à ne pas parler la même langue que lui.
//
// LE TEST COMPARE À UN BOUTON RÉEL, pris sur la même page, jamais à « 9.92px »
// écrit en dur. Le jour où la référence changera, ces deux-là devront suivre
// toutes seules, et c'est ce test qui le dira.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const lire = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const s = getComputedStyle(el);
  return { txt: el.textContent.trim(), px: s.fontSize, esp: s.letterSpacing, casse: s.textTransform };
};

async function ouvrirApp(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(async () => { await document.fonts.ready; });
  return page;
}

test('la pastille d\'abonné s\'écrit comme les boutons des modes', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const vu = await page.evaluate((srcLire) => {
      const lire = eval('(' + srcLire + ')');
      unlocked = true;
      localStorage.setItem('scriptura_code', 'CELINE7F2A');
      localStorage.setItem('scriptura_unlocked', 'true');
      document.body.classList.add('is-unlocked');
      if (typeof goHome === 'function') goHome();
      chooseMode('ideas');
      if (typeof renderGenCounter === 'function') renderGenCounter();
      return {
        pastille: lire('.gen-counter .abonne-badge'),
        etoile: lire('.gen-counter .abonne-star'),
        // La RÉFÉRENCE, mesurée sur la même page : un vrai bouton de mode.
        reference: lire('.grid-btn')
      };
    }, lire.toString());

    assert.ok(vu.reference, 'REGRESSION : aucun bouton de mode trouvé pour servir de référence. '
      + 'Ce test ne compare plus rien, en restant vert.');
    assert.ok(vu.pastille, 'REGRESSION : la pastille d\'abonné a disparu du bandeau de '
      + 'générations. C\'est elle qui distingue un abonné d\'un visiteur.');

    assert.equal(vu.pastille.casse, 'uppercase',
      'REGRESSION : la pastille n\'est plus en capitales. Vu : « ' + vu.pastille.txt + ' », casse '
      + vu.pastille.casse);

    assert.equal(vu.pastille.px, vu.reference.px,
      'REGRESSION : la pastille d\'abonné (' + vu.pastille.px + ') n\'a plus la taille des boutons '
      + 'des modes (' + vu.reference.px + '). Elle est posée juste au-dessus d\'eux : une taille à '
      + 'elle seule se voit immédiatement.');
    assert.equal(vu.pastille.esp, vu.reference.esp,
      'REGRESSION : la pastille n\'a plus l\'espacement des boutons (' + vu.pastille.esp
      + ' contre ' + vu.reference.esp + '). Une taille commune ne suffit pas à faire se '
      + 'ressembler deux textes.');

    // L'étoile a sa propre taille, et c'est le piège : réduire le libellé sans
    // la réduire l'aurait rendue plus grosse que le mot qu'elle accompagne.
    // Elle reste légèrement au-dessus, comme avant, jamais très au-dessus.
    const ecart = parseFloat(vu.etoile.px) - parseFloat(vu.pastille.px);
    assert.ok(ecart >= 0 && ecart <= 0.6,
      'REGRESSION : l\'étoile de la pastille fait ' + vu.etoile.px + ' pour un libellé à '
      + vu.pastille.px + '. Elle a sa taille à elle : en réduisant le texte sans la réduire, elle '
      + 'devient plus grosse que le mot qu\'elle accompagne et attire l\'œil à sa place.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les trois libellés de pastille passent bien en capitales', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    // Les trois cas nommés par le propriétaire. On vérifie le RENDU, pas le
    // texte source : c'est le CSS qui met en capitales, et le libellé reste
    // écrit normalement dans le code (js/abonnement.js).
    const vu = await page.evaluate(() => {
      const out = [];
      const badge = document.createElement('span');
      badge.className = 'abonne-badge';
      document.body.appendChild(badge);
      for (const libelle of ['Abonné Creator', 'Abonné Pro', 'Fondateur']) {
        badge.textContent = libelle;
        const s = getComputedStyle(badge);
        // Ce que l'écran affiche réellement pour ce libellé.
        out.push({ source: libelle, casse: s.textTransform, rendu: s.textTransform === 'uppercase'
          ? libelle.toUpperCase() : libelle });
      }
      badge.remove();
      return out;
    });

    for (const c of vu) {
      assert.equal(c.casse, 'uppercase',
        'REGRESSION : « ' + c.source +' » ne s\'affiche pas en capitales. Le propriétaire a nommé '
        + 'les trois cas explicitement : Abonné Creator, Abonné Pro, Fondateur.');
    }
    assert.deepEqual(vu.map(c => c.rendu),
      ['ABONNÉ CREATOR', 'ABONNÉ PRO', 'FONDATEUR'],
      'et les trois se lisent bien ainsi : ' + vu.map(c => c.rendu).join(', '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la ligne « aucun compte requis » s\'écrit comme les boutons', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    // Mesure de la référence dans un mode, puis retour à l'accueil pour la
    // ligne gratuite : elle ne vit que là.
    const reference = await page.evaluate((srcLire) => {
      const lire = eval('(' + srcLire + ')');
      unlocked = true;
      document.body.classList.add('is-unlocked');
      chooseMode('ideas');
      return lire('.grid-btn');
    }, lire.toString());

    const vu = await page.evaluate((srcLire) => {
      const lire = eval('(' + srcLire + ')');
      if (typeof goHome === 'function') goHome();
      unlocked = false;
      document.body.classList.remove('is-unlocked');
      if (typeof renderGenCounter === 'function') renderGenCounter();
      return lire('#heroFree');
    }, lire.toString());

    assert.ok(reference, 'REGRESSION : aucun bouton de mode pour servir de référence.');
    assert.ok(vu, 'REGRESSION : la ligne « aucun compte requis » a disparu de l\'accueil. C\'est '
      + 'elle qui lève la première objection d\'un visiteur : faut-il créer un compte.');

    assert.equal(vu.casse, 'uppercase',
      'REGRESSION : la ligne gratuite n\'est plus en capitales. Vu : « ' + vu.txt + ' »');
    assert.equal(vu.px, reference.px,
      'REGRESSION : la ligne gratuite (' + vu.px + ') n\'a plus la taille de référence ('
      + reference.px + '). Elle est posée juste sous le bouton principal de l\'accueil.');
    assert.equal(vu.esp, reference.esp,
      'REGRESSION : la ligne gratuite n\'a plus l\'espacement de référence (' + vu.esp
      + ' contre ' + reference.esp + ').');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

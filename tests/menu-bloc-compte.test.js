// Demande du propriétaire : « Je veux qu'on mette le plan de l'utilisateur et
// son code quelque part dans le menu latéral. »
//
// En préparant les rendus, un VRAI BUG est sorti, présent en ligne. Le menu du
// tiroir est une balise <nav>, il héritait donc de la règle générale `nav{}`
// (la barre du haut du site) : position:fixed en haut à gauche de l'écran.
// La liste se posait par-dessus l'en-tête du tiroir, le logo et la croix de
// fermeture passaient dessous, et un doigt au centre de la croix atteignait
// « Mes générations ». Autrement dit : vouloir fermer le menu ouvrait
// l'historique. Ce test le verrouille en visant la croix comme un doigt, pas
// en lisant une règle CSS.
//
// Sur le bloc lui-même, le choix du propriétaire est le code MASQUÉ, révélé
// sur geste. Le code est la clé du compte, il n'y a pas de mot de passe
// derrière, et un menu s'ouvre souvent devant quelqu'un.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const CODE = 'SCRK7B9M42';

async function ouvrir(navigateur, baseUrl, abonne) {
  const page = await navigateur.newPage({ viewport: { width: 390, height: 844 } });
  await poserMocksReseau(page);
  await page.addInitScript((c) => {
    if (c) {
      localStorage.setItem('scriptura_code', c);
      localStorage.setItem('scriptura_unlocked', 'true');
      localStorage.setItem('scriptura_plan', 'pro');
    }
  }, abonne ? CODE : '');
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(() => { openSidebar(); });
  await page.waitForTimeout(500);
  return page;
}

test('la croix ferme vraiment le menu, elle n\'est plus recouverte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, true);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vise = await page.evaluate(() => {
      const croix = document.querySelector('.sidebar-close');
      const r = croix.getBoundingClientRect();
      const sous = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const logo = document.querySelector('.sidebar-logo').getBoundingClientRect();
      const sousLogo = document.elementFromPoint(logo.left + 6, logo.top + logo.height / 2);
      return {
        croixAtteinte: !!sous && (sous === croix || croix.contains(sous)),
        quoi: sous ? (sous.className.baseVal || sous.className || sous.tagName) : 'rien',
        logoDegage: !!sousLogo && !sousLogo.closest('.sidebar-nav'),
        navPosition: getComputedStyle(document.querySelector('.sidebar-nav')).position
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vise.navPosition, 'static',
      'REGRESSION : le menu du tiroir reprend le position:fixed de la barre du haut.');
    assert.equal(vise.croixAtteinte, true,
      'REGRESSION : un doigt au centre de la croix atteint « ' + vise.quoi + ' » et pas la croix. '
      + 'Fermer le menu déclencherait autre chose.');
    assert.equal(vise.logoDegage, true, 'REGRESSION : le logo du tiroir est recouvert par la liste');

    // Et elle ferme pour de vrai, pas seulement « elle est atteignable ».
    await page.click('.sidebar-close');
    await page.waitForTimeout(500);
    const ferme = await page.evaluate(
      () => !document.getElementById('sidebar').classList.contains('active'));
    assert.equal(ferme, true, 'REGRESSION : le clic sur la croix ne ferme pas le menu');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un abonné voit son offre, et son code MASQUÉ', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, true);

    const vu = await page.evaluate(() => {
      const bloc = document.getElementById('sidebarCompte');
      const code = document.getElementById('sidebarCompteCode');
      const r = bloc.getBoundingClientRect();
      const nav = document.querySelector('.sidebar-nav').getBoundingClientRect();
      return {
        visible: getComputedStyle(bloc).display !== 'none',
        offre: document.getElementById('sidebarCompteOffre').textContent.trim(),
        codeAffiche: document.getElementById('sidebarCompteCodeTxt').textContent.trim(),
        avantLaListe: r.top < nav.top,
        aUneIcone: !!code.querySelector('svg')
      };
    });

    assert.equal(vu.visible, true, 'le bloc compte doit être visible pour un abonné');
    assert.equal(vu.offre, 'Plan Pro', 'l\'offre lue doit être celle du compte');
    assert.equal(vu.avantLaListe, true, 'le bloc se place entre le logo et la liste');
    assert.equal(vu.aUneIcone, true, 'l\'œil indique que le code peut être révélé');
    assert.ok(vu.codeAffiche.includes('•'),
      'REGRESSION : le code est affiché en clair dès l\'ouverture du menu (« '
      + vu.codeAffiche + ' »). C\'est la clé du compte, elle ne s\'affiche que sur geste.');
    assert.notEqual(vu.codeAffiche, 'SCRK7B9M42', 'le code complet ne doit pas être lisible');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour du propriétaire : « quand le code apparaît, si on reclique sur le
// petit œil le code doit se masquer ». C'est juste, un œil est un
// interrupteur : s'il n'agit que dans un sens, on affiche son code sans
// pouvoir le refermer autrement qu'en quittant le menu.
test('l\'œil est un interrupteur : il affiche, puis il remasque', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, true);

    const lire = () => page.evaluate(() => {
      const el = document.getElementById('sidebarCompteCode');
      return {
        code: document.getElementById('sidebarCompteCodeTxt').textContent.trim(),
        icone: document.getElementById('sidebarCompteCodeIcone').innerHTML,
        titre: el.getAttribute('title') || '',
        infosOuvertes: document.getElementById('infosAbonneOverlay').classList.contains('active')
      };
    });

    const ferme = await lire();
    await page.click('#sidebarCompteCode');
    await page.waitForTimeout(300);
    const revele = await lire();

    assert.equal(revele.code, CODE, 'le premier appui doit afficher le code complet');
    assert.ok(revele.icone.includes('<svg'),
      'REGRESSION : afficher le code efface l\'icône (le texte a écrasé le SVG)');
    assert.notEqual(revele.icone, ferme.icone,
      'REGRESSION : l\'icône ne change pas. Elle doit dire ce que fera le prochain appui.');
    assert.match(revele.titre, /masquer/i, 'l\'infobulle doit annoncer le masquage');
    assert.equal(revele.infosOuvertes, false,
      'REGRESSION : le clic remonte au bloc et ouvre la fenêtre d\'infos par-dessus');

    // Le deuxième appui doit refermer, c'est tout l'objet de la demande.
    await page.click('#sidebarCompteCode');
    await page.waitForTimeout(300);
    const rereferme = await lire();
    assert.ok(rereferme.code.includes('•'),
      'REGRESSION : un deuxième appui sur l\'œil ne remasque pas le code (« '
      + rereferme.code +' »). L\'œil doit fonctionner dans les deux sens.');
    assert.equal(rereferme.icone, ferme.icone, 'l\'icône doit revenir à son état de départ');
    assert.match(rereferme.titre, /afficher/i, 'l\'infobulle doit redevenir celle de l\'affichage');

    // Et un troisième appui rouvre : la bascule n'est pas à usage unique.
    await page.click('#sidebarCompteCode');
    await page.waitForTimeout(300);
    assert.equal((await lire()).code, CODE, 'REGRESSION : la bascule ne fonctionne qu\'une fois');

    await page.evaluate(() => { closeSidebar(); });
    await page.waitForTimeout(300);
    const apres = await page.evaluate(
      () => document.getElementById('sidebarCompteCodeTxt').textContent.trim());
    assert.ok(apres.includes('•'),
      'REGRESSION : le code reste en clair après fermeture (« ' + apres + ' »). '
      + 'Le masquage ne protégerait plus rien dès la deuxième ouverture.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un non-abonné y lit où il en est, sans ligne de code vide', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl, false);

    const vu = await page.evaluate(() => ({
      visible: getComputedStyle(document.getElementById('sidebarCompte')).display !== 'none',
      offre: document.getElementById('sidebarCompteOffre').textContent.trim(),
      ligne2: document.getElementById('sidebarCompteLigne2').textContent.trim(),
      champCode: !!document.getElementById('sidebarCompteCode')
    }));

    assert.equal(vu.visible, true, 'le bloc sert aussi au non-abonné');
    assert.equal(vu.offre, 'Plan gratuit', 'il doit lire son offre réelle');
    assert.equal(vu.champCode, false,
      'REGRESSION : une ligne de code s\'affiche alors qu\'un non-abonné n\'en a pas');
    assert.match(vu.ligne2, /génération/,
      'REGRESSION : à la place du code, il doit lire son décompte, pas une ligne vide');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

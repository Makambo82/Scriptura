// Retour propriétaire sur le formulaire du mode Idées : "qu'est-ce qui est
// superflu qu'on peut enlever ?".
//
// Vérification faite champ par champ : AUCUN n'est décoratif, les sept
// injectent tous une instruction réelle et distincte dans le prompt (codes de
// hooks propres à la plateforme, nature des angles selon l'objectif, et un bloc
// de contrainte entier pour la zone géographique). Supprimer un champ, c'est
// supprimer une capacité.
//
// En revanche QUATRE sont optionnels, et le code le dit lui-même : chacun a son
// repli explicite dans le prompt ("aucune plateforme précisée, reste
// généraliste"). Le superflu n'était donc pas dans les champs mais dans le fait
// de tous les montrer d'emblée : sept blocs pour une intention simple. Ils sont
// désormais repliés derrière un "Affiner".
//
// PRÉCISION DU PROPRIÉTAIRE APRÈS COUP, et c'est ce que ces tests verrouillent
// désormais : le panneau doit rester FERMÉ, sans exception, et se trouver TOUT
// EN BAS du formulaire.
// Une première version l'ouvrait toute seule quand la zone géographique
// devenait obligatoire ou quand la mémoire du créateur avait pré-rempli un
// champ. Sur son usage réel (niche Histoire, ton déjà mémorisé), les deux
// conditions étaient vraies en permanence : les quatre champs revenaient à
// l'écran à chaque fois, ce qui annulait tout l'intérêt du repli.
//
// Le vrai piège demeure : la ZONE GÉOGRAPHIQUE est OBLIGATOIRE pour cinq niches
// et bloque la génération si elle manque. Le filet est donc devenu RÉACTIF
// plutôt que préventif : le bouton signale qu'elle est attendue, et une
// tentative de génération sans elle ouvre le panneau et y emmène le créateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

async function ouvrirIdees(page, baseUrl) {
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'IDEES' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('ideasFlow').style.display = 'block';
    restartIdeas();
  });
  await page.waitForTimeout(150);
}

const etat = () => {
  const panneau = document.getElementById('ideaAffiner');
  const btn = document.getElementById('ideaAffinerBtn');
  const visible = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return {
    replie: !!panneau && panneau.hidden,
    aria: btn ? btn.getAttribute('aria-expanded') : null,
    // Ce qui doit rester visible en permanence.
    niche: visible('ideaNiche'),
    objectif: visible('ideaGoalGrid'),
    sujet: visible('ideaTheme'),
    bouton: visible('ideaGenerateBtn'),
    // Ce qui se replie.
    audience: visible('ideaAudience'),
    geo: visible('ideaGeo'),
    plateforme: visible('ideaPlatformGrid'),
    ton: visible('ideaTone')
  };
};

test('replié par défaut : seuls la niche, l\'objectif et le sujet restent à l\'écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirIdees(page, baseUrl);

    const vu = await page.evaluate(etat);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.replie, true, 'les quatre optionnels sont repliés au départ');
    assert.equal(vu.aria, 'false');
    assert.ok(vu.niche && vu.objectif && vu.sujet && vu.bouton, 'l\'essentiel reste visible');
    assert.ok(!vu.audience && !vu.geo && !vu.plateforme && !vu.ton, 'les quatre optionnels sont bien masqués');

    // Et ils reviennent d'un appui, sans rien perdre.
    await page.evaluate(() => document.getElementById('ideaAffinerBtn').click());
    await page.waitForTimeout(200);
    const ouvert = await page.evaluate(etat);
    assert.equal(ouvert.replie, false);
    assert.equal(ouvert.aria, 'true');
    assert.ok(ouvert.audience && ouvert.geo && ouvert.plateforme && ouvert.ton,
      'les quatre champs sont toujours là, aucune capacité supprimée');

    // Un second appui referme.
    await page.evaluate(() => document.getElementById('ideaAffinerBtn').click());
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(etat)).replie, true);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une niche qui exige la zone géographique NE force PAS l\'ouverture, elle la signale', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirIdees(page, baseUrl);

    await page.evaluate(() => {
      const sel = document.getElementById('ideaNiche');
      sel.value = 'Histoire'; // rend la zone géographique obligatoire
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(250);

    const vu = await page.evaluate(() => ({
      replie: document.getElementById('ideaAffiner').hidden,
      libelle: document.getElementById('ideaAffinerBtn').textContent.replace(/\s+/g, ' ').trim(),
      marque: document.getElementById('ideaAffinerBtn').classList.contains('affiner-requis')
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.replie, true,
      'REGRESSION : une ouverture automatique remettait les quatre champs à l\'écran en permanence, le repli ne servait plus à rien');
    assert.match(vu.libelle, /zone géographique attendue/i, 'le bouton le signale au lieu de s\'ouvrir : ' + vu.libelle);
    assert.equal(vu.marque, true, 'et il est mis en avant visuellement');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un champ pré-rempli par la mémoire du créateur ne rouvre pas le repli', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirIdees(page, baseUrl);

    // Exactement ce que fait appliquerProfilCreateur à l'ouverture du mode.
    await page.evaluate(() => {
      preRemplirSiVide('ideaTone', document.getElementById('ideaTone').options[1].value);
      const sel = document.getElementById('ideaNiche');
      sel.value = 'Business & Entrepreneuriat';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(250);

    const vu = await page.evaluate(etat);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.replie, true,
      'REGRESSION : le profil pré-remplit presque toujours quelque chose, une ouverture sur ce critère laissait le panneau ouvert en permanence');
    assert.ok(!vu.ton, 'le champ reste replié');
    // Le choix mémorisé n'est pas perdu pour autant, il part bien au prompt
    // (vérifié par le dernier test de ce fichier).
    const tonRetenu = await page.evaluate(() => ideaTone);
    assert.ok(tonRetenu, 'et il est bien pris en compte : ' + tonRetenu);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'erreur de zone géographique ouvre le repli au lieu de pointer un champ invisible', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await ouvrirIdees(page, baseUrl);

    // Niche exigeante posée SANS déclencher l'ouverture automatique, pour
    // reproduire le pire cas : on force le repli refermé juste après.
    await page.evaluate(() => {
      const sel = document.getElementById('ideaNiche');
      sel.value = 'Histoire';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      ouvrirAffinerIdees(false);
      document.getElementById('ideaGeo').value = '';
    });
    await page.waitForTimeout(150);
    assert.equal((await page.evaluate(etat)).replie, true, 'repli refermé, zone géographique vide');

    await page.evaluate(() => generateIdeas());
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => ({
      replie: document.getElementById('ideaAffiner').hidden,
      geoVisible: document.getElementById('ideaGeo').offsetParent !== null,
      erreur: document.getElementById('ideaErrorBox').textContent
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(vu.erreur, /zone géographique/i, 'le message d\'erreur est bien affiché');
    assert.equal(vu.replie, false,
      'REGRESSION : reprocher un champ que le créateur ne voit pas est une impasse');
    assert.equal(vu.geoVisible, true, 'le champ visé est à l\'écran');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('aucune capacité perdue : les quatre champs repliés atteignent toujours le prompt', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const prompts = [];
    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      prompts.push(JSON.stringify(body.messages || []));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'IDEESPROMPT' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('ideasFlow').style.display = 'block';
      restartIdeas();
      document.getElementById('ideaNiche').value = 'Histoire';
      document.getElementById('ideaGeo').value = 'Bénin';
      document.getElementById('ideaAudience').value = 'Diaspora africaine';
      const pf = document.getElementById('ideaPlatformGrid');
      pf.value = 'TikTok';
      pf.dispatchEvent(new Event('change', { bubbles: true }));
      const ton = document.getElementById('ideaTone');
      ton.value = ton.options[1].value;
      ton.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('ideaTheme').value = 'Behanzin';
    });
    await page.evaluate(() => generateIdeas());
    await page.waitForTimeout(2500);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(prompts.length, 'le prompt doit avoir été envoyé');
    const p = prompts[0];
    assert.match(p, /Diaspora africaine/, 'l\'audience atteint le prompt');
    assert.match(p, /Bénin/, 'la zone géographique aussi');
    // Les guillemets du prompt sont échappés dans le JSON des messages.
    assert.match(p, /PLATEFORME \\?"TikTok/, 'la plateforme aussi');
    assert.match(p, /RESPECTE SES CODES/, 'avec ses codes de hooks propres à la plateforme');
    assert.match(p, /RESPECT STRICT ET EXCLUSIF DU TON CHOISI/, 'et le ton aussi');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Précision du propriétaire : « tu dois mettre affiner en bas, complètement en
// bas ». Le créateur pose d'abord sa niche, son objectif et son sujet, et ne
// croise ces réglages qu'une fois l'essentiel rempli.
test('le repli est tout en bas du formulaire, après le sujet', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await ouvrirIdees(page, baseUrl);

    const ordre = await page.evaluate(() => {
      const y = id => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().top + window.scrollY : null;
      };
      return { niche: y('ideaNiche'), objectif: y('ideaGoalGrid'), sujet: y('ideaTheme'), affiner: y('ideaAffinerBtn'), bouton: y('ideaGenerateBtn') };
    });

    assert.ok(ordre.niche < ordre.objectif, 'la niche reste en premier');
    assert.ok(ordre.objectif < ordre.sujet, 'puis l\'objectif');
    assert.ok(ordre.sujet < ordre.affiner,
      'REGRESSION : « Affiner » doit venir APRÈS le sujet, pas s\'intercaler au milieu du formulaire');
    assert.ok(ordre.affiner < ordre.bouton, 'et rester au-dessus du bouton de génération, qui reste la dernière action');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

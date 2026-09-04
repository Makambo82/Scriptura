// Demande du propriétaire : sur l'objectif "Générer des ventes", le mode
// Carrousel déplie le même bloc "Ce que tu vends" que le mode Script, et ce
// qui y est mis (texte, photo produit, PDF) doit être RÉELLEMENT PRIS EN
// COMPTE dans la génération des slides.
//
// LE PIÈGE, et c'est celui que ces tests verrouillent en priorité : un bloc
// affiché mais ignoré par la génération est PIRE que pas de bloc du tout. Le
// créateur joint la photo de son produit, croit que Scriptura l'a lue, et
// reçoit des slides génériques sans jamais comprendre pourquoi. On vérifie
// donc que le fichier part vraiment dans le message envoyé au modèle, sous
// forme de bloc `image`, et pas seulement qu'un champ existe à l'écran.
//
// LE SECOND ENJEU est une régression que j'ai créée en écrivant ceci : la
// lecture du fichier était propre au mode Script, je l'ai rendue paramétrable
// pour que les deux modes la partagent plutôt que d'en avoir deux copies qui
// divergeraient. AUCUN TEST NE COUVRAIT LE MODE SCRIPT sur ce point. Ces
// tests couvrent donc les deux, sinon la mutualisation se paierait d'un
// silence sur le mode qui existait déjà.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Un vrai PNG 10x10, pour que la compression d'image de l'app ait quelque
// chose de valide à traiter.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzzCKRxWMKhhVAADnEAf1kZ0ZuAAAAABJRU5ErkJggg==';

const CARROUSEL_IA = {
  titre: 'Premiers abonnés',
  analyse: 'Un angle concret.',
  direction_visuelle: 'sobre',
  slides: [
    { numero: 1, gabarit: 'couverture', eyebrow: 'Croissance', titre: 'Tes 100 premiers abonnés', titre_accent: '100', bandeau: 'Sans budget.', visuel: 'v' },
    { numero: 2, gabarit: 'contenu', badge: 'Étape 1 / 2', emoji: '🎯', titre: 'Publie à heure fixe', points: [{ emoji: '⏰', titre: 'Toujours la même heure', texte: 'Ton audience prend le rendez-vous.' }], bandeau: 'La régularité bat le talent.', visuel: 'v' },
    { numero: 3, gabarit: 'recap', eyebrow: 'À toi', titre: 'Commente pour recevoir le plan', titre_accent: 'le plan', points: [{ emoji: '💬', titre: 'Commente', texte: 'Je t\'envoie le détail.' }], bandeau: 'Fin.', visuel: 'v' }
  ],
  legende: 'On commence quand ?',
  hashtags: ['#tiktok'],
  son_suggere: 'nappe calme'
};

async function ouvrirCarrousel(page, baseUrl, gestionnaires) {
  await poserMocksReseau(page, gestionnaires || {});
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'VENTE' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(300);
  await page.evaluate(() => chooseMode('carrousel'));
  await page.waitForTimeout(300);
}

const choisirObjectif = (page, motif) => page.evaluate(m => {
  const carte = Array.from(document.querySelectorAll('#carrouselObjectifs .choice'))
    .find(c => new RegExp(m, 'i').test(c.textContent));
  if (carte) carte.click();
  return !!carte;
}, motif);

const blocVisible = page => page.evaluate(() =>
  document.getElementById('carrouselVenteField').style.display !== 'none');

test('le bloc "ce que tu vends" ne se déplie que sur l\'objectif Ventes', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);

    assert.equal(await blocVisible(page), false, 'replié au départ, l\'objectif par défaut est "faire des vues"');

    assert.ok(await choisirObjectif(page, 'ventes'), 'l\'objectif Ventes doit exister');
    await page.waitForTimeout(200);
    assert.equal(await blocVisible(page), true, 'il se déplie sur Ventes');

    assert.ok(await choisirObjectif(page, 'vues'));
    await page.waitForTimeout(200);
    assert.equal(await blocVisible(page), false, 'et se replie dès qu\'on change d\'objectif');

    // Ce qui a été saisi n'est PAS effacé au passage : un créateur qui hésite
    // entre deux objectifs et revient sur Ventes retrouve son texte.
    await choisirObjectif(page, 'ventes');
    await page.evaluate(() => { document.getElementById('carrouselVenteDescription').value = 'une formation à 25000 FCFA'; });
    await choisirObjectif(page, 'vues');
    await choisirObjectif(page, 'ventes');
    await page.waitForTimeout(200);
    const garde = await page.evaluate(() => document.getElementById('carrouselVenteDescription').value);
    assert.equal(garde, 'une formation à 25000 FCFA',
      'REGRESSION : effacer le champ à chaque changement d\'objectif punirait le créateur qui hésite');
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la photo produit part VRAIMENT dans le message envoyé au modèle', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let corps = null;
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: (b) => { corps = b; return { content: [{ text: JSON.stringify(CARROUSEL_IA) }] }; }
    });

    await choisirObjectif(page, 'ventes');
    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'gagner ses premiers abonnés';
      document.getElementById('carrouselVenteDescription').value = 'une formation TikTok à 25000 FCFA';
    });
    await page.setInputFiles('#carrouselVenteFichierInput',
      { name: 'produit.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await page.waitForTimeout(700);

    const etatFichier = await page.evaluate(() => ({
      nom: document.getElementById('carrouselVenteFichierNom').textContent,
      retirer: document.getElementById('carrouselVenteFichierRetirerBtn').style.display !== 'none',
      enMemoire: !!carrouselVenteFichier,
      // Le champ est vidé après lecture, sinon rejoindre DEUX FOIS le même
      // fichier ne déclencherait pas de second `change`.
      champVide: document.getElementById('carrouselVenteFichierInput').value === ''
    }));
    assert.equal(etatFichier.nom, 'produit.png', 'le créateur voit ce qu\'il a joint');
    assert.equal(etatFichier.retirer, true, 'et peut le retirer');
    assert.equal(etatFichier.enMemoire, true, 'le fichier est bien retenu');
    assert.equal(etatFichier.champVide, true,
      'REGRESSION : sans vidage, rejoindre le même fichier deux fois ne déclencherait rien et semblerait cassé');

    await page.evaluate(() => genererCarrousel());
    await page.waitForTimeout(1000);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(corps, 'un appel au modèle doit partir');
    const blocs = (corps.messages && corps.messages[0] && corps.messages[0].content) || [];
    assert.ok(Array.isArray(blocs), 'le message doit porter plusieurs blocs quand un fichier est joint');
    assert.ok(blocs.some(b => b && b.type === 'image'),
      'REGRESSION MAJEURE : un bloc affiché mais ignoré par la génération est pire que pas de bloc du tout, le créateur croirait sa photo lue : ' + JSON.stringify(blocs.map(b => b && b.type)));

    const texte = JSON.stringify(blocs);
    assert.match(texte, /formation TikTok à 25000 FCFA/, 'ce que le créateur vend est dans le prompt');
    assert.match(texte, /fichier est joint/, 'et le modèle est prévenu qu\'un fichier l\'accompagne');
    assert.match(texte, /N'invente JAMAIS un prix/,
      'garde-fou indispensable : un prix ou un témoignage inventé sur une offre réelle engagerait le créateur');
    assert.match(texte, /apportent de la VALEUR RÉELLE/,
      'un carrousel qui vend dès la slide 2 est abandonné à la slide 2, la consigne doit être là');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un texte de vente laissé derrière ne part JAMAIS dans un carrousel sans objectif Ventes', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let corps = null;
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl, {
      generate: (b) => { corps = b; return { content: [{ text: JSON.stringify(CARROUSEL_IA) }] }; }
    });

    // Le créateur remplit le bloc, puis change d'avis et repart sur "vues".
    await choisirObjectif(page, 'ventes');
    await page.evaluate(() => { document.getElementById('carrouselVenteDescription').value = 'une formation à 25000 FCFA'; });
    await page.setInputFiles('#carrouselVenteFichierInput',
      { name: 'produit.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await page.waitForTimeout(700);
    await choisirObjectif(page, 'vues');
    await page.evaluate(() => {
      document.getElementById('carrouselSujet').value = 'gagner ses premiers abonnés';
      return genererCarrousel();
    });
    await page.waitForTimeout(1000);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const blocs = (corps.messages && corps.messages[0] && corps.messages[0].content) || [];
    const texte = JSON.stringify(blocs);
    assert.doesNotMatch(texte, /formation à 25000 FCFA/,
      'REGRESSION : une offre partirait dans un carrousel qui ne parle pas de vente, sans que le créateur l\'ait demandé');
    const types = Array.isArray(blocs) ? blocs.map(b => b && b.type) : [];
    assert.ok(!types.includes('image'),
      'et le fichier non plus : il serait payé en tokens pour rien, et fausserait le carrousel : ' + JSON.stringify(types));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('retirer le fichier le retire vraiment, pas seulement à l\'écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);
    await choisirObjectif(page, 'ventes');
    await page.setInputFiles('#carrouselVenteFichierInput',
      { name: 'produit.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => !!carrouselVenteFichier), true);

    await page.evaluate(() => retirerFichierVenteCarrousel());
    await page.waitForTimeout(200);
    const apres = await page.evaluate(() => ({
      enMemoire: !!carrouselVenteFichier,
      nom: document.getElementById('carrouselVenteFichierNom').textContent,
      retirerCache: document.getElementById('carrouselVenteFichierRetirerBtn').style.display === 'none'
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(apres.enMemoire, false,
      'REGRESSION : un fichier "retiré" à l\'écran mais gardé en mémoire repartirait quand même au modèle');
    assert.equal(apres.nom, '');
    assert.equal(apres.retirerCache, true);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// La lecture du fichier est désormais PARTAGÉE avec le mode Script (une seule
// fonction paramétrée par les identifiants, plutôt que deux copies). Rien ne
// couvrait le mode Script sur ce point : mutualiser sans le tester aurait
// transformé une simplification en risque.
test('le mode Script garde exactement le même comportement après la mutualisation', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'SCRIPTVENTE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('flow').style.display = 'block';
      state.objectif = 'Générer des ventes via mon contenu';
      showStep(2);
      syncVenteFieldVisibilite();
    });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.getElementById('venteField').style.display !== 'none'), true,
      'le bloc du mode Script s\'affiche toujours sur l\'objectif Ventes');

    await page.setInputFiles('#venteFichierInput',
      { name: 'ebook.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    await page.waitForTimeout(700);
    const vu = await page.evaluate(() => ({
      enMemoire: !!venteFichier,
      nom: document.getElementById('venteFichierNom').textContent,
      retirer: document.getElementById('venteFichierRetirerBtn').style.display !== 'none'
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.enMemoire, true, 'REGRESSION : la mutualisation a cassé la lecture du fichier du mode Script');
    assert.equal(vu.nom, 'ebook.png');
    assert.equal(vu.retirer, true);

    await page.evaluate(() => retirerFichierVente());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => !!venteFichier), false, 'et son retrait fonctionne toujours');
    assert.equal(await page.evaluate(() => document.getElementById('venteFichierNom').textContent), '');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un format de fichier non pris en charge est refusé, dans les deux modes', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await ouvrirCarrousel(page, baseUrl);
    await choisirObjectif(page, 'ventes');
    await page.setInputFiles('#carrouselVenteFichierInput',
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') });
    await page.waitForTimeout(500);

    const vu = await page.evaluate(() => ({
      enMemoire: !!carrouselVenteFichier,
      erreurVisible: document.getElementById('carrouselVenteFichierError').style.display !== 'none',
      message: document.getElementById('carrouselVenteFichierError').textContent
    }));
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.enMemoire, false, 'un fichier illisible ne doit jamais être retenu');
    assert.equal(vu.erreurVisible, true, 'et le créateur doit savoir pourquoi, plutôt que de croire que c\'est passé');
    assert.match(vu.message, /image ou un PDF/i, vu.message);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

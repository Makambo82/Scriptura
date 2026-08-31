// Mode Tendances (benchmark de niche, Pro uniquement) : couvre le gate Pro
// (non-abonné et Creator voient l'offre, jamais l'analyse) et le parcours
// complet côté navigateur (lancement -> boucle de polling "avancer" ->
// rendu du résultat), avec un /api/tendances mocké renvoyant EXACTEMENT la
// forme d'un vrai résultat observé en prod (voir historique git,
// api/tendances.js) : mêmes clés que synthetiser() produit réellement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Résultat réel observé en prod (2e test réussi, après le correctif de
// résolution d'URL fraîche) : 15 vidéos, 15 transcrites, synthèse complète.
const RESULTAT_REEL = {
  niche: 'cuisine', echantillon: 15, transcrites: 15, echecsTranscription: 0, echecsDetail: [],
  vuesMedianes: 646900, likesMedianes: 15300, engagementMoyen: 5, momentum: 0.54,
  topCreateurs: [
    { uniqueId: 'yaas0uk', nickname: 'Yaas0u 🇹🇳', followerCount: 504800, vuesCumulees: 2800000, nbVideos: 1 },
    { uniqueId: 'wasafetbayti2', nickname: 'وصفات بيتي', followerCount: 97600, vuesCumulees: 2400000, nbVideos: 1 },
    { uniqueId: 'fontaine3665', nickname: 'Saveurs sauvage', followerCount: 82100, vuesCumulees: 868700, nbVideos: 2 }
  ],
  registre: "Ton conversationnel et enthousiaste, mélange de français standard et expressions familières.",
  duree_optimale: '60-120s',
  patterns_retention: [
    'Ouverture hook sensorielle ou assertion forte',
    'Démonstration progressive étape-par-étape',
    'Insertion d\'interaction directe au spectateur'
  ]
};

function poserMockTendances(page) {
  let appelsAvancer = 0;
  return page.route('**/api/tendances', async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (body.action === 'lancer') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'job-test-1', total: 15 }) });
    }
    if (body.action === 'avancer') {
      appelsAvancer++;
      // 1er appel : encore en cours (vérifie que la boucle de polling boucle
      // vraiment, pas juste un seul aller-retour) ; 2e appel : terminé.
      if (appelsAvancer === 1) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statut: 'en_cours', traitees: 3, total: 15, resultat: null }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statut: 'termine', traitees: 15, total: 15, resultat: RESULTAT_REEL }) });
    }
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'action inconnue' } }) });
  });
}

async function ouvrirAccueilEtCliquerTendances(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  // Révèle les tuiles de mode (masquées derrière le CTA principal tant qu'on
  // n'a pas cliqué, voir revelerModes/js/ui.js) avant de cliquer sur Tendances.
  await page.evaluate(() => { if (typeof revelerModes === 'function') revelerModes(); });
  await page.waitForTimeout(150);
  await page.click('button[onclick="ouvrirTendances()"]');
  await page.waitForTimeout(150);
}

test('Tendances : non-abonné voit l\'offre Pro, jamais le formulaire d\'analyse', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await ouvrirAccueilEtCliquerTendances(page, baseUrl);

    const paywallActif = await page.evaluate(() => document.getElementById('plansOverlay').classList.contains('active'));
    assert.equal(paywallActif, true, 'Le paywall Pro aurait dû s\'ouvrir pour un non-abonné');
    const titre = await page.evaluate(() => document.getElementById('plansTitle').textContent);
    assert.match(titre, /Tendances TikTok/);
    assert.deepEqual(erreursJs, []);
  } finally { await navigateur.close(); await arreter(); }
});

test('Tendances : abonné Creator voit aussi l\'offre Pro (jamais accessible, même en payant Creator)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'CREATOR-TEST', plan: 'creator' });
    await page.evaluate(() => { if (typeof revelerModes === 'function') revelerModes(); });
    await page.waitForTimeout(150);
    await page.click('button[onclick="ouvrirTendances()"]');
    await page.waitForTimeout(150);

    const paywallActif = await page.evaluate(() => document.getElementById('plansOverlay').classList.contains('active'));
    assert.equal(paywallActif, true, 'Un Creator ne doit jamais voir le formulaire, Tendances est 100% Pro');
    assert.deepEqual(erreursJs, []);
  } finally { await navigateur.close(); await arreter(); }
});

test('Tendances : abonné Pro lance une analyse, la boucle de polling avance, le résultat réel s\'affiche', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    await poserMockTendances(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-TEST', plan: 'pro' });
    await page.evaluate(() => { if (typeof revelerModes === 'function') revelerModes(); });
    await page.waitForTimeout(150);
    await page.click('button[onclick="ouvrirTendances()"]');
    await page.waitForTimeout(150);

    // Le formulaire (pas le paywall) doit être visible pour un Pro.
    const formVisible = await page.evaluate(() => document.getElementById('tendancesForm').style.display !== 'none');
    assert.equal(formVisible, true);
    const paywallActif = await page.evaluate(() => document.getElementById('plansOverlay').classList.contains('active'));
    assert.equal(paywallActif, false);

    await page.fill('#tendancesInput', 'cuisine');
    await page.click('#tendancesGoBtn');

    // Attend la fin de la boucle de polling (2 appels "avancer" mockés, voir
    // poserMockTendances) et l'affichage du résultat.
    await page.waitForSelector('#tendancesResults', { state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => (document.getElementById('tendancesResults').textContent || '').includes('Yaas0u'), null, { timeout: 10000 });

    const texte = await page.evaluate(() => document.getElementById('tendancesResults').textContent);
    assert.match(texte, /cuisine/i);
    assert.match(texte, /646/); // vues médianes formatées (646.900 ou 646 900 selon locale)
    assert.match(texte, /Yaas0u/); // top créateur
    assert.match(texte, /conversationnel/); // extrait du registre
    assert.match(texte, /Ouverture hook sensorielle/); // pattern de rétention

    // Retour du propriétaire (capture) : chaque créateur doit se présenter
    // comme une carte "source" (avatar à initiale + nom + abonnés en tête,
    // détails en dessous), même style que la transcription TikTok
    // (.outils-source-avatar/.outils-source-nom/.outils-source-handle).
    const premierCreateur = await page.evaluate(() => {
      const li = document.querySelector('#tendancesResults .viral-list li');
      return li ? {
        avatar: li.querySelector('.outils-source-avatar')?.textContent,
        nom: li.querySelector('.outils-source-nom')?.textContent,
        handle: li.querySelector('.outils-source-handle')?.textContent
      } : null;
    });
    assert.ok(premierCreateur, 'le premier créateur doit être une carte avec avatar/nom/handle');
    assert.equal(premierCreateur.avatar, 'Y', 'l\'avatar doit être l\'initiale du créateur (Yaas0u -> Y)');
    assert.match(premierCreateur.nom, /Yaas0u/);
    assert.match(premierCreateur.handle, /@yaas0uk/);
    assert.match(premierCreateur.handle, /504.800 abonnés/);

    // Le formulaire, l'écran de chargement ET le bloc d'intro générique
    // doivent être masqués une fois le résultat affiché (jamais superposés
    // avec l'en-tête du résultat lui-même, voir capture réelle du
    // propriétaire : les deux titres s'affichaient l'un sous l'autre).
    const formCache = await page.evaluate(() => document.getElementById('tendancesForm').style.display === 'none');
    const loadingCache = await page.evaluate(() => document.getElementById('tendancesLoading').style.display === 'none');
    const introCache = await page.evaluate(() => document.getElementById('tendancesIntro').style.display === 'none');
    assert.equal(formCache, true);
    assert.equal(loadingCache, true);
    assert.equal(introCache, true, 'Le titre générique du module doit disparaître, sinon il double le titre du résultat');

    assert.deepEqual(erreursJs, []);
  } finally { await navigateur.close(); await arreter(); }
});

test('Tendances : la niche peut se saisir librement OU se choisir dans une liste déroulante', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    let nicheEnvoyee = null;
    await page.route('**/api/tendances', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'lancer') {
        nicheEnvoyee = body.niche;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, raison: 'pas_assez_de_videos', trouvees: 0 }) });
      }
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'inattendu' } }) });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-NICHE', plan: 'pro' });
    await page.evaluate(() => { if (typeof revelerModes === 'function') revelerModes(); });
    await page.waitForTimeout(150);
    await page.click('button[onclick="ouvrirTendances()"]');
    await page.waitForTimeout(150);

    // Par défaut : saisie libre visible, liste masquée.
    const etatInitial = await page.evaluate(() => ({
      saisieVisible: document.getElementById('tendancesChampSaisie').style.display !== 'none',
      listeVisible: document.getElementById('tendancesChampListe').style.display !== 'none'
    }));
    assert.equal(etatInitial.saisieVisible, true);
    assert.equal(etatInitial.listeVisible, false);

    // Bascule vers la liste déroulante.
    await page.click('#tendancesModeListeBtn');
    await page.waitForTimeout(100);
    const etatListe = await page.evaluate(() => ({
      saisieVisible: document.getElementById('tendancesChampSaisie').style.display !== 'none',
      listeVisible: document.getElementById('tendancesChampListe').style.display !== 'none'
    }));
    assert.equal(etatListe.saisieVisible, false);
    assert.equal(etatListe.listeVisible, true);

    // Choisit une niche dans la liste et lance : le lien envoyé au serveur
    // doit être celui choisi dans le <select>, pas un champ de saisie vide.
    await page.selectOption('#tendancesSelect', 'Cuisine & Food');
    await page.click('#tendancesGoBtnListe');
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(nicheEnvoyee, 'Cuisine & Food', 'la niche choisie dans la liste doit être celle envoyée au serveur');
  } finally { await navigateur.close(); await arreter(); }
});

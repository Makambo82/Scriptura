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

// 1x1 PNG transparent, pour simuler une vraie photo de profil sans dépendre
// du réseau (bac à sable sans accès Internet, voir CLAUDE.md).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// Résultat réel observé en prod (2e test réussi, après le correctif de
// résolution d'URL fraîche) : 15 vidéos, 15 transcrites, synthèse complète.
const RESULTAT_REEL = {
  niche: 'cuisine', echantillon: 15, transcrites: 15, echecsTranscription: 0, echecsDetail: [],
  vuesMedianes: 646900, likesMedianes: 15300, engagementMoyen: 5, momentum: 0.54,
  topCreateurs: [
    { uniqueId: 'yaas0uk', nickname: 'Yaas0u 🇹🇳', followerCount: 504800, avatarUrl: 'https://cdn-test.example/avatar-yaas0u.jpg', vuesCumulees: 2800000, nbVideos: 1, meilleureVideo: { id: '7669309697672908064', desc: 'Une recette qui a cartonné cette semaine.', vues: 2800000, likes: 210000, commentaires: 4300, partages: 9800, lien: 'https://www.tiktok.com/@yaas0uk/video/7669309697672908064' } },
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
    // Retour du propriétaire : vraie photo de profil plutôt qu'une initiale
    // seule. Simule un CDN d'avatar qui répond normalement (pas d'accès
    // réseau réel dans ce bac à sable), pour vérifier que l'image se
    // charge et s'affiche.
    await page.route('https://cdn-test.example/avatar-yaas0u.jpg', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));
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
    // comme une carte "source" (photo de profil + nom + abonnés en tête,
    // détails en dessous), même style que la transcription TikTok
    // (.outils-source-avatar/.outils-source-nom/.outils-source-handle).
    // Le bandeau de stats (vues/likes/commentaires/partages) porte sur SA
    // vidéo la plus performante, plus le nom seul.
    await page.waitForSelector('#tendancesResults .viral-list li .outils-source-avatar-img', { timeout: 5000 });
    const premierCreateur = await page.evaluate(() => {
      const li = document.querySelector('#tendancesResults .viral-list li');
      const img = li?.querySelector('.outils-source-avatar-img');
      return li ? {
        avatarTexte: li.querySelector('.outils-source-avatar')?.childNodes[0]?.textContent,
        avatarImgSrc: img?.getAttribute('src'),
        avatarImgCharge: img ? img.complete && img.naturalWidth > 0 : false,
        nom: li.querySelector('.outils-source-nom')?.textContent,
        handle: li.querySelector('.outils-source-handle')?.textContent
      } : null;
    });
    assert.ok(premierCreateur, 'le premier créateur doit être une carte avec avatar/nom/handle');
    assert.equal(premierCreateur.avatarTexte, 'Y', 'l\'initiale (Yaas0u -> Y) doit rester en repli derrière la photo');
    assert.equal(premierCreateur.avatarImgSrc, 'https://cdn-test.example/avatar-yaas0u.jpg', 'la vraie photo de profil doit être utilisée, pas juste l\'initiale');
    assert.equal(premierCreateur.avatarImgCharge, true, 'la photo doit se charger correctement (pas une image cassée)');
    assert.match(premierCreateur.nom, /Yaas0u/);
    assert.match(premierCreateur.handle, /@yaas0uk/);
    assert.match(premierCreateur.handle, /504.800 abonnés/);

    // Retour du propriétaire (2e passe) : le nom du créateur seul ne dit
    // jamais QUELLE vidéo est allée cartonner. Chaque carte affiche donc
    // les stats de sa vidéo la plus performante puis, tout en bas, un lien
    // direct vers la vidéo, quand la donnée est disponible.
    const carteComplete = await page.evaluate(() => {
      const li = document.querySelector('#tendancesResults .viral-list li');
      const a = li?.querySelector('.outils-source-lien');
      const stats = Array.from(li?.querySelectorAll('.ds-stats-row .ds-stat-num') || []).map(e => e.textContent);
      return {
        lien: a ? { href: a.getAttribute('href'), cible: a.getAttribute('target') } : null,
        stats,
        ordreDom: li ? Array.from(li.children).map(e => e.className) : []
      };
    });
    assert.ok(carteComplete.lien, 'un lien vers la vidéo la plus performante doit apparaître pour le premier créateur');
    assert.equal(carteComplete.lien.href, 'https://www.tiktok.com/@yaas0uk/video/7669309697672908064');
    assert.equal(carteComplete.lien.cible, '_blank');
    assert.ok(carteComplete.stats.some(s => /2.800.000|2 800 000/.test(s)), 'les vues de la vidéo phare doivent être visibles dans le bandeau de stats : ' + carteComplete.stats.join(','));
    assert.ok(carteComplete.stats.some(s => /210.000|210 000/.test(s)), 'les likes de la vidéo phare doivent être visibles : ' + carteComplete.stats.join(','));
    // Le lien doit être le DERNIER élément de la carte (retour du
    // propriétaire : "mettre le lien... en bas").
    assert.equal(carteComplete.ordreDom[carteComplete.ordreDom.length - 1], 'outils-source-lien', 'le lien doit être en bas de la carte : ' + carteComplete.ordreDom.join(','));

    // Un créateur dont l'ancien format de résultat n'a pas encore de
    // meilleureVideo (données historiques, avant ce correctif) ne doit
    // jamais planter : la carte s'affiche sans le lien, c'est tout.
    const nbLiens = await page.evaluate(() => document.querySelectorAll('#tendancesResults .viral-list li .outils-source-lien').length);
    assert.equal(nbLiens, 1, 'seul le créateur avec meilleureVideo doit afficher un lien, pas de plantage pour les autres');

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

test('Tendances : si la photo de profil ne charge pas, la carte retombe proprement sur l\'initiale (jamais un cadre cassé)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    const resultatAvatarCasse = {
      ...RESULTAT_REEL,
      topCreateurs: [{
        uniqueId: 'creatrice.test', nickname: 'Créatrice Test', followerCount: 12000,
        avatarUrl: 'https://cdn-test.example/avatar-introuvable.jpg',
        vuesCumulees: 500000, nbVideos: 1,
        meilleureVideo: { id: '111', desc: 'test', vues: 500000, likes: 20000, commentaires: 100, partages: 50, lien: 'https://www.tiktok.com/@creatrice.test/video/111' }
      }]
    };
    await page.route('**/api/tendances', async (route) => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (body.action === 'lancer') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'job-avatar-casse', total: 1 }) });
      if (body.action === 'avancer') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statut: 'termine', traitees: 1, total: 1, resultat: resultatAvatarCasse }) });
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'inattendu' } }) });
    });
    // L'URL de l'avatar échoue (404) : simule un lien CDN expiré, sans
    // dépendre du réseau réel (bac à sable sans accès Internet).
    await page.route('https://cdn-test.example/avatar-introuvable.jpg', (route) => route.fulfill({ status: 404 }));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-AVATAR-CASSE', plan: 'pro' });
    await page.evaluate(() => { if (typeof revelerModes === 'function') revelerModes(); });
    await page.waitForTimeout(150);
    await page.click('button[onclick="ouvrirTendances()"]');
    await page.waitForTimeout(150);
    await page.fill('#tendancesInput', 'cuisine');
    await page.click('#tendancesGoBtn');
    await page.waitForSelector('#tendancesResults', { state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => (document.getElementById('tendancesResults').textContent || '').includes('Créatrice Test'), null, { timeout: 10000 });

    // L'image casse (404) => onerror la retire du DOM, l'initiale (déjà
    // présente derrière) reste seule visible.
    await page.waitForFunction(() => !document.querySelector('#tendancesResults .outils-source-avatar-img'), null, { timeout: 5000 });
    const avatarTexte = await page.evaluate(() => document.querySelector('#tendancesResults .outils-source-avatar')?.textContent.trim());
    assert.equal(avatarTexte, 'C', 'après l\'échec de la photo, l\'initiale (Créatrice -> C) doit rester visible seule');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally { await navigateur.close(); await arreter(); }
});

test('Tendances : la zone géographique se saisit juste sous la niche, est envoyée au serveur et s\'affiche dans le résultat', async () => {
  // Retour du propriétaire : "ajouter la zone géographique... juste en bas
  // de niche", et "il faut que l'app prenne cela en compte dans la
  // recherche" (pas juste décoratif, voir la vraie transmission au serveur).
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {});
    const resultatAvecZone = { ...RESULTAT_REEL, zone: "Côte d'Ivoire" };
    let corpsLance = null;
    await page.route('**/api/tendances', async (route) => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (body.action === 'lancer') {
        corpsLance = body;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'job-zone-ui', total: 15 }) });
      }
      if (body.action === 'avancer') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, statut: 'termine', traitees: 15, total: 15, resultat: resultatAvecZone }) });
      }
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'inattendu' } }) });
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PRO-ZONE', plan: 'pro' });
    await page.evaluate(() => { if (typeof revelerModes === 'function') revelerModes(); });
    await page.waitForTimeout(150);
    await page.click('button[onclick="ouvrirTendances()"]');
    await page.waitForTimeout(150);

    // Le champ doit exister juste sous le champ de niche, avec le bon texte
    // indicateur.
    const zonePresente = await page.evaluate(() => {
      const zoneEl = document.getElementById('tendancesChampZone');
      const nicheEl = document.getElementById('tendancesChampSaisie');
      if (!zoneEl || !nicheEl) return null;
      // "Juste en bas de niche" : la zone doit suivre le champ de niche
      // dans l'ordre du DOM, jamais avant.
      const position = nicheEl.compareDocumentPosition(zoneEl);
      return {
        placeholder: document.getElementById('tendancesZoneInput')?.placeholder,
        apresLaNiche: !!(position & Node.DOCUMENT_POSITION_FOLLOWING)
      };
    });
    assert.ok(zonePresente, 'le champ zone géographique doit exister');
    assert.match(zonePresente.placeholder, /monde entier/i);
    assert.match(zonePresente.placeholder, /Europe/);
    assert.match(zonePresente.placeholder, /Afrique/);
    assert.match(zonePresente.placeholder, /Côte d'Ivoire/);
    assert.equal(zonePresente.apresLaNiche, true, 'le champ zone doit être placé après le champ niche');

    await page.fill('#tendancesInput', 'cuisine');
    await page.fill('#tendancesZoneInput', "Côte d'Ivoire");
    await page.click('#tendancesGoBtn');
    await page.waitForSelector('#tendancesResults', { state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => (document.getElementById('tendancesResults').textContent || '').includes('Yaas0u'), null, { timeout: 10000 });

    assert.ok(corpsLance, 'la requête de lancement doit avoir été envoyée');
    assert.equal(corpsLance.zone, "Côte d'Ivoire", 'la zone saisie doit être transmise au serveur, pas juste affichée');

    const texte = await page.evaluate(() => document.getElementById('tendancesResults').textContent);
    assert.match(texte, /Côte d'Ivoire/, 'la zone doit apparaître dans l\'en-tête du résultat');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
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

    // Choisit une niche dans la liste et lance : le mot-clé envoyé au serveur
    // doit être la VALEUR TikHub-friendly de l'option (voir index.html,
    // #tendancesSelect), pas le libellé affiché "Cuisine & Food" tel quel :
    // un "&" littéral dans le mot-clé de recherche TikHub abîme la
    // pertinence des résultats (retour du propriétaire : trop peu de
    // vidéos, chiffres trop bas, pour "Finance & Argent"/"Géopolitique &
    // Actualité" choisies dans la liste).
    await page.selectOption('#tendancesSelect', { label: 'Cuisine & Food' });
    await page.click('#tendancesGoBtn');
    await page.waitForTimeout(300);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.equal(nicheEnvoyee, 'cuisine', 'le mot-clé envoyé au serveur doit être la valeur propre de l\'option, pas le libellé avec "&"');

    // Aucune option de la liste ne doit envoyer un "&" littéral au serveur
    // (couvre toutes les niches d'un coup, pas seulement "Cuisine & Food").
    const valeursAvecEsperluette = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tendancesSelect option'))
        .filter(o => o.value.includes('&'))
        .map(o => o.value));
    assert.deepEqual(valeursAvecEsperluette, [], 'aucune valeur d\'option ne doit contenir un "&" littéral (mauvais mot-clé de recherche TikHub)');
  } finally { await navigateur.close(); await arreter(); }
});

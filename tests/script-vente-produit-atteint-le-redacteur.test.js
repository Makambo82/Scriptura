// Retour propriétaire, capture et PDF à l'appui. Objectif « Générer des
// ventes », photo d'un produit jointe, sujet « vendre un produit ». Le script
// livré ne parlait pas UNE SECONDE du produit : il expliquait comment mieux
// vendre, à un public de vendeurs, avec un témoignage inventé de toutes
// pièces (« Marc vendait des formations. Quand il a dit arrête de douter, les
// commandes ont doublé »).
//
// CAUSE, trouvée dans le code et non devinée : la génération se fait en deux
// temps, un Directeur Éditorial qui prépare la stratégie, puis un Rédacteur
// qui écrit. Le contexte de vente ET le fichier n'allaient QU'AU Directeur.
// Le Rédacteur ne recevait que des consignes abstraites (angle, structure,
// émotion) : il écrivait donc un script de vente sans savoir ce qui est
// vendu, et comblait ce vide en inventant un exemple. Le mode Carrousel, lui,
// faisait déjà passer le fichier à l'écriture : c'était le mode principal qui
// était le moins bien servi.
//
// CORRECTIF, qui respecte le choix de coût d'origine (ne pas renvoyer le
// fichier, donc ne pas le repayer, à chaque passe) : le Directeur est le seul
// à voir le fichier, mais il doit désormais écrire noir sur blanc ce qu'il y
// a vu (produit_concret), et CETTE description part au Rédacteur, avec
// l'interdiction d'inventer, qui n'existait jusqu'ici que côté Directeur,
// c'est-à-dire pas là où le texte est réellement écrit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const bloc = (i, mots) => ({ temps: '0-3 sec', texte: Array.from({ length: mots }, (_, k) => 'mot' + i + k).join(' '), visuel: 'V' + i });
const SCRIPT_OK = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [0, 1, 2, 3].map(i => bloc(i, 36)),
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};
// Le Directeur voit le fichier et décrit le produit : c'est ce champ qui doit
// désormais parvenir au Rédacteur.
const BRIEF = {
  analyse_strategique: 'a', angle_choisi: 'b', structure: 'c',
  emotion_dominante: 'd', strategie_hook: 'e', strategie_retention: 'f', strategie_cta: 'g',
  produit_concret: 'une crème raffermissante pour le ventre, pour hommes'
};

// Lance une vraie génération avec l'objectif Ventes, et renvoie les prompts
// réellement envoyés à chaque passe.
async function genererVente(page, baseUrl, { brief = BRIEF } = {}) {
  const prompts = [];
  await poserMocksReseau(page);
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const contenu = body.messages && body.messages[0] && body.messages[0].content;
    // Le contenu est soit une chaîne, soit un tableau (quand un fichier est
    // joint) : on récupère le texte dans les deux cas.
    const texte = typeof contenu === 'string'
      ? contenu
      : (Array.isArray(contenu) ? contenu.map(p => p && p.text ? p.text : '').join('\n') : '');
    prompts.push({ maxTokens: body.max_tokens, texte, avecFichier: Array.isArray(contenu) });
    const repondre = (obj) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: JSON.stringify(obj) }] })
    });
    if (body.max_tokens === 2000) return repondre(brief);
    if (body.max_tokens === 16000) return repondre(SCRIPT_OK);
    if (body.max_tokens === 2500) return repondre({ verdict: 'ok', faiblesses: [] });
    return repondre({});
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'VENTE' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('niche').value = 'Beauté & Mode';
    document.getElementById('sujet').value = 'vendre un produit';
    document.getElementById('venteDescription').value = 'une crème pour le ventre';
    ['audience', 'format', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
    state.depart = 'un sujet précis';
    state.objectif = 'Générer des ventes via mon contenu';
    selectedDuree = '1 minute';
  });
  await page.evaluate(() => generate());
  await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
  return prompts;
}

test('le RÉDACTEUR sait enfin ce que vend le créateur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const prompts = await genererVente(page, baseUrl);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    const brief = prompts.find(p => p.maxTokens === 2000);
    const ecriture = prompts.find(p => p.maxTokens === 16000);
    assert.ok(brief && ecriture, 'les deux passes doivent avoir eu lieu');

    // Le Directeur, lui, recevait déjà le contexte : ça ne régresse pas.
    assert.match(brief.texte, /CE QUE LE CRÉATEUR VEND/, 'le Directeur garde son contexte de vente');

    // LE CŒUR DU CORRECTIF.
    assert.match(ecriture.texte, /crème raffermissante pour le ventre/,
      'REGRESSION : le Rédacteur écrivait un script de vente sans savoir ce qui est vendu');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le Rédacteur reçoit aussi l\'interdiction d\'inventer, là où le texte est écrit', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const prompts = await genererVente(page, baseUrl);
    const ecriture = prompts.find(p => p.maxTokens === 16000);

    assert.match(ecriture.texte, /N'invente JAMAIS/,
      'la règle vivait côté Directeur seulement, donc pas là où le témoignage inventé apparaissait');
    assert.match(ecriture.texte, /témoignage/, 'et elle doit viser explicitement les faux témoignages');
    assert.match(ecriture.texte, /jamais de la vente en général/,
      'le script doit parler du produit, pas expliquer comment vendre à un public de vendeurs');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('si le Directeur ne décrit pas le produit, on retombe sur la description du créateur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    // Brief sans produit_concret (modèle qui oublie le champ) : le Rédacteur
    // ne doit pas se retrouver les mains vides pour autant.
    const briefSansProduit = { ...BRIEF };
    delete briefSansProduit.produit_concret;
    const prompts = await genererVente(page, baseUrl, { brief: briefSansProduit });
    const ecriture = prompts.find(p => p.maxTokens === 16000);

    assert.match(ecriture.texte, /une crème pour le ventre/,
      'repli sur ce que le créateur a écrit lui-même, plutôt que rien');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('sans objectif Ventes, rien de tout ça n\'alourdit le prompt', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const prompts = [];
    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const c = body.messages[0].content;
      prompts.push({ maxTokens: body.max_tokens, texte: typeof c === 'string' ? c : '' });
      const repondre = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(obj) }] }) });
      if (body.max_tokens === 2000) return repondre(BRIEF);
      if (body.max_tokens === 16000) return repondre(SCRIPT_OK);
      if (body.max_tokens === 2500) return repondre({ verdict: 'ok', faiblesses: [] });
      return repondre({});
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VUES' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Histoire';
      document.getElementById('sujet').value = 'Behanzin';
      ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      state.depart = 'un sujet précis';
      state.objectif = 'Faire plus de vues et maximiser la portée';
      selectedDuree = '1 minute';
    });
    await page.evaluate(() => generate());
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });

    const ecriture = prompts.find(p => p.maxTokens === 16000);
    assert.doesNotMatch(ecriture.texte, /CE QUE LE CRÉATEUR VEND/,
      'aucun bloc de vente ne doit polluer un script qui ne vend rien');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le bloc produit ouvre l\'écran, avec son « OU » entre le texte et le fichier', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    // Retour propriétaire : « la partie où on charge une image ou un pdf est
    // positionnée trop en bas », puis, plus net : « tout ce bloc doit être mis
    // en haut, après vient ton sujet ou idée, et ensuite la niche ». Sur
    // l'objectif Ventes, le produit est la matière ET la source de la niche et
    // des trois angles proposés : demander le sujet d'abord, ce serait demander
    // la conclusion avant les faits.
    const ordre = await page.evaluate(() => {
      const avant = (a, b) => !!(document.getElementById(a)
        .compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        venteAvantSujet: avant('venteField', 'sujet'),
        venteAvantNiche: avant('venteField', 'niche'),
        sujetAvantNiche: avant('sujet', 'niche'),
        venteAvantAudience: avant('venteField', 'audience'),
        fichierDansLeBloc: !!document.querySelector('#venteField #venteFichierInput'),
        // Le « OU » du propriétaire : décrire son produit OU en montrer la
        // photo, pas les deux. Entre le texte et le bouton, exactement là où
        // il a tracé son trait.
        ouEntreTexteEtFichier: (() => {
          const ou = document.querySelector('#venteField .ou-separateur');
          if (!ou) return 'absent';
          const apresTexte = !!(document.getElementById('venteDescription')
            .compareDocumentPosition(ou) & Node.DOCUMENT_POSITION_FOLLOWING);
          const avantFichier = !!(ou.compareDocumentPosition(document.getElementById('venteFichierInput'))
            & Node.DOCUMENT_POSITION_FOLLOWING);
          return (apresTexte && avantFichier) ? ou.textContent.trim() : 'mal placé';
        })()
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(ordre.venteAvantSujet, true,
      'REGRESSION : le bloc produit doit être EN HAUT, avant le sujet');
    assert.equal(ordre.venteAvantNiche, true,
      'REGRESSION : ce qu\'on vend doit venir AVANT la niche, c\'est la matière du script');
    assert.equal(ordre.sujetAvantNiche, true, 'puis le sujet, puis la niche');
    assert.equal(ordre.venteAvantAudience, true, 'et avant les réglages secondaires');
    assert.equal(ordre.fichierDansLeBloc, true, 'le bouton de chargement suit bien son bloc');
    assert.equal(ordre.ouEntreTexteEtFichier, 'OU',
      'le « OU » doit se lire entre la description écrite et le bouton de chargement');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Précision du propriétaire, puis correction : « on va positionner les champs
// sujet/idée et charger un fichier/image produit au-dessus de niche », puis
// « tout ce bloc doit être mis en haut, après vient ton sujet ou idée, et
// ensuite la niche ». Le créateur donne d'abord SA MATIÈRE, et le rangement
// vient après. D'autant que la niche se déduit maintenant du produit chargé
// (voir tests/niche-depuis-produit-charge.test.js), et que les trois angles
// proposés viennent nourrir le champ sujet : demander le sujet avant la photo
// serait exactement l'ordre inverse du bon.
//
// Verrouillé pour les DEUX modes qui acceptent un fichier produit.
test('dans Script ET Carrousel : produit, puis sujet, puis niche', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const ordre = await page.evaluate(() => {
      const avant = (a, b) => !!(document.getElementById(a)
        .compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        scriptProduitSujet: avant('venteField', 'sujet'),
        scriptSujetNiche: avant('sujet', 'niche'),
        scriptAnglesSousSujet: avant('sujet', 'anglesProduitScript'),
        carrouselProduitSujet: avant('carrouselVenteField', 'carrouselSujet'),
        carrouselSujetNiche: avant('carrouselSujet', 'carrouselNiche'),
        carrouselAnglesSousSujet: avant('carrouselSujet', 'anglesProduitCarrousel'),
        ouScript: !!document.querySelector('#venteField .ou-separateur'),
        ouCarrousel: !!document.querySelector('#carrouselVenteField .ou-separateur')
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(ordre, {
      scriptProduitSujet: true, scriptSujetNiche: true, scriptAnglesSousSujet: true,
      carrouselProduitSujet: true, carrouselSujetNiche: true, carrouselAnglesSousSujet: true,
      ouScript: true, ouCarrousel: true
    }, 'REGRESSION : produit, puis sujet (avec ses angles juste dessous), puis niche, dans les deux modes : ' + JSON.stringify(ordre));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

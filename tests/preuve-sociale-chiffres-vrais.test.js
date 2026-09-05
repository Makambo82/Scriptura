// Point le plus risqué relevé dans l'analyse produit, puis choisi par le
// propriétaire. Les notifications de preuve sociale étaient entièrement
// INVENTÉES :
//   - « 348 créateurs utilisent Scriptura » : un compteur parti d'une base
//     codée en dur, incrémenté à chaque affichage et mémorisé dans le
//     localStorage DU VISITEUR (donc un chiffre différent par appareil, qui
//     ne mesurait strictement rien) ;
//   - « Untel vient de s'abonner » : un prénom tiré au hasard dans une liste
//     d'une centaine de noms écrite dans le code ;
//   - « Un créateur vient de générer un script il y a 3 min » : délai tiré
//     au sort lui aussi.
//
// Pourquoi ça ne pouvait pas rester : Scriptura se vend sur la CRÉDIBILITÉ,
// des scores calculés par le code et jamais notés par l'IA, précisément pour
// qu'on puisse les vérifier. Or n'importe qui ouvrant les outils de son
// navigateur voyait ces chiffres fabriqués en trente secondes. Un créateur
// qui découvre ça ne se dit pas « la preuve sociale est exagérée », il se dit
// « les scores aussi sont peut-être inventés ».
//
// LA RÈGLE VERROUILLÉE ICI : sous les seuils, on n'affiche RIEN. Pas de
// repli, pas de message de secours. Une preuve sociale absente ne coûte
// qu'une occasion manquée ; une preuve sociale fausse coûte la confiance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'preuve-sociale.js'), 'utf8');

test('plus AUCUNE donnée inventée ne subsiste dans le code', () => {
  // Le fichier explique en commentaire ce qui a été retiré : on ne cherche
  // donc que du code exécutable, commentaires exclus.
  const codeSeul = SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  assert.doesNotMatch(codeSeul, /SOCIAL_NOMS|SOCIAL_BASE/,
    'la liste de prénoms et la base du faux compteur ne doivent plus exister');
  assert.doesNotMatch(codeSeul, /scriptura_social_count/,
    'le compteur mémorisé sur l\'appareil du visiteur ne doit plus exister');
  assert.doesNotMatch(codeSeul, /Math\.random/,
    'plus rien ne doit être tiré au hasard : c\'était toute la fabrication');
  assert.doesNotMatch(codeSeul, /s'abonner/,
    'plus aucun faux abonnement annoncé');
});

// Rend le module testable en Node pur, en lui donnant les chiffres qu'il
// aurait reçus du serveur. Nom local différent de celui du source : une
// déclaration de fonction évaluée en eval fuit dans la portée englobante.
// eslint-disable-next-line no-eval
const construireMessages = eval(SRC + '\n; construirePreuveMessages');

test('avec de vrais chiffres suffisants, les messages disent la vérité', () => {
  const messages = construireMessages({ creatoursSemaine: 37, generationsSemaine: 214 });
  assert.equal(messages.length, 2, JSON.stringify(messages));
  assert.match(messages[0], /37/, 'le nombre réel de créateurs : ' + messages[0]);
  assert.match(messages[1], /214/, 'le nombre réel de générations : ' + messages[1]);
  assert.match(messages[0], /cette semaine/, 'la période est dite, sinon le chiffre ne veut rien dire');
});

test('sous les seuils, on se TAIT plutôt que d\'afficher un chiffre qui dessert', () => {
  // « 2 créateurs cette semaine » est un argument CONTRE l'abonnement.
  assert.deepEqual(construireMessages({ creatoursSemaine: 2, generationsSemaine: 3 }), []);
  // Produit tout neuf : aucune donnée du tout.
  assert.deepEqual(construireMessages({ creatoursSemaine: 0, generationsSemaine: 0 }), []);
  // Panne serveur : surtout ne rien inventer pour combler.
  assert.deepEqual(construireMessages(null), []);
  assert.deepEqual(construireMessages({}), []);
});

test('chaque message franchit son seuil INDÉPENDAMMENT', () => {
  // Peu de créateurs mais beaucoup de générations : on ne dit que ce qui est
  // solide, jamais les deux en bloc.
  const messages = construireMessages({ creatoursSemaine: 3, generationsSemaine: 120 });
  assert.equal(messages.length, 1, JSON.stringify(messages));
  assert.match(messages[0], /120/);
  assert.doesNotMatch(messages[0], /créateurs ont utilisé/, 'le chiffre faible ne doit pas sortir');
});

test('dans le navigateur : rien ne s\'affiche quand le serveur n\'a rien à dire', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {
      data: (body, method) => (method === 'GET' ? { creatoursSemaine: 1, generationsSemaine: 2 } : undefined)
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    // Au-delà du délai d'apparition (5s) : la notification ne doit JAMAIS
    // se montrer, et aucun minuteur ne doit même avoir été armé.
    await page.waitForTimeout(7000);

    const vu = await page.evaluate(() => {
      const el = document.getElementById('socialNotif');
      return { visible: !!el && el.classList.contains('visible'), contenu: el ? el.innerHTML : null };
    });
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.visible, false, 'sous les seuils, aucune notification ne doit apparaître');
    assert.equal(vu.contenu, '', 'et rien ne doit même avoir été écrit dedans : ' + vu.contenu);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('dans le navigateur : avec de vrais chiffres, la notification apparaît et dit vrai', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {
      data: (body, method) => (method === 'GET' ? { creatoursSemaine: 42, generationsSemaine: 310 } : undefined)
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const el = document.getElementById('socialNotif');
      return el && el.classList.contains('visible');
    }, null, { timeout: 15000 });

    const contenu = await page.evaluate(() => document.getElementById('socialNotif').textContent);
    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(contenu, /42|310/, 'le chiffre affiché doit venir du serveur : ' + contenu);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('la route publique ne renvoie QUE des totaux, jamais un code ni un prénom', async () => {
  const envAvant = { ...process.env };
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-test';
  const fetchAvant = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ([
      { code_acces: 'CODE-A' }, { code_acces: 'CODE-A' }, { code_acces: 'CODE-B' }
    ])
  });
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    let statut = null, corps = null;
    const res = { status(c) { statut = c; return this; }, json(o) { corps = o; return this; } };
    await handler({ method: 'GET', query: { resource: 'preuveSociale' }, body: {} }, res);

    assert.equal(statut, 200);
    assert.equal(corps.creatoursSemaine, 2,
      'deux créateurs DISTINCTS : un créateur très actif ne doit pas se compter pour trois');
    assert.equal(corps.generationsSemaine, 3);
    const brut = JSON.stringify(corps);
    assert.ok(!brut.includes('CODE-A'), 'aucun code d\'accès ne doit sortir de cette route publique : ' + brut);
  } finally {
    global.fetch = fetchAvant;
    process.env = envAvant;
  }
});

test('la route publique renvoie des zéros en cas de panne, jamais une erreur ni un chiffre inventé', async () => {
  const envAvant = { ...process.env };
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-test';
  const fetchAvant = global.fetch;
  global.fetch = async () => { throw new Error('Supabase injoignable'); };
  try {
    const { default: handler } = await import('../api/data.js?t=' + Date.now());
    let statut = null, corps = null;
    const res = { status(c) { statut = c; return this; }, json(o) { corps = o; return this; } };
    await handler({ method: 'GET', query: { resource: 'preuveSociale' }, body: {} }, res);

    assert.equal(statut, 200, 'une panne ne doit pas casser la page d\'accueil');
    assert.deepEqual(corps, { creatoursSemaine: 0, generationsSemaine: 0 },
      'des zéros, que le client traduit par "je n\'affiche rien"');
  } finally {
    global.fetch = fetchAvant;
    process.env = envAvant;
  }
});

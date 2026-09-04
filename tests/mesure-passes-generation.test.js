// Question de coût posée par le propriétaire, après le détail des budgets de
// jetons du pipeline : "correction de la durée : 24000 tokens pourquoi ?".
//
// La réponse tenait en 8000 x 3 tentatives, mais surtout elle a mis au jour un
// malentendu qu'il fallait lever : max_tokens est un PLAFOND RÉSERVÉ, pas ce
// qui est facturé. Le vrai poids de ces passes est ailleurs : chacune renvoie
// le texte ENTIER dans le prompt et le fait réécrire entièrement. Une
// correction de durée coûte donc à peu près une écriture de script complète, et
// la boucle peut en enchaîner trois.
//
// Restait la seule chose qui permet de décider sans couper à l'aveugle :
// SAVOIR À QUELLE FRÉQUENCE ces passes se déclenchent vraiment. Personne ne le
// savait, rien ne l'enregistrait. Ces compteurs comblent ce trou.
//
// Ce que ces tests verrouillent :
//  - la mesure n'invente rien : elle compte les passes RÉELLEMENT effectuées ;
//  - elle n'envoie AUCUNE donnée de contenu (ni sujet, ni texte, ni script) ;
//  - elle est strictement passive : elle ne change ni le contenu livré, ni le
//    nombre d'appels IA, ni le comportement du pipeline ;
//  - la carte de lecture du Tableau de bord traduit ces compteurs en
//    pourcentages exacts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };

const bloc = (i, mots) => ({ temps: '0-3 sec', texte: Array.from({ length: mots }, (_, k) => 'mot' + i + k).join(' '), visuel: 'V' + i });
// 4 blocs x 36 mots = 144 mots : dans la cible "1 minute" (130-155), donc la
// boucle de durée ne se déclenche pas.
const SCRIPT_DANS_CIBLE = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [0, 1, 2, 3].map(i => bloc(i, 36)),
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};
// 4 blocs x 20 mots = 80 mots : sous le plancher de tolérance (117), donc la
// boucle de durée se déclenche, et au-dessus du seuil de complétude (65).
const SCRIPT_TROP_COURT = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [0, 1, 2, 3].map(i => bloc(i, 20)),
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};

async function genererScript(page, baseUrl, { premierJet, correction }) {
  const mesures = [];
  await poserMocksReseau(page);
  await page.route('**/api/data**', async (route) => {
    try {
      const b = JSON.parse(route.request().postData() || '{}');
      if (b && b.resource === 'passes') mesures.push(b);
    } catch (e) { /* corps non JSON */ }
    return route.fallback();
  });
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
    if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(premierJet) }] }) });
    if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
    if (body.max_tokens === 8000 && correction) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(correction) }] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'MESURE' + Math.round(Math.random() * 1e6), plan: 'creator' });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    masquerTousLesEcrans();
    document.getElementById('niche').value = 'Histoire';
    document.getElementById('sujet').value = 'Behanzin';
    ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
    state.depart = 'un sujet précis';
    selectedDuree = '1 minute';
  });
  await page.evaluate(() => generate());
  await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
  await page.waitForTimeout(800);
  return mesures;
}

test('mesure : un script déjà dans la cible n\'a déclenché AUCUNE correction de durée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const mesures = await genererScript(page, baseUrl, { premierJet: SCRIPT_DANS_CIBLE });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(mesures.length, 1, 'exactement une mesure par génération réussie');
    const m = mesures[0];
    assert.equal(m.mode, 'script');
    assert.equal(m.corrections_duree, 0, 'la boucle de durée ne s\'est pas déclenchée, la mesure doit le dire');
    assert.equal(m.revisions, 0, 'le Critique a validé, aucune réécriture');
    assert.equal(m.second_brouillon, false);
    assert.equal(m.critiques, 1, 'un seul passage du Critique, qui a validé du premier coup');
    assert.equal(m.dans_cible, true);
    assert.equal(m.mots_final, 144, 'le compte de mots réellement livré');
    assert.equal(m.duree_cible, '1 minute');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mesure : un script hors cible compte les tours réellement effectués', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // La correction ramène le script dans la cible : la boucle s'arrête donc
    // après UN seul tour, et la mesure doit refléter ce tour unique, pas le
    // maximum théorique de 3.
    const mesures = await genererScript(page, baseUrl, {
      premierJet: SCRIPT_TROP_COURT,
      correction: { script: [0, 1, 2, 3].map(i => bloc(i, 36)) }
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(mesures.length, 1);
    assert.equal(mesures[0].corrections_duree, 1,
      'un seul tour a suffi : la mesure compte les tours RÉELS, jamais le plafond de 3');
    assert.equal(mesures[0].mots_final, 144, 'et le compte final, après correction');
    assert.equal(mesures[0].dans_cible, true);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mesure : aucune donnée de contenu n\'est envoyée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const mesures = await genererScript(page, baseUrl, { premierJet: SCRIPT_DANS_CIBLE });
    const m = mesures[0];
    const envoye = JSON.stringify(m);

    assert.ok(!/Behanzin/i.test(envoye), 'le sujet ne doit jamais partir dans la mesure : ' + envoye);
    assert.ok(!/mot0|mot1|Hook /.test(envoye), 'ni le moindre morceau du script');
    const clesAutorisees = ['resource', 'code', 'mode', 'duree_cible', 'mots_final', 'dans_cible', 'corrections_duree', 'critiques', 'revisions', 'second_brouillon'];
    for (const cle of Object.keys(m)) {
      assert.ok(clesAutorisees.includes(cle), 'clé inattendue dans la mesure : ' + cle);
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('mesure : strictement passive, elle ne change ni le contenu livré ni le nombre d\'appels IA', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let appelsIA = 0;

    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      appelsIA++;
      if (body.max_tokens === 2000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
      if (body.max_tokens === 16000) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_DANS_CIBLE) }] }) });
      if (body.max_tokens === 2500) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PASSIVE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Histoire';
      document.getElementById('sujet').value = 'Behanzin';
      ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      state.depart = 'un sujet précis';
      selectedDuree = '1 minute';
    });
    await page.evaluate(() => generate());
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
    await page.waitForTimeout(800);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    // Brief, écriture, critique, juge du score : la mesure n'ajoute AUCUN
    // appel au modèle, elle écrit une ligne et c'est tout.
    assert.equal(appelsIA, 4, 'la mesure ne doit ajouter aucun appel IA (obtenu : ' + appelsIA + ')');
    const script = await page.evaluate(() => currentScript.map(b => b.texte));
    assert.deepEqual(script, SCRIPT_DANS_CIBLE.script.map(b => b.texte), 'le contenu livré est strictement inchangé');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('carte du Tableau de bord : les compteurs deviennent des pourcentages exacts', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // 4 générations : 2 avec correction de durée (1 et 3 tours), 1 avec
    // réviseur, 1 avec second brouillon, 3 dans la cible.
    const passes = [
      { mode: 'script', corrections_duree: 1, critiques: 1, revisions: 0, second_brouillon: false, dans_cible: true },
      { mode: 'script', corrections_duree: 3, critiques: 2, revisions: 1, second_brouillon: false, dans_cible: false },
      { mode: 'story', corrections_duree: 0, critiques: 1, revisions: 0, second_brouillon: true, dans_cible: true },
      { mode: 'script', corrections_duree: 0, critiques: 1, revisions: 0, second_brouillon: false, dans_cible: true }
    ];
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [], passes }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const texte = await page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('.score-card'));
      const c = cartes.find(x => /Passes de perfectionnement/.test(x.textContent));
      return c ? c.innerText.replace(/\s+/g, ' ') : '';
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.ok(texte, 'la carte doit s\'afficher dès qu\'il y a des mesures');
    assert.match(texte, /4 générations mesurées/);
    // Sous le seuil de 10 mesures : des COMPTES BRUTS, jamais des
    // pourcentages qui se liraient comme une tendance (voir le test suivant).
    assert.match(texte, /Correction de durée déclenchée .*? 2 sur 4/);
    assert.match(texte, /En moyenne 2\.0 tour\(s\)/, 'moyenne de 1 et 3 tours, calculée sur les seules générations concernées');
    assert.match(texte, /Réviseur déclenché .*? 1 sur 4/);
    assert.match(texte, /Second brouillon complet .*? 1 sur 4/);
    assert.match(texte, /Durée finale dans la cible .*? 3 sur 4/);
    assert.ok(!/%/.test(texte), 'aucun pourcentage tant que l\'échantillon est trop petit : ' + texte);
    assert.match(texte, /Trop peu de générations pour conclure/);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('carte du Tableau de bord : absente tant qu\'aucune génération n\'a été mesurée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [], passes: [] }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const presente = await page.evaluate(() => Array.from(document.querySelectorAll('.score-card')).some(x => /Passes de perfectionnement/.test(x.textContent)));
    assert.equal(presente, false, 'aucune carte vide ni pourcentage calculé sur zéro génération');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour terrain immédiat après la mise en ligne : sur UNE seule génération
// mesurée, la carte affichait quatre "100%". Techniquement exact, mais ça se
// lit comme une tendance alors que ce n'est qu'un seul cas. Une carte censée
// aider à décider ne doit pas pouvoir induire en erreur son unique lecteur.
test('carte : sous 10 mesures, des comptes bruts ; au-dessus, les pourcentages', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // 12 générations : 6 avec correction de durée, donc 50%.
    const passes = Array.from({ length: 12 }, (_, i) => ({
      mode: 'script',
      corrections_duree: i % 2 === 0 ? 1 : 0,
      critiques: 1, revisions: 0, second_brouillon: false, dans_cible: true
    }));
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [], passes }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const texte = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll('.score-card')).find(x => /Passes de perfectionnement/.test(x.textContent));
      return c ? c.innerText.replace(/\s+/g, ' ') : '';
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.match(texte, /Correction de durée déclenchée .*? 50%/, '6 sur 12, l\'échantillon est assez grand pour un pourcentage');
    assert.ok(!/Trop peu de générations/.test(texte), 'plus d\'avertissement une fois l\'échantillon suffisant');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('carte : une seule mesure ne doit JAMAIS s\'afficher comme un 100%', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    // Exactement le cas rencontré en production : une génération, qui a
    // déclenché toutes les passes lourdes.
    const passes = [{ mode: 'script', corrections_duree: 2, critiques: 2, revisions: 1, second_brouillon: true, dans_cible: true }];
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [], passes }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);

    const texte = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll('.score-card')).find(x => /Passes de perfectionnement/.test(x.textContent));
      return c ? c.innerText.replace(/\s+/g, ' ') : '';
    });

    assert.ok(!/100%/.test(texte),
      'REGRESSION : "100%" sur une seule génération se lit comme une tendance alors que c\'est un seul cas : ' + texte);
    assert.match(texte, /1 sur 1/, 'le compte brut, lui, est honnête');
    assert.match(texte, /Trop peu de générations pour conclure/, 'et c\'est dit explicitement');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

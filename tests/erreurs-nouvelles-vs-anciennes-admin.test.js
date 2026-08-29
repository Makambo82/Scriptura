// Vérifie que la carte "Échecs de génération" distingue les échecs
// NOUVEAUX (rouge) des échecs déjà consultés lors d'une visite précédente
// (doré), retour direct du propriétaire : "lorsque y'a de nouvelle erreur
// que le nombre soit en rouge, sinon en doré, et quand je consulte les
// nouvelles elles deviennent anciennes donc dorées" — puis, dans un
// deuxième retour, "mets deux nombres séparés : les nouvelles en rouge, les
// anciennes en doré" plutôt qu'un seul total dont la couleur change. La
// distinction se fait par horodatage de la dernière visite
// (scriptura_erreurs_vues_le, voir js/admin.js), pas par un simple compte
// total (qui peut rester identique si une vieille erreur sort de la
// fenêtre de 7 jours pile au moment où une nouvelle apparaît).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

test('les erreurs déjà consultées passent au doré ; une nouvelle erreur repasse la carte et son mode au rouge', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const errA = { mode: 'script', detail: '(529) surchargé', code_acces: 'FIFA', cree_le: new Date(Date.now() - 2 * 3600000).toISOString() };
    let recentesActuelles = [errA];

    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? {
            codes: [], parModePlan: {},
            erreursParMode: recentesActuelles.reduce((acc, e) => { acc[e.mode] = (acc[e.mode] || 0) + 1; return acc; }, {}),
            erreursTotal: recentesActuelles.length,
            erreursRecentes: recentesActuelles
          }
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

    const lireNombres = () => {
      const carte = document.querySelector('.score-card-alerte') || document.querySelector('.score-card');
      const spans = carte ? Array.from(carte.querySelectorAll('.score-global-num')) : [];
      return {
        alerte: !!document.querySelector('.score-card-alerte'),
        nouvelles: spans[0] ? { texte: spans[0].textContent, couleur: spans[0].style.color } : null,
        anciennes: spans[1] ? { texte: spans[1].textContent, couleur: spans[1].style.color } : null
      };
    };

    // ── Première visite (jamais consulté avant) : 1 nouvelle, 0 ancienne ──
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const premiereVisite = await page.evaluate(lireNombres);
    assert.equal(premiereVisite.alerte, true, 'première visite : jamais consulté, doit être en alerte');
    assert.equal(premiereVisite.nouvelles.texte, '1', 'première visite : la seule erreur existante est nouvelle');
    assert.match(premiereVisite.nouvelles.couleur, /248, ?113, ?113|#f87171/, 'le nombre de nouvelles doit être rouge');
    assert.equal(premiereVisite.anciennes.texte, '0', 'première visite : aucune ancienne pour l\'instant');
    assert.match(premiereVisite.anciennes.couleur, /gold/, 'le nombre d\'anciennes doit être doré');

    // ── Deuxième visite, mêmes données (rien de nouveau depuis la 1ère) ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const deuxiemeVisite = await page.evaluate(lireNombres);
    assert.equal(deuxiemeVisite.alerte, false, 'rien de nouveau depuis la 1ère visite : la carte ne doit plus être en alerte');
    assert.equal(deuxiemeVisite.nouvelles.texte, '0', 'rien de nouveau depuis la dernière visite');
    assert.equal(deuxiemeVisite.anciennes.texte, '1', 'l\'unique erreur est maintenant ancienne (déjà consultée)');

    // ── Une VRAIE nouvelle erreur arrive, sur un AUTRE mode (idées) ──
    await page.waitForTimeout(50); // s'assurer que cree_le est postérieur au dernier horodatage de visite
    const errB = { mode: 'ideas', detail: 'délai dépassé (55s)', code_acces: null, cree_le: new Date().toISOString() };
    recentesActuelles = [errA, errB];
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const troisiemeVisite = await page.evaluate(() => {
      const carte = document.querySelector('.score-card-alerte');
      const spans = carte ? Array.from(carte.querySelectorAll('.score-global-num')) : [];
      const lignes = Array.from(document.querySelectorAll('.erreur-mode-ligne')).map(l => ({
        texte: l.textContent,
        couleur: l.querySelector('b')?.style.color
      }));
      return {
        alerte: !!carte,
        nouvelles: spans[0] ? spans[0].textContent : null,
        anciennes: spans[1] ? spans[1].textContent : null,
        lignes
      };
    });
    assert.equal(troisiemeVisite.alerte, true, 'une nouvelle erreur est arrivée : la carte doit repasser en alerte');
    assert.equal(troisiemeVisite.nouvelles, '1', 'une seule nouvelle erreur (Idées)');
    assert.equal(troisiemeVisite.anciennes, '1', 'une seule ancienne erreur (Script, déjà consultée)');
    const ligneIdees = troisiemeVisite.lignes.find(l => l.texte.includes('Idées'));
    const ligneScript = troisiemeVisite.lignes.find(l => l.texte.includes('Script'));
    assert.ok(ligneIdees, 'la ligne Idées (nouvelle erreur) doit exister');
    assert.match(ligneIdees.couleur, /248, ?113, ?113|#f87171/, 'Idées contient la nouvelle erreur : doit être rouge');
    assert.ok(ligneScript, 'la ligne Script (ancienne erreur, déjà consultée) doit exister');
    assert.match(ligneScript.couleur, /gold/, 'Script ne contient qu\'une ancienne erreur déjà consultée : doit rester doré');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('le badge de la nav "Tableau de bord" affiche le nombre de NOUVELLES erreurs, pas le total', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const maintenant = Date.now();
    const erreursRecentes = [
      { mode: 'script', detail: 'ancienne 1', code_acces: 'FIFA', cree_le: new Date(maintenant - 3 * 24 * 3600000).toISOString() },
      { mode: 'script', detail: 'ancienne 2', code_acces: 'FIFA', cree_le: new Date(maintenant - 2 * 24 * 3600000).toISOString() },
      { mode: 'ideas', detail: 'nouvelle', code_acces: null, cree_le: new Date(maintenant).toISOString() }
    ];
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: [], parModePlan: {}, erreursParMode: { script: 2, ideas: 1 }, erreursTotal: 3, erreursRecentes }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate((seuil) => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
      // Simule une visite précédente il y a 1 jour : les 2 erreurs "script"
      // (2-3 jours) sont donc déjà connues, seule "ideas" (à l'instant) est nouvelle.
      localStorage.setItem('scriptura_erreurs_vues_le', seuil);
    }, new Date(maintenant - 24 * 3600000).toISOString());
    await connecterAbonne(page, { code: 'FONDATEUR', plan: 'admin' });
    await page.waitForTimeout(400);

    const badges = await page.evaluate(() => Array.from(document.querySelectorAll('.nav-admin-badge')).map(b => b.textContent));
    assert.deepEqual(badges, ['1', '1'], 'le badge doit afficher 1 (la seule nouvelle erreur), pas 3 (le total)');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

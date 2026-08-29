// Vérifie que la carte "Échecs de génération" distingue visuellement les
// échecs NOUVEAUX (rouge) des échecs déjà consultés lors d'une visite
// précédente (doré), retour direct du propriétaire : "lorsque y'a de
// nouvelle erreur que le nombre soit en rouge, sinon en doré, et quand je
// consulte les nouvelles elles deviennent anciennes donc dorées". La
// distinction se fait par horodatage de la dernière visite du tableau de
// bord (scriptura_erreurs_vues_le, voir js/admin.js), pas par un simple
// compte total (qui peut rester identique si une vieille erreur sort de la
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

    // ── Première visite (jamais consulté avant) : tout est nouveau, rouge ──
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const premiereVisite = await page.evaluate(() => {
      const carte = document.querySelector('.score-card-alerte');
      const num = carte ? carte.querySelector('.score-global-num') : null;
      return { alerte: !!carte, couleur: num ? num.style.color : null, texte: num ? num.textContent : null };
    });
    assert.equal(premiereVisite.alerte, true, 'première visite : jamais consulté, doit être en alerte');
    assert.match(premiereVisite.couleur, /248, ?113, ?113|#f87171/, 'première visite : le total doit être rouge (rien consulté encore)');
    assert.equal(premiereVisite.texte, '1');

    // ── Deuxième visite, mêmes données (rien de nouveau depuis la 1ère) : doré ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(400);
    const deuxiemeVisite = await page.evaluate(() => {
      const carte = document.querySelector('.score-card');
      const alerte = document.querySelector('.score-card-alerte');
      const num = carte ? carte.querySelector('.score-global-num') : null;
      return { alerte: !!alerte, couleur: num ? num.style.color : null };
    });
    assert.equal(deuxiemeVisite.alerte, false, 'rien de nouveau depuis la 1ère visite : la carte ne doit plus être en alerte');
    assert.match(deuxiemeVisite.couleur, /gold/, 'rien de nouveau : le total doit être doré');

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
      const num = carte ? carte.querySelector('.score-global-num') : null;
      const lignes = Array.from(document.querySelectorAll('.erreur-mode-ligne')).map(l => ({
        texte: l.textContent,
        couleur: l.querySelector('b')?.style.color
      }));
      return { alerte: !!carte, totalCouleur: num ? num.style.color : null, texte: num ? num.textContent : null, lignes };
    });
    assert.equal(troisiemeVisite.alerte, true, 'une nouvelle erreur est arrivée : la carte doit repasser en alerte');
    assert.match(troisiemeVisite.totalCouleur, /248, ?113, ?113|#f87171/, 'le total doit repasser au rouge');
    assert.equal(troisiemeVisite.texte, '2');
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

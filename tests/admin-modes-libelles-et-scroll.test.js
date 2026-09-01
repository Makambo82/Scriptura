// Retour du propriétaire, capture du Tableau de bord (carte "Générations
// par mode") : deux problèmes constatés en prod.
// 1) La colonne "Non-abonné" sortait complètement de l'écran sur certains
// navigateurs mobiles, aucun moyen de la voir (le tableau comprimait ses
// colonnes fixes jusqu'à perdre la dernière plutôt que de déborder de
// façon visible). Corrigé : la grille garde une largeur minimale, le
// débordement glisse au doigt (.admin-modes-scroll, overflow-x:auto).
// 2) Les libellés de mode étaient les clés internes techniques telles
// quelles ("diagnosticSommaire", "analyseVirale"), collées et en
// minuscule, jamais pensées pour être lues par un humain. Corrigé : une
// table de correspondance (MODE_LABELS_ADMIN, js/admin.js) donne un
// libellé français, espacé, avec une majuscule initiale, cohérent avec
// les noms publics utilisés ailleurs dans l'app (ex. "Analyse vidéo",
// même eyebrow que le module lui-même).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

test('Tableau de bord, carte "Générations par mode" : libellés lisibles et tableau scrollable pour voir la colonne Non-abonné', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 360, height: 800 } });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await poserMocksReseau(page, {
      data: (body) => {
        if (body.resource === 'admin-stats') {
          return {
            ok: true,
            codesActifsRecents: [], erreursParMode: {}, erreursTotal: 0, erreursRecentes: [],
            parModePlan: {
              fondateur: { script: 41, story: 17, serie: 13, diagnosticSommaire: 9, tendances: 6, analyseVirale: 5, storyboardSeul: 4, ideas: 2, audit: 1 },
              pro: { script: 1, diagnosticSommaire: 2 },
              creator: { diagnosticSommaire: 1 },
              nonAbonne: { ideas: 3 }
            }
          };
        }
        return undefined;
      }
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_unlocked', 'true');
      localStorage.setItem('scriptura_code', 'ADMINTEST');
      localStorage.setItem('scriptura_plan', 'creator');
      localStorage.setItem('scriptura_is_admin', 'true');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    const html = await page.evaluate(async () => await chargerCarteModes());
    await page.evaluate((h) => {
      const div = document.createElement('div');
      div.id = 'carteModesTest';
      div.innerHTML = h;
      document.body.appendChild(div);
    }, html);

    const infos = await page.evaluate(() => {
      const wrap = document.getElementById('carteModesTest');
      const scrollEl = wrap.querySelector('.admin-modes-scroll');
      const lignes = Array.from(wrap.querySelectorAll('.admin-modes-row')).map(r =>
        Array.from(r.querySelectorAll('span')).map(s => s.textContent));
      return {
        aScroll: !!scrollEl,
        overflowX: scrollEl ? getComputedStyle(scrollEl).overflowX : null,
        libelles: lignes.map(l => l[0]),
        nonAbonneVisibleDansHeader: wrap.querySelector('.admin-modes-header')?.textContent.includes('Non-abonné')
      };
    });

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(infos.aScroll, 'le tableau doit être enveloppé dans un conteneur scrollable');
    assert.equal(infos.overflowX, 'auto', 'le conteneur doit permettre de glisser horizontalement');
    assert.ok(infos.nonAbonneVisibleDansHeader, 'la colonne Non-abonné doit exister dans l\'en-tête (accessible en scrollant) : ' + JSON.stringify(infos));

    // Aucun libellé ne doit être une clé technique brute (camelCase collé,
    // minuscule) : chacun doit être lisible et commencer par une majuscule.
    const attendus = ['Script', 'Récit', 'Série', 'Diagnostic sommaire', 'Tendances', 'Analyse vidéo', 'Storyboard seul', 'Idées', 'Diagnostic complet'];
    attendus.forEach(label => {
      assert.ok(infos.libelles.includes(label), `le libellé "${label}" doit apparaître dans le tableau : ${JSON.stringify(infos.libelles)}`);
    });
    infos.libelles.forEach(l => {
      assert.ok(/^[A-ZÀ-Ý]/.test(l), `chaque libellé doit commencer par une majuscule : "${l}"`);
      assert.ok(!/[a-zà-ÿ][A-ZÀ-Ý]/.test(l), `aucun libellé ne doit rester en camelCase technique collé : "${l}"`);
    });
  } finally {
    await navigateur.close();
    await arreter();
  }
});

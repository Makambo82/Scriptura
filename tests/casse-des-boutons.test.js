// Retour du propriétaire : « regarde dans toute l'app s'il y a encore des
// boutons avec du texte en minuscule et corrige en majuscule ».
//
// L'INVENTAIRE A ÉTÉ FAIT EN MESURANT, écran par écran, la casse CALCULÉE par
// le navigateur, et pas en lisant la feuille de style : une règle peut exister
// et perdre en spécificité contre une autre, auquel cas le CSS dit une chose
// et l'écran une autre. 52 éléments remontaient, et tous n'étaient pas des
// boutons, d'où le partage que ces tests verrouillent.
//
// CE QUI DOIT ÊTRE EN CAPITALES : les boutons d'ACTION et de CHOIX, ceux qui
// ont un fond ou un cadre et qu'on lit comme des boutons.
//
// CE QUI DOIT RESTER EN MINUSCULES, et c'est tout aussi important : un
// balayage trop large abîmerait l'app. Le second test existe pour empêcher
// qu'on « finisse le travail » en passant tout en capitales.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

// Les boutons qui doivent crier, et les écrans où on les trouve.
const EN_CAPITALES = '.grid-btn, .plan-btn, .ds-scope-btn, .rappel-btn, '
  + '.outils-mini-btn, .script-edit-btn, .car-format-btn, .hero-cta-label';

// Ceux qui ne doivent PAS y passer, avec la raison, affichée en cas d'échec.
const EN_MINUSCULES = [
  ['.btn-back', 'le SEUL bouton que le propriétaire a explicitement voulu en minuscules. '
    + 'En capitales espacées, « ← RETOUR » pèse autant qu\'une action principale alors que ce '
    + 'n\'est qu\'un lien de navigation.'],
  ['.custom-select-trigger', 'c\'est un CHAMP, pas un bouton : il affiche une valeur choisie '
    + '(« 1x (normal) », le nom d\'une niche). Mettre une valeur saisie en capitales, c\'est la '
    + 'déformer.'],
  ['.footer-link-btn', 'ce sont des LIENS de pied de page, sans fond ni cadre. Huit phrases en '
    + 'capitales à la suite, ça crie au lieu d\'aider.'],
  ['.sidebar-item', 'ce sont des lignes de MENU, pas des boutons.'],
  ['.hero-mode-btn', 'ce sont des CARTES : un titre ET une description sur plusieurs lignes.'],
  ['.plan-toggle-btn', 'une carte de tarif, qui contient un prix.'],
  ['.serie-suggest-btn', 'une phrase entière (« Ou laisse Scriptura me proposer des concepts »), '
    + 'qui ne se met pas en capitales.']
];

const ECRANS = [
  ['accueil', () => {}],
  ['script', () => { chooseMode('script'); if (typeof showStep === 'function') showStep(2); }],
  ['idées', () => chooseMode('ideas')],
  ['récit', () => chooseMode('story')],
  ['carrousel', () => chooseMode('carrousel')],
  ['diagnostic', () => chooseMode('audit')],
  ['historique', () => openHistory()],
  ['montage manuel', () => ouvrirMontageManuelAccueil()],
  ['outils TikTok', () => ouvrirOutilsTikTok()],
  ['storyboard seul', () => openStoryboardSeul()]
];

async function ouvrirApp(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(async () => { await document.fonts.ready; });
  return page;
}

// Chaque écran repart de l'accueil, sinon une fenêtre laissée ouverte par
// l'écran précédent fausse les mesures suivantes. Vu pendant l'inventaire :
// une modale de tarifs restée ouverte faisait remonter un faux débordement sur
// six écrans d'affilée.
async function allerA(page, ouvrir) {
  await page.evaluate(() => {
    unlocked = true;
    localStorage.setItem('scriptura_code', 'CELINE7F2A');
    localStorage.setItem('scriptura_unlocked', 'true');
    document.body.classList.add('is-unlocked', 'peut-monter-video');
    if (typeof closePlans === 'function') closePlans();
    if (typeof goHome === 'function') goHome();
  });
  await page.waitForTimeout(200);
  await page.evaluate('(' + ouvrir.toString() + ')()');
  await page.waitForTimeout(400);
}

test('aucun bouton d\'action ou de choix n\'est resté en minuscules', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const restes = [];
    let vus = 0;

    for (const [nom, ouvrir] of ECRANS) {
      await allerA(page, ouvrir);
      const r = await page.evaluate((sel) => {
        const dehors = [];
        let n = 0;
        document.querySelectorAll(sel).forEach(b => {
          if (b.offsetParent === null) return;
          if (b.getBoundingClientRect().width < 2) return;
          const txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
          if (!/\p{L}{2}/u.test(txt)) return;   // pictogramme seul, rien à mettre en capitales
          n++;
          if (getComputedStyle(b).textTransform !== 'uppercase') {
            dehors.push((b.className || b.tagName) + ' · « ' + txt.slice(0, 30) + ' »');
          }
        });
        return { dehors, n };
      }, EN_CAPITALES);
      vus += r.n;
      r.dehors.forEach(d => restes.push(nom + ' → ' + d));
    }

    // Sans ce garde-fou, le test passerait au vert le jour où un renommage de
    // classe ferait que le balayage ne trouve plus RIEN à vérifier.
    assert.ok(vus >= 15,
      'REGRESSION : seulement ' + vus + ' boutons trouvés sur ' + ECRANS.length + ' écrans. '
      + 'Les classes visées ont dû être renommées : ce test ne vérifie plus rien, en restant vert.');

    assert.deepEqual(restes, [],
      'REGRESSION : ces boutons VISIBLES sont repassés en minuscules alors que tous leurs voisins '
      + 'sont en capitales. Un bouton oublié au milieu des autres se voit tout de suite et fait '
      + 'plus désordre que de n\'avoir rien changé :\n  ' + restes.join('\n  '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('et ce qui n\'est pas un bouton n\'a PAS été emporté au passage', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const fautes = [];
    const trouves = new Set();

    for (const [, ouvrir] of ECRANS) {
      await allerA(page, ouvrir);
      const r = await page.evaluate((liste) => {
        const out = [];
        liste.forEach(([sel]) => {
          document.querySelectorAll(sel).forEach(e => {
            if (e.offsetParent === null) return;
            if (e.getBoundingClientRect().width < 2) return;
            out.push({ sel, casse: getComputedStyle(e).textTransform,
              txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) });
          });
        });
        return out;
      }, EN_MINUSCULES);
      r.forEach(x => {
        trouves.add(x.sel);
        if (x.casse === 'uppercase') {
          const raison = (EN_MINUSCULES.find(m => m[0] === x.sel) || [, ''])[1];
          fautes.push(x.sel + ' · « ' + x.txt +' » → ' + raison);
        }
      });
    }

    assert.deepEqual([...new Set(fautes)], [],
      'REGRESSION : le passage en capitales a emporté des éléments qui ne sont pas des boutons '
      + 'd\'action. Chacun a une raison de rester en minuscules :\n  ' + [...new Set(fautes)].join('\n  '));

    // Le balayage doit vraiment RENCONTRER ces éléments, sinon il ne prouve
    // rien : un sélecteur devenu obsolète laisserait ce test vert à vide.
    assert.ok(trouves.size >= 4,
      'REGRESSION : seulement ' + trouves.size + ' des ' + EN_MINUSCULES.length + ' familles '
      + 'protégées ont été rencontrées à l\'écran (' + [...trouves].join(', ') + '). Les autres ont '
      + 'dû être renommées ou retirées : ce test ne les protège plus, en restant vert.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

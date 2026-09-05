// Retour propriétaire, après un « Erreur : Réponse incomplète, réessaie » vu
// en production sur un vrai script : « pourquoi ce premier échec ? ». La
// réponse honnête était qu'on ne pouvait pas savoir, et c'est ça le vrai
// problème.
//
// ANGLE MORT CORRIGÉ ICI. La carte « Échecs de génération » du Tableau de
// bord ne journalisait que les cas où l'appel au modèle ABANDONNE lui-même
// (réseau, délai dépassé, réponse vide, voir callAI dans js/api.js). Or dans
// ce cas précis, l'appel RÉUSSIT et renvoie bien du texte : c'est le contrôle
// de complétude, côté navigateur, qui le rejette ensuite parce qu'il manque
// le script, les hooks, ou que le texte fait moins de la moitié de la
// longueur visée. Rien n'était donc enregistré, et il était impossible de
// savoir si ça arrivait une fois par mois ou dix fois par jour chez les
// abonnés, alors que CHAQUE tentative consomme du quota.
//
// Le cas le plus important à mesurer n'est même pas celui que le créateur
// voit : c'est la RELANCE SILENCIEUSE qui réussit. Elle sauve la génération,
// le créateur ne se rend compte de rien, mais elle a coûté un appel complet
// et une unité de quota. C'est ce chiffre qui prévient avant que le problème
// ne devienne visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const BRIEF = { angle: 'a', promesse: 'p', emotion: 'e', structure: 's' };
const CRITIQUE_OK = { verdict: 'ok', faiblesses: [] };
const bloc = (i, mots) => ({ temps: '0-3 sec', texte: Array.from({ length: mots }, (_, k) => 'mot' + i + k).join(' '), visuel: 'V' + i });

// Script valide : 4 blocs de 36 mots, dans la cible "1 minute".
const SCRIPT_COMPLET = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [0, 1, 2, 3].map(i => bloc(i, 36)),
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};
// Réponse TRONQUÉE comme en vrai : le JSON s'arrête avant d'avoir écrit le
// script et les hooks. C'est exactement ce que produit une réponse coupée par
// le délai côté serveur.
const SCRIPT_TRONQUE = { analyse: 'ok' };

// Pilote une vraie génération de script, en contrôlant ce que renvoie l'étape
// d'écriture au 1er et au 2e essai. Renvoie les journaux d'erreur captés.
async function genererAvecEcriture(page, baseUrl, reponsesEcriture) {
  const journaux = [];
  await poserMocksReseau(page);
  await page.route('**/api/data**', async (route) => {
    try {
      const b = JSON.parse(route.request().postData() || '{}');
      if (b && b.resource === 'erreur') journaux.push(b);
    } catch (e) { /* corps non JSON */ }
    return route.fallback();
  });
  let essaiEcriture = 0;
  await page.route('**/api/generate', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const repondre = (obj) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: JSON.stringify(obj) }] })
    });
    if (body.max_tokens === 2000) return repondre(BRIEF);
    if (body.max_tokens === 16000) {
      const rep = reponsesEcriture[Math.min(essaiEcriture, reponsesEcriture.length - 1)];
      essaiEcriture++;
      return repondre(rep);
    }
    if (body.max_tokens === 2500) return repondre(CRITIQUE_OK);
    return repondre({});
  });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await connecterAbonne(page, { code: 'INCOMPLET' + Math.round(Math.random() * 1e6), plan: 'creator' });
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
  return journaux;
}

test('une relance silencieuse qui SAUVE la génération est quand même enregistrée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // 1er essai tronqué, 2e essai correct : le créateur ne voit RIEN, la
    // génération aboutit. C'est précisément le cas invisible qu'on veut
    // compter, parce qu'il a coûté un appel et du quota.
    const journaux = await genererAvecEcriture(page, baseUrl, [SCRIPT_TRONQUE, SCRIPT_COMPLET]);
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
    await page.waitForTimeout(600);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const incomplets = journaux.filter(j => /réponse incomplète/.test(j.detail || ''));
    assert.equal(incomplets.length, 1,
      'REGRESSION : ce cas n\'était enregistré NULLE PART : ' + JSON.stringify(journaux.map(j => j.detail)));
    assert.equal(incomplets[0].mode, 'script', 'rangé sous le mode Script du Tableau de bord');
    assert.match(incomplets[0].detail, /champs manquants/,
      'la raison exacte doit être dite, sinon le journal n\'apprend rien : ' + incomplets[0].detail);
    assert.match(incomplets[0].detail, /rattrapée par la relance/,
      'et il doit être distingué d\'un échec définitif, sinon impossible de savoir ce que voit vraiment le créateur');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un échec définitif (les DEUX essais tronqués) est enregistré comme tel', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // Les deux essais échouent : c'est le message que le propriétaire a vu.
    const journaux = await genererAvecEcriture(page, baseUrl, [SCRIPT_TRONQUE, SCRIPT_TRONQUE]);
    await page.waitForTimeout(6000);

    // L'erreur affichée au créateur ne doit pas être avalée : elle reste.
    const messageVu = await page.evaluate(() => {
      const el = document.getElementById('errorBox');
      return el ? el.textContent : '';
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS non gérée');
    const incomplets = journaux.filter(j => /réponse incomplète/.test(j.detail || ''));
    assert.equal(incomplets.length, 1, 'un échec définitif doit laisser exactement une trace : '
      + JSON.stringify(journaux.map(j => j.detail)));
    assert.match(incomplets[0].detail, /échec définitif/,
      'distingué de la relance rattrapée : ' + incomplets[0].detail);
    assert.match(messageVu, /incomplète/, 'et le créateur voit toujours son message, la mesure ne change rien pour lui');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une génération qui passe du premier coup n\'enregistre RIEN', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const journaux = await genererAvecEcriture(page, baseUrl, [SCRIPT_COMPLET]);
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });
    await page.waitForTimeout(600);

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const incomplets = journaux.filter(j => /réponse incomplète/.test(j.detail || ''));
    assert.deepEqual(incomplets, [],
      'aucun bruit dans le journal quand tout va bien, sinon le compteur d\'échecs ne veut plus rien dire');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

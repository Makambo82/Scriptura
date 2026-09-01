// Refonte du diagnostic sommaire (analyse par @nom d'utilisateur), demandée
// par le propriétaire après avoir envoyé une vraie capture de la page
// "Analyse de compte" de Vervox : leur FAQ précise "le score sur 100 combine
// 5 métriques pondérées : taux d'engagement (/30), vues moyennes (/25),
// régularité de publication (/20), croissance abonnés (/15) et viralité
// (/10)". Scriptura avait déjà 4 dimensions proches (Engagement/30,
// Portée/30, Régularité/20, Viralité/20) mais pas les mêmes poids, et la
// croissance abonnés restait un simple encart informatif jamais noté.
//
// Ce test verrouille : les 5 dimensions ET leurs poids exacts (30/25/20/15/10,
// vocabulaire propre à Scriptura : "Vues moyennes" et "Croissance abonnés"),
// plus plus aucune trace de "Portée" (l'ancienne dimension ratio vues/abonnés,
// remplacée par des vues moyennes en valeur absolue à seuils adaptés à la
// taille du compte). Le calcul est vérifié EXACTEMENT sur un jeu de données
// calibré (20 vidéos, 15 100 abonnés).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// 20 vidéos calibrées (vues croissantes de 500 à 5000, interactions = 6,5%
// des vues, étalées sur 40 jours ⇒ 3,5 vidéos/semaine). Avec 15 100 abonnés :
// moyVues=1455, medianeVues=1250, maxVues=5000, ratioViral=4.0 exactement,
// tauxEngagementPct=6.5% exactement. Score attendu (voir calibration) :
// Engagement 14/30, Vues moyennes 10/25, Régularité 14/20, Croissance
// abonnés non disponible (pas d'historique), Viralité 6/10.
// Score global = round((14+10+14+6) / (30+25+20+10) * 100) = round(44/85*100) = 52.
const VUES = [500, 600, 700, 800, 900, 1000, 1000, 1100, 1200, 1200, 1300, 1300, 1400, 1500, 1600, 1700, 1800, 2000, 2500, 5000];
const MAINTENANT = Math.floor(Date.now() / 1000);
const MEDIAS = VUES.map((vues, i) => ({
  vues,
  likes: Math.round(vues * 0.05),
  commentaires: Math.round(vues * 0.01),
  partages: Math.round(vues * 0.005),
  date: MAINTENANT - (40 - Math.round(i * 40 / 19)) * 86400,
  desc: 'vidéo de test ' + i
}));

const RAPPORT_IA = {
  profil_trouve: true, compte_verifie: null,
  engagement: { score: null, disponible: true, constat: 'placeholder, recalculé par le code' },
  vues_moyennes: { score: null, disponible: true, constat: 'placeholder, recalculé par le code' },
  regularite: { score: null, disponible: true, constat: 'placeholder, recalculé par le code' },
  croissance_abonnes: { score: null, disponible: false, constat: 'pas d\'historique' },
  viralite: { score: null, disponible: true, constat: 'placeholder, recalculé par le code' },
  sante_compte: 'Bonne',
  bio: { actuelle: 'Créatrice de contenu test', etat: 'claire', critique: 'Bio correcte.', suggestions: [] },
  niche: { disponible: true, nom: 'Niche test', etat: 'claire', analyse: ['Point 1'] },
  top_videos: [], flop_videos: [], concepts_recurrents: [],
  evolution: { pivot: false, constat: 'Constance.', avant: null, apres: null, formule_gagnante: null },
  leviers_prioritaires: [{ titre: 'Test', detail: 'Détail test.' }]
};

test('diagnostic sommaire : les 5 dimensions et poids exacts de Vervox (30/25/20/15/10), plus aucune trace de "Portée"', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await poserMocksReseau(page, { generate: () => ({ content: [{ text: JSON.stringify(RAPPORT_IA) }] }) });
    await page.route('**/api/username-scan', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ profil: { followerCount: 15100, heartCount: 812400 }, medias: MEDIAS })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSVERVOXREFONTE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      document.getElementById('diagSommaireFlow').style.display = 'block';
      document.getElementById('diagSommaireInput').value = 'compte.test';
    });
    await page.evaluate(() => lancerDiagnosticSommaire());
    await page.waitForTimeout(1800);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    const etat = await page.evaluate(() => {
      const cartes = Array.from(document.querySelectorAll('#diagSommaireResults .ds-dim-card')).map(c => ({
        nom: c.querySelector('.ds-dim-name')?.textContent?.trim(),
        badge: c.querySelector('.score-badge')?.textContent?.trim()
      }));
      return {
        score: document.getElementById('dsScoreNum')?.textContent?.trim(),
        cartes,
        texteComplet: document.getElementById('diagSommaireResults')?.textContent || ''
      };
    });

    assert.equal(etat.score, '52', 'le score global doit être calculé exactement selon les nouveaux poids Vervox : ' + JSON.stringify(etat));

    const parCle = {};
    etat.cartes.forEach(c => { parCle[c.nom] = c.badge; });
    assert.equal(parCle['Engagement'], '14/30', 'Engagement doit rester noté sur 30');
    assert.equal(parCle['Vues moyennes'], '10/25', 'Vues moyennes (nouvelle dimension, remplace Portée) doit être notée sur 25');
    assert.equal(parCle['Régularité'], '14/20', 'Régularité doit rester notée sur 20');
    // Retour du propriétaire : une dimension non mesurable (ici, aucun
    // diagnostic précédent de ce compte pour juger la croissance) n'affiche
    // plus de carte "impossible à mesurer", elle disparaît simplement.
    assert.equal(parCle['Croissance abonnés'], undefined, 'Croissance abonnés (non mesurable) ne doit plus afficher de carte du tout : ' + JSON.stringify(etat.cartes));
    assert.equal(parCle['Viralité'], '6/10', 'Viralité doit maintenant être notée sur 10 (et non plus 20)');

    // Aucune trace de l'ancienne dimension "Portée" (ratio vues/abonnés, remplacée).
    assert.ok(!/\bPortée\b/.test(etat.texteComplet), 'la dimension "Portée" doit avoir totalement disparu : ' + etat.texteComplet.slice(0, 300));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

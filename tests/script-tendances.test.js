// Non-régression : le mode Script doit envoyer la recherche de tendances
// TikTok (instructionRechercheTendancesTikTok) sur l'appel de stratégie
// (le Directeur Éditorial, qui choisit l'angle), quelle que soit la niche,
// tout en gardant la vérification factuelle (instructionRechercheWeb,
// appel de rédaction) strictement conditionnée à la niche (Histoire,
// Géopolitique & Actualité), indépendamment l'une de l'autre.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const BRIEF_FAKE = { analyse_strategique: 'A', angle_choisi: 'Angle X', pourquoi_cet_angle: 'P', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
const SCRIPT_FAKE = { score: { viral: 90, hook: 90, engagement: 90, emotion: 90, retention: 90 }, analyse: 'ok', hooks: [{ style: 'x', texte: 'Hook 1' }], script: [{ temps: '0-3 sec', texte: 'Texte', visuel: 'Visuel' }], legende: 'Légende', hashtags: ['#a'], variantes_titre: ['T1'] };

async function genererScript(page, niche, sujet) {
  const requetes = [];
  await poserMocksReseau(page, {
    generate: (body) => { requetes.push(body); return { content: [{ text: JSON.stringify(body.max_tokens === 2000 ? BRIEF_FAKE : SCRIPT_FAKE) }] }; }
  });
  await connecterAbonne(page, { code: 'SCRIPTTEST_' + niche.replace(/\s/g, ''), plan: 'creator' });
  await page.waitForTimeout(200);
  await page.evaluate(({ niche, sujet }) => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('niche').value = niche;
    document.getElementById('sujet').value = sujet;
    document.getElementById('audience').value = '';
    document.getElementById('format').value = '';
    document.getElementById('venteDescription').value = '';
    document.getElementById('viralVideo').value = '';
    if (typeof state !== 'undefined') state.depart = 'un sujet précis';
  }, { niche, sujet });
  await page.evaluate(() => generate());
  await page.waitForTimeout(2000);
  return requetes;
}

test('mode Script : recherche de tendances toujours active sur le brief, vérification factuelle conditionnée à la niche', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    // Niche factuelle (Histoire) : les deux recherches doivent être actives.
    const page1 = await navigateur.newPage();
    await page1.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const requetes1 = await genererScript(page1, 'Histoire', 'Le roi Béhanzin face à la colonisation');
    const brief1 = requetes1.find(r => r.max_tokens === 2000);
    const ecriture1 = requetes1.find(r => r.max_tokens === 16000);
    assert.ok(brief1, 'l\'appel de stratégie (brief) doit avoir eu lieu');
    assert.equal(brief1.web_search, true, 'le brief doit toujours chercher les tendances TikTok, quelle que soit la niche');
    assert.match(JSON.stringify(brief1.messages), /de définir l'angle et la stratégie/, 'le prompt du brief doit contenir l\'instruction de tendances TikTok');
    assert.ok(ecriture1, 'l\'appel de rédaction doit avoir eu lieu');
    assert.equal(ecriture1.web_search, true, 'la rédaction doit vérifier les faits pour une niche historique');
    await page1.close();

    // Niche neutre (Business) : le brief cherche quand même les tendances,
    // mais la rédaction ne doit PAS déclencher de vérification factuelle
    // (aucun besoin, ni coût ni lenteur supplémentaires pour cette niche).
    const page2 = await navigateur.newPage();
    await page2.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    const requetes2 = await genererScript(page2, 'Business & Entrepreneuriat', 'Comment lancer une petite entreprise');
    const brief2 = requetes2.find(r => r.max_tokens === 2000);
    const ecriture2 = requetes2.find(r => r.max_tokens === 16000);
    assert.equal(brief2.web_search, true, 'le brief doit chercher les tendances même pour une niche neutre');
    assert.equal(ecriture2.web_search, false, 'la rédaction ne doit pas vérifier de faits pour une niche non-factuelle');
    await page2.close();
  } finally {
    await navigateur.close();
    await arreter();
  }
});

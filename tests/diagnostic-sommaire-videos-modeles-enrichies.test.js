// Après avoir étudié une vraie capture Vervox de leur "Analyse de
// concurrents" (PDF envoyé par le propriétaire), leur exemple réel montre un
// constat par vidéo modèle bien plus riche que le nôtre : 2-3 phrases qui
// pointent la statistique précise qui ressort, expliquent la mécanique
// structurelle du succès, et donnent une instruction de transposition
// explicite ("Format à reproduire immédiatement par @otakube_app..."). Notre
// prompt plafonnait jusqu'ici le constat de chaque vidéo top/flop à "1
// phrase", nettement plus pauvre. Ce test verrouille que le prompt envoyé à
// l'IA demande désormais 2-3 phrases avec ces 3 exigences précises, en mode
// "mon compte" comme en mode concurrent (avec la consigne de transposition
// explicite propre au mode concurrent).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const VIDEOS_FAKE = Array.from({ length: 5 }, (_, i) => ({
  vues: 1000 + i * 500, likes: 50, commentaires: 10, partages: 5,
  date: Math.floor(Date.now() / 1000) - i * 5 * 86400, desc: 'Sujet de test ' + i
}));

async function lancerDiagnostic(page, { moi }) {
  // lancerDiagnosticSommaire() déclenche ENSUITE, en tâche de fond, un 2e
  // appel IA pour la recommandation croisée (afficherOpportuniteDiagSommaire,
  // js/recommandations.js) : on capture TOUS les prompts et on retient celui
  // du diagnostic lui-même (reconnaissable à sa consigne top/flop vidéos),
  // jamais juste "le dernier" qui appartiendrait à cet autre appel.
  const prompts = [];
  await poserMocksReseau(page, {
    generate: (body) => { prompts.push(body?.messages?.[0]?.content); return { content: [{ text: '{}' }] }; }
  });
  await page.route('**/api/username-scan', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ profil: { followerCount: 15100, heartCount: 812400 }, medias: VIDEOS_FAKE })
  }));
  await page.evaluate(() => {
    if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
    document.getElementById('diagSommaireFlow').style.display = 'block';
    document.getElementById('diagSommaireInput').value = 'compte.test';
  });
  await page.evaluate((moi) => { if (typeof choisirScopeSommaire === 'function') choisirScopeSommaire(moi); }, moi);
  await page.evaluate(() => lancerDiagnosticSommaire());
  await page.waitForTimeout(1800);
  return prompts.find(p => typeof p === 'string' && /TOP & FLOP VIDÉOS|CARTONS/.test(p)) || null;
}

test('diagnostic sommaire : le constat des vidéos top/flop demande 2-3 phrases riches (stat + mécanique + action), en mode "mon compte"', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSVIDEOSMOI' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    const prompt = await lancerDiagnostic(page, { moi: true });
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(typeof prompt === 'string' && prompt.length > 100, 'le prompt doit avoir été capturé');
    assert.match(prompt, /Le CONSTAT \(2-3 phrases, jamais une seule\)/, 'la consigne doit exiger 2-3 phrases, pas 1');
    assert.match(prompt, /pointer la statistique précise qui ressort/i, 'la consigne doit exiger de pointer une statistique précise');
    assert.match(prompt, /MÉCANIQUE structurelle/, 'la consigne doit exiger d\'expliquer la mécanique structurelle du succès/échec');
    assert.match(prompt, /quoi RÉUTILISER sur tes prochaines vidéos/, 'en mode "mon compte", la consigne doit demander quoi réutiliser (pas une transposition vers un tiers)');
    assert.match(prompt, /"constat": "<2-3 phrases : stat qui ressort \+ mécanique structurelle \+ quoi réutiliser>"/, 'le schéma JSON doit refléter la nouvelle exigence pour top_videos');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('diagnostic sommaire : le constat des vidéos modèles exige une transposition explicite, en mode concurrent', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'DSVIDEOSCONC' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    const prompt = await lancerDiagnostic(page, { moi: false });
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));

    assert.ok(typeof prompt === 'string' && prompt.length > 100, 'le prompt doit avoir été capturé');
    assert.match(prompt, /Le CONSTAT \(2-3 phrases, jamais une seule\)/, 'la consigne doit exiger 2-3 phrases, pas 1');
    assert.match(prompt, /instruction de TRANSPOSITION explicite et actionnable pour TOI/, 'en mode concurrent, la consigne doit exiger une transposition explicite vers l\'utilisateur');
    assert.match(prompt, /"constat": "<2-3 phrases : stat qui ressort chez lui \+ mécanique structurelle \+ instruction de transposition explicite pour toi>"/, 'le schéma JSON doit refléter la nouvelle exigence pour top_videos en mode concurrent');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

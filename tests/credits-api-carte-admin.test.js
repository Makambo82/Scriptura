// Carte « Crédits API » dans le vrai Tableau de bord (js/admin-credits.js).
// Le calcul est testé côté serveur (tests/credits-api.test.js) : ici on vérifie
// ce que le fondateur VOIT et FAIT, dans un navigateur réel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const il = (j) => new Date(Date.now() - j * 86400000).toISOString();

function etatDemo(surcharges = {}) {
  return {
    ok: true, actualiseLe: new Date(Date.now() - 120000).toISOString(), niveau: 'bas',
    fournisseurs: {
      elevenlabs: { mode: 'reel', disponible: true, utilises: 61200, limite: 100000, restants: 38800, pourcentRestant: 39, remiseAZeroUnix: Math.floor(Date.now() / 1000) + 9 * 86400, palier: 'creator', niveau: 'ok' },
      tikhub: { mode: 'reel', disponible: true, soldeUsd: 7.5, champs: [], niveau: 'ok' },
      anthropic: {
        mode: 'estime', saisie: { soldeUsd: 25, le: il(9) },
        estimation: { restantCentimes: 410, depuisCentimes: 2090, soldeSaisiCentimes: 2500, joursDepuisSaisie: 9, rythmeParJourCentimes: 232, joursRestants: 1, pourcentRestant: 16, niveau: 'bas' },
        depenseMesureeCentimes: 2090, niveau: 'bas'
      },
      together: { mode: 'estime', saisie: null, estimation: null, depenseMesureeCentimes: 120, niveau: null, prixUsd: { image: 0.04, video: 0.08 }, compte: { image: 30, video: 2 } },
      ...surcharges
    }
  };
}

async function ouvrirTableau(page, baseUrl) {
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
}

test('la carte distingue « réel » et « estimé », alerte en tête, et propose la saisie du solde', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, { data: (b) => b.action === 'credits-api' ? etatDemo() : (b.resource === 'admin-stats' && !b.action ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [] } : undefined) });
    await ouvrirTableau(page, baseUrl);
    await page.waitForSelector('#adminCreditsApi [data-fournisseur="anthropic"]');

    const vu = await page.evaluate(() => {
      const carte = document.getElementById('adminCreditsApi');
      const ligne = (f) => { const l = carte.querySelector(`[data-fournisseur="${f}"]`); return l ? l.textContent.replace(/\s+/g, ' ') : null; };
      return {
        alerte: carte.classList.contains('score-card-alerte'),
        anthropic: ligne('anthropic'), elevenlabs: ligne('elevenlabs'), together: ligne('together'), tikhub: ligne('tikhub'),
        texte: carte.textContent,
        // la carte doit venir AVANT les échecs de génération et les autres cartes
        position: Array.from(document.getElementById('adminStats').children).indexOf(carte)
      };
    });
    assert.equal(vu.alerte, true, 'un fournisseur « bas » doit mettre la carte en alerte');
    assert.match(vu.anthropic, /estimé/i, 'Anthropic : solde ESTIMÉ, étiqueté comme tel');
    assert.match(vu.anthropic, /4,10 \$/, 'le solde estimé est affiché en dollars');
    assert.match(vu.anthropic, /bas/i);
    assert.match(vu.elevenlabs, /réel/i, 'ElevenLabs : solde RÉEL');
    assert.match(vu.elevenlabs, /38\D?800/, 'crédits ElevenLabs restants');
    assert.match(vu.tikhub, /7,50 \$/);
    assert.match(vu.together, /Renseigner mon solde/, 'Together sans saisie : invite à renseigner, jamais un chiffre inventé');
    assert.ok(!/≈/.test(vu.together), 'REGRESSION : pas de solde estimé affiché sans solde saisi');
    assert.match(vu.texte, /recharge avant la panne/i);
    assert.ok(!/—/.test(vu.texte), 'jamais de tiret cadratin côté utilisateur');
    assert.ok(vu.position <= 1, 'la carte est en tête du tableau de bord : position ' + vu.position);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#adminCreditsApi a[href^="https://"]').length), 4, 'un lien de recharge par fournisseur');
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally { await navigateur.close(); await arreter(); }
});

test('saisie du solde Together : prix préremplis, envoi correct, formulaire refermé, erreurs de saisie claires', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const envois = [];
    await poserMocksReseau(page, { data: (b) => {
      if (b.action === 'credits-api') return etatDemo();
      if (b.action === 'credits-api-solde') {
        envois.push(b);
        return etatDemo({ together: { mode: 'estime', saisie: { soldeUsd: 12.5, le: new Date().toISOString() },
          estimation: { restantCentimes: 1250, depuisCentimes: 0, soldeSaisiCentimes: 1250, joursDepuisSaisie: 0, rythmeParJourCentimes: null, joursRestants: null, pourcentRestant: 100, niveau: 'ok' },
          depenseMesureeCentimes: 120, niveau: 'ok', prixUsd: { image: 0.05, video: 0.08 }, compte: { image: 30, video: 2 } } });
      }
      if (b.resource === 'admin-stats' && !b.action) return { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [] };
    } });
    await ouvrirTableau(page, baseUrl);
    await page.waitForSelector('#adminCreditsApi [data-fournisseur="together"]');

    await page.click('[data-fournisseur="together"] .credits-btn');
    assert.equal(await page.inputValue('#creditsPrixImage'), '0,04', 'les prix actuels sont préremplis');
    assert.equal(await page.inputValue('#creditsPrixVideo'), '0,08');

    // solde vide : refus local, rien envoyé
    await page.click('#creditsEnregistrer-together');
    assert.match(await page.textContent('#creditsFormErr-together'), /solde en dollars/i);
    assert.equal(envois.length, 0, 'une saisie invalide ne part jamais au serveur');

    await page.fill('#creditsSolde-together', '12,5');
    await page.fill('#creditsPrixImage', '0,05');
    await page.click('#creditsEnregistrer-together');
    await page.waitForFunction(() => !document.getElementById('creditsForm-together'));
    assert.equal(envois.length, 1);
    assert.deepEqual(
      { f: envois[0].fournisseur, s: envois[0].soldeUsd, pi: envois[0].prixImageUsd, pv: envois[0].prixVideoUsd },
      { f: 'together', s: 12.5, pi: 0.05, pv: 0.08 },
      'la virgule française est comprise (12,5 => 12.5)');
    const apres = await page.textContent('#adminCreditsApi [data-fournisseur="together"]');
    assert.match(apres, /12,50 \$/, 'la carte affiche tout de suite le nouveau solde, sans rechargement');
    assert.match(apres, /Mettre à jour mon solde/);
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally { await navigateur.close(); await arreter(); }
});

test('la carte ne retarde JAMAIS le tableau de bord : les autres cartes s\'affichent avant sa réponse', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    let liberer;
    const attente = new Promise(r => { liberer = r; });
    await poserMocksReseau(page, { data: (b) => b.resource === 'admin-stats' && !b.action ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [] } : undefined });
    // Enregistrée APRÈS les mocks : avec Playwright, la dernière route posée est consultée en premier.
    await page.route('**/api/data', async (route) => {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (b.action !== 'credits-api') return route.fallback();
      await attente; // ElevenLabs / TikHub qui traînent
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(etatDemo()) });
    });
    await ouvrirTableau(page, baseUrl);
    await page.waitForSelector('#adminCreditsApi');
    const pendant = await page.evaluate(() => ({
      carte: document.getElementById('adminCreditsApi').textContent,
      autresCartes: document.querySelectorAll('#adminStats > .score-card').length
    }));
    assert.match(pendant.carte, /Lecture des soldes en cours/, 'la carte annonce son chargement');
    assert.ok(pendant.autresCartes >= 3, 'REGRESSION : le tableau de bord attendait la carte Crédits API (jusqu\'à 8 s) avant de s\'afficher');
    liberer();
    await page.waitForSelector('#adminCreditsApi [data-fournisseur="anthropic"]');
  } finally { await navigateur.close(); await arreter(); }
});

test('panne de la carte : message clair et bouton Réessayer, le reste du tableau de bord intact', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page, { data: (b) => b.action === 'credits-api' ? { indisponible: true } : (b.resource === 'admin-stats' && !b.action ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [] } : undefined) });
    await ouvrirTableau(page, baseUrl);
    await page.waitForFunction(() => { const c = document.getElementById('adminCreditsApi'); return !!c && /Indisponible/.test(c.textContent); });
    assert.ok(await page.evaluate(() => !!document.querySelector('#adminCreditsApi .credits-btn')), 'bouton Réessayer présent');
    assert.ok(await page.evaluate(() => document.querySelectorAll('#adminStats > .score-card').length >= 3), 'les autres cartes restent affichées');
  } finally { await navigateur.close(); await arreter(); }
});

test('réponse « ok » SANS le détail des fournisseurs : la carte se dégrade, le Tableau de bord ne plante pas', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    // Cas réel rencontré par un test existant : tout appel admin-stats reçoit la même réponse générique.
    await poserMocksReseau(page, { data: (b) => b.resource === 'admin-stats' ? { ok: true, codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [] } : undefined });
    await ouvrirTableau(page, baseUrl);
    await page.waitForFunction(() => { const c = document.getElementById('adminCreditsApi'); return !!c && /Indisponible/.test(c.textContent); });
    assert.deepEqual(erreursJs, [], 'REGRESSION : une réponse sans « fournisseurs » faisait planter l\'affichage');
    assert.ok(await page.evaluate(() => document.querySelectorAll('#adminStats > .score-card').length >= 3), 'le reste du tableau de bord est intact');
  } finally { await navigateur.close(); await arreter(); }
});

// Capture réelle du propriétaire (18 novembre) : ElevenLabs et TikHub refusent la lecture du solde
// (clés sans la permission), Anthropic et Together n'ont pas encore de solde saisi.
test('clés sans permission de lecture : messages en français qui disent quoi faire, aucun JSON brut, pas de « rien d\'urgent » trompeur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    const detailTikHub = 'API Token lacks required permissions, please edit the API Token scopes at user dashboard';
    await poserMocksReseau(page, { data: (b) => b.action === 'credits-api' ? {
      ok: true, actualiseLe: new Date().toISOString(), niveau: 'ok',
      fournisseurs: {
        elevenlabs: { mode: 'reel', disponible: false, raison: 'droit_lecture', detail: 'The API key you used is missing the permission user_read to execute this operation.' },
        tikhub: { mode: 'reel', disponible: false, raison: 'droit_lecture', detail: detailTikHub },
        anthropic: { mode: 'estime', saisie: null, estimation: null, depenseMesureeCentimes: 0, niveau: null },
        together: { mode: 'estime', saisie: null, estimation: null, depenseMesureeCentimes: 0, niveau: null, prixUsd: { image: 0.04, video: 0.08 }, compte: { image: 0, video: 0 } }
      } } : (b.resource === 'admin-stats' && !b.action ? { codes: [], parModePlan: {}, erreursParMode: {}, erreursTotal: 0, erreursRecentes: [] } : undefined) });
    await ouvrirTableau(page, baseUrl);
    await page.waitForSelector('#adminCreditsApi [data-fournisseur="tikhub"]');
    const vu = await page.evaluate(() => {
      const c = document.getElementById('adminCreditsApi');
      const l = (f) => c.querySelector(`[data-fournisseur="${f}"]`).textContent.replace(/\s+/g, ' ');
      return { titre: c.querySelector('.score-title').textContent, entete: c.textContent, eleven: l('elevenlabs'), tikhub: l('tikhub') };
    });
    assert.equal(vu.titre, 'Crédits API', 'REGRESSION : « API » s\'affichait en minuscules (« Crédits api »)');
    assert.match(vu.entete, /Aucun solde n'est suivi/, 'REGRESSION : « Rien d\'urgent » alors qu\'aucun fournisseur n\'est suivi');
    assert.ok(!/Rien d'urgent/.test(vu.entete));
    assert.match(vu.eleven, /User\s*:\s*Read/, 'ElevenLabs : la permission à activer est nommée');
    assert.match(vu.eleven, /Actualiser/);
    assert.ok(!/missing the permission/i.test(vu.eleven), 'l\'anglais brut du fournisseur ne s\'affiche pas quand on a une explication française');
    assert.match(vu.tikhub, /permission/i, 'TikHub : expliqué comme un réglage de clé');
    assert.match(vu.tikhub, /tableau de bord TikHub/);
    assert.ok(vu.tikhub.includes(detailTikHub), 'la réponse de TikHub est citée en entier, sans coupure en plein mot');
    assert.ok(!/[{}]|request_id|"detail"/.test(vu.tikhub + vu.eleven), 'REGRESSION : du JSON brut s\'affichait à l\'écran');
    assert.ok(!/non lu.*non lu.*non lu/.test(vu.entete));
    assert.deepEqual(erreursJs, []);
  } finally { await navigateur.close(); await arreter(); }
});

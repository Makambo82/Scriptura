// Audit du 3 septembre 2026 (modes Script et Récit), trois failles de durée
// et de qualité corrigées ensemble :
//
// 1. RYTHME DE PAROLE INCOHÉRENT. Les cibles de mots de Script/Récit sont
//    calibrées sur ~2,5 mots/seconde, mais le minutage affiché des blocs
//    était calculé avec MOTS_PAR_SEC (2,8), un SEUIL DE DÉCOUPAGE en plans
//    du storyboard, jamais une promesse de durée. Un script "2 minutes"
//    parfaitement calibré affichait donc une timeline s'arrêtant à 1min44.
//    Corrigé par MOTS_PAR_SEC_PARLE/dureeParleeDe (js/storyboard.js),
//    désormais la seule référence pour ce qui promet une durée.
//
// 2. ÉTIQUETTES PARASITES NON FILTRÉES. "Le champ texte ne contient jamais
//    de minutage" n'était qu'une consigne de prompt côté Script et Récit
//    (Série, lui, avait déjà un filet déterministe). Pire : ce filet ne
//    reconnaissait que "[0-3 s]" et laissait passer les formats réellement
//    produits et explicitement interdits ("[0-3 sec]", "(0 à 3 secondes)",
//    "[0:00-0:05]", "0-3 sec :"). Restés dans le texte, ils étaient comptés
//    comme des mots (faussant le contrôle de durée ET le minutage), lus à
//    voix haute par la synthèse vocale du montage, et copiés par le créateur.
//
// 3. FAUX POSITIFS. Le filet renforcé ne doit jamais manger de la prose
//    légitime ("Tu as 3-4 secondes pour convaincre.").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

// Charge la fonction de nettoyage partagée telle qu'elle est réellement
// définie dans js/serie.js (pas une copie qui pourrait diverger).
function chargerNettoyage() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'serie.js'), 'utf8');
  const bloc = src.match(/function nettoyerEtiquettesEpisodeSerie[\s\S]*?\n}/);
  assert.ok(bloc, 'nettoyerEtiquettesEpisodeSerie doit exister dans js/serie.js');
  // eslint-disable-next-line no-eval
  return eval('(' + bloc[0].replace('function nettoyerEtiquettesEpisodeSerie', 'function') + ')');
}

test('nettoyage des étiquettes : tous les formats de minutage interdits par les prompts sont retirés', () => {
  const nettoyer = chargerNettoyage();
  const cas = [
    ['[0-3 sec] Tu sens ton coeur.', 'Tu sens ton coeur.', 'format exact du mode Script'],
    ['[0-3 s] Tu sens.', 'Tu sens.', 'format court déjà couvert avant l\'audit'],
    ['(0 à 3 secondes) Tu sens.', 'Tu sens.', 'parenthèses et "à" comme séparateur'],
    ['[0:00-0:05] Tu sens.', 'Tu sens.', 'format mm:ss, cité comme interdit par le prompt Récit'],
    ['0-3 sec : Tu sens.', 'Tu sens.', 'préfixe sans crochets, interdit par la règle 9 du mode Script'],
    ['0:00-0:05 : Tu sens.', 'Tu sens.', 'préfixe mm:ss sans crochets'],
    ['[45-60 min] Le film.', 'Le film.', 'unité minutes'],
    ['VOIX OFF : Tu sens.', 'Tu sens.', 'étiquette de tournage'],
    ['[ÉCRAN NOIR]', '', 'étiquette seule sur sa ligne']
  ];
  for (const [entree, attendu, pourquoi] of cas) {
    assert.equal(nettoyer(entree), attendu, `${pourquoi} : ${JSON.stringify(entree)}`);
  }
});

test('nettoyage des étiquettes : la prose légitime n\'est JAMAIS mutilée (pas de faux positif)', () => {
  const nettoyer = chargerNettoyage();
  // Toutes ces phrases sont du texte réellement parlé, elles doivent sortir
  // strictement intactes : un filet trop gourmand détruirait le sens du script.
  const prose = [
    'Tu as 3-4 secondes pour convaincre.',
    'Il gagne 20-30 minutes par jour.',
    'Le plan risqué a marché.',
    'Entre 2 et 3 secondes, tout bascule.',
    'Un score de 12-20 en maths.'
  ];
  for (const phrase of prose) {
    assert.equal(nettoyer(phrase), phrase, `cette prose doit rester intacte : ${JSON.stringify(phrase)}`);
  }
});

test('rythme de parole : une seule référence pour tout ce qui promet une durée', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);

    const mesures = await page.evaluate(() => ({
      parle: typeof MOTS_PAR_SEC_PARLE === 'number' ? MOTS_PAR_SEC_PARLE : null,
      decoupage: typeof MOTS_PAR_SEC === 'number' ? MOTS_PAR_SEC : null,
      dureeParlee100Mots: typeof dureeParleeDe === 'function' ? dureeParleeDe(new Array(100).fill('mot').join(' ')) : null
    }));

    assert.equal(mesures.parle, 2.5, 'le rythme de parole de référence doit être 2,5 mots/seconde (~150 mots/minute)');
    assert.equal(mesures.decoupage, 2.8, 'le seuil de découpage du storyboard reste distinct, il ne promet aucune durée');
    assert.equal(mesures.dureeParlee100Mots, 40, '100 mots doivent durer 40 secondes au rythme de parole de référence');

    // Cohérence de bout en bout : avec les cibles de mots du mode Script, la
    // durée parlée du centre de fourchette doit tomber à moins de 10% de la
    // durée choisie par le créateur. C'est exactement ce qui était faux
    // avant l'audit (-14% à -18% avec l'ancien rythme de 2,8).
    const cibles = [
      { centre: 69, secondes: 30 },
      { centre: 142.5, secondes: 60 },
      { centre: 290, secondes: 120 },
      { centre: 435, secondes: 180 },
      { centre: 730, secondes: 300 }
    ];
    for (const c of cibles) {
      const dureeReelle = c.centre / mesures.parle;
      const ecart = Math.abs(dureeReelle - c.secondes) / c.secondes;
      assert.ok(ecart < 0.10,
        `pour ${c.secondes}s, la cible de ${c.centre} mots donne ${dureeReelle.toFixed(0)}s, soit ${Math.round(ecart * 100)}% d'écart (doit rester sous 10%)`);
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Script : étiquettes parasites retirées, minutage recalculé cohérent avec la durée choisie', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
    const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };
    // 7 blocs de 20 mots parlés = 140 mots, pile dans la cible "1 minute"
    // (130-155), mais les 3 premiers blocs portent une étiquette parasite
    // que l'IA n'aurait jamais dû produire.
    const parasite = (i) => (i === 0 ? '[0-3 sec] ' : i === 1 ? 'VOIX OFF : ' : i === 2 ? '0:00-0:05 : ' : '');
    const SCRIPT = {
      analyse: 'ok',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      script: Array.from({ length: 7 }, (_, i) => ({
        temps: '0-3 sec',
        texte: parasite(i) + 'Phrase numéro ' + i + ' de ce script de test avec assez de mots pour peser vraiment dans la durée visée.',
        visuel: 'Visuel ' + i
      })),
      legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
    };

    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const rep = body.max_tokens === 2000 ? BRIEF : (body.max_tokens === 16000 ? SCRIPT : CRITIQUE_OK);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(rep) }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'AUDITDUREE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Développement personnel';
      document.getElementById('sujet').value = 'Sujet de test';
      ['audience', 'format', 'venteDescription', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      state.depart = 'un sujet précis';
    });
    await page.evaluate(() => generate());
    await page.waitForTimeout(3500);

    const resultat = await page.evaluate(() => ({
      temps: currentScript.map(s => s.temps),
      textes: currentScript.map(s => s.texte),
      mots: currentScript.map(s => (s.texte.match(/\S+/g) || []).length).reduce((a, b) => a + b, 0)
    }));

    // 1. Plus aucune étiquette parasite dans le texte parlé livré.
    const restants = resultat.textes.filter(t => /\[\s*\d|VOIX OFF|^\s*\d{1,2}:\d{2}\s*:/i.test(t));
    assert.equal(restants.length, 0, 'aucune étiquette/minutage ne doit subsister dans le texte parlé : ' + JSON.stringify(restants));

    // 2. Les mots parasites ne sont plus comptés dans la durée : le script
    //    reste dans la cible "1 minute" (130-155 mots) au lieu d'être gonflé.
    assert.ok(resultat.mots >= 130 && resultat.mots <= 160,
      'le compte de mots parlés doit refléter le texte réellement dit, sans les étiquettes : ' + resultat.mots);

    // 3. Le minutage recalculé doit correspondre au rythme de parole réel,
    //    donc tomber près de la durée choisie (1 minute), jamais 15% en dessous.
    const finSec = parseInt(resultat.temps[resultat.temps.length - 1].split('-')[1], 10);
    const attendu = resultat.mots / 2.5;
    assert.ok(Math.abs(finSec - attendu) <= 2,
      `la fin du minutage (${finSec}s) doit correspondre au temps de parole réel (${attendu.toFixed(0)}s)`);
    assert.ok(finSec >= 50 && finSec <= 70,
      `pour "1 minute" demandée, la timeline doit tomber près de 60s, pas 15% en dessous : ${finSec}s`);

    // 4. Le minutage est bien cumulatif et strictement croissant.
    let precedent = -1;
    for (const t of resultat.temps) {
      const debut = parseInt(t.split('-')[0], 10);
      assert.ok(debut > precedent, 'chaque bloc doit démarrer après le précédent : ' + JSON.stringify(resultat.temps));
      precedent = debut;
    }

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit format long : la génération aboutit alors qu\'aucune durée cible n\'existe', async () => {
  // Non-régression d'un bug introduit pendant l'audit puis rattrapé par les
  // tests : le budget de mots donné à la passe de clôture était calculé hors
  // de sa garde, or wt (cibles de mots) vaut null en format LONG, où le
  // créateur ne choisit aucune durée. wt.min levait alors une TypeError qui
  // faisait échouer TOUTE la génération de récit long, silencieusement du
  // point de vue du créateur (écran d'erreur générique).
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const RECIT = {
      titre: 'Titre du récit',
      ton: 'Dramatique',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      recit: [
        { segment: 'Hook', texte: 'Il pensait avoir tout prévu. Personne ne l\'a vu venir.' },
        { segment: 'Ouverture', texte: 'Aujourd\'hui, on parle de cette affaire que tout le monde a oubliée depuis.' },
        { segment: 'Clôture', texte: 'Alors, que retenir de cette histoire ? Que le silence protège ? Que la peur commande ? Ou que tout se jouait avant ? Moi, je t\'ai pas raconté une chute. Je t\'ai montré un miroir.' }
      ],
      legende: 'Légende', hashtags: ['#a']
    };

    await poserMocksReseau(page, {
      generate: () => ({ content: [{ text: JSON.stringify(RECIT) }] })
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'RECITLONG' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('storyInput').value = 'Un fait historique marquant à raconter';
      // Format long : aucune durée choisie, donc aucune cible de mots (wt null).
      storyFormat = 'long';
      storyDuree = '';
      storyTon = '';
    });
    await page.evaluate(() => generateStory());
    await page.waitForTimeout(2500);

    const etat = await page.evaluate(() => ({
      recitAffiche: !!(typeof currentStory !== 'undefined' && currentStory && Array.isArray(currentStory.recit) && currentStory.recit.length),
      resultsVisible: document.getElementById('storyResults') && document.getElementById('storyResults').style.display !== 'none'
    }));

    assert.equal(etat.recitAffiche, true, 'un récit long doit être généré et rendu, jamais interrompu par une erreur de calcul de budget');
    assert.equal(etat.resultsVisible, true, 'l\'écran de résultat du récit doit être visible');
    const typeErrors = erreursJs.filter(m => /TypeError/i.test(m));
    assert.equal(typeErrors.length, 0, 'aucune TypeError ne doit survenir en format long : ' + typeErrors.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : la durée choisie est connue du rédacteur, du critique ET du réviseur', async () => {
  // Retour propriétaire : le mode Récit doit calquer la structure du modèle
  // sur le sujet DANS LA DURÉE CHOISIE. Or la consigne de longueur
  // n'atteignait que le prompt d'écriture. Le Critique, lui, comparait un
  // récit de 30 secondes (69 mots visés) au script COMPLET du modèle (386 à
  // 768 mots) tout en ayant pour règle de signaler les étapes "développées
  // alors que le modèle ne fait que les effleurer, ou l'inverse" : la
  // compression correcte était donc signalée comme un écart de calque, puis
  // le Réviseur "corrigeait" en rallongeant, faisant sauter la durée. Ce
  // test verrouille la circulation de la contrainte jusqu'aux trois agents.
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const RECIT = {
      titre: 'Titre', ton: 'Dramatique', modele_utilise: 'inconnu',
      hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
      recit: [
        { segment: 'Hook', texte: 'Il pensait avoir tout prévu. Personne ne l\'a vu venir.' },
        { segment: 'Ouverture', texte: 'Aujourd\'hui, on parle de cette affaire oubliée de tous.' },
        { segment: 'Clôture', texte: 'Alors, que retenir de cette histoire ? Que le silence protège ? Que la peur commande ? Ou que tout se jouait avant ? Moi, je t\'ai pas raconté une chute. Je t\'ai montré un miroir.' }
      ],
      legende: 'L', hashtags: ['#a']
    };
    // Critique volontairement sévère : force le déclenchement du Réviseur,
    // pour capturer AUSSI son prompt.
    const CRITIQUE = {
      verdict: 'à améliorer',
      viralite: { hook: 10, curiosite: 10, rythme: 10, progression: 10, transitions: 10, revelation: 10, memorisation: 10 },
      segments_faibles: [{ index: 1, probleme: 'trop plat' }],
      faiblesses: ['segment 1 trop plat']
    };

    const prompts = [];
    await poserMocksReseau(page, {
      generate: (body) => {
        const texte = JSON.stringify(body.messages || []);
        prompts.push(texte);
        // Le critique renvoie un verdict, tout le reste renvoie un récit.
        return { content: [{ text: JSON.stringify(/Critique Éditorial/.test(texte) ? CRITIQUE : RECIT) }] };
      }
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'RECITDUREE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('storyInput').value = 'Un fait historique marquant à raconter';
      storyFormat = 'court';
      storyDuree = '30 secondes';
      storyTon = '';
    });
    await page.evaluate(() => generateStory());
    await page.waitForTimeout(3000);

    const promptEcriture = prompts.find(p => /Rédacteur|raconte|récit/i.test(p) && /LONGUEUR/.test(p));
    const promptCritique = prompts.find(p => /Critique Éditorial/.test(p));
    const promptReviseur = prompts.find(p => /Réviseur en Chef/.test(p) && /SEGMENTS À RÉÉCRIRE/.test(p));

    assert.ok(promptEcriture, 'le prompt d\'écriture doit avoir été envoyé');
    assert.match(promptEcriture, /RÉFÉRENCE DE STRUCTURE, JAMAIS DE LONGUEUR/,
      'le rédacteur doit être averti que le modèle ne dicte pas la longueur');
    assert.match(promptEcriture, /BUDGET CONCRET POUR 30 secondes/,
      'le rédacteur doit recevoir un budget de segments concret pour la durée choisie');

    assert.ok(promptCritique, 'le prompt du critique doit avoir été envoyé');
    assert.match(promptCritique, /DURÉE CHOISIE PAR LE CRÉATEUR/,
      'le critique doit connaître la durée choisie, sinon il pénalise la compression correcte');
    assert.match(promptCritique, /n'est donc PAS un écart de calque/,
      'le critique doit savoir qu\'une étape resserrée n\'est pas un écart de calque');

    assert.ok(promptReviseur, 'le prompt du réviseur doit avoir été envoyé');
    assert.match(promptReviseur, /DURÉE CHOISIE PAR LE CRÉATEUR/,
      'le réviseur doit connaître la durée choisie, sinon ses réécritures la font sauter');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour créateur (3 septembre 2026) : 2-3 minutes d'attente jugées trop
// longues pour générer un script ou un récit. Diagnostic : la complétion
// des hooks manquants et le contrôle de durée tournaient l'UN APRÈS
// L'AUTRE alors qu'ils ne se touchent jamais (la complétion des hooks ne
// lit/écrit que parsed.hooks, le contrôle de durée ne lit/écrit que
// parsed.script/parsed.recit). Lancés désormais en parallèle via
// Promise.all (voir js/generation.js et js/storytelling.js), sans toucher
// une seule ligne de prompt ni de logique de correction : ce test PROUVE
// empiriquement (mesure de temps) que l'exécution est bien concurrente,
// pas seulement que le code semble correct à la lecture.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const DELAI_MS = 700; // délai artificiel identique sur les deux appels ciblés

test('Script : la complétion des hooks et le contrôle de durée s\'exécutent en parallèle, pas en série', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const BRIEF = { analyse_strategique: 'A', angle_choisi: 'X', structure: 'S', emotion_dominante: 'E', strategie_hook: 'H', strategie_retention: 'R', strategie_cta: 'C' };
    const CRITIQUE_OK = { verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } };
    // 6 blocs de 13 mots parlés = 78 mots. Deux bornes à respecter, toutes
    // deux recalculées après le recentrage des cibles de durée du 6 septembre
    // (« 1 minute » = 138-163 mots, voir js/generation.js) :
    //   - sous hardMin (124 = 138 x 0,9), donc la correction de durée part ;
    //   - au-dessus du seuil de complétude (69 = 50 % de 138), sinon c'est un
    //     nouveau brouillon complet qui part à la place, et ce test n'observe
    //     plus ce qu'il croit observer.
    // Seulement 2 hooks (sur 5) pour déclencher aussi la complétion des hooks.
    const SCRIPT_INCOMPLET = {
      analyse: 'ok',
      hooks: [{ style: 'x', texte: 'Hook 1' }, { style: 'x', texte: 'Hook 2' }],
      script: Array.from({ length: 6 }, (_, i) => ({
        temps: '0-3 sec', texte: 'Phrase numéro ' + i + ' avec plusieurs mots pour peser dans le compte total ici.', visuel: 'V' + i
      })),
      legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
    };
    const HOOKS_MANQUANTS = { hooks: [{ style: 'y', texte: 'Hook 3' }, { style: 'y', texte: 'Hook 4' }, { style: 'y', texte: 'Hook 5' }] };
    // 9 blocs de 15 mots = 135 mots, dans la fenêtre acceptée (124-179 pour
    // « 1 minute ») : la boucle de correction de durée s'arrête après cette
    // seule tentative, ce que le test compte.
    const SCRIPT_CORRIGE = {
      script: Array.from({ length: 9 }, (_, i) => ({
        temps: '0-3 sec', texte: 'Phrase corrigée numéro ' + i + ' avec plusieurs mots pour peser correctement dans le compte total ici.', visuel: 'V' + i
      }))
    };

    let debutHooks = null, finHooks = null, debutDuree = null, finDuree = null;
    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 2000) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(BRIEF) }] }) });
      }
      if (body.max_tokens === 16000) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_INCOMPLET) }] }) });
      }
      if (body.max_tokens === 2500) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(CRITIQUE_OK) }] }) });
      }
      // Distingue par le CONTENU du prompt, jamais par max_tokens seul : le
      // juge indépendant (evaluerScriptGenere) utilise LUI AUSSI 1200
      // tokens, et se déclenche juste après ce Promise.all (séquentiel, à
      // raison). Un premier essai de ce test qui filtrait uniquement sur
      // max_tokens===1200 capturait par erreur l'appel du juge (qui arrive
      // après la fin réelle de la complétion des hooks) au lieu de celui de
      // la complétion des hooks elle-même, faisant croire à tort à une
      // exécution séquentielle alors que le code est bien parallèle
      // (vérifié séparément par instrumentation directe du code réel).
      const texteBody = JSON.stringify(body.messages || []);
      if (body.max_tokens === 1200 && /hook\(s\) manquant/.test(texteBody)) {
        debutHooks = Date.now();
        await new Promise(r => setTimeout(r, DELAI_MS));
        finHooks = Date.now();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(HOOKS_MANQUANTS) }] }) });
      }
      if (body.max_tokens === 8000) {
        debutDuree = Date.now();
        await new Promise(r => setTimeout(r, DELAI_MS));
        finDuree = Date.now();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(SCRIPT_CORRIGE) }] }) });
      }
      // Juge indépendant (evaluerScriptGenere) et autres appels annexes :
      // réponse neutre rapide, il doit rester séquentiel et hors mesure ici.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PARALLELE' + Math.round(Math.random() * 1e6), plan: 'creator' });
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

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.ok(debutHooks && finHooks, 'l\'appel de complétion des hooks doit avoir eu lieu');
    assert.ok(debutDuree && finDuree, 'l\'appel de correction de durée doit avoir eu lieu');

    // Preuve empirique du parallélisme : si les deux appels se chevauchent
    // dans le temps (l'un commence avant que l'autre finisse), c'est qu'ils
    // tournent bien en même temps, pas l'un après l'autre. En série, la
    // fenêtre de l'un ne pourrait jamais chevaucher celle de l'autre.
    const chevauchement = debutHooks < finDuree && debutDuree < finHooks;
    assert.ok(chevauchement,
      `les deux appels doivent se chevaucher dans le temps (parallèle), pas s'enchaîner (série) : hooks=[${debutHooks},${finHooks}] duree=[${debutDuree},${finDuree}]`);

    // Preuve complémentaire : l'écart entre le début du premier appel et la
    // fin du second reste proche d'UN SEUL délai (DELAI_MS), jamais deux
    // délais cumulés comme ce serait le cas en exécution séquentielle.
    const dernierDebut = Math.max(debutHooks, debutDuree);
    const dernierFin = Math.max(finHooks, finDuree);
    const fenetreTotale = dernierFin - Math.min(debutHooks, debutDuree);
    assert.ok(fenetreTotale < DELAI_MS * 1.8,
      `la fenêtre totale (${fenetreTotale}ms) doit rester proche d'un seul délai (${DELAI_MS}ms), pas de deux cumulés (${DELAI_MS * 2}ms) : preuve d'exécution parallèle, pas séquentielle`);

    // Et bien sûr : le résultat final doit être correct malgré la
    // parallélisation, les deux corrections ayant bien leur effet.
    const resultat = await page.evaluate(() => ({ nbHooks: currentHooks.length, nbBlocs: currentScript.length }));
    assert.equal(resultat.nbHooks, 5, 'les 3 hooks manquants doivent avoir été ajoutés aux 2 déjà présents : ' + resultat.nbHooks);
    assert.equal(resultat.nbBlocs, 9, 'le script corrigé (9 blocs) doit avoir remplacé le script incomplet (6 blocs) : ' + resultat.nbBlocs);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('Récit : la complétion des hooks et le contrôle de durée s\'exécutent en parallèle, pas en série', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    // 3 segments de ~13 mots = 39 mots : sous hardMinStory (54, pour "1
    // minute" = 130-155 -> 117 avant, mais storytelling.js utilise ses
    // propres cibles ; ici on force via storyDuree='1 minute') mais
    // au-dessus d'un seuil de complétude raisonnable. Seulement 2 hooks.
    const RECIT_INCOMPLET = {
      titre: 'Titre', ton: 'Dramatique', modele_utilise: 'inconnu',
      hooks: [{ style: 'x', texte: 'Hook 1' }, { style: 'x', texte: 'Hook 2' }],
      recit: [
        { segment: 'Hook', texte: 'Il pensait avoir tout prévu, mais personne ne voyait venir ce qui allait suivre.' },
        { segment: 'Ouverture', texte: 'Aujourd\'hui, on parle de cette affaire oubliée par presque tout le monde depuis.' },
        { segment: 'Clôture', texte: 'Alors, que retenir de cette histoire ? Que le silence protège ? Que la peur commande ? Ou que tout se jouait avant ? Moi, je t\'ai pas raconté une chute. Je t\'ai montré un miroir.' }
      ],
      legende: 'L', hashtags: ['#a']
    };
    const HOOKS_MANQUANTS = { hooks: [{ style: 'y', texte: 'Hook 3' }, { style: 'y', texte: 'Hook 4' }, { style: 'y', texte: 'Hook 5' }] };
    const RECIT_CORRIGE = {
      recit: Array.from({ length: 10 }, (_, i) => ({ segment: 'Segment ' + i, texte: 'Phrase corrigée numéro ' + i + ' avec plusieurs mots pour peser correctement dans le compte total du récit ici.' }))
    };

    let debutHooks = null, finHooks = null, debutDuree = null, finDuree = null;
    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.max_tokens === 400) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ titres: [] }) }] }) });
      }
      if (body.max_tokens === 16000) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(RECIT_INCOMPLET) }] }) });
      }
      if (body.max_tokens === 2500) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify({ verdict: 'excellent', viralite: { hook: 18, curiosite: 18, rythme: 18, progression: 18, transitions: 18, revelation: 18, memorisation: 18 } }) }] }) });
      }
      // Même précaution que le test Script (voir son commentaire dédié) :
      // la normalisation hook/ouverture, séquentielle et postérieure à ce
      // Promise.all, utilise ELLE AUSSI 1200 tokens. Distingue donc par le
      // contenu réel du prompt, jamais par max_tokens seul.
      const texteBody = JSON.stringify(body.messages || []);
      if (body.max_tokens === 1200 && /hook\(s\) manquant/.test(texteBody)) {
        debutHooks = Date.now();
        await new Promise(r => setTimeout(r, DELAI_MS));
        finHooks = Date.now();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(HOOKS_MANQUANTS) }] }) });
      }
      if (body.max_tokens === 8000) {
        debutDuree = Date.now();
        await new Promise(r => setTimeout(r, DELAI_MS));
        finDuree = Date.now();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: JSON.stringify(RECIT_CORRIGE) }] }) });
      }
      // Normalisation hook/ouverture, clôture, juge indépendant : tous
      // séquentiels après ce Promise.all, réponse neutre rapide, hors mesure.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{}' }] }) });
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'PARALLELE2' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('storyInput').value = 'Un fait historique marquant à raconter';
      storyFormat = 'court';
      storyDuree = '1 minute';
      storyTon = '';
    });
    await page.evaluate(() => generateStory());
    await page.waitForTimeout(4500);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
    assert.ok(debutHooks && finHooks, 'l\'appel de complétion des hooks doit avoir eu lieu');
    assert.ok(debutDuree && finDuree, 'l\'appel de correction de durée doit avoir eu lieu');

    const chevauchement = debutHooks < finDuree && debutDuree < finHooks;
    assert.ok(chevauchement,
      `les deux appels doivent se chevaucher dans le temps (parallèle), pas s'enchaîner (série) : hooks=[${debutHooks},${finHooks}] duree=[${debutDuree},${finDuree}]`);

    const fenetreTotale = Math.max(finHooks, finDuree) - Math.min(debutHooks, debutDuree);
    assert.ok(fenetreTotale < DELAI_MS * 1.8,
      `la fenêtre totale (${fenetreTotale}ms) doit rester proche d'un seul délai (${DELAI_MS}ms), pas de deux cumulés : preuve d'exécution parallèle`);

    const resultat = await page.evaluate(() => ({ nbHooks: currentStory.hooks.length, nbSegments: currentStory.recit.length }));
    assert.equal(resultat.nbHooks, 5, 'les 3 hooks manquants doivent avoir été ajoutés aux 2 déjà présents : ' + resultat.nbHooks);
    assert.equal(resultat.nbSegments, 10, 'le récit corrigé (10 segments) doit avoir remplacé le récit incomplet (3 segments) : ' + resultat.nbSegments);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

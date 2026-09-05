// INCIDENT RÉEL, rapporté par le propriétaire le 5 septembre, capture à
// l'appui. Objectif Ventes, photo d'un gel minceur jointe. Le script livré
// ouvrait sur « Ce gel viral à 15 euros qui promet des abdos en 3 jours est
// une arnaque totale », déroulait pourquoi ça ne peut pas marcher, et
// concluait par « clique sur le lien en bio pour accéder au vrai programme
// qui marche. Pas de gel. »
//
// Autrement dit : l'app a pris le produit du créateur, l'a mis en accusation
// dans sa propre vidéo, et a renvoyé son audience ailleurs. Le pire résultat
// possible, et il notait 84/100, parce que rien dans le score ne mesure ça.
//
// LA CAUSE N'EST PAS LE MODÈLE, CE SONT NOS CONSIGNES, et une partie venait
// de nous mot pour mot :
//   - le prompt des trois angles proposés (js/niche-auto.js) demandait
//     explicitement « un angle qui démonte une croyance du marché ». Sur un
//     produit, la croyance la plus facile à démonter, c'est le produit ;
//   - le Directeur Éditorial (js/generation.js) réclame des leviers de
//     tension (contradiction, révélation, coût caché, risque, secret) sans
//     jamais dire où les pointer ;
//   - et nulle part il n'était écrit que ce produit est CELUI DU CRÉATEUR.
//     Interdire d'INVENTER, ce qui était déjà en place, n'a jamais interdit
//     d'ATTAQUER.
//
// Ces tests verrouillent la règle aux trois endroits où elle doit exister, et
// vérifient qu'elle reste conditionnelle : sans produit chargé, elle
// n'alourdit aucun prompt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const bloc = (i, mots) => ({ temps: '0-3 sec', texte: Array.from({ length: mots }, (_, k) => 'mot' + i + k).join(' '), visuel: 'V' + i });
const SCRIPT_OK = {
  analyse: 'ok',
  hooks: Array.from({ length: 5 }, (_, i) => ({ style: 'x', texte: 'Hook ' + i })),
  script: [0, 1, 2, 3].map(i => bloc(i, 36)),
  legende: 'L', hashtags: ['#a'], variantes_titre: ['T']
};
const BRIEF = {
  analyse_strategique: 'a', angle_choisi: 'b', structure: 'c',
  emotion_dominante: 'd', strategie_hook: 'e', strategie_retention: 'f', strategie_cta: 'g',
  produit_concret: 'un gel raffermissant en pot de 200 ml'
};

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

// Les mots qui ont réellement causé l'incident, et ceux de la même famille.
const INTERDITS = ['arnaque', 'escroquerie', 'inefficace', 'inutile', 'trop cher'];

test('les trois angles proposés doivent TOUS vendre, aucun ne peut viser le produit', () => {
  const src = lire('niche-auto.js');
  const i = src.indexOf('ANGLES DE VIDÉO');
  assert.ok(i > 0, 'le prompt des angles doit exister');
  const prompt = src.slice(i, i + 2000);

  assert.ok(!/démonte une croyance du marché/.test(prompt),
    'REGRESSION : cette formule exacte est ce qui a produit l\'angle "ton produit est une arnaque"');
  assert.match(prompt, /RÈGLE ABSOLUE/,
    'la règle doit être posée comme absolue, sinon elle passe après les consignes créatives');
  assert.match(prompt, /APPARTIENT au créateur/,
    'le modèle doit savoir à QUI est ce produit : c\'est toute la différence');
  assert.match(prompt, /jamais le produit du créateur/i,
    'la cible du levier critique doit être nommée, sinon elle retombe sur le produit');
});

// Le vrai test : on capture les DEUX prompts RÉELLEMENT envoyés (Directeur
// puis Rédacteur) au cours d'une génération complète, plutôt que de relire le
// code. C'est le seul moyen de savoir ce que le modèle reçoit vraiment, et
// c'est précisément la leçon de l'incident précédent : le contexte de vente
// existait, mais n'atteignait pas l'étage où le texte est écrit.
test('la règle part aux DEUX étages du mode Script, pas seulement au Directeur', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const prompts = [];
    await poserMocksReseau(page);
    await page.route('**/api/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const contenu = body.messages && body.messages[0] && body.messages[0].content;
      const texte = typeof contenu === 'string'
        ? contenu
        : (Array.isArray(contenu) ? contenu.map(p => p && p.text ? p.text : '').join('\n') : '');
      prompts.push({ maxTokens: body.max_tokens, texte });
      const repondre = (obj) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ content: [{ text: JSON.stringify(obj) }] })
      });
      if (body.max_tokens === 2000) return repondre(BRIEF);
      if (body.max_tokens === 16000) return repondre(SCRIPT_OK);
      if (body.max_tokens === 2500) return repondre({ verdict: 'ok', faiblesses: [] });
      return repondre({});
    });

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'VENTE' + Math.round(Math.random() * 1e6), plan: 'creator' });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      masquerTousLesEcrans();
      document.getElementById('niche').value = 'Santé & Bien-être';
      document.getElementById('sujet').value = 'le geste que tout le monde rate avec ce gel';
      document.getElementById('venteDescription').value = 'un gel raffermissant';
      ['audience', 'format', 'viralVideo'].forEach(id => { document.getElementById(id).value = ''; });
      venteFichier = { base64: 'ZmF1c3NlLXBob3Rv', mediaType: 'image/png', nom: 'gel.png' };
      state.depart = 'un sujet précis';
      state.objectif = 'Générer des ventes via mon contenu';
      selectedDuree = '1 minute';
    });
    await page.evaluate(() => generate());
    await page.waitForFunction(() => typeof currentScript !== 'undefined' && currentScript && currentScript.length, null, { timeout: 25000 });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const directeur = prompts.find(p => p.maxTokens === 2000);
    const redacteur = prompts.find(p => p.maxTokens === 16000);
    assert.ok(directeur && redacteur, 'les deux passes doivent avoir eu lieu');

    for (const [nom, p] of [['Directeur', directeur.texte], ['Rédacteur', redacteur.texte]]) {
      assert.match(p, /RÈGLE ABSOLUE/, nom + ' : la règle doit y être, et posée comme absolue');
      assert.match(p, /APPARTIENT au créateur/, nom + ' : il doit savoir à QUI est ce produit');
      for (const mot of INTERDITS) {
        assert.ok(p.includes(mot), nom + ' : le mot "' + mot + '" doit être explicitement interdit, '
          + 'une interdiction vague ne tient pas devant des consignes créatives insistantes');
      }
      assert.match(p, /jamais vers une autre solution/,
        nom + ' : REGRESSION : le script renvoyait l\'audience vers "le vrai programme qui marche"');
    }

    // Et le Directeur doit savoir où pointer ses leviers de tension : c'est
    // eux, laissés sans cible, qui ont choisi le produit comme coupable.
    assert.match(directeur.texte, /Un angle qui met le produit en accusation est éliminé d'office/,
      'REGRESSION : les trois angles du Directeur doivent tous vendre');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('sans objectif Ventes ni produit, la règle n\'alourdit aucun prompt', () => {
  const src = lire('generation.js');
  // La règle est portée par venteContexteScript et venteRappelRedacteur, tous
  // deux vides hors objectif Ventes : c'est ce lien qu'on verrouille.
  assert.match(src, /const venteContexteScript = \(estObjectifVentes/,
    'le contexte de vente doit rester conditionné à l\'objectif Ventes');
  assert.match(src, /\$\{REGLE_PRODUIT_DU_CREATEUR\}`\n\s*: '';/,
    'la règle doit vivre DANS venteContexteScript, donc disparaître avec lui');
});

test('le Carrousel porte la même règle, et seulement avec un produit', () => {
  const src = lire('carrousel.js');
  const i = src.indexOf('function blocVenteCarrousel');
  const bloc = src.slice(i, src.indexOf('\n}', i));
  assert.match(bloc, /if \(!ctx\.venteDescription && !ctx\.venteFichier\) return '';/,
    'le bloc entier ne doit exister que si le créateur vend vraiment quelque chose');
  assert.match(bloc, /RÈGLE ABSOLUE/);
  assert.match(bloc, /APPARTIENT au créateur/);
  for (const mot of INTERDITS) {
    assert.ok(bloc.includes(mot), 'le mot "' + mot + '" doit être interdit aussi côté Carrousel');
  }
  assert.match(bloc, /jamais vers une autre solution/,
    'la dernière slide doit mener au produit du créateur, pas ailleurs');
});

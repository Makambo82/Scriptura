// Défaut trouvé en construisant le banc de comparaison des modèles d'images
// (outils/comparer-modeles-images.js) : en le lançant avec une clé factice, le
// message d'échec n'était pas « clé refusée » mais
//
//     Unexpected token 'H', "Host not i"... is not valid JSON
//
// La même ligne existait dans l'app, à deux endroits, et ce message-là est
// AFFICHÉ au créateur dans la boîte d'erreur du montage.
//
// DEUX CONSÉQUENCES, et la seconde est la plus grave :
//
//  1. Le créateur lit une erreur de parseur JavaScript à la place de « le
//     service d'images est momentanément indisponible ».
//  2. Pour les images, la SyntaxError sortait de la boucle AVANT toute lecture
//     du statut HTTP. Les retentatives (TENTATIVES_MAX = 3) ne se
//     déclenchaient donc JAMAIS pour la panne passagère qu'elles existent
//     précisément pour absorber. Un 502 de passerelle était traité comme un
//     échec définitif.
//
// ET ÇA POLLUE LE CHOIX DU MODÈLE : un modèle jugé « instable côté Together »
// a pu l'être à travers ce filtre, ses pannes de passerelle apparaissant comme
// des échecs définitifs et illisibles. C'est la raison pour laquelle ce
// correctif passe AVANT la comparaison des modèles.
//
// Ce fichier verrouille la FAMILLE, pas un endroit : les trois appels à un
// fournisseur externe de ce module doivent lire leur réponse de la même façon.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'api', 'montage-media.js'), 'utf8');

test('plus aucun appel fournisseur ne fait confiance à rep.json()', () => {
  // `rep.json()` nu, sans .catch : la ligne exacte qui produisait le message.
  const nus = SOURCE.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => /await\s+rep\.json\(\)/.test(l) && !/\.catch\(/.test(l) && !/^\s*\/\//.test(l));

  assert.deepEqual(nus.map(x => 'ligne ' + x.n + ' : ' + x.l.trim()), [],
    'REGRESSION : un appel fournisseur lit sa réponse avec rep.json() sans garde. Si le '
    + 'fournisseur répond du HTML (502 de passerelle), le créateur verra « Unexpected token » '
    + 'dans sa boîte d\'erreur. Utilise lireJsonOuNull.');
});

test('la fonction de lecture est écrite UNE fois et partagée', () => {
  assert.ok(/function analyserJson\(/.test(SOURCE), 'analyserJson doit exister');
  assert.ok(/async function lireJsonOuNull\(/.test(SOURCE), 'lireJsonOuNull doit exister');

  // Les trois appels externes (images, voix off, musique) doivent tous passer
  // par elle. Deux d'entre eux ne le faisaient pas.
  //
  // ON COMPTE LES APPELS, PAS LES OCCURRENCES : compter « analyserJson(brut) »
  // comptait aussi sa propre DÉCLARATION, ce qui gonflait le total de un et
  // laissait le contrôle de morsure passer alors qu'un fournisseur avait été
  // débranché. Un compteur qui compte la définition ne mesure rien.
  const usages = (SOURCE.match(/await lireJsonOuNull\(rep\)|= analyserJson\(brut\)/g) || []).length;
  assert.ok(usages >= 3,
    'REGRESSION : seulement ' + usages + ' appel(s) passe(nt) par la lecture commune. Les trois '
    + 'fournisseurs (Together images, ElevenLabs voix, ElevenLabs musique) doivent se comporter '
    + 'pareil : c\'est en en oubliant un que le défaut a survécu à sa première correction.');
});

test('une réponse illisible sur une panne passagère est RÉESSAYÉE, pas abandonnée', () => {
  const bloc = SOURCE.slice(SOURCE.indexOf('async function genererAvecForme'));
  const corps = bloc.slice(0, bloc.indexOf('\n}\n'));

  assert.ok(/data === null/.test(corps),
    'genererAvecForme doit traiter explicitement le cas « réponse illisible »');
  assert.ok(/rep\.status >= 500 \|\| rep\.status === 429/.test(corps),
    'REGRESSION : une réponse illisible accompagnée d\'un 5xx ou d\'un 429 doit repasser par les '
    + 'retentatives. C\'était le vrai dégât : la boucle existait et ne servait jamais dans le seul '
    + 'cas qui la justifie.');
  assert.ok(/tentative < TENTATIVES_MAX/.test(corps),
    'la retentative doit rester bornée par TENTATIVES_MAX');
});

test('le message montré au créateur est en français et dit quoi comprendre', () => {
  // Les apostrophes sont ÉCHAPPÉES dans la source (d\'images) : chercher la
  // forme lisible ne trouverait rien et le test passerait à côté.
  for (const attendu of [
    'Le service d\\\'images a répondu quelque chose d\\\'illisible',
    'Le service de voix off a répondu quelque chose d\\\'illisible'
  ]) {
    assert.ok(SOURCE.includes(attendu),
      'REGRESSION : message manquant ou réécrit → « ' + attendu + ' ». Le créateur ne doit jamais '
      + 'lire un message de parseur.');
  }
  // Et le statut HTTP y figure : sans lui, impossible de distinguer une panne
  // du fournisseur d'une clé expirée quand un abonné signale le problème.
  assert.ok(/illisible \(statut '\s*\+ rep\.status/.test(SOURCE.replace(/\s+/g, ' '))
    || /statut ' \+ rep\.status/.test(SOURCE),
    'le message doit porter le statut HTTP, c\'est ce qui rend un signalement exploitable');
});

// ── LA FAMILLE CÔTÉ TESTS, ET C'EST ELLE QUI A FAILLI FAIRE ANNULER LE
//    CORRECTIF ──
//
// Sept tests sont tombés en corrigeant l'app. Pas parce que le correctif était
// mauvais : parce que leurs faux `fetch` renvoyaient `{ ok, json }`, un objet
// SANS `.text()`, alors qu'une vraie réponse en a toujours une. Ces tests
// validaient donc du code qui ne pouvait marcher qu'avec eux, et ils
// INTERDISAIENT une correction juste. Un mock infidèle est pire qu'un test
// manquant : il donne une confiance que rien ne justifie.
//
// Tout fichier qui appelle une route de montage-media avec son propre faux
// fetch doit donc passer par tests/helpers/fetch-fidele.js.
test('aucun test n\'appelle montage-media avec un faux fetch infidèle', () => {
  const dossier = __dirname;
  const coupables = [];
  for (const nom of fs.readdirSync(dossier).filter(f => f.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(dossier, nom), 'utf8');
    // Seuls sont concernés les tests qui appellent le handler DIRECTEMENT
    // (import du module) ET qui posent leur propre fetch. Les tests de page,
    // qui passent par Playwright, ne sont pas concernés.
    const appelleLeHandler = /require\(.*montage-media|from '.*montage-media|import\(.*montage-media/.test(src);
    const poseUnFetch = /global\.fetch\s*=/.test(src);
    const estFidele = /fetch-fidele/.test(src);
    if (appelleLeHandler && poseUnFetch && !estFidele) coupables.push(nom);
  }
  assert.deepEqual(coupables, [],
    'REGRESSION : ' + coupables.join(', ') + ' pose un faux fetch sans passer par '
    + 'helpers/fetch-fidele. Ses réponses simulées n\'auront ni .text() ni .status, et elles '
    + 'feront échouer toute correction qui lit la réponse comme un vrai navigateur le fait. '
    + 'Ajoute : require(\'./helpers/fetch-fidele\').rendreLesMocksFideles();');
});

// ── CONTRÔLE DE MORSURE ──
test('contrôle de morsure : chaque règle tombe quand on réintroduit son défaut', () => {
  const mordu = (verif) => { try { verif(); return false; } catch (e) { return true; } };

  // 1. Retour à rep.json() nu.
  const nu = SOURCE.replace('const data = await lireJsonOuNull(rep);', 'const data = await rep.json();');
  assert.ok(mordu(() => {
    const nus = nu.split('\n').filter(l => /await\s+rep\.json\(\)/.test(l) && !/\.catch\(/.test(l) && !/^\s*\/\//.test(l));
    assert.deepEqual(nus, []);
  }), 'le test du rep.json() nu ne mord pas.');

  // 2. Retentative supprimée sur une réponse illisible.
  const sansReprise = SOURCE.replace(
    'if ((rep.status >= 500 || rep.status === 429) && tentative < TENTATIVES_MAX) {',
    'if (false) {'
  );
  assert.ok(mordu(() => {
    const bloc = sansReprise.slice(sansReprise.indexOf('async function genererAvecForme'));
    const corps = bloc.slice(0, bloc.indexOf('\n}\n'));
    assert.ok(/rep\.status >= 500 \|\| rep\.status === 429/.test(corps));
  }), 'le test de la retentative ne mord pas.');

  // 3. Un des trois fournisseurs qui reprend son propre chemin.
  const disperse = SOURCE.replace('const data = await lireJsonOuNull(rep);', 'const data = null;');
  assert.ok(mordu(() => {
    const usages = (disperse.match(/await lireJsonOuNull\(rep\)|= analyserJson\(brut\)/g) || []).length;
    assert.ok(usages >= 3);
  }), 'le test du partage ne mord pas.');
});

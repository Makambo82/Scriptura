// Demande du propriétaire : dans tous les écrans qui demandent une niche ET
// un sujet, le sujet passe EN PREMIER, et l'app propose la niche à partir de
// ce qui vient d'être écrit, libre au créateur d'en choisir une autre. C'est
// l'ordre naturel : on pense à son sujet, pas à sa case de rangement.
//
// Détection à deux étages (décision du propriétaire) : mots-clés dans le code
// d'abord, instantanés et gratuits ; l'IA seulement si les mots-clés ne
// trouvent rien, et hors quota de génération (voir api/generate.js).
//
// DEUX VRAIS BUGS trouvés en testant le dictionnaire sur des sujets réels,
// verrouillés ici parce qu'ils reviendraient au premier mot-clé ajoué :
//   1. L'APOSTROPHE. En la gardant comme un caractère de mot, "l'histoire"
//      restait un seul bloc et le mot-clé "histoire" ne le trouvait JAMAIS.
//      Ça ratait aussi "l'argent", "l'intelligence artificielle",
//      "d'entreprise" : une bonne part des sujets réels en français.
//   2. LA SOUS-CHAÎNE. "les couples se SÉPARENT" contient "parent", ce qui
//      rangeait le sujet dans Parentalité & Famille au lieu de Relation &
//      Amour ; et "ex" se trouvait dans "EXemple" ou "EXpliquer".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

// Charge la fonction telle qu'elle est RÉELLEMENT écrite dans le fichier de
// l'app, jamais une copie qui divergerait. L'expression finale est évaluée
// dans la même portée que le source, seule façon d'en extraire une fonction
// sans transformer ce fichier de script classique en module.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'niche-auto.js'), 'utf8');
// eslint-disable-next-line no-eval
// Nom local DIFFÉRENT de celui du fichier source : une déclaration de
// fonction évaluée en eval fuit dans la portée englobante et entrerait en
// collision avec un const du même nom.
const detecterNiche = eval(SRC + '\n; detecterNicheParMots');

test('les sujets réels tombent dans la bonne niche', () => {
  const cas = [
    ["pourquoi les gens n'arrivent pas à épargner", 'Finance & Argent'],
    ['les 5 erreurs du débutant en bourse', 'Finance & Argent'],
    ["l'histoire du roi Béhanzin", 'Histoire'],
    ["comment j'ai lancé mon business à 19 ans", 'Business & Entrepreneuriat'],
    ["les braquages qui ont marqué l'Afrique de l'Ouest", 'Faits divers & Crime'],
    ['ma routine skincare du matin', 'Beauté & Mode'],
    ['comment perdre du poids sans salle de sport', 'Sport & Fitness'],
    ['recette du poulet DG en 10 minutes', 'Cuisine & Food'],
    ["la vérité sur le sommeil et l'anxiété", 'Santé & Bien-être'],
    ['voyager en Asie avec 500 euros', 'Voyage & Découverte'],
    ['éduquer un adolescent sans crier', 'Parentalité & Famille'],
    ['la prière change-t-elle vraiment quelque chose', 'Religion & Foi']
  ];
  for (const [texte, attendu] of cas) {
    assert.equal(detecterNiche(texte), attendu, JSON.stringify(texte));
  }
});

test("l'apostrophe est un séparateur, sinon la moitié des sujets français échouent", () => {
  // Sans cette règle, ces trois-là renvoyaient null : le mot-clé était bien
  // là, mais collé à son article.
  assert.equal(detecterNiche("l'histoire de la colonisation"), 'Histoire');
  assert.equal(detecterNiche("l'intelligence artificielle expliquée simplement"), 'Technologie & IA');
  assert.equal(detecterNiche("d'où vient l'argent des banques"), 'Finance & Argent');
});

test('un mot-clé ne compte que s\'il commence un mot, jamais au milieu d\'un autre', () => {
  // "séparent" contient "parent" : le sujet parle de couples, pas de famille.
  assert.equal(detecterNiche('pourquoi les couples se séparent après 3 ans'), 'Relation & Amour');
  // "exemple"/"expliquer" contiennent "ex" (mot-clé de rupture amoureuse) :
  // ces sujets ne doivent PAS basculer dans Relation & Amour.
  assert.notEqual(detecterNiche('un exemple concret pour expliquer la mitose'), 'Relation & Amour');
});

test('dans le doute, la détection ne dit RIEN plutôt que de se tromper', () => {
  // Trop court : le créateur est encore en train de taper.
  assert.equal(detecterNiche('salut'), null);
  assert.equal(detecterNiche(''), null);
  // Aucun signal exploitable : c'est le cas que l'étage IA prendra en charge.
  assert.equal(detecterNiche("ce que personne n'ose dire vraiment"), null);
  // Sujet à cheval sur deux niches proches (Finance et Immobilier) : le
  // ranger au hasard dans l'une des deux orienterait toute la génération.
  assert.equal(detecterNiche("comment investir dans l'immobilier locatif"), null);
});

test('même sujet, même niche, toujours : la détection par mots-clés est déterministe', () => {
  const sujet = "pourquoi les gens n'arrivent pas à épargner";
  const premier = detecterNiche(sujet);
  for (let i = 0; i < 5; i++) assert.equal(detecterNiche(sujet), premier);
  // Insensible à la casse et aux accents, mêmes règles des deux côtés.
  assert.equal(detecterNiche('POURQUOI LES GENS N\'ARRIVENT PAS À ÉPARGNER'), premier);
});

test('dans les 4 écrans : le sujet est au-dessus, la niche se remplit, un choix manuel n\'est jamais écrasé', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      const taper = (id, texte) => {
        const el = document.getElementById(id);
        el.value = texte;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      // L'ordre RÉEL dans le document : getBoundingClientRect ne dit rien sur
      // un écran masqué (tout y vaut 0), compareDocumentPosition, si.
      const sujetAvantNiche = (idSujet, idNiche) => !!(document.getElementById(idSujet)
        .compareDocumentPosition(document.getElementById(idNiche)) & Node.DOCUMENT_POSITION_FOLLOWING);

      const r = { ordre: {}, detecte: {} };
      r.ordre.script = sujetAvantNiche('sujet', 'niche');
      r.ordre.idees = sujetAvantNiche('ideaTheme', 'ideaNiche');
      r.ordre.carrousel = sujetAvantNiche('carrouselSujet', 'carrouselNiche');
      r.ordre.serie = sujetAvantNiche('serieConcept', 'serieNiche');

      taper('sujet', "pourquoi les gens n'arrivent pas à épargner");
      r.detecte.script = document.getElementById('niche').value;
      r.noteScript = document.getElementById('nicheAutoNoteScript').textContent;
      r.noteVisible = document.getElementById('nicheAutoNoteScript').style.display !== 'none';

      taper('ideaTheme', 'comment investir en bourse quand on débute');
      r.detecte.idees = document.getElementById('ideaNiche').value;
      taper('carrouselSujet', 'les erreurs de maquillage qui vieillissent');
      r.detecte.carrousel = document.getElementById('carrouselNiche').value;
      // La Série remplit son menu seulement à l'ouverture de son écran : la
      // détection doit quand même savoir y poser une niche (bug trouvé en
      // testant, le menu était vide donc la niche était refusée en silence).
      taper('serieConcept', "les braquages qui ont marqué l'Afrique de l'Ouest");
      r.detecte.serie = document.getElementById('serieNiche').value;

      // Choix manuel, puis on continue d'écrire un sujet d'une TOUT AUTRE
      // niche : la niche choisie doit survivre, et la note disparaître.
      const n = document.getElementById('niche');
      n.value = 'Histoire';
      n.dispatchEvent(new Event('change', { bubbles: true }));
      taper('sujet', 'recette du poulet DG avec des épices et du piment');
      r.apresChoixManuel = n.value;
      r.noteApresChoix = document.getElementById('nicheAutoNoteScript').style.display !== 'none';
      return r;
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.deepEqual(vu.ordre, { script: true, idees: true, carrousel: true, serie: true },
      'REGRESSION : dans chaque écran, le sujet doit venir AVANT la niche');
    assert.deepEqual(vu.detecte, {
      script: 'Finance & Argent',
      idees: 'Finance & Argent',
      carrousel: 'Beauté & Mode',
      serie: 'Faits divers & Crime'
    }, 'la niche doit se remplir seule dans les quatre écrans : ' + JSON.stringify(vu.detecte));
    assert.match(vu.noteScript, /Niche détectée/, 'la détection doit se DIRE, sinon elle passe pour un bug');
    assert.equal(vu.noteVisible, true);
    assert.equal(vu.apresChoixManuel, 'Histoire',
      'REGRESSION : une niche choisie à la main ne doit JAMAIS être écrasée par la suite');
    assert.equal(vu.noteApresChoix, false, 'plus rien à annoncer une fois que le créateur a tranché');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// ═══════════════════════════════════════════════════════════
//  DÉTECTION AUTOMATIQUE DE LA NICHE À PARTIR DU SUJET
//
//  Demande du propriétaire : dans tous les écrans qui demandent une niche ET
//  un sujet, le sujet passe EN PREMIER, et l'app propose la niche à partir de
//  ce que le créateur vient d'écrire, libre à lui d'en choisir une autre.
//  C'est l'ordre naturel : un créateur pense à son sujet, pas à sa case de
//  rangement. Le mode Récit fonctionnait déjà comme ça (aucune niche du
//  tout), ce qui confirmait l'intuition.
//
//  DEUX ÉTAGES, décision du propriétaire :
//   1. MOTS-CLÉS, dans le code. Instantané pendant la frappe, aucun coût,
//      et surtout PRÉVISIBLE : même sujet, même niche, toujours. C'est ce
//      qui répond dans l'immense majorité des cas.
//   2. IA, seulement si les mots-clés ne trouvent RIEN. Un sujet allusif
//      ("ce que personne n'ose dire sur l'argent des autres") n'a parfois
//      aucun mot-clé exploitable. L'appel est minuscule (une ligne de
//      réponse), hors quota de génération (même conception que les
//      micro-éditions, voir api/generate.js), déclenché seulement à la
//      PAUSE de frappe, et jamais deux fois pour le même texte.
//
//  RÈGLES DE PRUDENCE, c'est là que ce genre de confort se rate :
//   - une niche choisie À LA MAIN n'est jamais écrasée, même si le sujet
//     change ensuite (même principe que le curseur de slides du carrousel) ;
//   - la détection DIT ce qu'elle a fait. Un champ qui se remplit tout seul
//     en silence passe pour un bug ;
//   - dans le doute, elle ne dit RIEN et laisse le champ vide. Une mauvaise
//     niche est pire que pas de niche : elle oriente toute la génération.
// ═══════════════════════════════════════════════════════════

// Longueur minimale avant de tenter quoi que ce soit : sous ce seuil, il n'y
// a pas encore de sujet, juste quelqu'un en train de taper sa première
// syllabe. Détecter là-dessus produirait des sautes de niche à chaque lettre.
const NICHE_MIN_CARACTERES = 12;
// Pause de frappe avant l'étage IA (l'étage mots-clés, lui, est instantané) :
// assez long pour ne pas se déclencher entre deux mots, assez court pour que
// la niche soit là avant que le créateur ait fini de lire son propre champ.
const NICHE_DELAI_IA_MS = 1100;

// Mots-clés par niche. Écrits SANS ACCENT et en minuscules : le texte du
// créateur est normalisé de la même façon avant comparaison (voir
// nicheNormaliser), donc "Géopolitique" trouve "geopolitique" et "épargne"
// trouve "epargne", sans avoir à dupliquer chaque variante.
//
// Le poids vient de la LONGUEUR du mot-clé, pas d'un chiffre écrit à la main :
// "cryptomonnaie" est un signal bien plus fort que "prix", et c'est
// mécaniquement vrai. Évite un tableau de poids à maintenir à la main, qui
// aurait dérivé au premier ajout.
const NICHE_MOTS_CLES = {
  'Art & Créativité': ['dessin', 'peinture', 'artiste', 'galerie', 'sculpture', 'illustration', 'graphisme', 'creativite', 'musee', 'oeuvre', 'street art', 'tatouage', 'photographie'],
  'Beauté & Mode': ['maquillage', 'beaute', 'skincare', 'coiffure', 'cheveux', 'mode', 'style vestimentaire', 'vetement', 'garde-robe', 'cosmetique', 'parfum', 'ongles', 'perruque', 'tenue'],
  'Business & Entrepreneuriat': ['business', 'entrepreneur', 'startup', 'entreprise', 'vendre', 'client', 'chiffre d\'affaires', 'marketing', 'strategie commerciale', 'freelance', 'boite', 'lancer sa', 'e-commerce', 'dropshipping', 'negociation'],
  'Célébrités & People': ['celebrite', 'star', 'acteur', 'actrice', 'chanteur', 'chanteuse', 'rappeur', 'people', 'scandale', 'paparazzi', 'red carpet', 'influenceur', 'tele-realite'],
  'Culture & Société': ['societe', 'culture', 'tradition', 'coutume', 'generation', 'debat de societe', 'phenomene', 'communaute', 'immigration', 'racisme', 'feminisme', 'diaspora'],
  'Cuisine & Food': ['recette', 'cuisine', 'plat', 'manger', 'restaurant', 'chef', 'ingredient', 'patisserie', 'dessert', 'boisson', 'gastronomie', 'street food', 'epice'],
  'Développement personnel': ['developpement personnel', 'confiance en soi', 'habitude', 'discipline', 'productivite', 'procrastination', 'objectif de vie', 'estime de soi', 'ameliorer sa vie', 'sortir de sa zone'],
  'Éducation': ['education', 'ecole', 'etudiant', 'apprendre', 'examen', 'universite', 'diplome', 'professeur', 'cours', 'revision', 'bac', 'concours', 'pedagogie'],
  'Faits divers & Crime': ['crime', 'meurtre', 'enquete policiere', 'disparition', 'tueur', 'braquage', 'proces', 'affaire criminelle', 'fait divers', 'arnaque', 'escroquerie', 'kidnapping', 'police', 'prison'],
  'Finance & Argent': ['argent', 'epargne', 'economiser', 'budget', 'dette', 'salaire', 'investir', 'bourse', 'action', 'cryptomonnaie', 'bitcoin', 'banque', 'credit', 'richesse', 'millionnaire', 'revenu passif', 'finance'],
  'Géopolitique & Actualité': ['geopolitique', 'guerre', 'president', 'election', 'gouvernement', 'politique', 'sanction', 'diplomatie', 'conflit', 'actualite', 'frontiere', 'militaire', 'nations unies', 'coup d\'etat'],
  'Histoire': ['histoire', 'historique', 'empire', 'roi', 'reine', 'colonisation', 'siecle', 'antiquite', 'guerre mondiale', 'civilisation', 'esclavage', 'archeologie', 'royaume', 'dynastie', 'revolution'],
  'Immobilier & Investissement': ['immobilier', 'appartement', 'maison', 'terrain', 'loyer', 'locataire', 'proprietaire', 'achat immobilier', 'rentabilite locative', 'construire', 'hypotheque', 'bien immobilier'],
  'Lifestyle': ['lifestyle', 'quotidien', 'vlog', 'journee type', 'organisation', 'minimalisme', 'deco', 'maison ideale', 'mode de vie', 'week-end'],
  'Motivation & Mindset': ['motivation', 'mindset', 'reussir', 'echec', 'abandonner', 'perseverance', 'mentalite', 'ambition', 'se depasser', 'discipline mentale', 'inspiration'],
  'Mystères & Paranormal': ['mystere', 'paranormal', 'fantome', 'extraterrestre', 'ovni', 'legende urbaine', 'inexplique', 'malediction', 'complot', 'surnaturel', 'disparu sans trace', 'phenomene etrange'],
  'Parentalité & Famille': ['parent', 'enfant', 'bebe', 'famille', 'education des enfants', 'grossesse', 'maternite', 'paternite', 'adolescent', 'fratrie', 'grand-mere', 'grand-pere'],
  'Relation & Amour': ['amour', 'couple', 'relation', 'rupture', 'ex', 'mariage', 'infidelite', 'seduction', 'celibataire', 'draguer', 'divorce', 'sentiment', 'coup de foudre', 'toxique'],
  'Religion & Foi': ['religion', 'foi', 'dieu', 'priere', 'bible', 'coran', 'eglise', 'mosquee', 'spirituel religieux', 'pasteur', 'imam', 'ramadan', 'careme', 'croyant'],
  'Santé & Bien-être': ['sante', 'bien-etre', 'sommeil', 'stress', 'anxiete', 'depression', 'maladie', 'medecin', 'symptome', 'nutrition', 'immunite', 'douleur', 'therapie', 'mental'],
  'Spiritualité & Philosophie': ['spiritualite', 'philosophie', 'meditation', 'conscience', 'sens de la vie', 'karma', 'energie', 'univers', 'sagesse', 'existence', 'ame', 'lacher prise'],
  'Sport & Fitness': ['sport', 'fitness', 'musculation', 'muscle', 'entrainement', 'salle de sport', 'football', 'basket', 'course a pied', 'perdre du poids', 'abdos', 'proteine', 'athlete', 'match'],
  'Technologie & IA': ['technologie', 'intelligence artificielle', 'ia', 'chatgpt', 'logiciel', 'application', 'code informatique', 'smartphone', 'internet', 'algorithme', 'robot', 'donnees', 'cybersecurite', 'numerique'],
  'Voyage & Découverte': ['voyage', 'voyager', 'pays', 'destination', 'tourisme', 'visa', 'expatrie', 'avion', 'hotel', 'plage', 'decouverte du monde', 'road trip', 'passeport']
};

// Minuscules, sans accent, ponctuation réduite à des espaces : "L'ÉPARGNE,
// pourquoi ?" devient " l epargne pourquoi ".
//
// L'APOSTROPHE COMPTE COMME UN SÉPARATEUR, et c'est capital en français :
// en la gardant, "l'histoire" restait un seul mot, et le mot-clé "histoire"
// ne le trouvait jamais (trouvé en testant, ça ratait aussi "l'argent",
// "l'intelligence artificielle", "d'entreprise"... c'est-à-dire une bonne
// part des sujets réels). Les mots-clés passent par la MÊME normalisation
// (voir detecterNicheParMots), donc "coup d'etat" y devient "coup d etat" des
// deux côtés et continue de correspondre.
// Les espaces aux extrémités permettent de chercher un mot entier très court
// (" ia ") sans attraper "média" ou "diagnostic".
function nicheNormaliser(texte) {
  return ' ' + String(texte == null ? '' : texte)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() + ' ';
}

// Un mot-clé compte s'il commence UN MOT du texte, jamais s'il apparaît au
// milieu d'un autre. Deux vrais faux positifs trouvés en testant, tous deux
// dus à la recherche naïve en sous-chaîne :
//   - "les couples se SÉPARENT" contient "parent", et rangeait le sujet dans
//     Parentalité & Famille, à égalité avec Relation & Amour ;
//   - "ex" (une rupture) se trouvait dans "EXemple", "EXpliquer", "sEXe".
// D'où deux règles : début de mot obligatoire, et pour les mots très courts
// (3 lettres ou moins, "roi", "ex", "ia"), le mot ENTIER. Le début de mot
// suffit pour tout le reste, et gère gratuitement les pluriels et les
// conjugaisons ("couple" trouve "couples", "voyage" trouve "voyager").
function nicheMotTrouve(texteNormalise, motNormalise) {
  if (!motNormalise) return false;
  if (motNormalise.length <= 3) return texteNormalise.includes(' ' + motNormalise + ' ');
  return texteNormalise.includes(' ' + motNormalise);
}

// Étage 1 : les mots-clés. Retourne le nom exact d'une niche, ou null.
//
// Le score d'une niche est la somme des LONGUEURS de ses mots-clés trouvés,
// pas leur nombre : trois mots vagues ne doivent pas battre un seul mot
// décisif ("cryptomonnaie" pèse plus que "prix" + "gens" + "vie").
//
// Deux garde-fous contre la fausse détection, qui est le vrai risque ici :
//  - un score plancher, sinon un seul mot court suffirait à trancher ;
//  - un ÉCART minimum avec la deuxième niche. Un sujet à cheval entre deux
//    niches ne doit pas être rangé au hasard dans l'une des deux : mieux vaut
//    ne rien proposer et laisser le créateur choisir.
function detecterNicheParMots(texte) {
  const t = nicheNormaliser(texte);
  if (t.trim().length < NICHE_MIN_CARACTERES) return null;

  const scores = [];
  Object.keys(NICHE_MOTS_CLES).forEach(niche => {
    let score = 0;
    NICHE_MOTS_CLES[niche].forEach(mot => {
      const m = nicheNormaliser(mot).trim();
      if (nicheMotTrouve(t, m)) score += m.length;
    });
    if (score > 0) scores.push({ niche, score });
  });
  if (!scores.length) return null;
  scores.sort((a, b) => b.score - a.score);

  const SCORE_PLANCHER = 6;      // un mot vraiment porteur, pas "sport" dans "transport"
  const ECART_MINIMUM = 3;       // sinon deux niches à égalité seraient départagées au hasard
  const meilleur = scores[0];
  const second = scores[1];
  if (meilleur.score < SCORE_PLANCHER) return null;
  if (second && (meilleur.score - second.score) < ECART_MINIMUM) return null;
  return meilleur.niche;
}

// Liste des niches réellement proposées, lue DANS le menu déroulant plutôt
// qu'écrite une deuxième fois ici : une niche ajoutée dans index.html doit
// être acceptée par la détection sans avoir à penser à ce fichier. La valeur
// vide ("Choisis ta niche…") est écartée.
function nichesDisponibles(champNiche) {
  if (!champNiche || !champNiche.options) return [];
  return Array.from(champNiche.options).map(o => (o.value || o.textContent || '').trim()).filter(Boolean);
}

// Certains menus de niche sont VIDES dans le HTML et remplis seulement à
// l'ouverture de leur écran (c'est le cas de la Série, voir initSerieSelects,
// js/serie.js, qui recopie les options du diagnostic). La détection tombait
// alors dans le vide : elle trouvait la bonne niche mais refusait de la poser,
// faute d'option correspondante dans un menu encore vide. On remplit donc le
// menu au même endroit et depuis la même source que le reste de l'app, plutôt
// que de dupliquer la liste des niches ici.
// Verrou « le créateur a tranché », porté par LE CHAMP lui-même et non par
// une variable de fermeture : deux détections différentes doivent le
// respecter, celle qui lit le sujet tapé et celle qui lit le produit chargé
// (voir detecterNicheDepuisFichierVente). Une niche choisie à la main ne doit
// être écrasée par AUCUNE des deux.
function marquerNicheChoisieALaMain(champNiche) {
  if (champNiche) champNiche.dataset.nicheChoisieMain = '1';
}
function nicheChoisieALaMain(champNiche) {
  return !!(champNiche && champNiche.dataset.nicheChoisieMain === '1');
}

// Détection de la niche À PARTIR DU PRODUIT CHARGÉ (objectif Ventes).
//
// Demande du propriétaire : quand on joint la photo de son produit ou son PDF,
// on a déjà donné l'information, l'app ne devrait pas la redemander. C'est
// d'autant plus vrai que le sujet saisi dans ce cas est souvent très pauvre
// (« vendre un produit »), donc les mots-clés n'ont rien à se mettre sous la
// dent : le fichier est la seule vraie matière.
//
// Un seul appel, minuscule (une ligne de réponse), hors quota comme la
// détection depuis le texte. Déclenché à l'instant du chargement, pas pendant
// la frappe : le créateur vient d'agir, une seconde d'attente y est naturelle.
//
// Mêmes prudences que partout ailleurs : jamais par-dessus un choix manuel,
// jamais une valeur absente du menu, et silence complet en cas de doute.
async function detecterNicheDepuisFichierVente(fichier, idNiche, idNote) {
  const champNiche = document.getElementById(idNiche);
  if (!fichier || !champNiche || nicheChoisieALaMain(champNiche)) return null;
  if (typeof callAI !== 'function') return null;
  assurerOptionsNiche(champNiche);
  const liste = nichesDisponibles(champNiche);
  if (!liste.length) return null;

  const prompt = `Un créateur TikTok veut vendre le produit présenté dans le fichier joint à ce message (photo du produit, ou document).

Range CE PRODUIT dans UNE de ces catégories, en recopiant son intitulé EXACTEMENT :
${liste.join('\n')}

Réponds UNIQUEMENT par l'intitulé choisi, rien d'autre, aucune explication.
Si le produit ne correspond clairement à aucune catégorie, réponds exactement : AUCUNE`;
  try {
    const reponse = await callAI(MODEL_RAPIDE, 30, prompt, 1, false, 0, 'detectionNiche', fichier, null, 'detectionNiche');
    if (!reponse) return null;
    const propre = String(reponse).trim().replace(/^["'\s]+|["'.\s]+$/g, '');
    if (!propre || /^aucune$/i.test(propre)) return null;
    const exact = liste.find(n => n.toLowerCase() === propre.toLowerCase())
      || liste.find(n => nicheNormaliser(n).trim() === nicheNormaliser(propre).trim());
    if (!exact) return null;
    // Le créateur a pu choisir sa niche pendant l'appel : on ne réveille
    // jamais une proposition devenue caduque.
    if (nicheChoisieALaMain(champNiche)) return null;
    champNiche.value = exact;
    const note = document.getElementById(idNote);
    if (note) {
      note.textContent = 'Niche détectée depuis ton produit : ' + exact + '. Tu peux la changer.';
      note.style.display = '';
    }
    return exact;
  } catch (e) {
    return null; // un confort de formulaire ne signale jamais d'erreur
  }
}

function assurerOptionsNiche(champNiche) {
  if (!champNiche || (champNiche.options && champNiche.options.length)) return;
  const source = document.getElementById('auditNiche');
  if (source) champNiche.innerHTML = source.innerHTML;
}

// Étage 2 : l'IA, UNIQUEMENT quand les mots-clés n'ont rien trouvé.
// Volontairement minuscule : un modèle rapide, une trentaine de jetons de
// réponse, une seule tentative. Hors quota de génération (voir
// api/generate.js, mode 'detectionNiche'), au même titre que les
// micro-éditions : c'est un confort de formulaire, pas une génération.
// Retourne null à la moindre incertitude, jamais une approximation.
async function detecterNicheParIA(texte, listeNiches) {
  if (typeof callAI !== 'function' || !listeNiches.length) return null;
  const prompt = `Voici le sujet d'une vidéo TikTok écrit par un créateur :

"""
${String(texte).slice(0, 600)}
"""

Range ce sujet dans UNE de ces catégories, en recopiant son intitulé EXACTEMENT :
${listeNiches.join('\n')}

Réponds UNIQUEMENT par l'intitulé choisi, rien d'autre, aucune explication.
Si le sujet ne correspond clairement à aucune catégorie, réponds exactement : AUCUNE`;
  try {
    const reponse = await callAI(MODEL_RAPIDE, 30, prompt, 1, false, 0, 'detectionNiche', null, null, 'detectionNiche');
    if (!reponse) return null;
    const propre = String(reponse).trim().replace(/^["'\s]+|["'.\s]+$/g, '');
    if (!propre || /^aucune$/i.test(propre)) return null;
    // Jamais la réponse brute : seulement si elle correspond VRAIMENT à une
    // niche existante. Un modèle qui inventerait "Finance et argent" (avec
    // "et" au lieu de "&") ne doit pas remplir le champ avec une valeur que
    // le menu déroulant ne connaît pas, ce qui le laisserait vide sans que
    // personne comprenne pourquoi.
    const exact = listeNiches.find(n => n.toLowerCase() === propre.toLowerCase());
    if (exact) return exact;
    const approx = listeNiches.find(n => nicheNormaliser(n).trim() === nicheNormaliser(propre).trim());
    return approx || null;
  } catch (e) {
    return null; // silencieux : un confort de formulaire ne signale jamais d'erreur
  }
}

// Branche la détection sur un couple (champ sujet, menu niche) d'un écran.
// Appelée une fois par mode au chargement (voir brancherToutesDetectionsNiche
// plus bas). `note` est l'élément qui affiche "Niche détectée : ...".
function brancherDetectionNiche(idSujet, idNiche, idNote) {
  const champSujet = document.getElementById(idSujet);
  const champNiche = document.getElementById(idNiche);
  const note = document.getElementById(idNote);
  if (!champSujet || !champNiche) return;

  let dernierTexteIA = '';
  let minuteurIA = null;

  const afficherNote = (niche, parIA) => {
    if (!note) return;
    if (!niche) { note.style.display = 'none'; note.textContent = ''; return; }
    note.textContent = 'Niche détectée' + (parIA ? '' : '') + ' : ' + niche + '. Tu peux la changer.';
    note.style.display = '';
  };

  // Un choix manuel gèle définitivement le champ pour cette saisie : le
  // créateur a tranché, l'app n'a plus rien à proposer. Sans ça, continuer à
  // écrire son sujet effacerait la niche qu'il vient de choisir.
  champNiche.addEventListener('change', () => {
    marquerNicheChoisieALaMain(champNiche);
    if (note) { note.style.display = 'none'; note.textContent = ''; }
  });

  const appliquer = (niche, parIA) => {
    if (!niche || nicheChoisieALaMain(champNiche)) return;
    assurerOptionsNiche(champNiche);
    if (!nichesDisponibles(champNiche).includes(niche)) return;
    champNiche.value = niche;
    afficherNote(niche, parIA);
  };

  champSujet.addEventListener('input', () => {
    if (nicheChoisieALaMain(champNiche)) return;
    if (minuteurIA) { clearTimeout(minuteurIA); minuteurIA = null; }
    const texte = champSujet.value || '';

    // Sujet effacé : on retire aussi la niche PROPOSÉE (jamais une niche
    // choisie à la main, protégée par choisiParCreateur ci-dessus), sinon
    // elle resterait à orienter une génération sans rapport.
    if (texte.trim().length < NICHE_MIN_CARACTERES) {
      champNiche.value = '';
      afficherNote(null);
      return;
    }

    const parMots = detecterNicheParMots(texte);
    if (parMots) { appliquer(parMots, false); return; }

    // Rien trouvé : on laisse le champ vide TOUT DE SUITE (plutôt que de
    // garder une niche devinée sur une version précédente du texte), et on
    // programme l'étage IA à la pause de frappe.
    champNiche.value = '';
    afficherNote(null);
    minuteurIA = setTimeout(async () => {
      const texteFinal = (champSujet.value || '').trim();
      if (texteFinal.length < NICHE_MIN_CARACTERES || nicheChoisieALaMain(champNiche)) return;
      // Jamais deux appels pour le même texte : sans ce garde-fou, corriger
      // une virgule puis revenir en arrière relancerait un appel à chaque
      // fois. C'est ce qui rend l'étage IA vraiment marginal en coût.
      if (texteFinal === dernierTexteIA) return;
      dernierTexteIA = texteFinal;
      const niche = await detecterNicheParIA(texteFinal, nichesDisponibles(champNiche));
      // Le créateur a pu choisir sa niche ou tout effacer pendant l'appel :
      // on ne réveille jamais une proposition devenue hors sujet.
      if (!niche || nicheChoisieALaMain(champNiche)) return;
      if ((champSujet.value || '').trim() !== texteFinal) return;
      appliquer(niche, true);
    }, NICHE_DELAI_IA_MS);
  });
}

// Les quatre écrans concernés. Le Récit n'y figure pas : il n'a
// volontairement AUCUNE niche (voir js/storytelling.js), le sujet y est déjà
// le premier champ. Le diagnostic non plus : il analyse un compte, il n'y a
// aucun sujet d'où déduire quoi que ce soit.
function brancherToutesDetectionsNiche() {
  brancherDetectionNiche('sujet', 'niche', 'nicheAutoNoteScript');
  brancherDetectionNiche('ideaTheme', 'ideaNiche', 'nicheAutoNoteIdees');
  brancherDetectionNiche('carrouselSujet', 'carrouselNiche', 'nicheAutoNoteCarrousel');
  brancherDetectionNiche('serieConcept', 'serieNiche', 'nicheAutoNoteSerie');
}

// Garde `typeof document` : ce fichier est aussi chargé tel quel par les
// tests en Node pur, pour vérifier le dictionnaire de mots-clés sans avoir à
// lancer un navigateur (voir tests/niche-auto-detection.test.js).
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', brancherToutesDetectionsNiche);
}

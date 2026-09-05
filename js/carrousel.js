// ═══════════════════════════════════════════════════════════
//  MODE CARROUSEL (slides photo TikTok)
//
//  POURQUOI UN MODE À PART, et pas une troisième option de "Format" à côté
//  de Faceless et Face caméra : un carrousel n'a pas de durée. Tout le mode
//  Script est bâti sur le temps de parole (cibles de mots par durée,
//  plafond de secondes par bloc, recalcul des `temps`, rythme de 2,5 mots
//  par seconde, découpage en plans à filmer). Greffer le carrousel là-dedans
//  aurait produit un script vidéo déguisé, avec un avertissement de durée
//  faux et une "Rétention estimée" calculée contre une cible de mots qui ne
//  veut rien dire ici. Le réglage réel d'un carrousel, c'est le NOMBRE DE
//  SLIDES et son FORMAT.
//
//  LA SLIDE EST UNE MISE EN PAGE, PAS UNE PHRASE POSÉE SUR UNE PHOTO.
//  Première version : une phrase centrée sur un dégradé. Le propriétaire a
//  fourni des carrousels de référence, et l'écart était sans appel. Un
//  carrousel qui tient debout, c'est une STRUCTURE : barre de progression
//  segmentée, pastille numérotée, titre en Playfair, cartes à puces, bandeau
//  de chute. Le modèle rédige donc désormais des slides STRUCTURÉES (titre,
//  définition, points, bandeau), et le code les met en page.
//
//  LE SCORE NE COÛTE RIEN ET RESTE 100% DÉTERMINISTE. Aucun juge IA n'est
//  appelé, contrairement au Script et au Récit : tout ce qui fait la
//  performance d'un carrousel est COMPTABLE (mots du titre d'accroche,
//  longueur de chaque élément, numérotation qui appelle la suite, appel à
//  l'action final, nombre de points par slide). Le code mesure, l'IA ne note
//  jamais. Mêmes slides, même score, et zéro token dépensé pour évaluer.
//
//  LES IMAGES SONT GÉNÉRÉES SLIDE PAR SLIDE, jamais toutes d'un coup par
//  défaut. Budget d'abord (voir carrouselImages dans api/_lib/acces.js), mais
//  surtout parce qu'un carrousel qui performe est presque toujours du texte
//  sur fond sobre : les slides de référence du propriétaire n'ont AUCUNE
//  photo. L'image est un renfort, pas la base.
//
//  ET LE TEXTE N'EST JAMAIS DEMANDÉ AU GÉNÉRATEUR D'IMAGES : les modèles
//  d'images écrivent des lettres tordues et des fautes dès qu'on leur
//  demande une phrase. On génère l'image SANS AUCUN TEXTE, et le code pose
//  la mise en page par-dessus.
// ═══════════════════════════════════════════════════════════

const CARROUSEL_SLIDES_MIN = 6;
const CARROUSEL_SLIDES_MAX = 15;
const CARROUSEL_SLIDES_DEFAUT = 8;

// Formats de publication. 4:5 par défaut : c'est le format des carrousels de
// référence, et celui qui occupe le plus de hauteur d'écran sans être rogné
// dans le fil. Le 16:9 est là pour les réutilisations hors TikTok (une
// présentation, un post LinkedIn) ; il tient beaucoup moins de texte, la mise
// en page s'y adapte toute seule (voir carrouselEchelleQuiTient).
const CAR_FORMATS = {
  '1:1':  { l: 1080, h: 1080, label: 'Carré' },
  '4:5':  { l: 1080, h: 1350, label: 'Portrait' },
  '9:16': { l: 1080, h: 1920, label: 'Vertical' },
  '16:9': { l: 1920, h: 1080, label: 'Paysage' }
};
const CAR_FORMAT_DEFAUT = '4:5';

// Seuils de LISIBILITÉ, en mots, mesurés élément par élément et non plus sur
// la slide entière : une slide structurée porte légitimement plus de texte
// qu'une phrase posée sur une photo, mais chacun de ses éléments reste court.
const CAR_MOTS_TITRE_IDEAL = 7;
const CAR_MOTS_TITRE_MAX = 12;
const CAR_MOTS_POINT_TITRE_MAX = 6;
const CAR_MOTS_POINT_TEXTE_MAX = 22;
const CAR_MOTS_BANDEAU_MAX = 20;
const CAR_POINTS_MAX = 3;

// Une slide "appelle le swipe" quand elle laisse quelque chose d'ouvert :
// suspension, deux-points, question, ou une pastille numérotée (un "PILIER
// 2 / 4" crée à lui seul le besoin d'aller au bout). Mesuré sur le contenu
// RÉEL, jamais sur une auto-déclaration du modèle.
const CAR_RELANCE_FIN = /(…|\.\.\.|:|\?)\s*$/;
const CAR_BADGE_NUMEROTE = /\d\s*\/\s*\d/;
const CAR_MOTS_CTA = /\b(abonne|suis-moi|suis moi|commente|partage|enregistre|sauvegarde|épingle|epingle|clique|lien|bio|dis-moi|dis moi|essaie|teste|télécharge|inscris)/i;

// Palette d'accents, reprise de la charte Scriptura et élargie comme dans les
// carrousels de référence : chaque slide prend l'accent suivant, ce qui fait
// respirer la série sans jamais sortir du fond sombre commun.
const CAR_ACCENTS = [
  { trait: '#C9A84C', doux: 'rgba(201,168,76,0.12)',  bord: 'rgba(201,168,76,0.42)' },
  { trait: '#3E9B75', doux: 'rgba(62,155,117,0.12)',  bord: 'rgba(62,155,117,0.42)' },
  { trait: '#6E9BD1', doux: 'rgba(110,155,209,0.12)', bord: 'rgba(110,155,209,0.40)' },
  { trait: '#9186D6', doux: 'rgba(145,134,214,0.12)', bord: 'rgba(145,134,214,0.40)' },
  { trait: '#D3894F', doux: 'rgba(211,137,79,0.12)',  bord: 'rgba(211,137,79,0.40)' },
  { trait: '#CE86A6', doux: 'rgba(206,134,166,0.12)', bord: 'rgba(206,134,166,0.40)' }
];
function carrouselAccent(i) { return CAR_ACCENTS[((i % CAR_ACCENTS.length) + CAR_ACCENTS.length) % CAR_ACCENTS.length]; }

const CAR_SERIF = '"Playfair Display", Georgia, serif';
const CAR_SANS = 'Poppins, system-ui, -apple-system, sans-serif';
const CAR_ENCRE = '#F3EFE4';
const CAR_ENCRE_DOUCE = 'rgba(255,255,255,0.66)';

let carrouselNbSlides = CARROUSEL_SLIDES_DEFAUT;
let carrouselFormat = CAR_FORMAT_DEFAUT;
let carrouselResultat = null;
let carrouselImages = [];          // [{ apercu, blob } | null], même longueur que les slides
let carrouselImagesEnCours = false;
// Slides déjà composées, dans l'ordre (voir peindreApercusCarrousel). Sert au
// téléchargement immédiat, sans recomposition, pour préserver le geste
// utilisateur exigé par la feuille de partage native d'iOS.
let carrouselApercusBlobs = [];
// Index de la slide dont le fond est en train d'être généré, ou -1. Un simple
// booléen ne suffisait pas : il fallait savoir SUR QUEL BOUTON poser le
// spinner, sinon le créateur ne voit rien tourner là où il vient d'appuyer.
let carrouselImageIndexEnCours = -1;
let carrouselQuotaImages = null;   // { used, plafond, illimite } ou null
let carrouselContexte = null;
let carrouselObjectif = 'faire des vues';
// Photo produit ou PDF joint quand l'objectif est "générer des ventes",
// exactement comme dans le mode Script : { base64, mediaType, nom } ou null.
let carrouselVenteFichier = null;
const CARROUSEL_VENTE_IDS = {
  erreur: 'carrouselVenteFichierError',
  nom: 'carrouselVenteFichierNom',
  retirer: 'carrouselVenteFichierRetirerBtn',
  input: 'carrouselVenteFichierInput'
};
const CARROUSEL_OBJECTIF_VENTES = 'générer des ventes';

// ── MATIÈRE FOURNIE PAR LE CRÉATEUR ──
// Au-delà de ce seuil, le champ "sujet" ne contient plus un thème à traiter
// mais un TEXTE À CONVERTIR (un script déjà écrit, un article, des notes).
// Même seuil que le mode Script (LONG_SEUIL, js/generation.js) : le créateur
// ne doit pas avoir à deviner deux règles différentes selon l'écran.
//
// SANS CETTE DÉTECTION, LE DÉFAUT EST SILENCIEUX : un script collé ici était
// annoncé au modèle comme "Sujet :", donc traité comme un thème à écrire de
// zéro. Le résultat était plausible mais à côté de la demande, et rien ne
// signalait au créateur que son texte avait été ignoré.
const CAR_SEUIL_MATIERE = 400;

// Matière IMPOSÉE, indépendamment de la longueur : quand le texte vient d'un
// script déjà généré ou d'une vidéo transcrite, on SAIT que c'est une matière
// à convertir. Le seuil de longueur n'est qu'une heuristique pour du texte
// collé à la main ; un script de 30 secondes fait moins de 400 caractères et
// serait sinon traité comme un simple thème, c'est-à-dire réécrit de zéro.
let carrouselMatiereImposee = false;

function carrouselEstMatiere(texte) {
  if (carrouselMatiereImposee) return true;
  return String(texte || '').trim().length > CAR_SEUIL_MATIERE;
}

// Compte les IDÉES d'un texte, pour en déduire un nombre de slides. C'est le
// CODE qui compte, jamais l'IA : même texte, même proposition, comme pour le
// score. Une idée = un paragraphe s'il y en a plusieurs, sinon une phrase
// porteuse. Les fragments trop courts (moins de 5 mots) ne comptent pas :
// ce sont des titres, des transitions ou des restes de mise en forme.
function carrouselCompterIdees(texte) {
  const t = String(texte || '').trim();
  if (!t) return 0;
  const parGros = t.split(/\n\s*\n+/).map(x => x.trim()).filter(x => carrouselCompterMots(x) >= 5);
  if (parGros.length >= 3) return parGros.length;
  const parLignes = t.split(/\n+/).map(x => x.trim()).filter(x => carrouselCompterMots(x) >= 5);
  if (parLignes.length >= 3) return parLignes.length;
  return t.split(/[.!?…]+/).map(x => x.trim()).filter(x => carrouselCompterMots(x) >= 5).length;
}

// Nombre de slides que la matière porte VRAIMENT : une couverture, une slide
// par idée, un récap. Si le texte porte 5 idées et que le curseur est resté
// sur 12, le modèle remplit du vide et le carrousel est dilué par un réglage
// que le créateur n'a même pas touché.
function carrouselSlidesPourMatiere(texte) {
  const idees = carrouselCompterIdees(texte);
  if (!idees) return null;
  return Math.min(CARROUSEL_SLIDES_MAX, Math.max(CARROUSEL_SLIDES_MIN, idees + 2));
}

// Le créateur a-t-il déplacé le curseur lui-même ? Si oui, on ne le corrige
// JAMAIS : proposer est un service, écraser un choix explicite est une
// surprise. C'est exactement le défaut de la durée héritée, qui avait produit
// un script de 48 secondes pendant que le formulaire affichait 2 minutes.
let carrouselSlidesChoisiParCreateur = false;

function carrouselEchapper(txt) {
  return String(txt == null ? '' : txt)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function carrouselCompterMots(txt) {
  const s = String(txt || '').trim();
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

// Tout le texte visible d'une slide, dans l'ordre où il est lu. Sert au
// comptage de mots affiché au créateur, jamais au score (qui, lui, mesure
// élément par élément).
function carrouselTexteSlide(s) {
  if (!s) return '';
  const bouts = [s.eyebrow, s.badge, s.titre, s.definition];
  (s.points || []).forEach(p => { bouts.push(p && p.titre); bouts.push(p && p.texte); });
  bouts.push(s.bandeau);
  return bouts.filter(Boolean).join(' ').trim();
}

// ── Curseur du nombre de slides ──
// Demande du propriétaire : une ligne graduée de 6 à 15 qu'on fait glisser.
// La valeur est relue depuis le champ à CHAQUE lecture (jamais depuis la
// seule variable), pour qu'un glissement ne puisse jamais être perdu si un
// événement `input` manque à l'appel.
// Appelée par le curseur lui-même : marque le choix comme explicite, puis
// met à jour l'affichage.
function reglerSlidesCarrousel() {
  carrouselSlidesChoisiParCreateur = true;
  majCurseurSlidesCarrousel();
}

// Réagit à la saisie dans le champ sujet : au-delà du seuil, on annonce la
// conversion et on propose un nombre de slides tiré de la matière.
// `texteACompter` (optionnel) : le texte sur lequel compter les idées, quand
// il diffère du contenu du champ. Cas réel : une vidéo TikTok arrive sous la
// forme "description + transcription". La DESCRIPTION est du contexte, elle
// porte l'angle et aide le modèle, mais elle ne vaut pas une slide. Comptée
// comme une idée, elle gonflait le nombre de slides d'une unité à chaque
// conversion depuis un lien, donc une slide de remplissage à chaque fois.
function majMatiereCarrousel(texteACompter) {
  const champ = document.getElementById('carrouselSujet');
  const note = document.getElementById('carrouselMatiereNote');
  if (!champ) return;
  const texte = champ.value || '';
  // Champ vidé à la main : le créateur repart de zéro, donc l'origine
  // "matière" ne vaut plus. Sans ça, un simple sujet tapé après avoir effacé
  // un script resterait traité comme un texte à convertir.
  if (!texte.trim()) carrouselMatiereImposee = false;
  const matiere = carrouselEstMatiere(texte);
  if (!note) return;
  if (!matiere) { note.style.display = 'none'; note.textContent = ''; return; }

  const pourCompter = (typeof texteACompter === 'string' && texteACompter.trim()) ? texteACompter : texte;
  const suggere = carrouselSlidesPourMatiere(pourCompter);
  // Proposition, jamais imposition : un curseur déjà déplacé à la main est
  // laissé tel quel.
  if (suggere && !carrouselSlidesChoisiParCreateur) {
    const curseur = document.getElementById('carrouselSlides');
    if (curseur) { curseur.value = String(suggere); majCurseurSlidesCarrousel(); }
  }
  // Le créateur doit SAVOIR que le comportement a changé : sans ce message,
  // la conversion resterait invisible, dans un sens comme dans l'autre.
  note.textContent = suggere
    ? 'Texte détecté : Scriptura va le convertir en carrousel plutôt que d\'écrire sur le sujet. J\'y compte ' + carrouselCompterIdees(pourCompter) + ' idées, soit ' + suggere + ' slides. Tu peux changer.'
    : 'Texte détecté : Scriptura va le convertir en carrousel plutôt que d\'écrire sur le sujet.';
  note.style.display = '';
}

function majCurseurSlidesCarrousel() {
  const curseur = document.getElementById('carrouselSlides');
  const valeur = document.getElementById('carrouselSlidesVal');
  if (!curseur) return carrouselNbSlides;
  let n = parseInt(curseur.value, 10);
  if (!Number.isFinite(n)) n = CARROUSEL_SLIDES_DEFAUT;
  n = Math.min(CARROUSEL_SLIDES_MAX, Math.max(CARROUSEL_SLIDES_MIN, n));
  carrouselNbSlides = n;
  if (valeur) valeur.textContent = n + ' slides';
  // Remplissage coloré à gauche du curseur : un dégradé recalculé, parce
  // qu'aucun navigateur ne sait styler la partie déjà parcourue d'un input
  // range de façon portable.
  const part = (n - CARROUSEL_SLIDES_MIN) / (CARROUSEL_SLIDES_MAX - CARROUSEL_SLIDES_MIN);
  curseur.style.setProperty('--car-part', Math.round(part * 100) + '%');
  return n;
}

function choisirFormatCarrousel(valeur) {
  if (!CAR_FORMATS[valeur]) return;
  carrouselFormat = valeur;
  // Un format changé après coup doit se voir tout de suite sur les aperçus
  // déjà affichés, sinon le créateur télécharge un format qu'il ne voit pas.
  if (carrouselResultat) renderCarrousel();
}

// Relu depuis le CHAMP à chaque lecture, jamais depuis la seule variable :
// c'est exactement le piège qui a produit un script de 48 secondes pendant
// que le formulaire affichait 2 minutes (un champ modifié à l'écran pendant
// qu'une variable interne gardait l'ancienne valeur).
function lireFormatCarrousel() {
  const champ = document.getElementById('carrouselFormat');
  const valeur = champ && champ.value;
  if (valeur && CAR_FORMATS[valeur]) carrouselFormat = valeur;
  return carrouselFormat;
}

// Remet le menu du formulaire d'accord avec le format réellement en vigueur.
// Sans ça, changer de format depuis l'écran de résultat laisserait le
// formulaire afficher l'ancien choix au retour, et la génération suivante
// repartirait sur celui-là.
function syncMenuFormatCarrousel() {
  const champ = document.getElementById('carrouselFormat');
  if (champ && champ.value !== carrouselFormat) champ.value = carrouselFormat;
}

function resetCarrouselForm() {
  const curseur = document.getElementById('carrouselSlides');
  if (curseur) curseur.value = String(CARROUSEL_SLIDES_DEFAUT);
  majCurseurSlidesCarrousel();
  syncVenteFieldCarrousel();
  const menuFormat = document.getElementById('carrouselFormat');
  if (menuFormat) { carrouselFormat = CAR_FORMAT_DEFAUT; menuFormat.value = CAR_FORMAT_DEFAUT; }
  carrouselSlidesChoisiParCreateur = false;
  carrouselMatiereImposee = false;
  // Le lien d'une vidéo précédente ne doit jamais rester dans le champ : il
  // ferait croire que le prochain carrousel en part encore.
  const lien = document.getElementById('carrouselLien');
  if (lien) lien.value = '';
  const noteLien = document.getElementById('carrouselLienNote');
  if (noteLien) noteLien.textContent = 'On récupère le texte parlé de ta vidéo et on le transforme en slides. Tu pourras le relire et l\'ajuster avant de générer.';
  const note = document.getElementById('carrouselMatiereNote');
  if (note) { note.style.display = 'none'; note.textContent = ''; }
  const err = document.getElementById('carrouselErrorBox');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const res = document.getElementById('carrouselResults');
  if (res) res.style.display = 'none';
  const form = document.getElementById('carrouselForm');
  if (form) form.style.display = '';
}

// ═══ PROMPT ═══
// Le modèle rédige une MISE EN PAGE, pas un bloc de texte. Les contraintes
// chiffrées reprennent exactement les seuils que le code mesurera ensuite
// (voir scoreCarrousel) : le modèle connaît la règle sur laquelle il sera
// évalué, ce qui évite de le noter sur un critère qu'on ne lui a jamais donné.
// Contexte de vente, injecté seulement quand l'objectif est Ventes. Le
// fichier joint (photo produit ou PDF) part SÉPARÉMENT, dans le message
// lui-même (voir genererCarrousel) : Claude le lit nativement, on ne lui en
// fait donc jamais un résumé de seconde main. Le prompt lui dit simplement
// qu'il est là et ce qu'il doit en tirer.
function blocVenteCarrousel(ctx) {
  if (!ctx.venteDescription && !ctx.venteFichier) return '';
  const surFichier = ctx.venteFichier
    ? ' Un fichier est joint à ce message (photo du produit, ou extrait du document fourni) : lis-le et sers-t\'en activement pour poser une offre, un bénéfice et une preuve CONCRETS, jamais génériques.'
    : '';
  return `
CE QUE LE CRÉATEUR VEND : ${ctx.venteDescription || '(voir le fichier joint à ce message)'}${surFichier}

RÈGLE ABSOLUE, AU-DESSUS DE TOUTE CONSIDÉRATION CRÉATIVE : ce produit APPARTIENT au créateur, c'est LUI qui le vend, et ce carrousel existe pour le vendre. (Incident réel côté Script, 5 septembre : une photo de produit jointe, et le contenu livré traitait le produit du créateur d'arnaque avant de renvoyer ailleurs. Interdire d'INVENTER n'a jamais interdit d'ATTAQUER, d'où cette règle.)
- Il est INTERDIT de présenter ce produit comme une arnaque, une escroquerie, une fausse promesse, un produit inefficace, inutile, dépassé ou trop cher, d'inviter à s'en méfier, à ne pas l'acheter, ou à lui préférer autre chose.
- La dernière slide mène à CE produit, jamais vers une autre solution ou une autre méthode.
- Si une slide démonte une croyance ou une illusion, la cible est le problème du lecteur, ses fausses idées, ou ce qu'il a déjà essayé sans succès. JAMAIS le produit du créateur.
- Le produit est la SOLUTION de ce carrousel, jamais son problème.

COMMENT LE CARROUSEL DOIT S'EN SERVIR, sans jamais devenir une publicité :
- Les slides du milieu apportent de la VALEUR RÉELLE sur le sujet. Un carrousel qui vend dès la slide 2 est abandonné à la slide 2.
- Une seule slide, vers la fin, fait le lien entre le problème traité et ce que le créateur propose, avec un bénéfice précis tiré de ce qui est décrit ci-dessus.
- La dernière slide dit où aller (lien en bio, commentaire, message), en toutes lettres.
- N'invente JAMAIS un prix, une garantie, un résultat chiffré ou un témoignage qui ne figure pas dans ce que le créateur a fourni.
`;
}

// Consignes de CONVERSION, quand le créateur a collé une matière (un script
// déjà écrit, un article, des notes) plutôt qu'un thème.
//
// LA LIGNE EST : FIDÉLITÉ SUR LES FAITS, LIBERTÉ SUR LA FORME. C'est le seul
// arbitrage qui rend la conversion honnête. Une conversion trop fidèle
// recopie un texte parlé, qui se lit mal et produit un mauvais carrousel. Une
// conversion trop libre réécrit à la place du créateur, et ce n'est plus son
// contenu. On interdit donc d'ajouter le moindre fait, et on autorise la
// réécriture complète de la formulation.
function blocConversionCarrousel(ctx) {
  if (!ctx.estMatiere) return '';
  return `
TU NE PARS PAS D'UN THÈME : LE CRÉATEUR T'A FOURNI SA PROPRE MATIÈRE, ci-dessus dans le champ "Sujet". Ton travail est de la CONVERTIR en carrousel, pas d'écrire un nouveau contenu sur le même thème.
RÈGLES DE CONVERSION, dans cet ordre de priorité :
1. FIDÉLITÉ SUR LES FAITS, ABSOLUE. N'ajoute JAMAIS un chiffre, un nom, une date, un exemple ou une affirmation qui ne soit pas dans la matière fournie. Si elle ne dit rien sur un point, ce point n'existe pas.
2. LIBERTÉ SUR LA FORME, TOTALE. La matière a probablement été écrite pour être PARLÉE ou lue en continu. Réécris entièrement les formulations pour la LECTURE en slides : phrases courtes, oral supprimé ("tu vois", "bref", "je vais te dire", "comme je disais"), transitions de discours supprimées.
3. DÉCOUPE AUX FRONTIÈRES D'IDÉES, jamais à intervalle régulier. Une slide = une idée de la matière. Si deux paragraphes disent la même chose, fusionne-les. Si un paragraphe en contient deux, sépare-les.
4. LE HOOK VIENT DE LA MATIÈRE. Si elle commence déjà par une accroche forte, reprends-la (raccourcie si besoin). Sinon, construis-en une À PARTIR de ce qu'elle contient de plus frappant, sans rien inventer.
5. L'APPEL À L'ACTION FINAL doit être ÉCRIT, pas parlé. "Commente si tu es d'accord" plutôt que "dis-le-moi en commentaire juste en dessous".
6. Si la matière ne porte pas assez d'idées pour le nombre de slides demandé, FAIS-EN MOINS plutôt que de remplir avec du vide ou des redites.
`;
}

function promptCarrousel(ctx) {
  const nb = ctx.nbSlides;
  const nbMilieu = Math.max(1, nb - 2);
  return `Tu es un stratège de contenu TikTok spécialisé dans les CARROUSELS (les publications à slides qu'on fait défiler du doigt), pas dans la vidéo.

CONTEXTE
- Niche : ${ctx.niche || 'non précisée'}
- ${ctx.estMatiere ? 'MATIÈRE FOURNIE PAR LE CRÉATEUR, à convertir (voir les règles de conversion plus bas)' : 'Sujet'} : ${ctx.sujet}
- Objectif : ${ctx.objectif || 'faire des vues'}
- Audience : ${ctx.audience || 'tout public'}
- Ton : ${ctx.estMatiere
    ? (ctx.ton || 'GARDE LE TON DE LA MATIÈRE FOURNIE. Le créateur ne t\'a pas demandé de ton particulier, et son texte a déjà le sien : c\'est sa voix, ne la remplace pas par un registre générique.')
    : (ctx.ton || 'naturel et direct')}
- Nombre de slides demandé : ${ctx.estMatiere ? `${nb} au maximum (voir la règle 6 : moins vaut mieux que du remplissage)` : `EXACTEMENT ${nb}`}
${blocConversionCarrousel(ctx)}${blocVenteCarrousel(ctx)}
CHAQUE SLIDE EST UNE MISE EN PAGE, PAS UN PARAGRAPHE. Tu remplis des champs
qui seront disposés par un moteur de rendu : une pastille, un titre, des
cartes à puces, un bandeau de chute. N'écris jamais de texte long dans un
seul champ, la slide déborderait.

TROIS GABARITS, ET TU CHOISIS CELUI QUI SERT LE PROPOS
- "couverture" : réservé à la slide 1. Champs : eyebrow (le thème en 2 à 5 mots), titre (l'accroche), titre_accent (LE mot ou groupe de mots du titre à mettre en avant, il doit apparaître EXACTEMENT dans le titre), bandeau (une phrase de contexte).
- "contenu" : le corps du carrousel. Champs : badge (ex. "PILIER 2 / 4", numéroté, il donne envie d'aller au bout), emoji (un seul, qui illustre le propos), titre, definition (une phrase entre guillemets qui pose la notion, facultatif), points (1 à ${CAR_POINTS_MAX} cartes), bandeau (la phrase qui frappe, facultatif).
- "recap" : réservé à la dernière slide. Champs : eyebrow, titre, titre_accent, points (les actions demandées), bandeau.

LES RÈGLES QUI DÉCIDENT SI LE CARROUSEL EST LU JUSQU'AU BOUT
1. Le titre de la SLIDE 1 fait tout le travail : il est lu sur une vignette, en une demi-seconde. Maximum ${CAR_MOTS_TITRE_MAX} mots, idéalement ${CAR_MOTS_TITRE_IDEAL}. Une promesse, une tension ou un chiffre, jamais une introduction.
2. Tout titre de slide : maximum ${CAR_MOTS_TITRE_MAX} mots.
3. Un point = un titre de ${CAR_MOTS_POINT_TITRE_MAX} mots maximum, et un texte de ${CAR_MOTS_POINT_TEXTE_MAX} mots maximum. Jamais plus de ${CAR_POINTS_MAX} points par slide : au-delà, la slide devient illisible et plus personne ne la lit.
4. Les ${nbMilieu} slides du milieu portent une pastille NUMÉROTÉE (2 / 5, 3 / 5...) ou un titre qui reste ouvert (suspension, deux-points, question). C'est ce qui crée le besoin d'aller au bout.
5. La DERNIÈRE slide demande une action explicite, en toutes lettres (commenter, enregistrer, épingler, s'abonner, aller en bio). Le lecteur est arrivé au bout, il est prêt à agir.
6. Le bandeau fait ${CAR_MOTS_BANDEAU_MAX} mots maximum. C'est une phrase qui frappe, pas un résumé.

LE VISUEL, séparément
Chaque slide porte aussi un champ "visuel" : la consigne de l'image de fond, décrite pour un générateur d'images. Décris une scène, une ambiance, une lumière. JAMAIS de texte ni de lettres (le texte est posé par-dessus par le moteur de rendu). Garde une direction artistique COHÉRENTE d'une slide à l'autre.${ctx.venteFichier ? `
PRODUIT RÉEL, RÈGLE ABSOLUE : le créateur vend un produit précis et sa VRAIE photo est disponible. Aucun de tes visuels ne doit donc représenter ce produit, ni un emballage, ni un tube, ni un flacon, ni une boîte, ni une étiquette, ni un logo : une image générée en produirait une imitation, forcément différente de la sienne, ce qui ruinerait un carrousel de vente. Décris seulement ce qui ENTOURE le produit : la personne, son geste, son émotion, le décor, la lumière, le problème vécu. Le produit lui-même sera montré par la vraie photo du créateur.` : ''}

RÉPONDS UNIQUEMENT EN JSON VALIDE, sans aucun texte avant ni après :
{"titre":"titre court du carrousel, pour l'historique","analyse":"en 2 phrases, pourquoi cet angle peut fonctionner","direction_visuelle":"la direction artistique commune, en une phrase","slides":[{"numero":1,"gabarit":"couverture","eyebrow":"...","badge":"","emoji":"","titre":"...","titre_accent":"...","definition":"","points":[{"emoji":"🎯","titre":"...","texte":"..."}],"bandeau":"...","visuel":"..."}],"legende":"la légende de la publication, prête à copier, SANS hashtag dedans","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"son_suggere":"le type de son ou de musique, en une phrase (un carrousel sans audio perd une grande partie de sa portée)"}

Le tableau "slides" contient ${ctx.estMatiere ? `AU PLUS ${nb} éléments (moins si la matière n'en porte pas autant), numérotés à partir de 1` : `EXACTEMENT ${nb} éléments, numérotés de 1 à ${nb}`}. La slide 1 est en gabarit "couverture", la slide ${nb} en gabarit "recap", toutes les autres en "contenu". Laisse vides ("" ou []) les champs qui ne servent pas au gabarit choisi.`;
}

// ═══ SCORE DÉTERMINISTE ═══
// Aucun appel IA. Chaque note sort d'un COMPTAGE sur le carrousel réellement
// produit. Deux fois les mêmes slides donnent deux fois le même score, ce qui
// est la condition pour qu'un créateur puisse faire confiance au chiffre.
function carrouselNotePart(part) {
  return Math.round(Math.max(0, Math.min(1, part)) * 100);
}

function carrouselNoteHook(motsTitre, texteTitre) {
  if (!motsTitre) return 0;
  let note;
  if (motsTitre <= CAR_MOTS_TITRE_IDEAL) note = 92;
  else if (motsTitre <= CAR_MOTS_TITRE_MAX) note = 78;
  else if (motsTitre <= CAR_MOTS_TITRE_MAX + 6) note = 55;
  else note = 32;
  // Un chiffre ou une question sont les deux déclencheurs de curiosité les
  // plus fiables du format, et ils se comptent.
  if (/\d/.test(texteTitre)) note += 4;
  if (/\?/.test(texteTitre)) note += 4;
  return Math.max(0, Math.min(100, note));
}

// Chaque élément d'une slide est mesuré contre SON propre plafond. Renvoie le
// nombre d'éléments et le nombre d'éléments conformes.
function carrouselMesurerElements(s) {
  let total = 0, ok = 0;
  const compter = (txt, plafond) => {
    const m = carrouselCompterMots(txt);
    if (!m) return;
    total++;
    if (m <= plafond) ok++;
  };
  compter(s.titre, CAR_MOTS_TITRE_MAX);
  compter(s.definition, CAR_MOTS_POINT_TEXTE_MAX);
  compter(s.bandeau, CAR_MOTS_BANDEAU_MAX);
  (s.points || []).forEach(p => {
    compter(p && p.titre, CAR_MOTS_POINT_TITRE_MAX);
    compter(p && p.texte, CAR_MOTS_POINT_TEXTE_MAX);
  });
  return { total, ok };
}

function scoreCarrousel(slides) {
  const n = Array.isArray(slides) ? slides.length : 0;
  if (!n) return null;

  // 1. Puissance du hook : le titre de la slide 1, mesuré seul.
  const hook = carrouselNoteHook(carrouselCompterMots(slides[0].titre), String(slides[0].titre || ''));

  // 2. Taux de swipe estimé : part des slides du milieu qui laissent
  //    vraiment quelque chose d'ouvert, par pastille numérotée ou par une
  //    fin en suspens. C'est le seul signal qui prédit qu'on arrive au bout.
  const milieu = slides.slice(1, Math.max(1, n - 1));
  const avecRelance = milieu.filter(s => {
    const badge = String((s && s.badge) || '');
    const fin = String((s && (s.bandeau || s.titre)) || '');
    return CAR_BADGE_NUMEROTE.test(badge) || CAR_RELANCE_FIN.test(fin);
  }).length;
  const swipe = milieu.length ? carrouselNotePart(avecRelance / milieu.length) : 0;

  // 3. Lisibilité : part des ÉLÉMENTS qui tiennent dans leur plafond. Mesurer
  //    élément par élément et non la slide entière est ce qui permet à une
  //    slide structurée de porter plus de texte sans être sanctionnée.
  let elemsTotal = 0, elemsOk = 0;
  slides.forEach(s => { const m = carrouselMesurerElements(s); elemsTotal += m.total; elemsOk += m.ok; });
  const lisibilite = elemsTotal ? carrouselNotePart(elemsOk / elemsTotal) : 0;

  // 4. Force du CTA : la dernière slide demande-t-elle vraiment une action ?
  const derniere = slides[n - 1] || {};
  const texteFinal = carrouselTexteSlide(derniere);
  let cta = CAR_MOTS_CTA.test(texteFinal) ? 88 : 30;
  if ((derniere.points || []).length >= 2) cta += 8;
  cta = Math.min(100, cta);

  // 5. Densité : jamais plus de CAR_POINTS_MAX points par slide, et une seule
  //    idée par point. Au-delà, la slide devient un mur et n'est plus lue.
  const sobres = slides.filter(s => (s.points || []).length <= CAR_POINTS_MAX).length;
  const densite = carrouselNotePart(sobres / n);

  const global = Math.round(hook * 0.3 + swipe * 0.25 + lisibilite * 0.2 + cta * 0.15 + densite * 0.1);

  // Ce qui déborde vraiment, slide par slide : c'est le seul défaut qu'un
  // créateur corrige en dix secondes, il doit être nommé, pas deviné.
  const slidesTropLongues = [];
  slides.forEach((s, i) => { const m = carrouselMesurerElements(s); if (m.ok < m.total) slidesTropLongues.push(i + 1); });

  return {
    hook, swipe, lisibilite, cta, densite,
    global: Math.max(0, Math.min(100, global)),
    motsParSlide: slides.map(s => carrouselCompterMots(carrouselTexteSlide(s))),
    slidesTropLongues
  };
}

// ═══ GÉNÉRATION ═══
function choisirObjectifCarrousel(valeur, el) {
  carrouselObjectif = valeur;
  document.querySelectorAll('#carrouselObjectifs .choice').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  syncVenteFieldCarrousel();
}

// Le bloc "ce que tu vends" n'apparaît que pour l'objectif Ventes. Il ne se
// VIDE PAS quand on change d'objectif : un créateur qui hésite entre deux
// objectifs et revient sur Ventes retrouve ce qu'il avait déjà écrit. C'est
// la lecture au moment de générer (carrouselLireFormulaire) qui décide de
// l'utiliser ou non, jamais l'affichage.
function syncVenteFieldCarrousel() {
  const champ = document.getElementById('carrouselVenteField');
  if (champ) champ.style.display = (carrouselObjectif === CARROUSEL_OBJECTIF_VENTES) ? '' : 'none';
}

async function chargerFichierVenteCarrousel(files) {
  carrouselVenteFichier = await lireFichierVente(files, CARROUSEL_VENTE_IDS);
// Le produit chargé sert AUSSI à deviner la niche (demande du propriétaire) :
// le créateur vient de donner l'information, l'app n'a pas à la redemander.
// D'autant que sur l'objectif Ventes, le sujet saisi est souvent très pauvre
// (« vendre un produit »), donc les mots-clés n'ont rien à analyser : le
// fichier est la seule vraie matière. Jamais attendu (pas de await) : le
// chargement du fichier doit rester instantané, la niche se posera une
// seconde plus tard. Jamais par-dessus un choix manuel non plus, c'est
// detecterNicheDepuisFichierVente qui s'en assure.
  if (carrouselVenteFichier && typeof analyserProduitCharge === 'function') {
    analyserProduitCharge(carrouselVenteFichier, 'carrouselNiche', 'nicheAutoNoteCarrousel', 'anglesProduitCarrousel', 'carrouselSujet');
  }
}

function retirerFichierVenteCarrousel() {
  carrouselVenteFichier = null;
  viderFichierVente(CARROUSEL_VENTE_IDS);
}

function carrouselLireFormulaire() {
  const val = id => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  return {
    sujet: val('carrouselSujet'),
    niche: val('carrouselNiche'),
    audience: val('carrouselAudience'),
    ton: val('carrouselTon'),
    objectif: carrouselObjectif || 'faire des vues',
    nbSlides: majCurseurSlidesCarrousel(),
    format: lireFormatCarrousel(),
    // Description ET fichier ne comptent QUE pour l'objectif Ventes : un
    // texte laissé derrière après un changement d'objectif ne doit jamais
    // partir en douce dans un prompt qui ne parle pas de vente.
    venteDescription: carrouselObjectif === CARROUSEL_OBJECTIF_VENTES ? val('carrouselVenteDescription') : '',
    venteFichier: carrouselObjectif === CARROUSEL_OBJECTIF_VENTES ? carrouselVenteFichier : null,
    estMatiere: carrouselEstMatiere(val('carrouselSujet'))
  };
}

function carrouselAfficherErreur(message) {
  const err = document.getElementById('carrouselErrorBox');
  if (!err) return;
  err.textContent = message;
  err.style.display = 'block';
}

// Normalise une slide venue du modèle. Tolère l'ancienne forme (un simple
// champ `texte`) pour que les carrousels déjà enregistrés se rouvrent sans
// rien perdre.
function normaliserSlideCarrousel(s, i, total) {
  const points = Array.isArray(s.points) ? s.points : [];
  const gabaritBrut = String(s.gabarit || '').toLowerCase();
  const gabarit = ['couverture', 'contenu', 'recap'].includes(gabaritBrut)
    ? gabaritBrut
    : (i === 0 ? 'couverture' : (i === total - 1 ? 'recap' : 'contenu'));
  return {
    numero: i + 1,
    gabarit,
    eyebrow: String(s.eyebrow || '').trim(),
    badge: String(s.badge || '').trim(),
    emoji: String(s.emoji || '').trim(),
    titre: String(s.titre || s.texte || '').trim(),
    titre_accent: String(s.titre_accent || '').trim(),
    definition: String(s.definition || '').trim(),
    points: points
      .filter(p => p && (p.titre || p.texte))
      .slice(0, CAR_POINTS_MAX)
      .map(p => ({
        emoji: String(p.emoji || '').trim(),
        titre: String(p.titre || '').trim(),
        texte: String(p.texte || '').trim()
      })),
    bandeau: String(s.bandeau || '').trim(),
    visuel: String(s.visuel || '').trim()
  };
}

// Normalise un résultat COMPLET. Appelée aussi bien après la génération
// qu'à la réouverture d'un carrousel enregistré : c'est le seul point de
// passage qui garantit qu'une slide affichée porte toujours les mêmes
// champs, quelle que soit la version de Scriptura qui l'a produite. Sans
// cela, un carrousel d'avant la refonte de la mise en page se rouvrait avec
// des titres vides, en silence.
function normaliserResultatCarrousel(r) {
  if (!r || !Array.isArray(r.slides) || !r.slides.length) return null;
  const utiles = r.slides.filter(s => s && (s.titre || s.texte || (Array.isArray(s.points) && s.points.length)));
  if (!utiles.length) return null;
  r.slides = utiles.map((s, i) => normaliserSlideCarrousel(s, i, utiles.length));
  r.hashtags = Array.isArray(r.hashtags) ? r.hashtags.map(h => String(h || '').trim()).filter(Boolean) : [];
  return r;
}

function parserCarrousel(texte) {
  const brut = String(texte || '');
  const debut = brut.indexOf('{');
  const fin = brut.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  let parsed;
  try { parsed = JSON.parse(brut.slice(debut, fin + 1)); }
  catch (e) { return null; }
  // La numérotation renvoyée par le modèle n'est jamais reprise telle
  // quelle : un doublon casserait l'association slide/image.
  return normaliserResultatCarrousel(parsed);
}

// ── RECYCLER UNE VIDÉO DÉJÀ PUBLIÉE ──
// Colle le lien d'une vidéo TikTok, on récupère son texte parlé et on le met
// dans le champ sujet, ce qui bascule automatiquement en mode conversion.
// Réutilise /api/tiktok-video?action=transcription, déjà en production pour
// l'analyse virale et les outils TikTok : aucune nouvelle route serveur.
//
// LE CAS EST LE PLUS FORT DE TOUS : le créateur a déjà tourné, déjà vérifié
// que le sujet fonctionne, et il en tire une seconde publication sans
// retourner devant la caméra.
async function recupererTranscriptCarrousel() {
  const lienEl = document.getElementById('carrouselLien');
  const noteEl = document.getElementById('carrouselLienNote');
  const btn = document.getElementById('carrouselLienBtn');
  const spin = document.getElementById('carrouselLienSpinner');
  const fleche = document.getElementById('carrouselLienFleche');
  const cible = document.getElementById('carrouselSujet');
  if (!lienEl || !cible) return;

  const url = (lienEl.value || '').trim();
  if (!url) { lienEl.focus(); return; }
  if (!/^https?:\/\//i.test(url)) {
    if (noteEl) noteEl.textContent = 'Colle un lien complet (qui commence par https://).';
    return;
  }
  // Ne JAMAIS écraser un texte déjà saisi sans prévenir : le créateur a pu
  // coller son script à la main avant de penser au lien.
  if (cible.value.trim() && !window.confirm('Remplacer le texte déjà présent par celui de la vidéo ?')) return;

  if (btn) btn.disabled = true;
  if (spin) spin.style.display = 'block';
  if (fleche) fleche.style.display = 'none';
  if (noteEl) noteEl.textContent = 'On écoute la vidéo et on la transcrit…';

  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 30000);
  try {
    const rep = await fetch('/api/tiktok-video?action=transcription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal
    });
    const data = await rep.json();
    if (!rep.ok) throw new Error((data && data.error && data.error.message) || 'Récupération impossible.');

    if (data.ok && data.transcript) {
      const desc = (data.description || '').trim();
      cible.value = (desc && !data.transcript.includes(desc.slice(0, 30)))
        ? desc + '\n\n' + data.transcript
        : data.transcript;
      // Une vidéo transcrite EST une matière, même si elle est courte.
      carrouselMatiereImposee = true;
      // Déclenche la détection de matière : le basculement en conversion doit
      // se voir exactement comme pour un texte collé à la main. Puis on
      // recompte sur la SEULE TRANSCRIPTION : la description qui la précède
      // est du contexte, pas une idée, et la compter ajoutait une slide de
      // remplissage à chaque conversion depuis un lien.
      cible.dispatchEvent(new Event('input', { bubbles: true }));
      majMatiereCarrousel(data.transcript);
      if (noteEl) noteEl.textContent = 'Texte de la vidéo récupéré. Relis-le, ajuste si besoin, puis génère.';
    } else if (data.description) {
      cible.value = data.description;
      cible.dispatchEvent(new Event('input', { bubbles: true }));
      if (noteEl) noteEl.textContent = "Cette vidéo n'a pas de sous-titres exploitables. On a mis sa description, complète-la à la main.";
    } else {
      if (noteEl) noteEl.textContent = "Cette vidéo n'a pas de sous-titres exploitables. Colle son texte à la main ci-dessous.";
    }
  } catch (e) {
    if (noteEl) {
      noteEl.textContent = (e.name === 'AbortError')
        ? 'La récupération a été trop longue. Réessaie, ou colle le texte à la main.'
        : 'Impossible de lire cette vidéo. Colle son texte à la main ci-dessous.';
    }
  } finally {
    clearTimeout(minuteur);
    if (btn) btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (fleche) fleche.style.display = '';
  }
}

// ── DEPUIS UN SCRIPT DÉJÀ GÉNÉRÉ ──
// Un sujet, deux publications : le créateur qui vient d'obtenir un script en
// tire un carrousel sans un seul copier-coller. La matière, l'angle et le
// hook sont déjà là.
//
// Réservé au SCRIPT, jamais au récit : un récit tient par la tension continue
// et l'immersion, découpé en slides à lire il perd exactement ce qui le rend
// bon. On l'ajoutera si un essai prouve le contraire.
function carrouselDepuisScript() {
  if (typeof currentScript === 'undefined' || !Array.isArray(currentScript) || !currentScript.length) return;
  const texte = currentScript.map(b => String((b && b.texte) || '').trim()).filter(Boolean).join('\n\n');
  if (!texte) return;

  chooseMode('carrousel');
  // Après chooseMode : resetCarrouselForm() vient de vider le formulaire, on
  // écrit donc APRÈS lui, sinon la matière serait effacée aussitôt posée.
  setTimeout(() => {
    const champ = document.getElementById('carrouselSujet');
    if (!champ) return;
    champ.value = texte;
    // Un script EST une matière, quelle que soit sa longueur : un script de
    // 30 secondes fait moins de 400 caractères et passerait sous le seuil.
    carrouselMatiereImposee = true;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    // La niche du script est reprise : elle ne sert plus à écrire (la matière
    // est là), mais elle rend les hashtags et la légende pertinents.
    const niche = (typeof lastGenContext !== 'undefined' && lastGenContext && lastGenContext.niche) || '';
    const menuNiche = document.getElementById('carrouselNiche');
    if (menuNiche && niche) {
      for (const opt of menuNiche.options) {
        if (opt.value === niche || opt.text === niche) { menuNiche.value = opt.value; break; }
      }
    }
    champ.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 0);
}

async function genererCarrousel() {
  const err = document.getElementById('carrouselErrorBox');
  if (err) err.style.display = 'none';

  const ctx = carrouselLireFormulaire();
  if (!ctx.sujet) {
    carrouselAfficherErreur('Dis-moi d\'abord de quoi doit parler ton carrousel.');
    return;
  }

  if (typeof startGenAnimation === 'function') startGenAnimation('carrousel');
  try {
    const texte = await callAI(
      typeof MODEL_CREATIF !== 'undefined' ? MODEL_CREATIF : 'claude-haiku-4-5-20251001',
      6000,
      promptCarrousel(ctx),
      // fichierJoint : la photo produit ou le PDF part dans le message
      // lui-même, comme dans le mode Script. Sans ce paramètre, le bloc
      // "ce que tu vends" serait affiché au créateur mais ignoré par la
      // génération, ce qui est pire que de ne pas l'avoir proposé.
      3, false, 0, 'creation', ctx.venteFichier || null, null, 'carrousel'
    );
    const parsed = parserCarrousel(texte);
    if (!parsed) throw new Error('Réponse illisible, réessaie.');

    carrouselResultat = parsed;
    carrouselContexte = ctx;
    carrouselImages = new Array(parsed.slides.length).fill(null);
    carrouselApercusBlobs = [];
    renderCarrousel();

    // L'enregistrement et la lecture du quota ne doivent JAMAIS retarder
    // l'affichage : le créateur voit son carrousel tout de suite.
    if (typeof saveGeneration === 'function') {
      saveGeneration('carrousel', parsed.titre || ctx.sujet.slice(0, 60), {
        resultat: parsed,
        // Le FICHIER n'est jamais enregistré (plusieurs Mo), seulement la
        // description et le fait qu'un fichier a servi : de quoi comprendre
        // plus tard pourquoi ce carrousel parlait d'une offre précise.
        context: { niche: ctx.niche, sujet: ctx.sujet, objectif: ctx.objectif, nbSlides: ctx.nbSlides, ton: ctx.ton, audience: ctx.audience, format: ctx.format, venteDescription: ctx.venteDescription || '', venteFichierJoint: !!ctx.venteFichier },
        score: scoreCarrousel(parsed.slides)
      });
    }
    if (typeof updateQuotaJour === 'function') updateQuotaJour();
    chargerQuotaImagesCarrousel();
  } catch (e) {
    carrouselAfficherErreur((e && e.message) || 'La génération a échoué, réessaie.');
  } finally {
    if (typeof stopGenAnimation === 'function') stopGenAnimation();
  }
}

// ═══ QUOTA D'IMAGES ═══
// Lu depuis le serveur (même source que le verrou réel), jamais compté
// localement : un rechargement de page remettrait un compteur local à zéro et
// promettrait des images que le serveur refuserait ensuite.
async function chargerQuotaImagesCarrousel() {
  try {
    const code = localStorage.getItem('scriptura_code');
    if (!code) { carrouselQuotaImages = null; majQuotaImagesCarrousel(); return; }
    const rep = await fetch('/api/data?resource=quotaCarrousel&code=' + encodeURIComponent(code));
    const data = await rep.json();
    carrouselQuotaImages = (data && data.ok && data.concerne) ? data : null;
  } catch (e) {
    carrouselQuotaImages = null;
  }
  majQuotaImagesCarrousel();
}

function texteQuotaImagesCarrousel() {
  if (!carrouselQuotaImages) return '';
  if (carrouselQuotaImages.illimite) return 'Images illimitées';
  const restant = Math.max(0, (carrouselQuotaImages.plafond || 0) - (carrouselQuotaImages.used || 0));
  return restant + ' image' + (restant > 1 ? 's' : '') + ' restante' + (restant > 1 ? 's' : '') + ' ce mois';
}

function majQuotaImagesCarrousel() {
  const el = document.getElementById('carrouselQuotaImages');
  if (!el) return;
  const txt = texteQuotaImagesCarrousel();
  el.textContent = txt;
  el.style.display = txt ? '' : 'none';
}

function imagesRestantesCarrousel() {
  if (!carrouselQuotaImages) return null;              // inconnu : le serveur tranchera
  if (carrouselQuotaImages.illimite) return Infinity;
  return Math.max(0, (carrouselQuotaImages.plafond || 0) - (carrouselQuotaImages.used || 0));
}

// ═══ IMAGES ═══
// "sans aucune lettre" n'est pas une précaution de style, c'est la condition
// pour que la slide soit utilisable : la mise en page est posée par-dessus.
function construirePromptImageCarrousel(visuel) {
  const direction = (carrouselResultat && carrouselResultat.direction_visuelle) ? ', ' + carrouselResultat.direction_visuelle : '';
  // Quand le produit du créateur va être POSÉ dans ce décor (voir
  // detourerProduitCarrousel), le décor doit lui faire une place. Sans cette
  // consigne, le modèle remplit tout le cadre et le produit détouré se
  // retrouve collé sur un mur d'objets : ça se voit tout de suite, et ça
  // ruine l'effet. On lui demande donc une zone dégagée là où le produit
  // atterrira, tout en gardant l'interdiction de dessiner un produit.
  const placeProduit = photoProduitCarrousel()
    ? '. Compose la scène en laissant une ZONE DÉGAGÉE et peu chargée dans la moitié haute de l\'image (une surface nette, un mur, une table vide, un fond flou) : un objet réel y sera posé ensuite. Ne dessine AUCUN produit, aucun flacon, aucun tube, aucune boîte, aucun emballage, aucune étiquette : cette place doit rester libre.'
    : '';
  return String(visuel || '') + direction + placeProduit +
    '. Aucune lettre, aucun mot, aucun texte, aucun chiffre visible dans l\'image. Image d\'ambiance sombre et sobre, qui laisse toute la place à un texte ajouté par-dessus. ' + carrouselFormat;
}

// Positions du produit dans le décor, une par slide, en tournant : le même
// objet posé exactement au même endroit sur chaque slide se remarquerait
// immédiatement. Coordonnées en fraction de la slide (centre du produit) et
// hauteur cible, elle aussi en fraction.
const CAR_POSES_PRODUIT = [
  { nom: 'de face, centré', cx: 0.50, cy: 0.34, h: 0.40, rot: 0 },
  { nom: 'posé à droite', cx: 0.68, cy: 0.31, h: 0.34, rot: 0.06 },
  { nom: 'posé à gauche', cx: 0.32, cy: 0.33, h: 0.36, rot: -0.05 },
  { nom: 'en gros plan', cx: 0.55, cy: 0.30, h: 0.48, rot: -0.02 }
];

// Compose le décor généré + le produit détouré, et renvoie un data URL.
// Le produit est posé APRÈS le décor mais AVANT le texte (voir
// composerSlideCarrousel) : il doit rester net et lumineux, c'est le sujet.
function composerFondProduitCarrousel(decorDataUrl, produitDataUrl, i, dims) {
  return new Promise((resolve) => {
    const pose = CAR_POSES_PRODUIT[i % CAR_POSES_PRODUIT.length];
    const cv = document.createElement('canvas');
    cv.width = dims.l; cv.height = dims.h;
    const c = cv.getContext('2d');
    const decor = new Image();
    decor.onload = () => {
      const r = Math.max(cv.width / decor.width, cv.height / decor.height);
      c.drawImage(decor, (cv.width - decor.width * r) / 2, (cv.height - decor.height * r) / 2,
        decor.width * r, decor.height * r);
      const prod = new Image();
      prod.onload = () => {
        const hCible = cv.height * pose.h;
        const ech = hCible / prod.height;
        const pl = prod.width * ech, ph = prod.height * ech;
        c.save();
        c.translate(cv.width * pose.cx, cv.height * pose.cy);
        c.rotate(pose.rot);
        // Ombre portée : sans elle, le produit a l'air collé au-dessus du
        // décor, pas posé dedans.
        c.shadowColor = 'rgba(0,0,0,0.55)';
        c.shadowBlur = Math.round(cv.width * 0.045);
        c.shadowOffsetY = Math.round(cv.height * 0.012);
        c.drawImage(prod, -pl / 2, -ph / 2, pl, ph);
        c.restore();
        resolve(cv.toDataURL('image/png'));
      };
      prod.onerror = () => resolve(decorDataUrl);
      prod.src = produitDataUrl;
    };
    decor.onerror = () => resolve(decorDataUrl);
    decor.src = decorDataUrl;
  });
}

// Un data URL redevient un Blob : la composition produit un data URL, alors
// que le reste du carrousel attend un Blob (téléchargement). base64VersBlob
// vit dans js/montage.js, chargé avant celui-ci.
function dataUrlVersBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m || typeof base64VersBlob !== 'function') return null;
  try { return base64VersBlob(m[2], m[1]); } catch (e) { return null; }
}

// Détoure le produit chargé, une seule fois par fichier : le résultat est
// gardé en mémoire, on ne recalcule pas à chaque slide.
let _produitDetoure = { source: null, resultat: null, averti: false };
function produitDetoureCarrousel() {
  return new Promise((resolve) => {
    const src = photoProduitCarrousel();
    if (!src) return resolve(null);
    if (_produitDetoure.source === src) return resolve(_produitDetoure.resultat);
    const img = new Image();
    img.onload = () => {
      let r = null;
      try { r = detourerProduitCarrousel(img); } catch (e) { r = null; }
      _produitDetoure = { source: src, resultat: r, averti: false };
      resolve(r);
    };
    img.onerror = () => { _produitDetoure = { source: src, resultat: null, averti: false }; resolve(null); };
    img.src = src;
  });
}

async function genererImageCarrousel(i) {
  if (carrouselImagesEnCours || !carrouselResultat) return;
  const slide = carrouselResultat.slides[i];
  if (!slide) return;

  const restant = imagesRestantesCarrousel();
  if (restant === 0) {
    carrouselAfficherErreur('Tu as utilisé toutes tes images de carrousel du mois. Tes slides restent téléchargeables sur fond sobre, c\'est d\'ailleurs ce qui performe le mieux.');
    return;
  }

  carrouselImagesEnCours = true;
  carrouselImageIndexEnCours = i;
  // On met à jour les SEULS boutons, sans reconstruire la zone : un rendu
  // complet effacerait les aperçus déjà composés (ils repartiraient sur
  // "Composition…") et ferait retravailler le canvas sur toutes les slides,
  // à chaque appui, pour rien.
  majBoutonsImageCarrousel();
  try {
    const rep = await fetch('/api/montage-media?action=images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts: [construirePromptImageCarrousel(slide.visuel || slide.titre)],
        format: carrouselFormat,
        usage: 'carrousel',
        code_acces: localStorage.getItem('scriptura_code') || null
      })
    });
    const data = await rep.json();
    const img = data.images && data.images[0];
    if (!rep.ok || !img) {
      throw new Error((data.erreurs && data.erreurs[0]) || (data.error && data.error.message) || 'Échec de génération de l\'image.');
    }
    let apercu = 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.base64;
    // LE PRODUIT ENTRE EN SCÈNE ICI, et seulement ici : sur le clic du
    // créateur, jamais tout seul (demande explicite du propriétaire). Le décor
    // vient d'être généré, on y pose maintenant SA vraie photo détourée, à une
    // place qui tourne d'une slide à l'autre.
    let avecProduit = false;
    const detoure = await produitDetoureCarrousel();
    if (detoure && detoure.dataUrl) {
      const fmt = CAR_FORMATS[carrouselFormat] || CAR_FORMATS[CAR_FORMAT_DEFAUT];
      apercu = await composerFondProduitCarrousel(apercu, detoure.dataUrl, i, fmt);
      avecProduit = true;
    } else if (photoProduitCarrousel() && !_produitDetoure.averti) {
      // Détourage impossible (photo prise dans un décor chargé, pas de fond
      // uni) : on le DIT au lieu de livrer un produit troué ou cerné d'un
      // halo. Le décor généré reste utilisable tel quel. UNE SEULE FOIS par
      // fichier : sur "tout générer", répéter le même avertissement à chaque
      // slide serait insupportable.
      _produitDetoure.averti = true;
      carrouselAfficherErreur('Le décor est généré, mais ton produit n\'a pas pu être détouré : sa photo n\'a pas de fond uni. '
        + 'Une photo sur fond blanc, carton ou drap donnera un bien meilleur résultat.');
    }
    carrouselImages[i] = {
      apercu,
      avecProduit,
      blob: (typeof dataUrlVersBlob === 'function') ? dataUrlVersBlob(apercu) : null
    };
    if (carrouselQuotaImages && !carrouselQuotaImages.illimite) {
      carrouselQuotaImages.used = (carrouselQuotaImages.used || 0) + 1;
    }
  } catch (e) {
    carrouselAfficherErreur('Slide ' + (i + 1) + ' : ' + ((e && e.message) || 'échec de génération.'));
  } finally {
    carrouselImagesEnCours = false;
    carrouselImageIndexEnCours = -1;
    // Rendu complet cette fois : le fond reçu doit apparaître sur l'aperçu.
    renderCarrousel();
    majQuotaImagesCarrousel();
  }
}

// "Tout générer" ANNONCE TOUJOURS LE COÛT avant de partir. Découvrir après
// coup qu'on vient de vider son quota du mois est le genre de surprise qui
// fait résilier.
async function genererToutesImagesCarrousel() {
  if (carrouselImagesEnCours || !carrouselResultat) return;
  const manquantes = carrouselResultat.slides
    .map((s, i) => (carrouselImages[i] ? null : i))
    .filter(i => i !== null);
  if (!manquantes.length) return;

  const restant = imagesRestantesCarrousel();
  let message = 'Générer ' + manquantes.length + ' image' + (manquantes.length > 1 ? 's' : '') + ' ?';
  if (restant !== null && restant !== Infinity) {
    message += '\n\nCela utilisera ' + Math.min(manquantes.length, restant) + ' de tes ' + restant + ' images restantes ce mois.';
    if (manquantes.length > restant) {
      message += '\nIl t\'en manque ' + (manquantes.length - restant) + ', les dernières slides resteront sur fond sobre.';
    }
  }
  if (!window.confirm(message)) return;

  for (const i of manquantes) {
    if (imagesRestantesCarrousel() === 0) break;
    await genererImageCarrousel(i);
  }
}

// ═══════════════════════════════════════════════════════════
//  COMPOSITION DE LA SLIDE
//  Un vrai moteur de mise en page, pas une phrase centrée. Les blocs sont
//  d'abord MESURÉS, puis dessinés, ce qui permet deux choses indispensables :
//  centrer verticalement l'ensemble, et réduire l'échelle quand le contenu ne
//  tient pas (le 16:9 offre bien moins de hauteur que le 9:16, la même slide
//  doit tenir dans les deux sans déborder).
// ═══════════════════════════════════════════════════════════

// Les polices de l'app (Playfair Display, Poppins) doivent être RÉELLEMENT
// chargées avant le premier dessin : sans cette attente, le canvas retombe
// silencieusement sur une police système et la slide n'a plus rien à voir
// avec l'app.
async function carrouselChargerPolices() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load('700 100px "Playfair Display"'),
      document.fonts.load('400 100px "Playfair Display"'),
      document.fonts.load('600 40px Poppins'),
      document.fonts.load('400 40px Poppins')
    ]);
  } catch (e) { /* police indisponible : le repli Georgia/system-ui suffit */ }
}

function carrouselRectArrondi(c, x, y, l, h, r) {
  const rayon = Math.min(r, l / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rayon, y);
  c.arcTo(x + l, y, x + l, y + h, rayon);
  c.arcTo(x + l, y + h, x, y + h, rayon);
  c.arcTo(x, y + h, x, y, rayon);
  c.arcTo(x, y, x + l, y, rayon);
  c.closePath();
}

// Découpe un texte en lignes tenant dans `largeurMax`. Un mot plus long que
// la ligne entière (une URL, un mot composé) est laissé tel quel plutôt que
// coupé n'importe où : mieux vaut un léger débordement qu'un mot illisible.
function carrouselLignes(c, texte, largeurMax) {
  const mots = String(texte || '').split(/\s+/).filter(Boolean);
  const lignes = [];
  let ligne = '';
  for (const mot of mots) {
    const essai = ligne ? ligne + ' ' + mot : mot;
    if (c.measureText(essai).width > largeurMax && ligne) { lignes.push(ligne); ligne = mot; }
    else ligne = essai;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

// Découpe un titre en lignes de SEGMENTS colorés, pour mettre un mot en
// avant dans la couleur d'accent sans casser le retour à la ligne.
function carrouselLignesAccentuees(c, titre, accent, largeurMax) {
  const t = String(titre || '');
  const cible = String(accent || '').trim();
  let morceaux;
  const pos = cible ? t.toLowerCase().indexOf(cible.toLowerCase()) : -1;
  if (cible && pos >= 0) {
    morceaux = [
      { txt: t.slice(0, pos), accent: false },
      { txt: t.slice(pos, pos + cible.length), accent: true },
      { txt: t.slice(pos + cible.length), accent: false }
    ].filter(m => m.txt);
  } else {
    morceaux = [{ txt: t, accent: false }];
  }

  const jetons = [];
  morceaux.forEach(m => {
    m.txt.split(/(\s+)/).forEach(bout => {
      if (!bout) return;
      if (/^\s+$/.test(bout)) { jetons.push({ txt: ' ', accent: m.accent, espace: true }); }
      else jetons.push({ txt: bout, accent: m.accent });
    });
  });

  const lignes = [];
  let courante = [];
  let largeur = 0;
  for (const jeton of jetons) {
    const l = c.measureText(jeton.txt).width;
    if (largeur + l > largeurMax && courante.length && !jeton.espace) {
      lignes.push(courante);
      courante = [jeton];
      largeur = l;
    } else {
      if (!(jeton.espace && !courante.length)) { courante.push(jeton); largeur += l; }
    }
  }
  if (courante.length) lignes.push(courante);
  return lignes;
}

// Construit la liste des blocs d'une slide. Chaque bloc sait se mesurer et se
// dessiner à une échelle donnée : c'est ce qui rend les 4 formats possibles
// avec une seule description de mise en page.
function carrouselBlocs(slide, accent) {
  const blocs = [];
  // Couverture ALIGNÉE À GAUCHE, récap centré : c'est exactement la
  // répartition des carrousels de référence. Une couverture centrée fait
  // "citation", une couverture calée à gauche fait "titre de chapitre", et
  // c'est ce second registre qui donne son autorité au carrousel.
  const centre = slide.gabarit === 'recap';
  if (slide.eyebrow) blocs.push({ type: 'eyebrow', txt: slide.eyebrow, centre });
  if (slide.eyebrow && slide.gabarit === 'couverture') blocs.push({ type: 'filet', centre });
  if (slide.badge) blocs.push({ type: 'badge', txt: slide.badge });
  if (slide.titre) blocs.push({ type: 'titre', txt: slide.titre, accentTxt: slide.titre_accent, emoji: slide.emoji, centre });
  if (slide.definition) blocs.push({ type: 'definition', txt: slide.definition });
  (slide.points || []).forEach(p => blocs.push({ type: 'point', point: p }));
  if (slide.bandeau) blocs.push({ type: 'bandeau', txt: slide.bandeau, centre: true });
  return blocs;
}

// Mesure ET dessine (selon `dessiner`), en renvoyant la hauteur totale. Un
// seul chemin de code pour les deux passes : impossible que la mesure et le
// rendu divergent.
function carrouselDisposer(c, blocs, zone, e, accent, dessiner, yDepart, u) {
  const L = zone.l;
  let y = yDepart;
  // Espacement entre blocs, avec un PLANCHER exprimé en unités de slide.
  // Retour propriétaire, capture à l'appui : sur une slide dense, la pastille
  // et le titre se touchaient presque (12px mesurés). CAUSE : l'espacement
  // suivait l'échelle de réduction appliquée pour faire tenir le contenu.
  // Or quand la mise en page rétrécit, le texte devient plus petit mais le
  // besoin de SÉPARATION, lui, ne rétrécit pas dans la même proportion :
  // sans plancher, une slide dense finit entièrement collée.
  const uRef = u || e;
  const espace = Math.max(24 * e, 17 * uRef);
  // La pastille ANNONCE le titre, mais reste un bloc distinct : elle a besoin
  // de plus d'air que deux cartes de contenu qui se suivent, sinon les deux
  // se lisent comme un seul bloc empilé.
  const espaceApresBadge = Math.max(38 * e, 27 * uRef);

  const police = (poids, taille, famille) => { c.font = poids + ' ' + Math.round(taille * e) + 'px ' + famille; };

  blocs.forEach((bloc, idx) => {
    if (idx) y += (blocs[idx - 1].type === 'badge' ? espaceApresBadge : espace);

    if (bloc.type === 'eyebrow') {
      police('600', 26, CAR_SANS);
      // L'interlettrage large des petites capitales est dessiné à la main :
      // canvas n'expose pas letter-spacing de façon portable.
      const txt = bloc.txt.toUpperCase();
      const pas = 5 * e;
      const largeur = c.measureText(txt).width + pas * Math.max(0, txt.length - 1);
      if (dessiner) {
        c.fillStyle = accent.trait;
        c.textAlign = 'left';
        let x = bloc.centre ? zone.x + (L - largeur) / 2 : zone.x;
        for (const ch of txt) { c.fillText(ch, x, y + 26 * e); x += c.measureText(ch).width + pas; }
      }
      y += 32 * e;

    } else if (bloc.type === 'filet') {
      if (dessiner) {
        c.fillStyle = accent.trait;
        const l = 110 * e;
        c.fillRect(bloc.centre ? zone.x + (L - l) / 2 : zone.x, y + 10 * e, l, 4 * e);
      }
      y += 20 * e;

    } else if (bloc.type === 'badge') {
      police('600', 26, CAR_SANS);
      const h = 60 * e;
      if (dessiner) {
        c.fillStyle = accent.doux;
        carrouselRectArrondi(c, zone.x, y, L, h, h / 2);
        c.fill();
        c.strokeStyle = accent.bord;
        c.lineWidth = 2 * e;
        c.stroke();
        c.fillStyle = accent.trait;
        c.textAlign = 'left';
        c.fillText(bloc.txt.toUpperCase(), zone.x + 32 * e, y + h / 2 + 9 * e);
      }
      y += h;

    } else if (bloc.type === 'titre') {
      const tuile = bloc.emoji ? 96 * e : 0;
      const decal = tuile ? tuile + 24 * e : 0;
      const taille = bloc.centre ? 62 : 54;
      police('700', taille, CAR_SERIF);
      const lignes = carrouselLignesAccentuees(c, bloc.txt, bloc.accentTxt, L - decal);
      const interligne = taille * 1.22 * e;
      if (dessiner) {
        if (tuile) {
          c.fillStyle = accent.doux;
          carrouselRectArrondi(c, zone.x, y, tuile, tuile, 22 * e);
          c.fill();
          c.strokeStyle = accent.bord; c.lineWidth = 2 * e; c.stroke();
          c.font = Math.round(52 * e) + 'px ' + CAR_SANS;
          c.textAlign = 'center';
          // textBaseline 'middle' plutôt qu'un décalage deviné : les emoji
          // n'ont pas les mêmes métriques que le texte latin, un décalage
          // calculé sur la taille de police les posait de travers dans leur
          // tuile (retour propriétaire, capture à l'appui).
          c.textBaseline = 'middle';
          c.fillStyle = CAR_ENCRE;
          c.fillText(bloc.emoji, zone.x + tuile / 2, y + tuile / 2);
          c.textBaseline = 'alphabetic';
          police('700', taille, CAR_SERIF);
        }
        c.textAlign = 'left';
        // Sans tuile, le bloc part du HAUT de la zone : la première ligne
        // descend d'une hauteur d'ascendante (0,78 de la taille de police).
        // Avec une tuile, il doit être CENTRÉ sur elle, ce qui donne un
        // décalage tout différent (0,25) : reprendre 0,78 posait le titre une
        // trentaine de pixels trop bas, et l'oeil le voyait tout de suite.
        let ly = tuile
          ? y + tuile / 2 - ((lignes.length - 1) * interligne) / 2 + taille * 0.25 * e
          : y + taille * 0.78 * e;
        lignes.forEach(ligne => {
          const largeur = ligne.reduce((acc, j) => acc + c.measureText(j.txt).width, 0);
          let x = bloc.centre ? zone.x + decal + (L - decal - largeur) / 2 : zone.x + decal;
          ligne.forEach(j => {
            c.fillStyle = j.accent ? accent.trait : CAR_ENCRE;
            c.fillText(j.txt, x, ly);
            x += c.measureText(j.txt).width;
          });
          ly += interligne;
        });
      }
      y += Math.max(tuile, lignes.length * interligne);

    } else if (bloc.type === 'definition') {
      const pad = 30 * e;
      police('600', 24, CAR_SANS);
      const hLabel = 34 * e;
      c.font = 'italic 400 ' + Math.round(34 * e) + 'px ' + CAR_SERIF;
      const lignes = carrouselLignes(c, '"' + bloc.txt + '"', L - pad * 2);
      const interligne = 46 * e;
      const h = pad * 2 + hLabel + lignes.length * interligne;
      if (dessiner) {
        c.fillStyle = 'rgba(255,255,255,0.045)';
        carrouselRectArrondi(c, zone.x, y, L, h, 26 * e);
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 2 * e; c.stroke();
        police('600', 24, CAR_SANS);
        c.fillStyle = accent.trait;
        c.textAlign = 'left';
        let x = zone.x + pad;
        for (const ch of 'DÉFINITION') { c.fillText(ch, x, y + pad + 22 * e); x += c.measureText(ch).width + 4 * e; }
        c.font = 'italic 400 ' + Math.round(34 * e) + 'px ' + CAR_SERIF;
        c.fillStyle = CAR_ENCRE;
        let ly = y + pad + hLabel + 34 * e;
        lignes.forEach(l => { c.fillText(l, zone.x + pad, ly); ly += interligne; });
      }
      y += h;

    } else if (bloc.type === 'point') {
      const p = bloc.point;
      const pad = 28 * e;
      const colEmoji = p.emoji ? 62 * e : 0;
      const largeurTxt = L - pad * 2 - colEmoji;
      let h = pad * 2;
      let lignesTitre = [], lignesTexte = [];
      if (p.titre) { police('600', 32, CAR_SANS); lignesTitre = carrouselLignes(c, p.titre, largeurTxt); h += lignesTitre.length * 42 * e; }
      if (p.texte) { police('400', 30, CAR_SANS); lignesTexte = carrouselLignes(c, p.texte, largeurTxt); h += lignesTexte.length * 40 * e; }
      if (p.titre && p.texte) h += 6 * e;
      if (dessiner) {
        c.fillStyle = 'rgba(255,255,255,0.045)';
        carrouselRectArrondi(c, zone.x, y, L, h, 26 * e);
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 2 * e; c.stroke();
        if (p.emoji) {
          c.font = Math.round(38 * e) + 'px ' + CAR_SANS;
          c.textAlign = 'left';
          c.fillStyle = CAR_ENCRE;
          c.fillText(p.emoji, zone.x + pad, y + pad + 34 * e);
        }
        const xTxt = zone.x + pad + colEmoji;
        let ly = y + pad;
        c.textAlign = 'left';
        if (lignesTitre.length) {
          police('600', 32, CAR_SANS);
          c.fillStyle = CAR_ENCRE;
          lignesTitre.forEach(l => { c.fillText(l, xTxt, ly + 32 * e); ly += 42 * e; });
          if (lignesTexte.length) ly += 6 * e;
        }
        if (lignesTexte.length) {
          police('400', 30, CAR_SANS);
          c.fillStyle = CAR_ENCRE_DOUCE;
          lignesTexte.forEach(l => { c.fillText(l, xTxt, ly + 30 * e); ly += 40 * e; });
        }
      }
      y += h;

    } else if (bloc.type === 'bandeau') {
      const pad = 26 * e;
      police('500', 30, CAR_SANS);
      const lignes = carrouselLignes(c, bloc.txt, L - pad * 2);
      const interligne = 42 * e;
      const h = pad * 2 + lignes.length * interligne;
      if (dessiner) {
        c.fillStyle = accent.doux;
        carrouselRectArrondi(c, zone.x, y, L, h, 26 * e);
        c.fill();
        c.strokeStyle = accent.bord; c.lineWidth = 2 * e; c.stroke();
        c.fillStyle = accent.trait;
        c.textAlign = 'center';
        let ly = y + pad + 30 * e;
        lignes.forEach(l => { c.fillText(l, zone.x + L / 2, ly); ly += interligne; });
      }
      y += h;
    }
  });

  return y - yDepart;
}

// Cherche la plus grande échelle qui tienne dans la hauteur disponible. Sans
// elle, un carrousel dense en 16:9 (deux fois moins haut que le 9:16)
// déborderait purement et simplement hors de la slide.
function carrouselEchelleQuiTient(c, blocs, zone, accent, hauteurDispo, echelleMax) {
  const haut = echelleMax || 1;
  // La plage descend jusqu'à 35% : le 16:9 offre deux fois moins de hauteur
  // que le 9:16 pour un contenu identique. Une plage trop courte laissait la
  // slide déborder purement et simplement hors du cadre, sans erreur ni
  // signal, c'est-à-dire le pire des défauts possibles ici.
  for (let f = 1; f >= 0.35; f -= 0.03) {
    const e = haut * f;
    // `haut` (l'unité de slide) est transmis pour que la MESURE applique
    // exactement le même plancher d'espacement que le rendu : sans lui, la
    // hauteur mesurée serait plus petite que la hauteur dessinée, et la
    // slide déborderait.
    if (carrouselDisposer(c, blocs, zone, e, accent, false, 0, haut) <= hauteurDispo) return e;
  }
  return haut * 0.35;
}

function carrouselFond(c, L, H) {
  const fond = c.createLinearGradient(0, 0, L, H);
  fond.addColorStop(0, '#0E0E11');
  fond.addColorStop(0.5, '#111114');
  fond.addColorStop(1, '#0B0B0D');
  c.fillStyle = fond;
  c.fillRect(0, 0, L, H);
  // Halo radial très discret, comme sur les carrousels de référence : il
  // évite le fond parfaitement plat, qui fait "capture d'écran".
  const halo = c.createRadialGradient(L / 2, H * 0.22, 0, L / 2, H * 0.22, L * 0.7);
  halo.addColorStop(0, 'rgba(201,168,76,0.07)');
  halo.addColorStop(1, 'rgba(201,168,76,0)');
  c.fillStyle = halo;
  c.fillRect(0, 0, L, H);
}

// ── LA VRAIE PHOTO DU PRODUIT, EN FOND DE SLIDE ──
//
// Demande du propriétaire : « quand l'utilisateur charge une image produit,
// l'app doit utiliser cette image sous différents plans, posture, position,
// dans les images d'arrière-plan du carrousel ». Constat sur son test : le
// carrousel PARLAIT bien du produit, mais aucune slide ne le MONTRAIT, ses
// fonds étaient des ambiances générées.
//
// CE QU'ON PEUT ET CE QU'ON NE PEUT PAS. On ne peut pas fabriquer son produit
// « sous un autre angle » : la génération d'images ne reçoit qu'un TEXTE, pas
// d'image de référence (api/montage-media.js), elle produirait un sosie, et
// sur un carrousel de vente un sosie est pire que rien. En revanche, une
// photo se RECADRE : d'un même fichier on tire un plan large, un plan serré
// et un plan décalé, ce qui donne trois arrière-plans différents avec le VRAI
// produit, jamais une imitation.
const CAR_CADRAGES_PRODUIT = [
  { nom: 'plan large', zoom: 1.0, ax: 0.5, ay: 0.5 },
  { nom: 'plan serré', zoom: 1.75, ax: 0.5, ay: 0.42 },
  { nom: 'plan décalé', zoom: 1.35, ax: 0.3, ay: 0.55 }
];

// Le fichier produit n'est utilisable en fond que si c'est une IMAGE : un PDF
// (ebook, brochure) apporte du texte au prompt, pas un visuel de vente.
function photoProduitCarrousel() {
  const f = carrouselVenteFichier;
  if (!f || !f.base64 || !/^image\//i.test(f.mediaType || '')) return null;
  return 'data:' + f.mediaType + ';base64,' + f.base64;
}

// ── DÉTOURAGE DU PRODUIT, PUIS MISE EN DÉCOR ──
//
// Demande du propriétaire : « l'app doit en arrière-plan faire le produit de
// l'image sur fond transparent avant de le servir dans différents décors,
// quand l'utilisateur cliquera sur générer un fond ».
//
// POURQUOI ON DÉTOURE NOUS-MÊMES plutôt que de le demander au modèle : la
// génération d'images ne reçoit qu'un TEXTE, jamais d'image de référence
// (api/montage-media.js). Elle ne peut donc ni détourer la photo du créateur,
// ni la redessiner : elle produirait un sosie, avec une étiquette en charabia
// et un faux logo. Le seul moyen d'avoir SON produit dans un décor, c'est de
// découper sa vraie photo ici, dans le navigateur, et de la poser sur le
// décor généré.
//
// LA MÉTHODE : remplissage par diffusion depuis les bords. On part de tous
// les pixels du contour, on avale tout ce qui ressemble à la couleur du fond
// à une tolérance près, et on rend ces pixels transparents. C'est la méthode
// qui convient aux photos de produit, presque toujours prises sur un fond
// uni (blanc studio, carton, drap). Elle est instantanée, gratuite, et ne
// dépend d'aucun service extérieur.
//
// SES LIMITES, ASSUMÉES ET SURVEILLÉES : sur une photo prise dans un décor
// chargé (le produit sur une table de salle de bain), la diffusion ne trouve
// pas de fond uni et fait n'importe quoi. On MESURE donc ce qu'on a retiré :
// trop peu ou presque tout, on refuse de détourer et on le dit, plutôt que de
// livrer un produit troué ou entouré d'un halo.
const CAR_DETOURAGE_TOLERANCE = 34;      // écart de couleur admis, sur 255
const CAR_DETOURAGE_MIN = 0.06;          // moins de 6 % retiré : pas de fond uni
const CAR_DETOURAGE_MAX = 0.94;          // plus de 94 % : on a mangé le produit
const CAR_DETOURAGE_TAILLE_MAX = 1100;   // borne le coût du calcul

// Réduit l'image si besoin et rend son contexte 2D, prêt à être analysé.
function _canvasDepuisImage(img, tailleMax) {
  const ratio = Math.min(1, tailleMax / Math.max(img.width, img.height));
  const L = Math.max(1, Math.round(img.width * ratio));
  const H = Math.max(1, Math.round(img.height * ratio));
  const cv = document.createElement('canvas');
  cv.width = L; cv.height = H;
  cv.getContext('2d').drawImage(img, 0, 0, L, H);
  return cv;
}

// Couleur de fond estimée : la MÉDIANE des pixels du contour, jamais la
// moyenne. Une moyenne se laisse tirer par un coin d'ombre ou un reflet, et
// on détourerait alors autour d'une couleur qui n'existe nulle part.
function _couleurFond(data, L, H) {
  const r = [], v = [], b = [];
  const pousser = (x, y) => {
    const k = (y * L + x) * 4;
    r.push(data[k]); v.push(data[k + 1]); b.push(data[k + 2]);
  };
  for (let x = 0; x < L; x++) { pousser(x, 0); pousser(x, H - 1); }
  for (let y = 0; y < H; y++) { pousser(0, y); pousser(L - 1, y); }
  const med = (t) => { t.sort((a, b2) => a - b2); return t[Math.floor(t.length / 2)]; };
  return [med(r), med(v), med(b)];
}

// Détoure et renvoie { dataUrl, part } où `part` est la fraction de l'image
// rendue transparente. Renvoie null si le résultat n'est pas exploitable :
// mieux vaut pas de détourage du tout qu'un produit abîmé.
function detourerProduitCarrousel(img) {
  const cv = _canvasDepuisImage(img, CAR_DETOURAGE_TAILLE_MAX);
  const L = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');
  const image = ctx.getImageData(0, 0, L, H);
  const data = image.data;
  const fond = _couleurFond(data, L, H);
  const tol = CAR_DETOURAGE_TOLERANCE;

  const vu = new Uint8Array(L * H);
  const pile = [];
  const proche = (k) => Math.abs(data[k] - fond[0]) <= tol
    && Math.abs(data[k + 1] - fond[1]) <= tol
    && Math.abs(data[k + 2] - fond[2]) <= tol;

  for (let x = 0; x < L; x++) { pile.push(x); pile.push((H - 1) * L + x); }
  for (let y = 0; y < H; y++) { pile.push(y * L); pile.push(y * L + L - 1); }

  let retires = 0;
  while (pile.length) {
    const p = pile.pop();
    if (vu[p]) continue;
    const k = p * 4;
    if (!proche(k)) continue;
    vu[p] = 1;
    data[k + 3] = 0;
    retires++;
    const x = p % L, y = (p - x) / L;
    if (x > 0) pile.push(p - 1);
    if (x < L - 1) pile.push(p + 1);
    if (y > 0) pile.push(p - L);
    if (y < H - 1) pile.push(p + L);
  }

  const part = retires / (L * H);
  if (part < CAR_DETOURAGE_MIN || part > CAR_DETOURAGE_MAX) return null;
  ctx.putImageData(image, 0, 0);
  return { dataUrl: cv.toDataURL('image/png'), part };
}

// AUCUNE slide ne porte le produit d'office. Essayé (photo posée
// automatiquement sur la couverture, l'offre et une slide du milieu), refusé
// par le propriétaire : « tous les slides doivent être générés avec le fond
// sombre comme avant, et c'est quand on va cliquer sur générer un fond que
// l'image va apparaître ». Le produit n'entre donc en scène que sur un geste
// du créateur, jamais tout seul. Voir composerFondProduitCarrousel plus bas,
// qui fabrique ce fond au moment du clic.

function composerSlideCarrousel(i) {
  return new Promise((resolve, reject) => {
    if (!carrouselResultat || !carrouselResultat.slides[i]) return reject(new Error('Slide introuvable'));
    const slide = carrouselResultat.slides[i];
    const total = carrouselResultat.slides.length;
    const fmt = CAR_FORMATS[carrouselFormat] || CAR_FORMATS[CAR_FORMAT_DEFAUT];
    const L = fmt.l, H = fmt.h;
    // La mise en page est décrite pour une slide de 1080 de large sur 1350 de
    // haut (le 4:5). L'unité retient la plus CONTRAIGNANTE des deux
    // dimensions : sur un 16:9, partir de la seule largeur dessinait tout
    // 1,78 fois trop grand pour une hauteur deux fois moindre.
    const u = Math.min(L / 1080, H / 1350);
    const accent = carrouselAccent(i);

    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = H;
    const c = canvas.getContext('2d');

    const dessiner = () => {
      // Cadre fin, légèrement doré, qui referme la slide comme sur les
      // carrousels de référence.
      const marge = 30 * u;
      c.strokeStyle = 'rgba(201,168,76,0.30)';
      c.lineWidth = 2 * u;
      carrouselRectArrondi(c, marge, marge, L - marge * 2, H - marge * 2, 42 * u);
      c.stroke();

      // Barre de progression segmentée : autant de segments que de slides,
      // remplis jusqu'à celle qu'on regarde. C'est le repère qui dit au
      // lecteur combien il lui reste, et c'est un moteur de swipe à lui seul.
      const bl = Math.min(L - (marge + 34 * u) * 2, 1180 * u);
      const bx = (L - bl) / 2;
      const ecart = 10 * u;
      const seg = (bl - ecart * (total - 1)) / total;
      const by = marge + 28 * u;
      for (let s = 0; s < total; s++) {
        c.fillStyle = s <= i ? '#C9A84C' : 'rgba(255,255,255,0.17)';
        carrouselRectArrondi(c, bx + s * (seg + ecart), by, Math.max(seg, 1), 6 * u, 3 * u);
        c.fill();
      }

      // Colonne de texte bornée puis centrée : sur un 16:9, occuper toute la
      // largeur donnerait des lignes de près de 1900 pixels, que l'oeil ne
      // sait pas suivre d'une ligne à l'autre.
      const dispoL = L - (marge + 52 * u) * 2;
      const largeurColonne = Math.min(dispoL, 1180 * u);
      const zone = { x: (L - largeurColonne) / 2, l: largeurColonne };
      const hautContenu = by + 44 * u;
      const basContenu = H - marge - 40 * u;
      const dispo = basContenu - hautContenu;

      const blocs = carrouselBlocs(slide, accent);
      const e = carrouselEchelleQuiTient(c, blocs, zone, accent, dispo, u);
      const hauteur = carrouselDisposer(c, blocs, zone, e, accent, false, 0, u);
      // Centrage vertical, mais jamais au-dessus du haut de la zone : une
      // slide dense reste calée sous la barre de progression.
      const y = Math.max(hautContenu, hautContenu + (dispo - hauteur) / 2);
      carrouselDisposer(c, blocs, zone, e, accent, true, y, u);

      // Pagination discrète en bas, en doré : le lecteur sait toujours où il
      // en est, même si la barre du haut est masquée par l'interface TikTok.
      c.font = '600 ' + Math.round(28 * u) + 'px ' + CAR_SANS;
      c.textAlign = 'center';
      c.fillStyle = 'rgba(201,168,76,0.75)';
      c.fillText((i + 1) + ' / ' + total, L / 2, H - marge - 22 * u);

      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Composition impossible')), 'image/png');
    };

    const demarrer = () => {
      carrouselFond(c, L, H);
      const image = carrouselImages[i];
      if (image && image.apercu) {
        const img = new Image();
        img.onload = () => {
          const ratio = Math.max(L / img.width, H / img.height);
          const il = img.width * ratio, ih = img.height * ratio;
          c.drawImage(img, (L - il) / 2, (H - ih) / 2, il, ih);
          // Voile sombre : la mise en page doit rester lisible quelle que
          // soit l'image, sans effacer complètement la photo. Allégé quand le
          // fond porte le produit détouré : le noyer sous 0,72 reviendrait à
          // le générer pour rien.
          const voile = c.createLinearGradient(0, 0, 0, H);
          if (image.avecProduit) {
            voile.addColorStop(0, 'rgba(10,10,12,0.42)');
            voile.addColorStop(0.45, 'rgba(10,10,12,0.62)');
            voile.addColorStop(1, 'rgba(10,10,12,0.93)');
          } else {
            voile.addColorStop(0, 'rgba(10,10,12,0.72)');
            voile.addColorStop(1, 'rgba(10,10,12,0.88)');
          }
          c.fillStyle = voile;
          c.fillRect(0, 0, L, H);
          dessiner();
        };
        img.onerror = dessiner;
        img.src = image.apercu;
      } else {
        dessiner();
      }
    };

    carrouselChargerPolices().then(demarrer, demarrer);
  });
}

function nomSlideCarrousel(i) {
  return 'carrousel-' + carrouselFormat.replace(':', 'x') + '-slide-' + String(i + 1).padStart(2, '0') + '.png';
}

// SYNCHRONE tant que l'aperçu est déjà composé : c'est ce qui préserve le
// geste utilisateur et ouvre vraiment la feuille de partage native sur
// iPhone. On ne recompose (avec attente) que si l'aperçu manque, cas où le
// repli en téléchargement classique est de toute façon acceptable.
function telechargerSlideCarrousel(i) {
  const dejaComposee = carrouselApercusBlobs[i];
  if (dejaComposee) {
    partagerFichiers(dejaComposee, nomSlideCarrousel(i), 'Slide Scriptura');
    return;
  }
  composerSlideCarrousel(i)
    .then(blob => { carrouselApercusBlobs[i] = blob; partagerFichiers(blob, nomSlideCarrousel(i), 'Slide Scriptura'); })
    .catch(e => carrouselAfficherErreur('Téléchargement impossible : ' + ((e && e.message) || 'erreur inconnue')));
}

// TOUTES les slides dans UNE SEULE feuille de partage ("Enregistrer 8
// images" sur iOS), jamais une feuille par slide : le navigateur bloquerait
// les suivantes dès la première, et huit feuilles d'affilée seraient de toute
// façon impraticables.
function telechargerToutesSlidesCarrousel() {
  if (!carrouselResultat) return;
  const total = carrouselResultat.slides.length;
  const pretes = [];
  const noms = [];
  for (let i = 0; i < total; i++) {
    if (carrouselApercusBlobs[i]) { pretes.push(carrouselApercusBlobs[i]); noms.push(nomSlideCarrousel(i)); }
  }
  // Toutes déjà composées : partage immédiat, geste utilisateur intact.
  if (pretes.length === total) {
    partagerFichiers(pretes, noms, 'Carrousel Scriptura');
    return;
  }
  // Sinon on complète, en acceptant de perdre le geste : mieux vaut un
  // téléchargement classique complet qu'un partage partiel.
  const manquantes = [];
  for (let i = 0; i < total; i++) manquantes.push(carrouselApercusBlobs[i] || composerSlideCarrousel(i));
  Promise.all(manquantes)
    .then(blobs => {
      blobs.forEach((b, i) => { carrouselApercusBlobs[i] = b; });
      partagerFichiers(blobs, blobs.map((b, i) => nomSlideCarrousel(i)), 'Carrousel Scriptura');
    })
    .catch(e => carrouselAfficherErreur('Téléchargement impossible : ' + ((e && e.message) || 'erreur inconnue')));
}

// Ce qu'on colle tel quel dans TikTok au moment de publier : la légende, puis
// les hashtags. Une seule source pour le bouton Copier et pour le bouton
// Partager, qui ne peuvent donc jamais diverger.
function legendeCompleteCarrousel() {
  if (!carrouselResultat) return '';
  const legende = String(carrouselResultat.legende || '').trim();
  const tags = (carrouselResultat.hashtags || []).map(h => String(h).toLowerCase()).join(' ');
  return [legende, tags].filter(Boolean).join('\n\n');
}

function copierTexteCarrousel() {
  if (!carrouselResultat) return;
  const lignes = carrouselResultat.slides.map(s => 'Slide ' + s.numero + ' : ' + carrouselTexteSlide(s));
  if (carrouselResultat.legende) lignes.push('', 'Légende : ' + carrouselResultat.legende);
  if (carrouselResultat.hashtags && carrouselResultat.hashtags.length) lignes.push(carrouselResultat.hashtags.join(' '));
  const texte = lignes.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texte);
}

// ═══ RENDU DE L'ÉCRAN ═══
// L'aperçu de chaque slide est la VRAIE composition, pas une maquette HTML
// approchante : ce que le créateur voit est exactement ce qu'il télécharge.
async function peindreApercusCarrousel() {
  if (!carrouselResultat) return;
  for (let i = 0; i < carrouselResultat.slides.length; i++) {
    const hote = document.getElementById('carApercu' + i);
    if (!hote) continue;
    try {
      const blob = await composerSlideCarrousel(i);
      // MÉMORISÉE pour le téléchargement : sur iPhone, Safari retire
      // l'autorisation d'ouvrir la feuille de partage native si une attente
      // asynchrone a lieu entre le clic et l'appel. Composer la slide AU
      // MOMENT du clic ferait donc perdre le geste, et le créateur
      // retomberait sur un téléchargement classique, qui n'atterrit pas dans
      // sa pellicule. L'aperçu est déjà composé, on garde son fichier.
      carrouselApercusBlobs[i] = blob;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.className = 'car-slide-img';
      img.alt = 'Aperçu de la slide ' + (i + 1);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
      hote.innerHTML = '';
      hote.appendChild(img);
    } catch (e) { /* un aperçu raté ne doit jamais empêcher le reste */ }
  }
}

function carteScoreCarrouselHTML(s) {
  if (!s) return '';
  const barre = (typeof metricBar === 'function') ? metricBar : (l, v) => '<div>' + l + ' : ' + v + '</div>';
  const alerte = s.slidesTropLongues.length
    ? '<p class="ctx-note" style="margin-top:10px">Slides dont un élément déborde : ' + s.slidesTropLongues.join(', ') +
      '. Un titre au-delà de ' + CAR_MOTS_TITRE_MAX + ' mots ou un point au-delà de ' + CAR_MOTS_POINT_TEXTE_MAX + ' est survolé, pas lu.</p>'
    : '';
  // Structure IDENTIQUE à la carte du mode Script (voir js/generation.js) :
  // en-tête "◆ Scriptura Score" à gauche, note en gros à droite, puis les
  // barres. Le carrousel avait sa propre présentation, plus pauvre, et deux
  // cartes de score différentes dans la même app donnent l'impression que la
  // note ne veut pas dire la même chose d'un mode à l'autre. Elle veut dire
  // exactement la même chose : elle est calculée par le code, sur des
  // signaux mesurés, dans les deux cas.
  return `
    <div class="score-card sb-appear">
      <div class="score-header">
        <div class="score-title">◆ Scriptura Score</div>
        <div class="score-global">
          <span class="score-global-num">${s.global}</span>
          <span class="score-global-max">/ 100</span>
        </div>
      </div>
      <div class="score-metrics">
        ${barre('Puissance du hook', s.hook)}
        ${barre('Taux de swipe estimé', s.swipe)}
        ${barre('Lisibilité des slides', s.lisibilite)}
        ${barre('Force du CTA', s.cta)}
        ${barre('Densité maîtrisée', s.densite)}
      </div>
      ${alerte}
    </div>`;
}

// Raccourci vers la source unique d'icônes (ICO, js/ui.js). Repli sur une
// chaîne vide plutôt que sur un emoji : mieux vaut un bouton sans icône
// qu'un bouton dont l'icône change d'un téléphone à l'autre, ce qui est
// précisément le défaut qu'on corrige ici.
function ico(nom) {
  return (typeof ICO === 'function') ? ICO(nom) : '';
}

// Libellé d'un bouton "générer un fond", SOURCE UNIQUE pour le rendu complet
// et pour la mise à jour en place : deux formulations séparées finiraient par
// diverger, et le bouton afficherait un état faux à mi-parcours.
// Ce que le créateur lit sous chaque slide.
function noteVisuelSlide(s, i) {
  const img = carrouselImages[i];
  if (img && img.avecProduit) return 'décor généré, avec TON produit détouré posé dedans';
  return s.visuel || 'fond sobre, sans image';
}

function libelleBoutonFondCarrousel(i) {
  if (carrouselImageIndexEnCours === i) return '<span class="car-spinner"></span> Génération…';
  if (carrouselImages[i]) return ico('refresh') + ' Refaire le fond';
  return ico('sparkle') + ' Générer un fond';
}

function libelleBoutonFondsTousCarrousel() {
  return (carrouselImagesEnCours && carrouselImageIndexEnCours < 0)
    ? '<span class="car-spinner"></span> Génération…'
    : ico('sparkle') + ' Générer les fonds';
}

// Met à jour les boutons de génération de fond sans reconstruire la zone.
function majBoutonsImageCarrousel() {
  if (!carrouselResultat) return;
  const bloque = imagesRestantesCarrousel() === 0;
  carrouselResultat.slides.forEach((s, i) => {
    const btn = document.getElementById('carGenBtn' + i);
    if (!btn) return;
    btn.innerHTML = libelleBoutonFondCarrousel(i);
    btn.disabled = carrouselImagesEnCours || bloque;
  });
  const tous = document.getElementById('carGenTousBtn');
  if (tous) {
    tous.innerHTML = libelleBoutonFondsTousCarrousel();
    tous.disabled = carrouselImagesEnCours || bloque;
  }
}

function renderCarrousel() {
  const zone = document.getElementById('carrouselResults');
  const form = document.getElementById('carrouselForm');
  if (!zone || !carrouselResultat) return;
  if (form) form.style.display = 'none';
  zone.style.display = 'block';

  const r = carrouselResultat;
  const score = scoreCarrousel(r.slides);
  const restant = imagesRestantesCarrousel();
  const bloque = restant === 0;
  const fmt = CAR_FORMATS[carrouselFormat] || CAR_FORMATS[CAR_FORMAT_DEFAUT];

  const formatsHtml = Object.keys(CAR_FORMATS).map(k => `
    <button class="car-format-btn${k === carrouselFormat ? ' actif' : ''}" data-format="${k}" onclick="changerFormatDepuisResultat('${k}')">
      ${k} <span>${CAR_FORMATS[k].label}</span>
    </button>`).join('');

  const slidesHtml = r.slides.map((s, i) => {
    const mots = carrouselCompterMots(carrouselTexteSlide(s));
    return `
      <div class="car-slide">
        <div class="car-slide-visuel" id="carApercu${i}" style="aspect-ratio:${fmt.l} / ${fmt.h}">
          <div class="car-slide-vide">Composition…</div>
        </div>
        <div class="car-slide-corps">
          <p class="car-slide-role">${carrouselEchapper(s.badge || s.eyebrow || ('Slide ' + (i + 1)))}</p>
          <p class="car-slide-texte">${carrouselEchapper(s.titre)}</p>
          ${s.points && s.points.length ? `<ul class="car-slide-points">${s.points.map(p => `<li><strong>${carrouselEchapper(p.titre)}</strong>${p.texte ? ' ' + carrouselEchapper(p.texte) : ''}</li>`).join('')}</ul>` : ''}
          ${s.bandeau ? `<p class="car-slide-bandeau">${carrouselEchapper(s.bandeau)}</p>` : ''}
          <p class="car-slide-mots">${mots} mot${mots > 1 ? 's' : ''} au total</p>
          <p class="car-slide-visuel-note"><strong>Visuel :</strong> ${carrouselEchapper(noteVisuelSlide(s, i))}</p>
          <div class="car-slide-actions">
            <button class="btn-regenerate" id="carGenBtn${i}" onclick="genererImageCarrousel(${i})" ${carrouselImagesEnCours || bloque ? 'disabled' : ''}>${libelleBoutonFondCarrousel(i)}</button>
            <button class="btn-regenerate" onclick="telechargerSlideCarrousel(${i})">${ico('download')} Télécharger</button>
          </div>
        </div>
      </div>`;
  }).join('');

  zone.innerHTML = `
    <button class="btn-back" onclick="navBack()">← Retour</button>
    <div class="results-top">
      <div class="results-top-row">
        <div class="results-heading">Ton carrousel est prêt.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-regenerate" onclick="copierTexteCarrousel()">${ico('copy')} Copier les textes</button>
          <button class="btn-regenerate" id="carGenTousBtn" onclick="genererToutesImagesCarrousel()" ${carrouselImagesEnCours || bloque ? 'disabled' : ''}>${libelleBoutonFondsTousCarrousel()}</button>
        </div>
      </div>
      <div class="results-meta" id="carrouselQuotaImages">${carrouselEchapper(texteQuotaImagesCarrousel())}</div>
    </div>
    <div class="car-formats-barre">
      <span class="car-formats-label">Format</span>
      <div class="car-formats">${formatsHtml}</div>
    </div>
    ${carteScoreCarrouselHTML(score)}
    ${r.analyse ? `<p class="ctx-note" style="margin:14px 0">${carrouselEchapper(r.analyse)}</p>` : ''}
    <div class="car-slides">${slidesHtml}</div>
    <!-- Carte repliable, exactement comme les sections de résultat du mode
         Script (out-card / out-header / out-body, voir renderResults dans
         js/generation.js) : mêmes classes, donc mêmes tailles de police,
         mêmes hashtags en pastilles, et le même geste pour ouvrir et fermer.
         Deux présentations différentes pour la même chose, d'un mode à
         l'autre, obligent le créateur à réapprendre l'écran à chaque fois. -->
    <div class="out-card sb-appear" style="margin-top:18px">
      <div class="out-header" onclick="toggleCard(this.parentElement)">
        <div class="out-title">Légende &amp; Hashtags</div>
        <div class="out-toggle">+</div>
      </div>
      <div class="out-body">
        <div class="out-section">
          <div class="out-section-label">Légende</div>
          <div class="legende-block">${carrouselEchapper(r.legende || '')}</div>
          ${r.hashtags && r.hashtags.length ? `<div class="hashtags">${r.hashtags.map(h => `<span class="ht">${carrouselEchapper(h)}</span>`).join('')}</div>` : ''}
          <!-- Copier et partager la légende AVEC ses hashtags, en un geste :
               c'est le bloc qu'on colle tel quel dans TikTok au moment de
               publier, le couper en deux copies n'aurait aucun sens. Mêmes
               helpers que partout ailleurs dans l'app (copyText/shareText via
               storeCopyText, pour ne jamais injecter le texte dans l'attribut
               onclick, où une apostrophe casserait tout). -->
          <div class="sb-actions-fin">
            <button class="icon-btn" title="Copier la légende et les hashtags" onclick="copyText(this, '${storeCopyText(legendeCompleteCarrousel())}')">${typeof ICON_COPY !== 'undefined' ? ICON_COPY : '&#9109;'}</button>
            <button class="icon-btn" title="Partager la légende et les hashtags" onclick="shareText(this, '${storeCopyText(legendeCompleteCarrousel())}')">${typeof ICON_SHARE !== 'undefined' ? ICON_SHARE : '&#8599;'}</button>
          </div>
        </div>
        ${r.son_suggere ? `<div class="out-section">
          <div class="out-section-label">Son suggéré</div>
          <div class="legende-block">${carrouselEchapper(r.son_suggere)}</div>
        </div>` : ''}
      </div>
    </div>
    <button class="btn-restart" onclick="telechargerToutesSlidesCarrousel()">${ico('download')} Télécharger toutes les slides</button>`;

  requestAnimationFrame(() => {
    zone.querySelectorAll('.metric-fill[data-width]').forEach(el => {
      el.style.width = el.getAttribute('data-width') + '%';
    });
  });
  peindreApercusCarrousel();
}

// Changer de format depuis l'écran de résultat : les aperçus sont recomposés,
// donc ce que le créateur voit reste toujours ce qu'il téléchargera.
function changerFormatDepuisResultat(valeur) {
  if (!CAR_FORMATS[valeur]) return;
  carrouselFormat = valeur;
  // Les slides mémorisées sont à l'ANCIEN format : les garder ferait
  // télécharger des proportions que le créateur ne voit plus à l'écran.
  carrouselApercusBlobs = [];
  syncMenuFormatCarrousel();
  renderCarrousel();
}

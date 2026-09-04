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
let carrouselQuotaImages = null;   // { used, plafond, illimite } ou null
let carrouselContexte = null;
let carrouselObjectif = 'faire des vues';

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

function choisirFormatCarrousel(valeur, el) {
  if (!CAR_FORMATS[valeur]) return;
  carrouselFormat = valeur;
  document.querySelectorAll('#carrouselFormats .choice').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  // Un format changé après coup doit se voir tout de suite sur les aperçus
  // déjà affichés, sinon le créateur télécharge un format qu'il ne voit pas.
  if (carrouselResultat) renderCarrousel();
}

function lireFormatCarrousel() {
  const choisi = document.querySelector('#carrouselFormats .choice.selected');
  const valeur = choisi && choisi.getAttribute('data-format');
  if (valeur && CAR_FORMATS[valeur]) carrouselFormat = valeur;
  return carrouselFormat;
}

function resetCarrouselForm() {
  const curseur = document.getElementById('carrouselSlides');
  if (curseur) curseur.value = String(CARROUSEL_SLIDES_DEFAUT);
  majCurseurSlidesCarrousel();
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
function promptCarrousel(ctx) {
  const nb = ctx.nbSlides;
  const nbMilieu = Math.max(1, nb - 2);
  return `Tu es un stratège de contenu TikTok spécialisé dans les CARROUSELS (les publications à slides qu'on fait défiler du doigt), pas dans la vidéo.

CONTEXTE
- Niche : ${ctx.niche || 'non précisée'}
- Sujet : ${ctx.sujet}
- Objectif : ${ctx.objectif || 'faire des vues'}
- Audience : ${ctx.audience || 'tout public'}
- Ton : ${ctx.ton || 'naturel et direct'}
- Nombre de slides demandé : EXACTEMENT ${nb}

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
Chaque slide porte aussi un champ "visuel" : la consigne de l'image de fond, décrite pour un générateur d'images. Décris une scène, une ambiance, une lumière. JAMAIS de texte ni de lettres (le texte est posé par-dessus par le moteur de rendu). Garde une direction artistique COHÉRENTE d'une slide à l'autre.

RÉPONDS UNIQUEMENT EN JSON VALIDE, sans aucun texte avant ni après :
{"titre":"titre court du carrousel, pour l'historique","analyse":"en 2 phrases, pourquoi cet angle peut fonctionner","direction_visuelle":"la direction artistique commune, en une phrase","slides":[{"numero":1,"gabarit":"couverture","eyebrow":"...","badge":"","emoji":"","titre":"...","titre_accent":"...","definition":"","points":[{"emoji":"🎯","titre":"...","texte":"..."}],"bandeau":"...","visuel":"..."}],"legende":"la légende de la publication, prête à copier, SANS hashtag dedans","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"son_suggere":"le type de son ou de musique, en une phrase (un carrousel sans audio perd une grande partie de sa portée)"}

Le tableau "slides" contient EXACTEMENT ${nb} éléments, numérotés de 1 à ${nb}. La slide 1 est en gabarit "couverture", la slide ${nb} en gabarit "recap", toutes les autres en "contenu". Laisse vides ("" ou []) les champs qui ne servent pas au gabarit choisi.`;
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
    format: lireFormatCarrousel()
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
      3, false, 0, 'creation', null, null, 'carrousel'
    );
    const parsed = parserCarrousel(texte);
    if (!parsed) throw new Error('Réponse illisible, réessaie.');

    carrouselResultat = parsed;
    carrouselContexte = ctx;
    carrouselImages = new Array(parsed.slides.length).fill(null);
    renderCarrousel();

    // L'enregistrement et la lecture du quota ne doivent JAMAIS retarder
    // l'affichage : le créateur voit son carrousel tout de suite.
    if (typeof saveGeneration === 'function') {
      saveGeneration('carrousel', parsed.titre || ctx.sujet.slice(0, 60), {
        resultat: parsed,
        context: { niche: ctx.niche, sujet: ctx.sujet, objectif: ctx.objectif, nbSlides: ctx.nbSlides, ton: ctx.ton, audience: ctx.audience, format: ctx.format },
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
  return String(visuel || '') + direction +
    '. Aucune lettre, aucun mot, aucun texte, aucun chiffre visible dans l\'image. Image d\'ambiance sombre et sobre, qui laisse toute la place à un texte ajouté par-dessus. ' + carrouselFormat;
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
  renderCarrousel();
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
    carrouselImages[i] = {
      apercu: 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.base64,
      blob: (typeof base64VersBlob === 'function') ? base64VersBlob(img.base64, img.mimeType || 'image/png') : null
    };
    if (carrouselQuotaImages && !carrouselQuotaImages.illimite) {
      carrouselQuotaImages.used = (carrouselQuotaImages.used || 0) + 1;
    }
  } catch (e) {
    carrouselAfficherErreur('Slide ' + (i + 1) + ' : ' + ((e && e.message) || 'échec de génération.'));
  } finally {
    carrouselImagesEnCours = false;
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
function carrouselDisposer(c, blocs, zone, e, accent, dessiner, yDepart) {
  const L = zone.l;
  let y = yDepart;
  const espace = 22 * e;

  const police = (poids, taille, famille) => { c.font = poids + ' ' + Math.round(taille * e) + 'px ' + famille; };

  blocs.forEach((bloc, idx) => {
    if (idx) y += espace;

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
    if (carrouselDisposer(c, blocs, zone, e, accent, false, 0) <= hauteurDispo) return e;
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
      const hauteur = carrouselDisposer(c, blocs, zone, e, accent, false, 0);
      // Centrage vertical, mais jamais au-dessus du haut de la zone : une
      // slide dense reste calée sous la barre de progression.
      const y = Math.max(hautContenu, hautContenu + (dispo - hauteur) / 2);
      carrouselDisposer(c, blocs, zone, e, accent, true, y);

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
          // soit l'image, sans effacer complètement la photo.
          const voile = c.createLinearGradient(0, 0, 0, H);
          voile.addColorStop(0, 'rgba(10,10,12,0.72)');
          voile.addColorStop(1, 'rgba(10,10,12,0.88)');
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

async function telechargerSlideCarrousel(i) {
  try {
    const blob = await composerSlideCarrousel(i);
    const nom = 'carrousel-' + carrouselFormat.replace(':', 'x') + '-slide-' + String(i + 1).padStart(2, '0') + '.png';
    if (typeof telechargerBlob === 'function') telechargerBlob(blob, nom);
  } catch (e) {
    carrouselAfficherErreur('Téléchargement impossible : ' + ((e && e.message) || 'erreur inconnue'));
  }
}

async function telechargerToutesSlidesCarrousel() {
  if (!carrouselResultat) return;
  for (let i = 0; i < carrouselResultat.slides.length; i++) {
    await telechargerSlideCarrousel(i);
  }
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
  return `
    <div class="score-card">
      <div class="score-global"><span class="score-num">${s.global}</span><span class="score-den">/100</span></div>
      ${barre('Puissance du hook', s.hook)}
      ${barre('Taux de swipe estimé', s.swipe)}
      ${barre('Lisibilité des slides', s.lisibilite)}
      ${barre('Force du CTA', s.cta)}
      ${barre('Densité maîtrisée', s.densite)}
      ${alerte}
    </div>`;
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
    const img = carrouselImages[i];
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
          <p class="car-slide-visuel-note"><strong>Visuel :</strong> ${carrouselEchapper(s.visuel || 'fond sobre, sans image')}</p>
          <div class="car-slide-actions">
            <button class="btn-regenerate" onclick="genererImageCarrousel(${i})" ${carrouselImagesEnCours || bloque ? 'disabled' : ''}>${img ? '↻ Refaire le fond' : '✦ Générer un fond'}</button>
            <button class="btn-regenerate" onclick="telechargerSlideCarrousel(${i})">⬇ Télécharger</button>
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
          <button class="btn-regenerate" onclick="copierTexteCarrousel()">⧉ Copier les textes</button>
          <button class="btn-regenerate" onclick="genererToutesImagesCarrousel()" ${carrouselImagesEnCours || bloque ? 'disabled' : ''}>✦ Générer les fonds</button>
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
    <div class="context-card" style="margin-top:18px">
      <div class="ctx-field">
        <label class="ctx-label">Légende</label>
        <p class="car-bloc-texte">${carrouselEchapper(r.legende || '')}</p>
      </div>
      ${r.hashtags && r.hashtags.length ? `<div class="ctx-field"><label class="ctx-label">Hashtags</label><p class="car-bloc-texte">${carrouselEchapper(r.hashtags.join(' '))}</p></div>` : ''}
      <!-- Copier et partager la légende AVEC ses hashtags, en un geste : c'est
           le bloc qu'on colle tel quel dans TikTok au moment de publier, le
           couper en deux copies n'aurait aucun sens. Mêmes helpers que partout
           ailleurs dans l'app (copyText/shareText via storeCopyText, pour ne
           jamais injecter le texte dans l'attribut onclick, où une apostrophe
           casserait tout). -->
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier la légende et les hashtags" onclick="copyText(this, '${storeCopyText(legendeCompleteCarrousel())}')">${typeof ICON_COPY !== 'undefined' ? ICON_COPY : '&#9109;'}</button>
        <button class="icon-btn" title="Partager la légende et les hashtags" onclick="shareText(this, '${storeCopyText(legendeCompleteCarrousel())}')">${typeof ICON_SHARE !== 'undefined' ? ICON_SHARE : '&#8599;'}</button>
      </div>
      ${r.son_suggere ? `<div class="ctx-field" style="margin-top:14px"><label class="ctx-label">Son suggéré</label><p class="car-bloc-texte">${carrouselEchapper(r.son_suggere)}</p></div>` : ''}
    </div>
    <button class="btn-restart" onclick="telechargerToutesSlidesCarrousel()">⬇ Télécharger toutes les slides</button>`;

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
  renderCarrousel();
}

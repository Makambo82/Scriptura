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
//  SLIDES.
//
//  LE SCORE NE COÛTE RIEN ET RESTE 100% DÉTERMINISTE. Contrairement au
//  Script et au Récit, aucun juge IA n'est appelé : tout ce qui fait la
//  performance d'un carrousel est COMPTABLE (mots de la slide 1, mots par
//  slide, présence d'une relance, présence d'un CTA final, nombre de
//  hashtags). Le code mesure, l'IA ne note jamais. Mêmes slides, même
//  score, et zéro token dépensé pour l'évaluation.
//
//  LES IMAGES SONT GÉNÉRÉES SLIDE PAR SLIDE, jamais toutes d'un coup par
//  défaut, pour deux raisons. La première est le budget : un carrousel de
//  15 slides consommerait l'essentiel du quota mensuel d'un Creator (voir
//  carrouselImages dans api/_lib/acces.js). La seconde est esthétique et
//  compte davantage : un carrousel qui performe est presque toujours du
//  TEXTE SUR FOND SOBRE, avec une ou deux images fortes. Quinze
//  illustrations générées séparément n'auraient aucune cohérence de style,
//  ce qui est exactement l'inverse de l'effet recherché.
//
//  ET LE TEXTE N'EST JAMAIS DEMANDÉ AU GÉNÉRATEUR D'IMAGES : les modèles
//  d'images écrivent des lettres tordues et des fautes dès qu'on leur
//  demande d'incruster une phrase. On génère donc l'image SANS AUCUN TEXTE,
//  et on pose le texte par-dessus nous-mêmes (voir composerSlideCarrousel),
//  dans la palette Scriptura. Le créateur télécharge une slide finie.
// ═══════════════════════════════════════════════════════════

const CARROUSEL_SLIDES_MIN = 6;
const CARROUSEL_SLIDES_MAX = 15;
const CARROUSEL_SLIDES_DEFAUT = 8;

// Seuils de LISIBILITÉ, en mots, et c'est le nerf du format. Une slide se
// lit en une seconde et demie avant que le pouce reparte : au-delà d'une
// vingtaine de mots, elle n'est plus lue, elle est survolée. La slide 1 est
// encore plus contrainte, elle doit être lisible sur une vignette.
const CAR_MOTS_HOOK_IDEAL = 8;
const CAR_MOTS_HOOK_MAX = 12;
const CAR_MOTS_SLIDE_IDEAL = 18;
const CAR_MOTS_SLIDE_MAX = 25;

// Une slide "appelle le swipe" quand elle laisse quelque chose ouvert :
// suspension, deux-points, question, ou numérotation (une liste numérotée
// crée à elle seule un besoin d'aller au bout). Mesuré sur le TEXTE RÉEL,
// jamais sur une auto-déclaration du modèle.
const CAR_RELANCE_FIN = /(…|\.\.\.|:|\?)\s*$/;
const CAR_RELANCE_NUMERO = /^\s*(\d{1,2}|[IVX]{1,4})\s*[.)°/–-]/i;
const CAR_MOTS_CTA = /\b(abonne|suis-moi|suis moi|commente|partage|enregistre|sauvegarde|clique|lien|bio|dis-moi|dis moi|essaie|teste|télécharge|inscris)/i;

let carrouselNbSlides = CARROUSEL_SLIDES_DEFAUT;
let carrouselResultat = null;      // { slides:[], legende, hashtags[], son_suggere, titre, analyse }
let carrouselImages = [];          // [{ apercu, blob } | null], même longueur que les slides
let carrouselImagesEnCours = false;
let carrouselQuotaImages = null;   // { used, plafond, illimite } ou null
let carrouselContexte = null;      // pour la régénération
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
  // Remplissage coloré à gauche du curseur : un simple dégradé recalculé,
  // parce qu'aucun navigateur ne sait styler la partie "déjà parcourue"
  // d'un input range de façon portable.
  const part = (n - CARROUSEL_SLIDES_MIN) / (CARROUSEL_SLIDES_MAX - CARROUSEL_SLIDES_MIN);
  curseur.style.setProperty('--car-part', Math.round(part * 100) + '%');
  return n;
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
// Écrit POUR le carrousel, jamais recyclé du script vidéo. Les contraintes
// chiffrées reprennent exactement les seuils que le code mesurera ensuite
// (voir scoreCarrousel) : le modèle connaît la règle sur laquelle il sera
// évalué, ce qui évite de le noter sur un critère qu'on ne lui a jamais
// donné.
function promptCarrousel(ctx) {
  const nb = ctx.nbSlides;
  const nbMilieu = Math.max(1, nb - 2);
  return `Tu es un stratège de contenu TikTok spécialisé dans les CARROUSELS PHOTO (les publications à slides qu'on fait défiler du doigt), pas dans la vidéo.

CONTEXTE
- Niche : ${ctx.niche || 'non précisée'}
- Sujet : ${ctx.sujet}
- Objectif : ${ctx.objectif || 'faire des vues'}
- Audience : ${ctx.audience || 'tout public'}
- Ton : ${ctx.ton || 'naturel et direct'}
- Nombre de slides demandé : EXACTEMENT ${nb}

CE QUI FAIT UN CARROUSEL QUI PERFORME, ET QUI DIFFÈRE TOTALEMENT D'UNE VIDÉO
1. La SLIDE 1 fait tout le travail. Elle est lue sur une vignette, en une demi-seconde, souvent sans le son. Maximum ${CAR_MOTS_HOOK_MAX} mots, idéalement ${CAR_MOTS_HOOK_IDEAL}. Une promesse, une tension ou un chiffre, jamais une introduction.
2. UNE SEULE IDÉE PAR SLIDE. Deux idées sur une slide, et les deux sont perdues.
3. Chaque slide du milieu (il y en a ${nbMilieu}) doit DONNER UNE RAISON DE GLISSER vers la suivante : termine-la par une suspension, un deux-points, une question, ou numérote-la (1., 2., 3.) pour créer le besoin d'aller au bout. Une slide qui se referme sur elle-même arrête la lecture.
4. Maximum ${CAR_MOTS_SLIDE_MAX} mots par slide, idéalement ${CAR_MOTS_SLIDE_IDEAL}. Au-delà, personne ne lit, tout le monde survole.
5. La DERNIÈRE slide porte l'appel à l'action, explicite et en toutes lettres (commenter, enregistrer, s'abonner, aller en bio). Le lecteur est arrivé au bout, il est prêt à agir : ne gâche pas ça avec une conclusion vague.

POUR CHAQUE SLIDE, DEUX CHOSES DIFFÉRENTES
- "texte" : le texte EXACT qui sera affiché sur l'image, tel quel, prêt à copier. Pas de description, pas de guillemets décoratifs.
- "visuel" : la consigne de ce qu'il faut mettre DERRIÈRE ce texte, décrite pour un générateur d'images. Décris une scène, une ambiance, une lumière, jamais du texte ni des lettres (le texte est posé par-dessus séparément). Reste dans une direction artistique COHÉRENTE d'une slide à l'autre : même style, même palette, même traitement, pour que le carrousel se tienne.

RÉPONDS UNIQUEMENT EN JSON VALIDE, sans aucun texte avant ni après :
{"titre":"titre court du carrousel, pour le retrouver dans l'historique","analyse":"en 2 phrases, pourquoi cet angle peut fonctionner sur ce sujet","direction_visuelle":"la direction artistique commune à toutes les slides, en une phrase","slides":[{"numero":1,"role":"hook","texte":"...","visuel":"..."}],"legende":"la légende de la publication, prête à copier, SANS hashtag dedans","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"son_suggere":"le type de son ou de musique à mettre, décrit en une phrase (un carrousel sans audio perd une grande partie de sa portée)"}

Le tableau "slides" contient EXACTEMENT ${nb} éléments, numérotés de 1 à ${nb}. Le "role" vaut "hook" pour la première, "cta" pour la dernière, "corps" pour toutes les autres.`;
}

// ═══ SCORE DÉTERMINISTE ═══
// Aucun appel IA. Chaque note sort d'un COMPTAGE sur le carrousel réellement
// produit. Deux fois les mêmes slides donnent deux fois le même score, ce
// qui est la condition pour qu'un créateur puisse faire confiance au chiffre.
function carrouselNoteHook(motsHook, texteHook) {
  if (!motsHook) return 0;
  let note;
  if (motsHook <= CAR_MOTS_HOOK_IDEAL) note = 92;
  else if (motsHook <= CAR_MOTS_HOOK_MAX) note = 78;
  else if (motsHook <= CAR_MOTS_HOOK_MAX + 6) note = 55;
  else note = 32;
  // Bonus mesurable : un chiffre ou une question dans le hook sont les deux
  // déclencheurs de curiosité les plus fiables du format.
  if (/\d/.test(texteHook)) note += 4;
  if (/\?/.test(texteHook)) note += 4;
  return Math.max(0, Math.min(100, note));
}

function carrouselNotePart(part) {
  return Math.round(Math.max(0, Math.min(1, part)) * 100);
}

function scoreCarrousel(slides, legende, hashtags) {
  const n = Array.isArray(slides) ? slides.length : 0;
  if (!n) return null;
  const textes = slides.map(s => String((s && s.texte) || ''));
  const mots = textes.map(carrouselCompterMots);

  // 1. Puissance du hook : la slide 1, mesurée seule.
  const hook = carrouselNoteHook(mots[0], textes[0]);

  // 2. Taux de swipe estimé : part des slides du milieu qui laissent
  //    vraiment quelque chose d'ouvert. C'est le seul signal qui prédit
  //    qu'on arrive au bout du carrousel.
  const milieu = textes.slice(1, Math.max(1, n - 1));
  const avecRelance = milieu.filter(t => CAR_RELANCE_FIN.test(t) || CAR_RELANCE_NUMERO.test(t)).length;
  const swipe = milieu.length ? carrouselNotePart(avecRelance / milieu.length) : 0;

  // 3. Lisibilité : part des slides sous le plafond de mots, avec un demi
  //    crédit pour celles qui dépassent l'idéal sans dépasser le plafond.
  const points = mots.reduce((acc, m) => {
    if (!m) return acc;
    if (m <= CAR_MOTS_SLIDE_IDEAL) return acc + 1;
    if (m <= CAR_MOTS_SLIDE_MAX) return acc + 0.6;
    return acc;
  }, 0);
  const lisibilite = carrouselNotePart(points / n);

  // 4. Force du CTA : la dernière slide demande-t-elle vraiment une action ?
  const dernier = textes[n - 1] || '';
  let cta = CAR_MOTS_CTA.test(dernier) ? 88 : 30;
  if (CAR_MOTS_CTA.test(String(legende || ''))) cta += 8;
  if (Array.isArray(hashtags) && hashtags.length >= 3) cta += 4;
  cta = Math.min(100, cta);

  // 5. Densité : une seule idée par slide. Mesurée par le nombre de phrases,
  //    deux phrases pleines sur une slide étant le symptôme le plus courant
  //    de deux idées empilées.
  const monoIdee = textes.filter(t => {
    const phrases = t.split(/[.!?…]+/).map(p => p.trim()).filter(p => carrouselCompterMots(p) >= 3);
    return phrases.length <= 1;
  }).length;
  const densite = carrouselNotePart(monoIdee / n);

  // Pondération : le hook et le swipe décident de la portée, les trois
  // autres décident de ce qu'il en reste.
  const global = Math.round(hook * 0.3 + swipe * 0.25 + lisibilite * 0.2 + cta * 0.15 + densite * 0.1);
  return {
    hook, swipe, lisibilite, cta, densite,
    global: Math.max(0, Math.min(100, global)),
    motsParSlide: mots,
    slidesTropLongues: mots.reduce((acc, m, i) => (m > CAR_MOTS_SLIDE_MAX ? acc.concat(i + 1) : acc), [])
  };
}

// ═══ GÉNÉRATION ═══
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
    nbSlides: majCurseurSlidesCarrousel()
  };
}

function choisirObjectifCarrousel(valeur, el) {
  carrouselObjectif = valeur;
  const cartes = document.querySelectorAll('#carrouselObjectifs .choice');
  cartes.forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
}

function carrouselAfficherErreur(message) {
  const err = document.getElementById('carrouselErrorBox');
  if (!err) return;
  err.textContent = message;
  err.style.display = 'block';
}

function parserCarrousel(texte) {
  const brut = String(texte || '');
  const debut = brut.indexOf('{');
  const fin = brut.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  let parsed;
  try { parsed = JSON.parse(brut.slice(debut, fin + 1)); }
  catch (e) { return null; }
  if (!parsed || !Array.isArray(parsed.slides) || !parsed.slides.length) return null;
  // Normalisation : on ne fait jamais confiance à la numérotation renvoyée,
  // on la repose depuis l'ordre réel du tableau. Un "numero" en double
  // casserait l'association slide/image.
  parsed.slides = parsed.slides
    .filter(s => s && String(s.texte || '').trim())
    .map((s, i) => ({
      numero: i + 1,
      role: String(s.role || (i === 0 ? 'hook' : 'corps')),
      texte: String(s.texte || '').trim(),
      visuel: String(s.visuel || '').trim()
    }));
  if (!parsed.slides.length) return null;
  parsed.hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.map(h => String(h || '').trim()).filter(Boolean) : [];
  return parsed;
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
      4000,
      promptCarrousel(ctx),
      3, false, 0, 'creation', null, null, 'carrousel'
    );
    const parsed = parserCarrousel(texte);
    if (!parsed) throw new Error('Réponse illisible, réessaie.');

    carrouselResultat = parsed;
    carrouselContexte = ctx;
    carrouselImages = new Array(parsed.slides.length).fill(null);
    renderCarrousel();

    // L'enregistrement et la lecture du quota d'images ne doivent JAMAIS
    // retarder l'affichage : le créateur voit son carrousel tout de suite.
    if (typeof saveGeneration === 'function') {
      saveGeneration('carrousel', parsed.titre || ctx.sujet.slice(0, 60), {
        resultat: parsed,
        context: { niche: ctx.niche, sujet: ctx.sujet, objectif: ctx.objectif, nbSlides: ctx.nbSlides, ton: ctx.ton, audience: ctx.audience },
        score: scoreCarrousel(parsed.slides, parsed.legende, parsed.hashtags)
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
// localement : un rechargement de page remettrait un compteur local à zéro
// et promettrait des images que le serveur refuserait ensuite.
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
  if (!carrouselQuotaImages) return null;              // inconnu : on laisse le serveur trancher
  if (carrouselQuotaImages.illimite) return Infinity;
  return Math.max(0, (carrouselQuotaImages.plafond || 0) - (carrouselQuotaImages.used || 0));
}

// ═══ IMAGES ═══
// "sans aucun texte" n'est pas une précaution de style, c'est la condition
// pour que la slide soit utilisable : le texte est posé par-dessus ensuite,
// proprement (voir composerSlideCarrousel).
function construirePromptImageCarrousel(visuel) {
  const direction = (carrouselResultat && carrouselResultat.direction_visuelle) ? ', ' + carrouselResultat.direction_visuelle : '';
  return String(visuel || '') + direction +
    '. Aucune lettre, aucun mot, aucun texte, aucun chiffre visible dans l\'image. Composition verticale qui laisse de la place au centre pour un texte ajouté ensuite. 9:16';
}

async function genererImageCarrousel(i) {
  if (carrouselImagesEnCours || !carrouselResultat) return;
  const slide = carrouselResultat.slides[i];
  if (!slide) return;

  const restant = imagesRestantesCarrousel();
  if (restant === 0) {
    carrouselAfficherErreur('Tu as utilisé toutes tes images de carrousel du mois. Le texte de tes slides reste disponible et se copie normalement.');
    return;
  }

  carrouselImagesEnCours = true;
  renderCarrousel();
  try {
    const rep = await fetch('/api/montage-media?action=images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts: [construirePromptImageCarrousel(slide.visuel || slide.texte)],
        format: '9:16',
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
// coup qu'on vient de vider son quota du mois est exactement le genre de
// surprise qui fait résilier.
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
      message += '\nIl t\'en manque ' + (manquantes.length - restant) + ', les dernières slides resteront sans image.';
    }
  }
  if (!window.confirm(message)) return;

  for (const i of manquantes) {
    if (imagesRestantesCarrousel() === 0) break;
    await genererImageCarrousel(i);
  }
}

// ═══ COMPOSITION DE LA SLIDE FINIE ═══
// Le texte est posé PAR NOUS sur l'image, dans la palette Scriptura, parce
// qu'un générateur d'images écrit mal. Sans fond généré, on retombe sur un
// dégradé sombre : une slide texte sur fond sobre est de toute façon ce qui
// performe le mieux, elle doit donc être téléchargeable sans dépenser une
// seule image.
const CAR_LARGEUR = 1080;
const CAR_HAUTEUR = 1920;

function carrouselDecouperLignes(ctx2d, texte, largeurMax) {
  const mots = String(texte || '').split(/\s+/).filter(Boolean);
  const lignes = [];
  let ligne = '';
  for (const mot of mots) {
    const essai = ligne ? ligne + ' ' + mot : mot;
    if (ctx2d.measureText(essai).width > largeurMax && ligne) {
      lignes.push(ligne);
      ligne = mot;
    } else {
      ligne = essai;
    }
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

function composerSlideCarrousel(i) {
  return new Promise((resolve, reject) => {
    if (!carrouselResultat || !carrouselResultat.slides[i]) return reject(new Error('Slide introuvable'));
    const slide = carrouselResultat.slides[i];
    const canvas = document.createElement('canvas');
    canvas.width = CAR_LARGEUR;
    canvas.height = CAR_HAUTEUR;
    const c = canvas.getContext('2d');

    const dessinerTexte = () => {
      // Voile sombre : garantit la lisibilité du texte quelle que soit
      // l'image derrière, sans masquer complètement la photo.
      const voile = c.createLinearGradient(0, 0, 0, CAR_HAUTEUR);
      voile.addColorStop(0, 'rgba(10,10,12,0.55)');
      voile.addColorStop(0.5, 'rgba(10,10,12,0.72)');
      voile.addColorStop(1, 'rgba(10,10,12,0.85)');
      c.fillStyle = voile;
      c.fillRect(0, 0, CAR_LARGEUR, CAR_HAUTEUR);

      const estHook = i === 0;
      const taille = estHook ? 104 : 76;
      c.font = '700 ' + taille + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#F5F1E6';
      const marge = 110;
      const lignes = carrouselDecouperLignes(c, slide.texte, CAR_LARGEUR - marge * 2);
      const interligne = taille * 1.28;
      let y = CAR_HAUTEUR / 2 - ((lignes.length - 1) * interligne) / 2;
      for (const ligne of lignes) {
        c.fillText(ligne, CAR_LARGEUR / 2, y);
        y += interligne;
      }

      // Repère de progression, en doré Scriptura : le lecteur sait toujours
      // où il en est, ce qui est un des leviers de swipe les plus simples.
      const total = carrouselResultat.slides.length;
      c.font = '600 40px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      c.fillStyle = '#C9A84C';
      c.fillText((i + 1) + ' / ' + total, CAR_LARGEUR / 2, CAR_HAUTEUR - 130);

      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Composition impossible')), 'image/png');
    };

    const image = carrouselImages[i];
    if (image && image.apercu) {
      const img = new Image();
      img.onload = () => {
        // Recadrage "couvrir" : on remplit tout le cadre sans déformer.
        const ratio = Math.max(CAR_LARGEUR / img.width, CAR_HAUTEUR / img.height);
        const l = img.width * ratio;
        const h = img.height * ratio;
        c.drawImage(img, (CAR_LARGEUR - l) / 2, (CAR_HAUTEUR - h) / 2, l, h);
        dessinerTexte();
      };
      img.onerror = () => { carrouselFondUni(c); dessinerTexte(); };
      img.src = image.apercu;
    } else {
      carrouselFondUni(c);
      dessinerTexte();
    }
  });
}

function carrouselFondUni(c) {
  const fond = c.createLinearGradient(0, 0, CAR_LARGEUR, CAR_HAUTEUR);
  fond.addColorStop(0, '#101014');
  fond.addColorStop(0.55, '#16211D');
  fond.addColorStop(1, '#0C0C0F');
  c.fillStyle = fond;
  c.fillRect(0, 0, CAR_LARGEUR, CAR_HAUTEUR);
}

async function telechargerSlideCarrousel(i) {
  try {
    const blob = await composerSlideCarrousel(i);
    const nom = 'carrousel-slide-' + String(i + 1).padStart(2, '0') + '.png';
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

function copierTexteCarrousel() {
  if (!carrouselResultat) return;
  const lignes = carrouselResultat.slides.map(s => 'Slide ' + s.numero + ' : ' + s.texte);
  if (carrouselResultat.legende) lignes.push('', 'Légende : ' + carrouselResultat.legende);
  if (carrouselResultat.hashtags && carrouselResultat.hashtags.length) lignes.push(carrouselResultat.hashtags.join(' '));
  const texte = lignes.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texte);
}

// ═══ RENDU ═══
function carteScoreCarrouselHTML(s) {
  if (!s) return '';
  const barre = (typeof metricBar === 'function') ? metricBar : (l, v) => '<div>' + l + ' : ' + v + '</div>';
  const alerte = s.slidesTropLongues.length
    ? '<p class="ctx-note" style="margin-top:10px">Slides trop chargées pour être lues d\'un coup d\'oeil : ' +
      s.slidesTropLongues.join(', ') + '. Au-delà de ' + CAR_MOTS_SLIDE_MAX + ' mots, la slide est survolée, pas lue.</p>'
    : '';
  return `
    <div class="score-card">
      <div class="score-global"><span class="score-num">${s.global}</span><span class="score-den">/100</span></div>
      ${barre('Puissance du hook', s.hook)}
      ${barre('Taux de swipe estimé', s.swipe)}
      ${barre('Lisibilité des slides', s.lisibilite)}
      ${barre('Force du CTA', s.cta)}
      ${barre('Une idée par slide', s.densite)}
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
  const score = scoreCarrousel(r.slides, r.legende, r.hashtags);
  const restant = imagesRestantesCarrousel();
  const bloque = restant === 0;

  const slidesHtml = r.slides.map((s, i) => {
    const img = carrouselImages[i];
    const mots = carrouselCompterMots(s.texte);
    const trop = mots > CAR_MOTS_SLIDE_MAX;
    const visuel = img
      ? `<img class="car-slide-img" src="${carrouselEchapper(img.apercu)}" alt="Visuel de la slide ${i + 1}"/>`
      : `<div class="car-slide-vide">Fond sobre<br/><span>aucune image générée</span></div>`;
    return `
      <div class="car-slide">
        <div class="car-slide-visuel">${visuel}<span class="car-slide-num">${i + 1}/${r.slides.length}</span></div>
        <div class="car-slide-corps">
          <p class="car-slide-texte">${carrouselEchapper(s.texte)}</p>
          <p class="car-slide-mots${trop ? ' car-trop' : ''}">${mots} mot${mots > 1 ? 's' : ''}${trop ? ', trop long pour être lu d\'un coup d\'oeil' : ''}</p>
          <p class="car-slide-visuel-note"><strong>Visuel :</strong> ${carrouselEchapper(s.visuel || 'fond sobre, texte seul')}</p>
          <div class="car-slide-actions">
            <button class="btn-regenerate" onclick="genererImageCarrousel(${i})" ${carrouselImagesEnCours || bloque ? 'disabled' : ''}>${img ? '↻ Refaire l\'image' : '✦ Générer l\'image'}</button>
            <button class="btn-regenerate" onclick="telechargerSlideCarrousel(${i})">⬇ Télécharger la slide</button>
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
          <button class="btn-regenerate" onclick="genererToutesImagesCarrousel()" ${carrouselImagesEnCours || bloque ? 'disabled' : ''}>✦ Générer les images</button>
        </div>
      </div>
      <div class="results-meta" id="carrouselQuotaImages">${carrouselEchapper(texteQuotaImagesCarrousel())}</div>
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
      ${r.son_suggere ? `<div class="ctx-field"><label class="ctx-label">Son suggéré</label><p class="car-bloc-texte">${carrouselEchapper(r.son_suggere)}</p></div>` : ''}
    </div>
    <button class="btn-restart" onclick="telechargerToutesSlidesCarrousel()">⬇ Télécharger toutes les slides</button>`;

  // Les barres de score s'animent comme partout ailleurs dans l'app.
  requestAnimationFrame(() => {
    zone.querySelectorAll('.metric-fill[data-width]').forEach(el => {
      el.style.width = el.getAttribute('data-width') + '%';
    });
  });
}

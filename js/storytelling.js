// ══════════════════════════════════════
//  GÉNÉRATEUR D'IDÉES
// ══════════════════════════════════════
// ══════════════════════════════════════
//  MODE STORYTELLING (STYLE MAKAMBO)
// ══════════════════════════════════════
let storyFormat = '';
let storyDuree = '';
// TikTok, toujours (voir PLATEFORME_SCRIPTURA, js/generation.js).
let storyPlatform = 'TikTok';
let storyTon = '';
let currentStory = null;
let currentStoryText = '';
// Éditeur IA par passage (Reformuler/Raccourcir/Allonger/Simplifier), même
// fonctionnalité que le mode Script (MICRO_EDIT_CONSIGNES/
// MICRO_EDIT_MAX_PAR_SCRIPT, js/generation.js, réutilisés tels quels ici :
// même consignes, même plafond, pas de raison de les dupliquer). Compteur
// séparé de celui du Script : chacun plafonne SON propre résultat affiché.
let _microEditsUtiliseesRecit = 0;

function setupStoryButtons() {
  // Format
  const fmtContainer = document.getElementById('storyFormatGrid');
  if (fmtContainer) {
    const fmtBtns = fmtContainer.querySelectorAll('.grid-btn');
    fmtBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        fmtBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storyFormat = btn.dataset.val;
        // Afficher le champ durée seulement si format court
        document.getElementById('storyDureeField').style.display = (storyFormat === 'court') ? 'block' : 'none';
      });
    });
  }
  // Durée (menu déroulant, 5 choix)
  const durSelectEl = document.getElementById('storyDureeGrid');
  if (durSelectEl) {
    durSelectEl.addEventListener('change', function() { storyDuree = this.value; });
  }
  // Ton, optionnel : menu déroulant (8 choix), l'option vide ("Aucun ton
  // particulier…") tient lieu de désélection, voir storyPrompt pour le
  // comportement quand aucun ton n'est choisi.
  const tonSelectEl = document.getElementById('storyTonGrid');
  if (tonSelectEl) {
    tonSelectEl.addEventListener('change', function() { storyTon = this.value; });
  }
}

// Repart d'un formulaire vide pour un nouveau récit, appelée à chaque entrée
// fraîche dans ce mode (voir chooseMode, js/serie.js) : sans ça, le format/la
// durée/la plateforme/le ton d'un récit précédent restaient silencieusement
// actifs (champs ET variables storyFormat/storyDuree/storyPlatform/storyTon)
// pour le suivant, même sans aucun rapport avec lui.
function restartStory() {
  document.getElementById('storyInput').value = '';
  storyFormat = '';
  storyDuree = '';
  storyTon = '';
  document.querySelectorAll('#storyFormatGrid .grid-btn, #storyPlatformGrid .grid-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('storyDureeGrid').value = '';
  document.getElementById('storyTonGrid').value = '';
  document.getElementById('storyDureeField').style.display = 'none';
  const errorBox = document.getElementById('storyErrorBox');
  if (errorBox) errorBox.style.display = 'none';
  const formCard = document.getElementById('storyFormCard');
  if (formCard) formCard.style.display = '';
  document.getElementById('storyResults').style.display = 'none';
}

function setStoryLoading(on) {
  const btn = document.getElementById('storyGenerateBtn');
  btn.disabled = on;
  document.getElementById('storySpinner').style.display = on ? 'block' : 'none';
  document.getElementById('storyBtnText').textContent = on ? 'Scriptura écrit ton récit…' : 'Créer mon récit';
  if (on) startGenAnimation('story');
  else stopGenAnimation();
}

// ── SCORE DÉTERMINISTE DU RÉCIT (retour terrain, audit du 2 septembre 2026) ──
// Même correctif et même principe que scorerScriptGenere (js/generation.js) :
// l'IA ne note plus rien elle-même, le CODE calcule chaque dimension à
// partir de cases cochées. Signaux adaptés au récit (accroche narrative/
// clôture/cohérence factuelle) plutôt qu'au vocabulaire hook TikTok du mode
// Script, d'où un jeu de signaux et un mapping distincts.
//
// Renforcé une 2e fois (retour terrain, un score à 100% questionné à raison,
// même correctif que le mode Script) : rythme_soutenu est détecté
// directement en CODE (statistique de longueur de phrase), plus aucune IA.
// Les 9 signaux restants viennent d'un 2e appel IA INDÉPENDANT (voir
// evaluerRecitGenere), qui ne voit QUE le texte fini, jamais le contexte de
// rédaction, et doit CITER le passage exact qui justifie chaque case
// cochée (citation introuvable mot pour mot = signal invalidé).
const GEN_SIGNAUX_JUGES_IA_RECIT = ['accroche_forte', 'rupture_attente', 'tension_maintenue', 'details_concrets', 'emotion_forte', 'cloture_complete', 'coherence_factuelle', 'non_redondance', 'originalite'];
// Même correctif que le mode Script (voir GEN_SIGNAUX_DEUX_CITATIONS,
// js/generation.js, retour terrain sur un score 25/100 à tort) : ces deux
// signaux ne se prouvent jamais par une seule citation.
// tension_maintenue décrit une relation début→fin, comme boucle_ouverte.
// cloture_complete exige DEUX éléments obligatoires (triple question
// miroir ET signature métapoétique) qu'une seule citation ne peut pas
// attester simultanément.
const GEN_SIGNAUX_DEUX_CITATIONS_RECIT = ['tension_maintenue', 'cloture_complete'];
const GEN_DIMENSIONS_RECIT = {
  narration:  ['accroche_forte', 'cloture_complete', 'coherence_factuelle'],
  engagement: ['rythme_soutenu', 'tension_maintenue', 'non_redondance'],
  emotion:    ['emotion_forte', 'details_concrets'],
  viral:      ['originalite', 'rupture_attente', 'emotion_forte']
};
// Même détecteur mécanique que le mode Script (voir _genDetecterRythmeSoutenu,
// js/generation.js), dupliqué ici (pas de module partagé entre fichiers
// chargés en <script> dans ce projet).
function _genDetecterRythmeSoutenuRecit(texte) {
  const phrases = String(texte || '').split(/[.!?…]+/).map(p => p.trim()).filter(Boolean);
  if (!phrases.length) return false;
  const motsTotal = phrases.reduce((s, p) => s + p.split(/\s+/).filter(Boolean).length, 0);
  return (motsTotal / phrases.length) <= 12;
}
// Signal EXPLICITEMENT true/false = 1/0 ; ABSENT (échec technique de
// l'évaluation IA) = 0.5, crédit neutre plutôt qu'une fausse note basse.
function _genScoreDimensionRecit(signaux, cles) {
  if (!signaux || typeof signaux !== 'object') return 50;
  const total = cles.reduce((somme, c) => somme + (signaux[c] === true ? 1 : signaux[c] === false ? 0 : 0.5), 0);
  return Math.round((total / cles.length) * 100);
}
// RÉTENTION : mêmes principes que le mode Script (voir _genScoreRetention,
// js/generation.js) : signaux de tension/clôture/rythme mélangés avec le
// vrai respect de la durée cible (mots comptés en code, jamais estimés).
function _genScoreRetentionRecit(signaux, motsReels, wt) {
  const base = _genScoreDimensionRecit(signaux, ['tension_maintenue', 'cloture_complete', 'rythme_soutenu']);
  let scoreMots = 100;
  if (wt && wt.min && wt.max) {
    if (motsReels < wt.min) scoreMots = Math.max(40, 100 - Math.round((wt.min - motsReels) / wt.min * 100));
    else if (motsReels > wt.max) scoreMots = Math.max(40, 100 - Math.round((motsReels - wt.max) / wt.max * 100));
  }
  return Math.round(base * 0.7 + scoreMots * 0.3);
}
function scorerRecitGenere(signaux, motsReels, wt) {
  return {
    viral: _genScoreDimensionRecit(signaux, GEN_DIMENSIONS_RECIT.viral),
    narration: _genScoreDimensionRecit(signaux, GEN_DIMENSIONS_RECIT.narration),
    engagement: _genScoreDimensionRecit(signaux, GEN_DIMENSIONS_RECIT.engagement),
    emotion: _genScoreDimensionRecit(signaux, GEN_DIMENSIONS_RECIT.emotion),
    retention: _genScoreRetentionRecit(signaux, motsReels, wt)
  };
}
// Juge EXTÉRIEUR et indépendant (voir commentaire d'en-tête ci-dessus),
// même mécanique que evaluerScriptGenere (js/generation.js) adaptée au
// vocabulaire du récit. Renvoie null en cas d'échec technique.
// Calcul du score du récit APRÈS son affichage (même principe et mêmes
// garde-fous que calculerScoreScriptEnArrierePlan, js/generation.js). Rien ici
// ne modifie le récit. Si le créateur a lancé un autre récit ou rouvert un
// ancien depuis l'historique entre-temps, currentStory ne pointe plus vers
// l'objet suivi et on s'arrête sans rien toucher.
// motsRecit est passé en paramètre plutôt que recalculé ici : countStoryWords
// vit dans la portée de generateStory, cette fonction-ci est au niveau module.
async function calculerScoreRecitEnArrierePlan(parsed, texteFinal, motsRecit, wt, sauvegardePromise) {
  let signauxIARecit = null;
  let raison = '';
  try {
    signauxIARecit = await evaluerRecitGenere(texteFinal);
    if (!signauxIARecit) {
      raison = _stRaisonJugeMuet;
      // Seconde tentative sur un modèle réellement différent, jamais à
      // l'identique : les deux modèles de callAI sont le même. Sauf refus
      // définitif (compte refusé, solde épuisé), où aucun modèle ne passera.
      if (!_stJugeEchecDefinitif) {
        signauxIARecit = await evaluerRecitGenere(texteFinal, MODEL_QUALITE_RECIT);
        if (!signauxIARecit) raison += ' | 2e tentative (autre modèle) : ' + _stRaisonJugeMuet;
      }
    }
  } catch (e) {
    raison = raison || ('erreur inattendue : ' + String((e && e.message) || e).slice(0, 120));
  }

  delete parsed.scoreEnCours;
  if (signauxIARecit) {
    // Même filet que côté Script : une exception ici laisserait la carte
    // bloquée sur "calcul en cours" pour toujours.
    try {
      const signauxFinalRecit = Object.assign(
        { rythme_soutenu: _genDetecterRythmeSoutenuRecit(texteFinal) },
        signauxIARecit
      );
      parsed.score = scorerRecitGenere(signauxFinalRecit, motsRecit, wt);
      delete parsed.evaluationIndisponible;
    } catch (e) {
      signauxIARecit = null;
      raison = 'calcul du score impossible : ' + String((e && e.message) || e).slice(0, 120);
    }
  }
  if (!signauxIARecit) {
    if (typeof journaliserEchecEvaluation === 'function') journaliserEchecEvaluation('score-story', raison);
    parsed.score = null;
    parsed.evaluationIndisponible = 'Score non calculé : l\'évaluation indépendante n\'a pas répondu cette fois. Plutôt que d\'afficher une note approximative, Scriptura préfère ne rien inventer. Régénère pour l\'obtenir.';
  }

  if (currentStory !== parsed) return; // un autre récit est affiché entre-temps
  if (typeof rafraichirCarteScore === 'function') rafraichirCarteScore('storyOutput', carteScoreRecitHTML(parsed));

  try { await sauvegardePromise; } catch (e) { /* sauvegarde déjà silencieuse */ }
  if (currentStory !== parsed) return;
  if (typeof updateGenerationScore === 'function') {
    updateGenerationScore(parsed.score, parsed.evaluationIndisponible || null);
  }
}

// Raison du dernier échec du juge du récit, pour la journaliser (même
// principe et mêmes motifs que _genRaisonJugeMuet, js/generation.js).
let _stRaisonJugeMuet = '';
// Même principe que _genJugeEchecDefinitif (js/generation.js) : un refus
// définitif ne se retente pas.
let _stJugeEchecDefinitif = false;
async function evaluerRecitGenere(texteComplet, modeleJuge) {
  _stRaisonJugeMuet = '';
  _stJugeEchecDefinitif = false;
  if (!texteComplet || !texteComplet.trim()) {
    _stRaisonJugeMuet = 'texte du récit vide';
    return null;
  }
  const prompt = `Tu es un critique EXTÉRIEUR et exigeant, tu n'as PAS écrit ce récit. Voici un récit TikTok déjà terminé. Ta seule mission : juger honnêtement s'il contient VRAIMENT chacune des techniques ci-dessous, et CITER le passage exact qui le prouve (jamais une paraphrase, jamais un extrait qui n'existe pas mot pour mot dans le texte).

RÉCIT :
"""
${texteComplet}
"""

Pour CHAQUE technique, juge sévèrement : ne coche "present":true QUE si tu peux citer un passage RÉEL et PRÉCIS (copié mot pour mot) qui le prouve sans discussion possible.
- "accroche_forte" : le hook arrête-t-il vraiment le scroll en 2 secondes, sans être générique ?
- "rupture_attente" : la toute première phrase surprend/contredit-elle une attente ?
- "tension_maintenue" : la tension narrative tient-elle vraiment du début à la fin, sans relâchement ? Cite le passage qui l'OUVRE ET le passage plus loin où elle culmine/se referme (deux citations, jamais une seule : ça se prouve en comparant deux endroits du texte).
- "details_concrets" : au moins un détail précis (nom/lieu/date/chiffre) ailleurs que dans le seul hook ?
- "emotion_forte" : un impact émotionnel réel et identifiable ?
- "cloture_complete" : le dernier segment contient-il vraiment les DEUX éléments obligatoires ? Cite la triple question miroir ET la signature métapoétique séparément (deux citations, jamais une seule : une seule citation ne peut pas prouver que les DEUX sont présentes).
- "coherence_factuelle" : aucune contradiction de date/heure/chiffre entre le hook et le reste du récit ?
- "non_redondance" : aucun segment consécutif ne reformule simplement le précédent ?
- "originalite" : l'angle est-il vraiment original, pas un cliché reconnaissable ?

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"accroche_forte":{"present":true,"preuve":"citation exacte ou vide"},"rupture_attente":{"present":true,"preuve":"..."},"tension_maintenue":{"present":true,"preuve_ouverture":"citation qui ouvre la tension","preuve_cloture":"citation plus loin qui la referme"},"details_concrets":{"present":true,"preuve":"..."},"emotion_forte":{"present":true,"preuve":"..."},"cloture_complete":{"present":true,"preuve_question":"citation de la triple question miroir","preuve_signature":"citation de la signature métapoétique"},"coherence_factuelle":{"present":true,"preuve":"..."},"non_redondance":{"present":true,"preuve":"..."},"originalite":{"present":true,"preuve":"..."}}`;

  try {
    const raw = await callAI(modeleJuge || MODEL_RAPIDE, 1400, prompt, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
    const jug = parseAIResponse(raw);
    if (!jug) {
      _stRaisonJugeMuet = 'réponse du juge illisible (aucun JSON exploitable)';
      return null;
    }
    const texteNormalise = _genNormaliserTexteJugeRecit(texteComplet);
    const signaux = {};
    GEN_SIGNAUX_JUGES_IA_RECIT.forEach(cle => {
      const d = jug[cle];
      if (cle === 'tension_maintenue') {
        const ouverture = _genValiderCitationRecit(d && d.preuve_ouverture, texteNormalise);
        const cloture = _genValiderCitationRecit(d && d.preuve_cloture, texteNormalise);
        const ordreValide = ouverture.valide && cloture.valide && cloture.position > ouverture.position;
        signaux[cle] = !!(d && d.present === true && ordreValide);
      } else if (cle === 'cloture_complete') {
        const question = _genValiderCitationRecit(d && d.preuve_question, texteNormalise);
        const signature = _genValiderCitationRecit(d && d.preuve_signature, texteNormalise);
        // La triple question précède toujours la signature dans le dernier
        // segment (voir le prompt de rédaction, point 9 puis point 10).
        const ordreValide = question.valide && signature.valide && signature.position > question.position;
        signaux[cle] = !!(d && d.present === true && ordreValide);
      } else {
        // Passait auparavant par sa propre normalisation en ligne (une 3e
        // copie de la même logique que _genValiderCitationRecit, divergente
        // d'elle) : unifié pour ne dépendre que d'un seul point de correction.
        const preuve = _genValiderCitationRecit(d && d.preuve, texteNormalise);
        signaux[cle] = !!(d && d.present === true && preuve.valide);
      }
    });
    return signaux;
  } catch (e) {
    // detailTechnique en priorité : le message montré au créateur est
    // neutralisé pour les erreurs d'infrastructure (voir callAI, js/api.js),
    // le journal doit garder la cause exacte.
    _stJugeEchecDefinitif = !!(e && e.fatal);
    _stRaisonJugeMuet = 'appel au juge impossible : ' + String((e && (e.detailTechnique || e.message)) || 'erreur inconnue').slice(0, 140);
    return null;
  }
}
// Même correctif que le mode Script (voir _genNormaliserTexteJuge,
// js/generation.js, retour terrain sur des scores viral/émotion à 0% causés
// par une simple différence d'apostrophe ou d'ellipse entre le rédacteur et
// le juge, deux appels IA séparés) : dupliqué ici, pas de module partagé
// entre fichiers chargés en <script> dans ce projet.
function _genNormaliserTexteJugeRecit(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[«»“”„]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
// Même helper que _genValiderCitation (js/generation.js), dupliqué ici (pas
// de module partagé entre fichiers chargés en <script> dans ce projet).
function _genValiderCitationRecit(preuve, texteNormalise) {
  let p = _genNormaliserTexteJugeRecit(preuve);
  if (p.length >= 2 && p[0] === '"' && p[p.length - 1] === '"') {
    p = p.slice(1, -1).trim();
  }
  if (p.length < 4) return { valide: false, position: -1 };
  const position = texteNormalise.indexOf(p);
  return { valide: position >= 0, position };
}

async function generateStory() {
  if (!_regenGratuiteEnCours) resetRegen('story');
  const input = document.getElementById('storyInput').value.trim();
  const errorBox = document.getElementById('storyErrorBox');
  errorBox.style.display = 'none';

  if (!input) {
    errorBox.textContent = 'Entre un sujet, une idée ou colle un texte pour créer ton récit.';
    errorBox.style.display = 'block'; return;
  }
  if (!storyFormat) {
    errorBox.textContent = 'Choisis un format : narratif long ou court.';
    errorBox.style.display = 'block'; return;
  }
  if (storyFormat === 'court' && !storyDuree) {
    errorBox.textContent = 'Choisis une durée pour le format court.';
    errorBox.style.display = 'block'; return;
  }

  // Vérification limite
  if (!unlocked && usedGen >= MAX_FREE) {
    openPlans('nouveau');
    return;
  }
  // Limite journalière pour les abonnés (anti-abus)
  if (!(await peutGenerer('storyErrorBox'))) return;

  setStoryLoading(true);
  document.getElementById('storyResults').style.display = 'none';

  // Cibles de mots pour le format court
  const wordTargets = {
    '30 secondes': { min: 60, max: 78 },
    '1 minute': { min: 130, max: 155 },
    '2 minutes': { min: 270, max: 310 },
    '3 minutes': { min: 410, max: 460 },
    '5 minutes': { min: 680, max: 780 }
  };
  const wt = wordTargets[storyDuree] || null;

  // Budget de segments déduit de la durée choisie, avec le découpage déjà
  // prescrit plus bas (13 à 18 mots par segment). Donne au modèle un repère
  // CONCRET du nombre d'étapes dont il dispose réellement pour transposer la
  // structure du modèle de référence, au lieu de le laisser deviner.
  const segMinRecit = wt ? Math.max(3, Math.round(wt.min / 18)) : 0;
  const segMaxRecit = wt ? Math.max(segMinRecit + 1, Math.round(wt.max / 13)) : 0;

  const longueurInstruction = storyFormat === 'court' && wt
    ? `LONGUEUR, RÈGLE ABSOLUE ET NON NÉGOCIABLE, ELLE PRIME SUR TOUT LE RESTE (peu importe la longueur du texte fourni par le créateur, même un article entier, ET peu importe la longueur du modèle de référence) : le récit doit faire EXACTEMENT entre ${wt.min} et ${wt.max} mots au total, pour ${storyDuree}. Repère de conversion : ~2,5 mots par seconde de narration. Compte tes mots avant de répondre, puis recompte après.

LE MODÈLE DE RÉFÉRENCE EST UNE RÉFÉRENCE DE STRUCTURE, JAMAIS DE LONGUEUR. Les modèles de référence font entre 386 et 768 mots, soit 2min30 à 5min de narration. Si la durée choisie ici est plus courte, tu ne dois SURTOUT PAS produire un récit de la longueur du modèle : tu dois TRANSPOSER sa structure entière à l'échelle de ${storyDuree}. Concrètement : toutes ses étapes narratives sont présentes, dans le même ordre, avec la même mécanique, mais chacune est RESSERRÉE. Une étape que le modèle développe sur un paragraphe entier peut tenir ici en une seule phrase, c'est normal et c'est exactement le travail attendu, jamais un appauvrissement.

CE QUI SE COMPRIME quand la durée est courte : le développement, les détails secondaires, les exemples, le nombre de phrases consacrées à chaque étape. CE QUI NE SE COMPRIME JAMAIS ET NE DISPARAÎT JAMAIS : le hook, l'ouverture, le détonateur, la montée de tension, la clôture (triple question miroir ET signature métapoétique). On resserre chaque étape, on n'en supprime aucune.

BUDGET CONCRET POUR ${storyDuree} : environ ${segMinRecit} à ${segMaxRecit} segments de 13 à 18 mots. Répartis les étapes du modèle sur ce nombre de segments. Si le modèle en compte davantage, FUSIONNE les étapes voisines les moins essentielles plutôt que d'en sacrifier une, et n'étale jamais une étape sur plusieurs segments quand le budget est serré.

ERREUR LA PLUS FRÉQUENTE, CELLE À NE JAMAIS COMMETTRE : calibrer le récit sur la longueur du modèle de référence au lieu de la durée demandée par le créateur. Un récit hors de la fourchette ${wt.min}-${wt.max} mots est un ÉCHEC, quelle que soit sa qualité par ailleurs.`
    : `LONGUEUR : Format narratif long. Déploie pleinement ton histoire, sans restriction de durée. Prends le temps de développer l'immersion, la tension et les rebondissements comme dans un vrai récit captivant.`;

  // La durée cible doit être connue de TOUS les agents qui jugent ou
  // réécrivent le récit, pas seulement du rédacteur. Sans elle, le Critique
  // compare un récit de 30 secondes (69 mots visés) au script complet du
  // modèle (386 à 768 mots) et signale comme "écart de calque" la compression
  // qui est précisément le travail demandé ; le Réviseur "corrige" alors en
  // rallongeant, et la durée choisie saute. C'est une cause structurelle de
  // récits hors cible, invisible tant que la contrainte ne circulait qu'au
  // moment de l'écriture (elle n'apparaissait que dans le prompt d'écriture).
  const contrainteDureeRecit = (storyFormat === 'court' && wt)
    ? `\nDURÉE CHOISIE PAR LE CRÉATEUR, CONTRAINTE NON NÉGOCIABLE : ${storyDuree}, soit ${wt.min} à ${wt.max} mots au total (~2,5 mots par seconde de narration).
LE MODÈLE CI-DESSUS EST UNE RÉFÉRENCE DE STRUCTURE, PAS DE LONGUEUR : les modèles font 386 à 768 mots (2min30 à 5min). Un récit correctement calqué à ${storyDuree} reprend TOUTES les étapes du modèle, dans le même ordre, avec la même mécanique, mais chacune resserrée à l'échelle de cette durée. Une étape traitée en une phrase là où le modèle lui consacre un paragraphe n'est donc PAS un écart de calque, c'est la transposition correcte, ne la signale jamais comme une faiblesse. Les seuls vrais écarts de calque sont : une étape SAUTÉE, une étape RÉORDONNÉE, ou une clôture amputée (triple question miroir ou signature métapoétique manquante).`
    : '';

  // Un texte collé long (article, notes brutes, plusieurs pages) est capé
  // avant d'entrer dans le prompt : la borne reste large (~20 000 caractères,
  // largement au-delà de la fenêtre de contexte du modèle), c'est un
  // garde-fou contre un collage aberrant, pas une limite pensée pour un
  // article normal, sans ça on perdrait silencieusement tout ce qui suit les
  // premiers paragraphes au lieu de laisser le modèle en faire la synthèse
  // (voir longueurInstruction plus haut : condenser est SON travail, jamais
  // en amont par une troncature qui jette de la matière). Même principe que
  // le mode Script (js/generation.js, LONG_SEUIL). Contrairement au mode
  // Script, il n'y a ici aucune phase de distillation séparée : ce texte est
  // réinjecté tel quel à chaque passe (écriture, critique, révision), coût
  // à considérer mais resté modeste au vu du nombre de passes borné à 2.
  const LONG_SEUIL_STORY = 400;
  const estTexteLongStory = input.length > LONG_SEUIL_STORY;
  const sujetPourPrompt = estTexteLongStory ? tronquerSansCouperEmoji(input, 20000) : input;

  // Recherche web : uniquement quand le créateur donne un SUJET court (pas de
  // niche à interroger ici, contrairement aux autres modes, voir js/api.js).
  // Quand il colle un texte long (article, script existant), il a déjà sa
  // matière première : Scriptura n'a pas à aller vérifier des faits qu'il
  // fournit lui-même. Le récit pouvant porter sur de l'actualité (politique,
  // faits divers) OU sur de l'Histoire, l'instruction couvre les deux cas,
  // l'IA applique celle qui correspond réellement au sujet donné.
  const rechercheWebStory = !estTexteLongStory;
  const instructionRechercheWebStory = rechercheWebStory
    ? `\nVÉRIFICATION FACTUELLE OBLIGATOIRE : avant d'écrire, utilise la recherche web pour vérifier les faits que tu comptes citer. Si le sujet relève de l'actualité, de la politique ou de la géopolitique récente, vérifie que ce que tu racontes est bien à jour aujourd'hui, jamais un statut, un poste ou une situation qui a pu changer depuis tes connaissances d'entraînement, une actualité politique pouvant changer chaque jour : va chercher l'information la plus récente, pas une archive. Si le sujet relève de l'Histoire, vérifie l'exactitude des faits historiques (dates, noms, chiffres, déroulé réel des événements) et recherche la version la plus fiable, pas une version approximative ou déformée.\n`
    : '';

  // Présélection de plusieurs modèles de référence candidats, voir
  // js/modeles.js. Le choix final entre ces candidats est fait par le
  // moteur Storytelling lui-même, en silence, dans ce même appel (aucun
  // appel supplémentaire). Sélection SÉMANTIQUE par IA (choisirModelesSemantique,
  // fiche ADN de chaque modèle : structure/rythme/type de hook/sujets
  // compatibles) comme mécanisme PRINCIPAL, décision du propriétaire : un
  // choix de script sur la seule ressemblance de mots-clés n'est pas
  // fiable. Le filtre lexical (choisirTopModeles) ne sert plus qu'en tout
  // dernier recours, si l'appel IA échoue techniquement (panne réseau/API),
  // pour ne jamais laisser Scriptura sans aucune référence de style.
  let modeleRef = '';
  let candidatsModeles = [];
  try {
    if (typeof choisirModelesSemantique === 'function' || typeof choisirTopModeles === 'function') {
      let candidats = (typeof choisirModelesSemantique === 'function')
        ? await choisirModelesSemantique(sujetPourPrompt, 3)
        : [];
      if (!candidats.length && typeof choisirTopModeles === 'function') {
        candidats = choisirTopModeles(sujetPourPrompt, 3, false); // secours technique uniquement
      }
      candidatsModeles = candidats;
      if (candidats.length) {
        const blocsCandidats = candidats.map((m, i) =>
          `── CANDIDAT ${i + 1} ──\nTITRE : ${m.titre}\nTON : ${m.ton}\nSCRIPT :\n${m.script}`
        ).join('\n\n');
        modeleRef = `

════════════════════════════════════════════
MODÈLES DE RÉFÉRENCE CANDIDATS (ta propre signature narrative, ${candidats.length} option${candidats.length > 1 ? 's' : ''} pertinente${candidats.length > 1 ? 's' : ''} pour ce sujet)
${candidats.length > 1 ? 'AVANT D\'ÉCRIRE, choisis EN SILENCE (ne l\'annonce jamais dans ta réponse) celui des candidats ci-dessous dont la structure narrative, le rythme, la progression dramatique et la montée en tension serviront le mieux CE récit précis, pas seulement celui dont le thème ressemble le plus au sujet. Une fois ce choix fait, utilise EXCLUSIVEMENT ce modèle unique comme référence absolue de style, de rythme, de ton et de structure : ne mélange JAMAIS plusieurs modèles entre eux.' : 'Utilise ce script comme RÉFÉRENCE ABSOLUE de style, de rythme, de ton et de structure.'}

INTERDICTION ABSOLUE DE COPIE, MÊME PARTIELLE, MÊME REFORMULÉE : tu ne dois JAMAIS reprendre une phrase du modèle en te contentant de changer un ou deux mots. Exemple d'ÉCHEC GRAVE déjà constaté : le modèle se termine par "Que parfois, la beauté ne sauve rien ?" et le récit livré dit "Que parfois, la tendresse ne sauve rien ?", même construction, un seul mot changé, ce n'est PAS calquer, c'est du plagiat déguisé. CALQUE veut dire reprendre son SQUELETTE narratif exact, étape par étape, dans le MÊME ordre, avec le MÊME dosage entre ce qu'il développe longuement et ce qu'il ne fait qu'effleurer, comme si tu posais un calque transparent sur sa structure et que tu écrivais entièrement par-dessus, avec des PHRASES 100% NOUVELLES, propres à CE sujet précis. Repère aussi les PROCÉDÉS RHÉTORIQUES qu'il emploie (anaphore, ironie, personnification, ellipse, images visuelles, antithèse, etc.) et réutilise-les dans ton récit avec la MÊME fréquence et la MÊME fonction narrative que dans le modèle, jamais ses mots. IMPRÈGNE-toi aussi de sa manière : la façon dont le hook frappe, dont les phrases sont courtes et rythmées, dont la tension monte, et SURTOUT la façon PRÉCISE dont IL referme le récit, reproduis exactement cette structure de clôture, quelle qu'elle soit (triple question, signature, chute sèche, question unique, autre chose), pas une clôture générique, mais avec un texte entièrement neuf. Ton objectif n'est jamais de coller au modèle par sécurité : c'est de faire AUSSI BIEN, IDÉALEMENT MIEUX que lui, avec exactement la même mécanique, une exécution plus percutante, plus précise, plus surprenante sur CE sujet précis, jamais un ersatz affadi de son texte original.

PRIORITÉ ABSOLUE DE CE MODÈLE (règle très importante) : le choix et le respect d'un modèle de référence n'est PAS optionnel, c'est une exigence centrale de Scriptura. Ton récit doit être CALQUÉ sur ce modèle (sa mécanique, sa structure), jamais RECOPIÉ (ses mots, ses phrases). Si la STRUCTURE de ce modèle (l'ordre de ses étapes narratives, ce qu'il choisit de développer ou de survoler) diffère de la MÉTHODE NARRATIVE OBLIGATOIRE listée plus bas, c'est TOUJOURS la structure du modèle choisi qui prime. La méthode ci-dessous ne comble que ce que le modèle ne couvre pas explicitement, elle ne le remplace jamais.

${blocsCandidats}
════════════════════════════════════════════
`;
      }
    }
  } catch(e) { /* si modeles.js absent, on continue avec la méthode seule */ }

  // Mémoire du créateur : voir js/profil.js, une ligne de contexte en plus,
  // sans toucher à la méthode narrative ni aux règles ci-dessous.
  const profilLigneStory = ligneProfilPourPrompt(await chargerProfilCreateur());

  // Ton, optionnel désormais : si le créateur n'en choisit pas, l'IA choisit
  // elle-même celui qui sert le mieux le sujet (en priorité celui du modèle
  // de référence retenu plus haut), et doit le rapporter dans le champ "ton".
  const tonInstruction = storyTon
    ? `TON, RÈGLE ABSOLUE, RESPECT STRICT ET EXCLUSIF : le créateur a choisi précisément le ton "${storyTon}". Écris l'INTÉGRALITÉ du récit dans CE ton, du hook à la clôture finale, sans jamais dévier vers un autre registre, même partiellement, même une seule phrase. C'est une consigne explicite du créateur, pas une suggestion : la trahir est un échec, quelle que soit la qualité par ailleurs. Un ton glacial ne devient jamais chaleureux en cours de route ; un ton ironique ne bascule jamais dans le pathos ; un ton poétique ne devient jamais froid ou clinique.`
    : `TON, LIBRE, À TOI DE CHOISIR : le créateur n'a précisé aucun ton. Choisis celui qui sert le mieux CE sujet précis, en priorité celui du modèle de référence choisi plus haut (chaque modèle a son propre ton). Une fois ce choix fait, tiens-le du hook à la clôture, sans jamais dévier vers un autre registre en cours de route. Indique le ton choisi (en un ou deux mots) dans le champ "ton" de ta réponse JSON.`;

  // Plateforme, RÈGLE ABSOLUE elle aussi (auparavant transmise sans aucune
  // consigne : le choix du créateur n'avait littéralement aucun effet sur la
  // légende, les hashtags ou l'appel à l'action). Le récit lui-même reste
  // inchangé (toutes ces plateformes partagent le même format vertical
  // court) : seule la légende/CTA/hashtags s'adaptent aux codes propres à
  // chaque plateforme.
  // TikTok certain (le sélecteur de plateforme a été retiré de tous les
  // modes) : la consigne devient inconditionnelle ET plus ferme. Elle n'était
  // même pas envoyée du tout quand aucune plateforme n'était choisie, donc
  // légende, hashtags et CTA partaient sans aucun cadre.
  const plateformeInstruction = `PLATEFORME, RÈGLE ABSOLUE : ce contenu est destiné à TIKTOK, jamais à une autre plateforme. Le récit lui-même ne change pas de structure, mais la LÉGENDE, les HASHTAGS et l'appel à l'action DOIVENT respecter les codes TikTok : légende courte et punchy, tutoiement direct, appel à l'action franc ("commente si...", "partage à quelqu'un qui..."), hashtags mêlant tendance et niche. Ne produis jamais une légende générique valable pour n'importe quelle plateforme, ni une légende qui ressemble à une description YouTube.`;

  // Mémoire virale partagée (le récit n'a pas de niche : mélange universel de
  // leviers réels). recupererPatternsViraux vient de js/generation.js (global).
  const memoireViraleStory = (typeof recupererPatternsViraux === 'function')
    ? await recupererPatternsViraux('') : '';

  const storyPrompt = `Tu es le meilleur storyteller narratif francophone, spécialisé dans les récits immersifs, critiques et stylisés pour les réseaux sociaux. Tu produis un script qui capte l'attention immédiatement, la maintient jusqu'à la fin, et marque émotionnellement le spectateur. Le spectateur doit VIVRE la scène, pas seulement la regarder.
${memoireViraleStory}

SUJET / TEXTE FOURNI PAR L'UTILISATEUR :
"""
${sujetPourPrompt}
"""
${estTexteLongStory ? "CE TEXTE EST UN TEXTE SOURCE LONG (article, notes brutes), PAS UN RÉCIT À RECOPIER : dégages-en le sujet réel, les faits marquants et l'angle le plus fort, puis RÉÉCRIS entièrement une histoire selon la méthode ci-dessous. Ne recopie JAMAIS des phrases entières du texte fourni tel quel, c'est une matière première, pas un brouillon à peaufiner." : ''}
${instructionRechercheWebStory}${plateformeInstruction}
${profilLigneStory ? profilLigneStory : ''}
${modeleRef}
${longueurInstruction}

MÉTHODE NARRATIVE OBLIGATOIRE (ta signature) :

1. HOOK EN 2 PHRASES, ASSEZ COURT ET SURTOUT PERCUTANT POUR ARRÊTER LE SCROLL IMMÉDIATEMENT, c'est le vrai critère, la longueur n'est qu'un moyen au service de ça, jamais une fin en soi : paradoxal, choquant, dérangeant, fataliste ou intrigant. Les 15 modèles réels de Scriptura tournent en moyenne autour de 11-12 mots pour les deux phrases réunies, rarement au-delà de 15 : c'est un repère de calibration, pas un plafond à atteindre au mot près. Un hook de 18-19 mots parfaitement claquant et grammaticalement impeccable vaut toujours mieux qu'un hook amputé d'un mot nécessaire pour rentrer dans une limite arbitraire. Élague le superflu (décor, précisions, subordonnées inutiles), jamais la grammaire : ne supprime jamais un article ou un mot grammaticalement nécessaire pour gagner un mot ("la vengeance devint traité" est une faute, pas un style, dis "la vengeance devint un traité" ou reformule). Le hook doit TOUJOURS rester ancré dans un fait concret (une date, un nom, un lieu, un chiffre), jamais une pure image abstraite ou philosophique qui plane au-dessus du sujet sans rien accrocher de réel : "Il a forgé une arme qui allait le détruire" reste vague et générique, "Le 16 août 2026, il a signé sa propre chute" accroche immédiatement parce que le spectateur sait DE QUOI et DE QUAND on parle.
   Exemples du style, avec leur nombre de mots : "Il n'a pas fait un braquage. Il a juste pris une décision." (13 mots) / "Il voulait devenir le guide du monde arabe. Il a fini lynché dans un tuyau." (15 mots) / "Ils ont vécu 24 ans sans lumière. Et personne n'a rien vu." (12 mots)

2. OUVERTURE, TOUJOURS UN SEGMENT À PART ENTIÈRE (jamais fusionnée avec le Hook ou le Contexte) : Enchaîne avec "Aujourd'hui, on parle de..." (ou variante fluide) qui pose le personnage ou l'enjeu. Voir "Ouverture" dans le format JSON plus bas : ce segment doit apparaître, distinct du Hook et du Contexte.

3. DÉTONATEUR, DÈS LES 5 À 10 PREMIÈRES SECONDES (juste après l'Ouverture, jamais repoussé après le portrait) : une question, une révélation ou une accusation qui fait basculer le récit et ouvre une boucle que le spectateur veut voir se refermer. C'est ce qui donne une raison concrète de rester, avant même de connaître tous les détails du contexte.

4. IMMERSION EN SECONDE PERSONNE : Utilise "Imaginez, vous êtes..." pour plonger le spectateur DANS la scène ouverte par le Détonateur, dans LA SITUATION PRÉCISE DU PERSONNAGE, jamais une adresse générique sur la vie ou les habitudes du spectateur lui-même (ce glissement, fréquent, transforme l'immersion en discours de coach, ce n'est plus de la narration). "Imaginez, vous êtes à sa place, ce soir-là, l'écran encore allumé..." plonge dans SA scène à LUI ; "Vous peaufinez chaque mot, vous testez chaque timing..." parle de la vie du spectateur, pas de celle du personnage, ce n'est pas de l'immersion. C'est un procédé signature essentiel. Fais-le vivre la situation de l'intérieur, tension déjà posée.

5. CONTEXTE / PORTRAIT, une fois la tension déjà installée : Plante le décor, présente le personnage ou la situation de façon vivante et concrète, MAINTENANT que le spectateur a une raison de vouloir ces détails. Le personnage doit être ANCRÉ par au moins un détail précis (un nom, une plateforme, un lieu, un chiffre, une date), jamais réduit à un simple "il"/"elle" générique du début à la fin : un récit qui ne nomme jamais son personnage ni ne cite aucun fait concret à son sujet reste une parabole abstraite, pas une histoire vécue, même si le hook, lui, était concret. SI LE SUJET FOURNI EST UN FAIT RÉEL DOCUMENTÉ, ces détails doivent être exacts et vérifiables, jamais inventés au détriment de la réalité. SI LE SUJET EST UNE IDÉE, UNE SITUATION HYPOTHÉTIQUE OU INVENTÉE (pas de personne ni d'événement réel identifiable), invente toi-même un prénom et un décor précis (plateforme, lieu, date plausible) pour ancrer le récit comme le ferait n'importe quelle fiction narrative, mais ne présente jamais ces détails inventés comme un fait réel vérifiable, et n'utilise jamais par erreur le nom d'une vraie personne ou marque existante pour une histoire inventée. N'énonce PAS de nouveau, avec d'autres mots, l'idée déjà posée dans l'Ouverture ou le Détonateur (ex : l'Ouverture dit déjà "imposé pour asservir l'Allemagne pendant des décennies", le Contexte ne doit pas répéter "avec un seul objectif : la faire payer pendant des décennies", c'est du piétinement, pas une progression). Chaque segment doit faire AVANCER le récit avec une information ou une scène nouvelle, jamais reformuler ce qui vient d'être dit.

6. MONTÉE DE TENSION avec RELANCES régulières (tous les ~5 secondes de lecture) : des ruptures narratives, des cliffhangers, des "Mais...", "Et là...", "Sauf que...". Personne ne doit décrocher.

7. Le message clé doit apparaître AVANT 20 secondes de lecture (pas de réserver tout le sens pour la conclusion).

8. Ajoute au moins un élément qui pousse à SAUVEGARDER : un fait rare, une citation mémorable, une révélation choc, un chiffre marquant.

9. CLÔTURE NARRATIVE, TOUJOURS UNE TRIPLE QUESTION MIROIR : c'est la marque de fabrique de Scriptura, les 15 modèles de référence s'y tiennent SANS EXCEPTION, ce n'est jamais une option parmi d'autres.
   "Alors, que retenir de cette histoire ?
   Que... ?
   Que... ?
   Ou que... ?"
   Ces questions doivent heurter, interpeller, et pousser à commenter/partager, adaptées précisément au sujet, jamais un gabarit générique.

10. SIGNATURE MÉTAPOÉTIQUE, OBLIGATOIRE DANS TOUS LES RÉCITS, SANS EXCEPTION. Aucun des 15 modèles de référence ne contient cette phrase eux-mêmes, c'est volontaire : c'est une exigence SUPPLÉMENTAIRE de Scriptura, à ajouter systématiquement, jamais une simple clôture de secours. Ajoute, juste avant ou après la triple question du point 9, une phrase de forme fixe "Moi, je t'ai pas [X]. Je t'ai [Y].", ton poétique, ironique, lucide, qui frappe fort en une seule image, adaptée précisément au sujet. Elle agit comme signature narrative de Scriptura.
    Exemple : "Moi, je t'ai pas raconté une fuite. Je t'ai montré ce que devient un empire quand il rentre dans une valise."

RAPPEL, LE DERNIER SEGMENT CONTIENT TOUJOURS LES DEUX : la triple question du point 9 ET la signature du point 10, jamais l'une sans l'autre. Un récit qui livre uniquement la signature métapoétique sans la triple question qui la précède (ou l'inverse) est un ÉCHEC DE CLÔTURE, l'erreur la plus visible et la plus grave que Scriptura puisse commettre.

${tonInstruction}

STYLE ET LANGUE :
- Français courant, compréhensible par un ado de 12 ans, avec de subtiles anecdotes qui font sourire le spectateur.
- Phrases brèves et moyennes. Rythme soutenu. Images fortes. Ruptures marquées.
- AUCUN ton générique. Aucune formule plate.
- UNE IMAGE MENTALE TOUTES LES 3 À 5 SECONDES (essentiel pour le storyboard qui sera généré ensuite à partir de ce texte) : écris comme si tu filmais mentalement chaque instant. Chaque phrase, ou petit groupe de phrases très courtes, doit porter UNE SEULE idée visuelle claire, concrète et filmable (une action, un lieu, un visage, un objet), jamais plusieurs idées mélangées dans une même phrase longue. Change d'image mentale environ toutes les 8 à 14 mots (~3 à 5 secondes à l'oral). Interdiction des phrases analytiques ou à tiroirs qui empilent plusieurs images en une seule construction : découpe-les en plusieurs phrases courtes, chacune avec sa propre image.
- LE CHAMP "texte" DE CHAQUE SEGMENT NE CONTIENT JAMAIS DE MINUTAGE : le champ "segment" (ex: "Hook", "Contexte") est SÉPARÉ et sert uniquement de repère pour le créateur, ne répète jamais un minutage chiffré ("0-3 sec", "0:00-0:05"...) en tête ou dans le corps du champ "texte". Le champ "texte" est ce qu'une voix off va LIRE À VOIX HAUTE mot pour mot : écris directement la phrase parlée.

EXIGENCE DE PERFECTION : Avant de livrer, relis ton récit. S'il n'atteint pas un niveau où un storyteller professionnel ne trouverait rien à améliorer, réécris-le. Vérifie que le hook arrête le scroll, que la tension tient du début à la fin, et que le DERNIER segment contient bien les DEUX éléments obligatoires : la triple question miroir (point 9) ET la signature métapoétique (point 10), jamais l'une sans l'autre.

COHÉRENCE FACTUELLE INTERNE, à vérifier en dernier : relis chaque date, heure ou chiffre cité (dans le hook COMME dans le corps du récit) et assure-toi qu'un même fait n'est JAMAIS donné avec deux valeurs différentes d'un passage à l'autre (ex : ne jamais donner une heure dans le hook puis une heure différente plus loin pour le même événement). Le hook doit être percutant, jamais approximatif ou inventé au détriment de l'exactitude déjà établie ailleurs dans le récit.

NON-REDONDANCE ENTRE SEGMENTS, à vérifier en dernier également : relis les segments consécutifs, surtout les tout premiers (Hook, Ouverture, Détonateur, Contexte). Si deux segments qui se suivent expriment la même idée avec des mots différents (piétinement), fusionne-les ou réécris le second pour qu'il apporte une information ou une scène réellement nouvelle. Chaque segment doit faire progresser le récit, jamais reformuler ce qui vient d'être dit.

ANCRAGE CONCRET DU RÉCIT ENTIER, à vérifier en dernier également : un hook concret suivi d'un corps qui retombe dans l'abstrait (un "il"/"elle" jamais nommé, aucune plateforme, aucun lieu, aucun chiffre après le hook) reste une parabole générique, pas une histoire vécue, même si le hook, lui, accrochait. Relis le récit en entier et vérifie qu'au moins un détail précis (nom, plateforme, lieu, date, chiffre, réel si le sujet l'est, sinon inventé comme le ferait toute fiction, voir point 5) apparaît AUSSI dans le Contexte ou la Montée de tension, pas seulement dans le Hook. Vérifie aussi que l'Immersion (point 4) plonge bien DANS la situation du personnage, jamais dans un discours générique adressé à la vie du spectateur.

EN PLUS DU RÉCIT, génère aussi :
- 5 HOOKS alternatifs (variations du hook d'ouverture, chacun dans un style différent mais gardant l'esprit paradoxal/choc)
- Une LÉGENDE prête à publier (accrocheuse, avec appel à commenter/partager)
- 8 HASHTAGS pertinents pour la portée

Vise l'excellence absolue.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"titre":"un titre évocateur pour ce récit","ton":"le ton choisi","modele_utilise":"le TITRE EXACT (copié tel quel) du candidat choisi plus haut","hooks":[{"style":"Type de hook","texte":"le hook complet"}],"recit":[{"segment":"Hook","texte":"..."},{"segment":"Ouverture","texte":"le \"Aujourd'hui, on parle de...\" (ou variante fluide) qui pose le personnage ou l'enjeu, voir point 2"},{"segment":"Détonateur","texte":"..."},{"segment":"Immersion","texte":"..."},{"segment":"Contexte","texte":"..."},{"segment":"Tension","texte":"..."},{"segment":"Clôture","texte":"la triple question miroir, PLUS la signature métapoétique obligatoire"}],"legende":"la légende prête à publier, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"],"analyse":"analyse critique courte du récit et pourquoi il fonctionne"}

Génère exactement 5 hooks et 2 variantes de titre (A et B) percutantes et différentes à tester. Découpe le récit en segments : chaque segment doit correspondre à environ 5 à 7 secondes de narration à l'oral (soit ~13 à 18 mots par segment). Le nombre de segments s'adapte à la longueur totale du récit. Le dernier segment DOIT contenir la triple question miroir ET la signature métapoétique, les deux systématiquement, jamais l'une sans l'autre. Le champ "modele_utilise" DOIT correspondre exactement au titre du candidat effectivement suivi, c'est ce qui permet de vérifier après coup que le reste de la structure (hors clôture) a bien été respecté.`;

  try {
    if (typeof avancerEtapeGen === 'function') avancerEtapeGen(1); // phase : écriture du récit
    // Étape en FLUX (voir onApercu, callAI) : le % avance en continu,
    // réellement proportionnel aux caractères déjà reçus, jamais à un
    // minuteur (voir GEN_POIDS.story, js/generation.js).
    const onApercuEcriture = (buf) => {
      afficherApercuEnDirect(buf, 'recit');
      if (typeof genProgressCtl !== 'undefined' && genProgressCtl) genProgressCtl.etapeFluxProgres(1, fractionFlux(buf.length, 16000));
    };
    const raw = await callAI(MODEL_CREATIF, 16000, storyPrompt, undefined, rechercheWebStory, undefined, undefined, undefined, onApercuEcriture, 'story');
    let parsed = parseAIResponse(raw);
    // Réponse tronquée (rare, mais arrive) : une nouvelle tentative silencieuse
    // avant de déranger le créateur avec une erreur qu'il devrait relancer lui-même.
    if (!parsed || !parsed.recit) {
      // Recherche web désactivée sur cette tentative de secours : si le 1er
      // essai a échoué (souvent une réponse tronquée par le temps limite), la
      // priorité passe à FINIR le récit plutôt qu'à revérifier des faits,
      // la recherche web ajoute justement le temps qui a fait échouer le 1er essai.
      const rawRetry = await callAI(MODEL_CREATIF, 16000, storyPrompt, undefined, false, undefined, undefined, undefined, onApercuEcriture, 'story');
      parsed = parseAIResponse(rawRetry);
    }
    if (!parsed || !parsed.recit) throw new Error('Réponse incomplète, réessaie');
    // Si le créateur a choisi un ton, l'affichage doit toujours correspondre
    // exactement à son choix, jamais à ce que l'IA a échoué à recopier
    // fidèlement. Sans choix explicite, on garde le ton que l'IA rapporte
    // elle-même avoir retenu (voir tonInstruction ci-dessus).
    if (storyTon) parsed.ton = storyTon;

    // ── MODÈLE DE RÉFÉRENCE RÉELLEMENT UTILISÉ ──
    // Avant ce correctif, le Critique éditorial ci-dessous devait juger la
    // fidélité "au modèle choisi" SANS jamais savoir lequel ni à quoi
    // ressemblait sa structure réelle, il ne pouvait donc pas vraiment
    // vérifier ce point. On retrouve ici le modèle via le titre que l'IA
    // rapporte (voir "modele_utilise" dans le JSON) et on transmet son
    // script COMPLET (pas seulement la clôture) au Critique et au Réviseur :
    // la fidélité au modèle porte sur toute la structure, l'ordre des
    // étapes, ce qu'il développe ou survole, pas seulement sur la clôture.
    const modeleUtilise = candidatsModeles.find(m => m.titre === parsed.modele_utilise) || candidatsModeles[0] || null;
    const structureModeleRef = modeleUtilise ? modeleUtilise.script.trim() : '';

    // ── CRITIQUE + RÉVISEUR (comme le mode script) ──
    // Le récit avait longtemps ce maillon manquant. Un Critique indépendant
    // cherche les faiblesses segment par segment ; si un problème ressort, un
    // Réviseur réécrit UNIQUEMENT les segments faibles. Sauté si l'utilisateur
    // a demandé « Répondre maintenant ». Si le Critique (indépendant) juge le
    // brouillon fondamentalement faible (voir critiqueRecitProblemeFondamental),
    // un second brouillon complet est retenté une fois plutôt qu'une révision
    // ciblée insuffisante, exactement comme le mode script (js/generation.js) :
    // avant ce correctif, un score honnête mais < 90 déclenchait déjà une
    // réécriture complète décidée par l'auto-évaluation du Rédacteur lui-même,
    // même pour un récit déjà correct que le Critique/Réviseur, moins coûteux,
    // aurait suffi à peaufiner. Bornée à 2 passes pour garder un temps de
    // génération raisonnable.
    // Mesure passive des passes réellement effectuées (voir _mesurePasses,
    // js/generation.js, même principe et même finalité). N'influence aucune
    // décision, aucune donnée de contenu.
    const _mesurePassesRecit = { corrections_duree: 0, critiques: 0, revisions: 0, second_brouillon: false };

    const MAX_PASSES_QUALITE_RECIT = 2;
    if (!repondreMaintenant) {
      try {
        for (let passe = 0; passe < MAX_PASSES_QUALITE_RECIT; passe++) {
          _mesurePassesRecit.critiques++;
          if (repondreMaintenant) break; // l'utilisateur a demandé son brouillon maintenant

          const recitForReview = (parsed.recit || []).map((s, i) => '[segment ' + i + ', ' + (s.segment || '') + '] ' + s.texte).join('\n');
          const critiquePrompt = `Tu es le Critique Éditorial de Scriptura, un directeur narratif exigeant et INDÉPENDANT. Tu n'as PAS écrit ce récit, ton rôle est de chercher VOLONTAIREMENT ses faiblesses, jamais de le valider par complaisance. Un récit Scriptura ne doit JAMAIS ressembler à ce que produirait une IA généraliste (transitions plates, généralités creuses, ton neutre de manuel).

SUJET : ${sujetPourPrompt}
RÉCIT PROPOSÉ (segments numérotés, ne change jamais leur numéro) :
${recitForReview}
${structureModeleRef ? `\nSCRIPT COMPLET DU MODÈLE DE RÉFÉRENCE RÉELLEMENT SUIVI POUR CE RÉCIT (référence réelle à comparer, pas une supposition) :\n"""\n${structureModeleRef}\n"""` : ''}
${contrainteDureeRecit}

TON TRAVAIL :
1. DÉTECTION DES FAIBLESSES segment par segment : phrases génériques, clichés, baisses de tension, passages oubliables, révélations arrivées trop tôt, formulations "qui sentent l'IA". Indique le numéro du segment.
2. RÉFUTATION, cherche TOUTES les raisons concrètes pour lesquelles un spectateur ferait défiler la vidéo AVANT LA FIN (hook trop lent, passage à vide, prévisibilité, immersion qui retombe...). Ne laisse la liste vide que si, après examen sincère et sévère, tu ne trouves vraiment aucune raison.
3. Compare LITTÉRALEMENT le récit au SCRIPT COMPLET DU MODÈLE ci-dessus (si fourni) : le récit doit être CALQUÉ sur ce modèle, pas seulement inspiré par lui, TOUTE sa structure : l'ordre des étapes narratives, ce qu'il développe ou survole, son rythme. Si le récit s'écarte du squelette du modèle (une étape sautée, réordonnée, ou développée alors que le modèle ne fait que l'effleurer, ou l'inverse), c'est un écart de calque à signaler dans segments_faibles. Vérifie SPÉCIFIQUEMENT que le dernier segment se termine par une triple question miroir ("Alors, que retenir de cette histoire ? Que... ? Que... ? Ou que... ?") : si elle est absente, c'est une ERREUR GRAVE à signaler explicitement dans segments_faibles, pas une nuance à minimiser, c'est l'écart le plus visible et le plus grave que Scriptura puisse commettre.
4. PLAGIAT, vérification OBLIGATOIRE, indépendante des points précédents : compare chaque phrase du récit, mot par mot, aux phrases du script du modèle. Si une phrase du récit reprend la construction ou l'essentiel des mots d'une phrase du modèle (même avec un ou deux mots changés, ex. "Que parfois, la tendresse ne sauve rien ?" copié sur "Que parfois, la beauté ne sauve rien ?"), c'est un PLAGIAT à signaler explicitement dans segments_faibles, quel que soit le segment concerné (hook, clôture, ou autre). Une bonne exécution du calque ne partage JAMAIS de phrase reconnaissable avec le modèle, seulement sa mécanique.
5. Vérifie que la SIGNATURE MÉTAPOÉTIQUE ("Moi, je t'ai pas [X]. Je t'ai [Y].") est bien présente dans la clôture, adaptée précisément au sujet, et qu'elle frappe fort en une seule image. Elle est OBLIGATOIRE dans tous les récits, quel que soit le modèle choisi, si elle est absente, générique ou faible, signale-le comme un problème à corriger.
6. REDONDANCE, vérification OBLIGATOIRE : compare chaque segment à celui qui le précède IMMÉDIATEMENT, en particulier les tout premiers (Hook, Ouverture, Contexte). Si un segment exprime, avec d'autres mots, une idée déjà posée dans le segment précédent (piétinement, pas de progression), c'est une faiblesse à signaler explicitement dans segments_faibles, même si chaque segment pris isolément est bien écrit. Exemple à signaler : l'Ouverture dit "imposé pour asservir l'Allemagne pendant des décennies" et le segment suivant dit "avec un seul objectif : la faire payer pendant des décennies", c'est la même idée répétée.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"verdict":"excellent" ou "à améliorer","segments_faibles":[{"index":2,"probleme":"description précise et actionnable"}],"raisons_de_scroll":["raison concrète 1"],"ia_generique":false,"instructions_revision":"instructions précises, segment par segment"}`;

          if (typeof avancerEtapeGen === 'function') avancerEtapeGen(2); // phase : critique éditorial
          const critiqueRaw = await callAI(MODEL_QUALITE_RECIT, 2500, critiquePrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
          const critique = parseAIResponse(critiqueRaw);
          if (!critique) break; // échec technique : on s'arrête là plutôt que de perdre du temps

          function critiqueRecitProbleme(c) {
            if (!c) return false;
            if (c.verdict === 'à améliorer') return true;
            if (c.ia_generique === true) return true;
            if (Array.isArray(c.segments_faibles) && c.segments_faibles.length > 0) return true;
            if (Array.isArray(c.raisons_de_scroll) && c.raisons_de_scroll.length > 0) return true;
            return false;
          }
          // Sous-ensemble plus sévère : justifie un second brouillon COMPLET
          // plutôt qu'une révision ciblée (générique ET jugé "à améliorer" à la
          // fois, ou un nombre de segments faibles couvrant une bonne partie du récit).
          function critiqueRecitProblemeFondamental(c) {
            if (!c) return false;
            if (c.verdict === 'à améliorer' && c.ia_generique === true) return true;
            if (Array.isArray(c.segments_faibles) && Array.isArray(parsed.recit) && parsed.recit.length > 0 && c.segments_faibles.length / parsed.recit.length >= 0.6) return true;
            return false;
          }

          if (!critiqueRecitProbleme(critique)) break; // le récit passe le contrôle qualité : terminé

          if (!repondreMaintenant && passe === 0 && critiqueRecitProblemeFondamental(critique)) {
            // ── SECOND BROUILLON COMPLET ──
            // Le Critique (indépendant) juge le premier brouillon fondamentalement
            // faible : une révision segment par segment ne suffirait pas, on
            // retente une écriture complète plutôt que de rafistoler.
            try {
              _mesurePassesRecit.second_brouillon = true;
              const raw2 = await callAI(MODEL_CREATIF, 16000, storyPrompt, undefined, rechercheWebStory, undefined, undefined, undefined, onApercuEcriture, 'story');
              const parsed2 = parseAIResponse(raw2);
              if (parsed2 && parsed2.recit) {
                parsed = parsed2;
                if (storyTon) parsed.ton = storyTon;
                continue; // relance une passe de critique sur ce nouveau brouillon
              }
            } catch(e) { /* si le second brouillon échoue, on continue avec la révision ciblée */ }
          }

          const segmentsFaiblesTxt = (critique.segments_faibles || [])
            .map(sf => '- Segment ' + sf.index + ' : ' + sf.probleme).join('\n')
            || 'Applique les instructions générales ci-dessous.';
          const raisonsScrollTxt = (critique.raisons_de_scroll || []).map(r => '- ' + r).join('\n');

          const revisePrompt = `Tu es le Réviseur en Chef de Scriptura, expert en réécriture CIBLÉE de récits viraux. Un critique indépendant a évalué le récit ci-dessous. RÈGLE ABSOLUE : ne réécris QUE les segments identifiés comme faibles. Conserve TOUS les autres segments EXACTEMENT tels quels (même texte, même fonction narrative), ce sont les points forts, ne les abîme pas.

SUJET : ${sujetPourPrompt}
RÉCIT ACTUEL (segments numérotés) :
${recitForReview}
${structureModeleRef ? `\nSCRIPT COMPLET DU MODÈLE DE RÉFÉRENCE RÉELLEMENT SUIVI POUR CE RÉCIT (toute réécriture doit rester CALQUÉE sur SA structure entière, pas seulement sa clôture) :\n"""\n${structureModeleRef}\n"""` : ''}
${contrainteDureeRecit}${(storyFormat === 'court' && wt) ? `\nTes segments réécrits doivent tenir dans le MÊME volume que ceux qu'ils remplacent (13 à 18 mots chacun) : une réécriture qui rallonge le récit le fait sortir de la durée choisie, c'est un échec même si le texte est meilleur.` : ''}

SEGMENTS À RÉÉCRIRE (uniquement ceux-ci) :
${segmentsFaiblesTxt}
${raisonsScrollTxt ? '\nRAISONS DE DÉCROCHAGE À ÉLIMINER :\n' + raisonsScrollTxt : ''}${critique.ia_generique ? '\nATTENTION : récit jugé trop générique. Les segments réécrits doivent avoir une voix beaucoup plus incarnée, jamais neutre.' : ''}${critique.instructions_revision ? '\nINSTRUCTIONS DU CRITIQUE :\n' + critique.instructions_revision : ''}

RÈGLES :
- Ne touche JAMAIS un segment non listé ci-dessus.
- Renvoie la liste COMPLÈTE des segments dans le même ordre, avec le même nombre total et les mêmes valeurs de "segment" (fonction narrative).
- Si le dernier segment (clôture) est réécrit, il DOIT contenir la triple question miroir ("Alors, que retenir de cette histoire ? Que... ? Que... ? Ou que... ?", adaptée au sujet) ET la signature métapoétique ("Moi, je t'ai pas [X]. Je t'ai [Y]."), les deux systématiquement, percutantes et adaptées au sujet.
- Réécris aussi les 5 hooks si le critique a signalé un hook faible, sinon garde-les.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hooks":[{"style":"...","texte":"..."}],"recit":[{"segment":"Hook","texte":"..."}]}`;

          try {
            if (typeof avancerEtapeGen === 'function') avancerEtapeGen(3); // phase : corrections ciblées
            _mesurePassesRecit.revisions++;
            const reviseRaw = await callAI(MODEL_QUALITE_RECIT, 8000, revisePrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
            const revised = parseAIResponse(reviseRaw);
            if (revised && Array.isArray(revised.recit) && revised.recit.length) {
              parsed.recit = revised.recit;
              if (Array.isArray(revised.hooks) && revised.hooks.length) parsed.hooks = revised.hooks;
            } else {
              break; // réponse illisible : on garde la meilleure version obtenue plutôt que de la perdre
            }
          } catch(e) { break; /* si la révision échoue (même après réessais), on garde la version précédente */ }
        }
      } catch(e) { /* si la critique/révision échoue, on garde la meilleure version obtenue */ }
    }

    // ══════════════════════════════════════
    //  CONTRÔLE DU NOMBRE DE HOOKS
    //  "Génère exactement 5 hooks" n'est pas toujours respecté (nature
    //  probabiliste de l'IA) : un récit livré avec 1 seul hook au lieu de 5
    //  est un vrai manque, pas une nuance de qualité. On complète
    //  mécaniquement plutôt que de laisser le créateur avec un seul choix.
    // ══════════════════════════════════════
    if (!Array.isArray(parsed.hooks)) parsed.hooks = [];

    // ══════════════════════════════════════
    //  COMPLÉTION DES HOOKS ET CONTRÔLE DE DURÉE, LANCÉS EN PARALLÈLE
    //  Même correctif que le mode Script (voir js/generation.js) : ces deux
    //  passes ne se touchent jamais. La complétion des hooks ne lit/écrit
    //  QUE parsed.hooks (sujet, hooks déjà là, jamais le corps du récit) ;
    //  le contrôle de durée ne lit/écrit QUE parsed.recit (jamais les
    //  hooks). Chaque fonction ci-dessous est un copier-coller STRICT de
    //  son bloc d'origine (mêmes prompts, mêmes règles, même nombre de
    //  tentatives) : seule leur exécution devient concurrente, via
    //  Promise.all plus bas. Les passes SUIVANTES (normalisation hook/
    //  ouverture, clôture) restent volontairement séquentielles APRÈS ce
    //  Promise.all : elles lisent/réécrivent parsed.recit une fois que sa
    //  version finale de durée est connue, jamais avant (voir leurs
    //  commentaires dédiés plus bas).
    // ══════════════════════════════════════
    async function completerHooksRecit() {
      if (repondreMaintenant || parsed.hooks.length >= 5) return;
      try {
        const hooksExistantsTxt = parsed.hooks.length
          ? parsed.hooks.map((h, i) => (i + 1) + '. [' + (h.style || '') + '] ' + h.texte).join('\n')
          : 'aucun';
        const nbManquants = 5 - parsed.hooks.length;
        const completHooksPrompt = `Tu es le meilleur storyteller narratif francophone de Scriptura. Ce récit a déjà ${parsed.hooks.length} hook(s) sur les 5 exigés. Génère les ${nbManquants} hook(s) manquant(s), dans le même esprit (paradoxal, choquant, dérangeant, fataliste ou intrigant, qui stoppe le scroll), mais RADICALEMENT différents des hooks déjà existants, jamais une reformulation proche.

SUJET : ${sujetPourPrompt}

HOOKS DÉJÀ EXISTANTS (ne les répète JAMAIS, ni ne t'en approche) :
${hooksExistantsTxt}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après, avec EXACTEMENT ${nbManquants} nouveau(x) hook(s) :
{"hooks":[{"style":"Type de hook","texte":"le hook complet"}]}`;
        const completHooksRaw = await callAI(MODEL_RAPIDE, 1200, completHooksPrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
        const completHooks = parseAIResponse(completHooksRaw);
        if (completHooks && Array.isArray(completHooks.hooks) && completHooks.hooks.length) {
          parsed.hooks = parsed.hooks.concat(completHooks.hooks.slice(0, nbManquants));
        }
      } catch (e) { /* on garde les hooks déjà obtenus si la complétion échoue */ }
    }

    // ══════════════════════════════════════
    //  CONTRÔLE QUALITÉ STRICT DE LA DURÉE (comme le mode Script)
    //  La consigne de durée dans le prompt ne suffit pas : on compte les
    //  mots réels du récit livré et on corrige si hors cible, peu importe
    //  la longueur du texte source fourni au départ.
    // ══════════════════════════════════════
    function countStoryWords(recit) {
      if (!recit || !Array.isArray(recit)) return 0;
      return recit.map(s => (s.texte || '')).join(' ').split(/\s+/).filter(Boolean).length;
    }

    // Filet de sécurité déterministe, même principe que le mode Série (voir
    // nettoyerEtiquettesEpisodeSerie, js/serie.js) et que le mode Script :
    // la règle "le champ texte ne contient jamais de minutage" n'était ici
    // aussi qu'une consigne de prompt, que l'IA peut ignorer. Un "[0-3 sec]"
    // ou un "VOIX OFF :" resté dans le texte était compté comme des MOTS
    // (donc faussait le contrôle de durée), lu à voix haute par la synthèse
    // vocale du montage, et copié tel quel par le créateur.
    function nettoyerSegmentsRecit(recit) {
      if (!Array.isArray(recit)) return recit;
      return recit.map(seg => {
        if (!seg || typeof seg.texte !== 'string') return seg;
        const propre = nettoyerEtiquettesEpisodeSerie(seg.texte);
        return propre === seg.texte ? seg : Object.assign({}, seg, { texte: propre });
      });
    }

    async function corrigerDureeRecit() {
      parsed.recit = nettoyerSegmentsRecit(parsed.recit);
      if (!(storyFormat === 'court' && wt)) return;

      let storyWordCount = countStoryWords(parsed.recit);
      let storyCorrectionAttempts = 0;
      const hardMinStory = Math.round(wt.min * 0.9);
      const hardMaxStory = Math.round(wt.max * 1.1);

      // 3 tentatives (comme le mode Script, voir js/generation.js) : une
      // simple erreur réseau/parsing sur une seule tentative ne doit plus
      // faire abandonner tout de suite (voir le catch plus bas), un récit
      // deux fois trop court partait auparavant sans aucun avertissement.
      while ((storyWordCount < hardMinStory || storyWordCount > hardMaxStory) && storyCorrectionAttempts < 3 && !repondreMaintenant) {
        storyCorrectionAttempts++;
        _mesurePassesRecit.corrections_duree = storyCorrectionAttempts;
        const tropCourt = storyWordCount < hardMinStory;
        const correctionPromptStory = `Tu es le Rédacteur en Chef de Scriptura. Le récit suivant ne respecte PAS la durée demandée et doit être corrigé.

RÉCIT ACTUEL (${storyWordCount} mots) :
${(parsed.recit || []).map(s => '[' + (s.segment || '') + '] ' + s.texte).join('\n')}

PROBLÈME : Ce récit fait ${storyWordCount} mots. La cible pour ${storyDuree} est ${wt.min} à ${wt.max} mots.
${tropCourt ? 'Le récit est TROP COURT. Tu dois l\'ALLONGER pour atteindre ' + wt.min + '-' + wt.max + ' mots. Développe l\'immersion et la tension, ajoute des détails concrets, SANS remplissage inutile. Garde le même sujet, le même ton ("' + (parsed.ton || 'celui déjà établi ci-dessus') + '"), la même structure.' : 'Le récit est TROP LONG. Tu dois le RACCOURCIR pour tomber à ' + wt.min + '-' + wt.max + ' mots. Coupe le superflu, condense, garde uniquement l\'essentiel percutant. Garde le hook et la clôture intacts, dans leur structure d\'origine.'}

RÈGLES :
- Le nouveau récit DOIT faire entre ${wt.min} et ${wt.max} mots au total. Compte tes mots avant de répondre.
- Garde le ton "${parsed.ton || 'déjà établi dans le récit ci-dessus'}" strictement, du début à la fin.
- Garde les mêmes segments (même "segment" et même ordre), le hook en premier, et dans le dernier segment garde OU rétablis les deux éléments obligatoires : la triple question miroir ET la signature métapoétique ("Moi, je t'ai pas [X]. Je t'ai [Y]."), intactes et bien présentes, systématiques quelle que soit la longueur.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"recit":[{"segment":"Hook","texte":"..."}]}`;

        let correctedStory = null;
        try {
          if (typeof avancerEtapeGen === 'function') avancerEtapeGen(4); // phase : calibrage de la durée
          const correctRawStory = await callAI(MODEL_CREATIF, 8000, correctionPromptStory, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
          correctedStory = parseAIResponse(correctRawStory);
        } catch(e) { /* échec réseau/parsing sur cette tentative : la boucle retente au tour suivant plutôt que d'abandonner tout de suite */ }

        if (correctedStory && Array.isArray(correctedStory.recit) && correctedStory.recit.length) {
          // Même nettoyage sur la version corrigée : la correction de durée
          // est un nouvel appel IA, donc une nouvelle occasion d'y glisser
          // une étiquette parasite, et son texte sert directement au
          // recomptage juste en dessous.
          parsed.recit = nettoyerSegmentsRecit(correctedStory.recit);
          storyWordCount = countStoryWords(parsed.recit);
        }
        // Correction invalide/vide : on ne casse plus la boucle, le tour
        // suivant retente avec la dernière version connue de parsed.recit.
      }
    }

    // Pas d'avancerEtapeGen(5) ICI, avant le Promise.all : contrairement au
    // mode Script (où hooks manquants + durée partagent UN SEUL step
    // numéroté), le Récit a une numérotation FINE où le step 4 est dédié au
    // "calibrage de la durée" (appelé DANS corrigerDureeRecit ci-dessus, si
    // la boucle de correction tourne réellement) et le step 5 marque la
    // phase SUIVANTE, "hook et ouverture". Appeler avancerEtapeGen(5) avant
    // le Promise.all aurait, par la garde "jamais en arrière" de la
    // fonction, rendu tout avancerEtapeGen(4) ultérieur muet : l'étape
    // "Calibrage de la durée" aurait disparu de l'écran de progression
    // même quand la correction tournait réellement en arrière-plan.
    await Promise.all([completerHooksRecit(), corrigerDureeRecit()]);

    if (typeof avancerEtapeGen === 'function') avancerEtapeGen(5); // phase : hook et ouverture

    // ══════════════════════════════════════
    //  NORMALISATION FINALE DU HOOK ET DE L'OUVERTURE
    //  Volontairement APRÈS le Promise.all ci-dessus (séquentielle, pas
    //  parallélisable avec la correction de durée) : lit/réécrit
    //  parsed.recit une fois sa version finale de durée connue, jamais
    //  avant, sinon la correction de durée pourrait écraser cette
    //  normalisation en réécrivant le récit en entier juste après.
    //  Retour terrain répété : le hook (point 1, EXACTEMENT 2 phrases) se
    //  retrouve fusionné avec l'Ouverture (point 2, "Aujourd'hui, on parle
    //  de...") en un seul bloc de 4 phrases ou plus, l'exemple JSON montrant
    //  bien un segment "Ouverture" séparé (voir plus haut) n'a pas suffi à
    //  le rendre fiable à chaque fois. Contrairement à la clôture (qui
    //  ÉCRASE toujours le dernier segment en place, donc sans risque à
    //  tourner sur un récit déjà correct), cette correction-ci INSÈRE un
    //  nouveau segment : la lancer sur un récit où l'Ouverture est déjà
    //  bien séparée créerait un doublon. D'où une garde simple (la
    //  transition "Aujourd'hui, on parle de..." est-elle déjà présente,
    //  peu importe le libellé exact du segment ?) avant de déclencher la
    //  correction, plutôt que de tourner à chaque fois sans condition.
    //  Placé après le contrôle de durée pour la même raison que la clôture :
    //  ce dernier réécrit le récit en entier et pourrait sinon défaire cette
    //  correction juste après.
    // ══════════════════════════════════════
    function detecteOuverture(texte) {
      return /aujourd['’]?hui,?\s+(?:on|nous)\s+(?:parle|allons parler|va parler)/i.test(texte || '');
    }
    // Même détecteur mécanique de plagiat que la clôture plus bas (déclaré
    // ici, function hoisted, disponible partout dans ce bloc try malgré
    // l'ordre d'apparition dans le fichier).
    function partageDesMotsAvecModeleHook(texte, reference, n) {
      const normaliser = (s) => (s || '').toLowerCase().replace(/[^a-zàâäéèêëïîôöùûüç0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const motsTexte = normaliser(texte);
      const motsRef = normaliser(reference);
      const N = n || 7;
      const refNGrams = new Set();
      for (let i = 0; i <= motsRef.length - N; i++) refNGrams.add(motsRef.slice(i, i + N).join(' '));
      for (let i = 0; i <= motsTexte.length - N; i++) {
        if (refNGrams.has(motsTexte.slice(i, i + N).join(' '))) return true;
      }
      return false;
    }
    if (!repondreMaintenant && Array.isArray(parsed.recit) && parsed.recit.length >= 1) {
      const segHook = parsed.recit[0];
      const segSuivant = parsed.recit[1];
      const modeleHookSeul = structureModeleRef ? (structureModeleRef.split('\n\n')[0] || '') : '';
      const hookPlagie = modeleHookSeul && partageDesMotsAvecModeleHook(segHook.texte, modeleHookSeul, 7);
      // Repère mesuré sur les 15 vrais modèles : moyenne 11-12 mots, jamais
      // plus de 15, pour les deux phrases du hook réunies. Ce garde-fou ne
      // vise PAS ce chiffre au mot près (un hook de 17-18 mots percutant est
      // très bien) : il attrape seulement les dérives franches (20+ mots),
      // où un hook "2 phrases" reste correct en nombre de phrases tout en
      // étant deux fois plus long qu'aucun hook réel et en diluant son impact.
      const compterMotsHook = (t) => ((t || '').trim().match(/\S+/g) || []).length;
      const hookTropLong = compterMotsHook(segHook.texte) > 20;
      // Déjà correct UNIQUEMENT si la transition est dans un AUTRE segment
      // que le hook (vraiment séparée) ET que le hook ne recopie pas le
      // hook du modèle ET qu'il tient dans le plafond de mots réel.
      const dejaCorrect = !detecteOuverture(segHook.texte) && segSuivant && detecteOuverture(segSuivant.texte) && !hookPlagie && !hookTropLong;
      if (!dejaCorrect) try {
        const correctionOuverturePrompt = `Tu es le Réviseur en Chef de Scriptura. Passe finale de fidélité : les deux premiers éléments du récit doivent être un HOOK de EXACTEMENT 2 phrases, assez court et surtout PERCUTANT pour arrêter le scroll (repère : les 15 vrais modèles de Scriptura tournent en moyenne autour de 11-12 mots, rarement au-delà de 15, mais ce n'est pas un plafond rigide, un hook plus long et parfaitement claquant vaut mieux qu'un hook amputé), ENTIÈREMENT NOUVELLES et propres à ce sujet, suivi d'une OUVERTURE séparée qui commence par "Aujourd'hui, on parle de..." (ou une variante fluide comme "Aujourd'hui, on va parler de..."), jamais fusionnés en un seul bloc.

SEGMENT ACTUEL À CORRIGER (peut déjà être correct, contenir le hook ET l'ouverture fusionnés, être un hook trop proche du modèle, ou un hook trop long) :
${segHook.texte}

SEGMENT SUIVANT DANS LE RÉCIT (déjà correct, INCHANGÉ après ta correction, donné seulement pour contexte, ne le duplique pas) :
${segSuivant ? segSuivant.texte : '(aucun)'}
${hookPlagie ? '\n⚠️ ALERTE PLAGIAT : le hook actuel ci-dessus REPREND DES MOTS DU HOOK DU MODÈLE DE RÉFÉRENCE (détecté mécaniquement). C\'est un PLAGIAT, même partiel. Tu DOIS écrire un hook totalement nouveau, avec un vocabulaire et une image différents, qui vise le MÊME EFFET (paradoxe/choc/dissonance) mais jamais les mêmes mots.\n' : ''}${hookTropLong ? `\n⚠️ ALERTE LONGUEUR : le hook actuel fait ${compterMotsHook(segHook.texte)} mots, largement au-dessus de ce qu'aucun vrai modèle Scriptura ne fait (moyenne 11-12, jamais plus de 15), au point de diluer son impact. Réécris-le pour qu'il soit PLUS PERCUTANT, pas juste plus court : coupe le superflu (détails, subordonnées, précisions qui appartiennent à l'ouverture ou au contexte), mais seulement ce qui affaiblit vraiment le punch, jamais au prix de la grammaire.\n` : ''}
RÈGLES :
- "hook" : EXACTEMENT 2 phrases, assez courtes et surtout percutantes pour arrêter le scroll immédiatement (repère 11-15 mots pour les deux réunies, pas un plafond rigide), paradoxales/choquantes/dérangeantes/intrigantes, avec un vocabulaire 100% nouveau (jamais repris du modèle, même partiellement). Si le segment actuel est verbeux ou dilué, condense-le pour plus d'impact, en gardant l'idée qui fait vraiment office de hook.
- "ouverture" : 1 à 3 phrases courtes commençant par "Aujourd'hui, on parle de..." (ou variante fluide), qui posent le personnage ou l'enjeu. Si cette transition existe déjà dans le segment actuel, réutilise-la et ajuste-la légèrement si besoin pour qu'elle tienne seule. Si elle est absente, écris-la, cohérente avec le sujet et le ton du récit.
- Ne perds AUCUNE information factuelle importante du segment actuel : si elle alourdit le hook, glisse-la dans l'ouverture plutôt que de la supprimer.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hook":"...","ouverture":"..."}`;

        const correctionOuvertureRaw = await callAI(MODEL_CREATIF, 1200, correctionOuverturePrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
        const correctionOuverture = parseAIResponse(correctionOuvertureRaw);
        if (correctionOuverture && typeof correctionOuverture.hook === 'string' && correctionOuverture.hook.trim()
            && typeof correctionOuverture.ouverture === 'string' && correctionOuverture.ouverture.trim()) {
          parsed.recit[0] = { segment: segHook.segment || 'Hook', texte: correctionOuverture.hook.trim() };
          parsed.recit.splice(1, 0, { segment: 'Ouverture', texte: correctionOuverture.ouverture.trim() });
        }
      } catch (e) { /* si la correction échoue, on garde le hook/ouverture actuels */ }
    }

    if (typeof avancerEtapeGen === 'function') avancerEtapeGen(6); // phase : anti-plagiat + finition clôture

    // ══════════════════════════════════════
    //  NORMALISATION FINALE DE LA CLÔTURE (systématique, plus détection)
    //  Volontairement APRÈS le contrôle de durée ci-dessus : ce dernier peut
    //  réécrire le récit EN ENTIER (donc aussi la clôture) avec une simple
    //  consigne "garde la même structure", sans redonner le texte exact du
    //  modèle, un filet bien plus faible que celui-ci. Placé avant, ce
    //  contrôle voyait sa correction parfois défaite par la correction de
    //  durée qui suivait juste après, symptôme observé en usage réel.
    //  Cette étape tournait AUPARAVANT seulement si un détecteur (compte de
    //  "?") jugeait la clôture non conforme. Abandonné : sur des vrais
    //  essais, des clôtures avec déjà 3 "?" mais une structure tronquée
    //  (intro fusionnée, 3e branche "Ou que" absente) passaient le
    //  détecteur alors qu'elles n'étaient pas fidèles, ET certains modèles
    //  légitimes clôturent sur une chute non-interrogative (Snowden,
    //  Madoff), rendant un simple seuil de "?" incapable de trancher
    //  fiablement dans les deux sens. Cette passe tourne donc désormais
    //  SYSTÉMATIQUEMENT sur chaque récit, coût négligeable (un appel Haiku
    //  court) pour une fidélité de clôture garantie plutôt que dépendante
    //  d'un détecteur imparfait.
    // ══════════════════════════════════════
    // Détecte un chevauchement de N mots CONSÉCUTIFS entre deux textes :
    // signal fiable de copie (même partielle, même avec un mot ou deux
    // changés autour), contrairement à une comparaison de thème ou de
    // longueur. Utilisé ci-dessous pour vérifier qu'une clôture "déjà
    // conforme structurellement" n'est pas simplement... le texte du modèle
    // recopié (qui, par définition, suit sa propre structure à la perfection).
    function partageDesMotsAvecModele(texte, reference, n) {
      const normaliser = (s) => (s || '').toLowerCase().replace(/[^a-zàâäéèêëïîôöùûüç0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const motsTexte = normaliser(texte);
      const motsRef = normaliser(reference);
      const N = n || 7;
      const refNGrams = new Set();
      for (let i = 0; i <= motsRef.length - N; i++) refNGrams.add(motsRef.slice(i, i + N).join(' '));
      for (let i = 0; i <= motsTexte.length - N; i++) {
        if (refNGrams.has(motsTexte.slice(i, i + N).join(' '))) return true;
      }
      return false;
    }

    if (!repondreMaintenant && structureModeleRef && Array.isArray(parsed.recit) && parsed.recit.length) {
      const clotureModeleSeule = structureModeleRef.split('\n\n').pop() || '';
      const dernierSegment = parsed.recit[parsed.recit.length - 1];
      // Budget de mots donné à la passe de clôture. Cette passe tourne APRÈS
      // le contrôle de durée (à raison, voir le commentaire ci-dessus) et
      // impose une structure lourde (phrase d'intro + 3 questions parallèles
      // + signature métapoétique). Sans budget, elle faisait sortir de la
      // fourchette un récit calibré pile dedans, en silence : sur un récit
      // "30 secondes" (60-78 mots), c'est +50%.
      // Budget MESURÉ sur les 15 modèles de référence, pas choisi à la main :
      // leur clôture pèse 49 mots en moyenne (médiane 50, de 30 à 63) pour
      // 528 mots de récit, soit ~10% du total. D'où : 10% de la cible, avec
      // un plancher à 30 mots (en dessous, la structure imposée ne tient
      // simplement pas) et un plafond à 63 (le maximum jamais atteint par un
      // modèle). Un premier jet de ce budget, non mesuré, autorisait jusqu'à
      // 195 mots sur un récit de 5 minutes, soit trois fois la clôture la
      // plus longue de tous les modèles.
      // wt est null en format LONG (aucune durée choisie, donc aucune cible
      // de mots) : la garde est indispensable ici, pas seulement dans le
      // ternaire plus bas, sinon wt.min plante toute la génération.
      const centreCibleRecit = wt ? (wt.min + wt.max) / 2 : 0;
      const budgetMotsCloture = Math.min(63, Math.max(30, Math.round(centreCibleRecit * 0.10)));
      const budgetCloture = (storyFormat === 'court' && wt)
        ? `\n- BUDGET DE LONGUEUR : le récit entier vise ${wt.min}-${wt.max} mots et fait actuellement ${countStoryWords(parsed.recit)} mots, dont ${((dernierSegment.texte || '').match(/\S+/g) || []).length} pour cette clôture. Ta clôture réécrite doit tenir en ~${budgetMotsCloture} mots au plus, la proportion qu'elle occupe dans les modèles de référence. Tu tiens ce budget en RESSERRANT les phrases (questions plus courtes, plus incisives), JAMAIS en supprimant un élément : les trois questions parallèles ET la signature métapoétique restent toutes présentes, quelle que soit la durée. Si le budget est serré, chaque question devient une question courte, elle ne disparaît pas.`
        : '';

      for (let tentative = 0; tentative < 2; tentative++) {
        try {
          const plagieDejaDetecte = tentative > 0; // 2e passage seulement si la 1re a laissé du plagiat
          const correctionClotureFormPrompt = `Tu es le Réviseur en Chef de Scriptura. Passe finale de fidélité : la clôture du récit doit reproduire EXACTEMENT la structure de la clôture du modèle de référence ci-dessous (même nombre de phrases/questions, même enchaînement), avec un CONTENU ENTIÈREMENT NOUVEAU, propre au sujet du récit.

CLÔTURE ACTUELLE DU RÉCIT :
${dernierSegment.texte}

CLÔTURE EXACTE DU MODÈLE DE RÉFÉRENCE (référence de FORME UNIQUEMENT, même structure phrase par phrase) :
"""
${clotureModeleSeule}
"""
${plagieDejaDetecte ? '\n⚠️ ALERTE : la clôture actuelle ci-dessus REPREND DES MOTS DU MODÈLE (détecté mécaniquement, pas une supposition). C\'est un PLAGIAT, même partiel, même avec quelques mots changés. Tu DOIS la réécrire avec un vocabulaire et des images totalement différents du modèle, en gardant uniquement sa structure.\n' : ''}
RÈGLES :
- Réécris la clôture pour qu'elle suive la structure du modèle ci-dessus PHRASE PAR PHRASE : si le modèle a une phrase d'intro suivie de 3 questions/phrases parallèles, le récit doit avoir exactement ça, ni moins ni plus, aucune phrase fusionnée ou sautée.
- INTERDICTION ABSOLUE de reprendre une phrase du modèle telle quelle ou en changeant juste un ou deux mots (ex. "Que parfois, la tendresse ne sauve rien ?" copié sur "Que parfois, la beauté ne sauve rien ?" est un ÉCHEC). Chaque phrase doit être NOUVELLE, écrite pour CE sujet précis, viser AUSSI BIEN sinon MIEUX que le modèle dans la même mécanique, jamais une simple substitution de mots.
- Garde impérativement la signature métapoétique ("Moi, je t'ai pas [X]. Je t'ai [Y]."), elle est obligatoire dans tous les cas. Place-la comme dans la clôture actuelle (juste avant ou après la structure de clôture).
- Garde le même sujet, le même ton, la même idée centrale, seule la FORME de la clôture s'aligne sur le modèle, jamais son texte.${budgetCloture}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"cloture":"la nouvelle clôture complète corrigée"}`;

          const correctionClotureRaw = await callAI(MODEL_CREATIF, 2000, correctionClotureFormPrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'story');
          const correctionCloture = parseAIResponse(correctionClotureRaw);
          if (correctionCloture && typeof correctionCloture.cloture === 'string' && correctionCloture.cloture.trim()) {
            dernierSegment.texte = correctionCloture.cloture.trim();
          }
        } catch (e) { break; /* si la correction échoue, on garde la clôture actuelle */ }

        if (!partageDesMotsAvecModele(dernierSegment.texte, clotureModeleSeule, 7)) break; // propre, inutile de retenter
      }
    }

    // Avertissement de durée calculé ICI, et pas à la fin du contrôle de
    // durée : les deux passes de normalisation ci-dessus (hook/ouverture, qui
    // INSÈRE un segment, et clôture, qui RÉÉCRIT le dernier) tournent APRÈS ce
    // contrôle et changent donc le nombre de mots final. Calculé plus haut,
    // l'avertissement portait sur un état périmé : il pouvait annoncer une
    // durée correcte pour un récit devenu hors cible, ou l'inverse, pendant
    // que le score, lui, était bien calculé sur le compte final (le créateur
    // voyait alors une rétention pénalisée sans aucune explication). Recompté
    // sur le récit VRAIMENT final, donc cohérent avec le score affiché.
    if (storyFormat === 'court' && wt) {
      const motsFinauxRecit = countStoryWords(parsed.recit);
      const hardMinFinal = Math.round(wt.min * 0.9);
      const hardMaxFinal = Math.round(wt.max * 1.1);
      if (motsFinauxRecit < hardMinFinal || motsFinauxRecit > hardMaxFinal) {
        parsed.avertissementDuree = motsFinauxRecit < hardMinFinal
          ? `Ce récit fait ${motsFinauxRecit} mots, plus court que les ${wt.min}-${wt.max} mots visés pour ${storyDuree}. Tu peux le régénérer pour retenter d'atteindre la durée choisie.`
          : `Ce récit fait ${motsFinauxRecit} mots, plus long que les ${wt.min}-${wt.max} mots visés pour ${storyDuree}. Tu peux le régénérer pour retenter d'atteindre la durée choisie.`;
      } else {
        delete parsed.avertissementDuree;
      }
    }

    // Score déterministe (voir scorerRecitGenere plus haut) : calculé ICI,
    // une fois TOUTES les passes de correction terminées (durée, hook/
    // ouverture, clôture). rythme_soutenu détecté en CODE, les 9 autres
    // signaux viennent d'un 2e appel IA INDÉPENDANT et exigeant une citation
    // vérifiée (voir evaluerRecitGenere) : jamais le même appel qui vient
    // d'écrire le récit qui se note lui-même.
    const texteFinalRecit = (parsed.recit || []).map(s => (s && s.texte) || '').join(' ');
    // Même angle mort que le mode Script (voir le commentaire détaillé dans
    // generate(), js/generation.js) : juge indépendant muet = tous ses signaux
    // absents = crédit neutre de 0,5 partout = un score fabriqué affiché comme
    // une mesure. Une seconde tentative (l'appel le moins cher du pipeline),
    // puis, à défaut, aucun chiffre inventé.
    // ── LE SCORE NE BLOQUE PLUS L'AFFICHAGE DU RÉCIT ──
    // Même décision produit que pour le mode Script (voir le commentaire
    // détaillé dans generate(), js/generation.js) : le juge indépendant est le
    // seul appel qui ne touche pas un mot du récit, il n'a donc aucune raison
    // de faire patienter le créateur. Méthode de calcul rigoureusement
    // inchangée, seulement déplacée après l'affichage.
    parsed.score = null;
    if (repondreMaintenant) {
      parsed.evaluationIndisponible = 'Score non calculé : tu as demandé ton brouillon tout de suite, l\'évaluation indépendante n\'a pas eu le temps de tourner. Le récit, lui, est complet.';
    } else {
      parsed.scoreEnCours = true;
    }

    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen); // met à jour le serveur (empreinte + IP)
      renderGenCounter();
      checkRappelAbonnement();
    }

    lastStoryContext = { sujet: input, plateforme: storyPlatform };
    renderStory(parsed);
    setTimeout(updateScrollBtn, 300);
    // scoreEnCours n'est jamais persisté (drapeau d'affichage) : une
    // réouverture depuis l'historique ne doit pas rester sur un "calcul en
    // cours" que plus rien n'alimente.
    const contenuRecitASauver = Object.assign({}, parsed);
    delete contenuRecitASauver.scoreEnCours;
    const sauvegardeRecit = saveGeneration('story', parsed.titre || input.slice(0, 60), contenuRecitASauver);
    updateQuotaJour();

    // Mesure (aucun appel IA, aucune donnée de contenu) : voir _mesurePassesRecit.
    if (typeof journaliserPassesGeneration === 'function') {
      journaliserPassesGeneration(Object.assign({
        mode: 'story',
        duree_cible: storyFormat === 'court' ? (storyDuree || '') : 'format long',
        mots_final: countStoryWords(parsed.recit),
        dans_cible: !parsed.avertissementDuree
      }, _mesurePassesRecit));
    }

    // Le juge part MAINTENANT, après l'affichage : plus rien ne l'attend.
    if (!repondreMaintenant) {
      calculerScoreRecitEnArrierePlan(parsed, texteFinalRecit, countStoryWords(parsed.recit), wt, sauvegardeRecit);
    }

    // Mémoire du créateur (tâche de fond, silencieuse).
    mettreAJourProfilCreateur({
      declare: { duree_moyenne: storyFormat === 'court' ? storyDuree : 'format long' },
      observe: {
        themes_traites: (parsed.titre || input.slice(0, 80)),
        plateformes: storyPlatform
      }
    });

  } catch(e) {
    errorBox.textContent = 'Erreur : ' + e.message;
    errorBox.style.display = 'block';
    // Bug corrigé (retour terrain, audit du 2 septembre 2026, même correctif
    // que js/generation.js) : lors d'une RÉGÉNÉRATION, #storyResults est
    // déjà masqué en tête de fonction et storyErrorBox (dans storyFormCard,
    // déjà masqué via masquerFormulaireGeneration) est invisible :
    // l'utilisateur se retrouvait devant un écran vide. On réaffiche le
    // récit précédent (encore dans le DOM) et on signale l'échec par un
    // toast (voir toastRegen, js/generation.js), visible quel que soit
    // l'écran affiché.
    const resultsEl = document.getElementById('storyResults');
    if (resultsEl && resultsEl.style.display === 'none' && typeof toastRegen === 'function') {
      resultsEl.style.display = '';
      toastRegen('Erreur pendant la régénération : ' + e.message);
    }
  } finally {
    setStoryLoading(false);
  }
}

// Carte de score du récit en TROIS états, même principe et même gabarit que
// carteScoreScriptHTML (js/generation.js), avec les libellés propres au récit.
// `scoreEnCours` est un drapeau d'AFFICHAGE, jamais persisté.
function carteScoreRecitHTML(d) {
  if (d && d.score) {
    const s = d.score;
    const vals = [s.viral, s.narration, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
    const globalScore = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    return `
      <div class="score-card sb-appear">
        <div class="score-header">
          <div class="score-title">◆ Scriptura Score</div>
          <div class="score-global">
            <span class="score-global-num">${globalScore}</span>
            <span class="score-global-max">/ 100</span>
          </div>
        </div>
        <div class="score-metrics">
          ${metricBar('Potentiel viral', s.viral)}
          ${metricBar('Force narrative', s.narration)}
          ${metricBar('Engagement', s.engagement)}
          ${metricBar('Force émotionnelle', s.emotion)}
          ${metricBar('Rétention estimée', s.retention)}
        </div>
        ${d.avertissementDuree ? `<div class="duree-avertissement">⏱ ${auditEsc(d.avertissementDuree)}</div>` : ''}
      </div>`;
  }
  if (d && d.scoreEnCours) {
    return `
      <div class="score-card sb-appear">
        <div class="score-header">
          <div class="score-title">◆ Scriptura Score</div>
          <div class="score-global"><span class="score-global-max">calcul en cours…</span></div>
        </div>
        <div class="score-metrics">
          ${['Potentiel viral', 'Force narrative', 'Engagement', 'Force émotionnelle', 'Rétention estimée'].map(l => metricBarVide(l)).join('')}
        </div>
        ${d.avertissementDuree ? `<div class="duree-avertissement">⏱ ${auditEsc(d.avertissementDuree)}</div>` : ''}
      </div>`;
  }
  if (d && d.evaluationIndisponible) {
    // Juge indépendant muet : aucune barre, aucun chiffre fabriqué. En
    // revanche l'avertissement de DURÉE reste affiché (même correctif que le
    // mode Script) : il est calculé en code, il ne dépend pas du juge, et
    // c'est justement quand le score manque qu'il devient le seul repère
    // objectif du créateur.
    return `
      <div class="score-card sb-appear">
        <div class="score-header">
          <div class="score-title">◆ Scriptura Score</div>
          <div class="score-global"><span class="score-global-max">non calculé</span></div>
        </div>
        <div class="duree-avertissement">${auditEsc(d.evaluationIndisponible)}</div>
        ${d.avertissementDuree ? `<div class="duree-avertissement">⏱ ${auditEsc(d.avertissementDuree)}</div>` : ''}
      </div>`;
  }
  return '';
}

function renderStory(d) {
  const out = document.getElementById('storyOutput');
  const fullText = (d.recit || []).map(s => s.texte).join('\n\n');
  // Éditeur IA par passage (voir microEditerSegmentRecit plus bas), remis à
  // zéro à chaque nouveau récit affiché, même mécanique que le mode Script
  // (renderResults, js/generation.js).
  _microEditsUtiliseesRecit = 0;

  // Stocker pour storyboard et copie
  currentStory = d;
  currentStoryText = fullText;

  // Réinitialiser le storyboard (bouton + texte visibles, conteneur vide) pour une nouvelle génération
  const sbBtnSt = document.getElementById('storyStoryboardBtn');
  if (sbBtnSt) {
    sbBtnSt.style.display = '';
    const descP = sbBtnSt.previousElementSibling;
    if (descP && descP.tagName === 'P') descP.style.display = '';
  }
  const sbContSt = document.getElementById('storyStoryboardOutput');
  if (sbContSt) sbContSt.innerHTML = '';

  // ── SCRIPTURA SCORE (trois états, voir carteScoreRecitHTML) ──
  const scoreHTML = carteScoreRecitHTML(d);

  // Construire les sections (comme le mode script : accordéon avec +)
  const sections = [];

  // Section, titre + ton + analyse
  sections.push({
    titre: d.titre || 'Ton récit',
    content: `
      <div class="out-section">
        ${d.ton ? `<div class="story-meta"><span class="script-meta-item">🎭 Ton ${auditEsc(d.ton)}</span></div>` : ''}
        ${d.analyse ? `<div class="legende-block" style="margin-top:14px">${auditEsc(d.analyse)}</div>` : ''}
      </div>`
  });

  // Section, 5 hooks
  if (d.hooks && d.hooks.length) {
    sections.push({
      titre: '5 Hooks alternatifs',
      content: `
      <div class="out-section">
        <div class="out-section-label">Accroches · Plusieurs styles</div>
        <div class="hooks-list" id="storyHooksList">${d.hooks.map((h, i) => `
          <div class="hook-item" data-idx="${i}">
            <div class="hook-style">${auditEsc(h.style || ('Hook ' + (i+1)))}</div>
            <div class="hook-text" id="storyHookText${i}">${auditEsc(h.texte || '')}</div>
          </div>`).join('')}</div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, texteHooksStory())">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, texteHooksStory())">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section, récit complet
  sections.push({
    titre: 'Le récit',
    content: `
      <div class="out-section">
        <div class="story-block" id="storyRecitBlock">${(d.recit || []).map((s, i) => `
          <div class="story-segment" data-idx="${i}">
            <div class="story-segment-text" id="storySegText${i}">${auditEsc(s.texte || '').replace(/\n/g, '<br/>')}</div>
            <div class="script-edit-toolbar" id="storySegToolbar${i}">
              <button type="button" class="script-edit-btn" onclick="microEditerSegmentRecit(${i},'reformuler',this)">Reformuler</button>
              <button type="button" class="script-edit-btn" onclick="microEditerSegmentRecit(${i},'raccourcir',this)">Raccourcir</button>
              <button type="button" class="script-edit-btn" onclick="microEditerSegmentRecit(${i},'allonger',this)">Allonger</button>
              <button type="button" class="script-edit-btn" onclick="microEditerSegmentRecit(${i},'simplifier',this)">Simplifier</button>
            </div>
          </div>`).join('')}</div>
        <div class="error-box" id="storyEditError" style="display:none;margin-top:10px"></div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyStory(this)">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareStory(this)">${ICON_SHARE}</button></div>
      </div>`
  });

  // Section, Légende & Hashtags (ensemble)
  if (d.legende || (d.hashtags && d.hashtags.length)) {
    // 5 hashtags max, en minuscules
    const tags = (d.hashtags || []).slice(0, 5).map(t => t.toLowerCase());
    sections.push({
      titre: 'Légende & Hashtags',
      content: `
      <div class="out-section">
        ${d.legende ? `<div class="legende-block">${auditEsc(sansHashtags(d.legende))}</div>` : ''}
        ${tags.length ? `<div class="hashtags-wrap" style="margin-top:14px">${tags.map(t => `<span class="hashtag-chip">${auditEsc(t)}</span>`).join('')}</div>` : ''}
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText(sansHashtags(d.legende || '') + (tags.length ? '\n\n' + tags.join(' ') : ''))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sansHashtags(d.legende || '') + (tags.length ? '\n\n' + tags.join(' ') : ''))}')">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section, Variantes A/B du titre
  if (d.variantes_titre && d.variantes_titre.length) {
    sections.push({
      titre: 'Variantes A/B du titre',
      content: `<div class="out-section">
        <div class="out-section-label">Titres alternatifs à tester</div>
        <div class="hooks-list">${(d.variantes_titre || []).map((t, i) => `
          <div class="hook-item">
            <span class="hook-style">Version ${i === 0 ? 'A' : 'B'}</span>
            ${auditEsc(t)}
          </div>`).join('')}
        </div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText((d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText((d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'))}')">${ICON_SHARE}</button></div>
      </div>`,
      sansBoutonGenerique: true
    });
  }

  // Section, storyboard à la demande
  sections.push({
    titre: 'Storyboard visuel',
    content: `
      <div class="out-section">
        <p style="color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.6;margin-bottom:16px">Génère le découpage visuel plan par plan de ton récit, avec un prompt d'image pour chaque segment.</p>
        ${optionsStoryboardHTML()}
        <button class="btn-storyboard" id="storyStoryboardBtn" onclick="generateStoryStoryboard()">
          <div class="spinner" id="storyboardSpinner2" style="display:none"></div>
          <span id="storyStoryboardText">🎬 Générer le storyboard visuel</span>
        </button>
        <div class="sb-progress-bar" id="sbProgBar2" style="display:none">
          <div class="wait-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 L5 13 H11 L10 22 L19 10 H13 L14 2 Z" fill="none" stroke="#E2C87A" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg></div>
          <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="sbProgFill2"></div></div>
          <div class="sb-progress-bar-pct" id="sbProgPct2">0%</div>
        </div>
        <div id="storyStoryboardOutput"></div>
      </div>`,
    sansBoutonGenerique: true
  });

  // Rendu : score en haut, puis accordéon (1re carte ouverte, clic sur + pour ouvrir)
  out.innerHTML = scoreHTML + sections.map((sec, i) => `
    <div class="out-card sb-appear${i === 0 ? ' open' : ''}" style="animation-delay:${(i + 1) * 0.12}s">
      <div class="out-header" onclick="toggleCard(this.parentElement)">
        <div class="out-title">${auditEsc(sec.titre)}</div>
        <div class="out-toggle">+</div>
      </div>
      <div class="out-body">
        ${sec.content}
      </div>
    </div>`).join('');

  out.dataset.fulltext = fullText;

  // Animer les barres de score
  setTimeout(() => {
    document.querySelectorAll('#storyOutput .metric-fill').forEach(bar => {
      bar.style.width = bar.dataset.width + '%';
    });
  }, 100);

  pushNav();
  masquerFormulaireGeneration('storyFormCard');
  document.getElementById('storyResults').style.display = 'block';
  document.getElementById('storyResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Texte des hooks, calculé en direct (jamais figé au moment du rendu) pour
// que copier/partager reflète toujours la dernière version.
function texteHooksStory() {
  return ((currentStory && currentStory.hooks) || []).map(h => h.texte || '').join('\n\n');
}

// ── Éditeur IA par passage, porté du mode Script (voir microEditerBlocScript,
// js/generation.js) : même logique, adaptée aux segments du récit
// (currentStory.recit au lieu de currentScript). ──
async function microEditerSegmentRecit(idx, action, btn) {
  const consigne = MICRO_EDIT_CONSIGNES[action];
  const texteEl = document.getElementById('storySegText' + idx);
  const errBox = document.getElementById('storyEditError');
  if (!consigne || !texteEl || !currentStory || !currentStory.recit || !currentStory.recit[idx]) return;
  if (errBox) errBox.style.display = 'none';

  if (_microEditsUtiliseesRecit >= MICRO_EDIT_MAX_PAR_SCRIPT) {
    if (errBox) {
      errBox.textContent = "Tu as atteint la limite de retouches pour ce récit (" + MICRO_EDIT_MAX_PAR_SCRIPT + "). Régénère un nouveau récit pour continuer à en retoucher.";
      errBox.style.display = 'block';
    }
    return;
  }

  const toolbar = btn ? btn.closest('.script-edit-toolbar') : null;
  const boutons = toolbar ? Array.from(toolbar.querySelectorAll('.script-edit-btn')) : [];
  boutons.forEach(b => b.disabled = true);
  const labelOriginal = btn ? btn.textContent : '';
  if (btn) btn.textContent = '…';

  try {
    const texteActuel = currentStory.recit[idx].texte || '';
    const prompt = `Tu es un rédacteur TikTok francophone. Voici UN PASSAGE d'un récit déjà écrit (ton : ${currentStory.ton || 'non précisé'}, plateforme : ${state.plateforme || 'TikTok'}).

PASSAGE À MODIFIER :
"${texteActuel}"

CONSIGNE : ${consigne}

Réponds UNIQUEMENT avec le nouveau texte de ce passage, rien avant, rien après : pas de guillemets, pas de JSON, pas de commentaire.`;

    const raw = await callAI(MODEL_RAPIDE, 300, prompt, undefined, false, undefined, 'microEditRecit');
    const nouveauTexte = String(raw || '').trim().replace(/^["«]+|["»]+$/g, '').trim();
    if (!nouveauTexte) throw new Error('Réponse vide');

    currentStory.recit[idx].texte = nouveauTexte;
    texteEl.innerHTML = auditEsc(nouveauTexte).replace(/\n/g, '<br/>');
    // Reconstruit le texte complet (copier/partager, voir copyStory/
    // shareStory, + point de départ du storyboard) : sinon ils renverraient
    // l'ancien texte après une retouche.
    currentStoryText = currentStory.recit.map(s => s.texte || '').join('\n\n');
    const out = document.getElementById('storyOutput');
    if (out) out.dataset.fulltext = currentStoryText;
    _microEditsUtiliseesRecit++;
  } catch (e) {
    if (errBox) {
      errBox.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
      errBox.style.display = 'block';
    }
  } finally {
    boutons.forEach(b => b.disabled = false);
    if (btn) btn.textContent = labelOriginal;
  }
}


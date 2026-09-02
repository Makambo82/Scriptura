// ═══════════════════════════════════════════════════════════
//  MODE « ANALYSER UNE VIDÉO VIRALE » (autonome)
//  L'utilisateur colle le lien d'une vidéo virale (TikTok). Scriptura
//  transcrit sa VOIX (api/video-stt.js, ElevenLabs Scribe), puis DÉCODE toute la
//  recette : hook, techniques de rétention, sujet, structure du début à la
//  fin, et ce qui l'a rendue virale. À la fin : copier la structure, ou
//  créer un script à partir de ça (handoff vers le flux Script).
//
//  C'est une ANALYSE (comme le diagnostic), pas une génération de contenu :
//  l'IA décode, elle n'invente rien. Réutilise le récupérateur de transcript
//  déjà en place et le pipeline de script existant pour le handoff.
// ═══════════════════════════════════════════════════════════

let _viralTranscript = '';   // transcript/texte de la vidéo analysée
let _viralRapport = null;    // dernier rapport affiché (pour les CTA)

function viralEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Ouvre le mode depuis l'accueil / le menu.
function ouvrirAnalyseVirale() {
  if (typeof pushNav === 'function') pushNav();
  masquerTousLesEcrans();
  resetAnalyseVirale();
  document.getElementById('viralFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function resetAnalyseVirale() {
  const lien = document.getElementById('viralAnaLien');
  const txt = document.getElementById('viralAnaTexte');
  if (lien) lien.value = '';
  if (txt) txt.value = '';
  const note = document.getElementById('viralAnaNote');
  if (note) note.textContent = "Colle le lien de partage (TikTok). Pas de lien ? Ouvre le repli et colle le texte de la vidéo.";
  const err = document.getElementById('viralAnaError');
  if (err) err.style.display = 'none';
  const form = document.getElementById('viralAnaForm');
  if (form) form.style.display = '';
  const res = document.getElementById('viralAnaResults');
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
}

// Depuis le résultat, relancer une nouvelle analyse.
function analyserAutreVideoVirale() {
  resetAnalyseVirale();
  const lien = document.getElementById('viralAnaLien');
  if (lien) lien.focus();
}

// Récupère le transcript à partir du lien (best-effort). Renvoie {transcript, description}
// ou null. Transcription par la voix via /api/tiktok-video (ElevenLabs Scribe).
async function _transcriptDepuisLien(url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 30000);
  try {
    const rep = await fetch('/api/tiktok-video?action=transcription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, code_acces: localStorage.getItem('scriptura_code') || null }), signal: ctrl.signal
    });
    const data = await rep.json();
    if (!rep.ok) throw new Error(data?.error?.message || 'Récupération impossible');
    return data;
  } finally { clearTimeout(minuteur); }
}

// Normalise un lien TikTok pour la comparaison (retire la query string et le
// slash final) : suffisant pour détecter le cas courant (même lien recollé
// tel quel), sans dupliquer côté client la résolution complète d'ID vidéo
// déjà faite côté serveur (api/_lib/tiktok-media.js).
function _lienViralNormalise(u) {
  return String(u || '').trim().split('?')[0].replace(/\/+$/, '');
}

// Cherche, parmi les analyses vidéo déjà sauvegardées de l'utilisateur, une
// dont le lien correspond exactement (voir lancerAnalyseVirale). Best-effort :
// ne bloque jamais une nouvelle analyse en cas d'erreur réseau.
async function _analyseViraleExistante(lien) {
  try {
    const cible = _lienViralNormalise(lien);
    if (!cible) return null;
    const params = new URLSearchParams({ resource: 'generations', action: 'last', code: getUserRef(), mode: 'analyseVirale', limit: '30' });
    const r = await fetch('/api/data?' + params.toString());
    const rep = await r.json();
    const rows = (rep && rep.ok && Array.isArray(rep.data)) ? rep.data : [];
    const trouve = rows.find(g => g.contenu && g.contenu.lien && _lienViralNormalise(g.contenu.lien) === cible);
    return (trouve && trouve.contenu && trouve.contenu.rapport) ? trouve.contenu.rapport : null;
  } catch (e) { return null; }
}

async function lancerAnalyseVirale() {
  const err = document.getElementById('viralAnaError');
  const note = document.getElementById('viralAnaNote');
  const btn = document.getElementById('viralAnaBtn');
  const spin = document.getElementById('viralAnaSpinner');
  const btnText = document.getElementById('viralAnaBtnText');
  err.style.display = 'none';

  // Verrou posé ICI, AVANT le premier `await` (bug corrigé, retour terrain,
  // audit du 2 septembre 2026) : auparavant posé juste avant l'appel réseau,
  // un double-clic/double-tap dans cette fenêtre lançait deux analyses
  // concurrentes (deux appels IA facturés). `btn.disabled` sert aussi de
  // garde d'entrée.
  if (btn.disabled) return;
  btn.disabled = true;

  const lien = (document.getElementById('viralAnaLien').value || '').trim();
  let texte = (document.getElementById('viralAnaTexte').value || '').trim();

  if (!lien && !texte) {
    err.textContent = "Colle le lien TikTok d'une vidéo, ou son texte à la main.";
    err.style.display = 'block';
    btn.disabled = false;
    return;
  }

  // Même lien déjà analysé ? Les SIGNAUX (leviers viraux) sont jugés par l'IA
  // à chaque appel, donc pas garantis identiques d'une fois sur l'autre même
  // pour la même vidéo, ce qui ferait varier le score pourtant censé être
  // déterministe (pilier de crédibilité). On réutilise donc l'analyse déjà
  // sauvegardée pour ce lien plutôt que d'en refaire une : même vidéo, même
  // résultat, garanti, et ça évite aussi de reconsommer du quota / un appel IA.
  if (lien) {
    const existante = await _analyseViraleExistante(lien);
    if (existante) {
      btn.disabled = false;
      if (typeof pushNav === 'function') pushNav();
      afficherRapportViral(existante);
      return;
    }
  }

  // Quota DÉDIÉ à l'analyse vidéo (compteur mensuel séparé de la création) :
  // non-abonné 1 (sur ses 5 gratuites), Creator 6/mois, Pro 15/mois. Au-delà,
  // un jeton en débloque une de plus (droit.viaJeton, décompté après succès).
  const droit = await droitAnalyseVirale();
  if (!droit.ok) {
    btn.disabled = false;
    if (droit.raison === 'expire') { gererAbonnementExpire(); return; }
    if (droit.raison === 'quota') {
      err.textContent = 'Tu as atteint ta limite d\'analyses vidéo ce mois-ci (' + droit.limite + '). Elle se recharge le 1er du mois prochain.';
      err.style.display = 'block';
      return;
    }
    // Non-abonné : analyse gratuite déjà utilisée (ou plus de générations
    // gratuites) → on propose l'abonnement.
    openPlans('nouveau');
    return;
  }

  if (spin) spin.style.display = 'block';
  if (btnText) btnText.textContent = 'Analyse en cours…';
  // Animation plein écran (bande dorée hachée + étapes défilantes), la même
  // que récit / script / série : l'utilisateur voit ce que fait l'app en
  // coulisse (récupération, transcription, décodage, score).
  if (typeof startGenAnimation === 'function') startGenAnimation('viral');

  try {
    // 1) Transcript : depuis le lien en priorité, sinon le texte collé.
    let description = '';
    let statsVideo = null; // vraies stats de la vidéo (vues/likes…), pour le score
    let auteurVideo = null; // pseudo/photo/@handle, pour la carte source en tête du rapport
    let createTimeVideo = null; // date de publication, même carte source
    let langueVideo = null; // langue détectée par la transcription (pour la mémoire)
    let framesVideo = []; // frames réparties sur la vidéo (base64 JPEG), pour juger le hook VISUEL et l'EXÉCUTION VISUELLE globale
    if (lien) {
      if (note) note.textContent = 'On écoute la vidéo et on la transcrit ☕…';
      try {
        const data = await _transcriptDepuisLien(lien);
        statsVideo = data.stats || null;
        auteurVideo = data.auteur || null;
        createTimeVideo = data.createTime || null;
        langueVideo = data.langue || null;
        // extraireFramesVisuelles (api/tiktok-video.js) renvoie un tableau de
        // simples chaînes base64, jamais des objets : callAI/js/api.js
        // attend { base64, mediaType } par image pour construire les
        // content blocks envoyés à Claude. Sans cet objet, l'appel échouait
        // à chaque fois avec une erreur API (media_type manquant).
        framesVideo = Array.isArray(data.frames) ? data.frames.map(f => ({ base64: f, mediaType: 'image/jpeg' })) : [];
        if (data.ok && data.transcript) { texte = data.transcript; description = data.description || ''; }
        else if (data.description && !texte) { texte = data.description; }
      } catch (e) {
        if (!texte) {
          // Message affiché volontairement générique et actionnable (un
          // repli existe, coller le texte à la main) : la vraie cause
          // technique (TikHub, ElevenLabs, réseau...) est conservée à part
          // pour la journalisation (voir plus bas), sinon le Tableau de
          // bord ne saurait jamais QUOI a réellement échoué.
          const erreurConviviale = new Error("Impossible de lire cette vidéo. Colle son texte à la main (repli ci-dessous).");
          erreurConviviale.detailTechnique = e.message;
          throw erreurConviviale;
        }
      }
    }
    if (!texte || texte.length < 15) {
      throw new Error("Pas assez de contenu à analyser. Colle le texte de la vidéo à la main.");
    }
    // Garde-fou : ne jamais envoyer du binaire (image/vidéo mal récupérée) à l'IA.
    const nonImpr = (texte.slice(0, 800).match(/[\x00-\x08\x0E-\x1F\uFFFD]/g) || []).length;
    if (nonImpr > 15) {
      throw new Error("Le contenu récupéré n'est pas lisible. Colle le texte de la vidéo à la main (repli ci-dessous).");
    }
    _viralTranscript = texte;

    if (btnText) btnText.textContent = 'Scriptura décode la recette…';
    if (note) note.textContent = 'Scriptura décode la recette virale ☕…';

    // 2) Décodage par l'IA, à partir du CONTENU seul (jamais des vraies stats
    // de la vidéo, qui ne pilotent plus l'angle de l'analyse) : refonte
    // demandée par le propriétaire pour s'aligner sur la méthode réelle de
    // Vervox/BeViral, une critique de la RECETTE (hook, structure, sujet),
    // toujours les DEUX faces (points forts ET leviers à renforcer), jamais
    // conditionnée par un jugement de portée maison. Analyse resserrée (pas
    // de redites) + SIGNAUX booléens qui servent à noter EN CODE + un
    // MODÈLE APPLICABLE (gabarit vierge réutilisable).
    const prompt = `Tu es Scriptura, expert TikTok. On te donne le CONTENU d'une vidéo (transcript de sa VOIX, et éventuellement sa description)${framesVideo.length ? `, ainsi que ${framesVideo.length} IMAGES de la vidéo (jointes, dans l'ordre chronologique : début, milieu, fin)` : ''}. Base-toi UNIQUEMENT sur le contenu fourni, n'invente aucune statistique ni aucun élément absent. Sois PERCUTANT et CONCIS : pas de redites d'une section à l'autre.

Décode objectivement la mécanique de cette vidéo à partir de son SEUL contenu (hook, structure, sujet), comme un monteur/scénariste pro qui juge la recette elle-même, jamais son résultat en vues. Sois rigoureux et honnête : identifie AUSSI BIEN ce qui fonctionne vraiment que ce qui reste faible, sans complaisance ni sévérité gratuite.

${description ? 'DESCRIPTION : ' + description + '\n\n' : ''}TRANSCRIPT DE LA VIDÉO :
${tronquerSansCouperEmoji(texte, 6000)}

Analyse comme un monteur/scénariste pro :
- LA NICHE : en 1 à 3 mots, le thème/domaine de la vidéo (ex. « finance perso », « cuisine rapide », « histoire », « développement perso », « tech »). Sert à ranger la recette dans la bonne famille.
- LE HOOK : la ou les toutes premières phrases réelles, la technique employée, et pourquoi il arrête (ou n'arrête pas) le scroll.
- LA RECETTE, TEMPS PAR TEMPS : reconstitue le déroulé chronologique réel en 4 à 6 TEMPS maximum (chaque temps = un procédé + le ressort d'attention qu'il crée, ou son absence). Ancre chaque temps dans le contenu réel.
- LE MODÈLE APPLICABLE : transforme cette structure en un GABARIT VIERGE réutilisable sur N'IMPORTE QUEL sujet. Chaque étape = un temps + une consigne de remplissage avec des [crochets] (ex. « ouvre par une équation binaire : [ton sujet] voulait X, [autre force] lui a donné Y »). 4 à 6 étapes, concrètes et transposables, jamais liées au sujet précis de la vidéo. Si la recette a de vraies faiblesses, ce gabarit doit déjà intégrer la version corrigée, jamais reproduire le défaut identifié plus haut.
- POURQUOI ÇA FONCTIONNE : 3 à 4 points MAJEURS et déterminants (les plus forts, pas une liste exhaustive).
- COMMENT L'AMÉLIORER : 3 à 4 leviers TRANSPOSABLES, formulés comme des RECETTES réutilisables sur N'IMPORTE QUEL sujet (ex. « ouvre par une équation binaire X/Y », pas « parle de Sarkozy »).
- SIGNAUX : pour chaque levier viral, dis honnêtement si CETTE vidéo l'emploie vraiment (true) ou pas (false). Ils servent à noter la vidéo EN CODE (score déterministe), sois rigoureux et tranché, jamais approximatif :
  • hook_fort : la toute première phrase crée une tension ou une promesse assez forte pour empêcher physiquement de scroller, pas une simple phrase d'intro banale.
  • boucle_ouverte : une question ou une promesse posée tôt reste délibérément SANS réponse immédiate, pour forcer à rester jusqu'à la résolution.
  • cliffhanger : un moment de suspense EXPLICITE est ménagé (souvent avant une révélation), où l'issue reste incertaine jusqu'au dernier instant. Absent si le récit se contente d'avancer sans ce suspense marqué.
  • deuxieme_personne : la vidéo s'adresse DIRECTEMENT et de façon RÉCURRENTE au spectateur (« tu », « toi », « vous »), pas une seule occurrence isolée.
  • details_concrets : des faits précis et vérifiables (dates, chiffres, noms, lieux) ancrent le récit, pas des généralités vagues.
  • escalade : la tension ou les enjeux montent PROGRESSIVEMENT d'une étape à l'autre (chaque temps plus fort que le précédent), pas un récit à intensité constante ou plate.
  • question_rhetorique : une question est posée sans attendre de réponse, pour faire réfléchir ou créer un effet dramatique.
  • archetypes : la vidéo mobilise une figure archétypale reconnaissable (le héros, la victime, le manipulateur…), pas un personnage neutre.
  • appel_action : la vidéo demande EXPLICITEMENT une action au spectateur (s'abonner, commenter, partager, regarder jusqu'au bout, suivre pour la suite…), pas juste un sous-entendu ou une implication vague.
  • angle_original : l'angle choisi pour ce sujet apporte une perspective ou un twist qui se démarque du traitement habituel/attendu de ce sujet, pas la manière la plus évidente de l'aborder.
  • sujet_precis : le sujet est ciblé et net (un angle précis, délimité), pas vague ou trop large au point de pouvoir s'appliquer à n'importe quel contenu.
  • authenticite : le ton sonne vécu, personnel, avec une vraie voix d'auteur, jamais un texte générique, robotique ou interchangeable qui pourrait sortir de n'importe quelle bouche.${framesVideo.length ? `
  • hook_visuel : LA PREMIÈRE IMAGE jointe (tout début de la vidéo) est en elle-même accrocheuse, pas juste le texte, plan cadré et composé pour arrêter le scroll (visage/expression forte, texte à l'écran percutant, scène visuellement intrigante), pas une image plate, floue ou anodine.
  • execution_visuelle : à partir de TOUTES les images jointes (début/milieu/fin), le cadrage est soigné et cohérent d'une image à l'autre, la qualité visuelle reste bonne, rien qui semble amateur, flou, mal éclairé ou visuellement décousu entre les moments de la vidéo.` : ''}

RÈGLE DE FORMAT DES NOMBRES : écris les nombres normalement, jamais de séparateur anglo-saxon. N'emploie jamais de tiret cadratin. Les consignes du modèle sont à l'impératif 2e personne CORRECT (« Ouvre », « Accumule », « Conclus », jamais « Conclues »).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises autour. Structure EXACTE :
{
  "niche": "<thème/domaine en 1 à 3 mots>",
  "sujet": "<le sujet réel de la vidéo + l'angle, 1 phrase>",
  "hook": { "technique": "<nom court de la technique d'accroche>", "verbatim": "<la ou les toutes premières phrases réelles du transcript>", "pourquoi": "<pourquoi ça arrête (ou n'arrête pas) le scroll, 1-2 phrases>" },
  "recette": [ { "temps": "<ex: 0-5s / 5-15s / avant la fin>", "titre": "<nom court du procédé>", "detail": "<ce qui se passe + le ressort d'attention, 1-2 phrases, ancré dans la vidéo>" } ],
  "modele": [ { "temps": "<ex: 0-5s>", "gabarit": "<consigne de remplissage avec des [crochets], transposable>" } ],
  "pourquoi_viral": [ "<point majeur 1>", "<point majeur 2>", "<point majeur 3>" ],
  "a_reprendre": [ { "titre": "<max 8 mots>", "detail": "<recette transposable à TES sujets, 1-2 phrases>" } ],
  "signaux": { "hook_fort": <true/false>, "boucle_ouverte": <true/false>, "cliffhanger": <true/false>, "deuxieme_personne": <true/false>, "details_concrets": <true/false>, "escalade": <true/false>, "question_rhetorique": <true/false>, "archetypes": <true/false>, "appel_action": <true/false>, "angle_original": <true/false>, "sujet_precis": <true/false>, "authenticite": <true/false>${framesVideo.length ? ', "hook_visuel": <true/false>, "execution_visuelle": <true/false>' : ''} }
}`;

    const raw = await callAI(MODEL_CREATIF, 3200, prompt, undefined, false, undefined, 'analyseVirale', framesVideo.length ? framesVideo : undefined);
    const rapport = parseAIResponse(raw);
    if (!rapport || (!rapport.hook && !rapport.recette)) {
      throw new Error("Analyse illisible, réessaie dans un instant.");
    }
    rapport.stats = statsVideo; // vraies stats (affichées en contexte, jamais un jugement)
    rapport.auteur = auteurVideo; // carte source en tête du rapport (retour du propriétaire)
    rapport.description = description;
    rapport.createTime = createTimeVideo;
    rapport.langue = langueVideo;
    rapport.transcript = texte; // ce que Scriptura a vraiment entendu/lu (repli affiché)
    // Mémorisé pour que le score (recalculé à chaque affichage, voir
    // scoreViraliteRecette) sache si "hook_visuel"/"execution_visuelle"
    // étaient mesurables ici, y compris en rouvrant ce rapport plus tard
    // depuis l'historique.
    rapport.frameDisponible = framesVideo.length > 0;
    _viralRapport = rapport;

    // 3) Décompte quota + sauvegarde.
    if (!unlocked) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      const vf = parseInt(localStorage.getItem('scriptura_viral_used') || '0', 10) + 1;
      localStorage.setItem('scriptura_viral_used', String(vf));
      renderGenCounter();
      checkRappelAbonnement();
    }
    // Le jeton (si utilisé pour débloquer cette analyse) est désormais
    // décompté côté SERVEUR par /api/tiktok-video (action=transcription)
    // lui-même (voir api/_lib/acces.js verifierQuota, mode 'analyseVirale'),
    // plus besoin de le refaire ici : ce serait un double décompte.
    const titreCourt = (rapport.sujet || 'vidéo virale').slice(0, 50);
    saveGeneration('analyseVirale', 'Analyse virale · ' + titreCourt, {
      lien: lien || null, transcript: texte, rapport: rapport
    });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    if (typeof pushNav === 'function') pushNav();
    afficherRapportViral(rapport);
    // Mémoire partagée : si la recette est élite (>= 90) ET vraiment performante,
    // on dépose sa version distillée pour nourrir les générations de tous.
    _deposerPatternViral(rapport);

  } catch (e) {
    err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    err.style.display = 'block';
    if (note) note.textContent = "Colle le lien de partage (TikTok). Pas de lien ? Ouvre le repli et colle le texte de la vidéo.";
    // Journalise les pannes techniques (TikHub, ElevenLabs, réseau...) pour
    // le Tableau de bord (voir carteErreursAdmin, js/admin.js), même
    // mécanisme que callAI (js/api.js) : ces dépendances externes n'ont,
    // sans ça, aucune visibilité si elles se dégradent ou tombent.
    const detailsNonTechniques = ['quota atteint', 'accès refusé'];
    if (!detailsNonTechniques.includes(e.message)) {
      try {
        fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resource: 'erreur', mode: 'analyseVirale', code: localStorage.getItem('scriptura_code') || null, detail: (e.detailTechnique || e.message || 'erreur inconnue').slice(0, 200) })
        }).catch(() => {});
      } catch (e2) { /* silencieux */ }
    }
  } finally {
    if (typeof stopGenAnimation === 'function') stopGenAnimation();
    btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (btnText) btnText.textContent = 'Analyser la vidéo';
  }
}

// ── Score de viralité (dimensions pondérées) ──
// DÉTERMINISTE : le CODE calcule tout à partir des leviers réellement présents
// (signaux booléens fournis par l'IA), jamais une note libre de l'IA. Mêmes
// signaux ⇒ même score, c'est un pilier de crédibilité.
//
// Refonte totale (demande du propriétaire) : le score se limite désormais au
// SEUL contenu de la vidéo, plus aucun croisement avec ses vraies stats
// (vues, portée, flop/viral). Répartition calquée sur celle de Vervox
// (25/20/20/15/20 sur 5 dimensions), mais avec le vocabulaire propre à
// Scriptura, pas une traduction de leurs intitulés. Chaque dimension =
// (leviers présents ÷ leviers de la dimension) × son poids ; le global =
// somme des sous-scores.
const SIGNAUX_VIRAL = ['hook_fort', 'boucle_ouverte', 'cliffhanger', 'deuxieme_personne', 'details_concrets', 'escalade', 'question_rhetorique', 'archetypes', 'appel_action', 'angle_original', 'sujet_precis', 'authenticite', 'hook_visuel', 'execution_visuelle'];
// Signaux qui dépendent des IMAGES de la vidéo (voir framesVideo) : non
// mesurables sur un texte collé à la main ou un échec d'extraction de
// frames, jamais absents pour autant (voir scoreViraliteRecette).
const SIGNAUX_VISUELS = ['hook_visuel', 'execution_visuelle'];
const DIMENSIONS_VIRAL = [
  { cle: 'accroche',    label: 'Accroche',      poids: 25, signaux: ['hook_fort', 'question_rhetorique', 'hook_visuel'] },
  { cle: 'sujet_angle', label: 'Sujet & angle', poids: 20, signaux: ['angle_original', 'sujet_precis'] },
  // Structure & rythme : la mécanique narrative qui tient le spectateur (boucle
  // ouverte, cliffhanger, montée en tension) et les figures qui la portent
  // (archétypes reconnaissables).
  { cle: 'structure',   label: 'Structure & rythme', poids: 20, signaux: ['boucle_ouverte', 'cliffhanger', 'escalade', 'archetypes'] },
  // Sincérité : est-ce que ça sonne vécu et concret (texte), et est-ce que
  // l'exécution est soignée d'un bout à l'autre (images début/milieu/fin) ?
  // Texte et image servent ensemble ce même critère d'authenticité globale.
  { cle: 'sincerite',   label: 'Sincérité',      poids: 20, signaux: ['details_concrets', 'authenticite', 'execution_visuelle'] },
  { cle: 'connexion',   label: 'Connexion & CTA', poids: 15, signaux: ['deuxieme_personne', 'appel_action'] }
];
// `frameDisponible` : si aucune frame n'a pu être extraite de la vidéo (échec
// FFmpeg, texte collé à la main sans lien...), les signaux VISUELS sont NON
// MESURABLES, pas absents : ils sont retirés du calcul (dénominateur réduit
// d'autant dans leur dimension), pour qu'un échec technique d'extraction ne
// fasse jamais baisser artificiellement la note d'une bonne recette texte.
//
// Courbe QUADRATIQUE, pas linéaire (retour du propriétaire : le score était
// trop généreux, une vidéo avec la moitié des leviers d'une dimension
// touchait déjà la moitié des points de cette dimension). Avec le carré du
// taux de présence, ne cocher qu'une partie des leviers coûte beaucoup plus
// cher (1/2 des leviers ⇒ 25% des points, pas 50%), seule une dimension
// quasi complète rapporte l'essentiel de son poids. Toujours déterministe
// et borné 0-100, seule la répartition à l'intérieur de chaque dimension
// change.
function scoreViraliteRecette(signaux, frameDisponible) {
  if (!signaux || typeof signaux !== 'object') return null;
  let global = 0;
  const dimensions = DIMENSIONS_VIRAL.map(d => {
    const signauxDim = frameDisponible ? d.signaux : d.signaux.filter(s => !SIGNAUX_VISUELS.includes(s));
    const presents = signauxDim.filter(k => signaux[k] === true).length;
    const taux = presents / signauxDim.length;
    const sousScore = Math.round(taux * taux * d.poids);
    global += sousScore;
    return { cle: d.cle, label: d.label, poids: d.poids, sousScore, presents, total: signauxDim.length };
  });
  const leviers = SIGNAUX_VIRAL.filter(k => signaux[k] === true).length;
  return { score: global, leviers, dimensions };
}
// Taux d'engagement réel (interactions ÷ vues), en %.
function _tauxEngagementViral(s) {
  if (!s || !s.vues) return null;
  const inter = (s.likes || 0) + (s.commentaires || 0) + (s.partages || 0);
  if (!inter) return null;
  return Math.round((inter / s.vues) * 1000) / 10;
}
function _fmtVuesViral(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v >= 1e6) return (Math.round(v / 1e5) / 10).toString().replace('.', ',') + ' M';
  if (v >= 1e3) return Math.round(v / 1e3) + ' K';
  return String(v);
}

// Seuils sur le score PONDÉRÉ (0-100, la somme des dimensions), pas sur un
// simple compte de leviers (13 signaux au total, tous n'ont pas le même poids).
const SEUIL_RECETTE_FORTE = 72;  // recette solide
const SEUIL_MEMOIRE = 85;        // entrée mémoire partagée : recette d'élite

// ── Mémoire partagée : dépôt d'une recette distillée ──
// Étiquettes lisibles des leviers (pour l'injection dans les autres modes).
const LEVIERS_LABEL = {
  hook_fort: 'hook fort', boucle_ouverte: 'boucle ouverte', cliffhanger: 'cliffhanger',
  deuxieme_personne: 'adresse à la 2e personne', details_concrets: 'détails concrets',
  escalade: 'escalade', question_rhetorique: 'question rhétorique', archetypes: 'archétypes',
  appel_action: 'appel à l\'action', angle_original: 'angle original', sujet_precis: 'sujet précis',
  authenticite: 'authenticité', hook_visuel: 'hook visuel', execution_visuelle: 'exécution visuelle'
};
// Best-effort, anonymisé : on n'envoie QUE du distillé (technique de hook,
// leviers, principes transposables, squelette sans verbatim), jamais le
// transcript ni le pseudo. Le serveur RECALCULE le score lui-même à partir
// des signaux bruts (bug corrigé, retour terrain : l'ancien contrat envoyait
// un score déjà calculé ici et le serveur se contentait de le "re-vérifier",
// donc de lui faire confiance, un appel direct à /api/patterns avec un score
// fabriqué pouvait empoisonner la mémoire partagée ; voir calculerScoreRecette,
// api/patterns.js), le score ci-dessous ne sert plus qu'au garde-fou côté
// client (éviter l'appel réseau pour rien sous le seuil). Ne bloque jamais
// l'utilisateur. Le garde-fou ne dépend plus que de la qualité de la recette
// elle-même (plus de vraie performance exigée en plus, ce signal a été
// retiré de l'analyse vidéo).
function _deposerPatternViral(d) {
  try {
    if (!d) return;
    const note = scoreViraliteRecette(d.signaux, d.frameDisponible);
    if (!note || note.score < SEUIL_MEMOIRE) return;       // garde-fou côté client
    const leviers = SIGNAUX_VIRAL.filter(k => d.signaux && d.signaux[k] === true).map(k => LEVIERS_LABEL[k] || k);
    const principes = (Array.isArray(d.a_reprendre) ? d.a_reprendre : [])
      .map(p => ({ titre: (p && p.titre) || '', detail: (p && p.detail) || '' }));
    const squelette = (Array.isArray(d.recette) ? d.recette : [])
      .map(r => ({ temps: (r && r.temps) || '', titre: (r && r.titre) || '' }));  // pas de detail : zéro verbatim
    const corps = {
      niche: d.niche || '', hook_technique: (d.hook && d.hook.technique) || '',
      leviers, principes, squelette,
      signaux: d.signaux || {}, frameDisponible: !!d.frameDisponible,
      langue: d.langue || null
    };
    fetch('/api/patterns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
    }).catch(() => {});   // silencieux : la mémoire ne doit jamais gêner l'utilisateur
  } catch (e) { /* jamais bloquant */ }
}
// Anime l'anneau du score (même mécanique que l'audit / le sommaire).
function animerScoreViral(valeur, circonference, numId, ringId) {
  const numEl = document.getElementById(numId || 'viralScoreNum');
  const ringEl = document.getElementById(ringId || 'viralRingFill');
  if (valeur == null || Number.isNaN(valeur)) { if (numEl) numEl.textContent = '·'; return; }
  const cible = Math.max(0, Math.min(100, valeur));
  const offsetFinal = circonference * (1 - cible / 100);
  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduit) { if (numEl) numEl.textContent = cible; if (ringEl) ringEl.style.strokeDashoffset = offsetFinal; return; }
  if (ringEl) requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offsetFinal; });
  const debut = performance.now();
  (function tick(t) {
    const p = Math.min(1, (t - debut) / 1300);
    if (numEl) numEl.textContent = Math.round(cible * p);
    if (p < 1) requestAnimationFrame(tick);
  })(debut);
}

// Rendu du rapport (nouvelle analyse OU réouverture depuis l'historique).
function afficherRapportViral(d) {
  const res = document.getElementById('viralAnaResults');
  if (!res || !d) return;
  _viralRapport = d;
  const texteRapport = _texteRapportViral(d); // pour les boutons Copier / Partager
  const form = document.getElementById('viralAnaForm');
  if (form) form.style.display = 'none';

  const hook = d.hook || {};
  const recette = Array.isArray(d.recette) ? d.recette : [];
  const facteurs = Array.isArray(d.pourquoi_viral) ? d.pourquoi_viral.filter(Boolean) : [];
  const reprendre = Array.isArray(d.a_reprendre) ? d.a_reprendre : [];
  const modele = Array.isArray(d.modele) ? d.modele.filter(m => m && (m.temps || m.gabarit)) : [];

  // Score de la recette : SEUL score de l'analyse (méthode Vervox/BeViral,
  // voir DIMENSIONS_VIRAL) — jamais croisé avec les vraies stats.
  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;
  const note = scoreViraliteRecette(d.signaux, d.frameDisponible);
  const score = note ? note.score : null;
  const pal = (typeof paletteScoreAudit === 'function') ? paletteScoreAudit(score) : { ringA: '#E2C87A', ringB: '#c9a84c', texte: '#E2C87A' };
  // Carte source en tête du rapport (retour du propriétaire, raisons
  // commerciales et d'attractivité) : même composant que la transcription/
  // le téléchargement TikTok (_outilsCarteSourceHtml, js/tiktok-outils.js),
  // `d` porte déjà exactement les champs attendus (auteur/description/
  // createTime/stats, voir rapport.auteur plus haut). La carte de score, elle,
  // ne garde plus la ligne vues/engagement/abonnés (désormais dans cette
  // carte source, sous forme d'icônes vues/likes/commentaires/partages).
  const _carteSourceInterieur = (typeof _outilsCarteSourceHtml === 'function') ? _outilsCarteSourceHtml(d) : '';
  const carteSourceHtml = _carteSourceInterieur ? `<div class="viral-carte-source">${_carteSourceInterieur}</div>` : '';
  const recetteForteBadge = score != null && score >= SEUIL_RECETTE_FORTE;
  const niveauTxt = note ? `${score >= SEUIL_MEMOIRE ? 'Recette très solide' : recetteForteBadge ? 'Recette solide' : 'Recette perfectible'} · ${note.leviers} leviers viraux` : '';
  const niveauTagClasse = recetteForteBadge ? 'ds-tag-ok' : 'ds-tag';
  // Détail du score : les 5 dimensions pondérées (calculées en code).
  const dims = note && Array.isArray(note.dimensions) ? note.dimensions : [];
  const dimsHtml = dims.length ? `
    <div class="viral-dims">
      ${dims.map(dm => `
        <div class="viral-dim">
          <div class="viral-dim-top"><span>${dm.label}</span><span class="viral-dim-val">${dm.sousScore}/${dm.poids}</span></div>
          <div class="viral-dim-bar"><div class="viral-dim-fill" style="width:${Math.round((dm.sousScore / dm.poids) * 100)}%"></div></div>
        </div>`).join('')}
    </div>` : '';
  const scoreCardHtml = score != null ? `
    <div class="score-card audit-score-card ds-score-card viral-score-card">
      <div class="audit-score-label">SCORE DE LA RECETTE</div>
      <div class="audit-ring-wrap">
        <svg class="audit-ring" viewBox="0 0 170 170">
          <defs><linearGradient id="viralRingGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${pal.ringA}"/><stop offset="100%" stop-color="${pal.ringB}"/></linearGradient></defs>
          <circle class="audit-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="audit-ring-fill" id="viralRingFill" cx="85" cy="85" r="${RING_R}" stroke="url(#viralRingGrad)" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"/>
        </svg>
        <div class="audit-ring-center"><div class="audit-score-num" style="color:${pal.texte}"><span id="viralScoreNum">0</span><span class="audit-score-suffix">/100</span></div></div>
      </div>
      ${niveauTxt ? `<div class="ds-sante-row"><span class="ds-tag ${niveauTagClasse}">${niveauTxt}</span></div>` : ''}
      ${dimsHtml}
    </div>` : '';

  const sujetHtml = d.sujet ? `
    <div class="score-card">
      <div class="audit-section-label">Le sujet & l'angle</div>
      <p class="audit-diag-constat" style="margin-top:16px">${viralEsc(d.sujet)}</p>
    </div>` : '';

  const hookHtml = (hook.technique || hook.verbatim) ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Le hook</div>
        <span class="ds-tag ds-tag-alert">🎯 ${viralEsc(hook.technique || 'Accroche')}</span>
      </div>
      ${hook.verbatim ? `<p class="ds-bio-actuelle">« ${viralEsc(hook.verbatim)} »</p>` : ''}
      ${hook.pourquoi ? `<p class="audit-diag-constat" style="margin-top:8px">${viralEsc(hook.pourquoi)}</p>` : ''}
    </div>` : '';

  const recetteHtml = recette.length ? `
    <div class="score-card">
      <div class="audit-section-label">La recette, temps par temps</div>
      <ul class="viral-list">
        ${recette.map(r => `<li>
          <div class="viral-list-head"><span class="viral-moment">${viralEsc(r.temps || '')}</span><span class="viral-tech">${viralEsc(r.titre || '')}</span></div>
          ${r.detail ? `<p>${viralEsc(r.detail)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </div>` : '';

  // Le MODÈLE APPLICABLE : gabarit vierge à lire et copier. L'action (créer un
  // script) est le seul CTA, en bas du résultat, pour ne pas doublonner.
  // GARDE-FOU : n'a de sens QUE si la recette est vraiment solide (score >=
  // SEUIL_RECETTE_FORTE). Sur un verdict « Peu à reprendre » (recette faible,
  // qu'elle ait floppé ou percé par chance), il n'y a rien de structurel à
  // ériger en modèle, dresser quand même un gabarit contredirait le verdict
  // affiché juste au-dessus.
  const recetteFortePourModele = score != null && score >= SEUIL_RECETTE_FORTE;
  const modeleHtml = (modele.length && recetteFortePourModele) ? `
    <div class="score-card viral-modele">
      <div class="audit-section-label">Le modèle applicable (à remplir)</div>
      <p class="viral-modele-intro">C'est la structure de la vidéo, vidée de son sujet. Remplace les trous entre crochets [ ] par le tien : tu gardes la mécanique qui a marché, tu changes juste le contenu. Le bouton « Créer un script » en bas le fait pour toi.</p>
      <ol class="viral-modele-list">
        ${modele.map(m => `<li>
          <span class="viral-moment">${viralEsc(m.temps || '')}</span>
          <p>${viralEsc(m.gabarit || '')}</p>
        </li>`).join('')}
      </ol>
    </div>` : '';

  const facteursHtml = facteurs.length ? `
    <div class="score-card ds-evolution pivot">
      <div class="audit-section-label">Pourquoi ça fonctionne</div>
      <ul class="ds-niche-analyse">${facteurs.map(f => `<li>${viralEsc(f)}</li>`).join('')}</ul>
    </div>` : '';

  const reprendreHtml = reprendre.length ? `
    <div class="score-card">
      <div class="audit-section-label">Comment l'améliorer</div>
      <ol class="ds-leviers-list">
        ${reprendre.map(l => `<li><b>${viralEsc(l.titre || '')}</b><p>${viralEsc(l.detail || '')}</p></li>`).join('')}
      </ol>
    </div>` : '';

  // Transcription complète (ce que Scriptura a vraiment entendu/lu) : repliée
  // par défaut, en annexe technique après l'analyse, pas devant. Sert à
  // vérifier la source si un constat surprend, sans encombrer l'écran.
  const transcriptHtml = d.transcript ? `
    <div class="score-card viral-transcript-card">
      <details class="viral-video-details">
        <summary class="viral-video-summary">📝 Voir la transcription complète</summary>
        <p class="viral-transcript-texte">${viralEsc(d.transcript)}</p>
      </details>
    </div>` : '';

  const ctaTexte = 'Tu as la recette. Passe à l\'action : Scriptura peut <strong>t\'écrire un script</strong> qui réutilise cette structure sur TON sujet.';

  res.innerHTML = `
    ${carteSourceHtml}
    ${scoreCardHtml}
    ${sujetHtml}
    ${hookHtml}
    ${recetteHtml}
    ${modeleHtml}
    ${facteursHtml}
    ${reprendreHtml}
    ${transcriptHtml}

    <div class="sb-actions-fin">
      <button class="icon-btn" title="Copier l'analyse" onclick="copyText(this, '${storeCopyText(texteRapport)}')">${ICON_COPY}</button>
      <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(texteRapport)}')">${ICON_SHARE}</button>
    </div>

    <div class="ds-alt" style="margin-top:8px">
      <p style="margin:0 0 14px">${ctaTexte}</p>
      <button class="btn-generate" onclick="creerScriptDepuisViral()">Créer un script à partir de ça →</button>
    </div>
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="analyserAutreVideoVirale()">Analyser une autre vidéo</button>`;

  res.style.display = 'block';
  if (score != null) setTimeout(() => animerScoreViral(score, RING_C), 50);
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Construit le rapport en texte lisible (pour les boutons Copier / Partager,
// mêmes icônes que les autres modes, voir afficherRapportViral).
function _texteRapportViral(d) {
  d = d || {};
  const lignes = [];
  const note = scoreViraliteRecette(d.signaux, d.frameDisponible);
  if (note) {
    let entete = 'SCORE DE LA RECETTE : ' + note.score + '/100 (' + note.leviers + ' leviers viraux)';
    lignes.push(entete);
    if (Array.isArray(note.dimensions) && note.dimensions.length) {
      lignes.push('Détail : ' + note.dimensions.map(dm => dm.label + ' ' + dm.sousScore + '/' + dm.poids).join(' · '));
    }
    if (d.stats && d.stats.vues) {
      const taux = _tauxEngagementViral(d.stats);
      let ligneStats = '\n' + _fmtVuesViral(d.stats.vues) + ' vues' + (taux != null ? ' · ' + String(taux).replace('.', ',') + "% d'engagement" : '');
      if (d.stats.abonnesAuteur) ligneStats += ' · ' + _fmtVuesViral(d.stats.abonnesAuteur) + ' abonnés';
      lignes.push(ligneStats);
    }
  }
  if (d.sujet) lignes.push('\nSUJET : ' + d.sujet);
  if (d.hook) lignes.push('\nHOOK (' + (d.hook.technique || '') + ') : ' + (d.hook.verbatim || '') + '\n' + (d.hook.pourquoi || ''));
  if (Array.isArray(d.recette) && d.recette.length) {
    lignes.push('\nLA RECETTE, TEMPS PAR TEMPS :');
    d.recette.forEach(r => lignes.push('- [' + (r.temps || '') + '] ' + (r.titre || '') + (r.detail ? ' : ' + r.detail : '')));
  }
  // Même garde-fou que l'affichage : pas de modèle dans le texte copié si la
  // recette est trop faible pour justifier un gabarit réutilisable.
  if (Array.isArray(d.modele) && d.modele.length && note && note.score >= SEUIL_RECETTE_FORTE) {
    lignes.push('\nLE MODÈLE APPLICABLE (à remplir) :');
    d.modele.forEach(m => lignes.push('- [' + (m.temps || '') + '] ' + (m.gabarit || '')));
  }
  if (Array.isArray(d.pourquoi_viral) && d.pourquoi_viral.length) {
    lignes.push('\nPOURQUOI ÇA FONCTIONNE :');
    d.pourquoi_viral.forEach(f => lignes.push('- ' + f));
  }
  if (Array.isArray(d.a_reprendre) && d.a_reprendre.length) {
    lignes.push('\nCOMMENT L\'AMÉLIORER :');
    d.a_reprendre.forEach(l => lignes.push('- ' + (l.titre || '') + ' : ' + (l.detail || '')));
  }
  return lignes.join('\n');
}

// Reconstruit le modèle applicable en texte (pour l'injecter dans le flux Script).
function _modeleEnTexte(d) {
  const modele = d && Array.isArray(d.modele) ? d.modele : [];
  if (!modele.length) return '';
  const etapes = modele.map(m => '[' + (m.temps || '') + '] ' + (m.gabarit || '')).join('\n');
  return 'MODÈLE DE STRUCTURE VIRALE À SUIVRE (remplis chaque crochet avec MON sujet, garde la mécanique) :\n' + etapes;
}

// Handoff vers le flux Script. Deux entrées :
//  - source 'modele'  : on passe le GABARIT vierge (structure à appliquer).
//  - source par défaut : on passe le transcript complet (recréer la recette).
// Dans tous les cas on dépose l'utilisateur sur le formulaire (étape 3) où il
// n'a plus qu'à indiquer SON sujet.
function creerScriptDepuisViral(source) {
  if (typeof chooseMode !== 'function') return;
  const d = _viralRapport || {};
  chooseMode('script'); // ouvre le flux Script (empile l'écran actuel)
  if (typeof state === 'object' && state) {
    state.depart = 'analyser une vidéo virale et recréer sa recette';
    if (!state.objectif) state.objectif = 'Faire plus de vues et maximiser la portée';
    if (!state.plateforme) state.plateforme = 'TikTok';
  }
  if (typeof showStep === 'function') showStep(3);
  if (typeof renderSummary === 'function') renderSummary(); // affiche le champ vidéo virale
  const champ = document.getElementById('viralVideo');
  if (champ) {
    // Modèle : on injecte le gabarit vierge. Sinon : le transcript réel.
    const contenu = source === 'modele' ? (_modeleEnTexte(d) || _viralTranscript || '') : (_viralTranscript || '');
    champ.value = contenu;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const sujet = document.getElementById('sujet');
  if (sujet) setTimeout(() => sujet.focus(), 200);
}

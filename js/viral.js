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

  const lien = (document.getElementById('viralAnaLien').value || '').trim();
  let texte = (document.getElementById('viralAnaTexte').value || '').trim();

  if (!lien && !texte) {
    err.textContent = "Colle le lien TikTok d'une vidéo, ou son texte à la main.";
    err.style.display = 'block';
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

  btn.disabled = true;
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
    let langueVideo = null; // langue détectée par la transcription (pour la mémoire)
    let frameHook = null; // 1re frame de la vidéo (base64 JPEG), pour juger le hook VISUEL
    if (lien) {
      if (note) note.textContent = 'On écoute la vidéo et on la transcrit ☕…';
      try {
        const data = await _transcriptDepuisLien(lien);
        statsVideo = data.stats || null;
        langueVideo = data.langue || null;
        frameHook = data.frame_hook || null;
        if (data.ok && data.transcript) { texte = data.transcript; description = data.description || ''; }
        else if (data.description && !texte) { texte = data.description; }
      } catch (e) {
        if (!texte) throw new Error("Impossible de lire cette vidéo. Colle son texte à la main (repli ci-dessous).");
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

    // 2) Décodage par l'IA. La POSTURE (virale / flop / neutre), déduite EN CODE
    // des vraies stats, change l'analyse : décoder une recette gagnante, ou
    // diagnostiquer un échec et prescrire la correction. Analyse resserrée
    // (pas de redites) + SIGNAUX booléens qui servent à noter EN CODE + un
    // MODÈLE APPLICABLE (gabarit vierge réutilisable).
    const posture = posturePerf(statsVideo);
    const directivePosture = posture === 'flop'
      ? `POSTURE, DIAGNOSTIC D'ÉCHEC : d'après ses vraies statistiques, cette vidéo a SOUS-PERFORMÉ (elle n'a même pas atteint l'audience de son compte). Ton rôle n'est PAS de la vanter. Diagnostique honnêtement POURQUOI elle n'a pas marché (hook faible ou lent, promesse floue, structure molle, rythme plat, absence de tension, leviers manquants), puis prescris les CORRECTIONS concrètes pour la transformer en vidéo virale. Sois direct mais utile, jamais complaisant.`
      : posture === 'virale'
        ? `POSTURE, RECETTE GAGNANTE : d'après ses vraies statistiques, cette vidéo a RÉELLEMENT percé (elle a dépassé l'audience de son compte). Décode la recette qui explique ce succès et ce qui la rend REPRODUCTIBLE sur d'autres sujets.`
        : `POSTURE, DÉCODAGE : décode objectivement la mécanique de cette vidéo, ce qui fonctionne et ce qui pourrait être renforcé.`;
    const lbl = _labelsPosture(posture);
    const prompt = `Tu es Scriptura, expert TikTok. On te donne le CONTENU d'une vidéo (transcript de sa VOIX, et éventuellement sa description)${frameHook ? ', ainsi que la toute PREMIÈRE IMAGE de la vidéo (jointe)' : ''}. Base-toi UNIQUEMENT sur le contenu fourni, n'invente aucune statistique ni aucun élément absent. Sois PERCUTANT et CONCIS : pas de redites d'une section à l'autre.

${directivePosture}

${description ? 'DESCRIPTION : ' + description + '\n\n' : ''}TRANSCRIPT DE LA VIDÉO :
${tronquerSansCouperEmoji(texte, 6000)}

Analyse comme un monteur/scénariste pro :
- LA NICHE : en 1 à 3 mots, le thème/domaine de la vidéo (ex. « finance perso », « cuisine rapide », « histoire », « développement perso », « tech »). Sert à ranger la recette dans la bonne famille.
- LE HOOK : la ou les toutes premières phrases réelles, la technique employée, et ${posture === 'flop' ? 'pourquoi il ne suffit pas à arrêter le scroll' : 'pourquoi il arrête le scroll'}.
- LA RECETTE, TEMPS PAR TEMPS : reconstitue le déroulé chronologique réel en 4 à 6 TEMPS maximum (chaque temps = un procédé + le ressort d'attention qu'il crée, ou son absence). Ancre chaque temps dans le contenu réel.
- LE MODÈLE APPLICABLE : transforme cette structure${posture === 'flop' ? ' CORRIGÉE' : ''} en un GABARIT VIERGE réutilisable sur N'IMPORTE QUEL sujet. Chaque étape = un temps + une consigne de remplissage avec des [crochets]${posture === 'flop'
      ? `, et ce modèle DOIT intégrer les CORRECTIONS que tu donnes juste au-dessus dans ${lbl.leviers.toUpperCase()}, jamais reproduire le défaut d'origine (ex. si tu recommandes d'ouvrir sur un fait daté plutôt qu'un paradoxe abstrait, la 1re étape du modèle doit être « ouvre par un fait daté et précis : [élément], [date/chiffre], [ce qui a changé] », PAS « ouvre par une équation binaire/un paradoxe »). Relis ton propre modèle avant de répondre : s'il reproduit encore le problème que tu viens de diagnostiquer, corrige-le`
      : ' (ex. « ouvre par une équation binaire : [ton sujet] voulait X, [autre force] lui a donné Y »)'}. 4 à 6 étapes, concrètes et transposables, jamais liées au sujet précis de la vidéo.
- ${lbl.pourquoi.toUpperCase()} : 3 à 4 points MAJEURS et déterminants seulement (les plus forts, pas une liste exhaustive).
- ${lbl.leviers.toUpperCase()} : 3 à 4 leviers TRANSPOSABLES, formulés comme des RECETTES réutilisables sur N'IMPORTE QUEL sujet (ex. « ouvre par une équation binaire X/Y », pas « parle de Sarkozy »).
- SIGNAUX : pour chaque levier viral, dis honnêtement si CETTE vidéo l'emploie vraiment (true) ou pas (false). Ils servent à noter la vidéo EN CODE (score déterministe), sois rigoureux et tranché, jamais approximatif (une vidéo qui a raté a peu de signaux à true) :
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
  • sujet_precis : le sujet est ciblé et net (un angle précis, délimité), pas vague ou trop large au point de pouvoir s'appliquer à n'importe quel contenu.${frameHook ? `
  • hook_visuel : L'IMAGE JOINTE (1re frame de la vidéo) est en elle-même accrocheuse, pas juste le texte, plan cadré et composé pour arrêter le scroll (visage/expression forte, texte à l'écran percutant, scène visuellement intrigante), pas une image plate, floue ou anodine.` : ''}

RÈGLE DE FORMAT DES NOMBRES : écris les nombres normalement, jamais de séparateur anglo-saxon. N'emploie jamais de tiret cadratin. Les consignes du modèle sont à l'impératif 2e personne CORRECT (« Ouvre », « Accumule », « Conclus », jamais « Conclues »).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises autour. Structure EXACTE :
{
  "niche": "<thème/domaine en 1 à 3 mots>",
  "sujet": "<le sujet réel de la vidéo + l'angle, 1 phrase>",
  "hook": { "technique": "<nom court de la technique d'accroche>", "verbatim": "<la ou les toutes premières phrases réelles du transcript>", "pourquoi": "<${posture === 'flop' ? 'pourquoi ce hook ne suffit pas' : 'pourquoi ça arrête le scroll'}, 1-2 phrases>" },
  "recette": [ { "temps": "<ex: 0-5s / 5-15s / avant la fin>", "titre": "<nom court du procédé>", "detail": "<ce qui se passe + le ressort d'attention, 1-2 phrases, ancré dans la vidéo>" } ],
  "modele": [ { "temps": "<ex: 0-5s>", "gabarit": "<consigne de remplissage avec des [crochets], transposable>" } ],
  "pourquoi_viral": [ "<point majeur 1>", "<point majeur 2>", "<point majeur 3>" ],
  "a_reprendre": [ { "titre": "<max 8 mots>", "detail": "<${posture === 'flop' ? 'correction concrète à appliquer' : 'recette transposable à TES sujets'}, 1-2 phrases>" } ],
  "signaux": { "hook_fort": <true/false>, "boucle_ouverte": <true/false>, "cliffhanger": <true/false>, "deuxieme_personne": <true/false>, "details_concrets": <true/false>, "escalade": <true/false>, "question_rhetorique": <true/false>, "archetypes": <true/false>, "appel_action": <true/false>, "angle_original": <true/false>, "sujet_precis": <true/false>${frameHook ? ', "hook_visuel": <true/false>' : ''} }
}`;

    const raw = await callAI(MODEL_CREATIF, 3200, prompt, undefined, false, undefined, 'analyseVirale', frameHook || undefined);
    const rapport = parseAIResponse(raw);
    if (!rapport || (!rapport.hook && !rapport.recette)) {
      throw new Error("Analyse illisible, réessaie dans un instant.");
    }
    rapport.stats = statsVideo; // vraies stats (pour le score + le contexte)
    rapport.langue = langueVideo;
    rapport.posture = posture;  // virale / flop / neutre (déjà calculée avant l'IA)
    rapport.transcript = texte; // ce que Scriptura a vraiment entendu/lu (repli affiché)
    // Mémorisé pour que le score (recalculé à chaque affichage, voir
    // scoreViraliteRecette) sache si "hook_visuel" était mesurable ici, y
    // compris en rouvrant ce rapport plus tard depuis l'historique.
    rapport.frameDisponible = !!frameHook;
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
// Le score global est découpé en 4 DIMENSIONS PONDÉRÉES (poids = 100 au total),
// pour montrer OÙ la vidéo est forte ou faible, pas juste un nombre opaque.
// Chaque dimension = (leviers présents ÷ leviers de la dimension) × son poids ;
// le global = somme des sous-scores.
const SIGNAUX_VIRAL = ['hook_fort', 'boucle_ouverte', 'cliffhanger', 'deuxieme_personne', 'details_concrets', 'escalade', 'question_rhetorique', 'archetypes', 'appel_action', 'angle_original', 'sujet_precis', 'hook_visuel'];
// Poids rééquilibrés à l'ajout de « Sujet & angle » (inspiré de Vervox, qui le
// pondère à 20/100) pour garder un total de 100 : Accroche et Rétention
// cèdent chacune 5 points, Ancrage 5 points, au profit de la nouvelle
// dimension. Connexion & CTA reste à 15, aligné sur le « CTA & engagement »
// de Vervox. « hook_visuel » (1re frame de la vidéo) rejoint Accroche, dans
// le même esprit que le « Hook & attention » unique de Vervox (verbal +
// visuel + audio, un seul critère), poids INCHANGÉ (voir scoreViraliteRecette
// pour la gestion du cas où aucune frame n'a pu être extraite).
const DIMENSIONS_VIRAL = [
  { cle: 'accroche',    label: 'Accroche',      poids: 25, signaux: ['hook_fort', 'question_rhetorique', 'hook_visuel'] },
  // Sujet & angle : jusqu'ici seulement décrit (d.sujet), jamais noté. Un
  // sujet traité de façon générique/attendue n'aide pas la vidéo à se
  // démarquer, même avec un bon hook et une bonne structure.
  { cle: 'sujet_angle', label: 'Sujet & angle', poids: 15, signaux: ['angle_original', 'sujet_precis'] },
  { cle: 'retention',   label: 'Rétention',     poids: 25, signaux: ['boucle_ouverte', 'cliffhanger', 'escalade'] },
  { cle: 'ancrage',     label: 'Ancrage',       poids: 20, signaux: ['details_concrets', 'archetypes'] },
  // Connexion & CTA : le levier « appel à l'action » est ajouté ici plutôt que
  // dans une dimension à part, il mesure la même chose que « deuxieme_personne »
  // (l'engagement direct du spectateur), comme le fait Vervox avec son critère
  // unique « CTA & engagement » (15/100).
  { cle: 'connexion',   label: 'Connexion & CTA', poids: 15, signaux: ['deuxieme_personne', 'appel_action'] }
];
// `frameDisponible` : si aucune frame n'a pu être extraite de la vidéo (échec
// FFmpeg, texte collé à la main sans lien...), « hook_visuel » est NON
// MESURABLE, pas absent : il est retiré du calcul (dénominateur de la
// dimension Accroche réduit à 2), pour qu'un échec technique d'extraction ne
// fasse jamais baisser artificiellement la note d'un bon hook texte.
function scoreViraliteRecette(signaux, frameDisponible) {
  if (!signaux || typeof signaux !== 'object') return null;
  let global = 0;
  const dimensions = DIMENSIONS_VIRAL.map(d => {
    const signauxDim = (d.cle === 'accroche' && !frameDisponible)
      ? d.signaux.filter(s => s !== 'hook_visuel')
      : d.signaux;
    const presents = signauxDim.filter(k => signaux[k] === true).length;
    const sousScore = Math.round((presents / signauxDim.length) * d.poids);
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

// ── Portée : le vrai signal de viralité ──
// vues ÷ abonnés de l'auteur. Une vidéo est virale quand l'algo la pousse
// BIEN AU-DELÀ de l'audience du compte, pas juste quand le compteur est gros.
function porteeViral(stats) {
  if (!stats || !stats.vues || !stats.abonnesAuteur || stats.abonnesAuteur <= 0) return null;
  const ratio = stats.vues / stats.abonnesAuteur;
  let niveau, label;
  if (ratio >= 10) { niveau = 4; label = 'Explosion'; }
  else if (ratio >= 5) { niveau = 3; label = 'Forte portée'; }
  else if (ratio >= 2) { niveau = 2; label = 'Bonne portée'; }
  else { niveau = 1; label = 'Dans son audience'; }
  // Ratio lisible : « ×12 » ou « ×3,4 ». Sous 0,1, l'arrondi normal donnerait
  // « ×0 », qui ressemble à une erreur d'affichage plutôt qu'à une vraie mesure
  // (le calcul est juste, un ratio proche de zéro reste une donnée réelle) :
  // on affiche alors « < ×0,1 » pour rester lisible sans jamais dire « zéro ».
  const affiche = ratio >= 10
    ? '×' + Math.round(ratio)
    : ratio < 0.1
      ? '< ×0,1'
      : '×' + (Math.round(ratio * 10) / 10).toString().replace('.', ',');
  return { ratio, niveau, label, affiche };
}
// Niveau d'engagement (interactions ÷ vues) : moyenne TikTok ~5-6%.
function niveauEngagementViral(taux) {
  if (taux == null) return null;
  if (taux >= 10) return { niveau: 4, label: 'Engagement exceptionnel' };
  if (taux >= 6) return { niveau: 3, label: 'Engagement fort' };
  if (taux >= 3) return { niveau: 2, label: 'Engagement normal' };
  return { niveau: 1, label: 'Engagement faible' };
}

// ── Double lecture : Recette × Performance ──
// La recette (structure) peut être forte alors que les vues sont un coup de
// chance, et inversement. On croise les deux axes pour un verdict honnête.
// Seuils sur le score PONDÉRÉ (0-100, la somme des 4 dimensions), pas sur un
// simple compte de leviers (11 signaux au total, tous n'ont pas le même poids).
const SEUIL_RECETTE_FORTE = 72;  // recette solide
const SEUIL_MEMOIRE = 85;        // entrée mémoire partagée : recette d'élite
// La performance est « réelle » quand la portée est forte (l'algo a poussé au
// delà de l'audience) ou, à défaut de connaître les abonnés, quand
// l'engagement est exceptionnel.
function performanceForte(stats) {
  const p = porteeViral(stats);
  if (p) return p.niveau >= 3;
  const taux = _tauxEngagementViral(stats);
  return taux != null && taux >= 10;
}
// Le verdict croisé, avec un titre + une explication.
// RÈGLE DE CRÉDIBILITÉ : on n'affirme JAMAIS un jugement de PORTÉE (« bridée »,
// « coup de chance ») sans connaître les abonnés de l'auteur. La portée = vues
// ÷ abonnés ; sans les abonnés, on ne peut pas dire si la vidéo a percé ou non,
// donc on s'en tient à la recette et on ne prétend rien sur l'algo.
function verdictCroiseViral(score, stats) {
  const recetteForte = score != null && score >= SEUIL_RECETTE_FORTE;
  const perfConnue = !!(stats && stats.vues);
  if (!perfConnue) {
    return recetteForte
      ? { ton: 'ok', titre: 'Recette solide', texte: 'La structure est forte. Les stats réelles manquaient, mais la recette est réutilisable telle quelle.' }
      : { ton: 'neutre', titre: 'Recette moyenne', texte: 'La structure reste perfectible. À reprendre en renforçant les leviers manquants.' };
  }
  const porteeConnue = !!(stats && stats.abonnesAuteur);
  const taux = _tauxEngagementViral(stats);
  const engagementExceptionnel = taux != null && taux >= 10;
  const engagementFaible = taux != null && taux < 3;
  // On ne peut trancher sur la performance QUE si on connaît la portée, ou si
  // l'engagement est si tranché (très haut / très bas) qu'il parle de lui-même.
  const perfJugeable = porteeConnue || engagementExceptionnel || engagementFaible;

  if (!perfJugeable) {
    // Vues connues mais portée non mesurable (pas d'abonnés, engagement moyen) :
    // aucune affirmation sur l'algo, verdict centré sur la recette.
    return recetteForte
      ? { ton: 'ok', titre: 'Recette très solide', texte: 'La structure est excellente et réutilisable. Sans le nombre d\'abonnés de l\'auteur, on ne peut pas mesurer la portée réelle, mais la recette, elle, tient.' }
      : { ton: 'neutre', titre: 'Recette perfectible', texte: 'La structure gagnerait à être renforcée. Portée réelle non mesurable ici (abonnés de l\'auteur inconnus).' };
  }

  const perfForte = porteeConnue ? (porteeViral(stats).niveau >= 3) : engagementExceptionnel;
  if (recetteForte && perfForte) return { ton: 'ok', titre: 'Formule reproductible', texte: 'La structure explique le succès. Tu peux la copier, elle marche par construction, pas par chance.' };
  if (recetteForte && !perfForte) return { ton: 'neutre', titre: 'Bonne structure, portée bridée', texte: 'La recette est solide mais le sujet, le timing ou la niche ont limité la portée. Réutilisable sur un meilleur angle.' };
  if (!recetteForte && perfForte) return { ton: 'alerte', titre: 'Probable coup de chance', texte: 'Grosses vues, mais la structure ne les explique pas vraiment (tendance, sujet d\'actu, coup de bol). Reproduis avec prudence.' };
  return { ton: 'neutre', titre: 'Peu à reprendre', texte: 'Ni recette solide ni performance marquante. Il y a mieux à décoder ailleurs.' };
}

// ── Posture d'analyse : virale, flop ou neutre ──
// Déterminée par la PERFORMANCE RÉELLE (pas par la recette) : la vidéo a-t-elle
// marché pour son compte ? virale = elle a dépassé son audience ; flop = elle
// n'a même pas atteint son audience ; neutre = entre les deux, ou stats
// inconnues (texte collé à la main). C'est ce qui fait basculer l'analyse entre
// « décode la recette gagnante » et « diagnostique l'échec + corrige ».
function posturePerf(stats) {
  if (!stats || !stats.vues) return 'neutre';
  if (performanceForte(stats)) return 'virale';
  const p = porteeViral(stats);
  const taux = _tauxEngagementViral(stats);
  const faible = p ? p.ratio < 1.5 : (taux != null && taux < 3);
  return faible ? 'flop' : 'neutre';
}
// Libellés des sections selon la posture (résultat + texte copié).
function _labelsPosture(posture) {
  if (posture === 'flop') return { pourquoi: "Pourquoi ça n'a pas marché", leviers: 'Comment la transformer en virale', cta: 'Créer la version virale corrigée →' };
  if (posture === 'virale') return { pourquoi: 'Pourquoi ça a percé', leviers: 'Ce que tu peux reprendre', cta: 'Créer un script à partir de ça →' };
  return { pourquoi: 'Ce qui fait la différence', leviers: 'Ce que tu peux reprendre', cta: 'Créer un script à partir de ça →' };
}

// ── Mémoire partagée : dépôt d'une recette distillée ──
// Étiquettes lisibles des leviers (pour l'injection dans les autres modes).
const LEVIERS_LABEL = {
  hook_fort: 'hook fort', boucle_ouverte: 'boucle ouverte', cliffhanger: 'cliffhanger',
  deuxieme_personne: 'adresse à la 2e personne', details_concrets: 'détails concrets',
  escalade: 'escalade', question_rhetorique: 'question rhétorique', archetypes: 'archétypes',
  appel_action: 'appel à l\'action', angle_original: 'angle original', sujet_precis: 'sujet précis',
  hook_visuel: 'hook visuel'
};
// Best-effort, anonymisé : on n'envoie QUE du distillé (technique de hook,
// leviers, principes transposables, squelette sans verbatim), jamais le
// transcript ni le pseudo. Le serveur re-vérifie le garde-fou (score >= 90 +
// perf réelle) avant d'écrire. Ne bloque jamais l'utilisateur.
function _deposerPatternViral(d) {
  try {
    if (!d) return;
    const note = scoreViraliteRecette(d.signaux, d.frameDisponible);
    if (!note || note.score < SEUIL_MEMOIRE) return;       // garde-fou côté client
    if (!performanceForte(d.stats)) return;                // perf réelle exigée
    const portee = porteeViral(d.stats);
    const leviers = SIGNAUX_VIRAL.filter(k => d.signaux && d.signaux[k] === true).map(k => LEVIERS_LABEL[k] || k);
    const principes = (Array.isArray(d.a_reprendre) ? d.a_reprendre : [])
      .map(p => ({ titre: (p && p.titre) || '', detail: (p && p.detail) || '' }));
    const squelette = (Array.isArray(d.recette) ? d.recette : [])
      .map(r => ({ temps: (r && r.temps) || '', titre: (r && r.titre) || '' }));  // pas de detail : zéro verbatim
    const corps = {
      niche: d.niche || '', hook_technique: (d.hook && d.hook.technique) || '',
      leviers, principes, squelette, score: note.score,
      portee: portee ? portee.ratio : null,
      engagement: _tauxEngagementViral(d.stats),
      langue: d.langue || null
    };
    fetch('/api/patterns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
    }).catch(() => {});   // silencieux : la mémoire ne doit jamais gêner l'utilisateur
  } catch (e) { /* jamais bloquant */ }
}
// Anime l'anneau du score (même mécanique que l'audit / le sommaire).
function animerScoreViral(valeur, circonference) {
  const numEl = document.getElementById('viralScoreNum');
  const ringEl = document.getElementById('viralRingFill');
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
  // Posture (virale / flop / neutre) : stockée sur le rapport, ou recalculée
  // depuis les stats (réouverture d'un ancien rapport sans posture).
  const posture = d.posture || posturePerf(d.stats);
  const lbl = _labelsPosture(posture);

  // Score de viralité + vraies stats.
  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;
  const note = scoreViraliteRecette(d.signaux, d.frameDisponible);
  const score = note ? note.score : null;
  const pal = (typeof paletteScoreAudit === 'function') ? paletteScoreAudit(score) : { ringA: '#E2C87A', ringB: '#c9a84c', texte: '#E2C87A' };
  const taux = _tauxEngagementViral(d.stats);
  const portee = porteeViral(d.stats);
  // Ligne 1 : vues + engagement. Ligne 2 : portée (le vrai signal), si connue.
  // Le nombre d'abonnés est affiché entre parenthèses à côté de la portée :
  // sans lui, le ratio ("×0,2 son audience") n'est pas vérifiable par le
  // lecteur, qui ne voit que les vues et peut trouver le verdict arbitraire.
  const statsLigne = (d.stats && d.stats.vues)
    ? `<div class="viral-stats-row">${_fmtVuesViral(d.stats.vues)} vues${taux != null ? ` · ${String(taux).replace('.', ',')}% d'engagement` : ''}${portee ? ` · portée ${portee.affiche} son audience (${_fmtVuesViral(d.stats.abonnesAuteur)} abonnés)` : ''}</div>` : '';
  // Seuils alignés sur SEUIL_RECETTE_FORTE/SEUIL_MEMOIRE (score pondéré), pas
  // sur le simple compte de leviers : un compte brut de signaux ignore leur
  // pondération par dimension et pouvait afficher « Recette solide » (vert)
  // alors que le verdict croisé juste en dessous disait l'inverse pour le
  // même score (ex. 5 leviers/8 mais 65/100, sous le seuil de 72).
  const recetteForteBadge = score != null && score >= SEUIL_RECETTE_FORTE;
  const niveauTxt = note ? `${score >= SEUIL_MEMOIRE ? 'Recette très solide' : recetteForteBadge ? 'Recette solide' : 'Recette perfectible'} · ${note.leviers} leviers viraux` : '';
  const niveauTagClasse = recetteForteBadge ? 'ds-tag-ok' : 'ds-tag';
  // Détail du score : les 4 dimensions pondérées (calculées en code).
  const dims = note && Array.isArray(note.dimensions) ? note.dimensions : [];
  const dimsHtml = dims.length ? `
    <div class="viral-dims">
      ${dims.map(dm => `
        <div class="viral-dim">
          <div class="viral-dim-top"><span>${dm.label}</span><span class="viral-dim-val">${dm.sousScore}/${dm.poids}</span></div>
          <div class="viral-dim-bar"><div class="viral-dim-fill" style="width:${Math.round((dm.sousScore / dm.poids) * 100)}%"></div></div>
        </div>`).join('')}
    </div>` : '';
  // Sur un flop, un gros score vert « SCORE DE VIRALITÉ » en haut, avant toute
  // explication, laisse croire à tort que la vidéo a cartonné : ce score
  // mesure la SOLIDITÉ DE LA RECETTE (structure), jamais le résultat réel.
  // Libellé honnête + rappel explicite selon la posture.
  const scoreLabel = posture === 'flop' ? 'SCORE DE LA RECETTE' : 'SCORE DE VIRALITÉ';
  const scoreRappel = posture === 'flop'
    ? '<div class="viral-score-rappel">Mesure la structure, pas le résultat : cette vidéo a floppé (diagnostic ci-dessous).</div>' : '';
  const scoreCardHtml = score != null ? `
    <div class="score-card audit-score-card ds-score-card viral-score-card">
      <div class="audit-score-label">${scoreLabel}</div>
      <div class="audit-ring-wrap">
        <svg class="audit-ring" viewBox="0 0 170 170">
          <defs><linearGradient id="viralRingGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${pal.ringA}"/><stop offset="100%" stop-color="${pal.ringB}"/></linearGradient></defs>
          <circle class="audit-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="audit-ring-fill" id="viralRingFill" cx="85" cy="85" r="${RING_R}" stroke="url(#viralRingGrad)" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"/>
        </svg>
        <div class="audit-ring-center"><div class="audit-score-num" style="color:${pal.texte}"><span id="viralScoreNum">0</span><span class="audit-score-suffix">/100</span></div></div>
      </div>
      ${scoreRappel}
      ${statsLigne}
      ${niveauTxt ? `<div class="ds-sante-row"><span class="ds-tag ${niveauTagClasse}">${niveauTxt}</span></div>` : ''}
      ${dimsHtml}
    </div>` : '';

  // Verdict croisé Recette × Performance : recette reproductible, coup de
  // chance, ou structure bridée. Répond à « est-ce une vraie recette ou du bol ».
  const verdict = verdictCroiseViral(score, d.stats);
  const tagClasse = verdict.ton === 'ok' ? 'ds-tag-ok' : verdict.ton === 'alerte' ? 'ds-tag-alert' : 'ds-tag';
  const verdictHtml = `
    <div class="score-card viral-verdict viral-verdict-${verdict.ton}">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Recette ou coup de chance ?</div>
        <span class="ds-tag ${tagClasse}">${viralEsc(verdict.titre)}</span>
      </div>
      <p class="audit-diag-constat" style="margin-top:10px">${viralEsc(verdict.texte)}</p>
    </div>`;

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
      <div class="audit-section-label">${viralEsc(lbl.pourquoi)}</div>
      <ul class="ds-niche-analyse">${facteurs.map(f => `<li>${viralEsc(f)}</li>`).join('')}</ul>
    </div>` : '';

  const reprendreHtml = reprendre.length ? `
    <div class="score-card">
      <div class="audit-section-label">${viralEsc(lbl.leviers)}</div>
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

  // Le pont vers le script s'adapte à la posture : refaire un carton, ou livrer
  // la version corrigée d'un flop.
  const ctaTexte = posture === 'flop'
    ? 'Tu as le diagnostic. Passe à l\'action : Scriptura peut <strong>réécrire la version virale</strong> de cette vidéo, adaptée à ton compte.'
    : 'Tu as la recette. Passe à l\'action : Scriptura peut <strong>t\'écrire un script</strong> qui réutilise cette structure sur TON sujet.';

  res.innerHTML = `
    ${scoreCardHtml}
    ${verdictHtml}
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
      <button class="btn-generate" onclick="creerScriptDepuisViral()">${viralEsc(lbl.cta)}</button>
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
  const lbl = _labelsPosture(d.posture || posturePerf(d.stats));
  const note = scoreViraliteRecette(d.signaux, d.frameDisponible);
  if (note) {
    let entete = 'SCORE DE VIRALITÉ : ' + note.score + '/100 (' + note.leviers + ' leviers viraux)';
    if (d.stats && d.stats.vues) {
      const taux = _tauxEngagementViral(d.stats);
      const portee = porteeViral(d.stats);
      entete += '\n' + _fmtVuesViral(d.stats.vues) + ' vues' + (taux != null ? ' · ' + String(taux).replace('.', ',') + "% d'engagement" : '');
      if (portee) entete += ' · portée ' + portee.affiche + ' son audience (' + _fmtVuesViral(d.stats.abonnesAuteur) + ' abonnés)';
    }
    lignes.push(entete);
    if (Array.isArray(note.dimensions) && note.dimensions.length) {
      lignes.push('Détail : ' + note.dimensions.map(dm => dm.label + ' ' + dm.sousScore + '/' + dm.poids).join(' · '));
    }
    const verdict = verdictCroiseViral(note.score, d.stats);
    lignes.push('\nVERDICT : ' + verdict.titre + '. ' + verdict.texte);
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
    lignes.push('\n' + lbl.pourquoi.toUpperCase() + ' :');
    d.pourquoi_viral.forEach(f => lignes.push('- ' + f));
  }
  if (Array.isArray(d.a_reprendre) && d.a_reprendre.length) {
    lignes.push('\n' + lbl.leviers.toUpperCase() + ' :');
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
//  - source par défaut : on passe le transcript complet (recréer la recette),
//    ou, pour un flop, la matière à corriger.
// Dans tous les cas on dépose l'utilisateur sur le formulaire (étape 3) où il
// n'a plus qu'à indiquer SON sujet.
function creerScriptDepuisViral(source) {
  if (typeof chooseMode !== 'function') return;
  const d = _viralRapport || {};
  const posture = d.posture || posturePerf(d.stats);
  chooseMode('script'); // ouvre le flux Script (empile l'écran actuel)
  if (typeof state === 'object' && state) {
    state.depart = posture === 'flop'
      ? 'reprendre une vidéo qui a raté et la transformer en version virale'
      : 'analyser une vidéo virale et recréer sa recette';
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

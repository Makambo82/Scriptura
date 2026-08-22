// ══════════════════════════════════════
//  GÉNÉRATEUR D'IDÉES
// ══════════════════════════════════════
// ══════════════════════════════════════
//  MODE STORYTELLING (STYLE MAKAMBO)
// ══════════════════════════════════════
let storyFormat = '';
let storyDuree = '';
let storyPlatform = '';
let storyTon = '';
let currentStory = null;
let currentStoryText = '';

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
  // Durée
  const durContainer = document.getElementById('storyDureeGrid');
  if (durContainer) {
    const durBtns = durContainer.querySelectorAll('.grid-btn');
    durBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        durBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storyDuree = btn.dataset.val;
      });
    });
  }
  // Plateforme
  const pfContainer = document.getElementById('storyPlatformGrid');
  if (pfContainer) {
    const pfBtns = pfContainer.querySelectorAll('.grid-btn');
    pfBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        pfBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storyPlatform = btn.dataset.val;
      });
    });
  }
  // Ton, optionnel : un clic sur un ton déjà actif le désélectionne (voir storyPrompt
  // pour le comportement quand aucun ton n'est choisi).
  const tonContainer = document.getElementById('storyTonGrid');
  if (tonContainer) {
    const tonBtns = tonContainer.querySelectorAll('.grid-btn');
    tonBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const dejaActif = btn.classList.contains('active');
        tonBtns.forEach(b => b.classList.remove('active'));
        if (dejaActif) {
          storyTon = '';
        } else {
          btn.classList.add('active');
          storyTon = btn.dataset.val;
        }
      });
    });
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
  storyPlatform = '';
  storyTon = '';
  document.querySelectorAll('#storyFormatGrid .grid-btn, #storyDureeGrid .grid-btn, #storyPlatformGrid .grid-btn, #storyTonGrid .grid-btn').forEach(b => b.classList.remove('active'));
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
  document.getElementById('storyBtnText').textContent = on ? 'Scriptura écrit ton récit…' : '✍️ Créer mon récit';
  if (on) startGenAnimation('story');
  else stopGenAnimation();
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

  const longueurInstruction = storyFormat === 'court' && wt
    ? `LONGUEUR, RÈGLE ABSOLUE, RESPECT STRICT (peu importe la longueur du texte fourni par le créateur, même un article entier) : le récit doit faire EXACTEMENT entre ${wt.min} et ${wt.max} mots au total, pour ${storyDuree}. Compte tes mots avant de répondre. Condense ta méthode narrative pour tenir dans cette durée sans perdre en impact, ne t'étends JAMAIS au-delà sous prétexte que le texte source est riche ou long : ton travail est de le RÉDUIRE à l'essentiel qui tient dans cette durée, pas de tout caser.`
    : `LONGUEUR : Format narratif long. Déploie pleinement ton histoire, sans restriction de durée. Prends le temps de développer l'immersion, la tension et les rebondissements comme dans un vrai récit captivant.`;

  // Un texte collé long (article, notes brutes) est capé avant d'entrer dans
  // le prompt : sans ça, un texte de plusieurs milliers de mots noie les
  // consignes de durée/ton/structure et le modèle a tendance à vouloir tout
  // caser au lieu de respecter la durée choisie. Même principe que le mode
  // Script (js/generation.js, LONG_SEUIL/sujetCourt).
  const LONG_SEUIL_STORY = 400;
  const estTexteLongStory = input.length > LONG_SEUIL_STORY;
  const sujetPourPrompt = estTexteLongStory ? tronquerSansCouperEmoji(input, 2000) : input;

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
  const codesPlateforme = {
    'TikTok': 'légende courte et punchy, tutoiement direct, appel à l\'action franc ("commente si...", "partage à quelqu\'un qui..."), hashtags mêlant tendance et niche.',
    'Instagram Reels': 'légende un peu plus soignée et esthétique, peut installer une micro-accroche narrative, ton communauté/lifestyle, hashtags mêlant larges et niche.',
    'YouTube': 'légende proche d\'un titre optimisé pour la recherche (curiosité ou promesse claire dès les premiers mots), hashtags moins nombreux mais précis.',
    'Facebook': 'ton plus familier et générationnel, légende qui invite explicitement au partage et au commentaire, peut être légèrement plus explicative.'
  };
  const plateformeInstruction = storyPlatform
    ? `PLATEFORME, RÈGLE ABSOLUE : ce contenu est destiné à ${storyPlatform}. Le récit lui-même ne change pas de structure, mais la LÉGENDE, les HASHTAGS et l'appel à l'action DOIVENT respecter les codes propres à cette plateforme : ${codesPlateforme[storyPlatform] || 'adapte le registre et les hashtags aux usages de cette plateforme précise.'} Ne produis jamais une légende générique valable pour n'importe quelle plateforme.`
    : '';

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

1. HOOK EN 2 PHRASES BRÈVES, MAXIMUM 16 MOTS AU TOTAL POUR LES DEUX PHRASES (mesuré sur les 15 modèles réels de Scriptura : jamais plus de 15 mots, aucune phrase individuelle de plus de 8 mots) : paradoxal, choquant, dérangeant, fataliste ou intrigant. Il doit stopper le scroll immédiatement. "Brèves" n'est pas une suggestion de style, c'est une contrainte de longueur stricte : chaque mot compte, aucune proposition subordonnée, aucun décor, va directement à l'os du paradoxe.
   Exemples du style, avec leur nombre de mots : "Il n'a pas fait un braquage. Il a juste pris une décision." (13 mots) / "Il voulait devenir le guide du monde arabe. Il a fini lynché dans un tuyau." (15 mots) / "Ils ont vécu 24 ans sans lumière. Et personne n'a rien vu." (12 mots)

2. OUVERTURE, TOUJOURS UN SEGMENT À PART ENTIÈRE (jamais fusionnée avec le Hook ou le Contexte) : Enchaîne avec "Aujourd'hui, on parle de..." (ou variante fluide) qui pose le personnage ou l'enjeu. Voir "Ouverture" dans le format JSON plus bas : ce segment doit apparaître, distinct du Hook et du Contexte.

3. CONTEXTE / PORTRAIT : Plante le décor, présente le personnage ou la situation de façon vivante et concrète.

4. IMMERSION EN SECONDE PERSONNE : Utilise "Imaginez, vous êtes..." pour plonger le spectateur DANS la scène. C'est un procédé signature essentiel. Fais-le vivre la situation de l'intérieur.

5. DÉTONATEUR : Une question, une révélation ou une accusation qui fait basculer le récit.

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

EN PLUS DU RÉCIT, génère aussi :
- 5 HOOKS alternatifs (variations du hook d'ouverture, chacun dans un style différent mais gardant l'esprit paradoxal/choc)
- Une LÉGENDE prête à publier (accrocheuse, avec appel à commenter/partager)
- 8 HASHTAGS pertinents pour la portée

Vise l'excellence absolue (score global 90-100). EVALUATION HONNETE : évalue ton récit avec RIGUEUR, sans gonfler les chiffres. Le score doit être MERITE.
- "viral" : potentiel de partage
- "narration" : qualité du récit, de l'accroche à la chute
- "engagement" : capacité à retenir l'attention sans temps mort
- "emotion" : impact émotionnel réel
- "retention" : pourcentage (0-100) d'auditeurs qui écouteront jusqu'à la chute finale, selon la force de l'accroche, la tension maintenue et la promesse de résolution.
Si ton récit ne mérite pas 90+, réécris-le AVANT de répondre.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"titre":"un titre évocateur pour ce récit","ton":"le ton choisi","modele_utilise":"le TITRE EXACT (copié tel quel) du candidat choisi plus haut","score":{"viral":90,"narration":92,"engagement":88,"emotion":91,"retention":85},"hooks":[{"style":"Type de hook","texte":"le hook complet"}],"recit":[{"segment":"Hook","texte":"..."},{"segment":"Ouverture","texte":"le \"Aujourd'hui, on parle de...\" (ou variante fluide) qui pose le personnage ou l'enjeu, voir point 2"},{"segment":"Contexte","texte":"..."},{"segment":"Immersion","texte":"..."},{"segment":"Tension","texte":"..."},{"segment":"Clôture","texte":"la triple question miroir, PLUS la signature métapoétique obligatoire"}],"legende":"la légende prête à publier, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"],"analyse":"analyse critique courte du récit et pourquoi il fonctionne"}

Génère exactement 5 hooks et 2 variantes de titre (A et B) percutantes et différentes à tester. Découpe le récit en segments : chaque segment doit correspondre à environ 5 à 7 secondes de narration à l'oral (soit ~13 à 18 mots par segment). Le nombre de segments s'adapte à la longueur totale du récit. Le dernier segment DOIT contenir la triple question miroir ET la signature métapoétique, les deux systématiquement, jamais l'une sans l'autre. Le champ "modele_utilise" DOIT correspondre exactement au titre du candidat effectivement suivi, c'est ce qui permet de vérifier après coup que le reste de la structure (hors clôture) a bien été respecté.`;

  try {
    const raw = await callAI(MODEL_CREATIF, 16000, storyPrompt, undefined, rechercheWebStory);
    let parsed = parseAIResponse(raw);
    // Réponse tronquée (rare, mais arrive) : une nouvelle tentative silencieuse
    // avant de déranger le créateur avec une erreur qu'il devrait relancer lui-même.
    if (!parsed || !parsed.recit) {
      // Recherche web désactivée sur cette tentative de secours : si le 1er
      // essai a échoué (souvent une réponse tronquée par le temps limite), la
      // priorité passe à FINIR le récit plutôt qu'à revérifier des faits,
      // la recherche web ajoute justement le temps qui a fait échouer le 1er essai.
      const rawRetry = await callAI(MODEL_CREATIF, 16000, storyPrompt, undefined, false);
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
    const MAX_PASSES_QUALITE_RECIT = 2;
    if (!repondreMaintenant) {
      try {
        for (let passe = 0; passe < MAX_PASSES_QUALITE_RECIT; passe++) {
          if (repondreMaintenant) break; // l'utilisateur a demandé son brouillon maintenant

          const recitForReview = (parsed.recit || []).map((s, i) => '[segment ' + i + ', ' + (s.segment || '') + '] ' + s.texte).join('\n');
          const critiquePrompt = `Tu es le Critique Éditorial de Scriptura, un directeur narratif exigeant et INDÉPENDANT. Tu n'as PAS écrit ce récit, ton rôle est de chercher VOLONTAIREMENT ses faiblesses, jamais de le valider par complaisance. Un récit Scriptura ne doit JAMAIS ressembler à ce que produirait une IA généraliste (transitions plates, généralités creuses, ton neutre de manuel).

SUJET : ${sujetPourPrompt}
RÉCIT PROPOSÉ (segments numérotés, ne change jamais leur numéro) :
${recitForReview}
${structureModeleRef ? `\nSCRIPT COMPLET DU MODÈLE DE RÉFÉRENCE RÉELLEMENT SUIVI POUR CE RÉCIT (référence réelle à comparer, pas une supposition) :\n"""\n${structureModeleRef}\n"""` : ''}

TON TRAVAIL :
1. DÉTECTION DES FAIBLESSES segment par segment : phrases génériques, clichés, baisses de tension, passages oubliables, révélations arrivées trop tôt, formulations "qui sentent l'IA". Indique le numéro du segment.
2. RÉFUTATION, cherche TOUTES les raisons concrètes pour lesquelles un spectateur ferait défiler la vidéo AVANT LA FIN (hook trop lent, passage à vide, prévisibilité, immersion qui retombe...). Ne laisse la liste vide que si, après examen sincère et sévère, tu ne trouves vraiment aucune raison.
3. Compare LITTÉRALEMENT le récit au SCRIPT COMPLET DU MODÈLE ci-dessus (si fourni) : le récit doit être CALQUÉ sur ce modèle, pas seulement inspiré par lui, TOUTE sa structure : l'ordre des étapes narratives, ce qu'il développe ou survole, son rythme. Si le récit s'écarte du squelette du modèle (une étape sautée, réordonnée, ou développée alors que le modèle ne fait que l'effleurer, ou l'inverse), c'est un écart de calque à signaler dans segments_faibles. Vérifie SPÉCIFIQUEMENT que le dernier segment se termine par une triple question miroir ("Alors, que retenir de cette histoire ? Que... ? Que... ? Ou que... ?") : si elle est absente, c'est une ERREUR GRAVE à signaler explicitement dans segments_faibles, pas une nuance à minimiser, c'est l'écart le plus visible et le plus grave que Scriptura puisse commettre.
4. PLAGIAT, vérification OBLIGATOIRE, indépendante des points précédents : compare chaque phrase du récit, mot par mot, aux phrases du script du modèle. Si une phrase du récit reprend la construction ou l'essentiel des mots d'une phrase du modèle (même avec un ou deux mots changés, ex. "Que parfois, la tendresse ne sauve rien ?" copié sur "Que parfois, la beauté ne sauve rien ?"), c'est un PLAGIAT à signaler explicitement dans segments_faibles, quel que soit le segment concerné (hook, clôture, ou autre). Une bonne exécution du calque ne partage JAMAIS de phrase reconnaissable avec le modèle, seulement sa mécanique.
5. Vérifie que la SIGNATURE MÉTAPOÉTIQUE ("Moi, je t'ai pas [X]. Je t'ai [Y].") est bien présente dans la clôture, adaptée précisément au sujet, et qu'elle frappe fort en une seule image. Elle est OBLIGATOIRE dans tous les récits, quel que soit le modèle choisi, si elle est absente, générique ou faible, signale-le comme un problème à corriger.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"verdict":"excellent" ou "à améliorer","segments_faibles":[{"index":2,"probleme":"description précise et actionnable"}],"raisons_de_scroll":["raison concrète 1"],"ia_generique":false,"instructions_revision":"instructions précises, segment par segment"}`;

          const critiqueRaw = await callAI(MODEL_QUALITE_RECIT, 2500, critiquePrompt);
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
              const raw2 = await callAI(MODEL_CREATIF, 16000, storyPrompt, undefined, rechercheWebStory);
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
            const reviseRaw = await callAI(MODEL_QUALITE_RECIT, 8000, revisePrompt);
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
    if (!repondreMaintenant && parsed.hooks.length < 5) {
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
        const completHooksRaw = await callAI(MODEL_RAPIDE, 1200, completHooksPrompt);
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

    if (storyFormat === 'court' && wt) {
      let storyWordCount = countStoryWords(parsed.recit);
      let storyCorrectionAttempts = 0;
      const hardMinStory = Math.round(wt.min * 0.9);
      const hardMaxStory = Math.round(wt.max * 1.1);

      while ((storyWordCount < hardMinStory || storyWordCount > hardMaxStory) && storyCorrectionAttempts < 2 && !repondreMaintenant) {
        storyCorrectionAttempts++;
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
          const correctRawStory = await callAI(MODEL_CREATIF, 8000, correctionPromptStory);
          correctedStory = parseAIResponse(correctRawStory);
        } catch(e) { break; /* en cas d'erreur (même après réessais), on garde la version actuelle */ }

        if (correctedStory && Array.isArray(correctedStory.recit) && correctedStory.recit.length) {
          parsed.recit = correctedStory.recit;
          storyWordCount = countStoryWords(parsed.recit);
        } else {
          break; // parsing échoué, on garde la version actuelle
        }
      }
    }

    // ══════════════════════════════════════
    //  NORMALISATION FINALE DU HOOK ET DE L'OUVERTURE
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
      // Plafond mesuré sur les 15 vrais modèles : jamais plus de 15 mots
      // pour les deux phrases du hook réunies (moyenne 11). Sans ce
      // contrôle, un hook "2 phrases" pouvait rester correct en nombre de
      // phrases tout en étant deux fois plus long qu'aucun hook réel.
      const compterMotsHook = (t) => ((t || '').trim().match(/\S+/g) || []).length;
      const hookTropLong = compterMotsHook(segHook.texte) > 16;
      // Déjà correct UNIQUEMENT si la transition est dans un AUTRE segment
      // que le hook (vraiment séparée) ET que le hook ne recopie pas le
      // hook du modèle ET qu'il tient dans le plafond de mots réel.
      const dejaCorrect = !detecteOuverture(segHook.texte) && segSuivant && detecteOuverture(segSuivant.texte) && !hookPlagie && !hookTropLong;
      if (!dejaCorrect) try {
        const correctionOuverturePrompt = `Tu es le Réviseur en Chef de Scriptura. Passe finale de fidélité : les deux premiers éléments du récit doivent être un HOOK de EXACTEMENT 2 phrases brèves (MAXIMUM 16 MOTS AU TOTAL, mesuré sur les 15 vrais modèles de Scriptura qui ne dépassent jamais 15 mots), ENTIÈREMENT NOUVELLES et propres à ce sujet, suivi d'une OUVERTURE séparée qui commence par "Aujourd'hui, on parle de..." (ou une variante fluide comme "Aujourd'hui, on va parler de..."), jamais fusionnés en un seul bloc.

SEGMENT ACTUEL À CORRIGER (peut déjà être correct, contenir le hook ET l'ouverture fusionnés, être un hook trop proche du modèle, ou un hook trop long) :
${segHook.texte}

SEGMENT SUIVANT DANS LE RÉCIT (déjà correct, INCHANGÉ après ta correction, donné seulement pour contexte, ne le duplique pas) :
${segSuivant ? segSuivant.texte : '(aucun)'}
${hookPlagie ? '\n⚠️ ALERTE PLAGIAT : le hook actuel ci-dessus REPREND DES MOTS DU HOOK DU MODÈLE DE RÉFÉRENCE (détecté mécaniquement). C\'est un PLAGIAT, même partiel. Tu DOIS écrire un hook totalement nouveau, avec un vocabulaire et une image différents, qui vise le MÊME EFFET (paradoxe/choc/dissonance) mais jamais les mêmes mots.\n' : ''}${hookTropLong ? `\n⚠️ ALERTE LONGUEUR : le hook actuel fait ${compterMotsHook(segHook.texte)} mots, largement au-dessus du maximum de 16 (les vrais modèles ne dépassent jamais 15). Coupe TOUT ce qui n'est pas strictement nécessaire au paradoxe/choc : supprime les détails, les subordonnées, les précisions, garde uniquement l'os de la phrase. Le surplus d'information appartient à l'ouverture ou au contexte, pas au hook.\n` : ''}
RÈGLES :
- "hook" : EXACTEMENT 2 phrases brèves, MAXIMUM 16 MOTS AU TOTAL pour les deux réunies, paradoxales/choquantes/dérangeantes/intrigantes, qui arrêtent le scroll immédiatement, avec un vocabulaire 100% nouveau (jamais repris du modèle, même partiellement). Si le segment actuel en contient plus (en phrases ou en mots), condense-le au strict essentiel : garde uniquement l'idée qui fait vraiment office de hook.
- "ouverture" : 1 à 3 phrases courtes commençant par "Aujourd'hui, on parle de..." (ou variante fluide), qui posent le personnage ou l'enjeu. Si cette transition existe déjà dans le segment actuel, réutilise-la et ajuste-la légèrement si besoin pour qu'elle tienne seule. Si elle est absente, écris-la, cohérente avec le sujet et le ton du récit.
- Ne perds AUCUNE information factuelle importante du segment actuel : si elle ne rentre pas dans les 16 mots du hook, glisse-la dans l'ouverture plutôt que de la supprimer.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hook":"...","ouverture":"..."}`;

        const correctionOuvertureRaw = await callAI(MODEL_CREATIF, 1200, correctionOuverturePrompt);
        const correctionOuverture = parseAIResponse(correctionOuvertureRaw);
        if (correctionOuverture && typeof correctionOuverture.hook === 'string' && correctionOuverture.hook.trim()
            && typeof correctionOuverture.ouverture === 'string' && correctionOuverture.ouverture.trim()) {
          parsed.recit[0] = { segment: segHook.segment || 'Hook', texte: correctionOuverture.hook.trim() };
          parsed.recit.splice(1, 0, { segment: 'Ouverture', texte: correctionOuverture.ouverture.trim() });
        }
      } catch (e) { /* si la correction échoue, on garde le hook/ouverture actuels */ }
    }

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
- Garde le même sujet, le même ton, la même idée centrale, seule la FORME de la clôture s'aligne sur le modèle, jamais son texte.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"cloture":"la nouvelle clôture complète corrigée"}`;

          const correctionClotureRaw = await callAI(MODEL_CREATIF, 2000, correctionClotureFormPrompt);
          const correctionCloture = parseAIResponse(correctionClotureRaw);
          if (correctionCloture && typeof correctionCloture.cloture === 'string' && correctionCloture.cloture.trim()) {
            dernierSegment.texte = correctionCloture.cloture.trim();
          }
        } catch (e) { break; /* si la correction échoue, on garde la clôture actuelle */ }

        if (!partageDesMotsAvecModele(dernierSegment.texte, clotureModeleSeule, 7)) break; // propre, inutile de retenter
      }
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
    saveGeneration('story', parsed.titre || input.slice(0, 60), parsed);
    updateQuotaJour();

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
  } finally {
    setStoryLoading(false);
  }
}

function renderStory(d) {
  const out = document.getElementById('storyOutput');
  const fullText = (d.recit || []).map(s => s.texte).join('\n\n');

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

  // ── SCRIPTURA SCORE (adapté au récit) ──
  let scoreHTML = '';
  if (d.score) {
    const s = d.score;
    const vals = [s.viral, s.narration, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
    const globalScore = vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 0;
    scoreHTML = `
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
      </div>`;
  }

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
          </div>`).join('')}</div>
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


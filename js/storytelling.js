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
  // Ton — optionnel : un clic sur un ton déjà actif le désélectionne (voir storyPrompt
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
    ? `LONGUEUR — RÈGLE ABSOLUE, RESPECT STRICT (peu importe la longueur du texte fourni par le créateur, même un article entier) : le récit doit faire EXACTEMENT entre ${wt.min} et ${wt.max} mots au total, pour ${storyDuree}. Compte tes mots avant de répondre. Condense ta méthode narrative pour tenir dans cette durée sans perdre en impact — ne t'étends JAMAIS au-delà sous prétexte que le texte source est riche ou long : ton travail est de le RÉDUIRE à l'essentiel qui tient dans cette durée, pas de tout caser.`
    : `LONGUEUR : Format narratif long. Déploie pleinement ton histoire, sans restriction de durée. Prends le temps de développer l'immersion, la tension et les rebondissements comme dans un vrai récit captivant.`;

  // Un texte collé long (article, notes brutes) est capé avant d'entrer dans
  // le prompt : sans ça, un texte de plusieurs milliers de mots noie les
  // consignes de durée/ton/structure et le modèle a tendance à vouloir tout
  // caser au lieu de respecter la durée choisie. Même principe que le mode
  // Script (js/generation.js, LONG_SEUIL/sujetCourt).
  const LONG_SEUIL_STORY = 400;
  const estTexteLongStory = input.length > LONG_SEUIL_STORY;
  const sujetPourPrompt = estTexteLongStory ? input.slice(0, 2000) : input;

  // Présélection rapide (locale, sans appel IA) de plusieurs modèles de
  // référence candidats — voir choisirTopModeles() dans js/modeles.js. Le
  // choix final entre ces candidats est fait par le moteur Storytelling
  // lui-même, en silence, dans ce même appel (aucun appel supplémentaire).
  let modeleRef = '';
  let candidatsModeles = [];
  try {
    if (typeof choisirTopModeles === 'function') {
      const candidats = choisirTopModeles(input, 3);
      candidatsModeles = candidats;
      if (candidats.length) {
        const blocsCandidats = candidats.map((m, i) =>
          `── CANDIDAT ${i + 1} ──\nTITRE : ${m.titre}\nTON : ${m.ton}\nSCRIPT :\n${m.script}`
        ).join('\n\n');
        modeleRef = `

════════════════════════════════════════════
MODÈLES DE RÉFÉRENCE CANDIDATS (ta propre signature narrative — ${candidats.length} option${candidats.length > 1 ? 's' : ''} pertinente${candidats.length > 1 ? 's' : ''} pour ce sujet)
${candidats.length > 1 ? 'AVANT D\'ÉCRIRE, choisis EN SILENCE (ne l\'annonce jamais dans ta réponse) celui des candidats ci-dessous dont la structure narrative, le rythme, la progression dramatique et la montée en tension serviront le mieux CE récit précis — pas seulement celui dont le thème ressemble le plus au sujet. Une fois ce choix fait, utilise EXCLUSIVEMENT ce modèle unique comme référence absolue de style, de rythme, de ton et de structure : ne mélange JAMAIS plusieurs modèles entre eux.' : 'Utilise ce script comme RÉFÉRENCE ABSOLUE de style, de rythme, de ton et de structure.'} Ne le copie pas, fais-en une réplique fidèle de sa mécanique : repère les PROCÉDÉS RHÉTORIQUES qu'il emploie (anaphore, ironie, personnification, ellipse, images visuelles, antithèse, etc.) et réutilise-les dans ton récit avec la MÊME fréquence et la MÊME fonction narrative que dans le modèle — pas seulement son ton de surface. IMPRÈGNE-toi aussi de sa manière : la façon dont le hook frappe, dont les phrases sont courtes et rythmées, dont la tension monte, et SURTOUT la façon PRÉCISE dont IL referme le récit — reproduis exactement cette structure de clôture, quelle qu'elle soit (triple question, signature, chute sèche, question unique, autre chose), pas une clôture générique. Ton nouveau récit doit avoir EXACTEMENT ce niveau de qualité et cette voix.

PRIORITÉ ABSOLUE DE CE MODÈLE (règle très importante) : le choix et le respect d'un modèle de référence n'est PAS optionnel — c'est une exigence centrale de Scriptura. Si la STRUCTURE de ce modèle (l'ordre de ses étapes narratives, ce qu'il choisit de développer ou de survoler) diffère de la MÉTHODE NARRATIVE OBLIGATOIRE listée plus bas, c'est TOUJOURS la structure du modèle choisi qui prime. La méthode ci-dessous ne comble que ce que le modèle ne couvre pas explicitement — elle ne le remplace jamais.

${blocsCandidats}
════════════════════════════════════════════
`;
      }
    }
  } catch(e) { /* si modeles.js absent, on continue avec la méthode seule */ }

  // Mémoire du créateur : voir js/profil.js — une ligne de contexte en plus,
  // sans toucher à la méthode narrative ni aux règles ci-dessous.
  const profilLigneStory = ligneProfilPourPrompt(await chargerProfilCreateur());

  // Ton — optionnel désormais : si le créateur n'en choisit pas, l'IA choisit
  // elle-même celui qui sert le mieux le sujet (en priorité celui du modèle
  // de référence retenu plus haut), et doit le rapporter dans le champ "ton".
  const tonInstruction = storyTon
    ? `TON — RÈGLE ABSOLUE, RESPECT STRICT ET EXCLUSIF : le créateur a choisi précisément le ton "${storyTon}". Écris l'INTÉGRALITÉ du récit dans CE ton, du hook à la clôture finale, sans jamais dévier vers un autre registre — même partiellement, même une seule phrase. C'est une consigne explicite du créateur, pas une suggestion : la trahir est un échec, quelle que soit la qualité par ailleurs. Un ton glacial ne devient jamais chaleureux en cours de route ; un ton ironique ne bascule jamais dans le pathos ; un ton poétique ne devient jamais froid ou clinique.`
    : `TON — LIBRE, À TOI DE CHOISIR : le créateur n'a précisé aucun ton. Choisis celui qui sert le mieux CE sujet précis — en priorité celui du modèle de référence choisi plus haut (chaque modèle a son propre ton). Une fois ce choix fait, tiens-le du hook à la clôture, sans jamais dévier vers un autre registre en cours de route. Indique le ton choisi (en un ou deux mots) dans le champ "ton" de ta réponse JSON.`;

  // Plateforme — RÈGLE ABSOLUE elle aussi (auparavant transmise sans aucune
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
    ? `PLATEFORME — RÈGLE ABSOLUE : ce contenu est destiné à ${storyPlatform}. Le récit lui-même ne change pas de structure, mais la LÉGENDE, les HASHTAGS et l'appel à l'action DOIVENT respecter les codes propres à cette plateforme : ${codesPlateforme[storyPlatform] || 'adapte le registre et les hashtags aux usages de cette plateforme précise.'} Ne produis jamais une légende générique valable pour n'importe quelle plateforme.`
    : '';

  const storyPrompt = `Tu es le meilleur storyteller narratif francophone, spécialisé dans les récits immersifs, critiques et stylisés pour les réseaux sociaux. Tu produis un script qui capte l'attention immédiatement, la maintient jusqu'à la fin, et marque émotionnellement le spectateur. Le spectateur doit VIVRE la scène, pas seulement la regarder.

SUJET / TEXTE FOURNI PAR L'UTILISATEUR :
"""
${sujetPourPrompt}
"""
${estTexteLongStory ? "CE TEXTE EST UN TEXTE SOURCE LONG (article, notes brutes), PAS UN RÉCIT À RECOPIER : dégages-en le sujet réel, les faits marquants et l'angle le plus fort, puis RÉÉCRIS entièrement une histoire selon la méthode ci-dessous. Ne recopie JAMAIS des phrases entières du texte fourni tel quel — c'est une matière première, pas un brouillon à peaufiner." : ''}
${plateformeInstruction}
${profilLigneStory ? profilLigneStory : ''}
${modeleRef}
${longueurInstruction}

MÉTHODE NARRATIVE OBLIGATOIRE (ta signature) :

1. HOOK EN 2 PHRASES BRÈVES : paradoxal, choquant, dérangeant, fataliste ou intrigant. Il doit stopper le scroll immédiatement.
   Exemples du style : "Il n'a pas fait un braquage. Il a juste pris une décision." / "Il voulait devenir le guide du monde arabe. Il a fini lynché dans un tuyau." / "Ils ont vécu 24 ans sans lumière. Et personne n'a rien vu."

2. OUVERTURE : Enchaîne avec "Aujourd'hui, on parle de..." (ou variante fluide) qui pose le personnage ou l'enjeu.

3. CONTEXTE / PORTRAIT : Plante le décor, présente le personnage ou la situation de façon vivante et concrète.

4. IMMERSION EN SECONDE PERSONNE : Utilise "Imaginez, vous êtes..." pour plonger le spectateur DANS la scène. C'est un procédé signature essentiel. Fais-le vivre la situation de l'intérieur.

5. DÉTONATEUR : Une question, une révélation ou une accusation qui fait basculer le récit.

6. MONTÉE DE TENSION avec RELANCES régulières (tous les ~5 secondes de lecture) : des ruptures narratives, des cliffhangers, des "Mais...", "Et là...", "Sauf que...". Personne ne doit décrocher.

7. Le message clé doit apparaître AVANT 20 secondes de lecture (pas de réserver tout le sens pour la conclusion).

8. Ajoute au moins un élément qui pousse à SAUVEGARDER : un fait rare, une citation mémorable, une révélation choc, un chiffre marquant.

9. CLÔTURE NARRATIVE (structure DÉPENDANTE du modèle choisi — pas automatique) : reproduis la structure de fin exacte du modèle choisi plus haut, quelle qu'elle soit. Triple question miroir (clôture PAR DÉFAUT, uniquement si aucun modèle ne s'applique) :
   "Alors, que retenir de cette histoire ?
   Que... ?
   Que... ?
   Ou que... ?"
   Ces questions doivent heurter, interpeller, et pousser à commenter/partager.

10. SIGNATURE MÉTAPOÉTIQUE — OBLIGATOIRE DANS TOUS LES RÉCITS, SANS EXCEPTION, quel que soit le modèle choisi. Aucun des 15 modèles de référence ne contient cette phrase eux-mêmes — c'est volontaire : c'est une exigence SUPPLÉMENTAIRE de Scriptura, à ajouter systématiquement, jamais une simple clôture de secours. Ajoute, juste avant ou après la clôture narrative du point 9, une phrase de forme fixe "Moi, je t'ai pas [X]. Je t'ai [Y]." — ton poétique, ironique, lucide, qui frappe fort en une seule image, adaptée précisément au sujet. Elle agit comme signature narrative de Scriptura.
    Exemple : "Moi, je t'ai pas raconté une fuite. Je t'ai montré ce que devient un empire quand il rentre dans une valise."

RAPPEL — LA STRUCTURE DU MODÈLE CHOISI (POINT 9) PRIME TOUJOURS SUR LA CLÔTURE PAR DÉFAUT ; LA SIGNATURE (POINT 10) EST TOUJOURS OBLIGATOIRE EN PLUS : le point 9 n'est qu'un filet de sécurité utilisé quand aucun modèle ne s'applique. Un modèle a TOUJOURS été choisi (voir plus haut) : regarde comment SA propre clôture est construite — triple question, chute sèche, question unique, silence, autre chose — et REPRODUIS EXACTEMENT CETTE STRUCTURE-LÀ, pas automatiquement la triple question du point 9. Ne plaque JAMAIS la triple question sur un récit dont le modèle se termine autrement : c'est une trahison de la structure du modèle, l'erreur la plus visible et la plus grave que Scriptura puisse commettre en clôture. La signature métapoétique du point 10, elle, s'ajoute TOUJOURS, peu importe le modèle et peu importe sa propre clôture — ce n'est jamais optionnel, contrairement à la triple question.

${tonInstruction}

STYLE ET LANGUE :
- Français courant, compréhensible par un ado de 12 ans, avec de subtiles anecdotes qui font sourire le spectateur.
- Phrases brèves et moyennes. Rythme soutenu. Images fortes. Ruptures marquées.
- AUCUN ton générique. Aucune formule plate.
- UNE IMAGE MENTALE TOUTES LES 3 À 5 SECONDES (essentiel pour le storyboard qui sera généré ensuite à partir de ce texte) : écris comme si tu filmais mentalement chaque instant. Chaque phrase — ou petit groupe de phrases très courtes — doit porter UNE SEULE idée visuelle claire, concrète et filmable (une action, un lieu, un visage, un objet), jamais plusieurs idées mélangées dans une même phrase longue. Change d'image mentale environ toutes les 8 à 14 mots (~3 à 5 secondes à l'oral). Interdiction des phrases analytiques ou à tiroirs qui empilent plusieurs images en une seule construction : découpe-les en plusieurs phrases courtes, chacune avec sa propre image.

EXIGENCE DE PERFECTION : Avant de livrer, relis ton récit. S'il n'atteint pas un niveau où un storyteller professionnel ne trouverait rien à améliorer, réécris-le. Vérifie que le hook arrête le scroll, que la tension tient du début à la fin, que la clôture reproduit fidèlement la structure de fin du modèle choisi (pas automatiquement la triple question si ce n'est pas ainsi que ce modèle se termine), et que la signature métapoétique est bien présente — elle, contrairement à la triple question, est obligatoire dans tous les cas, quel que soit le modèle.

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
{"titre":"un titre évocateur pour ce récit","ton":"le ton choisi","modele_utilise":"le TITRE EXACT (copié tel quel) du candidat choisi plus haut","score":{"viral":90,"narration":92,"engagement":88,"emotion":91,"retention":85},"hooks":[{"style":"Type de hook","texte":"le hook complet"}],"recit":[{"segment":"Hook","texte":"..."},{"segment":"Contexte","texte":"..."},{"segment":"Immersion","texte":"..."},{"segment":"Tension","texte":"..."},{"segment":"Clôture","texte":"la clôture, dans la structure exacte du modèle choisi, PLUS la signature métapoétique obligatoire"}],"legende":"la légende prête à publier, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"],"analyse":"analyse critique courte du récit et pourquoi il fonctionne"}

Génère exactement 5 hooks et 2 variantes de titre (A et B) percutantes et différentes à tester. Découpe le récit en segments : chaque segment doit correspondre à environ 5 à 7 secondes de narration à l'oral (soit ~13 à 18 mots par segment). Le nombre de segments s'adapte à la longueur totale du récit. Le dernier segment DOIT reproduire la structure de clôture du modèle choisi (triple question UNIQUEMENT si c'est ainsi que ce modèle précis se termine) ET inclure dans tous les cas la signature métapoétique, obligatoire quel que soit le modèle. Le champ "modele_utilise" DOIT correspondre exactement au titre du candidat effectivement suivi — c'est ce qui permet de vérifier après coup que la clôture a bien été respectée.`;

  try {
    const raw = await callAI(MODEL_CREATIF, 16000, storyPrompt);
    let parsed = parseAIResponse(raw);
    // Réponse tronquée (rare, mais arrive) : une nouvelle tentative silencieuse
    // avant de déranger le créateur avec une erreur qu'il devrait relancer lui-même.
    if (!parsed || !parsed.recit) {
      const rawRetry = await callAI(MODEL_CREATIF, 16000, storyPrompt);
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
    // ressemblait sa structure réelle — il ne pouvait donc pas vraiment
    // vérifier ce point. On retrouve ici le modèle via le titre que l'IA
    // rapporte (voir "modele_utilise" dans le JSON) et on transmet son
    // script COMPLET (pas seulement la clôture) au Critique et au Réviseur :
    // la fidélité au modèle porte sur toute la structure — l'ordre des
    // étapes, ce qu'il développe ou survole — pas seulement sur la clôture.
    const modeleUtilise = candidatsModeles.find(m => m.titre === parsed.modele_utilise) || candidatsModeles[0] || null;
    const structureModeleRef = modeleUtilise ? modeleUtilise.script.trim() : '';

    // ── SCORE RÉEL : régénère UNE fois si le récit n'est pas excellent (< 90) ──
    // Filet de variance créative : parfois un 2e jet est simplement meilleur.
    function scoreGlobalStory(p) {
      if (!p || !p.score) return 100;
      const s = p.score;
      const vals = [s.viral, s.narration, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 100;
    }
    if (!repondreMaintenant && scoreGlobalStory(parsed) < 90) {
      try {
        const raw2 = await callAI(MODEL_CREATIF, 16000, storyPrompt);
        const parsed2 = parseAIResponse(raw2);
        if (parsed2 && parsed2.recit && parsed2.score && scoreGlobalStory(parsed2) > scoreGlobalStory(parsed)) {
          parsed = parsed2;
        }
      } catch(e) { /* garde la première version si échec */ }
    }

    // ── CRITIQUE + RÉVISEUR (comme le mode script) ──
    // Le récit avait longtemps ce maillon manquant. Un Critique indépendant
    // cherche les faiblesses segment par segment ; si un problème ressort, un
    // Réviseur réécrit UNIQUEMENT les segments faibles. Sauté si l'utilisateur
    // a demandé « Répondre maintenant ».
    if (!repondreMaintenant) {
      try {
        const recitForReview = (parsed.recit || []).map((s, i) => '[segment ' + i + ' — ' + (s.segment || '') + '] ' + s.texte).join('\n');
        const critiquePrompt = `Tu es le Critique Éditorial de Scriptura, un directeur narratif exigeant et INDÉPENDANT. Tu n'as PAS écrit ce récit — ton rôle est de chercher VOLONTAIREMENT ses faiblesses, jamais de le valider par complaisance. Un récit Scriptura ne doit JAMAIS ressembler à ce que produirait une IA généraliste (transitions plates, généralités creuses, ton neutre de manuel).

SUJET : ${sujetPourPrompt}
RÉCIT PROPOSÉ (segments numérotés, ne change jamais leur numéro) :
${recitForReview}
${structureModeleRef ? `\nSCRIPT COMPLET DU MODÈLE DE RÉFÉRENCE RÉELLEMENT SUIVI POUR CE RÉCIT (référence réelle à comparer, pas une supposition) :\n"""\n${structureModeleRef}\n"""` : ''}

TON TRAVAIL :
1. DÉTECTION DES FAIBLESSES segment par segment : phrases génériques, clichés, baisses de tension, passages oubliables, révélations arrivées trop tôt, formulations "qui sentent l'IA". Indique le numéro du segment.
2. RÉFUTATION — cherche TOUTES les raisons concrètes pour lesquelles un spectateur ferait défiler la vidéo AVANT LA FIN (hook trop lent, passage à vide, prévisibilité, immersion qui retombe...). Ne laisse la liste vide que si, après examen sincère et sévère, tu ne trouves vraiment aucune raison.
3. Compare LITTÉRALEMENT le récit au SCRIPT COMPLET DU MODÈLE ci-dessus (si fourni) — pas seulement sa clôture, TOUTE sa structure : l'ordre des étapes narratives, ce qu'il développe ou survole, son rythme. Porte une attention PARTICULIÈRE à la forme exacte de sa clôture (triple question, punchline, chute sèche, question unique, silence, autre chose) : si le modèle se termine par une triple question et que le récit ne le fait pas (ou l'inverse), c'est une ERREUR GRAVE à signaler explicitement dans segments_faibles, pas une nuance à minimiser — c'est l'écart le plus visible et le plus grave que Scriptura puisse commettre.
4. Vérifie que la SIGNATURE MÉTAPOÉTIQUE ("Moi, je t'ai pas [X]. Je t'ai [Y].") est bien présente dans la clôture, adaptée précisément au sujet, et qu'elle frappe fort en une seule image. Elle est OBLIGATOIRE dans tous les récits, quel que soit le modèle choisi — si elle est absente, générique ou faible, signale-le comme un problème à corriger.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"verdict":"excellent" ou "à améliorer","segments_faibles":[{"index":2,"probleme":"description précise et actionnable"}],"raisons_de_scroll":["raison concrète 1"],"ia_generique":false,"instructions_revision":"instructions précises, segment par segment"}`;

        const critiqueRaw = await callAI(MODEL_RAPIDE, 2500, critiquePrompt);
        const critique = parseAIResponse(critiqueRaw);

        function critiqueRecitProbleme(c) {
          if (!c) return false;
          if (c.verdict === 'à améliorer') return true;
          if (c.ia_generique === true) return true;
          if (Array.isArray(c.segments_faibles) && c.segments_faibles.length > 0) return true;
          if (Array.isArray(c.raisons_de_scroll) && c.raisons_de_scroll.length > 0) return true;
          return false;
        }

        if (!repondreMaintenant && critique && critiqueRecitProbleme(critique)) {
          const segmentsFaiblesTxt = (critique.segments_faibles || [])
            .map(sf => '- Segment ' + sf.index + ' : ' + sf.probleme).join('\n')
            || 'Applique les instructions générales ci-dessous.';
          const raisonsScrollTxt = (critique.raisons_de_scroll || []).map(r => '- ' + r).join('\n');

          const revisePrompt = `Tu es le Réviseur en Chef de Scriptura, expert en réécriture CIBLÉE de récits viraux. Un critique indépendant a évalué le récit ci-dessous. RÈGLE ABSOLUE : ne réécris QUE les segments identifiés comme faibles. Conserve TOUS les autres segments EXACTEMENT tels quels (même texte, même fonction narrative) — ce sont les points forts, ne les abîme pas.

SUJET : ${sujetPourPrompt}
RÉCIT ACTUEL (segments numérotés) :
${recitForReview}
${structureModeleRef ? `\nSCRIPT COMPLET DU MODÈLE DE RÉFÉRENCE RÉELLEMENT SUIVI POUR CE RÉCIT (toute réécriture doit rester fidèle à SA structure entière, pas seulement sa clôture) :\n"""\n${structureModeleRef}\n"""` : ''}

SEGMENTS À RÉÉCRIRE (uniquement ceux-ci) :
${segmentsFaiblesTxt}
${raisonsScrollTxt ? '\nRAISONS DE DÉCROCHAGE À ÉLIMINER :\n' + raisonsScrollTxt : ''}${critique.ia_generique ? '\nATTENTION : récit jugé trop générique. Les segments réécrits doivent avoir une voix beaucoup plus incarnée, jamais neutre.' : ''}${critique.instructions_revision ? '\nINSTRUCTIONS DU CRITIQUE :\n' + critique.instructions_revision : ''}

RÈGLES :
- Ne touche JAMAIS un segment non listé ci-dessus.
- Renvoie la liste COMPLÈTE des segments dans le même ordre, avec le même nombre total et les mêmes valeurs de "segment" (fonction narrative).
- Si le dernier segment (clôture) est réécrit, reproduis EXACTEMENT la forme de clôture du script du modèle ci-dessus (triple question UNIQUEMENT si c'est ainsi que ce modèle se termine), ET assure-toi que la signature métapoétique ("Moi, je t'ai pas [X]. Je t'ai [Y].") reste présente, adaptée au sujet et percutante — elle est obligatoire dans tous les cas, quel que soit le modèle.
- Réécris aussi les 5 hooks si le critique a signalé un hook faible, sinon garde-les.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hooks":[{"style":"...","texte":"..."}],"recit":[{"segment":"Hook","texte":"..."}]}`;

          const reviseRaw = await callAI(MODEL_CREATIF, 16000, revisePrompt);
          const revised = parseAIResponse(reviseRaw);
          if (revised && Array.isArray(revised.recit) && revised.recit.length) {
            parsed.recit = revised.recit;
            if (Array.isArray(revised.hooks) && revised.hooks.length) parsed.hooks = revised.hooks;
          }
        }
      } catch(e) { /* si la critique/révision échoue, on garde la meilleure version obtenue */ }
    }

    // ══════════════════════════════════════
    //  CONTRÔLE PROGRAMMATIQUE DE LA FIDÉLITÉ DE CLÔTURE
    //  Le Critique éditorial ci-dessus a maintenant accès au script exact du
    //  modèle suivi (voir structureModeleRef), mais reste un jugement d'IA —
    //  pas une garantie : sur un vrai récit généré, la clôture a pu rester
    //  une simple punchline alors que le modèle suivi (ex. Kadhafi, Traoré)
    //  se termine par une triple question, sans que le Critique ne le
    //  signale. On vérifie donc mécaniquement, comme pour le nombre de
    //  mots : le modèle se termine-t-il par une triple question (2 "?" ou
    //  plus) ? Le récit fait-il pareil ? Si les deux ne correspondent pas,
    //  on corrige UNIQUEMENT le segment de clôture, sans toucher au reste.
    // ══════════════════════════════════════
    function detecteTripleQuestion(texte) {
      return ((texte || '').match(/\?/g) || []).length >= 2;
    }

    if (!repondreMaintenant && structureModeleRef && Array.isArray(parsed.recit) && parsed.recit.length) {
      const clotureModeleSeule = structureModeleRef.split('\n\n').pop() || '';
      const modeleAttendTripleQuestion = detecteTripleQuestion(clotureModeleSeule);
      const dernierSegment = parsed.recit[parsed.recit.length - 1];
      const recitATripleQuestion = detecteTripleQuestion(dernierSegment.texte || '');

      if (modeleAttendTripleQuestion !== recitATripleQuestion) {
        try {
          const correctionClotureFormPrompt = `Tu es le Réviseur en Chef de Scriptura. La clôture du récit ci-dessous ne respecte PAS la forme de clôture du modèle de référence réellement suivi pour ce récit — c'est l'erreur la plus grave que Scriptura puisse commettre en clôture.

CLÔTURE ACTUELLE DU RÉCIT :
${dernierSegment.texte}

CLÔTURE EXACTE DU MODÈLE DE RÉFÉRENCE À REPRODUIRE DANS SA FORME (même structure, pas les mêmes mots) :
"""
${clotureModeleSeule}
"""

PROBLÈME : ${modeleAttendTripleQuestion ? 'Le modèle se termine par une triple question miroir ("Alors, que retenir de cette histoire ? Que... ? Que... ? Ou que... ?") mais la clôture actuelle ne le fait pas.' : 'Le modèle NE se termine PAS par une triple question, mais la clôture actuelle en impose une — ce n\'est pas fidèle au modèle.'}

RÈGLES :
- Réécris UNIQUEMENT la clôture, dans la structure exacte du modèle ci-dessus (${modeleAttendTripleQuestion ? 'triple question miroir, adaptée au sujet' : 'la forme réelle du modèle, sans triple question forcée'}).
- Garde impérativement la signature métapoétique ("Moi, je t'ai pas [X]. Je t'ai [Y].") — elle est obligatoire dans tous les cas, quel que soit le modèle. Place-la comme dans la clôture actuelle (juste avant ou après la structure de clôture).
- Garde le même sujet, le même ton, la même idée centrale — seule la FORME de la clôture change.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"cloture":"la nouvelle clôture complète corrigée"}`;

          const correctionClotureRaw = await callAI(MODEL_CREATIF, 2000, correctionClotureFormPrompt);
          const correctionCloture = parseAIResponse(correctionClotureRaw);
          if (correctionCloture && typeof correctionCloture.cloture === 'string' && correctionCloture.cloture.trim()) {
            dernierSegment.texte = correctionCloture.cloture.trim();
          }
        } catch (e) { /* si la correction échoue, on garde la clôture actuelle */ }
      }
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
- Garde les mêmes segments (même "segment" et même ordre), le hook en premier, et dans le dernier segment la MÊME structure de clôture que le récit actuel ci-dessus (ne la remplace jamais par une triple question si ce n'était pas déjà sa forme). Garde impérativement la signature métapoétique ("Moi, je t'ai pas [X]. Je t'ai [Y].") intacte et bien présente — elle est obligatoire dans tous les cas.

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

  // Section — titre + ton + analyse
  sections.push({
    titre: d.titre || 'Ton récit',
    content: `
      <div class="out-section">
        ${d.ton ? `<div class="story-meta"><span class="script-meta-item">🎭 Ton ${d.ton}</span></div>` : ''}
        ${d.analyse ? `<div class="legende-block" style="margin-top:14px">${d.analyse}</div>` : ''}
      </div>`
  });

  // Section — 5 hooks
  if (d.hooks && d.hooks.length) {
    sections.push({
      titre: '5 Hooks alternatifs',
      content: `
      <div class="out-section">
        <div class="out-section-label">Accroches · Plusieurs styles</div>
        <div class="hooks-list" id="storyHooksList">${d.hooks.map((h, i) => `
          <div class="hook-item" data-idx="${i}">
            <div class="hook-style">${h.style || ('Hook ' + (i+1))}</div>
            <div class="hook-text" id="storyHookText${i}">${h.texte || ''}</div>
            <div class="retouche-actions"><button class="btn-regenerate mini story-hook-retouche-btn" onclick="changerHookStory(${i})">🔄 Changer ce hook</button></div>
          </div>`).join('')}</div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, texteHooksStory())">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, texteHooksStory())">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section — récit complet
  sections.push({
    titre: 'Le récit',
    content: `
      <div class="out-section">
        <div class="story-block" id="storyRecitBlock">${(d.recit || []).map((s, i) => `
          <div class="story-segment" data-idx="${i}">
            <div class="story-segment-text" id="storySegText${i}">${(s.texte || '').replace(/\n/g, '<br/>')}</div>
          </div>`).join('')}</div>
        <div class="script-retouche-libre">
          <label class="idea-section-label" for="storyRetoucheInput">✏️ Demander une retouche</label>
          <textarea class="ctx-textarea" id="storyRetoucheInput" placeholder="Ex : le hook est trop long, raccourcis-le. Change la formulation du passage sur la tension."></textarea>
          <button class="btn-regenerate mini" id="storyRetoucheBtn" onclick="retoucherRecitLibre()">Appliquer les retouches</button>
        </div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyStory(this)">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareStory(this)">${ICON_SHARE}</button></div>
      </div>`
  });

  // Section — Légende & Hashtags (ensemble)
  if (d.legende || (d.hashtags && d.hashtags.length)) {
    // 5 hashtags max, en minuscules
    const tags = (d.hashtags || []).slice(0, 5).map(t => t.toLowerCase());
    sections.push({
      titre: 'Légende & Hashtags',
      content: `
      <div class="out-section">
        ${d.legende ? `<div class="legende-block">${sansHashtags(d.legende)}</div>` : ''}
        ${tags.length ? `<div class="hashtags-wrap" style="margin-top:14px">${tags.map(t => `<span class="hashtag-chip">${t}</span>`).join('')}</div>` : ''}
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText(sansHashtags(d.legende || '') + (tags.length ? '\n\n' + tags.join(' ') : ''))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sansHashtags(d.legende || '') + (tags.length ? '\n\n' + tags.join(' ') : ''))}')">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section — Variantes A/B du titre
  if (d.variantes_titre && d.variantes_titre.length) {
    sections.push({
      titre: 'Variantes A/B du titre',
      content: `<div class="out-section">
        <div class="out-section-label">Titres alternatifs à tester</div>
        <div class="hooks-list">${(d.variantes_titre || []).map((t, i) => `
          <div class="hook-item">
            <span class="hook-style">Version ${i === 0 ? 'A' : 'B'}</span>
            ${t}
          </div>`).join('')}
        </div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText((d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText((d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'))}')">${ICON_SHARE}</button></div>
      </div>`,
      sansBoutonGenerique: true
    });
  }

  // Section — storyboard à la demande
  sections.push({
    titre: 'Storyboard visuel',
    content: `
      <div class="out-section">
        <p style="color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.6;margin-bottom:16px">Génère le découpage visuel plan par plan de ton récit, avec un prompt d'image pour chaque segment.</p>
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

  // Rendu : score en haut, puis accordéon (1re carte ouverte — clic sur + pour ouvrir)
  out.innerHTML = scoreHTML + sections.map((sec, i) => `
    <div class="out-card sb-appear${i === 0 ? ' open' : ''}" style="animation-delay:${(i + 1) * 0.12}s">
      <div class="out-header" onclick="toggleCard(this.parentElement)">
        <div class="out-title">${sec.titre}</div>
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
  document.getElementById('storyResults').style.display = 'block';
  document.getElementById('storyResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── RETOUCHE CIBLÉE (storytelling) ──
// Même principe que le mode script (js/generation.js) : un bouton par hook
// pour le régénérer, et un champ de texte libre pour retoucher le récit sans
// tout relancer. Gratuit et illimité, sauvegardé dans l'historique.

// Texte des hooks, calculé en direct (jamais figé au moment du rendu) pour
// que copier/partager reflète toujours la dernière version après retouche.
function texteHooksStory() {
  return ((currentStory && currentStory.hooks) || []).map(h => h.texte || '').join('\n\n');
}

async function changerHookStory(index) {
  if (!currentStory || !currentStory.hooks || !currentStory.hooks[index]) return;
  const item = document.querySelector('#storyHooksList .hook-item[data-idx="' + index + '"]');
  const textEl = document.getElementById('storyHookText' + index);
  if (!item || !textEl) return;
  const btn = item.querySelector('.story-hook-retouche-btn');

  const original = currentStory.hooks[index];
  const autresHooks = currentStory.hooks.map(h => h.texte).filter((t, i) => i !== index && t);

  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  textEl.style.opacity = '0.5';

  const ctx = lastStoryContext || {};
  const prompt = `Tu es le meilleur storyteller narratif francophone de Scriptura. Propose UNE nouvelle version du hook suivant, dans le même style ("${original.style || ''}"), mais avec une formulation différente et plus forte — paradoxale, choquante, dérangeante, fataliste ou intrigante, comme "Il n'a pas fait un braquage. Il a juste pris une décision."

CONTEXTE : sujet "${ctx.sujet || ''}", plateforme ${ctx.plateforme || ''}.

HOOK ACTUEL : "${original.texte || ''}"
${autresHooks.length ? 'AUTRES HOOKS DÉJÀ PROPOSÉS, à ne surtout pas reproduire : ' + autresHooks.join(' / ') : ''}

Réponds UNIQUEMENT avec le nouveau texte du hook, sans guillemets, sans commentaire.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 300, prompt);
    const nouveau = nettoyerTexteRetouche(raw);
    if (!nouveau) throw new Error('réponse vide');
    currentStory.hooks[index].texte = nouveau;
    textEl.textContent = nouveau;
    sauvegarderRetoucheStory();
  } catch (e) {
    toastRegen('Impossible de changer ce hook, réessaie');
  } finally {
    textEl.style.opacity = '';
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Changer ce hook'; }
  }
}

function rerenderStoryHooksList(avant) {
  const list = document.getElementById('storyHooksList');
  if (!list || !currentStory || !currentStory.hooks) return;
  list.innerHTML = currentStory.hooks.map((h, i) => `
    <div class="hook-item" data-idx="${i}">
      <div class="hook-style">${h.style || ('Hook ' + (i + 1))}</div>
      <div class="hook-text${avant && avant[i] !== h.texte ? ' retouche-flash' : ''}" id="storyHookText${i}">${h.texte || ''}</div>
      <div class="retouche-actions"><button class="btn-regenerate mini story-hook-retouche-btn" onclick="changerHookStory(${i})">🔄 Changer ce hook</button></div>
    </div>`).join('');
}

function rerenderRecitBlock(avant) {
  const block = document.getElementById('storyRecitBlock');
  if (!block || !currentStory || !currentStory.recit) return;
  block.innerHTML = currentStory.recit.map((s, i) => `
    <div class="story-segment" data-idx="${i}">
      <div class="story-segment-text${avant && avant[i] !== s.texte ? ' retouche-flash' : ''}" id="storySegText${i}">${(s.texte || '').replace(/\n/g, '<br/>')}</div>
    </div>`).join('');
}

async function retoucherRecitLibre() {
  const input = document.getElementById('storyRetoucheInput');
  const btn = document.getElementById('storyRetoucheBtn');
  if (!input || !btn || !currentStory || !currentStory.recit) return;
  const instructions = input.value.trim();
  if (!instructions) { input.focus(); return; }

  const avantRecit = currentStory.recit.map(s => s.texte);
  const avantHooks = ((currentStory.hooks) || []).map(h => h.texte);

  const label = btn.textContent;
  btn.disabled = true;
  input.disabled = true;
  btn.textContent = 'Application des retouches…';

  const ctx = lastStoryContext || {};
  const hooksNum = (currentStory.hooks || []).map((h, i) => (i + 1) + '. [' + (h.style || '') + '] ' + h.texte).join('\n');
  const recitNum = currentStory.recit.map((s, i) => '[segment ' + i + ' — ' + (s.segment || '') + '] ' + s.texte).join('\n');

  // Modèle de référence réellement suivi pour CE récit (voir modele_utilise,
  // storyPrompt) : si la demande porte sur la fidélité au modèle, la
  // retouche doit pouvoir s'appuyer sur son script exact, pas deviner.
  const modeleUtiliseTitreRetouche = currentStory.modele_utilise || '';
  const modeleRetouche = (typeof SCRIPTURA_MODELES !== 'undefined' ? SCRIPTURA_MODELES : [])
    .find(m => m.titre === modeleUtiliseTitreRetouche);
  const structureModeleRetouche = modeleRetouche ? modeleRetouche.script.trim() : '';

  const prompt = `Tu es le meilleur storyteller narratif francophone de Scriptura. Le créateur a relu son récit et te demande des retouches en langage libre. APPLIQUE TOUJOURS CE QU'IL DEMANDE, intégralement — une demande de retouche est une instruction prioritaire du créateur, jamais une suggestion que tu peux filtrer ou minimiser.

CONTEXTE : sujet "${ctx.sujet || ''}", plateforme ${ctx.plateforme || ''}.
${structureModeleRetouche ? `\nSCRIPT COMPLET DU MODÈLE DE RÉFÉRENCE SUIVI POUR CE RÉCIT (utile si la demande porte sur la fidélité au modèle) :\n"""\n${structureModeleRetouche}\n"""` : ''}

HOOKS ACTUELS (numérotés) :
${hooksNum || 'aucun'}

RÉCIT ACTUEL (segments numérotés, ne change jamais leur numéro ni leur fonction narrative) :
${recitNum}

DEMANDE DU CRÉATEUR (peut viser un élément précis, ou être une consigne globale qui concerne tout le récit — identifie sa PORTÉE réelle avant de répondre) :
"${instructions}"

RÈGLES :
- Détermine d'abord la PORTÉE de la demande : une demande précise (ex. "raccourcis le hook 2") ne touche que l'élément visé. Une demande globale (ex. "respecte rigoureusement la structure du modèle choisi", "renforce la tension partout", "change le ton de tout le récit") DOIT être appliquée à TOUS les segments et/ou hooks concernés, aussi nombreux soient-ils — ne la limite jamais artificiellement à un seul élément par excès de prudence.
- CETTE DEMANDE EST PRIORITAIRE sur les règles par défaut du récit : si elle implique de changer la structure de clôture, le ton, ou tout autre principe habituel de génération, applique-la quand même — c'est la décision du créateur, pas la tienne à remettre en question. Ne refuse jamais une demande légitime sous prétexte qu'elle s'écarte des règles habituelles de Scriptura.
- Si la demande est formulée de façon générale plutôt que ciblée sur un élément précis, interprète-la du mieux possible avec le contexte disponible (y compris le script du modèle de référence ci-dessus, si fourni) et applique-la partout où elle est pertinente. Ne renvoie JAMAIS un résultat vide sous prétexte que la demande n'était pas assez précise — fais de ton mieux avec l'intention exprimée.
- Ne réponds QUE pour les éléments que tu modifies réellement — n'écris rien pour un hook ou un segment inchangé.
- Si une demande est ambiguë sur QUEL élément précis elle vise (ex. "le hook" sans préciser lequel), applique-la à celui dont le contenu correspond le mieux.
- L'index désigne le numéro (à partir de 0) du hook ou du segment tel qu'indiqué ci-dessus. Ne change jamais un index.

Réponds STRICTEMENT selon ce format texte, une ligne par élément modifié, RIEN D'AUTRE (pas de JSON, pas d'introduction, pas de commentaire) :
HOOK <index> :: <nouveau texte complet de ce hook, sur une seule ligne>
SEGMENT <index> :: <nouveau texte complet de ce segment, sur une seule ligne>

Le segment "Clôture" peut contenir plusieurs phrases sur des lignes séparées (par ex. triple question + signature, ou toute autre structure selon le modèle utilisé) : si tu le modifies, remplace chaque retour à la ligne par la séquence \n (2 caractères, pas un vrai retour à la ligne) pour rester sur une seule ligne de réponse.
N'écris aucune ligne HOOK si aucune demande ne concerne les hooks. N'écris aucune ligne SEGMENT si aucune ne concerne le récit.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 4000, prompt);
    const parsed = parseLignesRetouche(raw);

    let recitChange = false, hooksChange = false;
    parsed.segments.forEach(item => {
      const i = item.index;
      if (Number.isInteger(i) && i >= 0 && i < currentStory.recit.length && item.texte) {
        if (currentStory.recit[i].texte !== item.texte) { currentStory.recit[i].texte = item.texte; recitChange = true; }
      }
    });
    parsed.hooks.forEach(item => {
      const i = item.index;
      if (currentStory.hooks && Number.isInteger(i) && i >= 0 && i < currentStory.hooks.length && item.texte) {
        if (currentStory.hooks[i].texte !== item.texte) { currentStory.hooks[i].texte = item.texte; hooksChange = true; }
      }
    });
    if (!recitChange && !hooksChange) throw new Error('aucun changement identifié');

    rerenderRecitBlock(avantRecit);
    rerenderStoryHooksList(avantHooks);
    currentStoryText = currentStory.recit.map(s => s.texte).join('\n\n');
    const out = document.getElementById('storyOutput');
    if (out) out.dataset.fulltext = currentStoryText;
    sauvegarderRetoucheStory();

    const inputApres = document.getElementById('storyRetoucheInput');
    if (inputApres) inputApres.value = '';
    toastRegen('Retouches appliquées');
  } catch (e) {
    toastRegen(e && e.message === 'aucun changement identifié'
      ? 'Aucun changement identifié — précise ta demande'
      : 'Retouche impossible, réessaie');
  } finally {
    const btnApres = document.getElementById('storyRetoucheBtn');
    const inputApres = document.getElementById('storyRetoucheInput');
    if (btnApres) { btnApres.disabled = false; btnApres.textContent = label; }
    if (inputApres) inputApres.disabled = false;
  }
}


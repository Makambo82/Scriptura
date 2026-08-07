// ═══════════════════════════════════════════════════════════
//  /api/audit — Fonction dédiée au mode "Analyse mon compte TikTok"
//  Reçoit des captures d'écran (images) + le contexte du créateur
//  (objectif, niche, fréquence), les transmet à l'API Anthropic
//  avec le prompt d'audit, renvoie la réponse.
//
//  Fichier INDÉPENDANT : ne touche pas aux autres modes de Scriptura.
// ═══════════════════════════════════════════════════════════

// Date réelle du jour, injectée dans l'appel d'audit principal (même principe
// que api/generate.js) : sans repère temporel, le modèle peut analyser un
// sujet d'actualité (niche "Géopolitique & Actualité", etc.) en présentant
// des faits ou une année déjà passés comme encore à venir.
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function systemDateActuelle() {
  const now = new Date();
  const dateStr = now.getUTCDate() + ' ' + MOIS_FR[now.getUTCMonth()] + ' ' + now.getUTCFullYear();
  return `Nous sommes le ${dateStr}. Utilise cette date comme repère temporel réel et actuel, quelles que soient tes connaissances d'entraînement. Ne présente jamais un événement ou une année déjà passés comme s'ils étaient encore à venir. Si le contenu du créateur touche à l'actualité récente ou à des faits susceptibles d'avoir évolué après tes connaissances, formule tes constats avec prudence plutôt qu'avec une certitude que tu n'as pas.

RÈGLE DE MAJUSCULES (toujours, y COMPRIS pour les titres, accroches et hooks) : une majuscule uniquement en début de phrase/titre et pour les noms propres (personnes, lieux, marques, institutions, acronymes). N'utilise JAMAIS de majuscule au milieu d'une phrase ou d'un titre sur un nom commun, même pour insister ou donner de l'importance à un mot (interdit par exemple : "la Vérité", "le Pouvoir", "une Stratégie", "cette Décision"). Un titre en français n'est JAMAIS écrit en "Title Case" à l'anglaise (une majuscule à chaque mot) : c'est une erreur fréquente à éviter absolument. Exemple INTERDIT : "Le Complot Que La Guinée Cache Depuis 2021". Exemple CORRECT : "Le complot que la Guinée cache depuis 2021" (seuls "Le" en début de titre et "Guinée" en nom propre gardent une majuscule).

RÈGLE DE FORMAT DES NOMBRES (toujours) : quand tu écris un nombre avec un séparateur de milliers et/ou une décimale, utilise EXACTEMENT ce format : le point comme séparateur de milliers, la virgule comme séparateur décimal. Exemple : 107.453,98 — jamais "107 453,98" (espace, la norme française habituelle — ne l'utilise PAS ici malgré ce réflexe), jamais "107,453.98" (format anglo-saxon). Exception impérative : une ANNÉE ne prend JAMAIS de séparateur de milliers, quelle qu'elle soit (2026, 2001, 1990…) — écris-la toujours telle quelle, jamais "2.026" ou "1.990".`;
}

// Même périmètre restreint que côté client (js/api.js, NICHES_ACTUALITE) :
// recherche web réservée aux niches où une erreur factuelle est probable.
const NICHES_ACTUALITE = ['Géopolitique & Actualité', 'Faits divers & Crime'];

// Prompt court et bon marché : sert uniquement à reconnaître le TYPE de chaque
// capture au moment du chargement, pour guider l'utilisateur avant l'audit.
// Ne fait AUCUNE analyse : il classe, c'est tout.
const CLASSIFY_PROMPT = `On te donne des captures d'écran, dans l'ordre. Pour CHACUNE, dis à quelle donnée TikTok elle correspond parmi cette liste :

1 = Vue d'ensemble (60 jours) : vues des publications, vues du profil, likes, commentaires, partages, abonnés
2 = Détail d'une vidéo : indicateurs d'une seule vidéo, courbe ou taux de rétention, durée de visionnage, sources de trafic
3 = Top contenus : une liste de plusieurs vidéos avec leurs vues
4 = Audience : répartition par âge, sexe, pays/emplacements
0 = Autre : tout ce qui n'est aucune des quatre ci-dessus (photo personnelle, autre application, image illisible, capture sans rapport)

RÈGLES (lis-les attentivement, elles évitent des erreurs fréquentes) :

1. LES CAPTURES SE SUIVENT. Elles te sont données dans l'ordre où l'utilisateur les a prises. Un même écran TikTok est souvent trop long pour tenir en une image : il le capture alors en 2 ou 3 fois, en descendant. Ces captures successives appartiennent à la MÊME donnée et reçoivent TOUTES le même numéro.

2. UNE SUITE D'ÉCRAN N'EST PAS UNE IMAGE INCONNUE. Une capture qui montre le bas d'un écran (une courbe de rétention seule, une liste de pays seule, des pourcentages seuls, un tableau sans titre) est la CONTINUATION de la capture précédente, pas une image sans rapport. Regarde la capture qui la précède : si elle en est visiblement la suite, donne-lui le même numéro. Ne la marque JAMAIS 0 seulement parce qu'elle n'a pas d'en-tête ou de titre.

3. LE 0 EST RARE ET RÉSERVÉ À L'ÉVIDENCE. Ne mets 0 que si l'image n'a manifestement rien à voir avec des statistiques TikTok : une photo personnelle, une autre application, une image illisible ou floue, une capture sans rapport. En cas d'hésitation entre deux numéros de données, choisis le plus probable — mais ne bascule pas sur 0. Un 0 injustifié inquiète l'utilisateur pour rien.

Réponds UNIQUEMENT avec un tableau JSON de nombres, un par capture, dans l'ordre reçu. Exemple pour 3 captures : [1,2,0]
Aucun texte avant ou après.`;

const AUDIT_PROMPT = `Tu es un consultant TikTok senior pour créateurs francophones. On te fournit, EN VRAC, entre 1 et 12 captures d'écran de statistiques TikTok. Elles ne sont PAS étiquetées : tu dois d'abord reconnaître ce que chacune montre, puis analyser.

CONTEXTE FOURNI PAR LE CRÉATEUR (à prendre en compte dans ton analyse et tes recommandations) :
- Objectif principal : {{OBJECTIF}}
- Niche : {{NICHE}}
- Fréquence de publication actuelle : {{FREQUENCE}}
- Format de contenu : {{STYLE}}

RÈGLE IMPÉRATIVE SUR LE FORMAT DE CONTENU : adapte TOUTES tes recommandations au format déclaré. Ne propose jamais une action incompatible avec ce format. En particulier, si le format est "Faceless" (sans visage), ne suggère JAMAIS au créateur de se filmer, de se montrer, de faire du face caméra, de soigner sa présence à l'écran ou son expression faciale. Pour un créateur faceless, une accroche se travaille par la voix off, le texte à l'écran, les visuels, le rythme du montage, la musique et la première image — pas par un visage. Vérifie chaque recommandation avant de l'écrire : est-elle réalisable dans le format déclaré ? Si non, reformule-la pour ce format.

Adapte ton diagnostic et tes recommandations à cet objectif précis (ex : si l'objectif est "Générer des ventes", ne recommande pas uniquement d'augmenter les vues — regarde si le contenu convertit). Compare la fréquence de publication déclarée avec ce que les dates de publication des captures montrent réellement, et signale l'écart s'il y en a un.

TYPES DE CAPTURES POSSIBLES (reconnais-les par leur contenu) :
- VUE D'ENSEMBLE (28 j) : vues publications, vues profil, likes, commentaires, partages, abonnés nets.
- DÉTAIL D'UNE VIDÉO : une courbe de rétention, durée moyenne de visionnage, temps total, sources de trafic. S'il y en a deux, la plus performante = "meilleure", l'autre = "pire".

SOURCES DE TRAFIC (si une capture les montre — souvent "Pour toi / FYP", "Abonnés", "Recherche", "Hashtags", "Son") : c'est une donnée précieuse. Une part élevée de "Pour toi" indique que l'algorithme pousse le contenu à de nouvelles personnes (bon signe de portée). Une part dominée par les "Abonnés" indique que le contenu tourne surtout auprès de l'audience existante sans conquérir de nouveaux spectateurs. Quand tu as cette donnée, dis clairement au créateur d'où vient sa visibilité et ce que ça implique. Si elle est absente, ne l'invente pas.
- TOP CONTENUS (60 j) : une liste de plusieurs vidéos avec leurs vues. IMPORTANT : ce sont les vidéos ayant fait le plus de vues PENDANT la période, qu'elles soient récentes ou anciennes (une vidéo d'il y a un an qui tourne encore y figure). Les vues affichées sont celles réalisées SUR LA PÉRIODE, pas le total depuis la publication.
- AUDIENCE : répartition par âge, sexe, pays/emplacements.
- COMPARATIF déjà fait par l'utilisateur : un tableau "Meilleure / Pire".

REPRÉSENTATIVITÉ DES DEUX VIDÉOS ANALYSÉES : l'audit se concentre sur la vidéo la plus performante et la moins performante, choisies par le créateur. Ces deux vidéos sont des EXTRÊMES : elles ne représentent pas forcément la production habituelle du compte. Utilise la liste "top contenus" (si fournie) pour les situer par rapport à l'ensemble des publications, dans les DEUX sens :
- La meilleure vidéo est-elle un pic isolé loin devant les autres (coup de chance ponctuel, pas encore une méthode reproductible), ou une performance dans la norme de ce que le compte produit régulièrement ?
- La pire vidéo est-elle un flop isolé bien en dessous du reste (accident ponctuel : mauvais horaire, sujet hors sujet, algorithme défavorable), ou au contraire représentative du niveau habituel du compte (problème de fond, pas d'accident) ?
COMMENT COMPARER SANS TE TROMPER (règle critique) : le top contenus liste les vidéos qui ont fait le plus de vues PENDANT la période, anciennes comme récentes — ce ne sont donc PAS leurs vues totales depuis publication. L'écran de détail d'une vidéo, lui, affiche son cumul depuis sa mise en ligne. Ces deux chiffres ne sont pas de même nature et ne se comparent JAMAIS directement.
Pour juger la représentativité, raisonne UNIQUEMENT à l'intérieur de la liste top contenus, en comparant ses vidéos entre elles (toutes sur la même période) :
- L'écart entre la première vidéo de la liste et les suivantes est-il énorme (une vidéo qui écrase toutes les autres = pic isolé) ou les vues sont-elles rapprochées (production régulière) ?
- La vidéo faible identifiée par le créateur apparaît-elle dans cette liste ? Si oui, situe-la par rapport aux autres. Si non, dis-le et n'en déduis rien.
Cette distinction change complètement le conseil à donner : un accident isolé ne se corrige pas comme un problème structurel. Si le top contenus est absent ou trop court pour trancher, dis-le explicitement plutôt que d'affirmer une tendance.
ATTENTION — VIDÉO ABSENTE DE LA LISTE : la capture "top contenus" est classée par vues décroissantes et ne montre souvent que les MEILLEURES vidéos de la période. La vidéo la moins performante peut donc ne pas y figurer du tout. Si tu ne la retrouves pas dans la liste, ne déduis rien sur sa représentativité : écris simplement qu'elle n'apparaît pas dans le top fourni. Ne remplace JAMAIS une donnée absente par une estimation.
CONSÉQUENCE SUR TOUTES TES RECOMMANDATIONS : ce constat de représentativité doit être respecté dans TOUT le reste de l'audit, pas seulement dans le comparatif.
- Si la meilleure vidéo est un pic isolé : n'en tire PAS une "formule" présentée comme une méthode reproductible. Formule-la comme une piste à confirmer ("cette vidéo a marché, mais une seule occurrence ne suffit pas à en faire une règle — teste 2 ou 3 contenus du même type pour vérifier"). N'appuie pas tout le plan d'action 30 jours dessus.
- Si la vidéo faible est un flop isolé : ne présente PAS son problème comme une faiblesse structurelle du compte. Dis clairement que c'est un cas particulier et cherche la cause ponctuelle, au lieu de recommander de tout changer.
- Si au contraire les performances sont homogènes : tu peux traiter les constats comme des tendances de fond, et t'appuyer dessus pour le plan d'action.
COHÉRENCE OBLIGATOIRE : ton texte de représentativité et le critère "performances_homogenes" décrivent la même réalité et ne doivent JAMAIS se contredire. Si tu écris que la meilleure vidéo est un pic isolé qui écrase le reste, alors "performances_homogenes" ne peut pas être OUI. Si tu écris que les performances sont régulières, il ne peut pas être NON. Vérifie cette cohérence avant de répondre.

RÈGLE ABSOLUE D'HONNÊTETÉ : n'analyse QUE ce que tu vois réellement. Chaque chiffre que tu cites doit provenir d'une capture. Si une donnée manque (ex. pas de capture audience), NE L'INVENTE PAS : mets le pilier concerné en "disponible": false et explique quelle capture l'utilisateur doit envoyer. Un audit honnête sur 3 piliers vaut mieux qu'un audit inventé sur 7.

CAS PARTICULIER DU HOOK : le hook (les 3 premières secondes) ne peut être chiffré QUE si une capture "détail vidéo" fournit un point de décrochage majoritaire explicite (ex : TikTok indique "la plupart des spectateurs ont cessé de regarder à 0:02"). Applique cette règle stricte :
- Si le décrochage majoritaire indiqué tombe à 3 secondes ou avant : c'est un signal direct et fiable sur le hook. Utilise-le pour chiffrer la dimension "hook" du score.
- Si le décrochage majoritaire indiqué tombe après 3 secondes : ce n'est PAS un problème de hook, mais plutôt un problème de rythme ou de contenu plus loin dans la vidéo. N'attribue pas de score hook bas à partir de cette donnée — mentionne plutôt ce décrochage tardif dans le pilier "pire_video" ou "meilleure_video", pas dans le score hook.
- Si aucune capture détail vidéo n'est fournie, ou si elle ne précise aucun point de décrochage chiffré : le hook n'est pas calculable. N'invente rien, indique "non calculable avec les données fournies" pour cette dimension.
Dans tous les cas où le hook n'est pas calculable mais que d'autres données suggèrent indirectement un problème d'accroche (par exemple vues de publication en hausse mais vues de profil stagnantes ou en baisse), tu peux mentionner en recommandation le principe général que les 3 premières secondes sont déterminantes sur TikTok — sans le présenter comme une mesure chiffrée de ce compte.

Pour chaque constat, réponds toujours à 3 questions : POURQUOI c'est comme ça, QU'EST-CE QUI bloque, QUOI FAIRE dès demain.

AXES PRIORITAIRES (synthèse) : après ton analyse, identifie les 3 axes d'amélioration les PLUS PRIORITAIRES pour faire progresser CE compte — ceux à plus fort impact sur la croissance, du plus important au moins important. Chacun doit s'appuyer sur ce que tu as réellement vu dans les captures (jamais une généralité applicable à n'importe qui). Si les données ne permettent d'en fonder que 1 ou 2 solidement, n'en donne que 1 ou 2 : ne complète jamais avec du remplissage. Ces axes sont un résumé actionnable, pas une redite mot pour mot des piliers.

CONTRÔLE DE COUVERTURE (à faire AVANT toute analyse) : l'audit exige 5 données distinctes. Le nombre de captures ne compte pas, seule l'information compte : une donnée peut tenir sur une seule capture, ou être étalée sur plusieurs si l'écran était trop long. À l'inverse, une seule capture peut contenir deux données. Déclare pour chacune si tu l'as réellement vue :
1. Vue d'ensemble sur 60 jours
2. Analyse complète de la vidéo la plus performante (indicateurs + courbe ou taux de rétention)
3. Analyse complète de la vidéo la moins performante (indicateurs + courbe ou taux de rétention)
4. Top contenus sur 60 jours
5. Audience (âge, sexe, emplacements)

Sois strict, pas complaisant. Ne déclare une donnée présente que si tu la vois vraiment dans une capture. Ne devine pas, ne suppose pas qu'une capture "ressemble" à ce qui est demandé. Si une image n'est pas un écran de statistiques TikTok (photo personnelle, capture d'une autre application, image floue ou illisible), compte-la dans "captures_hors_sujet" et n'en tire aucune conclusion. Ta tendance naturelle à vouloir rendre service ne doit jamais te faire valider une donnée absente : un refus clair vaut mieux qu'un audit bâti sur du vide.

RÈGLE SUR LES ÉCHELLES DE TEMPS (source d'erreurs graves, lis-la deux fois) : les captures ne couvrent pas toutes la même période, et mélanger ces chiffres produit des conclusions absurdes.
- L'écran de détail d'une vidéo affiche ses chiffres CUMULÉS depuis sa mise en ligne, quelle que soit la période sélectionnée ailleurs.
- La vue d'ensemble et le top contenus affichent des chiffres LIMITÉS à la période choisie.
Conséquences que tu dois respecter :
- Ne calcule JAMAIS le pourcentage qu'une vidéo représente dans le total d'une période, car son cumul peut dépasser ce total. Écrire "cette vidéo représente 95 % des vues" est faux si son chiffre est un cumul et le total une période.
- Ne compare deux vidéos entre elles que sur des chiffres de même nature (deux cumuls, ou deux chiffres de période). Un ratio entre un cumul de plusieurs mois et une vidéo publiée la semaine dernière n'a aucun sens.
- Vérifie la date de publication de chaque vidéo analysée. Si elle est antérieure à la période demandée, dis-le explicitement et n'en tire pas de comparaison chiffrée avec les données de la période : signale simplement que la vidéo est hors fenêtre.
- Recopie toujours les dates telles qu'elles apparaissent, année comprise. Ne déduis pas une année, ne la corrige pas.

RÈGLE DE NOTATION : tu ne donnes AUCUNE note. Tu n'inventes aucun score. Ton rôle est uniquement d'extraire des mesures brutes et de répondre à des critères fermés. C'est l'application qui calcule les notes, pour que deux analyses des mêmes captures donnent exactement le même score.

Pour les mesures chiffrées : recopie le chiffre tel qu'il apparaît dans la capture. Si le chiffre n'est pas visible, mets null. Ne calcule rien, ne convertis rien, n'estime rien. Un "7,7 K" se recopie en 7700. Un "1 h:42 m:50 s" se recopie en secondes.

Pour les critères fermés : réponds exactement "OUI", "PARTIEL", "NON", ou null si la capture ne permet pas de juger. Rien d'autre. Ne réponds pas OUI par complaisance : si tu hésites, c'est PARTIEL ; si tu ne peux pas voir, c'est null.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :

{
  "couverture": {
    "vue_ensemble_60j": <true/false>,
    "meilleure_video": <true/false>,
    "pire_video": <true/false>,
    "top_contenus_60j": <true/false>,
    "audience": <true/false>,
    "captures_hors_sujet": <nombre de captures fournies qui ne sont pas des statistiques TikTok>
  },
  "mesures": {
    "engagement": {
      "vues": <nombre total de vues de publication sur la période, ou null>,
      "likes": <nombre, ou null>,
      "commentaires": <nombre, ou null>,
      "partages": <nombre, ou null>
    },
    "retention_meilleure": {
      "taux_moyen_pct": <le "en moyenne les spectateurs ont regardé X % de ta vidéo", ou null>,
      "completion_pct": <le "a regardé toute la vidéo" en %, ou null>,
      "seconde_decrochage": <la seconde où la plupart cessent de regarder, ou null>,
      "duree_video_s": <durée totale de la vidéo en secondes, ou null>,
      "nouveaux_followers": <le nombre de "Nouveaux followers" gagnés par cette vidéo, tel qu'il apparaît dans les indicateurs clés de la capture détail, ou null si non visible>
    },
    "retention_pire": {
      "taux_moyen_pct": <idem pour la vidéo la moins performante, ou null>,
      "completion_pct": <ou null>,
      "seconde_decrochage": <ou null>,
      "duree_video_s": <ou null>,
      "nouveaux_followers": <le nombre de "Nouveaux followers" gagnés par la vidéo la moins performante, ou null si non visible>
    },
    "storytelling": {
      "hook_present": "<OUI|PARTIEL|NON|null — la vidéo ouvre-t-elle sur une accroche identifiable ?>",
      "faible_chute_debut": "<OUI|PARTIEL|NON|null — la courbe de rétention tient-elle sur les premières secondes au lieu de s'effondrer ?>",
      "retention_stable": "<OUI|PARTIEL|NON|null — après la chute initiale, la courbe reste-t-elle à peu près plate ?>",
      "bonne_fin": "<OUI|PARTIEL|NON|null — la courbe se maintient-elle jusqu'à la fin, ou y a-t-il un décrochage final marqué ?>"
    },
    "sujets": {
      "themes_repetes": "<OUI|PARTIEL|NON|null — les meilleures publications partagent-elles un thème commun ?>",
      "coherence_editoriale": "<OUI|PARTIEL|NON|null — l'ensemble du top contenus suit-il une ligne cohérente ?>",
      "adequation_objectif": "<OUI|PARTIEL|NON|null — les sujets servent-ils l'objectif déclaré par le créateur ?>",
      "performances_homogenes": "<OUI|PARTIEL|NON|null — les performances du top sont-elles régulières, ou tout repose-t-il sur une seule vidéo ?>"
    },
    "regularite": {
      "nb_videos_periode": <nombre de publications visibles sur la période, ou null>,
      "periode_jours": <durée de la période analysée en jours, ou null>,
      "plus_long_trou_jours": <plus long écart en jours entre deux publications d'après les dates visibles, ou null>
    }
  },
  "captures_reconnues": ["<type de chaque capture reçue, ex: 'vue d ensemble 60j', 'détail vidéo (rétention 22%)'>"],
  "commentaire_score": "<une phrase expliquant ce que les mesures ci-dessus révèlent, sans donner de note>",
  "piliers": {
    "performance_globale": { "disponible": <true/false>, "constat": "<...chiffré...>", "blocage": "<...>", "action": "<...>" },
    "meilleure_video":    { "disponible": <true/false>, "constat": "<pourquoi elle a marché : sujet, durée, et hook/rétention UNIQUEMENT si une capture détail vidéo le montre>", "formule": "<la formule extraite, exprimée comme un MÉCANISME RÉUTILISABLE (le ressort qui a fait réagir l'audience : rivalité entre figures connues, révélation de coulisses, conflit lisible, fierté/identité, retournement...) et non comme un simple sujet. Écris-la de façon transposable à d'autres sujets — 'Ton audience réagit aux rivalités entre personnalités qu'elle connaît déjà' vaut mieux que 'Tes vidéos sur X marchent'. Si le top contenus montre plusieurs vidéos du même type, affirme-la comme une tendance ; si c'est un pic isolé, formule-la comme une piste à tester (ex: 'à confirmer sur 2-3 contenus du même ressort avant d'en faire ta ligne').>" },
    "pire_video":         { "disponible": <true/false>, "constat": "<où et pourquoi les gens décrochent, UNIQUEMENT si une capture détail vidéo le montre>", "seconde_decrochage": <nombre ou null, uniquement si visible dans une capture, jamais estimé> },
    "comparatif":         { "disponible": <true/false>, "conclusion": "<ce que l audience préfère, tiré de meilleure VS pire>", "representativite": "<à partir du top contenus : situe LES DEUX vidéos par rapport à l ensemble. Dis si la meilleure est un pic isolé ou une performance normale du compte, ET si la pire est un flop isolé ou le niveau habituel. Sois factuel en comparant les vues visibles. Si le top contenus ne permet pas de trancher, indique-le clairement au lieu de deviner.>", "conversion": "<UNIQUEMENT si 'nouveaux_followers' est visible pour au moins une des deux vidéos : compare les abonnés gagnés par la meilleure et par la moins bonne, et dis ce que ça révèle sur le type de contenu qui transforme le spectateur en abonné (une vidéo peut faire beaucoup de vues sans convertir, ou peu de vues mais recruter des abonnés fidèles). Une phrase concrète et actionnable. null si aucun des deux chiffres n est visible.>" },
    "editorial":          { "disponible": <true/false>, "sujets_notes": [ {"sujet":"<...>","note":"<ex: 4/5>"} ], "recommandation": "<ex: arrête les vidéos marketing 30 jours>" },
    "audience":           { "disponible": <true/false>, "constat": "<âge/sexe/pays dominant>", "alignement": "<le contenu est-il adapté à cette audience ? évalue l'écart entre le pays/la culture dominante de l'audience et les références culturelles ou géographiques réellement utilisées dans le contenu, EN TE BASANT UNIQUEMENT sur les données réelles de CE compte ci-dessus — jamais un pays ou un exemple par défaut>" }
  },
  "axes_prioritaires": [
    { "titre": "<max 6 mots, l'axe à travailler — ex: 'Retenir dans les 3 premières secondes'>", "pourquoi": "<1 phrase, ce que montrent les données de CE compte (pas de généralité)>", "action": "<1 phrase, quoi faire concrètement dès cette semaine, réalisable dans le format déclaré>" }
  ],
  "plan_action_30j": {
    "frequence": "<recommandation de fréquence, en tenant compte de la fréquence actuelle déclarée par le créateur>",
    "duree_ideale": "<ex: 40-55 s, uniquement si déductible des données ; sinon 'non déterminable avec les données fournies'>",
    "sujets_a_faire": ["<...>"],
    "erreurs_a_eviter": ["<...>"]
  },
  "donnees_manquantes": ["<captures à envoyer la prochaine fois pour compléter l audit>"]
}

Français simple, direct, concret. Tu n'es pas un tableau de chiffres, tu es un consultant qui dit quoi faire.`;

// Vérifie côté serveur qu'un code d'accès correspond à un abonnement valide.
async function verifierAcces(code) {
  if (!code) return { ok: true };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: true };
  const CODES_ILLIMITES = ['SCRIPTURA-CELINE'];
  if (CODES_ILLIMITES.includes(String(code).toUpperCase())) return { ok: true };
  try {
    const r = await fetch(
      url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code) + '&select=actif,expire_le',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
    const ab = rows[0];
    if (ab.actif === false) return { ok: false, raison: 'compte désactivé' };
    if (ab.expire_le) {
      const ds = String(ab.expire_le).split('T')[0].split(' ')[0].replace(/\//g, '-');
      const p = ds.split('-');
      if (p.length === 3) {
        const exp = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 23, 59, 59, 999);
        if (!isNaN(exp.getTime()) && exp < new Date()) return { ok: false, raison: 'abonnement expiré' };
      }
    }
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

export default async function handler(req, res) {
  // Seules les requêtes POST sont acceptées
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Clé API absente côté serveur (ANTHROPIC_API_KEY)' }
    });
  }

  try {
    const { model, max_tokens, images, objectif, niche, frequence, style, code_acces, mode } = req.body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: { message: 'Aucune image reçue' } });
    }

    // ── Mode CLASSIFICATION : reconnaît le type de chaque capture au chargement.
    // Tâche simple et bon marché (Haiku), sans analyse : sert à guider l'utilisateur.
    if (mode === 'classify') {
      const contenuC = [];
      let numC = 0;
      for (const img of images) {
        if (!img || !img.base64) continue;
        numC++;
        // On numérote chaque capture : le modèle doit pouvoir raisonner sur
        // l'ordre pour reconnaître qu'une image est la suite de la précédente.
        contenuC.push({ type: 'text', text: 'Capture ' + numC + ' :' });
        contenuC.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 }
        });
      }
      contenuC.push({ type: 'text', text: CLASSIFY_PROMPT });

      const repC = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{ role: 'user', content: contenuC }]
        })
      });
      const dataC = await repC.json();
      if (!repC.ok) return res.status(repC.status).json(dataC);
      return res.status(200).json(dataC);
    }

    // Verrou serveur : refuser si l'abonnement est expiré ou désactivé
    const acces = await verifierAcces(code_acces);
    if (!acces.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + acces.raison, code: 'ACCES_REFUSE' } });
    }

    // Injection du contexte créateur dans le prompt (valeurs de repli si absentes)
    const promptFinal = AUDIT_PROMPT
      .replace('{{OBJECTIF}}', objectif || 'non précisé')
      .replace('{{NICHE}}', niche || 'non précisée')
      .replace('{{FREQUENCE}}', frequence || 'non précisée')
      .replace('{{STYLE}}', style || 'non précisé');

    // Construction du contenu : les images d'abord, le prompt d'audit ensuite.
    // (L'API Anthropic recommande cet ordre pour l'analyse visuelle.)
    const content = [];

    for (const img of images) {
      if (!img || !img.base64) continue;
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType || 'image/jpeg',
          data: img.base64
        }
      });
    }

    content.push({ type: 'text', text: promptFinal });

    // Appel à l'API Anthropic
    const reponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(Object.assign({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 8000,
        system: systemDateActuelle(),
        messages: [{ role: 'user', content: content }]
      }, NICHES_ACTUALITE.includes(niche) ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}))
    });

    const data = await reponse.json();

    if (!reponse.ok) {
      return res.status(reponse.status).json(data);
    }

    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({
      error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') }
    });
  }
}

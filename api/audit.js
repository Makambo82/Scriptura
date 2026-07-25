// ═══════════════════════════════════════════════════════════
//  /api/audit — Fonction dédiée au mode "Analyse mon compte TikTok"
//  Reçoit des captures d'écran (images) + le contexte du créateur
//  (objectif, niche, fréquence), les transmet à l'API Anthropic
//  avec le prompt d'audit, renvoie la réponse.
//
//  Fichier INDÉPENDANT : ne touche pas aux autres modes de Scriptura.
// ═══════════════════════════════════════════════════════════

const AUDIT_PROMPT = `Tu es un consultant TikTok senior pour créateurs francophones. On te fournit, EN VRAC, entre 1 et 10 captures d'écran de statistiques TikTok. Elles ne sont PAS étiquetées : tu dois d'abord reconnaître ce que chacune montre, puis analyser.

CONTEXTE FOURNI PAR LE CRÉATEUR (à prendre en compte dans ton analyse et tes recommandations) :
- Objectif principal : {{OBJECTIF}}
- Niche : {{NICHE}}
- Fréquence de publication actuelle : {{FREQUENCE}}
- Style de contenu : {{STYLE}}

RÈGLE IMPÉRATIVE SUR LE STYLE DE CONTENU : adapte TOUTES tes recommandations au style déclaré. Ne propose jamais une action incompatible avec ce format. En particulier, si le style est "Faceless (sans visage)", ne suggère JAMAIS au créateur de se filmer, de se montrer, de faire du face caméra, de soigner sa présence à l'écran ou son expression faciale. Pour un créateur faceless, une accroche se travaille par la voix off, le texte à l'écran, les visuels, le rythme du montage, la musique et la première image — pas par un visage. Vérifie chaque recommandation avant de l'écrire : est-elle réalisable dans le style déclaré ? Si non, reformule-la pour ce style.

Adapte ton diagnostic et tes recommandations à cet objectif précis (ex : si l'objectif est "Générer des ventes", ne recommande pas uniquement d'augmenter les vues — regarde si le contenu convertit). Compare la fréquence de publication déclarée avec ce que les dates de publication des captures montrent réellement, et signale l'écart s'il y en a un.

TYPES DE CAPTURES POSSIBLES (reconnais-les par leur contenu) :
- VUE D'ENSEMBLE (28 j) : vues publications, vues profil, likes, commentaires, partages, abonnés nets.
- DÉTAIL D'UNE VIDÉO : une courbe de rétention, durée moyenne de visionnage, temps total, sources de trafic. S'il y en a deux, la plus performante = "meilleure", l'autre = "pire".
- TOP CONTENUS (60 j) : une liste de plusieurs vidéos avec leurs vues.
- AUDIENCE : répartition par âge, sexe, pays/emplacements.
- COMPARATIF déjà fait par l'utilisateur : un tableau "Meilleure / Pire".

RÈGLE ABSOLUE D'HONNÊTETÉ : n'analyse QUE ce que tu vois réellement. Chaque chiffre que tu cites doit provenir d'une capture. Si une donnée manque (ex. pas de capture audience), NE L'INVENTE PAS : mets le pilier concerné en "disponible": false et explique quelle capture l'utilisateur doit envoyer. Un audit honnête sur 3 piliers vaut mieux qu'un audit inventé sur 7.

CAS PARTICULIER DU HOOK : le hook (les 3 premières secondes) ne peut être chiffré QUE si une capture "détail vidéo" fournit un point de décrochage majoritaire explicite (ex : TikTok indique "la plupart des spectateurs ont cessé de regarder à 0:02"). Applique cette règle stricte :
- Si le décrochage majoritaire indiqué tombe à 3 secondes ou avant : c'est un signal direct et fiable sur le hook. Utilise-le pour chiffrer la dimension "hook" du score.
- Si le décrochage majoritaire indiqué tombe après 3 secondes : ce n'est PAS un problème de hook, mais plutôt un problème de rythme ou de contenu plus loin dans la vidéo. N'attribue pas de score hook bas à partir de cette donnée — mentionne plutôt ce décrochage tardif dans le pilier "pire_video" ou "meilleure_video", pas dans le score hook.
- Si aucune capture détail vidéo n'est fournie, ou si elle ne précise aucun point de décrochage chiffré : le hook n'est pas calculable. N'invente rien, indique "non calculable avec les données fournies" pour cette dimension.
Dans tous les cas où le hook n'est pas calculable mais que d'autres données suggèrent indirectement un problème d'accroche (par exemple vues de publication en hausse mais vues de profil stagnantes ou en baisse), tu peux mentionner en recommandation le principe général que les 3 premières secondes sont déterminantes sur TikTok — sans le présenter comme une mesure chiffrée de ce compte.

Pour chaque constat, réponds toujours à 3 questions : POURQUOI c'est comme ça, QU'EST-CE QUI bloque, QUOI FAIRE dès demain.

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
      "duree_video_s": <durée totale de la vidéo en secondes, ou null>
    },
    "retention_pire": {
      "taux_moyen_pct": <idem pour la vidéo la moins performante, ou null>,
      "completion_pct": <ou null>,
      "seconde_decrochage": <ou null>,
      "duree_video_s": <ou null>
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
    "meilleure_video":    { "disponible": <true/false>, "constat": "<pourquoi elle a marché : sujet, durée, et hook/rétention UNIQUEMENT si une capture détail vidéo le montre>", "formule": "<la formule extraite, ex: 'Tes histoires personnelles font 2,5x plus de vues'>" },
    "pire_video":         { "disponible": <true/false>, "constat": "<où et pourquoi les gens décrochent, UNIQUEMENT si une capture détail vidéo le montre>", "seconde_decrochage": <nombre ou null, uniquement si visible dans une capture, jamais estimé> },
    "comparatif":         { "disponible": <true/false>, "conclusion": "<ce que l audience préfère, tiré de meilleure VS pire>" },
    "editorial":          { "disponible": <true/false>, "sujets_notes": [ {"sujet":"<...>","note":"<ex: 4/5>"} ], "recommandation": "<ex: arrête les vidéos marketing 30 jours>" },
    "audience":           { "disponible": <true/false>, "constat": "<âge/sexe/pays dominant>", "alignement": "<le contenu est-il adapté à cette audience ? ex: 70% France mais références 100% béninoises>" }
  },
  "plan_action_30j": {
    "frequence": "<recommandation de fréquence, en tenant compte de la fréquence actuelle déclarée par le créateur>",
    "duree_ideale": "<ex: 40-55 s, uniquement si déductible des données ; sinon 'non déterminable avec les données fournies'>",
    "sujets_a_faire": ["<...>"],
    "erreurs_a_eviter": ["<...>"]
  },
  "donnees_manquantes": ["<captures à envoyer la prochaine fois pour compléter l audit>"]
}

Français simple, direct, concret. Tu n'es pas un tableau de chiffres, tu es un consultant qui dit quoi faire.`;

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
    const { model, max_tokens, images, objectif, niche, frequence, style } = req.body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: { message: 'Aucune image reçue' } });
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
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 8000,
        messages: [{ role: 'user', content: content }]
      })
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

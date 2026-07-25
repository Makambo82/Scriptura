// ═══════════════════════════════════════════════════════════
//  /api/audit — Fonction dédiée au mode "Analyse mon compte TikTok"
//  Reçoit des captures d'écran (images) + le contexte du créateur
//  (objectif, niche, fréquence), les transmet à l'API Anthropic
//  avec le prompt d'audit, renvoie la réponse.
//
//  Fichier INDÉPENDANT : ne touche pas aux autres modes de Scriptura.
// ═══════════════════════════════════════════════════════════

const AUDIT_PROMPT = `Tu es un consultant TikTok senior pour créateurs francophones. On te fournit, EN VRAC, entre 1 et 8 captures d'écran de statistiques TikTok. Elles ne sont PAS étiquetées : tu dois d'abord reconnaître ce que chacune montre, puis analyser.

CONTEXTE FOURNI PAR LE CRÉATEUR (à prendre en compte dans ton analyse et tes recommandations) :
- Objectif principal : {{OBJECTIF}}
- Niche : {{NICHE}}
- Fréquence de publication actuelle : {{FREQUENCE}}

Adapte ton diagnostic et tes recommandations à cet objectif précis (ex : si l'objectif est "Générer des ventes", ne recommande pas uniquement d'augmenter les vues — regarde si le contenu convertit). Compare la fréquence de publication déclarée avec ce que les dates de publication des captures montrent réellement, et signale l'écart s'il y en a un.

TYPES DE CAPTURES POSSIBLES (reconnais-les par leur contenu) :
- VUE D'ENSEMBLE (28 j) : vues publications, vues profil, likes, commentaires, partages, abonnés nets.
- DÉTAIL D'UNE VIDÉO : une courbe de rétention, durée moyenne de visionnage, temps total, sources de trafic. S'il y en a deux, la plus performante = "meilleure", l'autre = "pire".
- TOP CONTENUS (60 j) : une liste de plusieurs vidéos avec leurs vues.
- AUDIENCE : répartition par âge, sexe, pays/emplacements.
- COMPARATIF déjà fait par l'utilisateur : un tableau "Meilleure / Pire".

RÈGLE ABSOLUE D'HONNÊTETÉ : n'analyse QUE ce que tu vois réellement. Chaque chiffre que tu cites doit provenir d'une capture. Si une donnée manque (ex. pas de capture audience), NE L'INVENTE PAS : mets le pilier concerné en "disponible": false et explique quelle capture l'utilisateur doit envoyer. Un audit honnête sur 3 piliers vaut mieux qu'un audit inventé sur 7.

CAS PARTICULIER DU HOOK : tu n'as pas de mesure fiable de rétention précise (chute à 3 secondes, seconde exacte de décrochage) sauf si une capture "détail vidéo" avec courbe de rétention labellisée est explicitement fournie. Si elle est absente, ne chiffre jamais le hook ni la rétention dans le score. Tu peux uniquement, si les données suggèrent indirectement un problème d'accroche (par exemple vues de publication en hausse mais vues de profil stagnantes ou en baisse), mentionner en recommandation le principe général que les 3 premières secondes sont déterminantes sur TikTok — sans le présenter comme une mesure de ce compte.

Pour chaque constat, réponds toujours à 3 questions : POURQUOI c'est comme ça, QU'EST-CE QUI bloque, QUOI FAIRE dès demain.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :

{
  "captures_reconnues": ["<type de chaque capture reçue, ex: 'vue d ensemble 28j', 'détail vidéo (rétention 71%)'>"],
  "tiktok_score": {
    "storytelling": <0-25>, "sujets": <0-25>, "engagement": <0-30>, "regularite": <0-20>,
    "global": <0-100>,
    "levier": "<la dimension qui, améliorée, ferait le plus monter le score>"
  },
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
    const { model, max_tokens, images, objectif, niche, frequence } = req.body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: { message: 'Aucune image reçue' } });
    }

    // Injection du contexte créateur dans le prompt (valeurs de repli si absentes)
    const promptFinal = AUDIT_PROMPT
      .replace('{{OBJECTIF}}', objectif || 'non précisé')
      .replace('{{NICHE}}', niche || 'non précisée')
      .replace('{{FREQUENCE}}', frequence || 'non précisée');

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
        max_tokens: max_tokens || 4000,
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

// api/generate.js, Fonction serverless Vercel
// Garde la clé API secrète, vérifie l'abonnement ET le quota du mode
// demandé, puis relaie vers Anthropic. Voir api/_lib/acces.js pour le détail
// de la résolution des droits (le serveur ne fait plus confiance au client :
// ni pour le plan, ni pour le quota, ni pour le modèle/nombre de tokens).
import { resoudreDroits, verifierQuota, verifierLimiteAnonyme, verifierAccesProOuJeton, MAX_FREE } from './_lib/acces.js';

// Seuls modèles réellement utilisés par l'app pour ce type d'appel (voir
// MODEL_CREATIF/MODEL_RAPIDE/MODEL_QUALITE_RECIT, js/api.js) : un modèle
// demandé hors de cette liste retombe sur le défaut, jamais transmis tel
// quel à Anthropic. claude-sonnet-4-6 : Critique + Réviseur du récit
// (js/storytelling.js) seulement, jugement créatif fin que Haiku jugeant
// Haiku ne rendait pas fidèlement ; toujours plafonné par le même quota et
// le même MAX_TOKENS_PLAFOND que le reste de ce endpoint.
const MODELES_AUTORISES = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6']);
const MODELE_DEFAUT = 'claude-haiku-4-5-20251001';
// Plafond dur, aligné sur le plus gros appel légitime existant (écriture du
// script complet, 16000, voir js/generation.js/js/storytelling.js).
const MAX_TOKENS_PLAFOND = 16000;

const PLAFOND_ANONYME_JOUR = 15; // filet IP, générations gratuites sans code

// Date réelle du jour, injectée dans CHAQUE appel modèle (voir handler ci-dessous).
// Le modèle n'a autrement aucun moyen de savoir qu'on n'est plus à la date de
// ses connaissances d'entraînement : sans ce repère, il peut présenter une
// année déjà passée comme "à venir" ou "décisive" (ex. "2024 sera décisif"
// alors qu'on est en 2026). Formatage manuel (pas de dépendance ICU/locale).
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dateDuJourFr() {
  const now = new Date();
  return now.getUTCDate() + ' ' + MOIS_FR[now.getUTCMonth()] + ' ' + now.getUTCFullYear();
}
function systemDateActuelle() {
  return `Nous sommes le ${dateDuJourFr()}. Utilise cette date comme repère temporel réel et actuel, quelles que soient tes connaissances d'entraînement. Ne présente jamais un événement ou une année déjà passés comme s'ils étaient encore à venir ou "décisifs" pour l'avenir. Si un sujet touche à l'actualité récente, à la politique ou à des faits susceptibles d'avoir évolué après tes connaissances, formule tes affirmations avec prudence plutôt qu'avec une certitude que tu n'as pas, et signale-le si c'est pertinent pour le créateur.

RÈGLE DE MAJUSCULES (toujours, y COMPRIS pour les titres, accroches et hooks) : une majuscule uniquement en début de phrase/titre et pour les noms propres (personnes, lieux, marques, institutions, acronymes). N'utilise JAMAIS de majuscule au milieu d'une phrase ou d'un titre sur un nom commun, même pour insister ou donner de l'importance à un mot (interdit par exemple : "la Vérité", "le Pouvoir", "une Stratégie", "cette Décision"). Un titre en français n'est JAMAIS écrit en "Title Case" à l'anglaise (une majuscule à chaque mot) : c'est une erreur fréquente à éviter absolument. Exemple INTERDIT : "Le Complot Que La Guinée Cache Depuis 2021". Exemple CORRECT : "Le complot que la Guinée cache depuis 2021" (seuls "Le" en début de titre et "Guinée" en nom propre gardent une majuscule).

RÈGLE DE FORMAT DES NOMBRES (toujours) : quand tu écris un nombre avec un séparateur de milliers et/ou une décimale, utilise EXACTEMENT ce format : le point comme séparateur de milliers, la virgule comme séparateur décimal. Exemple : 107.453,98, jamais "107 453,98" (espace, la norme française habituelle, ne l'utilise PAS ici malgré ce réflexe), jamais "107,453.98" (format anglo-saxon). Exception impérative : une ANNÉE ne prend JAMAIS de séparateur de milliers, quelle qu'elle soit (2026, 2001, 1990…), écris-la toujours telle quelle, jamais "2.026" ou "1.990".`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  try {
    const { model, max_tokens, messages, code_acces, web_search, web_search_max_uses, mode } = req.body;
    const modeDemande = typeof mode === 'string' && mode ? mode : 'creation';

    // Résout les droits réels (plan/jetons/admin) DIRECTEMENT depuis Supabase
    // (service role), jamais depuis une valeur envoyée par le client.
    const droits = await resoudreDroits(code_acces);
    if (!droits.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });
    }

    // Quota : le mode Série (Pro ou jeton pour ENTRER, puis compte comme une
    // création normale une fois dedans, voir moyenSerie côté client) a un
    // traitement à part ; les autres modes suivent le quota mensuel/à vie
    // habituel (voir verifierQuota).
    let verdict;
    if (modeDemande === 'creationSerie') {
      if (droits.isAdmin || droits.illimite || droits.plan === 'pro') {
        verdict = await verifierQuota(droits, 'creation', code_acces);
      } else {
        verdict = await verifierAccesProOuJeton(droits, code_acces);
      }
    } else if (modeDemande === 'diagnosticFusion') {
      // Réservé au Pro, ne consomme AUCUN quota (synthèse de deux diagnostics
      // déjà payés séparément, voir js/diagnostic-fusion.js) : jusqu'ici
      // vérifié seulement côté client (monPalier() !== 'pro'), donc
      // contournable par un appel direct à cette route.
      verdict = (droits.isAdmin || droits.illimite || droits.plan === 'pro')
        ? { ok: true }
        : { ok: false, raison: 'acces_requis' };
    } else {
      if (droits.anonyme) {
        const limiteIP = await verifierLimiteAnonyme(req, 'generate', PLAFOND_ANONYME_JOUR);
        // Filet journalier (anti-abus, se recharge chaque jour) ET plafond
        // à vie pour la création (les "5 générations gratuites" annoncées
        // par l'interface) : sans ce second filet, un visiteur qui n'a
        // jamais tapé de code n'était borné que par le filet journalier,
        // rechargé chaque jour, donc jamais vraiment limité à 5 au total.
        const limiteAVie = (modeDemande === 'creation')
          ? await verifierLimiteAnonyme(req, 'generate_creation', MAX_FREE, true)
          : { ok: true };
        if (!limiteIP.ok) verdict = limiteIP;
        else if (!limiteAVie.ok) verdict = limiteAVie;
        else verdict = await verifierQuota(droits, modeDemande, code_acces);
      } else {
        verdict = await verifierQuota(droits, modeDemande, code_acces);
      }
    }
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: 'Quota atteint pour ce mode.', code: 'QUOTA_ATTEINT', raison: verdict.raison } });
    }

    // Modèle et nombre de tokens : jamais transmis tels quels, le serveur
    // décide des valeurs réellement autorisées.
    const modeleFinal = MODELES_AUTORISES.has(model) ? model : MODELE_DEFAUT;
    const maxTokensFinal = Math.min(Math.max(parseInt(max_tokens, 10) || 4000, 1), MAX_TOKENS_PLAFOND);

    const bodyAnthropic = {
      model: modeleFinal,
      max_tokens: maxTokensFinal,
      system: systemDateActuelle(),
      messages: messages
    };
    // Recherche web : réservée par le client aux cas qui en ont vraiment besoin
    // (sujets d'actualité/géopolitique/Histoire, voir NICHES_ACTUALITE côté
    // client js/api.js, ou tendances TikTok pour Recommandations/Idées),
    // jamais activée par défaut, pour ne pas ralentir/coûter plus cher sur les
    // sujets qui n'en ont pas besoin. max_uses par défaut à 1 : au-delà d'un
    // appel de rédaction déjà lourd (jusqu'à 16000 tokens), chaque recherche
    // supplémentaire ajoute un aller-retour réseau qui peut faire dépasser la
    // limite de temps côté client (55s) et produire une réponse tronquée,
    // vécu concrètement comme des échecs "réponse incomplète" en mode Script
    // après l'ajout de la recherche web. Le client peut demander jusqu'à 3
    // recherches (web_search_max_uses) pour ses appels plus légers (6000
    // tokens max, ex. Recommandations/Idées) qui combinent vérification de
    // faits et recherche de tendances ; borné ici côté serveur quoi qu'il arrive.
    if (web_search) {
      const maxUses = Math.min(Math.max(parseInt(web_search_max_uses, 10) || 1, 1), 3);
      bodyAnthropic.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(bodyAnthropic)
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + error.message } });
  }
}

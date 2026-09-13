// api/generate.js, Fonction serverless Vercel
// Garde la clé API secrète, vérifie l'abonnement ET le quota du mode
// demandé, puis relaie vers Anthropic. Voir api/_lib/acces.js pour le détail
// de la résolution des droits (le serveur ne fait plus confiance au client :
// ni pour le plan, ni pour le quota, ni pour le modèle/nombre de tokens).
import { resoudreDroits, verifierQuota, verifierLimiteAnonyme, verifierLimiteGenerique, verifierAccesProOuJeton, codeAccesRefuse, MAX_FREE } from './_lib/acces.js';

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

// ══ COMBIEN A COÛTÉ CET APPEL, RÉELLEMENT ══
//
// Anthropic renvoie l'usage en jetons à CHAQUE appel, et l'app le jetait :
// le chemin en flux ne relayait que le texte, le chemin classique renvoyait
// bien `usage` mais personne ne le lisait. Résultat : impossible de dire ce
// que coûte une génération autrement qu'en l'estimant, et une estimation ne
// permet aucune décision de prix ni de quota.
//
// Le séparateur d'enregistrement U+001E ferme le flux et précède le relevé.
// C'est un caractère de CONTRÔLE : un modèle ne l'écrit ni dans du texte ni
// dans du JSON, donc il ne peut pas apparaître au milieu d'une génération et
// être pris pour une frontière. Partagé avec js/api.js, qui le détache.
const SEPARATEUR_JETONS = '';

const PLAFOND_ANONYME_JOUR = 15; // filet IP, générations gratuites sans code
// LOT 2, audit A13 : ces deux modes sont hors quota de génération par
// conception (voir plus bas), mais n'avaient jusqu'ici AUCUNE limite
// serveur. Plafonds journaliers généreux, par identité (code si connu,
// sinon IP, voir verifierLimiteGenerique) : jamais l'intention de gêner un
// usage normal, seulement de border un abus scripté.
const PLAFOND_MICRO_EDIT_JOUR = 100;      // couvre ~5 scripts entiers à 20 retouches chacun (MICRO_EDIT_MAX_PAR_SCRIPT côté client)
const PLAFOND_DETECTION_NICHE_JOUR = 60;  // un appel par nouveau sujet tapé, largement au-dessus d'un usage normal

// LOT 4A, audit ID 2 (Gate Phase 2) : microEditScript/microEditRecit/
// detectionNiche n'étaient bridés que par le filet journalier ci-dessus
// (PLAFOND_MICRO_EDIT_JOUR/PLAFOND_DETECTION_NICHE_JOUR), jamais par la
// TAILLE de l'appel lui-même : max_tokens (jusqu'à MAX_TOKENS_PLAFOND,
// 16000), web_search (jusqu'à 3 recherches) et le modèle restaient ceux
// d'une génération complète, quel que soit le mode déclaré par le client. Un
// appel direct avec mode:'microEditScript' et un payload de génération
// complète passait donc le filet de 100/jour sans jamais toucher au quota
// mensuel `creation` (40 à 70/mois). Plafonds alignés sur le SEUL usage
// client réel de ces trois modes (jamais une valeur arbitraire) :
// microEditScript/microEditRecit, 300 tokens, js/generation.js:3514 et
// js/storytelling.js:1667 ; detectionNiche, jusqu'à 700 tokens (avec fichier
// joint), js/niche-auto.js:296,433. Aucun des trois n'active jamais la
// recherche web côté client, donc jamais autorisée ici non plus.
const PLAFONDS_MODE_LEGER = {
  microEditScript: { maxTokens: 300, webSearch: false },
  microEditRecit: { maxTokens: 300, webSearch: false },
  detectionNiche: { maxTokens: 700, webSearch: false }
};

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
    const { model, max_tokens, messages, code_acces, web_search, web_search_max_uses, mode, stream } = req.body;
    const modeDemande = typeof mode === 'string' && mode ? mode : 'creation';

    // Résout les droits réels (plan/jetons/admin) DIRECTEMENT depuis Supabase
    // (service role), jamais depuis une valeur envoyée par le client.
    const droits = await resoudreDroits(code_acces);
    if (!droits.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: codeAccesRefuse(droits) } });
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
    } else if (modeDemande === 'detectionNiche') {
      // Détection de la niche à partir du sujet (voir js/niche-auto.js) :
      // gratuite et hors quota par conception, exactement comme les
      // micro-éditions ci-dessous. C'est une aide de FORMULAIRE, remplie
      // avant même d'avoir généré quoi que ce soit : la facturer reviendrait
      // à faire payer le créateur pour remplir son propre formulaire, et à
      // le décourager de s'en servir.
      //
      // Elle reste minuscule par construction côté client (modèle rapide,
      // une trentaine de jetons de réponse, appelée seulement quand les
      // mots-clés n'ont rien trouvé, jamais deux fois pour le même texte).
      //
      // LOT 2, AUDIT A13 : jusqu'ici, un appelant IDENTIFIÉ (code_acces
      // fourni) passait ici sans AUCUNE limite serveur (`{ok:true}`
      // inconditionnel) - seul l'anonyme avait le filet IP. Un appel direct
      // et répété à cette route avec un code_acces quelconque déclenchait
      // donc des appels Anthropic illimités. Filet journalier générique
      // (voir verifierLimiteGenerique, api/_lib/acces.js) pour les deux cas,
      // généreux (60/jour, un appel par nouveau sujet tapé dans un usage
      // normal est très en dessous).
      verdict = droits.anonyme
        ? await verifierLimiteAnonyme(req, 'generate', PLAFOND_ANONYME_JOUR)
        : await verifierLimiteGenerique(req, code_acces, 'detection-niche', PLAFOND_DETECTION_NICHE_JOUR);
    } else if (modeDemande === 'microEditScript' || modeDemande === 'microEditRecit') {
      // Éditeur IA par passage (Reformuler/Raccourcir/Allonger/Simplifier,
      // voir js/generation.js et js/storytelling.js) : gratuit et hors quota
      // de génération par conception (un confort d'édition sur un script déjà
      // généré, pas une nouvelle génération). BUG CORRIGÉ (retour terrain) :
      // ces deux modes n'existaient dans AUCUNE limite de plan, verifierQuota()
      // les faisait donc retomber sur un plafond de 0 et refusait
      // systématiquement pour Creator/Pro.
      //
      // LOT 2, AUDIT A13 : le plafond MICRO_EDIT_MAX_PAR_SCRIPT (20,
      // js/generation.js) n'existe QUE côté client, trivialement contourné
      // par un appel direct à cette route - `{ok:true}` inconditionnel, MÊME
      // POUR UN ANONYME SANS CODE, permettait donc des appels Anthropic
      // illimités et totalement anonymes. Filet journalier générique (voir
      // verifierLimiteGenerique, api/_lib/acces.js), généreux (100/jour,
      // couvre 5 scripts entiers de 20 retouches chacun) : couvre l'usage
      // normal sans jamais permettre l'explosion illimitée d'avant.
      verdict = await verifierLimiteGenerique(req, code_acces, 'micro-edit', PLAFOND_MICRO_EDIT_JOUR);
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
    // LOT 4A, audit ID 2 : microEditScript/microEditRecit/detectionNiche
    // reçoivent leur PROPRE plafond (voir PLAFONDS_MODE_LEGER), aligné sur
    // leur seul usage client légitime, jamais celui, bien plus large, d'une
    // génération complète - et jamais le modèle demandé par le client
    // (toujours MODELE_DEFAUT), aucun de ces trois modes n'ayant de raison
    // légitime d'utiliser un autre modèle.
    const plafondLeger = PLAFONDS_MODE_LEGER[modeDemande];
    const modeleFinal = plafondLeger ? MODELE_DEFAUT : (MODELES_AUTORISES.has(model) ? model : MODELE_DEFAUT);
    const maxTokensFinal = plafondLeger
      ? Math.min(Math.max(parseInt(max_tokens, 10) || plafondLeger.maxTokens, 1), plafondLeger.maxTokens)
      : Math.min(Math.max(parseInt(max_tokens, 10) || 4000, 1), MAX_TOKENS_PLAFOND);
    const webSearchAutorise = plafondLeger ? plafondLeger.webSearch : true;

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
    if (web_search && webSearchAutorise) {
      const maxUses = Math.min(Math.max(parseInt(web_search_max_uses, 10) || 1, 1), 3);
      bodyAnthropic.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }];
    }

    // Mode flux (Script/Récit/Série, voir onApercu dans js/api.js) : relaie le
    // texte d'Anthropic au navigateur au fur et à mesure plutôt que d'attendre
    // la réponse complète. Toute erreur AVANT le début du flux (quota déjà
    // filtré plus haut, mais aussi 429/529/400 côté Anthropic) reste une
    // réponse JSON classique, inchangée : seul le succès bascule en texte brut.
    if (stream === true) {
      bodyAnthropic.stream = true;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(bodyAnthropic)
      });

      if (!response.ok || !response.body) {
        let data = null;
        try { data = await response.json(); } catch (e) {}
        return res.status(response.status).json(data || { error: { message: 'Erreur en amont' } });
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Ce que l'appel a RÉELLEMENT coûté. Anthropic l'envoie à chaque flux et
      // on le jetait : `message_start` porte les jetons d'entrée (et ceux lus
      // en cache), `message_delta` le total de sortie une fois fini.
      const jetons = { entree: 0, sortie: 0, cache_lu: 0, cache_ecrit: 0 };
      const noterUsage = (u) => {
        if (!u) return;
        if (typeof u.input_tokens === 'number') jetons.entree = u.input_tokens;
        if (typeof u.output_tokens === 'number') jetons.sortie = u.output_tokens;
        if (typeof u.cache_read_input_tokens === 'number') jetons.cache_lu = u.cache_read_input_tokens;
        if (typeof u.cache_creation_input_tokens === 'number') jetons.cache_ecrit = u.cache_creation_input_tokens;
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const trames = buf.split('\n\n');
        buf = trames.pop(); // reste incomplet, remis en tampon pour la prochaine lecture
        for (const trame of trames) {
          const ligneData = trame.split('\n').find(l => l.startsWith('data:'));
          if (!ligneData) continue;
          try {
            const evt = JSON.parse(ligneData.slice(5).trim());
            if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
              res.write(evt.delta.text);
            } else if (evt.type === 'message_start' && evt.message) {
              noterUsage(evt.message.usage);
            } else if (evt.type === 'message_delta') {
              noterUsage(evt.usage);
            }
          } catch (e) { /* trame partielle ou non-JSON (ex: ping), ignorée */ }
        }
      }
      // ── LE RELEVÉ DE JETONS, EN FIN DE FLUX ──
      // Le corps de cette réponse est du TEXTE BRUT affiché en direct au
      // créateur (aperçu de génération) : on ne peut pas y glisser du JSON
      // n'importe où. Il est donc posé tout à la fin, derrière un séparateur
      // d'enregistrement (U+001E), un caractère de contrôle qu'un modèle
      // n'écrit jamais dans du texte ni dans du JSON. callAI le détache avant
      // que quoi que ce soit d'autre ne voie la réponse, aperçu compris.
      res.write(SEPARATEUR_JETONS + JSON.stringify(jetons));
      return res.end();
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

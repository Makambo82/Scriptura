// api/generate.js, Fonction serverless Vercel
// Garde la clé API secrète, vérifie l'abonnement, puis relaie vers Anthropic.

// Vérifie côté serveur qu'un code d'accès correspond à un abonnement valide.
// Retourne { ok:true } si la génération est autorisée, sinon { ok:false, raison }.
async function verifierAcces(code) {
  // Pas de code = utilisateur en générations gratuites : on laisse passer,
  // le navigateur gère déjà le quota gratuit.
  if (!code) return { ok: true };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  // Si Supabase n'est pas configuré côté serveur, on ne bloque pas (sécurité souple).
  if (!url || !key) return { ok: true };

  // Codes illimités (fondateur) : toujours autorisés.
  const CODES_ILLIMITES = ['SCRIPTURA-CELINE'];
  if (CODES_ILLIMITES.includes(String(code).toUpperCase())) return { ok: true };

  try {
    const r = await fetch(
      url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code) + '&select=actif,expire_le',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } }
    );
    const rows = await r.json();
    // Code introuvable : on laisse le navigateur trancher (peut être un code gratuit maison).
    if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
    const ab = rows[0];
    if (ab.actif === false) return { ok: false, raison: 'compte désactivé' };
    if (ab.expire_le) {
      // Normaliser la date (yyyy-mm-dd ou yyyy/mm/dd), fin de journée d'expiration.
      const s = String(ab.expire_le).split('T')[0].split(' ')[0].replace(/\//g, '-');
      const p = s.split('-');
      if (p.length === 3) {
        const exp = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 23, 59, 59, 999);
        if (!isNaN(exp.getTime()) && exp < new Date()) {
          return { ok: false, raison: 'abonnement expiré' };
        }
      }
    }
    return { ok: true };
  } catch (e) {
    // En cas de souci réseau, on n'enferme pas l'abonné dehors.
    return { ok: true };
  }
}

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
    const { model, max_tokens, messages, code_acces, web_search, web_search_max_uses } = req.body;

    // Vérifier l'abonnement AVANT d'appeler l'IA (verrou serveur incontournable)
    const acces = await verifierAcces(code_acces);
    if (!acces.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + acces.raison, code: 'ACCES_REFUSE' } });
    }

    const bodyAnthropic = {
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 4000,
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

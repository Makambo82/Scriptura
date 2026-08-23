// ═══════════════════════════════════════════════════════════
//  SUPABASE, Sauvegarde permanente des générations
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  MODÈLES IA, Haiku partout (rapide et fiable)
//  Pour tester un autre modèle plus tard, modifie juste ces 2 lignes.
// ═══════════════════════════════════════════════════════════
const MODEL_CREATIF = "claude-haiku-4-5-20251001";    // Haiku partout (rapide et fiable)
const MODEL_RAPIDE  = "claude-haiku-4-5-20251001";    // Directeur, idées, storyboards (vitesse)
const MODEL_AUDIT   = "claude-sonnet-4-6";            // Sonnet pour l'audit : tâche complexe, qualité premium
// Le premier jet du récit reste sur Haiku (rapide), mais juger si un hook
// "arrête vraiment le scroll" et réécrire les segments faibles est un
// jugement créatif fin, pas mécanique : Haiku jugeant Haiku était complaisant.
// Sonnet pour ces deux appels ciblés seulement (même logique que MODEL_AUDIT).
const MODEL_QUALITE_RECIT = "claude-sonnet-4-6";

// false = moteur allégé et rapide (2 agents). true = moteur complet (4 agents,
// avec critique sévère + réécriture ciblée + contrôle anti-générique, voir
// generate() dans js/generation.js). Activé : la qualité prime sur la
// vitesse, chaque script passe par un vrai contrôle avant d'être livré.
const CRITIQUE_ACTIVE = true;
// ── Limites journalières par plan ──
// La création (idées, script, storytelling, diagnostic sommaire) et
// l'audit complet ont des compteurs séparés : un audit ne consomme pas le
// quota de création et inversement. Le diagnostic sommaire (@nom
// d'utilisateur) et l'analyse vidéo (lien TikTok) ont chacun leur PROPRE
// compteur mensuel, séparé de la création : sommaire Creator 10/mois, Pro
// 25/mois ; analyse vidéo Creator 6/mois, Pro 15/mois (plus bas que le
// sommaire : elle consomme deux API payées au crédit, transcription
// ElevenLabs + décodage TikHub, coût double par appel). Un non-abonné a
// droit à 1 de chaque (décomptée aussi sur ses 5 générations gratuites, voir
// MAX_SOMMAIRE_GRATUIT / MAX_VIRAL_GRATUIT). Une fois le quota mensuel
// dédié épuisé (sommaire ou vidéo), un jeton acheté à l'unité en débloque
// une de plus (voir droitAnalyseSommaire / droitAnalyseVirale).
// Ces limites sont indicatives côté client (anti-abus), la vérité reste
// le comptage Supabase par type.
const LIMITES_MOIS = {
  creator: { creation: 40, audit: 0, sommaire: 10, viral: 6 },
  pro:     { creation: 70, audit: 5, sommaire: 25, viral: 15 }
};
// Non-abonné : 1 seule analyse sommaire / 1 seule analyse vidéo (prélevées
// aussi sur ses 5 générations gratuites).
const MAX_SOMMAIRE_GRATUIT = 1;
const MAX_VIRAL_GRATUIT = 1;
// Repli si le plan n'est pas reconnu : on applique le moins-disant (Creator).
function limitesDuPalier() {
  return LIMITES_MOIS[monPalier()] || LIMITES_MOIS.creator;
}

// ── Paliers d'abonnement ──
// Creator : tous les modes de création. Pro : Creator + Analyse compte TikTok.
// Le palier est lu dans la colonne "plan" de la table Supabase "abonnes".
// PLAN_PAR_DEFAUT s'applique quand la colonne est absente ou vide : le temps
// de renseigner les abonnés existants, le mettre sur 'pro' évite de leur
// couper l'accès ; le repasser sur 'creator' une fois la migration faite.
const PLAN_PAR_DEFAUT = 'creator';
const MODES_PRO = ['audit', 'serie'];

// Statut admin/illimité : déterminé UNIQUEMENT par le serveur (voir
// api/verify-code.js et verifyCode() dans js/auth.js), jamais en comparant
// le code local à une valeur codée en dur ici, avant ce changement, le
// code fondateur (SCRIPTURA-CELINE) était lisible en clair par n'importe
// qui dans le JavaScript servi au navigateur. Le client se contente de
// mémoriser le résultat renvoyé par le serveur au moment de la vérification.
function estCodeAdmin() {
  return localStorage.getItem('scriptura_is_admin') === 'true';
}
function estIllimite() {
  return localStorage.getItem('scriptura_illimite') === 'true';
}
function appliquerClasseAdmin() {
  document.body.classList.toggle('is-admin', estCodeAdmin());
}

// ── Niches nécessitant une vérification par recherche web ──
// Le modèle n'a aucune connaissance des faits postérieurs à son entraînement,
// et deux familles de niches ont besoin d'une vérification, mais pas de la
// même : l'actualité/la géopolitique/les faits divers changent chaque jour,
// donc il faut vérifier ce qui est VRAI MAINTENANT (jamais présenter comme
// actuel un statut qui a pu changer) ; l'Histoire, elle, ne change pas, mais
// le modèle peut se tromper sur les faits eux-mêmes (dates, noms, versions
// déformées), il faut y vérifier l'EXACTITUDE historique, pas la fraîcheur.
// Pour les autres niches (Business, Bien-être...), la recherche n'apporte
// rien et ralentirait/coûterait pour rien : on la réserve à ces deux familles.
const NICHES_ACTUALITE = ['Géopolitique & Actualité', 'Faits divers & Crime'];
const NICHES_HISTORIQUES = ['Histoire'];
function nicheNecessiteRecherche(niche) {
  return NICHES_ACTUALITE.includes(niche) || NICHES_HISTORIQUES.includes(niche);
}
// Retourne le bloc d'instruction adapté au type de vérification requis par la
// niche, ou une chaîne vide si la niche n'en nécessite aucune. `verbe` adapte
// la phrase au moment de l'appel ("de rédiger", "de proposer des idées"...).
function instructionRechercheWeb(niche, verbe) {
  if (NICHES_HISTORIQUES.includes(niche)) {
    return `\nVÉRIFICATION HISTORIQUE OBLIGATOIRE : avant ${verbe}, utilise la recherche web pour vérifier l'exactitude des faits historiques que tu comptes citer (dates, noms, chiffres, déroulé des événements), recherche la version la plus fiable et la plus proche de la réalité, pas une version approximative ou déformée issue de tes seules connaissances d'entraînement.\n`;
  }
  if (NICHES_ACTUALITE.includes(niche)) {
    return `\nSUJET D'ACTUALITÉ : avant ${verbe}, utilise la recherche web pour vérifier les faits, noms, dates, fonctions et statistiques que tu comptes citer sont bien à jour, ne présente jamais comme actuel un statut, un poste ou une situation qui a pu changer depuis tes connaissances d'entraînement : une actualité politique ou géopolitique peut changer chaque jour, va chercher l'information la plus récente, pas une archive.\n`;
  }
  return '';
}

// ── Recherche des tendances TikTok (Recommandations + mode Idées) ──
// Contrairement à instructionRechercheWeb ci-dessus (réservée aux niches qui
// ont besoin d'une VÉRIFICATION factuelle), celle-ci sert à INSPIRER : la
// quasi-totalité des créateurs Scriptura publient sur TikTok, donc plutôt que
// de laisser le modèle deviner ce qui performe à partir de ses seules
// connaissances d'entraînement (souvent datées), on l'envoie chercher les
// formats/angles/hooks qui marchent EN CE MOMENT dans la niche du créateur.
// Activée pour toutes les niches (pas de filtre NICHES_*), sur les deux
// entrées qui proposent explicitement des sujets/angles au créateur.
function instructionRechercheTendancesTikTok(niche, verbe) {
  return `\nTENDANCES TIKTOK ACTUELLES : avant ${verbe}, utilise la recherche web pour repérer ce qui performe RÉELLEMENT et RÉCEMMENT sur TikTok dans la niche "${niche}" (ou une niche proche), formats qui cartonnent, angles qui reviennent, hooks efficaces, sujets qui génèrent de l'engagement en ce moment. Inspire-toi de ces tendances réelles pour rendre tes propositions plus actuelles et plus performantes, SANS jamais inventer une tendance, un chiffre ou une source que tu n'as pas réellement trouvée, si la recherche ne remonte rien d'utile, reste sur ton expertise plutôt que d'inventer.\n`;
}

// ═══════════════════════════════════════════════════════════
//  APPEL IA AVEC REPRISE AUTOMATIQUE
//  Retente jusqu'à 3 fois si le modèle est surchargé (529) ou
//  si la réponse est vide/coupée. Attente croissante entre essais.
// ═══════════════════════════════════════════════════════════
// Règle de style ajoutée à TOUS les prompts : le tiret cadratin (le long
// tiret « em dash », U+2014) sonne « écrit par une IA ». On demande au modèle
// de ne jamais l'employer, et on nettoie la réponse par sécurité (voir
// tryOnce) au cas où il l'oublierait. (On nomme le caractère plutôt que de
// l'écrire, pour rester robuste à un futur remplacement automatique.)
const REGLE_STYLE_TIRET = "Règle de style permanente (français) : n'emploie JAMAIS le tiret cadratin (le long tiret « em dash », caractère Unicode U+2014) dans ta réponse. Structure tes phrases avec des virgules, des points, des deux-points ou des parenthèses selon le sens.\n\n";

// Tronque une chaîne à N caractères max SANS JAMAIS couper une paire de
// substituts UTF-16 (emoji, etc.) en deux. Un emoji occupe 2 "caractères"
// (code units) en JavaScript ; un .slice(0, N) naïf peut tomber pile entre les
// deux et laisser un caractère orphelin, ce qui fait planter le parseur JSON
// strict de Claude côté serveur ("no low surrogate in string", 400). Les
// bios et légendes TikTok sont pleines d'emoji : à utiliser PARTOUT où un tel
// texte est tronqué avant d'être injecté dans un prompt.
function tronquerSansCouperEmoji(str, n) {
  if (typeof str !== 'string' || str.length <= n) return str || '';
  let s = str.slice(0, n);
  const dernier = s.charCodeAt(s.length - 1);
  if (dernier >= 0xD800 && dernier <= 0xDBFF) s = s.slice(0, -1); // haut-substitut orphelin
  return s;
}

async function callAI(model, maxTokens, prompt, maxRetries, webSearch, webSearchMaxUses, mode, fichierJoint, onApercu) {
  // Fait UN appel au modèle donné. Retourne le texte, ou null si échec récupérable.
  // `mode` : identifie le quota à vérifier CÔTÉ SERVEUR (voir api/_lib/acces.js) :
  // 'creation' par défaut (idées/script/récit), ou 'creationSerie'
  // (Pro/jeton pour entrer, voir js/serie.js). diagnosticSommaire/analyseVirale/
  // audit passent par leurs propres routes (username-scan/video-stt/audit),
  // pas par callAI.
  // `fichierJoint` (optionnel) : { base64, mediaType }, une image (JPEG) ou
  // un PDF joint au message pour analyse (ex. photo produit ou ebook pour
  // l'objectif "générer des ventes", voir js/generation.js). Anthropic lit
  // les deux nativement via un content block dédié ('image' ou 'document'),
  // api/generate.js relaie `messages` tel quel, aucun changement serveur
  // nécessaire.
  // `onApercu` (optionnel) : callback appelé à chaque morceau reçu avec le
  // texte brut accumulé jusque-là (voir api/generate.js, mode stream). Sert
  // à afficher la génération au fur et à mesure (Script/Récit/Série, voir
  // afficherApercuEnDirect dans js/generation.js) plutôt que d'attendre la
  // réponse complète, sans changer la valeur de retour ni la logique de
  // réessai ci-dessous : un flux interrompu se comporte comme un échec
  // récupérable ordinaire, la tentative suivante repart de zéro.
  const promptStyle = REGLE_STYLE_TIRET + prompt;
  const contenuMessage = fichierJoint
    ? [
        { type: fichierJoint.mediaType === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: fichierJoint.mediaType, data: fichierJoint.base64 } },
        { type: 'text', text: promptStyle }
      ]
    : promptStyle;
  // Coupe la requête après 55s (juste sous les 60s de maxDuration côté serveur,
  // voir vercel.json) : sans ça, une requête bloquée reste pendue indéfiniment
  // côté navigateur au lieu d'échouer proprement et de déclencher une nouvelle
  // tentative, c'était une cause fréquente de générations qui "tournent" sans fin.
  async function tryOnce(useModel) {
    const controller = new AbortController();
    const delaiMax = setTimeout(() => controller.abort(), 55000);
    let res;
    try {
      res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: useModel,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: contenuMessage }],
          code_acces: localStorage.getItem('scriptura_code') || null,
          web_search: !!webSearch,
          web_search_max_uses: webSearchMaxUses || undefined,
          mode: mode || 'creation',
          stream: !!onApercu
        }),
        signal: controller.signal
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        return { ok: false, recoverable: true, detail: 'délai dépassé (55s)' };
      }
      throw e;
    } finally {
      clearTimeout(delaiMax);
    }
    // Abonnement expiré/désactivé, OU quota du mode atteint : deux refus
    // distincts renvoyés par le serveur avec le même statut HTTP (403),
    // distingués par error.code (voir api/generate.js).
    if (res.status === 403) {
      let payload = null;
      try { payload = await res.json(); } catch (e) {}
      if (payload && payload.error && payload.error.code === 'QUOTA_ATTEINT') {
        return { ok: false, recoverable: false, detail: 'quota atteint', quotaAtteint: true };
      }
      if (typeof gererAbonnementExpire === 'function') gererAbonnementExpire();
      return { ok: false, recoverable: false, detail: 'accès refusé' };
    }
    // Surcharge / erreur serveur temporaire → échec récupérable (on renvoie null)
    if (res.status === 529 || res.status === 503 || res.status === 500 || res.status === 429) {
      return { ok: false, recoverable: true, detail: '(' + res.status + ') serveur occupé' };
    }
    let raw;
    // Flux texte en direct (voir api/generate.js, mode stream) : le serveur ne
    // répond en text/plain QUE dans ce cas précis (erreurs = toujours du JSON,
    // voir ci-dessus), donc le content-type suffit à distinguer les deux sans
    // dépendre de la présence d'onApercu ici.
    const estFluxDirect = res.body && (res.headers.get('content-type') || '').includes('text/plain');
    if (estFluxDirect) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (onApercu) onApercu(buffer);
      }
      raw = buffer;
    } else {
      const data = await res.json();
      if (!res.ok) {
        const detail = data.error?.message || data.message || JSON.stringify(data).slice(0, 150);
        return { ok: false, recoverable: false, detail: '(' + res.status + ') ' + detail };
      }
      raw = data.content?.map(b => b.text || '').join('') || '';
    }
    if (!raw.trim()) return { ok: false, recoverable: true, detail: 'réponse vide' };
    // Filet de sécurité : retire tout tiret cadratin (em dash) résiduel que le
    // modèle aurait laissé malgré la consigne, en le remplaçant par une virgule.
    // Sans danger pour le JSON (le tiret n'apparaît que dans les valeurs texte).
    raw = raw.replace(/\s*—\s*/g, ', ');
    return { ok: true, raw: raw };
  }

  // Modèle de secours : si on demandait Sonnet, on retombe sur Haiku (stable).
  const fallbackModel = MODEL_RAPIDE;
  const usesFallback = (model === MODEL_CREATIF); // on ne bascule que si on visait Sonnet

  let lastDetail = '';

  // Tentative 1, modèle demandé (ex: Sonnet)
  try {
    const r1 = await tryOnce(model);
    if (r1.ok) return r1.raw;
    lastDetail = r1.detail;
    if (!r1.recoverable && !usesFallback) throw new Error(lastDetail);
  } catch(e) { lastDetail = e.message; }

  // Petite pause puis Tentative 2, même modèle
  await new Promise(r => setTimeout(r, 1500));
  try {
    const r2 = await tryOnce(model);
    if (r2.ok) return r2.raw;
    lastDetail = r2.detail;
  } catch(e) { lastDetail = e.message; }

  // Tentative 3, bascule automatique sur Haiku (si on visait Sonnet)
  if (usesFallback) {
    try {
      const r3 = await tryOnce(fallbackModel);
      if (r3.ok) return r3.raw;
      lastDetail = r3.detail;
    } catch(e) { lastDetail = e.message; }
  }

  throw new Error(lastDetail || 'Service momentanément indisponible, réessaie');
}


const SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PqRwwhtRedPMvETLCp562g_7HKFsjLl';
let supabaseClient = null;
try {
  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch(e) { console.warn('Supabase non initialisé', e); }

// Récupère un identifiant pour l'utilisateur : son code d'accès s'il en a un,
// sinon un identifiant anonyme stable stocké dans le navigateur.
function getUserRef() {
  const code = localStorage.getItem('scriptura_code');
  if (code) return code;
  let anon = localStorage.getItem('scriptura_anon_id');
  if (!anon) {
    anon = 'anon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('scriptura_anon_id', anon);
  }
  return anon;
}

// ═══════════════════════════════════════════════════════════
//  ANTI-CONTOURNEMENT, empreinte d'appareil + IP (via Supabase)
// ═══════════════════════════════════════════════════════════
// Objectif : le quota gratuit ne se réinitialise PAS quand on vide le cache.
// On calcule une empreinte stable de l'appareil (indépendante du localStorage)
// et on stocke le vrai quota dans Supabase, lié à cette empreinte + à l'IP.

// Calcule une empreinte stable du navigateur/appareil (ne dépend pas du cache)
async function getDeviceFingerprint() {
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    (navigator.languages || []).join(','),
    screen.width + 'x' + screen.height,
    screen.colorDepth || '',
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory || '',
    navigator.platform || '',
    navigator.maxTouchPoints || ''
  ];
  // Empreinte canvas (rendu graphique propre à chaque appareil)
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Scriptura🎬', 2, 15);
    parts.push(canvas.toDataURL().slice(-50));
  } catch(e) { /* ignore */ }

  const str = parts.join('|');
  // Hash simple (djb2) → chaîne courte et stable
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return 'fp_' + hash.toString(36);
}

// Récupère l'IP publique de l'utilisateur (service gratuit)
async function getUserIP() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    const j = await r.json();
    return j.ip || null;
  } catch(e) { return null; }
}

// Empreinte mémorisée pour la session
let _deviceFp = null;
let _userIP = null;
async function ensureDeviceIds() {
  if (!_deviceFp) _deviceFp = await getDeviceFingerprint();
  if (!_userIP) _userIP = await getUserIP();
  return { fp: _deviceFp, ip: _userIP };
}

// Récupère le quota réel depuis Supabase (le max entre empreinte et IP).
// Renvoie le nombre de générations déjà utilisées selon le serveur.
async function fetchServerQuota() {
  if (!supabaseClient) return null; // pas de Supabase → on garde le localStorage
  try {
    const { fp, ip } = await ensureDeviceIds();
    const refs = [fp];
    if (ip) refs.push('ip_' + ip);
    // Chercher les lignes correspondant à l'empreinte OU l'IP
    const { data, error } = await supabaseClient
      .from('quotas')
      .select('ref, used')
      .in('ref', refs);
    if (error) throw error;
    if (!data || !data.length) return 0;
    // On prend le maximum (le plus contraignant)
    return Math.max(...data.map(r => r.used || 0));
  } catch(e) {
    console.warn('fetchServerQuota échec', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  ASSAINISSEUR DE PROMPTS VISUELS
//  Appliqué sur chaque prompt après retour de l'IA.
//  Garantit côté code les règles que l'IA peut oublier :
//  1. Footer 9:16 présent
//  2. Zéro langage vidéo (mouvement caméra, transition, durée)
//  3. Zéro étiquettes structurelles écrites par l'IA
//  4. Détection des prompts suspects (trop courts = pauvres)
// ═══════════════════════════════════════════════════════════

// ── STYLES GRAPHIQUES DES VISUELS ──────────────────────────────────────────
// Le style choisi par le créateur est ajouté en footer de CHAQUE prompt visible
// (celui du storyboard, copié vers ChatGPT/Gemini) et appliqué à la génération
// des images du montage (Together). "footer" en anglais car les prompts le sont
// (les générateurs suivent bien mieux l'anglais). "neutre" = aucun style imposé.
const STYLES_VISUELS = [
  { id: 'peinture',  label: "Peinture à l'huile",        footer: 'Rendered as a classic oil painting with visible brushstrokes and canvas texture, a painterly fine-art illustration, not a photograph.' },
  { id: 'neutre',    label: 'Style neutre',                footer: '' },
  { id: 'cinema',    label: 'Cinématographique réaliste', footer: 'Cinematic photorealistic still, dramatic film lighting, rich cinematic color grading, shallow depth of field, movie-like atmosphere.' },
  { id: 'aquarelle', label: 'Aquarelle',                  footer: 'Soft watercolor painting, delicate washes of color, gentle bleeding edges, light paper texture, poetic and airy mood.' },
  { id: 'bd',        label: 'BD / illustration moderne',  footer: 'Modern comic-book graphic illustration, bold flat colors, clean crisp black outlines, cel-shaded contemporary cartoon look.' },
  { id: 'nb',        label: 'Noir & blanc dramatique',    footer: 'Dramatic black-and-white monochrome image, high-contrast chiaroscuro lighting, deep shadows and bright highlights, timeless, no color.' },
];
// Repère pour retirer un footer de style déjà présent (quel qu'il soit) avant
// d'en appliquer un autre, construit à partir du 1er mot distinctif de chacun.
const REGEX_FOOTER_STYLE = /\s*(Rendered as a classic oil painting|Cinematic photorealistic still|Soft watercolor painting|Modern comic-book graphic illustration|Dramatic black-and-white monochrome image)[^]*$/i;

// Formats (ratios). `img` = dimensions envoyées à Together (multiples de 16,
// requis par FLUX). `video` = dimensions du rendu final (raisonnables pour la
// mémoire du conteneur de rendu). L'id est aussi le footer de ratio du prompt.
const FORMATS_VISUELS = [
  { id: '9:16', label: 'Vertical 9:16', imgW: 768,  imgH: 1344, vidW: 720,  vidH: 1280 },
  { id: '16:9', label: 'Horizontal 16:9', imgW: 1344, imgH: 768,  vidW: 1280, vidH: 720 },
  { id: '1:1',  label: 'Carré 1:1',     imgW: 1024, imgH: 1024, vidW: 1000, vidH: 1000 },
];

function styleVisuelActuel() {
  try { return localStorage.getItem('scriptura_style_visuel') || 'peinture'; }
  catch (e) { return 'peinture'; }
}

function formatVisuelActuel() {
  try {
    const f = localStorage.getItem('scriptura_format_visuel');
    return FORMATS_VISUELS.some(x => x.id === f) ? f : '9:16';
  } catch (e) { return '9:16'; }
}

// Distinct de *VisuelActuel() ci-dessus : renvoie null si le créateur n'a
// JAMAIS fait ce choix lui-même (à ne pas confondre avec le défaut interne
// utilisé pour générer quand même, voir optionsStoryboardHTML). Sert
// uniquement à savoir si le <select> doit afficher un vrai choix ou son
// option "Choisir…".
function styleVisuelChoisi() {
  try { return localStorage.getItem('scriptura_style_visuel'); } catch (e) { return null; }
}
function formatVisuelChoisi() {
  try {
    const f = localStorage.getItem('scriptura_format_visuel');
    return FORMATS_VISUELS.some(x => x.id === f) ? f : null;
  } catch (e) { return null; }
}

function formatVisuelInfos(id) {
  return FORMATS_VISUELS.find(f => f.id === id) || FORMATS_VISUELS[0];
}

// Lit le ratio (format) déjà présent en fin de prompt du storyboard, c'est LUI
// la source de vérité pour le montage (pas le réglage global, qui a pu changer
// depuis). Défaut 9:16 si absent.
function ratioDuPrompt(p) {
  const m = String(p || '').match(/\b(9:16|16:9|1:1)\b\s*$/);
  return m ? m[1] : '9:16';
}

function changerStyleVisuel(id) {
  try { localStorage.setItem('scriptura_style_visuel', id); } catch (e) {}
}
function changerFormatVisuel(id) {
  try { localStorage.setItem('scriptura_format_visuel', id); } catch (e) {}
}

// Bloc de choix "Style graphique + Format", inséré AVANT chaque bouton
// « Générer le storyboard » (tous les modes). Réglé avant génération pour que
// chaque prompt reçoive le bon footer (style + ratio). Les <select> reflètent
// le choix mémorisé (localStorage) au moment où le bloc est construit. Tant
// qu'aucun choix n'a jamais été fait (nouvel utilisateur), affiche "Choisir…"
// plutôt qu'une vraie option déjà cochée, qui donnerait l'impression fausse
// d'un choix déjà fait : la génération utilisera quand même un défaut
// raisonnable (styleVisuelActuel/formatVisuelActuel) si le créateur ignore
// ces menus et lance directement.
function optionsStoryboardHTML() {
  const stChoisi = styleVisuelChoisi(), fmtChoisi = formatVisuelChoisi();
  const st = styleVisuelActuel(), fmt = formatVisuelActuel();
  const styleOpts = (stChoisi ? '' : '<option value="">Choisir ton style…</option>')
    + STYLES_VISUELS.map(s => `<option value="${s.id}"${stChoisi && s.id === st ? ' selected' : ''}>${s.label}</option>`).join('');
  const fmtOpts = (fmtChoisi ? '' : '<option value="">Choisir ton format…</option>')
    + FORMATS_VISUELS.map(f => `<option value="${f.id}"${fmtChoisi && f.id === fmt ? ' selected' : ''}>${f.label}</option>`).join('');
  return `<div class="sb-options-visuelles">
    <label class="sb-opt"><span>Style graphique</span>
      <select class="ctx-input" onchange="changerStyleVisuel(this.value)">${styleOpts}</select></label>
    <label class="sb-opt"><span>Format</span>
      <select class="ctx-input" onchange="changerFormatVisuel(this.value)">${fmtOpts}</select></label>
  </div>`;
}

// Retire tout footer de style + le "9:16", applique le style demandé, remet
// "9:16" en dernier. Idempotent (ne s'empile jamais). Style "neutre" = pas de
// footer. Sert à la fois pour le storyboard (assainirPromptVisuel) et pour la
// génération d'images du montage.
function appliquerStyleVisuel(prompt, styleId) {
  let p = String(prompt || '');
  // Retire un footer de ratio existant (9:16, 16:9 ou 1:1) et un footer de style.
  p = p.replace(/\s*(ratio\s*)?\b(9[\s:\/]+16|16[\s:\/]+9|1[\s:\/]+1)\b\.?\s*$/i, '').trim();
  p = p.replace(REGEX_FOOTER_STYLE, '').trim();
  const st = STYLES_VISUELS.find(s => s.id === styleId) || STYLES_VISUELS[0];
  if (st.footer) p = p.replace(/[.\s]*$/, '').trim() + '. ' + st.footer;
  // Footer de ratio = format courant, toujours en tout dernier.
  const ratio = formatVisuelActuel();
  if (!p.endsWith(ratio)) p = p + ' ' + ratio;
  return p;
}

/**
 * Nettoie et sécurise un prompt visuel unique.
 * @param {string} prompt - Le prompt brut retourné par l'IA
 * @param {string} [contexte] - Identifiant pour le log (ex. "Plan 3")
 * @returns {string} Le prompt nettoyé et garanti conforme
 */
function assainirPromptVisuel(prompt, contexte) {
  if (!prompt || typeof prompt !== 'string') return '';
  let p = prompt.trim();

  // ── 1. Supprimer les étiquettes structurelles si l'IA les a écrites ────────
  // Formes possibles : "Décor :", "1. Le Décor :", "DÉCOR :", etc. Les
  // prompts visuels sont désormais écrits en ANGLAIS (voir STRUCTURE_PROMPT_
  // VISUEL, js/storyboard.js) : on couvre donc aussi leurs équivalents
  // anglais ("Setting:", "Characters:"...), sinon ce filet de sécurité ne
  // rattraperait plus jamais rien.
  const etiquettes = [
    /^\s*\d*\.?\s*LE\s+DÉ?COR\s*:\s*/gim,
    /^\s*\d*\.?\s*LA\s+MATI[EÈ]RE\s*:\s*/gim,
    /^\s*\d*\.?\s*LES\s+PERSONNAGES\s*:\s*/gim,
    /^\s*\d*\.?\s*LA\s+VIE\s+DE\s+LA\s+SC[EÈ]NE\s*:\s*/gim,
    /^\s*\d*\.?\s*DÉCOR\s*:\s*/gim,
    /^\s*\d*\.?\s*MATIÈRE\s*:\s*/gim,
    /^\s*\d*\.?\s*PERSONNAGES\s*:\s*/gim,
    /^\s*\d*\.?\s*AMBIANCE\s*:\s*/gim,
    /^\s*\d*\.?\s*LUMIÈRE\s*:\s*/gim,
    /^\s*\d*\.?\s*DECOR\s*:\s*/gim,
    /^\s*\d*\.?\s*MATIERE\s*:\s*/gim,
    /^\s*\d*\.?\s*LUMIERE\s*:\s*/gim,
    // Équivalents anglais
    /^\s*\d*\.?\s*(THE\s+)?SETTING\s*:\s*/gim,
    /^\s*\d*\.?\s*MATERIALS?\s*:\s*/gim,
    /^\s*\d*\.?\s*(THE\s+)?CHARACTERS?\s*:\s*/gim,
    /^\s*\d*\.?\s*SCENE\s+(LIFE|DETAILS)\s*:\s*/gim,
    /^\s*\d*\.?\s*(AMBIANCE|AMBIENCE|ATMOSPHERE)\s*:\s*/gim,
    /^\s*\d*\.?\s*LIGHTING\s*:\s*/gim,
  ];
  etiquettes.forEach(re => { p = p.replace(re, ''); });
  // Nettoyer les sauts de ligne multiples créés par la suppression des étiquettes
  p = p.replace(/\n{3,}/g, '\n\n').trim();

  // ── 2. Remplacer le langage vidéo par des équivalents image fixe ────────────
  // Prompts désormais en anglais : la liste couvre les deux langues, au cas
  // où l'IA dévie malgré la consigne (repli en français) ou suit bien la
  // consigne (anglais, le cas normal désormais).
  const remplacementsVideo = [
    // Mouvements de caméra (FR)
    [/\b(la caméra|the camera)\s+(zoome?|s'attarde?|panoramique|recule?|avance?|suit|survole?|plonge?|monte?|descend)\b/gi, 'le regard du spectateur est attiré vers'],
    [/\bcoup de zoom\b/gi, 'gros plan sur'],
    [/\bpanoramique\s+(lent|rapide|vers)?\b/gi, 'vue panoramique de'],
    [/\btravelling\b/gi, 'cadrage immersif'],
    [/\bfondu (au noir|enchaîné|vers)\b/gi, 'atmosphère'],
    [/\btransition (douce|vers|entre)\b/gi, 'composition fusionnant'],
    [/\bscène suivante\b/gi, 'scène'],
    [/\ben mouvement\b/gi, 'dans une posture dynamique'],
    [/\bau fil de la séquence\b/gi, 'dans la composition'],
    // Durées et temporalité vidéo (FR)
    [/\bpendant \d+\s*(sec(onde)?s?|min(utes?)?)\b/gi, ''],
    [/\bdure \d+\s*(sec(onde)?s?|min(utes?)?)\b/gi, ''],
    [/\b\d+\s*secondes?\s*(de|d')\b/gi, ''],
    [/\bon voit ensuite\b/gi, 'on distingue aussi'],
    [/\bpuis (la caméra|on)\b/gi, 'dans l\'arrière-plan,'],
    // Coupures et montage (FR)
    [/\bcoupe (vers|sur|nette)\b/gi, 'contraste visuel avec'],
    [/\bplan (américain|rapproché|large|séquence|fixe)\b/gi, 'cadrage'],
    [/\béclairage (qui change|évolutif|progressif)\b/gi, 'éclairage'],
    // Camera movement (EN)
    [/\bthe camera\s+(zooms?( in| out)?|pans?|tilts?|tracks?|dollies?|pushes? in|pulls? back|glides?|sweeps?|rises?|descends?|follows?)\b/gi, 'the viewer\'s eye is drawn toward'],
    [/\bzoom(ing)? (in|out)\b/gi, 'close-up on'],
    [/\b(panning|tracking|dolly|traveling|travelling) shot\b/gi, 'immersive framing'],
    [/\bfades? (to black|in|out)\b/gi, 'atmosphere'],
    [/\btransitions? (to|into|between)\b/gi, 'composition merging with'],
    [/\bnext scene\b/gi, 'scene'],
    [/\bin motion\b/gi, 'in a dynamic posture'],
    [/\bover the course of the (sequence|scene)\b/gi, 'in the composition'],
    // Duration and video timing (EN)
    [/\bfor \d+\s*(seconds?|minutes?)\b/gi, ''],
    [/\blasts? \d+\s*(seconds?|minutes?)\b/gi, ''],
    [/\b\d+\s*seconds? (of|long)\b/gi, ''],
    [/\bwe then see\b/gi, 'also visible is'],
    [/\bthen the camera\b/gi, 'in the background,'],
    // Cuts and editing (EN)
    [/\bcuts? (to|away|sharply)\b/gi, 'visual contrast with'],
    [/\b(medium|close-up|wide|establishing|master) shot\b/gi, 'framing'],
    [/\b(changing|evolving|progressive) lighting\b/gi, 'lighting'],
  ];
  remplacementsVideo.forEach(([re, remplacement]) => {
    p = p.replace(re, remplacement);
  });
  // Nettoyer les espaces multiples créés par les suppressions
  p = p.replace(/  +/g, ' ').trim();

  // ── 3. Footer de STYLE graphique choisi + format 9:16 ───────────────────────
  // Le style (peinture, neutre, cinéma…) est ajouté de façon DÉTERMINISTE à la
  // fin de chaque prompt visible, celui du storyboard ET celui copié vers
  // ChatGPT/Gemini. appliquerStyleVisuel gère aussi le "9:16" final et n'empile
  // jamais deux footers.
  p = appliquerStyleVisuel(p, styleVisuelActuel());

  // ── 4. Détecter les prompts suspects (trop courts) ────────────────────────────
  const nbMots = p.split(/\s+/).filter(Boolean).length;
  if (nbMots < 30) {
    console.warn(`[Scriptura] Prompt suspect (${nbMots} mots)${contexte ? ', ' + contexte : ''} : "${p.slice(0, 80)}…"`);
  }

  return p;
}

/**
 * Applique assainirPromptVisuel() sur tout un storyboard retourné par l'IA.
 * Gère les deux structures JSON possibles (visuel vs prompt_visuel).
 * Assainit aussi la miniature si présente.
 * @param {object} parsed - L'objet JSON parsé retourné par l'IA
 * @returns {object} Le même objet avec tous les prompts nettoyés
 */
function assainirStoryboard(parsed) {
  if (!parsed) return parsed;

  // Miniature
  if (parsed.miniature) {
    parsed.miniature = assainirPromptVisuel(parsed.miniature, 'Miniature');
  }

  // Segments, deux structures possibles selon le mode
  if (Array.isArray(parsed.storyboard)) {
    parsed.storyboard = parsed.storyboard.map((seg, i) => {
      const label = 'Plan ' + (seg.segment || (i + 1));
      // Mode Récit / Storyboard Seul : champ "visuel"
      if (seg.visuel !== undefined) {
        seg.visuel = assainirPromptVisuel(seg.visuel, label);
      }
      // Mode Script / Série : champ "prompt_visuel"
      if (seg.prompt_visuel !== undefined) {
        seg.prompt_visuel = assainirPromptVisuel(seg.prompt_visuel, label);
      }
      return seg;
    });
  }

  return parsed;
}

// Enregistre/incrémente le quota côté serveur (empreinte ET IP)
async function bumpServerQuota(newValue) {
  if (!supabaseClient) return;
  try {
    const { fp, ip } = await ensureDeviceIds();
    const rows = [{ ref: fp, used: newValue, maj_le: new Date().toISOString() }];
    if (ip) rows.push({ ref: 'ip_' + ip, used: newValue, maj_le: new Date().toISOString() });
    // upsert : crée ou met à jour selon la clé 'ref'
    await supabaseClient.from('quotas').upsert(rows, { onConflict: 'ref' });
  } catch(e) { console.warn('bumpServerQuota échec', e); }
}

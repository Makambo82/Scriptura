// ═══════════════════════════════════════════════════════════
//  MODULE DIAGNOSTIC SOMMAIRE — analyse via @nom d'utilisateur TikTok
//  Alternative légère au diagnostic complet par captures (js/audit.js) :
//  aucune capture à envoyer. api/username-scan.js lit le PROFIL via LamaTok
//  et la LISTE DES VIDÉOS (vues, dates, ET sujets/légendes) via ScrapTik.
//
//  Les 4 dimensions inspirées de Vervox (Engagement, Portée, Régularité,
//  Viralité) sont calculables quand les vidéos sont récupérées : Engagement
//  à partir des totaux du profil ; Portée, Régularité et Viralité à partir
//  des vues/dates par vidéo (voir calculerMetriquesVideos). En plus, les
//  SUJETS des vidéos (légendes) alimentent une analyse de CONTENU comme
//  Vervox : niche réelle, Top/Flop vidéos, concepts récurrents, leviers qui
//  citent des vidéos précises. Si les vidéos ne sont pas récupérées (clé
//  ScrapTik absente, compte privé, quota), on retombe proprement sur
//  l'Engagement seul, sans jamais inventer de chiffre. Score recalculé côté
//  code (comme js/audit.js) sur les seules dimensions réellement mesurées,
//  jamais fourni tel quel par l'IA.
//
//  Rendu avec la palette Scriptura (doré + émeraude pour les points forts
//  — même mécanique que l'anneau de score du diagnostic complet).
//  Quota : aucun compteur dédié — consomme le même quota que les autres
//  modes de création (script, idées, récit). Non-abonné : ses 5
//  générations gratuites partagées ; Creator/Pro : leur quota mensuel de
//  création habituel.
// ═══════════════════════════════════════════════════════════

// Prépare l'écran de choix pour une nouvelle analyse (efface le champ,
// les erreurs et un éventuel résultat précédent encore affiché).
function resetDiagnosticSommaireForm() {
  const input = document.getElementById('diagSommaireInput');
  if (input) input.value = '';
  const err = document.getElementById('diagSommaireErrorBox');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const results = document.getElementById('diagSommaireResults');
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
  // Toujours réafficher le champ de saisie ici : appelée à l'entrée dans le
  // module (chooseMode) comme depuis "Analyser un autre compte", ces deux cas
  // doivent repartir d'un écran de choix visible même si un résultat précédent
  // l'avait masqué (voir toggleDiagSommaireEntree).
  if (typeof toggleDiagSommaireEntree === 'function') toggleDiagSommaireEntree(true);
}

// « Envoie tes captures » depuis l'écran de choix : bascule vers le
// diagnostic complet existant (js/audit.js), qui reste réservé au Pro
// (ou aux jetons) — même vérification qu'avant la refonte de l'écran d'entrée.
async function ouvrirCapturesDepuisChoix() {
  if (!aAccesMode('audit')) {
    const jetonsDispo = await lireJetonsAudit();
    if (jetonsDispo <= 0) {
      openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne');
      return;
    }
  }
  // Empiler l'écran sommaire actuel avant de basculer, sinon "← Retour"
  // depuis le diagnostic complet saute directement au héro au lieu de
  // revenir sur ce résultat sommaire.
  if (typeof pushNav === 'function') pushNav();
  const dsf = document.getElementById('diagSommaireFlow');
  if (dsf) dsf.style.display = 'none';
  const af = document.getElementById('auditFlow');
  if (af) af.style.display = 'block';
  if (typeof initAuditWizard === 'function') initAuditWizard(false);
}

// Depuis le résultat affiché, ramène à l'écran de saisie pour analyser un
// nouveau compte : efface le résultat précédent et réaffiche le champ @.
function analyserAutreCompteDiagSommaire() {
  resetDiagnosticSommaireForm();
  const input = document.getElementById('diagSommaireInput');
  if (input) input.focus();
}

function diagSommaireEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

// Extrait le nombre d'abonnés du profil brut, quel que soit le nommage
// renvoyé par LamaTok (structure TikTok : stats.followerCount, ou plat).
function dsAbonnes(profil) {
  const p = profil || {};
  const s = p.stats || p.statistics || p.user?.stats || p;
  const v = s.followerCount ?? s.follower_count ?? s.followers ?? p.followerCount ?? p.follower_count ?? null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Calcule à partir des vidéos réelles (endpoint /v1/user/medias) les
// métriques nécessaires aux dimensions Portée, Régularité et Viralité.
// Retourne null si trop peu de vidéos chiffrées pour être fiable — le
// diagnostic retombe alors sur l'Engagement seul (comme avant).
function calculerMetriquesVideos(medias, abonnes) {
  const vid = (Array.isArray(medias) ? medias : []).filter(v => typeof v.vues === 'number' && v.vues >= 0);
  if (vid.length < 3) return null;
  const vues = vid.map(v => v.vues).sort((a, b) => a - b);
  const n = vues.length;
  const moyVues = Math.round(vues.reduce((a, b) => a + b, 0) / n);
  const medianeVues = n % 2 ? vues[(n - 1) / 2] : Math.round((vues[n / 2 - 1] + vues[n / 2]) / 2);
  const maxVues = vues[n - 1];
  const ratioViral = medianeVues > 0 ? Math.round((maxVues / medianeVues) * 10) / 10 : null;
  const pctPics = Math.round(vid.filter(v => v.vues >= 2 * medianeVues).length / n * 100);
  const ratioPortee = abonnes ? Math.round((moyVues / abonnes) * 1000) / 10 : null; // en %

  const dates = vid.map(v => v.date).filter(d => typeof d === 'number' && d > 0).sort((a, b) => a - b);
  let videosParSemaine = null, joursCouverts = null;
  if (dates.length >= 2) {
    joursCouverts = Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / 86400));
    videosParSemaine = Math.round((dates.length / joursCouverts) * 7 * 10) / 10;
  }
  return { n, moyVues, medianeVues, maxVues, ratioViral, pctPics, ratioPortee, videosParSemaine, joursCouverts };
}

// Bascule entre l'écran de saisie (@nom d'utilisateur) et l'écran "analyse
// en cours" — jamais les deux affichés en même temps.
function toggleDiagSommaireEntree(visible) {
  document.querySelectorAll('#diagSommaireFlow .ds-field, #diagSommaireFlow .ds-note, #diagSommaireFlow .ds-sep, #diagSommaireFlow .ds-alt').forEach(el => {
    el.style.display = visible ? '' : 'none';
  });
}

// Messages qui défilent sous le pourcentage pendant l'analyse — ce
// diagnostic est rapide (un seul profil public à lire), contrairement au
// diagnostic complet par captures qui peut prendre plusieurs minutes.
const DS_LOADING_MESSAGES = [
  'On récupère ton profil…',
  'On calcule ton engagement…',
  'On analyse ta bio et ta niche…',
  'On identifie tes leviers prioritaires…'
];
let _dsLoadingTimer = null;

function demarrerAnimationChargementDs() {
  const pctEl = document.getElementById('dsLoadingPct');
  const statusEl = document.getElementById('dsLoadingStatus');
  if (statusEl) statusEl.textContent = DS_LOADING_MESSAGES[0];
  let i = 0;
  if (_dsLoadingTimer) clearInterval(_dsLoadingTimer);
  _dsLoadingTimer = setInterval(() => {
    i = (i + 1) % DS_LOADING_MESSAGES.length;
    if (statusEl) statusEl.textContent = DS_LOADING_MESSAGES[i];
  }, 1600);
  // Réutilise le même moteur de progression estimée que le storyboard
  // (js/storyboard.js) — durée courte car un seul appel léger est en jeu ici.
  const prog = (typeof createProgress === 'function')
    ? createProgress((p) => { if (pctEl) pctEl.textContent = p + '%'; }, 6000)
    : null;
  if (prog) prog.start();
  return prog;
}

function arreterAnimationChargementDs(prog) {
  if (_dsLoadingTimer) { clearInterval(_dsLoadingTimer); _dsLoadingTimer = null; }
  if (prog) prog.finish();
}

async function lancerDiagnosticSommaire() {
  const inputEl = document.getElementById('diagSommaireInput');
  const errorBox = document.getElementById('diagSommaireErrorBox');
  const btn = document.getElementById('diagSommaireGoBtn');
  const spinner = document.getElementById('diagSommaireSpinner');
  const arrow = document.getElementById('diagSommaireGoArrow');
  const results = document.getElementById('diagSommaireResults');

  errorBox.style.display = 'none';
  const brut = (inputEl.value || '').trim();
  const username = brut.replace(/^@+/, '');

  if (!username || !/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    errorBox.textContent = "Entre un nom d'utilisateur TikTok valide (lettres, chiffres, points, underscores).";
    errorBox.style.display = 'block';
    return;
  }

  // Même quota que les autres modes de création (script, idées, récit) :
  // aucun compteur dédié au diagnostic sommaire — non-abonné : ses 5
  // générations gratuites partagées ; abonné : son quota mensuel de création.
  if (!unlocked && usedGen >= MAX_FREE) {
    openPlans('nouveau');
    return;
  }
  if (!(await peutGenerer('diagSommaireErrorBox'))) return;

  btn.disabled = true;
  spinner.style.display = 'block';
  arrow.style.display = 'none';
  results.style.display = 'none';

  toggleDiagSommaireEntree(false);
  const loadingEl = document.getElementById('diagSommaireLoading');
  if (loadingEl) loadingEl.style.display = 'block';
  const dsProg = demarrerAnimationChargementDs();

  try {
    // Récupère le profil public via notre fonction serveur (clé LamaTok
    // jamais exposée au navigateur). Profil seul : voir note en tête de
    // fichier sur la limite structurelle de LamaTok (pas de liste de vidéos).
    const rep = await fetch('/api/username-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const donnees = await rep.json();
    if (!rep.ok) {
      throw new Error(donnees?.error?.message || "Profil introuvable. Vérifie l'orthographe, ou envoie tes captures pour l'analyse complète.");
    }

    // Métriques calculées à partir des vraies vidéos (endpoint medias). null
    // si LamaTok n'a pas renvoyé assez de vidéos → on reste sur l'Engagement.
    const abonnes = dsAbonnes(donnees.profil);
    const metriques = calculerMetriquesVideos(donnees.medias, abonnes);

    // Bloc vidéos injecté dans le prompt UNIQUEMENT si on a des métriques
    // réelles — sinon on garde la consigne d'origine (profil seul).
    const blocVideos = metriques ? `

DONNÉES PAR VIDÉO (calculées à partir des ${metriques.n} dernières vidéos publiques réelles — ce sont des FAITS, utilise-les tels quels) :
- Vues moyennes par vidéo : ${metriques.moyVues}
- Vues médianes par vidéo : ${metriques.medianeVues}
- Meilleure vidéo : ${metriques.maxVues} vues
${metriques.ratioPortee != null ? `- Portée : les vidéos font en moyenne ${metriques.ratioPortee}% du nombre d'abonnés en vues` : ''}
${metriques.videosParSemaine != null ? `- Cadence de publication : environ ${metriques.videosParSemaine} vidéo(s) par semaine (sur ${metriques.joursCouverts} jours couverts)` : ''}
- Rapport pic/médiane : la meilleure vidéo fait ${metriques.ratioViral}× les vues de la vidéo médiane ; ${metriques.pctPics}% des vidéos dépassent 2× la médiane.

Tu DOIS scorer Portée, Régularité et Viralité à partir de ces faits (voir barèmes plus bas).` : `

LIMITE : tu n'as PAS reçu les vidéos individuelles de ce compte (uniquement le profil agrégé). Mets donc "disponible": false et score null pour Portée, Régularité et Viralité — n'invente aucune de ces trois valeurs.`;

    // Sujets des vidéos (légendes) triés par vues : nourrit l'analyse de
    // CONTENU (niche réelle, top/flop, concepts récurrents). Vide si absent.
    const videosAvecSujet = (Array.isArray(donnees.medias) ? donnees.medias : [])
      .filter(v => v.desc && typeof v.vues === 'number')
      .sort((a, b) => b.vues - a.vues);
    const blocSujets = videosAvecSujet.length >= 3 ? `

SUJETS DES VIDÉOS (${videosAvecSujet.length} vidéos récupérées, triées de la plus vue à la moins vue — sujet réel + performance ; c'est ta SEULE source pour la niche réelle, le top/flop et les concepts récurrents) :
${videosAvecSujet.slice(0, 20).map(v => `- ${v.vues} vues${v.commentaires != null ? `, ${v.commentaires} comm.` : ''} : « ${v.desc.replace(/\s+/g, ' ').slice(0, 140)} »`).join('\n')}` : '';

    const prompt = `Tu es Scriptura, consultant TikTok pour créateurs francophones. On te donne les données PUBLIQUES brutes d'un profil TikTok (@${username}), au format JSON, récupérées via une API tierce. Le nom exact des champs peut varier : identifie-les par leur sens (abonnés, abonnements, likes cumulés reçus sur toutes les vidéos, nombre de vidéos publiées, bio, statut vérifié).

PROFIL :
${JSON.stringify(donnees.profil || {}).slice(0, 4000)}
${blocVideos}
${blocSujets}

RÈGLE ABSOLUE D'HONNÊTETÉ : n'utilise QUE ce qui est réellement présent dans ces données (profil + éventuel bloc "DONNÉES PAR VIDÉO"). Si une donnée est absente, mets null / "disponible": false — n'invente jamais un chiffre.

ENGAGEMENT (sur 30) : si le nombre de likes cumulés ET le nombre de vidéos sont présents, calcule les likes moyens par vidéo (likes cumulés ÷ nombre de vidéos), puis juge si c'est proportionnellement élevé ou faible face au nombre d'abonnés. Précise que c'est une estimation (le vrai taux d'engagement nécessiterait les vues par vidéo). Si l'un des deux chiffres manque, "disponible": false et score null.
   BARÈME /30 (strict) : TRÈS FAIBLE → 0-8 · FAIBLE → 9-15 · CORRECT → 16-22 · FORT → 23-30.

PORTÉE (sur 30) : disponible UNIQUEMENT si le bloc "DONNÉES PAR VIDÉO" est présent. Base-toi sur le % vues/abonnés (portée) : un compte sain fait souvent 20% ou plus de son audience en vues moyennes ; en dessous de 10%, la portée est faible.
   BARÈME /30 (strict) : TRÈS FAIBLE (portée < 8% des abonnés) → 0-8 · FAIBLE (8-20%) → 9-15 · CORRECTE (20-50%) → 16-22 · FORTE (> 50%, ou vues qui dépassent l'audience) → 23-30.

RÉGULARITÉ (sur 20) : disponible UNIQUEMENT si la cadence est fournie. Base-toi sur les vidéos/semaine.
   BARÈME /20 (strict) : quasi inactif (< 0,5/sem) → 0-5 · irrégulier (0,5-2/sem) → 6-11 · régulier (2-5/sem) → 12-16 · très soutenu (> 5/sem) → 17-20.

VIRALITÉ (sur 20) : disponible UNIQUEMENT si le rapport pic/médiane est fourni. Un compte avec des pics nets a un rapport pic/médiane élevé et plusieurs vidéos au-dessus de 2× la médiane. Un rapport proche de 1 = contenu plat, sans percée.
   BARÈME /20 (strict) : aucun pic (rapport < 2 et 0% de pics) → 0-5 · faible (2-4×) → 6-11 · bon (4-10×) → 12-16 · fort potentiel viral (> 10×, plusieurs pics) → 17-20.

COHÉRENCE ABSOLUE (règle non négociable) : pour CHAQUE dimension, le score chiffré, le mot employé dans le constat, et la "sante_compte" globale doivent aller dans le MÊME sens. Il est INTERDIT d'écrire "très faible" avec 18/30, ou de dire "faible" partout et conclure "santé Bonne". Relis-toi : un lecteur ne doit jamais voir un chiffre qui contredit tes mots.

BIO : évalue la bio actuelle du profil. Est-elle claire, spécifique, révèle-t-elle vraiment ce que fait ce compte ? Si elle est générique ou vague, propose EXACTEMENT 2 alternatives courtes et percutantes, dans le même esprit mais plus révélatrices de la valeur du compte.

NICHE : identifie la niche/thématique dominante à partir des SUJETS RÉELS des vidéos (bloc « SUJETS DES VIDÉOS ») EN PRIORITÉ, complétée par la bio. Sois précis et spécifique (ex. « storytelling historique — focus Afrique francophone », pas juste « histoire »). Dis si le positionnement est clair ou flou d'après ce que révèlent les sujets, avec 1 à 2 points d'analyse ANCRÉS dans les vidéos observées. Si aucun sujet de vidéo n'est fourni, rabats-toi sur la bio seule, et "disponible": false si même la bio ne permet pas de trancher.

TOP & FLOP VIDÉOS : UNIQUEMENT si le bloc « SUJETS DES VIDÉOS » est présent. La médiane des vues de ce compte est ${metriques ? metriques.medianeVues : 'inconnue'}.
   • TOP = uniquement les vidéos NETTEMENT AU-DESSUS de la médiane (de vraies percées). S'il n'y en a qu'une, n'en mets qu'une — ne complète JAMAIS avec des vidéos moyennes juste pour remplir. Maximum 3.
   • FLOP = uniquement les vidéos NETTEMENT EN-DESSOUS de la médiane. Maximum 3.
   • Une vidéo proche de la médiane ne va NI dans le top NI dans le flop (liste vide autorisée pour l'un ou l'autre).
   Pour chacune : résume le SUJET en quelques mots (pas la légende entière), donne le nombre de vues, et explique en une phrase la raison de la performance. INTERDIT d'écrire « en deçà de la médiane » pour une vidéo du top, ou « performe bien » pour une vidéo du flop : le constat doit toujours coller à la position réelle vs la médiane.

CONCEPTS RÉCURRENTS : UNIQUEMENT si les sujets sont fournis. Liste 3 à 7 thèmes/angles qui reviennent dans les vidéos (ex. « coups d'État africains », « histoires vraies méconnues », « géopolitique expliquée »). Formule court, comme des étiquettes. Sinon liste vide.

LEVIERS PRIORITAIRES : exactement 3 actions concrètes, fondées sur ce que tu observes réellement (profil ET sujets/performances des vidéos si fournis). Quand c'est pertinent, CITE une vidéo précise et ses vues pour appuyer (ex. « ta vidéo sur X a fait Y vues : décline ce format »). Jamais de supposition sur des vidéos absentes des données.

SANTÉ DU COMPTE : une appréciation globale ("Excellente", "Bonne", "Fragile" ou "Critique") fondée sur les signaux réellement disponibles (taille d'audience, ratio likes/vidéos si calculable, clarté de la bio) — reste prudent si peu de données sont exploitables.

RÈGLE DE FORMAT DES NOMBRES : dans tes phrases, écris les nombres normalement (ex: "12 400 abonnés"), jamais de séparateur anglo-saxon.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
{
  "profil_trouve": <true si les données décrivent bien un profil existant, false sinon>,
  "compte_verifie": <true/false/null>,
  "engagement": { "score": <0-30 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases>" },
  "portee": { "score": <0-30 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, ou explication si non disponible>" },
  "regularite": { "score": <0-20 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, ou explication si non disponible>" },
  "viralite": { "score": <0-20 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, ou explication si non disponible>" },
  "sante_compte": "<Excellente|Bonne|Fragile|Critique>",
  "bio": { "actuelle": "<texte tel quel, ou null>", "etat": "<claire|a_retravailler>", "critique": "<1-2 phrases>", "suggestions": ["<alternative 1>", "<alternative 2>"] },
  "niche": { "disponible": <true/false>, "nom": "<...>", "etat": "<claire|floue>", "analyse": ["<point 1>", "<point 2 si pertinent>"] },
  "top_videos": [ { "sujet": "<résumé court>", "vues": <nombre>, "constat": "<1 phrase>" } ],
  "flop_videos": [ { "sujet": "<résumé court>", "vues": <nombre>, "constat": "<1 phrase>" } ],
  "concepts_recurrents": ["<concept 1>", "<concept 2>"],
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<1-2 phrases>" } ]
}`;

    const raw = await callAI(MODEL_RAPIDE, 2600, prompt);
    const parsed = parseAIResponse(raw);
    if (!parsed || parsed.profil_trouve === false) {
      throw new Error("Profil introuvable ou privé. Vérifie l'orthographe du nom d'utilisateur.");
    }

    // Décompte du quota : même compteur partagé que les autres modes.
    if (!unlocked) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      renderGenCounter();
      checkRappelAbonnement();
    }

    const titre = 'Diagnostic sommaire · @' + username;
    saveGeneration('diagnosticSommaire', titre, { username: username, diagnostic: parsed });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    afficherDiagnosticSommaireResultat(parsed, username);

  } catch (e) {
    errorBox.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    errorBox.style.display = 'block';
    // Ré-affiche le champ de saisie uniquement en cas d'échec, pour permettre
    // de réessayer — en cas de succès, il reste masqué : le résultat prend
    // sa place (voir analyserAutreCompteDiagSommaire pour le faire réapparaître).
    toggleDiagSommaireEntree(true);
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    arrow.style.display = '';
    arreterAnimationChargementDs(dsProg);
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// Anime l'anneau de score + le chiffre qui monte — même mécanique que
// js/audit.js (animerScoreAudit), sur des identifiants distincts (dsRingFill
// / dsScoreNum) puisque les deux écrans ont chacun leur propre anneau.
function animerScoreDiagSommaire(valeur, circonference) {
  const numEl = document.getElementById('dsScoreNum');
  const ringEl = document.getElementById('dsRingFill');
  if (valeur == null || Number.isNaN(valeur)) {
    if (numEl) numEl.textContent = '—';
    return;
  }
  const cible = Math.max(0, Math.min(100, valeur));
  const offsetFinal = circonference * (1 - cible / 100);

  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduit) {
    if (numEl) numEl.textContent = cible;
    if (ringEl) ringEl.style.strokeDashoffset = offsetFinal;
    return;
  }

  if (ringEl) requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offsetFinal; });

  const duree = 1300;
  const debut = performance.now();
  function tick(maintenant) {
    const t = Math.min(1, (maintenant - debut) / duree);
    if (numEl) numEl.textContent = Math.round(cible * t);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const DS_DIM_META = {
  engagement: { icone: '📈', label: 'Engagement', max: 30 },
  portee:     { icone: '👁️', label: 'Portée', max: 30 },
  regularite: { icone: '📅', label: 'Régularité', max: 20 },
  viralite:   { icone: '⚡', label: 'Viralité', max: 20 }
};

// Ces 3 dimensions ont structurellement besoin de données par vidéo
// (dates, vues individuelles) qu'aucun profil public LamaTok n'expose —
// toujours non disponibles ici, jamais une estimation inventée.
const DS_TOUJOURS_INDISPONIBLE = {
  portee: "Non calculable avec un simple profil public : TikTok n'expose pas le nombre de vues par vidéo à cette échelle. Le diagnostic complet (captures) le permet.",
  regularite: "Non calculable sans la date de chaque vidéo, une donnée absente d'un profil public. Le diagnostic complet (captures) le permet.",
  viralite: "Non calculable sans pouvoir comparer tes vidéos entre elles individuellement — donnée indisponible via un simple profil public."
};

// Affiche le résultat (nouvelle génération OU réouverture depuis l'historique).
function afficherDiagnosticSommaireResultat(d, username) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !d) return;

  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;

  // Score recalculé ici, jamais fourni tel quel par l'IA (même principe que
  // js/audit.js) : ramené sur 100 à partir des SEULES dimensions réellement
  // mesurées. Quand les vidéos sont disponibles (endpoint medias), les 4
  // dimensions comptent ; sinon, seul l'Engagement (comme avant).
  const dimEstMesurable = (dim) =>
    dim && dim.disponible !== false && typeof dim.score === 'number' && !Number.isNaN(dim.score);

  let scoreObtenu = 0, scoreMax = 0, nbDimsMesurees = 0;
  Object.keys(DS_DIM_META).forEach(cle => {
    const meta = DS_DIM_META[cle];
    const dim = d[cle];
    if (dimEstMesurable(dim)) {
      scoreObtenu += Math.max(0, Math.min(meta.max, dim.score));
      scoreMax += meta.max;
      nbDimsMesurees++;
    }
  });
  const score = scoreMax > 0 ? Math.round((scoreObtenu / scoreMax) * 100) : null;

  // Couleur selon le niveau du score : rouge en dessous de 50, orange entre
  // 50 et 70, émeraude à partir de 70 — même palette que js/audit.js
  // (paletteScoreAudit), pour un repère de couleur cohérent entre les deux
  // diagnostics.
  const paletteScore = paletteScoreAudit(score);
  const ringColorA = paletteScore.ringA;
  const ringColorB = paletteScore.ringB;

  const dimsHtml = Object.keys(DS_DIM_META).map(cle => {
    const meta = DS_DIM_META[cle];
    // Dimension telle que renvoyée par l'IA ; à défaut (dimension absente de
    // la réponse), on la marque non disponible avec le texte explicatif dédié.
    const dim = d[cle] || { disponible: false, constat: DS_TOUJOURS_INDISPONIBLE[cle] };
    // Badge coloré selon le niveau (rouge/orange/émeraude) — voir
    // niveauScoreSur() dans js/audit.js, seuils partagés avec le score global.
    const disponible = dimEstMesurable(dim);
    const niveau = disponible ? niveauScoreSur(dim.score, meta.max) : 'niveau-neutre';
    // Constat : celui de l'IA si présent, sinon le texte "non disponible".
    const constat = dim.constat || DS_TOUJOURS_INDISPONIBLE[cle] || '';
    return `<div class="ds-dim-card">
      <div class="ds-dim-head">
        <span class="ds-dim-icon">${meta.icone}</span>
        <span class="ds-dim-name">${meta.label}</span>
        <span class="score-badge ${niveau}">${disponible ? (dim.score + '/' + meta.max) : '—'}</span>
      </div>
      <p class="ds-dim-text">${diagSommaireEsc(constat)}</p>
    </div>`;
  }).join('');

  const bio = d.bio || {};
  const bioOk = bio.etat === 'claire';
  const bioHtml = bio.actuelle ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Ton profil</div>
        <span class="ds-tag${bioOk ? ' ds-tag-ok' : ''}">${bioOk ? 'Bio claire' : 'Bio à retravailler'}</span>
      </div>
      <p class="ds-bio-actuelle">« ${diagSommaireEsc(bio.actuelle)} »</p>
      <p class="audit-diag-constat" style="margin-top:10px">${diagSommaireEsc(bio.critique)}</p>
      ${Array.isArray(bio.suggestions) && bio.suggestions.length ? `
      <div class="audit-section-label" style="margin-top:18px">💡 Suggestions pour la bio</div>
      ${bio.suggestions.map(s => `<p class="ds-suggestion">${diagSommaireEsc(s)}</p>`).join('')}` : ''}
    </div>` : '';

  const niche = d.niche || {};
  const nicheOk = niche.etat === 'claire';
  const nicheHtml = (niche.disponible !== false && niche.nom) ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Ta niche</div>
        <span class="ds-tag${nicheOk ? ' ds-tag-ok' : ''}">${nicheOk ? 'Niche claire' : 'Niche encore floue'}</span>
      </div>
      <div class="audit-diag-constat">${diagSommaireEsc(niche.nom)}</div>
      ${Array.isArray(niche.analyse) && niche.analyse.length ? `<ul class="ds-niche-analyse">${niche.analyse.map(p => `<li>${diagSommaireEsc(p)}</li>`).join('')}</ul>` : ''}
    </div>` : '';

  // Top / Flop vidéos + concepts récurrents : issus de l'analyse du CONTENU
  // réel des vidéos (sujets + vues). N'apparaissent que si l'IA les a fournis
  // (donc uniquement quand la liste des vidéos a été récupérée).
  const fmtVues = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    if (v >= 1e6) return (Math.round(v / 1e5) / 10).toString().replace('.', ',') + ' M';
    if (v >= 1e3) return Math.round(v / 1e3) + ' K';
    return String(v);
  };
  const carteVideos = (titre, tag, tagOk, liste) => (Array.isArray(liste) && liste.length) ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">${titre}</div>
        <span class="ds-tag${tagOk ? ' ds-tag-ok' : ''}">${tag}</span>
      </div>
      <ul class="ds-videos-list">
        ${liste.slice(0, 3).map(v => `<li>
          <div class="ds-video-head"><span class="ds-video-sujet">${diagSommaireEsc(v.sujet)}</span><span class="ds-video-vues">${fmtVues(v.vues)} vues</span></div>
          ${v.constat ? `<p class="ds-video-constat">${diagSommaireEsc(v.constat)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </div>` : '';
  const topHtml = carteVideos('Tes vidéos qui cartonnent', '🔥 Top', true, d.top_videos);
  const flopHtml = carteVideos('Tes vidéos en retrait', 'À revoir', false, d.flop_videos);

  const concepts = Array.isArray(d.concepts_recurrents) ? d.concepts_recurrents.filter(Boolean) : [];
  const conceptsHtml = concepts.length ? `
    <div class="score-card">
      <div class="audit-section-label">Concepts récurrents</div>
      <div class="ds-concepts">${concepts.map(c => `<span class="ds-concept-chip">${diagSommaireEsc(c)}</span>`).join('')}</div>
    </div>` : '';

  const leviers = Array.isArray(d.leviers_prioritaires) ? d.leviers_prioritaires : [];
  const leviersHtml = leviers.length ? `
    <div class="score-card">
      <div class="audit-section-label">Tes leviers prioritaires</div>
      <ol class="ds-leviers-list">
        ${leviers.map(l => `<li><b>${diagSommaireEsc(l.titre)}</b><p>${diagSommaireEsc(l.detail)}</p></li>`).join('')}
      </ol>
    </div>` : '';

  // Invitation vers l'analyse détaillée (captures) — copie différente selon
  // que l'utilisateur y a déjà accès (Pro/admin) ou doit encore la débloquer
  // (Creator, non-abonné), mais les DEUX versions mentionnent le jeton.
  // Bouton : celui qui a déjà accès part directement sur l'assistant de
  // captures (ouvrirCapturesDepuisChoix, qui vérifie l'accès et route au
  // besoin) ; celui qui n'a pas encore accès ouvre TOUJOURS le pop-up
  // d'abonnement (avec les jetons visibles), sans passer par cette même
  // fonction qui pourrait filer droit à l'assistant s'il a déjà des jetons —
  // on veut qu'il voie ses options avant de consommer quoi que ce soit.
  const dejaAcces = (typeof aAccesMode === 'function' && aAccesMode('audit'));
  // "Ton plan Pro" uniquement pour un vrai abonné Pro payant — un compte
  // admin/illimité a aussi accès, mais n'est pas au plan Pro à proprement
  // parler, donc lui dire "ton plan Pro" serait faux.
  const estProPayant = dejaAcces && unlocked && (typeof monPalier === 'function') && monPalier() === 'pro';
  const ctaDetailleHtml = dejaAcces ? `
    <div class="ds-alt">
      <p style="margin:0 0 14px">Ce diagnostic rapide n'est qu'un aperçu. ${estProPayant ? 'Ton plan Pro te donne' : 'Tu as déjà'} accès à l'<strong>analyse détaillée</strong> : rétention, sources de trafic, formats qui performent, top et flop de tes vidéos. (Sans abonnement, cette analyse est aussi disponible à l'unité avec un jeton.)</p>
      <button class="btn-generate" onclick="ouvrirCapturesDepuisChoix()">Lancer l'analyse détaillée →</button>
    </div>` : `
    <div class="ds-alt">
      <p style="margin:0 0 14px">Ce diagnostic rapide n'est qu'un aperçu. L'<strong>analyse détaillée</strong> va bien plus loin — rétention, sources de trafic, formats qui performent, top et flop de tes vidéos. Disponible avec le plan Pro, ou <strong>à l'unité avec un jeton, sans abonnement</strong>.</p>
      <button class="btn-generate" onclick="openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne')">Débloquer l'analyse détaillée →</button>
    </div>`;

  // Placeholder pour la recommandation sommaire (non-abonnés avec assez de
  // mémoire locale — voir afficherOpportuniteDiagSommaire dans recommandations.js).
  const opportuniteHtml = (!unlocked) ? `<div id="diagSommaireOpportunites"></div>` : '';

  results.innerHTML = `
    <div class="score-card audit-score-card ds-score-card">
      <div class="audit-score-label">DIAGNOSTIC SOMMAIRE · @${diagSommaireEsc(username)}</div>
      <div class="audit-ring-wrap">
        <svg class="audit-ring" viewBox="0 0 170 170">
          <defs>
            <linearGradient id="dsRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${ringColorA}"/>
              <stop offset="100%" stop-color="${ringColorB}"/>
            </linearGradient>
          </defs>
          <circle class="audit-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="audit-ring-fill" id="dsRingFill" cx="85" cy="85" r="${RING_R}" stroke="url(#dsRingGrad)"
            stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"/>
        </svg>
        <div class="audit-ring-center">
          <div class="audit-score-num" style="color:${paletteScore.texte}"><span id="dsScoreNum">0</span><span class="audit-score-suffix">/100</span></div>
        </div>
      </div>
      <div class="audit-score-phrase">${
        nbDimsMesurees >= 4
          ? 'Calculé sur les 4 dimensions (Engagement, Portée, Régularité, Viralité), à partir de tes dernières vidéos publiques.'
          : nbDimsMesurees > 0
            ? ('Calculé sur ' + nbDimsMesurees + ' dimension' + (nbDimsMesurees > 1 ? 's' : '') + ' sur 4 — les autres nécessitent des données par vidéo que ce compte n\'a pas permis de récupérer.')
            : 'Score non calculable : les données publiques de ce profil ne permettent d\'estimer aucune des 4 dimensions.'
      }</div>
    </div>

    <div class="ds-dims-grid">${dimsHtml}</div>

    ${d.sante_compte ? `<div class="ds-sante-row"><span class="ds-tag ${niveauDepuisLabelSante(d.sante_compte)}">Santé du compte : ${diagSommaireEsc(d.sante_compte)}</span></div>` : ''}

    ${bioHtml}
    ${nicheHtml}
    ${topHtml}
    ${flopHtml}
    ${conceptsHtml}
    ${leviersHtml}
    ${opportuniteHtml}

    ${ctaDetailleHtml}
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="analyserAutreCompteDiagSommaire()">Analyser un autre compte</button>`;

  results.style.display = 'block';
  setTimeout(() => animerScoreDiagSommaire(score, RING_C), 50);

  // Recommandation sommaire pour les non-abonnés qui ont déjà assez de
  // mémoire locale (script, récit, autre diagnostic déjà fait sur ce
  // navigateur) — en tâche de fond, ne retarde jamais l'affichage du
  // diagnostic lui-même. Voir js/recommandations.js.
  if (!unlocked && typeof afficherOpportuniteDiagSommaire === 'function') {
    afficherOpportuniteDiagSommaire();
  }
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

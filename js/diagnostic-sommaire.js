// ═══════════════════════════════════════════════════════════
//  MODULE DIAGNOSTIC SOMMAIRE, analyse via @nom d'utilisateur TikTok
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
// , même mécanique que l'anneau de score du diagnostic complet).
//  Quota : aucun compteur dédié, consomme le même quota que les autres
//  modes de création (script, idées, récit). Non-abonné : ses 5
//  générations gratuites partagées ; Creator/Pro : leur quota mensuel de
//  création habituel.
// ═══════════════════════════════════════════════════════════

// Type de compte analysé : true = le compte de l'utilisateur, false = un
// concurrent. Sert à alimenter DIFFÉREMMENT les recommandations (voir
// js/recommandations.js) : mes données vs intelligence de niche à adapter.
let _sommaireEstMonCompte = true;

// Bascule le sélecteur Mon compte / Compte concurrent.
function choisirScopeSommaire(estMoi) {
  _sommaireEstMonCompte = !!estMoi;
  const bMoi = document.getElementById('dsScopeMoi');
  const bConc = document.getElementById('dsScopeConcurrent');
  if (bMoi) bMoi.classList.toggle('actif', _sommaireEstMonCompte);
  if (bConc) bConc.classList.toggle('actif', !_sommaireEstMonCompte);
}

// Prépare l'écran de choix pour une nouvelle analyse (efface le champ,
// les erreurs et un éventuel résultat précédent encore affiché).
function resetDiagnosticSommaireForm() {
  const input = document.getElementById('diagSommaireInput');
  if (input) input.value = '';
  // Repart toujours sur « Mon compte » par défaut.
  choisirScopeSommaire(true);
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
// (ou aux jetons), même vérification qu'avant la refonte de l'écran d'entrée.
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

// Depuis le résultat d'un CONCURRENT : ramène à l'écran de saisie en forçant le
// scope sur « Mon compte » (resetDiagnosticSommaireForm remet déjà le sélecteur
// sur « Mon compte »), pour enchaîner sur l'analyse de son propre compte et se
// comparer.
function analyserMonCompteDepuisConcurrent() {
  resetDiagnosticSommaireForm(); // remet le scope sur « Mon compte »
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
// Retourne null si trop peu de vidéos chiffrées pour être fiable, le
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

  // Taux d'engagement RÉEL par vidéo (interactions ÷ vues) : la vraie mesure
  // d'engagement, et surtout STABLE et déterministe. On prend la MÉDIANE (robuste
  // aux vidéos extrêmes) sur les vidéos qui ont des vues > 0. Exprimé en % (0-100).
  const avecVues = vid.filter(v => typeof v.vues === 'number' && v.vues > 0);
  let tauxEngagementPct = null;
  if (avecVues.length >= 3) {
    const taux = avecVues.map(v => {
      const inter = (v.likes || 0) + (v.commentaires || 0) + (v.partages || 0);
      return inter / v.vues;
    }).sort((a, b) => a - b);
    const m = taux.length;
    const med = m % 2 ? taux[(m - 1) / 2] : (taux[m / 2 - 1] + taux[m / 2]) / 2;
    tauxEngagementPct = Math.round(med * 1000) / 10; // 1 décimale, en %
  }

  return { n, moyVues, medianeVues, maxVues, ratioViral, pctPics, ratioPortee, videosParSemaine, joursCouverts, tauxEngagementPct };
}

// Barème → note : interpolation linéaire DÉTERMINISTE dans une fourchette.
// Même valeur d'entrée ⇒ toujours la même note (contrairement à l'IA qui, à
// température 1, tirait un nombre différent dans la fourchette à chaque appel).
function _dsClamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function _dsInterp(x, x0, x1, s0, s1) {
  if (x1 === x0) return Math.round((s0 + s1) / 2);
  return Math.round(s0 + ((x - x0) / (x1 - x0)) * (s1 - s0));
}

// Calcule les 4 notes EN CODE à partir des métriques réelles (mêmes barèmes que
// ceux décrits à l'IA), pour un score parfaitement reproductible. L'IA ne note
// plus rien : elle ne fournit que les constats et l'analyse qualitative.
// Renvoie null si aucune métrique (mode « profil seul »), le diagnostic garde
// alors le comportement dégradé habituel (engagement estimé par l'IA).
function scorerDimensionsSommaire(m) {
  if (!m) return null;
  const dims = {};

  // ENGAGEMENT /30 depuis le taux d'engagement réel (interactions/vues), en %.
  if (m.tauxEngagementPct != null) {
    const e = m.tauxEngagementPct;
    let s;
    if (e < 3)       s = _dsClamp(_dsInterp(e, 0, 3, 0, 8), 0, 8);
    else if (e < 7)  s = _dsInterp(e, 3, 7, 9, 15);
    else if (e < 15) s = _dsInterp(e, 7, 15, 16, 22);
    else             s = _dsClamp(_dsInterp(e, 15, 30, 23, 30), 23, 30);
    dims.engagement = { score: s, disponible: true };
  } else dims.engagement = { score: null, disponible: false };

  // PORTÉE /30 depuis le % vues/abonnés.
  if (m.ratioPortee != null) {
    const p = m.ratioPortee;
    let s;
    if (p < 8)       s = _dsClamp(_dsInterp(p, 0, 8, 0, 8), 0, 8);
    else if (p < 20) s = _dsInterp(p, 8, 20, 9, 15);
    else if (p < 50) s = _dsInterp(p, 20, 50, 16, 22);
    else             s = _dsClamp(_dsInterp(p, 50, 150, 23, 30), 23, 30);
    dims.portee = { score: s, disponible: true };
  } else dims.portee = { score: null, disponible: false };

  // RÉGULARITÉ /20 depuis les vidéos/semaine.
  if (m.videosParSemaine != null) {
    const v = m.videosParSemaine;
    let s;
    if (v < 0.5)     s = _dsClamp(_dsInterp(v, 0, 0.5, 0, 5), 0, 5);
    else if (v < 2)  s = _dsInterp(v, 0.5, 2, 6, 11);
    else if (v < 5)  s = _dsInterp(v, 2, 5, 12, 16);
    else             s = _dsClamp(_dsInterp(v, 5, 10, 17, 20), 17, 20);
    dims.regularite = { score: s, disponible: true };
  } else dims.regularite = { score: null, disponible: false };

  // VIRALITÉ /20 depuis le rapport pic/médiane (et présence de pics).
  if (m.ratioViral != null) {
    const r = m.ratioViral;
    let s;
    if (r < 2)       s = (m.pctPics > 0) ? 5 : _dsClamp(_dsInterp(r, 1, 2, 0, 5), 0, 5);
    else if (r < 4)  s = _dsInterp(r, 2, 4, 6, 11);
    else if (r < 10) s = _dsInterp(r, 4, 10, 12, 16);
    else             s = _dsClamp(_dsInterp(r, 10, 20, 17, 20), 17, 20);
    dims.viralite = { score: s, disponible: true };
  } else dims.viralite = { score: null, disponible: false };

  return dims;
}

// Bascule entre l'écran de saisie (@nom d'utilisateur) et l'écran "analyse
// en cours", jamais les deux affichés en même temps.
function toggleDiagSommaireEntree(visible) {
  document.querySelectorAll('#diagSommaireFlow .ds-scope, #diagSommaireFlow .ds-field, #diagSommaireFlow .ds-note, #diagSommaireFlow .ds-sep, #diagSommaireFlow .ds-alt').forEach(el => {
    el.style.display = visible ? '' : 'none';
  });
}

// Messages qui défilent sous le pourcentage pendant l'analyse, ce
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
  // (js/storyboard.js), durée courte car un seul appel léger est en jeu ici.
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

// Cœur d'analyse de CONTENU réutilisable : à partir des données brutes déjà
// récupérées (profil LamaTok + vidéos ScrapTik) et du @username, calcule les
// métriques, bâtit le prompt (dimensions + niche + top/flop + concepts +
// pivot) et renvoie l'objet diagnostic parsé. Extrait de lancerDiagnosticSommaire
// pour que l'analyse détaillée (js/audit.js) puisse lancer un scan de contenu
// silencieux et enrichir sa synthèse croisée, sans dupliquer ce pipeline.
async function _diagnostiquerContenu(donnees, username, estMonCompte = true) {
  const moi = estMonCompte !== false;
  // Les vidéos couvrent ~6 mois. Les 4 DIMENSIONS (score) se calculent sur le
  // RÉCENT (2 derniers mois) = l'état ACTUEL du compte ; l'analyse de contenu
  // et la détection de pivot, elles, exploitent tout l'historique (bloc plus bas).
  const abonnes = dsAbonnes(donnees.profil);
  const toutesVideos = Array.isArray(donnees.medias) ? donnees.medias : [];
  const seuilRecent = Math.floor(Date.now() / 1000) - 60 * 86400;
  const videosRecentes = toutesVideos.filter(v => typeof v.date === 'number' && v.date >= seuilRecent);
  // Base des dimensions : le récent, avec plancher (les 20 plus récentes si
  // trop peu de vidéos ces 2 derniers mois) pour rester statistiquement fiable.
  const baseMetriques = videosRecentes.length >= 15
    ? videosRecentes
    : toutesVideos.slice(0, Math.max(15, videosRecentes.length));
  const metriques = calculerMetriquesVideos(baseMetriques, abonnes);

  const blocVideos = metriques ? `

DONNÉES PAR VIDÉO (calculées sur tes ${metriques.n} vidéos RÉCENTES ~2 derniers mois = état actuel, ce sont des FAITS) :
- Vues moyennes par vidéo : ${metriques.moyVues}
- Vues médianes par vidéo : ${metriques.medianeVues}
- Meilleure vidéo récente : ${metriques.maxVues} vues
${metriques.tauxEngagementPct != null ? `- Taux d'engagement réel (médiane interactions ÷ vues par vidéo) : ${metriques.tauxEngagementPct}%` : ''}
${metriques.ratioPortee != null ? `- Portée : les vidéos font en moyenne ${metriques.ratioPortee}% du nombre d'abonnés en vues` : ''}
${metriques.videosParSemaine != null ? `- Cadence de publication : environ ${metriques.videosParSemaine} vidéo(s) par semaine (sur ${metriques.joursCouverts} jours couverts)` : ''}
- Rapport pic/médiane : la meilleure vidéo fait ${metriques.ratioViral}× les vues de la vidéo médiane ; ${metriques.pctPics}% des vidéos dépassent 2× la médiane.

IMPORTANT : les NOTES chiffrées des 4 dimensions sont recalculées automatiquement par le code à partir de ces faits ; tes constats doivent rester COHÉRENTS avec ces chiffres (ne contredis pas un taux d'engagement de ${metriques.tauxEngagementPct != null ? metriques.tauxEngagementPct + '%' : 'n/a'} ou une portée de ${metriques.ratioPortee != null ? metriques.ratioPortee + '%' : 'n/a'}).` : `

LIMITE : tu n'as PAS reçu les vidéos individuelles de ce compte (uniquement le profil agrégé). Mets donc "disponible": false et score null pour Portée, Régularité et Viralité, n'invente aucune de ces trois valeurs.`;

  // Historique des vidéos AVEC DATES (mois/année), du plus récent au plus
  // ancien : nourrit la niche, le top/flop, les concepts ET la détection d'un
  // changement de cap (pivot). Chaque ligne porte [mois/année], vues et sujet.
  const fmtMois = (ts) => {
    if (typeof ts !== 'number' || !ts) return '??/????';
    const d = new Date(ts * 1000);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };
  const videosAvecSujet = toutesVideos
    .filter(v => v.desc && typeof v.vues === 'number')
    .sort((a, b) => (b.date || 0) - (a.date || 0)); // chronologique, récent d'abord
  const ligneVideo = v => `- [${fmtMois(v.date)}] ${v.vues} vues${v.commentaires != null ? `, ${v.commentaires} comm.` : ''} : « ${v.desc.replace(/\s+/g, ' ').slice(0, 120)} »`;
  const echantillon = videosAvecSujet.slice(0, 80);
  const blocSujets = echantillon.length >= 3 ? `

VIDÉOS (${echantillon.length}, de la plus récente à la plus ancienne, format [mois/année] puis vues puis sujet). C'est ta source pour la niche, le top/flop, les concepts ET la détection d'un éventuel changement de cap :
${echantillon.map(ligneVideo).join('\n')}` : '';

  // Intro selon le contexte : MON compte (posture coach, 2e personne) ou un
  // CONCURRENT (posture décodage, 3e pers. pour décrire le compte, 2e pers.
  // pour les enseignements adressés à l'utilisateur).
  const roleIntro = moi
    ? `Tu es Scriptura, consultant TikTok pour créateurs francophones. On te donne les données PUBLIQUES brutes du compte TikTok de l'utilisateur (@${username}), au format JSON, récupérées via une API tierce. Écris à la 2e personne (« ton compte », « tes vidéos »).`
    : `Tu es Scriptura, consultant TikTok pour créateurs francophones. L'utilisateur veut analyser un CONCURRENT (@${username}) pour comprendre ce qui fait marcher ce compte et en reprendre ce qui est transposable chez lui. On te donne les données PUBLIQUES brutes de ce compte concurrent, au format JSON, récupérées via une API tierce. RÈGLE D'ÉCRITURE : décris le compte concurrent à la 3e personne (« ce compte », « sa bio », « ses vidéos ») ; adresse à la 2e personne uniquement ce qui concerne l'utilisateur (ce qu'il peut reprendre, sa faille à exploiter). Ne cherche jamais à améliorer le concurrent LUI ; ton but est d'en tirer des enseignements pour l'utilisateur.`;

  // Sections qualitatives : coaching de MON compte vs décodage d'un concurrent.
  const consignesQualitatives = moi ? `
BIO : évalue la bio actuelle du profil. Est-elle claire, spécifique, révèle-t-elle vraiment ce que fait ce compte ? Si elle est générique ou vague, propose EXACTEMENT 2 alternatives courtes et percutantes, dans le même esprit mais plus révélatrices de la valeur du compte.

NICHE : identifie la niche/thématique dominante à partir des SUJETS RÉELS des vidéos EN PRIORITÉ, complétée par la bio. Sois précis et spécifique (ex. « storytelling historique, focus Afrique francophone », pas juste « histoire »). Dis si le positionnement est clair ou flou d'après ce que révèlent les sujets, avec 1 à 2 points ANCRÉS dans les vidéos observées. Si aucun sujet n'est fourni, rabats-toi sur la bio seule, et "disponible": false si même la bio ne tranche pas.

TOP & FLOP VIDÉOS : UNIQUEMENT si les sujets sont présents. La médiane des vues de ce compte est ${metriques ? metriques.medianeVues : 'inconnue'}.
   • TOP = uniquement les vidéos NETTEMENT AU-DESSUS de la médiane (de vraies percées). Maximum 3, ne complète JAMAIS avec des vidéos moyennes.
   • FLOP = les vidéos LES MOINS VUES fournies, nettement EN-DESSOUS de la médiane. Maximum 3.
   • Une vidéo proche de la médiane ne va NI dans le top NI dans le flop (liste vide autorisée).
   Pour chacune : résume le SUJET en quelques mots, donne les vues, explique en une phrase la raison. Le constat doit coller à la position réelle vs la médiane.

CONCEPTS RÉCURRENTS : 3 à 7 thèmes/angles qui reviennent dans les vidéos, formulés court comme des étiquettes. Sinon liste vide.

ÉVOLUTION / CHANGEMENT DE CAP : examine les DATES [mois/année] ET les SUJETS chronologiquement. Le créateur a-t-il CHANGÉ de type de contenu ?
   • Si OUI : "pivot": true. Situe la bascule (mois/année), résume AVANT et APRÈS, COMPARE les vues moyennes avant vs après, dis quelle période performait le mieux MÊME si c'est l'ancienne. Si l'ancienne marchait mieux, recommande de RÉUTILISER le mécanisme gagnant au service du nouvel objectif. Renseigne "formule_gagnante".
   • Si NON : "pivot": false, "constat" court sur la constance, autres champs vides.
   Ne prétends jamais un pivot inexistant.

LEVIERS PRIORITAIRES : exactement 3 actions concrètes pour TON compte, fondées sur ce que tu observes (profil, performances, et l'ÉVOLUTION si pivot). Cite une vidéo précise et ses vues quand c'est pertinent. Si un pivot a fait BAISSER la performance, un levier DOIT porter sur la réutilisation de la formule gagnante.

SANTÉ DU COMPTE : appréciation globale ("Excellente"|"Bonne"|"Fragile"|"Critique") fondée sur les signaux réellement disponibles, prudente si peu de données.` : `
SON POSITIONNEMENT (bio) : décris comment CE compte se présente dans sa bio, et ce qui est malin ou efficace dans son positionnement. Ne propose PAS de réécrire sa bio (ce n'est pas ton compte) : repère plutôt ce qu'elle révèle de sa stratégie.

SA NICHE : identifie sa niche / son angle dominant à partir des SUJETS RÉELS de ses vidéos EN PRIORITÉ, complété par la bio. Sois précis et spécifique. Dis si son positionnement est net ou flou, avec 1 à 2 points ANCRÉS dans ses vidéos.

SES CARTONS & SES RATÉS (top/flop) : UNIQUEMENT si les sujets sont présents. La médiane des vues de ce compte est ${metriques ? metriques.medianeVues : 'inconnue'}.
   • CARTONS (top) = uniquement ses vidéos NETTEMENT AU-DESSUS de la médiane (ses vraies percées, la recette à décoder). Maximum 3, jamais de remplissage.
   • RATÉS (flop) = ses vidéos LES MOINS VUES, nettement EN-DESSOUS de la médiane (ce que tu peux éviter). Maximum 3.
   • Une vidéo proche de la médiane ne va NI dans les cartons NI dans les ratés.
   Pour chacune : résume le SUJET en quelques mots, donne les vues, explique en une phrase POURQUOI ça a marché (ou raté) et ce que ça t'apprend. Le constat doit coller à la position réelle vs la médiane.

SES CONCEPTS RÉCURRENTS : 3 à 7 angles/formats qui reviennent chez lui, formulés court comme des étiquettes (sa mécanique répétée). Sinon liste vide.

SON ÉVOLUTION : examine ses DATES [mois/année] ET SUJETS chronologiquement. A-t-il CHANGÉ de cap ?
   • Si OUI : "pivot": true. Situe la bascule (mois/année), résume avant/après, COMPARE ses vues moyennes avant vs après, dis si son pari a payé (c'est une leçon pour toi).
   • Si NON : "pivot": false, "constat" court sur sa constance, autres champs vides.
   Ne prétends jamais un pivot inexistant.

CE QUE TU PEUX REPRENDRE ET ADAPTER (leviers) : exactement 3 actions concrètes, TRANSPOSABLES à TON propre compte, tirées de ce qui marche chez lui. Formule à la 2e personne (« reprends… », « adapte… »). Cite une de ses vidéos et ses vues quand c'est pertinent (ex. « sa vidéo sur X a fait Y vues : le ressort, c'est Z, applique-le à ta niche »). Reste concret et réaliste.

TA FAILLE À EXPLOITER : en 1 à 2 phrases, l'angle que CE concurrent néglige ou fait mal, et que TU peux occuper pour te différencier au lieu d'être une pâle copie. Fonde-toi sur ce que ses vidéos NE couvrent pas.

FAUT-IL VRAIMENT S'EN INSPIRER ? (verdict honnête, essentiel) : ce compte est-il un bon modèle, ou pas ? Sois lucide : un compte peut « exploser » pour de mauvaises raisons NON reproductibles (un seul coup viral isolé ; vues élevées mais engagement faible = audience peu investie ; format non transposable à une autre niche ; tactiques à ne pas copier comme le racolage ou le hors-sujet). Donne "modele" = "oui" (vraie recette à reprendre), "partiel" (du bon à prendre, avec réserves) ou "prudence" (peu ou pas un modèle), et un "constat" qui dit franchement ce qui est reproductible vs ce qui est un piège.

SANTÉ DU COMPTE : appréciation globale de CE compte ("Excellente"|"Bonne"|"Fragile"|"Critique") fondée sur les signaux réellement disponibles, prudente si peu de données.`;

  // Schéma JSON : le concurrent ajoute "faille_exploiter" et "verdict_inspiration",
  // et sa bio n'a pas de "suggestions" (on ne réécrit pas la bio d'autrui).
  const schemaJson = moi ? `{
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
  "evolution": { "pivot": <true/false>, "constat": "<1-2 phrases : la bascule et son effet, ou la constance>", "avant": "<contenu + perf avant, ou null>", "apres": "<contenu + perf après, ou null>", "formule_gagnante": "<la formule qui marche le mieux + comment la réutiliser, ou null>" },
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<1-2 phrases>" } ]
}` : `{
  "profil_trouve": <true si les données décrivent bien un profil existant, false sinon>,
  "compte_verifie": <true/false/null>,
  "engagement": { "score": <0-30 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, 3e personne sur ce compte>" },
  "portee": { "score": <0-30 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, ou explication si non disponible>" },
  "regularite": { "score": <0-20 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, ou explication si non disponible>" },
  "viralite": { "score": <0-20 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases, ou explication si non disponible>" },
  "sante_compte": "<Excellente|Bonne|Fragile|Critique>",
  "bio": { "actuelle": "<sa bio telle quelle, ou null>", "etat": "<claire|floue>", "critique": "<ce que révèle son positionnement, 1-2 phrases>" },
  "niche": { "disponible": <true/false>, "nom": "<...>", "etat": "<claire|floue>", "analyse": ["<point 1>", "<point 2 si pertinent>"] },
  "top_videos": [ { "sujet": "<résumé court>", "vues": <nombre>, "constat": "<1 phrase : pourquoi ça a marché + ce que ça t'apprend>" } ],
  "flop_videos": [ { "sujet": "<résumé court>", "vues": <nombre>, "constat": "<1 phrase>" } ],
  "concepts_recurrents": ["<concept 1>", "<concept 2>"],
  "evolution": { "pivot": <true/false>, "constat": "<1-2 phrases : sa bascule et son effet, ou sa constance>", "avant": "<contenu + perf avant, ou null>", "apres": "<contenu + perf après, ou null>", "formule_gagnante": "<sa formule qui marche le mieux, ou null>" },
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<action transposable à TON compte, 2e personne>" } ],
  "faille_exploiter": "<1-2 phrases : l'angle qu'il néglige et que tu peux occuper, ou null>",
  "verdict_inspiration": { "modele": "<oui|partiel|prudence>", "constat": "<ce qui est reproductible vs ce qui est un piège, 1-2 phrases>" }
}`;

  const prompt = `${roleIntro} Le nom exact des champs peut varier : identifie-les par leur sens (abonnés, abonnements, likes cumulés reçus sur toutes les vidéos, nombre de vidéos publiées, bio, statut vérifié).

PROFIL :
${JSON.stringify(donnees.profil || {}).slice(0, 4000)}
${blocVideos}
${blocSujets}

RÈGLE ABSOLUE D'HONNÊTETÉ : n'utilise QUE ce qui est réellement présent dans ces données (profil + éventuel bloc "DONNÉES PAR VIDÉO"). Si une donnée est absente, mets null / "disponible": false, n'invente jamais un chiffre.

ENGAGEMENT (sur 30) : si le "Taux d'engagement réel" est fourni ci-dessus, commente-le (interactions ÷ vues par vidéo : c'est la vraie mesure d'engagement). Un taux élevé = audience qui réagit fort. Sinon, à défaut, estime à partir des likes cumulés ÷ nombre de vidéos face aux abonnés, en précisant que c'est une estimation.
   BARÈME indicatif /30 : TRÈS FAIBLE (< 3%) → 0-8 · FAIBLE (3-7%) → 9-15 · CORRECT (7-15%) → 16-22 · FORT (> 15%) → 23-30.

PORTÉE (sur 30) : disponible UNIQUEMENT si le bloc "DONNÉES PAR VIDÉO" est présent. Base-toi sur le % vues/abonnés (portée) : un compte sain fait souvent 20% ou plus de son audience en vues moyennes ; en dessous de 10%, la portée est faible.
   BARÈME /30 (strict) : TRÈS FAIBLE (portée < 8% des abonnés) → 0-8 · FAIBLE (8-20%) → 9-15 · CORRECTE (20-50%) → 16-22 · FORTE (> 50%, ou vues qui dépassent l'audience) → 23-30.

RÉGULARITÉ (sur 20) : disponible UNIQUEMENT si la cadence est fournie. Base-toi sur les vidéos/semaine.
   BARÈME /20 (strict) : quasi inactif (< 0,5/sem) → 0-5 · irrégulier (0,5-2/sem) → 6-11 · régulier (2-5/sem) → 12-16 · très soutenu (> 5/sem) → 17-20.

VIRALITÉ (sur 20) : disponible UNIQUEMENT si le rapport pic/médiane est fourni. Un compte avec des pics nets a un rapport pic/médiane élevé et plusieurs vidéos au-dessus de 2× la médiane. Un rapport proche de 1 = contenu plat, sans percée.
   BARÈME /20 (strict) : aucun pic (rapport < 2 et 0% de pics) → 0-5 · faible (2-4×) → 6-11 · bon (4-10×) → 12-16 · fort potentiel viral (> 10×, plusieurs pics) → 17-20.

COHÉRENCE ABSOLUE (règle non négociable) : pour CHAQUE dimension, le score chiffré, le mot employé dans le constat, et la "sante_compte" globale doivent aller dans le MÊME sens. Il est INTERDIT d'écrire "très faible" avec 18/30, ou de dire "faible" partout et conclure "santé Bonne". Relis-toi : un lecteur ne doit jamais voir un chiffre qui contredit tes mots.
${consignesQualitatives}

RÈGLE DE FORMAT DES NOMBRES : dans tes phrases, écris les nombres normalement (ex: "12 400 abonnés"), jamais de séparateur anglo-saxon.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
${schemaJson}`;

  const raw = await callAI(MODEL_RAPIDE, 3000, prompt);
  const parsed = parseAIResponse(raw);

  // NOTES DÉTERMINISTES : on remplace les notes de l'IA (tirées au hasard dans
  // les fourchettes des barèmes, d'où des scores différents d'une analyse à
  // l'autre) par des notes calculées EN CODE à partir des chiffres réels. Même
  // compte + mêmes données ⇒ même score, toujours. On ne garde de l'IA que le
  // texte (constat). En mode « profil seul » (pas de vidéos), scores=null ⇒ on
  // laisse l'estimation d'engagement de l'IA (comportement dégradé inchangé).
  if (parsed) {
    const notes = scorerDimensionsSommaire(metriques);
    if (notes) {
      ['engagement', 'portee', 'regularite', 'viralite'].forEach(cle => {
        const codeDim = notes[cle];
        const constat = (parsed[cle] && parsed[cle].constat) || '';
        parsed[cle] = { score: codeDim.score, disponible: codeDim.disponible, constat };
      });
    }
  }
  return parsed;
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

  // Quota DÉDIÉ à l'analyse sommaire (compteur mensuel séparé de la création) :
  // non-abonné 1 (sur ses 5 gratuites), Creator 10/mois, Pro 30/mois.
  const droit = await droitAnalyseSommaire();
  if (!droit.ok) {
    if (droit.raison === 'expire') { gererAbonnementExpire(); return; }
    if (droit.raison === 'quota') {
      errorBox.textContent = 'Tu as atteint ta limite d\'analyses sommaires ce mois-ci (' + droit.limite + '). Elle se recharge le 1er du mois prochain.';
      errorBox.style.display = 'block';
      return;
    }
    // Non-abonné : analyse gratuite déjà utilisée (ou plus de générations
    // gratuites) → on propose l'abonnement.
    openPlans('nouveau');
    return;
  }

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
    // Timeout client : si le scan traîne (compte volumineux, service lent), on
    // échoue proprement avec un message clair plutôt qu'une erreur cryptique.
    const ctrlScan = new AbortController();
    const minuteurScan = setTimeout(() => ctrlScan.abort(), 50000);
    let rep;
    try {
      rep = await fetch('/api/username-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
        signal: ctrlScan.signal
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error("L'analyse a mis trop de temps. Réessaie dans un instant.");
      throw new Error("Connexion interrompue. Vérifie ta connexion et réessaie.");
    } finally {
      clearTimeout(minuteurScan);
    }
    let donnees;
    try { donnees = await rep.json(); }
    catch (e) { throw new Error("Réponse illisible du serveur. Réessaie dans un instant."); }
    if (!rep.ok) {
      throw new Error(donnees?.error?.message || "Profil introuvable. Vérifie l'orthographe, ou envoie tes captures pour l'analyse complète.");
    }

    // Analyse de contenu (dimensions + niche + top/flop + concepts + pivot) :
    // pipeline partagé avec l'analyse détaillée (voir _diagnostiquerContenu).
    const parsed = await _diagnostiquerContenu(donnees, username, _sommaireEstMonCompte);
    if (!parsed || parsed.profil_trouve === false) {
      throw new Error("Profil introuvable ou privé. Vérifie l'orthographe du nom d'utilisateur.");
    }

    // Décompte : le non-abonné consomme 1 génération gratuite ET son unique
    // analyse sommaire. L'abonné, lui, est compté via son quota mensuel dédié
    // (countMonthGenerations('diagnosticSommaire') sur l'enregistrement ci-dessous).
    if (!unlocked) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      const sf = parseInt(localStorage.getItem('scriptura_sommaire_used') || '0', 10) + 1;
      localStorage.setItem('scriptura_sommaire_used', String(sf));
      renderGenCounter();
      checkRappelAbonnement();
    }

    const titre = 'Diagnostic sommaire · @' + username;
    saveGeneration('diagnosticSommaire', titre, {
      username: username, diagnostic: parsed, estMonCompte: _sommaireEstMonCompte
    });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    afficherDiagnosticSommaireResultat(parsed, username, _sommaireEstMonCompte);

  } catch (e) {
    errorBox.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    errorBox.style.display = 'block';
    // Ré-affiche le champ de saisie uniquement en cas d'échec, pour permettre
    // de réessayer, en cas de succès, il reste masqué : le résultat prend
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

// Anime l'anneau de score + le chiffre qui monte, même mécanique que
// js/audit.js (animerScoreAudit), sur des identifiants distincts (dsRingFill
// / dsScoreNum) puisque les deux écrans ont chacun leur propre anneau.
function animerScoreDiagSommaire(valeur, circonference) {
  const numEl = document.getElementById('dsScoreNum');
  const ringEl = document.getElementById('dsRingFill');
  if (valeur == null || Number.isNaN(valeur)) {
    if (numEl) numEl.textContent = '·';
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
// (dates, vues individuelles) qu'aucun profil public LamaTok n'expose,
// toujours non disponibles ici, jamais une estimation inventée.
const DS_TOUJOURS_INDISPONIBLE = {
  portee: "Non calculable avec un simple profil public : TikTok n'expose pas le nombre de vues par vidéo à cette échelle. Le diagnostic complet (captures) le permet.",
  regularite: "Non calculable sans la date de chaque vidéo, une donnée absente d'un profil public. Le diagnostic complet (captures) le permet.",
  viralite: "Non calculable sans pouvoir comparer tes vidéos entre elles individuellement, donnée indisponible via un simple profil public."
};

// Affiche le résultat (nouvelle génération OU réouverture depuis l'historique).
// estMonCompte : true = mon compte (posture coach), false = un concurrent
// (posture décodage). Le moteur/score est identique ; seule l'écriture change.
function afficherDiagnosticSommaireResultat(d, username, estMonCompte = true) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !d) return;
  const moi = estMonCompte !== false;

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
  // 50 et 70, émeraude à partir de 70, même palette que js/audit.js
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
    // Badge coloré selon le niveau (rouge/orange/émeraude), voir
    // niveauScoreSur() dans js/audit.js, seuils partagés avec le score global.
    const disponible = dimEstMesurable(dim);
    const niveau = disponible ? niveauScoreSur(dim.score, meta.max) : 'niveau-neutre';
    // Constat : celui de l'IA si présent, sinon le texte "non disponible".
    const constat = dim.constat || DS_TOUJOURS_INDISPONIBLE[cle] || '';
    return `<div class="ds-dim-card">
      <div class="ds-dim-head">
        <span class="ds-dim-icon">${meta.icone}</span>
        <span class="ds-dim-name">${meta.label}</span>
        <span class="score-badge ${niveau}">${disponible ? (dim.score + '/' + meta.max) : '·'}</span>
      </div>
      <p class="ds-dim-text">${diagSommaireEsc(constat)}</p>
    </div>`;
  }).join('');

  const bio = d.bio || {};
  const bioOk = bio.etat === 'claire';
  const bioHtml = bio.actuelle ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">${moi ? 'Ton profil' : 'Son positionnement'}</div>
        <span class="ds-tag${bioOk ? ' ds-tag-ok' : ''}">${bioOk ? 'Bio claire' : (moi ? 'Bio à retravailler' : 'Bio floue')}</span>
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
        <div class="audit-section-label" style="margin-bottom:0">${moi ? 'Ta niche' : 'Sa niche'}</div>
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
  const topHtml = carteVideos(moi ? 'Tes vidéos qui cartonnent' : 'Ses cartons : la recette à décoder', '🔥 Top', true, d.top_videos);
  const flopHtml = carteVideos(moi ? 'Tes vidéos en retrait' : 'Ses ratés : ce que tu peux éviter', 'À revoir', false, d.flop_videos);

  const concepts = Array.isArray(d.concepts_recurrents) ? d.concepts_recurrents.filter(Boolean) : [];
  const conceptsHtml = concepts.length ? `
    <div class="score-card">
      <div class="audit-section-label">${moi ? 'Concepts récurrents' : 'Ses concepts récurrents'}</div>
      <div class="ds-concepts">${concepts.map(c => `<span class="ds-concept-chip">${diagSommaireEsc(c)}</span>`).join('')}</div>
    </div>` : '';

  const leviers = Array.isArray(d.leviers_prioritaires) ? d.leviers_prioritaires : [];
  const leviersHtml = leviers.length ? `
    <div class="score-card">
      <div class="audit-section-label">${moi ? 'Tes leviers prioritaires' : 'Ce que tu peux reprendre et adapter'}</div>
      <ol class="ds-leviers-list">
        ${leviers.map(l => `<li><b>${diagSommaireEsc(l.titre)}</b><p>${diagSommaireEsc(l.detail)}</p></li>`).join('')}
      </ol>
    </div>` : '';

  // ── Blocs SPÉCIFIQUES au mode concurrent ──
  // Faille à exploiter : l'angle qu'il néglige, pour se différencier au lieu de
  // copier. Verdict d'inspiration : est-ce vraiment un modèle à suivre (honnêteté).
  const faille = (!moi && d.faille_exploiter) ? `
    <div class="score-card">
      <div class="audit-section-label">🎯 Ta faille à exploiter</div>
      <p class="audit-diag-constat" style="margin-top:8px">${diagSommaireEsc(d.faille_exploiter)}</p>
    </div>` : '';

  const verdict = d.verdict_inspiration || {};
  const VERDICT_META = {
    oui:      { tag: '✓ Vrai modèle',        cls: 'ds-tag-ok' },
    partiel:  { tag: '~ À prendre avec pincettes', cls: '' },
    prudence: { tag: '⚠ Pas un modèle',      cls: 'ds-tag-alert' }
  };
  const vMeta = VERDICT_META[verdict.modele] || VERDICT_META.partiel;
  const verdictHtml = (!moi && verdict.constat) ? `
    <div class="score-card ds-evolution${verdict.modele === 'prudence' ? ' pivot' : ''}">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Faut-il vraiment s'en inspirer ?</div>
        <span class="ds-tag ${vMeta.cls}">${vMeta.tag}</span>
      </div>
      <p class="audit-diag-constat" style="margin-top:10px">${diagSommaireEsc(verdict.constat)}</p>
    </div>` : '';

  // Invitation vers l'analyse détaillée (captures), copie différente selon
  // que l'utilisateur y a déjà accès (Pro/admin) ou doit encore la débloquer
  // (Creator, non-abonné), mais les DEUX versions mentionnent le jeton.
  // Bouton : celui qui a déjà accès part directement sur l'assistant de
  // captures (ouvrirCapturesDepuisChoix, qui vérifie l'accès et route au
  // besoin) ; celui qui n'a pas encore accès ouvre TOUJOURS le pop-up
  // d'abonnement (avec les jetons visibles), sans passer par cette même
  // fonction qui pourrait filer droit à l'assistant s'il a déjà des jetons,
  // on veut qu'il voie ses options avant de consommer quoi que ce soit.
  const dejaAcces = (typeof aAccesMode === 'function' && aAccesMode('audit'));
  // "Ton plan Pro" uniquement pour un vrai abonné Pro payant, un compte
  // admin/illimité a aussi accès, mais n'est pas au plan Pro à proprement
  // parler, donc lui dire "ton plan Pro" serait faux.
  const estProPayant = dejaAcces && unlocked && (typeof monPalier === 'function') && monPalier() === 'pro';
  // Sur un CONCURRENT, l'analyse détaillée (captures de stats privées) est
  // impossible, on ne peut pas capturer les stats de quelqu'un d'autre. On
  // invite plutôt à analyser SON propre compte pour se comparer.
  const ctaConcurrentHtml = `
    <div class="ds-alt">
      <p style="margin:0 0 14px">Tu viens de décoder <strong>@${diagSommaireEsc(username)}</strong>. Pour voir où <strong>tu</strong> te situes face à lui, analyse ton propre compte, tu pourras comparer vos forces et repérer précisément ton retard ou ton avance.</p>
      <button class="btn-generate" onclick="analyserMonCompteDepuisConcurrent()">Analyser mon compte →</button>
    </div>`;
  const ctaDetailleHtml = dejaAcces ? `
    <div class="ds-alt">
      <p style="margin:0 0 14px">Ici, on a décodé ton <strong>contenu</strong> : ce qui marche, et quoi créer. Pour savoir <strong>comment l'algo te pousse (ou pas)</strong>, l'<strong>analyse détaillée</strong> lit tes statistiques privées, invisibles ici : rétention (où l'attention décroche), sources de trafic (Pour toi, abonnés, recherche), démographie de ton audience. ${estProPayant ? 'Incluse dans ton plan Pro.' : 'Tu y as déjà accès.'} (Sans abonnement, aussi disponible à l'unité avec un jeton.)</p>
      <button class="btn-generate" onclick="ouvrirCapturesDepuisChoix()">Lancer l'analyse détaillée →</button>
    </div>` : `
    <div class="ds-alt">
      <p style="margin:0 0 14px">Ici, on a décodé ton <strong>contenu</strong> : ce qui marche, et quoi créer. L'<strong>analyse détaillée</strong> répond à une autre question, <strong>comment l'algo te pousse (ou pas)</strong> : elle lit tes statistiques privées, invisibles ici (rétention, sources de trafic, démographie de ton audience). Disponible avec le plan Pro, ou <strong>à l'unité avec un jeton, sans abonnement</strong>.</p>
      <button class="btn-generate" onclick="openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne')">Débloquer l'analyse détaillée →</button>
    </div>`;

  // Santé DÉRIVÉE du score global (même barème que l'anneau) : garantit la
  // cohérence score ↔ santé ↔ couleur, jamais "53/100" affiché "Fragile".
  // Affichée à DEUX endroits : juste sous le score, et sous les dimensions.
  const sante = (typeof santeCompteDepuisScore === 'function') ? santeCompteDepuisScore(score) : null;
  const santeRowHtml = sante
    ? `<div class="ds-sante-row"><span class="ds-tag ${sante.niveau}">Santé du compte : ${sante.label}</span></div>`
    : '';

  // Évolution du compte : détection d'un changement de cap (pivot) sur ~6 mois,
  // avec comparaison avant/après et formule gagnante. N'apparaît que si l'IA a
  // renvoyé un constat (donc uniquement quand l'historique a été analysé).
  const evo = d.evolution || {};
  const evolutionHtml = evo.constat ? `
    <div class="score-card ds-evolution${evo.pivot ? ' pivot' : ''}">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Évolution du compte</div>
        <span class="ds-tag ${evo.pivot ? 'ds-tag-alert' : 'ds-tag-ok'}">${evo.pivot ? '↪ Changement de cap' : 'Contenu stable'}</span>
      </div>
      <p class="audit-diag-constat" style="margin-top:10px">${diagSommaireEsc(evo.constat)}</p>
      ${(evo.avant || evo.apres) ? `<div class="ds-evo-grid">
        ${evo.avant ? `<div class="ds-evo-col"><div class="ds-evo-h">Avant</div><p>${diagSommaireEsc(evo.avant)}</p></div>` : ''}
        ${evo.apres ? `<div class="ds-evo-col"><div class="ds-evo-h">Depuis</div><p>${diagSommaireEsc(evo.apres)}</p></div>` : ''}
      </div>` : ''}
      ${evo.formule_gagnante ? `<div class="ds-evo-formule"><div class="ds-evo-h">🏆 ${moi ? 'Ta' : 'Sa'} formule gagnante</div><p>${diagSommaireEsc(evo.formule_gagnante)}</p></div>` : ''}
    </div>` : '';

  // Placeholder pour la recommandation sommaire (non-abonnés avec assez de
  // mémoire locale, voir afficherOpportuniteDiagSommaire dans recommandations.js).
  const opportuniteHtml = (!unlocked) ? `<div id="diagSommaireOpportunites"></div>` : '';

  results.innerHTML = `
    <div class="score-card audit-score-card ds-score-card">
      <div class="audit-score-label">${moi ? 'DIAGNOSTIC SOMMAIRE' : 'ANALYSE CONCURRENT'} · @${diagSommaireEsc(username)}</div>
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
      ${santeRowHtml}
    </div>

    <div class="ds-dims-grid">${dimsHtml}</div>

    ${santeRowHtml}

    ${evolutionHtml}
    ${verdictHtml}
    ${bioHtml}
    ${nicheHtml}
    ${topHtml}
    ${flopHtml}
    ${conceptsHtml}
    ${leviersHtml}
    ${faille}
    ${opportuniteHtml}

    ${moi ? ctaDetailleHtml : ctaConcurrentHtml}
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="analyserAutreCompteDiagSommaire()">Analyser un autre compte</button>`;

  results.style.display = 'block';
  setTimeout(() => animerScoreDiagSommaire(score, RING_C), 50);

  // Recommandation sommaire pour les non-abonnés qui ont déjà assez de
  // mémoire locale (script, récit, autre diagnostic déjà fait sur ce
  // navigateur), en tâche de fond, ne retarde jamais l'affichage du
  // diagnostic lui-même. Voir js/recommandations.js.
  if (!unlocked && typeof afficherOpportuniteDiagSommaire === 'function') {
    afficherOpportuniteDiagSommaire();
  }
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

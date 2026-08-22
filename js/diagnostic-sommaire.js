// ═══════════════════════════════════════════════════════════
//  MODULE DIAGNOSTIC SOMMAIRE, analyse via @nom d'utilisateur TikTok
//  Alternative légère au diagnostic complet par captures (js/audit.js) :
//  aucune capture à envoyer. api/username-scan.js lit le PROFIL et la LISTE
//  DES VIDÉOS (vues, dates, ET sujets/légendes) via TikHub, seule source.
//
//  Les 4 dimensions inspirées de Vervox (Engagement, Portée, Régularité,
//  Viralité) sont calculables quand les vidéos sont récupérées : Engagement
//  à partir des totaux du profil ; Portée, Régularité et Viralité à partir
//  des vues/dates par vidéo (voir calculerMetriquesVideos). En plus, les
//  SUJETS des vidéos (légendes) alimentent une analyse de CONTENU comme
//  Vervox : niche réelle, Top/Flop vidéos, concepts récurrents, leviers qui
//  citent des vidéos précises. Si les vidéos ne sont pas récupérées (clé
//  TikHub absente, compte privé, quota), on retombe proprement sur
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

// Dernier résultat affiché ({ username, diagnostic, estMonCompte }), pour
// pouvoir enchaîner un FACE-À-FACE : après avoir décodé un concurrent, le
// bouton « Analyser mon compte » mémorise ce concurrent ici, et l'analyse de
// MON compte affiche ensuite « Toi face à @concurrent ».
let _dernierSommaireAffiche = null;
// Concurrent EN ATTENTE de comparaison (posé par « Analyser mon compte » depuis
// un résultat concurrent, consommé par la prochaine analyse de mon compte).
let _comparerAuConcurrent = null;

// Bascule le sélecteur Mon compte / Compte concurrent, ET adapte tout l'écran
// de saisie au contexte (titre, sous-titre, note, placeholder, et masquage de
// l'invitation « analyse détaillée » qui n'a de sens que pour MON compte).
function choisirScopeSommaire(estMoi) {
  _sommaireEstMonCompte = !!estMoi;
  const bMoi = document.getElementById('dsScopeMoi');
  const bConc = document.getElementById('dsScopeConcurrent');
  if (bMoi) bMoi.classList.toggle('actif', _sommaireEstMonCompte);
  if (bConc) bConc.classList.toggle('actif', !_sommaireEstMonCompte);
  _appliquerTextesScopeEntree();
}

// Réécrit les textes de l'écran de saisie selon le scope : 2e personne pour MON
// compte (« ton diagnostic », « ta niche »), tournure concurrent sinon (« décode
// un concurrent », « sa niche »). L'analyse détaillée (captures de MES stats
// privées) ne se propose qu'en mode « mon compte ».
function _appliquerTextesScopeEntree() {
  const moi = _sommaireEstMonCompte;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const notePublic = 'Aucune connexion, aucun mot de passe. On lit uniquement ce qui est <strong style="color:rgba(255,255,255,0.7)">public</strong> sur ';
  if (moi) {
    set('dsEntreeTitre', 'Ton diagnostic,<br><strong>sans captures.</strong>');
    set('dsEntreeSub', "Entre ton @nom d'utilisateur : Scriptura lit tes vidéos publiques des 2 derniers mois et décode ta niche, tes formats qui percent, et ce qui plombe ta croissance.");
    set('dsEntreeNote', notePublic + 'ton profil.');
  } else {
    set('dsEntreeTitre', 'Décode un concurrent,<br><strong>sans captures.</strong>');
    set('dsEntreeSub', 'Entre le @nom du concurrent : Scriptura lit ses vidéos publiques des 2 derniers mois et décode sa niche, ses formats qui percent, et sa recette pour percer.');
    set('dsEntreeNote', notePublic + 'son profil.');
  }
  const inp = document.getElementById('diagSommaireInput');
  if (inp) inp.placeholder = moi ? 'nom.utilisateur' : 'nom.du.concurrent';
  const det = document.getElementById('dsEntreeDetaillee');
  if (det) det.style.display = moi ? '' : 'none';
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
  // On MASQUE le résultat précédent sans effacer son contenu : ainsi « Retour »
  // peut le restaurer tel quel (le résultat est un sous-écran de navigation,
  // voir currentScreen/showScreen dans navigation.js). Il sera de toute façon
  // remplacé au prochain affichage (afficherDiagnosticSommaireResultat).
  if (results) results.style.display = 'none';
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

// Depuis un résultat affiché, ramène à l'écran de saisie pour une NOUVELLE
// analyse, en pré-réglant le sélecteur Mon compte / Concurrent selon le bouton :
//   • « Analyser mon compte » (résultat concurrent) → estMonCompte = true
//   • « Analyser un autre compte » → même scope que le résultat courant
//     (concurrent → un autre concurrent ; mon compte → mon compte)
// Empile d'abord le RÉSULTAT courant (sous-écran reconnu, voir navigation.js)
// pour que « Retour » y revienne au lieu de sauter à l'accueil/génération.
function analyserAutreCompteDiagSommaire(estMonCompte = true) {
  if (typeof pushNav === 'function') pushNav(); // le résultat courant entre dans l'historique
  resetDiagnosticSommaireForm();
  choisirScopeSommaire(estMonCompte !== false); // pré-règle le scope voulu
  const input = document.getElementById('diagSommaireInput');
  if (input) input.focus();
}

// « Analyser mon compte » depuis un résultat CONCURRENT : mémorise ce concurrent
// pour le face-à-face, puis ouvre la saisie pré-réglée sur Mon compte. La
// comparaison « Toi face à @concurrent » s'affichera après l'analyse de mon compte.
function analyserMonCompteVsConcurrent() {
  if (_dernierSommaireAffiche && _dernierSommaireAffiche.estMonCompte === false) {
    _comparerAuConcurrent = _dernierSommaireAffiche;
  }
  analyserAutreCompteDiagSommaire(true);
}

function diagSommaireEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

// Extrait le nombre d'abonnés du profil brut. TikHub range le compte à une
// profondeur variable (top-level stats, mais aussi users["<pseudo>"].stats
// selon les comptes), ce qui faisait échouer une lecture à chemin fixe et
// marquait la Portée « non calculable » à tort. On cherche donc RÉCURSIVEMENT
// la 1re valeur numérique > 0 sous une clé d'abonnés, quelle que soit la
// structure. Le motif est ancré : jamais confondu avec "followingCount".
function dsAbonnes(profil) {
  const CLES = /^(followercount|follower_count|followers|fans|fanscount|fans_count)$/i;
  let trouve = null;
  const vus = new Set();
  (function scan(o, prof) {
    if (trouve != null || !o || typeof o !== 'object' || prof > 6 || vus.has(o)) return;
    vus.add(o);
    for (const k of Object.keys(o)) {
      if (CLES.test(k)) {
        const n = Number(o[k]);
        if (Number.isFinite(n) && n > 0) { trouve = n; return; }
      }
      const val = o[k];
      if (val && typeof val === 'object') scan(val, prof + 1);
    }
  })(profil || {}, 0);
  return trouve;
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

// Mot de niveau d'une dimension À PARTIR DU SCORE CALCULÉ PAR LE CODE, avec les
// mêmes bornes que les barèmes. Sert à IMPOSER le qualificatif à l'IA (constats)
// pour qu'elle ne dise jamais « fort » sur un score faible, ni l'inverse.
function _dsNiveauMot(cle, score) {
  if (score == null) return null;
  if (cle === 'engagement' || cle === 'portee') { // /30
    return score <= 8 ? 'très faible' : score <= 15 ? 'faible' : score <= 22 ? 'correct' : 'fort';
  }
  return score <= 5 ? 'très faible' : score <= 11 ? 'faible' : score <= 16 ? 'correct' : 'fort'; // /20
}

// Bascule entre l'écran de saisie (@nom d'utilisateur) et l'écran "analyse
// en cours", jamais les deux affichés en même temps.
function toggleDiagSommaireEntree(visible) {
  document.querySelectorAll('#diagSommaireFlow .ds-scope, #diagSommaireFlow .ds-field, #diagSommaireFlow .ds-note, #diagSommaireFlow .ds-sep, #diagSommaireFlow .ds-alt').forEach(el => {
    el.style.display = visible ? '' : 'none';
  });
  // À la réapparition de l'écran de saisie, réappliquer la règle de scope :
  // l'invitation « analyse détaillée » (.ds-alt) reste masquée en mode concurrent.
  if (visible) _appliquerTextesScopeEntree();
}

// Messages qui défilent sous le pourcentage pendant l'analyse, ce
// diagnostic est rapide (un seul profil public à lire), contrairement au
// diagnostic complet par captures qui peut prendre plusieurs minutes.
// Deux jeux selon le contexte : MON compte (2e personne) vs un CONCURRENT
// (3e personne pour le décrire, 2e personne pour ce que j'en tire).
const DS_LOADING = {
  moi: {
    titre: 'Analyse de ton compte<br/>en cours',
    sous: 'On analyse ton profil public pour identifier tes forces et ce qui freine ta croissance.',
    note: "Plus tu as de contenus, plus l'analyse est fouillée : on lit tes vidéos des 2 derniers mois, une à une. Quelques secondes de plus ☕, on s'occupe du reste.",
    messages: [
      'On récupère ton profil…',
      'On calcule ton engagement…',
      'On analyse ta bio et ta niche…',
      'On identifie tes leviers prioritaires…'
    ]
  },
  concurrent: {
    titre: 'Analyse du concurrent<br/>en cours',
    sous: 'On décode ce profil public pour repérer ce qui le fait marcher, et ce que tu peux en reprendre.',
    note: "Plus il a de contenus, plus l'analyse est fouillée : on lit ses vidéos des 2 derniers mois, une à une. Quelques secondes de plus ☕, on s'occupe du reste.",
    messages: [
      'On récupère son profil…',
      'On calcule son engagement…',
      'On analyse sa bio et sa niche…',
      'On repère ce que tu peux lui reprendre…'
    ]
  }
};
let _dsLoadingTimer = null;

function demarrerAnimationChargementDs(estMonCompte = true) {
  const T = (estMonCompte !== false) ? DS_LOADING.moi : DS_LOADING.concurrent;
  // Adapte les textes fixes de l'écran de chargement au contexte.
  const titreEl = document.getElementById('dsLoadingTitle');
  const sousEl = document.getElementById('dsLoadingSub');
  const noteEl = document.getElementById('dsLoadingNote');
  if (titreEl) titreEl.innerHTML = T.titre;
  if (sousEl) sousEl.textContent = T.sous;
  if (noteEl) noteEl.textContent = T.note;

  const pctEl = document.getElementById('dsLoadingPct');
  const statusEl = document.getElementById('dsLoadingStatus');
  if (statusEl) statusEl.textContent = T.messages[0];
  let i = 0;
  if (_dsLoadingTimer) clearInterval(_dsLoadingTimer);
  _dsLoadingTimer = setInterval(() => {
    i = (i + 1) % T.messages.length;
    if (statusEl) statusEl.textContent = T.messages[i];
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
// récupérées (profil + vidéos TikHub) et du @username, calcule les
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

  // NIVEAUX déjà tranchés par le code (mêmes bornes que le barème). On les
  // impose à l'IA pour que ses CONSTATS n'emploient jamais un qualificatif qui
  // contredit le score affiché (le score, lui, est recalculé plus bas).
  const _notesPre = scorerDimensionsSommaire(metriques);
  const niveauxTexte = _notesPre ? ['engagement', 'portee', 'regularite', 'viralite'].map(cle => {
    const d = _notesPre[cle], meta = DS_DIM_META[cle];
    if (!d || d.disponible === false || d.score == null) return `- ${meta.label} : non mesurée (n'en parle pas comme forte ou faible)`;
    return `- ${meta.label} : ${_dsNiveauMot(cle, d.score)} (${d.score}/${meta.max})`;
  }).join('\n') : '';

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
  const ligneVideo = v => `- [${fmtMois(v.date)}] ${v.vues} vues${v.commentaires != null ? `, ${v.commentaires} comm.` : ''} : « ${tronquerSansCouperEmoji(v.desc.replace(/\s+/g, ' '), 120)} »`;
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

FAUT-IL VRAIMENT S'EN INSPIRER ? (verdict honnête, essentiel, OBLIGATOIRE) : ce compte est-il un bon modèle, ou pas ? Sois lucide : un compte peut « exploser » pour de mauvaises raisons NON reproductibles (un seul coup viral isolé ; vues élevées mais engagement faible = audience peu investie ; format non transposable à une autre niche ; tactiques à ne pas copier comme le racolage ou le hors-sujet). Donne "modele" = "oui" (vraie recette à reprendre), "partiel" (du bon à prendre, avec réserves) ou "prudence" (peu ou pas un modèle), et un "constat" qui dit franchement ce qui est reproductible vs ce qui est un piège. Ne l'omets JAMAIS.

Les champs "verdict_inspiration" et "faille_exploiter" sont OBLIGATOIRES : remplis-les toujours, ne les laisse jamais vides.

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
  "verdict_inspiration": { "modele": "<oui|partiel|prudence>", "constat": "<ce qui est reproductible vs ce qui est un piège, 1-2 phrases>" },
  "faille_exploiter": "<1-2 phrases : l'angle qu'il néglige et que tu peux occuper, ou null>",
  "bio": { "actuelle": "<sa bio telle quelle, ou null>", "etat": "<claire|floue>", "critique": "<ce que révèle son positionnement, 1-2 phrases>" },
  "niche": { "disponible": <true/false>, "nom": "<...>", "etat": "<claire|floue>", "analyse": ["<point 1>", "<point 2 si pertinent>"] },
  "top_videos": [ { "sujet": "<résumé court>", "vues": <nombre>, "constat": "<1 phrase : pourquoi ça a marché + ce que ça t'apprend>" } ],
  "flop_videos": [ { "sujet": "<résumé court>", "vues": <nombre>, "constat": "<1 phrase>" } ],
  "concepts_recurrents": ["<concept 1>", "<concept 2>"],
  "evolution": { "pivot": <true/false>, "constat": "<1-2 phrases : sa bascule et son effet, ou sa constance>", "avant": "<contenu + perf avant, ou null>", "apres": "<contenu + perf après, ou null>", "formule_gagnante": "<sa formule qui marche le mieux, ou null>" },
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<action transposable à TON compte, 2e personne>" } ]
}`;

  const prompt = `${roleIntro} Le nom exact des champs peut varier : identifie-les par leur sens (abonnés, abonnements, likes cumulés reçus sur toutes les vidéos, nombre de vidéos publiées, bio, statut vérifié).

PROFIL :
${tronquerSansCouperEmoji(JSON.stringify(donnees.profil || {}), 4000)}
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

${niveauxTexte ? `NIVEAUX DÉJÀ TRANCHÉS PAR LE CODE (le score AFFICHÉ vient du code, pas de toi). Dans tes constats et dans "sante_compte", emploie EXACTEMENT ces qualificatifs, ne les recalcule pas, ne les contredis jamais (n'écris jamais « fort » sur une dimension marquée « faible ») :
${niveauxTexte}

` : ''}COHÉRENCE ABSOLUE (règle non négociable) : pour CHAQUE dimension, le score chiffré, le mot employé dans le constat, et la "sante_compte" globale doivent aller dans le MÊME sens. Il est INTERDIT d'écrire "très faible" avec 18/30, ou de dire "faible" partout et conclure "santé Bonne". Relis-toi : un lecteur ne doit jamais voir un chiffre qui contredit tes mots.
${consignesQualitatives}

RÈGLE DE FORMAT DES NOMBRES : dans tes phrases, écris les nombres normalement (ex: "12 400 abonnés"), jamais de séparateur anglo-saxon.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
${schemaJson}`;

  // Plafond de tokens large : la réponse (surtout en mode concurrent, avec le
  // verdict et la faille en plus) est longue ; un plafond trop bas coupait les
  // derniers champs. Ce plafond n'est pas facturé s'il n'est pas atteint.
  const raw = await callAI(MODEL_RAPIDE, 4500, prompt, undefined, false, undefined, 'diagnosticSommaire');
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
    // Abonnés bruts au moment de CE diagnostic, sauvegardés avec lui (voir
    // saveGeneration) pour permettre de calculer une évolution d'un diagnostic
    // à l'autre du même compte (voir evolutionAbonnesDiagSommaire), sans appel
    // API supplémentaire : juste une lecture de l'historique déjà là.
    parsed.abonnes = abonnes;
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
  // non-abonné 1 (sur ses 5 gratuites), Creator 10/mois, Pro 25/mois. Au-delà,
  // un jeton en débloque une de plus (droit.viaJeton, décompté après succès).
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
  const dsProg = demarrerAnimationChargementDs(_sommaireEstMonCompte);

  try {
    // Récupère le profil public via notre fonction serveur (clé TikHub
    // jamais exposée au navigateur).
    // Timeout client : si le scan traîne (compte volumineux, service lent), on
    // échoue proprement avec un message clair plutôt qu'une erreur cryptique.
    const ctrlScan = new AbortController();
    const minuteurScan = setTimeout(() => ctrlScan.abort(), 50000);
    let rep;
    try {
      rep = await fetch('/api/username-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code_acces: localStorage.getItem('scriptura_code') || null }),
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
    // Le jeton (si utilisé pour débloquer cette analyse) est désormais
    // décompté côté SERVEUR par /api/username-scan lui-même (voir
    // api/_lib/acces.js verifierQuota, mode 'diagnosticSommaire'), plus
    // besoin de le refaire ici : ce serait un double décompte.

    const titre = 'Diagnostic sommaire · @' + username;
    saveGeneration('diagnosticSommaire', titre, {
      username: username, diagnostic: parsed, estMonCompte: _sommaireEstMonCompte
    });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    afficherDiagnosticSommaireResultat(parsed, username, _sommaireEstMonCompte);

    // FACE-À-FACE : si on vient de « Analyser mon compte » à la suite d'un
    // concurrent décodé, on ajoute en haut de mon résultat le duel « Toi face à
    // @concurrent » (best-effort, en tâche de fond, ne bloque pas l'affichage).
    if (_sommaireEstMonCompte && _comparerAuConcurrent) {
      const concurrent = _comparerAuConcurrent;
      _comparerAuConcurrent = null;
      afficherComparaisonConcurrent(parsed, username, concurrent);
    } else if (!_sommaireEstMonCompte) {
      _comparerAuConcurrent = null; // analyse d'un concurrent : on abandonne la comparaison en attente
    }

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
  engagement: { icone: ICO('trend'), label: 'Engagement', max: 30 },
  portee:     { icone: ICO('eye'), label: 'Portée', max: 30 },
  regularite: { icone: ICO('calendar'), label: 'Régularité', max: 20 },
  viralite:   { icone: ICO('bolt'), label: 'Viralité', max: 20 }
};

// Ces 3 dimensions ont structurellement besoin de données par vidéo
// (dates, vues individuelles) qu'aucun profil public n'expose,
// toujours non disponibles ici, jamais une estimation inventée.
const DS_TOUJOURS_INDISPONIBLE = {
  portee: "Non calculable avec un simple profil public : TikTok n'expose pas le nombre de vues par vidéo à cette échelle. Le diagnostic complet (captures) le permet.",
  regularite: "Non calculable sans la date de chaque vidéo, une donnée absente d'un profil public. Le diagnostic complet (captures) le permet.",
  viralite: "Non calculable sans pouvoir comparer tes vidéos entre elles individuellement, donnée indisponible via un simple profil public."
};

// ── Évolution des abonnés (7 / 30 / 90 jours), inspiré de Vervox ──
// 100% déterministe et sans appel API supplémentaire : compare le nombre
// d'abonnés de CE diagnostic aux diagnostics PRÉCÉDENTS du MÊME compte déjà
// sauvegardés dans l'historique (voir _diagnostiquerContenu, qui attache
// désormais `abonnes` à chaque diagnostic sauvegardé). Les analyses sommaires
// étant limitées mensuellement, l'historique reste souvent clairsemé : pour
// chaque fenêtre on prend le point le plus proche (tolérance ±50% de la
// fenêtre) plutôt que d'exiger une correspondance exacte au jour près.
async function evolutionAbonnesDiagSommaire(username, abonnesActuels, estMonCompte) {
  if (abonnesActuels == null || typeof _recentesGenerationsDe !== 'function') return null;
  const historique = await _recentesGenerationsDe('diagnosticSommaire', 40);
  const memeCompte = (historique || []).filter(g =>
    g && g.contenu && g.contenu.username === username &&
    (g.contenu.estMonCompte !== false) === (estMonCompte !== false) &&
    g.contenu.diagnostic && typeof g.contenu.diagnostic.abonnes === 'number'
  );
  if (!memeCompte.length) return null;

  const maintenant = Date.now();
  const FENETRES = [{ jours: 7, label: '7 jours' }, { jours: 30, label: '30 jours' }, { jours: 90, label: '90 jours' }];
  const points = FENETRES.map(f => {
    let meilleur = null, meilleurEcart = Infinity;
    memeCompte.forEach(g => {
      const t = Date.parse(g.cree_le || g.created_at || '');
      if (!Number.isFinite(t)) return;
      const ageJours = (maintenant - t) / 86400000;
      if (ageJours < f.jours * 0.5 || ageJours > f.jours * 1.5) return; // hors tolérance
      const ecart = Math.abs(ageJours - f.jours);
      if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleur = g; }
    });
    if (!meilleur) return null;
    const avant = meilleur.contenu.diagnostic.abonnes;
    const delta = abonnesActuels - avant;
    const pct = avant > 0 ? Math.round((delta / avant) * 1000) / 10 : null;
    return { label: f.label, delta, pct };
  }).filter(Boolean);

  return points.length ? points : null;
}

// Remplit le placeholder #dsAbonnesEvolution après coup (async, best-effort) :
// n'affiche rien si l'historique ne permet aucune comparaison fiable, plutôt
// qu'un chiffre approximatif ou trompeur.
async function afficherEvolutionAbonnesDiagSommaire(username, abonnesActuels, estMonCompte) {
  const cible = document.getElementById('dsAbonnesEvolution');
  if (!cible) return;
  let points = null;
  try { points = await evolutionAbonnesDiagSommaire(username, abonnesActuels, estMonCompte); }
  catch (e) { return; }
  if (!points || !points.length) return;
  const moi = estMonCompte !== false;
  cible.innerHTML = `
    <div class="score-card">
      <div class="audit-section-label">${moi ? 'Évolution de tes abonnés' : 'Évolution de ses abonnés'}</div>
      <div class="ds-abo-evo-grid">
        ${points.map(p => {
          const classe = p.delta > 0 ? 'ds-abo-evo-up' : p.delta < 0 ? 'ds-abo-evo-down' : '';
          const signe = p.delta > 0 ? '+' : '';
          const pctTxt = p.pct != null ? ` (${p.pct > 0 ? '+' : ''}${String(p.pct).replace('.', ',')}%)` : '';
          return `<div class="ds-abo-evo-item">
            <div class="ds-abo-evo-periode">${diagSommaireEsc(p.label)}</div>
            <div class="ds-abo-evo-delta ${classe}">${signe}${p.delta.toLocaleString('fr-FR')}${pctTxt}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// Affiche le résultat (nouvelle génération OU réouverture depuis l'historique).
// estMonCompte : true = mon compte (posture coach), false = un concurrent
// (posture décodage). Le moteur/score est identique ; seule l'écriture change.
function afficherDiagnosticSommaireResultat(d, username, estMonCompte = true) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !d) return;
  const moi = estMonCompte !== false;
  // Mémorise ce résultat pour un éventuel face-à-face (voir analyserMonCompteVsConcurrent).
  _dernierSommaireAffiche = { username: username, diagnostic: d, estMonCompte: moi };

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
      <div class="audit-section-label" style="margin-top:18px">${ICO('bulb')} Suggestions pour la bio</div>
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
  const topHtml = carteVideos(moi ? 'Tes vidéos qui cartonnent' : 'Ses cartons : la recette à décoder', ICO('flame') + ' Top', true, d.top_videos);
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
      <div class="audit-section-label">${ICO('target')} Sa faille, ton opportunité</div>
      <p class="audit-diag-constat" style="margin-top:8px">${diagSommaireEsc(d.faille_exploiter)}</p>
    </div>` : '';

  const verdict = d.verdict_inspiration || {};
  const VERDICT_META = {
    oui:      { tag: ICO('check') + ' Vrai modèle',        cls: 'ds-tag-ok' },
    partiel:  { tag: '~ À prendre avec pincettes', cls: '' },
    prudence: { tag: ICO('warn') + ' Pas un modèle',      cls: 'ds-tag-alert' }
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
      <button class="btn-generate" onclick="analyserMonCompteVsConcurrent()">Analyser mon compte →</button>
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
      ${evo.formule_gagnante ? `<div class="ds-evo-formule"><div class="ds-evo-h">${ICO('trophy')} ${moi ? 'Ta' : 'Sa'} formule gagnante</div><p>${diagSommaireEsc(evo.formule_gagnante)}</p></div>` : ''}
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

    <div id="dsAbonnesEvolution"></div>
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
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="analyserAutreCompteDiagSommaire(${moi})">Analyser un autre compte</button>
    ${moi ? `<div id="dsFusionBanner" class="ds-alt" style="display:none;margin-top:20px;cursor:pointer" onclick="ouvrirFusionDiagnostics()">
      ${ICO('link')} Tu as fait tes deux diagnostics,<strong>découvre le rapport fusionné, plus complet →</strong>
    </div>` : ''}`;

  results.style.display = 'block';
  setTimeout(() => animerScoreDiagSommaire(score, RING_C), 50);

  // Recommandation sommaire pour les non-abonnés qui ont déjà assez de
  // mémoire locale (script, récit, autre diagnostic déjà fait sur ce
  // navigateur), en tâche de fond, ne retarde jamais l'affichage du
  // diagnostic lui-même. Voir js/recommandations.js.
  if (!unlocked && typeof afficherOpportuniteDiagSommaire === 'function') {
    afficherOpportuniteDiagSommaire();
  }
  // Propose le rapport fusionné dès que ce diagnostic (le sien) complète la
  // paire avec un diagnostic complet déjà fait, directement ici, pas
  // seulement retrouvé plus tard dans "Mes générations".
  if (moi && typeof verifierBanniereFusion === 'function') verifierBanniereFusion('dsFusionBanner');
  // Évolution des abonnés vs diagnostics précédents du même compte (mon
  // compte OU un concurrent suivi dans le temps), en tâche de fond.
  afficherEvolutionAbonnesDiagSommaire(username, d.abonnes, moi);
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Score global d'un diagnostic (mêmes règles que l'anneau) : somme des SEULES
// dimensions mesurées, ramenée sur 100. Sert au duel chiffré du face-à-face.
function scoreGlobalDepuisDiag(d) {
  let obt = 0, max = 0;
  Object.keys(DS_DIM_META).forEach(cle => {
    const meta = DS_DIM_META[cle], dim = d && d[cle];
    if (dim && dim.disponible !== false && typeof dim.score === 'number' && !Number.isNaN(dim.score)) {
      obt += Math.max(0, Math.min(meta.max, dim.score)); max += meta.max;
    }
  });
  return max > 0 ? Math.round(obt / max * 100) : null;
}

// FACE-À-FACE « Toi face à @concurrent » : ajouté EN HAUT de mon résultat quand
// je viens de « Analyser mon compte » après avoir décodé un concurrent. Duel
// chiffré déterministe (score + 4 dimensions, mes chiffres vs les siens) puis
// synthèse IA (où je mène / suis en retard, et LE levier n°1 à lui prendre).
// Best-effort : toute erreur laisse simplement mon résultat tel quel.
async function afficherComparaisonConcurrent(moiDiag, moiUsername, concurrent) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !moiDiag || !concurrent) return;
  const concUser = (concurrent.username || 'ce compte');
  const concDiag = concurrent.diagnostic || {};

  // Carte placeholder tout en haut (le duel arrive après l'appel IA).
  const carte = document.createElement('div');
  carte.className = 'score-card ds-evolution pivot ds-vs-card';
  carte.innerHTML = `<div class="ds-vs-loading">On te compare à @${diagSommaireEsc(concUser)} ☕…</div>`;
  results.insertAdjacentElement('afterbegin', carte);

  // Duel chiffré (déterministe) : score global + 4 dimensions.
  const mesur = x => (x && x.disponible !== false && typeof x.score === 'number' && !Number.isNaN(x.score)) ? x.score : null;
  const lignes = [{ label: 'Score global', max: 100, moi: scoreGlobalDepuisDiag(moiDiag), lui: scoreGlobalDepuisDiag(concDiag) }];
  Object.keys(DS_DIM_META).forEach(cle => {
    const meta = DS_DIM_META[cle];
    lignes.push({ label: meta.label, max: meta.max, moi: mesur(moiDiag[cle]), lui: mesur(concDiag[cle]) });
  });
  // Synthèse IA (courte, actionnable).
  const compact = (d) => tronquerSansCouperEmoji(JSON.stringify({
    sante: d.sante_compte, engagement: d.engagement, portee: d.portee, regularite: d.regularite,
    viralite: d.viralite, niche: d.niche && d.niche.nom, top: d.top_videos,
    formule_gagnante: d.evolution && d.evolution.formule_gagnante, concepts: d.concepts_recurrents
  }), 2500);
  // Le CODE tranche qui gagne chaque dimension (un nombre plus élevé = meilleur).
  // L'IA ne compare JAMAIS les chiffres elle-même : elle ne fait que reformuler
  // ces verdicts, pour ne pas inverser le sens (ex. dire « tu domines » à 16 vs 18).
  const verdictLigne = (l) => {
    if (l.moi == null && l.lui == null) return 'non mesuré des deux côtés';
    if (l.moi == null) return 'NON MESURÉ chez toi';
    if (l.lui == null) return 'non mesuré chez lui';
    if (l.moi > l.lui) return `TU MÈNES (écart ${l.moi - l.lui})`;
    if (l.lui > l.moi) return `IL MÈNE (écart ${l.lui - l.moi})`;
    return 'ÉGALITÉ';
  };
  const duelTexte = lignes.map(l => `- ${l.label} : toi ${l.moi == null ? 'n/a' : l.moi} / lui ${l.lui == null ? 'n/a' : l.lui} => ${verdictLigne(l)}`).join('\n');
  const menes = lignes.filter(l => l.moi != null && l.lui != null && l.moi > l.lui).map(l => l.label);
  const retard = lignes.filter(l => l.moi != null && l.lui != null && l.lui > l.moi).map(l => l.label);
  const nonMesure = lignes.filter(l => l.moi == null && l.lui != null).map(l => l.label);
  const resume = `TU MÈNES SUR : ${menes.length ? menes.join(', ') : 'AUCUNE dimension'}\nTU ES EN RETARD SUR : ${retard.length ? retard.join(', ') : 'aucune dimension'}\nNON MESURÉ CHEZ TOI (ne prétends pas mener ou être en retard dessus) : ${nonMesure.length ? nonMesure.join(', ') : 'aucune'}`;
  const prompt = `Tu es Scriptura, consultant TikTok. L'utilisateur (@${moiUsername}) vient d'analyser un concurrent (@${concUser}) puis son propre compte. Écris une comparaison PRO, honnête et actionnable, à la 2e personne (« tu »).

DUEL CHIFFRÉ avec VERDICT DÉJÀ CALCULÉ par le code (c'est la vérité, à ne JAMAIS contredire ni recalculer) :
${duelTexte}

VERDICT D'ENSEMBLE (calculé par le code) :
${resume}

TON COMPTE (@${moiUsername}) : ${compact(moiDiag)}
LE CONCURRENT (@${concUser}) : ${compact(concDiag)}

RÈGLE ABSOLUE : ne compare jamais les chiffres toi-même et ne décide jamais qui gagne, le code l'a déjà tranché ci-dessus. Reprends EXACTEMENT ces verdicts (« tu mènes » / « il mène » / « égalité » / « non mesuré »). Ne dis jamais que tu domines une dimension marquée « IL MÈNE » ou « NON MESURÉ chez toi ». Puis donne LE levier n°1 à lui prendre pour combler l'écart, en t'appuyant sur sa formule gagnante / ses cartons. Concret, pas de flatterie, pas de généralités. N'emploie pas de tiret cadratin.

Réponds UNIQUEMENT en JSON : { "constat": "<2 à 4 phrases>", "levier_titre": "<max 8 mots>", "levier_detail": "<1-2 phrases>" }`;

  let syn = null;
  try { syn = parseAIResponse(await callAI(MODEL_RAPIDE, 1200, prompt, undefined, false, undefined, 'diagnosticSommaire')); } catch (e) { syn = null; }

  carte.innerHTML = _carteVsHtml(concUser, lignes, syn);

  // Persiste la comparaison dans la génération de mon compte (best-effort), pour
  // qu'elle réapparaisse à la réouverture depuis l'historique. Passe par le
  // serveur (clé service_role) comme le reste des écritures sur `generations`,
  // voir api/generations.js action 'patch'.
  try {
    if (typeof currentGenId !== 'undefined' && currentGenId) {
      const comparaison = { concurrent: concUser, lignes, synthese: syn };
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'generations', action: 'patch', code: getUserRef(), id: currentGenId, champs: { comparaisonConcurrent: comparaison } })
      });
    }
  } catch (e) { /* silencieux */ }
}

// Construit le HTML de la carte « Toi face à @concurrent » à partir du duel
// chiffré (lignes) et de la synthèse. Partagé entre l'affichage en direct
// (afficherComparaisonConcurrent) et la réouverture depuis l'historique
// (renderComparaisonSauvegardee), pour un rendu identique sans réappel IA.
function _carteVsHtml(concUser, lignes, syn) {
  const cell = (v, max) => (v == null ? '·' : v + '<span class="ds-vs-max">/' + max + '</span>');
  const corps = (lignes || []).map(l => {
    const both = l.moi != null && l.lui != null;
    const gagneMoi = both && l.moi > l.lui, gagneLui = both && l.lui > l.moi;
    return `<tr>
      <td class="ds-vs-dim">${diagSommaireEsc(l.label)}</td>
      <td class="ds-vs-num${gagneMoi ? ' ds-vs-gagne' : ''}">${cell(l.moi, l.max)}${gagneMoi ? ' ▸' : ''}</td>
      <td class="ds-vs-num${gagneLui ? ' ds-vs-gagne' : ''}">${gagneLui ? '◂ ' : ''}${cell(l.lui, l.max)}</td>
    </tr>`;
  }).join('');
  const tableau = `<table class="ds-vs"><thead><tr>
      <th></th><th>Toi</th><th>@${diagSommaireEsc(concUser)}</th></tr></thead>
    <tbody>${corps}</tbody></table>`;
  return `
    <div class="ds-section-row">
      <div class="audit-section-label" style="margin-bottom:0">Toi face à @${diagSommaireEsc(concUser)}</div>
      <span class="ds-tag ds-tag-alert">Face-à-face</span>
    </div>
    <div class="ds-vs-wrap">${tableau}</div>
    ${syn && syn.constat ? `<p class="audit-diag-constat" style="margin-top:14px">${diagSommaireEsc(syn.constat)}</p>` : ''}
    ${syn && syn.levier_titre ? `<div class="ds-evo-formule"><div class="ds-evo-h">${ICO('target')} Ton levier n°1 face à lui</div><p><b>${diagSommaireEsc(syn.levier_titre)}</b> — ${diagSommaireEsc(syn.levier_detail || '')}</p></div>` : ''}`;
}

// Réaffiche un face-à-face DÉJÀ calculé (stocké dans la génération) en haut du
// résultat, sans réappeler l'IA. Utilisé à la réouverture depuis l'historique.
function renderComparaisonSauvegardee(comp) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !comp || !Array.isArray(comp.lignes)) return;
  const carte = document.createElement('div');
  carte.className = 'score-card ds-evolution pivot ds-vs-card';
  carte.innerHTML = _carteVsHtml(comp.concurrent || 'ce compte', comp.lignes, comp.synthese);
  results.insertAdjacentElement('afterbegin', carte);
}

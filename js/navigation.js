// ═══════════════════════════════════════════════════════════
//  HISTORIQUE DE NAVIGATION (pile) — pour un vrai "Retour" pas à pas
// ═══════════════════════════════════════════════════════════
let navStack = [];

// Liste UNIQUE de tous les écrans de premier niveau. Plusieurs fonctions
// d'ouverture d'écran (chooseMode, openHistory, ouvrirTableauDeBord,
// ouvrirFusionDiagnostics, openStoryboardSeul, reopenGeneration…) avaient
// chacune sa propre liste recopiée à la main pour masquer "tous les autres
// écrans" avant d'afficher le leur — ces listes ont fini par diverger à
// chaque nouvel écran ajouté (fusion, storyboard seul, tableau de bord…),
// laissant l'écran précédent visible en dessous du nouveau. Cette liste et
// masquerTousLesEcrans() sont désormais la SEULE source de vérité : toute
// fonction qui ouvre un écran doit appeler masquerTousLesEcrans() plutôt que
// de refaire sa propre liste.
const TOUS_LES_ECRANS = ['homePage', 'flow', 'ideasFlow', 'storyFlow', 'auditFlow', 'diagSommaireFlow', 'fusionFlow', 'serieFlow', 'storyboardSeulFlow', 'historyFlow', 'adminFlow'];
function masquerTousLesEcrans() {
  TOUS_LES_ECRANS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  reinitialiserZoom();
}

// ═══════════════════════════════════════════════════════════
//  RÉINITIALISATION DU ZOOM MOBILE — corrige un "zoom aléatoire" signalé
//  sur tous les modes : comme l'app change d'écran sans jamais recharger
//  la page, un zoom résiduel (pincement accidentel, ou reliquat du zoom
//  système sur un champ) pouvait persister d'un écran à l'autre. Tous les
//  champs de saisie sont déjà en 16px minimum (voir css/style.css), donc
//  ce n'est pas un focus qui zoome — c'est un état de zoom qui traîne.
//  On le réinitialise à chaque changement d'écran, via le point de passage
//  unique déjà utilisé par tous les modes (masquerTousLesEcrans).
// ═══════════════════════════════════════════════════════════
function reinitialiserZoom() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute('content') || 'width=device-width, initial-scale=1.0';
  // Forcer un instant le zoom à 1 (le navigateur applique le changement),
  // puis revenir au réglage normal pour ne jamais bloquer le pincement.
  meta.setAttribute('content', original + ', maximum-scale=1.0, user-scalable=no');
  setTimeout(() => { meta.setAttribute('content', original); }, 150);
}

// Identifie l'écran actuellement visible
function currentScreen() {
  // Un résultat affiché est un "sous-écran" prioritaire
  const results = { 'results': 'flow', 'ideasResults': 'ideasFlow', 'storyResults': 'storyFlow' };
  for (const rid in results) {
    const el = document.getElementById(rid);
    if (el && el.style.display !== 'none' && el.offsetParent !== null) {
      return rid; // ex: 'ideasResults'
    }
  }
  // Sinon, l'écran/module visible
  for (const id of ['flow', 'ideasFlow', 'storyFlow', 'auditFlow', 'diagSommaireFlow', 'fusionFlow', 'serieFlow', 'storyboardSeulFlow', 'historyFlow', 'adminFlow']) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') return id;
  }
  // Page d'accueil : distinguer le mode focus (les 5 choix révélés) de l'accueil complet.
  if (document.body.classList.contains('hero-focus')) return 'heroFocus';
  return 'homePage';
}

// Empile l'écran courant avant d'en changer
let _skipPush = false;
function pushNav() {
  if (_skipPush) return; // réouverture depuis l'historique : empilement géré à la main
  const s = currentScreen();
  // Éviter les doublons consécutifs
  if (navStack[navStack.length - 1] !== s) navStack.push(s);
}

// Affiche un écran donné (sans toucher à la pile)
function showScreen(screen) {
  // Masquer tout
  masquerTousLesEcrans();
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');

  // En quittant l'historique, on sort proprement du mode sélection (sinon la
  // barre flottante continuerait de masquer le bouton "haut/bas" ailleurs).
  if (screen !== 'historyFlow') {
    if (typeof _selectMode !== 'undefined') _selectMode = false;
    if (typeof _selectedIds !== 'undefined') _selectedIds.clear();
    document.body.classList.remove('hist-select');
  }
  // Revenir à l'accueil = accueil complet, jamais le mode focus.
  if (screen === 'homePage' && typeof resetAccueilFocus === 'function') resetAccueilFocus();
  // Rafraîchir la recommandation IA à chaque retour à l'accueil complet (pas
  // en mode heroFocus, où #accueilPremium reste masqué par CSS) : sans ça,
  // une reco consommée (cache vidé après "Créer le script", voir
  // js/generation.js) resterait affichée telle quelle jusqu'au prochain
  // rechargement complet de la page. initAccueilPremium() relit d'abord le
  // cache journalier, donc ceci n'appelle l'IA que si nécessaire.
  if (screen === 'homePage' && typeof initAccueilPremium === 'function') initAccueilPremium();

  // Cas d'un sous-écran résultat
  const resultParent = { 'results': 'flow', 'ideasResults': 'ideasFlow', 'storyResults': 'storyFlow' };
  if (resultParent[screen]) {
    document.getElementById(resultParent[screen]).style.display = 'block';
    document.getElementById(screen).style.display = 'block';
  } else if (screen === 'homePage') {
    document.getElementById('homePage').style.display = 'block';
  } else if (screen === 'heroFocus') {
    // Retour depuis un mode : on réaffiche le héro avec les 5 choix déjà révélés,
    // pas l'accueil complet depuis le tout début.
    document.getElementById('homePage').style.display = 'block';
    if (typeof revelerModes === 'function') revelerModes();
  } else {
    document.getElementById(screen).style.display = 'block';
    // Masquer les résultats de ce module (on revient au formulaire)
    const childRes = { 'flow':'results', 'ideasFlow':'ideasResults', 'storyFlow':'storyResults' };
    if (childRes[screen]) {
      const r = document.getElementById(childRes[screen]);
      if (r) r.style.display = 'none';
    }
    // Rafraîchir la liste des générations en y revenant
    if (screen === 'historyFlow' && typeof renderHistory === 'function') renderHistory();
  }
  // On remet la page en haut AVANT d'animer, pour que le fondu soit visible
  window.scrollTo({ top: 0, behavior: 'auto' });
  const cibleAnim = (screen === 'heroFocus') ? 'homePage' : (resultParent[screen] || screen);
  animerEntreeEcran(document.getElementById(cibleAnim));
}

// Retour pas à pas : revient à l'écran précédent de la pile
function navBack() {
  if (navStack.length > 0) {
    const prev = navStack.pop();
    showScreen(prev);
  } else {
    showScreen('homePage');
  }
}

function goHome() {
  navStack = []; // réinitialiser l'historique quand on revient à l'accueil
  // Sortir du mode sélection de l'historique s'il était actif
  if (typeof _selectMode !== 'undefined') _selectMode = false;
  if (typeof _selectedIds !== 'undefined') _selectedIds.clear();
  document.body.classList.remove('hist-select');
  // Accueil complet (pas le mode focus des 5 boutons)
  if (typeof resetAccueilFocus === 'function') resetAccueilFocus();
  // Rafraîchir la recommandation IA (voir même appel + explication dans
  // showScreen ci-dessus — goHome() est un chemin de retour distinct, ex.
  // clic sur le logo, qui doit bénéficier du même rafraîchissement).
  if (typeof initAccueilPremium === 'function') initAccueilPremium();
  // Masquer tous les modules, puis réafficher la page d'accueil
  masquerTousLesEcrans();
  document.getElementById('homePage').style.display = 'block';
  // Masquer aussi le paywall s'il était ouvert
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
  animerEntreeEcran(document.getElementById('homePage'));
}

function backToHome() {
  // Si des résultats sont affichés, "Retour" ramène au formulaire (page précédente)
  // plutôt que directement à l'accueil.
  const resultsBlocks = ['results', 'ideasResults', 'storyResults'];
  let closedSomething = false;
  for (const id of resultsBlocks) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none' && el.offsetParent !== null) {
      el.style.display = 'none';
      closedSomething = true;
    }
  }
  if (closedSomething) {
    // On reste dans le mode, on remonte juste au formulaire
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  // Sinon, retour à l'accueil
  goHome();
}

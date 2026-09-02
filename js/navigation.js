// ═══════════════════════════════════════════════════════════
//  HISTORIQUE DE NAVIGATION (pile), pour un vrai "Retour" pas à pas
// ═══════════════════════════════════════════════════════════
let navStack = [];

// Liste UNIQUE de tous les écrans de premier niveau. Plusieurs fonctions
// d'ouverture d'écran (chooseMode, openHistory, ouvrirTableauDeBord,
// ouvrirFusionDiagnostics, openStoryboardSeul, reopenGeneration…) avaient
// chacune sa propre liste recopiée à la main pour masquer "tous les autres
// écrans" avant d'afficher le leur, ces listes ont fini par diverger à
// chaque nouvel écran ajouté (fusion, storyboard seul, tableau de bord…),
// laissant l'écran précédent visible en dessous du nouveau. Cette liste et
// masquerTousLesEcrans() sont désormais la SEULE source de vérité : toute
// fonction qui ouvre un écran doit appeler masquerTousLesEcrans() plutôt que
// de refaire sa propre liste.
const TOUS_LES_ECRANS = ['homePage', 'flow', 'ideasFlow', 'storyFlow', 'auditFlow', 'diagSommaireFlow', 'viralFlow', 'tiktokOutilsFlow', 'montageManuelFlow', 'fusionFlow', 'serieFlow', 'storyboardSeulFlow', 'historyFlow', 'adminFlow', 'tendancesFlow'];
function masquerTousLesEcrans() {
  TOUS_LES_ECRANS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  reinitialiserZoom();
}

// ═══════════════════════════════════════════════════════════
//  RÉINITIALISATION DU ZOOM MOBILE, corrige un "zoom aléatoire" signalé
//  sur tous les modes : comme l'app change d'écran sans jamais recharger
//  la page, un zoom résiduel (pincement accidentel, ou reliquat du zoom
//  système sur un champ) pouvait persister d'un écran à l'autre. Tous les
//  champs de saisie sont déjà en 16px minimum (voir css/style.css), mais
//  certains navigateurs mobiles (Safari iOS notamment) zooment quand même
//  légèrement au focus d'un champ, malgré le 16px, et ne redézooment pas
//  toujours tout seuls en le quittant : le zoom traîne alors tel quel,
//  sur le même écran, bien avant tout changement d'écran. On réinitialise
//  donc À LA FOIS à chaque changement d'écran (masquerTousLesEcrans) ET dès
//  qu'un champ de saisie perd le focus (délégation sur document, couvre
//  aussi les champs ajoutés dynamiquement en HTML par l'app).
// ═══════════════════════════════════════════════════════════
// Contenu d'origine capturé UNE SEULE FOIS au chargement : si on le relisait
// à chaque appel via getAttribute(), deux réinitialisations rapprochées (ex.
// un changement d'écran juste après la perte de focus d'un champ, les deux
// déclenchent désormais reinitialiserZoom) captureraient l'une le contenu
// déjà modifié par l'autre comme "original", et l'ajout de suffixe finirait
// par s'empiler indéfiniment au lieu de revenir au vrai réglage de départ.
const _viewportOriginal = (() => {
  const meta = document.querySelector('meta[name="viewport"]');
  return (meta && meta.getAttribute('content')) || 'width=device-width, initial-scale=1.0';
})();
let _zoomResetTimer = null;
function reinitialiserZoom() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  // Forcer un instant le zoom à 1 (le navigateur applique le changement),
  // puis revenir au réglage normal pour ne jamais bloquer le pincement.
  meta.setAttribute('content', _viewportOriginal + ', maximum-scale=1.0, user-scalable=no');
  if (_zoomResetTimer) clearTimeout(_zoomResetTimer);
  _zoomResetTimer = setTimeout(() => {
    meta.setAttribute('content', _viewportOriginal);
    _zoomResetTimer = null;
  }, 150);
}
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (!t) return;
  // Cases/fichiers exclus : jamais de zoom au focus sur ceux-là, inutile de
  // réinitialiser à chaque coche (l'historique et les images du montage en
  // cochent plusieurs d'affilée en mode sélection).
  const estChampTexte = (t.tagName === 'INPUT' && !['checkbox', 'file', 'radio'].includes(t.type))
    || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  if (estChampTexte) reinitialiserZoom();
});

// Identifie l'écran actuellement visible
function currentScreen() {
  // Un résultat affiché est un "sous-écran" prioritaire
  const results = { 'results': 'flow', 'ideasResults': 'ideasFlow', 'storyResults': 'storyFlow', 'sbSeulResults': 'storyboardSeulFlow', 'diagSommaireResults': 'diagSommaireFlow', 'viralAnaResults': 'viralFlow', 'outilsResults': 'tiktokOutilsFlow', 'tendancesResults': 'tendancesFlow' };
  for (const rid in results) {
    const el = document.getElementById(rid);
    if (el && el.style.display !== 'none' && el.offsetParent !== null) {
      return rid; // ex: 'ideasResults'
    }
  }
  // Sinon, l'écran/module visible
  for (const id of ['flow', 'ideasFlow', 'storyFlow', 'auditFlow', 'diagSommaireFlow', 'viralFlow', 'tiktokOutilsFlow', 'montageManuelFlow', 'fusionFlow', 'serieFlow', 'storyboardSeulFlow', 'historyFlow', 'adminFlow', 'tendancesFlow']) {
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

  // Cas d'un sous-écran résultat. Le formulaire de saisie (masqué à l'affichage
  // du résultat, voir masquerFormulaireGeneration) doit être remasqué ici : le
  // bouton "✎ Modifier" (afficherFormulaireGeneration / modifierCriteresScript)
  // le réaffiche temporairement sans jamais empiler de nouvel écran, un
  // "← Retour" depuis cet état doit donc retomber sur CE résultat, formulaire
  // remasqué, pas sur un écran où les deux se chevauchent.
  const resultParent = { 'results': 'flow', 'ideasResults': 'ideasFlow', 'storyResults': 'storyFlow', 'sbSeulResults': 'storyboardSeulFlow', 'diagSommaireResults': 'diagSommaireFlow', 'viralAnaResults': 'viralFlow', 'outilsResults': 'tiktokOutilsFlow', 'tendancesResults': 'tendancesFlow' };
  const formCardDuResultat = { 'ideasResults': 'ideasFormCard', 'storyResults': 'storyFormCard', 'sbSeulResults': 'sbSeulFormCard', 'viralAnaResults': 'viralAnaForm', 'outilsResults': 'outilsForm', 'tendancesResults': 'tendancesForm' };
  if (resultParent[screen]) {
    document.getElementById(resultParent[screen]).style.display = 'block';
    document.getElementById(screen).style.display = 'block';
    if (screen === 'results') {
      const s3 = document.getElementById('step3');
      if (s3) s3.classList.remove('active');
    } else if (screen === 'diagSommaireResults' && typeof toggleDiagSommaireEntree === 'function') {
      // On revient sur le RÉSULTAT du diagnostic sommaire : masquer l'écran de
      // saisie (sinon il s'afficherait au-dessus du résultat restauré).
      toggleDiagSommaireEntree(false);
    } else if (formCardDuResultat[screen] && typeof masquerFormulaireGeneration === 'function') {
      masquerFormulaireGeneration(formCardDuResultat[screen]);
    }
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
    const childRes = { 'flow':'results', 'ideasFlow':'ideasResults', 'storyFlow':'storyResults', 'storyboardSeulFlow':'sbSeulResults', 'viralFlow':'viralAnaResults', 'tiktokOutilsFlow':'outilsResults', 'tendancesFlow':'tendancesResults' };
    if (childRes[screen]) {
      const r = document.getElementById(childRes[screen]);
      if (r) r.style.display = 'none';
    }
    // Filet de sécurité : sur l'écran nu (sans résultat), le formulaire doit
    // TOUJOURS être visible, sinon, si on y arrive juste après avoir quitté
    // un résultat dont le formulaire était masqué, l'écran paraîtrait vide.
    const formCardDuFlow = { 'storyFlow': 'storyFormCard', 'ideasFlow': 'ideasFormCard', 'storyboardSeulFlow': 'sbSeulFormCard', 'viralFlow': 'viralAnaForm', 'tiktokOutilsFlow': 'outilsForm', 'tendancesFlow': 'tendancesForm' };
    if (formCardDuFlow[screen]) {
      const fc = document.getElementById(formCardDuFlow[screen]);
      if (fc && fc.style.display === 'none') fc.style.display = '';
    }
    if (screen === 'flow' && !document.querySelector('#flow .step.active') && typeof showStep === 'function') {
      showStep(3);
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
  // showScreen ci-dessus, goHome() est un chemin de retour distinct, ex.
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

// ═══════════════════════════════════════════════════════════
//  HISTORIQUE DE NAVIGATION (pile) — pour un vrai "Retour" pas à pas
// ═══════════════════════════════════════════════════════════
let navStack = [];

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
  for (const id of ['flow', 'ideasFlow', 'storyFlow', 'auditFlow', 'diagSommaireFlow', 'serieFlow', 'storyboardSeulFlow', 'historyFlow', 'adminFlow']) {
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
  ['homePage','flow','ideasFlow','storyFlow','auditFlow','diagSommaireFlow','serieFlow','storyboardSeulFlow','historyFlow','adminFlow'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
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
  // Réafficher la page d'accueil, masquer tous les modules
  document.getElementById('homePage').style.display = 'block';
  document.getElementById('flow').style.display = 'none';
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('storyFlow').style.display = 'none';
  const afh = document.getElementById('auditFlow');
  if (afh) afh.style.display = 'none';
  const dsfh = document.getElementById('diagSommaireFlow');
  if (dsfh) dsfh.style.display = 'none';
  const sfh = document.getElementById('serieFlow');
  if (sfh) sfh.style.display = 'none';
  const sbsh = document.getElementById('storyboardSeulFlow');
  if (sbsh) sbsh.style.display = 'none';
  const hist = document.getElementById('historyFlow');
  if (hist) hist.style.display = 'none';
  const adm = document.getElementById('adminFlow');
  if (adm) adm.style.display = 'none';
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


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
  for (const id of ['flow', 'ideasFlow', 'storyFlow', 'auditFlow', 'serieFlow', 'historyFlow']) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') return id;
  }
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
  ['homePage','flow','ideasFlow','storyFlow','auditFlow','serieFlow','historyFlow'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');

  // Cas d'un sous-écran résultat
  const resultParent = { 'results': 'flow', 'ideasResults': 'ideasFlow', 'storyResults': 'storyFlow' };
  if (resultParent[screen]) {
    document.getElementById(resultParent[screen]).style.display = 'block';
    document.getElementById(screen).style.display = 'block';
  } else if (screen === 'homePage') {
    document.getElementById('homePage').style.display = 'block';
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
  animerEntreeEcran(document.getElementById(resultParent[screen] || screen));
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
  // Réafficher la page d'accueil, masquer tous les modules
  document.getElementById('homePage').style.display = 'block';
  document.getElementById('flow').style.display = 'none';
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('storyFlow').style.display = 'none';
  const afh = document.getElementById('auditFlow');
  if (afh) afh.style.display = 'none';
  const sfh = document.getElementById('serieFlow');
  if (sfh) sfh.style.display = 'none';
  const hist = document.getElementById('historyFlow');
  if (hist) hist.style.display = 'none';
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


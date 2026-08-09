// ── BOUTON D'ACCUEIL « Commencer » → mode « focus » ──
// Au clic, l'accueil passe en mode focus : on masque tout le reste (grand
// titre, sections « Comment ça marche / Pourquoi / Tarifs / FAQ », salutation)
// et il ne reste que le cadre du statut, les 5 modes et le footer. Un bouton
// « ← Retour » (haut-gauche) revient à l'accueil complet.
function revelerModes() {
  const cta = document.getElementById('heroCta');
  const modes = document.getElementById('heroModes');
  const hint = document.getElementById('heroModesHint');
  if (cta) cta.style.display = 'none';
  if (modes) modes.style.display = ''; // retombe sur le display:grid du CSS
  if (hint) hint.style.display = '';
  document.body.classList.add('hero-focus');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Remet l'accueil dans son état complet (bouton Commencer visible, modes cachés).
function resetAccueilFocus() {
  document.body.classList.remove('hero-focus');
  const cta = document.getElementById('heroCta');
  const modes = document.getElementById('heroModes');
  const hint = document.getElementById('heroModesHint');
  if (modes) modes.style.display = 'none';
  if (hint) hint.style.display = 'none';
  if (cta) cta.style.display = '';
}

// « ← Retour » : quitte le mode focus et revient à l'accueil complet.
function quitterFocus() {
  resetAccueilFocus();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Libellé du bouton selon le statut : un abonné voit une invitation à agir
// (tirée au hasard parmi plusieurs, pour ne pas figer le texte à chaque
// visite), un nouveau visiteur voit l'offre gratuite.
const HERO_CTA_PHRASES_ABONNE = [
  'Que veux-tu créer ?',
  'Tu as une idée en tête ?',
  "Qu'est-ce qu'on écrit aujourd'hui ?",
  'Ton prochain contenu commence ici.',
  'Prêt à faire exploser ton compte ?',
  "Envie de percer aujourd'hui ?",
  'On fait grandir ton audience ?',
  'Tu commences par quoi ?',
  'Par quoi on commence ?',
  "On s'y met ?"
];
// Tirée une seule fois par visite (pas à chaque appel de majHeroCta, qui est
// rappelée souvent — après chaque génération, changement de quota…) pour que
// le texte reste stable pendant toute la session au lieu de changer sous les yeux.
let _heroCtaPhraseAbonne = null;
function majHeroCta() {
  const lbl = document.getElementById('heroCtaLabel');
  if (!lbl) return;
  if (typeof unlocked !== 'undefined' && unlocked) {
    if (!_heroCtaPhraseAbonne) {
      _heroCtaPhraseAbonne = HERO_CTA_PHRASES_ABONNE[Math.floor(Math.random() * HERO_CTA_PHRASES_ABONNE.length)];
    }
    lbl.textContent = _heroCtaPhraseAbonne;
  } else {
    lbl.textContent = 'Commencer gratuitement';
  }
}

function openModal() {
  // Fermer le paywall et le rappel s'ils sont ouverts (sinon ils masquent cette modal)
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');
  const rappel = document.getElementById('rappelOverlay');
  if (rappel) rappel.classList.remove('active');
  document.getElementById('modalOverlay').classList.add('active');
  setTimeout(() => document.getElementById('codeInput').focus(), 100);
}


// ── BOUTON INTELLIGENT HAUT/BAS ──
// Descend en bas si on est en haut, remonte en haut si on est en bas.
function scrollSmart() {
  // Couper net toute inertie de scroll manuel en cours : on "fixe" la position
  // actuelle en instantané. Sans ça, sur mobile, le premier clic ne fait
  // qu'arrêter le mouvement du doigt et il faut recliquer.
  window.scrollTo({ top: window.scrollY, behavior: 'auto' });
  // Puis on lance le défilement automatique au tour de boucle suivant,
  // pour que le navigateur ait bien enregistré l'arrêt avant de repartir.
  const cible = (_scrollDir === 'down') ? document.body.scrollHeight : 0;
  requestAnimationFrame(() => {
    window.scrollTo({ top: cible, behavior: 'smooth' });
  });
}
// Garde l'ancien nom au cas où il est appelé ailleurs
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

let _lastScrollY = 0;
let _scrollDir = 'down'; // sens courant du scroll
function updateScrollBtn() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  // La page est-elle assez longue pour scroller ?
  const scrollable = document.body.scrollHeight > window.innerHeight + 200;
  if (!scrollable) { btn.classList.remove('visible'); return; }

  btn.classList.add('visible');

  const y = window.scrollY;
  // Détecter le sens du scroll (avec un petit seuil pour éviter les micro-mouvements)
  if (y > _lastScrollY + 4) _scrollDir = 'down';
  else if (y < _lastScrollY - 4) _scrollDir = 'up';
  _lastScrollY = y;

  // La flèche suit le sens du scroll
  btn.textContent = (_scrollDir === 'down') ? '↓' : '↑';
  btn.setAttribute('title', (_scrollDir === 'down') ? 'Descendre en bas' : 'Remonter en haut');
}
window.addEventListener('scroll', updateScrollBtn);
window.addEventListener('resize', updateScrollBtn);

// ── MENU LATÉRAL (SIDEBAR) ──
function openSidebar() {
  document.getElementById('sidebar').classList.add('active');
  document.getElementById('sidebarOverlay').classList.add('active');
  updateSidebarCounter();
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('active');
  document.getElementById('sidebarOverlay').classList.remove('active');
}
function sidebarGo(action) {
  closeSidebar();
  if (action === 'history') { openHistory(); }
  else if (action === 'admin') { ouvrirTableauDeBord(); }
  else if (action === 'code') { openModal(); }
  else if (action === 'storyboardSeul') { if (typeof openStoryboardSeul === 'function') openStoryboardSeul(); }
  else if (action === 'subscribe') {
    // Ouvre le pop-up de choix des plans (Creator / Pro) ; l'utilisateur
    // choisit son plan avant d'être redirigé vers WhatsApp.
    if (typeof openPlans === 'function') openPlans('abonnement');
  }
}
function seDeconnecter() {
  unlocked = false;
  localStorage.setItem('scriptura_unlocked', 'false');
  localStorage.removeItem('scriptura_code');
  localStorage.removeItem('scriptura_expire');
  localStorage.removeItem('scriptura_is_admin');
  localStorage.removeItem('scriptura_illimite');
  document.body.classList.remove('is-unlocked');
  closeSidebar();
  location.reload();
}

// Met à jour le compteur affiché dans la sidebar
async function updateSidebarCounter() {
  const el = document.getElementById('sidebarCounterValue');
  if (!el) return;
  if (unlocked) {
    if (estIllimite()) {
      el.textContent = '✦ Illimité';
      return;
    }
    const faites = await countMonthGenerations('creation');
    const limiteCreation = limitesDuPalier().creation;
    const faitesAff = Math.min(faites, limiteCreation);
    el.textContent = faitesAff + ' / ' + limiteCreation + ' ce mois';
  } else {
    const faitesAff = Math.min(usedGen, MAX_FREE);
    el.textContent = faitesAff + ' / ' + MAX_FREE + ' gratuites';
  }
}

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
  else if (action === 'code') { openModal(); }
  else if (action === 'subscribe') {
    // Ouvre WhatsApp pour s'abonner
    window.open('https://wa.me/22995056424?text=Bonjour%20!%20je%20veux%20m%27abonner%20%C3%A0%20Scriptura%20pour%205%20000%20FCFA%2Fmois', '_blank');
  }
}
function seDeconnecter() {
  unlocked = false;
  localStorage.setItem('scriptura_unlocked', 'false');
  localStorage.removeItem('scriptura_code');
  localStorage.removeItem('scriptura_expire');
  document.body.classList.remove('is-unlocked');
  closeSidebar();
  location.reload();
}

// Met à jour le compteur affiché dans la sidebar
async function updateSidebarCounter() {
  const el = document.getElementById('sidebarCounterValue');
  if (!el) return;
  if (unlocked) {
    const monCode = (localStorage.getItem('scriptura_code') || '').toUpperCase();
    if (CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode)) {
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


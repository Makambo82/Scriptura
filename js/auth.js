// ── POP-UP RAPPEL ABONNEMENT ──
function fermerRappel() {
  document.getElementById('rappelOverlay').classList.remove('active');
}
function rappelVersCode() {
  fermerRappel();
  openModal();
}
// Déclenche le rappel après la 3e génération, une seule fois par appareil
function checkRappelAbonnement() {
  if (unlocked) return; // déjà abonné, pas de rappel
  if (localStorage.getItem('scriptura_rappel_vu')) return; // déjà montré
  if (usedGen === 3) {
    localStorage.setItem('scriptura_rappel_vu', 'true');
    setTimeout(() => {
      document.getElementById('rappelOverlay').classList.add('active');
    }, 1200); // petit délai après l'affichage du résultat
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('modalError').style.display = 'none';
  document.getElementById('codeInput').value = '';
}

// Interroge /api/verify-code pour connaître les droits RÉELS d'un code :
// admin/VIP/secours (env Vercel), abonnement normal ou jeton (relu côté
// serveur dans Supabase avec la clé service_role, jamais depuis le
// navigateur, voir api/verify-code.js). Mémorise le verdict, jamais le code
// lui-même en clair au-delà de scriptura_code (déjà le cas avant). Ne lève
// jamais d'erreur : en cas d'échec réseau, on part du principe qu'il n'y a
// ni admin ni illimité (le code peut quand même être valide, voir verifyCode).
async function verifierStatutServeur(code) {
  try {
    const r = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await r.json();
    localStorage.setItem('scriptura_is_admin', data.isAdmin ? 'true' : 'false');
    localStorage.setItem('scriptura_illimite', data.illimite ? 'true' : 'false');
    return data;
  } catch (e) {
    localStorage.setItem('scriptura_is_admin', 'false');
    localStorage.setItem('scriptura_illimite', 'false');
    return { valid: false, isAdmin: false, illimite: false };
  }
}

async function verifyCode() {
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  const errorEl = document.getElementById('modalError');
  errorEl.style.display = 'none';

  if (!code) {
    errorEl.textContent = 'Entre ton code d\'accès.';
    errorEl.style.display = 'block';
    return;
  }

  const btn = document.querySelector('#modalOverlay .btn-generate') || document.querySelector('#modalOverlay button');
  const btnLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }

  // Seule source de vérité : le serveur (admin/VIP/secours, ou abonnement/
  // jeton relu dans Supabase avec la clé service_role). Plus de requête
  // Supabase directe depuis le navigateur (voir supabase/abonnes_rls.sql).
  const verdict = await verifierStatutServeur(code);

  if (btn) { btn.disabled = false; btn.textContent = btnLabel; }

  if (!verdict.valid) {
    if (verdict.raison === 'compte désactivé') {
      errorEl.textContent = 'Ce code a été désactivé. Contacte-nous pour réactiver ton accès.';
    } else if (verdict.raison === 'abonnement expiré') {
      errorEl.textContent = 'Ton abonnement a expiré. Renouvelle pour retrouver l\'accès.';
    } else {
      errorEl.textContent = 'Code invalide. Vérifie ta saisie ou contacte-nous.';
    }
    errorEl.style.display = 'block';
    return;
  }

  // Code "jeton seul" : achat d'une ou plusieurs analyses à l'unité, sans
  // abonnement. On NE bascule PAS en "unlocked" : l'utilisateur reste sur
  // le statut non-abonné (5 générations gratuites, pas d'accès aux modes
  // Pro), on stocke juste le code pour que le solde de jetons (voir
  // lireJetonsAudit) le retrouve.
  if (verdict.jeton) {
    localStorage.setItem('scriptura_code', code);
    closeModal();
    renderGenCounter();
    closePaywall();
    return;
  }

  // Code valide : abonnement normal (Creator/Pro), ou admin/VIP/secours.
  unlocked = true;
  localStorage.setItem('scriptura_unlocked', 'true');
  localStorage.setItem('scriptura_code', code);
  if (verdict.expireLe) localStorage.setItem('scriptura_expire', verdict.expireLe);
  else localStorage.removeItem('scriptura_expire');
  localStorage.setItem('scriptura_plan', String(verdict.plan || PLAN_PAR_DEFAUT).trim().toLowerCase());
  document.body.classList.add('is-unlocked');
  appliquerClasseAdmin();
  closeModal();
  renderGenCounter();
  closePaywall();
}


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

// Interroge /api/verify-code pour savoir si `code` est le code fondateur ou
// un code VIP/secours (voir api/verify-code.js) et mémorise le verdict,
// jamais le code lui-même, dans localStorage. Ne lève jamais d'erreur :
// en cas d'échec réseau, on part du principe qu'il n'y a ni admin ni illimité.
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

  // Vérification via Supabase (codes personnels dans la table abonnes)
  if (supabaseClient) {
    // Afficher un état de chargement sur le bouton
    const btn = document.querySelector('#modalOverlay .btn-generate') || document.querySelector('#modalOverlay button');
    const btnLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }

    try {
      const { data, error } = await supabaseClient
        .from('abonnes')
        .select('*')
        .eq('code', code)
        .maybeSingle();

      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }

      if (error) throw error;

      if (!data) {
        errorEl.textContent = 'Code invalide. Vérifie ta saisie ou contacte-nous.';
        errorEl.style.display = 'block';
        return;
      }
      if (!data.actif) {
        errorEl.textContent = 'Ce code a été désactivé. Contacte-nous pour réactiver ton accès.';
        errorEl.style.display = 'block';
        return;
      }
      if (data.expire_le) {
        const expire = new Date(data.expire_le);
        const aujourdhui = new Date();
        aujourdhui.setHours(0,0,0,0);
        if (expire < aujourdhui) {
          errorEl.textContent = 'Ton abonnement a expiré. Renouvelle pour retrouver l\'accès.';
          errorEl.style.display = 'block';
          return;
        }
      }

      // Code "jeton seul" : achat d'une ou plusieurs analyses à l'unité,
      // sans abonnement. On NE bascule PAS en "unlocked" : l'utilisateur
      // reste sur le statut non-abonné (5 générations gratuites, pas
      // d'accès aux modes Pro), on stocke juste le code pour que le
      // système de jetons (lireJetonsAudit / consommerJetonAudit) le
      // retrouve et le décompte à l'usage.
      if (String(data.plan || '').trim().toLowerCase() === 'jeton') {
        localStorage.setItem('scriptura_code', code);
        closeModal();
        renderGenCounter();
        closePaywall();
        return;
      }

      // Code valide ! (abonnement normal : Creator ou Pro)
      unlocked = true;
      localStorage.setItem('scriptura_unlocked', 'true');
      localStorage.setItem('scriptura_code', code);
      // Mémoriser la date d'expiration pour l'afficher dans le pop-up abonné
      if (data.expire_le) localStorage.setItem('scriptura_expire', data.expire_le);
      else localStorage.removeItem('scriptura_expire');
      // Palier d'abonnement (colonne "plan" côté Supabase)
      localStorage.setItem('scriptura_plan',
        String(data.plan || PLAN_PAR_DEFAUT).trim().toLowerCase());
      // Ce code a-t-il en plus un statut admin/illimité (voir api/verify-code.js) ?
      await verifierStatutServeur(code);
      document.body.classList.add('is-unlocked');
      appliquerClasseAdmin();
      closeModal();
      renderGenCounter();
      closePaywall();
      return;

    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
      // Repli sur la vérification serveur si Supabase échoue
    }
  }

  // Repli : le code n'a pas de ligne Supabase (ou Supabase est indisponible),
  // il ne peut être valide que s'il s'agit du code admin ou d'un code VIP/secours,
  // vérifié uniquement côté serveur (voir api/verify-code.js).
  const verdict = await verifierStatutServeur(code);
  if (verdict.valid) {
    unlocked = true;
    localStorage.setItem('scriptura_unlocked', 'true');
    localStorage.setItem('scriptura_code', code);
    localStorage.setItem('scriptura_plan', verdict.plan || 'pro');
    document.body.classList.add('is-unlocked');
    appliquerClasseAdmin();
    closeModal();
    renderGenCounter();
    closePaywall();
  } else {
    errorEl.textContent = 'Code invalide.';
    errorEl.style.display = 'block';
  }
}


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
      document.body.classList.add('is-unlocked');
      closeModal();
      renderGenCounter();
      closePaywall();
      return;

    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
      // Repli sur les codes en dur si Supabase échoue
    }
  }

  // Repli : codes en dur (si Supabase indisponible)
  const valid = CODES_VALIDES.map(c => c.toUpperCase());
  if (valid.includes(code)) {
    unlocked = true;
    localStorage.setItem('scriptura_unlocked', 'true');
    localStorage.setItem('scriptura_code', code);
    // Codes en dur : ce sont des accès internes ou de secours, donc palier complet
    localStorage.setItem('scriptura_plan', 'pro');
    document.body.classList.add('is-unlocked');
    closeModal();
    renderGenCounter();
    closePaywall();
  } else {
    errorEl.textContent = 'Code invalide.';
    errorEl.style.display = 'block';
  }
}


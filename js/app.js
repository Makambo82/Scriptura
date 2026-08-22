// Fermer modal en cliquant dehors
// Synchronise usedGen avec le serveur : si le serveur dit qu'on a utilisé plus
// que le localStorage (cache vidé), on prend la valeur du serveur.
async function syncServerQuota() {
  if (unlocked) return; // les abonnés ne sont pas concernés
  try {
    const serverUsed = await fetchServerQuota();
    if (serverUsed !== null && serverUsed > usedGen) {
      usedGen = serverUsed;
      localStorage.setItem('scriptura_used', usedGen);
      renderGenCounter();
      // Si le serveur indique que la limite est déjà atteinte, on verrouille
    }
    // Dans tous les cas, on aligne le serveur sur le max connu
    if (serverUsed !== null && usedGen > serverUsed) {
      bumpServerQuota(usedGen);
    }
  } catch(e) { console.warn('syncServerQuota', e); }
}

// ═══════════════════════════════════════════════════════════
//  PRÉSENCE, signal "je suis encore là" pour le statut en ligne
//  du Tableau de bord (voir js/admin.js et supabase/presence.sql).
//  Envoyé par TOUS les visiteurs (abonnés ou non), uniquement pendant que
//  l'onglet est visible à l'écran, un onglet en arrière-plan ne compte
//  pas comme "en ligne". Échoue silencieusement si la table n'existe pas
//  encore (comme le reste des fonctionnalités Supabase de l'app).
// ═══════════════════════════════════════════════════════════
function envoyerPresence() {
  if (!supabaseClient || document.visibilityState !== 'visible') return;
  try {
    supabaseClient.from('presence').upsert(
      { ref: getUserRef(), derniere_activite: new Date().toISOString(), abonne: !!unlocked },
      { onConflict: 'ref' }
    );
  } catch (e) { /* silencieux */ }
}

document.addEventListener('DOMContentLoaded', function() {
  if (unlocked) document.body.classList.add('is-unlocked');
  appliquerClasseAdmin();
  // Migration : les sessions ouvertes avant la sécurisation des codes
  // admin/illimité (voir api/verify-code.js) sont "unlocked" mais n'ont
  // jamais eu scriptura_illimite/scriptura_is_admin renseignés. On les
  // revérifie une fois, en silence, pour qu'elles retrouvent leur statut
  // exact sans avoir à ressaisir leur code.
  if (unlocked && localStorage.getItem('scriptura_illimite') === null) {
    const monCode = localStorage.getItem('scriptura_code') || '';
    if (monCode && typeof verifierStatutServeur === 'function') {
      verifierStatutServeur(monCode).then(() => {
        appliquerClasseAdmin();
        if (typeof renderGenCounter === 'function') renderGenCounter();
      });
    } else {
      localStorage.setItem('scriptura_is_admin', 'false');
      localStorage.setItem('scriptura_illimite', 'false');
    }
  }
  setTimeout(updateScrollBtn, 500);
  startSocialProof();
  syncServerQuota();
  envoyerPresence();
  setInterval(envoyerPresence, 60000);
  document.addEventListener('visibilitychange', envoyerPresence);
  // Contrôle d'expiration dès l'ouverture : un abonné expiré est déconnecté
  // sans attendre qu'il tente de générer.
  if (unlocked) {
    setTimeout(async () => {
      try { if (await abonnementExpire()) gererAbonnementExpire(); } catch(e) {}
    }, 800);
    // Renseigner le décompte du bandeau d'accueil (12/50, 26/70…)
    setTimeout(() => { try { updateQuotaJour(); } catch(e) {} }, 900);
    // Bannière expiration proche / générations bientôt épuisées (voir
    // verifierNotifCompte, js/abonnement.js). Après le contrôle d'expiration
    // ci-dessus : inutile de la montrer à un abonné qu'on vient de déconnecter.
    setTimeout(() => { try { verifierNotifCompte(); } catch(e) {} }, 1100);
  }
  // Rappel des recommandations : on laisse le temps à Supabase de s'initialiser
  setTimeout(verifierRappelAudit, 1500);
  // Fermer la modal image au clic sur le fond
  const giOv = document.getElementById('genImageModal');
  if (giOv) giOv.addEventListener('click', (e) => { if (e.target === giOv) fermerGenImage(); }); // synchronise le quota gratuit avec le serveur (anti-vidage de cache)
  const overlay = document.getElementById('modalOverlay');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });
  }
  const rappelOv = document.getElementById('rappelOverlay');
  if (rappelOv) {
    rappelOv.addEventListener('click', function(e) {
      if (e.target === rappelOv) fermerRappel();
    });
  }
  const auditRappelOv = document.getElementById('auditRappelOverlay');
  if (auditRappelOv) {
    auditRappelOv.addEventListener('click', function(e) {
      if (e.target === auditRappelOv) fermerRappelAudit();
    });
  }
  const infosAbOv = document.getElementById('infosAbonneOverlay');
  if (infosAbOv) {
    infosAbOv.addEventListener('click', function(e) {
      if (e.target === infosAbOv) fermerInfosAbonne();
    });
  }
  // Choix du nombre d'épisodes d'une série
  document.querySelectorAll('#serieNbGrid .grid-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      document.querySelectorAll('#serieNbGrid .grid-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      serieNbEpisodes = parseInt(btn.dataset.val) || 5;
    });
  });
  // Choix de la durée de chaque épisode
  document.querySelectorAll('#serieDureeGrid .grid-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      document.querySelectorAll('#serieDureeGrid .grid-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      serieDuree = btn.dataset.val || '45 à 60 secondes';
    });
  });
  const paywallOv = document.getElementById('paywall');
  if (paywallOv) {
    paywallOv.addEventListener('click', function(e) {
      if (e.target === paywallOv) closePaywall();
    });
  }
  const codeInput = document.getElementById('codeInput');
  if (codeInput) {
    codeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') verifyCode();
    });
  }
  renderGenCounter();
  setupIdeaButtons();
  setupStoryButtons();
  setupStoryboardSeulButtons();
  if (typeof initCustomSelects === 'function') initCustomSelects();
  if (typeof initToggleButtonsAll === 'function') initToggleButtonsAll();

  // Recommandation IA de l'accueil (fonctionnalité Premium) : purement
  // additive, ne touche à rien d'autre. Ne fait rien pour un utilisateur
  // non abonné (voir initAccueilPremium, js/recommandations.js).
  if (typeof initAccueilPremium === 'function') initAccueilPremium();
});

// ── TON & DURÉE (menus déroulants), GROUPES INDÉPENDANTS ──
let selectedDuree = '';

const toneSelectEl = document.getElementById('tone');
if (toneSelectEl) {
  toneSelectEl.addEventListener('change', function() { selectedTone = this.value; });
}

const dureeSelectEl = document.getElementById('dureeGrid');
if (dureeSelectEl) {
  dureeSelectEl.addEventListener('change', function() { selectedDuree = this.value; });
}

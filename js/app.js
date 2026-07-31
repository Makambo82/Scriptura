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

document.addEventListener('DOMContentLoaded', function() {
  if (unlocked) document.body.classList.add('is-unlocked');
  setTimeout(updateScrollBtn, 500);
  startSocialProof();
  syncServerQuota();
  // Contrôle d'expiration dès l'ouverture : un abonné expiré est déconnecté
  // sans attendre qu'il tente de générer.
  if (unlocked) {
    setTimeout(async () => {
      try { if (await abonnementExpire()) gererAbonnementExpire(); } catch(e) {}
    }, 800);
    // Renseigner le décompte du bandeau d'accueil (12/50, 26/70…)
    setTimeout(() => { try { updateQuotaJour(); } catch(e) {} }, 900);
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

  // Recommandation IA de l'accueil (fonctionnalité Premium) : purement
  // additive, ne touche à rien d'autre. Ne fait rien pour un utilisateur
  // non abonné (voir initAccueilPremium, js/recommandations.js).
  if (typeof initAccueilPremium === 'function') initAccueilPremium();
});

// ── BOUTONS TON & DURÉE — GROUPES INDÉPENDANTS ──
let selectedDuree = '';

document.querySelectorAll('#toneGrid .grid-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#toneGrid .grid-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    selectedTone = btn.dataset.val;
  });
});

document.querySelectorAll('#dureeGrid .grid-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#dureeGrid .grid-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    selectedDuree = btn.dataset.val;
  });
});

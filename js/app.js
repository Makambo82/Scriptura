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
async function envoyerPresence() {
  if (!supabaseClient || document.visibilityState !== 'visible') return;
  try {
    // supabase-js n'exécute la requête qu'au moment où on l'attend (son
    // constructeur de requête est un "thenable" paresseux) : sans await ici,
    // l'upsert ne partait jamais réellement, aucune ligne n'était écrite
    // dans `presence`, pour personne, y compris le fondateur.
    await supabaseClient.from('presence').upsert(
      { ref: getUserRef(), derniere_activite: new Date().toISOString(), abonne: !!unlocked },
      { onConflict: 'ref' }
    );
  } catch (e) { /* silencieux */ }
}

// ═══════════════════════════════════════════════════════════
//  DÉFILEMENT AUTOMATIQUE DE LA GALERIE DE PREUVE TIKTOK (accueil)
//  Retour propriétaire : suggérer qu'on peut parcourir les couvertures sans
//  obliger à toucher, très lent (jamais un carrousel qui prend le contrôle),
//  aller-retour continu plutôt qu'un saut brutal en fin de course. Se met en
//  pause dès que l'utilisateur interagit (glisser, molette, flèches) et
//  reprend après un court délai d'inactivité, jamais pendant que quelqu'un
//  scrolle lui-même. Respecte prefers-reduced-motion.
// ═══════════════════════════════════════════════════════════
function demarrerDefilementPreuveGalerie() {
  const galerie = document.getElementById('preuveGalerie');
  if (!galerie) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const INTERVALLE = 60; // ms entre deux pas
  const PAS = 0.5; // px par pas (~8,3px/s) : très lent, à peine perceptible
  const PAUSE_APRES_INTERACTION = 2800; // ms avant reprise après une interaction
  let direction = 1;
  let derniereInteraction = 0;
  // Position flottante suivie à part : scrollLeft arrondit au pixel entier à
  // chaque lecture, un pas inférieur à 1px relu puis réécrit serait tronqué
  // et la galerie ne bougerait jamais.
  let position = galerie.scrollLeft;

  // setInterval, pas requestAnimationFrame (2e correctif, retour
  // propriétaire : le défilement ne bougeait toujours pas en prod même
  // après avoir retiré -webkit-overflow-scrolling:touch) : rAF s'est déjà
  // montré peu fiable pour tourner en continu sans jamais s'arrêter (constaté
  // aussi en test headless), setInterval reste le mécanisme le plus
  // universellement fiable pour ce genre d'animation d'arrière-plan.
  //
  // PAS de pointerdown ici (1er correctif) : un simple pointerdown se
  // déclenche aussi quand le visiteur scrolle verticalement la PAGE avec un
  // doigt qui passe sur la galerie, sans aucune intention d'interagir avec
  // elle, ça mettait en pause en permanence. Seuls la molette horizontale
  // et les flèches sont des interactions non ambiguës ; un vrai glisser
  // horizontal sur la galerie est détecté après coup, via l'écart entre la
  // position qu'on a fixée et scrollLeft réellement observé.
  const signalerInteraction = () => { derniereInteraction = Date.now(); };
  galerie.addEventListener('wheel', signalerInteraction, { passive: true });
  document.querySelectorAll('.preuve-galerie-arrow').forEach(btn => btn.addEventListener('click', signalerInteraction));

  setInterval(() => {
    if (Date.now() - derniereInteraction < PAUSE_APRES_INTERACTION) return;
    const max = galerie.scrollWidth - galerie.clientWidth;
    if (max <= 0) return;
    // Écart avec la position qu'on a fixée nous-mêmes : un vrai geste
    // horizontal de l'utilisateur (glisser la galerie) l'a changée entre
    // deux pas, on se resynchronise dessus ET on considère que c'est une
    // interaction (mise en pause), contrairement à un simple scroll
    // vertical de page qui ne touche jamais scrollLeft.
    if (Math.abs(galerie.scrollLeft - position) > 2) {
      position = galerie.scrollLeft;
      derniereInteraction = Date.now();
      return;
    }
    if (position >= max - 1) direction = -1;
    else if (position <= 1) direction = 1;
    position += PAS * direction;
    galerie.scrollLeft = position;
  }, INTERVALLE);
}

// Filet de sécurité : sur certains navigateurs mobiles, l'autoplay par
// attribut seul (autoplay+muted+playsinline) ne suffit pas toujours à
// déclencher la lecture (retour propriétaire : vidéos restées figées sur
// leur affiche sur iOS Safari). Un appel explicite à .play() juste après le
// chargement force la reprise ; l'erreur est avalée en silence si le
// navigateur bloque quand même l'autoplay, l'affiche reste alors visible.
function forcerLectureVideosExemple() {
  document.querySelectorAll('video.example-video').forEach(v => {
    const tenter = () => v.play().catch(() => {});
    if (v.readyState >= 2) tenter();
    else v.addEventListener('loadeddata', tenter, { once: true });
  });
}

document.addEventListener('DOMContentLoaded', function() {
  demarrerDefilementPreuveGalerie();
  forcerLectureVideosExemple();
  if (unlocked) document.body.classList.add('is-unlocked');
  appliquerClasseAdmin();
  if (typeof verifierBadgeErreursAdmin === 'function') verifierBadgeErreursAdmin();
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
        if (typeof verifierBadgeErreursAdmin === 'function') verifierBadgeErreursAdmin();
      });
    } else {
      localStorage.setItem('scriptura_is_admin', 'false');
      localStorage.setItem('scriptura_illimite', 'false');
    }
  }
  // Rattrape les comptes déjà connectés avant l'ajout du sélecteur multi-
  // comptes (voir assurerCompteActuelConnu, js/auth.js) : sans ça, la flèche
  // de bascule à côté de "Bonjour Prénom" resterait invisible pour ces
  // sessions même après un changement de code réussi vers un 2e compte.
  if (typeof assurerCompteActuelConnu === 'function') assurerCompteActuelConnu();
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
  initScrollReveal();
  initTicker();
  setupIdeaButtons();
  setupStoryButtons();
  setupStoryboardSeulButtons();
  // Boutons cliquables (≤4 choix) d'abord : ils "réservent" leurs <select>
  // via toggleInit avant le balayage général ci-dessous, qui convertirait
  // sinon tout <select> non encore marqué en menu déroulant.
  if (typeof initToggleButtonsAll === 'function') initToggleButtonsAll();
  if (typeof initCustomSelects === 'function') initCustomSelects();
  if (typeof initCustomSelectsWatch === 'function') initCustomSelectsWatch();

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

// js/pwa.js
// Enregistrement du Service Worker, détection des mises à jour,
// et bouton d'installation personnalisé. Chargé en dernier dans
// index.html, après tous les autres js/ pour ne pas retarder le
// premier rendu.

(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  // ───────────────────────────────────────────────────────
  // 1. ENREGISTREMENT
  // ───────────────────────────────────────────────────────
  let registration = null;
  let workerEnAttente = null;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        registration = reg;
        // Vérification périodique : toutes les heures, discrètement.
        // Chrome le fait déjà au reload, mais on couvre les sessions
        // longues (un créateur qui laisse l'app ouverte toute la journée).
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);

        // Une nouvelle version est détectée ? On l'écoute.
        reg.addEventListener('updatefound', () => {
          const nouveau = reg.installing;
          if (!nouveau) return;
          nouveau.addEventListener('statechange', () => {
            // "installed" + un contrôleur actif = une MISE À JOUR
            // (pas une première installation). C'est ce cas qui mérite
            // la bannière.
            if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
              workerEnAttente = nouveau;
              afficherBanniereMaj(nouveau);
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[pwa] Service worker non enregistré :', err);
      });
  });

  // Si un SW est déjà en attente au moment du chargement (cas d'une
  // page rechargée pendant qu'une MAJ attendait), on le retrouve.
  navigator.serviceWorker.ready.then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) {
      workerEnAttente = reg.waiting;
      afficherBanniereMaj(reg.waiting);
    }
  });

  // ───────────────────────────────────────────────────────
  // 2. RECHARGEMENT AUTOMATIQUE au changement de contrôleur
  // ───────────────────────────────────────────────────────
  // Après SKIP_WAITING, le nouveau SW prend le contrôle. On recharge
  // UNE fois pour que tous les assets soient réellement à jour (même
  // logique que ton anti-cache : jamais un mélange ancien/nouveau).
  let rechargementEnCours = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (rechargementEnCours) return;
    rechargementEnCours = true;
    window.location.reload();
  });

  // ───────────────────────────────────────────────────────
  // 3. BANNIÈRE DE MISE À JOUR
  // ───────────────────────────────────────────────────────
  function afficherBanniereMaj(worker) {
    if (document.getElementById('majBanner')) return;

    const b = document.createElement('div');
    b.id = 'majBanner';
    b.className = 'maj-banner';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.innerHTML =
      '<span class="maj-banner-txt">✦ Une nouvelle version de Scriptura est prête.</span>' +
      '<button type="button" class="maj-banner-btn" id="majRechargerBtn">Recharger</button>' +
      '<button type="button" class="maj-banner-close" id="majFermerBtn" aria-label="Plus tard">✕</button>';
    document.body.appendChild(b);

    document.getElementById('majRechargerBtn').addEventListener('click', () => {
      if (workerEnAttente) {
        workerEnAttente.postMessage({ type: 'SKIP_WAITING' });
      }
      b.remove();
      // Le reload se fera via controllerchange ci-dessus.
    });

    // "Plus tard" : on laisse la bannière se refermer, mais le SW
    // reste en attente. Le prochain reload manuel profitera de la MAJ
    // (le navigateur active le worker en attente quand tous les
    // onglets sont fermés, comportement natif).
    document.getElementById('majFermerBtn').addEventListener('click', () => {
      b.remove();
    });
  }

  // ───────────────────────────────────────────────────────
  // 4. BOUTON D'INSTALLATION (beforeinstallprompt)
  // ───────────────────────────────────────────────────────
  // Depuis Chrome 108 (fin 2022), la bannière auto n'existe plus sur
  // Android. Il faut la proposer SOI-MÊME. Le navigateur envoie cet
  // événement quand la PWA est installable (manifeste + SW + HTTPS + un
  // minimum d'engagement utilisateur). On le capture, on stocke, et on
  // affiche notre propre bouton.
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    const btns = document.querySelectorAll('[data-install-app]');
    btns.forEach((btn) => { btn.style.display = 'flex'; });
  });

  // Délégation d'événement : on ne câble pas chaque bouton un par un,
  // on écoute au niveau du document. Ça marche même pour les boutons
  // ajoutés dynamiquement plus tard.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-install-app]');
    if (!btn) return;
    if (!installPrompt) {
      // Le prompt n'est pas dispo (iOS Safari, ou conditions non
      // remplies). On donne la marche à suivre.
      alert(
        'Pour installer Scriptura :\n\n' +
        '• Sur iPhone / iPad : bouton Partager, puis « Sur l\'écran d\'accueil ».\n' +
        '• Sur Android : menu ⋮ du navigateur, puis « Installer l\'application ».\n' +
        '• Sur ordinateur : icône d\'installation dans la barre d\'adresse.'
      );
      return;
    }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    // On cache tous les boutons, quel que soit le choix : le prompt
    // ne peut être appelé qu'UNE fois par session.
    document.querySelectorAll('[data-install-app]').forEach((b) => {
      b.style.display = 'none';
    });
    if (outcome === 'accepted') {
      console.log('[pwa] Installation acceptée.');
    }
  });

  // L'app installée vient d'être lancée ? On n'affiche plus le bouton.
  window.addEventListener('appinstalled', () => {
    document.querySelectorAll('[data-install-app]').forEach((b) => {
      b.style.display = 'none';
    });
    installPrompt = null;
  });
})();

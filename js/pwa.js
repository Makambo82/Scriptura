// js/pwa.js
// Enregistrement du Service Worker, détection des mises à jour,
// et bouton d'installation personnalisé. Chargé en dernier dans
// index.html, après tous les autres js/ pour ne pas retarder le
// premier rendu.

(function () {
  'use strict';

  // Le numéro de version de CE chargement : le ?v= de ce script, le même
  // pour tous les fichiers de index.html (voir l'anti-cache, CLAUDE.md).
  const scriptCourant = document.currentScript;
  const VERSION_LOCALE = ((scriptCourant && scriptCourant.src) || '').match(/[?&]v=([^&#]+)/)?.[1] || null;
  const avecSW = 'serviceWorker' in navigator;

  // ───────────────────────────────────────────────────────
  // 1. ENREGISTREMENT
  // ───────────────────────────────────────────────────────
  let registration = null;
  let workerEnAttente = null;

  if (avecSW) window.addEventListener('load', () => {
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
  if (avecSW) navigator.serviceWorker.ready.then((reg) => {
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
  if (avecSW) navigator.serviceWorker.addEventListener('controllerchange', () => {
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
      b.remove();
      // Un service worker attend : il prend la main, puis controllerchange
      // recharge. Sinon (nouveau déploiement sans changement de sw.js, ou
      // navigateur sans service worker), on recharge nous-mêmes : avant,
      // ce bouton fermait la bannière sans rien recharger dans ce cas.
      if (workerEnAttente) workerEnAttente.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    });

    // "Plus tard" : on laisse la bannière se refermer, mais le SW
    // reste en attente. Le prochain reload manuel profitera de la MAJ
    // (le navigateur active le worker en attente quand tous les
    // onglets sont fermés, comportement natif).
    document.getElementById('majFermerBtn').addEventListener('click', () => {
      versionIgnoree = versionProposee;
      b.remove();
    });
  }

  // ───────────────────────────────────────────────────────
  // 3bis. NOUVEAU DÉPLOIEMENT VERCEL → même bannière
  // ───────────────────────────────────────────────────────
  // Retour propriétaire (18 novembre) : prévenir les créateurs à CHAQUE mise
  // en ligne, pas seulement quand sw.js change. On relit la page en ligne et
  // on compare son ?v= au nôtre : chaque livraison qui touche js/ ou css/ le
  // change (rituel anti-cache, CLAUDE.md). Un déploiement qui ne touche que
  // api/ ne le change pas, et c'est voulu : rien à recharger côté navigateur.
  // Aucune fonction serveur ajoutée (Vercel Hobby plafonne à 12, on y est).
  const INTERVALLE_VERIF_MS = 10 * 60 * 1000;
  let derniereVerif = 0;
  // « Plus tard » sur une version : on ne la repropose plus toutes les 10
  // minutes. Seule une mise en ligne ENCORE plus récente rouvre la bannière.
  let versionProposee = null, versionIgnoree = null;
  async function verifierNouvelleVersion(force) {
    if (!VERSION_LOCALE || document.getElementById('majBanner')) return;
    if (navigator.onLine === false || document.visibilityState === 'hidden') return;
    if (force !== true && Date.now() - derniereVerif < 2 * 60 * 1000) return;
    derniereVerif = Date.now();
    try {
      const r = await fetch('/index.html', { cache: 'no-store' });
      if (!r.ok) return;
      const distante = (await r.text()).match(/js\/pwa\.js\?v=([^"'&]+)/)?.[1];
      if (distante && distante !== VERSION_LOCALE && distante !== versionIgnoree) {
        versionProposee = distante;
        // Le nouveau sw.js éventuel s'installe aussi, sinon un service
        // worker resté ancien servirait encore l'ancienne page hors ligne.
        if (registration) registration.update().catch(() => {});
        afficherBanniereMaj(null);
      }
    } catch (e) { /* réseau capricieux : on réessaiera au prochain passage */ }
  }
  window.addEventListener('load', () => setTimeout(() => verifierNouvelleVersion(false), 60 * 1000));
  setInterval(() => verifierNouvelleVersion(false), INTERVALLE_VERIF_MS);
  document.addEventListener('visibilitychange', () => verifierNouvelleVersion(false));
  window.verifierNouvelleVersion = verifierNouvelleVersion; // tests (voir tests/pwa-nouvelle-version.test.js)

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

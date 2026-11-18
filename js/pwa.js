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
  // en ligne, quel que soit le fichier modifié dans le dépôt. Deux signaux :
  //  1. le ?v= de la page en ligne comparé au nôtre (livraison qui touche
  //     js/ ou css/, rituel anti-cache, CLAUDE.md) ;
  //  2. le SHA du commit déployé (/api/data?resource=version), comparé à
  //     celui vu à l'ouverture : attrape aussi api/, la doc, les tests.
  // Aucune fonction serveur ajoutée (Vercel Hobby plafonne à 12, on y est).
  const INTERVALLE_VERIF_MS = 3 * 60 * 1000;
  const DELAI_MIN_ENTRE_VERIFS_MS = 45 * 1000;
  let derniereVerif = 0;
  // « Plus tard » sur une version : on ne la repropose plus à chaque passage.
  // Seule une mise en ligne ENCORE plus récente rouvre la bannière.
  let versionProposee = null, versionIgnoree = null;
  // Identité du déploiement vu à l'ouverture (SHA du commit, via
  // /api/data?resource=version). Retour propriétaire : prévenir pour N'IMPORTE
  // QUELLE modification du dépôt, pas seulement quand js/ ou css/ changent.
  // null = pas encore connue (ou indisponible : on ne compare alors rien).
  let deploiementLocal = null;
  async function lireDeploiement() {
    try {
      const r = await fetch('/api/data?resource=version', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && j.ok && typeof j.deploiement === 'string' && j.deploiement) || null;
    } catch (e) { return null; }
  }
  async function verifierNouvelleVersion(force) {
    if (!VERSION_LOCALE || document.getElementById('majBanner')) return;
    if (navigator.onLine === false || document.visibilityState === 'hidden') return;
    if (force !== true && Date.now() - derniereVerif < DELAI_MIN_ENTRE_VERIFS_MS) return;
    derniereVerif = Date.now();
    try {
      // « no-cache » et non « no-store » : le navigateur redemande à Vercel
      // avec l'ETag, qui répond 304 (quelques octets) tant que rien n'a
      // changé. Même fraîcheur, pour un coût bien plus faible, ce qui permet
      // de vérifier souvent.
      const [r, deploiement] = await Promise.all([fetch('/index.html', { cache: 'no-cache' }), lireDeploiement()]);
      if (!r.ok) { derniereVerif = 0; return; }
      const distante = (await r.text()).match(/js\/pwa\.js\?v=([^"'&]+)/)?.[1];
      // Première réponse : c'est la version qu'on affiche. Les suivantes sont
      // comparées. (Si la lecture a échoué, on retentera la référence au
      // prochain passage.)
      if (deploiementLocal === null && deploiement) deploiementLocal = deploiement;
      const deploiementChange = !!(deploiement && deploiementLocal && deploiement !== deploiementLocal);
      const cle = (distante || '') + '|' + (deploiement || '');
      const versionChange = !!(distante && distante !== VERSION_LOCALE);
      if ((versionChange || deploiementChange) && cle !== versionIgnoree) {
        versionProposee = cle;
        // Le nouveau sw.js éventuel s'installe aussi, sinon un service
        // worker resté ancien servirait encore l'ancienne page hors ligne.
        if (registration) registration.update().catch(() => {});
        afficherBanniereMaj(null);
      }
    } catch (e) {
      // Réseau pas encore revenu (retour d'une app mise en veille, tunnel) :
      // on ne s'interdit pas de réessayer tout de suite au prochain signal.
      derniereVerif = 0;
    }
  }
  // Référence dès l'ouverture, sans attendre la première vérification : plus
  // elle est prise tôt, moins un déploiement tout juste passé peut passer
  // inaperçu.
  lireDeploiement().then((d) => { if (d && deploiementLocal === null) deploiementLocal = d; });
  // Signaux de vérification : 1 min après l'ouverture, toutes les 3 min,
  // et à CHAQUE retour sur l'app (onglet affiché, app rouverte depuis
  // l'écran d'accueil, réseau revenu, fenêtre reprise). Une app installée
  // dort en arrière-plan : les minuteurs s'y arrêtent, ce sont ces retours
  // qui attrapent la mise en ligne.
  window.addEventListener('load', () => setTimeout(() => verifierNouvelleVersion(false), 60 * 1000));
  setInterval(() => verifierNouvelleVersion(false), INTERVALLE_VERIF_MS);
  document.addEventListener('visibilitychange', () => verifierNouvelleVersion(false));
  window.addEventListener('pageshow', () => verifierNouvelleVersion(false));
  window.addEventListener('online', () => verifierNouvelleVersion(true));
  window.addEventListener('focus', () => verifierNouvelleVersion(false));
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

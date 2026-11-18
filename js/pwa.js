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
    if (delaiInvitationEcoule) proposerInstallation(false);
  });

  // Lance l'installation native (Chrome Android / ordinateur). Le prompt ne
  // peut être appelé qu'UNE fois par session.
  async function lancerInstallation() {
    if (!installPrompt) return false;
    const promptEnCours = installPrompt;
    promptEnCours.prompt();
    const { outcome } = await promptEnCours.userChoice;
    installPrompt = null;
    // On cache tous les boutons, quel que soit le choix.
    document.querySelectorAll('[data-install-app]').forEach((b) => {
      b.style.display = 'none';
    });
    retirerInvitationInstall();
    if (outcome === 'accepted') {
      console.log('[pwa] Installation acceptée.');
    }
    return outcome === 'accepted';
  }

  // Délégation d'événement : on ne câble pas chaque bouton un par un,
  // on écoute au niveau du document. Ça marche même pour les boutons
  // ajoutés dynamiquement plus tard.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-install-app]');
    if (!btn) return;
    if (!installPrompt) {
      // iPhone / iPad : Safari ne propose jamais l'installation, on montre
      // le geste exact à faire (même bulle que l'invitation automatique).
      if (modeIOS) { proposerInstallation(true); return; }
      // Le prompt n'est pas dispo (conditions non remplies). On donne la
      // marche à suivre.
      alert(
        'Pour installer Scriptura :\n\n' +
        '• Sur iPhone / iPad : bouton Partager, puis « Sur l\'écran d\'accueil ».\n' +
        '• Sur Android : menu ⋮ du navigateur, puis « Installer l\'application ».\n' +
        '• Sur ordinateur : icône d\'installation dans la barre d\'adresse.'
      );
      return;
    }
    await lancerInstallation();
  });

  // L'app installée vient d'être lancée ? On n'affiche plus le bouton.
  window.addEventListener('appinstalled', () => {
    document.querySelectorAll('[data-install-app]').forEach((b) => {
      b.style.display = 'none';
    });
    installPrompt = null;
  });

  // ───────────────────────────────────────────────────────
  // 5. INVITATION À INSTALLER (iPhone, Chrome iOS, Chrome Android)
  // ───────────────────────────────────────────────────────
  // Retour propriétaire : rien ne disait aux créateurs qu'une app existe.
  // Chrome Android ne montrait qu'un bouton discret dans le menu, et Safari
  // sur iPhone ne propose JAMAIS l'installation (le bouton restait caché).
  // Une petite bulle, une seule fois par session, après un temps de
  // lecture, jamais si l'app est déjà installée, et une croix qui la
  // ferme pour de bon (le bouton du menu reste là pour y revenir).
  const UA = navigator.userAgent || '';
  const estIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const estAndroid = /Android/i.test(UA);
  // Navigateur intégré d'une autre app (TikTok, Instagram, Facebook...) : c'est
  // par là qu'arrivent les clics « lien en bio ». On ne peut PAS y ajouter à
  // l'écran d'accueil, la consigne serait fausse : on ne propose rien.
  const iosIntegre = estIOS && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(UA) && !(/Safari\//.test(UA) && /Version\//.test(UA));
  const modeIOS = estIOS && !iosIntegre;
  const dejaInstallee = () => {
    try { if (navigator.standalone === true) return true; } catch (e) {}
    try { return window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
  };
  const CLE_INVITATION_FERMEE = 'scriptura_invitation_install_fermee';
  const CLE_INVITATION_VUE = 'scriptura_invitation_install_vue';
  let delaiInvitationEcoule = false;

  function lire(stockage, cle) { try { return window[stockage].getItem(cle); } catch (e) { return null; } }
  function ecrire(stockage, cle, v) { try { window[stockage].setItem(cle, v); } catch (e) {} }

  function retirerInvitationInstall() {
    const b = document.getElementById('installBanner');
    if (b) b.remove();
  }

  // `demande` = true : l'utilisateur a lui-même touché « Installer l'application »,
  // on montre le guide même s'il avait fermé l'invitation automatique.
  function proposerInstallation(demande) {
    if (document.getElementById('installBanner') || dejaInstallee()) return;
    if (!modeIOS && !(estAndroid && installPrompt)) return;
    if (!demande) {
      if (lire('localStorage', CLE_INVITATION_FERMEE) || lire('sessionStorage', CLE_INVITATION_VUE)) return;
      // Jamais par-dessus la bannière de mise à jour : on repasse plus tard.
      if (document.getElementById('majBanner')) { setTimeout(() => proposerInstallation(false), 20 * 1000); return; }
      if (document.visibilityState === 'hidden') return;
    }
    ecrire('sessionStorage', CLE_INVITATION_VUE, '1');

    const b = document.createElement('div');
    b.id = 'installBanner';
    b.className = 'maj-banner install-banner';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    const icoPartager = '<svg class="install-banner-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1"/></svg>';
    b.innerHTML = modeIOS
      ? '<span class="maj-banner-txt">✦ Installe Scriptura sur ton écran d\'accueil : touche ' + icoPartager + ' Partager, puis « Sur l\'écran d\'accueil ».</span>' +
        '<button type="button" class="maj-banner-close" id="installFermerBtn" aria-label="Fermer">✕</button>'
      : '<span class="maj-banner-txt">✦ Installe Scriptura sur ton téléphone pour l\'ouvrir en un geste.</span>' +
        '<button type="button" class="maj-banner-btn" id="installBtn">Installer</button>' +
        '<button type="button" class="maj-banner-close" id="installFermerBtn" aria-label="Plus tard">✕</button>';
    document.body.appendChild(b);

    document.getElementById('installFermerBtn').addEventListener('click', () => {
      ecrire('localStorage', CLE_INVITATION_FERMEE, '1');
      b.remove();
    });
    const installer = document.getElementById('installBtn');
    if (installer) installer.addEventListener('click', () => { lancerInstallation(); });
  }

  // iPhone : le bouton « Installer l'application » du menu et du pied de page
  // reste caché tant qu'on croit que le navigateur ne sait pas installer. Ici
  // il montre le geste à faire, donc on l'affiche (sauf app déjà installée).
  if (modeIOS && !dejaInstallee()) {
    const montrerBoutons = () => document.querySelectorAll('[data-install-app]').forEach((btn) => { btn.style.display = 'flex'; });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montrerBoutons);
    else montrerBoutons();
  }

  // Délai de lecture avant la bulle (réglable pour les tests).
  const DELAI_INVITATION_MS = Number(window.SCRIPTURA_DELAI_INVITATION_MS) >= 0 ? Number(window.SCRIPTURA_DELAI_INVITATION_MS) : 30 * 1000;
  window.addEventListener('load', () => setTimeout(() => {
    delaiInvitationEcoule = true;
    proposerInstallation(false);
  }, DELAI_INVITATION_MS));
})();

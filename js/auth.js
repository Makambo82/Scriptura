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
    // Panne réseau, jamais confondue avec un code réellement invalide (voir
    // `indisponible` déjà renvoyé par le serveur pour une panne Supabase,
    // api/verify-code.js) : basculerVersCompteConnu() ne doit surtout pas
    // oublier un compte valide juste parce que la requête a échoué une fois.
    return { valid: false, isAdmin: false, illimite: false, indisponible: true };
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
  // Mémorise ce compte pour la bascule rapide (bouton "Changer de code
  // d'accès" et flèche à côté de "Bonjour Prénom"), sauf codes admin/VIP :
  // réservés au fondateur/partenaires, pas des "comptes créateur" à faire
  // apparaître dans un sélecteur personnel.
  if (!verdict.isAdmin && !verdict.illimite) memoriserCompteConnu(code, verdict.plan);

  // Recharge systématiquement la page plutôt que de continuer en place :
  // sans ça, le cache de recommandation (avec la salutation et sa flèche de
  // bascule), l'historique déjà affiché, etc. resteraient ceux d'avant cette
  // connexion jusqu'au prochain rechargement naturel. Ancienne version : ne
  // rechargeait que pour un changement de compte explicite (drapeau
  // _modeChangementCompte), mais ce drapeau pouvait être remis à zéro par un
  // clic accidentel sur le fond de la fenêtre (closeModal), laissant alors
  // une connexion « réussie » sans aucun rafraîchissement visible, exactement
  // le symptôme rapporté (bascule de compte sans effet apparent).
  location.reload();
}

// ── COMPTES CONNUS SUR CE NAVIGATEUR (bascule rapide entre codes) ──
// Purement un confort de navigation local, jamais une source de vérité :
// chaque bascule revérifie le compte côté serveur (voir
// basculerVersCompteConnu). Codes admin/VIP jamais mémorisés ici (voir
// verifyCode ci-dessus).
const MAX_COMPTES_CONNUS = 6;

function listerComptesConnus() {
  try {
    const raw = localStorage.getItem('scriptura_comptes_connus');
    const liste = raw ? JSON.parse(raw) : [];
    return Array.isArray(liste) ? liste : [];
  } catch (e) { return []; }
}

// Ajoute/déplace ce code en tête de liste (compte le plus récemment utilisé
// en premier), plafonné à MAX_COMPTES_CONNUS (les plus anciens sortent).
function memoriserCompteConnu(code, plan) {
  try {
    let liste = listerComptesConnus().filter(c => c.code !== code);
    liste.unshift({ code: code, plan: plan || '' });
    if (liste.length > MAX_COMPTES_CONNUS) liste = liste.slice(0, MAX_COMPTES_CONNUS);
    localStorage.setItem('scriptura_comptes_connus', JSON.stringify(liste));
  } catch (e) { /* silencieux : purement un confort de navigation */ }
}

function oublierCompteConnu(code) {
  try {
    const liste = listerComptesConnus().filter(c => c.code !== code);
    localStorage.setItem('scriptura_comptes_connus', JSON.stringify(liste));
  } catch (e) { /* silencieux */ }
}

// Comptes connus SAUF celui actuellement actif (pour la flèche de bascule,
// voir salutationAccueil, js/recommandations.js).
function autresComptesConnus() {
  const actuel = (localStorage.getItem('scriptura_code') || '').trim().toUpperCase();
  return listerComptesConnus().filter(c => c.code !== actuel);
}

// S'assure que le compte ACTUELLEMENT connecté figure dans la liste, appelé
// une fois au chargement (voir js/app.js). memoriserCompteConnu() n'est
// sinon appelée que dans verifyCode()/basculerVersCompteConnu() : un abonné
// déjà connecté avant l'ajout de ce sélecteur (ou reconnecté via un autre
// chemin) n'y figurait jamais, la flèche de bascule restait alors invisible
// même avec un 2e compte réellement connu, faute de savoir que CELUI-CI
// l'était aussi. Sans effet pour un code admin/VIP (jamais mémorisé ici).
function assurerCompteActuelConnu() {
  if (typeof unlocked === 'undefined' || !unlocked) return;
  if (localStorage.getItem('scriptura_is_admin') === 'true' || localStorage.getItem('scriptura_illimite') === 'true') return;
  const code = (localStorage.getItem('scriptura_code') || '').trim().toUpperCase();
  if (!code) return;
  memoriserCompteConnu(code, localStorage.getItem('scriptura_plan') || '');
}

// Bascule directement sur un compte déjà connu sur ce navigateur, sans
// repasser par la saisie manuelle. Revérifie quand même le statut côté
// serveur (l'abonnement a pu expirer ou être désactivé depuis la dernière
// connexion) : jamais une bascule silencieuse vers un compte qui ne marche
// plus, dans ce cas on l'oublie et on rouvre la saisie manuelle, code déjà
// rempli, pour que le message d'erreur habituel explique pourquoi.
async function basculerVersCompteConnu(code) {
  const verdict = await verifierStatutServeur(code);
  // Panne réseau/serveur temporaire (voir verifierStatutServeur) : JAMAIS
  // oublier le compte pour ça, sinon une simple coupure de connexion suffit
  // à effacer un compte parfaitement valide et à faire disparaître la
  // flèche de bascule pour de bon. On laisse tout tel quel et on prévient.
  if (verdict.indisponible) {
    if (typeof toastRegen === 'function') toastRegen('Connexion instable, réessaie dans un instant.');
    return;
  }
  if (!verdict.valid || verdict.jeton) {
    oublierCompteConnu(code);
    openModal();
    const input = document.getElementById('codeInput');
    if (input) input.value = code;
    return;
  }
  unlocked = true;
  localStorage.setItem('scriptura_unlocked', 'true');
  localStorage.setItem('scriptura_code', code);
  if (verdict.expireLe) localStorage.setItem('scriptura_expire', verdict.expireLe);
  else localStorage.removeItem('scriptura_expire');
  localStorage.setItem('scriptura_plan', String(verdict.plan || PLAN_PAR_DEFAUT).trim().toLowerCase());
  if (!verdict.isAdmin && !verdict.illimite) memoriserCompteConnu(code, verdict.plan);
  location.reload();
}


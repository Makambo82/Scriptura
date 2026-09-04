// ═══════════════════════════════════════════════════════════
//  TABLEAU DE BORD, visible uniquement avec le code fondateur (variable
//  d'environnement CODE_ADMIN sur Vercel, voir api/verify-code.js, jamais
//  codé en dur côté client). Fichier
//  INDÉPENDANT : lecture seule sur Supabase, ne modifie aucun mode
//  existant. Chaque bloc de statistique échoue silencieusement (affiche
//  "donnée indisponible") plutôt que de casser le reste du tableau si
//  une table ou une colonne diffère de ce qui est attendu.
//
//  Le statut "en ligne" s'appuie sur la table `presence` (voir
//  supabase/presence.sql et envoyerPresence dans js/app.js) : chaque
//  visiteur, abonné ou non, y signale sa dernière activité pendant que
//  l'onglet est visible à l'écran.
// ═══════════════════════════════════════════════════════════

function ouvrirTableauDeBord() {
  pushNav();
  masquerTousLesEcrans();
  document.getElementById('adminFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
  chargerTableauDeBord();
}

function escAdmin(s) {
  const d = document.createElement('div');
  d.textContent = (s === null || s === undefined) ? '' : String(s);
  return d.innerHTML;
}

function carteStatAdmin(label, valeur, sousTexte) {
  return `<div class="score-card">
    <div class="score-title">${escAdmin(label)}</div>
    <div class="score-global" style="margin-top:10px"><span class="score-global-num">${escAdmin(valeur)}</span></div>
    <div class="ideas-sub" style="margin-top:8px">${escAdmin(sousTexte)}</div>
  </div>`;
}

function carteErreurAdmin(label, e) {
  return carteStatAdmin(label, '·', 'Donnée indisponible (' + (e && e.message ? e.message : 'erreur inconnue') + ')');
}

async function chargerTableauDeBord() {
  const zone = document.getElementById('adminStats');
  if (!zone) return;
  zone.innerHTML = '<div class="ideas-sub">Chargement des statistiques…</div>';
  if (!supabaseClient) { zone.innerHTML = '<div class="ideas-sub">Base de données indisponible.</div>'; return; }

  const [abonnesHTML, modesHTML] = await Promise.all([
    chargerCarteAbonnes(),
    chargerCarteModes()
  ]);

  // Les échecs de génération passent en premier, avant même "Ajouter un
  // abonné" : un problème qui affecte tous les utilisateurs est plus
  // urgent que la gestion courante des abonnés (voir carteErreursAdmin,
  // absente tant qu'il n'y a rien à signaler).
  zone.innerHTML = carteErreursAdmin() + carteCreerAbonne() + carteExpirationsAdmin()
    + carteInactifsAdmin() + abonnesHTML + modesHTML;
  demarrerPollNonAbonnesAdmin();

  // Le fondateur vient de voir le détail des échecs (la carte ci-dessus,
  // en tête) : le badge n'a plus lieu d'être tant qu'aucun NOUVEL échec
  // n'est venu s'ajouter depuis. Voir marquerErreursVues, ci-dessous.
  // UNIQUEMENT si le chargement a réellement réussi (retour d'audit) :
  // sinon une visite où rien n'a pu s'afficher (panne réseau) serait quand
  // même enregistrée comme "vue", et une vraie erreur toute nouvelle,
  // jamais réellement consultée, perdrait son badge rouge pour de bon.
  if (_erreursChargementReussi) {
    marquerErreursVues(_erreursTotal);
    // Marque aussi l'horodatage de cette visite (voir carteErreursAdmin,
    // dernierePriseConnaissanceErreurs) : APRÈS le rendu ci-dessus, jamais
    // avant, sinon les erreurs qu'on vient tout juste de découvrir
    // apparaîtraient déjà dorées au lieu de rouges sur cette même visite.
    marquerErreursVuesLe();
  }
}

// ── Codes qui expirent bientôt (7 prochains jours, ou déjà expirés mais
// encore actifs) : dérivée de _codesAbonnesAdmin, déjà remplie par
// chargerCarteAbonnes() au moment où cette fonction est appelée (voir
// chargerTableauDeBord ci-dessus, appel synchrone après le Promise.all).
// Pas de fetch séparé : `expire_le` est déjà inclus dans la même réponse
// /api/data (resource=admin-stats), voir handleAdminStats, api/data.js.
// Carte volontairement absente (return '') quand rien n'est à signaler,
// plutôt qu'un état vide permanent qui prendrait de la place pour rien.
function carteExpirationsAdmin() {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const seuil = new Date(auj.getTime() + 7 * 24 * 3600 * 1000);
  const bientot = _codesAbonnesAdmin
    .filter(c => c.actif !== false && c.expire_le)
    .map(c => Object.assign({}, c, { dateExpire: parseDateFlexible(c.expire_le) }))
    .filter(c => c.dateExpire && c.dateExpire <= seuil)
    .sort((a, b) => a.dateExpire - b.dateExpire);

  if (!bientot.length) return '';

  const lignes = bientot.map(c => {
    const joursRestants = joursRestantsAvantExpiration(c.expire_le);
    const texte = joursRestants < 0
      ? `Expiré depuis ${Math.abs(joursRestants)} j`
      : (joursRestants === 0 ? 'Expire aujourd\'hui' : `Expire dans ${joursRestants} j`);
    const couleur = joursRestants < 0 ? '#f87171' : 'var(--gold)';
    return `<div class="audit-sujet"><span>${escAdmin(c.code)} · ${escAdmin(c.plan || '·')}</span><b style="color:${couleur}">${texte}</b></div>`;
  }).join('');

  return `<div class="score-card">
    <div class="score-title">Expirent bientôt</div>
    <div class="audit-sujets" style="margin-top:14px">${lignes}</div>
  </div>`;
}

// ── Créer un nouvel abonné Creator/Pro, OU vendre des jetons à l'unité
// (nouveau code pour un non-abonné, ou ajout sur le code d'un abonné déjà
// Creator/Pro), depuis le tableau de bord (voir action=creer-abonne,
// api/data.js). Carte statique, jamais redessinée par chargerTableauDeBord()
// une fois affichée : après création, on met à jour
// _codesAbonnesAdmin/renderAdminListe/majEnteteAbonnesAdmin directement,
// sans recharger tout le tableau, pour ne pas effacer le code généré avant
// que l'abonné ait pu le copier.
let _adminNouveauPlan = 'creator';
// Jeton uniquement : 'nouveau' (visiteur non-abonné, un nouveau code est
// généré) ou 'existant' (abonné déjà Creator/Pro qui achète des jetons en
// plus, additionnés sur SON code, voir api/data.js pour pourquoi jamais une
// ligne séparée).
let _adminJetonMode = 'nouveau';

function carteCreerAbonne() {
  return `<div class="score-card">
    <div class="score-title">Ajouter un abonné</div>
    <div class="btn-grid" style="margin-top:12px">
      <button type="button" class="grid-btn active" id="adminPlanCreator" onclick="choisirPlanNouveauAbonne('creator', this)">Creator</button>
      <button type="button" class="grid-btn" id="adminPlanPro" onclick="choisirPlanNouveauAbonne('pro', this)">Pro</button>
      <button type="button" class="grid-btn" id="adminPlanJeton" onclick="choisirPlanNouveauAbonne('jeton', this)">Jeton</button>
    </div>
    <div id="adminNouveauChamps" style="margin-top:12px">${champsNouveauAbonneHTML()}</div>
    <button type="button" class="btn-generate" style="margin-top:12px;width:100%" onclick="creerAbonneAdmin()" id="adminCreerBtn">${libelleBoutonNouveauAbonne()}</button>
    <div id="adminNouveauResultat" style="display:none;margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px"></div>
  </div>`;
}

// Champs saisis, différents selon le plan choisi (voir carteCreerAbonne) :
// Creator/Pro → prénom seul. Jeton → bascule nouveau code / code existant
// (ce dernier ajoute au solde plutôt que d'en créer un), plus la quantité.
function champsNouveauAbonneHTML() {
  if (_adminNouveauPlan !== 'jeton') {
    return `<input type="text" class="ctx-input" id="adminNouveauPrenom" placeholder="Prénom de l'abonné" maxlength="20" style="text-transform:uppercase"/>`;
  }
  const modeNouveau = _adminJetonMode === 'nouveau';
  return `
    <div class="btn-grid" style="margin-bottom:10px">
      <button type="button" class="grid-btn${modeNouveau ? ' active' : ''}" onclick="choisirJetonMode('nouveau')">Nouveau code</button>
      <button type="button" class="grid-btn${modeNouveau ? '' : ' active'}" onclick="choisirJetonMode('existant')">Code existant</button>
    </div>
    ${modeNouveau
      ? `<input type="text" class="ctx-input" id="adminNouveauPrenom" placeholder="Prénom de l'abonné" maxlength="20" style="text-transform:uppercase"/>`
      : `<input type="text" class="ctx-input" id="adminCodeExistant" placeholder="Code existant, ex : FIFA" maxlength="30" style="text-transform:uppercase"/>`
    }
    <input type="number" class="ctx-input" id="adminJetonQte" min="1" max="50" step="1" value="1" placeholder="Nombre de jetons" style="margin-top:8px"/>`;
}

function libelleBoutonNouveauAbonne() {
  return (_adminNouveauPlan === 'jeton' && _adminJetonMode === 'existant') ? 'Ajouter les jetons' : 'Générer le code d\'accès';
}

function choisirPlanNouveauAbonne(v, btn) {
  _adminNouveauPlan = v;
  const zone = btn.parentElement;
  zone.querySelectorAll('.grid-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const champs = document.getElementById('adminNouveauChamps');
  if (champs) champs.innerHTML = champsNouveauAbonneHTML();
  const bouton = document.getElementById('adminCreerBtn');
  if (bouton) bouton.textContent = libelleBoutonNouveauAbonne();
}

function choisirJetonMode(v) {
  _adminJetonMode = v;
  const champs = document.getElementById('adminNouveauChamps');
  if (champs) champs.innerHTML = champsNouveauAbonneHTML();
  const bouton = document.getElementById('adminCreerBtn');
  if (bouton) bouton.textContent = libelleBoutonNouveauAbonne();
}

async function creerAbonneAdmin() {
  const bouton = document.getElementById('adminCreerBtn');
  const resultat = document.getElementById('adminNouveauResultat');
  const corps = { resource: 'admin-stats', action: 'creer-abonne', code_acces: localStorage.getItem('scriptura_code') || null, plan: _adminNouveauPlan };

  if (_adminNouveauPlan === 'jeton') {
    corps.qte = parseInt(document.getElementById('adminJetonQte')?.value, 10) || 1;
    if (_adminJetonMode === 'existant') {
      const code = (document.getElementById('adminCodeExistant')?.value || '').trim();
      if (!code) { if (typeof toastRegen === 'function') toastRegen('Indique le code existant.'); return; }
      corps.codeExistant = code;
    } else {
      const prenom = (document.getElementById('adminNouveauPrenom')?.value || '').trim();
      if (!prenom) { if (typeof toastRegen === 'function') toastRegen('Indique un prénom avant de générer le code.'); return; }
      corps.prenom = prenom;
    }
  } else {
    const prenom = (document.getElementById('adminNouveauPrenom')?.value || '').trim();
    if (!prenom) { if (typeof toastRegen === 'function') toastRegen('Indique un prénom avant de générer le code.'); return; }
    corps.prenom = prenom;
  }

  bouton.disabled = true;
  bouton.textContent = corps.codeExistant ? 'Ajout…' : 'Génération…';
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps)
    });
    const data = await r.json();
    if (data && data.erreur === 'code_introuvable') {
      if (typeof toastRegen === 'function') toastRegen('Ce code n\'existe pas dans la liste des abonnés.');
      return;
    }
    if (!r.ok || data.indisponible || !data.ok) throw new Error(data?.error?.message || 'opération échouée');
    const codeJs = data.code.replace(/'/g, "\\'");
    resultat.style.display = 'block';
    if (data.existant) {
      // Ajout sur un code déjà présent dans la liste : on met à jour son
      // solde localement plutôt que d'insérer une nouvelle ligne (voir
      // renderAdminListe, aucun doublon de code ne doit apparaître).
      resultat.innerHTML = `<div class="ideas-sub" style="margin-bottom:8px">${escAdmin(data.jetons)} jeton${data.jetons > 1 ? 's' : ''} au total sur ce code</div>
        <div style="display:flex;align-items:center;gap:10px"><b style="font-size:1.05rem;letter-spacing:0.02em">${escAdmin(data.code)}</b></div>`;
      const idx = _codesAbonnesAdmin.findIndex(c => c.code.toUpperCase() === data.code.toUpperCase());
      if (idx !== -1) _codesAbonnesAdmin[idx] = Object.assign({}, _codesAbonnesAdmin[idx], { jetons_audit: data.jetons });
      const champCode = document.getElementById('adminCodeExistant');
      if (champCode) champCode.value = '';
    } else {
      const sousTexte = _adminNouveauPlan === 'jeton'
        ? `Nouveau code Jeton (${escAdmin(data.jetons)} jeton${data.jetons > 1 ? 's' : ''}), sans expiration`
        : `Nouveau code ${escAdmin(data.plan)}, expire le ${escAdmin(data.expireLe)}`;
      resultat.innerHTML = `<div class="ideas-sub" style="margin-bottom:8px">${sousTexte}</div>
        <div style="display:flex;align-items:center;gap:10px">
          <b style="font-size:1.05rem;letter-spacing:0.02em">${escAdmin(data.code)}</b>
          <button type="button" class="grid-btn" onclick="copyText(this, '${codeJs}')">Copier</button>
        </div>`;
      _codesAbonnesAdmin.unshift({ code: data.code, plan: data.plan, actif: true, jetons_audit: data.jetons || 0 });
      renderAdminListe();
      majEnteteAbonnesAdmin();
      const champPrenom = document.getElementById('adminNouveauPrenom');
      if (champPrenom) champPrenom.value = '';
    }
  } catch (e) {
    if (typeof toastRegen === 'function') toastRegen('Impossible de terminer cette opération, réessaie.');
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelleBoutonNouveauAbonne();
  }
}

// ── Abonnés actifs, par formule (comptage exact, via /api/data resource=admin-stats) ──
// La table `abonnes` est verrouillée par RLS (voir supabase/abonnes_rls.sql) :
// le rôle anon (celui du navigateur) n'y a plus aucun accès direct. Ces
// comptes passent donc par une route serveur qui revérifie l'admin
// elle-même (jamais un simple flag localStorage, voir api/admin-stats.js).
// Détail dépliable de la carte "Abonnés actifs" : la liste des codes vient
// de la même réponse /api/data (resource=admin-stats), voir api/data.js.
// Ne contient jamais le fondateur/VIP, ces codes vivent en variables
// d'environnement, jamais dans la table `abonnes`. Recherche + filtre par
// statut/plan, même mécanique que l'historique (ICON_SEARCH/ICON_FILTER,
// .hist-tool-icon/.hist-search/.hist-chips, voir js/historique.js) : deux
// zones séparées (contrôles vs liste) pour que la saisie dans le champ de
// recherche ne réécrive jamais l'input lui-même à chaque frappe (le focus
// serait perdu sinon), seule la liste filtrée se redessine.
let _codesAbonnesAdmin = [];
let _adminSearchOpen = false;
let _adminSearchQuery = '';
let _adminFilterOpen = false;
let _adminPlanFilter = null; // null = tous, sinon 'creator'|'pro'|'jeton'|'desactive'
const ADMIN_PLAN_FILTRE = [
  { v: null, label: 'Tous' },
  { v: 'creator', label: 'Creator' },
  { v: 'pro', label: 'Pro' },
  { v: 'jeton', label: 'Jeton' },
  { v: 'desactive', label: 'Désactivés' }
];

// Statut en ligne/hors ligne par code, à partir de la table `presence`
// (voir supabase/presence.sql). Contrairement à `abonnes`/`generations`,
// `presence` reste en lecture ouverte à la clé publique : lecture directe
// via supabaseClient, pas besoin de passer par /api/data. `ref` == code
// d'accès quand l'abonné est connecté (voir getUserRef, js/api.js), donc
// directement comparable aux codes de la liste. Seuil : 2 minutes
// d'inactivité (mêmes anciennes cartes "En ligne maintenant"/"Actifs 24h"
// retirées du tableau de bord, redondantes avec ce point par code).
// `_presenceStatutInconnu` distingue "vérifié hors ligne" (point rouge) de
// "on n'a pas pu vérifier" (échec réseau/RLS) : un échec silencieux
// affichait un rouge trompeur, indiscernable d'un vrai hors ligne. Voir
// .admin-dot-inconnu (css/style.css).
let _presenceParCode = {};
let _presenceStatutInconnu = false;
async function chargerPresenceAdmin(codes) {
  if (!codes.length) return;
  if (!supabaseClient) { _presenceStatutInconnu = true; return; }
  try {
    const seuil = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data, error } = await supabaseClient.from('presence').select('ref, derniere_activite').in('ref', codes);
    if (error) throw error;
    const parCode = {};
    (data || []).forEach(row => { parCode[row.ref] = row.derniere_activite >= seuil; });
    _presenceParCode = parCode;
    _presenceStatutInconnu = false;
  } catch (e) {
    console.warn('Statut en ligne des abonnés indisponible (table presence) :', e);
    _presenceStatutInconnu = true;
  }
}

// Non-abonnés EN LIGNE MAINTENANT (retour propriétaire) : même mécanique
// que le point vert/rouge des abonnés (table `presence`, seuil 2 minutes),
// mais un simple compte plutôt qu'une liste, un identifiant anonyme
// (anon_<horodatage>_<alea>, voir getUserRef, js/api.js) n'a rien de
// lisible à afficher un par un. `abonne=false` couvre déjà tous les
// visiteurs sans code_acces (voir envoyerPresence, js/app.js, qui envoie
// abonne:!!unlocked pour CHAQUE visiteur, pas seulement les abonnés).
// null = indisponible (RLS/réseau), distinct de 0 vrai, jamais affiché
// comme un zéro trompeur.
async function compterNonAbonnesEnLigne() {
  if (!supabaseClient) return null;
  try {
    const seuil = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count, error } = await supabaseClient
      .from('presence')
      .select('ref', { count: 'exact', head: true })
      .eq('abonne', false)
      .gte('derniere_activite', seuil);
    if (error) throw error;
    return typeof count === 'number' ? count : null;
  } catch (e) {
    console.warn('Non-abonnés en ligne indisponible (table presence) :', e);
    return null;
  }
}

async function chargerCarteAbonnes() {
  try {
    const [r, nonAbonnesEnLigne] = await Promise.all([
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'admin-stats', code_acces: localStorage.getItem('scriptura_code') || null })
      }),
      compterNonAbonnesEnLigne()
    ]);
    const data = await r.json();
    if (!r.ok || data.indisponible) throw new Error(data?.error?.message || 'donnée indisponible');
    _codesAbonnesAdmin = Array.isArray(data.codes) ? data.codes : [];
    _adminSearchOpen = false; _adminSearchQuery = ''; _adminFilterOpen = false; _adminPlanFilter = null;
    // Zone SÉPARÉE du clic vers la liste des abonnés (retour propriétaire :
    // cliquer sur "N non-abonnés en ligne" ouvrait la liste des abonnés par
    // erreur, les deux zones cliquables étaient confondues dans le même
    // div). Son propre détail dépliable, voir toggleListeNonAbonnesAdmin.
    const blocNonAbonnes = nonAbonnesEnLigne != null
      ? `<div style="margin-top:14px;border-top:1px solid var(--border-soft);padding-top:12px;cursor:pointer" onclick="toggleListeNonAbonnesAdmin()">
          <div class="ideas-sub" id="adminNonAbonnesEnLigne">${escAdmin(String(nonAbonnesEnLigne))} non-abonné${nonAbonnesEnLigne > 1 ? 's' : ''} en ligne maintenant</div>
          <div class="ideas-sub" style="margin-top:6px;opacity:0.6" id="listeNonAbonnesAdminHint">Touche pour voir le détail (pays · navigateur) ↓</div>
        </div>
        <div id="listeNonAbonnesAdmin" style="display:none;margin-top:10px"></div>`
      : '';
    return `<div class="score-card">
      <div onclick="toggleListeAbonnesAdmin()" style="cursor:pointer">
        <div class="score-title">Abonnés actifs</div>
        <div class="score-global" style="margin-top:10px"><span class="score-global-num" id="adminAbonnesCount">${escAdmin(_codesAbonnesAdmin.filter(c => c.actif !== false).length)}</span></div>
        <div class="ideas-sub" style="margin-top:8px" id="adminAbonnesSousTexte">${escAdmin(sousTexteAbonnesAdmin())}</div>
        <div class="ideas-sub" style="margin-top:6px;opacity:0.6" id="listeAbonnesAdminHint">Touche pour voir le détail des codes ↓</div>
      </div>
      <div id="listeAbonnesAdmin" style="display:none;margin-top:14px;border-top:1px solid var(--border-soft);padding-top:12px">
        <div id="listeAbonnesAdminControles"></div>
        <div id="listeAbonnesAdminList" style="border-top:1px solid var(--border-soft);padding-top:10px"></div>
      </div>
      ${blocNonAbonnes}
    </div>`;
  } catch (e) {
    return carteErreurAdmin('Abonnés actifs', e);
  }
}

// Codes pays (x-vercel-ip-country) -> libellé lisible. Couvre la
// francophonie d'Afrique de l'Ouest/Centrale (public visé par Scriptura)
// + quelques pays fréquents ; un code absent de cette liste s'affiche tel
// quel plutôt que de planter.
const PAYS_NOMS_ADMIN = {
  CI: "Côte d'Ivoire", SN: 'Sénégal', CM: 'Cameroun', BJ: 'Bénin', TG: 'Togo',
  ML: 'Mali', BF: 'Burkina Faso', NE: 'Niger', GN: 'Guinée', CD: 'RD Congo',
  CG: 'Congo', GA: 'Gabon', MG: 'Madagascar', TD: 'Tchad', MR: 'Mauritanie',
  MA: 'Maroc', DZ: 'Algérie', TN: 'Tunisie', FR: 'France', BE: 'Belgique',
  CH: 'Suisse', CA: 'Canada', US: 'États-Unis', GB: 'Royaume-Uni'
};
function libellePaysAdmin(code) {
  if (!code) return 'Pays inconnu';
  return PAYS_NOMS_ADMIN[code] || code;
}

// Détail des non-abonnés en ligne : pays + navigateur, JAMAIS d'IP (voir
// PRESENCE_URL/handlePresence, api/data.js, décision propriétaire). Un
// identifiant anonyme n'a rien de lisible à afficher un par un, les
// combinaisons identiques (pays · navigateur) sont regroupées et comptées
// plutôt qu'une liste à plat.
async function chargerDetailNonAbonnesAdmin() {
  if (!supabaseClient) return '<div class="ideas-sub">Détail indisponible.</div>';
  try {
    const seuil = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data, error } = await supabaseClient
      .from('presence')
      .select('pays,navigateur')
      .eq('abonne', false)
      .gte('derniere_activite', seuil)
      .limit(300);
    if (error) throw error;
    if (!data || !data.length) return '<div class="ideas-sub">Aucun non-abonné en ligne actuellement.</div>';
    const compte = {};
    data.forEach(row => {
      const cle = libellePaysAdmin(row.pays) + ' · ' + (row.navigateur || 'Navigateur inconnu');
      compte[cle] = (compte[cle] || 0) + 1;
    });
    return Object.entries(compte)
      .sort((a, b) => b[1] - a[1])
      .map(([cle, n]) => `<div class="admin-nonabonnes-row"><span>${escAdmin(cle)}</span><span>${n}</span></div>`)
      .join('');
  } catch (e) {
    return '<div class="ideas-sub">Détail indisponible.</div>';
  }
}

async function toggleListeNonAbonnesAdmin() {
  const el = document.getElementById('listeNonAbonnesAdmin');
  const hint = document.getElementById('listeNonAbonnesAdminHint');
  if (!el) return;
  const ouvert = el.style.display !== 'none';
  el.style.display = ouvert ? 'none' : 'block';
  if (!ouvert) {
    el.innerHTML = '<div class="ideas-sub">Chargement…</div>';
    el.innerHTML = await chargerDetailNonAbonnesAdmin();
  }
  if (hint) hint.textContent = ouvert ? 'Touche pour voir le détail (pays · navigateur) ↓' : 'Touche pour masquer ↑';
}

async function toggleListeAbonnesAdmin() {
  const el = document.getElementById('listeAbonnesAdmin');
  const hint = document.getElementById('listeAbonnesAdminHint');
  if (!el) return;
  const ouvert = el.style.display !== 'none';
  el.style.display = ouvert ? 'none' : 'block';
  if (!ouvert) {
    renderAdminControles();
    renderAdminListe();
    // Statut en ligne chargé après le premier affichage (ne bloque pas
    // l'ouverture du panneau), puis la liste est redessinée avec les points.
    const codesUniques = Array.from(new Set(_codesAbonnesAdmin.map(c => c.code)));
    await chargerPresenceAdmin(codesUniques);
    renderAdminListe();
    demarrerPollPresenceAdmin();
  } else {
    arreterPollPresenceAdmin();
  }
  if (hint) hint.textContent = ouvert ? 'Touche pour voir le détail des codes ↓' : 'Touche pour masquer ↑';
}

// Rafraîchit le statut en ligne toutes les 10s tant que le panneau est
// ouvert, pour voir un abonné se connecter sans recharger la page (les
// clients signalent leur présence toutes les 60s au plus, voir
// envoyerPresence dans js/app.js : 10s suffit largement à le voir passer
// au vert). S'arrête tout seul dès que le panneau ou l'écran admin
// disparaît (retour arrière, changement d'écran), pas besoin d'un
// crochet séparé sur la navigation. (Retour propriétaire : 20s -> 10s.)
let _presencePollInterval = null;
function arreterPollPresenceAdmin() {
  if (_presencePollInterval) { clearInterval(_presencePollInterval); _presencePollInterval = null; }
}
function demarrerPollPresenceAdmin() {
  arreterPollPresenceAdmin();
  _presencePollInterval = setInterval(async () => {
    const panneau = document.getElementById('listeAbonnesAdmin');
    const ecranAdmin = document.getElementById('adminFlow');
    if (!panneau || panneau.style.display === 'none' || !ecranAdmin || ecranAdmin.style.display === 'none') {
      arreterPollPresenceAdmin();
      return;
    }
    const codesUniques = Array.from(new Set(_codesAbonnesAdmin.map(c => c.code)));
    await chargerPresenceAdmin(codesUniques);
    renderAdminListe();
  }, 10000);
}

// Rafraîchit le nombre de non-abonnés en ligne toutes les 10s tant que le
// tableau de bord est ouvert (retour propriétaire : voir un non-abonné
// ouvrir l'app en direct, sans recharger). Contrairement au poll des
// abonnés ci-dessus, pas besoin que le détail soit déplié : le nombre est
// visible dès l'ouverture du tableau de bord. Met juste le texte à jour en
// place (jamais un nouveau rendu de toute la carte, qui refermerait un
// panneau de détail déjà ouvert). S'arrête tout seul dès que l'écran admin
// disparaît.
let _nonAbonnesPollInterval = null;
function arreterPollNonAbonnesAdmin() {
  if (_nonAbonnesPollInterval) { clearInterval(_nonAbonnesPollInterval); _nonAbonnesPollInterval = null; }
}
function demarrerPollNonAbonnesAdmin() {
  arreterPollNonAbonnesAdmin();
  _nonAbonnesPollInterval = setInterval(async () => {
    const ecranAdmin = document.getElementById('adminFlow');
    const ligne = document.getElementById('adminNonAbonnesEnLigne');
    if (!ecranAdmin || ecranAdmin.style.display === 'none' || !ligne) {
      arreterPollNonAbonnesAdmin();
      return;
    }
    const n = await compterNonAbonnesEnLigne();
    if (n != null) ligne.textContent = `${n} non-abonné${n > 1 ? 's' : ''} en ligne maintenant`;
  }, 10000);
}

function filtrerCodesAdmin() {
  let liste = _codesAbonnesAdmin;
  if (_adminPlanFilter === 'desactive') liste = liste.filter(c => c.actif === false);
  else if (_adminPlanFilter) liste = liste.filter(c => (c.plan || '') === _adminPlanFilter);
  if (_adminSearchQuery.trim()) {
    const q = _adminSearchQuery.trim().toUpperCase();
    liste = liste.filter(c => (c.code || '').toUpperCase().includes(q));
  }
  // Pro en tête, puis Creator, puis le reste (jeton...) : retour propriétaire,
  // tri stable (ne touche pas à l'ordre relatif à l'intérieur d'un même plan).
  const rangPlanAdmin = { pro: 0, creator: 1 };
  liste = liste
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ra = rangPlanAdmin[a.c.plan] ?? 2, rb = rangPlanAdmin[b.c.plan] ?? 2;
      return ra !== rb ? ra - rb : a.i - b.i;
    })
    .map(x => x.c);
  // Épingle le code fondateur en tête, quels que soient le tri/la recherche/
  // le filtre en cours. Seul le fondateur (body.is-admin, voir
  // css/style.css) accède à ce tableau de bord : le code utilisé pour se
  // connecter ICI est donc forcément le sien, pas besoin de le distinguer
  // autrement.
  const codeFondateur = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  if (codeFondateur) {
    const idx = liste.findIndex(c => (c.code || '').toUpperCase() === codeFondateur);
    if (idx > 0) liste = [liste[idx], ...liste.slice(0, idx), ...liste.slice(idx + 1)];
  }
  return liste;
}

// Icônes + champ de recherche/puces de filtre : redessinés uniquement à
// l'ouverture ou quand on bascule recherche/filtre, jamais à chaque frappe.
function renderAdminControles() {
  const zone = document.getElementById('listeAbonnesAdminControles');
  if (!zone) return;
  let html = `<div style="display:flex;gap:8px;margin-bottom:10px">
    <button class="hist-tool-icon${(_adminSearchOpen || _adminSearchQuery) ? ' actif' : ''}" onclick="toggleAdminSearch()" title="Rechercher un code" aria-label="Rechercher un code">${ICON_SEARCH}</button>
    <button class="hist-tool-icon${(_adminPlanFilter || _adminFilterOpen) ? ' actif' : ''}" onclick="toggleAdminFilterMenu()" title="Filtrer" aria-label="Filtrer">${ICON_FILTER}</button>
  </div>`;
  if (_adminSearchOpen) {
    html += `<div class="hist-search" style="margin-bottom:10px"><span class="hist-search-ico">${ICON_SEARCH}</span>
      <input type="text" id="adminSearchInput" class="hist-search-input" placeholder="Rechercher un code…" value="${escAdmin(_adminSearchQuery)}" oninput="onAdminSearch(this.value)"/>
      ${_adminSearchQuery ? '<button class="hist-search-clear" onclick="clearAdminSearch()" aria-label="Effacer">✕</button>' : ''}
    </div>`;
  }
  if (_adminFilterOpen) {
    html += '<div class="hist-chips" style="margin-bottom:10px">' + ADMIN_PLAN_FILTRE.map(m => {
      const arg = m.v ? ("'" + m.v + "'") : 'null';
      return '<button class="hist-chip' + (_adminPlanFilter === m.v ? ' actif' : '') + '" onclick="setAdminPlanFilter(' + arg + ')">' + m.label + '</button>';
    }).join('') + '</div>';
  }
  zone.innerHTML = html;
}

// Libellé du plan affiché sur chaque ligne (voir renderAdminListe) :
// "creator"/"pro"/"jeton" (valeurs brutes stockées) → première lettre en
// majuscule. Le code fondateur ne passe jamais par ici, il affiche
// "Fondateur" directement (voir renderAdminListe).
function capitaliserPlanAdmin(plan) {
  if (!plan) return '·';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// Icône cadenas (même dessin que .ds-note-ico, index.html) : remplace
// l'interrupteur actif/désactivé sur la ligne du code fondateur (voir
// renderAdminListe), pour qu'il ne puisse pas être désactivé par erreur.
const ICON_CADENAS_FONDATEUR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>';

function renderAdminListe() {
  const zone = document.getElementById('listeAbonnesAdminList');
  if (!zone) return;
  const liste = filtrerCodesAdmin();
  const codeFondateur = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  zone.innerHTML = liste.length
    ? liste.map((c, i) => {
        const codeJs = c.code.replace(/'/g, "\\'");
        const enLigne = !!_presenceParCode[c.code];
        const classeDot = _presenceStatutInconnu ? 'admin-dot-inconnu' : (enLigne ? 'social-dot' : 'admin-dot-off');
        const titreDot = _presenceStatutInconnu ? 'Statut indisponible' : (enLigne ? 'En ligne' : 'Hors ligne');
        const estFondateur = codeFondateur && c.code.toUpperCase() === codeFondateur;
        // Le code fondateur n'a pas d'interrupteur : le désactiver par erreur
        // n'a aucun effet réel sur son accès (l'admin passe par CODE_ADMIN,
        // jamais par cette ligne Supabase), mais c'est trompeur et risqué à
        // laisser cliquable.
        const controleActif = estFondateur
          ? `<span style="display:flex;align-items:center;gap:5px;color:var(--gold);opacity:0.85" title="Le code fondateur ne se désactive pas ici">${ICON_CADENAS_FONDATEUR}</span>`
          : `<label class="admin-switch" title="${c.actif === false ? 'Réactiver' : 'Désactiver'}">
              <input type="checkbox" ${c.actif === false ? '' : 'checked'} onchange="toggleActifAbonneAdmin('${codeJs}', this.checked)"/>
              <span class="admin-switch-track"></span>
            </label>`;
        // Supprimer : uniquement pour un code déjà désactivé (jamais le
        // fondateur, jamais un abonné encore actif) — le serveur refuse de
        // toute façon (voir action=supprimer-abonne, api/data.js), ce
        // bouton reste un filet visuel, pas la seule protection.
        const boutonSupprimer = (!estFondateur && c.actif === false)
          ? `<button type="button" class="history-delete" onclick="supprimerAbonneAdmin('${codeJs}')" title="Supprimer définitivement" aria-label="Supprimer définitivement">${ICON_DELETE}</button>`
          : '';
        return `<div>
        <div class="audit-sujet">
          <span style="display:flex;align-items:center">
            <span class="${classeDot}" style="margin-right:8px" title="${titreDot}"></span>
            <span class="admin-code-clic" onclick="toggleGenerationsParCode('${codeJs}', ${i})" title="Voir ses générations par mode">${escAdmin(c.code)}${c.actif === false ? ' · désactivé' : ''}</span>
          </span>
          <span style="display:flex;align-items:center;gap:10px">
            <b>${escAdmin(estFondateur ? 'Fondateur' : capitaliserPlanAdmin(c.plan))}</b>
            ${controleActif}
            ${boutonSupprimer}
          </span>
        </div>
        <div id="genParCode-${i}" class="admin-gen-detail" style="display:none"></div>
      </div>`;
      }).join('')
    : '<div class="ideas-sub">Aucun code ne correspond.</div>';
}

// Détail des générations par mode d'un code précis, affiché/masqué au clic
// sur son texte (voir handleAdminStats, action=generations-par-code,
// api/data.js). `i` (position dans la liste actuellement affichée, pas le
// code lui-même) sert d'identifiant DOM : deux codes identiques peuvent
// exister dans la table (ex. un abonnement Creator et un jeton sur le même
// code, déjà vu en usage réel), un id basé sur le code collisionnerait.
async function toggleGenerationsParCode(code, i) {
  const el = document.getElementById('genParCode-' + i);
  if (!el) return;
  const ouvert = el.style.display !== 'none';
  if (ouvert) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div class="ideas-sub">Chargement…</div>';
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', action: 'generations-par-code', code_acces: localStorage.getItem('scriptura_code') || null, code })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible) throw new Error('donnée indisponible');
    const parMode = data.parMode || {};
    const lignes = Object.entries(parMode)
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `<div class="audit-sujet"><span>${escAdmin(m)}</span><b>${n}</b></div>`)
      .join('') || '<div class="ideas-sub">Aucune génération pour ce code.</div>';
    el.innerHTML = '<div class="ideas-sub" style="margin-bottom:4px;opacity:0.7">Générations par mode (tous les temps)</div>' + lignes;
  } catch (e) {
    el.innerHTML = '<div class="ideas-sub">Donnée indisponible.</div>';
  }
}

// Résumé sous le compteur "Abonnés actifs", recalculé depuis
// _codesAbonnesAdmin (jamais depuis les compteurs serveur d'origine) pour
// rester juste après une bascule actif/inactif locale.
function sousTexteAbonnesAdmin() {
  const total = _codesAbonnesAdmin.length;
  const actifs = _codesAbonnesAdmin.filter(c => c.actif !== false);
  const creator = actifs.filter(c => c.plan === 'creator').length;
  const pro = actifs.filter(c => c.plan === 'pro').length;
  return total + ' au total (actifs + désactivés) · ' + creator + ' Creator · ' + pro + ' Pro';
}

function majEnteteAbonnesAdmin() {
  const num = document.getElementById('adminAbonnesCount');
  const sous = document.getElementById('adminAbonnesSousTexte');
  if (num) num.textContent = _codesAbonnesAdmin.filter(c => c.actif !== false).length;
  if (sous) sous.textContent = sousTexteAbonnesAdmin();
}

// Interrupteur actif/inactif d'un code (voir handleAdminStats,
// action=toggle-actif, api/data.js). Effet immédiat, pas de confirmation :
// en cas d'échec, l'interrupteur revient à son état réel plutôt que de
// rester sur un état qui n'a jamais été réellement appliqué côté serveur.
async function toggleActifAbonneAdmin(code, actif) {
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', action: 'toggle-actif', code_acces: localStorage.getItem('scriptura_code') || null, code, actif })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible || !data.ok) throw new Error('échec de la mise à jour');
    const ligne = _codesAbonnesAdmin.find(c => c.code === code);
    if (ligne) ligne.actif = actif;
  } catch (e) {
    if (typeof toastRegen === 'function') toastRegen('Impossible de mettre à jour ce code, réessaie.');
  } finally {
    // Redessine toujours : reflète soit le nouvel état (succès), soit l'état
    // réel inchangé (échec), jamais l'état optimiste coché par l'utilisateur.
    renderAdminListe();
    majEnteteAbonnesAdmin();
  }
}

// Suppression DÉFINITIVE d'un code désactivé (retour propriétaire : "je
// dois le faire moi-même dans Supabase ?" → non, un bouton dans l'app).
// Confirmation obligatoire (même formule que js/historique.js, deleteOne) :
// irréversible, contrairement à la désactivation qui se rebascule d'un
// clic. Le serveur refuse de toute façon un code encore actif (voir
// action=supprimer-abonne, api/data.js), ce bouton n'est de toute façon
// affiché QUE pour les codes déjà désactivés (voir renderAdminListe).
async function supprimerAbonneAdmin(code) {
  if (!confirm('Supprimer définitivement le code « ' + code + ' » ?\n\nCette action est définitive, contrairement à la désactivation.')) return;
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', action: 'supprimer-abonne', code_acces: localStorage.getItem('scriptura_code') || null, code })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible || !data.ok) {
      if (typeof toastRegen === 'function') toastRegen(data && data.erreur === 'rien_a_supprimer' ? 'Ce code est introuvable ou encore actif.' : 'Impossible de supprimer ce code, réessaie.');
      return;
    }
    _codesAbonnesAdmin = _codesAbonnesAdmin.filter(c => c.code !== code);
    renderAdminListe();
    majEnteteAbonnesAdmin();
  } catch (e) {
    if (typeof toastRegen === 'function') toastRegen('Impossible de supprimer ce code, réessaie.');
  }
}

function toggleAdminSearch() {
  _adminSearchOpen = !_adminSearchOpen;
  if (_adminSearchOpen) _adminFilterOpen = false; else _adminSearchQuery = '';
  renderAdminControles();
  renderAdminListe();
  if (_adminSearchOpen) { const inp = document.getElementById('adminSearchInput'); if (inp) inp.focus(); }
}

function onAdminSearch(val) {
  _adminSearchQuery = val;
  renderAdminListe();
}

function clearAdminSearch() {
  _adminSearchQuery = '';
  renderAdminControles();
  renderAdminListe();
  const inp = document.getElementById('adminSearchInput');
  if (inp) inp.focus();
}

function toggleAdminFilterMenu() {
  _adminFilterOpen = !_adminFilterOpen;
  if (_adminFilterOpen) _adminSearchOpen = false;
  renderAdminControles();
  renderAdminListe();
}

function setAdminPlanFilter(v) {
  _adminPlanFilter = (_adminPlanFilter === v) ? null : v;
  renderAdminControles();
  renderAdminListe();
}

// ── Répartition des générations par mode sur 30 jours, via /api/data resource=admin-stats ──
// La table `generations` est verrouillée par RLS (voir
// supabase/generations_series_rls.sql) : passe désormais par la même route
// serveur (revérifie l'admin elle-même) que chargerCarteAbonnes.
// Alimentés par chargerCarteModes() ci-dessous (même réponse /api/data que
// parMode) : lus ensuite par carteInactifsAdmin()/carteErreursAdmin(),
// appelées de façon synchrone une fois le Promise.all de
// chargerTableauDeBord() résolu (voir plus haut dans ce fichier).
// Libellés lisibles des modes (voir chargerCarteModes ci-dessous) : mêmes
// clés que saveGeneration (js/historique.js), mêmes noms publics que les
// boutons de l'accueil (index.html) quand ils existent, pour rester
// cohérent avec ce que voit un créateur ailleurs dans l'app.
const MODE_LABELS_ADMIN = {
  ideas: 'Idées', script: 'Script', story: 'Récit', serie: 'Série',
  audit: 'Diagnostic complet', diagnosticSommaire: 'Diagnostic sommaire',
  storyboardSeul: 'Storyboard seul', tendances: 'Tendances', analyseVirale: 'Analyse vidéo'
};
let _codesActifsRecents = new Set();
let _erreursParMode = {};
let _erreursTotal = 0;
let _erreursRecentes = [];
// true seulement si le DERNIER chargement a réellement réussi (voir
// chargerTableauDeBord ci-dessous, retour d'audit) : marquerErreursVues/
// marquerErreursVuesLe ne doivent jamais s'exécuter après une visite où le
// fondateur n'a en réalité rien pu voir, sous peine de marquer "vue" une
// erreur toute nouvelle qu'il n'a en fait jamais consultée.
let _erreursChargementReussi = false;

async function chargerCarteModes() {
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible) throw new Error(data?.error?.message || 'donnée indisponible');
    _codesActifsRecents = new Set(Array.isArray(data.codesActifsRecents) ? data.codesActifsRecents : []);
    _erreursParMode = data.erreursParMode || {};
    _erreursTotal = data.erreursTotal || 0;
    _erreursRecentes = Array.isArray(data.erreursRecentes) ? data.erreursRecentes : [];
    _erreursChargementReussi = true;
    // Scindé par plan (Fondateur/Pro/Creator/Non-abonné, voir parModePlan,
    // api/data.js) pour voir ce qui pousse réellement à l'upgrade, plutôt
    // qu'un simple total tous plans confondus. Non-abonné = quota gratuit
    // anonyme (aucun code_acces). Jeton/VIP hors de cette comparaison (voir
    // le commentaire serveur). Colonnes alignées (grille), pas une ligne de
    // texte par plan : plus lisible pour comparer un mode à l'autre d'un
    // coup d'œil.
    const parModePlan = data.parModePlan || { fondateur: {}, pro: {}, creator: {}, nonAbonne: {} };
    const modes = Array.from(new Set([
      ...Object.keys(parModePlan.fondateur || {}),
      ...Object.keys(parModePlan.pro || {}),
      ...Object.keys(parModePlan.creator || {}),
      ...Object.keys(parModePlan.nonAbonne || {})
    ]));
    // Libellé lisible : les clés internes (voir saveGeneration,
    // js/historique.js) sont en camelCase technique, jamais montrées telles
    // quelles (retour propriétaire : "diagnosticSommaire"/"analyseVirale"
    // collés, illisibles). Retombe sur une majuscule initiale pour un mode
    // qui n'existerait pas encore dans cette liste, plutôt que planter.
    const majusculeInitiale = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const libelleMode = (m) => MODE_LABELS_ADMIN[m] || majusculeInitiale(m);
    const lignes = modes
      .map(m => ({
        m,
        fondateur: (parModePlan.fondateur || {})[m] || 0,
        pro: (parModePlan.pro || {})[m] || 0,
        creator: (parModePlan.creator || {})[m] || 0,
        nonAbonne: (parModePlan.nonAbonne || {})[m] || 0
      }))
      .sort((a, b) => (b.fondateur + b.pro + b.creator + b.nonAbonne) - (a.fondateur + a.pro + a.creator + a.nonAbonne))
      .map(r => `<div class="admin-modes-row"><span>${escAdmin(libelleMode(r.m))}</span><span>${r.fondateur}</span><span>${r.pro}</span><span>${r.creator}</span><span>${r.nonAbonne}</span></div>`)
      .join('') || '<div class="ideas-sub">Aucune génération sur cette période.</div>';
    // Enveloppe scrollable (retour propriétaire : la colonne "Non-abonné"
    // sortait de l'écran sans aucun moyen de la voir sur certains
    // navigateurs mobiles) : on ne réduit plus la largeur des colonnes,
    // on laisse glisser le tableau à l'horizontale à la place.
    return `<div class="score-card">
      <div class="score-title">GÉNÉRATIONS PAR MODE · 30 JOURS</div>
      <div class="admin-modes-scroll" style="margin-top:14px">
        <div class="admin-modes-table">
          <div class="admin-modes-header"><span></span><span>Fondateur</span><span>Pro</span><span>Creator</span><span>Non-abonné</span></div>
          ${lignes}
        </div>
      </div>
    </div>`;
  } catch (e) {
    // Retour d'audit : remettre _erreursTotal/_erreursParMode/_erreursRecentes
    // à zéro ici faisait DISPARAÎTRE silencieusement la carte d'alerte
    // "Échecs de génération" (carteErreursAdmin, if (!_erreursTotal) return
    // '') à la moindre panne réseau de CETTE requête, alors même que de
    // vrais échecs récents avaient pu être chargés lors d'une visite
    // précédente. On garde le dernier état connu (même filet que le reste :
    // jamais confondre "panne" et "rien à signaler") ; seule cette carte
    // "Générations par mode" affiche l'erreur de chargement. Même logique
    // pour _codesActifsRecents (carteInactifsAdmin) : la remettre à vide
    // ferait passer TOUS les abonnés pour inactifs depuis 14 jours à tort.
    _erreursChargementReussi = false;
    return carteErreurAdmin('Générations par mode · 30 jours', e);
  }
}

// ── Abonnés inactifs : actifs mais sans génération dans les 14 derniers
// jours (voir codesActifsRecents ci-dessus). Signal de désabonnement à
// venir, à recontacter avant qu'ils partent. Absente si rien à signaler.
function carteInactifsAdmin() {
  const inactifs = _codesAbonnesAdmin.filter(c => c.actif !== false && !_codesActifsRecents.has(c.code));
  if (!inactifs.length) return '';
  const lignes = inactifs
    .map(c => `<div class="audit-sujet"><span>${escAdmin(c.code)} · ${escAdmin(c.plan || '·')}</span><b style="color:var(--text-secondary);font-weight:400">Inactif depuis 14 j</b></div>`)
    .join('');
  return `<div class="score-card">
    <div class="score-title">Abonnés inactifs</div>
    <div class="audit-sujets" style="margin-top:14px">${lignes}</div>
  </div>`;
}

// ── Échecs de génération, 7 derniers jours (voir le journal côté client
// dans callAI, js/api.js, et supabase/erreurs_generation.sql, à exécuter
// par le propriétaire). Absente tant qu'aucun échec n'est enregistré (soit
// tout va bien, soit la table n'existe pas encore, indiscernable ici et
// sans conséquence : rien à signaler dans les deux cas). Placée en tête du
// tableau de bord (voir chargerTableauDeBord) et stylée en alerte
// (.score-card-alerte, css/style.css), pour ne jamais se fondre parmi les
// cartes de statistique neutres : voir aussi verifierBadgeErreursAdmin,
// qui signale la même chose avant même d'ouvrir ce tableau.
// Libellés lisibles pour les modes journalisés (voir `contexte`, callAI,
// js/api.js) : les valeurs brutes ('ideas', 'story'...) sont des
// identifiants techniques, pas ce qu'on montre au fondateur. 'creation'
// reste géré ici (jamais retiré) : c'est le libellé générique partagé
// qu'utilisaient TOUS les échecs Idées/Script/Récit avant le correctif de
// journalisation par mode réel, il peut encore apparaître pour d'anciennes
// lignes tant qu'elles n'ont pas expiré de la fenêtre de 7 jours.
const LABEL_MODE_ERREUR = {
  ideas: 'Idées', script: 'Script', story: 'Récit', serie: 'Série',
  storyboard: 'Storyboard', storyboardSeul: 'Storyboard seul',
  recommandation: 'Recommandations', montageGuide: 'Guide de montage',
  diagnosticSommaire: 'Diagnostic sommaire', diagnosticFusion: 'Diagnostic (fusion)',
  analyseVirale: 'Analyse virale', audit: 'Diagnostic détaillé',
  creation: 'Ancien échec (avant précision par mode)', creationSerie: 'Série', autre: 'Autre',
  // Volontairement séparés de 'script'/'story' : quand le juge indépendant
  // du score ne répond pas, le script ou le récit est bel et bien livré,
  // complet. Ce n'est pas un échec de génération, seul le score manque, et
  // les compter ensemble fausserait la lecture de la santé du service.
  'score-script': 'Score non calculé (Script)', 'score-story': 'Score non calculé (Récit)'
};
function labelModeErreur(m) { return LABEL_MODE_ERREUR[m] || m; }

// Format court "il y a X min/h/j", pour le détail d'un échec (voir
// toggleDetailErreursMode ci-dessous). Volontairement simple (pas de
// libellé au-delà du jour), le contexte est "7 derniers jours".
function tempsRelatifCourt(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (diffMin < 1) return 'à l\'instant';
  if (diffMin < 60) return 'il y a ' + diffMin + ' min';
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return 'il y a ' + diffH + ' h';
  return 'il y a ' + Math.round(diffH / 24) + ' j';
}

// Ouvre/ferme le détail des échecs d'UN mode (voir _erreursRecentes,
// chargerCarteModes) : le fondateur voit alors ce qui s'est réellement
// passé (message d'erreur technique, quand, sur quel code), pas seulement
// un compte. Chaque mode se déplie indépendamment des autres.
function toggleDetailErreursMode(mode) {
  const el = document.getElementById('detailErreurs_' + mode);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// Nouveau vs déjà consulté (retour propriétaire : "que le nombre soit en
// rouge seulement s'il y a du nouveau, sinon en doré, et qu'une fois
// consultées les erreurs redeviennent anciennes") : comparé à la date de
// la DERNIÈRE visite de ce tableau (avant celle-ci, voir
// dernierePriseConnaissanceErreurs/marquerErreursVuesLe plus bas), pas au
// total (qui peut rester identique si une vieille erreur sort de la
// fenêtre de 7 jours pile au moment où une nouvelle apparaît).
function estErreurNouvelle(dateStr, seuilIso) {
  if (!seuilIso) return true; // jamais consulté encore : tout est nouveau
  if (!dateStr) return false; // pas de date connue : ne pas alarmer à tort
  const d = new Date(dateStr).getTime(), s = new Date(seuilIso).getTime();
  return !isNaN(d) && !isNaN(s) && d > s;
}

function carteErreursAdmin() {
  if (!_erreursTotal) return '';
  const seuil = dernierePriseConnaissanceErreurs();
  // _erreursRecentes vide alors que _erreursTotal > 0 : la sous-requête de
  // détail a pu échouer indépendamment du comptage (deux requêtes séparées
  // côté serveur, voir handleAdminStats/api/data.js) ; impossible de juger
  // la fraîcheur dans ce cas, on affiche prudemment en rouge plutôt que de
  // supposer à tort que tout est déjà connu.
  const nouvelleDansListe = (liste) => liste.length ? liste.some(e => estErreurNouvelle(e.cree_le, seuil)) : true;
  const totalNouveau = nouvelleDansListe(_erreursRecentes);
  const lignes = Object.entries(_erreursParMode)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => {
      const modeJs = m.replace(/'/g, "\\'");
      const erreursDuMode = _erreursRecentes.filter(e => (e.mode || 'autre') === m);
      const modeNouveau = erreursDuMode.length ? nouvelleDansListe(erreursDuMode) : totalNouveau;
      const couleurMode = modeNouveau ? '#f87171' : 'var(--gold)';
      const detailHtml = erreursDuMode
        .map(e => {
          const nouvelle = estErreurNouvelle(e.cree_le, seuil);
          return `<div class="erreur-detail-item" style="border-left-color:${nouvelle ? 'rgba(248,113,113,0.55)' : 'rgba(201,168,76,0.4)'}"><span class="erreur-detail-quand">${escAdmin(tempsRelatifCourt(e.cree_le))}${e.code_acces ? ' · ' + escAdmin(e.code_acces) : ''}</span><span class="erreur-detail-texte">${escAdmin(e.detail || 'Détail indisponible.')}</span></div>`;
        })
        .join('') || '<div class="ideas-sub">Détail indisponible pour ces échecs.</div>';
      return `<div class="audit-sujet erreur-mode-ligne" onclick="toggleDetailErreursMode('${modeJs}')">
          <span>${escAdmin(labelModeErreur(m))}</span><b style="color:${couleurMode}">${n}</b>
        </div>
        <div class="erreur-detail-liste" id="detailErreurs_${modeJs}" style="display:none">${detailHtml}</div>`;
    })
    .join('');
  // Deux nombres plutôt qu'un seul total (retour propriétaire) : combien
  // sont VRAIMENT nouvelles depuis la dernière visite (rouge, ce qui mérite
  // un coup d'œil) et combien sont déjà connues (doré). nombreNouvelles
  // vient de _erreursRecentes (voir filet de sécurité ci-dessus) ; le reste
  // du total, forcément plus ancien puisque _erreursRecentes est trié du
  // plus récent au plus ancien, complète en "anciennes" sans avoir besoin
  // de connaître le détail de CHAQUE ligne au-delà des 50 dernières.
  const nombreNouvelles = _erreursRecentes.length
    ? _erreursRecentes.filter(e => estErreurNouvelle(e.cree_le, seuil)).length
    : _erreursTotal;
  const nombreAnciennes = Math.max(0, _erreursTotal - nombreNouvelles);
  return `<div class="score-card${totalNouveau ? ' score-card-alerte' : ''}">
    <div class="score-title"${totalNouveau ? '' : ' style="color:var(--gold)"'}>⚠ Échecs de génération · 7 jours</div>
    <div class="score-global" style="margin-top:10px;display:flex;align-items:baseline;gap:24px">
      <span class="score-global-num" style="color:#f87171">${escAdmin(nombreNouvelles)}</span>
      <span class="score-global-num" style="color:var(--gold)">${escAdmin(nombreAnciennes)}</span>
    </div>
    <div class="ideas-sub" style="margin-top:4px;opacity:0.6">Rouge = nouveau depuis ta dernière visite · doré = déjà consulté</div>
    <div class="audit-sujets" style="margin-top:14px">${lignes}</div>
    <div class="ideas-sub" style="margin-top:8px;opacity:0.6">Touche un mode pour voir le détail ↓</div>
  </div>`;
}

// ── Badge d'échecs de génération sur "Tableau de bord" (sidebar + pied de
// page, voir .nav-admin-btn, index.html), visible depuis N'IMPORTE QUEL
// écran, sans avoir besoin d'ouvrir le tableau de bord pour le savoir
// (demande explicite : pas de canal de notification séparé, juste rendre
// ça impossible à manquer). Appelé une seule fois au chargement (voir
// js/app.js), seulement pour le fondateur (body.is-admin) : le serveur
// revérifie de toute façon les droits (voir handleAdminStats, api/data.js),
// ce gate côté client évite juste un appel inutile pour tout le monde
// d'autre. Échoue silencieusement : ce badge est un signal EN PLUS, la
// carte d'alerte du tableau de bord (carteErreursAdmin ci-dessus) reste la
// seule source de vérité si ce badge ne s'affiche pas pour une raison ou
// une autre.
//
// "Vu" : le badge ne doit pas rester affiché indéfiniment une fois que le
// fondateur a déjà ouvert le tableau de bord et vu le détail des échecs
// (sinon un badge qui ne s'efface jamais perd tout son sens de signal).
// Suivi par un simple compteur en localStorage (pas de comparaison par
// identifiant précis d'échec, volontairement simple) : marquerErreursVues
// l'enregistre à l'ouverture du tableau de bord, verifierBadgeErreursAdmin
// ne réaffiche le badge que si le total a AUGMENTÉ depuis. Limite connue :
// si un ancien échec sort de la fenêtre de 7 jours pile au moment où un
// nouveau apparaît, le total peut rester identique et le badge ne pas se
// redéclencher, cas rare vu le faible volume attendu.
function cleErreursVues() {
  return 'scriptura_erreurs_vues_total';
}
function marquerErreursVues(total) {
  try { localStorage.setItem(cleErreursVues(), String(total || 0)); } catch (e) { /* silencieux */ }
  document.querySelectorAll('.nav-admin-badge').forEach(b => b.remove());
}

// ── Rouge (nouveau) vs doré (déjà consulté), voir carteErreursAdmin :
// horodatage de la dernière visite de ce tableau, indépendant du compteur
// "total" ci-dessus (qui sert uniquement le badge de la nav). Lu AVANT
// d'être mis à jour (voir chargerTableauDeBord, marquerErreursVuesLe
// appelée seulement APRÈS le rendu) : la carte affiche donc toujours "ce
// qui est arrivé depuis la visite PRÉCÉDENTE", jamais celle en cours.
function cleErreursVuesLe() {
  return 'scriptura_erreurs_vues_le';
}
function dernierePriseConnaissanceErreurs() {
  try { return localStorage.getItem(cleErreursVuesLe()); } catch (e) { return null; }
}
function marquerErreursVuesLe() {
  try { localStorage.setItem(cleErreursVuesLe(), new Date().toISOString()); } catch (e) { /* silencieux */ }
}
async function verifierBadgeErreursAdmin() {
  if (!document.body.classList.contains('is-admin')) return;
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible) return;
    const total = data.erreursTotal || 0;
    if (!total) return;
    let vu = 0;
    try { vu = parseInt(localStorage.getItem(cleErreursVues()), 10) || 0; } catch (e) { /* silencieux */ }
    if (total <= vu) return; // déjà vu la dernière fois, rien de nouveau depuis
    // Le nombre affiché doit être celui des échecs VRAIMENT nouveaux depuis
    // la dernière visite (retour propriétaire), pas le total des 7 jours :
    // même horodatage/logique que carteErreursAdmin (estErreurNouvelle/
    // dernierePriseConnaissanceErreurs), avec le même filet de sécurité si
    // le détail par erreur n'est pas disponible.
    const recentes = Array.isArray(data.erreursRecentes) ? data.erreursRecentes : [];
    const seuil = dernierePriseConnaissanceErreurs();
    const nouvelles = recentes.length ? recentes.filter(e => estErreurNouvelle(e.cree_le, seuil)).length : total;
    document.querySelectorAll('.nav-admin-btn').forEach(btn => {
      if (btn.querySelector('.nav-admin-badge')) return;
      const badge = document.createElement('span');
      badge.className = 'nav-admin-badge';
      badge.textContent = nouvelles > 99 ? '99+' : String(nouvelles);
      badge.title = nouvelles + (nouvelles > 1 ? ' nouveaux échecs' : ' nouvel échec') + ' de génération depuis ta dernière visite';
      btn.appendChild(badge);
    });
  } catch (e) { /* silencieux, voir commentaire ci-dessus */ }
}

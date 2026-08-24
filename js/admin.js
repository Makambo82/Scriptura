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

  const [enLigneHTML, actifs24hHTML, abonnesHTML, modesHTML] = await Promise.all([
    chargerCarteEnLigne(),
    chargerCarteActifs24h(),
    chargerCarteAbonnes(),
    chargerCarteModes()
  ]);

  zone.innerHTML = carteCreerAbonne() + enLigneHTML + actifs24hHTML + abonnesHTML + modesHTML;
}

// ── Créer un nouvel abonné Creator/Pro depuis le tableau de bord (voir
// action=creer-abonne, api/data.js). Carte statique, jamais redessinée par
// chargerTableauDeBord() une fois affichée : après création, on met à jour
// _codesAbonnesAdmin/renderAdminListe/majEnteteAbonnesAdmin directement,
// sans recharger tout le tableau, pour ne pas effacer le code généré avant
// que l'abonné ait pu le copier.
let _adminNouveauPlan = 'creator';

function carteCreerAbonne() {
  return `<div class="score-card">
    <div class="score-title">Ajouter un abonné</div>
    <div style="margin-top:12px">
      <input type="text" class="ctx-input" id="adminNouveauPrenom" placeholder="Prénom de l'abonné" maxlength="20"/>
    </div>
    <div class="btn-grid" style="margin-top:10px">
      <button type="button" class="grid-btn active" id="adminPlanCreator" onclick="choisirPlanNouveauAbonne('creator', this)">Creator</button>
      <button type="button" class="grid-btn" id="adminPlanPro" onclick="choisirPlanNouveauAbonne('pro', this)">Pro</button>
    </div>
    <button type="button" class="btn-generate" style="margin-top:12px;width:100%" onclick="creerAbonneAdmin()" id="adminCreerBtn">Générer le code d'accès</button>
    <div id="adminNouveauResultat" style="display:none;margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px"></div>
  </div>`;
}

function choisirPlanNouveauAbonne(v, btn) {
  _adminNouveauPlan = v;
  const zone = btn.parentElement;
  zone.querySelectorAll('.grid-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function creerAbonneAdmin() {
  const champ = document.getElementById('adminNouveauPrenom');
  const bouton = document.getElementById('adminCreerBtn');
  const resultat = document.getElementById('adminNouveauResultat');
  const prenom = (champ?.value || '').trim();
  if (!prenom) { if (typeof toastRegen === 'function') toastRegen('Indique un prénom avant de générer le code.'); return; }
  bouton.disabled = true;
  bouton.textContent = 'Génération…';
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', action: 'creer-abonne', code_acces: localStorage.getItem('scriptura_code') || null, prenom, plan: _adminNouveauPlan })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible || !data.ok) throw new Error(data?.error?.message || 'création échouée');
    const codeJs = data.code.replace(/'/g, "\\'");
    resultat.style.display = 'block';
    resultat.innerHTML = `<div class="ideas-sub" style="margin-bottom:8px">Nouveau code ${escAdmin(data.plan)}, expire le ${escAdmin(data.expireLe)}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <b style="font-size:1.05rem;letter-spacing:0.02em">${escAdmin(data.code)}</b>
        <button type="button" class="grid-btn" onclick="copyText(this, '${codeJs}')">Copier</button>
      </div>`;
    _codesAbonnesAdmin.unshift({ code: data.code, plan: data.plan, actif: true });
    renderAdminListe();
    majEnteteAbonnesAdmin();
    if (champ) champ.value = '';
  } catch (e) {
    if (typeof toastRegen === 'function') toastRegen('Impossible de créer cet abonné, réessaie.');
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Générer le code d\'accès';
  }
}

// ── En ligne maintenant (moins de 2 minutes d'inactivité) ──
async function chargerCarteEnLigne() {
  try {
    const seuil = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count: aAbonnes, error: e1 } = await supabaseClient.from('presence').select('*', { count: 'exact', head: true }).gte('derniere_activite', seuil).eq('abonne', true);
    if (e1) throw e1;
    const { count: aNonAbonnes, error: e2 } = await supabaseClient.from('presence').select('*', { count: 'exact', head: true }).gte('derniere_activite', seuil).eq('abonne', false);
    if (e2) throw e2;
    const total = (aAbonnes || 0) + (aNonAbonnes || 0);
    return carteStatAdmin('En ligne maintenant', total, (aAbonnes || 0) + ' abonné(s) · ' + (aNonAbonnes || 0) + ' non-abonné(s)');
  } catch (e) {
    return carteErreurAdmin('En ligne maintenant', e);
  }
}

// ── Actifs dans les dernières 24h (même table, fenêtre plus large) ──
async function chargerCarteActifs24h() {
  try {
    const seuil = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: aAbonnes, error: e1 } = await supabaseClient.from('presence').select('*', { count: 'exact', head: true }).gte('derniere_activite', seuil).eq('abonne', true);
    if (e1) throw e1;
    const { count: aNonAbonnes, error: e2 } = await supabaseClient.from('presence').select('*', { count: 'exact', head: true }).gte('derniere_activite', seuil).eq('abonne', false);
    if (e2) throw e2;
    const total = (aAbonnes || 0) + (aNonAbonnes || 0);
    return carteStatAdmin('Actifs dans les dernières 24h', total, (aAbonnes || 0) + ' abonné(s) · ' + (aNonAbonnes || 0) + ' non-abonné(s)');
  } catch (e) {
    return carteErreurAdmin('Actifs dans les dernières 24h', e);
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

async function chargerCarteAbonnes() {
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible) throw new Error(data?.error?.message || 'donnée indisponible');
    _codesAbonnesAdmin = Array.isArray(data.codes) ? data.codes : [];
    _adminSearchOpen = false; _adminSearchQuery = ''; _adminFilterOpen = false; _adminPlanFilter = null;
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
    </div>`;
  } catch (e) {
    return carteErreurAdmin('Abonnés actifs', e);
  }
}

function toggleListeAbonnesAdmin() {
  const el = document.getElementById('listeAbonnesAdmin');
  const hint = document.getElementById('listeAbonnesAdminHint');
  if (!el) return;
  const ouvert = el.style.display !== 'none';
  el.style.display = ouvert ? 'none' : 'block';
  if (!ouvert) { renderAdminControles(); renderAdminListe(); }
  if (hint) hint.textContent = ouvert ? 'Touche pour voir le détail des codes ↓' : 'Touche pour masquer ↑';
}

function filtrerCodesAdmin() {
  let liste = _codesAbonnesAdmin;
  if (_adminPlanFilter === 'desactive') liste = liste.filter(c => c.actif === false);
  else if (_adminPlanFilter) liste = liste.filter(c => (c.plan || '') === _adminPlanFilter);
  if (_adminSearchQuery.trim()) {
    const q = _adminSearchQuery.trim().toUpperCase();
    liste = liste.filter(c => (c.code || '').toUpperCase().includes(q));
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

function renderAdminListe() {
  const zone = document.getElementById('listeAbonnesAdminList');
  if (!zone) return;
  const liste = filtrerCodesAdmin();
  zone.innerHTML = liste.length
    ? liste.map((c, i) => {
        const codeJs = c.code.replace(/'/g, "\\'");
        return `<div>
        <div class="audit-sujet">
          <span class="admin-code-clic" onclick="toggleGenerationsParCode('${codeJs}', ${i})" title="Voir ses générations par mode">${escAdmin(c.code)}${c.actif === false ? ' · désactivé' : ''}</span>
          <span style="display:flex;align-items:center;gap:10px">
            <b>${escAdmin(c.plan || '·')}</b>
            <label class="admin-switch" title="${c.actif === false ? 'Réactiver' : 'Désactiver'}">
              <input type="checkbox" ${c.actif === false ? '' : 'checked'} onchange="toggleActifAbonneAdmin('${codeJs}', this.checked)"/>
              <span class="admin-switch-track"></span>
            </label>
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
async function chargerCarteModes() {
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'admin-stats', code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await r.json();
    if (!r.ok || data.indisponible) throw new Error(data?.error?.message || 'donnée indisponible');
    const parMode = data.parMode || {};
    const lignes = Object.entries(parMode)
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `<div class="audit-sujet"><span>${escAdmin(m)}</span><b>${n}</b></div>`)
      .join('') || '<div class="ideas-sub">Aucune génération sur cette période.</div>';
    return `<div class="score-card">
      <div class="score-title">GÉNÉRATIONS PAR MODE · 30 JOURS</div>
      <div class="audit-sujets" style="margin-top:14px">${lignes}</div>
    </div>`;
  } catch (e) {
    return carteErreurAdmin('Générations par mode · 30 jours', e);
  }
}

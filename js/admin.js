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

  zone.innerHTML = enLigneHTML + actifs24hHTML + abonnesHTML + modesHTML;
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

// ── Abonnés actifs, par formule (comptage exact, ne charge pas les lignes) ──
async function chargerCarteAbonnes() {
  try {
    const { count: total, error: e1 } = await supabaseClient.from('abonnes').select('*', { count: 'exact', head: true });
    if (e1) throw e1;
    const { count: actifs, error: e2 } = await supabaseClient.from('abonnes').select('*', { count: 'exact', head: true }).eq('actif', true);
    if (e2) throw e2;
    const { count: creator } = await supabaseClient.from('abonnes').select('*', { count: 'exact', head: true }).eq('actif', true).eq('plan', 'creator');
    const { count: pro } = await supabaseClient.from('abonnes').select('*', { count: 'exact', head: true }).eq('actif', true).eq('plan', 'pro');
    const sousTexte = (total || 0) + ' au total (actifs + désactivés) · '
      + (creator || 0) + ' Creator · ' + (pro || 0) + ' Pro';
    return carteStatAdmin('Abonnés actifs', actifs || 0, sousTexte);
  } catch (e) {
    return carteErreurAdmin('Abonnés actifs', e);
  }
}

// Le nom exact de la colonne de date sur `generations` n'est pas garanti
// (dépend de comment la table a été créée) : on essaie plusieurs noms
// courants plutôt que de dépendre d'un seul, pour éviter un aller-retour.
const CANDIDATS_COLONNE_DATE = ['created_at', 'inserted_at', 'date_creation', 'created', 'date'];

// ── Répartition des générations par mode sur 30 jours ──
async function chargerCarteModes() {
  const depuis30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  let derniereErreur = null;
  for (const colonne of CANDIDATS_COLONNE_DATE) {
    try {
      const { data, error } = await supabaseClient.from('generations').select('mode').gte(colonne, depuis30);
      if (error) { derniereErreur = error; continue; }
      const parMode = {};
      (data || []).forEach(r => { const m = r.mode || 'autre'; parMode[m] = (parMode[m] || 0) + 1; });
      const lignes = Object.entries(parMode)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `<div class="audit-sujet"><span>${escAdmin(m)}</span><b>${n}</b></div>`)
        .join('') || '<div class="ideas-sub">Aucune génération sur cette période.</div>';
      return `<div class="score-card">
        <div class="score-title">GÉNÉRATIONS PAR MODE · 30 JOURS</div>
        <div class="audit-sujets" style="margin-top:14px">${lignes}</div>
      </div>`;
    } catch (e) { derniereErreur = e; }
  }
  return carteErreurAdmin('Générations par mode · 30 jours', derniereErreur);
}

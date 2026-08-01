// ═══════════════════════════════════════════════════════════
//  TABLEAU DE BORD — visible uniquement avec le code fondateur
//  (SCRIPTURA-CELINE, voir CODE_ADMIN dans js/api.js). Fichier
//  INDÉPENDANT : lecture seule sur Supabase, ne modifie aucun mode
//  existant. Chaque bloc de statistique échoue silencieusement (affiche
//  "donnée indisponible") plutôt que de casser le reste du tableau si
//  une table ou une colonne diffère de ce qui est attendu.
// ═══════════════════════════════════════════════════════════

function ouvrirTableauDeBord() {
  pushNav();
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('flow').style.display = 'none';
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('storyFlow').style.display = 'none';
  const afh = document.getElementById('auditFlow'); if (afh) afh.style.display = 'none';
  const sfh = document.getElementById('serieFlow'); if (sfh) sfh.style.display = 'none';
  const hfh = document.getElementById('historyFlow'); if (hfh) hfh.style.display = 'none';
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
  return carteStatAdmin(label, '—', 'Donnée indisponible (' + (e && e.message ? e.message : 'erreur inconnue') + ')');
}

async function chargerTableauDeBord() {
  const zone = document.getElementById('adminStats');
  if (!zone) return;
  zone.innerHTML = '<div class="ideas-sub">Chargement des statistiques…</div>';
  if (!supabaseClient) { zone.innerHTML = '<div class="ideas-sub">Base de données indisponible.</div>'; return; }

  const [abonnesHTML, activiteHTML, modesHTML] = await Promise.all([
    chargerCarteAbonnes(),
    chargerCarteActivite(),
    chargerCarteModes()
  ]);

  zone.innerHTML = abonnesHTML + activiteHTML + modesHTML;
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

// ── Créateurs distincts ayant généré quelque chose récemment ──
async function chargerCarteActivite() {
  try {
    const depuis7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const depuis30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [r7, r30] = await Promise.all([
      supabaseClient.from('generations').select('code_acces').gte('created_at', depuis7),
      supabaseClient.from('generations').select('code_acces').gte('created_at', depuis30)
    ]);
    if (r7.error) throw r7.error;
    if (r30.error) throw r30.error;
    const uniq7 = new Set((r7.data || []).map(r => r.code_acces)).size;
    const uniq30 = new Set((r30.data || []).map(r => r.code_acces)).size;
    return carteStatAdmin('Créateurs actifs · 7 jours', uniq7, uniq30 + ' sur les 30 derniers jours');
  } catch (e) {
    return carteErreurAdmin('Créateurs actifs · 7 jours', e);
  }
}

// ── Répartition des générations par mode sur 30 jours ──
async function chargerCarteModes() {
  try {
    const depuis30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabaseClient.from('generations').select('mode').gte('created_at', depuis30);
    if (error) throw error;
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
  } catch (e) {
    return carteErreurAdmin('Générations par mode · 30 jours', e);
  }
}

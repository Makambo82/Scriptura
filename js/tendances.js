// ═══════════════════════════════════════════════════════════
//  MODE « TENDANCES » (benchmark d'une niche TikTok entière, Pro uniquement)
//  L'utilisateur indique une niche (mot-clé). Le serveur (api/tendances.js)
//  cherche les vidéos qui cartonnent dessus, les transcrit, puis en tire un
//  rapport : vues/likes médians, engagement, momentum, top créateurs,
//  registre de langage et patterns de rétention. Trop lourd pour une seule
//  requête serverless (voir api/tendances.js) : le job avance PAR ÉTAPES,
//  le navigateur rappelle action=avancer en boucle jusqu'à statut='termine'.
// ═══════════════════════════════════════════════════════════

let _tendancesResultat = null; // dernier rapport affiché (réouverture depuis l'historique)

function tendancesEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Ouvre le mode depuis l'accueil. Contrairement au diagnostic sommaire
// (ouvert à tous, gate seulement sur l'analyse détaillée), Tendances n'a
// AUCUN palier gratuit : le gate se fait ici, à l'entrée, comme pour
// « Crée-moi une série » (voir chooseMode, js/serie.js), pas au clic sur
// "Analyser" — inutile de laisser un non-Pro remplir un formulaire qu'il
// ne pourra jamais soumettre.
async function ouvrirTendances() {
  if (typeof pushNav === 'function') pushNav();
  masquerTousLesEcrans();
  const droit = await droitAnalyseTendances();
  if (!droit.ok) {
    document.getElementById('homePage').style.display = 'block';
    if (droit.raison === 'expire') { gererAbonnementExpire(); return; }
    openPlans('decouverte-tendances');
    return;
  }
  resetTendances();
  document.getElementById('tendancesFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function resetTendances() {
  const input = document.getElementById('tendancesInput');
  if (input) input.value = '';
  const err = document.getElementById('tendancesError');
  if (err) err.style.display = 'none';
  const form = document.getElementById('tendancesForm');
  if (form) form.style.display = '';
  const loading = document.getElementById('tendancesLoading');
  if (loading) loading.style.display = 'none';
  const res = document.getElementById('tendancesResults');
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
}

// Depuis le résultat, relancer une nouvelle analyse (retombera naturellement
// sur QUOTA_ATTEINT côté serveur si le mois est déjà consommé).
function relancerTendances() {
  resetTendances();
  const input = document.getElementById('tendancesInput');
  if (input) input.focus();
}

function _tendancesMajProgres(pct, statut) {
  const pctEl = document.getElementById('tendancesLoadingPct');
  const barEl = document.getElementById('tendancesLoadingBar');
  const statutEl = document.getElementById('tendancesLoadingStatus');
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (pctEl) pctEl.textContent = p + '%';
  if (barEl) barEl.style.width = p + '%';
  if (statutEl && statut) statutEl.textContent = statut;
}

// Parse une réponse d'erreur 403 du serveur (ACCES_REFUSE / QUOTA_ATTEINT),
// même mécanique que les autres modes (voir _outilsGererErreurReponse,
// js/tiktok-outils.js).
async function _tendancesMessageErreur(r) {
  let payload = null;
  try { payload = await r.json(); } catch (e) {}
  return (payload && payload.error && payload.error.message) || 'Erreur serveur.';
}

async function lancerTendances() {
  const err = document.getElementById('tendancesError');
  const btn = document.getElementById('tendancesGoBtn');
  err.style.display = 'none';

  const niche = (document.getElementById('tendancesInput').value || '').trim();
  if (!niche) {
    err.textContent = 'Indique ta niche (ex. « cuisine », « fitness », « business »).';
    err.style.display = 'block';
    return;
  }

  // Le gate Pro/quota a déjà été vérifié à l'ouverture de l'écran (voir
  // ouvrirTendances) : ici on ne fait plus que lancer, la vraie décision
  // reste de toute façon côté serveur (verifierQuota, api/_lib/acces.js),
  // qui n'a aucun repli jeton pour ce mode.
  const code_acces = localStorage.getItem('scriptura_code') || null;
  btn.disabled = true;
  document.getElementById('tendancesForm').style.display = 'none';
  const loading = document.getElementById('tendancesLoading');
  loading.style.display = 'block';
  document.getElementById('tendancesLoadingSub').textContent = 'Recherche des vidéos qui cartonnent sur « ' + niche + ' »…';
  _tendancesMajProgres(0, 'On cherche les vidéos de ta niche…');
  window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    const r1 = await fetch('/api/tendances', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lancer', niche, code_acces })
    });
    if (r1.status === 403) throw new Error(await _tendancesMessageErreur(r1));
    const j1 = await r1.json();
    if (!j1.ok) {
      if (j1.raison === 'pas_assez_de_videos') {
        throw new Error("Pas assez de vidéos trouvées pour cette niche (" + (j1.trouvees || 0) + "). Essaie un mot-clé un peu plus large.");
      }
      throw new Error((j1.error && j1.error.message) || "Impossible de lancer l'analyse.");
    }

    const id = j1.id, total = j1.total || 0;
    _tendancesMajProgres(5, total + ' vidéos trouvées, transcription en cours…');

    let statut = 'en_cours', resultat = null;
    while (statut === 'en_cours') {
      // L'utilisateur a quitté l'écran (retour, autre mode…) : on arrête la
      // boucle silencieusement, le job reste "en_cours" côté Supabase sans
      // gêner personne (jamais repris, jamais bloquant pour une prochaine analyse).
      const ecran = document.getElementById('tendancesFlow');
      if (!ecran || ecran.style.display === 'none') return;

      const r2 = await fetch('/api/tendances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'avancer', id, code_acces })
      });
      if (r2.status === 403) throw new Error(await _tendancesMessageErreur(r2));
      const j2 = await r2.json();
      if (!j2.ok) throw new Error((j2.error && j2.error.message) || 'Erreur pendant la transcription.');
      statut = j2.statut;
      resultat = j2.resultat;
      const traitees = j2.traitees || 0, tot = j2.total || total || 1;
      _tendancesMajProgres(5 + (traitees / tot) * 90, traitees + ' / ' + tot + ' vidéos transcrites…');
    }

    if (statut === 'echec' || !resultat) {
      throw new Error("La synthèse a échoué. Ton analyse de ce mois-ci a déjà été consommée, réessaie le mois prochain.");
    }

    _tendancesMajProgres(100, 'Terminé.');
    _tendancesResultat = resultat;

    if (!unlocked) { /* Tendances n'est jamais accessible sans abonnement Pro, rien à décompter ici */ }
    saveGeneration('tendances', 'Tendances · ' + (resultat.niche || niche), { niche: resultat.niche || niche, resultat });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    if (typeof pushNav === 'function') pushNav();
    afficherTendancesResultat(resultat);

  } catch (e) {
    document.getElementById('tendancesForm').style.display = '';
    loading.style.display = 'none';
    err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

function _fmtTendancesMomentum(m) {
  if (m == null) return { texte: 'Non mesurable sur cet échantillon', classe: 'ds-tag' };
  const val = String(m).replace('.', ',');
  if (m >= 1.15) return { texte: 'En accélération (×' + val + ' vs il y a 30-90j)', classe: 'ds-tag-ok' };
  if (m <= 0.85) return { texte: 'En ralentissement (×' + val + ' vs il y a 30-90j)', classe: 'ds-tag' };
  return { texte: 'Stable (×' + val + ' vs il y a 30-90j)', classe: 'ds-tag' };
}

// Rendu du rapport (nouvelle analyse OU réouverture depuis l'historique).
function afficherTendancesResultat(d) {
  const res = document.getElementById('tendancesResults');
  if (!res || !d) return;
  _tendancesResultat = d;
  const form = document.getElementById('tendancesForm');
  if (form) form.style.display = 'none';
  const loading = document.getElementById('tendancesLoading');
  if (loading) loading.style.display = 'none';

  const niche = d.niche || '';
  const createurs = Array.isArray(d.topCreateurs) ? d.topCreateurs.slice(0, 10) : [];
  const patterns = Array.isArray(d.patterns_retention) ? d.patterns_retention.filter(Boolean) : [];
  const momentum = _fmtTendancesMomentum(d.momentum);

  const enteteHtml = `
    <div class="ideas-header" style="margin-bottom:0">
      <div class="ideas-eyebrow">Benchmark · ${tendancesEsc(niche)}</div>
      <h2 class="ideas-title" style="font-size:1.5rem">Ce qui cartonne<br/><strong>sur « ${tendancesEsc(niche)} ».</strong></h2>
      ${d.echantillon ? `<p class="ideas-sub">Basé sur ${d.echantillon} vidéos des 90 derniers jours${d.transcrites ? `, dont ${d.transcrites} transcrites` : ''}.</p>` : ''}
    </div>`;

  const vueEnsembleHtml = `
    <div class="score-card">
      <div class="audit-section-label">Vue d'ensemble</div>
      <div class="ds-stats-row" style="margin-top:16px">
        ${d.vuesMedianes != null ? `<div class="ds-stat-item">${ICO('eye')}<span class="ds-stat-num">${formaterNombre(d.vuesMedianes)}</span><span class="ds-stat-label">Vues médianes</span></div>` : ''}
        ${d.likesMedianes != null ? `<div class="ds-stat-item">${ICO('heart')}<span class="ds-stat-num">${formaterNombre(d.likesMedianes)}</span><span class="ds-stat-label">J'aime médians</span></div>` : ''}
        ${d.engagementMoyen != null ? `<div class="ds-stat-item">${ICO('bolt')}<span class="ds-stat-num">${String(d.engagementMoyen).replace('.', ',')}%</span><span class="ds-stat-label">Engagement moyen</span></div>` : ''}
      </div>
      <div class="ds-sante-row"><span class="ds-tag ${momentum.classe}">${ICO('trend')} ${tendancesEsc(momentum.texte)}</span></div>
    </div>`;

  const createursHtml = createurs.length ? `
    <div class="score-card">
      <div class="audit-section-label">Top créateurs de ta niche</div>
      <ul class="viral-list">
        ${createurs.map((c, i) => `<li>
          <div class="viral-list-head"><span class="viral-moment">#${i + 1}</span><span class="viral-tech">${tendancesEsc(c.nickname || c.uniqueId || 'Créateur')}</span></div>
          <p>${c.uniqueId ? '@' + tendancesEsc(c.uniqueId) + ' · ' : ''}${c.followerCount != null ? formaterNombre(c.followerCount) + ' abonnés · ' : ''}${formaterNombre(c.vuesCumulees || 0)} vues cumulées sur ${c.nbVideos || 1} vidéo${(c.nbVideos || 1) > 1 ? 's' : ''} de l'échantillon</p>
        </li>`).join('')}
      </ul>
    </div>` : '';

  const qualitatifHtml = (d.registre || d.duree_optimale || patterns.length) ? `
    <div class="score-card">
      <div class="audit-section-label">Ce qui revient, vidéo après vidéo</div>
      ${d.registre ? `<p class="audit-diag-constat" style="margin-top:16px">${tendancesEsc(d.registre)}</p>` : ''}
      ${d.duree_optimale ? `<div class="ds-sante-row" style="margin:8px 0 4px"><span class="ds-tag">${ICO('clock')} Durée optimale observée : ${tendancesEsc(d.duree_optimale)}</span></div>` : ''}
      ${patterns.length ? `<ul class="ds-niche-analyse" style="margin-top:12px">${patterns.map(p => `<li>${tendancesEsc(p)}</li>`).join('')}</ul>` : ''}
    </div>` : `
    <div class="score-card">
      <div class="audit-section-label">Ce qui revient, vidéo après vidéo</div>
      <p class="audit-diag-interp" style="margin-top:16px">Pas assez de vidéos transcrites avec succès cette fois pour une lecture qualitative fiable. Les chiffres ci-dessus (vues, engagement, top créateurs) restent valables.</p>
    </div>`;

  res.innerHTML = `
    ${enteteHtml}
    ${vueEnsembleHtml}
    ${createursHtml}
    ${qualitatifHtml}
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="relancerTendances()">Nouvelle analyse</button>`;

  res.style.display = 'block';
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

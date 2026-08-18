// ═══════════════════════════════════════════════════════════
//  MODULE « OUTILS TIKTOK » (service annexe, hors modes de création)
//  Deux actions indépendantes à partir d'un même lien : transcription
//  (texte parlé, via /api/video-stt, déjà utilisé en interne par le mode
//  Analyse vidéo virale) et téléchargement (lien direct vers la vidéo,
//  sans filigrane si possible, via /api/tiktok-download, sans passer par
//  nos serveurs : pas de gros fichier qui transite par la fonction
//  serverless). Même quota mensuel que l'analyse vidéo (droitAnalyseVirale,
//  js/historique.js) : mêmes API payées mises à contribution.
// ═══════════════════════════════════════════════════════════

function outilsEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let _outilsTranscript = ''; // pour le bouton Copier

function ouvrirOutilsTikTok() {
  if (typeof pushNav === 'function') pushNav();
  masquerTousLesEcrans();
  resetOutilsTikTok();
  document.getElementById('tiktokOutilsFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function resetOutilsTikTok() {
  const lien = document.getElementById('outilsLien');
  if (lien) lien.value = '';
  const err = document.getElementById('outilsError');
  if (err) err.style.display = 'none';
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = '';
  const res = document.getElementById('outilsResults');
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
}

function outilsAutreVideo() {
  resetOutilsTikTok();
  const lien = document.getElementById('outilsLien');
  if (lien) lien.focus();
}

// Décompte les compteurs client (affichage seulement, le vrai contrôle est
// déjà fait côté serveur, voir api/_lib/acces.js) après un succès. Même
// bookkeeping que lancerAnalyseVirale (js/viral.js), les deux tirent sur le
// même quota 'analyseVirale'.
function _outilsDecompteApresSucces() {
  if (unlocked) return;
  usedGen++;
  localStorage.setItem('scriptura_used', usedGen);
  bumpServerQuota(usedGen);
  const vf = parseInt(localStorage.getItem('scriptura_viral_used') || '0', 10) + 1;
  localStorage.setItem('scriptura_viral_used', String(vf));
  renderGenCounter();
  checkRappelAbonnement();
}

async function lancerOutilTikTok(type) {
  const err = document.getElementById('outilsError');
  err.style.display = 'none';

  const lien = (document.getElementById('outilsLien').value || '').trim();
  if (!lien) {
    err.textContent = "Colle le lien TikTok d'une vidéo.";
    err.style.display = 'block';
    return;
  }

  // Même quota dédié que l'analyse vidéo (compteur mensuel séparé de la
  // création) : non-abonné 1 (sur ses 5 gratuites), Creator 6/mois, Pro
  // 15/mois. Au-delà, un jeton en débloque une de plus, décompté côté
  // serveur au moment de l'appel.
  const droit = await droitAnalyseVirale();
  if (!droit.ok) {
    if (droit.raison === 'expire') { gererAbonnementExpire(); return; }
    if (droit.raison === 'quota') {
      err.textContent = 'Tu as atteint ta limite d\'analyses vidéo ce mois-ci (' + droit.limite + '). Elle se recharge le 1er du mois prochain.';
      err.style.display = 'block';
      return;
    }
    openPlans('nouveau');
    return;
  }

  const btnId = type === 'transcription' ? 'outilsTranscriptionBtn' : 'outilsTelechargementBtn';
  const spinId = type === 'transcription' ? 'outilsTranscriptionSpinner' : 'outilsTelechargementSpinner';
  const txtId = type === 'transcription' ? 'outilsTranscriptionBtnText' : 'outilsTelechargementBtnText';
  const autreBtnId = type === 'transcription' ? 'outilsTelechargementBtn' : 'outilsTranscriptionBtn';
  const btn = document.getElementById(btnId);
  const spin = document.getElementById(spinId);
  const txt = document.getElementById(txtId);
  const autreBtn = document.getElementById(autreBtnId);
  const label = txt.textContent;

  btn.disabled = true;
  if (autreBtn) autreBtn.disabled = true;
  if (spin) spin.style.display = 'inline-block';
  txt.textContent = type === 'transcription' ? 'Transcription…' : 'Recherche…';

  try {
    if (type === 'transcription') {
      const data = await _outilsFetch('/api/video-stt', lien);
      if (!data.ok || !data.transcript) {
        throw new Error(data.raison === 'sans_parole'
          ? "Cette vidéo ne contient pas de parole détectable."
          : "Impossible de récupérer cette vidéo. Vérifie le lien.");
      }
      _outilsDecompteApresSucces();
      afficherResultatTranscription(data);
    } else {
      const data = await _outilsFetch('/api/tiktok-download', lien);
      if (!data.ok || !data.videoUrl) {
        throw new Error("Vidéo indisponible au téléchargement direct pour l'instant. Réessaie plus tard, ou avec un autre lien.");
      }
      _outilsDecompteApresSucces();
      afficherResultatTelechargement(data);
    }
  } catch (e) {
    err.textContent = e.message || 'Une erreur est survenue, réessaie.';
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    if (autreBtn) autreBtn.disabled = false;
    if (spin) spin.style.display = 'none';
    txt.textContent = label;
  }
}

async function _outilsFetch(route, url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    if (r.status === 403) {
      let payload = null;
      try { payload = await r.json(); } catch (e) {}
      if (payload && payload.error && payload.error.code === 'QUOTA_ATTEINT') {
        throw new Error(payload.error.message || 'Quota atteint.');
      }
      if (typeof gererAbonnementExpire === 'function') gererAbonnementExpire();
      throw new Error('Accès refusé.');
    }
    const data = await r.json();
    if (!r.ok) throw new Error((data && data.error && data.error.message) || 'Erreur serveur.');
    return data;
  } finally { clearTimeout(minuteur); }
}

function afficherResultatTranscription(data) {
  _outilsTranscript = data.transcript || '';
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = 'none';
  const res = document.getElementById('outilsResults');
  res.innerHTML = `
    <div class="outils-result-card">
      <h3>📝 Transcription</h3>
      <div class="outils-transcript">${outilsEsc(_outilsTranscript)}</div>
      <button class="btn-generate" id="outilsCopyBtn" style="width:100%" onclick="copySection('outilsCopyBtn', _outilsTranscript)">Copier le texte</button>
    </div>
    <button class="btn-back" style="margin-top:18px" onclick="outilsAutreVideo()">← Essayer un autre lien</button>
  `;
  res.style.display = 'block';
}

function afficherResultatTelechargement(data) {
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = 'none';
  const res = document.getElementById('outilsResults');
  res.innerHTML = `
    <div class="outils-result-card">
      <h3>⬇️ Téléchargement</h3>
      ${data.description ? `<div class="outils-dl-desc">${outilsEsc(data.description)}</div>` : ''}
      <a class="btn-generate" style="width:100%;text-decoration:none;box-sizing:border-box" href="${outilsEsc(data.videoUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir la vidéo ⬇️</a>
      <p class="outils-dl-note">Le lien s'ouvre dans un nouvel onglet (sans filigrane si disponible) : fais un clic droit → « Enregistrer la vidéo sous » pour la sauvegarder. Ce lien peut expirer après quelques minutes, télécharge rapidement.</p>
    </div>
    <button class="btn-back" style="margin-top:18px" onclick="outilsAutreVideo()">← Essayer un autre lien</button>
  `;
  res.style.display = 'block';
}

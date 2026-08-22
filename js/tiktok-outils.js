// ═══════════════════════════════════════════════════════════
//  MODULE « OUTILS TIKTOK » (service annexe, hors modes de création)
//  Deux actions indépendantes à partir d'un même lien : transcription
//  (texte parlé, via /api/tiktok-video?action=transcription, déjà utilisé
//  en interne par le mode Analyse vidéo virale) et téléchargement (la
//  vidéo elle-même, via /api/tiktok-video?action=download, proxy même
//  origine pour permettre le partage natif). Même quota mensuel que
//  l'analyse vidéo (droitAnalyseVirale, js/historique.js) : mêmes API
//  payées mises à contribution.
// ═══════════════════════════════════════════════════════════

function outilsEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let _outilsTranscript = ''; // pour les boutons Copier/Partager
let _outilsVideoBlob = null; // vidéo déjà récupérée, pour le bouton Télécharger (pas de 2e appel serveur)

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
  const btnT = document.getElementById('outilsTranscriptionBtn');
  const btnD = document.getElementById('outilsTelechargementBtn');
  if (btnT) btnT.classList.remove('actif');
  if (btnD) btnD.classList.remove('actif');
  _outilsMasquerProgBar();
  _outilsTranscript = '';
  _outilsVideoBlob = null;
}

// Bande dorée de progression estimée, même moteur que le storyboard
// (createProgress, js/storyboard.js) : monte de façon crédible pendant que
// l'API travaille (téléchargement de la vidéo + transcription côté serveur,
// nettement plus long qu'une génération texte, d'où une durée estimée plus
// longue), jamais un simple cercle sans indication de progression.
function _outilsMasquerProgBar() {
  const pb = document.getElementById('outilsProgBar');
  if (pb) pb.style.display = 'none';
  const fill = document.getElementById('outilsProgFill');
  if (fill) fill.style.width = '0%';
  const pct = document.getElementById('outilsProgPct');
  if (pct) pct.textContent = '0%';
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
  btn.classList.add('actif');
  if (autreBtn) autreBtn.disabled = true;
  if (spin) spin.style.display = 'inline-block';
  // Un seul libellé fixe pendant toute l'action (jamais "Recherche…" PUIS
  // "Préparation de la vidéo…") : un texte qui change en cours de route peut
  // changer de largeur et forcer le bouton à passer sur 2 lignes, donc à
  // grandir, un redimensionnement gênant vu que les deux boutons sont
  // côte à côte (voir .outils-btn-row, largeur égale flex:1 sur les deux).
  txt.textContent = type === 'transcription' ? 'Transcription…' : 'Téléchargement…';

  const progBar = document.getElementById('outilsProgBar');
  const progFill = document.getElementById('outilsProgFill');
  const progPct = document.getElementById('outilsProgPct');
  // Durée estimée plus longue que pour une génération texte : la vidéo est
  // téléchargée puis (pour la transcription) transcrite côté serveur.
  const dureeEstimee = type === 'transcription' ? 16000 : 10000;
  const prog = (typeof createProgress === 'function')
    ? createProgress((p) => { if (progFill) progFill.style.width = p + '%'; if (progPct) progPct.textContent = p + '%'; }, dureeEstimee)
    : null;
  if (progBar) progBar.style.display = 'flex';
  if (prog) prog.start();

  try {
    if (type === 'transcription') {
      const data = await _outilsFetchJson('/api/tiktok-video?action=transcription', lien);
      if (!data.ok || !data.transcript) {
        throw new Error(data.raison === 'sans_parole'
          ? "Cette vidéo ne contient pas de parole détectable."
          : "Impossible de récupérer cette vidéo. Vérifie le lien.");
      }
      if (prog) prog.finish();
      _outilsDecompteApresSucces();
      // Empile l'écran nu (formulaire encore visible ici) AVANT de passer
      // au résultat : un « ← Retour » depuis le résultat retombe ainsi sur
      // ce même écran, lien encore rempli, jamais sur l'accueil (même
      // mécanique que lancerAnalyseVirale, js/viral.js).
      if (typeof pushNav === 'function') pushNav();
      afficherResultatTranscription(data);
    } else {
      const blob = await _outilsFetchVideo(lien);
      if (prog) prog.finish();
      _outilsDecompteApresSucces();
      if (typeof pushNav === 'function') pushNav();
      afficherResultatTelechargement(blob);
    }
  } catch (e) {
    if (prog) prog.stop();
    _outilsMasquerProgBar();
    btn.classList.remove('actif'); // échec : pas de résultat à mettre en avant
    err.textContent = e.message || 'Une erreur est survenue, réessaie.';
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    if (autreBtn) autreBtn.disabled = false;
    if (spin) spin.style.display = 'none';
    txt.textContent = label;
  }
}

async function _outilsGererErreurReponse(r) {
  if (r.status === 403) {
    let payload = null;
    try { payload = await r.json(); } catch (e) {}
    if (payload && payload.error && payload.error.code === 'QUOTA_ATTEINT') {
      throw new Error(payload.error.message || 'Quota atteint.');
    }
    if (typeof gererAbonnementExpire === 'function') gererAbonnementExpire();
    throw new Error('Accès refusé.');
  }
  if (!r.ok) {
    let payload = null;
    try { payload = await r.json(); } catch (e) {}
    throw new Error((payload && payload.error && payload.error.message) || 'Erreur serveur.');
  }
}

// Transcription : JSON classique (texte, pas de gros volume).
async function _outilsFetchJson(route, url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    await _outilsGererErreurReponse(r);
    return await r.json();
  } finally { clearTimeout(minuteur); }
}

// Téléchargement : la vidéo elle-même (voir api/tiktok-video.js action
// download, proxy même origine, nécessaire pour le partage natif
// ci-dessous, un fetch() direct vers le CDN TikTok échouerait la plupart
// du temps, CORS).
async function _outilsFetchVideo(url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 55000);
  try {
    const params = new URLSearchParams({ action: 'download', url, code_acces: localStorage.getItem('scriptura_code') || '' });
    const r = await fetch('/api/tiktok-video?' + params.toString(), { signal: ctrl.signal });
    await _outilsGererErreurReponse(r);
    return await r.blob();
  } finally { clearTimeout(minuteur); }
}

// L'API de transcription (ElevenLabs) renvoie un seul bloc de texte continu,
// sans aucun paragraphe. On le regroupe par phrases (splitIntoSentences,
// déjà utilisé pour le découpage narratif du storyboard, voir js/storyboard.js)
// pour une lecture confortable, plutôt qu'un pavé de texte ininterrompu.
function formaterTranscriptEnParagraphes(texte) {
  if (typeof splitIntoSentences !== 'function') return texte || '';
  const phrases = splitIntoSentences(texte);
  if (!phrases.length) return texte || '';
  const paragraphes = [];
  for (let i = 0; i < phrases.length; i += 3) {
    paragraphes.push(phrases.slice(i, i + 3).join(' '));
  }
  return paragraphes.join('\n\n');
}

function afficherResultatTranscription(data) {
  _outilsTranscript = formaterTranscriptEnParagraphes(data.transcript || '');
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = 'none';
  const res = document.getElementById('outilsResults');
  res.innerHTML = `
    <div class="outils-result-card">
      <h3>${ICO('pen')} Transcription</h3>
      <div class="outils-transcript">${outilsEsc(_outilsTranscript)}</div>
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier" id="outilsCopyBtn" onclick="copySection('outilsCopyBtn', _outilsTranscript)">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, _outilsTranscript)">${ICON_SHARE}</button>
      </div>
    </div>
    <button class="btn-back" style="margin-top:18px" onclick="outilsAutreVideo()">← Essayer un autre lien</button>
  `;
  res.style.display = 'block';
}

function afficherResultatTelechargement(blob) {
  _outilsVideoBlob = blob;
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = 'none';
  const res = document.getElementById('outilsResults');
  res.innerHTML = `
    <div class="outils-result-card">
      <h3>${ICO('download')} Téléchargement</h3>
      <p class="outils-dl-desc">Ta vidéo est prête.</p>
      <button class="btn-generate" id="outilsDlBtn" style="width:100%" onclick="outilsPartagerVideo()">Télécharger la vidéo</button>
      <p class="outils-dl-note">Sur téléphone, ça ouvre la fenêtre de partage pour l'enregistrer directement dans ta galerie. Sur ordinateur, elle se télécharge normalement.</p>
    </div>
    <button class="btn-back" style="margin-top:18px" onclick="outilsAutreVideo()">← Essayer un autre lien</button>
  `;
  res.style.display = 'block';
}

// Ouvre la feuille de partage native (fichier déjà en main, pas de nouvel
// appel serveur) pour enregistrer directement dans la galerie/pellicule.
// Repli desktop : téléchargement classique (voir telechargerBlob,
// js/montage.js, même mécanique que « Télécharger la vidéo » du montage).
async function outilsPartagerVideo() {
  if (!_outilsVideoBlob) return;
  const btn = document.getElementById('outilsDlBtn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }
  try {
    const fichier = new File([_outilsVideoBlob], 'scriptura-tiktok.mp4', { type: _outilsVideoBlob.type || 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: 'Vidéo TikTok' });
    } else if (typeof telechargerBlob === 'function') {
      telechargerBlob(_outilsVideoBlob, 'scriptura-tiktok.mp4');
    }
  } catch (e) {
    // Annulation du partage par l'utilisateur : on ne fait rien.
    if (!(e && e.name === 'AbortError') && typeof telechargerBlob === 'function') {
      telechargerBlob(_outilsVideoBlob, 'scriptura-tiktok.mp4');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// ═══════════════════════════════════════════════════════════
//  MODULE « OUTILS TIKTOK » (service annexe, hors modes de création)
//  Deux actions indépendantes à partir d'un même lien OU d'un fichier
//  uploadé depuis la galerie : transcription (texte parlé, via
//  /api/tiktok-video?action=transcription pour un lien TikTok, ou
//  /api/transcribe-upload pour un fichier) et téléchargement (la vidéo
//  elle-même, via /api/tiktok-video?action=download). Même quota mensuel
//  que l'analyse vidéo (droitAnalyseVirale, js/historique.js).
//
//  Depuis l'ajout du mode fichier : deux modes exclusifs, choisis par
//  radio button. En mode fichier, le téléchargement n'est pas proposé
//  (pas de source TikTok à télécharger).
// ═══════════════════════════════════════════════════════════

function outilsEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let _outilsTranscript = '';        // pour les boutons Copier/Partager
let _outilsVideoBlob = null;       // vidéo déjà récupérée, pour le bouton Télécharger
let _outilsMode = 'lien';          // 'lien' | 'fichier'
let _outilsFichier = null;         // File object si mode fichier
const OUTILS_TAILLE_MAX_MO = 100;

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
  _outilsMode = 'lien';
  _outilsFichier = null;
  const info = document.getElementById('outilsFichierInfo');
  if (info) { info.style.display = 'none'; info.innerHTML = ''; }
  outilsChoisirMode('lien');
}

function outilsChoisirMode(mode) {
  _outilsMode = (mode === 'fichier') ? 'fichier' : 'lien';
  const btnLien = document.getElementById('outilsModeLienBtn');
  const btnFichier = document.getElementById('outilsModeFichierBtn');
  if (btnLien) btnLien.classList.toggle('actif', _outilsMode === 'lien');
  if (btnFichier) btnFichier.classList.toggle('actif', _outilsMode === 'fichier');
  const champLien = document.getElementById('outilsChampLien');
  const champFichier = document.getElementById('outilsChampFichier');
  if (champLien) champLien.style.display = _outilsMode === 'lien' ? '' : 'none';
  if (champFichier) champFichier.style.display = _outilsMode === 'fichier' ? '' : 'none';
  const err = document.getElementById('outilsError');
  if (err) err.style.display = 'none';
}

function outilsChargerFichier(files) {
  const err = document.getElementById('outilsError');
  const info = document.getElementById('outilsFichierInfo');
  if (!files || !files.length) return;
  const f = files[0];
  if (f.size > OUTILS_TAILLE_MAX_MO * 1024 * 1024) {
    _outilsFichier = null;
    if (info) { info.style.display = 'none'; info.innerHTML = ''; }
    if (err) {
      err.textContent = 'Fichier trop lourd (max ' + OUTILS_TAILLE_MAX_MO + ' Mo).';
      err.style.display = 'block';
    }
    return;
  }
  _outilsFichier = f;
  if (err) err.style.display = 'none';
  if (info) {
    info.style.display = 'block';
    info.className = 'outils-fichier-info';
    info.innerHTML = '📎 <strong>' + outilsEsc(f.name) + '</strong> (' + (f.size / 1024 / 1024).toFixed(1) + ' Mo) prêt.';
  }
}

// Bande dorée de progression estimée, même moteur que le storyboard
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

// Décompte les compteurs client après un succès.
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

  // Détermine la source : fichier (mode galerie) ou lien (mode TikTok).
  let lien = '';
  let fichier = null;
  if (type === 'transcription' && _outilsMode === 'fichier') {
    if (!_outilsFichier) {
      err.textContent = 'Choisis une vidéo dans ta galerie.';
      err.style.display = 'block';
      return;
    }
    fichier = _outilsFichier;
  } else {
    lien = (document.getElementById('outilsLien').value || '').trim();
    if (!lien) {
      err.textContent = "Colle le lien TikTok d'une vidéo.";
      err.style.display = 'block';
      return;
    }
  }

  // Même quota dédié que l'analyse vidéo, fichier ou lien.
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
  const icoId = type === 'transcription' ? 'outilsTranscriptionIco' : 'outilsTelechargementIco';
  const btn = document.getElementById(btnId);
  const spin = document.getElementById(spinId);
  const txt = document.getElementById(txtId);
  const ico = document.getElementById(icoId);
  const autreBtn = document.getElementById(autreBtnId);
  const label = txt.textContent;

  btn.disabled = true;
  btn.classList.add('actif');
  if (autreBtn) autreBtn.disabled = true;
  if (ico) ico.style.display = 'none';
  if (spin) spin.style.display = 'inline-block';
  txt.textContent = type === 'transcription' ? 'Transcription…' : 'Téléchargement…';

  const progBar = document.getElementById('outilsProgBar');
  const progFill = document.getElementById('outilsProgFill');
  const progPct = document.getElementById('outilsProgPct');
  const dureeEstimee = type === 'transcription' ? (fichier ? 30000 : 16000) : 10000;
  const prog = (typeof createProgress === 'function')
    ? createProgress((p) => { if (progFill) progFill.style.width = p + '%'; if (progPct) progPct.textContent = p + '%'; }, dureeEstimee)
    : null;
  if (progBar) progBar.style.display = 'flex';
  if (prog) prog.start();

  try {
    if (fichier) {
      // Chemin fichier : upload direct Supabase (aucun octet via Vercel,
      // qui plafonne à 4,5 Mo) puis appel /api/transcribe-upload qui fait
      // le reste. Voir api/transcribe-upload.js et js/api.js.
      if (progPct) progPct.textContent = '0%';
      if (txt) txt.textContent = 'Envoi…';
      const nomSafe = fichier.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(-60);
      const chemin = 'transcriptions/' + Date.now() + '-' + nomSafe;
      await uploaderAssetMontage(chemin, fichier, fichier.type || 'video/mp4');
      if (txt) txt.textContent = 'Transcription…';
      const r = await fetch('/api/transcribe-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chemin, code_acces: localStorage.getItem('scriptura_code') || null })
      });
      await _outilsGererErreurReponse(r);
      const data = await r.json();
      if (!data.ok || !data.transcript) {
        throw new Error(data.raison === 'sans_parole'
          ? "Cette vidéo ne contient pas de parole détectable."
          : (data.error?.message || "Transcription impossible."));
      }
      if (prog) prog.finish();
      _outilsDecompteApresSucces();
      if (typeof pushNav === 'function') pushNav();
      afficherResultatTranscription(data);
    } else if (type === 'transcription') {
      const data = await _outilsFetchJson('/api/tiktok-video?action=transcription', lien);
      if (!data.ok || !data.transcript) {
        throw new Error(data.raison === 'sans_parole'
          ? "Cette vidéo ne contient pas de parole détectable."
          : "Impossible de récupérer cette vidéo. Vérifie le lien.");
      }
      if (prog) prog.finish();
      _outilsDecompteApresSucces();
      if (typeof pushNav === 'function') pushNav();
      afficherResultatTranscription(data);
    } else {
      const { blob, meta } = await _outilsFetchVideo(lien);
      if (prog) prog.finish();
      _outilsDecompteApresSucces();
      if (typeof pushNav === 'function') pushNav();
      afficherResultatTelechargement(blob, meta);
    }
  } catch (e) {
    if (prog) prog.stop();
    _outilsMasquerProgBar();
    btn.classList.remove('actif');
    err.textContent = e.message || 'Une erreur est survenue, réessaie.';
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    if (autreBtn) autreBtn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (ico) ico.style.display = '';
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
    if (payload && payload.error && payload.error.code === 'ABONNEMENT_EXPIRE' && typeof gererAbonnementExpire === 'function') {
      gererAbonnementExpire();
    }
    throw new Error((payload && payload.error && payload.error.message) || 'Accès refusé.');
  }
  if (!r.ok) {
    let payload = null;
    try { payload = await r.json(); } catch (e) {}
    throw new Error((payload && payload.error && payload.error.message) || 'Erreur serveur.');
  }
}

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

async function _outilsFetchVideo(url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 55000);
  try {
    const params = new URLSearchParams({ action: 'download', url, code_acces: localStorage.getItem('scriptura_code') || '' });
    const r = await fetch('/api/tiktok-video?' + params.toString(), { signal: ctrl.signal });
    await _outilsGererErreurReponse(r);
    let meta = null;
    try {
      const brut = r.headers.get('X-Scriptura-Meta');
      if (brut) {
        const octets = Uint8Array.from(atob(brut), c => c.charCodeAt(0));
        meta = JSON.parse(new TextDecoder('utf-8').decode(octets));
      }
    } catch (e) { meta = null; }
    const blob = await r.blob();
    return { blob, meta };
  } finally { clearTimeout(minuteur); }
}

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

const _OUTILS_LANGUES = {
  fr: '🇫🇷 Français', en: '🇬🇧 Anglais', es: '🇪🇸 Espagnol', pt: '🇵🇹 Portugais',
  ar: '🇸🇦 Arabe', de: '🇩🇪 Allemand', it: '🇮🇹 Italien', nl: '🇳🇱 Néerlandais',
  sw: '🇰🇪 Swahili', ha: '🇳🇬 Haoussa', yo: '🇳🇬 Yoruba', wo: '🇸🇳 Wolof',
  zh: '🇨🇳 Chinois', tr: '🇹🇷 Turc', ru: '🇷🇺 Russe', hi: '🇮🇳 Hindi',
  ja: '🇯🇵 Japonais', ko: '🇰🇷 Coréen'
};
function _outilsNomLangue(code) {
  if (!code) return null;
  return _OUTILS_LANGUES[String(code).toLowerCase().slice(0, 2)] || String(code).toUpperCase();
}

function _outilsCompterMots(texte) {
  return (String(texte || '').trim().match(/\S+/g) || []).length;
}

function _outilsTelechargerTxt() {
  if (!_outilsTranscript || typeof telechargerBlob !== 'function') return;
  const blob = new Blob([_outilsTranscript], { type: 'text/plain;charset=utf-8' });
  telechargerBlob(blob, 'transcription-tiktok.txt');
}

function _outilsCarteSourceHtml(meta) {
  meta = meta || {};
  const auteur = meta.auteur || {};
  const nom = auteur.nickname || (auteur.uniqueId ? '@' + auteur.uniqueId : 'Vidéo TikTok');
  const initiale = (auteur.nickname || auteur.uniqueId || 'T').trim().charAt(0).toUpperCase();
  const avatarImg = auteur.avatarUrl
    ? `<img class="outils-source-avatar-img" src="${outilsEsc(auteur.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"/>`
    : '';
  const dateStr = meta.createTime
    ? new Date(meta.createTime * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const s = meta.stats || {};
  const statsHtml = (s.vues || s.likes || s.commentaires || s.partages) ? `
    <div class="ds-stats-row" style="justify-content:flex-start;margin-top:14px">
      ${s.vues != null ? `<div class="ds-stat-item">${ICO('eye')}<span class="ds-stat-num">${formaterNombre(s.vues)}</span></div>` : ''}
      ${s.likes != null ? `<div class="ds-stat-item">${ICO('heart')}<span class="ds-stat-num">${formaterNombre(s.likes)}</span></div>` : ''}
      ${s.commentaires != null ? `<div class="ds-stat-item">${ICO('comment')}<span class="ds-stat-num">${formaterNombre(s.commentaires)}</span></div>` : ''}
      ${s.partages != null ? `<div class="ds-stat-item">${ICO('share')}<span class="ds-stat-num">${formaterNombre(s.partages)}</span></div>` : ''}
    </div>` : '';
  if (!auteur.nickname && !auteur.uniqueId && !dateStr && !meta.description && !statsHtml) return '';
  return `
    <div class="outils-source-card">
      <div class="outils-source-head">
        <div class="outils-source-avatar">${outilsEsc(initiale)}${avatarImg}</div>
        <div class="outils-source-id">
          <div class="outils-source-nom">${outilsEsc(nom)}</div>
          ${auteur.uniqueId && auteur.nickname ? `<div class="outils-source-handle">@${outilsEsc(auteur.uniqueId)}</div>` : ''}
        </div>
        ${dateStr ? `<div class="outils-source-date">${dateStr}</div>` : ''}
      </div>
      ${meta.description ? `<p class="outils-source-desc">${outilsEsc(meta.description)}</p>` : ''}
      ${statsHtml}
    </div>`;
}

function afficherResultatTranscription(data) {
  _outilsTranscript = formaterTranscriptEnParagraphes(data.transcript || '');
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = 'none';

  const langueTag = _outilsNomLangue(data.langue);
  const nbMots = _outilsCompterMots(data.transcript);
  // En mode fichier, pas de lien TikTok : le bouton Télécharger n'a rien
  // à télécharger, on le masque. Le texte « Essayer un autre lien » devient
  // « Essayer une autre vidéo ».
  const depuisFichier = _outilsMode === 'fichier';

  const res = document.getElementById('outilsResults');
  res.innerHTML = `
    ${_outilsCarteSourceHtml(data)}

    <div class="outils-transcript-controls">
      ${langueTag ? `<span class="ds-tag">${langueTag}</span>` : ''}
      <span class="outils-word-count">${nbMots} mot${nbMots > 1 ? 's' : ''} extrait${nbMots > 1 ? 's' : ''}</span>
      <button class="outils-mini-btn" onclick="_outilsTelechargerTxt()">${ICO('download')} .txt</button>
      <button class="outils-mini-btn" id="outilsCopyBtn" onclick="copySection('outilsCopyBtn', _outilsTranscript)">${ICO('clipboard')} Copier</button>
      <button class="outils-mini-btn" onclick="shareText(this, _outilsTranscript)">${ICO('share')} Partager</button>
    </div>

    <div class="outils-result-card" style="margin-top:0">
      <div class="outils-transcript">${outilsEsc(_outilsTranscript)}</div>
    </div>
    <div class="err" id="outilsTelechargerDepuisTranscriptionError" style="display:none;margin-top:14px"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-top:18px">
      <button class="btn-back" style="margin-bottom:0" onclick="outilsAutreVideo()">← Essayer ${depuisFichier ? 'une autre vidéo' : 'un autre lien'}</button>
      ${depuisFichier ? '' : `
        <button class="outils-mini-btn" id="outilsTelechargerDepuisTranscriptionBtn" onclick="outilsTelechargerDepuisTranscription(this)">
          <span class="sb-gen-spinner" id="outilsTelechargerDepuisTranscriptionSpinner" style="display:none"></span>
          <span id="outilsTelechargerDepuisTranscriptionTxt" style="display:inline-flex;align-items:center;gap:6px">${ICO('download')} Télécharger</span>
        </button>
      `}
    </div>
  `;
  res.style.display = 'block';
}

async function outilsTelechargerDepuisTranscription(btn) {
  const lienEl = document.getElementById('outilsLien');
  const lien = (lienEl && lienEl.value || '').trim();
  const err = document.getElementById('outilsTelechargerDepuisTranscriptionError');
  const spin = document.getElementById('outilsTelechargerDepuisTranscriptionSpinner');
  const txt = document.getElementById('outilsTelechargerDepuisTranscriptionTxt');
  if (err) err.style.display = 'none';
  if (!lien) return;

  const droit = await droitAnalyseVirale();
  if (!droit.ok) {
    if (droit.raison === 'expire') { gererAbonnementExpire(); return; }
    if (err) {
      err.textContent = droit.raison === 'quota'
        ? "Tu as atteint ta limite d'analyses vidéo ce mois-ci (" + droit.limite + ")."
        : "Débloque Scriptura pour télécharger cette vidéo.";
      err.style.display = 'block';
    }
    if (droit.raison !== 'quota' && droit.raison !== 'expire') openPlans('nouveau');
    return;
  }

  btn.disabled = true;
  if (spin) spin.style.display = 'inline-block';
  if (txt) txt.style.display = 'none';
  try {
    const { blob } = await _outilsFetchVideo(lien);
    _outilsDecompteApresSucces();
    _outilsVideoBlob = blob;
    await outilsPartagerVideo();
  } catch (e) {
    if (err) {
      err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
      err.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (txt) txt.style.display = '';
  }
}

function afficherResultatTelechargement(blob, meta) {
  _outilsVideoBlob = blob;
  const form = document.getElementById('outilsForm');
  if (form) form.style.display = 'none';
  const res = document.getElementById('outilsResults');
  res.innerHTML = `
    ${_outilsCarteSourceHtml(meta)}
    <div class="outils-result-card" style="margin-top:${meta ? '18px' : '24px'}">
      <h3>${ICO('download')} Téléchargement</h3>
      <p class="outils-dl-desc">Ta vidéo est prête.</p>
      <button class="btn-generate" id="outilsDlBtn" style="width:100%" onclick="outilsPartagerVideo()">Télécharger la vidéo</button>
      <p class="outils-dl-note">Sur téléphone, ça ouvre la fenêtre de partage pour l'enregistrer directement dans ta galerie. Sur ordinateur, elle se télécharge normalement.</p>
    </div>
    <div class="err" id="outilsTranscrireDepuisTelechargementError" style="display:none;margin-top:14px"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-top:18px">
      <button class="btn-back" style="margin-bottom:0" onclick="outilsAutreVideo()">← Essayer un autre lien</button>
      <button class="outils-mini-btn" id="outilsTranscrireDepuisTelechargementBtn" onclick="outilsTranscrireDepuisTelechargement(this)">
        <span class="sb-gen-spinner" id="outilsTranscrireDepuisTelechargementSpinner" style="display:none"></span>
        <span id="outilsTranscrireDepuisTelechargementTxt" style="display:inline-flex;align-items:center;gap:6px">${ICO('pen')} Transcrire</span>
      </button>
    </div>
    <div id="outilsTranscritDepuisTelechargement"></div>
  `;
  res.style.display = 'block';
}

async function outilsTranscrireDepuisTelechargement(btn) {
  const lienEl = document.getElementById('outilsLien');
  const lien = (lienEl && lienEl.value || '').trim();
  const err = document.getElementById('outilsTranscrireDepuisTelechargementError');
  const spin = document.getElementById('outilsTranscrireDepuisTelechargementSpinner');
  const txt = document.getElementById('outilsTranscrireDepuisTelechargementTxt');
  if (err) err.style.display = 'none';
  if (!lien) return;

  const droit = await droitAnalyseVirale();
  if (!droit.ok) {
    if (droit.raison === 'expire') { gererAbonnementExpire(); return; }
    if (err) {
      err.textContent = droit.raison === 'quota'
        ? "Tu as atteint ta limite d'analyses vidéo ce mois-ci (" + droit.limite + ")."
        : "Débloque Scriptura pour transcrire cette vidéo.";
      err.style.display = 'block';
    }
    if (droit.raison !== 'quota' && droit.raison !== 'expire') openPlans('nouveau');
    return;
  }

  btn.disabled = true;
  if (spin) spin.style.display = 'inline-block';
  if (txt) txt.style.display = 'none';
  try {
    const data = await _outilsFetchJson('/api/tiktok-video?action=transcription', lien);
    if (!data.ok || !data.transcript) {
      throw new Error(data.raison === 'sans_parole'
        ? "Cette vidéo ne contient pas de parole détectable."
        : "Impossible de récupérer cette vidéo. Vérifie le lien.");
    }
    _outilsDecompteApresSucces();
    _outilsTranscript = formaterTranscriptEnParagraphes(data.transcript || '');
    const langueTag = _outilsNomLangue(data.langue);
    const nbMots = _outilsCompterMots(data.transcript);
    const zone = document.getElementById('outilsTranscritDepuisTelechargement');
    if (zone) {
      zone.innerHTML = `
        <div class="outils-transcript-controls" style="margin-top:18px">
          ${langueTag ? `<span class="ds-tag">${langueTag}</span>` : ''}
          <span class="outils-word-count">${nbMots} mot${nbMots > 1 ? 's' : ''} extrait${nbMots > 1 ? 's' : ''}</span>
          <button class="outils-mini-btn" onclick="_outilsTelechargerTxt()">${ICO('download')} .txt</button>
          <button class="outils-mini-btn" id="outilsCopyBtn" onclick="copySection('outilsCopyBtn', _outilsTranscript)">${ICO('clipboard')} Copier</button>
          <button class="outils-mini-btn" onclick="shareText(this, _outilsTranscript)">${ICO('share')} Partager</button>
        </div>
        <div class="outils-result-card" style="margin-top:14px">
          <div class="outils-transcript">${outilsEsc(_outilsTranscript)}</div>
        </div>`;
    }
    btn.style.display = 'none';
  } catch (e) {
    if (err) {
      err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
      err.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (txt) txt.style.display = '';
  }
}

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
    if (!(e && e.name === 'AbortError') && typeof telechargerBlob === 'function') {
      telechargerBlob(_outilsVideoBlob, 'scriptura-tiktok.mp4');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

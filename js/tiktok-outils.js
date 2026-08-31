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
  // L'icône laisse place au spinner pendant l'action (échange icône ↔ spinner).
  if (ico) ico.style.display = 'none';
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
      const { blob, meta } = await _outilsFetchVideo(lien);
      if (prog) prog.finish();
      _outilsDecompteApresSucces();
      if (typeof pushNav === 'function') pushNav();
      afficherResultatTelechargement(blob, meta);
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
    // Métadonnées (auteur, date, stats) passées par en-tête (voir
    // handleDownload, api/tiktok-video.js) : le corps reste le flux vidéo
    // brut. Best-effort, jamais bloquant si absent/illisible. atob() seul
    // renvoie une chaîne "binaire" (1 caractère = 1 octet) : un JSON.parse
    // direct dessus donne un texte accentué corrompu (chaque octet UTF-8
    // lu comme un caractère Latin-1 séparé), d'où le passage par
    // TextDecoder pour redécoder correctement l'UTF-8 d'origine.
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

// Langue détectée par ElevenLabs Scribe (code ISO 639-1) -> nom affichable.
// Sert d'étiquette informative seulement, jamais d'un contrôle : un code
// non répertorié s'affiche tel quel (en majuscules), jamais une erreur.
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

// Nombre de mots du transcript BRUT (avant mise en paragraphes, qui ne
// touche que les sauts de ligne, jamais les mots eux-mêmes).
function _outilsCompterMots(texte) {
  return (String(texte || '').trim().match(/\S+/g) || []).length;
}

function _outilsTelechargerTxt() {
  if (!_outilsTranscript || typeof telechargerBlob !== 'function') return;
  const blob = new Blob([_outilsTranscript], { type: 'text/plain;charset=utf-8' });
  telechargerBlob(blob, 'transcription-tiktok.txt');
}

// Carte "source" de la vidéo (auteur, date, description, stats), commune à
// la transcription et au téléchargement (même style, retour du
// propriétaire) : jamais d'avatar image (URLs TikHub signées à durée de
// vie courte, voir extraireAuteurInfo, api/_lib/tiktok-media.js), un badge
// à initiale à la place.
function _outilsCarteSourceHtml(meta) {
  meta = meta || {};
  const auteur = meta.auteur || {};
  const nom = auteur.nickname || (auteur.uniqueId ? '@' + auteur.uniqueId : 'Vidéo TikTok');
  const initiale = (auteur.nickname || auteur.uniqueId || 'T').trim().charAt(0).toUpperCase();
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
        <div class="outils-source-avatar">${outilsEsc(initiale)}</div>
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
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-top:18px">
      <button class="btn-back" style="margin-bottom:0" onclick="outilsAutreVideo()">← Essayer un autre lien</button>
      <button class="btn-storyboard" id="outilsTelechargerDepuisTranscriptionBtn" onclick="outilsTelechargerDepuisTranscription(this)">
        <span class="sb-gen-spinner" id="outilsTelechargerDepuisTranscriptionSpinner" style="display:none"></span>
        <span id="outilsTelechargerDepuisTranscriptionTxt">${ICO('download')} Télécharger la vidéo</span>
      </button>
    </div>
  `;
  res.style.display = 'block';
}

// Depuis le résultat de la TRANSCRIPTION, télécharge la même vidéo (même
// lien déjà utilisé) sans quitter cette page (retour du propriétaire) :
// déclenche directement le partage natif / téléchargement du fichier
// (voir outilsPartagerVideo), la transcription affichée reste intacte à
// l'écran, pas de changement d'écran vers le résultat "téléchargement".
async function outilsTelechargerDepuisTranscription(btn) {
  const lienEl = document.getElementById('outilsLien');
  const lien = (lienEl && lienEl.value || '').trim();
  const err = document.getElementById('outilsTelechargerDepuisTranscriptionError');
  const spin = document.getElementById('outilsTelechargerDepuisTranscriptionSpinner');
  const txt = document.getElementById('outilsTelechargerDepuisTranscriptionTxt');
  if (err) err.style.display = 'none';
  if (!lien) return;

  // Même quota dédié que la transcription (droitAnalyseVirale) : télécharger
  // après avoir transcrit consomme une 2e unité, une vraie 2e opération.
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

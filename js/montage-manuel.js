// ═══════════════════════════════════════════════════════════
//  MONTAGE MANUEL (Outils TikTok → « Monter une vidéo »)
//  Variante du montage vidéo (voir js/montage.js) qui ne part PAS d'un
//  storyboard généré par l'IA : le fondateur uploade directement ses
//  propres images et sa propre voix off (fichier existant OU texte à
//  transformer via ElevenLabs, au choix). Réservé au fondateur (voir
//  .outils-montage-btn, css/style.css, body.is-admin) : le rendu FFmpeg
//  reste coûteux, même restriction que le montage depuis le storyboard,
//  re-vérifiée côté serveur par /api/montage-render (resoudreDroits/
//  isAdmin), jamais fiée au seul CSS.
//  Réutilise volontairement le pipeline déjà en place : /api/montage-render
//  (proxy Railway ou repli FFmpeg local, selon MONTAGE_RENDER_URL),
//  /api/montage-media (voix ElevenLabs), et les fonctions de partage/
//  téléchargement de js/montage.js (partagerVideoMontage, prechargerVideoMontage,
//  montageStatutHTML), plutôt que de dupliquer cette logique.
// ═══════════════════════════════════════════════════════════

let omImages = [];         // [{ file, url }], dans l'ordre d'ajout = ordre du montage
let omAudio = null;        // { blob, url, duree, source: 'upload'|'ia', nom? }
let omModeVoix = 'upload'; // 'upload' | 'ia'
let omVoixListe = [];      // [{ id, label }], voix ElevenLabs configurées côté serveur
let omVoixId = '';
let omTexteNarration = '';
let omVoixEnCours = false;
let omEnCours = false;

function omResetState() {
  omImages.forEach(im => URL.revokeObjectURL(im.url));
  omImages = [];
  if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
  omAudio = null;
  omModeVoix = 'upload';
  omVoixId = '';
  omTexteNarration = '';
  omVoixEnCours = false;
  omEnCours = false;
  const err = document.getElementById('omErreur');
  if (err) err.style.display = 'none';
  const statut = document.getElementById('omStatut');
  if (statut) statut.style.display = 'none';
  const resultat = document.getElementById('omResultat');
  if (resultat) resultat.innerHTML = '';
  const btnUpload = document.getElementById('omModeUploadBtn');
  const btnIa = document.getElementById('omModeIaBtn');
  if (btnUpload) btnUpload.classList.add('actif');
  if (btnIa) btnIa.classList.remove('actif');
}

function ouvrirOutilsMontage() {
  omResetState();
  const lienBloc = document.getElementById('outilsLienBloc');
  const form = document.getElementById('outilsMontageForm');
  if (lienBloc) lienBloc.style.display = 'none';
  if (form) form.style.display = 'block';
  omChargerVoix();
  omRenderImages();
  omRenderVoixZone();
  omMajBoutonLancer();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function fermerOutilsMontage() {
  const form = document.getElementById('outilsMontageForm');
  const lienBloc = document.getElementById('outilsLienBloc');
  if (form) form.style.display = 'none';
  if (lienBloc) lienBloc.style.display = '';
}

// ── IMAGES ──
function omAjouterImages(fileList) {
  const fichiers = Array.prototype.filter.call(fileList || [], f => f.type && f.type.startsWith('image/'));
  fichiers.forEach(f => omImages.push({ file: f, url: URL.createObjectURL(f) }));
  const input = document.getElementById('omImagesInput');
  if (input) input.value = ''; // permet de resélectionner le même fichier après un retrait
  omRenderImages();
  omMajBoutonLancer();
}

function omRetirerImage(i) {
  const [retire] = omImages.splice(i, 1);
  if (retire) URL.revokeObjectURL(retire.url);
  omRenderImages();
  omMajBoutonLancer();
}

function omRenderImages() {
  const zone = document.getElementById('omImagesThumbs');
  const compte = document.getElementById('omImagesCompte');
  if (compte) compte.textContent = String(omImages.length);
  if (!zone) return;
  zone.innerHTML = omImages.map((im, i) => `
    <div class="audit-thumb">
      <img src="${im.url}" alt="image ${i + 1}"/>
      <button class="audit-thumb-del" onclick="omRetirerImage(${i})" title="Retirer">✕</button>
    </div>`).join('');
}

// Déduit l'extension réelle du fichier (nom, sinon type MIME) : cosmétique
// pour le chemin de stockage, le Content-Type servi vient du contentType
// passé à l'upload, pas de cette extension, mais plus lisible/débogable
// qu'un ".jpg" générique sur un PNG ou WEBP.
function omExtensionDeFichier(f) {
  const m = /\.([a-z0-9]+)$/i.exec((f && f.name) || '');
  if (m) return m[1].toLowerCase();
  const type = (f && f.type) || '';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

// ── VOIX OFF ──
async function omChargerVoix() {
  try {
    const rep = await fetch('/api/montage-media?action=voices');
    const data = await rep.json();
    omVoixListe = Array.isArray(data.voices) ? data.voices : [];
  } catch (e) {
    omVoixListe = [];
  }
  // Une seule voix disponible : rien à choisir, on la prend directement
  // (même comportement que chargerVoixMontage, js/montage.js).
  omVoixId = omVoixListe.length === 1 ? omVoixListe[0].id : '';
  if (omModeVoix === 'ia') omRenderVoixZone();
}

function omChoisirModeVoix(mode) {
  if (mode === omModeVoix) return;
  omModeVoix = mode;
  const btnUpload = document.getElementById('omModeUploadBtn');
  const btnIa = document.getElementById('omModeIaBtn');
  if (btnUpload) btnUpload.classList.toggle('actif', mode === 'upload');
  if (btnIa) btnIa.classList.toggle('actif', mode === 'ia');
  omRenderVoixZone();
}

// Voix choisie dans le menu déroulant : ne redessine PAS toute la zone (le
// select serait reconstruit et perdrait visuellement la sélection qu'on
// vient de faire, initCustomSelect ne relit que le HTML au moment du
// rendu) — juste le nécessaire si une voix off IA existante ne correspond
// plus à la voix choisie.
function omChangerVoix(id) {
  if (id === omVoixId) return;
  omVoixId = id;
  if (omAudio && omAudio.source === 'ia') {
    if (omAudio.url) URL.revokeObjectURL(omAudio.url);
    omAudio = null;
    omMajBoutonLancer();
    const audioEl = document.querySelector('#omVoixZone .montage-audio-preview');
    if (audioEl) audioEl.remove();
    const genBtn = document.querySelector('#omVoixZone .btn-regenerate');
    if (genBtn) genBtn.textContent = 'Générer la voix off';
  }
}

function omRenderVoixZone() {
  const zone = document.getElementById('omVoixZone');
  if (!zone) return;
  if (omModeVoix === 'upload') {
    const preview = (omAudio && omAudio.source === 'upload')
      ? `<div style="margin-top:10px">
           <audio class="montage-audio-preview" src="${omAudio.url}" controls></audio>
           <div class="montage-statut" style="margin:6px 0 0">${outilsEsc(omAudio.nom)} · ${Math.round(omAudio.duree)}s</div>
         </div>`
      : '';
    zone.innerHTML = `
      <input type="file" id="omAudioInput" accept="audio/*" style="display:none" onchange="omAudioFichierChoisi(this.files[0])"/>
      <button class="btn-regenerate" type="button" onclick="document.getElementById('omAudioInput').click()">${omAudio && omAudio.source === 'upload' ? '↻ Changer de fichier' : 'Choisir un fichier audio'}</button>
      ${preview}`;
    return;
  }
  // Marque l'option effectivement choisie (omVoixId) pour que le select
  // reconstruit reste cohérent avec l'état, même après un rendu déclenché
  // pendant la génération (ex. bouton passé sur "Génération…").
  let selectHtml = '';
  if (omVoixListe.length > 1) {
    const options = ['<option value=""' + (omVoixId ? '' : ' selected') + '>Choisis une voix…</option>']
      .concat(omVoixListe.map(v => `<option value="${v.id}"${v.id === omVoixId ? ' selected' : ''}>${outilsEsc(v.label)}</option>`));
    selectHtml = `<select class="ctx-input" id="omVoixSelect" style="margin-top:10px" onchange="omChangerVoix(this.value)">${options.join('')}</select>`;
  }
  const preview = (omAudio && omAudio.source === 'ia')
    ? `<audio class="montage-audio-preview" src="${omAudio.url}" controls style="margin-top:10px"></audio>`
    : '';
  zone.innerHTML = `
    <textarea class="ctx-input" id="omTexteNarration" rows="4" placeholder="Écris ou colle le texte de la narration…" oninput="omTexteNarration=this.value">${outilsEsc(omTexteNarration)}</textarea>
    ${selectHtml}
    <button class="btn-regenerate" type="button" style="margin-top:10px" ${omVoixEnCours ? 'disabled' : ''} onclick="omGenererVoixOff()">${omVoixEnCours ? 'Génération…' : (omAudio && omAudio.source === 'ia' ? '↻ Régénérer la voix off' : 'Générer la voix off')}</button>
    ${preview}`;
}

// Lit la durée réelle d'un fichier audio uploadé via l'élément <audio>
// (aucun aller-retour serveur nécessaire, contrairement à la génération IA
// qui la reçoit d'ElevenLabs).
function omLireDureeAudio(fichier) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fichier);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve({ url, duree: audio.duration || 0 });
    audio.onerror = () => resolve({ url, duree: 0 });
    audio.src = url;
  });
}

async function omAudioFichierChoisi(fichier) {
  if (!fichier) return;
  if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
  const { url, duree } = await omLireDureeAudio(fichier);
  omAudio = { blob: fichier, url, duree, nom: fichier.name, source: 'upload' };
  omRenderVoixZone();
  omMajBoutonLancer();
}

async function omGenererVoixOff() {
  const err = document.getElementById('omErreur');
  if (err) err.style.display = 'none';
  if (omVoixEnCours) return;
  const texteEl = document.getElementById('omTexteNarration');
  const texte = ((texteEl ? texteEl.value : omTexteNarration) || '').trim();
  omTexteNarration = texte;
  if (!texte) {
    if (err) { err.textContent = "Écris ou colle le texte de la narration."; err.style.display = 'block'; }
    return;
  }
  if (omVoixListe.length > 1 && !omVoixId) {
    if (err) { err.textContent = "Choisis d'abord une voix."; err.style.display = 'block'; }
    return;
  }

  omVoixEnCours = true;
  omRenderVoixZone();
  try {
    const rep = await fetch('/api/montage-media?action=tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: [texte], voiceId: omVoixId, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    if (!rep.ok || !data.audioBase64) throw new Error((data.error && data.error.message) || "La voix off n'a pas pu être générée.");
    if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
    const blob = base64VersBlob(data.audioBase64, data.mimeType || 'audio/mpeg');
    const duree = (Array.isArray(data.durations) && data.durations[0]) || 0;
    omAudio = { blob, url: URL.createObjectURL(blob), duree, source: 'ia' };
  } catch (e) {
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
  } finally {
    omVoixEnCours = false;
    omRenderVoixZone();
    omMajBoutonLancer();
  }
}

function omMajBoutonLancer() {
  const btn = document.getElementById('omLancerBtn');
  if (!btn) return;
  btn.disabled = omEnCours || !omImages.length || !omAudio || !(omAudio.duree > 0);
}

// Devine le format de sortie (9:16 / 16:9 / 1:1) depuis les proportions de
// la première image, plutôt qu'imposer toujours du portrait : des images
// déjà carrées ou en paysage, forcées en 9:16 par le service de rendu
// (crop centré, voir render-service/server.js), perdraient une bonne
// partie du cadrage.
function omDetecterFormat() {
  return new Promise((resolve) => {
    if (!omImages.length) return resolve('9:16');
    const img = new Image();
    img.onload = () => {
      const r = img.naturalWidth / (img.naturalHeight || 1);
      const cibles = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };
      let meilleur = '9:16', ecart = Infinity;
      for (const f in cibles) {
        const e = Math.abs(r - cibles[f]);
        if (e < ecart) { ecart = e; meilleur = f; }
      }
      resolve(meilleur);
    };
    img.onerror = () => resolve('9:16');
    img.src = omImages[0].url;
  });
}

async function omLancerMontage() {
  const err = document.getElementById('omErreur');
  const statut = document.getElementById('omStatut');
  const resultat = document.getElementById('omResultat');
  if (err) err.style.display = 'none';
  if (omEnCours || !omImages.length || !omAudio || !(omAudio.duree > 0)) return;
  if (!supabaseClient) {
    if (err) { err.textContent = 'Connexion au stockage indisponible.'; err.style.display = 'block'; }
    return;
  }

  omEnCours = true;
  omMajBoutonLancer();
  if (resultat) resultat.innerHTML = '';
  if (statut) { statut.style.display = 'block'; statut.innerHTML = montageStatutHTML('Envoi des fichiers…'); }

  try {
    const dossier = 'montage-manuel-' + Date.now();
    // Pas de découpage narratif par plan ici (contrairement au montage
    // depuis un storyboard) : chaque image reçoit une part égale de la
    // durée réelle de la voix off, seule information de durée disponible
    // pour un montage assemblé à la main.
    const dureeParImage = omAudio.duree / omImages.length;

    const images = [];
    try {
      for (let i = 0; i < omImages.length; i++) {
        const chemin = dossier + '/img-' + (i + 1) + '.' + omExtensionDeFichier(omImages[i].file);
        const { error } = await supabaseClient.storage.from('montages').upload(chemin, omImages[i].file, { contentType: omImages[i].file.type || 'image/jpeg' });
        if (error) throw new Error(error.message);
        const { data } = supabaseClient.storage.from('montages').getPublicUrl(chemin);
        images.push({ url: data.publicUrl, duration: dureeParImage });
      }
    } catch (e) { throw new Error('Upload des images : ' + e.message); }

    let audioUrl;
    try {
      const extAudio = omAudio.source === 'ia' ? 'mp3' : omExtensionDeFichier({ name: omAudio.nom });
      const cheminAudio = dossier + '/voix-off.' + extAudio;
      const { error: errAudio } = await supabaseClient.storage.from('montages').upload(cheminAudio, omAudio.blob, { contentType: omAudio.blob.type || 'audio/mpeg' });
      if (errAudio) throw new Error(errAudio.message);
      audioUrl = supabaseClient.storage.from('montages').getPublicUrl(cheminAudio).data.publicUrl;
    } catch (e) { throw new Error('Upload de la voix off : ' + e.message); }

    if (statut) statut.innerHTML = montageStatutHTML("Montage en cours (peut prendre plusieurs minutes selon le nombre d'images)…");
    const format = await omDetecterFormat();
    let dataRender;
    try {
      const rRender = await fetch('/api/montage-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, audioUrl, format, code_acces: localStorage.getItem('scriptura_code') || null })
      });
      dataRender = await rRender.json();
      if (!rRender.ok || !dataRender.url) throw new Error((dataRender.error && dataRender.error.message) || "Le montage n'a pas pu être généré.");
    } catch (e) { throw new Error('Rendu de la vidéo : ' + e.message); }

    if (statut) statut.style.display = 'none';
    // Précharge la vidéo dès qu'elle existe pour que le partage natif iOS
    // (partagerVideoMontage, js/montage.js) fonctionne sans aller-retour
    // réseau au clic, même mécanisme que le montage depuis le storyboard.
    montageVideoFichierPromise = prechargerVideoMontage(dataRender.url);
    if (resultat) resultat.innerHTML = `
      <video class="montage-video" src="${outilsEsc(dataRender.url)}" controls playsinline></video>
      <button class="btn-regenerate" style="display:inline-block;margin-top:12px" onclick="partagerVideoMontage(this, '${outilsEsc(dataRender.url)}')" type="button">Télécharger la vidéo</button>`;
  } catch (e) {
    if (statut) statut.style.display = 'none';
    if (err) { err.textContent = e.message; err.style.display = 'block'; }
  } finally {
    omEnCours = false;
    omMajBoutonLancer();
  }
}

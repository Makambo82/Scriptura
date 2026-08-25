// ═══════════════════════════════════════════════════════════
//  MONTAGE MANUEL (carte "Monter une vidéo", accueil → Services annexes)
//  Outil à part entière (écran #montageManuelFlow dédié, retour direct :
//  jamais imbriqué dans l'écran Outils TikTok, même s'il en réutilise le
//  pipeline de rendu) qui ne part PAS d'un storyboard généré par l'IA : le
//  fondateur uploade directement ses propres images et sa propre voix off
//  (fichier existant OU texte à transformer via ElevenLabs, au choix).
//  Réservé au fondateur (voir .outils-montage-home-btn, css/style.css,
//  body.is-admin) : le rendu FFmpeg reste coûteux, même restriction que le
//  montage depuis le storyboard, re-vérifiée côté serveur par
//  /api/montage-render (resoudreDroits/isAdmin), jamais fiée au seul CSS.
//  Réutilise volontairement le pipeline déjà en place : /api/montage-render
//  (proxy Railway ou repli FFmpeg local, selon MONTAGE_RENDER_URL),
//  /api/montage-media (voix ElevenLabs), et les fonctions de partage/
//  téléchargement de js/montage.js (partagerVideoMontage, prechargerVideoMontage,
//  montageStatutHTML), plutôt que de dupliquer cette logique.
//
//  Synchro image/voix (retour direct : sans ça, chaque image affiche une
//  part ÉGALE de la voix off, sans lien avec ce qui est réellement dit à
//  ce moment) :
//  - Voix IA (ElevenLabs) : le texte doit compter UNE LIGNE PAR IMAGE,
//    chacune envoyée comme un segment séparé (mêmes horodatages caractère
//    par caractère qu'utilise déjà le montage depuis le storyboard, voir
//    api/montage-media.js), donc une vraie durée par image, pas une moyenne.
//  - Voix uploadée : aucun découpage n'est possible à deviner depuis un
//    simple fichier audio, donc la durée de chaque image reste réglable à
//    la main (omDureesManuelles), pré-remplie à parts égales.
// ═══════════════════════════════════════════════════════════

let omImages = [];           // [{ file, url }], dans l'ordre d'ajout = ordre du montage
let omAudio = null;          // { blob, url, duree, source: 'upload'|'ia', nom?, durations? }
let omDureesManuelles = [];  // [nombre, ...] durée (s) par image, mode 'upload' uniquement
let omModeVoix = 'upload';   // 'upload' | 'ia'
let omVoixListe = [];        // [{ id, label }], voix ElevenLabs configurées côté serveur
let omVoixId = '';
let omTexteNarration = '';
let omVoixEnCours = false;
let omEnCours = false;

function omResetState() {
  omImages.forEach(im => URL.revokeObjectURL(im.url));
  omImages = [];
  if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
  omAudio = null;
  omDureesManuelles = [];
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

// Point d'entrée unique, depuis la carte "Monter une vidéo" de l'accueil
// (section "Services annexes", voir index.html) : même mécanique que les
// autres écrans de premier niveau (pushNav + masquerTousLesEcrans, voir
// js/navigation.js), pas de sous-écran partagé avec un autre outil.
function ouvrirMontageManuelAccueil() {
  if (typeof pushNav === 'function') pushNav();
  if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
  omResetState();
  const ecran = document.getElementById('montageManuelFlow');
  if (ecran) ecran.style.display = 'block';
  omChargerVoix();
  omRenderImages();
  omRenderVoixZone();
  omMajBoutonLancer();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ── IMAGES ──
function omAjouterImages(fileList) {
  const fichiers = Array.prototype.filter.call(fileList || [], f => f.type && f.type.startsWith('image/'));
  fichiers.forEach(f => omImages.push({ file: f, url: URL.createObjectURL(f) }));
  const input = document.getElementById('omImagesInput');
  if (input) input.value = ''; // permet de resélectionner le même fichier après un retrait
  omApresChangementImages();
}

function omRetirerImage(i) {
  const [retire] = omImages.splice(i, 1);
  if (retire) URL.revokeObjectURL(retire.url);
  omApresChangementImages();
}

// Le nombre d'images conditionne la synchro (une ligne par image en mode
// IA, une durée par image en mode upload) : toute voix off déjà prête
// devient incohérente dès que la liste change, on l'invalide plutôt que de
// laisser un montage mal calé partir silencieusement.
function omApresChangementImages() {
  if (omAudio && omAudio.source === 'ia') {
    if (omAudio.url) URL.revokeObjectURL(omAudio.url);
    omAudio = null;
  }
  omDureesManuelles = [];
  omRenderImages();
  omRenderVoixZone();
  omMajBoutonLancer();
}

function omRenderImages() {
  const zone = document.getElementById('omImagesThumbs');
  const compte = document.getElementById('omImagesCompte');
  if (compte) compte.textContent = String(omImages.length);
  if (zone) {
    zone.innerHTML = omImages.map((im, i) => `
      <div class="audit-thumb">
        <img src="${im.url}" alt="image ${i + 1}"/>
        <button class="audit-thumb-del" onclick="omRetirerImage(${i})" title="Retirer">✕</button>
      </div>`).join('');
  }
  omRenderDureesManuelles();
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

// ── DURÉES MANUELLES (voix off uploadée uniquement) ──
function omInitDureesManuelles() {
  const part = omImages.length ? (omAudio.duree / omImages.length) : 0;
  omDureesManuelles = omImages.map(() => Math.round(part * 10) / 10);
}

function omRenderDureesManuelles() {
  const zone = document.getElementById('omDureesZone');
  if (!zone) return;
  if (omModeVoix !== 'upload' || !(omAudio && omAudio.source === 'upload') || !omImages.length) {
    zone.innerHTML = '';
    return;
  }
  if (omDureesManuelles.length !== omImages.length) omInitDureesManuelles();
  zone.innerHTML = `
    <div class="montage-statut" style="margin:14px 0 8px">Durée de chaque image (en secondes), à ajuster sur le rythme réel de la voix off :</div>
    ${omImages.map((im, i) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:28px;flex:0 0 auto;color:var(--text-secondary);font-size:0.82rem">#${i + 1}</span>
        <input type="number" min="0.1" step="0.1" class="ctx-input" style="width:90px;flex:0 0 auto" value="${omDureesManuelles[i]}" oninput="omDureeChangee(${i}, this.value)"/>
      </div>`).join('')}
    <div class="montage-statut" id="omDureesTotal"></div>`;
  omMajTotalDurees();
}

function omDureeChangee(i, valeur) {
  omDureesManuelles[i] = Math.max(0, parseFloat(valeur) || 0);
  omMajTotalDurees();
  omMajBoutonLancer();
}

function omMajTotalDurees() {
  const el = document.getElementById('omDureesTotal');
  if (!el || !omAudio) return;
  const total = omDureesManuelles.reduce((s, d) => s + d, 0);
  const ecart = Math.abs(total - omAudio.duree);
  el.textContent = `Total : ${total.toFixed(1)}s (voix off : ${omAudio.duree.toFixed(1)}s)`;
  // Simple indication visuelle, pas bloquante : un petit écart est recollé
  // par le service de rendu (dernière image étirée si besoin), un gros
  // écart signale probablement un oubli.
  el.style.color = ecart > 1 ? '#f0b429' : '';
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
  omRenderDureesManuelles();
}

// Voix choisie dans le menu déroulant : ne redessine PAS toute la zone (le
// select serait reconstruit et perdrait visuellement la sélection qu'on
// vient de faire) — juste le nécessaire si une voix off IA existante ne
// correspond plus à la voix choisie.
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
  const nbImages = omImages.length;
  const indication = nbImages
    ? `Une ligne de narration par image, dans l'ordre du montage (${nbImages} image${nbImages > 1 ? 's' : ''} → ${nbImages} ligne${nbImages > 1 ? 's' : ''}).`
    : "Ajoute d'abord tes images (une ligne de narration par image sera demandée).";
  // Barre de progression estimée pendant l'appel ElevenLabs (peut prendre
  // plusieurs dizaines de secondes sur un long texte, voir omGenererVoixOff) :
  // seulement visible pendant la génération, jamais affichée sinon.
  const progBar = omVoixEnCours
    ? `<div class="sb-progress-bar" id="omVoixProgBar" style="margin-top:10px">
         <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="omVoixProgFill"></div></div>
         <div class="sb-progress-bar-pct" id="omVoixProgPct">0%</div>
       </div>`
    : '';
  zone.innerHTML = `
    <div class="montage-statut" style="margin-bottom:6px">${indication}</div>
    <textarea class="ctx-input" id="omTexteNarration" rows="4" placeholder="Ligne 1 pour l'image 1…&#10;Ligne 2 pour l'image 2…" oninput="omTexteNarration=this.value" ${omVoixEnCours ? 'disabled' : ''}>${outilsEsc(omTexteNarration)}</textarea>
    ${selectHtml}
    <button class="btn-regenerate" type="button" style="margin-top:10px" ${omVoixEnCours ? 'disabled' : ''} onclick="omGenererVoixOff()">${omVoixEnCours ? 'Génération…' : (omAudio && omAudio.source === 'ia' ? '↻ Régénérer la voix off' : 'Générer la voix off')}</button>
    ${progBar}
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
  omDureesManuelles = []; // recalculées (parts égales) au prochain rendu, voir omInitDureesManuelles
  omRenderVoixZone();
  omRenderDureesManuelles();
  omMajBoutonLancer();
}

async function omGenererVoixOff() {
  const err = document.getElementById('omErreur');
  if (err) err.style.display = 'none';
  if (omVoixEnCours) return;
  if (!omImages.length) {
    if (err) { err.textContent = 'Ajoute d\'abord tes images.'; err.style.display = 'block'; }
    return;
  }
  const texteEl = document.getElementById('omTexteNarration');
  const texteBrut = (texteEl ? texteEl.value : omTexteNarration) || '';
  omTexteNarration = texteBrut;
  // Une ligne par image, dans l'ordre : chaque ligne devient un segment
  // ElevenLabs séparé, avec sa VRAIE durée (horodatage caractère par
  // caractère), pas une moyenne (voir en-tête de fichier).
  const lignes = texteBrut.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lignes.length !== omImages.length) {
    if (err) {
      err.textContent = `Écris exactement une ligne de narration par image (${omImages.length} image${omImages.length > 1 ? 's' : ''}, ${lignes.length} ligne${lignes.length > 1 ? 's' : ''} détectée${lignes.length > 1 ? 's' : ''}).`;
      err.style.display = 'block';
    }
    return;
  }
  if (omVoixListe.length > 1 && !omVoixId) {
    if (err) { err.textContent = "Choisis d'abord une voix."; err.style.display = 'block'; }
    return;
  }

  omVoixEnCours = true;
  omRenderVoixZone();
  // Durée estimée proportionnelle au texte (lecture ElevenLabs + traitement) :
  // un texte de 53 lignes prend nettement plus longtemps qu'une seule ligne,
  // une durée fixe donnerait une barre trompeuse dans un sens ou l'autre.
  const dureeEstimee = Math.max(8000, texteBrut.length * 60);
  const prog = createProgress((p) => {
    const fill = document.getElementById('omVoixProgFill');
    const pct = document.getElementById('omVoixProgPct');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }, dureeEstimee);
  prog.start();
  try {
    const rep = await fetch('/api/montage-media?action=tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: lignes, voiceId: omVoixId, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    if (!rep.ok || !data.audioBase64) throw new Error((data.error && data.error.message) || "La voix off n'a pas pu être générée.");
    const durations = Array.isArray(data.durations) ? data.durations : [];
    // Défense en profondeur (retour direct du propriétaire : bouton "Démarrer
    // le montage" resté grisé sans explication) : le serveur est censé refuser
    // avant de répondre si le nombre de segments ne correspond pas (voir
    // api/montage-media.js), mais si jamais cette égalité n'est pas
    // respectée pour une autre raison, mieux vaut un message clair ici
    // qu'une voix off en apparence prête mais un montage bloqué en silence.
    if (durations.length !== lignes.length) {
      throw new Error(`Réponse incohérente du serveur : ${durations.length} durée(s) reçue(s) pour ${lignes.length} ligne(s).`);
    }
    if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
    const blob = base64VersBlob(data.audioBase64, data.mimeType || 'audio/mpeg');
    const duree = durations.reduce((s, d) => s + d, 0);
    prog.finish();
    omAudio = { blob, url: URL.createObjectURL(blob), duree, durations, source: 'ia' };
  } catch (e) {
    prog.stop();
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
  let voixPrete = false;
  if (omAudio && omAudio.duree > 0) {
    voixPrete = omAudio.source === 'ia'
      ? (Array.isArray(omAudio.durations) && omAudio.durations.length === omImages.length)
      : (omDureesManuelles.length === omImages.length && omDureesManuelles.every(d => d > 0));
  }
  btn.disabled = omEnCours || !omImages.length || !voixPrete;
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
  const durees = omAudio.source === 'ia' ? omAudio.durations : omDureesManuelles;
  if (!Array.isArray(durees) || durees.length !== omImages.length || durees.some(d => !(d > 0))) return;
  if (!supabaseClient) {
    if (err) { err.textContent = 'Connexion au stockage indisponible.'; err.style.display = 'block'; }
    return;
  }

  omEnCours = true;
  omMajBoutonLancer();
  if (resultat) resultat.innerHTML = '';
  if (statut) { statut.style.display = 'block'; statut.innerHTML = montageStatutHTML('Envoi des fichiers…'); }
  // Durée estimée proportionnelle au nombre d'images (upload + rendu FFmpeg,
  // plus long sur un montage à 50 images que sur un montage à 3) : une durée
  // fixe donnerait une barre trompeuse pour les gros montages comme les petits.
  const progBar = document.getElementById('omMontageProgBar');
  const dureeEstimeeMontage = Math.max(15000, omImages.length * 2500);
  const prog = createProgress((p) => {
    const fill = document.getElementById('omMontageProgFill');
    const pct = document.getElementById('omMontageProgPct');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }, dureeEstimeeMontage);
  if (progBar) progBar.style.display = 'flex';
  prog.start();

  try {
    const dossier = 'montage-manuel-' + Date.now();

    const images = [];
    try {
      for (let i = 0; i < omImages.length; i++) {
        const chemin = dossier + '/img-' + (i + 1) + '.' + omExtensionDeFichier(omImages[i].file);
        const { error } = await supabaseClient.storage.from('montages').upload(chemin, omImages[i].file, { contentType: omImages[i].file.type || 'image/jpeg' });
        if (error) throw new Error(error.message);
        const { data } = supabaseClient.storage.from('montages').getPublicUrl(chemin);
        images.push({ url: data.publicUrl, duration: durees[i] });
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

    prog.finish();
    if (statut) statut.style.display = 'none';
    if (progBar) progBar.style.display = 'none';
    // Précharge la vidéo dès qu'elle existe pour que le partage natif iOS
    // (partagerVideoMontage, js/montage.js) fonctionne sans aller-retour
    // réseau au clic, même mécanisme que le montage depuis le storyboard.
    montageVideoFichierPromise = prechargerVideoMontage(dataRender.url);
    if (resultat) resultat.innerHTML = `
      <video class="montage-video" src="${outilsEsc(dataRender.url)}" controls playsinline></video>
      <button class="btn-regenerate" style="display:inline-block;margin-top:12px" onclick="partagerVideoMontage(this, '${outilsEsc(dataRender.url)}')" type="button">Télécharger la vidéo</button>`;
  } catch (e) {
    prog.stop();
    if (statut) statut.style.display = 'none';
    if (progBar) progBar.style.display = 'none';
    if (err) { err.textContent = e.message; err.style.display = 'block'; }
  } finally {
    omEnCours = false;
    omMajBoutonLancer();
  }
}

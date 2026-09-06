// ═══════════════════════════════════════════════════════════
//  MONTAGE MANUEL (carte "Monter une vidéo", accueil → Services annexes)
//  Outil à part entière (écran #montageManuelFlow dédié, retour direct :
//  jamais imbriqué dans l'écran Outils TikTok, même s'il en réutilise le
//  pipeline de rendu) qui ne part PAS d'un storyboard généré par l'IA :
//  le créateur uploade directement ses propres images et sa propre voix off
//  (fichier existant OU texte à transformer via ElevenLabs, au choix).
//  Ouvert à Creator ET Pro (voir .outils-montage-home-btn, css/style.css,
//  body.peut-monter-video, ou body.is-admin pour le fondateur), même règle
//  que le montage depuis le storyboard, re-vérifiée côté serveur par
//  /api/montage-render (verifierAccesMontage), jamais fiée au seul CSS.
//  Réutilise volontairement le pipeline déjà en place : /api/montage-render
//  (proxy vers le service de rendu externe Railway),
//  /api/montage-media (voix ElevenLabs), et les fonctions de partage/
//  téléchargement de js/montage.js (partagerVideoMontage, prechargerVideoMontage),
//  plutôt que de dupliquer cette logique.
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
let omVoixListe = [];        // [{ id, label, description }], voix ElevenLabs configurées côté serveur
let omVoixId = '';
// Vitesse de lecture de la voix off (retour propriétaire), transmise à
// ElevenLabs (voice_settings.speed, voir api/montage-media.js). Plage
// 0.5-1.5 : au-delà, ElevenLabs déconseille (voix nettement déformée), voir
// commentaire équivalent dans js/montage.js.
const OM_VITESSES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
function omLabelVitesse(v) {
  if (v === 1) return '1x (normal)';
  if (v === 0.5) return '0,5x (très lent)';
  if (v === 1.5) return '1,5x (très rapide)';
  return String(v).replace('.', ',') + 'x';
}
let omVitesseVoix = 1;
let omTexteNarration = '';
let omVoixEnCours = false;
let omMusique = null;        // { blob, url }, musique de fond instrumentale générée par Eleven Music (optionnelle)
let omMusiqueEnCours = false;
// Volume de la musique de fond relatif à la voix off (retour propriétaire),
// même remarque que js/montage.js : purement un réglage de mélange au
// rendu, ne dépend pas du fichier musique déjà généré.
let omVolumeMusique = 0.15;
let omEnCours = false;

function omResetState() {
  omImages.forEach(im => URL.revokeObjectURL(im.url));
  omImages = [];
  if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
  omAudio = null;
  omDureesManuelles = [];
  omModeVoix = 'upload';
  omVoixId = '';
  omVitesseVoix = 1;
  omTexteNarration = '';
  omVoixEnCours = false;
  if (omMusique && omMusique.url) URL.revokeObjectURL(omMusique.url);
  omMusique = null;
  omMusiqueEnCours = false;
  omVolumeMusique = 0.15;
  omEnCours = false;
  const err = document.getElementById('omErreur');
  if (err) err.style.display = 'none';
  const statut = document.getElementById('omStatut');
  if (statut) statut.style.display = 'none';
  const resultat = document.getElementById('omResultat');
  if (resultat) resultat.innerHTML = '';
  // Sélecteur de volume musique statique (jamais reconstruit ailleurs) :
  // remis à 15% ici, même raison que le sélecteur de vitesse (js/montage.js).
  const selVolumeMusique = document.getElementById('omMusiqueVolumeSelect');
  if (selVolumeMusique) selVolumeMusique.value = '0.15';
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
// Verrouillées pendant la génération de la voix IA (retour audit) : si le
// nombre d'images retombe par coïncidence sur la même valeur après un
// ajout/retrait pendant la génération, la voix "prête" pouvait correspondre
// à un texte désynchronisé des images réellement affichées, sans que rien
// ne le signale.
function omAjouterImages(fileList) {
  if (omVoixEnCours) return;
  const fichiers = Array.prototype.filter.call(fileList || [], f => f.type && f.type.startsWith('image/'));
  fichiers.forEach(f => omImages.push({ file: f, url: URL.createObjectURL(f) }));
  const input = document.getElementById('omImagesInput');
  if (input) input.value = ''; // permet de resélectionner le même fichier après un retrait
  omApresChangementImages();
}

function omRetirerImage(i) {
  if (omVoixEnCours) return;
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
  omInvaliderResultat();
  omRenderImages();
  omRenderVoixZone();
  omMajBoutonLancer();
}

function omRenderImages() {
  const zone = document.getElementById('omImagesThumbs');
  const compte = document.getElementById('omImagesCompte');
  // Pastille d'état de l'en-tête "Images" (retour propriétaire : disposition
  // premium du montage) : verte dès qu'au moins une image est ajoutée.
  if (compte) {
    compte.textContent = String(omImages.length);
    compte.classList.toggle('montage-chip-pret', omImages.length > 0);
  }
  if (zone) {
    zone.innerHTML = omImages.map((im, i) => `
      <div class="audit-thumb">
        <img src="${im.url}" alt="image ${i + 1}"/>
        <button class="audit-thumb-del" onclick="omRetirerImage(${i})" title="Retirer" ${omVoixEnCours ? 'disabled' : ''}>✕</button>
      </div>`).join('');
  }
  // Images verrouillées pendant la génération de la voix IA (voir
  // omAjouterImages/omRetirerImage) : le bouton d'ajout doit refléter le
  // même verrou, pas juste les boutons de retrait individuels.
  const btnAjouter = document.getElementById('omAjouterImagesBtn');
  if (btnAjouter) btnAjouter.disabled = omVoixEnCours;
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
  omInvaliderResultat();
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
  // Bug corrigé (retour terrain, audit du 2 septembre 2026) : basculer de
  // mode laissait l'ancien omAudio (voix IA ou fichier importé) actif en
  // mémoire. Si le nombre d'images n'avait pas changé entre-temps, le bouton
  // "Démarrer le montage" pouvait rester activable et lancer un rendu avec
  // cette ANCIENNE voix (et ses sous-titres, s'ils étaient cochés), alors
  // que l'écran affichait le nouveau mode "rien choisi". On efface donc
  // systématiquement omAudio au changement de mode, même logique que
  // omChangerVoix/omChangerVitesse pour un changement de voix IA.
  if (omAudio) {
    if (omAudio.url) URL.revokeObjectURL(omAudio.url);
    omAudio = null;
  }
  omDureesManuelles = [];
  const btnUpload = document.getElementById('omModeUploadBtn');
  const btnIa = document.getElementById('omModeIaBtn');
  if (btnUpload) btnUpload.classList.toggle('actif', mode === 'upload');
  if (btnIa) btnIa.classList.toggle('actif', mode === 'ia');
  omInvaliderResultat();
  omRenderVoixZone();
  omRenderDureesManuelles();
  omMajBoutonLancer();
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
    omInvaliderResultat();
    omMajBoutonLancer();
    const audioEl = document.querySelector('#omVoixZone .montage-audio-preview');
    if (audioEl) audioEl.remove();
    const genBtn = document.querySelector('#omVoixZone .btn-regenerate');
    if (genBtn) { genBtn.textContent = 'Générer la voix off'; genBtn.classList.replace('btn-regenerate', 'btn-montage-primary'); }
    omMajChipVoix();
  }
}

// Même logique que omChangerVoix ci-dessus : une voix off IA déjà générée
// a été produite à l'ANCIENNE vitesse, elle ne correspond plus au réglage
// choisi, on l'invalide plutôt que de laisser un montage lancé sur un audio
// qui ne reflète pas la vitesse affichée.
function omChangerVitesse(v) {
  const vitesse = Number(v) || 1;
  if (vitesse === omVitesseVoix) return;
  omVitesseVoix = vitesse;
  if (omAudio && omAudio.source === 'ia') {
    if (omAudio.url) URL.revokeObjectURL(omAudio.url);
    omAudio = null;
    omInvaliderResultat();
    omMajBoutonLancer();
    const audioEl = document.querySelector('#omVoixZone .montage-audio-preview');
    if (audioEl) audioEl.remove();
    const genBtn = document.querySelector('#omVoixZone .btn-regenerate');
    if (genBtn) { genBtn.textContent = 'Générer la voix off'; genBtn.classList.replace('btn-regenerate', 'btn-montage-primary'); }
    omMajChipVoix();
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
    const boutonUploadClasse = (omAudio && omAudio.source === 'upload') ? 'btn-regenerate' : 'btn-montage-primary';
    zone.innerHTML = `
      <input type="file" id="omAudioInput" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" style="display:none" onchange="omAudioFichierChoisi(this.files[0])"/>
      <button class="${boutonUploadClasse}" type="button" onclick="document.getElementById('omAudioInput').click()">${omAudio && omAudio.source === 'upload' ? '↻ Changer de fichier' : 'Choisir un fichier audio'}</button>
      ${preview}`;
    omRenderMusiqueZone();
    omMajChipVoix();
    omMajCaseSousTitres();
    return;
  }
  // Marque l'option effectivement choisie (omVoixId) pour que le select
  // reconstruit reste cohérent avec l'état, même après un rendu déclenché
  // pendant la génération (ex. bouton passé sur "Génération…").
  let selectHtml = '';
  if (omVoixListe.length > 1) {
    const options = ['<option value=""' + (omVoixId ? '' : ' selected') + '>Choisis une voix…</option>']
      .concat(omVoixListe.map(v => `<option value="${v.id}"${v.id === omVoixId ? ' selected' : ''} data-description="${outilsEsc(v.description || '')}">${outilsEsc(v.label)}</option>`));
    selectHtml = `<select class="ctx-input" id="omVoixSelect" style="margin-top:10px" onchange="omChangerVoix(this.value)">${options.join('')}</select>`;
  }
  const vitesseOptions = OM_VITESSES.map(v => `<option value="${v}"${v === omVitesseVoix ? ' selected' : ''}>${omLabelVitesse(v)}</option>`).join('');
  const vitesseHtml = `<div class="montage-field" style="margin-top:12px">
    <label class="montage-field-label" for="omVitesseSelect">Vitesse de lecture</label>
    <select class="ctx-input" id="omVitesseSelect" onchange="omChangerVitesse(this.value)">${vitesseOptions}</select>
  </div>`;
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
         <div class="wait-badge"><span class="sb-progress-bar-pct" id="omVoixProgPct">0%</span></div>
         <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="omVoixProgFill"></div></div>
       </div>`
    : '';
  const boutonVoixClasse = (omAudio && omAudio.source === 'ia') ? 'btn-regenerate' : 'btn-montage-primary';
  zone.innerHTML = `
    <div class="montage-statut" style="margin-bottom:6px">${indication}</div>
    <textarea class="ctx-input" id="omTexteNarration" rows="4" placeholder="Ligne 1 pour l'image 1…&#10;Ligne 2 pour l'image 2…" oninput="omTexteNarration=this.value" ${omVoixEnCours ? 'disabled' : ''}>${outilsEsc(omTexteNarration)}</textarea>
    ${selectHtml}
    ${vitesseHtml}
    <button class="${boutonVoixClasse}" type="button" style="margin-top:12px" ${omVoixEnCours ? 'disabled' : ''} onclick="omGenererVoixOff()">${omVoixEnCours ? 'Génération…' : (omAudio && omAudio.source === 'ia' ? '↻ Régénérer la voix off' : 'Générer la voix off')}</button>
    ${progBar}
    ${preview}`;
  omRenderMusiqueZone();
  omMajChipVoix();
  omMajCaseSousTitres();
}

// Sous-titres incrustés : jamais possibles avec une voix off importée (pas
// d'horodatage, voir le commentaire dans omLancerMontage). Retour terrain :
// la case restait cochée et cliquable même en mode "upload", sans jamais
// rien faire au rendu, silencieusement. On la grise et on change la note
// pour que ce soit visible plutôt que deviné.
function omMajCaseSousTitres() {
  const checkbox = document.getElementById('omSousTitresCheckbox');
  const note = document.getElementById('omSousTitresNote');
  if (!checkbox) return;
  const dispo = omModeVoix === 'ia';
  checkbox.disabled = !dispo;
  if (note) note.textContent = dispo ? '(voix IA uniquement)' : '(indisponible : voix importée, pas d\'horodatage possible)';
}

// Pastille d'état de l'en-tête "Voix off" (retour propriétaire : disposition
// premium du montage), commune aux deux modes (upload/IA).
function omMajChipVoix() {
  const chip = document.getElementById('omVoixChip');
  if (!chip) return;
  chip.textContent = omAudio ? 'Prêt ✓' : (omVoixEnCours ? 'Génération…' : 'À faire');
  chip.classList.toggle('montage-chip-pret', !!omAudio);
}

// Lit la durée réelle d'un fichier audio uploadé via l'élément <audio>
// (aucun aller-retour serveur nécessaire, contrairement à la génération IA
// qui la reçoit d'ElevenLabs).
function omLireDureeAudio(fichier) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fichier);
    const audio = new Audio();
    audio.preload = 'metadata';
    const fini = (duree) => resolve({ url, duree: (Number.isFinite(duree) && duree > 0) ? duree : 0 });
    audio.onloadedmetadata = () => {
      // Bug connu Safari/WebKit (retour terrain : WAV valide "non reconnu"
      // sans aucun message) : la durée d'un blob audio reste parfois
      // Infinity tant qu'on n'a pas cherché une position, avant de se
      // corriger sur ontimeupdate. Sans ce contournement, ces fichiers
      // étaient silencieusement traités comme durée 0 (bouton "Démarrer
      // le montage" resté grisé, sans dire pourquoi).
      if (!Number.isFinite(audio.duration)) {
        audio.currentTime = 1e101;
        // Retour audit : sans filet, si ontimeupdate ne se déclenche jamais
        // (cas rare hors Safari), la promesse restait bloquée pour de bon,
        // sans erreur affichée. Le filet retombe sur duree:0, déjà le
        // signal existant pour afficher le message d'erreur prévu.
        const filet = setTimeout(() => { audio.ontimeupdate = null; fini(0); }, 3000);
        audio.ontimeupdate = () => { clearTimeout(filet); audio.ontimeupdate = null; fini(audio.duration); };
      } else {
        fini(audio.duration);
      }
    };
    audio.onerror = () => fini(0);
    audio.src = url;
  });
}

async function omAudioFichierChoisi(fichier) {
  if (!fichier) return;
  if (omAudio && omAudio.url) URL.revokeObjectURL(omAudio.url);
  const err = document.getElementById('omErreur');
  const { url, duree } = await omLireDureeAudio(fichier);
  omAudio = { blob: fichier, url, duree, nom: fichier.name, source: 'upload' };
  omDureesManuelles = []; // recalculées (parts égales) au prochain rendu, voir omInitDureesManuelles
  // Retour terrain : un fichier illisible par le navigateur (encodage WAV
  // non supporté, fichier corrompu) échouait avant sans AUCUN message, juste
  // un bouton qui restait grisé sans explication. omAudio reste quand même
  // renseigné (nom affiché, comme avant) : seul le bouton "Démarrer le
  // montage" reste bloqué tant que la durée est nulle.
  if (!duree) {
    if (err) { err.textContent = 'Ce fichier audio n\'a pas pu être lu par le navigateur (format ou encodage non supporté). Essaie un autre fichier, idéalement en MP3.'; err.style.display = 'block'; }
  } else if (err) {
    err.style.display = 'none';
  }
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
  omInvaliderResultat();

  omVoixEnCours = true;
  omRenderVoixZone();
  omRenderImages(); // verrouille visuellement l'ajout/retrait d'image pendant la génération
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
      body: JSON.stringify({ segments: lignes, voiceId: omVoixId, speed: omVitesseVoix, code_acces: localStorage.getItem('scriptura_code') || null })
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
    // Sous-titres (groupes "2 mots longs ou 3 mots courts", voir
    // api/montage-media.js) : seulement disponibles pour une voix off
    // générée par l'IA (horodatage ElevenLabs), jamais pour un fichier
    // audio uploadé par le créateur (source:'upload' plus bas, aucun
    // horodatage possible sans repasser par un service de transcription).
    omAudio = { blob, url: URL.createObjectURL(blob), duree, durations, source: 'ia', captions: Array.isArray(data.captions) ? data.captions : [] };
  } catch (e) {
    prog.stop();
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
    // Journalisé pour la carte "Échecs de génération" du Tableau de bord
    // (même mécanisme que callAI, js/api.js, et le diagnostic sommaire/
    // l'analyse virale) : ce flux appelle directement /api/montage-media,
    // jamais callAI, donc un échec ici restait invisible côté fondateur
    // (question directe après un vrai crash FFmpeg jamais vu au tableau
    // de bord). Fire-and-forget, ne doit jamais retarder l'affichage.
    try {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'erreur', mode: 'montageVoixOff', code: localStorage.getItem('scriptura_code') || null, detail: (e.message || 'erreur inconnue').slice(0, 200) })
      }).catch(() => {});
    } catch (e2) { /* silencieux */ }
  } finally {
    omVoixEnCours = false;
    omRenderVoixZone();
    omRenderImages(); // redéverrouille l'ajout/retrait d'image une fois la génération terminée
    omMajBoutonLancer();
  }
}

// Musique de fond instrumentale (retour propriétaire : le montage Scriptura
// "pas assez premium" comparé à un montage CapCut fait à la main). Générée
// via Eleven Music (api/montage-media.js, action=music), CALÉE SUR LA DURÉE
// DE LA VOIX OFF déjà prête (omAudio.duree, valable pour les deux sources :
// mesurée pour un fichier uploadé, somme des horodatages ElevenLabs pour une
// génération IA) : jamais lancée avant, pour connaître la durée totale
// exacte à demander. Toujours optionnelle (bouton "Retirer" plutôt qu'une
// case à cocher, voir omRenderMusiqueZone) : un montage sans musique reste
// valide, contrairement à la voix off.
async function omGenererMusique() {
  const err = document.getElementById('omErreur');
  if (err) err.style.display = 'none';
  if (omMusiqueEnCours || !omAudio || !(omAudio.duree > 0)) return;
  const dureeTotaleMs = Math.round(omAudio.duree * 1000);

  omMusiqueEnCours = true;
  omRenderMusiqueZone();
  // % estimé (même moteur que la voix off, createProgress), calé sur la
  // durée demandée : une musique de 90s prend plus longtemps à générer
  // qu'une de 10s.
  const progMusiqueOm = createProgress((p) => {
    const fill = document.getElementById('omMusiqueProgFill');
    const pct = document.getElementById('omMusiqueProgPct');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }, Math.max(12000, dureeTotaleMs * 0.4));
  progMusiqueOm.start();
  try {
    const rep = await fetch('/api/montage-media?action=music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dureeMs: dureeTotaleMs, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    if (!rep.ok || !data.audioBase64) throw new Error((data.error && data.error.message) || "La musique de fond n'a pas pu être générée.");
    if (omMusique && omMusique.url) URL.revokeObjectURL(omMusique.url);
    const blob = base64VersBlob(data.audioBase64, data.mimeType || 'audio/mpeg');
    omMusique = { blob, url: URL.createObjectURL(blob) };
    progMusiqueOm.finish();
  } catch (e) {
    progMusiqueOm.stop();
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
    try {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'erreur', mode: 'montageMusique', code: localStorage.getItem('scriptura_code') || null, detail: (e.message || 'erreur inconnue').slice(0, 200) })
      }).catch(() => {});
    } catch (e2) { /* silencieux */ }
  } finally {
    omMusiqueEnCours = false;
    omRenderMusiqueZone();
  }
}

function omRetirerMusique() {
  if (omMusique && omMusique.url) URL.revokeObjectURL(omMusique.url);
  omMusique = null;
  omRenderMusiqueZone();
}

function omChangerVolumeMusique(v) {
  omVolumeMusique = Number(v) || 0.15;
}

function omRenderMusiqueZone() {
  const zone = document.getElementById('omMusiqueZone');
  if (!zone) return;
  if (omMusiqueEnCours) {
    // % estimé, même moteur que la voix off (voir omGenererMusique).
    zone.innerHTML = `<div class="sb-progress-bar" id="omMusiqueProgBar" style="max-width:none;margin:0">
      <div class="wait-badge"><span class="sb-progress-bar-pct" id="omMusiqueProgPct">0%</span></div>
      <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="omMusiqueProgFill"></div></div>
    </div>`;
  } else if (omMusique) {
    zone.innerHTML = `
      <audio class="montage-audio-preview" src="${omMusique.url}" controls></audio>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <button class="btn-regenerate" onclick="omGenererMusique()" type="button">↻ Régénérer</button>
        <button class="btn-regenerate" onclick="omRetirerMusique()" type="button">Retirer</button>
      </div>`;
  } else {
    const pret = omAudio && omAudio.duree > 0;
    zone.innerHTML = `<button class="btn-montage-primary" onclick="omGenererMusique()" type="button" ${pret ? '' : 'disabled title="Génère d\'abord la voix off"'}>Générer une musique de fond</button>`;
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
  // Une vidéo déjà rendue (#omResultat non vide) : le bouton propose d'en
  // recommencer une nouvelle plutôt que de rester sur "Démarrer le montage"
  // (retour direct, capture d'écran : le bouton restait figé après succès).
  // omInvaliderResultat() vide #omResultat dès que l'utilisateur change quoi
  // que ce soit depuis (images, voix), donc ce simple test reste toujours
  // juste : jamais "vidéo prête" pour des réglages qui ont changé depuis.
  const resultat = document.getElementById('omResultat');
  const dejaRendu = !!(resultat && resultat.innerHTML.trim());
  btn.textContent = dejaRendu ? 'Monter une autre vidéo' : 'Démarrer le montage';
  btn.onclick = dejaRendu ? omNouveauMontage : omLancerMontage;
}

// Vide le résultat déjà rendu (vidéo + bouton téléchargement) dès que
// l'utilisateur change quoi que ce soit après un montage réussi (images,
// voix off) : sans ça, une ancienne vidéo restait affichée à côté de
// réglages qui ne lui correspondent plus, et le bouton "Monter une autre
// vidéo" (voir omMajBoutonLancer) serait trompeur, laissant croire à une
// vidéo à jour qui ne l'est plus.
function omInvaliderResultat() {
  const resultat = document.getElementById('omResultat');
  if (resultat) resultat.innerHTML = '';
}

// Appelé par le bouton "Monter une autre vidéo" (voir omMajBoutonLancer) :
// repart d'un montage vide sur ce même écran, sans revenir à l'accueil.
function omNouveauMontage() {
  omResetState();
  omRenderImages();
  omRenderVoixZone();
  omMajBoutonLancer();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  // Simple texte ici (pas de bande rayée décorative en plus) : la vraie
  // barre de progression avec pourcentage (#omMontageProgBar, juste en
  // dessous) existe déjà pour cette étape,
  // les deux ensemble donnaient deux barres empilées pour une seule attente
  // (retour direct après capture d'écran).
  if (statut) { statut.style.display = 'block'; statut.textContent = 'Envoi des fichiers…'; }
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

    // Musique de fond : optionnelle, seulement si générée (voir
    // omGenererMusique). Le rendu (render-service/server.js) la mélange sous
    // la voix off avec le volume automatiquement baissé.
    let musicUrl = '';
    if (omMusique) {
      try {
        const cheminMusique = dossier + '/musique.mp3';
        const { error: errMusique } = await supabaseClient.storage.from('montages').upload(cheminMusique, omMusique.blob, { contentType: 'audio/mpeg' });
        if (errMusique) throw new Error(errMusique.message);
        musicUrl = supabaseClient.storage.from('montages').getPublicUrl(cheminMusique).data.publicUrl;
      } catch (e) { throw new Error('Upload de la musique de fond : ' + e.message); }
    }

    if (statut) statut.textContent = "Montage en cours (peut prendre plusieurs minutes selon le nombre d'images)…";
    const format = await omDetecterFormat();
    // Sous-titres activables/désactivables avant de démarrer (retour
    // propriétaire), voir #omSousTitresCheckbox dans le HTML. Cochée par
    // défaut ; de toute façon jamais disponible pour une voix off
    // uploadée (aucun horodatage possible, voir omGenererVoixOff plus haut).
    const sousTitresActives = document.getElementById('omSousTitresCheckbox')?.checked !== false;
    let dataRender;
    try {
      const rRender = await fetch('/api/montage-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images, audioUrl, format,
          captions: (sousTitresActives && omAudio.source === 'ia' && omAudio.captions) || [],
          musicUrl, musicVolume: omVolumeMusique,
          // Filigrane Scriptura (retour propriétaire), coché par défaut.
          watermark: document.getElementById('omFiligraneCheckbox')?.checked !== false,
          code_acces: localStorage.getItem('scriptura_code') || null
        })
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
    montageVideoFichierPromiseParUrl.set(dataRender.url, prechargerVideoMontage(dataRender.url));
    if (resultat) resultat.innerHTML = `
      <video class="montage-video" src="${outilsEsc(dataRender.url)}" controls playsinline></video>
      <button class="btn-regenerate" style="display:inline-block;margin-top:12px" onclick="partagerVideoMontage(this, '${outilsEsc(dataRender.url)}')" type="button">Télécharger la vidéo</button>`;
  } catch (e) {
    prog.stop();
    if (statut) statut.style.display = 'none';
    if (progBar) progBar.style.display = 'none';
    if (err) { err.textContent = e.message; err.style.display = 'block'; }
    try {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'erreur', mode: 'montageRendu', code: localStorage.getItem('scriptura_code') || null, detail: (e.message || 'erreur inconnue').slice(0, 200) })
      }).catch(() => {});
    } catch (e2) { /* silencieux */ }
  } finally {
    omEnCours = false;
    omMajBoutonLancer();
  }
}

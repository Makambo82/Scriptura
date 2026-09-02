// ═══════════════════════════════════════════════════════════
//  MONTAGE VIDÉO, assemblage images + voix off, rendu par FFmpeg
//  auto-hébergé (voir api/montage-render.js).
//  Réservé au fondateur (bouton visible uniquement en body.is-admin).
//  Boucle complète : les images sont générées par Together AI (voir
//  api/montage-images.js) à partir des prompts visuels déjà écrits par
//  Scriptura pour chaque plan, et la voix off par ElevenLabs (voir
//  api/montage-tts.js) à partir du texte du storyboard, plus rien à
//  uploader manuellement. L'horodatage renvoyé par ElevenLabs donne la
//  durée EXACTE de chaque plan.
// ═══════════════════════════════════════════════════════════

// Le rendu passe TOUJOURS par /api/montage-render (dans ce dépôt), jamais
// par un appel direct du navigateur au service de rendu externe : l'URL et
// le jeton de ce service ne doivent JAMAIS vivre dans du JS servi au
// client (ce serait publié en clair pour n'importe qui, exactement comme
// une clé secrète collée dans le HTML). C'est /api/montage-render qui
// proxie vers le service externe si configuré (voir MONTAGE_RENDER_URL/
// MONTAGE_RENDER_TOKEN, variables d'environnement Vercel, et
// render-service/README.md pour le déploiement du service lui-même).

let montagePlans = [];      // [{ text, visuel }], un par plan du storyboard
let montageImages = [];     // [{ blob, apercu } | null], même ordre/longueur que montagePlans
let montageVoixOff = null;  // { blob, url, durations }, générée par ElevenLabs
let montageMusique = null;  // { blob, url }, musique de fond instrumentale générée par Eleven Music (optionnelle)
// Volume de la musique de fond relatif à la voix off (retour propriétaire),
// transmis au rendu (musicVolume, voir render-service/server.js pour le
// mélange amix). Purement un réglage de MÉLANGE : contrairement à la
// vitesse de la voix off, changer ce volume n'invalide jamais la musique
// déjà générée (le fichier audio lui-même ne change pas, seul son niveau au
// moment du mixage change).
let montageVolumeMusique = 0.15;
let montageEnCours = false;
let montageVoixEnCours = false;
let montageMusiqueEnCours = false;
let montageImagesEnCours = false;
let montageVoixListe = [];  // [{ id, label, description }], voix ElevenLabs configurées (voir api/montage-media.js action=voices)
let montageVoixId = '';     // id de la voix actuellement choisie
// Vitesse de lecture de la voix off (retour propriétaire), transmise à
// ElevenLabs (voice_settings.speed, voir api/montage-media.js). Plage
// 0.5-1.5 : au-delà, ElevenLabs déconseille (voix nettement déformée),
// même plage que le sélecteur de voix (jusqu'à 10 voix, 6 hommes/4 femmes).
const MONTAGE_VITESSES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
function montageLabelVitesse(v) {
  if (v === 1) return '1x (normal)';
  if (v === 0.5) return '0,5x (très lent)';
  if (v === 1.5) return '1,5x (très rapide)';
  return String(v).replace('.', ',') + 'x';
}
let montageVitesseVoix = 1;
let montageImageIndexEnCours = -1; // index du plan en cours de génération (-1 = aucun)
let montageVideoFichierPromise = null; // File préchargé de la vidéo rendue, voir partagerVideoMontage
let montageImagesSelection = new Set(); // indices des images cochées pour le téléchargement en lot
// Style graphique choisi AU MONTAGE (retour propriétaire) : prime sur celui
// du storyboard si le créateur en choisit un ici, vide = garder les prompts
// du storyboard tels quels (voir appliquerStyleVisuelSansRatio, js/api.js).
let montageStyleOverride = '';

// Bouton "Générer la vidéo" inséré à la suite de chaque storyboard généré
// (Récit, Script, Storyboard seul, Série, génération en direct ET
// réouverture depuis l'historique). Masqué par CSS pour tout le monde sauf
// le fondateur (.montage-trigger-btn, voir css/style.css).
//
// `plans` est mémorisé dans un registre à clé (comme storeCopyText pour le
// texte) plutôt que capturé dans une closure : certains appelants (le
// storyboard déjà généré d'un épisode de Série, voir js/serie.js
// renderSerieStoryboard) renvoient une chaîne HTML sans jamais avoir de
// référence DOM directe sur laquelle attacher un .onclick après coup,
// l'onclick doit donc être auto-suffisant dès la génération du HTML.
window._montageSourceStore = window._montageSourceStore || {};
function storeMontageSource(plans) {
  const key = '__montagekey_' + (window._montageSourceCounter = (window._montageSourceCounter || 0) + 1);
  window._montageSourceStore[key] = plans;
  return key;
}
function ouvrirMontageParCle(key, boutonEl) {
  const plans = window._montageSourceStore[key];
  if (plans) ouvrirMontage(plans, boutonEl);
}
function montageBoutonHTML(id, plans) {
  const cle = storeMontageSource(plans);
  return `<button class="btn-regenerate montage-trigger-btn" id="${id}" type="button" onclick="ouvrirMontageParCle('${cle}', this)">Générer la vidéo</button>`;
}

// Pas une boîte de dialogue : le panneau (#montageModal, un seul exemplaire
// partagé) est déplacé dans le DOM juste après la ligne de boutons
// (Copier/Partager/Générer la vidéo, voir .sb-actions-fin, commune aux 4
// modes de storyboard) qui contenait le bouton cliqué, pour s'afficher
// comme une extension du storyboard plutôt qu'une fenêtre par-dessus. Rien
// pour le fermer, sur demande expresse.
function ouvrirMontage(plans, boutonEl) {
  montagePlans = (plans || [])
    .map(p => ({ text: p.text || p.texte || p.texte_dit || '', visuel: p.visuel || p.prompt_visuel || '' }))
    .filter(p => p.text);
  montageImages = new Array(montagePlans.length).fill(null);
  montageImagesSelection = new Set();
  montageStyleOverride = '';
  montageVoixOff = null;
  montageMusique = null;
  montageVitesseVoix = 1;
  montageVolumeMusique = 0.15;
  montageEnCours = false;
  montageVoixEnCours = false;
  montageMusiqueEnCours = false;
  montageImagesEnCours = false;
  const resultat = document.getElementById('montageResultat');
  if (resultat) resultat.innerHTML = '';
  const statut = document.getElementById('montageStatut');
  if (statut) statut.style.display = 'none';
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  // Sélecteur de vitesse statique (jamais reconstruit par renderMontageEtat,
  // contrairement au menu des voix) : remis à "1x (normal)" ici, sinon le
  // panneau partagé garderait le choix d'un montage précédent affiché à
  // l'écran sans que montageVitesseVoix (remis à 1 ci-dessus) ne corresponde.
  // Le setter select.value est intercepté par initCustomSelect (js/ui.js)
  // pour rafraîchir le libellé affiché même sans événement 'change'.
  const selVitesse = document.getElementById('montageVitesseSelect');
  if (selVitesse) selVitesse.value = '1';
  const selVolumeMusique = document.getElementById('montageMusiqueVolumeSelect');
  if (selVolumeMusique) selVolumeMusique.value = '0.15';
  // Style graphique (retour propriétaire) : reconstruit à chaque ouverture
  // (comme le menu des voix) avec "Garder le style du storyboard" toujours
  // sélectionné par défaut, jamais le choix d'un montage précédent.
  const selStyle = document.getElementById('montageStyleSelect');
  if (selStyle) { selStyle.innerHTML = stylesVisuelsOptionsHTML(''); selStyle.value = ''; }
  const compteAttendu = document.getElementById('montageCompteAttendu');
  if (compteAttendu) compteAttendu.textContent = montagePlans.length;
  renderMontageEtat();
  chargerVoixMontage();
  const panneau = document.getElementById('montageModal');
  if (panneau) {
    const ligneActions = boutonEl && boutonEl.closest('.sb-actions-fin');
    if (ligneActions) ligneActions.insertAdjacentElement('afterend', panneau);
    panneau.classList.add('active');
    panneau.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Décode une chaîne base64 (renvoyée par ElevenLabs ou Gemini) en Blob.
function base64VersBlob(base64, mimeType) {
  const octets = atob(base64);
  const tampon = new Uint8Array(octets.length);
  for (let i = 0; i < octets.length; i++) tampon[i] = octets.charCodeAt(i);
  return new Blob([tampon], { type: mimeType });
}

function telechargerBlob(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Récupère la vidéo rendue (proxy same-origin, évite tout souci CORS) et la
// prépare en File, prêt pour navigator.share(). Appelée dès que le rendu est
// prêt (voir lancerMontage), PAS au clic : Safari iOS retire l'autorisation
// de partage natif si un aller-retour réseau a lieu entre le clic et l'appel
// à navigator.share (constaté en usage réel : bascule silencieuse sur le
// repli window.open, donc double popup, "autoriser la pop-up" PUIS
// "enregistrer la vidéo", au lieu de la feuille de partage native directe).
function prechargerVideoMontage(url) {
  return fetch('/api/montage-media?action=download&url=' + encodeURIComponent(url))
    .then(rep => { if (!rep.ok) throw new Error('récupération impossible'); return rep.blob(); })
    .then(blob => new File([blob], 'scriptura-montage.mp4', { type: 'video/mp4' }))
    .catch(() => null);
}

// « Télécharger la vidéo » : ouvre la feuille de partage native (iOS/Android)
// via l'API Web Share en partageant le FICHIER vidéo déjà préchargé (voir
// prechargerVideoMontage), c'est ce qui donne directement « Enregistrer la
// vidéo », AirDrop, Messages, etc., sans détour. Repli : téléchargement
// direct classique si l'API n'est pas disponible (ordinateur de bureau,
// vieux navigateur) ou si le préchargement a échoué.
async function partagerVideoMontage(btn, url) {
  const libelle = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }
  try {
    const fichier = (await (montageVideoFichierPromise || prechargerVideoMontage(url))) || await (async () => {
      const rep = await fetch('/api/montage-media?action=download&url=' + encodeURIComponent(url));
      if (!rep.ok) throw new Error('récupération impossible');
      return new File([await rep.blob()], 'scriptura-montage.mp4', { type: 'video/mp4' });
    })();
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: 'Montage Scriptura' });
    } else {
      telechargerBlob(fichier, 'scriptura-montage.mp4');
    }
  } catch (e) {
    // Annulation du partage par l'utilisateur : on ne fait rien.
    if (!(e && e.name === 'AbortError')) {
      window.open('/api/montage-media?action=download&url=' + encodeURIComponent(url), '_blank');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = libelle; }
  }
}

// Convertit une image PNG (générée par Together AI) vers JPEG/WEBP via
// <canvas>, entièrement côté navigateur, pas d'aller-retour serveur.
async function convertirImageVers(blob, format) {
  if (format === 'png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const mime = format === 'webp' ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Conversion image échouée')), mime, 0.92);
  });
}

// Agrandit une image du studio en plein écran (lightbox). Fermeture par clic
// n'importe où, par la croix, ou par la touche Échap.
function agrandirImageMontage(i) {
  const img = montageImages[i];
  if (!img) return;
  const box = document.getElementById('montageLightbox');
  const el = document.getElementById('montageLightboxImg');
  if (!box || !el) return;
  el.src = img.apercu;
  box.classList.add('active');
}
function fermerImageMontage() {
  const box = document.getElementById('montageLightbox');
  if (box) box.classList.remove('active');
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') fermerImageMontage();
});

async function telechargerImageMontage(i) {
  const img = montageImages[i];
  if (!img) return;
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  const format = document.getElementById('montageImgFormatSelect')?.value || 'png';
  try {
    const blobConverti = await convertirImageVers(img.blob, format);
    telechargerBlob(blobConverti, 'scriptura-plan-' + (i + 1) + '.' + format);
  } catch (e) {
    if (err) { err.textContent = 'Erreur de téléchargement (plan ' + (i + 1) + ') : ' + e.message; err.style.display = 'block'; }
  }
}

function toggleSelectionImage(i) {
  if (montageImagesSelection.has(i)) montageImagesSelection.delete(i);
  else montageImagesSelection.add(i);
  renderMontageEtat();
}

function toggleToutSelectionnerImages() {
  const indicesDisponibles = montageImages.map((img, i) => img ? i : null).filter(i => i !== null);
  const toutDejaCoche = indicesDisponibles.length > 0 && indicesDisponibles.every(i => montageImagesSelection.has(i));
  montageImagesSelection = toutDejaCoche ? new Set() : new Set(indicesDisponibles);
  renderMontageEtat();
}

// ── ZIP minimal (méthode "stored", sans compression) ────────────────────
// Les images sont déjà compressées (PNG/JPEG/WEBP) : recompresser dans le
// zip n'apporterait rien, autant écrire un zip "stored", le format le
// plus simple, pas besoin de bibliothèque externe pour ça.
function crc32(octets) {
  let crc = ~0;
  for (let i = 0; i < octets.length; i++) {
    crc ^= octets[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

async function creerZip(fichiers) {
  const encodeur = new TextEncoder();
  const partiesLocales = [];
  const entreesCentrales = [];
  let offset = 0;
  const maintenant = new Date();
  const dosTime = ((maintenant.getHours() << 11) | (maintenant.getMinutes() << 5) | (maintenant.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((maintenant.getFullYear() - 1980) << 9) | ((maintenant.getMonth() + 1) << 5) | maintenant.getDate()) & 0xFFFF;

  for (const { nom, blob } of fichiers) {
    const donnees = new Uint8Array(await blob.arrayBuffer());
    const nomOctets = encodeur.encode(nom);
    const crc = crc32(donnees);

    const enteteLocal = new DataView(new ArrayBuffer(30));
    enteteLocal.setUint32(0, 0x04034b50, true);
    enteteLocal.setUint16(4, 20, true);
    enteteLocal.setUint16(6, 0, true);
    enteteLocal.setUint16(8, 0, true); // 0 = stored (pas de compression)
    enteteLocal.setUint16(10, dosTime, true);
    enteteLocal.setUint16(12, dosDate, true);
    enteteLocal.setUint32(14, crc, true);
    enteteLocal.setUint32(18, donnees.length, true);
    enteteLocal.setUint32(22, donnees.length, true);
    enteteLocal.setUint16(26, nomOctets.length, true);
    enteteLocal.setUint16(28, 0, true);
    partiesLocales.push(new Uint8Array(enteteLocal.buffer), nomOctets, donnees);

    const enteteCentral = new DataView(new ArrayBuffer(46));
    enteteCentral.setUint32(0, 0x02014b50, true);
    enteteCentral.setUint16(4, 20, true);
    enteteCentral.setUint16(6, 20, true);
    enteteCentral.setUint16(8, 0, true);
    enteteCentral.setUint16(10, 0, true);
    enteteCentral.setUint16(12, dosTime, true);
    enteteCentral.setUint16(14, dosDate, true);
    enteteCentral.setUint32(16, crc, true);
    enteteCentral.setUint32(20, donnees.length, true);
    enteteCentral.setUint32(24, donnees.length, true);
    enteteCentral.setUint16(28, nomOctets.length, true);
    enteteCentral.setUint16(30, 0, true);
    enteteCentral.setUint16(32, 0, true);
    enteteCentral.setUint16(34, 0, true);
    enteteCentral.setUint16(36, 0, true);
    enteteCentral.setUint32(38, 0, true);
    enteteCentral.setUint32(42, offset, true);
    entreesCentrales.push(new Uint8Array(enteteCentral.buffer), nomOctets);

    offset += 30 + nomOctets.length + donnees.length;
  }

  const tailleCentral = entreesCentrales.reduce((s, p) => s + p.length, 0);
  const finCentral = new DataView(new ArrayBuffer(22));
  finCentral.setUint32(0, 0x06054b50, true);
  finCentral.setUint16(4, 0, true);
  finCentral.setUint16(6, 0, true);
  finCentral.setUint16(8, fichiers.length, true);
  finCentral.setUint16(10, fichiers.length, true);
  finCentral.setUint32(12, tailleCentral, true);
  finCentral.setUint32(16, offset, true);
  finCentral.setUint16(20, 0, true);

  return new Blob([...partiesLocales, ...entreesCentrales, new Uint8Array(finCentral.buffer)], { type: 'application/zip' });
}

// Télécharge les images cochées (ou toutes, si aucune coche) en un seul
// fichier .zip, les navigateurs mobiles (Safari iOS en tête) bloquent ou
// perturbent plusieurs téléchargements déclenchés coup sur coup, un seul
// fichier zip évite le problème complètement.
async function telechargerImagesSelectionnees() {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  const indices = montageImagesSelection.size
    ? Array.from(montageImagesSelection).sort((a, b) => a - b)
    : montageImages.map((img, i) => img ? i : null).filter(i => i !== null);
  if (!indices.length) return;

  const format = document.getElementById('montageImgFormatSelect')?.value || 'png';
  try {
    const fichiers = [];
    for (const i of indices) {
      const img = montageImages[i];
      if (!img) continue;
      const blobConverti = await convertirImageVers(img.blob, format);
      fichiers.push({ nom: 'scriptura-plan-' + (i + 1) + '.' + format, blob: blobConverti });
    }
    const zip = await creerZip(fichiers);
    telechargerBlob(zip, 'scriptura-images.zip');
  } catch (e) {
    if (err) { err.textContent = 'Erreur de téléchargement en lot : ' + e.message; err.style.display = 'block'; }
  }
}

// Encode un AudioBuffer décodé (Web Audio API) en WAV PCM 16 bits,
// format simple, pas de dépendance, aucune bibliothèque de conversion
// audio n'est nécessaire pour ce format.
function encoderWav(audioBuffer) {
  const nbCanaux = audioBuffer.numberOfChannels;
  const frequenceEch = audioBuffer.sampleRate;
  const nbEchantillons = audioBuffer.length;
  const tailleData = nbEchantillons * nbCanaux * 2;
  const buffer = new ArrayBuffer(44 + tailleData);
  const vue = new DataView(buffer);

  function ecrireChaine(offset, chaine) {
    for (let i = 0; i < chaine.length; i++) vue.setUint8(offset + i, chaine.charCodeAt(i));
  }

  ecrireChaine(0, 'RIFF');
  vue.setUint32(4, 36 + tailleData, true);
  ecrireChaine(8, 'WAVE');
  ecrireChaine(12, 'fmt ');
  vue.setUint32(16, 16, true);
  vue.setUint16(20, 1, true); // PCM
  vue.setUint16(22, nbCanaux, true);
  vue.setUint32(24, frequenceEch, true);
  vue.setUint32(28, frequenceEch * nbCanaux * 2, true);
  vue.setUint16(32, nbCanaux * 2, true);
  vue.setUint16(34, 16, true);
  ecrireChaine(36, 'data');
  vue.setUint32(40, tailleData, true);

  const canaux = [];
  for (let c = 0; c < nbCanaux; c++) canaux.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < nbEchantillons; i++) {
    for (let c = 0; c < nbCanaux; c++) {
      let echantillon = Math.max(-1, Math.min(1, canaux[c][i]));
      echantillon = echantillon < 0 ? echantillon * 0x8000 : echantillon * 0x7FFF;
      vue.setInt16(offset, echantillon, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function convertirAudioVersWav(blob) {
  const tampon = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(tampon);
    return encoderWav(audioBuffer);
  } finally {
    ctx.close();
  }
}

async function telechargerVoixOffMontage() {
  if (!montageVoixOff) return;
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  const format = document.getElementById('montageAudioFormatSelect')?.value || 'mp3';
  try {
    if (format === 'wav') {
      const wavBlob = await convertirAudioVersWav(montageVoixOff.blob);
      telechargerBlob(wavBlob, 'scriptura-voix-off.wav');
    } else {
      telechargerBlob(montageVoixOff.blob, 'scriptura-voix-off.mp3');
    }
  } catch (e) {
    if (err) { err.textContent = 'Erreur de téléchargement voix off : ' + e.message; err.style.display = 'block'; }
  }
}

// Le style graphique + le format sont choisis AVANT la génération du storyboard
// et déjà présents dans le prompt de chaque plan (footer). Le montage réutilise
// donc les prompts du storyboard tels quels, pas de menu ici.

// ── CHARGER SES PROPRES IMAGES ────────────────────────────────────────────
// Permet d'utiliser des visuels générés ailleurs (ChatGPT, Gemini…) au lieu
// (ou en complément) de Together AI. Les fichiers alimentent montageImages
// exactement comme les images générées ({ blob, apercu }), le reste du
// montage (sélection, téléchargement, rendu) fonctionne à l'identique.
function _assignerImageMontage(i, fichier) {
  if (montageImages.length !== montagePlans.length) montageImages = new Array(montagePlans.length).fill(null);
  montageImages[i] = { blob: fichier, apercu: URL.createObjectURL(fichier) };
}

// Bulk : plusieurs fichiers d'un coup, assignés aux plans DANS L'ORDRE (1er
// fichier = plan 1, etc.).
function declencherUploadImages() {
  if (!montagePlans.length || montageImagesEnCours) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => {
    const fichiers = Array.from(inp.files || []).filter(f => f.type.startsWith('image/'));
    if (!fichiers.length) return;
    for (let k = 0; k < fichiers.length && k < montagePlans.length; k++) _assignerImageMontage(k, fichiers[k]);
    renderMontageEtat();
  };
  inp.click();
}

// Par plan : charge une seule image pour un plan précis (ex. un plan dont la
// génération Together a échoué, ou qu'on préfère faire soi-même).
function declencherUploadImageSlot(i) {
  if (montageImagesEnCours) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = (inp.files || [])[0];
    if (f && f.type.startsWith('image/')) { _assignerImageMontage(i, f); renderMontageEtat(); }
  };
  inp.click();
}

async function genererImagesMontage() {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageImagesEnCours) return;

  // Un plan à la fois, séquentiellement : chaque image s'affiche dès
  // qu'elle est prête au lieu d'attendre tout le lot (et ça respecte la
  // même contrainte que api/montage-images.js, Together AI n'accepte
  // qu'une requête d'image à la fois sur ce compte).
  montageImagesEnCours = true;
  montageImages = new Array(montagePlans.length).fill(null);
  montageImageIndexEnCours = 0;
  renderMontageEtat();

  let echecs = 0;
  for (let i = 0; i < montagePlans.length; i++) {
    montageImageIndexEnCours = i;
    renderMontageEtat();
    try {
      const promptBrut = montagePlans[i].visuel || montagePlans[i].text;
      const rep = await fetch('/api/montage-media?action=images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: [construirePromptImageMontage(promptBrut)], format: ratioDuPrompt(promptBrut), code_acces: localStorage.getItem('scriptura_code') || null })
      });
      const data = await rep.json();
      const img = data.images && data.images[0];
      if (!rep.ok || !img) throw new Error((data.erreurs && data.erreurs[0]) || (data.error && data.error.message) || 'Échec de génération.');
      montageImages[i] = { blob: base64VersBlob(img.base64, img.mimeType || 'image/png'), apercu: 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.base64 };
    } catch (e) {
      echecs++;
    }
    renderMontageEtat();
  }

  if (echecs > 0 && err) {
    err.textContent = echecs + ' image(s) n\'ont pas pu être générées (voir ✕ ci-dessus), réessaie-les une par une.';
    err.style.display = 'block';
  }
  montageImageIndexEnCours = -1;
  montageImagesEnCours = false;
  renderMontageEtat();
}

async function regenererImageMontage(i) {
  const plan = montagePlans[i];
  if (!plan || montageImagesEnCours) return;
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';

  montageImagesEnCours = true;
  renderMontageEtat();
  try {
    const promptBrut = plan.visuel || plan.text;
    const rep = await fetch('/api/montage-media?action=images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: [construirePromptImageMontage(promptBrut)], format: ratioDuPrompt(promptBrut), code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    const img = data.images && data.images[0];
    if (!rep.ok || !img) throw new Error((data.erreurs && data.erreurs[0]) || (data.error && data.error.message) || 'Échec de régénération.');
    montageImages[i] = { blob: base64VersBlob(img.base64, img.mimeType || 'image/png'), apercu: 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.base64 };
  } catch (e) {
    if (err) { err.textContent = 'Erreur (plan ' + (i + 1) + ') : ' + e.message; err.style.display = 'block'; }
  } finally {
    montageImagesEnCours = false;
    renderMontageEtat();
  }
}

// Charge les voix ElevenLabs configurées côté serveur (voir
// api/montage-media.js action=voices) et remplit le sélecteur. Le menu
// reste caché s'il n'y a qu'une seule voix disponible, rien à choisir dans ce cas
// (montageVoixId prend directement cette voix, comme avant). S'il y en a
// plusieurs, aucune n'est présélectionnée : un texte indicatif ("Choisis une
// voix…") s'affiche, même convention que les autres menus déroulants de
// l'app (niche, ton, format…), au lieu d'imposer un choix par défaut
// arbitraire que l'utilisateur pourrait ne pas remarquer.
async function chargerVoixMontage() {
  const select = document.getElementById('montageVoixSelect');
  if (!select) return;
  try {
    const rep = await fetch('/api/montage-media?action=voices');
    const data = await rep.json();
    montageVoixListe = Array.isArray(data.voices) ? data.voices : [];
  } catch (e) {
    montageVoixListe = [];
  }
  // Le <select> lui-même est déjà invisible en permanence une fois converti
  // en menu déroulant maison (voir initCustomSelect, js/ui.js) : masquer/
  // afficher ce choix doit donc agir sur son enveloppe visible (.custom-select),
  // pas sur le <select> d'origine, sans effet visuel une fois wrappé.
  const voixEl = select.closest('.custom-select') || select;
  if (montageVoixListe.length > 1) {
    montageVoixId = '';
    select.innerHTML = '<option value="">Choisis une voix…</option>'
      + montageVoixListe.map(v => `<option value="${v.id}" data-description="${v.description || ''}">${v.label}</option>`).join('');
    select.value = '';
    voixEl.style.display = '';
  } else if (montageVoixListe.length === 1) {
    montageVoixId = montageVoixListe[0].id;
    select.innerHTML = `<option value="${montageVoixId}" data-description="${montageVoixListe[0].description || ''}">${montageVoixListe[0].label}</option>`;
    select.value = montageVoixId;
    voixEl.style.display = 'none';
  } else {
    voixEl.style.display = 'none';
  }
}

function changerVoixMontage(id) {
  if (id === montageVoixId) return;
  montageVoixId = id;
  // La voix off déjà générée correspond à l'ancienne voix : on la
  // réinitialise pour ne pas assembler un montage avec la mauvaise voix.
  montageVoixOff = null;
  renderMontageEtat();
}

function changerVitesseMontage(v) {
  const vitesse = Number(v) || 1;
  if (vitesse === montageVitesseVoix) return;
  montageVitesseVoix = vitesse;
  // Même raisonnement que changerVoixMontage ci-dessus : la voix off déjà
  // générée l'a été à l'ancienne vitesse, elle ne correspond plus au réglage
  // affiché.
  montageVoixOff = null;
  renderMontageEtat();
}

// Style graphique choisi AU MONTAGE (retour propriétaire) : prime sur celui
// du storyboard - un utilisateur a pu choisir un style avant de générer le
// storyboard (déjà présent dans chaque prompt), puis changer d'avis une
// fois arrivé au montage. S'il ne choisit rien ici, les prompts du
// storyboard partent inchangés (voir construirePromptImageMontage plus bas).
function changerStyleMontage(id) {
  const nouveauStyle = id || '';
  if (nouveauStyle === montageStyleOverride) return;
  montageStyleOverride = nouveauStyle;
  // Les images déjà générées reflètent l'ancien choix (storyboard ou style
  // précédent) : les invalider plutôt que laisser croire qu'elles suivent
  // déjà le nouveau style, même logique que changerVoixMontage ci-dessus.
  if (montageImages.some(Boolean)) {
    montageImages = new Array(montagePlans.length).fill(null);
  }
  renderMontageEtat();
}

// Applique le style choisi AU MONTAGE au prompt d'un plan, s'il y en a un
// (sinon le prompt du storyboard part tel quel). Centralisé ici : utilisé à
// la fois par genererImagesMontage et regenererImageMontage plus bas.
function construirePromptImageMontage(promptBrut) {
  return montageStyleOverride ? appliquerStyleVisuelSansRatio(promptBrut, montageStyleOverride) : promptBrut;
}

// Supprime les images sélectionnées (retour propriétaire) : les remet à
// null, exactement l'état d'un plan dont la génération a échoué (regénérer
// via l'IA ou charger sa propre image restent proposés, voir
// renderMontageEtat), plutôt qu'un vrai retrait qui désynchroniserait
// montageImages de montagePlans (même longueur toujours attendue ailleurs).
function supprimerImagesSelectionnees() {
  if (!montageImagesSelection.size) return;
  montageImagesSelection.forEach(i => { montageImages[i] = null; });
  montageImagesSelection = new Set();
  renderMontageEtat();
}

async function genererVoixOffMontage() {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageVoixEnCours) return;
  // Plusieurs voix disponibles mais aucune choisie (le menu affiche encore
  // son texte indicatif, voir chargerVoixMontage) : on ne part jamais sur un
  // choix par défaut silencieux, on demande explicitement de choisir.
  if (montageVoixListe.length > 1 && !montageVoixId) {
    if (err) { err.textContent = 'Choisis d\'abord une voix.'; err.style.display = 'block'; }
    return;
  }

  montageVoixEnCours = true;
  renderMontageEtat();
  // % estimé (même moteur que js/montage-manuel.js, omVoixProgBar) : aucun
  // signal réel disponible ici, un seul appel ElevenLabs non flux.
  const texteVoixOffMontage = montagePlans.map(p => p.text).join('');
  const progVoixMontage = createProgress((p) => {
    const fill = document.getElementById('montageVoixProgFill');
    const pct = document.getElementById('montageVoixProgPct');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }, Math.max(8000, texteVoixOffMontage.length * 60));
  progVoixMontage.start();
  try {
    const rep = await fetch('/api/montage-media?action=tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: montagePlans.map(p => p.text), voiceId: montageVoixId, speed: montageVitesseVoix, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    if (!rep.ok || !data.audioBase64) throw new Error((data.error && data.error.message) || 'La voix off n\'a pas pu être générée.');

    const durations = Array.isArray(data.durations) ? data.durations : [];
    // Défense en profondeur (même bug déjà corrigé sur le montage manuel,
    // js/montage-manuel.js : un plafond de segments trop bas côté serveur
    // tronquait silencieusement les durées, laissant le montage bloqué sans
    // explication) : jamais une voix off "prête" avec moins de durées que
    // de plans, même si le serveur est censé refuser ce cas en amont.
    if (durations.length !== montagePlans.length) {
      throw new Error(`Réponse incohérente du serveur : ${durations.length} durée(s) reçue(s) pour ${montagePlans.length} plan(s).`);
    }
    const blob = base64VersBlob(data.audioBase64, data.mimeType || 'audio/mpeg');
    montageVoixOff = {
      blob,
      url: URL.createObjectURL(blob),
      durations,
      // Sous-titres (groupes "2 mots longs ou 3 mots courts", voir
      // api/montage-media.js) : tableau vide si l'horodatage ElevenLabs ne
      // couvrait pas tout le texte, le montage reste alors utilisable sans
      // sous-titres plutôt que d'échouer.
      captions: Array.isArray(data.captions) ? data.captions : []
    };
    progVoixMontage.finish();
  } catch (e) {
    progVoixMontage.stop();
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
    // Voir js/montage-manuel.js pour la même journalisation : ce flux
    // appelle directement /api/montage-media, jamais callAI, donc restait
    // invisible pour la carte "Échecs de génération" du Tableau de bord.
    try {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'erreur', mode: 'montageVoixOff', code: localStorage.getItem('scriptura_code') || null, detail: (e.message || 'erreur inconnue').slice(0, 200) })
      }).catch(() => {});
    } catch (e2) { /* silencieux */ }
  } finally {
    montageVoixEnCours = false;
    renderMontageEtat();
  }
}

// Musique de fond instrumentale (retour propriétaire : le montage Scriptura
// "pas assez premium" comparé à un montage CapCut fait à la main, cause
// identifiée : aucune musique de fond nulle part dans le pipeline). Générée
// via Eleven Music (api/montage-media.js, action=music), CALÉE SUR LA DURÉE
// DE LA VOIX OFF déjà générée : jamais lancée avant, pour connaître la durée
// totale exacte à demander. Toujours optionnelle (bouton "Retirer" plutôt
// qu'une case à cocher, voir renderMontageEtat) : un montage sans musique
// reste valide, contrairement à la voix off.
async function genererMusiqueMontage() {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  if (montageMusiqueEnCours || !montageVoixOff) return;
  const dureeTotaleMs = Math.round(montageVoixOff.durations.reduce((s, d) => s + (d || 0), 0) * 1000);
  if (!dureeTotaleMs) return;

  montageMusiqueEnCours = true;
  renderMontageEtat();
  // % estimé (même moteur que la voix off, createProgress) : aucun signal
  // réel disponible pour un appel Eleven Music non flux, calé sur la durée
  // demandée (une musique de 90s prend plus longtemps à générer qu'une de 10s).
  const progMusiqueMontage = createProgress((p) => {
    const fill = document.getElementById('montageMusiqueProgFill');
    const pct = document.getElementById('montageMusiqueProgPct');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }, Math.max(12000, dureeTotaleMs * 0.4));
  progMusiqueMontage.start();
  try {
    const rep = await fetch('/api/montage-media?action=music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dureeMs: dureeTotaleMs, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    if (!rep.ok || !data.audioBase64) throw new Error((data.error && data.error.message) || 'La musique de fond n\'a pas pu être générée.');
    const blob = base64VersBlob(data.audioBase64, data.mimeType || 'audio/mpeg');
    montageMusique = { blob, url: URL.createObjectURL(blob) };
    progMusiqueMontage.finish();
  } catch (e) {
    progMusiqueMontage.stop();
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
    try {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'erreur', mode: 'montageMusique', code: localStorage.getItem('scriptura_code') || null, detail: (e.message || 'erreur inconnue').slice(0, 200) })
      }).catch(() => {});
    } catch (e2) { /* silencieux */ }
  } finally {
    montageMusiqueEnCours = false;
    renderMontageEtat();
  }
}

function retirerMusiqueMontage() {
  montageMusique = null;
  renderMontageEtat();
}

function changerVolumeMusiqueMontage(v) {
  montageVolumeMusique = Number(v) || 0.15;
}

function renderMontageEtat() {
  const nbPretes = montageImages.filter(Boolean).length;
  const compte = document.getElementById('montageImagesCompte');
  // Pastille d'état de l'en-tête (retour propriétaire : disposition premium
  // du montage) : verte une fois toutes les images prêtes, neutre sinon.
  if (compte) {
    compte.textContent = nbPretes + ' / ' + montagePlans.length;
    compte.classList.toggle('montage-chip-pret', montagePlans.length > 0 && nbPretes === montagePlans.length);
  }

  const zoneImg = document.getElementById('montageImagesThumbs');
  if (zoneImg) {
    zoneImg.innerHTML = montagePlans.map((p, i) => {
      const img = montageImages[i];
      if (img) return `<div class="audit-thumb">
        <img src="${img.apercu}" alt="" style="cursor:zoom-in" onclick="agrandirImageMontage(${i})" title="Agrandir">
        <input type="checkbox" class="montage-thumb-select" title="Sélectionner" ${montageImagesSelection.has(i) ? 'checked' : ''} onclick="event.stopPropagation();toggleSelectionImage(${i})">
        <button class="montage-thumb-dl" onclick="event.stopPropagation();telechargerImageMontage(${i})" title="Télécharger">${ICO('download')}</button>
      </div>`;
      if (montageImagesEnCours && i >= montageImageIndexEnCours) {
        return `<div class="audit-thumb montage-thumb-attente" title="En attente…"></div>`;
      }
      // Plan sans image : régénérer via IA (↻) OU charger sa propre image (📁).
      return `<div class="audit-thumb montage-thumb-echec">
        <span class="montage-thumb-retry" onclick="regenererImageMontage(${i})" title="Régénérer via l'IA">↻</span>
        <button class="montage-thumb-upload" onclick="event.stopPropagation();declencherUploadImageSlot(${i})" title="Charger une image pour ce plan">${ICO('folder')}</button>
      </div>`;
    }).join('');
  }
  const btnGenImg = document.getElementById('montageGenImagesBtn');
  if (btnGenImg) {
    btnGenImg.disabled = montageImagesEnCours;
    btnGenImg.textContent = montageImagesEnCours ? 'Génération des images…' : (nbPretes ? '↻ Régénérer les images' : 'Générer les images');
  }
  // % RÉEL pendant la génération des images (une par une, séquentiellement,
  // voir genererImagesMontage) : montageImageIndexEnCours/montagePlans.length
  // sont déjà connus avec certitude à chaque appel, un calcul direct suffit,
  // pas besoin d'estimation de temps. Les vignettes continuent d'apparaître
  // progressivement en dessous.
  const loaderImg = document.getElementById('montageImagesLoader');
  if (loaderImg) loaderImg.style.display = montageImagesEnCours ? 'flex' : 'none';
  if (montageImagesEnCours && montagePlans.length) {
    const pctImg = Math.round((Math.max(0, montageImageIndexEnCours) / montagePlans.length) * 100);
    const fillImg = document.getElementById('montageImagesLoaderFill');
    const pctElImg = document.getElementById('montageImagesLoaderPct');
    if (fillImg) fillImg.style.width = pctImg + '%';
    if (pctElImg) pctElImg.textContent = pctImg + '%';
  }
  const btnSelectAll = document.getElementById('montageSelectAllBtn');
  if (btnSelectAll) {
    const indicesDisponibles = montageImages.map((im, i) => im ? i : null).filter(i => i !== null);
    const toutCoche = indicesDisponibles.length > 0 && indicesDisponibles.every(i => montageImagesSelection.has(i));
    btnSelectAll.disabled = !nbPretes;
    btnSelectAll.textContent = toutCoche ? 'Tout désélectionner' : 'Tout sélectionner';
  }
  const btnDlSelection = document.getElementById('montageDlSelectionBtn');
  if (btnDlSelection) {
    btnDlSelection.disabled = !nbPretes;
    const nbSelection = montageImagesSelection.size;
    btnDlSelection.textContent = nbSelection
      ? `⬇ Télécharger la sélection (${nbSelection}) (.zip)`
      : '⬇ Télécharger toutes les images (.zip)';
  }
  // Bouton "supprimer la sélection" (retour propriétaire) : actif seulement
  // si au moins une image est cochée, comme les autres actions de sélection.
  const btnDelSelection = document.getElementById('montageDelSelectionBtn');
  if (btnDelSelection) btnDelSelection.disabled = montageImagesSelection.size === 0;

  const zoneVoix = document.getElementById('montageVoixZone');
  if (zoneVoix) {
    if (montageVoixEnCours) {
      // % estimé (comme js/montage-manuel.js, omVoixProgBar) : aucun signal
      // réel disponible pour un appel ElevenLabs unique, non flux.
      zoneVoix.innerHTML = `<div class="sb-progress-bar" id="montageVoixProgBar" style="max-width:none;margin:0">
        <div class="wait-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 L5 13 H11 L10 22 L19 10 H13 L14 2 Z" fill="none" stroke="#E2C87A" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg></div>
        <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="montageVoixProgFill"></div></div>
        <div class="sb-progress-bar-pct" id="montageVoixProgPct">0%</div>
      </div>`;
    } else if (montageVoixOff) {
      zoneVoix.innerHTML = `
        <audio class="montage-audio-preview" src="${montageVoixOff.url}" controls></audio>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <select class="ctx-input" id="montageAudioFormatSelect" style="flex:0 0 auto;width:auto">
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
          </select>
          <button class="btn-regenerate" style="flex:0 0 auto" onclick="telechargerVoixOffMontage()" type="button">Télécharger</button>
        </div>
        <button class="btn-regenerate" style="margin-top:10px" onclick="genererVoixOffMontage()" type="button">↻ Régénérer la voix off</button>`;
    } else {
      zoneVoix.innerHTML = `<button class="btn-montage-primary" onclick="genererVoixOffMontage()" type="button">Générer la voix off</button>`;
    }
  }
  // Pastille d'état de l'en-tête "Voix off" (retour propriétaire).
  const chipVoix = document.getElementById('montageVoixChip');
  if (chipVoix) {
    chipVoix.textContent = montageVoixOff ? 'Prêt ✓' : (montageVoixEnCours ? 'Génération…' : 'À faire');
    chipVoix.classList.toggle('montage-chip-pret', !!montageVoixOff);
  }

  const zoneMusique = document.getElementById('montageMusiqueZone');
  if (zoneMusique) {
    if (montageMusiqueEnCours) {
      // % estimé, même moteur que la voix off (voir genererMusiqueMontage).
      zoneMusique.innerHTML = `<div class="sb-progress-bar" id="montageMusiqueProgBar" style="max-width:none;margin:0">
        <div class="wait-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 L5 13 H11 L10 22 L19 10 H13 L14 2 Z" fill="none" stroke="#E2C87A" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg></div>
        <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="montageMusiqueProgFill"></div></div>
        <div class="sb-progress-bar-pct" id="montageMusiqueProgPct">0%</div>
      </div>`;
    } else if (montageMusique) {
      zoneMusique.innerHTML = `
        <audio class="montage-audio-preview" src="${montageMusique.url}" controls></audio>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <button class="btn-regenerate" onclick="genererMusiqueMontage()" type="button">↻ Régénérer</button>
          <button class="btn-regenerate" onclick="retirerMusiqueMontage()" type="button">Retirer</button>
        </div>`;
    } else {
      zoneMusique.innerHTML = `<button class="btn-montage-primary" onclick="genererMusiqueMontage()" type="button" ${montageVoixOff ? '' : 'disabled title="Génère d\'abord la voix off"'}>Générer une musique de fond</button>`;
    }
  }

  const btn = document.getElementById('montageLancerBtn');
  // On n'exige plus TOUTES les images : une image bloquée (ex. faux positif
  // NSFW de Together) ne doit plus empêcher tout le montage. Il suffit d'au
  // moins une image ; les plans manquants réutilisent l'image voisine (voir
  // construireImagesEffectives). On garde le bouton actif tant qu'il reste
  // au moins une image et une voix off.
  if (btn) btn.disabled = montageEnCours || montageVoixEnCours || montageImagesEnCours
    || !montagePlans.length || nbPretes < 1 || !montageVoixOff;
}

// Remplace chaque plan sans image (bloqué/échec) par l'image disponible la
// plus proche (voisin précédent en priorité, sinon suivant). Ainsi un plan
// récalcitrant n'empêche pas le montage : sa portion de voix off montre
// l'image voisine. Renvoie null si AUCUNE image n'est disponible.
function construireImagesEffectives() {
  const n = montagePlans.length;
  if (!montageImages.some(Boolean)) return null;
  const eff = new Array(n);
  let nbRemplaces = 0;
  for (let i = 0; i < n; i++) {
    if (montageImages[i]) { eff[i] = montageImages[i]; continue; }
    let trouve = null;
    for (let d = 1; d < n && !trouve; d++) {
      if (i - d >= 0 && montageImages[i - d]) trouve = montageImages[i - d];
      else if (i + d < n && montageImages[i + d]) trouve = montageImages[i + d];
    }
    eff[i] = trouve;
    if (trouve) nbRemplaces++;
  }
  construireImagesEffectives.nbRemplaces = nbRemplaces;
  return eff;
}

async function lancerMontage() {
  const err = document.getElementById('montageErreur');
  const statut = document.getElementById('montageStatut');
  const resultat = document.getElementById('montageResultat');
  if (err) err.style.display = 'none';
  const imagesEff = construireImagesEffectives();
  if (!montagePlans.length || !imagesEff || !montageVoixOff) return;
  if (!supabaseClient) {
    if (err) { err.textContent = 'Connexion au stockage indisponible.'; err.style.display = 'block'; }
    return;
  }

  montageEnCours = true;
  montageVideoFichierPromise = null;
  renderMontageEtat();
  if (resultat) resultat.innerHTML = '';
  // Simple texte ici (pas montageStatutHTML, qui embarque sa propre bande
  // rayée décorative) : la vraie barre de progression avec pourcentage
  // (#montageProgBar, juste en dessous) existe pour cette étape, même
  // correctif que js/montage-manuel.js (omLancerMontage).
  if (statut) { statut.style.display = 'block'; statut.textContent = 'Envoi des fichiers…'; }
  const progBarMontage = document.getElementById('montageProgBar');
  const dureeEstimeeMontage = Math.max(15000, imagesEff.length * 2500);
  const progMontage = createProgress((p) => {
    const fill = document.getElementById('montageProgFill');
    const pct = document.getElementById('montageProgPct');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }, dureeEstimeeMontage);
  if (progBarMontage) progBarMontage.style.display = 'flex';
  progMontage.start();

  try {
    const dossier = 'montage-' + Date.now();

    // Durées EXACTES : renvoyées par ElevenLabs (horodatage caractère par
    // caractère), pas une estimation ni une mesure côté navigateur.
    const durees = montageVoixOff.durations;

    // Chaque étape est isolée dans son propre try/catch avec un préfixe
    // distinct : une exception native (Supabase, fetch…) qui ne passe pas
    // par nos messages français habituels reste quand même identifiable,
    // sans ça, une erreur générique du navigateur ne dit pas à quelle étape
    // (upload images, upload audio, ou rendu) elle s'est produite.
    // imagesEff : les plans sans image (bloqués) réutilisent l'image voisine,
    // pour ne jamais bloquer tout le montage à cause d'un seul plan.
    const images = [];
    try {
      for (let i = 0; i < imagesEff.length; i++) {
        const chemin = dossier + '/img-' + (i + 1) + '.jpg';
        const { error } = await supabaseClient.storage.from('montages').upload(chemin, imagesEff[i].blob, { contentType: imagesEff[i].blob.type || 'image/png' });
        if (error) throw new Error(error.message);
        const { data } = supabaseClient.storage.from('montages').getPublicUrl(chemin);
        images.push({ url: data.publicUrl, duration: durees[i] || 2 });
      }
    } catch (e) { throw new Error('Upload des images : ' + e.message); }

    let dataAudio;
    try {
      const cheminAudio = dossier + '/voix-off.mp3';
      const { error: errAudio } = await supabaseClient.storage.from('montages').upload(cheminAudio, montageVoixOff.blob, { contentType: 'audio/mpeg' });
      if (errAudio) throw new Error(errAudio.message);
      dataAudio = supabaseClient.storage.from('montages').getPublicUrl(cheminAudio).data;
    } catch (e) { throw new Error('Upload de la voix off : ' + e.message); }

    // Musique de fond : optionnelle, seulement si générée (voir
    // genererMusiqueMontage). Le rendu (render-service/server.js) la mélange
    // sous la voix off avec le volume automatiquement baissé.
    let musicUrl = '';
    if (montageMusique) {
      try {
        const cheminMusique = dossier + '/musique.mp3';
        const { error: errMusique } = await supabaseClient.storage.from('montages').upload(cheminMusique, montageMusique.blob, { contentType: 'audio/mpeg' });
        if (errMusique) throw new Error(errMusique.message);
        musicUrl = supabaseClient.storage.from('montages').getPublicUrl(cheminMusique).data.publicUrl;
      } catch (e) { throw new Error('Upload de la musique de fond : ' + e.message); }
    }

    // Rendu FFmpeg auto-hébergé, synchrone : une seule requête, pas de
    // sondage de statut (contrairement à JSON2Video, remplacé faute de
    // crédits, voir historique de ce fichier).
    if (statut) statut.textContent = 'Montage en cours (peut prendre plusieurs minutes selon le nombre de plans)…';
    let dataRender;
    try {
      // Toujours /api/montage-render (voir en-tête de fichier) : c'est lui
      // qui décide, côté serveur, d'assembler la vidéo lui-même ou de
      // proxier vers le service de rendu externe.
      // Sous-titres activables/désactivables par le fondateur avant de
      // lancer le montage (retour propriétaire), voir la case à cocher
      // #montageSousTitresCheckbox juste au-dessus du bouton "Lancer le
      // montage" dans le HTML. Cochée par défaut.
      const sousTitresActives = document.getElementById('montageSousTitresCheckbox')?.checked !== false;
      const corpsRendu = {
        images, audioUrl: dataAudio.publicUrl,
        format: ratioDuPrompt((montagePlans[0] && montagePlans[0].visuel) || ''),
        captions: (sousTitresActives && montageVoixOff.captions) || [],
        musicUrl,
        musicVolume: montageVolumeMusique,
        // Filigrane Scriptura (retour propriétaire), coché par défaut.
        watermark: document.getElementById('montageFiligraneCheckbox')?.checked !== false,
        code_acces: localStorage.getItem('scriptura_code') || null
      };
      const rRender = await fetch('/api/montage-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpsRendu)
      });
      dataRender = await rRender.json();
      if (!rRender.ok || !dataRender.url) throw new Error((dataRender.error && dataRender.error.message) || 'Le montage n\'a pas pu être généré.');
    } catch (e) { throw new Error('Rendu de la vidéo : ' + e.message); }

    progMontage.finish();
    if (statut) statut.style.display = 'none';
    if (progBarMontage) progBarMontage.style.display = 'none';
    // Précharge la vidéo dès qu'elle existe, pas au clic sur "Télécharger"
    // (voir prechargerVideoMontage) : le temps que l'utilisateur regarde
    // l'aperçu avant de cliquer suffit largement à finir le téléchargement.
    montageVideoFichierPromise = prechargerVideoMontage(dataRender.url);
    const nbRemplaces = construireImagesEffectives.nbRemplaces || 0;
    const note = nbRemplaces > 0
      ? `<div class="montage-statut" style="margin:0 0 10px">${nbRemplaces} plan(s) sans image (bloqué·s) remplacé·s par l'image voisine. Régénère ces images puis relance le montage pour un rendu complet.</div>`
      : '';
    if (resultat) resultat.innerHTML = note + `
      <video class="montage-video" src="${auditEsc(dataRender.url)}" controls playsinline></video>
      <button class="btn-regenerate" style="display:inline-block;margin-top:12px" onclick="partagerVideoMontage(this, '${auditEsc(dataRender.url)}')" type="button">Télécharger la vidéo</button>`;
  } catch (e) {
    progMontage.stop();
    if (statut) statut.style.display = 'none';
    if (progBarMontage) progBarMontage.style.display = 'none';
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
    try {
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'erreur', mode: 'montageRendu', code: localStorage.getItem('scriptura_code') || null, detail: (e.message || 'erreur inconnue').slice(0, 200) })
      }).catch(() => {});
    } catch (e2) { /* silencieux */ }
  } finally {
    montageEnCours = false;
    renderMontageEtat();
  }
}

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

// Rendu vidéo final : par défaut l'ancien endpoint Vercel (/api/montage-render,
// bridé par le plan gratuit). Dès que le service de rendu externe est déployé
// (voir render-service/README.md), colle son URL ici pour un rendu 1080p, une
// synchro image/voix exacte et des transitions variées. Tant que c'est vide,
// rien ne change, aucune coupure pendant la migration.
const MONTAGE_RENDER_URL = 'https://scriptura-production-a540.up.railway.app'; // service de rendu Railway
const MONTAGE_RENDER_TOKEN = ''; // seulement si MONTAGE_TOKEN est défini côté service

let montagePlans = [];      // [{ text, visuel }], un par plan du storyboard
let montageImages = [];     // [{ blob, apercu } | null], même ordre/longueur que montagePlans
let montageVoixOff = null;  // { blob, url, durations }, générée par ElevenLabs
let montageEnCours = false;
let montageVoixEnCours = false;
let montageImagesEnCours = false;
let montageVoixListe = [];  // [{ id, label }], voix ElevenLabs configurées (voir api/montage-voices.js)
let montageVoixId = '';     // id de la voix actuellement choisie
let montageImageIndexEnCours = -1; // index du plan en cours de génération (-1 = aucun)
let montageImagesSelection = new Set(); // indices des images cochées pour le téléchargement en lot

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
  return `<button class="btn-regenerate montage-trigger-btn" id="${id}" type="button" onclick="ouvrirMontageParCle('${cle}', this)">🎬 Générer la vidéo</button>`;
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
  montageVoixOff = null;
  montageEnCours = false;
  montageVoixEnCours = false;
  montageImagesEnCours = false;
  const resultat = document.getElementById('montageResultat');
  if (resultat) resultat.innerHTML = '';
  const statut = document.getElementById('montageStatut');
  if (statut) statut.style.display = 'none';
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
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

// « Télécharger la vidéo » : ouvre la feuille de partage native (iOS/Android)
// via l'API Web Share en partageant le FICHIER vidéo, c'est ce qui donne
// « Enregistrer la vidéo », AirDrop, Messages, etc. On récupère d'abord la
// vidéo via notre proxy same-origin (/api/montage-media?action=download) pour éviter tout
// souci CORS de lecture. Repli : téléchargement direct classique si l'API
// n'est pas disponible (ordinateur de bureau, vieux navigateur).
async function partagerVideoMontage(btn, url) {
  const libelle = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }
  try {
    const rep = await fetch('/api/montage-media?action=download&url=' + encodeURIComponent(url));
    if (!rep.ok) throw new Error('récupération impossible');
    const blob = await rep.blob();
    const fichier = new File([blob], 'scriptura-montage.mp4', { type: 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: 'Montage Scriptura' });
    } else {
      telechargerBlob(blob, 'scriptura-montage.mp4');
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
      const rep = await fetch('/api/montage-media?action=images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: [montagePlans[i].visuel || montagePlans[i].text], format: ratioDuPrompt(montagePlans[i].visuel || ''), code_acces: localStorage.getItem('scriptura_code') || null })
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
    const rep = await fetch('/api/montage-media?action=images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: [plan.visuel || plan.text], format: ratioDuPrompt(plan.visuel || ''), code_acces: localStorage.getItem('scriptura_code') || null })
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
// reste caché s'il n'y a qu'une seule voix disponible, rien à choisir dans ce cas.
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
  if (montageVoixListe.length) {
    montageVoixId = montageVoixListe[0].id;
    select.innerHTML = montageVoixListe.map(v => `<option value="${v.id}">${v.label}</option>`).join('');
    select.value = montageVoixId;
    select.style.display = montageVoixListe.length > 1 ? '' : 'none';
  } else {
    select.style.display = 'none';
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

async function genererVoixOffMontage() {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageVoixEnCours) return;

  montageVoixEnCours = true;
  renderMontageEtat();
  try {
    const rep = await fetch('/api/montage-media?action=tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: montagePlans.map(p => p.text), voiceId: montageVoixId, code_acces: localStorage.getItem('scriptura_code') || null })
    });
    const data = await rep.json();
    if (!rep.ok || !data.audioBase64) throw new Error((data.error && data.error.message) || 'La voix off n\'a pas pu être générée.');

    const blob = base64VersBlob(data.audioBase64, data.mimeType || 'audio/mpeg');
    montageVoixOff = {
      blob,
      url: URL.createObjectURL(blob),
      durations: Array.isArray(data.durations) ? data.durations : []
    };
  } catch (e) {
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
  } finally {
    montageVoixEnCours = false;
    renderMontageEtat();
  }
}

function renderMontageEtat() {
  const nbPretes = montageImages.filter(Boolean).length;
  const compte = document.getElementById('montageImagesCompte');
  if (compte) compte.textContent = nbPretes + ' / ' + montagePlans.length + ' image(s)';

  const zoneImg = document.getElementById('montageImagesThumbs');
  if (zoneImg) {
    zoneImg.innerHTML = montagePlans.map((p, i) => {
      const img = montageImages[i];
      if (img) return `<div class="audit-thumb">
        <img src="${img.apercu}" alt="" style="cursor:zoom-in" onclick="agrandirImageMontage(${i})" title="Agrandir">
        <input type="checkbox" class="montage-thumb-select" title="Sélectionner" ${montageImagesSelection.has(i) ? 'checked' : ''} onclick="event.stopPropagation();toggleSelectionImage(${i})">
        <button class="montage-thumb-dl" onclick="event.stopPropagation();telechargerImageMontage(${i})" title="Télécharger">⬇</button>
      </div>`;
      if (montageImagesEnCours && i >= montageImageIndexEnCours) {
        return `<div class="audit-thumb montage-thumb-attente" title="En attente…"></div>`;
      }
      // Plan sans image : régénérer via IA (↻) OU charger sa propre image (📁).
      return `<div class="audit-thumb montage-thumb-echec">
        <span class="montage-thumb-retry" onclick="regenererImageMontage(${i})" title="Régénérer via l'IA">↻</span>
        <button class="montage-thumb-upload" onclick="event.stopPropagation();declencherUploadImageSlot(${i})" title="Charger une image pour ce plan">📁</button>
      </div>`;
    }).join('');
  }
  const btnGenImg = document.getElementById('montageGenImagesBtn');
  if (btnGenImg) {
    btnGenImg.disabled = montageImagesEnCours;
    btnGenImg.textContent = montageImagesEnCours ? 'Génération des images…' : (nbPretes ? '↻ Régénérer les images' : '🎨 Générer les images');
  }
  // Bande rayée dorée pendant la génération des images (même animation que les
  // autres générations). Les vignettes continuent d'apparaître progressivement
  // en dessous.
  const loaderImg = document.getElementById('montageImagesLoader');
  if (loaderImg) loaderImg.style.display = montageImagesEnCours ? 'flex' : 'none';
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

  const zoneVoix = document.getElementById('montageVoixZone');
  if (zoneVoix) {
    if (montageVoixEnCours) {
      // Même bande rayée dorée que les autres générations (sans texte ni %).
      zoneVoix.innerHTML = `<div class="sb-progress-bar" style="max-width:none;margin:0"><div class="sb-progress-bar-track"><div class="sb-progress-bar-fill"></div></div></div>`;
    } else if (montageVoixOff) {
      zoneVoix.innerHTML = `
        <audio class="montage-audio-preview" src="${montageVoixOff.url}" controls></audio>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <select class="ctx-input" id="montageAudioFormatSelect" style="flex:0 0 auto;width:auto">
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
          </select>
          <button class="btn-regenerate" style="flex:0 0 auto" onclick="telechargerVoixOffMontage()" type="button">⬇ Télécharger</button>
        </div>
        <button class="btn-regenerate" style="margin-top:10px" onclick="genererVoixOffMontage()" type="button">↻ Régénérer la voix off</button>`;
    } else {
      zoneVoix.innerHTML = `<button class="btn-regenerate" onclick="genererVoixOffMontage()" type="button">🎙️ Générer la voix off</button>`;
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

// Statut de l'assemblage final = bande rayée dorée (même animation que les
// autres générations) + un court message informatif conservé ici, car le rendu
// peut durer plusieurs minutes (contrairement aux images/voix off).
function montageStatutHTML(message) {
  return '<div class="sb-progress-bar" style="max-width:none;margin:0 0 12px">'
    + '<div class="sb-progress-bar-track"><div class="sb-progress-bar-fill"></div></div></div>'
    + '<div>' + message + '</div>';
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
  renderMontageEtat();
  if (resultat) resultat.innerHTML = '';
  if (statut) { statut.style.display = 'block'; statut.innerHTML = montageStatutHTML('Envoi des fichiers…'); }

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

    // Rendu FFmpeg auto-hébergé, synchrone : une seule requête, pas de
    // sondage de statut (contrairement à JSON2Video, remplacé faute de
    // crédits, voir historique de ce fichier).
    if (statut) statut.innerHTML = montageStatutHTML('Montage en cours (peut prendre plusieurs minutes selon le nombre de plans)…');
    let dataRender;
    try {
      // Service de rendu externe si configuré (rendu 1080p, synchro exacte,
      // transitions variées), sinon l'ancien endpoint Vercel par défaut.
      const urlRendu = MONTAGE_RENDER_URL ? MONTAGE_RENDER_URL.replace(/\/$/, '') + '/render' : '/api/montage-render';
      const entetes = { 'Content-Type': 'application/json' };
      if (MONTAGE_RENDER_URL && MONTAGE_RENDER_TOKEN) entetes['x-montage-token'] = MONTAGE_RENDER_TOKEN;
      // Le code d'accès n'est envoyé qu'au repli Vercel (/api/montage-render,
      // dans ce dépôt, désormais protégé côté serveur) : jamais au service
      // Railway externe, hors de notre contrôle.
      const corpsRendu = { images, audioUrl: dataAudio.publicUrl, format: ratioDuPrompt((montagePlans[0] && montagePlans[0].visuel) || '') };
      if (!MONTAGE_RENDER_URL) corpsRendu.code_acces = localStorage.getItem('scriptura_code') || null;
      const rRender = await fetch(urlRendu, {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify(corpsRendu)
      });
      dataRender = await rRender.json();
      if (!rRender.ok || !dataRender.url) throw new Error((dataRender.error && dataRender.error.message) || 'Le montage n\'a pas pu être généré.');
    } catch (e) { throw new Error('Rendu de la vidéo : ' + e.message); }

    if (statut) statut.style.display = 'none';
    const nbRemplaces = construireImagesEffectives.nbRemplaces || 0;
    const note = nbRemplaces > 0
      ? `<div class="montage-statut" style="margin:0 0 10px">${nbRemplaces} plan(s) sans image (bloqué·s) remplacé·s par l'image voisine. Régénère ces images puis relance le montage pour un rendu complet.</div>`
      : '';
    if (resultat) resultat.innerHTML = note + `
      <video class="montage-video" src="${auditEsc(dataRender.url)}" controls playsinline></video>
      <button class="btn-regenerate" style="display:inline-block;margin-top:12px" onclick="partagerVideoMontage(this, '${auditEsc(dataRender.url)}')" type="button">⬇ Télécharger la vidéo</button>`;
  } catch (e) {
    if (statut) statut.style.display = 'none';
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
  } finally {
    montageEnCours = false;
    renderMontageEtat();
  }
}

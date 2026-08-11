// ═══════════════════════════════════════════════════════════
//  MONTAGE VIDÉO — assemblage images + voix off, rendu par FFmpeg
//  auto-hébergé (voir api/montage-render.js).
//  Réservé au fondateur (bouton visible uniquement en body.is-admin).
//  Boucle complète : les images sont générées par Together AI (voir
//  api/montage-images.js) à partir des prompts visuels déjà écrits par
//  Scriptura pour chaque plan, et la voix off par ElevenLabs (voir
//  api/montage-tts.js) à partir du texte du storyboard — plus rien à
//  uploader manuellement. L'horodatage renvoyé par ElevenLabs donne la
//  durée EXACTE de chaque plan.
// ═══════════════════════════════════════════════════════════

let montagePlans = [];      // [{ text, visuel }] — un par plan du storyboard
let montageImages = [];     // [{ blob, apercu } | null] — même ordre/longueur que montagePlans
let montageVoixOff = null;  // { blob, url, durations } — générée par ElevenLabs
let montageEnCours = false;
let montageVoixEnCours = false;
let montageImagesEnCours = false;
let montageVoixListe = [];  // [{ id, label }] — voix ElevenLabs configurées (voir api/montage-voices.js)
let montageVoixId = '';     // id de la voix actuellement choisie

// Bouton "Générer la vidéo" inséré à la suite de chaque storyboard généré
// (Récit, Script, Storyboard seul, Série — génération en direct ET
// réouverture depuis l'historique). Masqué par CSS pour tout le monde sauf
// le fondateur (.montage-trigger-btn, voir css/style.css).
//
// `plans` est mémorisé dans un registre à clé (comme storeCopyText pour le
// texte) plutôt que capturé dans une closure : certains appelants (le
// storyboard déjà généré d'un épisode de Série, voir js/serie.js
// renderSerieStoryboard) renvoient une chaîne HTML sans jamais avoir de
// référence DOM directe sur laquelle attacher un .onclick après coup —
// l'onclick doit donc être auto-suffisant dès la génération du HTML.
window._montageSourceStore = window._montageSourceStore || {};
function storeMontageSource(plans) {
  const key = '__montagekey_' + (window._montageSourceCounter = (window._montageSourceCounter || 0) + 1);
  window._montageSourceStore[key] = plans;
  return key;
}
function ouvrirMontageParCle(key) {
  const plans = window._montageSourceStore[key];
  if (plans) ouvrirMontage(plans);
}
function montageBoutonHTML(id, plans) {
  const cle = storeMontageSource(plans);
  return `<button class="btn-regenerate montage-trigger-btn" id="${id}" type="button" onclick="ouvrirMontageParCle('${cle}')">🎬 Générer la vidéo</button>`;
}

function ouvrirMontage(plans) {
  montagePlans = (plans || [])
    .map(p => ({ text: p.text || p.texte || p.texte_dit || '', visuel: p.visuel || p.prompt_visuel || '' }))
    .filter(p => p.text);
  montageImages = new Array(montagePlans.length).fill(null);
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
  const modal = document.getElementById('montageModal');
  if (modal) modal.classList.add('active');
}

function fermerMontage() {
  if (montageEnCours) return; // un rendu est en cours : on ne ferme pas dessus
  const modal = document.getElementById('montageModal');
  if (modal) modal.classList.remove('active');
}

// Décode une chaîne base64 (renvoyée par ElevenLabs ou Gemini) en Blob.
function base64VersBlob(base64, mimeType) {
  const octets = atob(base64);
  const tampon = new Uint8Array(octets.length);
  for (let i = 0; i < octets.length; i++) tampon[i] = octets.charCodeAt(i);
  return new Blob([tampon], { type: mimeType });
}

async function genererImagesMontage() {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageImagesEnCours) return;

  montageImagesEnCours = true;
  renderMontageEtat();
  try {
    const rep = await fetch('/api/montage-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: montagePlans.map(p => p.visuel || p.text) })
    });
    const data = await rep.json();
    if (!rep.ok) throw new Error((data.error && data.error.message) || 'Les images n\'ont pas pu être générées.');

    montageImages = (data.images || []).map(img => img
      ? { blob: base64VersBlob(img.base64, img.mimeType || 'image/png'), apercu: 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.base64 }
      : null);
    const echecs = (data.erreurs || []).filter(Boolean).length;
    if (echecs > 0 && err) {
      err.textContent = echecs + ' image(s) n\'ont pas pu être générées (voir ✕ ci-dessus) — réessaie-les une par une.';
      err.style.display = 'block';
    }
  } catch (e) {
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
  } finally {
    montageImagesEnCours = false;
    renderMontageEtat();
  }
}

async function regenererImageMontage(i) {
  const plan = montagePlans[i];
  if (!plan || montageImagesEnCours) return;
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';

  montageImagesEnCours = true;
  renderMontageEtat();
  try {
    const rep = await fetch('/api/montage-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: [plan.visuel || plan.text] })
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
// api/montage-voices.js) et remplit le sélecteur. Le menu reste caché s'il
// n'y a qu'une seule voix disponible — rien à choisir dans ce cas.
async function chargerVoixMontage() {
  const select = document.getElementById('montageVoixSelect');
  if (!select) return;
  try {
    const rep = await fetch('/api/montage-voices');
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
    const rep = await fetch('/api/montage-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: montagePlans.map(p => p.text), voiceId: montageVoixId })
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
      if (img) return `<div class="audit-thumb"><img src="${img.apercu}" alt=""></div>`;
      return `<div class="audit-thumb montage-thumb-echec" onclick="regenererImageMontage(${i})" title="Réessayer">↻</div>`;
    }).join('');
  }
  const btnGenImg = document.getElementById('montageGenImagesBtn');
  if (btnGenImg) {
    btnGenImg.disabled = montageImagesEnCours;
    btnGenImg.textContent = montageImagesEnCours ? 'Génération des images…' : (nbPretes ? '↻ Régénérer les images' : '🎨 Générer les images');
  }

  const zoneVoix = document.getElementById('montageVoixZone');
  if (zoneVoix) {
    if (montageVoixEnCours) {
      zoneVoix.innerHTML = `<div class="montage-statut" style="margin-top:0">Génération de la voix off…</div>`;
    } else if (montageVoixOff) {
      zoneVoix.innerHTML = `
        <audio class="montage-audio-preview" src="${montageVoixOff.url}" controls></audio>
        <button class="btn-regenerate" style="margin-top:10px" onclick="genererVoixOffMontage()" type="button">↻ Régénérer la voix off</button>`;
    } else {
      zoneVoix.innerHTML = `<button class="btn-regenerate" onclick="genererVoixOffMontage()" type="button">🎙️ Générer la voix off</button>`;
    }
  }

  const btn = document.getElementById('montageLancerBtn');
  if (btn) btn.disabled = montageEnCours || montageVoixEnCours || montageImagesEnCours
    || !montagePlans.length || nbPretes !== montagePlans.length || !montageVoixOff;
}

async function lancerMontage() {
  const err = document.getElementById('montageErreur');
  const statut = document.getElementById('montageStatut');
  const resultat = document.getElementById('montageResultat');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageImages.filter(Boolean).length !== montagePlans.length || !montageVoixOff) return;
  if (!supabaseClient) {
    if (err) { err.textContent = 'Connexion au stockage indisponible.'; err.style.display = 'block'; }
    return;
  }

  montageEnCours = true;
  renderMontageEtat();
  if (resultat) resultat.innerHTML = '';
  if (statut) { statut.style.display = 'block'; statut.textContent = 'Envoi des fichiers…'; }

  try {
    const dossier = 'montage-' + Date.now();

    // Durées EXACTES : renvoyées par ElevenLabs (horodatage caractère par
    // caractère), pas une estimation ni une mesure côté navigateur.
    const durees = montageVoixOff.durations;

    // Chaque étape est isolée dans son propre try/catch avec un préfixe
    // distinct : une exception native (Supabase, fetch…) qui ne passe pas
    // par nos messages français habituels reste quand même identifiable —
    // sans ça, une erreur générique du navigateur ne dit pas à quelle étape
    // (upload images, upload audio, ou rendu) elle s'est produite.
    const images = [];
    try {
      for (let i = 0; i < montageImages.length; i++) {
        const chemin = dossier + '/img-' + (i + 1) + '.jpg';
        const { error } = await supabaseClient.storage.from('montages').upload(chemin, montageImages[i].blob, { contentType: montageImages[i].blob.type || 'image/png' });
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
    // crédits — voir historique de ce fichier).
    if (statut) statut.textContent = 'Montage en cours (peut prendre plusieurs minutes selon le nombre de plans)…';
    let dataRender;
    try {
      const rRender = await fetch('/api/montage-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, audioUrl: dataAudio.publicUrl })
      });
      dataRender = await rRender.json();
      if (!rRender.ok || !dataRender.url) throw new Error((dataRender.error && dataRender.error.message) || 'Le montage n\'a pas pu être généré.');
    } catch (e) { throw new Error('Rendu de la vidéo : ' + e.message); }

    if (statut) statut.style.display = 'none';
    if (resultat) resultat.innerHTML = `
      <video class="montage-video" src="${dataRender.url}" controls playsinline></video>
      <a class="btn-regenerate" style="display:inline-block;margin-top:12px" href="/api/montage-download?url=${encodeURIComponent(dataRender.url)}" download="scriptura-montage.mp4">⬇ Télécharger la vidéo</a>`;
  } catch (e) {
    if (statut) statut.style.display = 'none';
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
  } finally {
    montageEnCours = false;
    renderMontageEtat();
  }
}

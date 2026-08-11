// ═══════════════════════════════════════════════════════════
//  MONTAGE VIDÉO — assemblage images + voix off via JSON2Video
//  Réservé au fondateur (bouton visible uniquement en body.is-admin).
//  L'utilisateur génère ses images HORS Scriptura et les uploade ici ; la
//  voix off est générée par Scriptura même (ElevenLabs, voir
//  api/montage-tts.js) à partir du texte déjà présent dans le storyboard —
//  ce qui donne la durée EXACTE de chaque plan (horodatage renvoyé par
//  ElevenLabs), sans avoir à estimer ni mesurer un fichier après coup.
// ═══════════════════════════════════════════════════════════

let montagePlans = [];      // [{ text }] — un par plan du storyboard
let montageImages = [];     // [{ blob, apercu, nom }] — même ordre que montagePlans
let montageVoixOff = null;  // { blob, url, durations } — générée par ElevenLabs
let montageEnCours = false;
let montageVoixEnCours = false;

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
  montagePlans = (plans || []).map(p => ({ text: p.text || p.texte || p.texte_dit || '' })).filter(p => p.text);
  montageImages = [];
  montageVoixOff = null;
  montageEnCours = false;
  montageVoixEnCours = false;
  const inputImg = document.getElementById('montageImagesInput');
  if (inputImg) inputImg.value = '';
  const resultat = document.getElementById('montageResultat');
  if (resultat) resultat.innerHTML = '';
  const statut = document.getElementById('montageStatut');
  if (statut) statut.style.display = 'none';
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  const compteAttendu = document.getElementById('montageCompteAttendu');
  if (compteAttendu) compteAttendu.textContent = montagePlans.length;
  renderMontageEtat();
  const modal = document.getElementById('montageModal');
  if (modal) modal.classList.add('active');
}

function fermerMontage() {
  if (montageEnCours) return; // un rendu est en cours : on ne ferme pas dessus
  const modal = document.getElementById('montageModal');
  if (modal) modal.classList.remove('active');
}

function prepareImageMontage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('lecture impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image invalide'));
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error('compression impossible'));
          resolve({ blob, apercu: canvas.toDataURL('image/jpeg', 0.5), nom: file.name || 'image.jpg' });
        }, 'image/jpeg', 0.85);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function ajouterImagesMontage(files) {
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  const liste = Array.from(files || []).filter(f => f.type.startsWith('image/'));
  for (const f of liste) {
    if (montageImages.length >= montagePlans.length) {
      if (err) {
        err.textContent = 'Il faut exactement ' + montagePlans.length + ' image(s), une par plan — inutile d\'en ajouter plus.';
        err.style.display = 'block';
      }
      break;
    }
    try { montageImages.push(await prepareImageMontage(f)); }
    catch (e) { console.warn('Image ignorée', e); }
  }
  const inputImg = document.getElementById('montageImagesInput');
  if (inputImg) inputImg.value = '';
  renderMontageEtat();
}

function retirerImageMontage(i) {
  montageImages.splice(i, 1);
  renderMontageEtat();
}

// Décode une chaîne base64 (renvoyée par ElevenLabs) en Blob audio.
function base64VersBlob(base64, mimeType) {
  const octets = atob(base64);
  const tampon = new Uint8Array(octets.length);
  for (let i = 0; i < octets.length; i++) tampon[i] = octets.charCodeAt(i);
  return new Blob([tampon], { type: mimeType });
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
      body: JSON.stringify({ segments: montagePlans.map(p => p.text) })
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
  const compte = document.getElementById('montageImagesCompte');
  if (compte) compte.textContent = montageImages.length + ' / ' + montagePlans.length + ' image(s)';

  const zoneImg = document.getElementById('montageImagesThumbs');
  if (zoneImg) {
    zoneImg.innerHTML = montageImages.map((img, i) => `
      <div class="audit-thumb">
        <img src="${img.apercu}" alt="">
        <button class="audit-thumb-del" onclick="retirerImageMontage(${i})" type="button">✕</button>
      </div>`).join('');
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
  if (btn) btn.disabled = montageEnCours || montageVoixEnCours || !montagePlans.length || montageImages.length !== montagePlans.length || !montageVoixOff;
}

async function lancerMontage() {
  const err = document.getElementById('montageErreur');
  const statut = document.getElementById('montageStatut');
  const resultat = document.getElementById('montageResultat');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageImages.length !== montagePlans.length || !montageVoixOff) return;
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

    const images = [];
    for (let i = 0; i < montageImages.length; i++) {
      const chemin = dossier + '/img-' + (i + 1) + '.jpg';
      const { error } = await supabaseClient.storage.from('montages').upload(chemin, montageImages[i].blob, { contentType: 'image/jpeg' });
      if (error) throw new Error('Upload image ' + (i + 1) + ' : ' + error.message);
      const { data } = supabaseClient.storage.from('montages').getPublicUrl(chemin);
      images.push({ url: data.publicUrl, duration: durees[i] || 2 });
    }

    const cheminAudio = dossier + '/voix-off.mp3';
    const { error: errAudio } = await supabaseClient.storage.from('montages').upload(cheminAudio, montageVoixOff.blob, { contentType: 'audio/mpeg' });
    if (errAudio) throw new Error('Upload voix off : ' + errAudio.message);
    const { data: dataAudio } = supabaseClient.storage.from('montages').getPublicUrl(cheminAudio);

    if (statut) statut.textContent = 'Lancement du montage…';
    const rGen = await fetch('/api/montage-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, audioUrl: dataAudio.publicUrl })
    });
    const dataGen = await rGen.json();
    if (!rGen.ok || !dataGen.project) throw new Error((dataGen.error && dataGen.error.message) || 'Le montage n\'a pas pu démarrer.');

    if (statut) statut.textContent = 'Rendu en cours (peut prendre plusieurs minutes selon le nombre de plans)…';
    const project = dataGen.project;
    const debut = Date.now();
    // Une vidéo à 15-20 plans (fondus + zoom sur chaque image) prend plus
    // longtemps à encoder qu'un montage court : marge large pour ne pas
    // déclencher une fausse erreur sur un rendu qui avance encore normalement.
    const DELAI_MAX = 15 * 60 * 1000;

    while (true) {
      await new Promise(r => setTimeout(r, 4000));
      const rSt = await fetch('/api/montage-status?project=' + encodeURIComponent(project));
      const dataSt = await rSt.json();
      if (dataSt.status === 'done' && dataSt.url) {
        if (statut) statut.style.display = 'none';
        if (resultat) resultat.innerHTML = `
          <video class="montage-video" src="${dataSt.url}" controls playsinline></video>
          <a class="btn-regenerate" style="display:inline-block;margin-top:12px" href="/api/montage-download?url=${encodeURIComponent(dataSt.url)}" download="scriptura-montage.mp4">⬇ Télécharger la vidéo</a>`;
        break;
      }
      if (dataSt.status === 'error') throw new Error(dataSt.message || 'Le rendu a échoué côté JSON2Video.');
      if (Date.now() - debut > DELAI_MAX) throw new Error('Le rendu prend plus de temps que prévu — réessaie plus tard.');
    }
  } catch (e) {
    if (statut) statut.style.display = 'none';
    if (err) { err.textContent = 'Erreur : ' + e.message; err.style.display = 'block'; }
  } finally {
    montageEnCours = false;
    renderMontageEtat();
  }
}

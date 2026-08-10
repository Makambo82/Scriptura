// ═══════════════════════════════════════════════════════════
//  MONTAGE VIDÉO — assemblage images + voix off via JSON2Video
//  Réservé au fondateur (bouton visible uniquement en body.is-admin).
//  L'utilisateur génère ses images et sa voix off HORS Scriptura, les
//  uploade ici : cette page ne fait QUE l'assemblage (timeline calée sur
//  la durée narrative de chaque plan, voir js/storyboard.js dureeDe()).
// ═══════════════════════════════════════════════════════════

let montagePlans = [];    // [{ text, seconds }] — un par plan du storyboard
let montageImages = [];   // [{ blob, apercu, nom }] — même ordre que montagePlans
let montageAudio = null;  // { file, nom }
let montageEnCours = false;

// Bouton "Générer la vidéo" inséré à la suite de chaque storyboard généré
// (Récit, Script, Storyboard seul, Série). Masqué par CSS pour tout le
// monde sauf le fondateur (.montage-trigger-btn, voir css/style.css).
function montageBoutonHTML(id) {
  return `<button class="btn-regenerate montage-trigger-btn" id="${id}" type="button">🎬 Générer la vidéo</button>`;
}

function ouvrirMontage(plans) {
  montagePlans = (plans || []).map(p => {
    const texte = p.text || p.texte || p.texte_dit || '';
    return { text: texte, seconds: Math.max(DUREE_MIN, dureeDe(texte)) };
  });
  montageImages = [];
  montageAudio = null;
  montageEnCours = false;
  const inputImg = document.getElementById('montageImagesInput');
  const inputAudio = document.getElementById('montageAudioInput');
  if (inputImg) inputImg.value = '';
  if (inputAudio) inputAudio.value = '';
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

function ajouterAudioMontage(files) {
  const f = (files || [])[0];
  const inputAudio = document.getElementById('montageAudioInput');
  if (inputAudio) inputAudio.value = '';
  if (!f || !f.type.startsWith('audio/')) return;
  montageAudio = { file: f, nom: f.name || 'voix-off' };
  renderMontageEtat();
}

function retirerAudioMontage() {
  montageAudio = null;
  renderMontageEtat();
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

  const zoneAudio = document.getElementById('montageAudioZone');
  if (zoneAudio) {
    zoneAudio.innerHTML = montageAudio
      ? `<div class="montage-audio-chip">🎙️ ${montageAudio.nom}<button class="montage-audio-del" onclick="retirerAudioMontage()" type="button">✕</button></div>`
      : '';
  }

  const btn = document.getElementById('montageLancerBtn');
  if (btn) btn.disabled = montageEnCours || !montagePlans.length || montageImages.length !== montagePlans.length || !montageAudio;
}

async function lancerMontage() {
  const err = document.getElementById('montageErreur');
  const statut = document.getElementById('montageStatut');
  const resultat = document.getElementById('montageResultat');
  if (err) err.style.display = 'none';
  if (!montagePlans.length || montageImages.length !== montagePlans.length || !montageAudio) return;
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

    const images = [];
    for (let i = 0; i < montageImages.length; i++) {
      const chemin = dossier + '/img-' + (i + 1) + '.jpg';
      const { error } = await supabaseClient.storage.from('montages').upload(chemin, montageImages[i].blob, { contentType: 'image/jpeg' });
      if (error) throw new Error('Upload image ' + (i + 1) + ' : ' + error.message);
      const { data } = supabaseClient.storage.from('montages').getPublicUrl(chemin);
      images.push({ url: data.publicUrl, duration: Math.round(montagePlans[i].seconds * 10) / 10 });
    }

    const extAudio = (montageAudio.file.name || '').match(/\.[^.]+$/);
    const cheminAudio = dossier + '/voix-off' + (extAudio ? extAudio[0] : '.mp3');
    const { error: errAudio } = await supabaseClient.storage.from('montages').upload(cheminAudio, montageAudio.file, { contentType: montageAudio.file.type || 'audio/mpeg' });
    if (errAudio) throw new Error('Upload audio : ' + errAudio.message);
    const { data: dataAudio } = supabaseClient.storage.from('montages').getPublicUrl(cheminAudio);

    if (statut) statut.textContent = 'Lancement du montage…';
    const rGen = await fetch('/api/montage-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, audioUrl: dataAudio.publicUrl })
    });
    const dataGen = await rGen.json();
    if (!rGen.ok || !dataGen.project) throw new Error((dataGen.error && dataGen.error.message) || 'Le montage n\'a pas pu démarrer.');

    if (statut) statut.textContent = 'Rendu en cours (peut prendre 1 à 3 minutes)…';
    const project = dataGen.project;
    const debut = Date.now();
    const DELAI_MAX = 6 * 60 * 1000;

    while (true) {
      await new Promise(r => setTimeout(r, 4000));
      const rSt = await fetch('/api/montage-status?project=' + encodeURIComponent(project));
      const dataSt = await rSt.json();
      if (dataSt.status === 'done' && dataSt.url) {
        if (statut) statut.style.display = 'none';
        if (resultat) resultat.innerHTML = `
          <video class="montage-video" src="${dataSt.url}" controls playsinline></video>
          <a class="btn-regenerate" style="display:inline-block;margin-top:12px" href="${dataSt.url}" download target="_blank" rel="noopener">⬇ Télécharger la vidéo</a>`;
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

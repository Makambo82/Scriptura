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
  const err = document.getElementById('montageErreur');
  if (err) err.style.display = 'none';
  if (!f) return;
  // iOS ne fournit pas toujours le type MIME d'un fichier choisi dans Fichiers :
  // on accepte donc aussi par extension, sinon un mp3 valide serait rejeté.
  const estAudio = (f.type && f.type.startsWith('audio/'))
    || /\.(mp3|wav|m4a|aac|ogg|oga|flac|aif|aiff|mp4|weba)$/i.test(f.name || '');
  if (!estAudio) {
    if (err) { err.textContent = 'Choisis un fichier audio (mp3, wav, m4a…).'; err.style.display = 'block'; }
    return;
  }
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

// Mesure la durée (en secondes) d'un fichier audio côté navigateur, via un
// élément <audio> et ses métadonnées. Renvoie 0 si illisible (on retombe
// alors sur l'estimation par le texte).
function dureeAudio(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () => { const d = a.duration; URL.revokeObjectURL(url); resolve(isFinite(d) && d > 0 ? d : 0); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      a.src = url;
    } catch (e) { resolve(0); }
  });
}

// Répartit la durée totale de la voix off sur les images, proportionnellement
// à la part de texte de chaque plan. La dernière image absorbe l'arrondi pour
// que la somme colle exactement à la voix off. Si la voix n'est pas mesurable,
// on garde l'estimation par le texte.
async function calculerDureesImages() {
  const dureeVoix = montageAudio ? await dureeAudio(montageAudio.file) : 0;
  const totalEstime = montagePlans.reduce((s, p) => s + p.seconds, 0) || 1;
  const facteur = (dureeVoix > 0) ? dureeVoix / totalEstime : 1;
  const durees = montagePlans.map(p => Math.max(1, Math.round(p.seconds * facteur * 10) / 10));
  if (dureeVoix > 0 && durees.length) {
    const somme = durees.reduce((a, b) => a + b, 0);
    const reste = Math.round((dureeVoix - somme) * 10) / 10;
    const dernier = durees.length - 1;
    durees[dernier] = Math.max(1, Math.round((durees[dernier] + reste) * 10) / 10);
  }
  return durees;
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

    // Caler la durée des images sur la VRAIE voix off : on mesure la durée du
    // fichier audio et on répartit les images proportionnellement à leur part
    // de texte, mais de façon à couvrir TOUTE la voix off — comme étirer les
    // images sur la timeline dans CapCut. Sans ça, l'estimation (mots ÷ vitesse)
    // est plus courte que la voix réelle et les images se terminent avant la fin.
    const durees = await calculerDureesImages();

    const images = [];
    for (let i = 0; i < montageImages.length; i++) {
      const chemin = dossier + '/img-' + (i + 1) + '.jpg';
      const { error } = await supabaseClient.storage.from('montages').upload(chemin, montageImages[i].blob, { contentType: 'image/jpeg' });
      if (error) throw new Error('Upload image ' + (i + 1) + ' : ' + error.message);
      const { data } = supabaseClient.storage.from('montages').getPublicUrl(chemin);
      images.push({ url: data.publicUrl, duration: durees[i] });
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
          <button class="btn-regenerate" id="montageTelechargerBtn" type="button" style="display:inline-block;margin-top:12px" onclick="telechargerVideoMontage('${dataSt.url}')">⬇ Télécharger la vidéo</button>`;
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

// Un lien <a download> vers une URL distante (autre domaine que Scriptura,
// ici JSON2Video/Supabase) est ignoré par Safari iOS : il se contente
// d'ouvrir/lire la vidéo au lieu de proposer de l'enregistrer. On récupère
// donc la vidéo en mémoire (blob, donc "même origine" pour le navigateur),
// puis on passe par le partage natif (menu "Enregistrer la vidéo") — ou, à
// défaut, un lien de téléchargement sur ce blob, qui lui fonctionne bien.
async function telechargerVideoMontage(url) {
  const btn = document.getElementById('montageTelechargerBtn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }
  try {
    const rep = await fetch(url);
    if (!rep.ok) throw new Error('vidéo introuvable');
    const blob = await rep.blob();
    const fichier = new File([blob], 'scriptura-montage.mp4', { type: blob.type || 'video/mp4' });

    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier] });
    } else {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = 'scriptura-montage.mp4';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') window.open(url, '_blank'); // repli : ouvrir la vidéo telle quelle
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

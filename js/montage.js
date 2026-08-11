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
      let fini = false;
      const terminer = (d) => {
        if (fini) return;
        fini = true;
        URL.revokeObjectURL(url);
        resolve(isFinite(d) && d > 0 ? d : 0);
      };
      a.onerror = () => terminer(0);
      a.onloadedmetadata = () => {
        if (isFinite(a.duration)) { terminer(a.duration); return; }
        // Bug connu (Safari/Chrome) : certains MP3 à débit variable renvoient
        // une durée Infinity tant qu'on n'a pas cherché jusqu'à la fin —
        // sans ce contournement, la durée retombe silencieusement à
        // l'estimation par le texte, plus courte que la vraie voix off
        // (les images se terminent alors avant la fin de l'audio).
        a.currentTime = 1e101;
        a.ontimeupdate = () => terminer(a.duration);
      };
      a.src = url;
      // Garde-fou : si rien ne se déclenche (fichier inhabituel), ne jamais
      // bloquer indéfiniment le lancement du montage.
      setTimeout(() => terminer(a.duration), 5000);
    } catch (e) { resolve(0); }
  });
}

// Répartit la durée totale de la voix off sur les images, proportionnellement
// à la part de texte de chaque plan. La dernière image absorbe l'arrondi ET
// une marge de sécurité (MARGE_SECURITE) pour que la somme des images ne
// tombe JAMAIS un peu sous la vraie durée de la voix off — un écart, même
// d'une fraction de seconde, entre la mesure faite ici et celle que JSON2Video
// fait lui-même du même fichier (arrondis, décodage) suffit à faire finir les
// images avant l'audio (l'élément audio, au niveau du film entier, impose sa
// propre longueur naturelle). Une dernière image qui dure un peu plus
// longtemps que nécessaire est un bien moindre mal qu'un écran figé pendant
// que la voix continue. Si la voix n'est pas mesurable, on garde l'estimation
// par le texte.
async function calculerDureesImages() {
  const dureeVoix = montageAudio ? await dureeAudio(montageAudio.file) : 0;
  const totalEstime = montagePlans.reduce((s, p) => s + p.seconds, 0) || 1;
  const facteur = (dureeVoix > 0) ? dureeVoix / totalEstime : 1;
  const durees = montagePlans.map(p => Math.max(1, Math.round(p.seconds * facteur * 10) / 10));
  if (dureeVoix > 0 && durees.length) {
    const MARGE_SECURITE = Math.max(1.5, dureeVoix * 0.03);
    const somme = durees.reduce((a, b) => a + b, 0);
    const reste = Math.round((dureeVoix + MARGE_SECURITE - somme) * 10) / 10;
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

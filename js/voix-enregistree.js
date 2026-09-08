// ═══════════════════════════════════════════════════════════
//  ENREGISTRER SA VOIX DIRECTEMENT DANS L'APP
//
//  Suggestion d'un vrai utilisateur (celui à qui le propriétaire a offert un
//  plan Creator) : « permettre que l'utilisateur puisse enregistrer sa propre
//  voix en direct sur l'app ».
//
//  POURQUOI C'EST UNE BONNE IDÉE ÉCONOMIQUEMENT, en plus d'être demandée : la
//  voix générée est facturée AU CARACTÈRE chez ElevenLabs, à chaque génération
//  ET à chaque « Régénérer ». Elle ne consomme aucun quota côté créateur, donc
//  c'est le propriétaire qui paie. Une voix enregistrée ne coûte rien à
//  personne.
//
//  CE MODULE NE CONNAÎT NI LE MONTAGE NI L'INTERFACE : il ouvre le micro,
//  enregistre, et rend un fichier avec sa durée. Les deux écrans de montage
//  (storyboard et manuel) l'utilisent, ce qui évite le sort réservé à l'import
//  MP3 et au bouton musique, livrés d'un seul côté puis oubliés de l'autre.
//
//  CONTEXTE SÉCURISÉ OBLIGATOIRE : navigator.mediaDevices n'existe qu'en HTTPS
//  (ou sur localhost). Vercel sert l'app en HTTPS, donc c'est acquis en
//  production ; enregistrementVoixDisponible() le vérifie quand même, pour que
//  le bouton ne s'affiche pas là où il ne peut pas fonctionner.
// ═══════════════════════════════════════════════════════════

// Par ordre de préférence. Opus est le plus léger, mais Safari (donc TOUT
// iPhone, quel que soit le navigateur affiché) n'enregistre qu'en mp4/AAC.
// FFmpeg lit les deux, le service de rendu n'a donc rien à savoir de ça.
const VOIX_FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

// Garde-fou : dix minutes. Personne ne fait une voix off TikTok plus longue,
// et un enregistrement oublié en marche remplirait la mémoire du téléphone.
const VOIX_DUREE_MAX_S = 600;

let _voixEnregistrement = null;   // { recorder, flux, morceaux, debut, contexte, animation, minuteur }

function enregistrementVoixDisponible() {
  return typeof MediaRecorder !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function formatEnregistrementVoix() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const f of VOIX_FORMATS) {
    if (MediaRecorder.isTypeSupported(f)) return f;
  }
  return '';   // on laisse le navigateur choisir
}

// L'extension doit suivre le VRAI type du fichier. Le montage storyboard
// téléversait jusqu'ici « voix-off.mp3 » en audio/mpeg en dur, ce qui était
// juste tant que la voix venait d'ElevenLabs (toujours du MP3) et devient faux
// dès qu'elle vient du micro.
function extensionAudioDepuisType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('webm')) return 'webm';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('mp4') || t.includes('aac') || t.includes('m4a')) return 'm4a';
  if (t.includes('wav')) return 'wav';
  return 'mp3';
}

function enregistrementVoixEnCours() {
  return !!_voixEnregistrement;
}

// `surNiveau` reçoit un niveau sonore entre 0 et 1, plusieurs fois par
// seconde. Il sert à afficher un indicateur pendant la prise : sans lui, on
// découvre qu'on était trop loin du micro APRÈS avoir lu tout son texte.
// `surLimite` est appelé si le garde-fou de durée coupe l'enregistrement.
async function demarrerEnregistrementVoix(surNiveau, surLimite) {
  if (_voixEnregistrement) return;
  if (!enregistrementVoixDisponible()) {
    throw new Error('Ce navigateur ne sait pas enregistrer le micro. Sur iPhone, ouvre Scriptura dans Safari.');
  }

  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      // Ce que le navigateur sait faire gratuitement et qui compte vraiment
      // pour une voix off amateur : couper l'écho, réduire le bruit de fond,
      // égaliser le volume quand on s'éloigne du téléphone.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (e) {
    // On traduit les noms d'erreur du navigateur : « NotAllowedError » ne dit
    // rien à un créateur, et c'est pourtant le cas le plus fréquent.
    if (e && e.name === 'NotAllowedError') {
      throw new Error('Micro refusé. Autorise le micro pour Scriptura dans les réglages de ton navigateur, puis réessaie.');
    }
    if (e && (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError')) {
      throw new Error('Aucun micro trouvé sur cet appareil.');
    }
    throw new Error('Le micro n\'a pas pu être ouvert : ' + ((e && e.message) || 'raison inconnue'));
  }

  const format = formatEnregistrementVoix();
  const recorder = new MediaRecorder(flux, format ? { mimeType: format } : undefined);
  const morceaux = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) morceaux.push(e.data); };

  const etat = { recorder, flux, morceaux, debut: 0, contexte: null, animation: null, minuteur: null };
  _voixEnregistrement = etat;

  // Indicateur de niveau. Purement décoratif : s'il échoue (AudioContext
  // indisponible, onglet en arrière-plan), l'enregistrement continue.
  if (typeof surNiveau === 'function') {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const contexte = new Ctx();
      const source = contexte.createMediaStreamSource(flux);
      const analyseur = contexte.createAnalyser();
      analyseur.fftSize = 512;
      source.connect(analyseur);
      const donnees = new Uint8Array(analyseur.frequencyBinCount);
      etat.contexte = contexte;
      const boucle = () => {
        if (_voixEnregistrement !== etat) return;
        analyseur.getByteTimeDomainData(donnees);
        // Écart quadratique moyen autour du silence (128) : un vrai niveau
        // sonore, pas un pic isolé qui ferait sauter la jauge.
        let somme = 0;
        for (let i = 0; i < donnees.length; i++) {
          const d = (donnees[i] - 128) / 128;
          somme += d * d;
        }
        const niveau = Math.min(1, Math.sqrt(somme / donnees.length) * 4);
        surNiveau(niveau);
        etat.animation = requestAnimationFrame(boucle);
      };
      etat.animation = requestAnimationFrame(boucle);
    } catch (e) { /* l'indicateur est un confort, jamais une condition */ }
  }

  etat.debut = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  recorder.start();

  etat.minuteur = setTimeout(() => {
    if (_voixEnregistrement === etat) {
      if (typeof surLimite === 'function') surLimite();
      arreterEnregistrementVoix().catch(() => {});
    }
  }, VOIX_DUREE_MAX_S * 1000);
}

function _libererEnregistrement(etat) {
  if (etat.minuteur) clearTimeout(etat.minuteur);
  if (etat.animation) cancelAnimationFrame(etat.animation);
  // Les pistes du micro sont coupées EXPLICITEMENT : sans ça, la pastille
  // rouge « micro actif » reste allumée sur le téléphone après la prise, ce
  // qui est inquiétant et, à juste titre, mal vu.
  if (etat.flux) etat.flux.getTracks().forEach(t => t.stop());
  if (etat.contexte && etat.contexte.close) etat.contexte.close().catch(() => {});
}

// Rend { blob, url, duree, type }. La durée est MESURÉE au chronomètre : un
// fichier webm produit par MediaRecorder ne porte pas toujours sa durée dans
// ses métadonnées, et un <audio> renvoie alors Infinity. Le service de rendu
// recale de toute façon la vidéo sur la durée réelle de l'audio qu'il mesure
// lui-même (calerDureesSurAudio), donc un écart de quelques centièmes ne
// désynchronise rien.
function arreterEnregistrementVoix() {
  const etat = _voixEnregistrement;
  if (!etat) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    etat.recorder.onstop = () => {
      const fin = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const duree = Math.max(0, (fin - etat.debut) / 1000);
      _libererEnregistrement(etat);
      _voixEnregistrement = null;
      const type = etat.recorder.mimeType || formatEnregistrementVoix() || 'audio/webm';
      const blob = new Blob(etat.morceaux, { type });
      if (!blob.size) { reject(new Error('L\'enregistrement est vide. Vérifie que le micro n\'est pas coupé.')); return; }
      resolve({ blob, url: URL.createObjectURL(blob), duree, type });
    };
    try { etat.recorder.stop(); } catch (e) {
      _libererEnregistrement(etat);
      _voixEnregistrement = null;
      reject(new Error('L\'enregistrement n\'a pas pu être arrêté : ' + e.message));
    }
  });
}

function annulerEnregistrementVoix() {
  const etat = _voixEnregistrement;
  if (!etat) return;
  _voixEnregistrement = null;
  etat.recorder.onstop = null;
  try { etat.recorder.stop(); } catch (e) { /* déjà arrêté */ }
  _libererEnregistrement(etat);
}

// ── SYNCHRONISER LES IMAGES SUR UNE VOIX ENREGISTRÉE ──
// La voix d'ElevenLabs arrive avec un horodatage caractère par caractère : on
// sait à la milliseconde près quand chaque plan est dit. Un enregistrement
// n'a rien de tout ça.
//
// ON RÉPARTIT DONC AU PRORATA DU NOMBRE DE MOTS de chaque plan, ce qui est
// bien plus juste qu'un partage à parts égales : un plan de vingt mots dure
// vraiment deux fois plus longtemps qu'un plan de dix. Ça reste une
// approximation, et elle est assumée : c'est le prix d'une voix qu'on
// enregistre soi-même.
//
// PLANCHER D'UNE SECONDE par image, comme dans le service de rendu : en
// dessous, on ne voit pas l'image passer. Le reliquat est repris sur les plans
// qui ont de la marge, au prorata là encore.
function repartirDureesParMots(textes, dureeTotale) {
  const liste = Array.isArray(textes) ? textes : [];
  if (!liste.length || !(dureeTotale > 0)) return liste.map(() => 0);

  const PLANCHER = 1;
  const poids = liste.map(t => Math.max(1, String(t || '').split(/\s+/).filter(Boolean).length));
  const total = poids.reduce((a, b) => a + b, 0);
  let durees = poids.map(p => dureeTotale * p / total);

  // Trop court pour tenir le plancher partout : on répartit à parts égales,
  // c'est le mieux qu'on puisse faire et ça reste cohérent.
  if (dureeTotale < PLANCHER * liste.length) {
    return liste.map(() => dureeTotale / liste.length);
  }

  const sousPlancher = durees.map(d => d < PLANCHER);
  if (sousPlancher.some(Boolean)) {
    const manque = durees.reduce((s, d, i) => s + (sousPlancher[i] ? PLANCHER - d : 0), 0);
    const poidsRestants = durees.reduce((s, d, i) => s + (sousPlancher[i] ? 0 : d), 0);
    durees = durees.map((d, i) => sousPlancher[i]
      ? PLANCHER
      : d - manque * (d / poidsRestants));
  }
  return durees.map(d => Math.round(d * 1000) / 1000);
}

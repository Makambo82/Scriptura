// ═══════════════════════════════════════════════════════════
//  Service de rendu vidéo Scriptura (hébergé HORS Vercel)
//
//  Pourquoi un service séparé : le rendu FFmpeg est trop lourd et trop long
//  pour le plan Vercel gratuit (300 s / 1 Go imposés, non contournables), ce
//  qui forçait des compromis, découpage en lots (coupes nettes toutes les 5
//  images), 720p/15fps, et une synchro image/voix approximative. Sur un vrai
//  hébergeur (Render, Railway, Fly…) on lève les compromis de qualité :
//  durées respectées au millième, transitions variées, Ken Burns varié, 1080p.
//  Le rendu reste découpé en LOTS (voir TAILLE_LOT), non par limite de temps,
//  mais pour borner la mémoire : un seul graphe de ~20 images 1080p sature la
//  RAM (OOM, "FFmpeg killed / code null"). Les lots sont plus grands que sur
//  Vercel, donc quasiment tout en fondu croisé, coupure nette rare entre lots.
//
//  Endpoint : POST /render  { images: [{url, duration}], audioUrl }
//             → { url } (vidéo mp4 ré-uploadée dans Supabase Storage)
//  Santé    : GET /        → 200 "OK"
//
//  Graphe FFmpeg validé par exécution réelle (durée de sortie = somme exacte
//  des durées ; chaque image apparaît pile à sa position). Voir le README
//  pour le déploiement pas à pas.
// ═══════════════════════════════════════════════════════════

const express = require('express');
const { spawn } = require('child_process');
const { promises: fs } = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── Réglages (surchargeable par variables d'environnement de l'hébergeur) ──
const PORT = process.env.PORT || 3000;
const LARGEUR = parseInt(process.env.MONTAGE_WIDTH || '1080', 10);   // défaut si aucun format envoyé
const HAUTEUR = parseInt(process.env.MONTAGE_HEIGHT || '1920', 10);
// Dimensions de sortie par format (raisonnables pour la mémoire du conteneur).
const DIMENSIONS_VIDEO = {
  '9:16': { w: 720,  h: 1280 },
  '16:9': { w: 1280, h: 720 },
  '1:1':  { w: 1000, h: 1000 },
};
const FPS = parseInt(process.env.MONTAGE_FPS || '25', 10);           // 25 = Ken Burns fluide
const DUREE_TRANSITION = parseFloat(process.env.MONTAGE_TRANSITION || '0.5');
const ZMAX = 1.20;
// Étalonnage (retour propriétaire, "en tant que pro CapCut, quelles
// améliorations") : légère remontée de contraste et de saturation
// appliquée à CHAQUE plan - sans ça, des images générées par IA paraissent
// souvent plates/ternes une fois montées, c'est ce qui donne le look
// "premium" instantané. Réglable par variable d'environnement, même
// convention que FPS/DUREE_TRANSITION ci-dessus.
const GRADE_CONTRASTE = parseFloat(process.env.MONTAGE_GRADE_CONTRASTE || '1.08');
const GRADE_SATURATION = parseFloat(process.env.MONTAGE_GRADE_SATURATION || '1.15');
// Durée du carton de fin (appel à l'action, retour propriétaire), dans les
// dernières secondes de la vidéo.
const DUREE_CARTE_FIN = 2.5;
// Volume de la musique de fond relatif à la voix off (1.0), reste en
// retrait sous la narration sans jamais la couvrir (retour propriétaire :
// musique de fond pour un montage plus premium). Réglable désormais PAR
// MONTAGE (musicVolume dans la requête /render, voir menu "Volume de la
// musique" côté client, js/montage.js et js/montage-manuel.js) ; cette
// variable d'environnement ne sert plus que de valeur par défaut si le
// client n'en envoie pas (anciens appels, ou service appelé directement).
const MUSIQUE_VOLUME_DEFAUT = parseFloat(process.env.MONTAGE_MUSIC_VOLUME || '0.15');
// Plage exposée côté client (5%-50%) : au-delà, la musique commence à
// couvrir la voix off, jamais l'intention d'un fond sonore.
const MUSIQUE_VOLUME_MIN = 0.05;
const MUSIQUE_VOLUME_MAX = 0.5;

// Extrait en fonction pure (testable sans passer par une vraie requête HTTP
// ni un rendu FFmpeg complet, voir tests/render-service-volume-musique.test.js
// dans le dépôt principal) : jamais une valeur hors plage envoyée telle
// quelle à FFmpeg, la valeur par défaut sert seulement si le client n'envoie
// rien (absent, non numérique).
function resoudreVolumeMusique(demande) {
  const v = Number(demande);
  return Number.isFinite(v) ? Math.min(MUSIQUE_VOLUME_MAX, Math.max(MUSIQUE_VOLUME_MIN, v)) : MUSIQUE_VOLUME_DEFAUT;
}
// Nombre de plans rendus ensemble dans UN graphe FFmpeg (donc de flux ouverts
// en même temps). C'est ce nombre, pas la résolution, qui borne la mémoire :
// un seul gros graphe de ~20 images 1080p saturait la RAM du conteneur (OOM,
// "FFmpeg killed / code null"). Chaque lot est un graphe indépendant, recollé
// ensuite par le démuxeur concat (copie de flux, quasi gratuite). Fondu croisé
// varié À L'INTÉRIEUR d'un lot ; une coupure nette (rare) entre deux lots.
// Réglable via MONTAGE_BATCH selon la RAM de l'hébergeur (plus haut = moins de
// coupures, mais plus de mémoire). Baissé de 4 à 3 après un vrai OOM kill en
// production (montage à 53 plans, lot-0 déjà tué "code null") : même le tout
// premier lot de 4 dépassait la RAM disponible sur le conteneur actuel.
const TAILLE_LOT = parseInt(process.env.MONTAGE_BATCH || '3', 10);
// Jeton optionnel : si défini, chaque requête doit envoyer le même dans
// l'en-tête "x-montage-token". Gate légère (l'outil est réservé au fondateur).
const MONTAGE_TOKEN = process.env.MONTAGE_TOKEN || '';
// Origine(s) autorisée(s) pour l'appel navigateur direct. '*' par défaut.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Transitions variées (une différente à chaque coupe, en boucle). Choisies
// pour rester élégantes, pas gadget.
const TRANSITIONS = [
  'fade', 'dissolve', 'smoothleft', 'smoothright',
  'wipeleft', 'circleopen', 'slideup', 'fadeblack',
];

// ── CORS (appel direct depuis le navigateur du fondateur) ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-montage-token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/', (req, res) => res.status(200).send('OK'));

// Animation Ken Burns : 6 mouvements en rotation (zoom avant/arrière centrés,
// + panoramiques droite/gauche/haut/bas à zoom constant pour laisser de la
// place au déplacement). Rend chaque image vivante différemment.
function kenBurns(preset, D) {
  const inc = ((ZMAX - 1) / Math.max(1, D - 1)).toFixed(6);
  const p = `on/${Math.max(1, D - 1)}`;
  const cx = 'iw/2-(iw/zoom/2)', cy = 'ih/2-(ih/zoom/2)';
  const zin = `min(zoom+${inc},${ZMAX})`;
  const zout = `if(eq(on,0),${ZMAX},max(zoom-${inc},1))`;
  const zfix = `${ZMAX}`;
  const P = [
    { z: zin,  x: cx, y: cy },                                  // zoom avant
    { z: zout, x: cx, y: cy },                                  // zoom arrière
    { z: zfix, x: `(iw-iw/zoom)*${p}`,     y: cy },             // pano droite
    { z: zfix, x: `(iw-iw/zoom)*(1-${p})`, y: cy },             // pano gauche
    { z: zfix, x: cx, y: `(ih-ih/zoom)*(1-${p})` },            // pano haut
    { z: zfix, x: cx, y: `(ih-ih/zoom)*${p}` },                // pano bas
  ];
  return P[preset % P.length];
}

// Graphe FFmpeg pour UN LOT de plans. `decalage` = index global du 1er plan
// du lot, pour que l'alternance Ken Burns ET les transitions restent variées
// d'un lot à l'autre (pas de répétition au début de chaque lot).
// Synchro exacte : chaque clip dure (durée voulue + transition), et le fondu
// vers le plan suivant démarre pile à la frontière narrative cumulée du lot,
// la durée totale du lot reste égale à la somme de ses durées, donc, une fois
// les lots recollés, à la voix off entière. Chaque image apparaît à sa
// seconde exacte. Vérifié par exécution réelle.
function construireGrapheLot(durees, decalage, W, H) {
  const n = durees.length;
  const longueurs = durees.map(d => d + DUREE_TRANSITION);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const D = Math.max(1, Math.round(longueurs[i] * FPS));
    const kb = kenBurns(decalage + i, D);
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H},setsar=1,fps=${FPS},` +
      `zoompan=z='${kb.z}':x='${kb.x}':y='${kb.y}':d=${D}:s=${W}x${H}:fps=${FPS},` +
      `eq=contrast=${GRADE_CONTRASTE}:saturation=${GRADE_SATURATION}[v${i}]`
    );
  }
  let dernier = 'v0';
  let frontiere = durees[0];
  for (let i = 1; i < n; i++) {
    const sortie = i === n - 1 ? 'vout' : `vx${i}`;
    const tr = TRANSITIONS[(decalage + i - 1) % TRANSITIONS.length];
    parts.push(`[${dernier}][v${i}]xfade=transition=${tr}:duration=${DUREE_TRANSITION}:offset=${frontiere.toFixed(3)}[${sortie}]`);
    dernier = sortie;
    frontiere += durees[i];
  }
  if (n === 1) parts.push(`[v0]null[vout]`);
  return parts.join(';');
}

// Sous-titres incrustés (retour propriétaire) : groupes de mots déjà
// calculés côté Vercel (api/montage-media.js, jusqu'à 4 mots), reçus ici
// comme [{texte, debut, fin}] en secondes. Générés en
// ASS plutôt qu'en SRT : le filtre "subtitles" de FFmpeg suppose une
// résolution de script par défaut (souvent 384×288, un vieux standard TV)
// pour un SRT sans en-tête, ce qui fausse silencieusement la position
// verticale une fois mis à l'échelle vers la vraie résolution de sortie
// (constaté visuellement en test : le texte apparaissait dans le tiers
// SUPÉRIEUR au lieu du tiers inférieur). Un fichier ASS déclare sa propre
// résolution (PlayResX/PlayResY = W/H réels), donc MarginV correspond
// exactement à des pixels de la vidéo de sortie, quel que soit le format.
function versHorodatageASS(s) {
  const cs = Math.round(s * 100); // centièmes de seconde (précision ASS)
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const centiemes = cs % 100;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${h}:${pad(m)}:${pad(sec)}.${pad(centiemes)}`;
}

// Échappe les caractères qui ont un sens spécial dans le format ASS
// (accolades = balises de style inline). Le texte vient de segments de
// storyboard écrits par l'IA en prose normale, ce cas ne devrait jamais se
// présenter, mais mieux vaut ne jamais planter tout un rendu pour ça.
function echapperTexteASS(texte) {
  return String(texte).replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
}

// Mots-clés en couleur (retour propriétaire, "en tant que pro CapCut") :
// chiffres et statistiques colorés en doré dans les sous-titres, souvent
// ce qui accroche l'œil en premier sur TikTok. Détection par motif après
// échappement (jamais sur du texte pouvant contenir nos propres balises de
// contrôle, voir echapperTexteASS ci-dessus). Couleur inline ASS en
// &HBBGGRR& (ordre inversé du RGB usuel, différent du format &HAABBGGRR
// des styles ci-dessous) : #E2C87A (doré clair, déjà utilisé partout
// ailleurs dans Scriptura) -> BB=7A GG=C8 RR=E2.
const MOTIF_CHIFFRE_ASS = /\d+(?:[.,]\d+)?\s?(?:%|x|k|K|M|h|€|\$)?/g;
function mettreEnValeurChiffres(texteEchappe) {
  return texteEchappe.replace(MOTIF_CHIFFRE_ASS, (m) => `{\\c&H7AC8E2&}${m}{\\c&HFFFFFF&}`);
}

function construireASS(captions, W, H, carteFin, filigraneDureeTotale) {
  // Taille et marge proportionnelles à la sortie (testé visuellement sur
  // 720×1280 : FontSize 52, MarginV 220 = un bon compromis lisible sans
  // toucher au tiers inférieur où TikTok pose ses propres icônes une fois
  // republié) ; recalculées pour rester cohérentes sur les autres formats
  // (16:9, 1:1). MarginL/MarginR = 40 dans le style ci-dessous réservent une
  // marge de sécurité de chaque côté (retour propriétaire : jamais dépasser
  // les bords gauche/droite) ; WrapStyle:0 (repli sur deux lignes, réparties
  // pour rester lisibles) prend le relais si un groupe de 4 mots est trop
  // large pour tenir sur une seule ligne dans cette marge - jamais de
  // dépassement horizontal, testé visuellement avec un groupe volontairement
  // très long.
  const fontSize = Math.max(24, Math.round(W * 0.072));
  const marginV = Math.max(60, Math.round(H * 0.17));
  // Style du carton de fin (retour propriétaire) : nettement plus grand,
  // centré à l'écran (Alignment=5) plutôt qu'en bas comme les sous-titres,
  // en doré, pour qu'il se voie comme un vrai carton et non une ligne de
  // sous-titre parmi d'autres.
  const fontSizeCarte = Math.max(28, Math.round(W * 0.09));
  // Filigrane Scriptura (retour propriétaire, facultatif via case à cocher
  // côté client) : petit, semi-transparent (alpha 0x80, l'inverse de
  // l'habitude CSS en ASS : 00=opaque, FF=invisible), coin bas-droit
  // (Alignment=3), espacement des lettres (Spacing=3) pour évoquer le
  // logo du site ("S C R I P T U R A" très espacé).
  const fontSizeFiligrane = Math.max(14, Math.round(W * 0.032));
  const marginFiligrane = Math.max(16, Math.round(W * 0.035));
  const entete = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,2,40,40,${marginV},1
Style: CarteFin,DejaVu Sans,${fontSizeCarte},&H007AC8E2,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,5,50,50,0,1
Style: Filigrane,DejaVu Sans,${fontSizeFiligrane},&H80FFFFFF,&H000000FF,&H80000000,&H00000000,1,0,0,0,100,100,3,0,1,1,0,3,${marginFiligrane},${marginFiligrane},${marginFiligrane},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // Chiffres/statistiques colorés (retour propriétaire, "en tant que pro
  // CapCut") : voir mettreEnValeurChiffres ci-dessus, appliqué après
  // échappement pour ne jamais laisser passer une balise de contrôle non
  // maîtrisée.
  const lignes = captions.map(c =>
    `Dialogue: 0,${versHorodatageASS(c.debut)},${versHorodatageASS(c.fin)},Default,,0,0,0,,${mettreEnValeurChiffres(echapperTexteASS(c.texte))}`
  ).join('\n');
  // Carton de fin (retour propriétaire) : facultatif, saisi par le créateur
  // avant de lancer le montage (voir menu client). Layer 1 (au-dessus des
  // sous-titres habituels) au cas où sa fenêtre chevauche la toute dernière
  // ligne de sous-titres.
  const ligneCarte = carteFin
    ? `\nDialogue: 1,${versHorodatageASS(carteFin.debut)},${versHorodatageASS(carteFin.fin)},CarteFin,,0,0,0,,${echapperTexteASS(carteFin.texte)}`
    : '';
  // Filigrane : dure toute la vidéo (0 -> durée totale), Layer 0 (sous le
  // carton de fin s'ils se chevauchent, jamais gênant vu sa faible opacité).
  const ligneFiligrane = filigraneDureeTotale
    ? `\nDialogue: 0,${versHorodatageASS(0)},${versHorodatageASS(filigraneDureeTotale)},Filigrane,,0,0,0,,SCRIPTURA`
    : '';
  return entete + lignes + ligneCarte + ligneFiligrane + '\n';
}

async function telechargerVers(url, cheminLocal) {
  const rep = await fetch(url);
  if (!rep.ok) throw new Error('Téléchargement échoué (' + rep.status + ') : ' + url);
  const tampon = Buffer.from(await rep.arrayBuffer());
  await fs.writeFile(cheminLocal, tampon);
}

function executerFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code, signal) => {
      if (code === 0) resolve();
      // "code null" veut dire que le processus n'est pas parti de lui-même :
      // il a été TUÉ par un signal (Node ne remonte alors jamais de code de
      // sortie). SIGKILL depuis l'hébergeur (pas depuis FFmpeg lui-même) est
      // la signature d'un OOM kill : le conteneur a manqué de mémoire pendant
      // l'encodage, voir TAILLE_LOT plus haut pour le réglage qui borne ça.
      // Le signal était jusqu'ici perdu (juste "code null", sans piste), ce
      // qui rendait le diagnostic impossible sans accès aux logs Railway.
      else if (code === null && signal) {
        const pisteOom = signal === 'SIGKILL'
          ? ' — probablement un manque de mémoire sur le conteneur (OOM kill) : baisse MONTAGE_BATCH côté hébergeur.'
          : '';
        reject(new Error('FFmpeg a été interrompu par le système (signal ' + signal + ')' + pisteOom + ' : ' + stderr.slice(-2000)));
      }
      else reject(new Error('FFmpeg a échoué (code ' + code + ') : ' + stderr.slice(-2000)));
    });
  });
}

// Durée RÉELLE d'un fichier média, lue dans l'en-tête par FFmpeg (ffmpeg -i
// sort "Duration: HH:MM:SS.ss" sur stderr et se termine en erreur sans sortie
//, c'est normal). Sert de vérité pour caler la vidéo sur la voix off.
function dureeAudio(chemin) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', chemin]);
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', () => resolve(0));
    proc.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])) : 0);
    });
  });
}

async function uploaderVersSupabase(cheminLocal, nomFichier) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Configuration Supabase absente (SUPABASE_URL / SUPABASE_ANON_KEY)');
  const tampon = await fs.readFile(cheminLocal);
  const chemin = 'rendus/' + nomFichier;
  const rep = await fetch(url + '/storage/v1/object/montages/' + chemin, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'video/mp4' },
    body: tampon,
  });
  if (!rep.ok) {
    const texte = await rep.text().catch(() => '');
    throw new Error('Upload du rendu final échoué (' + rep.status + ') : ' + texte.slice(0, 300));
  }
  return url + '/storage/v1/object/public/montages/' + chemin;
}

app.post('/render', async (req, res) => {
  if (MONTAGE_TOKEN && req.headers['x-montage-token'] !== MONTAGE_TOKEN) {
    return res.status(401).json({ error: { message: 'Jeton invalide' } });
  }
  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  const audioUrl = typeof req.body?.audioUrl === 'string' ? req.body.audioUrl : '';
  if (!images.length || !audioUrl) {
    return res.status(400).json({ error: { message: 'Images ou audio manquant' } });
  }
  const durees = images.map(img => Math.max(1, Number(img.duration) || 2));
  // Dimensions de sortie selon le format demandé (défaut = valeurs d'env).
  const dim = DIMENSIONS_VIDEO[req.body?.format];
  const W = dim ? dim.w : LARGEUR;
  const H = dim ? dim.h : HAUTEUR;
  const captions = Array.isArray(req.body?.captions) ? req.body.captions.filter(c => c && c.texte) : [];
  // Carton de fin (retour propriétaire, "en tant que pro CapCut") : texte
  // d'appel à l'action saisi par le créateur avant de lancer le montage
  // (voir champ "Texte de fin" côté client), facultatif. Fenêtre calculée
  // plus bas une fois dureeTotale connue (dernières DUREE_CARTE_FIN secondes).
  const texteCarteFin = typeof req.body?.endCardText === 'string' ? req.body.endCardText.trim().slice(0, 200) : '';
  // Filigrane Scriptura (retour propriétaire), facultatif, activé/désactivé
  // par case à cocher côté client (défaut coché) : petit texte "SCRIPTURA"
  // semi-transparent en coin bas-droit, présent toute la vidéo.
  const filigraneActif = !!req.body?.watermark;
  // Musique de fond (retour propriétaire : le montage manquait de la
  // musique la plus élémentaire pour "sonner premium"), optionnelle : sans
  // elle, comportement inchangé. Générée côté Vercel (Eleven Music, voir
  // api/montage-media.js action=music), une simple URL publique ici comme
  // pour audioUrl/images.
  const musicUrl = typeof req.body?.musicUrl === 'string' ? req.body.musicUrl : '';
  // Volume choisi par montage (voir menu "Volume de la musique" côté
  // client), voir resoudreVolumeMusique ci-dessus pour le bornage.
  const musicVolume = resoudreVolumeMusique(req.body?.musicVolume);

  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'montage-'));
  try {
    await Promise.all(images.map((img, i) => telechargerVers(img.url, path.join(dossier, `img-${i}.jpg`))));
    const cheminAudio = path.join(dossier, 'audio.mp3');
    await telechargerVers(audioUrl, cheminAudio);
    let cheminMusique = '';
    if (musicUrl) {
      cheminMusique = path.join(dossier, 'musique.mp3');
      await telechargerVers(musicUrl, cheminMusique);
    }

    // Cale la vidéo sur la durée RÉELLE de l'audio : si la somme des durées de
    // segments est un peu inférieure à l'audio (ex. pauses arrondies, silence
    // final), on allonge la DERNIÈRE image pour combler, la narration n'est
    // ainsi jamais coupée et la vidéo dure exactement la voix off.
    const dureeReelleAudio = await dureeAudio(cheminAudio);
    const sommeDurees = durees.reduce((s, d) => s + d, 0);
    if (dureeReelleAudio > sommeDurees + 0.05) {
      durees[durees.length - 1] += (dureeReelleAudio - sommeDurees);
    }
    const dureeTotale = durees.reduce((s, d) => s + d, 0);
    console.log(`[render] début, ${images.length} plans, audio ${dureeReelleAudio.toFixed(2)}s, vidéo ${dureeTotale.toFixed(2)}s`);
    const carteFin = texteCarteFin
      ? { texte: texteCarteFin, debut: Math.max(0, dureeTotale - DUREE_CARTE_FIN), fin: dureeTotale }
      : null;
    const filigraneDureeTotale = filigraneActif ? dureeTotale : 0;

    // Rendu PAR LOTS (mémoire bornée) : chaque lot = un graphe FFmpeg
    // indépendant, vidéo seule, fondu croisé varié à l'intérieur du lot.
    const cheminsLots = [];
    for (let debut = 0; debut < images.length; debut += TAILLE_LOT) {
      const fin = Math.min(debut + TAILLE_LOT, images.length);
      const dureesLot = durees.slice(debut, fin);
      const longueursLot = dureesLot.map(d => d + DUREE_TRANSITION);
      const cheminLot = path.join(dossier, `lot-${cheminsLots.length}.mp4`);
      const args = [];
      for (let j = debut; j < fin; j++) {
        args.push('-loop', '1', '-t', String(longueursLot[j - debut]), '-i', path.join(dossier, `img-${j}.jpg`));
      }
      args.push('-filter_complex', construireGrapheLot(dureesLot, debut, W, H));
      args.push(
        '-map', '[vout]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
        '-t', String(dureesLot.reduce((s, d) => s + d, 0)),
        '-y', cheminLot
      );
      await executerFFmpeg(args);
      cheminsLots.push(cheminLot);
      console.log(`[render] lot ${cheminsLots.length}/${Math.ceil(images.length / TAILLE_LOT)} rendu`);
    }

    // Recolle les lots (copie de flux, quasi gratuit en mémoire) puis mixe la
    // voix off. -t garantit la durée totale exacte (= voix off).
    const cheminListe = path.join(dossier, 'liste.txt');
    await fs.writeFile(cheminListe, cheminsLots.map(c => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
    const cheminConcat = path.join(dossier, 'concat.mp4');
    await executerFFmpeg(['-f', 'concat', '-safe', '0', '-i', cheminListe, '-c', 'copy', '-y', cheminConcat]);

    // Sous-titres et musique de fond (retour propriétaire), tous deux
    // optionnels et indépendants : sans les deux, le flux vidéo ET la piste
    // audio de la voix off sont simplement COPIÉS (rapide, sans perte).
    // Sous-titres -> filtre vidéo "ass" (impose un ré-encodage vidéo, un
    // filtre ne peut pas s'appliquer à un flux copié tel quel). Musique ->
    // filtre audio "amix" (mélange voix + musique, ré-encodage audio déjà
    // nécessaire de toute façon pour convertir en AAC). Les deux peuvent
    // cohabiter dans le même -filter_complex, chacun mappé indépendamment.
    const argsMux = ['-i', cheminConcat, '-i', cheminAudio];
    if (cheminMusique) {
      // -stream_loop -1 : la musique boucle indéfiniment plutôt que de
      // s'arrêter avant la fin si la durée reçue d'ElevenLabs est un peu
      // plus courte que la voix off (arrondis) ; amix ci-dessous cale de
      // toute façon la sortie sur la durée de la voix (duration=first).
      argsMux.push('-stream_loop', '-1', '-i', cheminMusique);
    }

    const filtres = [];
    let sortieVideo = '0:v';
    // Le carton de fin (carteFin) et le filigrane déclenchent aussi le
    // filtre "ass" même sans sous-titres actifs (ex. sous-titres désactivés
    // par le fondateur, mais carton de fin ou filigrane quand même
    // demandés) : les trois sont indépendants les uns des autres.
    if (captions.length || carteFin || filigraneDureeTotale) {
      const cheminASS = path.join(dossier, 'sous-titres.ass');
      await fs.writeFile(cheminASS, construireASS(captions, W, H, carteFin, filigraneDureeTotale), 'utf8');
      filtres.push('[0:v]ass=' + cheminASS.replace(/:/g, '\\:') + '[vout]');
      sortieVideo = '[vout]';
    }
    let sortieAudio = '1:a';
    if (cheminMusique) {
      // normalize=0 impératif : le comportement par défaut d'amix divise le
      // volume de CHAQUE entrée par le nombre d'entrées (ici /2), ce qui
      // aurait aussi affaibli la voix off de moitié en plus de la musique.
      // La voix reste à son volume plein (1.0), seule la musique est
      // baissée (MUSIQUE_VOLUME) pour rester en retrait sous la narration.
      filtres.push(
        `[1:a]volume=1.0[va]`,
        `[2:a]volume=${musicVolume}[ma]`,
        `[va][ma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
      );
      sortieAudio = '[aout]';
    }
    if (filtres.length) argsMux.push('-filter_complex', filtres.join(';'));
    argsMux.push('-map', sortieVideo, '-map', sortieAudio);
    if (captions.length || carteFin || filigraneDureeTotale) {
      argsMux.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p');
    } else {
      argsMux.push('-c:v', 'copy');
    }
    argsMux.push(
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      '-t', String(dureeTotale),
      '-y', path.join(dossier, 'out.mp4')
    );
    await executerFFmpeg(argsMux);
    console.log('[render] rendu FFmpeg terminé'
      + (captions.length ? ' (avec sous-titres)' : '')
      + (cheminMusique ? ' (avec musique de fond)' : '')
      + (carteFin ? ' (avec carton de fin)' : '')
      + (filigraneDureeTotale ? ' (avec filigrane)' : ''));

    const nomFichier = 'montage-' + Date.now() + '.mp4';
    const urlPublique = await uploaderVersSupabase(path.join(dossier, 'out.mp4'), nomFichier);
    console.log('[render] upload Supabase terminé');
    return res.status(200).json({ url: urlPublique });
  } catch (e) {
    console.error('[render] erreur :', e.message);
    return res.status(500).json({ error: { message: 'Erreur de rendu : ' + (e.message || 'inconnue') } });
  } finally {
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
});

// Lancé seulement si exécuté directement (npm start / node server.js),
// jamais quand ce fichier est importé pour ses fonctions pures (voir
// test-sous-titres.js) : sinon chaque import ouvrirait son propre serveur
// HTTP, en concurrence sur le même port.
if (require.main === module) {
  app.listen(PORT, () => console.log('Service de rendu Scriptura à l\'écoute sur le port ' + PORT));
}

module.exports = {
  construireASS, versHorodatageASS, echapperTexteASS, mettreEnValeurChiffres,
  construireGrapheLot, resoudreVolumeMusique,
  MUSIQUE_VOLUME_DEFAUT, MUSIQUE_VOLUME_MIN, MUSIQUE_VOLUME_MAX,
  GRADE_CONTRASTE, GRADE_SATURATION, DUREE_CARTE_FIN
};

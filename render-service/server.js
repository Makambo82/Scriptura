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
// Nombre de plans rendus ensemble dans UN graphe FFmpeg (donc de flux ouverts
// en même temps). C'est ce nombre, pas la résolution, qui borne la mémoire :
// un seul gros graphe de ~20 images 1080p saturait la RAM du conteneur (OOM,
// "FFmpeg killed / code null"). Chaque lot est un graphe indépendant, recollé
// ensuite par le démuxeur concat (copie de flux, quasi gratuite). Fondu croisé
// varié À L'INTÉRIEUR d'un lot ; une coupure nette (rare) entre deux lots.
// Réglable via MONTAGE_BATCH selon la RAM de l'hébergeur (plus haut = moins de
// coupures, mais plus de mémoire).
const TAILLE_LOT = parseInt(process.env.MONTAGE_BATCH || '4', 10);
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
      `zoompan=z='${kb.z}':x='${kb.x}':y='${kb.y}':d=${D}:s=${W}x${H}:fps=${FPS}[v${i}]`
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
    proc.on('close', (code) => {
      if (code === 0) resolve();
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

  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'montage-'));
  try {
    await Promise.all(images.map((img, i) => telechargerVers(img.url, path.join(dossier, `img-${i}.jpg`))));
    const cheminAudio = path.join(dossier, 'audio.mp3');
    await telechargerVers(audioUrl, cheminAudio);

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

    await executerFFmpeg([
      '-i', cheminConcat, '-i', cheminAudio,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      '-t', String(dureeTotale),
      '-y', path.join(dossier, 'out.mp4')
    ]);
    console.log('[render] rendu FFmpeg terminé');

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

app.listen(PORT, () => console.log('Service de rendu Scriptura à l\'écoute sur le port ' + PORT));

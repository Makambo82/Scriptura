// ═══════════════════════════════════════════════════════════
//  Service de rendu vidéo Scriptura (hébergé HORS Vercel)
//
//  Pourquoi un service séparé : le rendu FFmpeg est trop lourd et trop long
//  pour le plan Vercel gratuit (300 s / 1 Go imposés, non contournables), ce
//  qui forçait des compromis — découpage en lots (coupes nettes toutes les 5
//  images), 720p/15fps, et une synchro image/voix approximative. Sur un vrai
//  hébergeur (Render, Railway, Fly…), sans ces limites, on rend TOUT le
//  montage dans un seul graphe FFmpeg : durées respectées au millième,
//  transitions variées entre CHAQUE plan, animations Ken Burns variées.
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
const LARGEUR = parseInt(process.env.MONTAGE_WIDTH || '1080', 10);   // vrai host → 1080p
const HAUTEUR = parseInt(process.env.MONTAGE_HEIGHT || '1920', 10);
const FPS = parseInt(process.env.MONTAGE_FPS || '25', 10);           // 25 = Ken Burns fluide
const DUREE_TRANSITION = parseFloat(process.env.MONTAGE_TRANSITION || '0.5');
const ZMAX = 1.20;
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

// Un SEUL graphe FFmpeg pour tout le montage (aucun découpage en lots : le
// vrai hébergeur a la mémoire pour ça, donc fondu croisé entre CHAQUE plan).
// Synchro exacte : chaque clip dure (durée voulue + transition), et le fondu
// vers le plan suivant démarre pile à la frontière narrative cumulée — la
// durée totale reste égale à la somme des durées (donc à la voix off), et
// chaque image apparaît à sa seconde exacte. Vérifié par exécution réelle.
function construireGraphe(durees) {
  const n = durees.length;
  const longueurs = durees.map(d => d + DUREE_TRANSITION);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const D = Math.max(1, Math.round(longueurs[i] * FPS));
    const kb = kenBurns(i, D);
    parts.push(
      `[${i}:v]scale=${LARGEUR}:${HAUTEUR}:force_original_aspect_ratio=increase,` +
      `crop=${LARGEUR}:${HAUTEUR},setsar=1,fps=${FPS},` +
      `zoompan=z='${kb.z}':x='${kb.x}':y='${kb.y}':d=${D}:s=${LARGEUR}x${HAUTEUR}:fps=${FPS}[v${i}]`
    );
  }
  let dernier = 'v0';
  let frontiere = durees[0];
  for (let i = 1; i < n; i++) {
    const sortie = i === n - 1 ? 'vout' : `vx${i}`;
    const tr = TRANSITIONS[(i - 1) % TRANSITIONS.length];
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
  const dureeTotale = durees.reduce((s, d) => s + d, 0);

  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'montage-'));
  console.log(`[render] début — ${images.length} plans, ${dureeTotale.toFixed(1)}s`);
  try {
    await Promise.all(images.map((img, i) => telechargerVers(img.url, path.join(dossier, `img-${i}.jpg`))));
    const cheminAudio = path.join(dossier, 'audio.mp3');
    await telechargerVers(audioUrl, cheminAudio);

    const longueurs = durees.map(d => d + DUREE_TRANSITION);
    const args = [];
    for (let i = 0; i < images.length; i++) {
      args.push('-loop', '1', '-t', String(longueurs[i]), '-i', path.join(dossier, `img-${i}.jpg`));
    }
    args.push('-i', cheminAudio); // dernière entrée = audio
    args.push('-filter_complex', construireGraphe(durees));
    args.push(
      '-map', '[vout]',
      '-map', `${images.length}:a`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      '-t', String(dureeTotale),
      '-y',
      path.join(dossier, 'out.mp4')
    );
    await executerFFmpeg(args);
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

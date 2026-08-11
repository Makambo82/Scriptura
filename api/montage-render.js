// ═══════════════════════════════════════════════════════════
//  /api/montage-render — Assemble la vidéo finale avec FFmpeg (auto-hébergé),
//  à partir des images + de la voix off déjà uploadées dans Supabase Storage
//  par js/montage.js (bucket "montages"). Remplace JSON2Video (crédits
//  épuisés en cours de route) : rendu synchrone, dans la même requête,
//  binaire FFmpeg fourni par ffmpeg-static (aucun service externe).
//
//  Effet Ken Burns (zoompan) sur chaque image, alternant zoom avant / zoom
//  arrière — et un seul type de transition (fondu croisé, xfade) entre les
//  plans, sur demande expresse : trop de types de transitions différents
//  rendait le montage brouillon.
//
//  Calage des durées : chaque image i (sauf la dernière) est allongée de la
//  durée de la transition (duration + 0.5s) et le xfade suivant démarre à
//  la somme cumulée des durées voulues — la durée totale de la vidéo colle
//  ainsi exactement à la somme des durées (donc à la voix off ElevenLabs),
//  transitions comprises, sans jamais raccourcir le montage. Vérifié par
//  exécution réelle de FFmpeg (voir historique de travail), pas seulement
//  en théorie.
//
//  Réservé au fondateur (bouton visible uniquement en body.is-admin) — le
//  rendu utilise SUPABASE_URL/SUPABASE_ANON_KEY, déjà présents côté serveur
//  pour d'autres routes, pour réuploader le résultat dans le même bucket
//  public.
// ═══════════════════════════════════════════════════════════

import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const LARGEUR = 1080, HAUTEUR = 1920;
const FPS = 25;
const DUREE_TRANSITION = 0.5;

async function telechargerVers(url, cheminLocal) {
  const rep = await fetch(url);
  if (!rep.ok) throw new Error('Téléchargement échoué (' + rep.status + ') : ' + url);
  const tampon = Buffer.from(await rep.arrayBuffer());
  await fs.writeFile(cheminLocal, tampon);
}

function zoompanExpr(i, duree) {
  const d = Math.max(1, Math.round(duree * FPS));
  // Alternance simple zoom avant / zoom arrière (même logique déjà validée
  // côté JSON2Video : deux variantes seulement, pas de liste à rallonge).
  const zoomAvant = i % 2 === 0;
  const zMax = 1.25;
  const pas = (zMax - 1) / d;
  const z = zoomAvant
    ? `min(zoom+${pas.toFixed(6)},${zMax})`
    : `if(eq(on,1),${zMax},max(zoom-${pas.toFixed(6)},1))`;
  return `zoompan=z='${z}':d=${d}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${LARGEUR}x${HAUTEUR}:fps=${FPS}`;
}

function construireFiltre(durees, longueurs) {
  const n = durees.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    // zoompan doit tourner sur la longueur RÉELLE du clip (durée voulue +
    // transition absorbée), sinon son animation de zoom se termine avant
    // la fin du clip et se fige pendant le fondu — d'où l'usage de
    // `longueurs[i]` (la valeur passée à -t pour cette entrée) et non
    // `durees[i]` (la durée voulue, sans le rembourrage de transition).
    // Sur-échantillonnage 1.5x (au lieu de 2x) avant zoompan : lisse encore
    // bien le zoom, mais réduit nettement le volume de pixels à traiter —
    // un montage à ~20 plans dépassait la limite de temps d'exécution
    // (voir historique) avant ce changement.
    parts.push(
      `[${i}:v]scale=${Math.round(LARGEUR * 1.5)}:${Math.round(HAUTEUR * 1.5)},setsar=1,fps=${FPS},${zoompanExpr(i, longueurs[i])}[v${i}]`
    );
  }
  let dernier = 'v0';
  let cumul = durees[0];
  for (let i = 1; i < n; i++) {
    const sortie = i === n - 1 ? 'vout' : `vx${i}`;
    parts.push(`[${dernier}][v${i}]xfade=transition=fade:duration=${DUREE_TRANSITION}:offset=${cumul.toFixed(3)}[${sortie}]`);
    dernier = sortie;
    cumul += durees[i];
  }
  if (n === 1) parts.push(`[v0]null[vout]`);
  return parts.join(';');
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
  if (!url || !key) throw new Error('Configuration Supabase absente côté serveur');
  const tampon = await fs.readFile(cheminLocal);
  const chemin = 'rendus/' + nomFichier;
  const rep = await fetch(url + '/storage/v1/object/montages/' + chemin, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'video/mp4'
    },
    body: tampon
  });
  if (!rep.ok) {
    const texte = await rep.text().catch(() => '');
    throw new Error('Upload du rendu final échoué (' + rep.status + ') : ' + texte.slice(0, 300));
  }
  return url + '/storage/v1/object/public/montages/' + chemin;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const images = Array.isArray(body?.images) ? body.images : [];
  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl : '';
  if (!images.length || !audioUrl) {
    return res.status(400).json({ error: { message: 'Images ou audio manquant' } });
  }
  const durees = images.map(img => Math.max(1, Number(img.duration) || 2));

  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'montage-'));
  try {
    await Promise.all(
      images.map((img, i) => telechargerVers(img.url, path.join(dossier, `img-${i}.jpg`)))
    );
    const cheminAudio = path.join(dossier, 'audio.mp3');
    await telechargerVers(audioUrl, cheminAudio);

    const longueurs = durees.map((d, i) => d + (i < durees.length - 1 ? DUREE_TRANSITION : 0));

    const cheminSortie = path.join(dossier, 'out.mp4');
    const args = [];
    images.forEach((img, i) => {
      args.push('-loop', '1', '-t', String(longueurs[i]), '-i', path.join(dossier, `img-${i}.jpg`));
    });
    args.push('-i', cheminAudio);
    args.push('-filter_complex', construireFiltre(durees, longueurs));
    // Durée totale visée = somme exacte des durées voulues (donc de la voix
    // off ElevenLabs). -shortest seul ne suffit pas : selon la version de
    // FFmpeg, zoompan peut produire quelques frames de plus que prévu (écart
    // constaté entre le FFmpeg système 6.1.1 et le binaire ffmpeg-static
    // 7.0.2 utilisé en production) — un -t explicite sur la sortie force la
    // durée exacte quelle que soit cette variation.
    const dureeTotale = durees.reduce((s, d) => s + d, 0);
    args.push(
      '-map', '[vout]',
      '-map', `${images.length}:a`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-t', String(dureeTotale),
      '-y',
      cheminSortie
    );

    await executerFFmpeg(args);

    const nomFichier = 'montage-' + Date.now() + '.mp4';
    const urlPublique = await uploaderVersSupabase(cheminSortie, nomFichier);
    return res.status(200).json({ url: urlPublique });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  } finally {
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}

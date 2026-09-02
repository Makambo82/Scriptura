// ═══════════════════════════════════════════════════════════
//  /api/montage-render, POINT D'ENTRÉE UNIQUE du rendu vidéo côté client
//  (voir js/montage.js, qui n'appelle plus jamais un service externe
//  directement). Si MONTAGE_RENDER_URL est réglée (variable d'environnement
//  Vercel), PROXIE la requête vers le service de rendu externe
//  (render-service/, Railway/Render/Fly), avec le jeton MONTAGE_RENDER_TOKEN
//  ajouté ici, côté serveur uniquement (voir plus bas). Sinon, assemble la
//  vidéo finale ICI MÊME avec FFmpeg (auto-hébergé), à partir des images +
//  de la voix off déjà uploadées dans Supabase Storage par js/montage.js
//  (bucket "montages"). Remplace JSON2Video (crédits épuisés en cours de
//  route) : rendu synchrone, dans la même requête, binaire FFmpeg fourni
//  par ffmpeg-static.
//
//  Effet Ken Burns (zoompan) sur chaque image, alternant zoom avant / zoom
//  arrière, et un seul type de transition (fondu croisé, xfade) entre les
//  plans, sur demande expresse : trop de types de transitions différents
//  rendait le montage brouillon.
//
//  Rendu PAR LOTS (voir TAILLE_LOT) : un montage à ~20 plans dans un seul
//  graphe FFmpeg (tous les flux vidéo ouverts en même temps) provoquait un
//  "ran out of available memory" sur le plan Vercel gratuit, confirmé sur
//  les logs de production, indépendamment de la résolution/cadence choisie.
//  La mémoire consommée dépend surtout du NOMBRE de flux ouverts simultané-
//  ment, pas de leur taille. On rend donc chaque petit groupe de plans dans
//  son propre graphe (fondu croisé À L'INTÉRIEUR du lot), puis on recolle
//  les lots avec le démuxeur concat (copie de flux, quasi gratuite en
//  mémoire) avant de mixer la voix off en dernière étape. Conséquence
//  visible : un cut net (sans fondu) toutes les TAILLE_LOT images, au lieu
//  d'un fondu partout, compromis assumé pour rester dans la mémoire
//  disponible, "cut net" faisait déjà partie des transitions validées.
//
//  Calage des durées : chaque image i (sauf la dernière DE SON LOT) est
//  allongée de la durée de la transition (duration + 0.5s) et le xfade
//  suivant démarre à la somme cumulée des durées voulues DU LOT, la durée
//  totale de la vidéo colle ainsi exactement à la somme des durées (donc à
//  la voix off ElevenLabs), transitions comprises. Vérifié par exécution
//  réelle de FFmpeg (voir historique de travail), pas seulement en théorie.
//
//  Réservé au fondateur (bouton visible uniquement en body.is-admin), le
//  rendu utilise SUPABASE_URL/SUPABASE_ANON_KEY, déjà présents côté serveur
//  pour d'autres routes, pour réuploader le résultat dans le même bucket
//  public.
// ═══════════════════════════════════════════════════════════

import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { resoudreDroits } from './_lib/acces.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// 720x1280 plutôt que 1080x1920 : environ 2x plus rapide à rendre (mesuré),
// pour une différence rarement visible une fois recompressé par TikTok/
// Instagram à l'envoi, décisif pour les montages à beaucoup de plans qui
// approchaient la limite de temps d'exécution.
const LARGEUR = 720, HAUTEUR = 1280;
// 15 img/s plutôt que 25 : réduit d'environ 40% le nombre d'images à
// calculer (le zoompan interpole chaque image, c'est le poste le plus
// coûteux). Sur le plan Vercel gratuit, les fonctions sont plafonnées à
// 300s (confirmé sur les logs : le réglage maxDuration à 800s est ignoré,
// raboté à 5 min), un montage de ~2 min dépassait cette limite à 25 img/s.
// 15 img/s reste fluide pour un mouvement lent type Ken Burns.
const FPS = 15;
const DUREE_TRANSITION = 0.5;
// Nombre maximum de plans traités ensemble dans UN SEUL graphe FFmpeg (donc
// de flux vidéo ouverts en même temps). C'est ce nombre, pas la résolution
// ni la cadence, qui déterminait la mémoire consommée, un lot fixe garde
// le pic de mémoire constant quel que soit le nombre total de plans.
const TAILLE_LOT = 5;

// Même hôte de confiance que api/montage-download.js : `images[].url` et
// `audioUrl` sont fournies par le client (uploadées par js/montage.js dans
// ce même bucket Supabase juste avant l'appel), et étaient jusqu'ici
// téléchargées sans aucune vérification, un appel direct pouvait donc faire
// du serveur un proxy vers n'importe quelle adresse (interne ou externe).
const HOTES_AUTORISES = [/^nlkfqxllunbvppulpnzl\.supabase\.co$/i];
function hoteAutorise(url) {
  try { return HOTES_AUTORISES.some(re => re.test(new URL(url).hostname)); }
  catch (e) { return false; }
}

async function telechargerVers(url, cheminLocal) {
  if (!hoteAutorise(url)) throw new Error('Hôte non autorisé : ' + url);
  const rep = await fetch(url);
  if (!rep.ok) throw new Error('Téléchargement échoué (' + rep.status + ') : ' + url);
  const tampon = Buffer.from(await rep.arrayBuffer());
  await fs.writeFile(cheminLocal, tampon);
}

function zoompanExpr(indexGlobal, duree) {
  const d = Math.max(1, Math.round(duree * FPS));
  // Alternance simple zoom avant / zoom arrière (même logique déjà validée
  // côté JSON2Video : deux variantes seulement, pas de liste à rallonge).
  // Indexée globalement (pas par lot) pour que l'alternance reste cohérente
  // d'un lot à l'autre.
  const zoomAvant = indexGlobal % 2 === 0;
  const zMax = 1.25;
  const pas = (zMax - 1) / d;
  const z = zoomAvant
    ? `min(zoom+${pas.toFixed(6)},${zMax})`
    : `if(eq(on,1),${zMax},max(zoom-${pas.toFixed(6)},1))`;
  return `zoompan=z='${z}':d=${d}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${LARGEUR}x${HAUTEUR}:fps=${FPS}`;
}

// Construit le graphe FFmpeg pour UN LOT de plans (fondu croisé à
// l'intérieur du lot uniquement, voir le commentaire d'en-tête pour le
// pourquoi). `decalageGlobal` sert uniquement à garder l'alternance de
// zoom cohérente d'un lot à l'autre.
function construireFiltreLot(durees, longueurs, decalageGlobal) {
  const n = durees.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    // zoompan doit tourner sur la longueur RÉELLE du clip (durée voulue +
    // transition absorbée), sinon son animation de zoom se termine avant
    // la fin du clip et se fige pendant le fondu, d'où l'usage de
    // `longueurs[i]` (la valeur passée à -t pour cette entrée) et non
    // `durees[i]` (la durée voulue, sans le rembourrage de transition).
    // Pas de sur-échantillonnage avant zoompan : les images sources
    // (Together AI, 768x1344) sont déjà proches de la résolution de sortie
    // (720x1280), les agrandir avant de les rétrécir n'ajoutait aucun
    // vrai détail, juste de la mémoire et du calcul en plus.
    parts.push(
      `[${i}:v]scale=${LARGEUR}:${HAUTEUR},setsar=1,fps=${FPS},${zoompanExpr(decalageGlobal + i, longueurs[i])}[v${i}]`
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

// Journal minimal (mémoire + étape) pour voir, dans les logs Vercel, à
// quelle étape précise un rendu meurt, indispensable pour diagnostiquer
// un "ran out of available memory" à distance, sans pouvoir reproduire le
// pic mémoire exact du serveur de production en local. process.memoryUsage()
// ne mesure QUE le processus Node, le vrai travail (donc la vraie mémoire)
// se fait dans le sous-processus FFmpeg spawné à côté, d'où l'usage de
// os.freemem()/totalmem() qui reflètent la mémoire du conteneur entier.
function logEtape(etape) {
  const mem = process.memoryUsage();
  const libreMo = Math.round(os.freemem() / 1048576);
  const totalMo = Math.round(os.totalmem() / 1048576);
  console.log(`[montage-render] ${etape}, libre=${libreMo}/${totalMo}MB (conteneur) node.rss=${Math.round(mem.rss / 1048576)}MB`);
}

function executerFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code, signal) => {
      if (code === 0) resolve();
      // Voir render-service/server.js pour le même correctif : "code null"
      // sans signal capturé rendait un OOM kill indiscernable d'un vrai bug.
      else if (code === null && signal) {
        const pisteOom = signal === 'SIGKILL'
          ? ' — probablement un manque de mémoire (fonction Vercel limitée à 1 Go) : réduis TAILLE_LOT ou le nombre de plans.'
          : '';
        reject(new Error('FFmpeg a été interrompu par le système (signal ' + signal + ')' + pisteOom + ' : ' + stderr.slice(-2000)));
      }
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
  // Réservé au fondateur (voir en-tête de fichier) : jusqu'ici seulement
  // vérifié côté CSS (body.is-admin), donc contournable par un appel direct.
  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Réservé au fondateur', code: 'ACCES_REFUSE' } });
  }

  const images = Array.isArray(body?.images) ? body.images : [];
  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl : '';
  if (!images.length || !audioUrl) {
    return res.status(400).json({ error: { message: 'Images ou audio manquant' } });
  }
  // Sous-titres incrustés (retour propriétaire), voir api/montage-media.js
  // pour leur construction. Optionnels : un tableau vide (ou absent) ne
  // doit jamais empêcher le montage, juste le laisser sans sous-titres.
  // Uniquement transmis au service de rendu externe ci-dessous, le rendu
  // FFmpeg local plus bas (repli sans MONTAGE_RENDER_URL) ne les brûle pas
  // encore dans la vidéo.
  const captions = Array.isArray(body?.captions) ? body.captions : [];
  // Musique de fond (retour propriétaire : montage "pas assez premium"),
  // voir api/montage-media.js action=music pour sa génération. Optionnelle,
  // même remarque que captions ci-dessus : seulement transmise au service de
  // rendu externe, le repli FFmpeg local plus bas ne la mixe pas encore.
  const musicUrl = typeof body?.musicUrl === 'string' ? body.musicUrl : '';
  // Volume de la musique de fond (retour propriétaire), choisi par montage
  // via le menu "Volume de la musique" côté client (0.05-0.5, voir
  // render-service/server.js pour le bornage définitif). Optionnel : sans
  // lui, le service de rendu retombe sur sa valeur par défaut.
  const musicVolume = Number.isFinite(Number(body?.musicVolume)) ? Number(body.musicVolume) : undefined;

  // Service de rendu externe (Railway/Render/Fly, voir render-service/),
  // proxié depuis ICI (serveur), jamais appelé directement par le
  // navigateur (voir js/montage.js) : sans ça, l'URL du service ET son
  // jeton auraient dû vivre dans le JS servi au client, donc publics, ce
  // qui aurait annulé toute protection (même faille que si on avait mis
  // une clé secrète dans le HTML). MONTAGE_RENDER_URL/MONTAGE_RENDER_TOKEN
  // sont des variables d'environnement VERCEL (jamais exposées au
  // navigateur), à régler séparément des variables du service externe
  // lui-même (voir render-service/README.md). Sans MONTAGE_RENDER_URL :
  // repli sur le rendu FFmpeg local ci-dessous (comportement d'origine).
  if (process.env.MONTAGE_RENDER_URL) {
    try {
      const entetesProxy = { 'Content-Type': 'application/json' };
      if (process.env.MONTAGE_RENDER_TOKEN) entetesProxy['x-montage-token'] = process.env.MONTAGE_RENDER_TOKEN;
      const format = typeof body?.format === 'string' ? body.format : undefined;
      const rProxy = await fetch(process.env.MONTAGE_RENDER_URL.replace(/\/$/, '') + '/render', {
        method: 'POST',
        headers: entetesProxy,
        body: JSON.stringify({ images, audioUrl, format, captions, musicUrl, musicVolume })
      });
      const dataProxy = await rProxy.json().catch(() => ({}));
      if (!rProxy.ok || !dataProxy.url) {
        return res.status(502).json({ error: { message: (dataProxy.error && dataProxy.error.message) || 'Le service de rendu externe a échoué.' } });
      }
      return res.status(200).json({ url: dataProxy.url });
    } catch (e) {
      return res.status(502).json({ error: { message: 'Service de rendu externe injoignable : ' + (e.message || 'inconnue') } });
    }
  }
  const durees = images.map(img => Math.max(1, Number(img.duration) || 2));

  logEtape('début (' + images.length + ' plans)');
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'montage-'));
  try {
    await Promise.all(
      images.map((img, i) => telechargerVers(img.url, path.join(dossier, `img-${i}.jpg`)))
    );
    const cheminAudio = path.join(dossier, 'audio.mp3');
    await telechargerVers(audioUrl, cheminAudio);
    logEtape('téléchargements terminés');

    // Rendu par lots (voir TAILLE_LOT et le commentaire d'en-tête) : chaque
    // lot est un graphe FFmpeg indépendant, vidéo seule (l'audio est mixé
    // une fois tout recollé), avec fondu croisé entre ses propres plans.
    const cheminsLots = [];
    for (let debut = 0; debut < images.length; debut += TAILLE_LOT) {
      const fin = Math.min(debut + TAILLE_LOT, images.length);
      const dureesLot = durees.slice(debut, fin);
      const longueursLot = dureesLot.map((d, i) => d + (i < dureesLot.length - 1 ? DUREE_TRANSITION : 0));

      const cheminLot = path.join(dossier, `lot-${cheminsLots.length}.mp4`);
      const args = [];
      for (let j = debut; j < fin; j++) {
        args.push('-loop', '1', '-t', String(longueursLot[j - debut]), '-i', path.join(dossier, `img-${j}.jpg`));
      }
      args.push('-filter_complex', construireFiltreLot(dureesLot, longueursLot, debut));
      args.push(
        '-map', '[vout]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-t', String(dureesLot.reduce((s, d) => s + d, 0)),
        '-y',
        cheminLot
      );
      await executerFFmpeg(args);
      cheminsLots.push(cheminLot);
      logEtape('lot ' + cheminsLots.length + '/' + Math.ceil(images.length / TAILLE_LOT) + ' rendu (plans ' + debut + '-' + (fin - 1) + ')');
    }

    // Recolle les lots (copie de flux, sans ré-encoder : quasi gratuit en
    // mémoire et en temps, contrairement au rendu lui-même).
    const cheminListe = path.join(dossier, 'liste.txt');
    await fs.writeFile(cheminListe, cheminsLots.map(c => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
    const cheminConcat = path.join(dossier, 'concat.mp4');
    await executerFFmpeg(['-f', 'concat', '-safe', '0', '-i', cheminListe, '-c', 'copy', '-y', cheminConcat]);
    logEtape('lots recollés');

    // Mixe la voix off sur la vidéo recollée. Durée totale visée = somme
    // exacte des durées voulues (donc de la voix off ElevenLabs), un -t
    // explicite force cette durée quelle que soit une éventuelle dérive
    // d'arrondi accumulée sur les lots.
    const dureeTotale = durees.reduce((s, d) => s + d, 0);
    const cheminSortie = path.join(dossier, 'out.mp4');
    await executerFFmpeg([
      '-i', cheminConcat,
      '-i', cheminAudio,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-t', String(dureeTotale),
      '-y',
      cheminSortie
    ]);
    logEtape('voix off mixée');

    const nomFichier = 'montage-' + Date.now() + '.mp4';
    const urlPublique = await uploaderVersSupabase(cheminSortie, nomFichier);
    logEtape('upload Supabase terminé');
    return res.status(200).json({ url: urlPublique });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  } finally {
    await fs.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}

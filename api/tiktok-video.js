// ═══════════════════════════════════════════════════════════
//  /api/tiktok-video, REGROUPE 2 routes vidéo TikTok qui étaient chacune
//  leur propre fonction serverless (video-stt, tiktok-download) : le plan
//  Vercel Hobby plafonne à 12 fonctions serverless par déploiement, dépassé
//  silencieusement (voir api/data.js pour le détail de l'incident).
//  Consolidation mécanique, comportement de chaque route inchangé : un
//  champ `action` (query) sélectionne la route d'origine. Les deux
//  partagent déjà la résolution de lien (api/_lib/tiktok-media.js).
//
//  action=transcription (POST, JSON) | action=download (GET, flux binaire)
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierQuota, verifierLimiteAnonyme } from './_lib/acces.js';
import {
  detailTikHub, extraireAwemeId, resoudreLien, urlsVideo,
  extraireDesc, extraireStats, extraireAuteurUsername, extraireAuteurInfo, extraireCreateTime, abonnesViaProfil,
  telechargerMedia, resoudreVideoTikTok
} from './_lib/tiktok-media.js';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';

const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_TRANSCRIPT = 8000;
const PLAFOND_ANONYME_JOUR = 5; // filet IP, coûte jusqu'à 3 API payées par appel

// Extrait PLUSIEURS frames réparties sur toute la durée de la vidéo (pas
// seulement le tout début) : sert à juger le hook visuel (1re frame,
// ancien comportement) MAIS AUSSI l'exécution visuelle globale (cadrage,
// cohérence, qualité) sur l'ensemble de la vidéo, voir js/viral.js.
// Toujours via ffmpeg-static, déjà utilisé ici, aucune API supplémentaire :
// Scriptura n'a pas accès aux sous-titres natifs de la vidéo (beaucoup de
// créateurs n'en incrustent pas), on reste sur ce qu'on peut vraiment
// extraire nous-mêmes. Best-effort, ne bloque JAMAIS la transcription (le
// score se dégrade proprement sans ces signaux si ça échoue).
const FRACTIONS_FRAMES = [0.08, 0.45, 0.85]; // début / milieu / fin
async function _dureeVideo(cheminVideo) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', cheminVideo]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])) : null);
    });
    proc.on('error', () => resolve(null));
  });
}
async function extraireFramesVisuelles(buf) {
  const dossier = await fsp.mkdtemp(path.join(os.tmpdir(), 'frames-'));
  const cheminVideo = path.join(dossier, 'v.mp4');
  try {
    await fsp.writeFile(cheminVideo, buf);
    const duree = await _dureeVideo(cheminVideo);
    // Sans durée connue (rare), repli sur des instants fixes proches du
    // début : mieux qu'aucune frame, la plupart des vidéos TikTok durent au
    // moins quelques secondes.
    const instants = duree
      ? FRACTIONS_FRAMES.map(f => Math.max(0.2, Math.min(duree - 0.1, duree * f)))
      : [0.3, 1.5, 3];
    const frames = [];
    for (let i = 0; i < instants.length; i++) {
      const cheminImage = path.join(dossier, 'f' + i + '.jpg');
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(ffmpegPath, ['-y', '-ss', String(instants[i]), '-i', cheminVideo, '-frames:v', '1', '-q:v', '3', cheminImage]);
          let stderr = '';
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('error', reject);
          proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg (code ' + code + ') : ' + stderr.slice(-500))));
        });
        const img = await fsp.readFile(cheminImage);
        frames.push(img.toString('base64'));
      } catch (e) { /* une frame ratée ne doit jamais faire échouer les autres */ }
    }
    return frames;
  } finally {
    await fsp.rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}

// ═══ TRANSCRIPTION (voir l'ancien api/video-stt.js) ═══

async function transcrireEleven(buf, contentType, key) {
  const form = new FormData();
  const type = /audio|video/.test(contentType) ? contentType : 'video/mp4';
  form.append('file', new Blob([buf], { type }), 'video.mp4');
  form.append('model_id', 'scribe_v1');
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(ELEVEN_STT, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: ctrl.signal });
    const txt = await r.text();
    let data = null; try { data = JSON.parse(txt); } catch (e) {}
    if (!r.ok) return { ok: false, status: r.status, message: (data && (data.detail?.message || data.detail || data.message)) || txt.slice(0, 300) };
    return { ok: true, text: (data && data.text) || '', lang: data && (data.language_code || data.language) };
  } catch (e) { return { ok: false, status: 0, message: e.message }; }
  finally { clearTimeout(minuteur); }
}

async function handleTranscription(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  const tikhubKey = (process.env.TIKHUB_API_KEY || '').trim();
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!tikhubKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (TIKHUB_API_KEY)' } });
  if (!elevenKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (ELEVENLABS_API_KEY)' } });

  try {
    const { url, code_acces } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: { message: 'Lien manquant' } });
    }

    const droits = await resoudreDroits(code_acces);
    if (!droits.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });
    }
    if (droits.anonyme) {
      const limiteIP = await verifierLimiteAnonyme(req, 'video-stt', PLAFOND_ANONYME_JOUR);
      if (!limiteIP.ok) return res.status(403).json({ error: { message: 'Limite atteinte, réessaie plus tard.', code: 'QUOTA_ATTEINT' } });
    }

    let urlResolue = url.trim();
    let id = extraireAwemeId(urlResolue);
    if (!id) { urlResolue = await resoudreLien(urlResolue); id = extraireAwemeId(urlResolue); }
    if (!id) {
      // Pas de quota consommé : lien mal formé, jamais le travail réel de
      // cette route (bug corrigé, retour terrain).
      return res.status(422).json({ error: { message: "Lien TikTok non reconnu. Vérifie le lien, ou colle le texte de la vidéo à la main." } });
    }

    const dataTikHub = await detailTikHub(id, tikhubKey);

    let description = dataTikHub ? (extraireDesc(dataTikHub) || '') : '';
    let stats = dataTikHub ? extraireStats(dataTikHub) : null;
    const auteur = dataTikHub ? extraireAuteurInfo(dataTikHub) : null;
    const createTime = dataTikHub ? extraireCreateTime(dataTikHub) : null;

    let media = null;
    if (dataTikHub) {
      for (const u of urlsVideo(dataTikHub)) {
        const m = await telechargerMedia(u);
        if (m.ok) { media = m; break; }
      }
    }
    if (!media) {
      // Pas de quota consommé : vidéo privée/supprimée/indisponible, jamais
      // atteint la transcription (bug corrigé, retour terrain).
      return res.status(200).json({ ok: false, description, stats, raison: 'video_indisponible' });
    }

    // SEULEMENT MAINTENANT (retour terrain) : le lien est confirmé valide et
    // la vidéo réellement téléchargeable, juste avant l'appel ElevenLabs
    // (payant) qui suit. Un échec de transcription ElevenLabs lui-même
    // (raison 'stt_echec' plus bas) continue de consommer le quota,
    // volontairement : la vidéo a réellement été traitée à ce stade, et
    // laisser ce cas gratuit permettrait de déclencher des appels
    // ElevenLabs à volonté sans jamais toucher son quota.
    const verdict = await verifierQuota(droits, 'analyseVirale', code_acces);
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: "Quota d'analyses vidéo atteint.", code: 'QUOTA_ATTEINT', raison: verdict.raison } });
    }

    if (stats && stats.vues && !stats.abonnesAuteur) {
      const username = extraireAuteurUsername(dataTikHub);
      if (username) {
        const ab = await abonnesViaProfil(username, tikhubKey);
        if (ab != null) stats.abonnesAuteur = ab;
      }
    }

    // Frames + transcription en parallèle (indépendantes, même buffer vidéo) :
    // les frames ne doivent jamais retarder ni faire échouer la transcription.
    const [stt, frames] = await Promise.all([
      transcrireEleven(media.buf, media.contentType, elevenKey),
      extraireFramesVisuelles(media.buf).catch(() => [])
    ]);
    if (!stt.ok) {
      return res.status(200).json({ ok: false, description, stats, raison: 'stt_echec' });
    }
    const transcript = (stt.text || '').trim().slice(0, MAX_TRANSCRIPT);
    return res.status(200).json({
      ok: transcript.length > 10,
      transcript,
      description,
      stats,
      auteur,
      createTime,
      langue: stt.lang || null,
      // Toutes les frames extraites (voir extraireFramesVisuelles) : la
      // première sert au hook visuel (ancien frame_hook), l'ensemble sert à
      // juger l'exécution visuelle globale (voir js/viral.js).
      frames: (frames && frames.length) ? frames : null,
      raison: transcript.length > 10 ? null : 'sans_parole'
    });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ TÉLÉCHARGEMENT (voir l'ancien api/tiktok-download.js) ═══

async function handleDownload(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  const tikhubKey = (process.env.TIKHUB_API_KEY || '').trim();
  if (!tikhubKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (TIKHUB_API_KEY)' } });

  const url = req.query?.url;
  const code_acces = req.query?.code_acces || null;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: { message: 'Lien manquant' } });
  }

  try {
    const droits = await resoudreDroits(code_acces);
    if (!droits.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });
    }
    if (droits.anonyme) {
      const limiteIP = await verifierLimiteAnonyme(req, 'tiktok-download', PLAFOND_ANONYME_JOUR);
      if (!limiteIP.ok) return res.status(403).json({ error: { message: 'Limite atteinte, réessaie plus tard.', code: 'QUOTA_ATTEINT' } });
    }

    const resolu = await resoudreVideoTikTok(url, tikhubKey);
    if (!resolu) {
      // Pas de quota consommé : lien mal formé (bug corrigé, retour terrain).
      return res.status(422).json({ error: { message: 'Lien TikTok non reconnu. Vérifie le lien.' } });
    }

    const candidats = resolu.dataTikHub ? urlsVideo(resolu.dataTikHub) : [];

    let media = null;
    for (const u of candidats) {
      const m = await telechargerMedia(u);
      if (m.ok) { media = m; break; }
    }
    if (!media) {
      // Pas de quota consommé : vidéo indisponible au téléchargement (bug
      // corrigé, retour terrain).
      return res.status(502).json({ error: { message: 'Vidéo indisponible au téléchargement pour l\'instant. Réessaie plus tard, ou avec un autre lien.' } });
    }

    // SEULEMENT MAINTENANT (retour terrain) : le lien est confirmé valide et
    // la vidéo réellement téléchargée.
    const verdict = await verifierQuota(droits, 'analyseVirale', code_acces);
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: "Quota d'analyses vidéo atteint.", code: 'QUOTA_ATTEINT', raison: verdict.raison } });
    }

    // Même carte source (auteur, date, description, stats) que la
    // transcription (voir afficherResultatTranscription, js/tiktok-outils.js) :
    // le corps de la réponse reste le flux vidéo brut (le client fait
    // .blob() dessus), les métadonnées passent donc par un en-tête dédié
    // (JSON encodé en base64, pour rester ASCII-safe en en-tête HTTP).
    const auteur = resolu.dataTikHub ? extraireAuteurInfo(resolu.dataTikHub) : null;
    const createTime = resolu.dataTikHub ? extraireCreateTime(resolu.dataTikHub) : null;
    const meta = { description: resolu.description, stats: resolu.stats, auteur, createTime };
    res.setHeader('X-Scriptura-Meta', Buffer.from(JSON.stringify(meta), 'utf8').toString('base64'));
    res.setHeader('Content-Type', media.contentType || 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="scriptura-tiktok.mp4"');
    return res.status(200).send(media.buf);

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ POINT D'ENTRÉE COMMUN ═══

export default async function handler(req, res) {
  const action = req.query?.action;
  if (action === 'download') return handleDownload(req, res);
  if (action === 'transcription') return handleTranscription(req, res);
  return res.status(400).json({ error: { message: 'action inconnue' } });
}

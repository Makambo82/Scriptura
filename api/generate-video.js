// ═══════════════════════════════════════════════════════════
//  /api/generate-video — Montage vidéo automatique depuis un storyboard
//  (images IA + voix + sous-titres + montage FFmpeg). Fichier INDÉPENDANT :
//  ne touche à aucun autre mode de Scriptura.
//
//  Prérequis (voir supabase/videos.sql) :
//  - Table `videos` + bucket de stockage public `videos` dans Supabase.
//  - Variables d'environnement Vercel : GEMINI_API_KEY, ELEVENLABS_API_KEY,
//    en plus de SUPABASE_URL / SUPABASE_ANON_KEY déjà utilisées ailleurs.
//
//  Reçoit une liste de segments {texte, visuel} (texte parlé + description
//  de l'image pour ce plan), et renvoie l'URL de la vidéo finale une fois
//  prête. Un seul appel, synchrone : le client attend la réponse (jusqu'à
//  la limite de durée configurée dans vercel.json).
// ═══════════════════════════════════════════════════════════

import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const runFfmpeg = promisify(execFile);

// Bornes de sécurité pour rester dans la fenêtre de temps Vercel et dans le
// quota gratuit Gemini (10 requêtes/minute sur le palier gratuit).
const MAX_SEGMENTS = 14;
const FPS = 25;
const LARGEUR = 1080, HAUTEUR = 1920; // 9:16 (format TikTok)

// Noms de modèles configurables par variable d'environnement : ce sont des
// modèles "preview" côté fournisseurs, susceptibles de changer de nom sans
// préavis — un changement de variable Vercel suffit alors, pas de redéploiement.
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

async function verifierAcces(code) {
  if (!code) return { ok: false, raison: 'code manquant — abonnement requis pour créer une vidéo' };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: true };
  const CODES_ILLIMITES = ['SCRIPTURA-CELINE'];
  if (CODES_ILLIMITES.includes(String(code).toUpperCase())) return { ok: true };
  try {
    const r = await fetch(url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(code) + '&select=actif,expire_le,plan', {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, raison: 'code inconnu' };
    const ab = rows[0];
    if (ab.actif === false) return { ok: false, raison: 'compte désactivé' };
    if (String(ab.plan || '').trim().toLowerCase() === 'jeton') {
      return { ok: false, raison: 'la création de vidéo nécessite un abonnement (pas seulement des jetons)' };
    }
    if (ab.expire_le) {
      const exp = new Date(ab.expire_le);
      if (!isNaN(exp.getTime()) && exp < new Date()) return { ok: false, raison: 'abonnement expiré' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: true }; // souci réseau : on ne bloque pas, comme le reste de l'app
  }
}

async function genererImage(prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    })
  });
  if (!res.ok) throw new Error('Génération image échouée (' + res.status + ') : ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const part = ((data?.candidates?.[0]?.content?.parts) || []).find(p => p.inlineData);
  if (!part) throw new Error('Aucune image renvoyée par Gemini pour ce plan');
  return Buffer.from(part.inlineData.data, 'base64');
}

async function obtenirVoixParDefaut() {
  const voixForcee = process.env.ELEVENLABS_VOICE_ID;
  if (voixForcee) return voixForcee;
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error('Impossible de lister les voix ElevenLabs (' + res.status + ')');
  const data = await res.json();
  const voix = (data.voices || [])[0];
  if (!voix) throw new Error('Aucune voix disponible sur ce compte ElevenLabs');
  return voix.voice_id;
}

async function genererVoixAvecMinutage(texte, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text: texte, model_id: ELEVENLABS_MODEL })
  });
  if (!res.ok) throw new Error('Génération voix échouée (' + res.status + ') : ' + (await res.text()).slice(0, 200));
  return res.json();
}

// Texte complet (narration) + bornes [début,fin[ de chaque segment (en
// index de caractère dans ce texte).
function construireTexteEtBornes(segments) {
  let texte = '';
  const bornes = [];
  segments.forEach((seg, i) => {
    if (i > 0) texte += ' ';
    const debut = texte.length;
    texte += seg.texte;
    bornes.push({ debut, fin: texte.length });
  });
  return { texte, bornes };
}

// Déduit le [début, fin] en secondes de chaque segment à partir du minutage
// caractère par caractère renvoyé par ElevenLabs.
function minutageParSegment(alignment, bornes) {
  const debuts = alignment.character_start_times_seconds || [];
  const fins = alignment.character_end_times_seconds || [];
  const dernier = Math.max(debuts.length - 1, 0);
  return bornes.map(({ debut, fin }) => {
    const i0 = Math.min(debut, dernier);
    const i1 = Math.min(Math.max(fin - 1, i0), dernier);
    return { start: debuts[i0] || 0, end: (fins[i1] != null ? fins[i1] : (debuts[i0] || 0) + 1) };
  });
}

function formatSRT(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, l) => String(n).padStart(l, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(ms, 3)}`;
}

// Regroupe les mots en courtes cartes de 4 mots façon TikTok (à partir du
// minutage caractère par caractère), plutôt qu'une phrase entière d'un bloc.
function construireSousTitres(texteComplet, alignment) {
  const debuts = alignment.character_start_times_seconds || [];
  const fins = alignment.character_end_times_seconds || [];
  const mots = [];
  let i = 0;
  while (i < texteComplet.length) {
    while (i < texteComplet.length && /\s/.test(texteComplet[i])) i++;
    if (i >= texteComplet.length) break;
    const debutMot = i;
    while (i < texteComplet.length && !/\s/.test(texteComplet[i])) i++;
    const finMot = i;
    mots.push({ texte: texteComplet.slice(debutMot, finMot), debut: debuts[debutMot] || 0, fin: fins[Math.max(finMot - 1, debutMot)] || 0 });
  }
  const MOTS_PAR_CARTE = 4;
  const cartes = [];
  for (let k = 0; k < mots.length; k += MOTS_PAR_CARTE) {
    const groupe = mots.slice(k, k + MOTS_PAR_CARTE);
    if (!groupe.length) continue;
    cartes.push({ texte: groupe.map(m => m.texte).join(' '), debut: groupe[0].debut, fin: groupe[groupe.length - 1].fin });
  }
  return cartes.map((c, idx) => `${idx + 1}\n${formatSRT(c.debut)} --> ${formatSRT(c.fin)}\n${c.texte}\n`).join('\n');
}

// 4 mouvements simples, alternés par index de segment — aucune image ne
// reste totalement fixe.
const EFFETS_KEN_BURNS = [
  (frames) => `zoompan=z='min(zoom+0.0015,1.2)':d=${frames}:s=${LARGEUR}x${HAUTEUR}:fps=${FPS}`,
  (frames) => `zoompan=z='if(lte(zoom,1.0),1.2,max(1.0,zoom-0.0015))':d=${frames}:s=${LARGEUR}x${HAUTEUR}:fps=${FPS}`,
  (frames) => `zoompan=z='1.15':x='if(gte(on,1),x+2,0)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${LARGEUR}x${HAUTEUR}:fps=${FPS}`,
  (frames) => `zoompan=z='1.15':x='if(gte(on,1),x-2,iw*0.2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${LARGEUR}x${HAUTEUR}:fps=${FPS}`
];

async function creerClipImage(cheminImage, duree, cheminSortie, indexEffet) {
  const frames = Math.max(1, Math.round(duree * FPS));
  const effet = EFFETS_KEN_BURNS[indexEffet % EFFETS_KEN_BURNS.length](frames);
  const filtre = `scale=${LARGEUR * 2}:${HAUTEUR * 2}:force_original_aspect_ratio=increase,crop=${LARGEUR * 2}:${HAUTEUR * 2},${effet}`;
  await runFfmpeg(ffmpegInstaller.path, [
    '-y', '-loop', '1', '-i', cheminImage,
    '-t', String(duree),
    '-vf', filtre,
    '-r', String(FPS),
    '-pix_fmt', 'yuv420p',
    '-an',
    cheminSortie
  ]);
}

async function majSuivi(id, patch) {
  if (!id || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;
  try {
    await fetch(process.env.SUPABASE_URL + '/rest/v1/videos?id=eq.' + id, {
      method: 'PATCH',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
  } catch (e) { /* silencieux : le suivi n'est jamais bloquant */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  const dossierTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'scriptura-video-'));
  let idVideo = null;

  try {
    const { segments, code_acces, mode, titre } = req.body || {};

    if (!Array.isArray(segments) || !segments.length) {
      return res.status(400).json({ error: { message: 'Aucun segment reçu' } });
    }
    if (segments.length > MAX_SEGMENTS) {
      return res.status(400).json({ error: { message: 'Storyboard trop long pour la création automatique (maximum ' + MAX_SEGMENTS + ' plans pour l\'instant).' } });
    }
    if (!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: { message: 'Clés vidéo absentes côté serveur (GEMINI_API_KEY / ELEVENLABS_API_KEY)' } });
    }

    const acces = await verifierAcces(code_acces);
    if (!acces.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + acces.raison } });
    }

    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/videos', {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify([{ code_acces: code_acces || 'anonyme', mode: mode || 'script', titre: titre || 'Vidéo', statut: 'en_cours' }])
        });
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) idVideo = rows[0].id;
      } catch (e) { /* silencieux */ }
    }

    // ── 1. Voix complète + minutage réel ──
    const { texte: texteComplet, bornes } = construireTexteEtBornes(segments);
    const voiceId = await obtenirVoixParDefaut();
    const voix = await genererVoixAvecMinutage(texteComplet, voiceId);
    const minutages = minutageParSegment(voix.alignment, bornes);

    // ── 2. Une image par segment, l'UNE APRÈS L'AUTRE (pas en parallèle :
    //      le palier gratuit Gemini limite à 10 requêtes/minute). ──
    const images = [];
    for (const seg of segments) {
      images.push(await genererImage(seg.visuel));
    }

    // ── 3. Un clip Ken Burns par segment, durée = son créneau de voix réel ──
    const cheminsClips = [];
    for (let i = 0; i < segments.length; i++) {
      const cheminImage = path.join(dossierTemp, `img${i}.png`);
      await fs.writeFile(cheminImage, images[i]);
      const duree = Math.max(0.6, minutages[i].end - minutages[i].start);
      const cheminClip = path.join(dossierTemp, `clip${i}.mp4`);
      await creerClipImage(cheminImage, duree, cheminClip, i);
      cheminsClips.push(cheminClip);
    }

    // ── 4. Assemblage (concaténation, pas de ré-encodage) ──
    const cheminListe = path.join(dossierTemp, 'liste.txt');
    await fs.writeFile(cheminListe, cheminsClips.map(c => `file '${c}'`).join('\n'));
    const cheminMuet = path.join(dossierTemp, 'muet.mp4');
    await runFfmpeg(ffmpegInstaller.path, ['-y', '-f', 'concat', '-safe', '0', '-i', cheminListe, '-c', 'copy', cheminMuet]);

    // ── 5. Sous-titres incrustés ──
    const srt = construireSousTitres(texteComplet, voix.alignment);
    const cheminSRT = path.join(dossierTemp, 'sous_titres.srt');
    await fs.writeFile(cheminSRT, srt, 'utf8');
    const cheminSousTitre = path.join(dossierTemp, 'soustitre.mp4');
    await runFfmpeg(ffmpegInstaller.path, [
      '-y', '-i', cheminMuet,
      '-vf', `subtitles=${cheminSRT}:force_style='FontName=DejaVu Sans,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Alignment=2,MarginV=140'`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      cheminSousTitre
    ]);

    // ── 6. Voix (fichier) ──
    const cheminVoix = path.join(dossierTemp, 'voix.mp3');
    await fs.writeFile(cheminVoix, Buffer.from(voix.audio_base64, 'base64'));

    // ── 7. Vidéo finale (image + sous-titres + voix) ──
    const cheminFinal = path.join(dossierTemp, 'final.mp4');
    await runFfmpeg(ffmpegInstaller.path, [
      '-y', '-i', cheminSousTitre, '-i', cheminVoix,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-shortest',
      cheminFinal
    ]);

    // ── 8. Envoi sur Supabase Storage ──
    const octets = await fs.readFile(cheminFinal);
    const nomFichier = 'video_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.mp4';
    const repUpload = await fetch(process.env.SUPABASE_URL + '/storage/v1/object/videos/' + nomFichier, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
        'Content-Type': 'video/mp4'
      },
      body: octets
    });
    if (!repUpload.ok) {
      throw new Error('Envoi du fichier vidéo échoué (' + repUpload.status + ') : ' + (await repUpload.text()).slice(0, 200));
    }
    const urlPublique = process.env.SUPABASE_URL + '/storage/v1/object/public/videos/' + nomFichier;

    await majSuivi(idVideo, { statut: 'pret', url: urlPublique });

    return res.status(200).json({ url: urlPublique });

  } catch (error) {
    await majSuivi(idVideo, { statut: 'erreur', erreur: String(error.message || error).slice(0, 500) });
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (error.message || 'inconnue') } });
  } finally {
    try { await fs.rm(dossierTemp, { recursive: true, force: true }); } catch (e) { /* silencieux */ }
  }
}

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
  detailLamaTok, detailTikHub, extraireAwemeId, resoudreLien, urlsVideo,
  extraireDesc, extraireStats, extraireAuteurUsername, abonnesViaProfil,
  telechargerMedia, resoudreVideoTikTok
} from './_lib/tiktok-media.js';

const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_TRANSCRIPT = 8000;
const PLAFOND_ANONYME_JOUR = 5; // filet IP, coûte jusqu'à 3 API payées par appel

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
  const lamaKey = process.env.LAMATOK_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!lamaKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });
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
    const verdict = await verifierQuota(droits, 'analyseVirale', code_acces);
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: "Quota d'analyses vidéo atteint.", code: 'QUOTA_ATTEINT', raison: verdict.raison } });
    }

    let urlResolue = url.trim();
    let id = extraireAwemeId(urlResolue);
    if (!id) { urlResolue = await resoudreLien(urlResolue); id = extraireAwemeId(urlResolue); }
    if (!id) {
      return res.status(422).json({ error: { message: "Lien TikTok non reconnu. Vérifie le lien, ou colle le texte de la vidéo à la main." } });
    }

    const dataLama = await detailLamaTok(id, lamaKey);

    let description = dataLama ? (extraireDesc(dataLama) || '') : '';
    let stats = dataLama ? extraireStats(dataLama) : null;

    let media = null;
    let dataTikHub = null;
    if (dataLama) {
      for (const u of urlsVideo(dataLama)) {
        const m = await telechargerMedia(u);
        if (m.ok) { media = m; break; }
      }
    }
    if (!media) {
      const tikhubKey = (process.env.TIKHUB_API_KEY || '').trim();
      dataTikHub = tikhubKey ? await detailTikHub(id, tikhubKey) : null;
      if (dataTikHub) {
        if (!description) description = extraireDesc(dataTikHub) || '';
        if (!stats) stats = extraireStats(dataTikHub);
        for (const u of urlsVideo(dataTikHub)) {
          const m = await telechargerMedia(u);
          if (m.ok) { media = m; break; }
        }
      }
    }
    if (!media) {
      return res.status(200).json({ ok: false, description, stats, raison: 'video_indisponible' });
    }

    if (stats && stats.vues && !stats.abonnesAuteur) {
      const username = extraireAuteurUsername(dataLama) || extraireAuteurUsername(dataTikHub);
      if (username) {
        const ab = await abonnesViaProfil(username, lamaKey);
        if (ab != null) stats.abonnesAuteur = ab;
      }
    }

    const stt = await transcrireEleven(media.buf, media.contentType, elevenKey);
    if (!stt.ok) {
      return res.status(200).json({ ok: false, description, stats, raison: 'stt_echec' });
    }
    const transcript = (stt.text || '').trim().slice(0, MAX_TRANSCRIPT);
    return res.status(200).json({
      ok: transcript.length > 10,
      transcript,
      description,
      stats,
      langue: stt.lang || null,
      raison: transcript.length > 10 ? null : 'sans_parole'
    });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ TÉLÉCHARGEMENT (voir l'ancien api/tiktok-download.js) ═══

async function handleDownload(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  const lamaKey = process.env.LAMATOK_API_KEY;
  if (!lamaKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });

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
    const verdict = await verifierQuota(droits, 'analyseVirale', code_acces);
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: "Quota d'analyses vidéo atteint.", code: 'QUOTA_ATTEINT', raison: verdict.raison } });
    }

    const tikhubKey = (process.env.TIKHUB_API_KEY || '').trim();
    const resolu = await resoudreVideoTikTok(url, lamaKey, tikhubKey);
    if (!resolu) {
      return res.status(422).json({ error: { message: 'Lien TikTok non reconnu. Vérifie le lien.' } });
    }

    const candidats = [
      ...(resolu.dataLama ? urlsVideo(resolu.dataLama) : []),
      ...(resolu.dataTikHub ? urlsVideo(resolu.dataTikHub) : [])
    ];

    let media = null;
    for (const u of candidats) {
      const m = await telechargerMedia(u);
      if (m.ok) { media = m; break; }
    }
    if (!media) {
      return res.status(502).json({ error: { message: 'Vidéo indisponible au téléchargement pour l\'instant. Réessaie plus tard, ou avec un autre lien.' } });
    }

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

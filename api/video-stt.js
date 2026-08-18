// ═══════════════════════════════════════════════════════════
//  /api/video-stt, TRANSCRIPTION D'UNE VIDÉO PAR LA VOIX
//
//  Au lieu de dépendre des sous-titres TikTok (fragiles, URLs expirantes),
//  on RÉCUPÈRE L'AUDIO de la vidéo et on le TRANSCRIT avec ElevenLabs Scribe
//  (speech-to-text). Marche sur n'importe quelle vidéo qui parle.
//
//  Pipeline : lien -> détail de la vidéo -> URL de la vidéo (sans filigrane si
//  possible) -> téléchargement (en-têtes crédibles + Range) -> ElevenLabs
//  /v1/speech-to-text (model scribe_v1) -> texte. Clé ELEVENLABS_API_KEY déjà
//  en place (partagée avec le montage / voix off).
//
//  SOURCE DU MÉDIA : LamaTok en PRINCIPAL (/v1/media/by/id), TikHub
//  (/fetch_post_detail, payé au crédit) en REPLI. TikHub prend le relais
//  sans coût fixe si LamaTok ne rend rien d'exploitable.
//
//  POST { url } -> { ok, transcript, description, stats, langue }. Non bloquant :
//  ok=false si la vidéo est indisponible ou sans parole (repli manuel côté client).
//  Clés 100% côté serveur.
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierQuota, verifierLimiteAnonyme } from './_lib/acces.js';
import {
  detailLamaTok, detailTikHub, extraireAwemeId, resoudreLien, urlsVideo,
  extraireDesc, extraireStats, extraireAbonnesAuteur, extraireAuteurUsername,
  abonnesViaProfil, telechargerMedia
} from './_lib/tiktok-media.js';

const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_TRANSCRIPT = 8000;
const PLAFOND_ANONYME_JOUR = 5; // filet IP, coûte jusqu'à 3 API payées par appel

// Transcrit un buffer audio/vidéo via ElevenLabs Scribe.
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

export default async function handler(req, res) {
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

    // Verrou serveur : droits réels + quota dédié (mensuel pour un plan,
    // 1 seule fois à vie sinon), jamais une valeur envoyée par le client.
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

    // 1) Résoudre le lien court et extraire l'id.
    let urlResolue = url.trim();
    let id = extraireAwemeId(urlResolue);
    if (!id) { urlResolue = await resoudreLien(urlResolue); id = extraireAwemeId(urlResolue); }
    if (!id) {
      return res.status(422).json({ error: { message: "Lien TikTok non reconnu. Vérifie le lien, ou colle le texte de la vidéo à la main." } });
    }

    // 2) Détail de la vidéo : LamaTok en PRINCIPAL, TikHub en REPLI (voir
    // note en tête de fichier).
    const dataLama = await detailLamaTok(id, lamaKey);

    // Description & stats : on prend ce que la source principale donne, complété
    // par le repli si besoin.
    let description = dataLama ? (extraireDesc(dataLama) || '') : '';
    let stats = dataLama ? extraireStats(dataLama) : null;

    // 3) Télécharger la 1re vidéo réellement exploitable (en-têtes crédibles).
    //    On tente d'abord les URLs LamaTok, puis TikHub.
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
      // Non bloquant : le client retombe sur le collage manuel.
      return res.status(200).json({ ok: false, description, stats, raison: 'video_indisponible' });
    }

    // 3 bis) PORTÉE : le nombre d'abonnés de l'auteur manque souvent dans le
    // détail d'un post. Sans lui, impossible de mesurer la portée (vues ÷
    // abonnés), et le verdict devient trompeur. On va donc le chercher sur le
    // profil de l'auteur (2e appel LamaTok), une seule fois, si besoin.
    if (stats && stats.vues && !stats.abonnesAuteur) {
      const username = extraireAuteurUsername(dataLama) || extraireAuteurUsername(dataTikHub);
      if (username) {
        const ab = await abonnesViaProfil(username, lamaKey);
        if (ab != null) stats.abonnesAuteur = ab;
      }
    }

    // 4) Transcription ElevenLabs Scribe.
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

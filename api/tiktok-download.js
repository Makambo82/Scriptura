// ═══════════════════════════════════════════════════════════
//  /api/tiktok-download, PROXY DE TÉLÉCHARGEMENT D'UNE VIDÉO TIKTOK
//
//  Résout le lien (LamaTok en principal, TikHub en repli, voir
//  api/_lib/tiktok-media.js, partagé avec api/video-stt.js), télécharge la
//  vidéo CÔTÉ SERVEUR (même en-têtes crédibles que la transcription), puis
//  la RENVOIE au navigateur (même origine que Scriptura, jamais de CORS).
//
//  Pourquoi pas un simple lien direct vers le CDN TikTok ? Le bouton
//  "Télécharger" (js/tiktok-outils.js) doit pouvoir ouvrir la feuille de
//  partage native (Web Share API, `files`) pour que le créateur enregistre
//  la vidéo directement dans sa galerie, exactement comme le montage
//  (js/montage.js, api/montage-download.js). Cette API exige un fichier
//  RÉEL en main côté navigateur, jamais une simple URL distante : un
//  fetch() direct vers le CDN TikTok échouerait aussi la plupart du temps
//  (CORS). Même coût serveur que la transcription (déjà acceptée), qui
//  télécharge déjà la vidéo entière pour la même vidéo.
//
//  GET ?url=<lien TikTok>&code_acces=<code|vide> -> flux vidéo binaire, ou
//  JSON d'erreur. Même quota mensuel que l'analyse vidéo (verifierQuota
//  'analyseVirale', voir api/_lib/acces.js), vérifié UNE seule fois ici
//  (le bouton de partage, lui, réutilise le fichier déjà récupéré, aucun
//  second appel serveur).
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierQuota, verifierLimiteAnonyme } from './_lib/acces.js';
import { resoudreVideoTikTok, urlsVideo, telechargerMedia } from './_lib/tiktok-media.js';

const PLAFOND_ANONYME_JOUR = 5; // filet IP, mêmes API payées que video-stt

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  const lamaKey = process.env.LAMATOK_API_KEY;
  if (!lamaKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });

  const url = req.query?.url;
  const code_acces = req.query?.code_acces || null;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: { message: 'Lien manquant' } });
  }

  try {
    // Verrou serveur : droits réels + quota dédié, jamais une valeur envoyée
    // par le client (même bucket que l'analyse vidéo, voir en-tête de fichier).
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

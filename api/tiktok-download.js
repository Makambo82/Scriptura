// ═══════════════════════════════════════════════════════════
//  /api/tiktok-download, LIEN DIRECT DE TÉLÉCHARGEMENT D'UNE VIDÉO TIKTOK
//
//  Résout un lien TikTok vers le détail de la vidéo (LamaTok en principal,
//  TikHub en repli, voir api/_lib/tiktok-media.js, partagé avec
//  api/video-stt.js) et renvoie l'URL média la mieux notée (sans filigrane
//  en priorité). Contrairement à video-stt.js, ne télécharge PAS la vidéo
//  côté serveur : le navigateur du créateur récupère directement depuis
//  cette URL, pas de gros fichier qui transite par la fonction serverless
//  (durée/taille limitées sur Vercel), pas de coût de bande passante ici.
//  Ces URLs peuvent expirer après quelques minutes (CDN TikTok), le client
//  doit prévenir l'utilisateur de télécharger rapidement.
//
//  POST { url, code_acces } -> { ok, videoUrl, description, stats } ou
//  { ok:false, raison }. Même quota mensuel que l'analyse vidéo
//  (verifierQuota 'analyseVirale', voir api/_lib/acces.js) : mêmes API
//  payées (LamaTok/TikHub) mises à contribution pour résoudre le lien.
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierQuota, verifierLimiteAnonyme } from './_lib/acces.js';
import { resoudreVideoTikTok, urlsVideo } from './_lib/tiktok-media.js';

const PLAFOND_ANONYME_JOUR = 5; // filet IP, mêmes API payées que video-stt

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  const lamaKey = process.env.LAMATOK_API_KEY;
  if (!lamaKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (LAMATOK_API_KEY)' } });

  try {
    const { url, code_acces } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: { message: 'Lien manquant' } });
    }

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
    if (!candidats.length) {
      return res.status(200).json({ ok: false, description: resolu.description, stats: resolu.stats, raison: 'video_indisponible' });
    }

    return res.status(200).json({
      ok: true,
      videoUrl: candidats[0],
      description: resolu.description,
      stats: resolu.stats
    });

  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

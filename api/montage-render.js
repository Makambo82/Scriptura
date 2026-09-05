// ═══════════════════════════════════════════════════════════
//  /api/montage-render, POINT D'ENTRÉE UNIQUE du rendu vidéo côté client
//  (voir js/montage.js, qui n'appelle jamais le service externe
//  directement). PROXIE la requête vers le service de rendu externe
//  (render-service/, Railway), avec le jeton MONTAGE_RENDER_TOKEN ajouté
//  ici, côté serveur uniquement (voir plus bas) : l'URL et le jeton ne
//  doivent jamais vivre dans du JS servi au client.
//
//  Ouvert à Creator ET Pro, comme le reste du montage (voir
//  verifierAccesMontage, api/_lib/acces.js), depuis que le coût réel du
//  service de rendu externe est mesuré (retour propriétaire) : sur un
//  montage réel de 55 s (11 plans, sous-titres, musique, filigrane), 35,4 s
//  de calcul et un pic de 91 Mo de RAM, soit quelques millièmes de dollar
//  au tarif Railway (facturé à la seconde de vCPU et de Go-RAM). Le rendu
//  n'est qu'une dernière étape du même parcours déjà payant, le réserver
//  plus longtemps au fondateur laissait un abonné préparer ses images et
//  sa voix off sans jamais pouvoir obtenir la vidéo finale.
//
//  Historique : ce fichier assemblait autrefois la vidéo ICI MÊME avec
//  FFmpeg (auto-hébergé sur Vercel), en repli si MONTAGE_RENDER_URL
//  n'était pas réglée. Retiré (retour propriétaire) : ce repli reproduisait
//  exactement les compromis (720p, 15 img/s, cut net sans fondu, ni
//  sous-titres ni musique ni filigrane) qui avaient justifié le passage à
//  un service externe (voir render-service/README.md), et n'était de toute
//  façon plus jamais exécuté en production. MONTAGE_RENDER_URL est
//  désormais requise pour que le montage fonctionne.
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierAccesMontage, codeAccesRefuse } from './_lib/acces.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  // Même règle d'accès que le reste du montage (voir en-tête de fichier) :
  // vérifiée ICI, jamais fiée au seul CSS (body.peut-monter-video), qui ne
  // sert qu'à masquer le bouton, pas à protéger la route.
  const droits = await resoudreDroits(body?.code_acces);
  const acces = verifierAccesMontage(droits);
  if (!acces.ok) {
    return res.status(403).json({ error: { message: 'Réservé aux abonnés Creator et Pro', code: codeAccesRefuse(droits) } });
  }

  const images = Array.isArray(body?.images) ? body.images : [];
  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl : '';
  if (!images.length || !audioUrl) {
    return res.status(400).json({ error: { message: 'Images ou audio manquant' } });
  }
  // Sous-titres incrustés (retour propriétaire), voir api/montage-media.js
  // pour leur construction. Optionnels : un tableau vide (ou absent) ne
  // doit jamais empêcher le montage, juste le laisser sans sous-titres.
  const captions = Array.isArray(body?.captions) ? body.captions : [];
  // Musique de fond (retour propriétaire : montage "pas assez premium"),
  // voir api/montage-media.js action=music pour sa génération. Optionnelle.
  const musicUrl = typeof body?.musicUrl === 'string' ? body.musicUrl : '';
  // Volume de la musique de fond (retour propriétaire), choisi par montage
  // via le menu "Volume de la musique" côté client (0.05-0.5, voir
  // render-service/server.js pour le bornage définitif). Optionnel : sans
  // lui, le service de rendu retombe sur sa valeur par défaut.
  const musicVolume = Number.isFinite(Number(body?.musicVolume)) ? Number(body.musicVolume) : undefined;
  // Filigrane Scriptura (retour propriétaire), facultatif, activé/désactivé
  // par case à cocher côté client.
  const watermark = !!body?.watermark;

  // Service de rendu externe (Railway, voir render-service/), proxié depuis
  // ICI (serveur), jamais appelé directement par le navigateur (voir
  // js/montage.js) : sans ça, l'URL du service ET son jeton auraient dû
  // vivre dans le JS servi au client, donc publics, ce qui aurait annulé
  // toute protection (même faille que si on avait mis une clé secrète dans
  // le HTML). MONTAGE_RENDER_URL/MONTAGE_RENDER_TOKEN sont des variables
  // d'environnement VERCEL (jamais exposées au navigateur), à régler
  // séparément des variables du service externe lui-même (voir
  // render-service/README.md).
  if (!process.env.MONTAGE_RENDER_URL) {
    return res.status(500).json({ error: { message: 'Service de rendu vidéo non configuré (MONTAGE_RENDER_URL absente).' } });
  }
  try {
    const entetesProxy = { 'Content-Type': 'application/json' };
    if (process.env.MONTAGE_RENDER_TOKEN) entetesProxy['x-montage-token'] = process.env.MONTAGE_RENDER_TOKEN;
    const format = typeof body?.format === 'string' ? body.format : undefined;
    const rProxy = await fetch(process.env.MONTAGE_RENDER_URL.replace(/\/$/, '') + '/render', {
      method: 'POST',
      headers: entetesProxy,
      body: JSON.stringify({ images, audioUrl, format, captions, musicUrl, musicVolume, watermark })
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

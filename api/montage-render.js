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

import { resoudreDroits, verifierAccesMontage, verifierQuota, rembourserUsage, codeAccesRefuse } from './_lib/acces.js';

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
  // LOT 3, audit A2 : le render-service refuse désormais TOUTE requête sans
  // jeton valide (voir jetonValide, render-service/server.js). Sans cette
  // variable ici, le proxy enverrait la requête sans en-tête et le
  // render-service la rejetterait avec un 401 générique - vrai, mais qui
  // ressemblerait à une panne du service externe plutôt qu'à ce que c'est
  // réellement : une configuration Vercel incomplète.
  if (!process.env.MONTAGE_RENDER_TOKEN) {
    return res.status(500).json({ error: { message: 'Service de rendu vidéo non configuré (MONTAGE_RENDER_TOKEN absente).' } });
  }

  // LOT 2, audit A7 : le rendu vidéo (Railway) n'avait jusqu'ici AUCUN
  // quota, seulement la vérification de plan ci-dessus - un appel direct et
  // répété à cette route coûtait donc à volonté. Décompté ICI, une fois la
  // requête validée (jamais pour un payload invalide ou une configuration
  // manquante), juste avant de proxier vers le service externe (même ordre
  // que la génération d'images du même montage, voir api/montage-media.js),
  // remboursé si le service externe échoue.
  const quota = await verifierQuota(droits, 'montageRendus', body?.code_acces);
  if (!quota.ok) {
    return res.status(403).json({ error: { message: 'Limite de rendus vidéo du mois atteinte pour ton plan.', code: 'QUOTA_ATTEINT' } });
  }

  try {
    const entetesProxy = { 'Content-Type': 'application/json' };
    if (process.env.MONTAGE_RENDER_TOKEN) entetesProxy['x-montage-token'] = process.env.MONTAGE_RENDER_TOKEN;
    const format = typeof body?.format === 'string' ? body.format : undefined;
    const debutRendu = Date.now();
    const rProxy = await fetch(process.env.MONTAGE_RENDER_URL.replace(/\/$/, '') + '/render', {
      method: 'POST',
      headers: entetesProxy,
      body: JSON.stringify({ images, audioUrl, format, captions, musicUrl, musicVolume, watermark })
    });
    const dataProxy = await rProxy.json().catch(() => ({}));
    if (!rProxy.ok || !dataProxy.url) {
      if (quota.consomme) await rembourserUsage(droits, 'montageRendus', body?.code_acces, 1);
      // MÊME LEÇON que le correctif du stockage montage (audit A3, retour
      // terrain) : un message générique qui avale le statut HTTP réel rend
      // le prochain incident impossible à diagnostiquer sans accès direct
      // au service externe (Railway). Le statut est toujours disponible ici
      // (rProxy.status), même quand le corps n'a pas pu être lu en JSON
      // (processus planté, page d'erreur de l'hébergeur au lieu du JSON
      // attendu) : dataProxy.error.message reste le message le plus précis
      // quand le service a pu répondre proprement, le statut HTTP comble le
      // reste, en particulier ce cas de figure.
      const raison = (dataProxy.error && dataProxy.error.message) || 'réponse illisible';
      return res.status(502).json({ error: { message: 'Le service de rendu externe a échoué (HTTP ' + rProxy.status + ' : ' + raison + ').' } });
    }
    // Mesure du rendu, jamais bloquante (voir journaliserMontage) : la vidéo
    // est déjà prête, rien de ce qui suit ne doit pouvoir la retarder ni la
    // faire échouer. Lancée sans await, erreurs avalées.
    journaliserMontage({
      code_acces: body?.code_acces || null,
      plan: droits.isAdmin ? 'fondateur' : (droits.plan || null),
      nb_plans: images.length,
      duree_video_s: images.reduce((s, img) => s + (Number(img && img.duration) || 0), 0),
      duree_rendu_ms: Date.now() - debutRendu,
      format: format || null,
      sous_titres: captions.length > 0,
      musique: !!musicUrl,
      filigrane: watermark
    });
    return res.status(200).json({ url: dataProxy.url });
  } catch (e) {
    if (quota.consomme) await rembourserUsage(droits, 'montageRendus', body?.code_acces, 1);
    return res.status(502).json({ error: { message: 'Service de rendu externe injoignable : ' + (e.message || 'inconnue') } });
  }
}

// Enregistre une vidéo montée dans `montages_rendus` (table OPTIONNELLE, voir
// supabase/montages_rendus.sql), pour la carte "Vidéos montées" du Tableau de
// bord. Le quota d'images était déjà compté, mais le rendu lui-même ne
// l'était nulle part : impossible de savoir combien de vidéos sortent
// réellement de l'app, ni quel plan s'en sert.
//
// Tout est avalé en silence, volontairement, et à trois niveaux : Supabase
// non configuré, table absente, requête en échec. Une mesure n'a AUCUNE
// raison de casser ou de ralentir la fonctionnalité qu'elle mesure, surtout
// après un rendu qui vient de coûter une minute d'attente au créateur.
// Aucune donnée de contenu n'est enregistrée, uniquement des compteurs.
function journaliserMontage(ligne) {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    fetch(url + '/rest/v1/montages_rendus', {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=minimal'
      },
      body: JSON.stringify(ligne)
    }).catch(() => {});
  } catch (e) { /* jamais bloquant */ }
}

// ═══════════════════════════════════════════════════════════
//  /api/tendances, Analyse de tendances TikTok par niche (mode "Tendances")
//
//  Inspiré de Vervox : scanner ~50 vidéos qui cartonnent dans une niche
//  (recherche par mot-clé, pas un compte précis), en tirer un benchmark
//  (vues/likes médians, engagement, momentum), un classement des créateurs,
//  le registre de langage et les patterns de rétention observés. Réservé au
//  plan Pro, 1 analyse par mois (voir api/_lib/acces.js), comme Vervox
//  lui-même limite son propre benchmark.
//
//  Trop lourd pour une seule requête serverless (télécharger + transcrire
//  ~50 vidéos dépasse largement les 60-300s dont dispose une fonction
//  Vercel) : le job avance PAR ÉTAPES, jamais de job en arrière-plan séparé.
//    - POST {action:'lancer', niche, code_acces} : cherche les vidéos
//      candidates (fetch_general_search, TikHub, pagination), les
//      enregistre dans Supabase (pas encore transcrites), renvoie l'id.
//    - POST {action:'avancer', id, code_acces} : traite un LOT borné de
//      vidéos (téléchargement + transcription ElevenLabs), à rappeler en
//      boucle par le navigateur jusqu'à ce que statut='termine'. Le dernier
//      lot déclenche la synthèse finale (chiffres calculés par le code,
//      lecture qualitative par l'IA sur les transcripts réels).
//
//  Confirmé en prod (3 tours de sonde, voir historique git) : l'endpoint
//  TikHub fetch_general_search{keyword,count,cursor} renvoie de vraies
//  vidéos avec id/desc/createTime/author/authorStats/stats/challenges et
//  pagination cursor/has_more.
//
//  ?debug=1&mot=NICHE&code_acces=CODE (GET, admin uniquement) : sonde de
//  diagnostic conservée pour du dépannage futur (endpoints TikHub candidats).
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierQuota } from './_lib/acces.js';
import { urlsVideo, telechargerMedia, detailTikHub, extraireAuteurUsername, extraireAuteurAvatar } from './_lib/tiktok-media.js';

const TIKHUB_BASE = 'https://api.tikhub.io';
const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const VIDEOS_CIBLE = 50;          // nombre de vidéos candidates visées
const VIDEOS_CIBLE_TEST = 5;      // mode test (admin), pour vérifier un correctif sans payer 50 vidéos
const FENETRE_JOURS = 90;         // fraîcheur, comme Vervox
const PAGES_MAX_RECHERCHE = 20;   // garde-fou anti-boucle infinie (cf. réserve élargie ci-dessous)
// fetch_general_search (TikHub) ne trie PAS par performance, juste par
// pertinence du mot-clé : un 1er test réel a montré des médianes basses
// (vues/likes) parce qu'on gardait les 50 premières vidéos rencontrées,
// carton ou pas. On cherche donc une réserve plus large (cible × ce
// multiplicateur, ou toutes les pages dispo si la niche en a moins), puis
// on NE GARDE QUE les mieux vues (voir tri dans lancer()) : c'est ce
// tri-là, pas la recherche elle-même, qui fait "ce qui cartonne". Relevé de
// 3 à 5 (retour du propriétaire : les résultats ne semblaient toujours pas
// assez "explosés") : plus la réserve avant tri est large, plus la chance
// d'y trouver les vraies vidéos à forte vue augmente. Ça reste un plafond
// statistique, pas une garantie : la recherche reste triée par pertinence,
// pas par popularité, donc une niche pauvre en gros cartons sur les 90
// derniers jours (FENETRE_JOURS) restera limitée par ce qui existe
// vraiment, quelle que soit la taille de la réserve.
const RESERVE_MULTIPLICATEUR = 5;
const LOT_PAR_AVANCEE = 3;        // vidéos traitées par appel "avancer", en parallèle
const MODEL_SYNTHESE = 'claude-haiku-4-5-20251001';
const MAX_TRANSCRIPT = 2000;      // par vidéo, la synthèse porte sur l'ensemble de l'échantillon

// ── Supabase (service_role, jamais exposé au client) ──
function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function supabaseHeaders(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}
async function supabaseInsert(cfg, table, ligne) {
  const r = await fetch(cfg.url + '/rest/v1/' + table, {
    method: 'POST',
    headers: { ...supabaseHeaders(cfg.key), Prefer: 'return=representation' },
    body: JSON.stringify(ligne)
  });
  if (!r.ok) return { ok: false, detail: await r.text().catch(() => '') };
  const data = await r.json().catch(() => null);
  return { ok: true, id: data && data[0] && data[0].id };
}
async function supabaseGetById(cfg, table, id) {
  const r = await fetch(cfg.url + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: supabaseHeaders(cfg.key) });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return (data && data[0]) || null;
}
async function supabaseUpdate(cfg, table, id, patch) {
  const r = await fetch(cfg.url + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: { ...supabaseHeaders(cfg.key), Prefer: 'return=minimal' }, body: JSON.stringify(patch)
  });
  return { ok: r.ok };
}

// ── Recherche TikHub (fetch_general_search, confirmé en prod) ──
async function rechercherVideos(mot, cursor, tikhubKey) {
  const url = TIKHUB_BASE + '/api/v1/tiktok/web/fetch_general_search?' +
    new URLSearchParams({ keyword: mot, count: 20, cursor: String(cursor || 0) }).toString();
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tikhubKey } });
    if (!r.ok) return null;
    const data = await r.json();
    const inner = data && data.data;
    const arr = inner && Array.isArray(inner.data) ? inner.data : [];
    const items = arr.map(x => x && x.item).filter(Boolean);
    return { items, cursor: inner ? inner.cursor : cursor, hasMore: !!(inner && inner.has_more) };
  } catch (e) { return null; }
}

// Ne garde QUE les champs utiles (la réponse brute de TikHub est massive :
// bitrateInfo, zoomCover, MVMAF… inutiles une fois l'URL de téléchargement
// extraite), pour garder la ligne Supabase légère.
function allegerItem(item) {
  const stats = item.stats || {};
  const author = item.author || {};
  const authorStats = item.authorStats || {};
  return {
    id: item.id,
    desc: String(item.desc || '').slice(0, 500),
    createTime: typeof item.createTime === 'number' ? item.createTime : null,
    auteur: {
      id: author.id || null,
      uniqueId: author.uniqueId || null,
      nickname: author.nickname || null,
      followerCount: typeof authorStats.followerCount === 'number' ? authorStats.followerCount : null,
      avatarUrl: extraireAuteurAvatar(author)
    },
    stats: {
      vues: Number(stats.playCount) || 0,
      likes: Number(stats.diggCount) || 0,
      commentaires: Number(stats.commentCount) || 0,
      partages: Number(stats.shareCount) || 0
    },
    hashtags: Array.isArray(item.challenges) ? item.challenges.slice(0, 8).map(c => c && c.title).filter(Boolean) : [],
    // Réutilise le scanner générique déjà éprouvé par l'analyse vidéo unitaire
    // (api/tiktok-video.js) : les champs playAddr/downloadAddr de TikHub sont
    // identiques ici, aucune logique d'extraction à réécrire.
    urlsCandidates: urlsVideo(item).slice(0, 3),
    transcript: null,
    transcriptEchec: false
  };
}

// ── Transcription (même mécanisme qu'api/tiktok-video.js, dupliqué ici pour
// ne pas toucher à un endpoint déjà en production et testé) ──
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
    if (!r.ok) return { ok: false, reason: 'stt http ' + r.status + (data && data.detail ? ' : ' + JSON.stringify(data.detail).slice(0, 120) : '') };
    return { ok: true, text: (data && data.text) || '' };
  } catch (e) { return { ok: false, reason: 'stt ' + (e.name === 'AbortError' ? 'timeout' : e.message) }; }
  finally { clearTimeout(minuteur); }
}

// 2 tours de test réel en prod : diagnostic confirmé, quasi tous les échecs
// sont "http 403" (voir echecDetail, historique git). Les URLs playAddr/
// downloadAddr capturées à `lancer` sont des liens signés à durée de vie
// courte, périmés le temps que `avancer` les atteigne. api/tiktok-video.js
// (mode vidéo unique, en prod, fiable) ne les utilise jamais tels quels :
// il résout une URL FRAÎCHE juste avant de télécharger via fetch_post_detail
// (voir resoudreVideoTikTok, _lib/tiktok-media.js). Même principe ici :
// on retente une résolution fraîche par TikHub avant le téléchargement, et
// on ne retombe sur les URLs de la recherche (potentiellement périmées) que
// si cette résolution fraîche échoue (panne TikHub, id introuvable...).
async function transcrireVideo(v, tikhubKey, elevenKey) {
  const raisons = [];
  let urls = v.urlsCandidates || [];
  if (tikhubKey) {
    const detail = await detailTikHub(v.id, tikhubKey);
    const fraiches = detail ? urlsVideo(detail).slice(0, 3) : [];
    if (fraiches.length) urls = fraiches;
    // L'item de RECHERCHE (fetch_general_search) ne porte pas toujours le
    // uniqueId de l'auteur, surtout pour les niches aux correspondances plus
    // rares (retour du propriétaire : aucun lien "voir cette vidéo" sur des
    // niches comme "finance" ou "géopolitique") : sans lui, impossible de
    // construire le lien TikTok vers la vidéo (voir meilleureVideo,
    // synthetiser()). Le détail complet du post, déjà appelé ci-dessus pour
    // l'URL fraîche, le contient presque toujours, sans appel TikHub
    // supplémentaire.
    if (detail && (!v.auteur || !v.auteur.uniqueId)) {
      const uniqueId = extraireAuteurUsername(detail);
      if (uniqueId) v.auteur = { ...(v.auteur || {}), uniqueId };
    }
    // Même repli pour la photo de profil (retour du propriétaire : une
    // vraie photo plutôt qu'une initiale) : l'item de recherche ne la porte
    // pas toujours non plus.
    if (detail && (!v.auteur || !v.auteur.avatarUrl)) {
      const avatarUrl = extraireAuteurAvatar(detail);
      if (avatarUrl) v.auteur = { ...(v.auteur || {}), avatarUrl };
    }
  }
  for (const u of urls) {
    const media = await telechargerMedia(u);
    if (!media.ok) { raisons.push(media.reason || 'échec inconnu'); continue; }
    const stt = await transcrireEleven(media.buf, media.contentType, elevenKey);
    if (stt.ok && stt.text && stt.text.trim().length > 10) {
      v.transcript = stt.text.trim().slice(0, MAX_TRANSCRIPT);
      return;
    }
    raisons.push(stt.reason || (stt.ok ? 'transcript vide/trop court' : 'échec stt inconnu'));
  }
  v.transcriptEchec = true;
  v.echecDetail = raisons;
}

// ── Appel Claude direct (même mécanisme qu'api/generate.js), hors quota :
// le quota "tendances" a déjà été consommé au lancement (action=lancer),
// cette synthèse finale n'en consomme pas un 2e. ──
async function appelClaudeDirect(prompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL_SYNTHESE, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await r.json();
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) throw new Error('Réponse IA vide ou invalide');
  return text;
}

function mediane(arrTrie) {
  if (!arrTrie.length) return null;
  const n = arrTrie.length;
  return n % 2 ? arrTrie[(n - 1) / 2] : Math.round((arrTrie[n / 2 - 1] + arrTrie[n / 2]) / 2);
}

// Chiffres calculés PAR LE CODE (déterministe, jamais recalculés par l'IA,
// même principe que le reste de Scriptura) + synthèse qualitative de l'IA
// sur les transcripts réellement récupérés (registre, patterns de rétention).
async function synthetiser(niche, videos) {
  const avecStats = videos.filter(v => v.stats && v.stats.vues > 0);
  const vuesTrie = avecStats.map(v => v.stats.vues).sort((a, b) => a - b);
  const likesTrie = avecStats.map(v => v.stats.likes).sort((a, b) => a - b);
  const vuesMedianes = mediane(vuesTrie);
  const likesMedianes = mediane(likesTrie);
  const engagementMoyen = avecStats.length
    ? Math.round((avecStats.reduce((s, v) => s + ((v.stats.likes + v.stats.commentaires + v.stats.partages) / v.stats.vues), 0) / avecStats.length) * 1000) / 10
    : null;

  // Momentum : vues moyennes des vidéos récentes (0-30j) vs plus anciennes
  // (30-90j) de l'échantillon, un signe de tendance qui MONTE ou qui S'ESSOUFFLE.
  const maintenant = Math.floor(Date.now() / 1000);
  const recentes = avecStats.filter(v => v.createTime && (maintenant - v.createTime) <= 30 * 86400);
  const anciennes = avecStats.filter(v => v.createTime && (maintenant - v.createTime) > 30 * 86400);
  const moyenne = arr => arr.length ? arr.reduce((s, v) => s + v.stats.vues, 0) / arr.length : null;
  const moyRecent = moyenne(recentes), moyAncien = moyenne(anciennes);
  const momentum = (moyRecent != null && moyAncien) ? Math.round((moyRecent / moyAncien) * 100) / 100 : null;

  // Classement des créateurs par vues cumulées SUR CET ÉCHANTILLON (pas leur
  // compte entier, honnête sur ce qui est réellement mesuré ici). Chaque
  // créateur porte aussi sa photo de profil (avatarUrl) et sa MEILLEURE
  // vidéo de l'échantillon (id/desc/lien/stats détaillées) : retour du
  // propriétaire, le rapport donnait le nom d'un créateur sans jamais dire
  // QUELLE vidéo regarder. On parcourt les vidéos déjà classées par
  // performance (classerParPerformance, vues ET engagement) : la première
  // vidéo rencontrée pour un créateur est donc sa plus performante, pas
  // juste la première de la liste brute.
  //
  // Le lien doit TOUJOURS exister, même sans uniqueId (constaté en prod sur
  // des niches comme "finance"/"actualité" : ni l'item de recherche ni le
  // détail du post ne le fournissent pour une partie des auteurs, malgré la
  // résolution déjà tentée dans transcrireVideo). TikTok route une page
  // /@handle/video/{id} sur l'ID de la vidéo, pas sur le handle (confirmé
  // par les nombreux outils tiers qui génèrent ce type de lien à partir du
  // seul ID) : un handle générique en repli donne donc quand même un lien
  // fonctionnel, jamais un lien mort faute de handle exact.
  const parAuteur = new Map();
  let videosAvecHandle = 0, videosSansHandle = 0;
  classerParPerformance(avecStats).forEach(v => {
    const a = v.auteur || {};
    const cle = a.uniqueId || a.id;
    if (!cle) return;
    if (a.uniqueId) videosAvecHandle++; else videosSansHandle++;
    if (!parAuteur.has(cle)) {
      parAuteur.set(cle, {
        uniqueId: a.uniqueId, nickname: a.nickname, followerCount: a.followerCount, avatarUrl: a.avatarUrl || null,
        vuesCumulees: 0, nbVideos: 0,
        meilleureVideo: {
          id: v.id,
          desc: v.desc || '',
          vues: v.stats.vues,
          likes: v.stats.likes,
          commentaires: v.stats.commentaires,
          partages: v.stats.partages,
          lien: `https://www.tiktok.com/@${a.uniqueId || 'video'}/video/${v.id}`
        }
      });
    }
    const e = parAuteur.get(cle);
    e.vuesCumulees += v.stats.vues; e.nbVideos++;
  });
  const topCreateurs = Array.from(parAuteur.values()).sort((a, b) => b.vuesCumulees - a.vuesCumulees).slice(0, 10);

  // Diagnostic temporaire (voir transcrireVideo) : pourquoi chaque échec de
  // téléchargement/transcription, à retirer une fois le taux de réussite
  // fiabilisé sur des tests réels.
  const echecs = videos.filter(v => v.transcriptEchec);
  const echecsDetail = echecs.slice(0, 20).map(v => ({ id: v.id, raisons: v.echecDetail || [] }));

  const stats = {
    echantillon: videos.length,
    transcrites: videos.filter(v => v.transcript).length,
    echecsTranscription: echecs.length,
    echecsDetail,
    // Diagnostic (voir commentaire sur meilleureVideo.lien ci-dessus) :
    // combien de vidéos de l'échantillon avaient un vrai handle vs un lien
    // de repli, pour savoir si ce cas reste marginal ou s'il faut aller
    // plus loin (ex. un 2e appel TikHub dédié à la résolution du handle).
    videosAvecHandle, videosSansHandle,
    vuesMedianes, likesMedianes, engagementMoyen, momentum, topCreateurs
  };

  const avecTranscript = videos.filter(v => v.transcript).slice(0, 40);
  let qualitatif = {};
  if (avecTranscript.length >= 3) {
    const corpus = avecTranscript
      .map((v, i) => `- Vidéo ${i + 1} (${v.stats.vues} vues${v.hashtags.length ? ', ' + v.hashtags.join(' ') : ''}) : « ${v.desc} » — transcript : ${v.transcript}`)
      .join('\n\n');
    const prompt = `Tu es Scriptura, consultant TikTok pour créateurs francophones. Voici un échantillon de ${avecTranscript.length} vidéos qui cartonnent en ce moment dans la niche "${niche}" (mot-clé de recherche), avec leur transcript réel.

${corpus.slice(0, 40000)}

FAITS DÉJÀ CALCULÉS PAR LE CODE (ne les recalcule jamais, base ta lecture dessus, ne les contredis pas) :
- Vues médianes de l'échantillon : ${vuesMedianes}
- Engagement moyen : ${engagementMoyen != null ? engagementMoyen + '%' : 'non mesurable'}
- Momentum (vues moyennes récentes 0-30j vs 30-90j) : ${momentum != null ? momentum + '×' : 'non mesurable, pas assez d\'historique dans l\'échantillon'}

TON TRAVAIL : à partir des TRANSCRIPTS ci-dessus UNIQUEMENT (jamais des chiffres, déjà connus, n'invente rien d'autre), identifie :
1. Le REGISTRE de langage dominant (ton, vocabulaire typique, expressions récurrentes de cette niche).
2. La DURÉE optimale observée (estimation à partir du contenu et du rythme, pas une donnée exacte).
3. Les PATTERNS DE RÉTENTION concrets qui reviennent d'une vidéo à l'autre (techniques de hook, structure, rythme, appels à l'action). 5 à 8 patterns précis, jamais génériques.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour :
{"registre": "<description du ton/vocabulaire, 2-3 phrases>", "duree_optimale": "<estimation, ex. '45-90s'>", "patterns_retention": ["<pattern 1>", "<pattern 2>"]}`;

    try {
      const raw = await appelClaudeDirect(prompt, 2000);
      const nettoye = raw.replace(/^```json\s*|\s*```$/g, '').trim();
      qualitatif = JSON.parse(nettoye);
    } catch (e) { qualitatif = {}; }
  }

  return { niche, ...stats, ...qualitatif };
}

// Classe les vidéos par PERFORMANCE (vues ET engagement, jamais les vues
// seules) : un gros compte peut cumuler des vues sans que le contenu soit
// vraiment bon (juste sa base d'abonnés), alors qu'une vidéo à l'audience
// plus modeste mais au taux d'engagement élevé est souvent le signal le
// plus honnête de "ça cartonne vraiment" — exactement ce que ce mode
// promet de repérer (voir en-tête de fichier). Combine les deux par RANG
// (pas une formule à poids arbitraires) : chaque vidéo est classée une
// fois par vues, une fois par engagement, la somme des deux rangs
// départage (plus bas = mieux classée sur les deux plans à la fois), ce
// qui évite qu'une métrique à l'échelle bien plus grande (vues, en
// centaines de milliers) n'écrase l'autre (engagement, une fraction < 1)
// dans un simple score pondéré.
function classerParPerformance(videos) {
  const avecTaux = videos.map(v => {
    const s = v.stats || {};
    const vues = s.vues || 0;
    const engagement = vues > 0 ? ((s.likes || 0) + (s.commentaires || 0) + (s.partages || 0)) / vues : 0;
    return { v, vues, engagement };
  });
  // Départage explicite par l'AUTRE métrique en cas d'égalité (ex. données
  // d'engagement manquantes/nulles pour un lot de vidéos) : sans ce
  // départage, un simple tri stable retombe sur l'ordre d'arrivée, qui peut
  // par coïncidence s'opposer au rang vues et neutraliser tout le calcul
  // (rangCombine identique pour toutes les vidéos). Avec le départage, une
  // égalité d'engagement retombe proprement sur le classement par vues,
  // jamais sur un artefact d'ordre d'arrivée.
  const parVues = [...avecTaux].sort((a, b) => b.vues - a.vues || b.engagement - a.engagement);
  const parEngagement = [...avecTaux].sort((a, b) => b.engagement - a.engagement || b.vues - a.vues);
  const rangVues = new Map(parVues.map((x, i) => [x.v.id, i]));
  const rangEngagement = new Map(parEngagement.map((x, i) => [x.v.id, i]));
  return avecTaux
    .map(x => ({ v: x.v, rangCombine: rangVues.get(x.v.id) + rangEngagement.get(x.v.id) }))
    .sort((a, b) => a.rangCombine - b.rangCombine)
    .map(x => x.v);
}

// ── action=lancer : cherche les vidéos candidates, crée le job ──
async function lancer(req, res, tikhubKey) {
  const { niche, code_acces, test } = req.body || {};
  if (!niche || typeof niche !== 'string' || !niche.trim()) {
    return res.status(400).json({ error: { message: 'Niche manquante' } });
  }
  const droits = await resoudreDroits(code_acces);
  if (!droits.ok) return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });

  // Mode test (admin uniquement) : échantillon réduit à VIDEOS_CIBLE_TEST au
  // lieu de VIDEOS_CIBLE, pour vérifier un correctif sans payer TikHub/
  // ElevenLabs sur 50 vidéos à chaque itération (voir debug-tendances.html).
  const cible = (test === true && droits.isAdmin) ? VIDEOS_CIBLE_TEST : VIDEOS_CIBLE;

  const verdict = await verifierQuota(droits, 'tendances', code_acces);
  if (!verdict.ok) {
    // Un Creator a un plafond de 0/mois : ce n'est jamais "déjà utilisé",
    // le mode ne lui est simplement pas ouvert (comme l'audit détaillé).
    if (verdict.raison === 'acces_requis' || droits.plan !== 'pro') {
      return res.status(403).json({ error: { message: 'Le mode Tendances est réservé au plan Pro.', code: 'ACCES_REFUSE' } });
    }
    return res.status(403).json({ error: { message: "Tu as déjà utilisé ton analyse de tendances ce mois-ci.", code: 'QUOTA_ATTEINT' } });
  }

  const cfg = supabaseConfig();
  if (!cfg) return res.status(500).json({ error: { message: 'Mémoire indisponible (Supabase non configuré).' } });

  const seuilDate = Math.floor(Date.now() / 1000) - FENETRE_JOURS * 86400;
  const reserveCible = cible * RESERVE_MULTIPLICATEUR;
  const reserve = new Map(); // id -> item allégé, PAS encore filtré par performance
  let cursor = 0, page = 0, hasMore = true;
  while (reserve.size < reserveCible && hasMore && page < PAGES_MAX_RECHERCHE) {
    const lot = await rechercherVideos(niche.trim(), cursor, tikhubKey);
    page++;
    if (!lot) break;
    for (const item of lot.items) {
      if (!item || !item.id || reserve.has(item.id)) continue;
      if (item.createTime && item.createTime < seuilDate) continue;
      reserve.set(item.id, allegerItem(item));
    }
    hasMore = lot.hasMore;
    cursor = lot.cursor;
    if (cursor == null) break;
  }

  if (reserve.size < 5) {
    return res.status(200).json({ ok: false, raison: 'pas_assez_de_videos', trouvees: reserve.size });
  }

  // On ne garde que les vidéos qui cartonnent VRAIMENT (vues ET engagement,
  // pas les vues seules, voir classerParPerformance) : c'est ce tri qui
  // fait de l'échantillon "ce qui cartonne dans la niche", pas la
  // recherche elle-même (voir RESERVE_MULTIPLICATEUR ci-dessus).
  const collectees = new Map(
    classerParPerformance(Array.from(reserve.values()))
      .slice(0, cible)
      .map(v => [v.id, v])
  );

  const insere = await supabaseInsert(cfg, 'tendances_niche', {
    code_acces: code_acces || null,
    niche: niche.trim(),
    statut: 'en_cours',
    videos: Array.from(collectees.values()),
    index_suivant: 0
  });
  if (!insere.ok) return res.status(500).json({ error: { message: 'Échec de la création de l\'analyse.' } });

  return res.status(200).json({ ok: true, id: insere.id, total: collectees.size });
}

// ── action=avancer : traite un lot borné, en parallèle, jusqu'au bout ──
async function avancer(req, res, tikhubKey, elevenKey) {
  const { id, code_acces } = req.body || {};
  if (!id) return res.status(400).json({ error: { message: 'id manquant' } });
  const droits = await resoudreDroits(code_acces);
  if (!droits.ok) return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });

  const cfg = supabaseConfig();
  if (!cfg) return res.status(500).json({ error: { message: 'Mémoire indisponible (Supabase non configuré).' } });
  const job = await supabaseGetById(cfg, 'tendances_niche', id);
  if (!job) return res.status(404).json({ error: { message: 'Analyse introuvable.' } });
  if (job.statut !== 'en_cours') {
    return res.status(200).json({ ok: true, statut: job.statut, traitees: job.index_suivant, total: (job.videos || []).length, resultat: job.resultat || null });
  }

  const videos = job.videos || [];
  const debut = job.index_suivant || 0;
  const lot = videos.slice(debut, debut + LOT_PAR_AVANCEE).filter(v => !v.transcript && !v.transcriptEchec);
  if (!elevenKey) {
    lot.forEach(v => { v.transcriptEchec = true; }); // dégradation propre : la synthèse continue sans transcript
  } else {
    await Promise.all(lot.map(v => transcrireVideo(v, tikhubKey, elevenKey)));
  }

  const nouvelIndex = Math.min(debut + LOT_PAR_AVANCEE, videos.length);
  let statut = 'en_cours', resultat = null;
  if (nouvelIndex >= videos.length) {
    try {
      resultat = await synthetiser(job.niche, videos);
      statut = 'termine';
    } catch (e) {
      statut = 'echec';
    }
  }

  await supabaseUpdate(cfg, 'tendances_niche', id, { videos, index_suivant: nouvelIndex, statut, resultat, maj_le: new Date().toISOString() });
  return res.status(200).json({ ok: true, statut, traitees: nouvelIndex, total: videos.length, resultat });
}

// ── Sonde de diagnostic (admin), conservée pour du dépannage futur ──
const CANDIDATS_RECHERCHE = [
  { nom: 'fetch_general_search', chemin: '/api/v1/tiktok/web/fetch_general_search', params: (mot) => ({ keyword: mot, count: 10 }) }
];
function formeDonnees(v, profondeur) {
  if (profondeur > 9 || v == null) return v === null ? null : typeof v;
  if (Array.isArray(v)) return { type: 'array', longueur: v.length, premierElement: v.length ? formeDonnees(v[0], profondeur + 1) : null };
  if (typeof v === 'object') { const out = {}; for (const k of Object.keys(v)) out[k] = formeDonnees(v[k], profondeur + 1); return out; }
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  return v;
}
async function testerCandidat(candidat, mot, tikhubKey) {
  const url = TIKHUB_BASE + candidat.chemin + '?' + new URLSearchParams(candidat.params(mot)).toString();
  const out = { nom: candidat.nom, chemin: candidat.chemin };
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tikhubKey } });
    out.statut = r.status;
    let data = null;
    try { data = await r.json(); } catch (e) { out.nonJson = true; }
    if (data) out.forme = formeDonnees(data, 0);
  } catch (e) { out.erreur = e.message; }
  return out;
}

export default async function handler(req, res) {
  const tikhubKey = (process.env.TIKHUB_API_KEY || '').trim();
  const elevenKey = (process.env.ELEVENLABS_API_KEY || '').trim();

  if (req.method === 'GET') {
    const mot = ((req.query && (req.query.mot || req.query.q)) || '').toString().trim();
    const debug = req.query && (req.query.debug || req.query.d);
    if (!debug || !mot) return res.status(400).json({ error: { message: 'Debug : /api/tendances?mot=NICHE&debug=1&code_acces=CODE' } });
    const droits = await resoudreDroits((req.query && req.query.code_acces) || '');
    if (!droits.isAdmin) return res.status(403).json({ error: { message: 'Réservé aux comptes admin' } });
    if (!tikhubKey) return res.status(200).json({ _debug: { tikhubKeyPresent: false, raison: 'TIKHUB_API_KEY absente côté serveur' } });
    const resultats = await Promise.all(CANDIDATS_RECHERCHE.map(c => testerCandidat(c, mot, tikhubKey)));
    return res.status(200).json({ _debug: { mot, tikhubKeyPresent: true, candidats: resultats } });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  if (!tikhubKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (TIKHUB_API_KEY)' } });

  try {
    const action = (req.body && req.body.action) || '';
    if (action === 'lancer') return await lancer(req, res, tikhubKey);
    if (action === 'avancer') return await avancer(req, res, tikhubKey, elevenKey);
    return res.status(400).json({ error: { message: 'action inconnue (attendu : "lancer" ou "avancer")' } });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

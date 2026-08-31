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
import { urlsVideo, telechargerMedia } from './_lib/tiktok-media.js';

const TIKHUB_BASE = 'https://api.tikhub.io';
const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const VIDEOS_CIBLE = 50;          // nombre de vidéos candidates visées
const FENETRE_JOURS = 90;         // fraîcheur, comme Vervox
const PAGES_MAX_RECHERCHE = 15;   // garde-fou anti-boucle infinie
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
      followerCount: typeof authorStats.followerCount === 'number' ? authorStats.followerCount : null
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

// Premier test réel en prod (16 vidéos trouvées sur 50 visées, seulement 2
// transcrites sur 16) : on garde désormais la raison précise de chaque échec
// (déjà fournie par telechargerMedia, jetée avant) dans `echecDetail`, pour
// diagnostiquer sur des données réelles plutôt que deviner un correctif.
async function transcrireVideo(v, elevenKey) {
  const raisons = [];
  for (const u of (v.urlsCandidates || [])) {
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
  // compte entier, honnête sur ce qui est réellement mesuré ici).
  const parAuteur = new Map();
  avecStats.forEach(v => {
    const a = v.auteur || {};
    const cle = a.uniqueId || a.id;
    if (!cle) return;
    if (!parAuteur.has(cle)) parAuteur.set(cle, { uniqueId: a.uniqueId, nickname: a.nickname, followerCount: a.followerCount, vuesCumulees: 0, nbVideos: 0 });
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

// ── action=lancer : cherche les vidéos candidates, crée le job ──
async function lancer(req, res, tikhubKey) {
  const { niche, code_acces } = req.body || {};
  if (!niche || typeof niche !== 'string' || !niche.trim()) {
    return res.status(400).json({ error: { message: 'Niche manquante' } });
  }
  const droits = await resoudreDroits(code_acces);
  if (!droits.ok) return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: 'ACCES_REFUSE' } });

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
  const collectees = new Map(); // id -> item allégé
  let cursor = 0, page = 0, hasMore = true;
  while (collectees.size < VIDEOS_CIBLE && hasMore && page < PAGES_MAX_RECHERCHE) {
    const lot = await rechercherVideos(niche.trim(), cursor, tikhubKey);
    page++;
    if (!lot) break;
    for (const item of lot.items) {
      if (collectees.size >= VIDEOS_CIBLE) break;
      if (!item || !item.id || collectees.has(item.id)) continue;
      if (item.createTime && item.createTime < seuilDate) continue;
      collectees.set(item.id, allegerItem(item));
    }
    hasMore = lot.hasMore;
    cursor = lot.cursor;
    if (cursor == null) break;
  }

  if (collectees.size < 5) {
    return res.status(200).json({ ok: false, raison: 'pas_assez_de_videos', trouvees: collectees.size });
  }

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
async function avancer(req, res, elevenKey) {
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
    await Promise.all(lot.map(v => transcrireVideo(v, elevenKey)));
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
    if (action === 'avancer') return await avancer(req, res, elevenKey);
    return res.status(400).json({ error: { message: 'action inconnue (attendu : "lancer" ou "avancer")' } });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

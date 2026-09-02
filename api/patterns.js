// ═══════════════════════════════════════════════════════════
//  /api/patterns, MÉMOIRE PARTAGÉE DES RECETTES VIRALES
//
//  Cerveau commun de Scriptura. Alimenté par le mode « Analyser une vidéo
//  virale » : quand une vidéo passe le GARDE-FOU (recette >= 90, sur son seul
//  contenu, plus aucun croisement avec les vraies stats de la vidéo), sa
//  recette DISTILLÉE et ANONYMISÉE est déposée ici, puis réutilisée pour
//  inspirer les générations (script/récit/idées) de tous les utilisateurs, la
//  niche demandée servie en priorité.
//
//  POST { niche, hook_technique, leviers, principes, squelette, signaux,
//         frameDisponible, langue }
//        -> écrit SI le garde-fou passe. Le score n'est PAS fourni par le
//        client (bug corrigé, retour terrain : l'ancien contrat acceptait un
//        `score` envoyé tel quel par le navigateur, le seuil était donc
//        "re-vérifié" sur un chiffre jamais recalculé, n'importe qui pouvait
//        empoisonner cette mémoire partagée avec {score:100} fabriqué). Le
//        score est maintenant RECALCULÉ ici, en code, à partir des signaux
//        bruts (mêmes SIGNAUX_VIRAL/DIMENSIONS_VIRAL/formule quadratique que
//        js/viral.js scoreViraliteRecette, dupliqués ici volontairement :
//        aucun module partagé entre le client et les fonctions serverless
//        dans ce projet). Non bloquant.
//  GET  ?niche=...&limit=8      -> { ok, patterns:[...] }, niche d'abord.
//
//  Stockage Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) : la table
//  n'accepte plus l'écriture directe du rôle anon (voir
//  supabase/patterns_viraux_rls.sql) pour qu'un appel direct à Supabase ne
//  puisse plus contourner le garde-fou vérifié ci-dessous. La lecture, elle,
//  reste publique (donnée anonymisée, faite pour inspirer tout le monde).
//  Si la clé service_role est absente, l'endpoint dégrade en silence
//  (ok:false), l'app n'est jamais bloquée.
// ═══════════════════════════════════════════════════════════

const SEUIL_MEMOIRE = 85;   // score de recette (pondéré) minimal pour entrer
const MAX_LIRE = 12;        // plafond dur de patterns renvoyés

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

// ── Recalcul du score, EN CODE, à partir des signaux bruts ──
// Port exact de scoreViraliteRecette (js/viral.js) : même liste de signaux,
// mêmes dimensions/poids, même formule quadratique (taux² × poids, pas
// linéaire). Dupliqué ici volontairement (pas de module partagé entre le
// client et les fonctions serverless dans ce projet), mais c'est la SEULE
// version qui compte pour la mémoire partagée : le score envoyé par le
// client, s'il en envoie un, est entièrement ignoré.
const SIGNAUX_VIRAL = ['hook_fort', 'boucle_ouverte', 'cliffhanger', 'deuxieme_personne', 'details_concrets', 'escalade', 'question_rhetorique', 'archetypes', 'appel_action', 'angle_original', 'sujet_precis', 'authenticite', 'hook_visuel', 'execution_visuelle'];
const SIGNAUX_VISUELS = ['hook_visuel', 'execution_visuelle'];
const DIMENSIONS_VIRAL = [
  { cle: 'accroche',    poids: 25, signaux: ['hook_fort', 'question_rhetorique', 'hook_visuel'] },
  { cle: 'sujet_angle', poids: 20, signaux: ['angle_original', 'sujet_precis'] },
  { cle: 'structure',   poids: 20, signaux: ['boucle_ouverte', 'cliffhanger', 'escalade', 'archetypes'] },
  { cle: 'sincerite',   poids: 20, signaux: ['details_concrets', 'authenticite', 'execution_visuelle'] },
  { cle: 'connexion',   poids: 15, signaux: ['deuxieme_personne', 'appel_action'] }
];
function calculerScoreRecette(signaux, frameDisponible) {
  if (!signaux || typeof signaux !== 'object') return 0;
  let global = 0;
  DIMENSIONS_VIRAL.forEach(d => {
    const signauxDim = frameDisponible ? d.signaux : d.signaux.filter(s => !SIGNAUX_VISUELS.includes(s));
    const presents = signauxDim.filter(k => signaux[k] === true).length;
    const taux = signauxDim.length ? presents / signauxDim.length : 0;
    global += Math.round(taux * taux * d.poids);
  });
  return global;
}

// Le garde-fou : recette forte (>= seuil), sur son seul contenu. Le
// croisement avec les vraies stats de la vidéo (portée, engagement) a été
// retiré de l'analyse (refonte demandée par le propriétaire, alignée sur la
// méthode Vervox/BeViral : le score juge le contenu, jamais son résultat).
function passeGardeFou(score) {
  return Number(score) >= SEUIL_MEMOIRE;
}

// Nettoie/borne un tableau d'objets distillés avant stockage (défense contre un
// client qui enverrait n'importe quoi, et pour garder la table légère).
function bornerTableau(arr, max, mapper) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).map(mapper).filter(Boolean);
}
function texteCourt(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }

async function ecrire(cfg, body) {
  // Score recalculé ICI à partir des signaux bruts, jamais celui (le cas
  // échéant) envoyé par le client : voir calculerScoreRecette ci-dessus.
  const score = calculerScoreRecette(body.signaux, !!body.frameDisponible);
  if (!passeGardeFou(score)) return { ok: false, raison: 'sous_seuil' };

  // On ne garde QUE du distillé : pas de transcript, pas de pseudo, pas de
  // verbatim de hook (seulement la technique).
  const ligne = {
    niche: texteCourt(body.niche, 60) || null,
    hook_technique: texteCourt(body.hook_technique, 120) || null,
    leviers: bornerTableau(body.leviers, 12, x => texteCourt(x, 40)),
    principes: bornerTableau(body.principes, 6, o => {
      const titre = texteCourt(o && o.titre, 120), detail = texteCourt(o && o.detail, 240);
      return titre || detail ? { titre, detail } : null;
    }),
    squelette: bornerTableau(body.squelette, 8, o => {
      const temps = texteCourt(o && o.temps, 40), titre = texteCourt(o && o.titre, 120);
      return temps || titre ? { temps, titre } : null;
    }),
    score: Math.round(score),
    langue: texteCourt(body.langue, 12) || null
  };

  const r = await fetch(cfg.url + '/rest/v1/patterns_viraux', {
    method: 'POST',
    headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
    body: JSON.stringify(ligne)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return { ok: false, raison: 'ecriture_echec', detail: txt.slice(0, 200) };
  }
  return { ok: true };
}

async function lire(cfg, niche, limit) {
  const n = Math.max(1, Math.min(MAX_LIRE, Number(limit) || 8));
  const champs = 'niche,hook_technique,leviers,principes,squelette,score';
  const base = cfg.url + '/rest/v1/patterns_viraux?select=' + encodeURIComponent(champs);
  const req = (q) => fetch(base + q, { headers: entetes(cfg.key) }).then(r => r.ok ? r.json() : []);

  let patterns = [];
  const nicheNette = typeof niche === 'string' ? niche.trim() : '';
  // Niche d'abord : on sert en priorité les recettes de la même famille.
  if (nicheNette) {
    patterns = await req('&niche=ilike.' + encodeURIComponent('%' + nicheNette + '%') +
      '&order=cree_le.desc&limit=' + n);
  }
  // Compléter avec les plus récentes toutes niches confondues (leviers
  // universels) sans dépasser le plafond ni dupliquer.
  if (patterns.length < n) {
    const reste = await req('&order=cree_le.desc&limit=' + (n * 2));
    const vus = new Set(patterns.map(p => JSON.stringify(p)));
    for (const p of reste) {
      if (patterns.length >= n) break;
      const cle = JSON.stringify(p);
      if (!vus.has(cle)) { vus.add(cle); patterns.push(p); }
    }
  }
  return { ok: true, patterns: patterns.slice(0, n) };
}

export default async function handler(req, res) {
  const cfg = config();
  // Pas de Supabase configuré : dégradation silencieuse, jamais d'erreur dure.
  if (!cfg) return res.status(200).json({ ok: false, raison: 'non_configure', patterns: [] });

  try {
    if (req.method === 'GET') {
      const niche = req.query && (req.query.niche || req.query.n);
      const limit = req.query && req.query.limit;
      const out = await lire(cfg, niche, limit);
      return res.status(200).json(out);
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      const out = await ecrire(cfg, body);
      return res.status(200).json(out);
    }
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  } catch (e) {
    // Non bloquant : une panne de la mémoire ne doit jamais casser l'app.
    return res.status(200).json({ ok: false, raison: 'erreur', patterns: [] });
  }
}

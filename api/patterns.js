// ═══════════════════════════════════════════════════════════
//  /api/patterns, MÉMOIRE PARTAGÉE DES RECETTES VIRALES
//
//  Cerveau commun de Scriptura. Alimenté par le mode « Analyser une vidéo
//  virale » : quand une vidéo passe le GARDE-FOU (recette >= 90 ET performance
//  réelle forte), sa recette DISTILLÉE et ANONYMISÉE est déposée ici, puis
//  réutilisée pour inspirer les générations (script/récit/idées) de tous les
//  utilisateurs, la niche demandée servie en priorité.
//
//  POST { niche, hook_technique, leviers, principes, squelette, score, portee,
//         engagement, langue }  -> écrit SI le garde-fou passe (re-vérifié ici,
//         jamais faire confiance au client). Non bloquant.
//  GET  ?niche=...&limit=8      -> { ok, patterns:[...] }, niche d'abord.
//
//  Stockage Supabase (SUPABASE_URL / SUPABASE_ANON_KEY, déjà côté serveur).
//  Table : voir supabase/patterns_viraux.sql. Si absente/non configurée,
//  l'endpoint dégrade en silence (ok:false), l'app n'est jamais bloquée.
// ═══════════════════════════════════════════════════════════

const SEUIL_MEMOIRE = 85;   // score de recette (pondéré) minimal pour entrer
const MAX_LIRE = 12;        // plafond dur de patterns renvoyés

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

// Le garde-fou : recette forte (>= seuil) ET performance réelle. La perf est
// réelle si la portée dépasse largement l'audience (>= 5x) ou, à défaut de
// connaître les abonnés, si l'engagement est exceptionnel (>= 10%).
function passeGardeFou(score, portee, engagement) {
  if (!(Number(score) >= SEUIL_MEMOIRE)) return false;
  const p = Number(portee), e = Number(engagement);
  const porteeForte = Number.isFinite(p) && p >= 5;
  const engagementFort = Number.isFinite(e) && e >= 10;
  return porteeForte || engagementFort;
}

// Nettoie/borne un tableau d'objets distillés avant stockage (défense contre un
// client qui enverrait n'importe quoi, et pour garder la table légère).
function bornerTableau(arr, max, mapper) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).map(mapper).filter(Boolean);
}
function texteCourt(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }

async function ecrire(cfg, body) {
  const score = Number(body.score);
  const portee = body.portee == null ? null : Number(body.portee);
  const engagement = body.engagement == null ? null : Number(body.engagement);
  if (!passeGardeFou(score, portee, engagement)) return { ok: false, raison: 'sous_seuil' };

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
    portee: Number.isFinite(portee) ? Math.round(portee * 10) / 10 : null,
    engagement: Number.isFinite(engagement) ? Math.round(engagement * 10) / 10 : null,
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

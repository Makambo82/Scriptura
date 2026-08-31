// ═══════════════════════════════════════════════════════════
//  /api/tendances, Analyse de tendances TikTok par niche (mode "Tendances")
//
//  Inspiré de Vervox : scanner ~50 vidéos qui cartonnent dans une niche
//  (recherche par mot-clé/niche, pas un compte précis), en tirer un
//  benchmark (vues/likes médians, engagement, momentum), un classement des
//  créateurs, le registre de langage et les patterns de rétention observés.
//
//  ÉTAPE 1 EN COURS (ce fichier) : avant de construire le pipeline complet,
//  on vérifie la forme réelle de l'endpoint TikHub de recherche par
//  mot-clé, jamais utilisé ailleurs dans Scriptura (seuls fetch_user_profile
//  et fetch_user_post le sont, tous deux scopés à UN compte connu). Le
//  bac à sable de développement bloque tikhub.io au niveau réseau, impossible
//  de vérifier autrement qu'en prod, avec la vraie clé.
//
//  ?debug=1&mot=NICHE&code_acces=CODE (GET, admin uniquement, déclenche de
//  vrais appels payés) : teste plusieurs endpoints TikHub candidats pour la
//  recherche par mot-clé et renvoie leurs réponses brutes (statut + extrait),
//  pour confirmer lequel fonctionne avant d'écrire le pipeline dessus.
// ═══════════════════════════════════════════════════════════

import { resoudreDroits } from './_lib/acces.js';

const TIKHUB_BASE = 'https://api.tikhub.io';

// 2e tour de sonde (confirmé en prod) : fetch_general_search répond 200 et
// renvoie de vraies vidéos (id, desc, createTime, author, stats, authorStats,
// video, music, challenges) avec pagination (cursor/has_more). C'est
// l'endpoint retenu pour le pipeline, fetch_search_video reste cassé (400)
// et n'est plus nécessaire, retiré. Ce 3e tour se contente d'approfondir la
// forme (le tour précédent s'arrêtait à une profondeur trop faible et
// affichait "object" pour video/author/stats, exactement les champs dont le
// pipeline a besoin : l'URL de téléchargement, l'identité du créateur, les
// compteurs vues/likes/commentaires/partages).
const CANDIDATS_RECHERCHE = [
  { nom: 'fetch_general_search', chemin: '/api/v1/tiktok/web/fetch_general_search', params: (mot) => ({ keyword: mot, count: 10 }) }
];

// Résume récursivement la FORME des données (clés, type, longueur des
// tableaux, clés du 1er élément si tableau d'objets) sans jamais renvoyer le
// contenu complet : assez pour comprendre où sont les vidéos et leurs champs,
// sans gonfler la réponse ni exposer des données brutes inutilement.
function formeDonnees(v, profondeur) {
  if (profondeur > 9 || v == null) return v === null ? null : typeof v;
  if (Array.isArray(v)) {
    return { type: 'array', longueur: v.length, premierElement: v.length ? formeDonnees(v[0], profondeur + 1) : null };
  }
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = formeDonnees(v[k], profondeur + 1);
    return out;
  }
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

  return res.status(501).json({ error: { message: "Pipeline pas encore implémenté, seul le debug (GET ?debug=1) existe pour l'instant." } });
}

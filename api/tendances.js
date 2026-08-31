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

// Candidats plausibles (convention /api/v1/tiktok/web/... déjà utilisée par
// fetch_user_profile et fetch_user_post ailleurs dans Scriptura), à confirmer
// avec la vraie clé : aucun n'a pu être vérifié depuis cet environnement de
// développement (réseau bloqué vers tikhub.io).
const CANDIDATS_RECHERCHE = [
  { nom: 'fetch_search_video', chemin: '/api/v1/tiktok/web/fetch_search_video', params: (mot) => ({ keyword: mot, count: 5 }) },
  { nom: 'fetch_general_search', chemin: '/api/v1/tiktok/web/fetch_general_search', params: (mot) => ({ keyword: mot, count: 5 }) },
  { nom: 'fetch_challenge_video', chemin: '/api/v1/tiktok/web/fetch_challenge_video', params: (mot) => ({ challengeName: mot, count: 5 }) },
  { nom: 'fetch_hashtag_detail', chemin: '/api/v1/tiktok/web/fetch_hashtag_detail', params: (mot) => ({ challengeName: mot }) }
];

async function testerCandidat(candidat, mot, tikhubKey) {
  const url = TIKHUB_BASE + candidat.chemin + '?' + new URLSearchParams(candidat.params(mot)).toString();
  const out = { nom: candidat.nom, chemin: candidat.chemin };
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tikhubKey } });
    out.statut = r.status;
    let data = null;
    try { data = await r.json(); } catch (e) { out.nonJson = true; }
    if (data) out.extrait = JSON.stringify(data).slice(0, 600);
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

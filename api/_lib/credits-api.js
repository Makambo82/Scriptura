// ═══════════════════════════════════════════════════════════════════════
//  CRÉDITS API : ce que le Tableau de bord affiche (carte « Crédits API »)
//
//  Appelé par api/data.js (resource admin-stats, fondateur uniquement, droits
//  déjà vérifiés par l'appelant) : aucune fonction Vercel de plus, le plan
//  gratuit est à 12 sur 12.
//
//  Deux natures de chiffres, JAMAIS mélangées à l'écran :
//    * RÉEL      : ElevenLabs et TikHub exposent leur solde, on le lit.
//    * ESTIMÉ    : Anthropic et Together n'ont aucun point d'accès pour le
//                  solde. Solde saisi par le propriétaire à chaque recharge,
//                  moins la dépense mesurée par l'app depuis (voir depenses.js).
//
//  Les appels externes (ElevenLabs, TikHub) sont mis en cache 5 minutes : un
//  fondateur qui ouvre le tableau de bord dix fois d'affilée ne doit pas
//  dépenser dix appels, ni ralentir son écran.
// ═══════════════════════════════════════════════════════════════════════

import {
  depenseAnthropicCentimes, depenseTogetherCentimes, estimerSolde, PRIX_TOGETHER_DEFAUT_USD
} from './depenses.js';

const DUREE_CACHE_MS = 5 * 60 * 1000;
const DELAI_FOURNISSEUR_MS = 8000;
const SEUILS_TIKHUB_USD = { bas: 1, critique: 0.25 }; // ~1 000 requêtes à 0,001 $
let _cache = null;

const FOURNISSEURS_ESTIMES = ['anthropic', 'together'];

const entetes = (key) => ({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' });

async function lireLignes(cfg, motif, limite) {
  try {
    const r = await fetch(cfg.url + '/rest/v1/usage_serveur?select=ref,used,maj_le&ref=like.' + encodeURIComponent(motif) + '&limit=' + limite,
      { headers: entetes(cfg.key) });
    const rows = await r.json().catch(() => []);
    return r.ok && Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

async function ecrireLigne(cfg, ref, used) {
  const r = await fetch(cfg.url + '/rest/v1/usage_serveur?on_conflict=ref', {
    method: 'POST',
    headers: { ...entetes(cfg.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ref, used, maj_le: new Date().toISOString() })
  });
  if (!r.ok) throw new Error('écriture refusée (' + r.status + ')');
}

async function appelExterne(url, entetesExt) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_FOURNISSEUR_MS);
  try {
    const r = await fetch(url, { headers: entetesExt, signal: ctrl.signal });
    const texte = await r.text();
    let data = null; try { data = JSON.parse(texte); } catch (e) {}
    return { ok: r.ok, status: r.status, data, texte };
  } finally { clearTimeout(minuteur); }
}

const niveauParPart = (part) => part <= 0 ? 'epuise' : part <= 0.1 ? 'critique' : part <= 0.2 ? 'bas' : 'ok';

// ── ElevenLabs : point d'accès documenté (GET /v1/user/subscription) ──
async function lireElevenLabs() {
  const key = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) return { mode: 'reel', disponible: false, raison: 'cle_absente' };
  try {
    const { ok, status, data, texte } = await appelExterne('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': key });
    if (!ok || !data) {
      // Une clé ElevenLabs peut être restreinte : sans le droit « User : lecture »,
      // elle sert à générer des voix mais pas à lire son propre solde.
      const detail = String((data && (data.detail && (data.detail.message || data.detail.status) || data.message)) || texte || '').slice(0, 160);
      return { mode: 'reel', disponible: false, raison: status === 401 || status === 403 ? 'droit_lecture' : 'http_' + status, detail };
    }
    const utilises = Number(data.character_count), limite = Number(data.character_limit);
    if (!Number.isFinite(utilises) || !Number.isFinite(limite) || limite <= 0) {
      return { mode: 'reel', disponible: false, raison: 'format_inconnu', detail: Object.keys(data).slice(0, 12).join(', ') };
    }
    const restants = Math.max(0, limite - utilises);
    return {
      mode: 'reel', disponible: true, utilises, limite, restants,
      pourcentRestant: Math.round((restants / limite) * 100),
      remiseAZeroUnix: Number(data.next_character_count_reset_unix) || null,
      palier: typeof data.tier === 'string' ? data.tier : null,
      niveau: niveauParPart(restants / limite)
    };
  } catch (e) {
    return { mode: 'reel', disponible: false, raison: 'injoignable', detail: String(e && e.message || '').slice(0, 120) };
  }
}

// ── TikHub : point d'accès « infos du compte », NON confirmé par la doc
// officielle (introuvable depuis ici). On lit donc la réponse défensivement et
// on renvoie les champs utiles tels quels : la première ouverture du tableau
// de bord montrera ce que TikHub répond vraiment. ──
const RE_CHAMP_UTILE = /balance|credit|usage|quota|limit|plan|level|rate|expire|free/i;
const RE_CHAMP_SECRET = /key|token|secret|password|email|mail|phone|ip$/i;

function aplatir(obj, chemin, sortie, profondeur) {
  if (sortie.length >= 14 || profondeur > 4 || obj === null || obj === undefined) return;
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (RE_CHAMP_SECRET.test(k)) continue;
      aplatir(v, chemin ? chemin + '.' + k : k, sortie, profondeur + 1);
    }
    return;
  }
  const dernier = String(chemin).split('.').pop();
  if (RE_CHAMP_UTILE.test(dernier) && (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean')) {
    sortie.push({ cle: chemin, valeur: typeof obj === 'string' ? obj.slice(0, 60) : obj });
  }
}

async function lireTikHub() {
  const key = (process.env.TIKHUB_API_KEY || '').trim();
  if (!key) return { mode: 'reel', disponible: false, raison: 'cle_absente' };
  try {
    const { ok, status, data, texte } = await appelExterne('https://api.tikhub.io/api/v1/tikhub/user/get_user_info', { Authorization: 'Bearer ' + key });
    if (!ok || !data) {
      return { mode: 'reel', disponible: false, raison: 'http_' + status, detail: String(texte || '').replace(/\s+/g, ' ').slice(0, 160) };
    }
    const champs = [];
    aplatir(data, '', champs, 0);
    const solde = champs.find(c => /(^|\.)balance$/i.test(c.cle) && Number.isFinite(Number(c.valeur)));
    if (!solde) return { mode: 'reel', disponible: false, raison: 'format_inconnu', champs };
    const usd = Number(solde.valeur);
    return {
      mode: 'reel', disponible: true, soldeUsd: usd, champs,
      niveau: usd <= 0 ? 'epuise' : usd < SEUILS_TIKHUB_USD.critique ? 'critique' : usd < SEUILS_TIKHUB_USD.bas ? 'bas' : 'ok'
    };
  } catch (e) {
    return { mode: 'reel', disponible: false, raison: 'injoignable', detail: String(e && e.message || '').slice(0, 120) };
  }
}

async function soldesReels(forcer) {
  if (!forcer && _cache && Date.now() - _cache.t < DUREE_CACHE_MS) return _cache;
  const [elevenlabs, tikhub] = await Promise.all([lireElevenLabs(), lireTikHub()]);
  _cache = { t: Date.now(), elevenlabs, tikhub };
  return _cache;
}

function indexer(lignes) {
  const m = {};
  for (const l of lignes) m[l.ref] = l;
  return m;
}

function pireNiveau(niveaux) {
  const ordre = ['ok', 'bas', 'critique', 'epuise'];
  return niveaux.filter(Boolean).reduce((p, n) => ordre.indexOf(n) > ordre.indexOf(p) ? n : p, 'ok');
}

async function creditsApiEtat(cfg, { actualiser } = {}) {
  const [depenses, reglages, reels] = await Promise.all([
    lireLignes(cfg, 'depense_%', 1000),
    lireLignes(cfg, 'credits_%', 200),
    soldesReels(!!actualiser)
  ]);
  const idx = indexer(reglages);
  const prixTogether = {
    image: idx.credits_prix_together_image ? idx.credits_prix_together_image.used / 1e6 : PRIX_TOGETHER_DEFAUT_USD.image,
    video: idx.credits_prix_together_video ? idx.credits_prix_together_video.used / 1e6 : PRIX_TOGETHER_DEFAUT_USD.video
  };
  const depenseTotale = {
    anthropic: depenseAnthropicCentimes(depenses),
    together: depenseTogetherCentimes(depenses, prixTogether)
  };
  const compteTogether = depenses.reduce((acc, l) => {
    const m = /^depense_together_(image|video)_\d{4}-\d{2}$/.exec(String(l.ref || ''));
    if (m && l.used > 0) acc[m[1]] += l.used;
    return acc;
  }, { image: 0, video: 0 });

  const estime = (f) => {
    const solde = idx['credits_solde_' + f], base = idx['credits_base_' + f];
    const saisie = solde ? { soldeUsd: solde.used / 100, le: solde.maj_le } : null;
    const estimation = solde ? estimerSolde({
      soldeSaisiCentimes: solde.used,
      baseCentimes: base ? base.used : 0,
      depenseTotaleCentimes: depenseTotale[f],
      saisiLe: solde.maj_le
    }) : null;
    return { mode: 'estime', saisie, estimation, depenseMesureeCentimes: depenseTotale[f], niveau: estimation ? estimation.niveau : null };
  };
  const anthropic = estime('anthropic');
  const together = { ...estime('together'), prixUsd: prixTogether, compte: compteTogether };

  return {
    ok: true,
    actualiseLe: new Date(reels.t).toISOString(),
    fournisseurs: { elevenlabs: reels.elevenlabs, tikhub: reels.tikhub, anthropic, together },
    niveau: pireNiveau([reels.elevenlabs.niveau, reels.tikhub.niveau, anthropic.niveau, together.niveau])
  };
}

// Le propriétaire vient de recharger (ou de relire sa console) : on fixe son
// solde ET la dépense mesurée À CET INSTANT. L'estimation ne compte ensuite
// que ce qui se dépense APRÈS la saisie, sans double compte avec ce qui avait
// déjà été mesuré avant.
async function creditsApiSaisie(cfg, body) {
  const f = String(body && body.fournisseur || '');
  if (!FOURNISSEURS_ESTIMES.includes(f)) return { status: 400, error: 'Fournisseur inconnu.' };
  const solde = Number(body.soldeUsd);
  if (!Number.isFinite(solde) || solde < 0 || solde > 1000000) return { status: 400, error: 'Solde invalide (nombre de dollars, 0 ou plus).' };

  const prixDemandes = {};
  if (f === 'together') {
    for (const t of ['image', 'video']) {
      const v = body['prix' + (t === 'image' ? 'Image' : 'Video') + 'Usd'];
      if (v === undefined || v === null || v === '') continue;
      const p = Number(v);
      if (!Number.isFinite(p) || p < 0 || p > 100) return { status: 400, error: 'Prix unitaire invalide (en dollars, entre 0 et 100).' };
      prixDemandes[t] = p;
    }
  }
  try {
    // Les prix d'abord : la base de dépense doit être valorisée avec eux.
    for (const [t, p] of Object.entries(prixDemandes)) await ecrireLigne(cfg, 'credits_prix_together_' + t, Math.round(p * 1e6));
    const [depenses, reglages] = await Promise.all([lireLignes(cfg, 'depense_%', 1000), lireLignes(cfg, 'credits_prix_together_%', 10)]);
    const idx = indexer(reglages);
    const prix = {
      image: idx.credits_prix_together_image ? idx.credits_prix_together_image.used / 1e6 : PRIX_TOGETHER_DEFAUT_USD.image,
      video: idx.credits_prix_together_video ? idx.credits_prix_together_video.used / 1e6 : PRIX_TOGETHER_DEFAUT_USD.video
    };
    const base = f === 'anthropic' ? depenseAnthropicCentimes(depenses) : depenseTogetherCentimes(depenses, prix);
    await ecrireLigne(cfg, 'credits_base_' + f, base);
    await ecrireLigne(cfg, 'credits_solde_' + f, Math.round(solde * 100));
    return { status: 200 };
  } catch (e) {
    return { status: 502, error: 'Enregistrement impossible : ' + (e && e.message || 'inconnue') };
  }
}

function viderCache() { _cache = null; }

export { creditsApiEtat, creditsApiSaisie, viderCache as _viderCacheCredits };

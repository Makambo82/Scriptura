// ═══════════════════════════════════════════════════════════
//  SUPABASE — Sauvegarde permanente des générations
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  MODÈLES IA — Haiku partout (rapide et fiable)
//  Pour tester un autre modèle plus tard, modifie juste ces 2 lignes.
// ═══════════════════════════════════════════════════════════
const MODEL_CREATIF = "claude-haiku-4-5-20251001";    // Haiku partout (rapide et fiable)
const MODEL_RAPIDE  = "claude-haiku-4-5-20251001";    // Directeur, idées, storyboards (vitesse)
const MODEL_AUDIT   = "claude-sonnet-4-6";            // Sonnet pour l'audit : tâche complexe, qualité premium

// false = moteur allégé et rapide (2 agents). true = moteur complet (4 agents,
// avec critique sévère + réécriture ciblée + contrôle anti-générique, voir
// generate() dans js/generation.js). Activé : la qualité prime sur la
// vitesse — chaque script passe par un vrai contrôle avant d'être livré.
const CRITIQUE_ACTIVE = true;
// ── Limites journalières par plan ──
// La création (idées, script, storytelling) et l'audit ont des compteurs
// séparés : un audit ne consomme pas le quota de création et inversement.
// Ces limites sont indicatives côté client (anti-abus), la vérité reste
// le comptage Supabase par type.
const LIMITES_MOIS = {
  creator: { creation: 50, audit: 0 },
  pro:     { creation: 70, audit: 5 }
};
// Repli si le plan n'est pas reconnu : on applique le moins-disant (Creator).
function limitesDuPalier() {
  return LIMITES_MOIS[monPalier()] || LIMITES_MOIS.creator;
}

// ── Paliers d'abonnement ──
// Creator : tous les modes de création. Pro : Creator + Analyse compte TikTok.
// Le palier est lu dans la colonne "plan" de la table Supabase "abonnes".
// PLAN_PAR_DEFAUT s'applique quand la colonne est absente ou vide : le temps
// de renseigner les abonnés existants, le mettre sur 'pro' évite de leur
// couper l'accès ; le repasser sur 'creator' une fois la migration faite.
const PLAN_PAR_DEFAUT = 'creator';
const MODES_PRO = ['audit', 'serie'];
const CODES_ILLIMITES = ["SCRIPTURA-CELINE"];   // Codes exemptés de la limite journalière (VIP/admin)

// ═══════════════════════════════════════════════════════════
//  APPEL IA AVEC REPRISE AUTOMATIQUE
//  Retente jusqu'à 3 fois si le modèle est surchargé (529) ou
//  si la réponse est vide/coupée. Attente croissante entre essais.
// ═══════════════════════════════════════════════════════════
async function callAI(model, maxTokens, prompt, maxRetries) {
  // Fait UN appel au modèle donné. Retourne le texte, ou null si échec récupérable.
  async function tryOnce(useModel) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: useModel,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
        code_acces: localStorage.getItem('scriptura_code') || null
      })
    });
    // Abonnement expiré/désactivé refusé par le serveur
    if (res.status === 403) {
      if (typeof gererAbonnementExpire === 'function') gererAbonnementExpire();
      return { ok: false, recoverable: false, detail: 'accès refusé' };
    }
    // Surcharge / erreur serveur temporaire → échec récupérable (on renvoie null)
    if (res.status === 529 || res.status === 503 || res.status === 500 || res.status === 429) {
      return { ok: false, recoverable: true, detail: '(' + res.status + ') serveur occupé' };
    }
    const data = await res.json();
    if (!res.ok) {
      const detail = data.error?.message || data.message || JSON.stringify(data).slice(0, 150);
      return { ok: false, recoverable: false, detail: '(' + res.status + ') ' + detail };
    }
    const raw = data.content?.map(b => b.text || '').join('') || '';
    if (!raw.trim()) return { ok: false, recoverable: true, detail: 'réponse vide' };
    return { ok: true, raw: raw };
  }

  // Modèle de secours : si on demandait Sonnet, on retombe sur Haiku (stable).
  const fallbackModel = MODEL_RAPIDE;
  const usesFallback = (model === MODEL_CREATIF); // on ne bascule que si on visait Sonnet

  let lastDetail = '';

  // Tentative 1 — modèle demandé (ex: Sonnet)
  try {
    const r1 = await tryOnce(model);
    if (r1.ok) return r1.raw;
    lastDetail = r1.detail;
    if (!r1.recoverable && !usesFallback) throw new Error(lastDetail);
  } catch(e) { lastDetail = e.message; }

  // Petite pause puis Tentative 2 — même modèle
  await new Promise(r => setTimeout(r, 1500));
  try {
    const r2 = await tryOnce(model);
    if (r2.ok) return r2.raw;
    lastDetail = r2.detail;
  } catch(e) { lastDetail = e.message; }

  // Tentative 3 — bascule automatique sur Haiku (si on visait Sonnet)
  if (usesFallback) {
    try {
      const r3 = await tryOnce(fallbackModel);
      if (r3.ok) return r3.raw;
      lastDetail = r3.detail;
    } catch(e) { lastDetail = e.message; }
  }

  throw new Error(lastDetail || 'Service momentanément indisponible, réessaie');
}


const SUPABASE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PqRwwhtRedPMvETLCp562g_7HKFsjLl';
let supabaseClient = null;
try {
  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch(e) { console.warn('Supabase non initialisé', e); }

// Récupère un identifiant pour l'utilisateur : son code d'accès s'il en a un,
// sinon un identifiant anonyme stable stocké dans le navigateur.
function getUserRef() {
  const code = localStorage.getItem('scriptura_code');
  if (code) return code;
  let anon = localStorage.getItem('scriptura_anon_id');
  if (!anon) {
    anon = 'anon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('scriptura_anon_id', anon);
  }
  return anon;
}

// ═══════════════════════════════════════════════════════════
//  ANTI-CONTOURNEMENT — empreinte d'appareil + IP (via Supabase)
// ═══════════════════════════════════════════════════════════
// Objectif : le quota gratuit ne se réinitialise PAS quand on vide le cache.
// On calcule une empreinte stable de l'appareil (indépendante du localStorage)
// et on stocke le vrai quota dans Supabase, lié à cette empreinte + à l'IP.

// Calcule une empreinte stable du navigateur/appareil (ne dépend pas du cache)
async function getDeviceFingerprint() {
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    (navigator.languages || []).join(','),
    screen.width + 'x' + screen.height,
    screen.colorDepth || '',
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory || '',
    navigator.platform || '',
    navigator.maxTouchPoints || ''
  ];
  // Empreinte canvas (rendu graphique propre à chaque appareil)
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Scriptura🎬', 2, 15);
    parts.push(canvas.toDataURL().slice(-50));
  } catch(e) { /* ignore */ }

  const str = parts.join('|');
  // Hash simple (djb2) → chaîne courte et stable
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return 'fp_' + hash.toString(36);
}

// Récupère l'IP publique de l'utilisateur (service gratuit)
async function getUserIP() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    const j = await r.json();
    return j.ip || null;
  } catch(e) { return null; }
}

// Empreinte mémorisée pour la session
let _deviceFp = null;
let _userIP = null;
async function ensureDeviceIds() {
  if (!_deviceFp) _deviceFp = await getDeviceFingerprint();
  if (!_userIP) _userIP = await getUserIP();
  return { fp: _deviceFp, ip: _userIP };
}

// Récupère le quota réel depuis Supabase (le max entre empreinte et IP).
// Renvoie le nombre de générations déjà utilisées selon le serveur.
async function fetchServerQuota() {
  if (!supabaseClient) return null; // pas de Supabase → on garde le localStorage
  try {
    const { fp, ip } = await ensureDeviceIds();
    const refs = [fp];
    if (ip) refs.push('ip_' + ip);
    // Chercher les lignes correspondant à l'empreinte OU l'IP
    const { data, error } = await supabaseClient
      .from('quotas')
      .select('ref, used')
      .in('ref', refs);
    if (error) throw error;
    if (!data || !data.length) return 0;
    // On prend le maximum (le plus contraignant)
    return Math.max(...data.map(r => r.used || 0));
  } catch(e) {
    console.warn('fetchServerQuota échec', e);
    return null;
  }
}

// Enregistre/incrémente le quota côté serveur (empreinte ET IP)
async function bumpServerQuota(newValue) {
  if (!supabaseClient) return;
  try {
    const { fp, ip } = await ensureDeviceIds();
    const rows = [{ ref: fp, used: newValue, maj_le: new Date().toISOString() }];
    if (ip) rows.push({ ref: 'ip_' + ip, used: newValue, maj_le: new Date().toISOString() });
    // upsert : crée ou met à jour selon la clé 'ref'
    await supabaseClient.from('quotas').upsert(rows, { onConflict: 'ref' });
  } catch(e) { console.warn('bumpServerQuota échec', e); }
}

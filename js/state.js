// ── STATE ──
let selectedTone = '';
// plateforme par défaut TikTok : l'étape 2 propose désormais la plateforme
// pré-remplie sous forme de menu repliable (voir choisirPlateforme,
// js/generation.js), plus besoin d'un écran dédié pour la choisir.
const state = { objectif:'', depart:'', plateforme:'TikTok' };

// Contexte de la dernière génération (pour l'ajustement du script)
let lastGenContext = null;
let currentScript = null;
let currentHooks = null;
let lastStoryContext = null;

// ══════════════════════════════════════
//  NAVIGATION ENTRE MODES
// ══════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  MODE AUDIT TIKTOK, gestion des captures
// ═══════════════════════════════════════════════════════════

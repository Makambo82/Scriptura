// ── STATE ──
let selectedTone = '';
const state = { objectif:'', depart:'', plateforme:'' };

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

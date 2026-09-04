// ── STATE ──
let selectedTone = '';
// TIKTOK, ET RIEN D'AUTRE (décision du propriétaire) : le sélecteur de
// plateforme a été retiré de tous les modes, Scriptura est exclusivement
// orienté TikTok. Le champ est CONSERVÉ dans l'état plutôt que supprimé :
// il est lu par les prompts, le résumé d'étape et l'historique, et il
// documente à chaque lecture qu'il s'agit d'une décision produit assumée,
// pas d'une valeur oubliée. Voir PLATEFORME_SCRIPTURA (js/generation.js).
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

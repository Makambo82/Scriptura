// Sauvegarde une génération dans Supabase (silencieux, ne bloque jamais l'app)
let currentGenId = null; // id de la génération en cours (pour y rattacher le storyboard)

// Icône marque-page (favori), trait fin doré, style du logo. Contour quand ce
// n'est pas un favori, rempli en or quand ça l'est (classe .actif, voir CSS).
const ICON_FAV = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17.06a.6.6 0 0 1-.94.5L12 17.8l-6.06 3.76A.6.6 0 0 1 5 21.06V4a1 1 0 0 1 1-1z"/></svg>';
// Icône corbeille (supprimer), même trait fin doré.
const ICON_DELETE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
// Loupe (recherche) et curseurs (filtre par type), style trait, couleur héritée.
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><line x1="15.6" y1="15.6" x2="21" y2="21"/></svg>';
const ICON_FILTER = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6.2 7.4V19l-3.6 1.8v-8.4L4 5Z"/></svg>';

// Icônes de mode (trait fin doré, mêmes visuels que les cartes d'accueil).
// Définies ici en dur car historique.js est chargé avant ui.js (où vit ICO()) :
// ces libellés sont construits au chargement, ICO() n'existerait pas encore.
const _icoMode = (p) => '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const ICO_MODE = {
  audit:          _icoMode('<path d="M4 19h16"/><rect x="5.5" y="14" width="3" height="5" rx=".6"/><rect x="10.5" y="10" width="3" height="9" rx=".6"/><rect x="15.5" y="6" width="3" height="13" rx=".6"/>'),
  serie:          _icoMode('<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M8 6v12"/><path d="M16 6v12"/>'),
  ideas:          _icoMode('<path d="M9.5 18.5h5"/><path d="M10.5 21h3"/><path d="M12 3.5c-3.6 0-6 2.7-5.4 6.1.3 1.7 1.4 2.9 2.4 3.9.6.6.9 1.2 1 2h4c.1-.8.4-1.4 1-2 1-1 2.1-2.2 2.4-3.9C18 6.2 15.6 3.5 12 3.5Z"/>'),
  script:         _icoMode('<path d="M7 3.5h6.5L18 8v11.5A1 1 0 0 1 17 20.5H7A1 1 0 0 1 6 19.5v-15A1 1 0 0 1 7 3.5Z"/><path d="M13.5 3.5V8H18"/><path d="M9 12h6"/><path d="M9 15h6"/><path d="M9 18h4"/>'),
  story:          _icoMode('<path d="M4 20s1-4 3-6l9-9 3 3-9 9c-2 2-6 3-6 3Z"/><path d="M13.5 6.5l3 3"/><path d="M4.5 19.5l3-1.2"/>'),
  storyboardSeul: _icoMode('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 12h17"/><path d="M12 5v14"/>')
};

// Types disponibles pour le filtre "par mode" (menu ouvert par l'icône curseurs).
const HIST_MODES_FILTRE = [
  { v: null,     label: 'Tous' },
  { v: 'audit',  label: ICO_MODE.audit + ' Diagnostic' },
  { v: 'diagnosticSommaire', label: '@ Diagnostic sommaire' },
  { v: 'serie',  label: ICO_MODE.serie + ' Série' },
  { v: 'ideas',  label: ICO_MODE.ideas + ' Idées' },
  { v: 'script', label: ICO_MODE.script + ' Script' },
  { v: 'story',  label: ICO_MODE.story + ' Récit' },
  { v: 'storyboardSeul', label: ICO_MODE.storyboardSeul + ' Storyboard' }
];
// Normalise pour une recherche insensible à la casse ET aux accents.
function _normaliserRecherche(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Passe par le serveur (clé service_role) plutôt qu'un accès Supabase
// direct : la table `generations` n'accepte plus l'accès du rôle anon
// (voir supabase/generations_series_rls.sql), n'importe qui pouvait sinon
// lire/modifier/supprimer la ligne de n'importe quel autre utilisateur en
// appelant Supabase directement. Toutes les fonctions de ce fichier qui
// touchaient `generations`/`series` en direct suivent le même principe.
async function saveGeneration(mode, titre, contenu) {
  // Régénération GRATUITE : on met à jour la ligne existante au lieu d'en créer une
  // nouvelle → ça ne compte pas comme une génération supplémentaire dans le quota.
  if (_regenGratuiteEnCours && currentGenId) {
    try {
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'generations', action: 'save-regen', code: getUserRef(), id: currentGenId, titre: titre || 'Sans titre', contenu })
      });
    } catch(e) { console.warn('Maj régénération échouée', e); }
    return; // on garde le même currentGenId, aucune nouvelle ligne créée
  }

  // Génération normale (ou 3e régénération+) : nouvelle ligne = compte dans le quota
  currentGenId = null;
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'generations', action: 'save', code: getUserRef(), mode: mode, titre: titre || 'Sans titre', contenu })
    });
    const data = await r.json();
    if (data && data.ok) currentGenId = data.id;
  } catch(e) { console.warn('Sauvegarde échouée', e); }
}

// Fusionne `champs` dans le `contenu` de la génération courante, côté
// serveur (lecture + fusion + écriture en une seule requête, voir
// api/generations.js action 'patch'). Partagé par les fonctions ci-dessous,
// qui ne différaient auparavant que par les champs à fusionner.
async function _patchGenerationCourante(champs) {
  if (!currentGenId) return;
  try {
    await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'generations', action: 'patch', code: getUserRef(), id: currentGenId, champs })
    });
  } catch (e) { console.warn('Mise à jour de la génération échouée', e); }
}

// Met à jour une génération existante (pour y rattacher le storyboard généré)
async function updateGenerationStoryboard(storyboardData) {
  await _patchGenerationCourante({ storyboard_genere: storyboardData });
}

// Rattache le guide de montage CapCut à la génération courante (script, récit,
// storyboard seul), pour qu'il réapparaisse à la réouverture. Même mécanisme
// que updateGenerationStoryboard. currentGenId est déjà positionné, y compris
// à la réouverture (voir ouvrirGeneration).
async function updateGenerationGuideMontage(guide) {
  await _patchGenerationCourante({ guide_montage: guide });
}

// Sauvegarde une retouche ciblée (segment de script ou hook modifié) sur la
// génération déjà enregistrée, pour qu'elle reste visible en rouvrant depuis
// l'historique, même mécanisme que updateGenerationStoryboard ci-dessus.
async function sauvegarderRetouche() {
  await _patchGenerationCourante({ script: currentScript, hooks: currentHooks });
}

// Même principe que sauvegarderRetouche, pour le mode Storytelling
// (currentStory.recit / currentStory.hooks au lieu de currentScript / currentHooks).
async function sauvegarderRetoucheStory() {
  if (!currentStory) return;
  await _patchGenerationCourante({ recit: currentStory.recit, hooks: currentStory.hooks });
}

// Sauvegarde la recommandation "Et maintenant ?" générée après un audit tout
// juste terminé, pour qu'elle reste identique en rouvrant cet audit depuis
// l'historique (même mécanisme que sauvegarderRetouche/updateGenerationStoryboard).
async function sauvegarderRecommandationAudit(data) {
  await _patchGenerationCourante({ recommandation_ia: data });
}

// Réaffiche un storyboard déjà généré (depuis Mes générations), sans régénérer.
function reafficherStoryboard(sbData, isStory, guideSauve) {
  if (!sbData || !sbData.storyboard) return;
  const board = sbData.storyboard;
  const miniature = sbData.miniature;

  if (isStory) {
    // Mode Storytelling
    const out = document.getElementById('storyStoryboardOutput');
    if (!out) return;
    const miniHtmlSt = miniature ? `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">${ICO('image')} Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${auditEsc(miniature)}</div>
        ${blocGenImage(storeCopyText(miniature||''))}
      </div>` : '';
    out.innerHTML = `<div class="sb-actions-top"><button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardStory')">↻ Régénérer</button></div><div class="sb-aide">${ICO('bulb')} Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" style="margin-top:18px">${miniHtmlSt}${board.map((s, i) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${auditEsc(s.duree || '')}</span>
          <span class="sb-index">Plan ${String(i+1).padStart(2,'0')}</span>
        </div>
        <div class="sb-dit">"${auditEsc(s.texte || '')}"</div>
        <div class="sb-visual-label">${ICO('image')} Prompt visuel</div>
        <div class="sb-visual">${auditEsc(s.visuel || '')}</div>
        ${blocGenImage(storeCopyText(s.visuel||''))}
      </div>`).join('')}
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText((miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + board.map((s,i) => 'Plan ' + (i+1) + ' : ' + (s.visuel||'')).join('\n\n'))}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText((miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + board.map((s,i) => 'Plan ' + (i+1) + ' : ' + (s.visuel||'')).join('\n\n'))}')">${ICON_SHARE}</button>
        ${montageBoutonHTML('montageBtnStory', board)}
      </div>
      ${typeof guideMontageBlocHTML === 'function' ? guideMontageBlocHTML('StoryReouv', board, '', updateGenerationGuideMontage, guideSauve) : ''}</div>`;
    // Cacher le bouton "Générer le storyboard" puisqu'il est déjà là
    const btn = document.getElementById('storyStoryboardBtn');
    if (btn) btn.style.display = 'none';
  } else {
    // Mode J'ai une idée
    const container = document.getElementById('storyboardContainer');
    if (!container) return;
    const miniHtml = miniature ? `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">${ICO('image')} Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${auditEsc(miniature)}</div>
        ${blocGenImage(storeCopyText(miniature||''))}
      </div>` : '';
    const tousLesPromptsRe = (miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + board.map((seg, i) => 'Plan ' + (i+1) + ' : ' + (seg.prompt_visuel||'')).join('\n\n');
    container.innerHTML = `<div class="sb-actions-top"><button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardIdee')">↻ Régénérer</button></div><div class="sb-aide">${ICO('bulb')} Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-list">${miniHtml}${board.map((seg, i) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${auditEsc(seg.segment)}</span>
          <span class="sb-index">Plan ${String(i+1).padStart(2,'0')}</span>
        </div>
        <div class="sb-dit">"${auditEsc(seg.texte_dit)}"</div>
        <div class="sb-visual-label">${ICO('image')} Prompt visuel</div>
        <div class="sb-visual">${auditEsc(seg.prompt_visuel)}</div>
        ${blocGenImage(storeCopyText(seg.prompt_visuel||''))}
      </div>`).join('')}
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tousLesPromptsRe)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tousLesPromptsRe)}')">${ICON_SHARE}</button>
        ${montageBoutonHTML('montageBtnScript', board)}
      </div>
      ${typeof guideMontageBlocHTML === 'function' ? guideMontageBlocHTML('ScriptReouv', board, '', updateGenerationGuideMontage, guideSauve) : ''}</div>`;
    // Cacher le bouton générer
    const btn = document.getElementById('sbGenerateBtn');
    if (btn) btn.style.display = 'none';
  }
}

// Compte les générations faites ce mois-ci par l'utilisateur (anti-abus abonnés).
// typeVoulu : 'creation' (les 3 modes) ou 'audit'. Sans argument, compte tout.
async function countMonthGenerations(typeVoulu) {
  try {
    // Début du mois courant : le 1er à 00:00
    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const params = new URLSearchParams({
      resource: 'generations', action: 'count', code: getUserRef(), type: typeVoulu || '', depuis: debutMois.toISOString()
    });
    const r = await fetch('/api/data?' + params.toString());
    const data = await r.json();
    return (data && data.ok) ? (data.count || 0) : 0;
  } catch(e) { console.warn('Comptage du mois échoué', e); return 0; }
}

// Vérifie si un abonné a atteint sa limite mensuelle de création.
// Retourne true si l'utilisateur PEUT générer, false s'il est bloqué (et affiche le message).
// Palier d'abonnement de l'utilisateur courant
function monPalier() {
  return (localStorage.getItem('scriptura_plan') || PLAN_PAR_DEFAUT).trim().toLowerCase();
}

// Un mode réservé au Pro est-il accessible ?
function aAccesMode(mode) {
  if (!MODES_PRO.includes(mode)) return true;
  // Codes VIP/admin : accès total
  if (estIllimite()) return true;
  return unlocked && monPalier() === 'pro';
}

// Parse une date quel que soit le séparateur (yyyy/mm/dd ou yyyy-mm-dd).
// Les slashes ne sont pas fiables selon les navigateurs : on normalise en tirets.
function parseDateFlexible(val) {
  if (!val) return null;
  let s = String(val).trim();
  // Ne garder que la partie date si une heure est présente
  s = s.split('T')[0].split(' ')[0];
  s = s.replace(/\//g, '-'); // slashes -> tirets
  const parts = s.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (y && m && d) return new Date(y, m - 1, d); // date locale, sans souci de fuseau
  }
  const fallback = new Date(val);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// Jours restants avant expiration, seule source de vérité pour ce calcul
// (utilisée à la fois par la notification "ton abonnement expire dans...",
// js/abonnement.js, et par la carte "Expirent bientôt" du tableau de bord
// fondateur, js/admin.js) : l'accès reste valide jusqu'à la FIN du jour
// d'expiration, donc on compte depuis l'instant présent (heure comprise)
// jusqu'à 23:59:59 ce jour-là, jamais un simple écart de dates civiles
// minuit à minuit, qui ignore l'heure actuelle et sous-compte le temps
// réellement restant. Avant ce correctif, les deux écrans utilisaient deux
// calculs différents et pouvaient afficher un nombre de jours différent
// pour le même abonné au même moment.
function joursRestantsAvantExpiration(expireStr) {
  const expire = parseDateFlexible(expireStr);
  if (!expire) return null;
  expire.setHours(23, 59, 59, 999);
  return Math.ceil((expire - new Date()) / 86400000);
}

// Vérifie EN DIRECT si l'abonnement courant est expiré (ou désactivé), en
// relisant le statut réel côté serveur (voir /api/verify-code, clé
// service_role) : la RLS verrouillée sur `abonnes` (voir
// supabase/abonnes_rls.sql) interdit désormais toute lecture directe depuis
// le navigateur. Fetch dédié (plutôt que verifierStatutServeur, js/auth.js) :
// celle-ci avale ses erreurs réseau en un `valid:false` sans le signaler,
// ce qui bloquerait ici un abonné légitime sur un simple raté réseau, alors
// que le doute doit toujours jouer en sa faveur.
async function abonnementExpire() {
  if (!unlocked) return false;
  const code = localStorage.getItem('scriptura_code');
  if (!code) return false;
  if (estIllimite()) return false;
  try {
    const r = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const verdict = await r.json();
    if (!verdict || verdict.indisponible) return false; // réseau/config incertains : on n'enferme pas l'abonné dehors
    return verdict.valid === false;
  } catch(e) { return false; } // réseau incertain : on n'enferme pas l'abonné dehors
}

// Déconnecte un abonné expiré et lui propose de renouveler.
function gererAbonnementExpire() {
  unlocked = false;
  localStorage.setItem('scriptura_unlocked', 'false');
  localStorage.removeItem('scriptura_expire');
  renderGenCounter();
  if (typeof openPlans === 'function') openPlans('expire');
}

async function peutGenerer(errorBoxId) {
  // Les non-abonnés sont gérés par le système de générations gratuites, pas ici.
  if (!unlocked) return true;

  // Codes VIP/admin : générations vraiment illimitées, aucun quota mensuel.
  if (estIllimite()) return true;

  // Abonnement expiré ? On bloque et on renvoie vers le renouvellement.
  if (await abonnementExpire()) { gererAbonnementExpire(); return false; }

  const limite = limitesDuPalier().creation;
  const faitesCeMois = await countMonthGenerations('creation');
  if (faitesCeMois >= limite) {
    openPlans('quota');
    return false;
  }
  return true;
}

// Décide si l'utilisateur peut lancer une ANALYSE SOMMAIRE (@nom d'utilisateur).
// Compteur mensuel dédié, séparé de la création : Creator 10, Pro 25. Un
// non-abonné y a droit 1 fois (aussi décomptée sur ses 5 gratuites). Une fois
// ce quota dédié épuisé (abonné ou non-abonné), un jeton acheté à l'unité en
// débloque une de plus (voir lireJetonsAudit/consommerJetonAudit, pool
// partagé avec l'audit détaillé et la série) : `viaJeton` dans le retour
// dit à l'appelant de décompter le jeton APRÈS un succès.
// Retourne { ok:true, viaJeton? } ou { ok:false, raison, limite }.
async function droitAnalyseSommaire() {
  if (estIllimite()) return { ok: true };

  if (!unlocked) {
    // Non-abonné (avec ou sans jetons achetés) : 1 analyse sommaire ET dans
    // la limite des 5 gratuites. Au-delà, un jeton en débloque une de plus.
    const sommFaites = parseInt(localStorage.getItem('scriptura_sommaire_used') || '0', 10);
    if (sommFaites < MAX_SOMMAIRE_GRATUIT && usedGen < MAX_FREE) return { ok: true };
    if (await lireJetonsAudit() > 0) return { ok: true, viaJeton: true };
    return { ok: false, raison: sommFaites >= MAX_SOMMAIRE_GRATUIT ? 'sommaire_gratuit' : 'free' };
  }

  // Abonné : abonnement valide + quota mensuel dédié, sinon jeton.
  if (await abonnementExpire()) return { ok: false, raison: 'expire' };
  const limite = limitesDuPalier().sommaire || 0;
  const faites = await countMonthGenerations('diagnosticSommaire');
  if (faites < limite) return { ok: true };
  if (await lireJetonsAudit() > 0) return { ok: true, viaJeton: true };
  return { ok: false, raison: 'quota', limite };
}

// Décide si l'utilisateur peut lancer une ANALYSE VIDÉO (lien TikTok).
// Même mécanique que droitAnalyseSommaire ci-dessus (quota mensuel dédié +
// repli jeton), avec ses propres constantes : Creator 6, Pro 15, non-abonné
// 1 fois (aussi décomptée sur ses 5 gratuites).
// Retourne { ok:true, viaJeton? } ou { ok:false, raison, limite }.
async function droitAnalyseVirale() {
  if (estIllimite()) return { ok: true };

  if (!unlocked) {
    const viralFaites = parseInt(localStorage.getItem('scriptura_viral_used') || '0', 10);
    if (viralFaites < MAX_VIRAL_GRATUIT && usedGen < MAX_FREE) return { ok: true };
    if (await lireJetonsAudit() > 0) return { ok: true, viaJeton: true };
    return { ok: false, raison: viralFaites >= MAX_VIRAL_GRATUIT ? 'viral_gratuit' : 'free' };
  }

  if (await abonnementExpire()) return { ok: false, raison: 'expire' };
  const limite = limitesDuPalier().viral || 0;
  const faites = await countMonthGenerations('analyseVirale');
  if (faites < limite) return { ok: true };
  if (await lireJetonsAudit() > 0) return { ok: true, viaJeton: true };
  return { ok: false, raison: 'quota', limite };
}

// Lit le solde de jetons de l'abonné courant, pour l'affichage et les
// vérifications d'AFFICHAGE côté client (le vrai contrôle, lui, est fait
// côté serveur au moment de l'opération, voir api/_lib/acces.js). Passe par
// /api/verify-code (clé service_role côté serveur) plutôt qu'une lecture
// directe de `abonnes` : la RLS interdit désormais cet accès direct au rôle
// anon (voir supabase/abonnes_rls.sql).
async function lireJetonsAudit() {
  const code = localStorage.getItem('scriptura_code');
  if (!code) return 0;
  try {
    const r = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await r.json();
    return parseInt(data.jetons, 10) || 0;
  } catch(e) { console.warn('Lecture jetons échouée', e); return 0; }
}

// Ancienne fonction de décompte client d'un jeton : n'est plus appelée
// nulle part (chaque flux protégé décompte désormais le jeton lui-même
// côté SERVEUR au moment de l'opération, voir api/_lib/acces.js
// consommerJetonServeur). Laissée en place, non référencée, pour limiter le
// diff plutôt que de la supprimer.
async function consommerJetonAudit() {
  if (!supabaseClient) return;
  const code = localStorage.getItem('scriptura_code');
  if (!code) return;
  try {
    const actuels = await lireJetonsAudit();
    const nouveau = Math.max(0, actuels - 1);
    await supabaseClient.from('abonnes').update({ jetons_audit: nouveau }).eq('code', code);
  } catch(e) { console.warn('Décompte jeton échoué', e); }
}

// Décide si l'utilisateur peut lancer un audit, et par quel moyen.
// Retourne : 'pro' (analyse mensuelle incluse), 'jeton' (à décompter),
// ou false (pas le droit, on lui a proposé d'acheter).
async function peutAuditer() {
  // Abonnement expiré ? on bloque avant tout (sauf codes illimités, gérés plus bas)
  if (!estIllimite() && await abonnementExpire()) {
    gererAbonnementExpire();
    return false;
  }
  if (estIllimite()) return 'illimite';

  // 1. D'abord les analyses incluses dans le plan Pro (elles se rechargent)
  const limiteIncluse = limitesDuPalier().audit;
  if (limiteIncluse > 0) {
    const faits = await countMonthGenerations('audit');
    if (faits < limiteIncluse) return 'pro';
  }

  // 2. Ensuite les jetons achetés (ne périment pas)
  const jetons = await lireJetonsAudit();
  if (jetons > 0) return 'jeton';

  // 3. Rien de disponible : on propose d'acheter selon le profil
  openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne');
  return false;
}

// Supprime une ou plusieurs générations dans Supabase
async function deleteGenerations(ids) {
  if (!ids || !ids.length) return false;
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'generations', action: 'delete', code: getUserRef(), ids })
    });
    const data = await r.json();
    return !!(data && data.ok);
  } catch(e) { console.warn('Suppression échouée', e); return false; }
}

// Supprime des séries (table dédiée)
async function deleteSeries(ids) {
  if (!ids || !ids.length) return false;
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'series', action: 'delete', code: getUserRef(), ids })
    });
    const data = await r.json();
    return !!(data && data.ok);
  } catch(e) { console.warn('Suppression série échouée', e); return false; }
}

// Suppression mixte : répartit les ids entre générations et séries.
// Les ids de série sont préfixés "serie:".
async function deleteMixte(ids) {
  const idsSeries = ids.filter(x => String(x).startsWith('serie:')).map(x => x.slice(6));
  const idsGen = ids.filter(x => !String(x).startsWith('serie:'));
  let ok = true;
  if (idsGen.length) ok = await deleteGenerations(idsGen) && ok;
  if (idsSeries.length) ok = await deleteSeries(idsSeries) && ok;
  return ok;
}

// Ouvre le panneau historique
async function openHistory() {
  pushNav(); // mémoriser l'écran d'où on vient
  _selectMode = false;
  _favFilter = false;
  _modeFilter = null;
  _searchQuery = '';
  _searchOpen = false;
  _filterOpen = false;
  if (typeof _selectedIds !== 'undefined') _selectedIds.clear();
  masquerTousLesEcrans();
  document.getElementById('historyFlow').style.display = 'block';
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
  // Pré-remplir le code si connu
  const code = localStorage.getItem('scriptura_code');
  if (code) document.getElementById('historyCodeInput').value = code;
  renderHistory();
}

// Synchronise avec le code d'accès saisi
async function syncHistory() {
  const code = document.getElementById('historyCodeInput').value.trim().toUpperCase();
  if (code) {
    localStorage.setItem('scriptura_code', code);
  }
  renderHistory();
}

// Affiche la liste des générations
let _selectMode = false;
let _selectedIds = new Set();
let _favFilter = false;   // filtre "Favoris" : n'afficher que les favoris
let _modeFilter = null;   // filtre par type ('audit'|'serie'|'ideas'|'script'|'story') ou null
let _searchQuery = '';    // texte de recherche (titres)
let _searchOpen = false;  // champ de recherche déployé ?
let _filterOpen = false;  // menu de filtre par type déployé ?


// Titre court et propre pour la liste « Mes générations ».
// Un script lancé depuis une recommandation reçoit un « sujet » composé
// (« Titre. Angle : … Hook suggéré : … ») qui était enregistré tel quel comme
// titre : dans la liste, on ne garde que le titre, sans l'angle ni le hook.
// Le contexte complet reste stocké à part et sert quand on rouvre la génération.
function histTitreCourt(titre) {
  let t = String(titre == null ? '' : titre);
  t = t.split(/\s*\.?\s*(?:Angle\s*:|Hook\s+suggéré\s*:|Pourquoi\s+ça\s+marche\s*:)/i)[0];
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return t || 'Sans titre';
}

let _histOffset = 0;
let _histHasMore = false;
let _histChargementPlus = false;

async function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:40px">Chargement…</p>';

  _histOffset = 0;
  const brut = await loadGenerations(0);
  _histHasMore = brut.length === HIST_TAILLE_PAGE;
  _histOffset = brut.length;
  // Les épisodes de série ne s'affichent pas isolément : masqués ici
  // (ils restent enregistrés pour le comptage du quota).
  const gens = brut.filter(g => g.mode !== 'serie');
  const series = await chargerSeriesHistorique();

  // Cache complet (non filtré) : permet de redessiner instantanément après un
  // changement de favori, sans nouvel aller-retour serveur.
  window._historyDataAll = gens;
  window._historySeriesAll = series;
  dessinerHistorique();
}

// Bouton "Charger plus" en bas de liste : récupère la page suivante de 50
// générations et l'ajoute au cache existant, sans recharger tout le reste.
async function chargerPlusHistorique() {
  if (_histChargementPlus || !_histHasMore) return;
  _histChargementPlus = true;
  _afficherListeFiltree();
  try {
    const brut = await loadGenerations(_histOffset);
    _histHasMore = brut.length === HIST_TAILLE_PAGE;
    _histOffset += brut.length;
    const nouvelles = brut.filter(g => g.mode !== 'serie');
    window._historyDataAll = (window._historyDataAll || []).concat(nouvelles);
  } finally {
    _histChargementPlus = false;
    _afficherListeFiltree();
  }
}

// Dessine la liste à partir du cache mémoire (aucun rechargement réseau).
// Appelée par renderHistory après chargement, et directement après un
// changement de favori pour un affichage immédiat.
function dessinerHistorique() {
  const gensAll = window._historyDataAll || [];
  const seriesAll = window._historySeriesAll || [];

  // Rien du tout (aucune génération ni série) : état vide global.
  if (!gensAll.length && !seriesAll.length) {
    document.getElementById('historyList').innerHTML = '<div class="history-empty"><p>Aucune génération pour l\'instant.</p><p style="font-size:0.88rem;opacity:0.6;margin-top:8px">Tes scripts, idées et récits apparaîtront ici automatiquement.</p></div>';
    document.getElementById('historyToolbar').style.display = 'none';
    const fb = document.getElementById('historyFilters'); if (fb) fb.style.display = 'none';
    _favFilter = false; _modeFilter = null; _searchOpen = false; _filterOpen = false; _searchQuery = '';
    document.body.classList.remove('hist-select');
    return;
  }

  // Barre d'outils (sélection + favoris + recherche + filtre) puis la liste.
  document.getElementById('historyToolbar').style.display = 'flex';
  updateHistoryToolbar();
  _afficherListeFiltree();
}

// Applique les filtres actifs (mode, favoris, recherche) et remplit la liste.
// Séparé du reste pour pouvoir rafraîchir la liste pendant la frappe dans la
// recherche sans reconstruire la barre (donc sans perdre le focus du champ).
function _afficherListeFiltree() {
  const list = document.getElementById('historyList');
  let gens = (window._historyDataAll || []).slice();
  let series = (window._historySeriesAll || []).slice();

  // Filtre par type (menu curseurs) : un seul mode à la fois.
  if (_modeFilter) {
    if (_modeFilter === 'serie') gens = [];
    else { gens = gens.filter(g => g.mode === _modeFilter); series = []; }
  }
  // Filtre favoris.
  if (_favFilter) {
    gens = gens.filter(g => g.favori);
    series = series.filter(s => s.favori);
  }
  // Recherche par titre (insensible à la casse et aux accents).
  const q = (_searchQuery && _searchQuery.trim()) ? _normaliserRecherche(_searchQuery.trim()) : '';
  if (q) {
    gens = gens.filter(g => _normaliserRecherche(histTitreCourt(g.titre)).includes(q));
    series = series.filter(s => _normaliserRecherche(s.titre || '').includes(q));
  }

  window._historyData = gens;
  window._historySeries = series;

  // Aucun résultat pour les filtres en cours.
  if (!gens.length && !series.length) {
    const filtres = _favFilter || _modeFilter || q;
    list.innerHTML = '<div class="history-empty"><p>' + (filtres ? 'Aucun résultat pour ces filtres.' : 'Aucune génération pour l\'instant.') + '</p>' + (filtres ? '<p style="font-size:0.88rem;opacity:0.6;margin-top:8px">Modifie ou retire les filtres pour voir plus de résultats.</p>' : '') + '</div>'
      + (_histHasMore ? '<button class="btn-regenerate" style="width:100%;margin-top:14px" ' + (_histChargementPlus ? 'disabled' : 'onclick="chargerPlusHistorique()"') + '>' + (_histChargementPlus ? 'Chargement…' : 'Charger l\'historique plus ancien') + '</button>' : '');
    return;
  }

  const modeLabels = { script: ICO_MODE.script + ' Script', ideas: ICO_MODE.ideas + ' Idées', story: ICO_MODE.story + ' Récit', audit: ICO_MODE.audit + ' Diagnostic', serie: ICO_MODE.serie + ' Série', storyboardSeul: ICO_MODE.storyboardSeul + ' Storyboard' };
  const modeColors = { script: '#C9A84C', ideas: '#E2C87A', story: '#C9A84C', audit: '#E2C87A', serie: '#C9A84C', storyboardSeul: '#E2C87A' };

  // Séries et générations sont fusionnées dans UNE seule liste,
  // triée du plus récent au plus ancien (peu importe le type).
  const items = [];

  (series || []).forEach(s => {
    const total = s.nb_episodes || 5;
    const fait = Array.isArray(s.episodes) ? s.episodes.length : (s.episode_courant || 0);
    const pct = Math.min(100, Math.round((fait / total) * 100));
    const fini = s.statut === 'terminee' || fait >= total;
    const sid = 'serie:' + s.id;
    const checked = _selectedIds.has(sid) ? 'checked' : '';
    const selectClass = _selectMode ? ' selecting' : '';
    const estFav = !!s.favori;
    const html = `
      <div class="history-card${selectClass}${estFav ? ' favori' : ''}${_selectedIds.has(sid) ? ' selected' : ''}" data-id="${sid}">
        ${_selectMode ? `<label class="history-check" onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleSelect('${sid}')"/></label>` : ''}
        <div class="history-card-body" onclick="${_selectMode ? `toggleSelect('${sid}')` : `ouvrirSerieDepuisHistorique('${s.id}')`}">
          <div class="history-card-head">
            <span class="history-mode" style="color:#C9A84C">${ICO_MODE.serie} Série</span>
            ${fini ? '<span class="serie-badge-fini">Terminée</span>' : `<span class="history-date">${formaterNombre(fait)}/${formaterNombre(total)} épisodes</span>`}
          </div>
          <div class="history-title">${serieEsc(s.titre || 'Série sans titre')}</div>
          <div class="serie-progress-bar" style="margin-top:10px"><span class="serie-progress-fill" style="width:${pct}%"></span></div>
        </div>
        ${!_selectMode ? `<div class="history-actions">
          <button class="history-fav${estFav ? ' actif' : ''}" onclick="event.stopPropagation(); toggleFavori('${sid}')" title="${estFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${ICON_FAV}</button>
          <button class="history-delete" onclick="event.stopPropagation(); deleteOneSerie('${s.id}')" aria-label="Supprimer">${ICON_DELETE}</button>
        </div>` : ''}
      </div>`;
    items.push({ t: new Date(s.cree_le).getTime() || 0, fav: estFav, html: html });
  });

  gens.forEach((g, i) => {
    const date = new Date(g.cree_le);
    const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' à ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const checked = _selectedIds.has(g.id) ? 'checked' : '';
    const selectClass = _selectMode ? ' selecting' : '';
    const estFav = !!g.favori;
    const html = `
      <div class="history-card${selectClass}${estFav ? ' favori' : ''}" data-id="${g.id}">
        ${_selectMode ? `<label class="history-check" onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleSelect('${g.id}')"/></label>` : ''}
        <div class="history-card-body" onclick="${_selectMode ? `toggleSelect('${g.id}')` : `reopenGeneration(${i})`}">
          <div class="history-card-head">
            <span class="history-mode" style="color:${modeColors[g.mode] || '#C9A84C'}">${modeLabels[g.mode] || auditEsc(g.mode)}</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-title">${serieEsc(histTitreCourt(g.titre))}</div>
          ${!_selectMode ? '<div class="history-reopen">Appuie pour rouvrir cette génération →</div>' : ''}
        </div>
        ${!_selectMode ? `<div class="history-actions">
          <button class="history-fav${estFav ? ' actif' : ''}" onclick="event.stopPropagation(); toggleFavori('${g.id}')" title="${estFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${ICON_FAV}</button>
          <button class="history-delete" onclick="event.stopPropagation(); deleteOne('${g.id}')" aria-label="Supprimer">${ICON_DELETE}</button>
        </div>` : ''}
      </div>`;
    items.push({ t: date.getTime() || 0, fav: estFav, html: html });
  });

  // Les favoris (épinglés) d'abord, puis le plus récent au plus ancien.
  items.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || b.t - a.t);
  list.innerHTML = items.map(x => x.html).join('')
    + (_histHasMore && !_selectMode ? '<button class="btn-regenerate" style="width:100%;margin-top:14px" '
      + (_histChargementPlus ? 'disabled' : 'onclick="chargerPlusHistorique()"') + '>'
      + (_histChargementPlus ? 'Chargement…' : 'Charger l\'historique plus ancien') + '</button>' : '');
}

function updateHistoryToolbar() {
  const toolbar = document.getElementById('historyToolbar');
  if (!toolbar) return;
  // En mode sélection, la barre flotte en bas de l'écran (toujours accessible
  // pendant le défilement) ; sinon elle reste en ligne en haut de la liste.
  toolbar.classList.toggle('flottant', _selectMode);
  document.body.classList.toggle('hist-select', _selectMode);
  if (_selectMode) {
    const n = _selectedIds.size;
    const totalDispo = (window._historyData ? window._historyData.length : 0) + (window._historySeries ? window._historySeries.length : 0);
    const toutCoche = n > 0 && n >= totalDispo;
    toolbar.innerHTML = `
      <button class="hist-tool-btn" onclick="exitSelectMode()">Annuler</button>
      <button class="hist-tool-btn" onclick="${toutCoche ? 'toutDeselectionner()' : 'toutSelectionner()'}">${toutCoche ? 'Aucun' : 'Tout'}</button>
      <span class="hist-tool-count">${n}</span>
      <button class="hist-tool-btn fav" onclick="favoriSelected()" ${n === 0 ? 'disabled' : ''} title="Mettre en favori">${ICON_FAV}<span class="hist-tool-lbl">Favoris</span></button>
      <button class="hist-tool-btn danger" onclick="deleteSelected()" ${n === 0 ? 'disabled' : ''} title="Supprimer">${ICON_DELETE}<span class="hist-tool-lbl">Supprimer</span></button>`;
  } else {
    toolbar.innerHTML = `
      <button class="hist-tool-btn" onclick="enterSelectMode()">Sélectionner</button>
      <button class="hist-tool-btn fav${_favFilter ? ' actif' : ''}" onclick="toggleFavFilter()" title="N'afficher que les favoris">${ICON_FAV}<span class="hist-tool-lbl">Favoris</span></button>
      <button class="hist-tool-icon${(_searchOpen || _searchQuery) ? ' actif' : ''}" onclick="toggleSearch()" title="Rechercher" aria-label="Rechercher">${ICON_SEARCH}</button>
      <button class="hist-tool-icon hist-tool-right${(_modeFilter || _filterOpen) ? ' actif' : ''}" onclick="toggleFilterMenu()" title="Filtrer par type" aria-label="Filtrer par type">${ICON_FILTER}</button>`;
  }
  renderHistoryFilters();
}

// Rangée sous la barre : champ de recherche (si déployé) et/ou puces de type.
function renderHistoryFilters() {
  const box = document.getElementById('historyFilters');
  if (!box) return;
  if (_selectMode) { box.innerHTML = ''; box.style.display = 'none'; return; }
  let html = '';
  if (_searchOpen) {
    html += '<div class="hist-search"><span class="hist-search-ico">' + ICON_SEARCH + '</span>'
      + '<input type="text" id="histSearchInput" class="hist-search-input" placeholder="Rechercher un titre…" value="' + serieEsc(_searchQuery) + '" oninput="onHistSearch(this.value)"/>'
      + (_searchQuery ? '<button class="hist-search-clear" onclick="clearHistSearch()" aria-label="Effacer">✕</button>' : '')
      + '</div>';
  }
  if (_filterOpen) {
    html += '<div class="hist-chips">' + HIST_MODES_FILTRE.map(function (m) {
      const arg = m.v ? ("'" + m.v + "'") : 'null';
      return '<button class="hist-chip' + (_modeFilter === m.v ? ' actif' : '') + '" onclick="setModeFilter(' + arg + ')">' + m.label + '</button>';
    }).join('') + '</div>';
  }
  box.innerHTML = html;
  box.style.display = html ? 'block' : 'none';
}

// Filtre "Favoris" : bascule entre "tout" et "seulement les favoris".
function toggleFavFilter() {
  _favFilter = !_favFilter;
  updateHistoryToolbar();
  _afficherListeFiltree();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Loupe : déploie/replie le champ de recherche.
function toggleSearch() {
  _searchOpen = !_searchOpen;
  if (_searchOpen) _filterOpen = false; else _searchQuery = '';
  updateHistoryToolbar();
  _afficherListeFiltree();
  if (_searchOpen) { const inp = document.getElementById('histSearchInput'); if (inp) inp.focus(); }
}

// Saisie dans la recherche : on ne rafraîchit QUE la liste (le champ garde le focus).
function onHistSearch(val) {
  _searchQuery = val;
  _afficherListeFiltree();
}

function clearHistSearch() {
  _searchQuery = '';
  const inp = document.getElementById('histSearchInput');
  if (inp) { inp.value = ''; inp.focus(); }
  updateHistoryToolbar();
  _afficherListeFiltree();
}

// Curseurs : déploie/replie le menu de filtre par type.
function toggleFilterMenu() {
  _filterOpen = !_filterOpen;
  if (_filterOpen) _searchOpen = false;
  updateHistoryToolbar();
  _afficherListeFiltree();
}

// Choix d'un type dans le menu (null = tous).
function setModeFilter(m) {
  _modeFilter = m;
  updateHistoryToolbar();
  _afficherListeFiltree();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Retrouve un élément (génération ou série) dans le cache complet.
function _histItem(id) {
  const estSerie = String(id).startsWith('serie:');
  const arr = estSerie ? window._historySeriesAll : window._historyDataAll;
  const item = (arr || []).find(x => (estSerie ? ('serie:' + x.id) : x.id) === id);
  return { estSerie, rawId: estSerie ? id.slice(6) : id, item };
}

// Enregistre l'état favori côté serveur, en arrière-plan (ne bloque jamais
// l'interface). L'affichage, lui, a déjà été mis à jour tout de suite.
function _persisterFavori(table, ids, valeur) {
  if (!ids.length) return;
  const resource = table === 'series' ? 'series' : 'generations';
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource, action: 'favori', code: getUserRef(), ids, valeur })
  }).then(function (r) { if (!r.ok) console.warn('Favori non enregistré'); })
    .catch(function (e) { console.warn('Favori non enregistré', e); });
}

// Ajoute/retire UNE génération (ou série) des favoris. Réponse INSTANTANÉE :
// l'étoile devient dorée et l'élément remonte en haut tout de suite ;
// l'enregistrement se fait en arrière-plan.
function toggleFavori(id) {
  const { estSerie, rawId, item } = _histItem(id);
  if (!item) return;
  const nouveau = !item.favori;
  item.favori = nouveau;          // maj optimiste du cache
  dessinerHistorique();           // affichage immédiat (doré + épinglé)
  _persisterFavori(estSerie ? 'series' : 'generations', [rawId], nouveau);
}

// Met en favori (ou retire) toutes les cartes cochées, en une fois et sans délai.
function favoriSelected() {
  const ids = Array.from(_selectedIds);
  if (!ids.length) return;
  // Si tout le lot est déjà en favori → on retire ; sinon → on met en favori.
  const tousDejaFav = ids.every(id => { const r = _histItem(id); return r.item && r.item.favori; });
  const nouveau = !tousDejaFav;
  ids.forEach(id => { const r = _histItem(id); if (r.item) r.item.favori = nouveau; });
  _selectMode = false;
  _selectedIds.clear();
  dessinerHistorique();           // affichage immédiat
  const idsSeries = ids.filter(x => String(x).startsWith('serie:')).map(x => x.slice(6));
  const idsGen = ids.filter(x => !String(x).startsWith('serie:'));
  _persisterFavori('generations', idsGen, nouveau);
  _persisterFavori('series', idsSeries, nouveau);
}

function enterSelectMode() {
  _selectMode = true;
  _selectedIds.clear();
  renderHistory();
}

function exitSelectMode() {
  _selectMode = false;
  _selectedIds.clear();
  renderHistory();
}

// Coche toutes les générations ET toutes les séries affichées
function toutSelectionner() {
  _selectedIds.clear();
  if (window._historyData) window._historyData.forEach(g => _selectedIds.add(g.id));
  if (window._historySeries) window._historySeries.forEach(s => _selectedIds.add('serie:' + s.id));
  renderHistory();
}

function toutDeselectionner() {
  _selectedIds.clear();
  renderHistory();
}

function toggleSelect(id) {
  if (_selectedIds.has(id)) _selectedIds.delete(id);
  else _selectedIds.add(id);
  updateHistoryToolbar();
  // Mettre à jour l'apparence de la carte
  const card = document.querySelector(`.history-card[data-id="${id}"]`);
  if (card) {
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = _selectedIds.has(id);
    card.classList.toggle('selected', _selectedIds.has(id));
  }
}

async function deleteOne(id) {
  // On retrouve le titre ici plutôt que de le passer dans le bouton :
  // un titre contenant un guillemet ou un retour à la ligne cassait le clic.
  const g = (window._historyData || []).find(x => x.id === id);
  let titre = (g && g.titre) ? String(g.titre) : 'cette génération';
  if (titre.length > 60) titre = titre.slice(0, 60) + '…';
  titre = titre.replace(/\s+/g, ' ').trim();
  if (!confirm('Supprimer « ' + titre + ' » ?\n\nCette action est définitive.')) return;
  const ok = await deleteGenerations([id]);
  if (ok) {
    renderHistory();
  } else {
    alert('La suppression a échoué. Réessaie.');
  }
}

async function deleteSelected() {
  const ids = Array.from(_selectedIds);
  if (!ids.length) return;
  if (!confirm('Supprimer ' + ids.length + ' élément' + (ids.length > 1 ? 's' : '') + ' ?\n\nCette action est définitive.')) return;
  const ok = await deleteMixte(ids);
  if (ok) {
    _selectMode = false;
    _selectedIds.clear();
    renderHistory();
  } else {
    alert('La suppression a échoué. Réessaie.');
  }
}

// Supprime une seule série depuis son panier
async function deleteOneSerie(id) {
  // Titre retrouvé ici (et non passé dans le bouton) pour éviter qu'un
  // guillemet dans le titre ne casse le clic.
  const s = (window._historySeries || []).find(x => x.id === id);
  let titre = (s && s.titre) ? String(s.titre).replace(/\s+/g, ' ').trim() : 'cette série';
  if (titre.length > 60) titre = titre.slice(0, 60) + '…';
  if (!confirm('Supprimer la série « ' + titre + ' » et tous ses épisodes ?\n\nCette action est définitive.')) return;
  const ok = await deleteSeries([id]);
  if (ok) renderHistory();
  else alert('La suppression a échoué. Réessaie.');
}

// Rouvre une génération complète dans son mode d'origine (avec hooks, script, légende,
// hashtags, storyboard à la demande, exactement comme à la génération)
function reopenGeneration(i) {
  const g = window._historyData[i];
  if (!g || !g.contenu) return;
  // Empiler 'historyFlow' pour que Retour ramène à la liste des générations
  if (navStack[navStack.length - 1] !== 'historyFlow') navStack.push('historyFlow');
  _skipPush = true; // empêcher les fonctions render d'empiler par-dessus

  masquerTousLesEcrans();

  // Mémoriser l'id pour pouvoir re-rattacher un storyboard généré ensuite
  currentGenId = g.id || null;

  if (g.mode === 'script') {
    document.getElementById('flow').style.display = 'block';
    currentScript = g.contenu.script;
    currentHooks = g.contenu.hooks;
    lastGenContext = g.contenu.context || { sujet: g.titre, plateforme: 'TikTok' };
    renderResults(g.contenu, g.contenu.niche || '', g.titre || '');
    // Réafficher le storyboard sauvegardé s'il existe
    if (g.contenu.storyboard_genere) {
      setTimeout(() => reafficherStoryboard(g.contenu.storyboard_genere, false, g.contenu.guide_montage), 200);
    }
  } else if (g.mode === 'story') {
    document.getElementById('storyFlow').style.display = 'block';
    lastStoryContext = { sujet: g.titre || '', plateforme: '' };
    renderStory(g.contenu);
    if (g.contenu.storyboard_genere) {
      setTimeout(() => reafficherStoryboard(g.contenu.storyboard_genere, true, g.contenu.guide_montage), 200);
    }
  } else if (g.mode === 'ideas') {
    document.getElementById('ideasFlow').style.display = 'block';
    renderIdeas(g.contenu.idees, g.contenu.niche || '');
  } else if (g.mode === 'audit') {
    const af = document.getElementById('auditFlow');
    if (af) af.style.display = 'block';
    // On rouvre un audit déjà fait : pas de capture ici, on montre le résultat.
    if (typeof masquerUICaptureAudit === 'function') masquerUICaptureAudit();
    renderAudit(g.contenu);
  } else if (g.mode === 'diagnosticSommaire') {
    const dsf = document.getElementById('diagSommaireFlow');
    if (dsf) dsf.style.display = 'block';
    // Même masquage du champ de saisie que lors d'une recherche en direct
    // (lancerDiagnosticSommaire) : on rouvre un résultat déjà là, pas un
    // écran de choix.
    if (typeof toggleDiagSommaireEntree === 'function') toggleDiagSommaireEntree(false);
    const cds = g.contenu || {};
    if (typeof afficherDiagnosticSommaireResultat === 'function') {
      afficherDiagnosticSommaireResultat(cds.diagnostic || {}, cds.username || '', cds.estMonCompte, cds.recommandation_ia);
      // Réaffiche le face-à-face « Toi face à @concurrent » s'il avait été calculé.
      if (cds.comparaisonConcurrent && typeof renderComparaisonSauvegardee === 'function') {
        renderComparaisonSauvegardee(cds.comparaisonConcurrent);
      }
    }
  } else if (g.mode === 'analyseVirale') {
    const vf = document.getElementById('viralFlow');
    if (vf) vf.style.display = 'block';
    const cv = g.contenu || {};
    if (typeof afficherRapportViral === 'function') afficherRapportViral(cv.rapport || {});
    if (cv.transcript && typeof _viralTranscript !== 'undefined') _viralTranscript = cv.transcript;
  } else if (g.mode === 'storyboardSeul') {
    const sbsh = document.getElementById('storyboardSeulFlow');
    if (sbsh) sbsh.style.display = 'block';
    const csb = g.contenu || {};
    document.getElementById('sbSeulInput').value = csb.script || '';
    if (typeof sbSeulPlatform !== 'undefined') sbSeulPlatform = csb.plateforme || '';
    const pfContainer = document.getElementById('sbSeulPlatformGrid');
    if (pfContainer) {
      pfContainer.querySelectorAll('.grid-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === csb.plateforme);
      });
    }
    // Menus Style + Format : remplis une seule fois à l'ouverture fraîche du
    // module (voir openStoryboardSeul), jamais en rouvrant depuis
    // l'historique, ce chemin-ci les laissait vides tant que "✎ Modifier"
    // n'avait encore jamais été cliqué dans CETTE session.
    const optSb = document.getElementById('sbSeulOptionsVisuelles');
    if (optSb && typeof optionsStoryboardHTML === 'function') optSb.innerHTML = optionsStoryboardHTML();
    if (csb.storyboard_genere) {
      afficherStoryboardSeulResultat(csb.storyboard_genere.storyboard, csb.storyboard_genere.miniature || null, csb.guide_montage);
    }
  } else if (g.mode === 'serie') {
    const sfh = document.getElementById('serieFlow');
    if (sfh) sfh.style.display = 'block';
    const c = g.contenu || {};
    if (c.serie_id && typeof ouvrirSerie === 'function') {
      // La vraie vue série (mêmes fonctions que le module Série) : montre
      // TOUS les épisodes déjà écrits, avec leur storyboard s'il en existe
      // un, jamais un aperçu figé du seul épisode consulté depuis
      // l'historique, qui serait de toute façon périmé dès qu'un storyboard
      // est généré après coup (voir serie_id, ajouté dans genererEpisode).
      ouvrirSerie(c.serie_id);
    } else {
      // Repli pour les entrées enregistrées avant l'ajout de serie_id :
      // on n'a que l'épisode isolé, sans moyen de retrouver sa série.
      const blocL = document.getElementById('serieListeBloc');
      if (blocL) blocL.style.display = 'none';
      const crea = document.getElementById('serieCreation');
      if (crea) crea.style.display = 'none';
      const nouv = document.getElementById('serieNouvelleBtn');
      if (nouv) nouv.style.display = 'none';
      const det = document.getElementById('serieDetail');
      if (det) {
        det.style.display = 'block';
        det.innerHTML = '<div class="serie-section-label">' + serieEsc(g.titre || 'Épisode') + '</div>'
          + '<div class="serie-episode">'
          + '<div class="serie-episode-titre">' + serieEsc(c.titre || '') + '</div>'
          + '<div class="serie-episode-txt">' + serieEsc(c.script || '') + '</div>'
          + '</div>'
          + '<button class="serie-suggest-btn" onclick="retourListeSeries()">← Retour à mes séries</button>';
      }
    }
  }

  _skipPush = false; // réactiver l'empilement normal
  window.scrollTo({ top: 0, behavior: 'auto' });
}


// Récupère l'historique des générations de l'utilisateur
// ══════════════════════════════════════
//  POP-UP DE RAPPEL DES RECOMMANDATIONS
//  Dès le lendemain d'un audit, si l'abonné rouvre Scriptura, on lui
//  rappelle sa reco principale et on demande s'il a commencé.
//  Ne s'affiche qu'une fois par audit (mémorisé en localStorage).
// ══════════════════════════════════════

// Extrait la recommandation principale d'un audit sauvegardé.
function recoPrincipale(contenu) {
  if (!contenu || typeof contenu !== 'object') return null;
  const pa = contenu.plan_action_30j || {};
  // Priorité : la première action concrète du plan des 30 jours
  if (Array.isArray(pa.sujets_a_faire) && pa.sujets_a_faire.length) {
    return pa.sujets_a_faire[0];
  }
  if (pa.frequence) return pa.frequence;
  // Sinon, le levier du score (dimension la plus faible), déjà calculé à l'affichage
  if (contenu.mesures) {
    const s = calculerScores(contenu.mesures);
    if (s.levier_dim) return 'Travailler en priorité : ' + s.levier_dim;
  }
  return null;
}

let _rappelAuditCourant = null;

async function verifierRappelAudit() {
  if (!unlocked) return; // réservé aux abonnés connectés
  try {
    const params = new URLSearchParams({ resource: 'generations', action: 'last', code: getUserRef(), mode: 'audit' });
    const r = await fetch('/api/data?' + params.toString());
    const rep = await r.json();
    const audit = rep && rep.ok && rep.data;
    if (!audit) return;
    // Déjà rappelé pour cet audit ? on n'insiste pas.
    const dejaVu = localStorage.getItem('scriptura_rappel_' + audit.id);
    if (dejaVu) return;

    // Au moins le lendemain : l'audit doit dater d'un autre jour que today.
    const dateAudit = new Date(audit.cree_le);
    const auj = new Date();
    const memeJour = dateAudit.toDateString() === auj.toDateString();
    if (memeJour) return; // pas le jour même, on attend au moins demain

    const reco = recoPrincipale(audit.contenu);
    if (!reco) return; // rien à rappeler

    _rappelAuditCourant = audit;
    const recoEl = document.getElementById('auditRappelReco');
    if (recoEl) recoEl.textContent = reco;
    document.getElementById('auditRappelStep1').style.display = 'block';
    document.getElementById('auditRappelStep2').style.display = 'none';
    document.getElementById('auditRappelOverlay').classList.add('active');
  } catch(e) { console.warn('Rappel audit échoué', e); }
}

// Depuis le pop-up de rappel (le lendemain d'un audit) : génère directement
// les 10 idées à partir de la niche et l'objectif de l'audit sauvegardé.
function genererIdeesDepuisRappel() {
  const audit = _rappelAuditCourant;
  fermerRappelAudit();
  const contenu = (audit && audit.contenu) ? audit.contenu : {};
  // Si la niche n'est pas dans l'audit sauvegardé, lancerIdeesDepuisAudit
  // ouvrira le formulaire vierge au lieu de générer à l'aveugle.
  lancerIdeesDepuisAudit(contenu.niche || '', contenu.objectif || '');
}

function auditRappelRepondre(aCommence) {
  if (_rappelAuditCourant) {
    localStorage.setItem('scriptura_rappel_' + _rappelAuditCourant.id, aCommence ? 'oui' : 'non');
  }
  document.getElementById('auditRappelStep1').style.display = 'none';
  const step2 = document.getElementById('auditRappelStep2');
  const rep = document.getElementById('auditRappelReponse');
  const btns = document.getElementById('auditRappelStep2Btns');
  if (aCommence) {
    rep.textContent = 'Excellent. La régularité fait toute la différence, continue sur cette lancée, tu es sur la bonne voie.';
    btns.innerHTML = '<button class="rappel-btn rappel-btn-oui" onclick="fermerRappelAudit()">Continuer</button>';
  } else {
    rep.textContent = 'Pas de souci. Le plus dur, c\'est de commencer. Laisse Scriptura te trouver des idées de contenu, tout de suite.';
    btns.innerHTML =
      '<button class="rappel-btn rappel-btn-oui" onclick="genererIdeesDepuisRappel()">Trouver des idées maintenant</button>' +
      '<button class="rappel-btn rappel-btn-non" onclick="fermerRappelAudit()">Plus tard</button>';
  }
  step2.style.display = 'block';
}

function fermerRappelAudit() {
  const el = document.getElementById('auditRappelOverlay');
  if (el) el.classList.remove('active');
}

// Chargé par pages de 50 (voir chargerPlusHistorique) : une limite fixe de
// 50 faisait disparaître silencieusement l'historique plus ancien dès qu'un
// utilisateur actif dépassait 50 générations dans le mois (ex: juillet
// devenu invisible une fois 50 générations faites en août).
const HIST_TAILLE_PAGE = 50;

async function loadGenerations(offset) {
  const debut = offset || 0;
  try {
    const params = new URLSearchParams({ resource: 'generations', action: 'list', code: getUserRef(), offset: String(debut) });
    const r = await fetch('/api/data?' + params.toString());
    const data = await r.json();
    return (data && data.ok) ? (data.data || []) : [];
  } catch(e) { console.warn('Chargement échoué', e); return []; }
}

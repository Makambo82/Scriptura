// ═══════════════════════════════════════════════════════════
//  GUIDE DE MONTAGE CAPCUT (sur-mesure, généré par l'IA)
//
//  Sous un storyboard, l'utilisateur peut générer un guide de montage CapCut
//  ADAPTÉ à SA vidéo (ton, rythme, moments forts), pas un tuto générique :
//  intention de montage, déroulé CapCut étape par étape, plan par plan
//  (transitions + effets), musique, sous-titres. Le storyboard fournit les
//  vraies données (durées, voix off, visuels), l'IA les met en scène.
//
//  C'est une génération : gating quota comme les autres modes. Le guide est
//  persisté par le mode appelant (callback onSave), pour réapparaître à la
//  réouverture. Démarré sur le mode Série, réutilisable ailleurs ensuite.
// ═══════════════════════════════════════════════════════════

function guideMontageEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Les boutons vivent dans des chaînes HTML (aucune référence DOM au moment de
// la construction) : on stocke les données (plans, contexte, callback de
// sauvegarde) en mémoire et l'onclick ne transporte qu'une clé.
window._guideMontageStore = window._guideMontageStore || {};
function storeGuideSource(data) {
  const key = '__guidekey_' + (window._guideSourceCounter = (window._guideSourceCounter || 0) + 1);
  window._guideMontageStore[key] = data;
  return key;
}
// idBtn : id du bouton. zoneId : id du conteneur où rendre le guide. plans :
// storyboard (tolère {duree,text,visuel} ou {segment,texte_dit,prompt_visuel}).
// contexte : texte libre (ton, titre…). onSave(guide) : persistance côté appelant.
function guideMontageBoutonHTML(idBtn, zoneId, plans, contexte, onSave) {
  const key = storeGuideSource({ plans: plans || [], contexte: contexte || '', zoneId, onSave });
  return `<button class="btn-regenerate guide-montage-btn" id="${idBtn}" type="button" onclick="genererGuideMontageParCle('${key}', this)">🎬 Guide de montage CapCut</button>`;
}
function genererGuideMontageParCle(key, btn) {
  const s = window._guideMontageStore[key];
  if (s) genererGuideMontage(s.plans, s.contexte, btn, s.zoneId, s.onSave);
}

// Normalise un plan quel que soit le mode d'origine.
function _normPlanGuide(p) {
  return {
    duree: p.duree || p.segment || '',
    voix: p.text || p.texte_dit || p.texte || '',
    visuel: p.visuel || p.prompt_visuel || ''
  };
}

async function genererGuideMontage(plans, contexte, btn, zoneId, onSave) {
  const norm = (Array.isArray(plans) ? plans : []).map(_normPlanGuide).filter(p => p.voix || p.visuel);
  if (!norm.length) return;

  // Quota : c'est une génération à part entière.
  if (typeof unlocked !== 'undefined' && !unlocked && typeof usedGen !== 'undefined' && usedGen >= MAX_FREE) { openPlans('nouveau'); return; }
  if (typeof peutGenerer === 'function' && !(await peutGenerer('guideMontageErr'))) return;

  const zone = document.getElementById(zoneId);
  const libelleBtn = btn ? btn.textContent : '';
  if (btn) btn.disabled = true;
  // Animation plein écran (bande dorée + étapes), comme les autres générations.
  if (typeof startGenAnimation === 'function') startGenAnimation('montageGuide');

  try {
    const guide = await _appelerGuideMontage(norm, contexte);
    if (!guide || (!Array.isArray(guide.etapes) && !Array.isArray(guide.par_plan))) {
      throw new Error('Guide illisible, réessaie');
    }

    // Décompte quota + rappels (mêmes règles que les autres générations).
    if (typeof unlocked !== 'undefined' && !unlocked) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      if (typeof bumpServerQuota === 'function') bumpServerQuota(usedGen);
      if (typeof renderGenCounter === 'function') renderGenCounter();
      if (typeof checkRappelAbonnement === 'function') checkRappelAbonnement();
    }
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    if (zone) { zone.innerHTML = renderGuideMontage(guide); zone.style.display = 'block'; zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    if (btn) btn.style.display = 'none';
    if (typeof onSave === 'function') { try { onSave(guide); } catch (e) {} }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = libelleBtn || '🎬 Guide de montage CapCut'; }
    if (zone) { zone.innerHTML = `<div class="error-box" style="display:block;margin-top:12px">Guide impossible : ${guideMontageEsc(e.message || 'réessaie')}.</div>`; zone.style.display = 'block'; }
  } finally {
    if (typeof stopGenAnimation === 'function') stopGenAnimation();
  }
}

// Bloc complet (bouton + zone) prêt à insérer sous n'importe quel storyboard.
// suffixe : identifiant unique par emplacement. onSave optionnel (persistance).
// guideSauve : si un guide a déjà été généré (réouverture), on l'affiche
// directement et on masque le bouton.
function guideMontageBlocHTML(suffixe, plans, contexte, onSave, guideSauve) {
  const zoneId = 'guideZone' + suffixe;
  return `<div class="guide-montage-wrap">
    ${guideSauve ? '' : guideMontageBoutonHTML('guideBtn' + suffixe, zoneId, plans, contexte || '', onSave)}
    <div class="guide-montage-zone" id="${zoneId}">${guideSauve ? renderGuideMontage(guideSauve) : ''}</div>
  </div>`;
}

async function _appelerGuideMontage(plans, contexte) {
  const storyboardTexte = plans.map((p, i) =>
    `Plan ${i + 1} (${p.duree || '?'}) — voix off : "${(p.voix || '').slice(0, 240)}"${p.visuel ? ` — visuel : ${p.visuel.slice(0, 180)}` : ''}`
  ).join('\n');

  const prompt = `Tu es monteur vidéo pro spécialisé TikTok faceless et CapCut (appli mobile). On te donne le STORYBOARD d'une vidéo (plans avec durée, voix off, visuel). Rédige un GUIDE DE MONTAGE CAPCUT SUR-MESURE, adapté au TON, au rythme et aux moments forts de CETTE vidéo précise, jamais un tuto générique. Chaque conseil doit être exécutable tel quel dans CapCut.

STORYBOARD :
${storyboardTexte}
${contexte ? '\nCONTEXTE : ' + contexte : ''}

Produis :
- INTENTION : en 1 à 2 phrases, le feeling de montage visé (nerveux, contemplatif, dramatique, punchy…) déduit du contenu réel.
- ÉTAPES : le déroulé CapCut dans l'ordre (projet 9:16, import des images générées, pose de la voix off, transitions, sous-titres, musique, export). 5 à 7 étapes GÉNÉRALES et courtes. IMPORTANT : n'énumère JAMAIS les plans un par un dans les étapes (pas de « Plan 1 sur 4,5 sec, Plan 2 sur… »), tout le détail par plan va dans PLAN PAR PLAN ci-dessous. Garde chaque détail d'étape à 1-2 phrases.
- PLAN PAR PLAN : pour CHAQUE plan, sa durée exacte, la transition vers le suivant, et l'effet ou le mouvement conseillé (zoom lent, secousse, fondu, cut sec…), cohérent avec le moment. Une entrée par plan.
- MUSIQUE : ambiance conseillée et où monter, baisser ou couper le son.
- SOUS-TITRES : style (police, taille, couleur, animation) adapté au ton.

RÈGLES : nombres écrits normalement, jamais de tiret cadratin, wording naturel de créateur. Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{
  "intention": "<1-2 phrases>",
  "etapes": [ { "titre": "<étape courte>", "detail": "<consigne générale, 1-2 phrases, SANS énumérer les plans>" } ],
  "par_plan": [ { "plan": "1", "duree": "<ex: 4,5 sec>", "transition": "<vers le plan suivant>", "effet": "<effet/mouvement sur ce plan>" } ],
  "musique": "<ambiance + où couper/monter>",
  "sous_titres": "<style adapté au ton>"
}`;

  const modele = (typeof MODEL_RAPIDE !== 'undefined') ? MODEL_RAPIDE : 'claude-haiku-4-5-20251001';
  const raw = await callAI(modele, 2600, prompt);
  return parseAIResponse(raw);
}

// Rendu du guide (nouvelle génération ou réouverture depuis l'historique).
// Dressé comme les prompts du storyboard : pas de cadre séparé, mêmes blocs
// (sb-segment) que les plans, avec un bloc par plan (Plan 01, Plan 02…).
function renderGuideMontage(g) {
  g = g || {};
  const etapes = Array.isArray(g.etapes) ? g.etapes : [];
  const parPlan = Array.isArray(g.par_plan) ? g.par_plan : [];
  const texte = _texteGuideMontage(g);
  return `
    <div class="guide-montage-block">
      <div class="guide-montage-titre">🎬 Monter dans CapCut</div>
      ${g.intention ? `<p class="guide-intention">${guideMontageEsc(g.intention)}</p>` : ''}
      ${etapes.length ? `<ol class="guide-etapes">${etapes.map(e => `<li><b>${guideMontageEsc(e.titre || '')}</b><p>${guideMontageEsc(e.detail || '')}</p></li>`).join('')}</ol>` : ''}
      ${parPlan.length ? `
        <div class="sb-visual-label" style="margin-top:16px">Plan par plan</div>
        ${parPlan.map((p, i) => `
          <div class="sb-segment guide-plan-seg">
            <div class="sb-head"><span class="sb-time">${guideMontageEsc(p.duree || '')}</span><span class="sb-index">Plan ${String(p.plan || (i + 1)).padStart(2, '0')}</span></div>
            ${p.transition ? `<div class="guide-plan-line"><b>Transition</b> ${guideMontageEsc(p.transition)}</div>` : ''}
            ${p.effet ? `<div class="guide-plan-line"><b>Effet</b> ${guideMontageEsc(p.effet)}</div>` : ''}
          </div>`).join('')}` : ''}
      ${g.musique ? `<div class="sb-visual-label" style="margin-top:16px">Musique</div><p class="guide-txt">${guideMontageEsc(g.musique)}</p>` : ''}
      ${g.sous_titres ? `<div class="sb-visual-label" style="margin-top:12px">Sous-titres</div><p class="guide-txt">${guideMontageEsc(g.sous_titres)}</p>` : ''}
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier le guide" onclick="copyText(this, '${storeCopyText(texte)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(texte)}')">${ICON_SHARE}</button>
      </div>
    </div>`;
}

function _texteGuideMontage(g) {
  g = g || {};
  const l = [];
  l.push('GUIDE DE MONTAGE CAPCUT');
  if (g.intention) l.push('\nINTENTION : ' + g.intention);
  if (Array.isArray(g.etapes) && g.etapes.length) {
    l.push('\nLE DÉROULÉ DANS CAPCUT :');
    g.etapes.forEach((e, i) => l.push((i + 1) + '. ' + (e.titre || '') + ' : ' + (e.detail || '')));
  }
  if (Array.isArray(g.par_plan) && g.par_plan.length) {
    l.push('\nPLAN PAR PLAN :');
    g.par_plan.forEach((p, i) => l.push('Plan ' + String(p.plan || (i + 1)).padStart(2, '0') + (p.duree ? ' (' + p.duree + ')' : '') + ' : transition ' + (p.transition || '') + (p.effet ? ' · effet ' + p.effet : '')));
  }
  if (g.musique) l.push('\nMUSIQUE : ' + g.musique);
  if (g.sous_titres) l.push('\nSOUS-TITRES : ' + g.sous_titres);
  return l.join('\n');
}

// ═══════════════════════════════════════════════════════════
//  MODE « ANALYSER UNE VIDÉO VIRALE » (autonome)
//  L'utilisateur colle le lien d'une vidéo virale (TikTok). Scriptura
//  transcrit sa VOIX (api/video-stt.js, ElevenLabs Scribe), puis DÉCODE toute la
//  recette : hook, techniques de rétention, sujet, structure du début à la
//  fin, et ce qui l'a rendue virale. À la fin : copier la structure, ou
//  créer un script à partir de ça (handoff vers le flux Script).
//
//  C'est une ANALYSE (comme le diagnostic), pas une génération de contenu :
//  l'IA décode, elle n'invente rien. Réutilise le récupérateur de transcript
//  déjà en place et le pipeline de script existant pour le handoff.
// ═══════════════════════════════════════════════════════════

let _viralTranscript = '';   // transcript/texte de la vidéo analysée
let _viralRapport = null;    // dernier rapport affiché (pour les CTA)

function viralEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Ouvre le mode depuis l'accueil / le menu.
function ouvrirAnalyseVirale() {
  if (typeof pushNav === 'function') pushNav();
  masquerTousLesEcrans();
  resetAnalyseVirale();
  document.getElementById('viralFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function resetAnalyseVirale() {
  const lien = document.getElementById('viralAnaLien');
  const txt = document.getElementById('viralAnaTexte');
  if (lien) lien.value = '';
  if (txt) txt.value = '';
  const note = document.getElementById('viralAnaNote');
  if (note) note.textContent = "Colle le lien de partage (TikTok). Pas de lien ? Ouvre le repli et colle le texte de la vidéo.";
  const err = document.getElementById('viralAnaError');
  if (err) err.style.display = 'none';
  const form = document.getElementById('viralAnaForm');
  if (form) form.style.display = '';
  const res = document.getElementById('viralAnaResults');
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
}

// Depuis le résultat, relancer une nouvelle analyse.
function analyserAutreVideoVirale() {
  resetAnalyseVirale();
  const lien = document.getElementById('viralAnaLien');
  if (lien) lien.focus();
}

// Récupère le transcript à partir du lien (best-effort). Renvoie {transcript, description}
// ou null. Transcription par la voix via /api/video-stt (ElevenLabs Scribe).
async function _transcriptDepuisLien(url) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 30000);
  try {
    const rep = await fetch('/api/video-stt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }), signal: ctrl.signal
    });
    const data = await rep.json();
    if (!rep.ok) throw new Error(data?.error?.message || 'Récupération impossible');
    return data;
  } finally { clearTimeout(minuteur); }
}

async function lancerAnalyseVirale() {
  const err = document.getElementById('viralAnaError');
  const note = document.getElementById('viralAnaNote');
  const btn = document.getElementById('viralAnaBtn');
  const spin = document.getElementById('viralAnaSpinner');
  const btnText = document.getElementById('viralAnaBtnText');
  err.style.display = 'none';

  const lien = (document.getElementById('viralAnaLien').value || '').trim();
  let texte = (document.getElementById('viralAnaTexte').value || '').trim();

  if (!lien && !texte) {
    err.textContent = "Colle le lien d'une vidéo virale, ou son texte à la main.";
    err.style.display = 'block';
    return;
  }

  // Quotas : c'est une génération (comme storyboard seul).
  if (!unlocked && usedGen >= MAX_FREE) { openPlans('nouveau'); return; }
  if (!(await peutGenerer('viralAnaError'))) return;

  btn.disabled = true;
  if (spin) spin.style.display = 'block';
  if (btnText) btnText.textContent = 'Analyse en cours…';
  // Animation plein écran (bande dorée hachée + étapes défilantes), la même
  // que récit / script / série : l'utilisateur voit ce que fait l'app en
  // coulisse (récupération, transcription, décodage, score).
  if (typeof startGenAnimation === 'function') startGenAnimation('viral');

  try {
    // 1) Transcript : depuis le lien en priorité, sinon le texte collé.
    let description = '';
    let statsVideo = null; // vraies stats de la vidéo (vues/likes…), pour le score
    let langueVideo = null; // langue détectée par la transcription (pour la mémoire)
    if (lien) {
      if (note) note.textContent = 'On écoute la vidéo et on la transcrit ☕…';
      try {
        const data = await _transcriptDepuisLien(lien);
        statsVideo = data.stats || null;
        langueVideo = data.langue || null;
        if (data.ok && data.transcript) { texte = data.transcript; description = data.description || ''; }
        else if (data.description && !texte) { texte = data.description; }
      } catch (e) {
        if (!texte) throw new Error("Impossible de lire cette vidéo. Colle son texte à la main (repli ci-dessous).");
      }
    }
    if (!texte || texte.length < 15) {
      throw new Error("Pas assez de contenu à analyser. Colle le texte de la vidéo à la main.");
    }
    // Garde-fou : ne jamais envoyer du binaire (image/vidéo mal récupérée) à l'IA.
    const nonImpr = (texte.slice(0, 800).match(/[\x00-\x08\x0E-\x1F\uFFFD]/g) || []).length;
    if (nonImpr > 15) {
      throw new Error("Le contenu récupéré n'est pas lisible. Colle le texte de la vidéo à la main (repli ci-dessous).");
    }
    _viralTranscript = texte;

    if (btnText) btnText.textContent = 'Scriptura décode la recette…';
    if (note) note.textContent = 'Scriptura décode la recette virale ☕…';

    // 2) Décodage par l'IA. Analyse RESSERRÉE et percutante (pas de redites) :
    // le déroulé (rétention + structure fusionnés) en quelques temps, les
    // facteurs majeurs, et les leviers transposables. Plus des SIGNAUX (booléens)
    // qui servent à calculer le score de viralité EN CODE.
    const prompt = `Tu es Scriptura, expert TikTok. On te donne le CONTENU d'une vidéo virale (transcript de sa VOIX, et éventuellement sa description). Décode PRÉCISÉMENT et honnêtement ce qui l'a rendue virale. Base-toi UNIQUEMENT sur le contenu fourni, n'invente aucune statistique ni aucun élément absent. Sois PERCUTANT et CONCIS : pas de redites d'une section à l'autre.

${description ? 'DESCRIPTION : ' + description + '\n\n' : ''}TRANSCRIPT DE LA VIDÉO :
${texte.slice(0, 6000)}

Analyse comme un monteur/scénariste pro :
- LA NICHE : en 1 à 3 mots, le thème/domaine de la vidéo (ex. « finance perso », « cuisine rapide », « histoire », « développement perso », « tech »). Sert à ranger la recette dans la bonne famille.
- LE HOOK : la ou les toutes premières phrases réelles, la technique, pourquoi ça arrête le scroll.
- LA RECETTE, TEMPS PAR TEMPS : reconstitue le déroulé chronologique en 4 à 6 TEMPS maximum (fusionne structure et rétention : chaque temps = un procédé + le ressort d'attention qu'il crée). Ancre chaque temps dans le contenu réel.
- POURQUOI ÇA A PERCÉ : 3 à 4 facteurs MAJEURS et déterminants seulement (les plus forts, pas une liste exhaustive).
- CE QUE TU PEUX REPRENDRE : 3 à 4 leviers TRANSPOSABLES, formulés comme des RECETTES réutilisables sur N'IMPORTE QUEL sujet (ex. « ouvre par une équation binaire X/Y », pas « parle de Sarkozy »).
- SIGNAUX : pour chaque levier viral, dis honnêtement si CETTE vidéo l'emploie vraiment (true) ou pas (false). Ils servent à noter la vidéo, sois rigoureux.

RÈGLE DE FORMAT DES NOMBRES : écris les nombres normalement, jamais de séparateur anglo-saxon. N'emploie jamais de tiret cadratin.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises autour. Structure EXACTE :
{
  "niche": "<thème/domaine en 1 à 3 mots>",
  "sujet": "<le sujet réel de la vidéo + l'angle, 1 phrase>",
  "hook": { "technique": "<nom court de la technique d'accroche>", "verbatim": "<la ou les toutes premières phrases réelles du transcript>", "pourquoi": "<pourquoi ça arrête le scroll, 1-2 phrases>" },
  "recette": [ { "temps": "<ex: 0-5s / 5-15s / avant la fin>", "titre": "<nom court du procédé>", "detail": "<ce qui se passe + le ressort d'attention, 1-2 phrases, ancré dans la vidéo>" } ],
  "pourquoi_viral": [ "<facteur majeur 1>", "<facteur majeur 2>", "<facteur majeur 3>" ],
  "a_reprendre": [ { "titre": "<max 8 mots>", "detail": "<recette transposable à TES sujets, 1-2 phrases>" } ],
  "signaux": { "hook_fort": <true/false>, "boucle_ouverte": <true/false>, "cliffhanger": <true/false>, "deuxieme_personne": <true/false>, "details_concrets": <true/false>, "escalade": <true/false>, "question_rhetorique": <true/false>, "archetypes": <true/false> }
}`;

    const raw = await callAI(MODEL_CREATIF, 3000, prompt);
    const rapport = parseAIResponse(raw);
    if (!rapport || (!rapport.hook && !rapport.recette)) {
      throw new Error("Analyse illisible, réessaie dans un instant.");
    }
    rapport.stats = statsVideo; // vraies stats (pour le score + le contexte)
    rapport.langue = langueVideo;
    _viralRapport = rapport;

    // 3) Décompte quota + sauvegarde.
    if (!unlocked) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      renderGenCounter();
      checkRappelAbonnement();
    }
    const titreCourt = (rapport.sujet || 'vidéo virale').slice(0, 50);
    saveGeneration('analyseVirale', 'Analyse virale · ' + titreCourt, {
      lien: lien || null, transcript: texte, rapport: rapport
    });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    afficherRapportViral(rapport);
    // Mémoire partagée : si la recette est élite (>= 90) ET vraiment performante,
    // on dépose sa version distillée pour nourrir les générations de tous.
    _deposerPatternViral(rapport);

  } catch (e) {
    err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    err.style.display = 'block';
    if (note) note.textContent = "Colle le lien de partage (TikTok). Pas de lien ? Ouvre le repli et colle le texte de la vidéo.";
  } finally {
    if (typeof stopGenAnimation === 'function') stopGenAnimation();
    btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (btnText) btnText.textContent = '🔍 Analyser la vidéo';
  }
}

// ── Score de viralité ──
// DÉTERMINISTE : compté EN CODE à partir des leviers viraux réellement présents
// (signaux booléens fournis par l'IA), jamais une note libre. Échelle 30-100 :
// une vidéo virale a déjà une base, chaque levier fort la fait monter.
const SIGNAUX_VIRAL = ['hook_fort', 'boucle_ouverte', 'cliffhanger', 'deuxieme_personne', 'details_concrets', 'escalade', 'question_rhetorique', 'archetypes'];
function scoreViraliteRecette(signaux) {
  if (!signaux || typeof signaux !== 'object') return null;
  const n = SIGNAUX_VIRAL.filter(k => signaux[k] === true).length;
  return { score: Math.round(30 + 70 * (n / SIGNAUX_VIRAL.length)), leviers: n };
}
// Taux d'engagement réel (interactions ÷ vues), en %.
function _tauxEngagementViral(s) {
  if (!s || !s.vues) return null;
  const inter = (s.likes || 0) + (s.commentaires || 0) + (s.partages || 0);
  if (!inter) return null;
  return Math.round((inter / s.vues) * 1000) / 10;
}
function _fmtVuesViral(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v >= 1e6) return (Math.round(v / 1e5) / 10).toString().replace('.', ',') + ' M';
  if (v >= 1e3) return Math.round(v / 1e3) + ' K';
  return String(v);
}

// ── Portée : le vrai signal de viralité ──
// vues ÷ abonnés de l'auteur. Une vidéo est virale quand l'algo la pousse
// BIEN AU-DELÀ de l'audience du compte, pas juste quand le compteur est gros.
function porteeViral(stats) {
  if (!stats || !stats.vues || !stats.abonnesAuteur || stats.abonnesAuteur <= 0) return null;
  const ratio = stats.vues / stats.abonnesAuteur;
  let niveau, label;
  if (ratio >= 10) { niveau = 4; label = 'Explosion'; }
  else if (ratio >= 5) { niveau = 3; label = 'Forte portée'; }
  else if (ratio >= 2) { niveau = 2; label = 'Bonne portée'; }
  else { niveau = 1; label = 'Dans son audience'; }
  // Ratio lisible : « ×12 » ou « ×3,4 ».
  const affiche = ratio >= 10 ? '×' + Math.round(ratio) : '×' + (Math.round(ratio * 10) / 10).toString().replace('.', ',');
  return { ratio, niveau, label, affiche };
}
// Niveau d'engagement (interactions ÷ vues) : moyenne TikTok ~5-6%.
function niveauEngagementViral(taux) {
  if (taux == null) return null;
  if (taux >= 10) return { niveau: 4, label: 'Engagement exceptionnel' };
  if (taux >= 6) return { niveau: 3, label: 'Engagement fort' };
  if (taux >= 3) return { niveau: 2, label: 'Engagement normal' };
  return { niveau: 1, label: 'Engagement faible' };
}

// ── Double lecture : Recette × Performance ──
// La recette (structure) peut être forte alors que les vues sont un coup de
// chance, et inversement. On croise les deux axes pour un verdict honnête.
const SEUIL_RECETTE_FORTE = 83;  // 6 leviers sur 8 ou plus
const SEUIL_MEMOIRE = 90;        // entrée dans la mémoire partagée : 7-8 leviers
// La performance est « réelle » quand la portée est forte (l'algo a poussé au
// delà de l'audience) ou, à défaut de connaître les abonnés, quand
// l'engagement est exceptionnel.
function performanceForte(stats) {
  const p = porteeViral(stats);
  if (p) return p.niveau >= 3;
  const taux = _tauxEngagementViral(stats);
  return taux != null && taux >= 10;
}
// Le verdict croisé, avec un titre + une explication. perfConnue=false quand on
// n'a aucune stat (lien non résolu) : on tombe alors sur une lecture recette seule.
function verdictCroiseViral(score, stats) {
  const recetteForte = score != null && score >= SEUIL_RECETTE_FORTE;
  const perfConnue = !!(stats && stats.vues);
  if (!perfConnue) {
    return recetteForte
      ? { ton: 'ok', titre: 'Recette solide', texte: 'La structure est forte. Les stats réelles manquaient, mais la recette est réutilisable telle quelle.' }
      : { ton: 'neutre', titre: 'Recette moyenne', texte: 'La structure reste perfectible. À reprendre en renforçant les leviers manquants.' };
  }
  const perfForte = performanceForte(stats);
  if (recetteForte && perfForte) return { ton: 'ok', titre: 'Formule reproductible', texte: 'La structure explique le succès. Tu peux la copier, elle marche par construction, pas par chance.' };
  if (recetteForte && !perfForte) return { ton: 'neutre', titre: 'Bonne structure, portée bridée', texte: 'La recette est solide mais le sujet, le timing ou la niche ont limité la portée. Réutilisable sur un meilleur angle.' };
  if (!recetteForte && perfForte) return { ton: 'alerte', titre: 'Probable coup de chance', texte: 'Grosses vues, mais la structure ne les explique pas vraiment (tendance, sujet d\'actu, coup de bol). Reproduis avec prudence.' };
  return { ton: 'neutre', titre: 'Peu à reprendre', texte: 'Ni recette solide ni performance marquante. Il y a mieux à décoder ailleurs.' };
}

// ── Mémoire partagée : dépôt d'une recette distillée ──
// Étiquettes lisibles des leviers (pour l'injection dans les autres modes).
const LEVIERS_LABEL = {
  hook_fort: 'hook fort', boucle_ouverte: 'boucle ouverte', cliffhanger: 'cliffhanger',
  deuxieme_personne: 'adresse à la 2e personne', details_concrets: 'détails concrets',
  escalade: 'escalade', question_rhetorique: 'question rhétorique', archetypes: 'archétypes'
};
// Best-effort, anonymisé : on n'envoie QUE du distillé (technique de hook,
// leviers, principes transposables, squelette sans verbatim), jamais le
// transcript ni le pseudo. Le serveur re-vérifie le garde-fou (score >= 90 +
// perf réelle) avant d'écrire. Ne bloque jamais l'utilisateur.
function _deposerPatternViral(d) {
  try {
    if (!d) return;
    const note = scoreViraliteRecette(d.signaux);
    if (!note || note.score < SEUIL_MEMOIRE) return;       // garde-fou côté client
    if (!performanceForte(d.stats)) return;                // perf réelle exigée
    const portee = porteeViral(d.stats);
    const leviers = SIGNAUX_VIRAL.filter(k => d.signaux && d.signaux[k] === true).map(k => LEVIERS_LABEL[k] || k);
    const principes = (Array.isArray(d.a_reprendre) ? d.a_reprendre : [])
      .map(p => ({ titre: (p && p.titre) || '', detail: (p && p.detail) || '' }));
    const squelette = (Array.isArray(d.recette) ? d.recette : [])
      .map(r => ({ temps: (r && r.temps) || '', titre: (r && r.titre) || '' }));  // pas de detail : zéro verbatim
    const corps = {
      niche: d.niche || '', hook_technique: (d.hook && d.hook.technique) || '',
      leviers, principes, squelette, score: note.score,
      portee: portee ? portee.ratio : null,
      engagement: _tauxEngagementViral(d.stats),
      langue: d.langue || null
    };
    fetch('/api/patterns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
    }).catch(() => {});   // silencieux : la mémoire ne doit jamais gêner l'utilisateur
  } catch (e) { /* jamais bloquant */ }
}
// Anime l'anneau du score (même mécanique que l'audit / le sommaire).
function animerScoreViral(valeur, circonference) {
  const numEl = document.getElementById('viralScoreNum');
  const ringEl = document.getElementById('viralRingFill');
  if (valeur == null || Number.isNaN(valeur)) { if (numEl) numEl.textContent = '·'; return; }
  const cible = Math.max(0, Math.min(100, valeur));
  const offsetFinal = circonference * (1 - cible / 100);
  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduit) { if (numEl) numEl.textContent = cible; if (ringEl) ringEl.style.strokeDashoffset = offsetFinal; return; }
  if (ringEl) requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offsetFinal; });
  const debut = performance.now();
  (function tick(t) {
    const p = Math.min(1, (t - debut) / 1300);
    if (numEl) numEl.textContent = Math.round(cible * p);
    if (p < 1) requestAnimationFrame(tick);
  })(debut);
}

// Rendu du rapport (nouvelle analyse OU réouverture depuis l'historique).
function afficherRapportViral(d) {
  const res = document.getElementById('viralAnaResults');
  if (!res || !d) return;
  _viralRapport = d;
  const texteRapport = _texteRapportViral(d); // pour les boutons Copier / Partager
  const form = document.getElementById('viralAnaForm');
  if (form) form.style.display = 'none';

  const hook = d.hook || {};
  const recette = Array.isArray(d.recette) ? d.recette : [];
  const facteurs = Array.isArray(d.pourquoi_viral) ? d.pourquoi_viral.filter(Boolean) : [];
  const reprendre = Array.isArray(d.a_reprendre) ? d.a_reprendre : [];

  // Score de viralité + vraies stats.
  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;
  const note = scoreViraliteRecette(d.signaux);
  const score = note ? note.score : null;
  const pal = (typeof paletteScoreAudit === 'function') ? paletteScoreAudit(score) : { ringA: '#E2C87A', ringB: '#c9a84c', texte: '#E2C87A' };
  const taux = _tauxEngagementViral(d.stats);
  const portee = porteeViral(d.stats);
  // Ligne 1 : vues + engagement. Ligne 2 : portée (le vrai signal), si connue.
  const statsLigne = (d.stats && d.stats.vues)
    ? `<div class="viral-stats-row">${_fmtVuesViral(d.stats.vues)} vues${taux != null ? ` · ${String(taux).replace('.', ',')}% d'engagement` : ''}${portee ? ` · portée ${portee.affiche} son audience` : ''}</div>` : '';
  const niveauTxt = note ? `${note.leviers >= 6 ? 'Recette très solide' : note.leviers >= 4 ? 'Recette solide' : 'Recette correcte'} · ${note.leviers} leviers viraux` : '';
  const scoreCardHtml = score != null ? `
    <div class="score-card audit-score-card ds-score-card">
      <div class="audit-score-label">SCORE DE VIRALITÉ</div>
      <div class="audit-ring-wrap">
        <svg class="audit-ring" viewBox="0 0 170 170">
          <defs><linearGradient id="viralRingGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${pal.ringA}"/><stop offset="100%" stop-color="${pal.ringB}"/></linearGradient></defs>
          <circle class="audit-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="audit-ring-fill" id="viralRingFill" cx="85" cy="85" r="${RING_R}" stroke="url(#viralRingGrad)" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"/>
        </svg>
        <div class="audit-ring-center"><div class="audit-score-num" style="color:${pal.texte}"><span id="viralScoreNum">0</span><span class="audit-score-suffix">/100</span></div></div>
      </div>
      ${statsLigne}
      ${niveauTxt ? `<div class="ds-sante-row"><span class="ds-tag ds-tag-ok">${niveauTxt}</span></div>` : ''}
    </div>` : '';

  // Verdict croisé Recette × Performance : recette reproductible, coup de
  // chance, ou structure bridée. Répond à « est-ce une vraie recette ou du bol ».
  const verdict = verdictCroiseViral(score, d.stats);
  const tagClasse = verdict.ton === 'ok' ? 'ds-tag-ok' : verdict.ton === 'alerte' ? 'ds-tag-alert' : 'ds-tag';
  const verdictHtml = `
    <div class="score-card viral-verdict viral-verdict-${verdict.ton}">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Recette ou coup de chance ?</div>
        <span class="ds-tag ${tagClasse}">${viralEsc(verdict.titre)}</span>
      </div>
      <p class="audit-diag-constat" style="margin-top:10px">${viralEsc(verdict.texte)}</p>
    </div>`;

  const sujetHtml = d.sujet ? `
    <div class="score-card">
      <div class="audit-section-label">Le sujet & l'angle</div>
      <p class="audit-diag-constat" style="margin-top:16px">${viralEsc(d.sujet)}</p>
    </div>` : '';

  const hookHtml = (hook.technique || hook.verbatim) ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Le hook</div>
        <span class="ds-tag ds-tag-alert">🎯 ${viralEsc(hook.technique || 'Accroche')}</span>
      </div>
      ${hook.verbatim ? `<p class="ds-bio-actuelle">« ${viralEsc(hook.verbatim)} »</p>` : ''}
      ${hook.pourquoi ? `<p class="audit-diag-constat" style="margin-top:8px">${viralEsc(hook.pourquoi)}</p>` : ''}
    </div>` : '';

  const recetteHtml = recette.length ? `
    <div class="score-card">
      <div class="audit-section-label">La recette, temps par temps</div>
      <ul class="viral-list">
        ${recette.map(r => `<li>
          <div class="viral-list-head"><span class="viral-moment">${viralEsc(r.temps || '')}</span><span class="viral-tech">${viralEsc(r.titre || '')}</span></div>
          ${r.detail ? `<p>${viralEsc(r.detail)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </div>` : '';

  const facteursHtml = facteurs.length ? `
    <div class="score-card ds-evolution pivot">
      <div class="audit-section-label">Pourquoi ça a percé</div>
      <ul class="ds-niche-analyse">${facteurs.map(f => `<li>${viralEsc(f)}</li>`).join('')}</ul>
    </div>` : '';

  const reprendreHtml = reprendre.length ? `
    <div class="score-card">
      <div class="audit-section-label">Ce que tu peux reprendre</div>
      <ol class="ds-leviers-list">
        ${reprendre.map(l => `<li><b>${viralEsc(l.titre || '')}</b><p>${viralEsc(l.detail || '')}</p></li>`).join('')}
      </ol>
    </div>` : '';

  res.innerHTML = `
    ${scoreCardHtml}
    ${verdictHtml}
    ${sujetHtml}
    ${hookHtml}
    ${recetteHtml}
    ${facteursHtml}
    ${reprendreHtml}

    <div class="sb-actions-fin">
      <button class="icon-btn" title="Copier l'analyse" onclick="copyText(this, '${storeCopyText(texteRapport)}')">${ICON_COPY}</button>
      <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(texteRapport)}')">${ICON_SHARE}</button>
    </div>

    <div class="ds-alt" style="margin-top:8px">
      <p style="margin:0 0 14px">Tu as la recette. Passe à l'action : Scriptura peut <strong>t'écrire un script</strong> qui réutilise cette structure sur TON sujet.</p>
      <button class="btn-generate" onclick="creerScriptDepuisViral()">Créer un script à partir de ça →</button>
    </div>
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="analyserAutreVideoVirale()">Analyser une autre vidéo</button>`;

  res.style.display = 'block';
  if (score != null) setTimeout(() => animerScoreViral(score, RING_C), 50);
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Construit le rapport en texte lisible (pour les boutons Copier / Partager,
// mêmes icônes que les autres modes, voir afficherRapportViral).
function _texteRapportViral(d) {
  d = d || {};
  const lignes = [];
  const note = scoreViraliteRecette(d.signaux);
  if (note) {
    let entete = 'SCORE DE VIRALITÉ : ' + note.score + '/100 (' + note.leviers + ' leviers viraux)';
    if (d.stats && d.stats.vues) {
      const taux = _tauxEngagementViral(d.stats);
      const portee = porteeViral(d.stats);
      entete += '\n' + _fmtVuesViral(d.stats.vues) + ' vues' + (taux != null ? ' · ' + String(taux).replace('.', ',') + "% d'engagement" : '');
      if (portee) entete += ' · portée ' + portee.affiche + ' son audience';
    }
    lignes.push(entete);
    const verdict = verdictCroiseViral(note.score, d.stats);
    lignes.push('\nVERDICT : ' + verdict.titre + '. ' + verdict.texte);
  }
  if (d.sujet) lignes.push('\nSUJET : ' + d.sujet);
  if (d.hook) lignes.push('\nHOOK (' + (d.hook.technique || '') + ') : ' + (d.hook.verbatim || '') + '\n' + (d.hook.pourquoi || ''));
  if (Array.isArray(d.recette) && d.recette.length) {
    lignes.push('\nLA RECETTE, TEMPS PAR TEMPS :');
    d.recette.forEach(r => lignes.push('- [' + (r.temps || '') + '] ' + (r.titre || '') + (r.detail ? ' : ' + r.detail : '')));
  }
  if (Array.isArray(d.pourquoi_viral) && d.pourquoi_viral.length) {
    lignes.push('\nPOURQUOI ÇA A PERCÉ :');
    d.pourquoi_viral.forEach(f => lignes.push('- ' + f));
  }
  if (Array.isArray(d.a_reprendre) && d.a_reprendre.length) {
    lignes.push('\nCE QUE TU PEUX REPRENDRE :');
    d.a_reprendre.forEach(l => lignes.push('- ' + (l.titre || '') + ' : ' + (l.detail || '')));
  }
  return lignes.join('\n');
}

// Handoff vers le flux Script : réutilise le pipeline existant « analyser une
// vidéo virale et recréer sa recette » (le transcript est déjà en main), en
// pré-remplissant l'état et le champ, puis en déposant l'utilisateur sur le
// formulaire (étape 4) où il n'a plus qu'à indiquer SON sujet.
function creerScriptDepuisViral() {
  if (typeof chooseMode !== 'function') return;
  chooseMode('script'); // ouvre le flux Script (empile l'écran actuel)
  if (typeof state === 'object' && state) {
    state.depart = 'analyser une vidéo virale et recréer sa recette';
    if (!state.objectif) state.objectif = 'Faire plus de vues et maximiser la portée';
    if (!state.plateforme) state.plateforme = 'TikTok';
  }
  if (typeof showStep === 'function') showStep(4);
  if (typeof renderSummary === 'function') renderSummary(); // affiche le champ vidéo virale
  const champ = document.getElementById('viralVideo');
  if (champ) { champ.value = _viralTranscript || ''; champ.dispatchEvent(new Event('input', { bubbles: true })); }
  const sujet = document.getElementById('sujet');
  if (sujet) setTimeout(() => sujet.focus(), 200);
}

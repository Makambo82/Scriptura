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

  try {
    // 1) Transcript : depuis le lien en priorité, sinon le texte collé.
    let description = '';
    let statsVideo = null; // vraies stats de la vidéo (vues/likes…), pour le score
    if (lien) {
      if (note) note.textContent = 'On écoute la vidéo et on la transcrit ☕…';
      try {
        const data = await _transcriptDepuisLien(lien);
        statsVideo = data.stats || null;
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
- LE HOOK : la ou les toutes premières phrases réelles, la technique, pourquoi ça arrête le scroll.
- LA RECETTE, TEMPS PAR TEMPS : reconstitue le déroulé chronologique en 4 à 6 TEMPS maximum (fusionne structure et rétention : chaque temps = un procédé + le ressort d'attention qu'il crée). Ancre chaque temps dans le contenu réel.
- POURQUOI ÇA A PERCÉ : 3 à 4 facteurs MAJEURS et déterminants seulement (les plus forts, pas une liste exhaustive).
- CE QUE TU PEUX REPRENDRE : 3 à 4 leviers TRANSPOSABLES, formulés comme des RECETTES réutilisables sur N'IMPORTE QUEL sujet (ex. « ouvre par une équation binaire X/Y », pas « parle de Sarkozy »).
- SIGNAUX : pour chaque levier viral, dis honnêtement si CETTE vidéo l'emploie vraiment (true) ou pas (false). Ils servent à noter la vidéo, sois rigoureux.

RÈGLE DE FORMAT DES NOMBRES : écris les nombres normalement, jamais de séparateur anglo-saxon. N'emploie jamais de tiret cadratin.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises autour. Structure EXACTE :
{
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

  } catch (e) {
    err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    err.style.display = 'block';
    if (note) note.textContent = "Colle le lien de partage (TikTok). Pas de lien ? Ouvre le repli et colle le texte de la vidéo.";
  } finally {
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
  const statsLigne = (d.stats && d.stats.vues)
    ? `<div class="viral-stats-row">${_fmtVuesViral(d.stats.vues)} vues${taux != null ? ` · ${String(taux).replace('.', ',')}% d'engagement` : ''}</div>` : '';
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
      entete += '\n' + _fmtVuesViral(d.stats.vues) + ' vues' + (taux != null ? ' · ' + String(taux).replace('.', ',') + "% d'engagement" : '');
    }
    lignes.push(entete);
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

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
    if (lien) {
      if (note) note.textContent = 'On écoute la vidéo et on la transcrit ☕…';
      try {
        const data = await _transcriptDepuisLien(lien);
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

    // 2) Décodage par l'IA.
    const prompt = `Tu es Scriptura, expert TikTok. On te donne le CONTENU d'une vidéo virale (transcript des sous-titres, et éventuellement sa description). Décode PRÉCISÉMENT et honnêtement ce qui l'a rendue virale, du hook jusqu'à la fin. Base-toi UNIQUEMENT sur le contenu fourni, n'invente aucune statistique ni aucun élément absent.

${description ? 'DESCRIPTION : ' + description + '\n\n' : ''}TRANSCRIPT DE LA VIDÉO :
${texte.slice(0, 6000)}

Analyse comme un monteur/scénariste pro : le HOOK (la ou les premières secondes) et pourquoi il arrête le scroll ; les techniques de RÉTENTION qui maintiennent l'attention (boucles ouvertes, tension, questions, cliffhangers, révélations progressives, rythme) et OÙ elles interviennent ; le SUJET réel et l'angle ; la STRUCTURE étape par étape ; et LES FACTEURS qui expliquent la viralité. Termine par ce que le créateur peut RÉUTILISER concrètement sur ses propres sujets.

RÈGLE DE FORMAT DES NOMBRES : écris les nombres normalement, jamais de séparateur anglo-saxon. N'emploie jamais de tiret cadratin.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises autour. Structure EXACTE :
{
  "sujet": "<le sujet réel de la vidéo + l'angle, 1-2 phrases>",
  "hook": { "technique": "<nom court de la technique d'accroche>", "verbatim": "<la ou les toutes premières phrases réelles du transcript>", "pourquoi": "<pourquoi ça arrête le scroll, 1-2 phrases>" },
  "retention": [ { "moment": "<ex: 0-3s / milieu / avant la fin>", "technique": "<nom court>", "detail": "<comment c'est fait dans CETTE vidéo, 1 phrase>" } ],
  "structure": [ { "etape": "<Hook | Mise en tension | Développement | Twist | Chute/CTA | ...>", "role": "<ce que cette étape provoque, 1 phrase>" } ],
  "pourquoi_viral": [ "<facteur 1>", "<facteur 2>", "<facteur 3>" ],
  "a_reprendre": [ { "titre": "<max 8 mots>", "detail": "<comment appliquer ce ressort à TES propres sujets, 1-2 phrases>" } ]
}`;

    const raw = await callAI(MODEL_CREATIF, 3000, prompt);
    const rapport = parseAIResponse(raw);
    if (!rapport || (!rapport.hook && !rapport.structure)) {
      throw new Error("Analyse illisible, réessaie dans un instant.");
    }
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

// Rendu du rapport (nouvelle analyse OU réouverture depuis l'historique).
function afficherRapportViral(d) {
  const res = document.getElementById('viralAnaResults');
  if (!res || !d) return;
  _viralRapport = d;
  const form = document.getElementById('viralAnaForm');
  if (form) form.style.display = 'none';

  const hook = d.hook || {};
  const retention = Array.isArray(d.retention) ? d.retention : [];
  const structure = Array.isArray(d.structure) ? d.structure : [];
  const facteurs = Array.isArray(d.pourquoi_viral) ? d.pourquoi_viral.filter(Boolean) : [];
  const reprendre = Array.isArray(d.a_reprendre) ? d.a_reprendre : [];

  const hookHtml = (hook.technique || hook.verbatim) ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Le hook</div>
        <span class="ds-tag ds-tag-alert">🎯 ${viralEsc(hook.technique || 'Accroche')}</span>
      </div>
      ${hook.verbatim ? `<p class="ds-bio-actuelle">« ${viralEsc(hook.verbatim)} »</p>` : ''}
      ${hook.pourquoi ? `<p class="audit-diag-constat" style="margin-top:8px">${viralEsc(hook.pourquoi)}</p>` : ''}
    </div>` : '';

  const retentionHtml = retention.length ? `
    <div class="score-card">
      <div class="audit-section-label">Techniques de rétention</div>
      <ul class="viral-list">
        ${retention.map(r => `<li>
          <div class="viral-list-head"><span class="viral-moment">${viralEsc(r.moment || '')}</span><span class="viral-tech">${viralEsc(r.technique || '')}</span></div>
          ${r.detail ? `<p>${viralEsc(r.detail)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </div>` : '';

  const structureHtml = structure.length ? `
    <div class="score-card">
      <div class="audit-section-label">Structure, du début à la fin</div>
      <ol class="viral-structure">
        ${structure.map(s => `<li><b>${viralEsc(s.etape || '')}</b>${s.role ? ` : ${viralEsc(s.role)}` : ''}</li>`).join('')}
      </ol>
    </div>` : '';

  const sujetHtml = d.sujet ? `
    <div class="score-card">
      <div class="audit-section-label">Le sujet & l'angle</div>
      <p class="audit-diag-constat">${viralEsc(d.sujet)}</p>
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
    <div class="score-card audit-score-card">
      <div class="audit-score-label">ANALYSE VIRALE</div>
      <p class="audit-diag-constat" style="text-align:center;margin-top:6px">${viralEsc(d.sujet || 'Recette décodée')}</p>
    </div>
    ${hookHtml}
    ${retentionHtml}
    ${structureHtml}
    ${sujetHtml}
    ${facteursHtml}
    ${reprendreHtml}

    <div class="ds-alt" style="margin-top:8px">
      <p style="margin:0 0 14px">Tu as la recette. Passe à l'action : Scriptura peut <strong>t'écrire un script</strong> qui réutilise cette structure sur TON sujet.</p>
      <button class="btn-generate" onclick="creerScriptDepuisViral()">Créer un script à partir de ça →</button>
      <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="copierStructureVirale(this)">Copier la structure</button>
    </div>
    <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:12px" onclick="analyserAutreVideoVirale()">Analyser une autre vidéo</button>`;

  res.style.display = 'block';
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Copie le rapport en texte lisible.
function copierStructureVirale(btn) {
  const d = _viralRapport || {};
  const lignes = [];
  if (d.sujet) lignes.push('SUJET : ' + d.sujet);
  if (d.hook) lignes.push('\nHOOK (' + (d.hook.technique || '') + ') : ' + (d.hook.verbatim || '') + '\n' + (d.hook.pourquoi || ''));
  if (Array.isArray(d.retention) && d.retention.length) {
    lignes.push('\nRÉTENTION :');
    d.retention.forEach(r => lignes.push('- [' + (r.moment || '') + '] ' + (r.technique || '') + ' : ' + (r.detail || '')));
  }
  if (Array.isArray(d.structure) && d.structure.length) {
    lignes.push('\nSTRUCTURE :');
    d.structure.forEach((s, i) => lignes.push((i + 1) + '. ' + (s.etape || '') + ' : ' + (s.role || '')));
  }
  if (Array.isArray(d.pourquoi_viral) && d.pourquoi_viral.length) {
    lignes.push('\nPOURQUOI VIRAL :');
    d.pourquoi_viral.forEach(f => lignes.push('- ' + f));
  }
  if (Array.isArray(d.a_reprendre) && d.a_reprendre.length) {
    lignes.push('\nÀ REPRENDRE :');
    d.a_reprendre.forEach(l => lignes.push('- ' + (l.titre || '') + ' : ' + (l.detail || '')));
  }
  const texte = lignes.join('\n');
  if (typeof copyText === 'function' && typeof storeCopyText === 'function') {
    copyText(btn, storeCopyText(texte));
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(texte);
    if (btn) { const l = btn.textContent; btn.textContent = '✓ Copié !'; setTimeout(() => btn.textContent = l, 2000); }
  }
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

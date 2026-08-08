// ═══════════════════════════════════════════════════════════
//  MODULE DIAGNOSTIC SOMMAIRE — analyse via @nom d'utilisateur TikTok
//  Alternative légère au diagnostic complet par captures (js/audit.js) :
//  aucune capture à envoyer, le profil PUBLIC + les dernières vidéos sont
//  lus via un service tiers (LamaTok, voir api/username-scan.js).
//  Structure d'analyse inspirée de Vervox (score, 4 dimensions, bio,
//  niche, leviers prioritaires, analyse détaillée), rendue avec la palette
//  Scriptura (doré + émeraude pour les points forts — même mécanique que
//  l'anneau de score du diagnostic complet).
//  Moins riche que l'audit complet (pas de rétention, pas de sources de
//  trafic — données non publiques), mais accessible dès le palier Creator,
//  et une fois gratuitement pour les non-abonnés.
// ═══════════════════════════════════════════════════════════

// Prépare l'écran de choix pour une nouvelle analyse (efface le champ,
// les erreurs et un éventuel résultat précédent encore affiché).
function resetDiagnosticSommaireForm() {
  const input = document.getElementById('diagSommaireInput');
  if (input) input.value = '';
  const err = document.getElementById('diagSommaireErrorBox');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const results = document.getElementById('diagSommaireResults');
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
}

// « Envoie tes captures » depuis l'écran de choix : bascule vers le
// diagnostic complet existant (js/audit.js), qui reste réservé au Pro
// (ou aux jetons) — même vérification qu'avant la refonte de l'écran d'entrée.
async function ouvrirCapturesDepuisChoix() {
  if (!aAccesMode('audit')) {
    const jetonsDispo = await lireJetonsAudit();
    if (jetonsDispo <= 0) {
      openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne');
      return;
    }
  }
  const dsf = document.getElementById('diagSommaireFlow');
  if (dsf) dsf.style.display = 'none';
  const af = document.getElementById('auditFlow');
  if (af) af.style.display = 'block';
  if (typeof initAuditWizard === 'function') initAuditWizard(false);
}

function diagSommaireEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

async function lancerDiagnosticSommaire() {
  const inputEl = document.getElementById('diagSommaireInput');
  const errorBox = document.getElementById('diagSommaireErrorBox');
  const btn = document.getElementById('diagSommaireGoBtn');
  const spinner = document.getElementById('diagSommaireSpinner');
  const arrow = document.getElementById('diagSommaireGoArrow');
  const results = document.getElementById('diagSommaireResults');

  errorBox.style.display = 'none';
  const brut = (inputEl.value || '').trim();
  const username = brut.replace(/^@+/, '');

  if (!username || !/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    errorBox.textContent = "Entre un nom d'utilisateur TikTok valide (lettres, chiffres, points, underscores).";
    errorBox.style.display = 'block';
    return;
  }

  if (!(await peutFaireDiagnosticSommaire())) return;

  btn.disabled = true;
  spinner.style.display = 'block';
  arrow.style.display = 'none';
  results.style.display = 'none';

  try {
    // 1) Récupère profil + dernières vidéos via notre fonction serveur
    //    (clé LamaTok jamais exposée au navigateur).
    const rep = await fetch('/api/username-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const donnees = await rep.json();
    if (!rep.ok) {
      throw new Error(donnees?.error?.message || "Profil introuvable. Vérifie l'orthographe, ou envoie tes captures pour l'analyse complète.");
    }

    // 2) Transmet les données brutes à l'IA : le nom exact des champs
    //    dépend du service tiers, donc c'est l'IA qui les identifie par
    //    leur sens plutôt qu'un parsing rigide côté code (plus robuste si
    //    LamaTok fait évoluer sa réponse).
    const nbVideos = Array.isArray(donnees.medias) ? donnees.medias.length : 0;
    const prompt = `Tu es Scriptura, consultant TikTok pour créateurs francophones. On te donne les données PUBLIQUES brutes d'un profil TikTok (@${username}) et de ses ${nbVideos || 0} dernières vidéos, au format JSON, récupérées via une API tierce. Le nom exact des champs peut varier légèrement selon le service : identifie-les par leur sens (abonnés, abonnements, likes cumulés, nombre de vidéos, bio, statut vérifié ; par vidéo : vues, likes, commentaires, partages, date de publication, légende/description).

PROFIL :
${JSON.stringify(donnees.profil || {}).slice(0, 4000)}

DERNIÈRES VIDÉOS (peut être vide si indisponible : ${donnees.medias_erreur || 'aucune erreur signalée'}) :
${JSON.stringify(donnees.medias || []).slice(0, 8000)}

RÈGLE ABSOLUE D'HONNÊTETÉ : n'utilise QUE ce qui est réellement présent dans ces données. Si les vidéos sont absentes ou insuffisantes pour juger une dimension, marque cette dimension "disponible": false, score à 0, et dis-le dans le constat au lieu d'inventer. Ce diagnostic est SOMMAIRE : il n'a accès qu'à des statistiques publiques de surface (pas de rétention, pas de sources de trafic, pas de courbe de visionnage par vidéo) — ne prétends jamais avoir plus d'information que ça.

CALCUL DES 4 DIMENSIONS (barème sur 100 au total, additionne les 4 scores pour score_global — ne donne jamais un score_global qui ne soit pas la somme exacte des 4) :
1. ENGAGEMENT (sur 30) : (likes+commentaires+partages) / vues, moyenné sur les vidéos disponibles. Compare implicitement à la moyenne TikTok habituelle (3-5%) dans ton constat, en termes clairs, sans jargon statistique.
2. PORTÉE (sur 30) : vues moyennes des vidéos rapportées au nombre d'abonnés. Un ratio élevé (vues moyennes proches ou supérieures aux abonnés) signale que le contenu sort de la seule base d'abonnés (bonne distribution algorithmique) ; un ratio faible signale une portée limitée à l'audience existante.
3. RÉGULARITÉ (sur 20) : fréquence et régularité de publication déduites des dates des vidéos fournies (rythme hebdomadaire, écarts entre publications). Un rythme régulier note haut ; des trous longs ou irréguliers notent bas.
4. VIRALITÉ (sur 20) : présence de vidéos qui dépassent largement la moyenne du compte (pics). Note haute si au moins une vidéo sort nettement du lot ; note basse si les performances sont plates sans aucun pic.

SANTÉ DU COMPTE : une appréciation globale en un mot ("Excellente", "Bonne", "Fragile" ou "Critique") cohérente avec score_global.

BIO : évalue la bio actuelle du profil. Est-elle claire, spécifique, révèle-t-elle vraiment ce que fait ce compte ? Si elle est générique ou vague, propose EXACTEMENT 2 alternatives courtes et percutantes, dans le même esprit que la bio actuelle mais plus révélatrices de la valeur du compte.

NICHE : identifie la niche/thématique dominante de ce compte à partir des légendes des vidéos et de la bio. Dis si elle est claire (un positionnement net et cohérent) ou floue (le compte mélange plusieurs sujets ou identités sans lien clair, ce qui dilue l'algorithme et l'audience). Donne 1 à 3 points d'analyse concrets sur ce positionnement (chevauchement de sujets, opportunité de sous-niche moins concurrentielle, etc.), uniquement si les données le permettent.

LEVIERS PRIORITAIRES : exactement 3 actions concrètes et réalisables, classées de la plus prioritaire à la moins prioritaire, chacune fondée sur ce que tu observes réellement dans CES données (jamais une généralité applicable à n'importe quel compte).

ANALYSE DÉTAILLÉE (aperçu chiffré, pas de texte) : parmi les vidéos fournies, compte combien se distinguent nettement au-dessus de la moyenne du compte (top) et combien nettement en dessous (flop), combien de thèmes/concepts distincts reviennent plusieurs fois, et combien de formats différents (ex: storytelling, liste, avis, tuto) sont représentés.

RÈGLE DE FORMAT DES NOMBRES : dans tes phrases, écris les nombres normalement (ex: "12 400 abonnés"), jamais de séparateur anglo-saxon.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
{
  "profil_trouve": <true si les données décrivent bien un profil existant, false sinon>,
  "score_global": <0-100, somme exacte des 4 scores ci-dessous>,
  "niveau": "<Excellent|Très bon|Bon|Moyen|À travailler, cohérent avec score_global>",
  "emoji": "<un seul emoji pertinent illustrant le niveau>",
  "tagline": "<1 phrase courte et encourageante ou lucide selon le score>",
  "sante_compte": "<Excellente|Bonne|Fragile|Critique>",
  "dimensions": {
    "engagement": { "score": <0-30>, "disponible": <true/false>, "constat": "<1-2 phrases>" },
    "portee": { "score": <0-30>, "disponible": <true/false>, "constat": "<1-2 phrases>" },
    "regularite": { "score": <0-20>, "disponible": <true/false>, "constat": "<1-2 phrases>" },
    "viralite": { "score": <0-20>, "disponible": <true/false>, "constat": "<1-2 phrases>" }
  },
  "bio": { "actuelle": "<texte tel quel, ou null>", "etat": "<claire|a_retravailler>", "critique": "<1-2 phrases>", "suggestions": ["<alternative 1>", "<alternative 2>"] },
  "niche": { "nom": "<...>", "etat": "<claire|floue>", "analyse": ["<point 1>", "<point 2 si pertinent>"] },
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<1-2 phrases>" } ],
  "analyse_detaillee": { "top_videos": <nombre>, "flop_videos": <nombre>, "concepts_recurrents": <nombre>, "formats_representes": <nombre> }
}`;

    const raw = await callAI(MODEL_RAPIDE, 2500, prompt);
    const parsed = parseAIResponse(raw);
    if (!parsed || parsed.profil_trouve === false) {
      throw new Error("Profil introuvable ou privé. Vérifie l'orthographe du nom d'utilisateur.");
    }

    // 3) Décompte du quota : non-abonné → marque son unique usage gratuit
    // consommé (en plus de son compteur de générations gratuites partagé).
    if (!unlocked) {
      localStorage.setItem('scriptura_diag_sommaire_utilise', 'true');
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      renderGenCounter();
      checkRappelAbonnement();
    }

    const titre = 'Diagnostic rapide · @' + username;
    saveGeneration('diagnosticSommaire', titre, { username: username, diagnostic: parsed });
    if (typeof updateQuotaJour === 'function') updateQuotaJour();

    afficherDiagnosticSommaireResultat(parsed, username);

  } catch (e) {
    errorBox.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    errorBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    arrow.style.display = '';
  }
}

// Anime l'anneau de score + le chiffre qui monte — même mécanique que
// js/audit.js (animerScoreAudit), sur des identifiants distincts (dsRingFill
// / dsScoreNum) puisque les deux écrans ont chacun leur propre anneau.
function animerScoreDiagSommaire(valeur, circonference) {
  const numEl = document.getElementById('dsScoreNum');
  const ringEl = document.getElementById('dsRingFill');
  if (valeur == null || Number.isNaN(valeur)) {
    if (numEl) numEl.textContent = '—';
    return;
  }
  const cible = Math.max(0, Math.min(100, valeur));
  const offsetFinal = circonference * (1 - cible / 100);

  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduit) {
    if (numEl) numEl.textContent = cible;
    if (ringEl) ringEl.style.strokeDashoffset = offsetFinal;
    return;
  }

  if (ringEl) requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offsetFinal; });

  const duree = 1300;
  const debut = performance.now();
  function tick(maintenant) {
    const t = Math.min(1, (maintenant - debut) / duree);
    if (numEl) numEl.textContent = Math.round(cible * t);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const DS_DIM_META = {
  engagement: { icone: '📈', label: 'Engagement' },
  portee:     { icone: '👁️', label: 'Portée' },
  regularite: { icone: '📅', label: 'Régularité' },
  viralite:   { icone: '⚡', label: 'Viralité' }
};

// Affiche le résultat (nouvelle génération OU réouverture depuis l'historique).
function afficherDiagnosticSommaireResultat(d, username) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !d) return;

  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;
  const score = (typeof d.score_global === 'number' && !Number.isNaN(d.score_global)) ? Math.max(0, Math.min(100, d.score_global)) : null;
  const excellent = score != null && score >= 80;
  const ringColorA = excellent ? 'var(--emerald)' : 'var(--gold)';
  const ringColorB = excellent ? 'var(--emerald-light)' : 'var(--gold-light)';

  const dims = d.dimensions || {};
  const dimsHtml = Object.keys(DS_DIM_META).map(cle => {
    const meta = DS_DIM_META[cle];
    const dim = dims[cle] || {};
    const max = (cle === 'engagement' || cle === 'portee') ? 30 : 20;
    const bon = dim.disponible !== false && typeof dim.score === 'number' && (dim.score / max) >= 0.7;
    return `<div class="ds-dim-card">
      <div class="ds-dim-head">
        <span class="ds-dim-icon">${meta.icone}</span>
        <span class="ds-dim-name">${meta.label}</span>
        <span class="ds-dim-score${bon ? ' ds-dim-score-ok' : ''}">${dim.disponible === false ? '—' : (dim.score != null ? dim.score : '—') + '/' + max}</span>
      </div>
      <p class="ds-dim-text">${diagSommaireEsc(dim.constat)}</p>
    </div>`;
  }).join('');

  const bio = d.bio || {};
  const bioOk = bio.etat === 'claire';
  const bioHtml = bio.actuelle ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Ton profil</div>
        <span class="ds-tag${bioOk ? ' ds-tag-ok' : ''}">${bioOk ? 'Bio claire' : 'Bio à retravailler'}</span>
      </div>
      <p class="ds-bio-actuelle">« ${diagSommaireEsc(bio.actuelle)} »</p>
      <p class="audit-diag-constat" style="margin-top:10px">${diagSommaireEsc(bio.critique)}</p>
      ${Array.isArray(bio.suggestions) && bio.suggestions.length ? `
      <div class="audit-section-label" style="margin-top:18px">💡 Suggestions pour la bio</div>
      ${bio.suggestions.map(s => `<p class="ds-suggestion">${diagSommaireEsc(s)}</p>`).join('')}` : ''}
    </div>` : '';

  const niche = d.niche || {};
  const nicheOk = niche.etat === 'claire';
  const nicheHtml = niche.nom ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Ta niche</div>
        <span class="ds-tag${nicheOk ? ' ds-tag-ok' : ''}">${nicheOk ? 'Niche claire' : 'Niche encore floue'}</span>
      </div>
      <div class="audit-diag-constat">${diagSommaireEsc(niche.nom)}</div>
      ${Array.isArray(niche.analyse) && niche.analyse.length ? `<ul class="ds-niche-analyse">${niche.analyse.map(p => `<li>${diagSommaireEsc(p)}</li>`).join('')}</ul>` : ''}
    </div>` : '';

  const leviers = Array.isArray(d.leviers_prioritaires) ? d.leviers_prioritaires : [];
  const leviersHtml = leviers.length ? `
    <div class="score-card">
      <div class="audit-section-label">Tes leviers prioritaires</div>
      <ol class="ds-leviers-list">
        ${leviers.map(l => `<li><b>${diagSommaireEsc(l.titre)}</b><p>${diagSommaireEsc(l.detail)}</p></li>`).join('')}
      </ol>
    </div>` : '';

  const ad = d.analyse_detaillee || {};
  const adHtml = (ad.top_videos != null || ad.concepts_recurrents != null) ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Analyse détaillée</div>
        <span class="ds-tag ds-tag-ok">${unlocked ? (typeof monPalier === 'function' ? monPalier().toUpperCase() : '') : 'APERÇU'}</span>
      </div>
      <div class="ds-mini-stats">
        <div class="ds-mini-stat"><b>${ad.top_videos ?? '—'}↑ ${ad.flop_videos ?? '—'}↓</b><span>Top &amp; Flop vidéos</span></div>
        <div class="ds-mini-stat"><b>${ad.concepts_recurrents ?? '—'}</b><span>Concepts récurrents</span></div>
        <div class="ds-mini-stat"><b>${ad.formats_representes ?? '—'}</b><span>Formats représentés</span></div>
      </div>
    </div>` : '';

  const subscribeNote = (!unlocked) ? `
    <div class="ds-result-subscribe">✦ Ce diagnostic rapide est un aperçu. Pour que Scriptura te fasse des recommandations personnalisées et suive ton évolution dans le temps, <a onclick="openPlans('abonnement')" style="color:var(--gold-light);text-decoration:underline;cursor:pointer">abonne-toi</a>.</div>` : '';

  results.innerHTML = `
    <div class="score-card audit-score-card ds-score-card">
      <div class="audit-score-label">DIAGNOSTIC RAPIDE · @${diagSommaireEsc(username)}</div>
      <div class="audit-ring-wrap">
        <svg class="audit-ring" viewBox="0 0 170 170">
          <defs>
            <linearGradient id="dsRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${ringColorA}"/>
              <stop offset="100%" stop-color="${ringColorB}"/>
            </linearGradient>
          </defs>
          <circle class="audit-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="audit-ring-fill" id="dsRingFill" cx="85" cy="85" r="${RING_R}" stroke="url(#dsRingGrad)"
            stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"/>
        </svg>
        <div class="audit-ring-center">
          <div class="audit-score-num"${excellent ? ' style="color:var(--emerald-light)"' : ''}><span id="dsScoreNum">0</span><span>/100</span></div>
        </div>
      </div>
      ${d.niveau ? `<div class="ds-niveau-badge${excellent ? ' ds-niveau-badge-ok' : ''}">${diagSommaireEsc(d.niveau)}</div>` : ''}
      ${d.emoji || d.tagline ? `<div class="audit-score-phrase">${d.emoji ? diagSommaireEsc(d.emoji) + ' ' : ''}${diagSommaireEsc(d.tagline)}</div>` : ''}
    </div>

    <div class="ds-dims-grid">${dimsHtml}</div>

    ${d.sante_compte ? `<div class="ds-sante-row"><span class="ds-tag${excellent ? ' ds-tag-ok' : ''}">Santé du compte : ${diagSommaireEsc(d.sante_compte)}</span></div>` : ''}

    ${bioHtml}
    ${nicheHtml}
    ${leviersHtml}
    ${adHtml}

    <div class="score-card">
      ${subscribeNote}
      <button class="btn-generate" style="width:100%;justify-content:center;margin-top:${subscribeNote ? '14px' : '0'}" onclick="resetDiagnosticSommaireForm()">↻ Analyser un autre compte</button>
    </div>`;

  results.style.display = 'block';
  if (score != null) setTimeout(() => animerScoreDiagSommaire(score, RING_C), 50);
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

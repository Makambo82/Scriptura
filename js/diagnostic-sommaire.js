// ═══════════════════════════════════════════════════════════
//  MODULE DIAGNOSTIC SOMMAIRE — analyse via @nom d'utilisateur TikTok
//  Alternative légère au diagnostic complet par captures (js/audit.js) :
//  aucune capture à envoyer, uniquement le PROFIL PUBLIC lu via un
//  service tiers (LamaTok, voir api/username-scan.js).
//
//  LIMITE STRUCTURELLE IMPORTANTE (vérifiée sur la documentation complète
//  de LamaTok) : ce service n'expose AUCUN endpoint pour lister les
//  vidéos d'un compte — seulement le profil agrégé. Sur les 4 dimensions
//  inspirées de Vervox (Engagement, Portée, Régularité, Viralité), seule
//  l'Engagement peut être approximée (grossièrement) à partir des totaux
//  du profil ; les 3 autres ont structurellement besoin de données par
//  vidéo qu'aucun profil public n'expose, et sont donc TOUJOURS affichées
//  comme non disponibles plutôt que de fabriquer un chiffre. Score
//  recalculé côté code (comme js/audit.js) sur les seules dimensions
//  réellement mesurées, jamais fourni tel quel par l'IA.
//
//  Rendu avec la palette Scriptura (doré + émeraude pour les points forts
//  — même mécanique que l'anneau de score du diagnostic complet).
//  Accessible dès le palier Creator, et une fois gratuitement pour les
//  non-abonnés.
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
    // Récupère le profil public via notre fonction serveur (clé LamaTok
    // jamais exposée au navigateur). Profil seul : voir note en tête de
    // fichier sur la limite structurelle de LamaTok (pas de liste de vidéos).
    const rep = await fetch('/api/username-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const donnees = await rep.json();
    if (!rep.ok) {
      throw new Error(donnees?.error?.message || "Profil introuvable. Vérifie l'orthographe, ou envoie tes captures pour l'analyse complète.");
    }

    // Le nom exact des champs dépend du service tiers : l'IA les identifie
    // par leur sens plutôt qu'un parsing rigide côté code.
    const prompt = `Tu es Scriptura, consultant TikTok pour créateurs francophones. On te donne les données PUBLIQUES brutes d'un profil TikTok (@${username}), au format JSON, récupérées via une API tierce. Le nom exact des champs peut varier : identifie-les par leur sens (abonnés, abonnements, likes cumulés reçus sur toutes les vidéos, nombre de vidéos publiées, bio, statut vérifié).

PROFIL :
${JSON.stringify(donnees.profil || {}).slice(0, 4000)}

RÈGLE ABSOLUE D'HONNÊTETÉ : n'utilise QUE ce qui est réellement présent dans ces données. Si un champ est absent, mets null / "disponible": false — n'invente jamais un chiffre.

LIMITE STRUCTURELLE DE CE DIAGNOSTIC (important) : tu n'as accès QU'à ce profil public agrégé, JAMAIS à la liste des vidéos individuelles (dates, vues par vidéo). Ne tente donc JAMAIS d'estimer la régularité de publication, la présence de pics viraux, ou les vues moyennes par vidéo : cette donnée n'existe simplement pas dans ce que tu reçois. Concentre-toi uniquement sur ce qui est calculable à partir des totaux du profil.

ENGAGEMENT (sur 30, seule dimension chiffrée de ce diagnostic) : si le nombre de likes cumulés ET le nombre de vidéos sont tous deux présents, calcule les likes moyens par vidéo (likes cumulés ÷ nombre de vidéos), puis juge si ce chiffre est proportionnellement élevé ou faible par rapport au nombre d'abonnés. Précise dans le constat que c'est une estimation grossière (pas le vrai taux d'engagement, qui nécessiterait les vues par vidéo). Si l'un des deux chiffres manque, "disponible": false et score null — n'estime rien à la place.

BIO : évalue la bio actuelle du profil. Est-elle claire, spécifique, révèle-t-elle vraiment ce que fait ce compte ? Si elle est générique ou vague, propose EXACTEMENT 2 alternatives courtes et percutantes, dans le même esprit mais plus révélatrices de la valeur du compte.

NICHE : identifie la niche/thématique dominante UNIQUEMENT à partir du texte de la bio (tu n'as pas accès aux vidéos, donc pas aux sujets réellement traités). Si la bio ne permet pas de trancher, "disponible": false plutôt que de deviner. Sinon, dis si le positionnement semble clair ou flou d'après ce que la bio annonce, avec 1 à 2 points d'analyse.

LEVIERS PRIORITAIRES : exactement 3 actions concrètes, fondées UNIQUEMENT sur ce que tu observes réellement dans ces données de profil (abonnés, vidéos, likes, bio) — jamais une supposition sur le contenu de vidéos que tu n'as pas vues.

SANTÉ DU COMPTE : une appréciation globale ("Excellente", "Bonne", "Fragile" ou "Critique") fondée sur les signaux réellement disponibles (taille d'audience, ratio likes/vidéos si calculable, clarté de la bio) — reste prudent si peu de données sont exploitables.

RÈGLE DE FORMAT DES NOMBRES : dans tes phrases, écris les nombres normalement (ex: "12 400 abonnés"), jamais de séparateur anglo-saxon.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
{
  "profil_trouve": <true si les données décrivent bien un profil existant, false sinon>,
  "compte_verifie": <true/false/null>,
  "engagement": { "score": <0-30 ou null>, "disponible": <true/false>, "constat": "<1-2 phrases>" },
  "sante_compte": "<Excellente|Bonne|Fragile|Critique>",
  "bio": { "actuelle": "<texte tel quel, ou null>", "etat": "<claire|a_retravailler>", "critique": "<1-2 phrases>", "suggestions": ["<alternative 1>", "<alternative 2>"] },
  "niche": { "disponible": <true/false>, "nom": "<...>", "etat": "<claire|floue>", "analyse": ["<point 1>", "<point 2 si pertinent>"] },
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<1-2 phrases>" } ]
}`;

    const raw = await callAI(MODEL_RAPIDE, 2000, prompt);
    const parsed = parseAIResponse(raw);
    if (!parsed || parsed.profil_trouve === false) {
      throw new Error("Profil introuvable ou privé. Vérifie l'orthographe du nom d'utilisateur.");
    }

    // Décompte du quota : non-abonné → marque son unique usage gratuit
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
  engagement: { icone: '📈', label: 'Engagement', max: 30 },
  portee:     { icone: '👁️', label: 'Portée', max: 30 },
  regularite: { icone: '📅', label: 'Régularité', max: 20 },
  viralite:   { icone: '⚡', label: 'Viralité', max: 20 }
};

// Ces 3 dimensions ont structurellement besoin de données par vidéo
// (dates, vues individuelles) qu'aucun profil public LamaTok n'expose —
// toujours non disponibles ici, jamais une estimation inventée.
const DS_TOUJOURS_INDISPONIBLE = {
  portee: "Non calculable avec un simple profil public : TikTok n'expose pas le nombre de vues par vidéo à cette échelle. Le diagnostic complet (captures) le permet.",
  regularite: "Non calculable sans la date de chaque vidéo, une donnée absente d'un profil public. Le diagnostic complet (captures) le permet.",
  viralite: "Non calculable sans pouvoir comparer tes vidéos entre elles individuellement — donnée indisponible via un simple profil public."
};

// Affiche le résultat (nouvelle génération OU réouverture depuis l'historique).
function afficherDiagnosticSommaireResultat(d, username) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !d) return;

  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;

  // Score recalculé ici, jamais fourni tel quel par l'IA (même principe que
  // js/audit.js) : ramené sur 100 à partir des SEULES dimensions mesurées.
  // Aujourd'hui, au mieux une seule (Engagement) — voir note en tête de fichier.
  const eng = d.engagement || {};
  const engMesurable = eng.disponible !== false && typeof eng.score === 'number' && !Number.isNaN(eng.score);
  const score = engMesurable ? Math.round((Math.max(0, Math.min(30, eng.score)) / 30) * 100) : null;
  const excellent = score != null && score >= 80;
  const ringColorA = excellent ? 'var(--emerald)' : 'var(--gold)';
  const ringColorB = excellent ? 'var(--emerald-light)' : 'var(--gold-light)';

  const dimsHtml = Object.keys(DS_DIM_META).map(cle => {
    const meta = DS_DIM_META[cle];
    const dim = (cle === 'engagement') ? eng : { disponible: false, constat: DS_TOUJOURS_INDISPONIBLE[cle] };
    const bon = dim.disponible !== false && typeof dim.score === 'number' && (dim.score / meta.max) >= 0.7;
    return `<div class="ds-dim-card">
      <div class="ds-dim-head">
        <span class="ds-dim-icon">${meta.icone}</span>
        <span class="ds-dim-name">${meta.label}</span>
        <span class="ds-dim-score${bon ? ' ds-dim-score-ok' : ''}">${dim.disponible === false ? '—' : (dim.score != null ? dim.score : '—') + '/' + meta.max}</span>
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
  const nicheHtml = (niche.disponible !== false && niche.nom) ? `
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
      <div class="audit-score-phrase">${engMesurable
        ? 'Calculé sur 1 dimension (Engagement) sur 4 — Portée, Régularité et Viralité nécessitent des données par vidéo qu\'un simple profil public ne fournit pas.'
        : 'Score non calculable : les données publiques de ce profil ne permettent d\'estimer aucune des 4 dimensions.'}</div>
    </div>

    <div class="ds-dims-grid">${dimsHtml}</div>

    ${d.sante_compte ? `<div class="ds-sante-row"><span class="ds-tag${excellent ? ' ds-tag-ok' : ''}">Santé du compte : ${diagSommaireEsc(d.sante_compte)}</span></div>` : ''}

    ${bioHtml}
    ${nicheHtml}
    ${leviersHtml}

    <div class="score-card">
      ${subscribeNote}
      <button class="btn-generate" style="width:100%;justify-content:center;margin-top:${subscribeNote ? '14px' : '0'}" onclick="resetDiagnosticSommaireForm()">↻ Analyser un autre compte</button>
    </div>`;

  results.style.display = 'block';
  setTimeout(() => animerScoreDiagSommaire(score, RING_C), 50);
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

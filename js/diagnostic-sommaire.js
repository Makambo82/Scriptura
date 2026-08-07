// ═══════════════════════════════════════════════════════════
//  MODULE DIAGNOSTIC SOMMAIRE — analyse via @nom d'utilisateur TikTok
//  Alternative légère au diagnostic complet par captures (js/audit.js) :
//  aucune capture à envoyer, juste le profil PUBLIC lu via un service tiers
//  (LamaTok, voir api/username-scan.js). Moins riche que l'audit complet
//  (pas de rétention, pas de sources de trafic — données non publiques),
//  mais accessible dès le palier Creator, et une fois gratuitement pour
//  les non-abonnés.
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

// Formate un nombre à l'affichage (ex: 12 400 → "12,4 K") — cohérence
// visuelle avec les compteurs TikTok eux-mêmes.
function diagSommaireFormatNombre(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace('.0', '').replace('.', ',') + ' M';
  if (v >= 1000) return (v / 1000).toFixed(1).replace('.0', '').replace('.', ',') + ' K';
  return String(v);
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
    // 1) Récupère le profil public via notre fonction serveur (clé LamaTok
    //    jamais exposée au navigateur).
    const rep = await fetch('/api/username-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const profil = await rep.json();
    if (!rep.ok) {
      throw new Error(profil?.error?.message || "Profil introuvable. Vérifie l'orthographe, ou envoie tes captures pour l'analyse complète.");
    }

    // 2) Transmet les données brutes du profil à l'IA : le nom exact des
    //    champs dépend du service tiers, donc c'est l'IA qui les identifie
    //    par leur sens plutôt qu'un parsing rigide côté code (plus robuste
    //    si LamaTok fait évoluer sa réponse).
    const prompt = `Tu es Scriptura, consultant TikTok pour créateurs francophones. On te donne les données PUBLIQUES brutes d'un profil TikTok (@${username}), au format JSON, récupérées via une API tierce. Le nom exact des champs peut varier légèrement : identifie-les par leur sens (nombre d'abonnés, d'abonnements, de likes cumulés, de vidéos publiées, la bio, le statut vérifié).

DONNÉES BRUTES :
${JSON.stringify(profil).slice(0, 6000)}

RÈGLE ABSOLUE D'HONNÊTETÉ : n'utilise QUE ce qui est réellement présent dans ces données. Si un champ est absent ou vide, mets null — n'invente jamais un chiffre. Ce diagnostic est SOMMAIRE : il n'a accès qu'à des statistiques publiques de surface (pas de rétention, pas de sources de trafic, pas de détail par vidéo) — ne prétends jamais avoir plus d'information que ça.

RÈGLE DE FORMAT DES NOMBRES : dans tes phrases, écris les nombres en toutes lettres normalement (ex: "12 400 abonnés"), jamais de séparateur anglo-saxon.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
{
  "profil_trouve": <true si les données décrivent bien un profil existant, false sinon>,
  "compte_verifie": <true/false/null>,
  "stats": {
    "abonnes": <nombre ou null>,
    "abonnements": <nombre ou null>,
    "likes_total": <nombre ou null>,
    "videos": <nombre ou null>
  },
  "bio": "<texte de la bio, ou null>",
  "constat_principal": "<1-2 phrases : ce que ces chiffres publics révèlent sur ce compte>",
  "point_bloquant": "<1 phrase : le frein le plus visible depuis ces seules données publiques>",
  "action_immediate": "<1 phrase concrète, réalisable dès aujourd'hui>"
}`;

    const raw = await callAI(MODEL_RAPIDE, 1500, prompt);
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

// Affiche le résultat (nouvelle génération OU réouverture depuis l'historique).
function afficherDiagnosticSommaireResultat(d, username) {
  const results = document.getElementById('diagSommaireResults');
  if (!results || !d) return;

  const s = d.stats || {};
  const statsHtml = `
    <div class="ds-result-stats">
      <div class="ds-result-stat"><b>${diagSommaireFormatNombre(s.abonnes)}</b><span>Abonnés</span></div>
      <div class="ds-result-stat"><b>${diagSommaireFormatNombre(s.likes_total)}</b><span>Likes cumulés</span></div>
      <div class="ds-result-stat"><b>${diagSommaireFormatNombre(s.videos)}</b><span>Vidéos</span></div>
      <div class="ds-result-stat"><b>${diagSommaireFormatNombre(s.abonnements)}</b><span>Abonnements</span></div>
    </div>`;

  const subscribeNote = (!unlocked) ? `
    <div class="ds-result-subscribe">✦ Ce diagnostic rapide est un aperçu. Pour que Scriptura te fasse des recommandations personnalisées et suive ton évolution dans le temps, <a onclick="openPlans('abonnement')" style="color:var(--gold-light);text-decoration:underline;cursor:pointer">abonne-toi</a>.</div>` : '';

  results.innerHTML = `
    <div class="score-card">
      <div class="audit-score-label">@${diagSommaireEsc(username)}${d.compte_verifie ? ' ✓' : ''}</div>
      ${d.bio ? `<div class="ds-note" style="margin-top:8px"><span>💬</span><span>${diagSommaireEsc(d.bio)}</span></div>` : ''}
      ${statsHtml}
      <div class="audit-section-label" style="margin-top:18px">Constat</div>
      <div class="audit-diag-constat">${diagSommaireEsc(d.constat_principal)}</div>
      <div class="audit-section-label" style="margin-top:18px">Ce qui bloque</div>
      <div class="audit-diag-constat">${diagSommaireEsc(d.point_bloquant)}</div>
      <div class="audit-section-label" style="margin-top:18px">À faire dès maintenant</div>
      <div class="audit-diag-constat">${diagSommaireEsc(d.action_immediate)}</div>
      ${subscribeNote}
      <button class="btn-generate" style="width:100%;justify-content:center;margin-top:20px" onclick="resetDiagnosticSommaireForm()">↻ Analyser un autre compte</button>
    </div>`;
  results.style.display = 'block';
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

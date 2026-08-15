// ═══════════════════════════════════════════════════════════
//  RAPPORT FUSIONNÉ, combine le diagnostic complet (captures, js/audit.js)
//  et le diagnostic sommaire (@nom d'utilisateur, js/diagnostic-sommaire.js)
//  d'un même créateur en une synthèse plus complète : chaque diagnostic
//  voit des choses que l'autre ne voit pas (rétention/sources de trafic
//  côté captures ; bio, ratio vues/abonnés, régularité récente côté
//  @nom d'utilisateur), les croiser affine les recommandations.
//  Réservé au Pro : ne consomme AUCUN quota supplémentaire, c'est une
//  synthèse de deux diagnostics déjà générés (et déjà payés).
// ═══════════════════════════════════════════════════════════

// Récupère la dernière génération d'un mode donné pour l'utilisateur courant.
async function _derniereGenerationDe(mode) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('generations')
      .select('*')
      .eq('code_acces', getUserRef())
      .eq('mode', mode)
      .order('cree_le', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    return data[0];
  } catch (e) { console.warn('Lecture génération échouée', e); return null; }
}

// Récupère les N dernières générations d'un mode (plus récentes d'abord).
// Utilisé par les recommandations pour croiser le compte du créateur et les
// comptes de concurrents qu'il a analysés (tag estMonCompte, voir
// js/diagnostic-sommaire.js). Best-effort : [] en cas d'erreur.
async function _recentesGenerationsDe(mode, n) {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('generations')
      .select('*')
      .eq('code_acces', getUserRef())
      .eq('mode', mode)
      .order('cree_le', { ascending: false })
      .limit(n || 8);
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch (e) { console.warn('Lecture générations échouée', e); return []; }
}

// Le diagnostic sommaire d'un compte est « le mien » par défaut : les
// générations antérieures au tag (estMonCompte absent) sont donc traitées
// comme le compte du créateur, jamais comme un concurrent.
function _sommaireEstMien(gen) {
  return !!(gen && gen.contenu && gen.contenu.estMonCompte !== false);
}

// Affiche (ou masque) la bannière dans l'historique : visible uniquement
// pour un Pro ayant au moins un diagnostic complet ET un diagnostic sommaire.
async function verifierBanniereFusion() {
  const banniere = document.getElementById('fusionBanner');
  if (!banniere) return;
  banniere.style.display = 'none';
  if (!unlocked || (typeof monPalier === 'function' && monPalier() !== 'pro')) return;
  // La fusion porte sur SON compte : on exige un audit ET un diagnostic
  // sommaire DE SON compte (pas d'un concurrent analysé).
  const [audit, sommaires] = await Promise.all([_derniereGenerationDe('audit'), _recentesGenerationsDe('diagnosticSommaire', 8)]);
  if (audit && sommaires.some(_sommaireEstMien)) banniere.style.display = 'block';
}

async function ouvrirFusionDiagnostics() {
  pushNav();
  masquerTousLesEcrans();
  document.getElementById('fusionFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
  await genererFusionDiagnostics();
}

async function genererFusionDiagnostics() {
  const err = document.getElementById('fusionError');
  const loading = document.getElementById('fusionLoading');
  const results = document.getElementById('fusionResults');
  err.style.display = 'none';
  results.innerHTML = '';
  loading.style.display = 'block';

  try {
    if (!unlocked || (typeof monPalier === 'function' && monPalier() !== 'pro')) {
      throw new Error('Le rapport fusionné est réservé au plan Pro');
    }
    const [auditGen, sommaires] = await Promise.all([_derniereGenerationDe('audit'), _recentesGenerationsDe('diagnosticSommaire', 8)]);
    const sommaireGen = sommaires.find(_sommaireEstMien);
    if (!auditGen || !sommaireGen) {
      throw new Error("Il te faut un diagnostic complet ET un diagnostic sommaire de TON compte pour générer un rapport fusionné");
    }

    const prompt = `Tu es Scriptura, consultant TikTok pour créateurs francophones. On te donne DEUX diagnostics déjà réalisés pour le MÊME créateur, à des moments différents et par des méthodes différentes :

1) DIAGNOSTIC COMPLET (basé sur des captures d'écran des statistiques TikTok officielles du créateur, rétention, sources de trafic, audience démographique) :
${JSON.stringify(auditGen.contenu || {}).slice(0, 6000)}

2) DIAGNOSTIC SOMMAIRE (basé sur le profil public TikTok @${(sommaireGen.contenu && sommaireGen.contenu.username) || ''} lu via une API tierce, bio, niche, engagement de surface) :
${JSON.stringify(sommaireGen.contenu || {}).slice(0, 6000)}

TON TRAVAIL : croise ces deux diagnostics pour produire une synthèse PLUS COMPLÈTE que chacun pris séparément. Le diagnostic complet voit la rétention et les sources de trafic (données privées, invisibles au diagnostic sommaire) ; le diagnostic sommaire voit la bio et le ratio vues/abonnés sur la durée (données publiques, absentes du diagnostic complet). Utilise cette complémentarité.

RÈGLE ABSOLUE D'HONNÊTETÉ : n'utilise QUE ce qui est réellement présent dans ces deux diagnostics. Si les deux se contredisent sur un point, dis-le explicitement plutôt que de trancher arbitrairement. Ne réinvente pas de données.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises Markdown autour. Structure EXACTE :
{
  "synthese": "<2-3 phrases : la situation combinée de ce compte, plus riche que chaque diagnostic pris seul>",
  "convergences": ["<un point où les deux diagnostics se confirment mutuellement, si applicable>"],
  "complements": ["<ce que le croisement révèle que NI l'un NI l'autre diagnostic ne montrait seul>"],
  "bio": { "actuelle": "<reprise du diagnostic sommaire>", "etat": "<claire|a_retravailler>", "critique": "<affinée à la lumière du diagnostic complet si pertinent>", "suggestions": ["<...>", "<...>"] },
  "niche": { "nom": "<version réconciliée des deux analyses de niche>", "etat": "<claire|floue>", "analyse": ["<...>"] },
  "leviers_prioritaires": [ { "titre": "<max 8 mots>", "detail": "<1-2 phrases, fondé sur AU MOINS un des deux diagnostics, idéalement les deux>" } ]
}

Donne exactement 3 leviers prioritaires, les plus importants pour ce compte, classés du plus au moins prioritaire.`;

    const raw = await callAI(MODEL_CREATIF, 3000, prompt);
    const parsed = parseAIResponse(raw);
    if (!parsed) throw new Error('Réponse illisible, réessaie');

    afficherFusionResultat(parsed);

  } catch (e) {
    err.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
    err.style.display = 'block';
  } finally {
    loading.style.display = 'none';
  }
}

function afficherFusionResultat(d) {
  const results = document.getElementById('fusionResults');
  if (!results || !d) return;

  const bio = d.bio || {};
  const bioOk = bio.etat === 'claire';
  const niche = d.niche || {};
  const nicheOk = niche.etat === 'claire';
  const leviers = Array.isArray(d.leviers_prioritaires) ? d.leviers_prioritaires : [];

  results.innerHTML = `
    <div class="score-card">
      <div class="audit-score-label">SYNTHÈSE</div>
      <div class="audit-diag-constat">${diagSommaireEsc(d.synthese)}</div>
    </div>

    ${Array.isArray(d.convergences) && d.convergences.length ? `
    <div class="score-card">
      <div class="audit-section-label">✔ Ce que les deux diagnostics confirment</div>
      <ul class="ds-niche-analyse">${d.convergences.map(c => `<li>${diagSommaireEsc(c)}</li>`).join('')}</ul>
    </div>` : ''}

    ${Array.isArray(d.complements) && d.complements.length ? `
    <div class="score-card">
      <div class="audit-section-label">🔗 Ce que le croisement révèle en plus</div>
      <ul class="ds-niche-analyse">${d.complements.map(c => `<li>${diagSommaireEsc(c)}</li>`).join('')}</ul>
    </div>` : ''}

    ${bio.actuelle ? `
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
    </div>` : ''}

    ${niche.nom ? `
    <div class="score-card">
      <div class="ds-section-row">
        <div class="audit-section-label" style="margin-bottom:0">Ta niche</div>
        <span class="ds-tag${nicheOk ? ' ds-tag-ok' : ''}">${nicheOk ? 'Niche claire' : 'Niche encore floue'}</span>
      </div>
      <div class="audit-diag-constat">${diagSommaireEsc(niche.nom)}</div>
      ${Array.isArray(niche.analyse) && niche.analyse.length ? `<ul class="ds-niche-analyse">${niche.analyse.map(p => `<li>${diagSommaireEsc(p)}</li>`).join('')}</ul>` : ''}
    </div>` : ''}

    ${leviers.length ? `
    <div class="score-card">
      <div class="audit-section-label">Tes leviers prioritaires (fusionnés)</div>
      <ol class="ds-leviers-list">
        ${leviers.map(l => `<li><b>${diagSommaireEsc(l.titre)}</b><p>${diagSommaireEsc(l.detail)}</p></li>`).join('')}
      </ol>
    </div>` : ''}`;
}

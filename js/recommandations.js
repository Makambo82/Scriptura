// ═══════════════════════════════════════════════════════════
//  RECOMMANDATION IA — l'assistant personnel de Scriptura
//  Combine la mémoire du créateur (js/profil.js) et, quand disponible,
//  le diagnostic d'un audit tout juste terminé, pour dire au créateur
//  quoi créer aujourd'hui et pourquoi. Affichée à deux endroits :
//  l'accueil (fonctionnalité Premium, voir initAccueilPremium) et la
//  fin d'un rapport d'audit (voir afficherEtMaintenant, appelée par
//  renderAudit dans js/audit.js).
//
//  Ne modifie aucun mode existant, aucune règle d'analyse, aucun
//  prompt métier : nouveau prompt dédié, purement additif. N'invente
//  jamais de certitude — si la mémoire disponible est trop mince,
//  aucune recommandation n'est générée (ou son niveau de confiance
//  est signalé comme faible), plutôt que d'inventer des données.
// ═══════════════════════════════════════════════════════════

let _recommandations = [];

// Texte descriptif complet du profil pour ce prompt dédié (plus détaillé
// que la ligne courte ajoutée aux autres prompts, voir ligneProfilPourPrompt
// dans js/profil.js, qui reste inchangée et utilisée telle quelle ailleurs).
function texteProfilPourRecommandation(profil) {
  const d = profil.declare, o = profil.observe, l = profil.lecons;
  const lignes = [];
  lignes.push('Nombre de générations déjà faites avec Scriptura : ' + (o.nb_generations || 0));
  if (d.niche_principale) lignes.push('Niche principale : ' + d.niche_principale);
  if (d.niches_secondaires && d.niches_secondaires.length) lignes.push('Niches secondaires : ' + d.niches_secondaires.join(', '));
  if (d.style_contenu) lignes.push('Style/format de contenu habituel : ' + d.style_contenu);
  if (d.ton_prefere) lignes.push('Ton le plus souvent choisi : ' + d.ton_prefere);
  if (d.duree_moyenne) lignes.push('Durée habituelle : ' + d.duree_moyenne);
  if (d.structure_narrative) lignes.push('Structure narrative favorite : ' + d.structure_narrative);
  if (d.objectifs && d.objectifs.length) lignes.push('Objectif(s) : ' + d.objectifs.join(', '));
  if (o.themes_traites && o.themes_traites.length) lignes.push('Sujets déjà traités récemment, à ne jamais répéter à l\'identique : ' + o.themes_traites.slice(0, 10).join(', '));
  if (o.themes_a_eviter && o.themes_a_eviter.length) lignes.push('À éviter pour ce créateur : ' + o.themes_a_eviter.slice(0, 6).join(', '));
  if (o.plateformes && o.plateformes.length) lignes.push('Plateforme(s) habituelle(s) : ' + o.plateformes.join(', '));
  if (l.recommandations_permanentes && l.recommandations_permanentes.length) lignes.push('Leçons retenues de ses audits précédents : ' + l.recommandations_permanentes.slice(0, 4).join(' · '));
  if (l.dernier_score_audit != null) lignes.push('Dernier score ADN TikTok mesuré : ' + l.dernier_score_audit + '/100');
  return lignes.join('\n');
}

// auditFrais + ts : optionnels, passés uniquement depuis la fin d'un audit
// tout juste terminé (voir js/audit.js), pour enrichir la recommandation
// avec un diagnostic encore plus frais que la mémoire déjà enregistrée.
// nicheFraiche/objectifFrais : idem, transmis explicitement quand l'audit
// vient tout juste de se terminer et que le Profil Créateur n'a pas encore
// fini de les enregistrer en tâche de fond (voir renderAudit).
async function genererRecommandations(auditFrais, ts, nicheFraiche, objectifFrais) {
  const profilCharge = await chargerProfilCreateur();
  // Copie superficielle : on ne modifie jamais le profil mis en cache lui-même
  // ici, seulement le texte envoyé à ce prompt (l'enregistrement définitif se
  // fait séparément par mettreAJourProfilCreateur, voir js/audit.js).
  const profil = {
    declare: Object.assign({}, profilCharge.declare, {
      niche_principale: nicheFraiche || profilCharge.declare.niche_principale,
      objectifs: objectifFrais ? ajouterListeProfil(profilCharge.declare.objectifs, objectifFrais, 6) : profilCharge.declare.objectifs
    }),
    observe: profilCharge.observe,
    lecons: profilCharge.lecons
  };
  const texteProfil = texteProfilPourRecommandation(profil);
  const texteAuditFrais = auditFrais ? texteDiagnosticOpportunites(auditFrais, ts || {}) : '';

  // Mémoire trop mince pour recommander quoi que ce soit d'honnête : on
  // n'invente rien, on ne génère simplement pas de recommandation.
  const rienDeConnu = !profil.declare.niche_principale
    && !(profil.observe.themes_traites && profil.observe.themes_traites.length)
    && !(profil.lecons.recommandations_permanentes && profil.lecons.recommandations_permanentes.length)
    && !texteAuditFrais;
  if (rienDeConnu) return null;

  const prompt = `Tu es le Directeur Éditorial de Scriptura, l'assistant IA personnel d'un créateur de contenu francophone. Tu le connais grâce à sa mémoire accumulée dans Scriptura (générations passées, préférences, audits). Ta mission : lui dire précisément quoi créer aujourd'hui.

CE QUE TU SAIS DE CE CRÉATEUR :
${texteProfil || 'Peu d\'historique pour l\'instant.'}
${texteAuditFrais ? '\nDIAGNOSTIC DE SON DERNIER AUDIT (tout juste terminé) :\n' + texteAuditFrais : ''}

RÈGLE DE CONFIANCE — TRÈS IMPORTANTE : base-toi UNIQUEMENT sur les informations ci-dessus. N'invente JAMAIS une statistique, un fait ou une certitude que tu n'as pas. Si les informations connues sont limitées, dis-le honnêtement (niveau_confiance "faible") et propose des recommandations plus générales mais toujours utiles, plutôt que de prétendre connaître ce créateur mieux que tu ne le connais. Si tu disposes d'assez d'éléments concrets (niche connue, historique, leçons d'audit), sois précis et spécifique (niveau_confiance "élevée").

MISSION : génère exactement 6 recommandations de contenu pour aujourd'hui, classées de la plus pertinente (index 0) à la moins pertinente pour CE créateur précis.

Pour CHAQUE recommandation, fournis :
1. Un TITRE fort et accrocheur
2. L'ANGLE recommandé : l'approche précise à adopter
3. 2 à 4 JUSTIFICATIONS courtes prouvant la pertinence pour CE créateur — chacune doit citer un élément concret connu de lui ci-dessus (sa niche, un thème à ne pas répéter, une leçon d'audit, son objectif...). Si les éléments concrets manquent, formule une justification honnête et générale plutôt que d'inventer un fait précis.
4. Le POTENTIEL estimé pour ce créateur, exactement un de ces 4 mots : Faible, Moyen, Élevé, Très élevé
5. Un TON conseillé, à choisir EXACTEMENT parmi : Analytique, Inspirant, Provocateur, Éducatif, Humoristique, Storytelling
6. Un HOOK recommandé : la phrase d'accroche exacte pour démarrer la vidéo

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"niveau_confiance":"faible|moyenne|élevée","recommandations":[{"titre":"...","angle":"...","justifications":["...","..."],"potentiel":"Élevé","ton_conseille":"Storytelling","hook":"..."}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 6000, prompt);
    const parsed = parseAIResponse(raw);
    if (!parsed || !Array.isArray(parsed.recommandations) || !parsed.recommandations.length) return null;
    return parsed;
  } catch (e) {
    console.warn('Recommandations IA indisponibles', e);
    return null;
  }
}

function escaperReco(s) { return (typeof auditEsc === 'function') ? auditEsc(s) : String(s == null ? '' : s); }

function carteRecommandationHero(reco) {
  const justifs = (reco.justifications || []).map(j => `<div class="audit-diag-interp">✔ ${escaperReco(j)}</div>`).join('');
  return `
    <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
    <div class="idea-titre" style="font-size:1.25rem;margin-bottom:10px">${escaperReco(reco.titre)}</div>
    <div class="audit-diag-constat">${escaperReco(reco.angle)}</div>
    <div class="audit-section-label" style="margin-top:18px">Pourquoi cette recommandation ?</div>
    <div style="margin:10px 0 4px">${justifs}</div>
    <span class="summary-tag">🔥 Potentiel estimé : ${escaperReco(reco.potentiel || 'Moyen')}</span>
  `;
}

function carteRecommandationSecondaire(reco, index) {
  const justifs = (reco.justifications || []).map(j => '✔ ' + escaperReco(j)).join('<br/>');
  return `<div class="out-card idea-card">
    <div class="out-header" onclick="toggleCard(this.parentElement)">
      <div class="out-title idea-titre">${escaperReco(reco.titre)}</div>
      <div class="out-toggle">+</div>
    </div>
    <div class="out-body">
      <div class="idea-section"><div class="idea-section-label">◆ L'angle</div><div class="idea-section-text">${escaperReco(reco.angle)}</div></div>
      <div class="idea-section"><div class="idea-section-label">◆ Pourquoi</div><div class="idea-section-text">${justifs}</div></div>
      <div class="idea-section"><div class="idea-section-label">◆ Potentiel</div><div class="idea-section-text">${escaperReco(reco.potentiel || 'Moyen')}</div></div>
      <div class="idea-actions"><button class="idea-btn-script" onclick="creerScriptDepuisRecommandation(${index})">🎬 Créer le script</button></div>
    </div>
  </div>`;
}

// Affiche la recommandation principale + le bouton pour révéler les autres,
// dans le conteneur donné. `entete` (optionnel) est inséré avant la carte
// (utilisé pour la salutation d'accueil ou le titre "Et maintenant ?").
function rendreRecommandations(containerId, data, entete) {
  const zone = document.getElementById(containerId);
  if (!zone) return;
  if (!data || !data.recommandations || !data.recommandations.length) {
    zone.innerHTML = '';
    zone.style.display = 'none';
    return;
  }

  _recommandations = data.recommandations;
  const autresId = containerId + 'Autres';
  const confianceNote = (data.niveau_confiance === 'faible')
    ? '<div class="audit-diag-interp" style="margin-top:14px">Scriptura te connaît encore peu — ces recommandations s\'affineront à mesure que tu génères et analyses davantage.</div>'
    : '';

  zone.innerHTML = `
    ${entete || ''}
    <div class="score-card">
      ${carteRecommandationHero(data.recommandations[0])}
      ${confianceNote}
      <button class="btn-generate" style="margin-top:20px" onclick="creerScriptDepuisRecommandation(0)">Créer le script</button>
      <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:10px" onclick="toggleAutresRecommandations('${autresId}')">Voir d'autres recommandations</button>
      <div id="${autresId}" style="display:none;margin-top:18px"></div>
    </div>
  `;
  zone.style.display = 'block';
}

function toggleAutresRecommandations(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.style.display === 'none') {
    el.innerHTML = _recommandations.slice(1).map((r, i) => carteRecommandationSecondaire(r, i + 1)).join('');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// Pont recommandation → mode script : même mécanisme que useIdeaForScript
// et creerScriptDepuisOpportunite (js/generation.js, js/audit.js) — ne
// modifie ni ne redemande rien, ne fait que pré-remplir des champs déjà
// existants avant d'ouvrir directement le récapitulatif.
function creerScriptDepuisRecommandation(index) {
  const reco = _recommandations[index];
  if (!reco) return;

  pushNav(); // capture l'écran d'où on vient (accueil ou rapport d'audit) avant de le masquer

  const homeEl = document.getElementById('homePage');
  if (homeEl) homeEl.style.display = 'none';
  const auditEl = document.getElementById('auditFlow');
  if (auditEl) auditEl.style.display = 'none';
  document.getElementById('flow').style.display = 'block';

  const parts = [reco.titre];
  if (reco.angle) parts.push('Angle : ' + reco.angle);
  if (reco.hook) parts.push('Hook suggéré : "' + reco.hook + '"');
  document.getElementById('sujet').value = parts.filter(Boolean).join('. ');

  const profil = _profilCreateur; // déjà chargé en cache par genererRecommandations()
  const niche = (profil && profil.declare.niche_principale) || '';
  const nicheSelect = document.getElementById('niche');
  if (nicheSelect && niche) {
    for (let opt of nicheSelect.options) {
      if (opt.value === niche || opt.text === niche) { nicheSelect.value = opt.value; break; }
    }
  }

  const objectif = (profil && profil.declare.objectifs && profil.declare.objectifs[0]) || '';
  if (objectif) state.objectif = objectif;
  state.plateforme = (profil && profil.observe.plateformes && profil.observe.plateformes[0]) || 'TikTok';

  if (reco.ton_conseille) {
    const toneBtns = Array.from(document.querySelectorAll('#toneGrid .grid-btn'));
    const match = toneBtns.find(b => b.textContent.trim().toLowerCase() === String(reco.ton_conseille).trim().toLowerCase());
    if (match) match.click();
  }

  state.depart = 'un sujet précis que je veux développer';

  if (state.objectif && state.plateforme) {
    showStep(4);
    renderSummary();
  } else {
    showStep(1);
  }

  window.scrollTo({ top: document.getElementById('flow').offsetTop - 20, behavior: 'smooth' });
}

// ── Accueil (fonctionnalité Premium) ──
function salutationAccueil(profil) {
  const dejaActif = profil && profil.observe && profil.observe.nb_generations > 0;
  return dejaActif ? 'Bon retour 👋' : 'Bonjour 👋';
}

async function initAccueilPremium() {
  // CAS 1 (utilisateur non identifié / gratuit) : on ne touche à rien,
  // l'accueil reste exactement celui d'aujourd'hui.
  if (!unlocked) return;
  const zone = document.getElementById('accueilPremium');
  if (!zone) return;

  const profil = await chargerProfilCreateur();
  const entete = `<div class="results-heading">${salutationAccueil(profil)}</div>
    <div class="ideas-sub" style="margin:6px 0 20px">Voici ce que je te recommande aujourd'hui.</div>`;

  const data = await genererRecommandations(null, null);
  if (!data) { zone.innerHTML = ''; zone.style.display = 'none'; return; }
  rendreRecommandations('accueilPremium', data, entete);
}

// ── Fin d'un rapport d'audit : "Et maintenant ?" ──
// Remplace l'ancienne section "opportunités" par la même brique de
// recommandation que l'accueil, pour un parcours cohérent
// Analyse → Décision → Script → Storyboard.
async function afficherEtMaintenant(auditFrais, ts, niche, objectif) {
  const zone = document.getElementById('auditOpportunites');
  if (!zone) return;
  zone.innerHTML = '<div class="audit-section-label">Et maintenant ?</div><div class="audit-diag-interp">Scriptura cherche la meilleure recommandation pour ton compte…</div>';

  const data = await genererRecommandations(auditFrais, ts, niche, objectif);
  if (!data) { zone.innerHTML = ''; return; }
  rendreRecommandations('auditOpportunites', data, '<div class="audit-section-label">Et maintenant ?</div>');
}

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
// true UNIQUEMENT quand la prochaine génération de script provient du bouton
// "Créer le script" de la recommandation (voir creerScriptDepuisRecommandation
// et generate(), js/generation.js). Consommé (remis à false) par le tout
// premier generate() qui suit, réussi ou non — jamais laissé traîner sur une
// génération sans rapport avec la recommandation affichée.
let _recoEnCoursDaction = false;

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
  // n'invente rien. Signalé distinctement d'un échec technique (voir plus
  // bas) pour que l'accueil puisse afficher un message honnête plutôt que
  // de disparaître sans explication.
  const rienDeConnu = !profil.declare.niche_principale
    && !(profil.observe.themes_traites && profil.observe.themes_traites.length)
    && !(profil.lecons.recommandations_permanentes && profil.lecons.recommandations_permanentes.length)
    && !texteAuditFrais;
  if (rienDeConnu) return { onboarding: true };

  // Tout ce qui suit (construction du prompt incluse) est désormais dans le
  // try : une erreur de construction (fonction manquante, cache navigateur
  // désynchronisé après une mise à jour, etc.) ne doit jamais faire
  // disparaître silencieusement toute la zone de recommandation — elle doit
  // retomber sur le message de repli déjà prévu dans initAccueilPremium()
  // pour le cas "échec technique" (data === null).
  try {
    // Recherche web — deux besoins distincts, qui peuvent se cumuler :
    // 1) vérification factuelle, uniquement si la niche touche l'actualité/la
    //    géopolitique ou l'Histoire (voir js/api.js) — c'est exactement le cas
    //    qui a produit une recommandation datée à tort ("2024 sera décisif"
    //    alors qu'on est en 2026) ;
    // 2) tendances TikTok, toujours activée : la quasi-totalité des créateurs
    //    Scriptura publient sur TikTok, donc les recommandations gagnent à
    //    s'appuyer sur ce qui performe réellement en ce moment, pas seulement
    //    sur le profil du créateur et les connaissances d'entraînement.
    const rechercheWebReco = nicheNecessiteRecherche(profil.declare.niche_principale);
    const rechercheWebActive = true;

    const prompt = `Tu es le Directeur Éditorial de Scriptura, l'assistant IA personnel d'un créateur de contenu francophone. Tu le connais grâce à sa mémoire accumulée dans Scriptura (générations passées, préférences, audits). Ta mission : lui dire précisément quoi créer aujourd'hui.
${rechercheWebReco ? instructionRechercheWeb(profil.declare.niche_principale, 'de recommander') : ''}${instructionRechercheTendancesTikTok(profil.declare.niche_principale, 'de recommander')}
CE QUE TU SAIS DE CE CRÉATEUR :
${texteProfil || 'Peu d\'historique pour l\'instant.'}
${texteAuditFrais ? '\nDIAGNOSTIC DE SON DERNIER AUDIT (tout juste terminé) :\n' + texteAuditFrais : ''}

RÈGLE DE CONFIANCE — TRÈS IMPORTANTE : base-toi UNIQUEMENT sur les informations ci-dessus. N'invente JAMAIS une statistique, un fait ou une certitude que tu n'as pas. Si les informations connues sont limitées, dis-le honnêtement (niveau_confiance "faible") et propose des recommandations plus générales mais toujours utiles, plutôt que de prétendre connaître ce créateur mieux que tu ne le connais. Si tu disposes d'assez d'éléments concrets (niche connue, historique, leçons d'audit), sois précis et spécifique (niveau_confiance "élevée").

RÈGLE DU MÉCANISME GAGNANT — LE CŒUR DE TON TRAVAIL : ne confonds JAMAIS le SUJET qui a marché avec la RAISON pour laquelle il a marché. Si un thème ou une vidéo a bien performé pour ce créateur (une figure politique, un pays, un fait précis), ce n'est presque jamais le sujet en lui-même qui a plu — c'est un MÉCANISME sous-jacent, le ressort qui fait réagir l'audience. Identifie-le explicitement : rivalité entre personnalités que le public suit et débat déjà, révélation de coulisses du pouvoir, conflit clair et lisible, retournement ou trahison, enjeu qui touche la fierté ou l'identité du spectateur, personnages que l'audience connaît de longue date... Puis construis tes recommandations en RÉUTILISANT ce mécanisme, appliqué à des SUJETS ET DES ANGLES VARIÉS — surtout PAS en répétant les mêmes personnes ou le même pays. Reproduire le même sujet encore et encore est paresseux, générique et finit par lasser l'audience ; réutiliser le mécanisme gagnant sur du terrain neuf, c'est ça la vraie croissance. Tu peux garder AU PLUS UNE recommandation proche du sujet d'origine ; toutes les autres doivent transposer le mécanisme ailleurs.

MISSION : génère exactement 6 recommandations de contenu pour aujourd'hui, classées de la plus pertinente (index 0) à la moins pertinente pour CE créateur précis. Les 6 doivent porter sur des sujets NETTEMENT DIFFÉRENTS les uns des autres — jamais 6 variantes du même sujet, du même pays ou des mêmes personnalités.

Pour CHAQUE recommandation, fournis :
1. Un TITRE fort et accrocheur
2. L'ANGLE recommandé : l'approche précise à adopter
3. 2 à 4 JUSTIFICATIONS courtes prouvant la pertinence pour CE créateur — chacune doit citer un élément concret connu de lui ci-dessus (sa niche, un thème à ne pas répéter, une leçon d'audit, son objectif...). AU MOINS UNE justification doit nommer le MÉCANISME gagnant réutilisé — POURQUOI ça fera réagir son audience — et non se contenter de rappeler un sujet déjà traité. Si les éléments concrets manquent, formule une justification honnête et générale plutôt que d'inventer un fait précis.
4. Le POTENTIEL estimé pour ce créateur, exactement un de ces 4 mots : Faible, Moyen, Élevé, Très élevé
5. Un TON conseillé, à choisir EXACTEMENT parmi : Analytique, Inspirant, Provocateur, Éducatif, Humoristique, Storytelling, Réaction, Tutoriel, Satirique, Émotionnel
6. Un HOOK recommandé : la phrase d'accroche exacte pour démarrer la vidéo
7. La SOURCE de cette recommandation, exactement un de ces trois mots : "diagnostic" (elle se fonde surtout sur les leçons ou le score de son audit TikTok), "creations" (elle se fonde surtout sur sa niche, son ton, son format ou ses sujets déjà traités), ou "mixte" (les deux à part égale). Sois honnête : indique ce sur quoi tu t'es RÉELLEMENT appuyé pour CETTE reco. S'il n'y a pas de diagnostic connu, ce ne peut jamais être "diagnostic" ni "mixte".

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"niveau_confiance":"faible|moyenne|élevée","recommandations":[{"titre":"...","angle":"...","justifications":["...","..."],"potentiel":"Élevé","ton_conseille":"Storytelling","hook":"...","source":"mixte"}]}`;

    const raw = await callAI(MODEL_RAPIDE, 6000, prompt, undefined, rechercheWebActive, rechercheWebReco ? 2 : 1);
    const parsed = parseAIResponse(raw);
    if (!parsed || !Array.isArray(parsed.recommandations) || !parsed.recommandations.length) return null;
    // Vérification systématique avant affichage : passe best-effort, ne bloque
    // jamais l'affichage (voir verifierRecommandations juste en dessous).
    return await verifierRecommandations(parsed);
  } catch (e) {
    console.warn('Recommandations IA indisponibles', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  VÉRIFICATION POST-GÉNÉRATION — filet de sécurité anti-hallucination
//  Un second appel IA, avec recherche web systématique, relit les
//  recommandations tout juste générées et corrige deux types d'erreurs
//  que le premier appel peut produire :
//  1. INCOHÉRENCE INTERNE : le titre parle d'un pays/d'une personne et
//     l'angle ou les justifications en citent un autre (c'est exactement
//     le bug constaté : titre "alliance béninoise" pour un contenu qui
//     parle en réalité du Sénégal ou du Gabon).
//  2. ERREUR FACTUELLE : un nom, un poste, un pays ou un fait d'actualité
//     cité est faux ou périmé — vérifié par recherche web.
//  Best-effort : si cette passe échoue (réseau, JSON invalide, etc.), on
//  renvoie les recommandations d'origine plutôt que de bloquer
//  l'affichage — une reco non vérifiée vaut mieux qu'aucune reco.
// ═══════════════════════════════════════════════════════════
async function verifierRecommandations(parsed) {
  try {
    const verifPrompt = `Tu es un vérificateur factuel strict. On te donne une liste de recommandations de contenu générées automatiquement pour un créateur TikTok francophone. Ta mission : les relire une par une et corriger deux types d'erreurs, AVANT qu'elles ne soient publiées.

1. COHÉRENCE INTERNE (vérifie en premier, sans recherche) : pour CHAQUE recommandation, le titre, l'angle, les justifications et le hook doivent tous parler EXACTEMENT du même pays, des mêmes personnes et des mêmes faits. Un titre qui mentionne un pays alors que l'angle ou les justifications en développent un autre est une erreur grave à corriger immédiatement (ex : un titre qui parle d'une "alliance béninoise" alors que les noms cités sont ceux de dirigeants sénégalais — c'est incohérent et faux, il faut corriger le pays dans le titre pour qu'il corresponde à la réalité du contenu).

2. EXACTITUDE FACTUELLE (utilise la recherche web) : pour chaque nom de personne, poste, pays ou fait d'actualité cité, vérifie par une recherche web qu'il est exact et toujours d'actualité aujourd'hui. Corrige tout ce qui est faux, daté ou périmé.

Voici les recommandations à vérifier, au format JSON :
${JSON.stringify(parsed.recommandations)}

RÈGLES :
- Ne réécris QUE ce qui doit être corrigé (incohérence ou erreur factuelle) ; laisse le reste strictement identique.
- Ne supprime aucune recommandation et n'en ajoute aucune : renvoie exactement le même nombre, dans le même ordre.
- Garde exactement la même structure JSON pour chaque recommandation (mêmes clés : titre, angle, justifications, potentiel, ton_conseille, hook, source).
- Si tout est déjà cohérent et exact, renvoie la liste telle quelle.

Réponds UNIQUEMENT avec le JSON corrigé, sans texte avant ni après, structure EXACTE :
{"recommandations":[{"titre":"...","angle":"...","justifications":["...","..."],"potentiel":"Élevé","ton_conseille":"Storytelling","hook":"...","source":"mixte"}]}`;

    // Recherche web systématique pour cette passe, quelle que soit la niche :
    // c'est elle qui doit attraper les erreurs de noms/pays/faits, y compris
    // sur des niches où la génération initiale n'utilisait pas la recherche.
    const rawVerif = await callAI(MODEL_RAPIDE, 6000, verifPrompt, undefined, true);
    const verifie = parseAIResponse(rawVerif);

    // Filet de sécurité : la vérification doit renvoyer le même nombre de
    // recommandations, sinon on ne lui fait pas confiance et on garde
    // l'original plutôt que de risquer un décalage d'affichage.
    if (
      verifie &&
      Array.isArray(verifie.recommandations) &&
      verifie.recommandations.length === parsed.recommandations.length
    ) {
      parsed.recommandations = verifie.recommandations;
    }
    return parsed;
  } catch (e) {
    console.warn('Vérification des recommandations indisponible, affichage sans vérification', e);
    return parsed;
  }
}

function escaperReco(s) { return (typeof auditEsc === 'function') ? auditEsc(s) : String(s == null ? '' : s); }

// Source d'une recommandation (renseignée par le modèle) : sur quoi elle se
// fonde. Retourne null si absente (anciennes recos en cache) -> aucune étiquette.
// `premium` : true quand la source s'appuie au moins en partie sur le
// diagnostic (fonctionnalité Pro) -> traitement émeraude du badge, voir
// badgeSourceReco et css/style.css (.reco-source-tag.premium).
function infoSourceReco(reco) {
  const s = (reco && reco.source ? String(reco.source) : '').trim().toLowerCase();
  if (s === 'diagnostic') return { icone: '📊', texte: "D'après ton diagnostic TikTok", premium: true };
  if (s === 'creations' || s === 'créations') return { icone: '🎬', texte: "D'après tes créations", premium: false };
  if (s === 'mixte' || s.includes('deux')) return { icone: '🧭', texte: "D'après ton diagnostic et tes créations", premium: true };
  return null;
}
function badgeSourceReco(reco) {
  const i = infoSourceReco(reco);
  return i ? `<span class="reco-source-tag${i.premium ? ' premium' : ''}">${i.icone} ${i.texte}</span>` : '';
}

function carteRecommandationHero(reco, avecRafraichir) {
  const justifs = (reco.justifications || []).map(j => `<div class="audit-diag-interp">✔ ${escaperReco(j)}</div>`).join('');
  return `
    <div class="reco-header-row">
      <div class="audit-score-label" style="margin-bottom:0">🎯 RECOMMANDATION IA</div>
      ${avecRafraichir ? boutonActualiserReco() : ''}
    </div>
    <div class="idea-titre" style="font-size:1.25rem;margin-bottom:10px">${escaperReco(reco.titre)}</div>
    <div class="audit-diag-constat">${escaperReco(reco.angle)}</div>
    <div class="audit-section-label" style="margin-top:18px">Pourquoi cette recommandation ?</div>
    <div style="margin:10px 0 4px">${justifs}</div>
    <div class="reco-tags">${badgeSourceReco(reco)}<span class="summary-tag">🔥 Potentiel estimé : ${escaperReco(reco.potentiel || 'Moyen')}</span></div>
  `;
}

// Version condensée de la recommandation, pour les non-abonnés qui ont
// déjà assez d'historique local (générations, diagnostic sommaire...) pour
// que Scriptura sache quoi leur suggérer — sans révéler la richesse
// complète (justifications, hook, ton conseillé) réservée aux abonnés.
function carteRecommandationSommaire(reco) {
  return `
    <div class="audit-score-label">🎯 UNE IDÉE POUR TOI</div>
    <div class="idea-titre" style="font-size:1.1rem;margin-bottom:8px">${escaperReco(reco.titre)}</div>
    <div class="audit-diag-constat" style="font-weight:400;color:var(--text-secondary)">${escaperReco(reco.angle)}</div>
  `;
}

// Affiche la carte condensée + l'invitation à s'abonner pour le reste.
function rendreRecommandationSommaire(containerId, data, entete) {
  const zone = document.getElementById(containerId);
  if (!zone) return;
  if (!data || !data.recommandations || !data.recommandations.length) {
    zone.innerHTML = '';
    zone.style.display = 'none';
    return;
  }
  zone.innerHTML = `
    ${entete || ''}
    <div class="score-card">
      ${carteRecommandationSommaire(data.recommandations[0])}
      <div class="ds-result-subscribe" style="margin-top:16px">✦ Abonne-toi pour un suivi personnalisé complet : 6 recommandations détaillées, hooks, tons conseillés, et un script en un clic.</div>
    </div>`;
  zone.style.display = 'block';
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
      ${infoSourceReco(reco) ? `<div class="idea-section"><div class="idea-section-label">◆ Basé sur</div><div class="idea-section-text">${infoSourceReco(reco).icone} ${infoSourceReco(reco).texte}</div></div>` : ''}
      <div class="idea-actions"><button class="idea-btn-script" onclick="creerScriptDepuisRecommandation(${index})">🎬 Créer le script</button></div>
    </div>
  </div>`;
}

// Bouton "Actualiser" : version compacte et discrète, intégrée à l'en-tête
// de la carte (à droite du texte "RECOMMANDATION IA"), à la place de
// l'ancien bouton pleine largeur "↻ Nouvelle recommandation". Même
// fonction (rafraichirRecommandationAccueil, même id), juste plus discret.
// Actif tant qu'il reste des essais du jour, désactivé une fois le
// plafond quotidien atteint (voir RECO_REFRESH_MAX) ; la note de limite
// est affichée séparément par noteLimiteReco(), sous la carte.
function boutonActualiserReco() {
  const restants = (typeof recoRefreshRestants === 'function') ? recoRefreshRestants() : RECO_REFRESH_MAX;
  const base = 'class="btn-actualiser reco-refresh" id="btnRafraichirReco" title="Actualiser la recommandation"';
  if (restants > 0) {
    return `<button ${base} onclick="rafraichirRecommandationAccueil()"><span class="reco-refresh-label">↻ Actualiser</span></button>`;
  }
  return `<button ${base} disabled><span class="reco-refresh-label">↻ Actualiser</span></button>`;
}

// Note affichée sous la carte une fois le plafond quotidien de rafraîchissements
// atteint (séparée du bouton, désormais logé dans l'en-tête — voir ci-dessus).
function noteLimiteReco() {
  const restants = (typeof recoRefreshRestants === 'function') ? recoRefreshRestants() : RECO_REFRESH_MAX;
  if (restants > 0) return '';
  return `<div class="ideas-sub" style="text-align:center;margin-top:8px;font-size:0.76rem;opacity:0.65">Tu as atteint ta limite du jour — de nouvelles recommandations demain.</div>`;
}

// Affiche la recommandation principale + le bouton pour révéler les autres,
// dans le conteneur donné. `entete` (optionnel) est inséré avant la carte
// (utilisé pour la salutation d'accueil ou le titre "Et maintenant ?").
function rendreRecommandations(containerId, data, entete, avecRafraichir) {
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
    ? '<div class="audit-diag-interp" style="margin-top:14px">Scriptura te connaît encore peu — ces recommandations s\'affineront à mesure que tu utilises Scriptura davantage.</div>'
    : '';

  zone.innerHTML = `
    ${entete || ''}
    <div class="score-card">
      ${carteRecommandationHero(data.recommandations[0], avecRafraichir)}
      ${confianceNote}
      ${avecRafraichir ? noteLimiteReco() : ''}
      <button class="btn-generate" style="margin-top:10px" onclick="creerScriptDepuisRecommandation(0)">Créer le script</button>
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

  _recoEnCoursDaction = true; // la prochaine génération de script correspond à cette recommandation

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
    const toneSel = document.getElementById('tone');
    if (toneSel) {
      const cible = String(reco.ton_conseille).trim().toLowerCase();
      const opt = Array.from(toneSel.options).find(o => o.text.trim().toLowerCase() === cible);
      if (opt) { toneSel.value = opt.value; selectedTone = opt.value; }
    }
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

// ── Accueil (dynamique selon le statut) ──
// Codes personnels qui ne suivent pas le format standard (prénom + 4
// caractères alphanumériques), à mapper à la main. Le code est toujours
// comparé en MAJUSCULES (voir verifyCode, qui stocke scriptura_code ainsi).
const PRENOM_CODE_EXCEPTIONS = {
  'SCRIPTURA-CELINE': 'Rey'
};

// Déduit le prénom du créateur à partir de son code d'accès personnel.
// Deux formats reconnus :
// 1. Format standard généré automatiquement : prénom + 4 caractères
//    alphanumériques, ex. MARIE7F2A → Marie. Le suffixe généré contient
//    toujours au moins un chiffre : c'est ce qui permet de le distinguer
//    d'un prénom entier écrit sans suffixe (voir cas 2) — sans ce repère,
//    "PAULINE" serait mal coupé en "Pau" + "LINE".
// 2. Codes créés à la main, sans suffixe (ex. "FIFA") : Rey en crée
//    parfois directement à partir du seul prénom. Dans ce cas, le code
//    entier EST le prénom, à condition qu'il ne contienne que des lettres
//    (ça exclut les codes génériques type SCRIPTURA-JUIL-2026, qui ont des
//    tirets, sans avoir à les lister un par un).
// Renvoie null si rien de tout ça ne correspond : pas de prénom affiché
// plutôt que d'en deviner un faux.
function prenomDepuisCode() {
  const code = (localStorage.getItem('scriptura_code') || '').trim().toUpperCase();
  if (!code) return null;
  if (PRENOM_CODE_EXCEPTIONS[code]) return PRENOM_CODE_EXCEPTIONS[code];

  const LETTRES = /^[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]+$/;
  const CONTIENT_LETTRE = /[A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/;

  // Format standard auto-généré (SANS tiret) : prénom + 4 caractères
  // alphanumériques, ex. MARIE7F2A → Marie.
  if (!code.includes('-') && code.length > 4 && /[0-9]/.test(code.slice(-4))) {
    const brut = code.slice(0, -4);
    if (LETTRES.test(brut)) return brut.charAt(0) + brut.slice(1).toLowerCase();
    return null;
  }

  // Code manuel à UN seul tiret : PRÉFIXE-HANDLE (ex. TIKTOK-F18 → F18).
  // Le segment après le tiret est le prénom/pseudo, s'il contient au moins une
  // lettre. Les codes de campagne à plusieurs tirets (SCRIPTURA-JUIL-2026) sont
  // volontairement exclus : aucun prénom deviné.
  const segments = code.split('-');
  if (segments.length === 2) {
    const h = segments[1];
    if (h && h.length <= 14 && CONTIENT_LETTRE.test(h)) {
      return h.charAt(0) + h.slice(1).toLowerCase();
    }
    return null;
  }

  // Code entièrement en lettres, sans suffixe (ex. FIFA → Fifa).
  if (LETTRES.test(code)) return code.charAt(0) + code.slice(1).toLowerCase();

  return null;
}

// Signale si ce créateur a déjà fait un diagnostic sommaire (@nom
// d'utilisateur, js/diagnostic-sommaire.js) — utilisé uniquement pour
// distinguer, dans le message "pas encore assez d'infos", le cas où il l'a
// DÉJÀ fait (message ciblé : il ne lui manque qu'une génération) du cas où
// il n'a vraiment rien fait (message générique renvoyant vers le
// diagnostic). Un diagnostic sommaire seul (niche + bio, aucune donnée de
// performance réelle) ne suffit jamais à lui seul à une recommandation
// fiable — voir genererRecommandations, qui ne le compte pas comme un
// signal utilisable. Best-effort : toute erreur retombe sur le message
// générique plutôt que de bloquer l'affichage.
async function aFaitDiagnosticSommaire() {
  if (typeof _derniereGenerationDe !== 'function') return false;
  try {
    const g = await _derniereGenerationDe('diagnosticSommaire');
    return !!g;
  } catch (e) { return false; }
}

// Depuis le bouton "Trouver mes premières idées" affiché après un
// diagnostic sommaire (voir aFaitDiagnosticSommaire ci-dessus) : ouvre le
// mode Idées et pré-remplit la niche et le sujet à partir de ce que le
// diagnostic sait déjà (niche + bio) — jamais sur un champ déjà rempli par
// l'utilisateur, et libre à lui de tout modifier avant de générer. Le champ
// "niche" ne se pré-sélectionne que si le nom identifié par le diagnostic
// correspond exactement à une option du menu (voir preRemplirSiVide,
// js/profil.js) ; sinon on laisse la niche vide plutôt que de deviner.
// Transforme niche + bio en UN sujet de contenu concret, dans le même
// esprit que les exemples déjà affichés dans le champ ("les empires
// africains", "la psychologie de l'argent"...). Les champs bruts du
// diagnostic sommaire (niche.analyse, bio.actuelle) sont écrits pour un
// AUDIT — analytiques, à la troisième personne — et ne ressemblent jamais
// à un vrai sujet de vidéo si on les recopie tels quels ; ce petit appel
// dédié (Haiku, quelques centaines de tokens) reformule spécifiquement
// pour ce champ. Best-effort : une erreur laisse simplement le champ vide,
// jamais un texte qui ne ressemble pas à un sujet.
async function suggestionSujetDepuisSommaire(niche, bio) {
  if (!niche && !bio) return '';
  try {
    const prompt = `Tu aides un créateur de contenu francophone à démarrer sur Scriptura. Voici ce qu'on sait de lui :
${niche ? '- Niche : ' + niche : ''}
${bio ? '- Bio TikTok actuelle : ' + bio : ''}

Propose UN SEUL sujet de vidéo concret et précis qu'il pourrait explorer — dans le même esprit que ces exemples : "les empires africains", "la psychologie de l'argent", "les femmes qui ont marqué l'histoire". Un sujet court (5 à 10 mots) : jamais une analyse, jamais une phrase qui parle DE lui ou de sa bio — un vrai sujet de contenu, prêt à explorer tel quel.

Réponds UNIQUEMENT avec ce sujet, sans guillemets, sans ponctuation finale, rien d'autre.`;
    const raw = await callAI(MODEL_RAPIDE, 60, prompt);
    const sujet = (raw || '').trim().replace(/^["«»]+|["«»]+$/g, '').replace(/\.$/, '');
    return (sujet.length > 2 && sujet.length < 150) ? sujet : '';
  } catch (e) { return ''; }
}

async function demarrerIdeesDepuisSommaire() {
  chooseMode('ideas');
  if (typeof _derniereGenerationDe !== 'function') return;
  try {
    const g = await _derniereGenerationDe('diagnosticSommaire');
    const d = g && g.contenu && g.contenu.diagnostic;
    if (!d) return;

    const niche = d.niche || {};
    const nicheNom = niche.disponible !== false ? (niche.nom || '') : '';
    if (nicheNom && typeof preRemplirSiVide === 'function') {
      preRemplirSiVide('ideaNiche', nicheNom);
    }

    const themeEl = document.getElementById('ideaTheme');
    if (themeEl && !themeEl.value.trim()) {
      const placeholderAvant = themeEl.placeholder;
      themeEl.placeholder = 'Je réfléchis à un sujet pour toi…';
      const sujet = await suggestionSujetDepuisSommaire(nicheNom, (d.bio && d.bio.actuelle) || '');
      // Revérifié après l'appel : l'utilisateur a pu commencer à taper
      // pendant l'attente, jamais écraser ce qu'il a déjà saisi.
      if (sujet && !themeEl.value.trim()) themeEl.value = sujet;
      themeEl.placeholder = placeholderAvant;
    }
  } catch (e) { /* silencieux : best-effort, ne doit jamais bloquer l'ouverture du mode Idées */ }
}

function salutationAccueil() {
  // Salutation selon le jour ET l'heure LOCALE du téléphone de l'utilisateur :
  // - Lundi à jeudi : 0h-11h59 → Bonjour, 12h-17h59 → Bon après-midi, 18h-23h59 → Bonsoir.
  // - Vendredi : "Bon vendredi" toute la journée, quelle que soit l'heure.
  // - Samedi et dimanche : "Bon week-end" toute la journée, quelle que soit l'heure.
  const maintenant = new Date();
  const jour = maintenant.getDay(); // 0 = dimanche, 1 = lundi, ..., 5 = vendredi, 6 = samedi
  let base;
  if (jour === 5) {
    base = 'Bon vendredi';
  } else if (jour === 0 || jour === 6) {
    base = 'Bon week-end';
  } else {
    const h = maintenant.getHours();
    base = h < 12 ? 'Bonjour' : (h < 18 ? 'Bon après-midi' : 'Bonsoir');
  }
  const prenom = prenomDepuisCode();
  return prenom ? (base + ' ' + prenom + ' 👋') : (base + ' 👋');
}

// ── Cache journalier de la recommandation d'accueil ──
// initAccueilPremium() se déclenche à CHAQUE ouverture de la page d'accueil :
// sans cache, un abonné qui rouvre l'app plusieurs fois par jour relance
// autant d'appels au modèle pour un contenu qui n'a aucune raison d'avoir
// changé entre deux visites de la même journée. Stocké côté navigateur
// (localStorage, par code d'accès) : pas de changement de schéma Supabase,
// et la recommandation reste correcte même hors-ligne le temps de la journée.
function cleRecoJour() {
  const d = new Date();
  const jour = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return 'scriptura_reco_' + getUserRef() + '_' + jour;
}
function lireRecoCache() {
  try {
    const brut = localStorage.getItem(cleRecoJour());
    return brut ? JSON.parse(brut) : null;
  } catch (e) { return null; }
}
function ecrireRecoCache(data) {
  try {
    const cleDuJour = cleRecoJour();
    localStorage.setItem(cleDuJour, JSON.stringify(data));
    // Nettoyage léger : les entrées des jours précédents ne servent plus à rien.
    const prefixe = 'scriptura_reco_' + getUserRef() + '_';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefixe) && k !== cleDuJour) localStorage.removeItem(k);
    }
  } catch (e) { /* stockage plein ou indisponible : tant pis, pas bloquant */ }
}
// Invalide la recommandation du jour : appelée après toute nouvelle
// génération (voir saveGeneration, js/historique.js), pour qu'un créateur
// qui vient d'agir sur la reco n'en revoie pas une devenue obsolète le
// reste de la journée. Sans effet si aucune reco n'était en cache.
function viderRecoCache() {
  try { localStorage.removeItem(cleRecoJour()); } catch (e) { /* silencieux */ }
}

// ── Plafond quotidien du bouton "Nouvelle recommandation" ──
// Pour maîtriser les coûts API : chaque clic sur "Nouvelle recommandation"
// relance un appel au modèle. On en autorise au plus RECO_REFRESH_MAX par jour
// et par créateur (la 1re reco du jour, elle, ne compte pas). Compteur stocké
// côté navigateur, clé par jour — recharger l'app ne le remet donc PAS à zéro
// (sinon le plafond serait contournable et n'économiserait rien). Repart à 0 le
// lendemain, en phase avec le cache de reco déjà journalier.
const RECO_REFRESH_MAX = 2;
function cleRecoRefresh() {
  const d = new Date();
  const jour = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return 'scriptura_reco_refresh_' + getUserRef() + '_' + jour;
}
function recoRefreshUtilises() {
  try { return parseInt(localStorage.getItem(cleRecoRefresh()) || '0', 10) || 0; } catch (e) { return 0; }
}
function recoRefreshRestants() {
  return Math.max(0, RECO_REFRESH_MAX - recoRefreshUtilises());
}
function incrementerRecoRefresh() {
  try {
    const cle = cleRecoRefresh();
    localStorage.setItem(cle, String(recoRefreshUtilises() + 1));
    // Nettoyage des compteurs des jours précédents (ne servent plus).
    const prefixe = 'scriptura_reco_refresh_' + getUserRef() + '_';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefixe) && k !== cle) localStorage.removeItem(k);
    }
  } catch (e) { /* silencieux */ }
}

async function initAccueilPremium() {
  const zone = document.getElementById('accueilPremium');
  if (!zone) return;
  // Filet de sécurité : une erreur imprévue n'importe où dans cette fonction
  // (profil corrompu, fonction manquante après une mise à jour non encore
  // rechargée par le navigateur, etc.) ne doit jamais laisser la zone vide
  // et invisible — elle doit au moins retomber sur le message de repli.
  try {
    await initAccueilPremiumInterne(zone);
  } catch (e) {
    console.warn('Accueil personnalisé indisponible', e);
    zone.innerHTML = `
      <div class="score-card">
        <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
        <div class="audit-diag-interp">Scriptura n'a pas pu préparer ta recommandation du jour pour le moment. Réessaie un peu plus tard.</div>
      </div>`;
    zone.style.display = 'block';
  }
}

async function initAccueilPremiumInterne(zone) {
  // Non-abonné (visiteur anonyme OU acheteur de jetons à l'unité, qui reste
  // non-abonné dans Scriptura) : même emplacement que la carte des abonnés,
  // mais un simple message d'accueil — jamais de recommandation
  // personnalisée, réservée aux abonnés (fonctionnalité Premium). Le titre
  // principal de la page ("Ton contenu, réinventé.") n'est pas touché.
  // Acheteur de jetons : code "jeton" enregistré (scriptura_code) mais pas
  // "unlocked". C'est un mini-compte identifié — il a droit à l'accueil
  // personnalisé et aux recommandations, comme un abonné. Seul le visiteur
  // VRAIMENT anonyme (aucun code enregistré) voit le simple mot de bienvenue.
  const aUnCode = !!(localStorage.getItem('scriptura_code') || '').trim();
  if (!unlocked && !aUnCode) {
    // Exception : un visiteur anonyme qui a déjà généré quelque chose sur
    // CE navigateur (script, récit, diagnostic sommaire...) a laissé assez
    // de mémoire à Scriptura pour lui montrer un aperçu utile — une seule
    // idée condensée, pas les 6 recommandations détaillées réservées aux
    // abonnés. S'il n'y a encore rien de connu, on retombe sur le simple
    // mot de bienvenue (voir genererRecommandations → rienDeConnu).
    let dataAnon = lireRecoCache();
    // Un "onboarding" en cache (écrit avant ce correctif, ou par une
    // exécution plus ancienne du code) est traité comme une absence de
    // cache : cet état est censé changer dans la journée, on ne s'y fie
    // jamais, même s'il traîne encore dans le localStorage de quelqu'un.
    if (dataAnon && dataAnon.onboarding) dataAnon = null;
    if (!dataAnon) {
      // La salutation ne dépend d'aucun appel réseau : elle s'affiche tout
      // de suite, avec un message d'attente, plutôt que de laisser la zone
      // vide et silencieuse pendant tout l'appel IA (voir même principe
      // plus bas pour le cas abonné).
      zone.innerHTML = `<div class="results-heading">${salutationAccueil()}</div>
        <div class="ideas-sub" style="margin:6px 0 20px">Un instant, je regarde ce que je peux te proposer…</div>`;
      zone.style.display = 'block';
      dataAnon = await genererRecommandations(null, null);
      // Ne JAMAIS mettre en cache un résultat "onboarding" (pas encore assez
      // d'infos) : contrairement à un échec technique, cet état change dès
      // que le visiteur suit le conseil (fait une génération) — le mettre en
      // cache pour la journée entière l'empêcherait de voir sa vraie
      // recommandation juste après avoir fait exactement ce qu'on lui a
      // demandé.
      if (dataAnon && !dataAnon.onboarding) ecrireRecoCache(dataAnon);
    }
    if (dataAnon && !dataAnon.onboarding && Array.isArray(dataAnon.recommandations) && dataAnon.recommandations.length) {
      const enteteAnon = `<div class="results-heading">${salutationAccueil()}</div>
        <div class="ideas-sub" style="margin:6px 0 20px">Voici un aperçu de ce que Scriptura peut faire pour toi.</div>`;
      rendreRecommandationSommaire('accueilPremium', dataAnon, enteteAnon);
      return;
    }
    const dejaSommaireAnon = await aFaitDiagnosticSommaire();
    zone.innerHTML = dejaSommaireAnon ? `
      <div class="results-heading">${salutationAccueil()}</div>
      <div class="ideas-sub" style="margin:6px 0 20px">Ton diagnostic sommaire est fait — il me manque une génération (une idée, un script ou un récit) pour te proposer une vraie recommandation, fiable.</div>
      <button class="btn-generate" onclick="demarrerIdeesDepuisSommaire()">💡 Trouver mes premières idées</button>
    ` : `
      <div class="results-heading">Bienvenue sur Scriptura.</div>
      <div class="ideas-sub" style="margin:6px 0 20px">Pour des recommandations vraiment pensées pour toi, commence par analyser ton compte TikTok.</div>
      <button class="btn-generate" onclick="chooseMode('audit')">📊 Analyser mon compte</button>
    `;
    zone.style.display = 'block';
    return;
  }

  const entete = `<div class="results-heading">${salutationAccueil()}</div>
    <div class="ideas-sub" style="margin:6px 0 20px">Voici ce que je te recommande aujourd'hui.</div>`;

  // Une recommandation déjà générée aujourd'hui pour ce créateur : on la
  // réaffiche telle quelle plutôt que de refaire un appel identique.
  let data = lireRecoCache();
  // Un "onboarding" en cache (écrit avant ce correctif, ou par une
  // exécution plus ancienne du code) est traité comme une absence de
  // cache : cet état est censé changer dans la journée, on ne s'y fie
  // jamais, même s'il traîne encore dans le localStorage de quelqu'un.
  if (data && data.onboarding) data = null;
  if (!data) {
    // La salutation n'a aucune raison d'attendre la recommandation elle-même
    // (appel IA, potentiellement long) : on l'affiche tout de suite, avec un
    // message clair pour que l'abonné comprenne que sa recommandation arrive
    // plutôt que de voir un accueil vide et silencieux pendant ce temps.
    zone.innerHTML = `${entete}
      <div class="score-card">
        <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
        <div class="audit-diag-interp">Je prépare ta recommandation du jour, ça arrive dans un instant…</div>
      </div>`;
    zone.style.display = 'block';
    data = await genererRecommandations(null, null);
    // On ne met en cache qu'une vraie recommandation exploitable — jamais un
    // échec technique (null), pour qu'un simple problème réseau ne bloque
    // pas toute la journée, ET jamais un résultat "onboarding" (pas encore
    // assez d'infos) : cet état change dès que l'abonné suit le conseil
    // (fait une génération), le mettre en cache l'empêcherait de voir sa
    // vraie recommandation juste après avoir fait exactement ce qu'on lui a
    // demandé.
    if (data && !data.onboarding) ecrireRecoCache(data);
  }

  if (data && data.onboarding) {
    // Pas assez de mémoire encore : message honnête plutôt que rien du
    // tout (sinon la fonctionnalité paraît absente/cassée, voir consigne
    // "niveau de confiance adapté plutôt que d'inventer des certitudes").
    // Message ciblé s'il a déjà fait un diagnostic sommaire (voir
    // aFaitDiagnosticSommaire) : ce diagnostic seul ne suffit jamais à une
    // recommandation fiable, mais on le lui dit explicitement plutôt que de
    // le renvoyer vers un diagnostic qu'il a déjà fait.
    const dejaSommaire = await aFaitDiagnosticSommaire();
    zone.innerHTML = dejaSommaire ? `${entete}
      <div class="score-card">
        <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
        <div class="audit-diag-constat">Ton diagnostic sommaire est fait, bien joué.</div>
        <div class="audit-diag-interp">Il me manque encore une génération (une idée, un script ou un récit) pour te faire une recommandation vraiment fiable — le diagnostic sommaire seul ne montre que ta bio et ta niche, pas encore ce qui fonctionne pour toi.</div>
        <button class="btn-generate" style="margin-top:14px" onclick="demarrerIdeesDepuisSommaire()">💡 Trouver mes premières idées</button>
      </div>` : `${entete}
      <div class="score-card">
        <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
        <div class="audit-diag-constat">Scriptura apprend encore tes habitudes.</div>
        <div class="audit-diag-interp">Analyse ton compte TikTok : tes recommandations personnalisées apparaîtront ici dès la prochaine visite.</div>
        <button class="btn-generate" style="margin-top:14px" onclick="chooseMode('audit')">📊 Analyser mon compte</button>
      </div>`;
    zone.style.display = 'block';
    return;
  }

  if (!data) {
    // Échec technique (API indisponible, timeout, JSON invalide...) : on
    // garde quand même la salutation plutôt que de vider toute la zone
    // (sinon l'accueil paraît cassé alors que ce n'est qu'un souci
    // ponctuel — voir le cas "onboarding" juste au-dessus, qui applique
    // déjà ce principe pour l'autre cas de figure).
    zone.innerHTML = `${entete}
      <div class="score-card">
        <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
        <div class="audit-diag-interp">Scriptura n'a pas pu préparer ta recommandation du jour pour le moment. Réessaie un peu plus tard.</div>
      </div>`;
    zone.style.display = 'block';
    return;
  }
  rendreRecommandations('accueilPremium', data, entete, true);
}

// Force une nouvelle recommandation d'accueil, sans attendre le changement
// de jour (vide le cache du jour puis relance l'initialisation normale).
async function rafraichirRecommandationAccueil() {
  // Plafond quotidien atteint : le bouton ne répond plus (économie d'API).
  if (recoRefreshRestants() <= 0) return;
  const btn = document.getElementById('btnRafraichirReco');
  // Le doré remplit progressivement le bouton (via .reco-refresh-loading) et le
  // texte passe en blanc, le temps que Scriptura trouve une nouvelle reco.
  // Le re-render de initAccueilPremium() remplace ensuite le bouton (fin de l'anim).
  if (btn) { btn.disabled = true; btn.classList.add('reco-refresh-loading'); }
  // On compte l'appel AVANT de le lancer : c'est le coût API qu'on plafonne.
  incrementerRecoRefresh();
  viderRecoCache();
  await initAccueilPremium();
}

// ── Fin d'un rapport d'audit : "Et maintenant ?" ──
// Remplace l'ancienne section "opportunités" par la même brique de
// recommandation que l'accueil, pour un parcours cohérent
// Analyse → Décision → Script → Storyboard.
async function afficherEtMaintenant(auditFrais, ts, niche, objectif) {
  const zone = document.getElementById('auditOpportunites');
  if (!zone) return;

  // Audit rouvert depuis "Mes générations" : la recommandation a déjà été
  // générée et sauvegardée la première fois (voir plus bas) — on la
  // réaffiche telle quelle. Sans ça, chaque réouverture en produisait une
  // nouvelle, différente de celle vue initialement.
  if (auditFrais && auditFrais.recommandation_ia) {
    rendreRecommandations('auditOpportunites', auditFrais.recommandation_ia, '<div class="audit-section-label">Et maintenant ?</div>');
    return;
  }

  zone.innerHTML = '<div class="audit-section-label">Et maintenant ?</div><div class="audit-diag-interp">Scriptura cherche la meilleure recommandation pour ton compte…</div>';

  const data = await genererRecommandations(auditFrais, ts, niche, objectif);
  // rienDeConnu ne devrait jamais arriver ici (l'audit tout juste terminé
  // fournit toujours un diagnostic), mais on s'en protège par cohérence.
  if (!data || data.onboarding) { zone.innerHTML = ''; return; }
  if (typeof sauvegarderRecommandationAudit === 'function') sauvegarderRecommandationAudit(data);
  rendreRecommandations('auditOpportunites', data, '<div class="audit-section-label">Et maintenant ?</div>');
}

// Équivalent de afficherEtMaintenant(), pour le diagnostic sommaire (@username)
// et réservé aux non-abonnés : si Scriptura a déjà assez de mémoire locale sur
// ce visiteur (script, récit, autre diagnostic déjà fait sur ce navigateur),
// on lui montre une idée condensée en plus de son diagnostic.
async function afficherOpportuniteDiagSommaire() {
  const zone = document.getElementById('diagSommaireOpportunites');
  if (!zone) return;

  let data = lireRecoCache();
  // Même règle que initAccueilPremiumInterne : un "onboarding" en cache
  // (même écrit avant ce correctif) est traité comme une absence de cache.
  if (data && data.onboarding) data = null;
  if (!data) {
    data = await genererRecommandations(null, null);
    // Un résultat "onboarding" ne se met jamais en cache, cet état pouvant
    // changer dans la journée.
    if (data && !data.onboarding) ecrireRecoCache(data);
  }
  if (!data || data.onboarding || !Array.isArray(data.recommandations) || !data.recommandations.length) {
    zone.innerHTML = '';
    return;
  }

  rendreRecommandationSommaire('diagSommaireOpportunites', data, '<div class="audit-section-label">🎯 En plus de ce diagnostic</div>');
}

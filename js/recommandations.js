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

  // Recherche web : uniquement si la niche du créateur touche l'actualité/la
  // géopolitique (voir js/api.js) — c'est exactement le cas qui a produit une
  // recommandation datée à tort ("2024 sera décisif" alors qu'on est en 2026).
  const rechercheWebReco = nicheNecessiteRecherche(profil.declare.niche_principale);

  const prompt = `Tu es le Directeur Éditorial de Scriptura, l'assistant IA personnel d'un créateur de contenu francophone. Tu le connais grâce à sa mémoire accumulée dans Scriptura (générations passées, préférences, audits). Ta mission : lui dire précisément quoi créer aujourd'hui.
${rechercheWebReco ? '\nSUJET D\'ACTUALITÉ : avant de recommander, utilise la recherche web pour vérifier que les faits, personnes ou situations que tu mentionnes sont toujours d\'actualité — jamais une situation qui a pu changer depuis tes connaissances d\'entraînement.\n' : ''}
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

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"niveau_confiance":"faible|moyenne|élevée","recommandations":[{"titre":"...","angle":"...","justifications":["...","..."],"potentiel":"Élevé","ton_conseille":"Storytelling","hook":"..."}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 6000, prompt, undefined, rechercheWebReco);
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
      ${carteRecommandationHero(data.recommandations[0])}
      ${confianceNote}
      <button class="btn-generate" style="margin-top:20px" onclick="creerScriptDepuisRecommandation(0)">Créer le script</button>
      <button class="btn-storyboard" style="width:100%;justify-content:center;margin-top:10px" onclick="toggleAutresRecommandations('${autresId}')">Voir d'autres recommandations</button>
      <div id="${autresId}" style="display:none;margin-top:18px"></div>
      ${avecRafraichir ? '<button class="btn-regenerate reco-refresh" style="width:100%;justify-content:center;margin-top:10px" id="btnRafraichirReco" onclick="rafraichirRecommandationAccueil()"><span class="reco-refresh-label">↻ Nouvelle recommandation</span></button>' : ''}
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

  if (code.length > 4 && /[0-9]/.test(code.slice(-4))) {
    const brut = code.slice(0, -4);
    if (LETTRES.test(brut)) return brut.charAt(0) + brut.slice(1).toLowerCase();
    return null;
  }

  if (LETTRES.test(code)) return code.charAt(0) + code.slice(1).toLowerCase();

  return null;
}

function salutationAccueil(profil) {
  // Salutation selon l'heure LOCALE du téléphone de l'utilisateur :
  // 0h-11h59 → Bonjour, 12h-17h59 → Bon après-midi, 18h-23h59 → Bonsoir.
  const h = new Date().getHours();
  const base = h < 12 ? 'Bonjour' : (h < 18 ? 'Bon après-midi' : 'Bonsoir');
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

async function initAccueilPremium() {
  const zone = document.getElementById('accueilPremium');
  if (!zone) return;

  // Non-abonné (visiteur anonyme OU acheteur de jetons à l'unité, qui reste
  // non-abonné dans Scriptura) : même emplacement que la carte des abonnés,
  // mais un simple message d'accueil — jamais de recommandation
  // personnalisée, réservée aux abonnés (fonctionnalité Premium). Le titre
  // principal de la page ("Ton contenu, réinventé.") n'est pas touché.
  if (!unlocked) {
    zone.innerHTML = `
      <div class="results-heading">Bienvenue sur Scriptura.</div>
      <div class="ideas-sub" style="margin:6px 0 20px">Que souhaites-tu créer aujourd'hui ?</div>
    `;
    zone.style.display = 'block';
    return;
  }

  const profil = await chargerProfilCreateur();
  const entete = `<div class="results-heading">${salutationAccueil(profil)}</div>
    <div class="ideas-sub" style="margin:6px 0 20px">Voici ce que je te recommande aujourd'hui.</div>`;

  // Une recommandation déjà générée aujourd'hui pour ce créateur : on la
  // réaffiche telle quelle plutôt que de refaire un appel identique.
  let data = lireRecoCache();
  if (!data) {
    data = await genererRecommandations(null, null);
    // On ne met en cache que les réponses exploitables (recommandations
    // réelles ou message d'onboarding) — jamais un échec technique (null),
    // pour qu'un simple problème réseau ne bloque pas toute la journée.
    if (data) ecrireRecoCache(data);
  }

  if (data && data.onboarding) {
    // Pas assez de mémoire encore : message honnête plutôt que rien du
    // tout (sinon la fonctionnalité paraît absente/cassée, voir consigne
    // "niveau de confiance adapté plutôt que d'inventer des certitudes").
    zone.innerHTML = `${entete}
      <div class="score-card">
        <div class="audit-score-label">🎯 RECOMMANDATION IA</div>
        <div class="audit-diag-constat">Scriptura apprend encore tes habitudes.</div>
        <div class="audit-diag-interp">Fais une première génération ou un diagnostic : tes recommandations personnalisées apparaîtront ici dès la prochaine visite.</div>
      </div>`;
    zone.style.display = 'block';
    return;
  }

  if (!data) { zone.innerHTML = ''; zone.style.display = 'none'; return; }
  rendreRecommandations('accueilPremium', data, entete, true);
}

// Force une nouvelle recommandation d'accueil, sans attendre le changement
// de jour (vide le cache du jour puis relance l'initialisation normale).
async function rafraichirRecommandationAccueil() {
  const btn = document.getElementById('btnRafraichirReco');
  // Le doré remplit progressivement le bouton (via .reco-refresh-loading) et le
  // texte passe en blanc, le temps que Scriptura trouve une nouvelle reco.
  // Le re-render de initAccueilPremium() remplace ensuite le bouton (fin de l'anim).
  if (btn) { btn.disabled = true; btn.classList.add('reco-refresh-loading'); }
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

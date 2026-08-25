// ═══════════════════════════════════════════════════════════
//  RECOMMANDATION IA, l'assistant personnel de Scriptura
//  Combine la mémoire du créateur (js/profil.js) et, quand disponible,
//  le diagnostic d'un audit tout juste terminé, pour dire au créateur
//  quoi créer aujourd'hui et pourquoi. Affichée à deux endroits :
//  l'accueil (fonctionnalité Premium, voir initAccueilPremium) et la
//  fin d'un rapport d'audit (voir afficherEtMaintenant, appelée par
//  renderAudit dans js/audit.js).
//
//  Ne modifie aucun mode existant, aucune règle d'analyse, aucun
//  prompt métier : nouveau prompt dédié, purement additif. N'invente
//  jamais de certitude, si la mémoire disponible est trop mince,
//  aucune recommandation n'est générée (ou son niveau de confiance
//  est signalé comme faible), plutôt que d'inventer des données.
// ═══════════════════════════════════════════════════════════

let _recommandations = [];
// true UNIQUEMENT quand la prochaine génération de script provient du bouton
// "Créer le script" de la recommandation (voir creerScriptDepuisRecommandation
// et generate(), js/generation.js). Consommé (remis à false) par le tout
// premier generate() qui suit, réussi ou non, jamais laissé traîner sur une
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

// Résumé compact d'un diagnostic sommaire (pour nourrir la recommandation) :
// niche réelle, vidéos qui percent (sujet + vues), concepts récurrents.
// Vide si rien d'exploitable.
function resumeDiagnosticSommaire(contenu) {
  const d = contenu && contenu.diagnostic;
  if (!d) return '';
  const lignes = [];
  const niche = d.niche || {};
  if (niche.disponible !== false && niche.nom) lignes.push('Niche : ' + niche.nom);
  const tops = Array.isArray(d.top_videos) ? d.top_videos.filter(v => v && v.sujet) : [];
  if (tops.length) lignes.push('Vidéos qui percent : ' + tops.slice(0, 3).map(v => '« ' + v.sujet + ' » (' + (v.vues != null ? v.vues + ' vues' : '?') + ')').join(' ; '));
  const concepts = Array.isArray(d.concepts_recurrents) ? d.concepts_recurrents.filter(Boolean) : [];
  if (concepts.length) lignes.push('Concepts récurrents : ' + concepts.slice(0, 6).join(', '));
  // Formule gagnante détectée via un éventuel pivot (js/diagnostic-sommaire.js) :
  // signal fort pour recommander (réutiliser ce qui marchait le mieux).
  const evo = d.evolution || {};
  if (evo.pivot && evo.formule_gagnante) lignes.push('Formule qui performait le mieux (à réutiliser) : ' + evo.formule_gagnante);
  return lignes.join('\n');
}

// Construit le bloc « diagnostics » pour la recommandation, en distinguant
// le compte du créateur (ses vraies données de performance) des comptes de
// concurrents qu'il a analysés (intelligence de niche à ADAPTER). C'est ce
// croisement qui rend les recommandations plus fiables : mes mécaniques
// gagnantes d'un côté, ce qui marche dans la niche de l'autre.
// Retourne { texte, aSignalFort }, aSignalFort=true si on a de vraies
// données de performance sur SON compte (top vidéos), un signal suffisant à
// lui seul pour recommander (contrairement à un profil sommaire nu).
async function blocDiagnosticsPourReco() {
  if (typeof _recentesGenerationsDe !== 'function') return { texte: '', aSignalFort: false };
  const gens = await _recentesGenerationsDe('diagnosticSommaire', 8);
  if (!gens.length) return { texte: '', aSignalFort: false };

  const mien = gens.find(_sommaireEstMien);
  const concurrents = [];
  const vus = new Set();
  for (const g of gens) {
    if (_sommaireEstMien(g)) continue;
    const u = (g.contenu && g.contenu.username) || '';
    if (u && !vus.has(u)) { vus.add(u); concurrents.push(g); }
    if (concurrents.length >= 3) break;
  }

  let texte = '', aSignalFort = false;
  if (mien) {
    const r = resumeDiagnosticSommaire(mien.contenu);
    if (r) {
      aSignalFort = true;
      texte += '\nTES DONNÉES DE PERFORMANCE RÉELLES (son compte @' + ((mien.contenu && mien.contenu.username) || '') + ', lues sur TikTok, des FAITS sur LUI) :\n' + r + '\nSers-t\'en pour identifier SES mécaniques gagnantes et recommander des sujets NEUFS qui les réutilisent.';
    }
  }
  if (concurrents.length) {
    const blocs = concurrents.map(g => {
      const r = resumeDiagnosticSommaire(g.contenu);
      return r ? ('• @' + ((g.contenu && g.contenu.username) || '') + ' :\n' + r) : '';
    }).filter(Boolean);
    if (blocs.length) {
      texte += '\n\nCE QUI MARCHE CHEZ DES CONCURRENTS DE SA NICHE (comptes qu\'il a analysés, INSPIRE-toi du MÉCANISME, transpose-le sur des sujets neufs, ne copie JAMAIS le sujet ni le concurrent tel quel) :\n' + blocs.join('\n');
    }
  }
  return { texte, aSignalFort };
}

// auditFrais + ts : optionnels, passés uniquement depuis la fin d'un audit
// tout juste terminé (voir js/audit.js), pour enrichir la recommandation
// avec un diagnostic encore plus frais que la mémoire déjà enregistrée.
// nicheFraiche/objectifFrais : idem, transmis explicitement quand l'audit
// vient tout juste de se terminer et que le Profil Créateur n'a pas encore
// fini de les enregistrer en tâche de fond (voir renderAudit).
// Vérifie si Scriptura a VRAIMENT de quoi baser une recommandation (niche
// connue, thèmes déjà traités, leçons d'audit, diagnostic/génération tout
// juste fournis, ou signal fort croisé compte/concurrents), AVANT même
// d'afficher un message d'attente ou de lancer un appel IA. Sert à ne
// jamais promettre à l'utilisateur que Scriptura "regarde ce qui marche
// dans ta niche" alors que sa niche n'est pas encore connue : ce serait
// malhonnête, pas premium. Même logique que le calcul interne à
// genererRecommandations ci-dessous (rienDeConnu) : si l'un change, pense
// à répercuter sur l'autre.
async function aAssezDeMemoirePourReco(auditFrais, texteExtra, nicheFraiche) {
  const profilCharge = await chargerProfilCreateur();
  const diag = await blocDiagnosticsPourReco();
  return !!(
    nicheFraiche || profilCharge.declare.niche_principale
    || (profilCharge.observe.themes_traites && profilCharge.observe.themes_traites.length)
    || (profilCharge.lecons.recommandations_permanentes && profilCharge.lecons.recommandations_permanentes.length)
    || auditFrais || texteExtra
    || diag.aSignalFort
  );
}

// `texteExtra` (optionnel) : texte déjà prêt à injecter à la place de
// texteDiagnosticOpportunites(auditFrais, ts), pour un appelant dont les
// données n'ont pas la forme de l'audit détaillé (voir
// afficherOpportuniteDiagSommaire ci-dessous, qui construit le sien via
// texteDiagnosticSommaireOpportunites, js/diagnostic-sommaire.js). Les
// appelants existants (afficherEtMaintenant, initAccueilPremiumInterne) ne
// le passent jamais : comportement inchangé pour eux.
async function genererRecommandations(auditFrais, ts, nicheFraiche, objectifFrais, texteExtra) {
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
  const texteAuditFrais = texteExtra || (auditFrais ? texteDiagnosticOpportunites(auditFrais, ts || {}) : '');
  // Croisement mon compte / concurrents (analyses sommaires @nom d'utilisateur).
  const diag = await blocDiagnosticsPourReco();

  // Mémoire trop mince pour recommander quoi que ce soit d'honnête : on
  // n'invente rien. Signalé distinctement d'un échec technique (voir plus
  // bas) pour que l'accueil puisse afficher un message honnête plutôt que
  // de disparaître sans explication. Même condition que
  // aAssezDeMemoirePourReco ci-dessus (utilisée en amont par l'UI, avant
  // même d'afficher un message d'attente) : si l'un change, répercuter sur
  // l'autre.
  const rienDeConnu = !profil.declare.niche_principale
    && !(profil.observe.themes_traites && profil.observe.themes_traites.length)
    && !(profil.lecons.recommandations_permanentes && profil.lecons.recommandations_permanentes.length)
    && !texteAuditFrais
    && !diag.aSignalFort;
  if (rienDeConnu) return { onboarding: true };

  // Tout ce qui suit (construction du prompt incluse) est désormais dans le
  // try : une erreur de construction (fonction manquante, cache navigateur
  // désynchronisé après une mise à jour, etc.) ne doit jamais faire
  // disparaître silencieusement toute la zone de recommandation, elle doit
  // retomber sur le message de repli déjà prévu dans initAccueilPremium()
  // pour le cas "échec technique" (data === null).
  try {
    // Recherche web, deux besoins distincts, qui peuvent se cumuler :
    // 1) vérification factuelle, uniquement si la niche touche l'actualité/la
    //    géopolitique ou l'Histoire (voir js/api.js), c'est exactement le cas
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
${texteAuditFrais ? '\nDIAGNOSTIC TOUT JUSTE TERMINÉ :\n' + texteAuditFrais : ''}
${diag.texte || ''}

RÈGLE DE CONFIANCE, TRÈS IMPORTANTE : base-toi UNIQUEMENT sur les informations ci-dessus. N'invente JAMAIS une statistique, un fait ou une certitude que tu n'as pas. Si les informations connues sont limitées, dis-le honnêtement (niveau_confiance "faible") et propose des recommandations plus générales mais toujours utiles, plutôt que de prétendre connaître ce créateur mieux que tu ne le connais. Si tu disposes d'assez d'éléments concrets (niche connue, historique, leçons d'audit), sois précis et spécifique (niveau_confiance "élevée").

RÈGLE DU MÉCANISME GAGNANT, LE CŒUR DE TON TRAVAIL : ne confonds JAMAIS le SUJET qui a marché avec la RAISON pour laquelle il a marché. Si un thème ou une vidéo a bien performé pour ce créateur (une figure politique, un pays, un fait précis), ce n'est presque jamais le sujet en lui-même qui a plu, c'est un MÉCANISME sous-jacent, le ressort qui fait réagir l'audience. Identifie-le explicitement : rivalité entre personnalités que le public suit et débat déjà, révélation de coulisses du pouvoir, conflit clair et lisible, retournement ou trahison, enjeu qui touche la fierté ou l'identité du spectateur, personnages que l'audience connaît de longue date... Puis construis tes recommandations en RÉUTILISANT ce mécanisme, appliqué à des SUJETS ET DES ANGLES VARIÉS, surtout PAS en répétant les mêmes personnes ou le même pays. Reproduire le même sujet encore et encore est paresseux, générique et finit par lasser l'audience ; réutiliser le mécanisme gagnant sur du terrain neuf, c'est ça la vraie croissance. Tu peux garder AU PLUS UNE recommandation proche du sujet d'origine ; toutes les autres doivent transposer le mécanisme ailleurs.

MISSION : génère exactement 6 recommandations de contenu pour aujourd'hui, classées de la plus pertinente (index 0) à la moins pertinente pour CE créateur précis. Les 6 doivent porter sur des sujets NETTEMENT DIFFÉRENTS les uns des autres, jamais 6 variantes du même sujet, du même pays ou des mêmes personnalités.

Pour CHAQUE recommandation, fournis :
1. Un TITRE fort et accrocheur
2. L'ANGLE recommandé : l'approche précise à adopter
3. 2 à 4 JUSTIFICATIONS courtes prouvant la pertinence pour CE créateur, chacune doit citer un élément concret connu de lui ci-dessus (sa niche, un thème à ne pas répéter, une leçon d'audit, son objectif...). AU MOINS UNE justification doit nommer le MÉCANISME gagnant réutilisé, POURQUOI ça fera réagir son audience, et non se contenter de rappeler un sujet déjà traité. Si les éléments concrets manquent, formule une justification honnête et générale plutôt que d'inventer un fait précis.
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
//  VÉRIFICATION POST-GÉNÉRATION, filet de sécurité anti-hallucination
//  Un second appel IA, avec recherche web systématique, relit les
//  recommandations tout juste générées et corrige deux types d'erreurs
//  que le premier appel peut produire :
//  1. INCOHÉRENCE INTERNE : le titre parle d'un pays/d'une personne et
//     l'angle ou les justifications en citent un autre (c'est exactement
//     le bug constaté : titre "alliance béninoise" pour un contenu qui
//     parle en réalité du Sénégal ou du Gabon).
//  2. ERREUR FACTUELLE : un nom, un poste, un pays ou un fait d'actualité
//     cité est faux ou périmé, vérifié par recherche web.
//  Best-effort : si cette passe échoue (réseau, JSON invalide, etc.), on
//  renvoie les recommandations d'origine plutôt que de bloquer
//  l'affichage, une reco non vérifiée vaut mieux qu'aucune reco.
// ═══════════════════════════════════════════════════════════
async function verifierRecommandations(parsed) {
  try {
    const verifPrompt = `Tu es un vérificateur factuel strict. On te donne une liste de recommandations de contenu générées automatiquement pour un créateur TikTok francophone. Ta mission : les relire une par une et corriger deux types d'erreurs, AVANT qu'elles ne soient publiées.

1. COHÉRENCE INTERNE (vérifie en premier, sans recherche) : pour CHAQUE recommandation, le titre, l'angle, les justifications et le hook doivent tous parler EXACTEMENT du même pays, des mêmes personnes et des mêmes faits. Un titre qui mentionne un pays alors que l'angle ou les justifications en développent un autre est une erreur grave à corriger immédiatement (ex : un titre qui parle d'une "alliance béninoise" alors que les noms cités sont ceux de dirigeants sénégalais, c'est incohérent et faux, il faut corriger le pays dans le titre pour qu'il corresponde à la réalité du contenu).

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
  if (s === 'diagnostic') return { icone: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><rect x="5.5" y="13" width="3" height="6" rx="0.6"/><rect x="10.5" y="9" width="3" height="10" rx="0.6"/><rect x="15.5" y="6" width="3" height="13" rx="0.6"/></svg>', texte: "D'après ton diagnostic TikTok", premium: true };
  if (s === 'creations' || s === 'créations') return { icone: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4-8 4-8-4 8-4Z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg>', texte: "D'après tes créations", premium: false };
  if (s === 'mixte' || s.includes('deux')) return { icone: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z"/></svg>', texte: "D'après ton diagnostic et tes créations", premium: true };
  return null;
}
function badgeSourceReco(reco) {
  const i = infoSourceReco(reco);
  return i ? `<span class="reco-source-tag${i.premium ? ' premium' : ''}">${i.icone} ${i.texte}</span>` : '';
}

function carteRecommandationHero(reco, avecRafraichir) {
  const justifs = (reco.justifications || []).map(j => `<div class="audit-diag-interp"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg> ${escaperReco(j)}</div>`).join('');
  return `
    <div class="reco-header-row">
      <div class="audit-score-label" style="margin-bottom:0"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> RECOMMANDATION IA</div>
      ${avecRafraichir ? boutonActualiserReco() : ''}
    </div>
    <div class="idea-titre" style="font-size:1.25rem;margin-bottom:10px">${escaperReco(reco.titre)}</div>
    <div class="audit-diag-constat">${escaperReco(reco.angle)}</div>
    <div class="audit-section-label" style="margin-top:18px">Pourquoi cette recommandation ?</div>
    <div style="margin:10px 0 4px">${justifs}</div>
    <div class="reco-tags">${badgeSourceReco(reco)}<span class="summary-tag"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3-2 4.2-2 7a2 2 0 0 0 4 0c0-.6-.2-1.1-.5-1.6 2 1 3.5 2.9 3.5 5.1a5 5 0 0 1-10 0C7 12 9.5 9.3 12 3Z"/></svg> Potentiel estimé : ${escaperReco(reco.potentiel || 'Moyen')}</span></div>
  `;
}

// Version condensée de la recommandation, pour les non-abonnés qui ont
// déjà assez d'historique local (générations, diagnostic sommaire...) pour
// que Scriptura sache quoi leur suggérer, sans révéler la richesse
// complète (justifications, hook, ton conseillé) réservée aux abonnés.
function carteRecommandationSommaire(reco) {
  return `
    <div class="audit-score-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> UNE IDÉE POUR TOI</div>
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
  // Nécessaire pour que creerScriptDepuisRecommandation(0) (bouton ci-dessous)
  // retrouve la bonne recommandation, même mécanisme que rendreRecommandations,
  // voir plus bas. Le non-abonné garde ses limites habituelles (MAX_FREE) au
  // moment de générer réellement le script : ce bouton ne fait que pré-remplir
  // le récapitulatif, il ne contourne aucun quota.
  _recommandations = data.recommandations;
  zone.innerHTML = `
    ${entete || ''}
    <div class="score-card">
      ${carteRecommandationSommaire(data.recommandations[0])}
      <button class="btn-generate" style="margin-top:14px" onclick="creerScriptDepuisRecommandation(0)"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h6.5L18 8v11.5A1 1 0 0 1 17 20.5H7A1 1 0 0 1 6 19.5v-15A1 1 0 0 1 7 3.5Z"/><path d="M13.5 3.5V8H18"/><path d="M9 12h6"/><path d="M9 15h6"/><path d="M9 18h4"/></svg> Créer le script</button>
      <div class="ds-result-subscribe" style="margin-top:12px">✦ Abonne-toi pour un suivi personnalisé complet : 6 recommandations détaillées, hooks, tons conseillés, et un script en un clic.</div>
    </div>`;
  zone.style.display = 'block';
}

function carteRecommandationSecondaire(reco, index) {
  const justifs = (reco.justifications || []).map(j => '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg> ' + escaperReco(j)).join('<br/>');
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
      <div class="idea-actions"><button class="idea-btn-script" onclick="creerScriptDepuisRecommandation(${index})"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h6.5L18 8v11.5A1 1 0 0 1 17 20.5H7A1 1 0 0 1 6 19.5v-15A1 1 0 0 1 7 3.5Z"/><path d="M13.5 3.5V8H18"/><path d="M9 12h6"/><path d="M9 15h6"/><path d="M9 18h4"/></svg> Créer le script</button></div>
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
// atteint (séparée du bouton, désormais logé dans l'en-tête, voir ci-dessus).
function noteLimiteReco() {
  const restants = (typeof recoRefreshRestants === 'function') ? recoRefreshRestants() : RECO_REFRESH_MAX;
  if (restants > 0) return '';
  return `<div class="ideas-sub" style="text-align:center;margin-top:8px;font-size:0.76rem;opacity:0.65">Tu as atteint ta limite du jour, de nouvelles recommandations demain.</div>`;
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
    ? '<div class="audit-diag-interp" style="margin-top:14px">Scriptura te connaît encore peu, ces recommandations s\'affineront à mesure que tu utilises Scriptura davantage.</div>'
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
// et creerScriptDepuisOpportunite (js/generation.js, js/audit.js), ne
// modifie ni ne redemande rien, ne fait que pré-remplir des champs déjà
// existants avant d'ouvrir directement le récapitulatif.
function creerScriptDepuisRecommandation(index) {
  const reco = _recommandations[index];
  if (!reco) return;

  _recoEnCoursDaction = true; // la prochaine génération de script correspond à cette recommandation

  // Enregistré dès CE clic, pas seulement si la génération qui suit aboutit :
  // sans ça, un créateur qui clique "Générer le script" puis abandonne le
  // formulaire (ferme l'écran, change de sujet, génération ratée...) n'était
  // jamais mémorisé comme "déjà traité", et la même recommandation pouvait
  // ressortir le lendemain. mettreAJourProfilCreateur dédoublonne déjà, donc
  // ça ne fait pas doublon si generate() l'enregistre une seconde fois.
  if (reco.titre && typeof mettreAJourProfilCreateur === 'function') {
    mettreAJourProfilCreateur({ observe: { themes_traites: reco.titre.slice(0, 80) } });
  }
  if (typeof viderRecoCache === 'function') viderRecoCache();

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
    showStep(3);
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
//    d'un prénom entier écrit sans suffixe (voir cas 2), sans ce repère,
//    "PAULINE" serait mal coupé en "Pau" + "LINE".
// 2. Codes créés à la main, sans suffixe (ex. "FIFA") : Rey en crée
//    parfois directement à partir du seul prénom. Dans ce cas, le code
//    entier EST le prénom, à condition qu'il ne contienne que des lettres
//    (ça exclut les codes génériques type SCRIPTURA-JUIL-2026, qui ont des
//    tirets, sans avoir à les lister un par un).
// Renvoie null si rien de tout ça ne correspond : pas de prénom affiché
// plutôt que d'en deviner un faux.
function prenomDepuisCode(codeParam) {
  const code = (codeParam || localStorage.getItem('scriptura_code') || '').trim().toUpperCase();
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
// d'utilisateur, js/diagnostic-sommaire.js), utilisé uniquement pour
// distinguer, dans le message "pas encore assez d'infos", le cas où il l'a
// DÉJÀ fait (message ciblé : il ne lui manque qu'une génération) du cas où
// il n'a vraiment rien fait (message générique renvoyant vers le
// diagnostic). Un diagnostic sommaire seul (niche + bio, aucune donnée de
// performance réelle) ne suffit jamais à lui seul à une recommandation
// fiable, voir genererRecommandations, qui ne le compte pas comme un
// signal utilisable. Best-effort : toute erreur retombe sur le message
// générique plutôt que de bloquer l'affichage.
async function aFaitDiagnosticSommaire() {
  if (typeof _recentesGenerationsDe !== 'function') return false;
  try {
    // Seul un diagnostic de SON compte compte : avoir analysé un concurrent ne
    // signifie pas qu'il a analysé le sien.
    const gens = await _recentesGenerationsDe('diagnosticSommaire', 8);
    return gens.some(_sommaireEstMien);
  } catch (e) { return false; }
}

// Signale si ce visiteur a déjà analysé son compte, sommaire OU détaillé
// (voir _derniereGenerationDe, js/diagnostic-fusion.js), sert à masquer
// l'invitation "Commence par analyser ton compte" et le badge "Commence
// ici" (voir revelerModes, js/ui.js) une fois cette étape déjà franchie :
// continuer à la pousser vers quelqu'un qui l'a déjà fait est trompeur.
// Best-effort : toute erreur retombe sur "pas encore fait" (comportement
// actuel, jamais régressif) plutôt que de bloquer l'affichage des modes.
async function aFaitAnalyseCompte() {
  if (typeof _derniereGenerationDe !== 'function' || typeof _recentesGenerationsDe !== 'function') return false;
  try {
    const [audit, sommaires] = await Promise.all([
      _derniereGenerationDe('audit'),
      _recentesGenerationsDe('diagnosticSommaire', 8)
    ]);
    // L'audit par captures est toujours le sien ; côté sommaire, seul un
    // diagnostic de SON compte compte (pas un concurrent analysé).
    return !!(audit || (Array.isArray(sommaires) && sommaires.some(_sommaireEstMien)));
  } catch (e) { return false; }
}

// Depuis le bouton "Trouver mes premières idées" affiché après un
// diagnostic sommaire (voir aFaitDiagnosticSommaire ci-dessus) : ouvre le
// mode Idées et pré-remplit la niche et le sujet à partir de ce que le
// diagnostic sait déjà (niche + bio), jamais sur un champ déjà rempli par
// l'utilisateur, et libre à lui de tout modifier avant de générer. Le champ
// "niche" ne se pré-sélectionne que si le nom identifié par le diagnostic
// correspond exactement à une option du menu (voir preRemplirSiVide,
// js/profil.js) ; sinon on laisse la niche vide plutôt que de deviner.
// Transforme niche + bio en UN sujet de contenu concret, dans le même
// esprit que les exemples déjà affichés dans le champ ("les empires
// africains", "la psychologie de l'argent"...). Les champs bruts du
// diagnostic sommaire (niche.analyse, bio.actuelle) sont écrits pour un
// AUDIT, analytiques, à la troisième personne, et ne ressemblent jamais
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

Propose UN SEUL sujet de vidéo concret et précis qu'il pourrait explorer, dans le même esprit que ces exemples : "les empires africains", "la psychologie de l'argent", "les femmes qui ont marqué l'histoire". Un sujet court (5 à 10 mots) : jamais une analyse, jamais une phrase qui parle DE lui ou de sa bio, un vrai sujet de contenu, prêt à explorer tel quel.

Réponds UNIQUEMENT avec ce sujet, sans guillemets, sans ponctuation finale, rien d'autre.`;
    const raw = await callAI(MODEL_RAPIDE, 60, prompt);
    const sujet = (raw || '').trim().replace(/^["«»]+|["«»]+$/g, '').replace(/\.$/, '');
    return (sujet.length > 2 && sujet.length < 150) ? sujet : '';
  } catch (e) { return ''; }
}

async function demarrerIdeesDepuisSommaire() {
  chooseMode('ideas');
  if (typeof _recentesGenerationsDe !== 'function') return;
  try {
    // On pré-remplit à partir de SON compte uniquement, jamais d'un concurrent
    // qu'il aurait analysé (sa niche à lui, pas celle du concurrent).
    const gens = await _recentesGenerationsDe('diagnosticSommaire', 8);
    const g = gens.find(_sommaireEstMien);
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
  // prenom vient du code d'accès (localStorage.scriptura_code), saisi
  // librement par l'utilisateur (voir syncHistory, js/historique.js) et
  // jamais validé côté serveur avant stockage : échappé avant d'être inséré
  // dans le HTML de la salutation (toutes les utilisations le sont).
  const prenom = prenomDepuisCode();
  const prenomSur = prenom ? escaperReco(prenom) : prenom;
  const texte = prenomSur ? (base + ' ' + prenomSur + ' 👋') : (base + ' 👋');

  // Flèche de bascule entre comptes connus sur ce navigateur (voir
  // changerCodeAcces/memoriserCompteConnu, js/auth.js) : uniquement pour un
  // abonné, et seulement s'il existe AU MOINS un autre compte que l'actuel,
  // sinon la flèche n'aurait rien à proposer.
  if (typeof unlocked === 'undefined' || !unlocked) return texte;
  const autres = (typeof autresComptesConnus === 'function') ? autresComptesConnus() : [];
  if (!autres.length) return texte;

  const items = autres.map(c => {
    const p = prenomDepuisCode(c.code);
    const label = p ? escaperReco(p) : c.code;
    return `<button type="button" onclick="basculerVersCompteConnu('${c.code}')">${label}</button>`;
  }).join('')
    // "Se déconnecter" : même fonction que le bouton du panneau latéral
    // (seDeconnecter, js/ui.js), juste accessible directement depuis ce
    // menu plutôt que d'aller le chercher ailleurs. Séparé visuellement des
    // comptes (voir .swap-logout, css/style.css) pour ne jamais être
    // confondu avec une bascule de compte.
    + '<button type="button" class="swap-logout" onclick="seDeconnecter()">Se déconnecter</button>';
  // Le menu est positionné (position:absolute) par rapport à
  // .salutation-swap-anchor, pas à .salutation-swap-wrap : ce dernier
  // englobe TOUT le texte de la salutation (variable en largeur selon le
  // prénom), un right:0 posé sur lui aurait étiré le menu vers la gauche
  // depuis la fin de tout ce texte, le faisant apparaître sous le début de
  // la salutation plutôt que juste sous la flèche.
  return `<span class="salutation-swap-wrap">
    <span>${texte}</span>
    <span class="salutation-swap-anchor">
      <button type="button" class="salutation-swap-btn" onclick="toggleSelecteurComptes(event)" aria-label="Changer de compte">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <span class="salutation-swap-menu" id="salutationSwapMenu">${items}</span>
    </span>
  </span>`;
}

// Ferme le menu de bascule de compte si un clic a lieu ailleurs sur la page.
document.addEventListener('click', function(e) {
  const menu = document.getElementById('salutationSwapMenu');
  if (!menu || !menu.classList.contains('open')) return;
  if (e.target.closest('.salutation-swap-wrap')) return;
  menu.classList.remove('open');
});

function toggleSelecteurComptes(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('salutationSwapMenu');
  if (menu) menu.classList.toggle('open');
}

// ── Cache persistant de la recommandation d'accueil ──
// initAccueilPremium() se déclenche à CHAQUE ouverture de la page d'accueil :
// sans cache, un abonné qui rouvre l'app relance autant d'appels au modèle
// pour un contenu qui n'a aucune raison d'avoir changé. Stocké côté
// navigateur (localStorage, par code d'accès), sans expiration automatique :
// la recommandation reste la même tant que le créateur ne clique pas
// lui-même sur "Actualiser" ou "Générer le script" (voir viderRecoCache
// ci-dessous), y compris d'un jour à l'autre.
function cleRecoAbonne() {
  return 'scriptura_reco_' + getUserRef();
}
function lireRecoCache() {
  try {
    const brut = localStorage.getItem(cleRecoAbonne());
    return brut ? JSON.parse(brut) : null;
  } catch (e) { return null; }
}
function ecrireRecoCache(data) {
  try {
    const cle = cleRecoAbonne();
    localStorage.setItem(cle, JSON.stringify(data));
    // Nettoyage des anciennes entrées journalières (scriptura_reco_<code>_
    // <date>, avant le passage à un cache sans expiration) : ne servent
    // plus à rien, autant libérer la place.
    const prefixeAncien = cle + '_';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefixeAncien)) localStorage.removeItem(k);
    }
  } catch (e) { /* stockage plein ou indisponible : tant pis, pas bloquant */ }
}
// Invalide la recommandation en cache : appelée après un clic sur
// "Actualiser" ou "Générer le script" (voir saveGeneration,
// js/historique.js), les deux seuls déclencheurs d'une nouvelle
// recommandation désormais. Sans effet si aucune reco n'était en cache.
function viderRecoCache() {
  try { localStorage.removeItem(cleRecoAbonne()); } catch (e) { /* silencieux */ }
}

// ── Plafond quotidien du bouton "Nouvelle recommandation" ──
// Pour maîtriser les coûts API : chaque clic sur "Nouvelle recommandation"
// relance un appel au modèle. On en autorise au plus RECO_REFRESH_MAX par jour
// et par créateur (la 1re reco du jour, elle, ne compte pas). Compteur stocké
// côté navigateur, clé par jour, recharger l'app ne le remet donc PAS à zéro
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
  // et invisible, elle doit au moins retomber sur le message de repli.
  try {
    await initAccueilPremiumInterne(zone);
  } catch (e) {
    console.warn('Accueil personnalisé indisponible', e);
    zone.innerHTML = `
      <div class="score-card">
        <div class="audit-score-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> RECOMMANDATION IA</div>
        <div class="audit-diag-interp">Scriptura n'a pas pu préparer ta recommandation du jour pour le moment. Réessaie un peu plus tard.</div>
      </div>`;
    zone.style.display = 'block';
  }
}

async function initAccueilPremiumInterne(zone) {
  // Non-abonné (visiteur anonyme OU acheteur de jetons à l'unité, qui reste
  // non-abonné dans Scriptura) : même emplacement que la carte des abonnés,
  // mais un simple message d'accueil, jamais de recommandation
  // personnalisée, réservée aux abonnés (fonctionnalité Premium). Le titre
  // principal de la page ("Ton contenu, réinventé.") n'est pas touché.
  // Acheteur de jetons : code "jeton" enregistré (scriptura_code) mais pas
  // "unlocked". C'est un mini-compte identifié, il a droit à l'accueil
  // personnalisé et aux recommandations, comme un abonné. Seul le visiteur
  // VRAIMENT anonyme (aucun code enregistré) voit le simple mot de bienvenue.
  const aUnCode = !!(localStorage.getItem('scriptura_code') || '').trim();
  if (!unlocked && !aUnCode) {
    // Exception : un visiteur anonyme qui a déjà généré quelque chose sur
    // CE navigateur (script, récit, diagnostic sommaire...) a laissé assez
    // de mémoire à Scriptura pour lui montrer un aperçu utile, une seule
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
      // Vérifié AVANT d'afficher quoi que ce soit : promettre "je regarde ce
      // qui marche dans ta niche" à un visiteur dont on ne connaît encore
      // rien serait malhonnête. S'il n'y a vraiment rien à exploiter, on
      // saute directement au message "Bienvenue" plus bas, sans message
      // d'attente ni appel IA inutile (le résultat serait "onboarding" de
      // toute façon).
      if (!(await aAssezDeMemoirePourReco())) {
        dataAnon = { onboarding: true };
      } else {
        // La salutation ne dépend d'aucun appel réseau : elle s'affiche tout
        // de suite, avec un message d'attente, plutôt que de laisser la zone
        // vide et silencieuse pendant tout l'appel IA (voir même principe
        // plus bas pour le cas abonné).
        zone.innerHTML = `<div class="results-heading">${salutationAccueil()}</div>
          <div class="ideas-sub" style="margin:6px 0 20px">Un instant, je regarde ce qui marche en ce moment sur TikTok dans ta niche, pour te proposer une première idée…</div>`;
        zone.style.display = 'block';
        dataAnon = await genererRecommandations(null, null);
        // Ne JAMAIS mettre en cache un résultat "onboarding" (pas encore assez
        // d'infos) : contrairement à un échec technique, cet état change dès
        // que le visiteur suit le conseil (fait une génération), le mettre en
        // cache pour la journée entière l'empêcherait de voir sa vraie
        // recommandation juste après avoir fait exactement ce qu'on lui a
        // demandé.
        if (dataAnon && !dataAnon.onboarding) ecrireRecoCache(dataAnon);
      }
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
      <div class="ideas-sub" style="margin:6px 0 20px">Ton diagnostic sommaire est fait, il me manque une génération (une idée, un script ou un récit) pour te proposer une vraie recommandation, fiable.</div>
      <button class="btn-generate" onclick="demarrerIdeesDepuisSommaire()"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 18.5h5"/><path d="M10.5 21h3"/><path d="M12 3.5c-3.6 0-6 2.7-5.4 6.1.3 1.7 1.4 2.9 2.4 3.9.6.6.9 1.2 1 2h4c.1-.8.4-1.4 1-2 1-1 2.1-2.2 2.4-3.9C18 6.2 15.6 3.5 12 3.5Z"/></svg> Trouver mes premières idées</button>
    ` : `
      <div class="results-heading">Bienvenue sur Scriptura.</div>
      <div class="ideas-sub" style="margin:6px 0 20px">Pour des recommandations vraiment pensées pour toi, commence par analyser ton compte TikTok.</div>
      <button class="btn-generate" onclick="chooseMode('audit')"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><rect x="5.5" y="13" width="3" height="6" rx="0.6"/><rect x="10.5" y="9" width="3" height="10" rx="0.6"/><rect x="15.5" y="6" width="3" height="13" rx="0.6"/></svg> Analyser mon compte</button>
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
    // Vérifié AVANT d'afficher le message d'attente : promettre "je regarde
    // ce qui marche dans ta niche" à un abonné dont on ne connaît encore
    // rien serait malhonnête. S'il n'y a vraiment rien à exploiter, on saute
    // directement au message "Scriptura apprend encore tes habitudes" plus
    // bas, sans message d'attente ni appel IA inutile.
    if (!(await aAssezDeMemoirePourReco())) {
      data = { onboarding: true };
    } else {
      // La salutation n'a aucune raison d'attendre la recommandation elle-même
      // (appel IA, potentiellement long) : on l'affiche tout de suite, avec un
      // message clair pour que l'abonné comprenne que sa recommandation arrive
      // plutôt que de voir un accueil vide et silencieux pendant ce temps.
      zone.innerHTML = `${entete}
        <div class="score-card">
          <div class="audit-score-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> RECOMMANDATION IA</div>
          <div class="audit-diag-interp">Je regarde ce qui marche en ce moment dans ta niche sur TikTok, à partir de ton profil et de tes générations, pour préparer ta recommandation du jour…</div>
        </div>`;
      zone.style.display = 'block';
      data = await genererRecommandations(null, null);
      // On ne met en cache qu'une vraie recommandation exploitable, jamais un
      // échec technique (null), pour qu'un simple problème réseau ne bloque
      // pas toute la journée, ET jamais un résultat "onboarding" (pas encore
      // assez d'infos) : cet état change dès que l'abonné suit le conseil
      // (fait une génération), le mettre en cache l'empêcherait de voir sa
      // vraie recommandation juste après avoir fait exactement ce qu'on lui a
      // demandé.
      if (data && !data.onboarding) ecrireRecoCache(data);
    }
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
        <div class="audit-score-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> RECOMMANDATION IA</div>
        <div class="audit-diag-constat">Ton diagnostic sommaire est fait, bien joué.</div>
        <div class="audit-diag-interp">Il me manque encore une génération (une idée, un script ou un récit) pour te faire une recommandation vraiment fiable, le diagnostic sommaire seul ne montre que ta bio et ta niche, pas encore ce qui fonctionne pour toi.</div>
        <button class="btn-generate" style="margin-top:14px" onclick="demarrerIdeesDepuisSommaire()"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 18.5h5"/><path d="M10.5 21h3"/><path d="M12 3.5c-3.6 0-6 2.7-5.4 6.1.3 1.7 1.4 2.9 2.4 3.9.6.6.9 1.2 1 2h4c.1-.8.4-1.4 1-2 1-1 2.1-2.2 2.4-3.9C18 6.2 15.6 3.5 12 3.5Z"/></svg> Trouver mes premières idées</button>
      </div>` : `${entete}
      <div class="score-card">
        <div class="audit-score-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> RECOMMANDATION IA</div>
        <div class="audit-diag-constat">Scriptura apprend encore tes habitudes.</div>
        <div class="audit-diag-interp">Analyse ton compte TikTok : ta recommandation personnalisée arrivera juste après, à la fin de ton diagnostic.</div>
        <button class="btn-generate" style="margin-top:14px" onclick="chooseMode('audit')"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><rect x="5.5" y="13" width="3" height="6" rx="0.6"/><rect x="10.5" y="9" width="3" height="10" rx="0.6"/><rect x="15.5" y="6" width="3" height="13" rx="0.6"/></svg> Analyser mon compte</button>
      </div>`;
    zone.style.display = 'block';
    return;
  }

  if (!data) {
    // Échec technique (API indisponible, timeout, JSON invalide...) : on
    // garde quand même la salutation plutôt que de vider toute la zone
    // (sinon l'accueil paraît cassé alors que ce n'est qu'un souci
    // ponctuel, voir le cas "onboarding" juste au-dessus, qui applique
    // déjà ce principe pour l'autre cas de figure).
    zone.innerHTML = `${entete}
      <div class="score-card">
        <div class="audit-score-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> RECOMMANDATION IA</div>
        <div class="audit-diag-interp">Scriptura n'a pas pu préparer ta recommandation du jour pour le moment. Réessaie un peu plus tard.</div>
      </div>`;
    zone.style.display = 'block';
    return;
  }
  rendreRecommandations('accueilPremium', data, entete, true);
}

// Force une nouvelle recommandation d'accueil (vide le cache puis relance
// l'initialisation normale) : avec creerScriptDepuisRecommandation, seul
// déclencheur d'un changement de recommandation, elle ne change plus
// jamais d'elle-même.
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
  // générée et sauvegardée la première fois (voir plus bas), on la
  // réaffiche telle quelle. Sans ça, chaque réouverture en produisait une
  // nouvelle, différente de celle vue initialement.
  if (auditFrais && auditFrais.recommandation_ia) {
    rendreRecommandations('auditOpportunites', auditFrais.recommandation_ia, '<div class="audit-section-label">Et maintenant ?</div>');
    return;
  }

  zone.innerHTML = '<div class="audit-section-label">Et maintenant ?</div><div class="audit-diag-interp">Scriptura regarde ce qui marche en ce moment dans ta niche sur TikTok, à partir de ce diagnostic, pour te proposer la suite…</div>';

  const data = await genererRecommandations(auditFrais, ts, niche, objectif);
  // rienDeConnu ne devrait jamais arriver ici (l'audit tout juste terminé
  // fournit toujours un diagnostic), mais on s'en protège par cohérence.
  if (!data || data.onboarding) { zone.innerHTML = ''; return; }
  if (typeof sauvegarderRecommandationAudit === 'function') sauvegarderRecommandationAudit(data);
  rendreRecommandations('auditOpportunites', data, '<div class="audit-section-label">Et maintenant ?</div>');
}

// Équivalent de afficherEtMaintenant(), pour le diagnostic sommaire
// (@username) : abonné ou non, désormais. Génère la recommandation à partir
// du diagnostic tout juste calculé (top/flop vidéos, niche, concepts
// récurrents, voir texteDiagnosticSommaireOpportunites, js/diagnostic-
// sommaire.js), le même principe que afficherEtMaintenant pour l'audit
// détaillé, plutôt que de piocher dans le cache générique de l'accueil (qui
// ne change plus que sur "Actualiser"/"Générer le script", voir
// cleRecoAbonne plus haut : cette recommandation-ci a sa propre occasion de
// changer, la fin d'un diagnostic, elle ne doit ni lire ni écrire ce cache).
async function afficherOpportuniteDiagSommaire(d, moi, username, recommandationSauvegardee) {
  const zone = document.getElementById('diagSommaireOpportunites');
  if (!zone) return;

  const entete = '<div class="audit-section-label"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg> En plus de ce diagnostic</div>';
  // Abonné : mêmes 6 recommandations détaillées que partout ailleurs dans
  // l'app (accueil, "Et maintenant ?"). Non-abonné : la version teaser à 1
  // idée + bandeau d'abonnement (rendreRecommandationSommaire), inchangée.
  const rendre = (data) => unlocked
    ? rendreRecommandations('diagSommaireOpportunites', data, entete)
    : rendreRecommandationSommaire('diagSommaireOpportunites', data, entete);

  // Diagnostic rouvert depuis "Mes générations" : la recommandation a déjà
  // été générée et sauvegardée la première fois, on la réaffiche telle
  // quelle plutôt que d'en produire une nouvelle à chaque réouverture.
  if (recommandationSauvegardee) {
    rendre(recommandationSauvegardee);
    return;
  }

  // Message d'attente pendant l'appel IA (peut prendre quelques secondes,
  // recherche web comprise) : jamais de zone vide et silencieuse, même
  // principe que initAccueilPremiumInterne/afficherEtMaintenant.
  zone.innerHTML = entete + '<div class="audit-diag-interp">Scriptura regarde ce qui marche en ce moment dans ta niche sur TikTok, à partir de ce diagnostic, pour te proposer une idée en plus…</div>';

  const texteExtra = (d && typeof texteDiagnosticSommaireOpportunites === 'function')
    ? texteDiagnosticSommaireOpportunites(d, moi, username)
    : '';
  const data = await genererRecommandations(null, null, d && d.niche && d.niche.nom, null, texteExtra);
  if (!data || data.onboarding || !Array.isArray(data.recommandations) || !data.recommandations.length) {
    zone.innerHTML = '';
    return;
  }
  if (typeof sauvegarderRecommandationAudit === 'function') sauvegarderRecommandationAudit(data);

  rendre(data);
}

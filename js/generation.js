let ideaPlatform = '';
let ideaGoal = '';
let ideaTone = '';

function setupIdeaButtons() {
  const groups = [
    { id: 'ideaGoalGrid', setter: v => ideaGoal = v }
  ];
  const ideaToneSelectEl = document.getElementById('ideaTone');
  if (ideaToneSelectEl) {
    ideaToneSelectEl.addEventListener('change', function() { ideaTone = this.value; });
  }
  const ideaPlatformSelectEl = document.getElementById('ideaPlatformGrid');
  if (ideaPlatformSelectEl) {
    ideaPlatformSelectEl.addEventListener('change', function() { ideaPlatform = this.value; });
  }
  groups.forEach(g => {
    const container = document.getElementById(g.id);
    if (!container) return;
    const btns = container.querySelectorAll('.grid-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        // Désactiver UNIQUEMENT les boutons de CE conteneur précis
        btns.forEach(b => b.classList.remove('active'));
        // Activer celui cliqué
        btn.classList.add('active');
        g.setter(btn.dataset.val);
      });
    });
  });

  // Adapter le champ géo selon la niche (obligatoire pour Histoire/Géopolitique)
  const nicheSelect = document.getElementById('ideaNiche');
  if (nicheSelect) {
    nicheSelect.addEventListener('change', updateGeoRequirement);
  }
  updateGeoRequirement();
}

function updateGeoRequirement() {
  const niche = document.getElementById('ideaNiche').value;
  const geoRequired = ['Histoire', 'Géopolitique & Actualité', 'Culture & Société', 'Spiritualité & Philosophie', 'Lifestyle'].includes(niche);
  const label = document.getElementById('ideaGeoLabel');
  const optional = document.getElementById('geoOptional');
  const input = document.getElementById('ideaGeo');

  if (geoRequired) {
    if (optional) optional.style.display = 'none';
    if (input) input.style.borderColor = 'rgba(201,168,76,0.4)';
    if (label && !label.querySelector('.geo-req')) {
      const req = document.createElement('span');
      req.className = 'geo-req';
      req.style.cssText = 'color:var(--gold);margin-left:4px';
      req.textContent = '*';
      label.appendChild(req);
    }
  } else {
    if (optional) optional.style.display = 'inline';
    if (input) input.style.borderColor = '';
    const req = label ? label.querySelector('.geo-req') : null;
    if (req) req.remove();
  }
}

// Repart d'un formulaire vide pour une nouvelle exploration d'idées, appelée
// à chaque entrée fraîche dans ce mode (voir chooseMode, js/serie.js) : sans
// ça, la niche/le sujet/le ton d'une exploration précédente restaient
// silencieusement actifs (champs ET variables ideaPlatform/ideaGoal/ideaTone)
// pour la suivante, même sans aucun rapport avec elle.
function restartIdeas() {
  document.getElementById('ideaNiche').value = '';
  document.getElementById('ideaAudience').value = '';
  document.getElementById('ideaGeo').value = '';
  document.getElementById('ideaTheme').value = '';
  document.getElementById('ideaTone').value = '';
  ideaPlatform = '';
  ideaGoal = '';
  ideaTone = '';
  document.getElementById('ideaPlatformGrid').value = '';
  document.querySelectorAll('#ideaGoalGrid .grid-btn').forEach(b => b.classList.remove('active'));
  updateGeoRequirement();
  const errorBox = document.getElementById('ideaErrorBox');
  if (errorBox) errorBox.style.display = 'none';
  const formCard = document.getElementById('ideasFormCard');
  if (formCard) formCard.style.display = '';
  document.getElementById('ideasResults').style.display = 'none';
}

// ── Mémoire virale partagée : injection dans les générations ──
// Récupère quelques recettes RÉELLEMENT virales déjà décodées (niche d'abord)
// depuis /api/patterns et les met en forme comme INSPIRATION. Best-effort :
// renvoie '' si indisponible, jamais bloquant. Consigne stricte côté prompt :
// s'inspirer des leviers, ADAPTER au sujet, ne jamais copier ni citer la liste.
async function recupererPatternsViraux(niche, limit) {
  try {
    const q = '?limit=' + (limit || 5) + (niche ? '&niche=' + encodeURIComponent(niche) : '');
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 6000);
    let data;
    try {
      const r = await fetch('/api/patterns' + q, { signal: ctrl.signal });
      data = await r.json();
    } finally { clearTimeout(minuteur); }
    if (!data || !data.ok || !Array.isArray(data.patterns) || !data.patterns.length) return '';
    return _formatPatternsViraux(data.patterns);
  } catch (e) { return ''; }
}
function _formatPatternsViraux(patterns) {
  const lignes = patterns.slice(0, 6).map((p, i) => {
    const leviers = Array.isArray(p.leviers) && p.leviers.length ? ' | leviers : ' + p.leviers.join(', ') : '';
    const principes = Array.isArray(p.principes)
      ? p.principes.map(x => x && (x.titre || x.detail)).filter(Boolean).slice(0, 2).join(' ; ') : '';
    const tete = (p.hook_technique || 'accroche') + (p.niche ? ' (' + p.niche + ')' : '');
    return `${i + 1}. ${tete}${leviers}${principes ? ' | à transposer : ' + principes : ''}`;
  });
  return `\nMÉMOIRE VIRALE DE SCRIPTURA (recettes RÉELLEMENT virales déjà décodées, retenues seulement parce que leur structure ET leurs performances l'ont prouvé). Inspire-toi de ces LEVIERS et PRINCIPES pour renforcer ta production, mais ADAPTE-les au sujet ci-dessous, ne les copie JAMAIS tels quels, ne cite jamais cette liste et n'en reprends pas les exemples :\n${lignes.join('\n')}\n`;
}

// ── Signaux issus des PROPRES analyses du créateur (audit complet et/ou
// diagnostic sommaire DE SON compte), demandé par le propriétaire après
// avoir étudié le mécanisme réel de Vervox : leur générateur d'idées combine
// "tendances de niche" + "profil déclaré" + "tes analyses éventuelles (audit
// de compte, benchmark, analyses concurrents)". Scriptura avait déjà les deux
// premières sources (profilLigneIdees + recherche tendances) mais ignorait
// totalement la troisième : le prompt promettait déjà des idées fondées sur
// les "leçons d'audit" (voir plus bas, "1. OPPORTUNITÉS") sans qu'aucune
// donnée d'audit ne soit jamais réellement transmise. Corrigé ici.
// Best-effort, jamais bloquant : sans audit ni diagnostic sauvegardé pour ce
// créateur, ce bloc reste vide, aucun chiffre n'est inventé.
function _niveauRatioIdees(score, max) {
  if (score == null || !max) return null;
  const r = score / max;
  return r < 0.3 ? 'très faible' : r < 0.55 ? 'faible' : r < 0.8 ? 'correct' : 'fort';
}

async function _signauxAnalysesPropresIdees() {
  if (typeof _derniereGenerationDe !== 'function' || typeof _recentesGenerationsDe !== 'function') return '';
  let auditGen = null, sommaires = [];
  try {
    [auditGen, sommaires] = await Promise.all([_derniereGenerationDe('audit'), _recentesGenerationsDe('diagnosticSommaire', 8)]);
  } catch (e) { return ''; }
  const sommaireGen = (sommaires || []).find(g =>
    typeof _sommaireEstMien === 'function' ? _sommaireEstMien(g) : (g && g.contenu && g.contenu.estMonCompte !== false));

  const faibles = [], forts = [], leviers = [];

  // Audit complet (captures) : 5 dimensions /20 chacune (voir SCORE_DIMS,
  // js/audit.js), recalculées EN CODE comme à l'affichage (calculerScores),
  // jamais relues telles quelles depuis la réponse brute du modèle.
  if (auditGen && auditGen.contenu && typeof SCORE_DIMS !== 'undefined' && typeof calculerScores === 'function') {
    const a = auditGen.contenu;
    const ts = a.mesures ? calculerScores(a.mesures) : (a.tiktok_score || {});
    SCORE_DIMS.forEach(d => {
      const n = (typeof ts[d.key] === 'number') ? ts[d.key] : parseFloat(ts[d.key]);
      if (!Number.isFinite(n)) return;
      const niv = _niveauRatioIdees(n, d.max);
      if (niv === 'très faible' || niv === 'faible') faibles.push(`${d.label} (${niv}, audit complet)`);
      else if (niv === 'fort') forts.push(`${d.label} (fort, audit complet)`);
    });
    (Array.isArray(a.axes_prioritaires) ? a.axes_prioritaires : []).slice(0, 2).forEach(ax => {
      if (ax && ax.titre) leviers.push(ax.titre + (ax.action ? ' : ' + ax.action : ''));
    });
  }

  // Diagnostic sommaire de SON compte (5 dimensions Vervox /100, voir
  // DS_DIM_META, js/diagnostic-sommaire.js), notes déjà calculées côté code.
  if (sommaireGen && sommaireGen.contenu && sommaireGen.contenu.diagnostic && typeof DS_DIM_META !== 'undefined') {
    const diag = sommaireGen.contenu.diagnostic;
    Object.keys(DS_DIM_META).forEach(cle => {
      const meta = DS_DIM_META[cle];
      const dim = diag[cle];
      if (!dim || dim.disponible === false || typeof dim.score !== 'number') return;
      const niv = _niveauRatioIdees(dim.score, meta.max);
      if (niv === 'très faible' || niv === 'faible') faibles.push(`${meta.label} (${niv}, diagnostic sommaire)`);
      else if (niv === 'fort') forts.push(`${meta.label} (fort, diagnostic sommaire)`);
    });
    (Array.isArray(diag.leviers_prioritaires) ? diag.leviers_prioritaires : []).slice(0, 2).forEach(l => {
      if (l && l.titre) leviers.push(l.titre + (l.detail ? ' : ' + l.detail : ''));
    });
  }

  if (!faibles.length && !forts.length && !leviers.length) return '';

  return `
SIGNAUX ISSUS DE TES PROPRES ANALYSES (audit et/ou diagnostic déjà réalisés par ce créateur sur SON compte, ce sont des FAITS RÉELS, jamais des suppositions) :
${faibles.length ? `- Points faibles observés : ${faibles.join(', ')}` : ''}
${forts.length ? `- Points forts déjà confirmés : ${forts.join(', ')}` : ''}
${leviers.length ? `- Leviers déjà identifiés pour lui : ${leviers.join(' / ')}` : ''}

CONSIGNE LIÉE AUX SIGNAUX CI-DESSUS : au moins 2 des 10 idées doivent répondre DIRECTEMENT à un point faible observé, transformées en VRAIE IDÉE DE VIDÉO CONCRÈTE (jamais une reformulation du levier lui-même, jamais un titre du type "améliore ta régularité"). Au moins 1 idée doit s'appuyer sur un point fort déjà confirmé pour capitaliser dessus.`;
}

function setIdeaLoading(on) {
  const btn = document.getElementById('ideaGenerateBtn');
  btn.disabled = on;
  document.getElementById('ideaSpinner').style.display = on ? 'block' : 'none';
  document.getElementById('ideaBtnText').textContent = on ? 'Scriptura brainstorme…' : 'Générer mes idées de contenu';
  if (on) startGenAnimation('ideas');
  else stopGenAnimation();
}

async function generateIdeas() {
  const niche = document.getElementById('ideaNiche').value.trim();
  const audience = document.getElementById('ideaAudience').value.trim();
  const geo = document.getElementById('ideaGeo').value.trim();
  const theme = document.getElementById('ideaTheme').value.trim();
  const errorBox = document.getElementById('ideaErrorBox');

  errorBox.style.display = 'none';

  if (!niche) {
    errorBox.textContent = 'Choisis au moins ta niche pour continuer.';
    errorBox.style.display = 'block'; return;
  }

  // Géo obligatoire pour Histoire et Géopolitique
  if (['Histoire', 'Géopolitique & Actualité', 'Culture & Société', 'Spiritualité & Philosophie', 'Lifestyle'].includes(niche) && !geo) {
    errorBox.textContent = 'Pour ' + niche + ', précise une zone géographique (pays, région, empire…) pour des idées ciblées.';
    errorBox.style.display = 'block'; return;
  }

  if (!theme) {
    errorBox.textContent = 'Précise le sujet que tu veux explorer.';
    errorBox.style.display = 'block';
    document.getElementById('ideaTheme')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Vérification limite (partagée avec le générateur de script)
  if (!unlocked && usedGen >= MAX_FREE) {
    openPlans('nouveau');
    return;
  }
  // Limite journalière pour les abonnés (anti-abus)
  if (!(await peutGenerer('ideaErrorBox'))) return;

  setIdeaLoading(true);
  document.getElementById('ideasResults').style.display = 'none';

  // Mémoire du créateur : voir js/profil.js, n'ajoute qu'une ligne de plus
  // au bloc de contexte déjà présent, ne modifie aucune règle de ce prompt.
  // En parallèle, les signaux issus de SES PROPRES analyses déjà faites
  // (audit complet, diagnostic sommaire), voir _signauxAnalysesPropresIdees.
  const [profilLigneIdees, signauxAnalysesIdees] = await Promise.all([
    chargerProfilCreateur().then(p => ligneProfilPourPrompt(p)),
    _signauxAnalysesPropresIdees()
  ]);

  // Recherche web, deux besoins distincts, qui peuvent se cumuler : vérification
  // factuelle pour les niches d'actualité/géopolitique/Histoire (voir js/api.js),
  // et tendances TikTok, toujours activée (la quasi-totalité des créateurs
  // Scriptura publient sur TikTok) pour que les idées s'appuient sur ce qui
  // performe réellement en ce moment, pas seulement sur le profil du créateur.
  const rechercheWebIdees = nicheNecessiteRecherche(niche);
  const rechercheWebIdeesActive = true;

  // Les choix du créateur (ton, plateforme, objectif) ne sont pas là pour
  // décorer le prompt, chacun doit avoir un effet réel et vérifiable sur
  // les idées produites. Avant ce correctif, le ton et la plateforme étaient
  // mélangés dans une seule phrase cassée par un ternaire (résultat
  // grammaticalement incorrect dès qu'un ton était choisi), et l'objectif
  // n'avait tout simplement AUCUNE instruction propre.
  const ideaToneInstruction = ideaTone
    ? `RESPECT STRICT ET EXCLUSIF DU TON CHOISI : le créateur a choisi précisément ce ton : "${ideaTone}". Chaque angle et chaque hook proposés doivent rester dans CE ton exact, sans dérive vers un autre registre, c'est une consigne explicite, pas une suggestion.`
    : `Aucun ton précisé : adapte le ton au style le plus pertinent pour la niche et le sujet de chaque idée.`;

  const codesPlateformeIdees = {
    'TikTok': 'hooks courts et percutants dès la première seconde, rythme rapide, tutoiement direct.',
    'Instagram Reels': 'hooks un peu plus soignés et esthétiques, peuvent installer une micro-narration, ton communauté/lifestyle.',
    'YouTube Shorts': 'hooks proches d\'un titre de recherche (curiosité ou promesse claire dès les premiers mots), pensés pour capter au scroll ET à la recherche.',
    'Facebook': 'hooks au ton plus familier et générationnel, qui invitent explicitement au partage et à la discussion en commentaire.',
    'LinkedIn': 'hooks professionnels, orientés retour d\'expérience ou enseignement concret, jamais putaclic, la crédibilité prime sur le sensationnalisme.'
  };
  const ideaPlatformInstruction = ideaPlatform
    ? `PLATEFORME "${ideaPlatform}", RESPECTE SES CODES : ${codesPlateformeIdees[ideaPlatform] || 'adapte le format des hooks aux usages de cette plateforme précise.'}`
    : `Aucune plateforme précisée : reste généraliste, sans t'ancrer dans les codes d'une seule.`;

  const codesObjectifIdees = {
    'faire des vues': 'privilégie des angles à très fort potentiel de curiosité et de partage immédiat, le hook doit créer un choc ou un besoin urgent de voir la suite, la portée prime sur tout le reste.',
    'gagner des abonnés': 'privilégie des angles qui donnent envie de suivre le compte pour la suite (partie 2 implicite, format récurrent, promesse d\'autres révélations du même genre), le créateur doit apparaître comme une référence qu\'on veut revoir.',
    'générer des ventes': 'privilégie des angles qui créent un désir ou un besoin concret pouvant mener naturellement vers une offre, un produit ou un service du créateur, sans jamais sonner comme une pub déguisée.',
    'renforcer mon expertise': 'privilégie des angles qui démontrent une maîtrise réelle du sujet, analyses fines, retournements qui montrent que le créateur voit ce que les autres ne voient pas, jamais du contenu superficiel.'
  };
  const ideaGoalInstruction = ideaGoal
    ? `OBJECTIF DU CRÉATEUR "${ideaGoal}", RESPECTE-LE RIGOUREUSEMENT dans le choix des angles : ${codesObjectifIdees[ideaGoal] || 'adapte les angles à cet objectif précis.'}`
    : `Aucun objectif précisé : équilibre les angles entre portée, fidélisation et démonstration d'expertise.`;

  // Mémoire virale partagée (niche d'abord) : leviers réels pour muscler les idées.
  const memoireViraleIdees = await recupererPatternsViraux(niche);

  const prompt = `Tu es le Directeur Éditorial de Scriptura, expert en contenu viral francophone et stratège TikTok. Tu génères des idées de vidéos VIRALES et NON GÉNÉRIQUES pour CE créateur précis, jamais une liste interchangeable qu'un autre créateur de la même niche pourrait recevoir à l'identique.
${rechercheWebIdees ? instructionRechercheWeb(niche, 'de proposer des idées') : ''}${instructionRechercheTendancesTikTok(niche, 'de proposer des idées')}${memoireViraleIdees}

PROFIL DU CRÉATEUR :
- Niche : ${niche}
${audience ? '- Audience : ' + audience : ''}
${geo ? '- ZONE GÉOGRAPHIQUE CIBLE : ' + geo : ''}
${ideaPlatform ? '- Plateforme : ' + ideaPlatform : ''}
${ideaGoal ? '- Objectif : ' + ideaGoal : ''}
${ideaTone ? '- Style/angle : ' + ideaTone : ''}
${theme ? '- Thème précis à explorer : ' + theme : ''}
${profilLigneIdees ? '- ' + profilLigneIdees : ''}
${signauxAnalysesIdees}

${geo ? `CONTRAINTE GÉOGRAPHIQUE ABSOLUE, TU ES UN EXPERT LOCAL DE : ${geo}
Toutes les idées DOIVENT être ancrées spécifiquement dans cette zone. Ne reste JAMAIS vague ou générique.
- Puise dans les figures historiques réelles, les événements précis, les dynasties, les royaumes, les batailles, les personnages et les faits SPÉCIFIQUES à ${geo}
- Utilise des noms propres réels, des dates réelles, des lieux réels de cette zone
- Agis comme quelqu'un qui connaît intimement l'histoire et les réalités de ${geo}, pas comme un touriste
- Évite les sujets déjà vus mille fois : cherche les histoires méconnues, les angles surprenants, les faits que même les habitants de ${geo} ignorent souvent
- Si la niche est géopolitique : ancre dans les enjeux, tensions, alliances et réalités actuelles et historiques réelles de ${geo}
Une idée qui pourrait s'appliquer à n'importe quelle région est une idée ÉCHOUÉE. Chaque idée doit être impossible à imaginer sans connaître ${geo}.` : ''}

AVANT D'ÉCRIRE LA MOINDRE IDÉE, RAISONNE EN SILENCE, ce raisonnement ne doit JAMAIS apparaître dans ta réponse, seul le résultat final compte :

1. OPPORTUNITÉS : à partir du profil ci-dessus (niche, historique, leçons d'audit, objectif), identifie les sujets offrant le plus fort potentiel pour CE créateur précis, pas pour n'importe qui dans cette niche. Cherche activement : les contradictions, les paradoxes, les idées reçues à démonter, les secrets, les erreurs coûteuses, les conséquences inattendues, les révélations méconnues, les histoires peu racontées, les angles rarement utilisés. Ne retiens jamais un sujet évident quand un angle plus fort existe sur le même thème.

2. ANTI-RÉPÉTITION : si le profil ci-dessus mentionne des sujets, angles, structures ou hooks déjà utilisés pour ce créateur, écarte-les activement, ne les reformule pas, ne les paraphrase pas.

3. FILTRE ANTI-GÉNÉRIQUE : pour chaque idée envisagée, vérifie-la contre ces questions avant de la retenir, ressemble-t-elle à ce qu'une IA généraliste proposerait spontanément ? Est-elle trop évidente ? Manque-t-elle de surprise ou de curiosité ? Ressemble-t-elle à une idée déjà générée pour ce créateur ? Si la réponse est oui à l'une de ces questions, rejette-la et cherche mieux.

4. TEST DU FIL D'ACTUALITÉ : pour chaque idée retenue, imagine-la apparaître sur le fil ${ideaPlatform || 'TikTok'} de l'audience visée. Susciterait-elle IMMÉDIATEMENT l'envie de cliquer ou de continuer à regarder ? Si non, rejette-la au profit d'une meilleure.

5. CLASSEMENT : une fois les meilleures idées retenues, classe-les de la plus forte opportunité à la moins forte pour CE créateur. La première idée de ta réponse doit être celle que tu juges la meilleure.

MISSION : Génère 10 idées de vidéos à FORT POTENTIEL VIRAL, dans cet ordre de pertinence.

RÈGLES ABSOLUES :
- INTERDIT les idées génériques ("Les 5 erreurs à éviter", "Comment réussir en...", "Mon top 10"). Ça, tout le monde le fait.
- Chaque idée doit avoir un ANGLE UNIQUE, une tension, quelque chose de surprenant ou contre-intuitif
- Les idées doivent exploiter des déclencheurs émotionnels (curiosité, choc, indignation, fascination, peur de rater)
- ${ideaToneInstruction}
- ${ideaPlatformInstruction}
- ${ideaGoalInstruction}
- Chaque idée doit donner envie de cliquer IMMÉDIATEMENT
- Varie les angles : certaines révélations, certaines contre-intuitions, certaines histoires, certains débats
- Deux créateurs différents de la même niche ne doivent jamais recevoir la même liste : personnalise réellement à partir du profil ci-dessus, pas seulement de la niche.

Pour CHAQUE idée, fournis :
1. Un TITRE accrocheur (comme il apparaîtrait en accroche)
2. L'ANGLE : quelle est l'approche unique, pourquoi c'est différent, et pourquoi cet angle précis plutôt qu'un plus évident sur le même sujet
3. POURQUOI ÇA MARCHE POUR CE CRÉATEUR : le mécanisme psychologique qui rend cette idée virale, ET en quoi elle est pertinente pour SON profil précis. Ne mentionne JAMAIS une performance ou une statistique que tu ne connais pas réellement, base-toi uniquement sur les informations disponibles ci-dessus.
4. UN HOOK DE DÉPART cohérent avec l'angle : la première phrase exacte pour lancer la vidéo. Vérifie-le avant de le retenir : est-il prévisible ou générique ? S'il échoue à ce test, remplace-le.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après (aucun raisonnement visible, uniquement le résultat) :
{"idees":[{"titre":"...","angle":"...","pourquoi":"...","hook":"..."}]}

Génère exactement 10 idées, toutes différentes, classées de la meilleure opportunité à la moins forte pour ce créateur précis.`;

  try {
    // Flux activé UNIQUEMENT pour calibrer le % (voir GEN_POIDS.ideas) :
    // un seul appel ici, aucun aperçu texte affiché (sortie JSON, pas de la
    // prose à lire en direct comme pour Script/Récit).
    const onApercuIdees = (buf) => { if (genProgressCtl) genProgressCtl.etapeFluxProgres(0, fractionFlux(buf.length, 6000)); };
    const raw = await callAI(MODEL_RAPIDE, 6000, prompt, undefined, rechercheWebIdeesActive, rechercheWebIdees ? 2 : 1, undefined, undefined, onApercuIdees, 'ideas');
    const parsed = parseAIResponse(raw);
    if (!parsed || !parsed.idees) throw new Error('Réponse invalide, réessaie');

    // Incrémenter le compteur
    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen); // met à jour le serveur (empreinte + IP)
      renderGenCounter();
      checkRappelAbonnement();
    }

    renderIdeas(parsed.idees, niche);
    setTimeout(updateScrollBtn, 300);
    saveGeneration('ideas', 'Idées : ' + niche, { idees: parsed.idees, niche: niche });
    updateQuotaJour();

    // Mémoire du créateur (tâche de fond, silencieuse).
    mettreAJourProfilCreateur({
      declare: {
        niche_principale: niche,
        ton_prefere: toneCourtDepuisSelect('ideaTone'),
        objectifs: ideaGoal ? (OBJECTIF_COURT_VERS_LONG[ideaGoal] || ideaGoal) : undefined
      },
      observe: {
        themes_traites: (parsed.idees || []).slice(0, 3).map(i => i.titre).filter(Boolean),
        plateformes: ideaPlatform,
        // Anti-répétition croisée avec les autres modes (voir generate()) :
        // mémorise l'angle et le hook de la meilleure idée retenue.
        angles_recents: (parsed.idees && parsed.idees[0] && parsed.idees[0].angle) ? tronquerSansCouperEmoji(String(parsed.idees[0].angle), 120) : undefined,
        hooks_recents: (parsed.idees && parsed.idees[0] && parsed.idees[0].hook) ? tronquerSansCouperEmoji(String(parsed.idees[0].hook), 140) : undefined
      }
    });

  } catch(e) {
    errorBox.textContent = 'Erreur : ' + e.message;
    errorBox.style.display = 'block';
  } finally {
    setIdeaLoading(false);
  }
}

// Stocke les idées pour le passage vers le générateur de script
let generatedIdeas = [];

function renderIdeas(idees, niche) {
  generatedIdeas = idees;
  const list = document.getElementById('ideasList');
  list.innerHTML = idees.map((idea, i) => `
    <div class="out-card idea-card">
      <div class="out-header" onclick="toggleCard(this.parentElement)">
        <div class="out-title idea-titre">${auditEsc(idea.titre || '')}</div>
        <div class="out-toggle">+</div>
      </div>
      <div class="out-body">
        <div class="idea-section">
          <div class="idea-section-label">◆ L'angle</div>
          <div class="idea-section-text">${auditEsc(idea.angle || '')}</div>
        </div>
        <div class="idea-section">
          <div class="idea-section-label">◆ Pourquoi ça marche</div>
          <div class="idea-section-text">${auditEsc(idea.pourquoi || '')}</div>
        </div>
        <div class="idea-section">
          <div class="idea-section-label">◆ Hook de départ</div>
          <div class="idea-hook">"${auditEsc(idea.hook || '')}"</div>
        </div>
        <div class="idea-actions">
          <button class="idea-btn-script" onclick="useIdeaForScript(${i})">Générer le script complet</button>
          <button class="idea-btn-copy icon-btn" title="Copier" onclick="copyIdea(${i}, this)">${ICON_COPY}</button><button class="idea-btn-share icon-btn" title="Partager" onclick="shareIdea(${i}, this)">${ICON_SHARE}</button>
        </div>
      </div>
    </div>`).join('');

  pushNav();
  masquerFormulaireGeneration('ideasFormCard');
  document.getElementById('ideasResults').style.display = 'block';
  document.getElementById('ideasResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Envoie l'idée choisie vers le générateur de script
function useIdeaForScript(index) {
  const idea = generatedIdeas[index];
  if (!idea) return;

  // Récupérer TOUS les choix faits dans "Trouve-moi des idées"
  const niche = document.getElementById('ideaNiche').value.trim();
  const audience = document.getElementById('ideaAudience') ? document.getElementById('ideaAudience').value.trim() : '';
  const geoContext = document.getElementById('ideaGeo').value.trim();

  // Basculer vers le mode script
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('flow').style.display = 'block';

  // Ce pont ne concerne jamais une vidéo virale ou un contenu existant à
  // coller : si ce champ était resté visible d'un passage précédent par
  // l'étape 2 (voir renderSummary), il n'a plus sa place ici.
  document.getElementById('viralVideoField').style.display = 'none';
  document.getElementById('viralVideo').value = '';

  // 1. Sujet = le titre de l'idée (+ contexte géo si présent)
  document.getElementById('sujet').value = idea.titre + (geoContext ? ' (' + geoContext + ')' : '');

  // 2. Niche : reporter dans le select du mode script
  const nicheSelect = document.getElementById('niche');
  if (nicheSelect && niche) {
    for (let opt of nicheSelect.options) {
      if (opt.value === niche || opt.text === niche) { nicheSelect.value = opt.value; break; }
    }
  }

  // 3. Audience : reporter dans le select du mode script
  const audSelect = document.getElementById('audience');
  if (audSelect && audience && !audience.startsWith('Choisis')) {
    for (let opt of audSelect.options) {
      if (opt.value === audience || opt.text === audience) { audSelect.value = opt.value; break; }
    }
  }

  // 4. Objectif : reporter dans state
  if (ideaGoal) {
    const goalMap = {
      'faire des vues': 'Faire plus de vues et maximiser la portée',
      'gagner des abonnés': 'Gagner des abonnés qualifiés rapidement',
      'générer des ventes': 'Générer des ventes via mon contenu',
      'renforcer mon expertise': 'Renforcer mon expertise et ma crédibilité'
    };
    state.objectif = goalMap[ideaGoal] || ideaGoal;
  }

  // 5. Plateforme : reporter dans state
  if (ideaPlatform) state.plateforme = ideaPlatform;

  // 6. Ton : reporter si un champ existe dans le mode script
  const tonScript = document.getElementById('ton');
  if (tonScript && ideaTone) {
    for (let opt of tonScript.options || []) {
      if (opt.value === ideaTone || opt.text === ideaTone) { tonScript.value = opt.value; break; }
    }
  }

  // Point de départ : on a déjà tout, c'est un sujet précis
  state.depart = 'un sujet précis que je veux développer';

  // Comme TOUS les choix sont reportés, on saute directement au récap (étape 3)
  if (state.objectif && state.plateforme) {
    showStep(3);
    renderSummary();
  } else {
    // Au cas où il manquerait objectif ou plateforme, on va à l'étape 1
    showStep(1);
  }

  window.scrollTo({ top: document.getElementById('flow').offsetTop - 20, behavior: 'smooth' });
}

function copyIdea(index, btn) {
  const idea = generatedIdeas[index];
  if (!idea) return;
  const text = idea.titre + '\n\nAngle : ' + idea.angle + '\n\nPourquoi ça marche : ' + idea.pourquoi + '\n\nHook : ' + idea.hook;
  const label = btn.innerHTML;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ Copié !';
    setTimeout(() => btn.innerHTML = label, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    btn.textContent = '✓ Copié !';
    setTimeout(() => btn.innerHTML = label, 2000);
  });
}

// ── NAVIGATION ──
function choose(key, val, nextStep) {
  state[key] = val;
  // "depart" est le dernier choix avant l'étape contexte (résumé objectif +
  // point de départ + plateforme) : avant, c'était le choix plateforme qui
  // déclenchait ce récap, cette responsabilité lui revient maintenant.
  if (key === 'depart') renderSummary();
  showStep(nextStep + 1);
}

function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step' + n).classList.add('active');
  // L'étape 2 porte le menu plateforme : le resynchroniser ici couvre tous
  // les chemins qui l'affichent (avance normale, retour depuis l'étape 3,
  // pré-remplissage venant d'ailleurs, ex. creerScriptDepuisViral).
  if (n === 2 && typeof syncPlatformPickerVisuel === 'function') syncPlatformPickerVisuel();
  // Le champ "Ce que tu vends" (étape 3) n'a de sens que pour l'objectif
  // ventes : le resynchroniser ici couvre tous les chemins qui affichent
  // cette étape, pas seulement l'avancée normale depuis l'étape 2.
  if (n === 3 && typeof syncVenteFieldVisibilite === 'function') syncVenteFieldVisibilite();
  document.getElementById('flow').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goBack(n) {
  showStep(n);
}

// ── PLATEFORME (menu repliable, étape 2) ──
// Remplace l'ancienne étape 3 dédiée : pré-remplie sur TikTok, modifiable en
// un clic, sans bloquer l'avancée instantanée de idée-vague/sujet-précis.
function togglePlatformPicker() {
  const wrap = document.getElementById('platformPicker');
  if (wrap) wrap.classList.toggle('open');
}

function fermerPlatformPicker() {
  const wrap = document.getElementById('platformPicker');
  if (wrap) wrap.classList.remove('open');
}

function choisirPlateforme(val, el) {
  state.plateforme = val;
  document.querySelectorAll('#platformPanel .custom-select-option').forEach(o => o.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const iconWrap = document.getElementById('platformTriggerIconWrap');
  const svg = el ? el.querySelector('svg') : null;
  if (iconWrap && svg) iconWrap.innerHTML = svg.outerHTML;
  const label = document.getElementById('platformTriggerLabel');
  if (label) label.textContent = val;
  fermerPlatformPicker();
}

// Remet le bouton/icône du menu plateforme en phase avec state.plateforme,
// utile quand celui-ci a été renseigné ailleurs qu'en cliquant une option
// (pré-remplissage, retour arrière, restart…).
function syncPlatformPickerVisuel() {
  const label = document.getElementById('platformTriggerLabel');
  const iconWrap = document.getElementById('platformTriggerIconWrap');
  if (!label || !iconWrap) return;
  const val = state.plateforme || 'TikTok';
  label.textContent = val;
  document.querySelectorAll('#platformPanel .custom-select-option').forEach(o => o.classList.remove('selected'));
  const opt = document.querySelector('#platformPanel .custom-select-option[data-val="' + val.replace(/"/g, '\\"') + '"]');
  if (opt) {
    opt.classList.add('selected');
    const svg = opt.querySelector('svg');
    if (svg) iconWrap.innerHTML = svg.outerHTML;
  }
}

document.addEventListener('click', function (e) {
  const wrap = document.getElementById('platformPicker');
  if (wrap && !wrap.contains(e.target)) wrap.classList.remove('open');
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const wrap = document.getElementById('platformPicker');
  if (wrap && wrap.classList.contains('open')) wrap.classList.remove('open');
});

// ── OBJECTIF "VENTES" (étape 3) : description + fichier joint ──
// Photo produit ou PDF (ebook, brochure…) pour que l'angle et l'offre du
// script soient concrets, pas seulement génériques (retour créateur
// explicite). compresserImage() vient de js/audit.js (portée globale,
// déjà utilisée pour les captures) : même traitement, réutilisé tel quel.
let venteFichier = null; // { base64, mediaType, nom } | null
const VENTE_PDF_MAX_OCTETS = 3 * 1024 * 1024; // ~3 Mo bruts, une vingtaine de pages d'un PDF texte

function syncVenteFieldVisibilite() {
  const champ = document.getElementById('venteField');
  if (champ) champ.style.display = (state.objectif === 'Générer des ventes via mon contenu') ? '' : 'none';
}

function lireFichierEnBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function chargerFichierVente(files) {
  const f = files && files[0];
  const err = document.getElementById('venteFichierError');
  const nomEl = document.getElementById('venteFichierNom');
  const retirerBtn = document.getElementById('venteFichierRetirerBtn');
  err.style.display = 'none';
  if (!f) return;
  try {
    if (f.type === 'application/pdf') {
      if (f.size > VENTE_PDF_MAX_OCTETS) {
        throw new Error('PDF trop volumineux (max ~3 Mo, une vingtaine de pages). Garde l\'essentiel : sommaire, page produit, avis.');
      }
      const base64 = await lireFichierEnBase64(f);
      venteFichier = { base64, mediaType: 'application/pdf', nom: f.name };
    } else if (f.type.startsWith('image/')) {
      const compresse = await compresserImage(f);
      venteFichier = { base64: compresse.base64, mediaType: compresse.mediaType, nom: f.name };
    } else {
      throw new Error('Format non pris en charge : joins une image ou un PDF.');
    }
    nomEl.textContent = venteFichier.nom;
    retirerBtn.style.display = '';
  } catch (e) {
    venteFichier = null;
    nomEl.textContent = '';
    retirerBtn.style.display = 'none';
    err.textContent = e.message || 'Impossible de lire ce fichier.';
    err.style.display = 'block';
  }
  document.getElementById('venteFichierInput').value = '';
}

function retirerFichierVente() {
  venteFichier = null;
  document.getElementById('venteFichierNom').textContent = '';
  document.getElementById('venteFichierRetirerBtn').style.display = 'none';
  document.getElementById('venteFichierError').style.display = 'none';
}

// « Analyser une vidéo virale » : à partir d'un lien TikTok collé, récupère
// automatiquement la transcription par la voix (voir api/video-stt.js) et remplit le
// champ texte, que l'utilisateur peut relire/ajuster avant de générer. En cas
// d'échec (vidéo sans sous-titres, privée, lien non reconnu), on ne bloque pas :
// on affiche un message et le collage manuel reste disponible.
async function recupererTranscriptViral() {
  const lienEl = document.getElementById('viralLien');
  const noteEl = document.getElementById('viralLienNote');
  const btn = document.getElementById('viralLienBtn');
  const spin = document.getElementById('viralLienSpinner');
  const arrow = document.getElementById('viralLienArrow');
  const cible = document.getElementById('viralVideo');
  if (!lienEl || !cible) return;

  const url = (lienEl.value || '').trim();
  if (!url) { lienEl.focus(); return; }
  if (!/^https?:\/\//i.test(url)) {
    if (noteEl) noteEl.textContent = "Colle un lien complet (qui commence par https://).";
    return;
  }

  if (btn) btn.disabled = true;
  if (spin) spin.style.display = 'block';
  if (arrow) arrow.style.display = 'none';
  if (noteEl) noteEl.textContent = 'On écoute la vidéo et on la transcrit ☕…';

  // Le service peut mettre quelques secondes (résolution du lien + sous-titres).
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 30000);
  try {
    const rep = await fetch('/api/tiktok-video?action=transcription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal
    });
    const data = await rep.json();
    if (!rep.ok) throw new Error(data?.error?.message || "Récupération impossible.");

    if (data.ok && data.transcript) {
      // On préfixe la description (contexte utile) si elle apporte quelque chose.
      const desc = (data.description || '').trim();
      const bloc = desc && !data.transcript.includes(desc.slice(0, 30))
        ? 'Description : ' + desc + '\n\nTranscription :\n' + data.transcript
        : data.transcript;
      cible.value = bloc;
      cible.dispatchEvent(new Event('input', { bubbles: true }));
      if (noteEl) noteEl.textContent = 'Sous-titres récupérés, relis-les et ajuste si besoin, puis génère.';
    } else {
      // Pas de sous-titres : on met au moins la description, et on invite au manuel.
      if (data.description) cible.value = data.description;
      if (noteEl) noteEl.textContent = "Cette vidéo n'a pas de sous-titres exploitables. Décris-la ou colle son texte à la main ci-dessous.";
    }
  } catch (e) {
    if (noteEl) {
      noteEl.textContent = (e.name === 'AbortError')
        ? "La récupération a été trop longue. Réessaie, ou colle le texte à la main."
        : 'Impossible de lire cette vidéo. Colle son texte à la main ci-dessous.';
    }
  } finally {
    clearTimeout(minuteur);
    if (btn) btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (arrow) arrow.style.display = '';
  }
}

// Depuis le bouton "✎ Modifier" du résultat : masque le résultat et
// rouvre l'étape 3 (le formulaire) pour changer les critères sans jamais
// effacer les valeurs déjà saisies, contrairement à restart(), qui repart
// de zéro. Voir renderResults(), qui masque l'étape 3 à l'affichage du résultat.
function modifierCriteresScript() {
  // Empile l'écran résultat AVANT de le masquer : un "← Retour" pendant la
  // modification retombe ainsi directement sur ce résultat (formulaire
  // remasqué, voir showScreen), jamais plus loin en arrière.
  pushNav();
  document.getElementById('results').style.display = 'none';
  showStep(3);
}

function renderSummary() {
  const el = document.getElementById('summaryTags');
  el.innerHTML = [state.objectif, state.depart, state.plateforme]
    .filter(Boolean)
    .map(v => `<span class="summary-tag">${v}</span>`)
    .join('');

  // Mettre à jour le compteur de générations
  renderGenCounter();

  // Afficher le champ de contenu existant selon le point de départ choisi,
  // "analyser une vidéo virale" et "améliorer un contenu existant" ont TOUS
  // LES DEUX besoin que le créateur colle un texte, mais pour un usage
  // différent (recréer une recette externe vs. améliorer SON propre
  // contenu) : le champ est donc partagé, mais son libellé et le prompt
  // final (voir generate()) traitent ces deux cas différemment.
  const viralField = document.getElementById('viralVideoField');
  const viralLabel = document.getElementById('viralVideoLabel');
  const viralInput = document.getElementById('viralVideo');
  const viralAstuce = document.getElementById('viralVideoAstuce');
  const viralLienRow = document.getElementById('viralLienRow');
  const viralLienNote = document.getElementById('viralLienNote');
  const viralSummary = document.getElementById('viralVideoSummary');
  const sujetLabel = document.getElementById('sujetLabel');
  // Par défaut, on remet le champ lien et le label visibles (cas générique).
  if (viralLienRow) viralLienRow.style.display = '';
  if (viralLienNote) viralLienNote.style.display = '';
  if (viralLabel) viralLabel.style.display = '';

  const estViral = state.depart && state.depart.includes('analyser une vidéo virale');
  const estFlop = state.depart && state.depart.includes('vidéo qui a raté');
  if (estViral || estFlop) {
    // Ces modes ne sont atteints QUE via le handoff depuis « Analyser une
    // vidéo » : le transcript est déjà rempli, donc le champ lien n'a plus lieu
    // d'être. On efface le lien + le label, on relègue la vidéo décodée dans un
    // repli discret, et on met « Ton sujet » en vedette.
    viralField.style.display = 'flex';
    if (viralLienRow) viralLienRow.style.display = 'none';
    if (viralLienNote) viralLienNote.style.display = 'none';
    if (viralLabel) viralLabel.style.display = 'none';
    if (viralSummary) viralSummary.textContent = estFlop ? 'Voir la vidéo qui a raté' : ' Voir la vidéo décodée';
    if (viralAstuce) viralAstuce.textContent = "Déjà prise en compte. Tu peux la relire ou l'ajuster ici si besoin.";
    sujetLabel.textContent = 'Ton sujet à toi (ce dont TU veux parler)';
  } else if (state.depart && state.depart.includes('améliorer ou adapter')) {
    viralField.style.display = 'flex';
    viralLabel.textContent = 'Ton contenu existant, à améliorer';
    viralInput.placeholder = "Colle ici le texte complet de ta vidéo ou de ton script existant. Scriptura part de CE contenu, garde ton sujet et ton fond, améliore la forme (hook, rythme, structure, CTA).";
    if (viralAstuce) viralAstuce.textContent = "Colle le script ou les sous-titres tels quels, rien n'est réinventé, seulement amélioré et adapté.";
    if (viralSummary) viralSummary.textContent = 'Voir le contenu';
    sujetLabel.textContent = 'Angle ou sujet précis à mettre en avant';
  } else {
    viralField.style.display = 'none';
    sujetLabel.textContent = 'Ton sujet ou idée';
  }
}

// ── PARSING JSON ROBUSTE ──
function parseAIResponse(raw) {
  if (!raw) return null;

  // Tentative 1 : parsing direct du bloc JSON complet
  let match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch(e) {
      // Le JSON est probablement tronqué, on tente de le réparer
    }
  }

  // Tentative 2 : réparer un JSON tronqué
  // On prend depuis la première accolade
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let jsonStr = raw.substring(start);

  // Fermer les structures ouvertes (tableaux et objets)
  try {
    // Compter les accolades et crochets non fermés
    let openBraces = 0, openBrackets = 0, inString = false, escape = false;
    let lastValidPos = 0;

    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = !inString;
      if (!inString) {
        if (c === '{') openBraces++;
        if (c === '}') openBraces--;
        if (c === '[') openBrackets++;
        if (c === ']') openBrackets--;
        // Position après une valeur complète
        if (c === '}' || c === ']') lastValidPos = i + 1;
      }
    }

    // Tronquer à la dernière position valide et fermer proprement
    let repaired = jsonStr.substring(0, lastValidPos);
    // Recompter ce qui reste ouvert
    openBraces = 0; openBrackets = 0; inString = false; escape = false;
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = !inString;
      if (!inString) {
        if (c === '{') openBraces++;
        if (c === '}') openBraces--;
        if (c === '[') openBrackets++;
        if (c === ']') openBrackets--;
      }
    }
    // Fermer les crochets puis les accolades restants
    while (openBrackets > 0) { repaired += ']'; openBrackets--; }
    while (openBraces > 0) { repaired += '}'; openBraces--; }

    return JSON.parse(repaired);
  } catch(e) {
    // Tentative 3 : la coupure est arrivée AVANT toute structure fermée.
    // On repart du texte brut, on ferme la chaîne en cours si besoin,
    // puis toutes les structures ouvertes. Mieux vaut un objet partiel que rien.
    try {
      let t = jsonStr;
      let ob = 0, obr = 0, ins = false, esc = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') ins = !ins;
        if (!ins) {
          if (c === '{') ob++;
          if (c === '}') ob--;
          if (c === '[') obr++;
          if (c === ']') obr--;
        }
      }
      if (ins) t += '"';               // fermer la chaîne restée ouverte
      t = t.replace(/,\s*$/, '');      // virgule orpheline en fin
      while (obr > 0) { t += ']'; obr--; }
      while (ob > 0) { t += '}'; ob--; }
      return JSON.parse(t);
    } catch(e2) {
      return null;
    }
  }
}

// Affiche, PENDANT la génération (voir `onApercu` de callAI, js/api.js), le
// texte déjà écrit dans #genLivePreview : ne montre QUE ce qui est
// syntaxiquement complet (parseAIResponse ferme proprement le JSON tronqué,
// un bloc encore en train d'être écrit n'apparaît donc jamais à moitié).
// `cle` est le champ du JSON à afficher : 'script' (Script, tableau de blocs
// {texte}), 'recit' (Récit, tableau de {texte}) ou 'script' à nouveau côté
// Série (js/serie.js), mais cette fois une chaîne unique, pas un tableau,
// d'où la double branche ci-dessous.
function afficherApercuEnDirect(buffer, cle) {
  const parsed = parseAIResponse(buffer);
  const conteneur = document.getElementById('genLivePreview');
  if (!parsed || !conteneur) return;
  const valeur = parsed[cle];
  let lignes = [];
  if (Array.isArray(valeur)) {
    lignes = valeur.map(b => (b && b.texte) ? String(b.texte) : '').filter(Boolean);
  } else if (typeof valeur === 'string' && valeur.trim()) {
    lignes = [valeur];
  }
  if (!lignes.length) return;
  conteneur.style.display = 'block';
  conteneur.innerHTML = lignes.map(l => `<p class="gen-live-line">${auditEsc(l)}</p>`).join('');
  conteneur.scrollTop = conteneur.scrollHeight;
}

// ── SCORE DÉTERMINISTE DU SCRIPT (retour terrain, audit du 2 septembre 2026) ──
// Bug corrigé : le "Scriptura Score" venait auparavant directement de
// l'auto-évaluation de l'IA (elle inventait un chiffre 0-100 par dimension),
// deux générations identiques pouvaient afficher deux scores différents,
// contraire au pilier "mêmes données ⇒ même score, toujours" (voir CLAUDE.md).
// Un script tout juste écrit n'a par nature AUCUNE performance réelle à
// mesurer (contrairement à l'Audit, qui note de vraies vidéos publiées) :
// l'IA ne note donc plus rien elle-même, elle coche seulement la PRÉSENCE de
// techniques concrètes, et c'est le CODE qui calcule chaque dimension à
// partir de ces cases. Même principe que scoreViraliteRecette (js/viral.js).
//
// Renforcé une 2e fois (retour terrain, un score à 100% questionné à raison) :
// deux failles de rigueur corrigées ici. (1) deuxieme_personne/rythme_soutenu
// sont désormais détectés directement en CODE (regex/statistique), plus
// aucune IA impliquée pour ces deux-là. (2) Les 8 signaux restants viennent
// d'un 2e appel IA INDÉPENDANT (voir evaluerScriptGenere), qui ne voit QUE le
// texte fini, jamais le contexte de rédaction : le même appel qui vient
// d'écrire un texte a un biais d'auto-complaisance connu à le noter
// lui-même. Ce juge extérieur doit en plus CITER le passage exact qui
// justifie chaque case cochée, une citation introuvable mot pour mot dans le
// texte (vérifié mécaniquement) invalide le signal.
const GEN_SIGNAUX_JUGES_IA = ['hook_fort', 'pattern_interrupt', 'boucle_ouverte', 'details_concrets', 'emotion_forte', 'cta_clair', 'originalite', 'promesse_tenue'];
// Signaux qui décrivent une relation ENTRE deux endroits du texte (début et
// fin), jamais une technique concentrée dans une seule phrase : une seule
// citation ne peut structurellement pas les "prouver". Retour terrain (script
// Niger/Tiani, score 25/100) : promesse_tenue et boucle_ouverte tombaient à
// faux alors que le hook et la chute reprenaient presque mot pour mot la
// même idée ("connaît chaque pas d'avance"), le juge n'avait tout simplement
// aucune case pour citer DEUX passages. Ces deux signaux exigent désormais
// une citation d'ouverture ET une citation de clôture, toutes deux vérifiées,
// la clôture devant se situer chronologiquement APRÈS l'ouverture.
const GEN_SIGNAUX_DEUX_CITATIONS = ['boucle_ouverte', 'promesse_tenue'];
const GEN_DIMENSIONS_SCRIPT = {
  hook:       ['hook_fort', 'pattern_interrupt', 'originalite'],
  engagement: ['rythme_soutenu', 'deuxieme_personne', 'boucle_ouverte'],
  emotion:    ['emotion_forte', 'details_concrets'],
  viral:      ['originalite', 'emotion_forte', 'cta_clair']
};
// Présence d'une adresse directe au spectateur (tu/vous), comptage MÉCANIQUE,
// aucune IA : au moins 2 occurrences pour éviter qu'un seul "tu" incident
// dans une citation ne déclenche le signal.
function _genDetecterDeuxiemePersonne(texte) {
  const m = String(texte || '').match(/\b(tu|t'|toi|ton|ta|tes|vous|votre|vos)\b/gi);
  return !!m && m.length >= 2;
}
// Rythme soutenu approximé par la longueur moyenne des phrases (statistique
// pure, aucune IA) : des phrases courtes collent à la consigne "une image
// mentale toutes les 3-5 secondes", des phrases longues trahissent un
// temps mort ou une idée diluée.
function _genDetecterRythmeSoutenu(texte) {
  const phrases = String(texte || '').split(/[.!?…]+/).map(p => p.trim()).filter(Boolean);
  if (!phrases.length) return false;
  const motsTotal = phrases.reduce((s, p) => s + p.split(/\s+/).filter(Boolean).length, 0);
  return (motsTotal / phrases.length) <= 12;
}
// Score d'une dimension : simple taux de présence des signaux qui la
// composent, jamais un chiffre choisi librement. Un signal EXPLICITEMENT
// true/false compte pour 1/0 ; un signal ABSENT (clé manquante, ex. l'appel
// d'évaluation a échoué techniquement) compte pour 0.5, crédit neutre plutôt
// qu'une fausse note basse. `signaux` totalement absent retombe sur 50.
function _genScoreDimension(signaux, cles) {
  if (!signaux || typeof signaux !== 'object') return 50;
  const total = cles.reduce((somme, c) => somme + (signaux[c] === true ? 1 : signaux[c] === false ? 0 : 0.5), 0);
  return Math.round((total / cles.length) * 100);
}
// RÉTENTION : mélange le taux de signaux pertinents (boucle ouverte, chute
// qui tient sa promesse, rythme) avec le VRAI respect de la durée cible
// (compte de mots réel, mesuré en code, jamais une estimation) : un script
// qui coche tout mais dépasse largement la cible ne retient pas vraiment
// l'audience jusqu'au bout.
function _genScoreRetention(signaux, motsReels, wt) {
  const base = _genScoreDimension(signaux, ['boucle_ouverte', 'promesse_tenue', 'rythme_soutenu']);
  let scoreMots = 100;
  if (wt && wt.min && wt.max) {
    if (motsReels < wt.min) scoreMots = Math.max(40, 100 - Math.round((wt.min - motsReels) / wt.min * 100));
    else if (motsReels > wt.max) scoreMots = Math.max(40, 100 - Math.round((motsReels - wt.max) / wt.max * 100));
  }
  return Math.round(base * 0.7 + scoreMots * 0.3);
}
function scorerScriptGenere(signaux, motsReels, wt) {
  return {
    viral: _genScoreDimension(signaux, GEN_DIMENSIONS_SCRIPT.viral),
    hook: _genScoreDimension(signaux, GEN_DIMENSIONS_SCRIPT.hook),
    engagement: _genScoreDimension(signaux, GEN_DIMENSIONS_SCRIPT.engagement),
    emotion: _genScoreDimension(signaux, GEN_DIMENSIONS_SCRIPT.emotion),
    retention: _genScoreRetention(signaux, motsReels, wt)
  };
}
// Juge EXTÉRIEUR et indépendant (voir commentaire d'en-tête ci-dessus) :
// reçoit UNIQUEMENT le texte fini, jamais le brief ni le contexte de
// rédaction. Chaque signal exige une citation vérifiée mot pour mot dans le
// texte (normalisée : espaces/casse), sinon il retombe à false. Renvoie
// null en cas d'échec technique (jamais bloquant, voir l'appelant).
async function evaluerScriptGenere(texteComplet) {
  if (!texteComplet || !texteComplet.trim()) return null;
  const prompt = `Tu es un critique EXTÉRIEUR et exigeant, tu n'as PAS écrit ce script. Voici un script TikTok déjà terminé. Ta seule mission : juger honnêtement s'il contient VRAIMENT chacune des techniques ci-dessous, et CITER le passage exact qui le prouve (jamais une paraphrase, jamais un extrait qui n'existe pas mot pour mot dans le texte).

SCRIPT :
"""
${texteComplet}
"""

Pour CHAQUE technique, juge sévèrement : ne coche "present":true QUE si tu peux citer un passage RÉEL et PRÉCIS (copié mot pour mot) qui le prouve sans discussion possible.
- "hook_fort" : le hook arrête-t-il vraiment le scroll en 2 secondes, sans être générique ?
- "pattern_interrupt" : la toute première phrase rompt-elle une attente (chiffre choc, affirmation contre-intuitive) ?
- "boucle_ouverte" : une vraie tension/curiosité plantée tôt et qui reste non résolue un moment. Cite le passage qui l'OUVRE ET le passage plus loin où elle finit par se refermer (deux citations, jamais une seule : ça se prouve en comparant deux endroits du texte, pas dans une seule phrase).
- "details_concrets" : des exemples/chiffres précis plutôt que du vague ?
- "emotion_forte" : une émotion nette et identifiable ?
- "cta_clair" : le dernier passage contient-il un vrai appel à l'action qui dit précisément quoi faire ?
- "originalite" : l'angle est-il vraiment original, pas un cliché IA reconnaissable ?
- "promesse_tenue" : la chute répond-elle vraiment à la promesse ouverte par le hook ? Cite le passage du DÉBUT qui ouvre la promesse ET le passage de la FIN qui la referme (deux citations, jamais une seule : ça se prouve en comparant le début et la fin, pas dans une seule phrase).

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hook_fort":{"present":true,"preuve":"citation exacte ou vide"},"pattern_interrupt":{"present":true,"preuve":"..."},"boucle_ouverte":{"present":true,"preuve_ouverture":"citation qui plante la tension","preuve_cloture":"citation plus loin qui la referme"},"details_concrets":{"present":true,"preuve":"..."},"emotion_forte":{"present":true,"preuve":"..."},"cta_clair":{"present":true,"preuve":"..."},"originalite":{"present":true,"preuve":"..."},"promesse_tenue":{"present":true,"preuve_ouverture":"citation du hook qui ouvre la promesse","preuve_cloture":"citation de la chute qui la referme"}}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 1200, prompt, undefined, undefined, undefined, undefined, undefined, undefined, 'script');
    const jug = parseAIResponse(raw);
    if (!jug) return null;
    const texteNormalise = String(texteComplet).toLowerCase().replace(/\s+/g, ' ');
    const signaux = {};
    GEN_SIGNAUX_JUGES_IA.forEach(cle => {
      const d = jug[cle];
      if (GEN_SIGNAUX_DEUX_CITATIONS.includes(cle)) {
        const ouverture = _genValiderCitation(d && d.preuve_ouverture, texteNormalise);
        const cloture = _genValiderCitation(d && d.preuve_cloture, texteNormalise);
        const ordreValide = ouverture.valide && cloture.valide && cloture.position > ouverture.position;
        signaux[cle] = !!(d && d.present === true && ordreValide);
      } else {
        const preuve = _genValiderCitation(d && d.preuve, texteNormalise);
        signaux[cle] = !!(d && d.present === true && preuve.valide);
      }
    });
    return signaux;
  } catch (e) { return null; }
}
// Vérifie qu'une citation existe mot pour mot (espaces/casse normalisés)
// dans le texte, et renvoie sa position pour permettre un contrôle
// chronologique (voir GEN_SIGNAUX_DEUX_CITATIONS ci-dessus).
function _genValiderCitation(preuve, texteNormalise) {
  const p = (typeof preuve === 'string' ? preuve : '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (p.length < 4) return { valide: false, position: -1 };
  const position = texteNormalise.indexOf(p);
  return { valide: position >= 0, position };
}

// ── GÉNÉRATION ──
async function generate() {
  if (!_regenGratuiteEnCours) resetRegen('script');
  const niche    = document.getElementById('niche').value.trim();
  const sujetBrut = document.getElementById('sujet').value.trim();
  // Le champ accepte aussi bien quelques mots qu'un texte long collé (un
  // article entier, plusieurs pages). Au-delà d'un certain volume, on le
  // traite comme une MATIÈRE de référence : le Directeur Éditorial (seule
  // phase à recevoir ce texte complet, les phases suivantes ne travaillent
  // plus que sur l'angle déjà distillé, voir sujetCourt plus bas) doit
  // pouvoir en tenir compte EN ENTIER pour faire une vraie synthèse, pas
  // juste lire le début et perdre tout ce qui suit. La borne ci-dessous
  // reste large (~20 000 caractères, largement au-delà de la fenêtre de
  // contexte du modèle) : c'est un garde-fou contre un collage aberrant
  // (des centaines de pages), pas une limite pensée pour un article normal.
  const LONG_SEUIL = 400;
  const estTexteLong = sujetBrut.length > LONG_SEUIL;
  const sujet = estTexteLong
    ? tronquerSansCouperEmoji(sujetBrut, 20000)
    : sujetBrut;
  const audience = document.getElementById('audience').value.trim();
  const format   = document.getElementById('format').value.trim();
  const venteDescription = (state.objectif === 'Générer des ventes via mon contenu')
    ? document.getElementById('venteDescription').value.trim() : '';
  const viralVideo = document.getElementById('viralVideo').value.trim();
  // Les 4 choix de l'étape "Avec quoi commences-tu ?" doivent chacun produire
  // un résultat concrètement différent, pas seulement les 2 premiers.
  // Voir departInstructionScript plus bas pour l'instruction envoyée à l'IA
  // pour CHAQUE cas (y compris "idée vague" et "sujet précis", auparavant
  // strictement identiques dans le prompt final malgré la promesse de l'étape
  // 2 : "Scriptura s'adapte à ton point de départ").
  const isViralMode = state.depart && state.depart.includes('analyser une vidéo virale');
  // Handoff depuis « Analyser une vidéo » quand la vidéo a floppé : on la
  // transforme en version virale (matière déjà pré-remplie dans le champ vidéo).
  const isFlopMode = state.depart && state.depart.includes('vidéo qui a raté');
  const isAmeliorerMode = state.depart && state.depart.includes('améliorer ou adapter');
  // "un sujet précis..." recouvre à la fois le choix direct de l'étape 2 et
  // le pont "Générer le script complet" depuis une idée déjà trouvée (voir
  // useIdeaForScript, qui fixe state.depart sur un texte légèrement
  // différent mais du même sens : sujet déjà arrêté, jamais à réinventer).
  const isSujetPrecis = state.depart && state.depart.includes('sujet précis');
  const isIdeeVague = state.depart === 'une idée vague ou un thème général';
  const errorBox = document.getElementById('errorBox');

  errorBox.style.display = 'none';

  if (!niche || !sujet) {
    errorBox.textContent = 'Renseigne au minimum ta niche et ton sujet pour continuer.';
    errorBox.style.display = 'block'; return;
  }
  if (isViralMode && !viralVideo) {
    errorBox.textContent = 'Colle le texte de la vidéo virale que tu veux analyser.';
    errorBox.style.display = 'block'; return;
  }
  if (isFlopMode && !viralVideo) {
    errorBox.textContent = 'La vidéo à transformer est vide. Relance l\'analyse pour repartir de sa structure.';
    errorBox.style.display = 'block'; return;
  }
  if (isAmeliorerMode && !viralVideo) {
    errorBox.textContent = 'Colle le texte de ton contenu existant à améliorer.';
    errorBox.style.display = 'block'; return;
  }

  // Cette génération correspond-elle à la recommandation d'accueil ? Capturé
  // ici (une seule fois, avant les vérifications de quota) puis remis à false
  // : ne s'applique qu'à la toute prochaine tentative, jamais à une génération
  // sans rapport plus tard dans la session.
  const depuisRecommandation = (typeof _recoEnCoursDaction !== 'undefined') && _recoEnCoursDaction;
  if (typeof _recoEnCoursDaction !== 'undefined') _recoEnCoursDaction = false;

  // ── VÉRIFICATION LIMITE ──
  if (!unlocked && usedGen >= MAX_FREE) {
    openPlans('nouveau');
    return;
  }
  // Limite journalière pour les abonnés (anti-abus)
  if (!(await peutGenerer('errorBox'))) return;

  setLoading(true);
  document.getElementById('results').style.display = 'none';

  // Calcul de la cible de mots selon la durée
  const wordTargets = {
    '30 secondes': { min: 60, max: 78, blocs: '3', desc: '30 secondes' },
    '1 minute':    { min: 130, max: 155, blocs: '4', desc: '1 minute' },
    '2 minutes':   { min: 270, max: 310, blocs: '5', desc: '2 minutes' },
    '3 minutes':   { min: 410, max: 460, blocs: '6', desc: '3 minutes' },
    '5 minutes':   { min: 680, max: 780, blocs: '7-8', desc: '5 minutes' }
  };
  const wt = wordTargets[selectedDuree] || wordTargets['1 minute'];

  // Mémoire du créateur : une ligne de contexte factuelle en plus, construite
  // depuis le profil déjà connu (voir js/profil.js). N'existe que si des
  // informations sont déjà connues ; ne modifie aucune règle du prompt.
  const profilLigneScript = ligneProfilPourPrompt(await chargerProfilCreateur());

  // Recherche web : uniquement pour les niches d'actualité/géopolitique (voir
  // js/api.js), pour vérifier les faits avant de rédiger. Aucun impact sur les
  // autres niches (ni coût, ni lenteur supplémentaires).
  const rechercheWeb = nicheNecessiteRecherche(niche);

  // Recherche des tendances TikTok (voir js/api.js) : comme en mode Idées,
  // le Directeur Éditorial choisit un angle parmi 3 pour CE sujet, donc
  // autant qu'il s'appuie sur ce qui marche EN CE MOMENT dans la niche,
  // pas seulement sur ses connaissances d'entraînement. Active pour toutes
  // les niches, indépendamment de rechercheWeb (vérification factuelle).
  const rechercheTendancesScriptActive = true;

  // Point de départ (étape 2, "Avec quoi commences-tu ?") : les 4 choix
  // doivent chacun changer concrètement le résultat, pas seulement les 2 qui
  // impliquent un texte à coller. "Idée vague" et "sujet précis" produisaient
  // auparavant EXACTEMENT le même prompt, aucune trace du choix fait à
  // l'écran 2, alors que sa promesse ("Scriptura s'adapte à ton point de
  // départ") disait le contraire.
  let departInstructionScript = '';
  if (isViralMode) {
    departInstructionScript = `\nMODE ANALYSE : le créateur veut reproduire la recette de cette vidéo virale :\n[DEBUT]\n${viralVideo}\n[FIN]\nDécode sa structure et sa mécanique (hook, rythme, narration) pour la réappliquer à SON sujet à lui, n'écris jamais sur le sujet de la vidéo virale elle-même.\n`;
  } else if (isFlopMode) {
    departInstructionScript = `\nMODE CORRECTION : cette vidéo a SOUS-PERFORMÉ. On te donne son diagnostic et/ou sa structure corrigée :\n[DEBUT]\n${viralVideo}\n[FIN]\nApplique cette mécanique corrigée pour écrire la VERSION VIRALE du script sur le sujet du créateur : hook plus fort, tension mieux tenue, leviers qui manquaient. N'écris pas sur le sujet de la vidéo d'origine, applique sa recette corrigée au sujet du créateur.\n`;
  } else if (isAmeliorerMode) {
    departInstructionScript = `\nMODE AMÉLIORATION : le créateur a déjà ce contenu, à améliorer et adapter, PAS à remplacer par un sujet différent :\n[DEBUT]\n${viralVideo}\n[FIN]\nPars de ce texte précis : garde son sujet et son fond réels, améliore uniquement la forme (hook plus fort, structure plus efficace, rythme, CTA plus clair). N'invente jamais un sujet différent de celui de ce contenu existant.\n`;
  } else if (isIdeeVague) {
    departInstructionScript = `\nPOINT DE DÉPART : le créateur n'a qu'un thème général, pas encore d'angle précis, tu as toute liberté créative pour définir TOI-MÊME un angle spécifique et percutant à l'intérieur de ce thème. Ne te contente jamais de décrire le thème tel quel : trouve UN angle concret et défendable, et assume-le.\n`;
  } else if (isSujetPrecis) {
    departInstructionScript = `\nPOINT DE DÉPART : le sujet ci-dessus est déjà précis et arrêté par le créateur, reste rigoureusement ancré dessus. N'élargis JAMAIS vers un thème plus général et ne dévie JAMAIS vers un angle différent de celui donné : approfondis ce sujet exact, ne le remplace pas par un autre.\n`;
  }

  // Retour terrain (2 scripts consécutifs) : "Tu sais...", "Et si je te
  // disais..." jugés clichés/IA par le créateur, alors que ni l'un ni
  // l'autre ne figurait dans la liste interdite existante. Recherche
  // (tendances TikTok 2026, sources multiples) : ces formules correspondent
  // exactement aux hooks les plus signalés comme génériques/IA à
  // l'international ("you know...", "what if I told you...", "did you know
  // that...", "wait for it", "watch till the end", "hi guys, today..."),
  // liste enrichie en conséquence. Réutilisée pour le choix de direction ET
  // la génération finale des hooks (une seule source, jamais deux listes
  // qui divergent).
  const GEN_HOOKS_CLICHES_INTERDITS = '"Tu sais...", "Et si je te disais...", "Imagine...", "Laisse-moi te dire...", "Aujourd\'hui on va parler de...", "Voici pourquoi...", "Vous ne devinerez jamais...", "Voici 5 astuces...", "Saviez-vous que...", "Dans cette vidéo...", "Attends la fin...", "Regarde jusqu\'au bout..."';

  // Les choix du créateur (plateforme, objectif) doivent avoir un effet réel
  // et vérifiable sur le script produit, pas juste apparaître en contexte
  // passif. Avant ce correctif, la plateforme n'avait aucun code concret
  // ("respecte les codes de rythme" sans dire lesquels), et l'objectif,
  // stocké comme une phrase complète (ex. "Renforcer mon expertise et ma
  // crédibilité"), devait être deviné par l'IA contre des étiquettes
  // courtes qui ne correspondent pas toujours textuellement (aucune ne
  // contient le mot "autorité").
  const codesPlateformeScript = {
    'TikTok': 'hooks très courts et immédiats, rythme rapide, tutoiement direct, coupes fréquentes.',
    'Instagram Reels': 'esthétique soignée, peut installer une micro-narration avant le twist, ton communauté/lifestyle.',
    'YouTube Shorts': 'hook proche d\'un titre de recherche (curiosité ou promesse claire dès les premiers mots), pensé pour capter au scroll ET à la recherche.',
    'Facebook': 'ton plus familier et générationnel, formulations qui invitent explicitement au partage et au commentaire.',
    'LinkedIn': 'registre professionnel, retour d\'expérience ou enseignement concret, jamais putaclic, la crédibilité prime sur le sensationnalisme.',
    'WhatsApp Status': 'très court et personnel, comme un message adressé à des proches/contacts plutôt qu\'à un public anonyme, ton direct et intime.'
  };
  const plateformeInstructionScript = state.plateforme
    ? `PLATEFORME "${state.plateforme}", RESPECTE SES CODES : ${codesPlateformeScript[state.plateforme] || 'adapte le rythme et le registre aux usages propres à cette plateforme.'}`
    : `Aucune plateforme précisée : reste généraliste, adapté à un usage vidéo courte multi-plateformes.`;

  // L'objectif ne doit pas se limiter au CTA final : l'angle, l'émotion
  // dominante et la structure choisis par le Directeur Éditorial doivent
  // eux aussi en dépendre rigoureusement (retour créateur explicite).
  // "corps" alimente le brief stratégique ET la consigne du Rédacteur en
  // Chef, "cta" reste la consigne spécifique du dernier bloc.
  // "trame" : squelette narratif par défaut, une base solide pour le
  // Directeur Éditorial, pas un carcan absolu, il garde la main pour s'en
  // écarter avec une vraie raison (voir consigne d'adaptation ci-dessous et
  // l'appel à cette trame dans le brief). "critique" : questions propres à
  // cet objectif que le Critique Éditorial doit se poser en plus de sa
  // grille générale (anti-IA-générique, clichés...), jamais à sa place.
  // Retour terrain + recherche (tendances TikTok 2026, sources multiples) :
  // mon 1er correctif imposait un CTA de partage PARLÉ pour "Faire plus de
  // vues", exactement l'inverse de la pratique confirmée. Pour la pure
  // portée, le levier qui compte est la BOUCLE (la chute rejoint l'ouverture,
  // pour que la relecture automatique TikTok redémarre sans coupure
  // ressentie) : les rewatchs comptent 2x plus qu'une vue simple pour
  // l'algorithme, et un CTA parlé de 2-3s mange du temps d'antenne et casse
  // justement cette boucle. L'appel à l'action, s'il y en a un, doit être
  // discret (commente/reste jusqu'au bout) et vivre dans la LÉGENDE, jamais
  // forcé dans le script parlé lui-même.
  const codesObjectifScript = {
    'Faire plus de vues et maximiser la portée': {
      corps: 'privilégie l\'angle et l\'émotion qui donnent le plus envie de RE-REGARDER ou d\'enchaîner sur une autre vidéo du compte (surprise, choc, humour, forte identification), la portée prime sur la conversion. La structure et les relances doivent maximiser la rétention pure jusqu\'au bout, sans jamais ralentir pour expliquer ou vendre quoi que ce soit.',
      cta: 'PRIVILÉGIE LA BOUCLE plutôt qu\'un CTA parlé : la toute dernière phrase doit rejoindre ou faire écho à la toute première (même mot, même image, même idée), pour que la relecture automatique de TikTok enchaîne sans coupure ressentie et pousse au rewatch (pesé 2x plus qu\'une vue simple par l\'algorithme). N\'ajoute PAS de phrase de type "partage/abonne-toi" parlée à la fin, ça mange du temps d\'antenne et casse la boucle : si un vrai appel à l\'action est utile, il vivra dans la légende, pas ici. Tout au plus, une relance implicite très courte ("et ça continue" / "regarde bien la fin") est acceptable si elle sert la boucle, jamais un ordre de partage explicite.',
      trame: 'hook → anomalie ou paradoxe → première révélation → nouvelle question qui relance la curiosité → contexte bref → révélation plus forte → twist → chute qui BOUCLE sur le hook (même mot, même image, ou la même phrase complétée différemment), pour un effet de relecture immédiate.',
      critique: 'Les 3 premières secondes donnent-elles vraiment envie de rester ? Y a-t-il un ou plusieurs moments où la tension retombe (un passage à vide, une baisse de rythme) ? La chute boucle-t-elle vraiment sur l\'ouverture (même mot/image/idée), ou est-ce une simple conclusion qui n\'a aucun lien littéral avec le hook ? Chaque phrase justifie-t-elle vraiment sa présence, ou une partie pourrait-elle être supprimée sans perte ?'
    },
    'Gagner des abonnés qualifiés rapidement': {
      corps: 'construis un angle qui donne une signature reconnaissable au créateur (un point de vue, une expertise, une manière de traiter ce type de sujet), pas un contenu isolé et interchangeable. Traite ce sujet comme un ÉPISODE d\'une série implicite sur ce thème (même sans le nommer explicitement "partie 1"), l\'émotion dominante doit créer de l\'attachement au créateur autant qu\'au sujet.',
      cta: 'donner une raison concrète et précise de s\'abonner (promesse de valeur future, contenu récurrent, "la suite arrive"), jamais un "abonne-toi" générique. Le contenu-série (une raison claire de vouloir voir la suite) fait mieux que la portée pure pour la fidélisation, prouvé.',
      trame: 'hook → histoire ou information forte → valeur livrée au spectateur → signature éditoriale (la manière propre au créateur de traiter ce type de sujet, pas générique) → ouverture explicite vers la suite ou un autre contenu du compte (traite ce sujet comme un épisode, pas un one-shot) → pourquoi suivre ce compte précisément → CTA d\'abonnement.',
      critique: 'Le créateur a-t-il une identité claire et reconnaissable dans ce script, ou pourrait-il être signé par n\'importe quel compte ? Le spectateur comprend-il concrètement pourquoi suivre CE compte plutôt qu\'un autre sur le même sujet ? Le script donne-t-il vraiment envie de voir la prochaine vidéo (une suite, un approfondissement identifiable), pas seulement d\'avoir aimé celle-ci ?'
    },
    'Générer des ventes via mon contenu': {
      corps: 'construis l\'angle autour d\'un problème réel et douloureux pour l\'audience, que l\'offre du créateur résout implicitement. Privilégie une structure problème → agitation → solution assumée : l\'AGITATION doit rendre le problème concrètement urgent et personnel (montrer les vraies conséquences de l\'inaction, pas juste le nommer), prouvé pour augmenter l\'intention d\'achat de 37% par rapport à un problème simplement énoncé. Ton natif et vécu ("j\'ai réparé la mauvaise partie du problème"), jamais le ton d\'une pub léchée. L\'émotion dominante doit créer le désir ou l\'urgence d\'agir, jamais du contenu purement informatif qui n\'oriente vers rien. ATTENTION (piège fréquent sur cet objectif argumentatif) : garde des PHRASES COURTES même en expliquant le problème ou l\'offre, une explication n\'est pas une excuse pour ralentir le rythme. Appuie-toi sur UN exemple concret et vécu, nommé et précis (pas une catégorie générique de client ou de situation), c\'est ce détail unique qui rend le problème réel pour le spectateur.',
      cta: 'inciter à passer à l\'action commerciale (lien, DM, commentaire déclencheur, offre), sans jamais sonner comme une pub déguisée. Ce CTA doit être une PHRASE AUTONOME ET EXPLICITE, clairement identifiable comme le dernier bloc, jamais dilué ou fondu dans une phrase de conclusion argumentative.',
      trame: 'problème → prise de conscience → agitation réelle (conséquences concrètes de l\'inaction, pas juste "c\'est grave") → nouvelle façon de voir ce problème → solution → preuve ou crédibilité → offre → CTA. L\'offre n\'apparaît jamais avant que le désir soit réellement construit.',
      critique: 'Le problème posé est-il assez important pour justifier qu\'on y consacre du temps et, potentiellement, de l\'argent ? L\'agitation montre-t-elle de VRAIES conséquences concrètes, ou reste-t-elle une affirmation vague ("c\'est un problème") sans les rendre tangibles ? Le désir est-il vraiment construit avant que l\'offre apparaisse, ou l\'offre arrive-t-elle trop tôt/brutalement ? L\'objection la plus probable du spectateur (prix, doute, "ça marche vraiment ?") est-elle anticipée d\'une façon ou d\'une autre ? Les phrases restent-elles courtes et rythmées même dans les passages explicatifs, ou le texte s\'alourdit-il en argumentant ? Le CTA final est-il une phrase à part entière et explicite, ou se noie-t-il dans la conclusion ?'
    },
    'Renforcer mon expertise et ma crédibilité': {
      corps: 'choisis un angle qui démontre une maîtrise réelle et non évidente du sujet (nuance, contre-intuition, preuve concrète), jamais un contenu superficiel ou putaclic. Privilégie une structure de démonstration/preuve plutôt qu\'une simple accroche, l\'émotion dominante visée est le respect et la confiance envers le créateur, pas seulement le divertissement. ATTENTION (piège fréquent sur cet objectif argumentatif) : garde des PHRASES COURTES même en démontrant ou en nuançant, l\'analyse ne justifie pas des phrases longues. La preuve concrète doit être UN cas précis et nommé (un chiffre daté, une situation vécue, un exemple identifiable), jamais une généralité abstraite du type "de nombreux cas montrent que...".',
      cta: 'inciter à commenter son avis ou sauvegarder, démontrer une maîtrise réelle du sujet, jamais du contenu superficiel. Ce CTA doit rester une PHRASE AUTONOME ET EXPLICITE à la toute fin du script, jamais oublié ni fondu dans la conclusion de la démonstration.',
      trame: 'thèse forte et assumée → fait ou preuve concrète → contexte → nuance (ce qui est vrai mais incomplet dans la vision commune) → analyse → contre-argument pris au sérieux → conclusion originale, pas une simple reformulation de la thèse de départ → CTA explicite.',
      critique: 'Les affirmations sont-elles précises et vérifiables, ou vagues et invérifiables ? Y a-t-il une vraie nuance (une distinction, une limite reconnue), ou seulement une déclaration d\'autorité sans démonstration ? Le script démontre-t-il l\'expertise par le raisonnement, ou se contente-t-il de l\'affirmer ("je suis expert donc crois-moi") ? La preuve avancée est-elle un cas précis et nommé, ou reste-t-elle abstraite ? Les phrases restent-elles courtes malgré l\'argumentation ? Un CTA explicite et autonome clôt-il vraiment le script, ou a-t-il disparu dans la conclusion démonstrative ?'
    }
  };
  const objectifCorpsScript = codesObjectifScript[state.objectif] && codesObjectifScript[state.objectif].corps;
  const objectifCtaScript = codesObjectifScript[state.objectif] && codesObjectifScript[state.objectif].cta;
  const objectifTrameScript = codesObjectifScript[state.objectif] && codesObjectifScript[state.objectif].trame;
  const objectifCritiqueScript = codesObjectifScript[state.objectif] && codesObjectifScript[state.objectif].critique;

  // Objectif ventes : ce que le créateur vend rend l'angle et l'offre
  // concrets plutôt que génériques (retour créateur explicite). Le fichier
  // joint (photo produit ou PDF) n'est lu qu'à cette seule phase (comme le
  // texte source long, voir sujet/sujetCourt plus bas) : les phases
  // suivantes travaillent sur l'angle déjà distillé par le Directeur
  // Éditorial, pas sur le fichier brut, pour ne pas répéter son coût.
  const estObjectifVentes = state.objectif === 'Générer des ventes via mon contenu';
  const estObjectifVues = state.objectif === 'Faire plus de vues et maximiser la portée';
  const venteContexteScript = (estObjectifVentes && (venteDescription || venteFichier))
    ? `\nCE QUE LE CRÉATEUR VEND : ${venteDescription || '(voir le fichier joint au message)'}${venteFichier ? ' Un fichier joint au message (photo du produit ou extrait du document fourni) donne des détails supplémentaires, utilise-le activement pour construire un angle, une preuve et une offre concrets, pas génériques.' : ''}\n`
    : '';
  const venteFichierPourBrief = (estObjectifVentes && venteFichier) ? venteFichier : undefined;
  const objectifInstructionScript = state.objectif
    ? `OBJECTIF DU CRÉATEUR "${state.objectif}", LE CTA FINAL DOIT : ${objectifCtaScript || 'servir précisément cet objectif, formulé exactement comme le créateur l\'a choisi.'}`
    : `Aucun objectif précisé : vise un CTA équilibré entre portée et fidélisation.`;
  const objectifCorpsInstructionScript = state.objectif
    ? `OBJECTIF DU CRÉATEUR "${state.objectif}", CECI DOIT GUIDER L'ANGLE, L'ÉMOTION ET LA STRUCTURE (pas seulement le CTA final) : ${objectifCorpsScript || 'choisis l\'angle, l\'émotion et la structure qui servent le mieux cet objectif précis, formulé exactement comme le créateur l\'a choisi.'}`
    : `Aucun objectif précisé : choisis l'angle et la structure les plus solides dans l'absolu.`;

  // Mémoire virale partagée (niche d'abord) : recettes prouvées pour éclairer
  // le choix de structure/hook du Directeur Éditorial.
  const memoireViraleScript = await recupererPatternsViraux(niche);

  try {
    // ════════════════════════════════════════════
    //  PHASE 1, LE DIRECTEUR ÉDITORIAL (raisonnement)
    //  Analyse le sujet, génère 3 angles, sélectionne le meilleur,
    //  choisit la structure, définit la stratégie de hooks.
    // ════════════════════════════════════════════
    const briefPrompt = `Tu es le Directeur Éditorial de Scriptura, le meilleur stratège de contenu viral francophone. Tu ne rédiges PAS encore. Tu réfléchis comme un directeur créatif de haut niveau avant toute écriture.

RÈGLE FONDAMENTALE, au-dessus de toutes les autres : le script final doit donner l'impression d'avoir été écrit par un excellent storyteller spécialisé TikTok, jamais par une IA généraliste. Chaque choix que tu fais ci-dessous doit servir cette règle.
${instructionRechercheTendancesTikTok(niche, 'de définir l\'angle et la stratégie')}${memoireViraleScript}

CONTEXTE :
- ${estTexteLong ? 'MATIÈRE FOURNIE PAR LE CRÉATEUR (texte de référence, potentiellement un article ou un document entier, à NE PAS recopier tel quel : extrais-en le sujet réel, l\'angle et les faits utiles, puis distille pour tenir dans la durée choisie plus bas, quelle que soit la richesse de cette matière)' : 'Sujet'} : ${sujet}
- Niche : ${niche}
- Plateforme : ${state.plateforme}
- Objectif du créateur : ${state.objectif}
- Durée cible : ${wt.desc}
${audience ? '- Audience : ' + audience : ''}
${format ? '- Format : ' + format : ''}
${selectedTone ? '- Ton souhaité : ' + selectedTone : ''}
${profilLigneScript ? '- ' + profilLigneScript : ''}
${departInstructionScript}
${objectifCorpsInstructionScript}
${venteContexteScript}

TON TRAVAIL DE RÉFLEXION (fais-le sérieusement, c'est ce qui fait la différence) :

1. ANALYSE DU SUJET : Quel est l'enjeu réel, la tension cachée, ce qui rend ce sujet émotionnellement puissant ? Quel est l'angle mort que personne n'exploite ? Si le profil du créateur ci-dessus contient des leçons tirées de ses audits précédents, utilise-les activement pour orienter cette analyse.

2. TROIS ANGLES NARRATIFS DIFFÉRENTS : Propose 3 angles VRAIMENT distincts (pas 3 variantes du même). Pour CHAQUE angle, cherche activement au moins un de ces leviers puissants : l'élément inattendu, la contradiction, la révélation, le conflit, la surprise, le paradoxe, le coût caché, le secret, le risque. Un angle qui n'exploite aucun de ces leviers est un angle faible, remplace-le. Par exemple : un angle contre-intuitif, un angle émotionnel/personnel, un angle révélation/coulisses. Chaque angle doit attaquer le sujet différemment.

3. COMPARAISON ET SÉLECTION : Compare les 3 angles pour ${state.plateforme} et l'objectif "${state.objectif}". L'angle choisi ne doit jamais être simplement "intéressant" : il doit être le PLUS PUISSANT des trois, celui qui a le plus fort potentiel d'arrêt du scroll ET de rétention. Choisis-en UN et justifie en une phrase pourquoi il est le plus fort, pas seulement pourquoi il convient.

4. STRUCTURE NARRATIVE OPTIMALE : Quelle structure sert le mieux cet angle ? ${objectifTrameScript ? `Base-toi sur cette trame par défaut pour l'objectif du créateur, une base solide et éprouvée, pas un carcan : ${objectifTrameScript} Adapte le NOMBRE d'étapes de cette trame au nombre de blocs disponibles pour la durée choisie (indiqué plus bas) : à peu de blocs, fusionne ou élague les étapes les moins essentielles, mais ne sacrifie JAMAIS le hook ni la conclusion/CTA. Tu peux t'en écarter si tu as une meilleure structure pour CE sujet précis, mais seulement avec une vraie raison, pas par réflexe.` : '(ex: problème→agitation→solution, boucle ouverte, storytelling chronologique, liste à tension croissante, mythe→réalité...)'} Choisis la meilleure.

5. STRATÉGIE ÉMOTIONNELLE ET RÉTENTION : Quelle émotion dominante veux-tu déclencher ? Pour tenir l'attention jusqu'au bout, appuie-toi consciemment sur ta connaissance de la psychologie humaine et choisis, parmi ces leviers, celui ou ceux qui serviront le mieux CE sujet (nomme-le/les) : la BOUCLE OUVERTE MAINTENUE (une tension posée tôt, jamais refermée avant la fin), la RÉCOMPENSE IMPRÉVISIBLE (varier le rythme et les révélations pour que le spectateur ne puisse jamais deviner ce qui vient), l'ESCALADE DES ENJEUX (chaque relance plus forte que la précédente, jamais un plateau), ou le MICRO-CLIFFHANGER (une relance juste avant chaque coupure mentale naturelle). Précise où placer les "retention hooks" (relances qui réaccrochent) et quel levier psychologique chacun exploite.

6. ANGLE DE HOOK GAGNANT : Quel type de hook aura le plus d'impact pour cet angle précis ? Appuie-toi sur ta connaissance de la psychologie humaine pour choisir CONSCIEMMENT le levier le plus puissant pour ce sujet précis (nomme-le) parmi : la BOUCLE OUVERTE / CURIOSITY GAP (une information manquante que le spectateur a besoin de combler), le PATTERN INTERRUPT (une forme ou une amorce qui casse ce à quoi on s'attend), l'AVERSION À LA PERTE (ce que le spectateur risque de manquer ou perdre s'il ne regarde pas), la DISSONANCE / CONTRADICTION (deux faits qui ne devraient normalement pas coexister), l'IDENTIFICATION MENACÉE (une menace ou une promesse qui touche directement le spectateur, pas un tiers abstrait), l'ENTRÉE EN PLEINE ACTION / IN MEDIAS RES (commencer au milieu d'une scène ou d'un résultat déjà arrivé, jamais poser calmement le décor avant, un début qui commence après coup retient nettement moins), ou le CHIFFRE/DÉTAIL PRÉCIS DÈS LA PREMIÈRE PHRASE (un chiffre, un montant, une durée exacte plutôt qu'une généralité vague). Le hook ne doit jamais être seulement accrocheur : il doit provoquer une envie IRRÉPRESSIBLE de continuer, en exploitant délibérément ce levier précis, pas au hasard. Teste mentalement la direction envisagée : est-elle prévisible ? Correspond-elle à une formule interdite (${GEN_HOOKS_CLICHES_INTERDITS}) ? Pourrait-elle être prononcée par n'importe quel créateur sur n'importe quel sujet (si oui, encore trop générique, cherche plus spécifique à CE sujet précis) ? Crée-t-elle une vraie tension et une boucle de curiosité ? Si elle échoue à l'un de ces tests, cherche une meilleure direction. Donne la direction ET le levier psychologique choisi (pas encore la formulation finale).

7. STRATÉGIE DE CHUTE : ${estObjectifVues ? 'Pour l\'objectif "Faire plus de vues", pas de CTA parlé : décris comment la chute va boucler sur le hook (quel mot/image/idée du hook elle va reprendre), pour un effet de relecture immédiate.' : 'Quel appel à l\'action final servira le mieux l\'objectif "' + state.objectif + '" ? Quelle action précise le spectateur doit-il faire à la fin (acheter, commenter un mot, partager, s\'abonner pour une raison précise) ?'}

8. ANTI-RÉPÉTITION : Si le profil du créateur ci-dessus mentionne des angles, hooks ou structures déjà utilisés récemment, ton angle et ta structure choisis DOIVENT en être nettement différents. Ne recycle jamais ce qui a déjà été fait pour ce créateur.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"analyse_strategique":"l'enjeu réel et l'angle mort en 2 phrases percutantes","angle_choisi":"description de l'angle gagnant sélectionné","pourquoi_cet_angle":"justification en 1 phrase : pourquoi c'est le PLUS PUISSANT des 3, pas juste pourquoi il convient","structure":"la structure narrative choisie et son déroulé","emotion_dominante":"l'émotion clé à déclencher","strategie_hook":"la direction du hook le plus percutant, déjà validée contre le test de prévisibilité, avec le levier psychologique choisi nommé explicitement","strategie_retention":"où placer les relances pour tenir jusqu'au bout, avec le(s) levier(s) psychologique(s) exploité(s) nommé(s)","strategie_cta":"l'action précise à demander en fin de script"}`;

    const briefRaw = await callAI(MODEL_RAPIDE, 2000, briefPrompt, undefined, rechercheTendancesScriptActive, undefined, undefined, venteFichierPourBrief, undefined, 'script');
    const brief = parseAIResponse(briefRaw) || {};
    // Si l'utilisateur a collé un texte long, on ne le répète pas dans les
    // étapes suivantes : on utilise l'angle dégagé par le directeur éditorial.
    const sujetCourt = estTexteLong
      ? (brief.angle_choisi || brief.analyse_strategique || tronquerSansCouperEmoji(sujet, 200))
      : sujet;

    // ════════════════════════════════════════════
    //  PHASE 2, LE RÉDACTEUR EN CHEF (écriture + auto-critique)
    //  Reçoit le brief stratégique, écrit le meilleur contenu,
    //  s'auto-critique et livre la version finale calibrée.
    // ════════════════════════════════════════════
    // Format optionnel ici (contrairement au mode Série) : par défaut, on
    // écrit pour un créateur qui se filme, le cas le plus courant.
    const estFaceless = /faceless|voix off|sans visage/i.test(format);

    const writePrompt = `Tu es le Rédacteur en Chef de Scriptura, capable de rivaliser avec les meilleurs créateurs à 500K+ abonnés. RÈGLE FONDAMENTALE, au-dessus de toutes les autres : ce script doit donner l'impression d'avoir été écrit par un excellent storyteller spécialisé TikTok, jamais par une IA généraliste. Tu reçois le brief stratégique du Directeur Éditorial. Tu dois maintenant EXÉCUTER ce brief avec une qualité exceptionnelle.
${rechercheWeb ? instructionRechercheWeb(niche, 'de rédiger') : ''}

BRIEF STRATÉGIQUE À SUIVRE :
- Analyse : ${brief.analyse_strategique || sujet}
- Angle choisi : ${brief.angle_choisi || 'angle percutant'}
- Structure : ${brief.structure || 'problème-solution'}
- Émotion dominante : ${brief.emotion_dominante || 'curiosité'}
- Direction du hook : ${brief.strategie_hook || 'accroche forte'}
- Stratégie de rétention : ${brief.strategie_retention || 'relances régulières'}
- Stratégie de CTA : ${brief.strategie_cta || 'appel à l\'action clair adapté à l\'objectif'}

CONTEXTE :
- Sujet : ${sujetCourt}
- Niche : ${niche}
- Plateforme : ${state.plateforme}
- Objectif : ${state.objectif}
${audience ? '- AUDIENCE CIBLE : ' + audience + ', écris en pensant précisément à ce public (vocabulaire, références, niveau de connaissance déjà supposé), pas à un public générique.' : ''}
- Format : ${format || 'non précisé, écris par défaut pour un créateur qui se filme (face caméra)'}
${selectedTone ? '- Ton : ' + selectedTone : ''}

RÈGLES ABSOLUES DE QUALITÉ (non négociables) :

1. RESPECT STRICT DE LA DURÉE (RÈGLE N°1 ABSOLUE, PEU IMPORTE LA LONGUEUR DU TEXTE SOURCE FOURNI PAR LE CRÉATEUR, MÊME UN ARTICLE OU UN DOCUMENT DE PLUSIEURS PAGES) : Le script doit faire EXACTEMENT entre ${wt.min} et ${wt.max} mots au TOTAL (pour ${wt.desc}), répartis en ${wt.blocs} blocs. Si le créateur a collé une matière longue, ton travail est de la RÉDUIRE à l'essentiel qui tient dans cette durée choisie, jamais de tout caser sous prétexte qu'il y a plus de matière disponible : la durée choisie prime toujours sur la richesse de la source.
   ⚠️ MÉTHODE OBLIGATOIRE : Avant de finaliser, COMPTE mot par mot le total de ton script. S'il fait moins de ${wt.min} mots, tu DOIS ajouter du contenu de valeur pour atteindre la cible. S'il dépasse ${wt.max}, tu DOIS couper. Ne rends JAMAIS un script hors de la fourchette ${wt.min}-${wt.max} mots.
   Un script de ${wt.desc} qui fait moins de ${wt.min} mots est un ÉCHEC TOTAL. Vise le milieu de la fourchette (environ ${Math.round((wt.min + wt.max) / 2)} mots).

2. CHAQUE PHRASE A UNE FONCTION : Interdiction absolue de phrase de remplissage. Chaque phrase doit soit accrocher, soit faire avancer, soit créer une tension, soit relancer. Si une phrase ne sert à rien, supprime-la.

3. UNE IMAGE MENTALE TOUTES LES 3 À 5 SECONDES (essentiel pour le storyboard qui sera généré ensuite à partir de ce texte) : écris comme si tu filmais mentalement chaque instant. Chaque phrase, ou petit groupe de phrases très courtes, doit porter UNE SEULE idée visuelle claire, concrète et filmable (une action, un lieu, un visage, un objet), jamais plusieurs idées mélangées dans une même phrase longue. Change d'image mentale environ toutes les 8 à 14 mots (~3 à 5 secondes à l'oral). Interdiction des phrases analytiques ou à tiroirs qui empilent plusieurs images en une seule construction : découpe-les en plusieurs phrases courtes, chacune avec sa propre image. Ce rythme sert la rétention ET permet un découpage storyboard précis, sans perte de sens.

4. TENSION DU DÉBUT À LA FIN : Applique la stratégie de rétention du brief. Place des relances ("mais attends...", "et c'est là que...", "sauf que...") pour que personne ne décroche.

5. ${estObjectifVues
  ? 'CHUTE EN BOUCLE (pas un CTA parlé) : ' + objectifInstructionScript + ' Ne force JAMAIS une phrase "partage/abonne-toi" parlée à la fin pour cet objectif, ça casse la boucle et mange du temps d\'antenne pour rien (voir le brief). TEST OBLIGATOIRE avant de valider : la dernière phrase reprend-elle vraiment un mot, une image ou l\'idée exacte de la toute première phrase, de façon à ce qu\'une relecture immédiate semble naturelle ? Si la chute n\'a aucun lien littéral avec l\'ouverture, réécris-la.'
  : 'CTA OBLIGATOIRE À LA FIN : Le DERNIER bloc du script DOIT contenir un appel à l\'action clair. Jamais un "abonne-toi" générique. ' + objectifInstructionScript + '\nLe CTA doit être naturel, percutant, et donner envie d\'agir MAINTENANT. C\'est la partie qui transforme une vue en résultat. Ne termine JAMAIS un script sans CTA. TEST OBLIGATOIRE avant de valider : la dernière phrase nomme-t-elle une action précise et exécutable (partage, commente, abonne-toi, va voir, dis-moi...) ? Une chute qui sonne bien ou une question rhétorique SANS consigne d\'action claire n\'est PAS un CTA, même si elle referme joliment le propos, réécris-la.'
}

6. HOOKS DIFFÉRENCIANTS ET TESTÉS : Génère 5 hooks qui suivent la direction du brief. Chaque hook tient en UNE respiration (viser 7 à 10 mots, jamais une phrase qu'on devrait couper pour reprendre son souffle à l'oral). Avant de valider CHAQUE hook, teste-le mentalement : est-il prévisible ? Correspond-il à une formule interdite (${GEN_HOOKS_CLICHES_INTERDITS}) ? Pourrait-il être prononcé par n'importe quel créateur sur n'importe quel sujet (trop générique si oui) ? Crée-t-il une vraie tension psychologique immédiate ? Ouvre-t-il une boucle de curiosité (une question implicite que le spectateur veut absolument voir résolue) ? Promet-il une révélation forte ? Un hook qui échoue à l'un de ces tests est REJETÉ, remplace-le avant de répondre. INTERDIT les formules génériques. Chaque hook doit être IMPOSSIBLE à confondre avec du ChatGPT basique.

7. ${plateformeInstructionScript}

8. ORIENTÉ OBJECTIF DU DÉBUT À LA FIN, PAS SEULEMENT LE CTA : ${objectifCorpsInstructionScript} Le brief stratégique ci-dessus a déjà dû en tenir compte pour l'angle, l'émotion et la structure, vérifie que ton texte le reflète vraiment, pas seulement le dernier bloc.

9. LE CHAMP "texte" NE CONTIENT JAMAIS DE MINUTAGE : le champ "temps" (ex: "0-3 sec") est SÉPARÉ et sert uniquement de repère visuel pour le créateur, ne le répète JAMAIS en tête ou dans le corps du champ "texte". Le champ "texte" est ce qu'une voix off va LIRE À VOIX HAUTE mot pour mot : il ne doit jamais commencer par "0-3 sec :", "(0 à 3 secondes)" ou toute variante numérique de minutage. Écris directement la phrase parlée.

FORMAT, RÈGLE ABSOLUE, écris VRAIMENT pour ce format (les deux ne se ressemblent JAMAIS) :

${estFaceless ? `>> FORMAT FACELESS (le créateur n'apparaît pas) :
Le "texte" de chaque bloc est la VOIX OFF (ce qu'on entend), jamais une adresse du type "regarde-moi" ou "je vais te montrer face caméra".
Le "visuel" de chaque bloc décrit précisément ce qui apparaît à l'écran pendant cette voix off (images, texte animé, plans d'illustration, archives), ET précise le TEXTE À L'ÉCRAN de ce bloc (2-6 mots maximum, le chiffre/mot clé de la phrase, jamais une retranscription complète de la voix off) : 30-40% des spectateurs regardent le son coupé, le texte à l'écran doit COMPLÉTER la voix off, pas la dupliquer mot pour mot (confirmé par les recommandations officielles TikTok). Change de visuel/texte à chaque bloc, jamais deux blocs consécutifs sur la même image fixe.
STRUCTURE QUI CARTONNE POUR CE FORMAT (recherche tendances TikTok 2026) : hook → contexte bref → valeurs/révélations livrées une par une, CHACUNE portée par son propre visuel/texte à l'écran (jamais une information sans support visuel dédié) → preuve ou exemple concret → payoff → chute/CTA. Le faceless excelle particulièrement sur le tutoriel/démonstration (1,4x plus de sauvegardes qu'un talking-head sur ce type de contenu, prouvé) et le storytelling factuel dense : privilégie la clarté et la densité d'info, c'est le MESSAGE qui porte la vidéo, pas un visage.` : `>> FORMAT FACE CAMÉRA (le créateur se filme et parle) :
Le "texte" de chaque bloc est PARLÉ à la première personne, comme si le créateur s'adressait directement à sa caméra, fluide et naturel, jamais de mention "VOIX OFF" ou "TEXTE À L'ÉCRAN" (ce sont des codes faceless, interdits ici).
Le "visuel" de chaque bloc dit COMMENT se filmer : cadrage (gros plan, plan poitrine), énergie et ton, où regarder, quel geste ou expression appuyer le propos, ET quand couper vers un plan de coupe (cutaway) : dès qu'une phrase mentionne un objet/lieu/chiffre concret ("montre-le"), le visuel doit dire par quoi le montrer (image, texte animé, capture) plutôt que de laisser un plan fixe sur le visage. Un plan fixe sans coupure ni zoom au-delà de 15-25 secondes fait décrocher, prévois une reformulation de cadrage ou un cutaway avant ce seuil.
STRUCTURE QUI CARTONNE POUR CE FORMAT (recherche tendances TikTok 2026) : hook (0-3s) → corps qui exploite la présence RÉELLE du créateur (vécu personnel, ton, regard caméra direct, émotion visible) → CTA/chute (5-10s finales). Le face caméra excelle particulièrement sur le témoignage vécu, l'avis assumé et la construction de confiance (le spectateur perçoit un créateur qui parle en présence directe comme un ami/une référence, pas juste un message) : privilégie le premier degré et l'anecdote incarnée plutôt qu'une liste neutre de faits, c'est la PRÉSENCE qui porte la vidéo.`}
${selectedTone ? `
TON, RÈGLE ABSOLUE, RESPECT STRICT ET EXCLUSIF : le créateur a choisi précisément ce ton : "${selectedTone}". Écris l'INTÉGRALITÉ du script dans CE ton, du hook à la chute, sans jamais dévier vers un autre registre, même partiellement, même une seule phrase. C'est une consigne explicite du créateur, pas une suggestion : la trahir est un échec, quelle que soit la qualité par ailleurs. Un ton satirique ne devient jamais sérieux ou émotionnel en cours de route ; un ton émotionnel ne bascule jamais dans l'ironie ou la moquerie ; un ton analytique ne devient jamais lyrique. Chaque phrase doit rester fidèle au ton choisi, pas seulement le hook ou l'intro.` : ''}

RÈGLES DE QUALITÉ À RESPECTER :
- Un simple prompt ChatGPT ne doit JAMAIS pouvoir reproduire ça. Sois nettement supérieur.
- Le hook doit vraiment arrêter le scroll.
- Le compte de mots doit être dans la cible ${wt.min}-${wt.max}.
- ${estObjectifVues ? 'Le dernier bloc DOIT boucler sur le hook (même mot/image/idée), jamais un CTA parlé du type "partage/abonne-toi" (voir consigne de chute ci-dessus).' : 'Le dernier bloc DOIT contenir un vrai CTA qui dit quoi faire.'}
- Chaque phrase a une fonction, aucun remplissage.
- Une seule image mentale par phrase, changement toutes les 3 à 5 secondes.
Écris ta MEILLEURE version. Chaque script doit être digne d'un créateur professionnel.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"analyse":"pourquoi ce sujet+angle peut exploser, en 2-3 phrases percutantes qui reprennent l'angle stratégique","hooks":[{"style":"Type de hook","texte":"le hook complet et percutant"}],"script":[{"temps":"0-3 sec","texte":"...","visuel":"${estFaceless ? "ce qu'on voit à l'écran" : "comment se filmer pour ce bloc"}"}],"legende":"${estObjectifVues ? 'légende prête à copier, PAS un CTA de partage fort ici non plus (voir le script qui boucle déjà) : une phrase courte qui donne envie de commenter ou de rester (ex. une question ouverte liée au sujet), engagement léger, jamais un ordre' : 'légende prête à copier avec CTA fort'}, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"]}

Génère exactement 5 hooks. Le script doit avoir ${wt.blocs} blocs et faire IMPÉRATIVEMENT entre ${wt.min} et ${wt.max} mots au total (vise ${Math.round((wt.min + wt.max) / 2)} mots). Compte tes mots avant de répondre. C'est la règle la plus importante.`;

    function scriptEstComplet(p) {
      return !!p && Array.isArray(p.script) && p.script.length > 0 && Array.isArray(p.hooks) && p.hooks.length > 0;
    }

    // Le brief (Directeur éditorial) vient de se terminer pour de vrai :
    // jalon réel pour le %, pas une estimation (voir GEN_POIDS/avancerEtapeGen).
    if (typeof avancerEtapeGen === 'function') avancerEtapeGen(2);
    // Étape en FLUX (voir onApercu, callAI) : le % avance en continu, réellement
    // proportionnel aux caractères déjà reçus du modèle, jamais à un minuteur.
    const onApercuEcriture = (buf) => {
      afficherApercuEnDirect(buf, 'script');
      if (genProgressCtl) genProgressCtl.etapeFluxProgres(2, fractionFlux(buf.length, 16000));
    };
    const writeRaw = await callAI(MODEL_CREATIF, 16000, writePrompt, undefined, rechercheWeb, undefined, undefined, undefined, onApercuEcriture, 'script');
    let parsed = parseAIResponse(writeRaw);
    // Réponse tronquée (rare, mais arrive) : une nouvelle tentative silencieuse
    // avant de déranger le créateur avec une erreur qu'il devrait relancer lui-même.
    // parsed peut être un objet "vrai" mais incomplet (ex: {score:{...}} sans script)
    // si la réparation JSON a dû tronquer avant la fin, on vérifie donc les champs
    // essentiels, pas juste la présence de l'objet.
    if (!scriptEstComplet(parsed)) {
      // Recherche web désactivée sur cette tentative de secours : si le 1er
      // essai a échoué (souvent une réponse tronquée par le temps limite), la
      // priorité passe à FINIR le script plutôt qu'à revérifier des faits,
      // la recherche web ajoute justement le temps qui a fait échouer le 1er essai.
      const writeRawRetry = await callAI(MODEL_CREATIF, 16000, writePrompt, undefined, false, undefined, undefined, undefined, onApercuEcriture, 'script');
      const parsedRetry = parseAIResponse(writeRawRetry);
      if (scriptEstComplet(parsedRetry)) parsed = parsedRetry;
    }
    if (!scriptEstComplet(parsed)) throw new Error('Réponse incomplète, réessaie, ce sera plus rapide');

    // ══════════════════════════════════════
    //  PHASES 3-4 (Critique + Réviseur), le cœur du renforcement qualité.
    //  Le Critique cherche ACTIVEMENT les faiblesses, y compris en essayant
    //  de RÉFUTER le script (pourquoi un spectateur scrollerait avant la
    //  fin ?). Si un problème significatif ressort, le Réviseur réécrit
    //  UNIQUEMENT les segments faibles identifiés, jamais tout le script,
    //  SAUF si le Critique juge le brouillon fondamentalement faible (voir
    //  critiqueIndiqueProblemeFondamental) : dans ce cas seulement, un
    //  second brouillon complet est retenté (filet de variance créative,
    //  qu'une révision segment par segment ne suffirait pas à corriger).
    //  Décidé par le Critique (indépendant), jamais par l'auto-évaluation du
    //  Rédacteur : avant ce correctif, un score honnête mais < 90 déclenchait
    //  déjà une réécriture complète, même pour un script déjà correct que le
    //  Critique/Réviseur, moins coûteux, aurait suffi à peaufiner.
    //  Bornée à 1 passe (voir MAX_PASSES_QUALITE) pour garder un temps de
    //  génération raisonnable : au-delà, on livre la meilleure version
    //  obtenue plutôt que de multiplier les allers-retours.
    // ══════════════════════════════════════
    let critique = null;
    if (CRITIQUE_ACTIVE) {
      // Un problème "significatif" déclenche une révision : verdict négatif,
      // script jugé générique/IA, une raison concrète de décrochage trouvée,
      // ou une moyenne de viralité en dessous du niveau d'exigence attendu.
      function critiqueIndiqueProbleme(c) {
        if (!c) return false;
        if (c.verdict === 'à améliorer') return true;
        if (c.ia_generique === true) return true;
        if (Array.isArray(c.raisons_de_scroll) && c.raisons_de_scroll.length > 0) return true;
        if (c.viralite && typeof c.viralite === 'object') {
          const vals = Object.values(c.viralite).filter(v => typeof v === 'number');
          if (vals.length && (vals.reduce((a, b) => a + b, 0) / vals.length) < 14) return true; // moyenne sur 20
        }
        return false;
      }
      // Sous-ensemble plus sévère : justifie un second brouillon COMPLET
      // plutôt qu'une révision ciblée (générique ET jugé "à améliorer" à la
      // fois, ou viralité nettement en dessous même du seuil de révision).
      function critiqueIndiqueProblemeFondamental(c) {
        if (!c) return false;
        if (c.verdict === 'à améliorer' && c.ia_generique === true) return true;
        if (c.viralite && typeof c.viralite === 'object') {
          const vals = Object.values(c.viralite).filter(v => typeof v === 'number');
          if (vals.length && (vals.reduce((a, b) => a + b, 0) / vals.length) < 11) return true; // moyenne sur 20
        }
        return false;
      }

      // Qualité maximale : jusqu'à 2 rondes de critique + révision. Le créateur
      // peut couper court à tout moment via « Répondre maintenant » (le drapeau
      // repondreMaintenant, vérifié en tête de boucle).
      const MAX_PASSES_QUALITE = 2;
      for (let passe = 0; passe < MAX_PASSES_QUALITE; passe++) {
        if (repondreMaintenant) break; // l'utilisateur a demandé son brouillon maintenant
        // ══════════════════════════════════════
        //  PHASE 3, LE CRITIQUE (agent indépendant)
        //  Juge le travail du rédacteur sans l'avoir écrit. Cherche
        //  volontairement les faiblesses plutôt que de valider par défaut.
        // ══════════════════════════════════════
        const scriptForReview = (parsed.script || []).map((s, i) => '[segment ' + i + ', ' + s.temps + '] ' + s.texte).join('\n');
        const hooksForReview = (parsed.hooks || []).map((h, i) => (i + 1) + '. ' + h.texte).join('\n');

        const critiquePrompt = `Tu es le Critique Éditorial de Scriptura, un directeur éditorial exigeant et INDÉPENDANT. Tu n'as PAS écrit ce script, ton rôle est de chercher VOLONTAIREMENT ses faiblesses, jamais de le valider par complaisance. RÈGLE FONDAMENTALE : un script de Scriptura ne doit jamais ressembler à ce que produirait une IA généraliste. Si c'est le cas ici, dis-le sans détour.

CONTEXTE :
- Sujet : ${sujetCourt}
- Plateforme : ${state.plateforme}
- Objectif : ${state.objectif}
${objectifCorpsInstructionScript}
- Durée cible : ${wt.desc} (${wt.min}-${wt.max} mots)
- Angle stratégique prévu : ${brief.angle_choisi || 'non précisé'}

HOOKS PROPOSÉS (numérotés) :
${hooksForReview}

SCRIPT PROPOSÉ (segments numérotés, ne change jamais leur numéro) :
${scriptForReview}

TON TRAVAIL, EN TROIS TEMPS :

1. DÉTECTION DES FAIBLESSES, cherche, segment par segment : phrases génériques, clichés, longueurs inutiles, répétitions, révélations arrivées trop tôt (qui tuent la tension), baisses de tension, passages oubliables, formulations qui "sentent l'IA" (transitions plates, généralités creuses, ton neutre de manuel). Vérifie aussi que l'angle, l'émotion et la structure servent vraiment l'objectif du créateur ci-dessus (pas seulement le CTA final) : si le corps du script pourrait être identique quel que soit l'objectif choisi, c'est une faiblesse à signaler. Pour chaque faiblesse, indique le numéro du segment concerné.
${objectifCritiqueScript ? `\n1bis. CONTRÔLE SPÉCIFIQUE À L'OBJECTIF "${state.objectif}" : ${objectifCritiqueScript} Toute réponse négative ou mitigée à ces questions est une faiblesse à signaler, au même titre que celles du point 1.\n` : ''}
2. RÉFUTATION, LE TEST LE PLUS IMPORTANT : essaie volontairement de RÉFUTER ce script. Cherche TOUTES les raisons concrètes pour lesquelles un spectateur ferait défiler la vidéo AVANT LA FIN (hook trop lent, promesse non tenue, passage à vide, prévisibilité, bloc trop long, perte d'intérêt...). Ne laisse la liste vide que si, après un examen sincère et sévère, tu n'as vraiment trouvé aucune raison valable.

3. CONTRÔLE DE VIRALITÉ ET ANTI-IA-GÉNÉRIQUE, note chacun de ces critères avec rigueur, sur 20 : force du hook, intensité de la curiosité créée, rythme narratif, progression dramatique, qualité des transitions, puissance de la révélation, mémorisation finale. Puis réponds honnêtement : ce script, tel quel, paraît-il avoir été écrit par une IA généraliste plutôt que par un storyteller TikTok spécialisé ?

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"verdict":"excellent" ou "à améliorer","note_globale":75,"faiblesses":["faiblesse précise avec le numéro de segment concerné"],"points_forts":["ce qui marche"],"segments_faibles":[{"index":2,"probleme":"description précise et actionnable du problème de ce segment"}],"raisons_de_scroll":["raison concrète 1","raison concrète 2"],"ia_generique":true,"justification_ia_generique":"pourquoi, en une phrase (chaîne vide si non générique)","viralite":{"hook":15,"curiosite":14,"rythme":16,"progression":15,"transitions":14,"revelation":13,"memorisation":15},"instructions_revision":"instructions précises et actionnables pour le réviseur, segment par segment"}`;

        if (typeof avancerEtapeGen === 'function') avancerEtapeGen(3);
        let nouvelleCritique = null;
        try {
          const critiqueRaw = await callAI(MODEL_RAPIDE, 2500, critiquePrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'script');
          nouvelleCritique = parseAIResponse(critiqueRaw);
        } catch(e) { /* si le critique échoue (même après réessais), on garde la meilleure version obtenue */ }

        if (!nouvelleCritique) break; // échec technique : on s'arrête là plutôt que de perdre du temps
        critique = nouvelleCritique;

        if (!critiqueIndiqueProbleme(critique)) break; // le script passe le contrôle qualité : terminé

        if (!repondreMaintenant && passe === 0 && critiqueIndiqueProblemeFondamental(critique)) {
          // ── SECOND BROUILLON COMPLET ──
          // Le Critique (indépendant) juge le premier brouillon fondamentalement
          // faible (générique ET jugé "à améliorer", ou viralité très basse) :
          // une révision segment par segment ne suffirait pas, on retente une
          // écriture complète plutôt que de rafistoler.
          try {
            const writeRaw2 = await callAI(MODEL_CREATIF, 16000, writePrompt, undefined, rechercheWeb, undefined, undefined, undefined, onApercuEcriture, 'script');
            const parsed2 = parseAIResponse(writeRaw2);
            if (scriptEstComplet(parsed2)) {
              parsed = parsed2;
              continue; // relance une passe de critique sur ce nouveau brouillon
            }
          } catch(e) { /* si le second brouillon échoue, on continue avec la révision ciblée */ }
        }

        // ══════════════════════════════════════
        //  PHASE 4, LE RÉVISEUR (agent indépendant)
        //  Réécrit UNIQUEMENT les segments identifiés comme faibles,
        //  jamais le script entier, pour ne jamais perdre ce qui marche.
        // ══════════════════════════════════════
        const segmentsFaiblesTxt = (critique.segments_faibles || [])
          .map(sf => '- Segment ' + sf.index + ' : ' + sf.probleme).join('\n')
          || (critique.faiblesses || []).map(f => '- ' + f).join('\n')
          || 'Aucun segment précis signalé, applique les instructions générales ci-dessous à l\'ensemble.';
        const raisonsScrollTxt = (critique.raisons_de_scroll || []).map(r => '- ' + r).join('\n');

        const revisePrompt = `Tu es le Réviseur en Chef de Scriptura, expert en réécriture CIBLÉE de contenu viral. Un critique indépendant a évalué le script ci-dessous. RÈGLE ABSOLUE : ne réécris QUE les segments identifiés comme faibles. Conserve TOUS les autres segments EXACTEMENT tels quels (même texte, même timing, même visuel), ce sont les points forts du script, ne les abîme pas.

SUJET : ${sujetCourt} | PLATEFORME : ${state.plateforme} | OBJECTIF : ${state.objectif}
${objectifCorpsInstructionScript}
DURÉE CIBLE : ${wt.desc} (${wt.min}-${wt.max} mots au total)

SCRIPT ACTUEL (segments numérotés) :
${scriptForReview}

SEGMENTS À RÉÉCRIRE (uniquement ceux-ci) :
${segmentsFaiblesTxt}

${raisonsScrollTxt ? 'RAISONS POUR LESQUELLES UN SPECTATEUR DÉCROCHERAIT, À ÉLIMINER :\n' + raisonsScrollTxt + '\n' : ''}${critique.ia_generique ? 'ATTENTION : ce script a été jugé trop générique, proche d\'une IA généraliste (' + (critique.justification_ia_generique || '') + '). Les segments réécrits doivent avoir une voix beaucoup plus spécifique et incarnée, jamais neutre.\n' : ''}${critique.instructions_revision ? 'INSTRUCTIONS SUPPLÉMENTAIRES DU CRITIQUE :\n' + critique.instructions_revision : ''}

RÈGLES :
- Ne touche JAMAIS un segment qui n'est pas listé ci-dessus comme à réécrire.
- Renvoie la liste COMPLÈTE des segments (les inchangés recopiés à l'identique, les faibles réécrits), dans le même ordre, avec le même nombre total de segments.
- Respecte la durée cible ${wt.min}-${wt.max} mots au total et ${wt.blocs} blocs.
- Le hook doit arrêter le scroll, la tension tenir jusqu'au bout, ${estObjectifVues ? 'la chute doit boucler sur le hook (même mot/image/idée), jamais un CTA parlé de partage.' : 'le CTA final être présent et clair.'}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hooks":[{"style":"...","texte":"..."}],"script":[{"temps":"0-3 sec","texte":"...","visuel":"..."}]}

Fournis les 5 hooks (réécris-les aussi si le critique a signalé un problème de hook, sinon garde les meilleurs) et le script complet, segment par segment, dans le même ordre.`;

        if (typeof avancerEtapeGen === 'function') avancerEtapeGen(4);
        try {
          const reviseRaw = await callAI(MODEL_CREATIF, 8000, revisePrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'script');
          const revised = parseAIResponse(reviseRaw);
          if (revised && revised.script) {
            parsed.script = revised.script;
            if (revised.hooks) parsed.hooks = revised.hooks;
          } else {
            break; // réponse illisible : on garde la meilleure version obtenue plutôt que de la perdre
          }
        } catch(e) { break; /* si la révision échoue (même après réessais), on garde la version précédente */ }
      }
    }

    // ══════════════════════════════════════
    //  CONTRÔLE DU NOMBRE DE HOOKS
    //  "Génère exactement 5 hooks" n'est pas toujours respecté (nature
    //  probabiliste de l'IA) : un script livré avec 1 seul hook au lieu de
    //  5 est un vrai manque, pas une nuance de qualité. On complète
    //  mécaniquement plutôt que de laisser le créateur avec un seul choix.
    // ══════════════════════════════════════
    if (!Array.isArray(parsed.hooks)) parsed.hooks = [];
    if (!repondreMaintenant && parsed.hooks.length < 5) {
      try {
        const hooksExistantsTxt = parsed.hooks.length
          ? parsed.hooks.map((h, i) => (i + 1) + '. [' + (h.style || '') + '] ' + h.texte).join('\n')
          : 'aucun';
        const nbManquants = 5 - parsed.hooks.length;
        const completHooksPrompt = `Tu es le Rédacteur en Chef de Scriptura. Ce script a déjà ${parsed.hooks.length} hook(s) sur les 5 exigés. Génère les ${nbManquants} hook(s) manquant(s), qui arrêtent vraiment le scroll, mais RADICALEMENT différents des hooks déjà existants, jamais une reformulation proche, jamais une formule générique type ChatGPT, et surtout jamais une des formules interdites (${GEN_HOOKS_CLICHES_INTERDITS}).

SUJET : ${sujetCourt} | PLATEFORME : ${state.plateforme} | OBJECTIF : ${state.objectif}

HOOKS DÉJÀ EXISTANTS (ne les répète JAMAIS, ni ne t'en approche) :
${hooksExistantsTxt}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après, avec EXACTEMENT ${nbManquants} nouveau(x) hook(s) :
{"hooks":[{"style":"Type de hook","texte":"le hook complet"}]}`;
        const completHooksRaw = await callAI(MODEL_RAPIDE, 1200, completHooksPrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'script');
        const completHooks = parseAIResponse(completHooksRaw);
        if (completHooks && Array.isArray(completHooks.hooks) && completHooks.hooks.length) {
          parsed.hooks = parsed.hooks.concat(completHooks.hooks.slice(0, nbManquants));
        }
      } catch (e) { /* on garde les hooks déjà obtenus si la complétion échoue */ }
    }

    // Qualité (critique/révision) ET complétion des hooks terminées pour de
    // vrai, quel que soit le nombre de passes réellement effectuées : jalon
    // réel avant le dernier contrôle (voir GEN_POIDS/avancerEtapeGen).
    if (typeof avancerEtapeGen === 'function') avancerEtapeGen(5);

    // ══════════════════════════════════════
    //  CONTRÔLE QUALITÉ STRICT DE LA DURÉE
    //  Compte les mots réels. Si hors cible, régénère avec correction.
    // ══════════════════════════════════════
    function countScriptWords(script) {
      if (!script || !Array.isArray(script)) return 0;
      return script.map(s => (s.texte || '')).join(' ').split(/\s+/).filter(Boolean).length;
    }

    let wordCount = countScriptWords(parsed.script);
    let correctionAttempts = 0;

    // Tolérance : on accepte une petite marge (10%) mais on corrige si vraiment hors cible
    const hardMin = Math.round(wt.min * 0.9);
    const hardMax = Math.round(wt.max * 1.1);

    while ((wordCount < hardMin || wordCount > hardMax) && correctionAttempts < 2 && !repondreMaintenant) {
      correctionAttempts++;
      const tooShort = wordCount < hardMin;
      const correctionPrompt = `Tu es le Rédacteur en Chef de Scriptura. Le script suivant ne respecte PAS la durée demandée et doit être corrigé.

SCRIPT ACTUEL (${wordCount} mots) :
${(parsed.script || []).map(s => '[' + s.temps + '] ' + s.texte).join('\n')}

PROBLÈME : Ce script fait ${wordCount} mots. La cible pour ${wt.desc} est ${wt.min} à ${wt.max} mots.
${tooShort ? 'Le script est TROP COURT. Tu dois l\'ALLONGER pour atteindre ' + wt.min + '-' + wt.max + ' mots. Ajoute du contenu de valeur, développe les idées, ajoute des détails percutants, SANS remplissage inutile. Garde le même sujet, le même angle, le même ton.' : 'Le script est TROP LONG. Tu dois le RACCOURCIR pour tomber à ' + wt.min + '-' + wt.max + ' mots. Coupe le superflu, condense, garde uniquement l\'essentiel percutant.'}

RÈGLES :
- Le nouveau script DOIT faire entre ${wt.min} et ${wt.max} mots au total. Compte tes mots avant de répondre.
- Garde ${wt.blocs} blocs, un hook fort au début, ${estObjectifVues ? 'une chute qui boucle sur le hook à la fin (pas de CTA parlé)' : 'un CTA clair à la fin'}
- Chaque phrase garde une fonction, zéro remplissage
- Contexte : ${state.plateforme}, objectif ${state.objectif}, sujet : ${sujetCourt}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"script":[{"temps":"0-3 sec","texte":"...","visuel":"..."}]}`;

      let correctedScript = null;
      try {
        const correctRaw = await callAI(MODEL_CREATIF, 8000, correctionPrompt, undefined, undefined, undefined, undefined, undefined, undefined, 'script');
        correctedScript = parseAIResponse(correctRaw);
      } catch(e) { break; /* en cas d'erreur (même après réessais), on garde la version actuelle */ }

      if (correctedScript && correctedScript.script) {
        parsed.script = correctedScript.script;
        wordCount = countScriptWords(parsed.script);
      } else {
        break; // parsing échoué, on garde la version actuelle
      }
    }

    // Score déterministe (voir scorerScriptGenere plus haut) : calculé ICI à
    // partir de signaux, jamais d'un chiffre choisi par l'IA. deuxieme_personne/
    // rythme_soutenu sont détectés directement en CODE (aucune IA, voir
    // _genDetecterDeuxiemePersonne/_genDetecterRythmeSoutenu), les 8 autres
    // viennent d'un 2e appel IA INDÉPENDANT et exigeant une citation
    // vérifiée (voir evaluerScriptGenere) : jamais le même appel qui vient
    // d'écrire le script qui se note lui-même (biais d'auto-complaisance).
    // wordCount est déjà le compte FINAL (après l'éventuelle correction de
    // durée ci-dessus).
    const texteFinalScript = (parsed.script || []).map(s => (s && s.texte) || '').join(' ');
    const signauxIA = repondreMaintenant ? null : await evaluerScriptGenere(texteFinalScript);
    const signauxFinal = Object.assign(
      {
        deuxieme_personne: _genDetecterDeuxiemePersonne(texteFinalScript),
        rythme_soutenu: _genDetecterRythmeSoutenu(texteFinalScript)
      },
      signauxIA || {}
    );
    parsed.score = scorerScriptGenere(signauxFinal, wordCount, wt);

    // Incrémenter le compteur si pas débloqué
    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen); // met à jour le serveur (empreinte + IP)
      renderGenCounter();
      checkRappelAbonnement();
    }

    // Sauvegarder le contexte pour l'ajustement du script
    lastGenContext = { objectif: state.objectif, plateforme: state.plateforme, niche, sujet, audience, format, tone: selectedTone, duree: selectedDuree, brief: brief, critique: critique };
    currentScript = parsed.script;
    currentHooks = parsed.hooks;

    // Ce script vient bien de la recommandation d'accueil : elle est
    // désormais suivie d'effet, donc potentiellement obsolète.
    if (depuisRecommandation && typeof viderRecoCache === 'function') viderRecoCache();

    renderResults(parsed, niche, sujet);
    setTimeout(updateScrollBtn, 300);
    // Sauvegarder la génération complète + le contexte (pour rouvrir et générer le storyboard plus tard)
    saveGeneration('script', sujet, Object.assign({}, parsed, { niche: niche, context: { sujet: sujet, plateforme: state.plateforme, objectif: state.objectif } }));
    updateQuotaJour();

    // Mémoire du créateur : la génération vient de réussir, on affine le
    // profil avec ce qu'on vient d'apprendre (tâche de fond, silencieuse).
    mettreAJourProfilCreateur({
      declare: {
        niche_principale: niche,
        style_contenu: format || undefined,
        ton_prefere: toneCourtDepuisSelect('tone'),
        duree_moyenne: selectedDuree,
        objectifs: state.objectif
      },
      observe: {
        themes_traites: tronquerSansCouperEmoji(sujet, 80),
        plateformes: state.plateforme,
        // Anti-répétition (voir renforcement du pipeline) : mémorise l'angle,
        // la structure et le hook principal pour ne jamais les recycler
        // à l'identique lors d'une prochaine génération pour ce créateur.
        angles_recents: brief && brief.angle_choisi ? tronquerSansCouperEmoji(String(brief.angle_choisi), 120) : undefined,
        structures_recentes: brief && brief.structure ? tronquerSansCouperEmoji(String(brief.structure), 100) : undefined,
        hooks_recents: (parsed.hooks && parsed.hooks[0] && parsed.hooks[0].texte) ? tronquerSansCouperEmoji(String(parsed.hooks[0].texte), 140) : undefined
      }
    });

  } catch(e) {
    errorBox.textContent = 'Erreur : ' + e.message;
    errorBox.style.display = 'block';
    // Bug corrigé (retour terrain, audit du 2 septembre 2026) : lors d'une
    // RÉGÉNÉRATION, #results est déjà masqué en tête de fonction et errorBox
    // (dans #step3) n'est plus "active" à cet instant (l'écran résultat a
    // pris le relais) : l'utilisateur se retrouvait devant un écran
    // totalement vide, sans message ni bouton retour visible. On réaffiche
    // le résultat précédent (encore dans le DOM, juste masqué) et on
    // signale l'échec par le toast déjà utilisé pour le feedback de
    // régénération (voir toastRegen plus bas), visible quel que soit
    // l'écran affiché.
    const resultsEl = document.getElementById('results');
    if (resultsEl && resultsEl.style.display === 'none') {
      resultsEl.style.display = '';
      toastRegen('Erreur pendant la régénération : ' + e.message);
    }
  } finally {
    setLoading(false);
  }
}

// Régénère un contenu. Les REGEN_GRATUITES premières fois sont gratuites (ne comptent pas au quota).
// Petit message flottant temporaire (feedback régénération)
function toastRegen(message) {
  let t = document.getElementById('regenToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'regenToast';
    t.className = 'regen-toast';
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

async function regenererContenu(type) {
  const gratuite = regenEstGratuite(type);
  _regenGratuiteEnCours = gratuite;

  // Petit message informatif
  const restantes = REGEN_GRATUITES - regenCount[type];
  if (gratuite) {
    if (restantes > 0) {
      toastRegen('Régénération gratuite · ' + restantes + ' restante' + (restantes > 1 ? 's' : ''));
    } else {
      toastRegen('Dernière régénération gratuite · la prochaine comptera');
    }
  } else {
    toastRegen('Cette régénération compte dans ton quota');
  }

  try {
    if (type === 'script') {
      await generate();
    } else if (type === 'story') {
      await generateStory();
    } else if (type === 'storyboardIdee') {
      await generateStoryboard();
    } else if (type === 'storyboardStory') {
      await generateStoryStoryboard();
    } else if (type === 'storyboardSeul') {
      await generateStoryboardSeul();
    }
  } finally {
    _regenGratuiteEnCours = false;
  }
}

let genInterval = null;
let genProgressCtl = null;
// Mode actuellement affiché par l'overlay (voir startGenAnimation), retenu
// pour qu'avancerEtapeGen sache quel barème de poids appliquer.
let genModeActuel = null;
// Durée estimée (ms) de chaque type de génération, pour calibrer la montée
// de la barre vers 90% : repli utilisé UNIQUEMENT pour les modes absents de
// GEN_POIDS ci-dessous (pas encore convertis à la progression réelle).
const GEN_DUREE = {
  script: 78000,
  story: 66000,
  ideas: 12000,
  audit: 18000,
  serie_creation: 30000,
  serie_episode: 30000,
  viral: 42000,
  montageGuide: 20000
};
// Poids RÉELS de chaque étape d'un mode (voir creerProgressionReelle,
// js/storyboard.js) : le max_tokens de l'appel qui compose l'étape (le
// meilleur repère disponible de son coût réel), pas une durée devinée à la
// main. Un mode absent de cette table retombe sur GEN_DUREE (estimation de
// temps classique, comportement inchangé) : conversion volontairement
// progressive, mode par mode, plutôt qu'un grand changement d'un coup.
const GEN_POIDS = {
  // Un seul appel, sans sous-phase réelle : le flux (voir onApercu ci-dessous)
  // est activé UNIQUEMENT pour calibrer le %, sans afficher le JSON brut à
  // l'écran (contrairement à Script/Récit, cette réponse n'est pas un texte
  // à lire directement).
  ideas: [6000],
  // Bible/concept de série (js/serie.js, creerSerie) : un seul appel, même
  // principe que ideas ci-dessus.
  serie_creation: [2500],
  // Épisode de série (js/serie.js, genererEpisode) : écriture EN FLUX(3000)
  // + contrôle de durée, jusqu'à 2 tentatives(2500).
  serie_episode: [3000, 2500],
  // Indices alignés EXACTEMENT sur GEN_STEPS.script (7 étapes, ci-dessous) :
  // 0-1=brief, un seul appel(2000, réparti sur les 2 premières étapes
  // textuelles faute de signal séparé), 2=écriture[FLUX RÉEL](16000),
  // 3=critique(2500), 4=révision ciblée(8000), 5=hooks manquants + contrôle
  // de durée, jusqu'à 2 tentatives(8000), 6=finalisation(pas d'appel).
  script: [1, 1, 16, 2.5, 8, 8, 1],
  // Indices alignés sur GEN_STEPS.story et avancerEtapeGen (voir
  // js/storytelling.js) : 0=choix du modèle(pas d'appel), 1=écriture
  // [FLUX RÉEL](16000), 2=critique(2500), 3=révision ciblée(8000),
  // 4=calibrage de durée(8000), 5=hook et ouverture(1200), 6=anti-plagiat
  // et clôture(2000).
  story: [0.5, 16, 2.5, 8, 8, 1.2, 2]
};

// ── « RÉPONDRE MAINTENANT » : interruption coopérative ──
// Drapeau partagé (script + récit). Quand l'utilisateur appuie sur le bouton
// pendant l'attente, on le passe à true ; le pipeline le vérifie entre chaque
// phase et, s'il est levé, livre le brouillon en cours SANS les étapes de
// perfectionnement restantes. Il ne peut pas interrompre l'appel déjà en vol
// (le premier brouillon est incompressible), seulement sauter la suite.
let repondreMaintenant = false;
// Modes où le bouton d'échappement a un sens (pipelines à plusieurs passes).
const MODES_REPONSE_IMMEDIATE = ['script', 'story'];

function demanderReponseImmediate() {
  repondreMaintenant = true;
  const btn = document.getElementById('genSkipBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scriptura termine ton brouillon…';
  }
}

function setLoading(on) {
  const btn = document.getElementById('generateBtn');
  btn.disabled = on;
  document.getElementById('spinner').style.display = on ? 'block' : 'none';
  document.getElementById('btnText').textContent = on ? 'Scriptura génère ton contenu…' : 'Générer mon contenu Scriptura';

  if (on) {
    startGenAnimation('script');
  } else {
    stopGenAnimation();
  }
}

// Jeux d'étapes selon le mode
const GEN_STEPS = {
  script: [
    'Le Directeur analyse le sujet…',
    'Exploration de 3 angles narratifs…',
    'Le Rédacteur écrit le script…',
    'Le Critique évalue le travail…',
    'Le Réviseur applique les corrections…',
    'Contrôle de la durée…',
    'Finalisation…'
  ],
  ideas: [
    'Analyse de ta niche et ton audience…',
    'Exploration des angles à fort potentiel…',
    'Recherche de sujets méconnus…',
    'Sélection des idées les plus virales…'
  ],
  // Étapes RÉELLES du moteur récit (voir generateStory, js/storytelling.js) :
  // elles ne défilent pas sur un minuteur aveugle mais avancent au vrai
  // moment où chaque phase serveur démarre (via avancerEtapeGen), pour que
  // ce que voit le créateur corresponde à ce qui se passe vraiment. L'ordre
  // et le nombre suivent exactement les phases pilotées dans generateStory.
  story: [
    'Choix du modèle narratif de référence…',
    'Écriture de ton récit…',
    'Relecture par le critique éditorial…',
    'Corrections ciblées du récit…',
    'Calibrage de la durée…',
    'Hook et ouverture au cordeau…',
    'Contrôle anti-plagiat et finition…'
  ],
  audit: [
    'Lecture des captures…',
    'Extraction des statistiques…',
    'Analyse de la vue d\'ensemble…',
    'Comparaison des meilleures et pires vidéos…',
    'Analyse de l\'audience…',
    'Calcul de l\'ADN TikTok Score…',
    'Rédaction du plan d\'action…'
  ],
  serie_creation: [
    'Lecture du concept…',
    'Définition de la prémisse…',
    "Construction de l'univers et du ton…",
    'Choix de la règle récurrente…',
    "Répartition de l'arc narratif…",
    "Attribution d'une fonction à chaque épisode…",
    'Finalisation de la bible…'
  ],
  serie_episode: [
    'Relecture de la bible de la série…',
    'Vérification des épisodes déjà publiés…',
    'Cadrage de la fonction narrative…',
    "Écriture de l'accroche…",
    'Développement du récit…',
    'Pose de la tension finale…',
    'Calibrage de la durée…'
  ],
  viral: [
    'Récupération de la vidéo…',
    'Extraction de la voix…',
    'Transcription de la parole…',
    'Décodage du hook…',
    'Reconstitution de la recette, temps par temps…',
    'Repérage des leviers viraux…',
    'Calcul du score de viralité…'
  ],
  montageGuide: [
    'Lecture du storyboard…',
    'Analyse du ton et du rythme…',
    'Choix des transitions et effets…',
    'Calage des durées de chaque plan…',
    'Direction musique et sous-titres…',
    'Rédaction du guide CapCut…'
  ]
};
const GEN_TAGLINE = {
  script: 'Ton équipe éditoriale IA au travail',
  ideas: 'Ton directeur éditorial cherche tes idées',
  story: 'Ton storyteller écrit ton récit',
  audit: 'Ton consultant TikTok établit ton diagnostic',
  serie_creation: 'Ton architecte narratif construit ta série',
  serie_episode: 'Ton scénariste écrit ton épisode',
  viral: 'Scriptura décode la recette virale',
  montageGuide: 'Ton monteur prépare ton CapCut'
};

function startGenAnimation(mode) {
  mode = mode || 'script';
  const overlay = document.getElementById('genOverlay');
  const stepsContainer = document.getElementById('genSteps');
  const tagline = document.querySelector('.gen-tagline');

  // Reconstruire les étapes selon le mode
  const stepTexts = GEN_STEPS[mode] || GEN_STEPS.script;
  stepsContainer.innerHTML = stepTexts.map((txt, i) =>
    `<div class="gen-step" data-step="${i}"><div class="gen-step-icon">${i+1}</div><div class="gen-step-text">${txt}</div></div>`
  ).join('');

  // Adapter le tagline
  if (tagline) tagline.textContent = GEN_TAGLINE[mode] || GEN_TAGLINE.script;

  // Aperçu en direct (voir afficherApercuEnDirect) : vide et masqué tant que
  // rien n'est encore arrivé, une nouvelle génération ne doit jamais montrer
  // le texte de la précédente.
  const apercu = document.getElementById('genLivePreview');
  if (apercu) { apercu.innerHTML = ''; apercu.style.display = 'none'; }

  const steps = stepsContainer.querySelectorAll('.gen-step');
  overlay.classList.add('active');

  steps.forEach(s => s.classList.remove('active', 'done'));

  let current = 0;
  const total = steps.length;
  steps[0].classList.add('active');

  // Barre de progression : saute à 100% pile quand le résultat est prêt
  // (voir stopGenAnimation). Le % s'affiche pour TOUS les modes (voir
  // css/style.css, .sb-progress-bar affiche fill/pct par défaut désormais).
  // Pour les modes présents dans GEN_POIDS (voir plus haut), ce % reflète
  // le VRAI travail (jalons réels + flux de caractères reçus,
  // creerProgressionReelle, js/storyboard.js) ; les autres modes gardent
  // l'estimation de temps classique (createProgress) le temps d'être
  // convertis à leur tour.
  const fill = document.getElementById('genProgressFill');
  const pctEl = document.getElementById('genProgressPct');
  if (genProgressCtl) genProgressCtl.stop();
  genModeActuel = mode;
  const setPct = (p) => { if (fill) fill.style.width = p + '%'; if (pctEl) pctEl.textContent = p + '%'; };
  genProgressCtl = GEN_POIDS[mode]
    ? creerProgressionReelle(setPct, GEN_POIDS[mode], GEN_DUREE[mode])
    : createProgress(setPct, GEN_DUREE[mode] || 45000);
  genProgressCtl.start();

  // « Répondre maintenant » : nouveau départ = drapeau baissé. Le bouton
  // n'apparaît que sur les modes à plusieurs passes (script, récit).
  repondreMaintenant = false;
  const skipBtn = document.getElementById('genSkipBtn');
  const skipNote = document.getElementById('genSkipNote');
  const avecSkip = MODES_REPONSE_IMMEDIATE.indexOf(mode) !== -1;
  if (skipBtn) {
    skipBtn.disabled = false;
    skipBtn.textContent = 'Répondre maintenant';
    skipBtn.style.display = avecSkip ? 'inline-block' : 'none';
  }
  if (skipNote) skipNote.style.display = avecSkip ? 'block' : 'none';

  // Défilement des étapes textuelles (indépendant de la barre).
  // Mode récit : PAS de minuteur aveugle. Les étapes sont pilotées par les
  // vraies phases du moteur (generateStory appelle avancerEtapeGen à chaque
  // phase serveur). La barre de progression continue de bouger toute seule,
  // donc une étape qui reste affichée pendant une phase longue (l'écriture
  // dure vraiment ~30 s) est honnête, pas figée. Les autres modes gardent
  // le défilement estimé sur minuteur.
  if (mode === 'story') {
    genInterval = null;
  } else {
    genInterval = setInterval(() => {
      if (current < total - 1) {
        steps[current].classList.remove('active');
        steps[current].classList.add('done');
        current++;
        steps[current].classList.add('active');
      }
    }, 3200);
  }
}

// Avance l'étape ACTIVE de l'overlay de génération jusqu'à AU MOINS `cible`
// (index 0-based), de façon monotone : ne revient jamais en arrière, ne
// dépasse jamais la dernière étape. Utilisé par les modes qui connaissent
// leurs vraies phases serveur (récit) pour refléter l'état réel plutôt qu'un
// minuteur. Sans effet si l'overlay n'est pas monté (appel défensif).
function avancerEtapeGen(cible) {
  const stepsContainer = document.getElementById('genSteps');
  if (!stepsContainer) return;
  const steps = stepsContainer.querySelectorAll('.gen-step');
  if (!steps.length) return;
  const max = steps.length - 1;
  const cibleClamp = Math.max(0, Math.min(cible | 0, max));
  let courant = 0;
  steps.forEach((s, i) => { if (s.classList.contains('active')) courant = i; });
  if (cibleClamp <= courant) return; // jamais en arrière
  for (let i = courant; i < cibleClamp; i++) {
    steps[i].classList.remove('active');
    steps[i].classList.add('done');
  }
  steps[cibleClamp].classList.remove('done');
  steps[cibleClamp].classList.add('active');
  // Même signal réel pour le %, pas seulement le texte des étapes : voir
  // GEN_POIDS/creerProgressionReelle plus haut. Un mode absent de GEN_POIDS
  // utilise createProgress, dont etapeTerminee est un no-op, sans effet.
  if (genProgressCtl) genProgressCtl.etapeTerminee(cibleClamp - 1);
}

function stopGenAnimation() {
  const overlay = document.getElementById('genOverlay');
  const steps = document.querySelectorAll('.gen-step');

  if (genInterval) { clearInterval(genInterval); genInterval = null; }

  // Masquer le bouton « Répondre maintenant » dès que le résultat arrive.
  const skipBtn = document.getElementById('genSkipBtn');
  const skipNote = document.getElementById('genSkipNote');
  if (skipBtn) skipBtn.style.display = 'none';
  if (skipNote) skipNote.style.display = 'none';

  // La barre saute à 100% (résultat prêt), puis on ferme l'overlay.
  if (genProgressCtl) genProgressCtl.finish();

  // Compléter toutes les étapes
  steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });

  setTimeout(() => {
    overlay.classList.remove('active');
    if (genProgressCtl) { genProgressCtl.stop(); genProgressCtl = null; }
  }, 400);
}

// ── RENDER ──
function metricBar(label, value) {
  return `
    <div class="metric">
      <div class="metric-top">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}/100</span>
      </div>
      <div class="metric-bar">
        <div class="metric-fill" data-width="${value}" style="width:0%"></div>
      </div>
    </div>`;
}

// Plafond de micro-éditions par passage (Reformuler/Raccourcir/Allonger/
// Simplifier, voir microEditerBlocScript) pour UN script affiché : gratuit,
// hors quota de génération (juste un confort d'édition, pas une nouvelle
// génération, comme chez Vervox), mais un plafond simple évite l'abus
// évident sans construire un nouveau système de quota. Remis à zéro à
// chaque nouveau script affiché (voir renderResults ci-dessous).
const MICRO_EDIT_MAX_PAR_SCRIPT = 20;
let _microEditsUtilises = 0;

function renderResults(d, niche, sujet) {
  const list = document.getElementById('outputList');
  const section = document.getElementById('results');
  document.getElementById('resultsMeta').textContent = niche + ' · ' + state.plateforme;
  _microEditsUtilises = 0;

  // Réinitialiser le storyboard (bouton + description visibles, barre de
  // progression masquée, conteneur vide) pour une nouvelle génération.
  const sbBtn = document.getElementById('sbGenerateBtn');
  if (sbBtn) sbBtn.style.display = '';
  const sbDescP = document.getElementById('sbDescP');
  if (sbDescP) sbDescP.style.display = '';
  const sbProgBar1 = document.getElementById('sbProgBar1');
  if (sbProgBar1) sbProgBar1.style.display = 'none';
  const sbCont = document.getElementById('storyboardContainer');
  if (sbCont) sbCont.innerHTML = '';

  // Aucune étape (1, 2 ou 3) n'a sa place une fois le résultat affiché, seul
  // le bouton "✎ Modifier" (voir modifierCriteresScript) fait réapparaître
  // l'étape 3. Purement des classes CSS (voir showStep) : rien à restaurer
  // explicitement, showStep(3) les rétablit normalement. On nettoie les 3,
  // pas seulement l'étape 3 : reopenGeneration (js/historique.js, réouverture
  // d'un script depuis l'historique) appelle renderResults() directement sans
  // jamais passer par showStep(), l'étape 1 gardait alors sa classe "active"
  // par défaut du HTML si l'utilisateur n'était jamais passé par le flux en
  // direct dans cette session, laissant ses 4 choix visibles au-dessus du résultat.
  document.querySelectorAll('#flow .step').forEach(s => s.classList.remove('active'));

  list.innerHTML = '';

  // ── SCRIPTURA SCORE ──
  if (d.score) {
    const s = d.score;
    const globalScore = Math.round((s.viral + s.hook + s.engagement + s.emotion) / 4);
    const scoreHTML = `
      <div class="score-card sb-appear">
        <div class="score-header">
          <div class="score-title">◆ Scriptura Score</div>
          <div class="score-global">
            <span class="score-global-num">${globalScore}</span>
            <span class="score-global-max">/ 100</span>
          </div>
        </div>
        <div class="score-metrics">
          ${metricBar('Potentiel viral', s.viral)}
          ${metricBar('Puissance du hook', s.hook)}
          ${metricBar('Engagement', s.engagement)}
          ${metricBar('Force émotionnelle', s.emotion)}
          ${metricBar('Rétention estimée', s.retention)}
        </div>
        
      </div>`;
    list.innerHTML = scoreHTML;
    // Animer les barres après affichage
    setTimeout(() => {
      document.querySelectorAll('.metric-fill').forEach(bar => {
        bar.style.width = bar.dataset.width + '%';
      });
    }, 100);
  }

  const sections = [
    {
      titre: "La stratégie de Scriptura",
      num: "01",
      content: `<div class="out-section">
        <div class="out-section-label">Analyse virale & angle choisi</div>
        <div class="legende-block">${auditEsc(d.analyse || '')}</div>
        ${lastGenContext && lastGenContext.brief && lastGenContext.brief.angle_choisi ? `
        <div class="strategy-block">
          <div class="strategy-item"><span class="strategy-tag">◆ Angle retenu</span>${auditEsc(lastGenContext.brief.angle_choisi)}</div>
          ${lastGenContext.brief.structure ? `<div class="strategy-item"><span class="strategy-tag">◆ Structure</span>${auditEsc(lastGenContext.brief.structure)}</div>` : ''}
          ${lastGenContext.brief.emotion_dominante ? `<div class="strategy-item"><span class="strategy-tag">◆ Émotion clé</span>${auditEsc(lastGenContext.brief.emotion_dominante)}</div>` : ''}
        </div>` : ''}
      </div>`
    },
    {
      titre: "5 Hooks, Arrêter le scroll en 2 secondes",
      num: "02",
      content: `<div class="out-section">
        <div class="out-section-label">Hooks · Plusieurs styles</div>
        <div class="hooks-list" id="hooksList">${(d.hooks || []).map((h, i) => `
          <div class="hook-item" data-idx="${i}">
            <span class="hook-style">${auditEsc(h.style)}</span>
            <span id="hookText${i}">${auditEsc(h.texte)}</span>
          </div>`).join('')}
        </div>
      </div>`
    },
    {
      titre: "Script complet",
      num: "03",
      content: `<div class="out-section">
        <div class="out-section-label">Script · ${auditEsc(state.plateforme)}</div>
        <div class="script-block" id="scriptBlock">${(d.script || []).map((s, i) => `
          <div class="script-row" data-idx="${i}">
            <div class="script-text" id="scriptText${i}">${auditEsc(s.texte)}</div>
            <div class="script-edit-toolbar" id="scriptEditToolbar${i}">
              <button type="button" class="script-edit-btn" onclick="microEditerBlocScript(${i},'reformuler',this)">Reformuler</button>
              <button type="button" class="script-edit-btn" onclick="microEditerBlocScript(${i},'raccourcir',this)">Raccourcir</button>
              <button type="button" class="script-edit-btn" onclick="microEditerBlocScript(${i},'allonger',this)">Allonger</button>
              <button type="button" class="script-edit-btn" onclick="microEditerBlocScript(${i},'simplifier',this)">Simplifier</button>
            </div>
          </div>`).join('')}
        </div>
        <div class="error-box" id="scriptEditError" style="display:none;margin-top:10px"></div>
      </div>`
    },
    {
      titre: "Légende & Hashtags",
      num: "04",
      sansBoutonGenerique: true,
      content: `<div class="out-section">
        <div class="out-section-label">Légende</div>
        <div class="legende-block">${auditEsc(sansHashtags(d.legende || ''))}</div>
        <div class="hashtags">${(d.hashtags || []).slice(0, 5).map(h => `<span class="ht">${auditEsc(h.toLowerCase())}</span>`).join('')}</div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText(sansHashtags(d.legende || '') + '\n\n' + (d.hashtags||[]).slice(0, 5).map(h => h.toLowerCase()).join(' '))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sansHashtags(d.legende || '') + '\n\n' + (d.hashtags||[]).slice(0, 5).map(h => h.toLowerCase()).join(' '))}')">${ICON_SHARE}</button></div>
      </div>`
    },
    {
      titre: "Variantes A/B du titre",
      num: "06",
      content: `<div class="out-section">
        <div class="out-section-label">Titres alternatifs à tester</div>
        <div class="hooks-list">${(d.variantes_titre || []).map((t, i) => `
          <div class="hook-item">
            <span class="hook-style">Version ${i === 0 ? 'A' : 'B'}</span>
            ${auditEsc(t)}
          </div>`).join('')}
        </div>
      </div>`
    },
    {
      titre: "Storyboard visuel",
      num: "05",
      content: `<div class="out-section">
        <p style="color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.6;margin-bottom:16px" id="sbDescP">Génère le découpage visuel plan par plan de ton script, avec un prompt d'image pour chaque segment.</p>
        ${optionsStoryboardHTML()}
        <button class="btn-storyboard" id="sbGenerateBtn" onclick="generateStoryboard()">
          <span class="sb-gen-spinner" id="sbGenSpinner"></span>
          <span id="sbGenText">Générer le storyboard visuel</span>
        </button>
        <div class="sb-progress-bar" id="sbProgBar1" style="display:none">
          <div class="wait-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 L5 13 H11 L10 22 L19 10 H13 L14 2 Z" fill="none" stroke="#E2C87A" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg></div>
          <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="sbProgFill1"></div></div>
          <div class="sb-progress-bar-pct" id="sbProgPct1">0%</div>
        </div>
        <div id="storyboardContainer"></div>
      </div>`,
      sansBoutonGenerique: true
    }
  ];

  // Textes pour les boutons copier (même ordre que le tableau `sections` juste
  // en dessous : chaque copyTexts[i] doit correspondre à sections[i]).
  copyTexts = [
    d.analyse || '',
    (d.hooks || []).map(h => h.style + ' :\n' + h.texte).join('\n\n'),
    (d.script || []).map(s => '[' + s.temps + ']\n' + s.texte).join('\n\n'),
    (d.legende || '') + '\n\n' + (d.hashtags || []).join(' '),
    (d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'),
    (d.storyboard || []).map(s => s.segment + ' | ' + s.texte_dit + '\nVISUEL: ' + s.prompt_visuel).join('\n\n')
  ];

  sections.forEach((sec, i) => {
    const card = document.createElement('div');
    card.className = 'out-card sb-appear' + (i === 0 ? ' open' : '');
    card.style.animationDelay = (i * 0.12) + 's';
    const btnId = 'copybtn_' + i;
    card.innerHTML = `
      <div class="out-header" onclick="toggleCard(this.parentElement)">
        <div class="out-title">${sec.titre}</div>
        <div class="out-toggle">+</div>
      </div>
      <div class="out-body">
        ${sec.content}
        ${sec.sansBoutonGenerique ? '' : `<div class="sb-actions-fin"><button class="icon-btn" title="Copier" id="${btnId}" onclick="copySection('${btnId}', copyTexts[${i}])">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, copyTexts[${i}])">${ICON_SHARE}</button></div>`}
      </div>
    `;
    list.appendChild(card);
  });

  pushNav();
  section.style.display = 'block';
  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

function toggleCard(card) { card.classList.toggle('open'); }

// ── Éditeur IA par passage (Reformuler/Raccourcir/Allonger/Simplifier) ──
// Demandé par le propriétaire après avoir étudié le générateur de scripts
// Vervox : leur "Éditeur IA intégré" (sélectionner un passage, demander une
// reformulation, réécrit en 2 secondes SANS tout refaire) est justement ce
// qui manquait chez nous, le script généré était en lecture seule (seul
// "✎ Modifier" existait, et il relance TOUT depuis les critères de départ).
// Gratuit et hors quota de génération (un confort d'édition, pas une
// nouvelle génération), plafonné par MICRO_EDIT_MAX_PAR_SCRIPT pour éviter
// l'abus évident sans construire un nouveau système de quota.
const MICRO_EDIT_CONSIGNES = {
  reformuler: "Reformule ce passage avec d'autres mots, en gardant EXACTEMENT le même sens, la même longueur approximative et la même intention : juste une autre façon naturelle de le dire.",
  raccourcir: "Raccourcis nettement ce passage (vise environ la moitié de sa longueur), en gardant uniquement l'essentiel, sans perdre le sens ni la clarté.",
  allonger: "Développe ce passage avec un peu plus de détail, de texture ou d'exemple concret, en gardant un rythme naturel à l'oral, sans devenir bavard ni générique.",
  simplifier: "Simplifie ce passage : phrases plus courtes, mots plus simples, plus facile à dire à voix haute et à comprendre d'emblée, sans perdre le sens."
};

async function microEditerBlocScript(idx, action, btn) {
  const consigne = MICRO_EDIT_CONSIGNES[action];
  const texteEl = document.getElementById('scriptText' + idx);
  const errBox = document.getElementById('scriptEditError');
  if (!consigne || !texteEl || !currentScript || !currentScript[idx]) return;
  if (errBox) errBox.style.display = 'none';

  if (_microEditsUtilises >= MICRO_EDIT_MAX_PAR_SCRIPT) {
    if (errBox) {
      errBox.textContent = "Tu as atteint la limite de retouches pour ce script (" + MICRO_EDIT_MAX_PAR_SCRIPT + "). Régénère un nouveau script pour continuer à en retoucher.";
      errBox.style.display = 'block';
    }
    return;
  }

  const toolbar = btn ? btn.closest('.script-edit-toolbar') : null;
  const boutons = toolbar ? Array.from(toolbar.querySelectorAll('.script-edit-btn')) : [];
  boutons.forEach(b => b.disabled = true);
  const labelOriginal = btn ? btn.textContent : '';
  if (btn) btn.textContent = '…';

  try {
    const ctx = lastGenContext || {};
    const texteActuel = currentScript[idx].texte || '';
    const prompt = `Tu es un rédacteur TikTok francophone. Voici UN PASSAGE d'un script vidéo déjà écrit (niche : ${ctx.niche || 'non précisée'}, sujet : ${ctx.sujet || 'non précisé'}, plateforme : ${state.plateforme || 'TikTok'}).

PASSAGE À MODIFIER :
"${texteActuel}"

CONSIGNE : ${consigne}

Réponds UNIQUEMENT avec le nouveau texte de ce passage, rien avant, rien après : pas de guillemets, pas de JSON, pas de commentaire.`;

    const raw = await callAI(MODEL_RAPIDE, 300, prompt, undefined, false, undefined, 'microEditScript');
    const nouveauTexte = String(raw || '').trim().replace(/^["«]+|["»]+$/g, '').trim();
    if (!nouveauTexte) throw new Error('Réponse vide');

    currentScript[idx].texte = nouveauTexte;
    texteEl.textContent = nouveauTexte;
    // copyTexts[2] = section "Script complet" (même ordre que `sections`
    // dans renderResults, voir le commentaire à sa construction) : à
    // reconstruire après édition, sinon Copier/Partager renvoient l'ancien texte.
    if (Array.isArray(copyTexts) && copyTexts.length > 2) {
      copyTexts[2] = currentScript.map(s => '[' + s.temps + ']\n' + s.texte).join('\n\n');
    }
    _microEditsUtilises++;
  } catch (e) {
    if (errBox) {
      errBox.textContent = 'Erreur : ' + (e.message || 'réessaie') + '.';
      errBox.style.display = 'block';
    }
  } finally {
    boutons.forEach(b => b.disabled = false);
    if (btn) btn.textContent = labelOriginal;
  }
}

// Variable globale pour les textes à copier
let copyTexts = [];

function copySection(id, text) {
  const btn = document.getElementById(id);
  const label = btn.innerHTML;
  const copy = (txt) => {
    navigator.clipboard.writeText(txt).then(() => {
      btn.textContent = '✓ Copié !';
      btn.style.borderColor = 'var(--gold)';
      btn.style.color = 'var(--gold)';
      setTimeout(() => {
        btn.innerHTML = label;
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '✓ Copié !';
      setTimeout(() => btn.innerHTML = label, 2000);
    });
  };
  copy(text);
}

async function generateStoryboard() {
  if (!lastGenContext || !currentScript) return;
  if (!_regenGratuiteEnCours) resetRegen('storyboardIdee');

  // Bouton, description et barre de progression sont désormais des frères
  // de storyboardContainer (jamais remplacés par son innerHTML) : ils
  // restent utilisables identiquement à la première génération et à
  // chaque régénération, même une fois masqués après le premier succès.
  const btn = document.getElementById('sbGenerateBtn');
  const spinner = document.getElementById('sbGenSpinner');
  const genText = document.getElementById('sbGenText');
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'block';
  if (genText) genText.textContent = 'Scriptura crée le storyboard…';
  const progBar1 = document.getElementById('sbProgBar1');
  if (progBar1) progBar1.style.display = 'flex';
  const setPctSb1 = (p) => {
    const fill = document.getElementById('sbProgFill1');
    const pct = document.getElementById('sbProgPct1');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  };

  const ctx = lastGenContext;
  // UNIQUEMENT le texte parlé (jamais le minutage) : préfixer "[0-3 sec]" ici
  // polluait le texte envoyé à segmentNarrativeStoryboard, donc les plans, donc
  // la voix off du montage, qui lisait "zéro trois sec" à voix haute. Le
  // découpage recalcule lui-même la durée de chaque plan (estimateDuration), le
  // minutage n'a donc aucune utilité dans ce texte. Même correctif que le mode
  // Série (voix_off_propre).
  const scriptText = currentScript.map(s => s.texte).join('\n');
  const plat = ctx.plateforme || 'TikTok';

  const carteMiniature = (m) => `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${auditEsc(m)}</div>
        ${blocGenImage(storeCopyText(m))}
      </div>`;
  const cartePlan = (i, p) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${auditEsc(p.duree || '')}</span>
          <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
        </div>
        <div class="sb-dit">"${auditEsc(p.text || '')}"</div>
        <div class="sb-visual-label">🎬 Prompt visuel</div>
        <div class="sb-visual">${auditEsc(p.visuel || '')}</div>
        ${blocGenImage(storeCopyText(p.visuel || ''))}
      </div>`;

  // Le conteneur (bouton, spinner, barre de progression compris) est remplacé
  // dès le départ par la grille progressive : le statut d'avancement et les
  // erreurs doivent donc désormais vivre DANS cette nouvelle grille, jamais
  // sur les anciens éléments (btn/spinner/genText), devenus détachés du DOM
  // une fois ce remplacement fait, sinon un échec en cours de lots restait
  // invisible pour l'utilisateur (spinner bloqué indéfiniment).
  const container = document.getElementById('storyboardContainer');
  container.innerHTML = `<div class="sb-actions-top"><button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardIdee')">↻ Régénérer</button></div>
    <div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div>
    <div class="sb-statut" id="sbIdeeStatut">Scriptura crée le storyboard…</div>
    <div class="storyboard-list" id="sbIdeeGrid"></div>`;
  const grid = document.getElementById('sbIdeeGrid');
  const statut = document.getElementById('sbIdeeStatut');

  // Déclaré AVANT le try (bug corrigé, retour terrain, audit du 2 septembre
  // 2026) : un `const prog` déclaré DANS le try n'est pas visible dans le
  // `finally` qui suit (portée de bloc), `typeof prog !== 'undefined'` y
  // était donc TOUJOURS faux et prog.stop() n'était jamais appelé en cas
  // d'erreur précoce (ex. "Script vide") : le minuteur de progression
  // (setTimeout récursif) tournait alors indéfiniment. Même correctif déjà
  // appliqué ailleurs (js/serie.js).
  let prog = null;
  try {
    // Découpage narratif déterministe (js/storyboard.js), AVANT tout appel IA :
    // le nombre de plans n'est plus limité par ce qu'une seule requête peut
    // produire dans son budget de temps, les visuels sont générés par lots
    // (voir genererVisuelsParLots), donc un script long reste rapide et fiable.
    const plans = segmentNarrativeStoryboard(scriptText);
    if (!plans.length) throw new Error('Script vide');

    // Jalon RÉEL par lot (voir js/storyboard.js, generateStoryStoryboard,
    // même correctif) : le % avance à chaque lot VRAIMENT reçu.
    const nbLots1 = Math.max(1, Math.ceil(plans.length / TAILLE_LOT_VISUELS));
    prog = creerProgressionReelle(setPctSb1, Array(nbLots1).fill(1));
    prog.start();

    let miniature = '';
    const promesseMiniature = genererMiniatureVisuelle(`${ctx.sujet}\n\n${scriptText}`, plat).then(m => {
      miniature = m;
      if (m) grid.insertAdjacentHTML('afterbegin', carteMiniature(m));
    });

    await genererVisuelsParLots(plans, plat, (lot, indexDepart) => {
      const html = lot.map((p, k) => cartePlan(indexDepart + k, p)).join('');
      grid.insertAdjacentHTML('beforeend', html);
      const fait = Math.min(indexDepart + lot.length, plans.length);
      if (statut) statut.textContent = `Scriptura crée le storyboard… ${fait}/${plans.length} plans`;
      prog.etapeTerminee(Math.floor(indexDepart / TAILLE_LOT_VISUELS));
    });
    await promesseMiniature;
    if (statut) statut.remove();

    prog.finish();
    setTimeout(() => { const pb = document.getElementById('sbProgBar1'); if (pb) pb.style.display = 'none'; }, 600);

    const tousLesPrompts2 = (miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + plans.map((p, i) => 'Plan ' + (i + 1) + ' : ' + (p.visuel || '')).join('\n\n');
    grid.insertAdjacentHTML('beforeend', `
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tousLesPrompts2)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tousLesPrompts2)}')">${ICON_SHARE}</button>
        ${montageBoutonHTML('montageBtnScript', plans)}
      </div>
      ${typeof guideMontageBlocHTML === 'function' ? guideMontageBlocHTML('Script', plans, '', updateGenerationGuideMontage) : ''}`);

    // Sauvegarder le storyboard pour qu'il reste après réouverture, mêmes
    // champs qu'avant (segment/texte_dit/prompt_visuel).
    const storyboardPourSauvegarde = plans.map((p, i) => ({ segment: p.duree, texte_dit: p.text, prompt_visuel: p.visuel || '' }));
    updateGenerationStoryboard({ storyboard: storyboardPourSauvegarde, miniature: miniature || null });

    // Masquer le bouton + le texte descriptif après génération (le bouton Régénérer prend le relais)
    if (btn) {
      btn.style.display = 'none';
      const descP = document.getElementById('sbDescP');
      if (descP) descP.style.display = 'none';
    }

  } catch(e) {
    // Ajouté APRÈS ce qui a déjà pu s'afficher (plans des lots précédents) :
    // un échec en cours de route ne fait plus disparaître ce qui a déjà réussi.
    if (statut) statut.remove();
    grid.insertAdjacentHTML('beforeend', `<div class="error-box" style="display:block;margin-top:14px">Erreur : ${e.message}. <a onclick="generateStoryboard()" style="text-decoration:underline;cursor:pointer">Réessayer</a></div>`);
  } finally {
    if (prog) prog.stop();
    const pb1 = document.getElementById('sbProgBar1');
    if (pb1) setTimeout(() => { pb1.style.display = 'none'; }, 600);
    if (btn) btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (genText) genText.textContent = 'Générer le storyboard visuel';
  }
}





function restart() {
  Object.keys(state).forEach(k => state[k] = '');
  state.plateforme = 'TikTok';
  if (typeof syncPlatformPickerVisuel === 'function') syncPlatformPickerVisuel();
  document.getElementById('niche').value = '';
  document.getElementById('sujet').value = '';
  document.getElementById('audience').value = '';
  document.getElementById('format').value = '';
  document.getElementById('viralVideo').value = '';
  document.getElementById('viralVideoField').style.display = 'none';
  // Ton et durée n'étaient jusqu'ici jamais réinitialisés : un ton ou une
  // durée choisis pour UN sujet restaient silencieusement appliqués au
  // suivant, sans que rien ne le signale dans le formulaire vidé.
  document.getElementById('tone').value = '';
  selectedTone = '';
  selectedDuree = '';
  document.getElementById('dureeGrid').value = '';
  document.getElementById('venteDescription').value = '';
  if (typeof retirerFichierVente === 'function') retirerFichierVente();
  document.getElementById('results').style.display = 'none';
  showStep(1);
}

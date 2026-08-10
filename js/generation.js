let ideaPlatform = '';
let ideaGoal = '';
let ideaTone = '';

function setupIdeaButtons() {
  const groups = [
    { id: 'ideaPlatformGrid', setter: v => ideaPlatform = v },
    { id: 'ideaGoalGrid', setter: v => ideaGoal = v }
  ];
  const ideaToneSelectEl = document.getElementById('ideaTone');
  if (ideaToneSelectEl) {
    ideaToneSelectEl.addEventListener('change', function() { ideaTone = this.value; });
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

function setIdeaLoading(on) {
  const btn = document.getElementById('ideaGenerateBtn');
  btn.disabled = on;
  document.getElementById('ideaSpinner').style.display = on ? 'block' : 'none';
  document.getElementById('ideaBtnText').textContent = on ? 'Scriptura brainstorme…' : '💡 Générer mes idées de contenu';
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

  // Mémoire du créateur : voir js/profil.js — n'ajoute qu'une ligne de plus
  // au bloc de contexte déjà présent, ne modifie aucune règle de ce prompt.
  const profilLigneIdees = ligneProfilPourPrompt(await chargerProfilCreateur());

  // Recherche web — deux besoins distincts, qui peuvent se cumuler : vérification
  // factuelle pour les niches d'actualité/géopolitique/Histoire (voir js/api.js),
  // et tendances TikTok, toujours activée (la quasi-totalité des créateurs
  // Scriptura publient sur TikTok) pour que les idées s'appuient sur ce qui
  // performe réellement en ce moment, pas seulement sur le profil du créateur.
  const rechercheWebIdees = nicheNecessiteRecherche(niche);
  const rechercheWebIdeesActive = true;

  // Les choix du créateur (ton, plateforme, objectif) ne sont pas là pour
  // décorer le prompt — chacun doit avoir un effet réel et vérifiable sur
  // les idées produites. Avant ce correctif, le ton et la plateforme étaient
  // mélangés dans une seule phrase cassée par un ternaire (résultat
  // grammaticalement incorrect dès qu'un ton était choisi), et l'objectif
  // n'avait tout simplement AUCUNE instruction propre.
  const ideaToneInstruction = ideaTone
    ? `RESPECT STRICT ET EXCLUSIF DU TON CHOISI : le créateur a choisi précisément ce ton : "${ideaTone}". Chaque angle et chaque hook proposés doivent rester dans CE ton exact, sans dérive vers un autre registre — c'est une consigne explicite, pas une suggestion.`
    : `Aucun ton précisé : adapte le ton au style le plus pertinent pour la niche et le sujet de chaque idée.`;

  const codesPlateformeIdees = {
    'TikTok': 'hooks courts et percutants dès la première seconde, rythme rapide, tutoiement direct.',
    'Instagram Reels': 'hooks un peu plus soignés et esthétiques, peuvent installer une micro-narration, ton communauté/lifestyle.',
    'YouTube Shorts': 'hooks proches d\'un titre de recherche (curiosité ou promesse claire dès les premiers mots), pensés pour capter au scroll ET à la recherche.',
    'Facebook': 'hooks au ton plus familier et générationnel, qui invitent explicitement au partage et à la discussion en commentaire.',
    'LinkedIn': 'hooks professionnels, orientés retour d\'expérience ou enseignement concret, jamais putaclic — la crédibilité prime sur le sensationnalisme.'
  };
  const ideaPlatformInstruction = ideaPlatform
    ? `PLATEFORME "${ideaPlatform}" — RESPECTE SES CODES : ${codesPlateformeIdees[ideaPlatform] || 'adapte le format des hooks aux usages de cette plateforme précise.'}`
    : `Aucune plateforme précisée : reste généraliste, sans t'ancrer dans les codes d'une seule.`;

  const codesObjectifIdees = {
    'faire des vues': 'privilégie des angles à très fort potentiel de curiosité et de partage immédiat — le hook doit créer un choc ou un besoin urgent de voir la suite, la portée prime sur tout le reste.',
    'gagner des abonnés': 'privilégie des angles qui donnent envie de suivre le compte pour la suite (partie 2 implicite, format récurrent, promesse d\'autres révélations du même genre) — le créateur doit apparaître comme une référence qu\'on veut revoir.',
    'générer des ventes': 'privilégie des angles qui créent un désir ou un besoin concret pouvant mener naturellement vers une offre, un produit ou un service du créateur — sans jamais sonner comme une pub déguisée.',
    'renforcer mon expertise': 'privilégie des angles qui démontrent une maîtrise réelle du sujet — analyses fines, retournements qui montrent que le créateur voit ce que les autres ne voient pas, jamais du contenu superficiel.'
  };
  const ideaGoalInstruction = ideaGoal
    ? `OBJECTIF DU CRÉATEUR "${ideaGoal}" — RESPECTE-LE RIGOUREUSEMENT dans le choix des angles : ${codesObjectifIdees[ideaGoal] || 'adapte les angles à cet objectif précis.'}`
    : `Aucun objectif précisé : équilibre les angles entre portée, fidélisation et démonstration d'expertise.`;

  const prompt = `Tu es le Directeur Éditorial de Scriptura, expert en contenu viral francophone et stratège TikTok. Tu génères des idées de vidéos VIRALES et NON GÉNÉRIQUES pour CE créateur précis — jamais une liste interchangeable qu'un autre créateur de la même niche pourrait recevoir à l'identique.
${rechercheWebIdees ? instructionRechercheWeb(niche, 'de proposer des idées') : ''}${instructionRechercheTendancesTikTok(niche, 'de proposer des idées')}

PROFIL DU CRÉATEUR :
- Niche : ${niche}
${audience ? '- Audience : ' + audience : ''}
${geo ? '- ZONE GÉOGRAPHIQUE CIBLE : ' + geo : ''}
${ideaPlatform ? '- Plateforme : ' + ideaPlatform : ''}
${ideaGoal ? '- Objectif : ' + ideaGoal : ''}
${ideaTone ? '- Style/angle : ' + ideaTone : ''}
${theme ? '- Thème précis à explorer : ' + theme : ''}
${profilLigneIdees ? '- ' + profilLigneIdees : ''}

${geo ? `CONTRAINTE GÉOGRAPHIQUE ABSOLUE — TU ES UN EXPERT LOCAL DE : ${geo}
Toutes les idées DOIVENT être ancrées spécifiquement dans cette zone. Ne reste JAMAIS vague ou générique.
- Puise dans les figures historiques réelles, les événements précis, les dynasties, les royaumes, les batailles, les personnages et les faits SPÉCIFIQUES à ${geo}
- Utilise des noms propres réels, des dates réelles, des lieux réels de cette zone
- Agis comme quelqu'un qui connaît intimement l'histoire et les réalités de ${geo}, pas comme un touriste
- Évite les sujets déjà vus mille fois : cherche les histoires méconnues, les angles surprenants, les faits que même les habitants de ${geo} ignorent souvent
- Si la niche est géopolitique : ancre dans les enjeux, tensions, alliances et réalités actuelles et historiques réelles de ${geo}
Une idée qui pourrait s'appliquer à n'importe quelle région est une idée ÉCHOUÉE. Chaque idée doit être impossible à imaginer sans connaître ${geo}.` : ''}

AVANT D'ÉCRIRE LA MOINDRE IDÉE, RAISONNE EN SILENCE — ce raisonnement ne doit JAMAIS apparaître dans ta réponse, seul le résultat final compte :

1. OPPORTUNITÉS : à partir du profil ci-dessus (niche, historique, leçons d'audit, objectif), identifie les sujets offrant le plus fort potentiel pour CE créateur précis — pas pour n'importe qui dans cette niche. Cherche activement : les contradictions, les paradoxes, les idées reçues à démonter, les secrets, les erreurs coûteuses, les conséquences inattendues, les révélations méconnues, les histoires peu racontées, les angles rarement utilisés. Ne retiens jamais un sujet évident quand un angle plus fort existe sur le même thème.

2. ANTI-RÉPÉTITION : si le profil ci-dessus mentionne des sujets, angles, structures ou hooks déjà utilisés pour ce créateur, écarte-les activement — ne les reformule pas, ne les paraphrase pas.

3. FILTRE ANTI-GÉNÉRIQUE : pour chaque idée envisagée, vérifie-la contre ces questions avant de la retenir — ressemble-t-elle à ce qu'une IA généraliste proposerait spontanément ? Est-elle trop évidente ? Manque-t-elle de surprise ou de curiosité ? Ressemble-t-elle à une idée déjà générée pour ce créateur ? Si la réponse est oui à l'une de ces questions, rejette-la et cherche mieux.

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
2. L'ANGLE : quelle est l'approche unique, pourquoi c'est différent — et pourquoi cet angle précis plutôt qu'un plus évident sur le même sujet
3. POURQUOI ÇA MARCHE POUR CE CRÉATEUR : le mécanisme psychologique qui rend cette idée virale, ET en quoi elle est pertinente pour SON profil précis. Ne mentionne JAMAIS une performance ou une statistique que tu ne connais pas réellement — base-toi uniquement sur les informations disponibles ci-dessus.
4. UN HOOK DE DÉPART cohérent avec l'angle : la première phrase exacte pour lancer la vidéo. Vérifie-le avant de le retenir : est-il prévisible ou générique ? S'il échoue à ce test, remplace-le.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après (aucun raisonnement visible, uniquement le résultat) :
{"idees":[{"titre":"...","angle":"...","pourquoi":"...","hook":"..."}]}

Génère exactement 10 idées, toutes différentes, classées de la meilleure opportunité à la moins forte pour ce créateur précis.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 6000, prompt, undefined, rechercheWebIdeesActive, rechercheWebIdees ? 2 : 1);
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
        angles_recents: (parsed.idees && parsed.idees[0] && parsed.idees[0].angle) ? String(parsed.idees[0].angle).slice(0, 120) : undefined,
        hooks_recents: (parsed.idees && parsed.idees[0] && parsed.idees[0].hook) ? String(parsed.idees[0].hook).slice(0, 140) : undefined
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
        <div class="out-title idea-titre">${idea.titre || ''}</div>
        <div class="out-toggle">+</div>
      </div>
      <div class="out-body">
        <div class="idea-section">
          <div class="idea-section-label">◆ L'angle</div>
          <div class="idea-section-text">${idea.angle || ''}</div>
        </div>
        <div class="idea-section">
          <div class="idea-section-label">◆ Pourquoi ça marche</div>
          <div class="idea-section-text">${idea.pourquoi || ''}</div>
        </div>
        <div class="idea-section">
          <div class="idea-section-label">◆ Hook de départ</div>
          <div class="idea-hook">"${idea.hook || ''}"</div>
        </div>
        <div class="idea-actions">
          <button class="idea-btn-script" onclick="useIdeaForScript(${i})">🎬 Générer le script complet</button>
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
  if (audSelect && audience && !audience.startsWith('Choisir')) {
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

  // Comme TOUS les choix sont reportés, on saute directement au récap (étape 4)
  if (state.objectif && state.plateforme) {
    showStep(4);
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
  if (nextStep === 3 && key === 'plateforme') {
    showStep(4);
    renderSummary();
  } else {
    showStep(nextStep + 1);
  }
}

function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step' + n).classList.add('active');
  document.getElementById('flow').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goBack(n) {
  showStep(n);
}

// Depuis le bouton "✎ Modifier" du résultat : masque le résultat et
// rouvre l'étape 4 (le formulaire) pour changer les critères sans jamais
// effacer les valeurs déjà saisies — contrairement à restart(), qui repart
// de zéro. Voir renderResults(), qui masque l'étape 4 à l'affichage du résultat.
function modifierCriteresScript() {
  document.getElementById('results').style.display = 'none';
  showStep(4);
}

function renderSummary() {
  const el = document.getElementById('summaryTags');
  el.innerHTML = [state.objectif, state.depart, state.plateforme]
    .filter(Boolean)
    .map(v => `<span class="summary-tag">${v}</span>`)
    .join('');

  // Mettre à jour le compteur de générations
  renderGenCounter();

  // Afficher le champ vidéo virale si l'utilisateur a choisi cette option
  const viralField = document.getElementById('viralVideoField');
  const sujetLabel = document.getElementById('sujetLabel');
  if (state.depart && state.depart.includes('analyser une vidéo virale')) {
    viralField.style.display = 'flex';
    sujetLabel.textContent = 'Ton sujet à toi (ce dont TU veux parler)';
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

// ── GÉNÉRATION ──
async function generate() {
  if (!_regenGratuiteEnCours) resetRegen('script');
  const niche    = document.getElementById('niche').value.trim();
  const sujetBrut = document.getElementById('sujet').value.trim();
  // Le champ accepte aussi bien quelques mots qu'un texte long collé.
  // Au-delà d'un certain volume, on le traite comme une MATIÈRE de référence :
  // on le borne pour ne pas faire exploser les prompts (le sujet est réutilisé
  // à plusieurs étapes), et on prévient le modèle de ne pas le recopier.
  const LONG_SEUIL = 400;
  const estTexteLong = sujetBrut.length > LONG_SEUIL;
  const sujet = estTexteLong
    ? sujetBrut.slice(0, 2000)
    : sujetBrut;
  const audience = document.getElementById('audience').value.trim();
  const format   = document.getElementById('format').value.trim();
  const viralVideo = document.getElementById('viralVideo').value.trim();
  const isViralMode = state.depart && state.depart.includes('analyser une vidéo virale');
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

  // Les choix du créateur (plateforme, objectif) doivent avoir un effet réel
  // et vérifiable sur le script produit, pas juste apparaître en contexte
  // passif. Avant ce correctif, la plateforme n'avait aucun code concret
  // ("respecte les codes de rythme" sans dire lesquels), et l'objectif —
  // stocké comme une phrase complète (ex. "Renforcer mon expertise et ma
  // crédibilité") — devait être deviné par l'IA contre des étiquettes
  // courtes qui ne correspondent pas toujours textuellement (aucune ne
  // contient le mot "autorité").
  const codesPlateformeScript = {
    'TikTok': 'hooks très courts et immédiats, rythme rapide, tutoiement direct, coupes fréquentes.',
    'Instagram Reels': 'esthétique soignée, peut installer une micro-narration avant le twist, ton communauté/lifestyle.',
    'YouTube Shorts': 'hook proche d\'un titre de recherche (curiosité ou promesse claire dès les premiers mots), pensé pour capter au scroll ET à la recherche.',
    'Facebook': 'ton plus familier et générationnel, formulations qui invitent explicitement au partage et au commentaire.',
    'LinkedIn': 'registre professionnel, retour d\'expérience ou enseignement concret, jamais putaclic — la crédibilité prime sur le sensationnalisme.',
    'WhatsApp Status': 'très court et personnel, comme un message adressé à des proches/contacts plutôt qu\'à un public anonyme, ton direct et intime.'
  };
  const plateformeInstructionScript = state.plateforme
    ? `PLATEFORME "${state.plateforme}" — RESPECTE SES CODES : ${codesPlateformeScript[state.plateforme] || 'adapte le rythme et le registre aux usages propres à cette plateforme.'}`
    : `Aucune plateforme précisée : reste généraliste, adapté à un usage vidéo courte multi-plateformes.`;

  const codesObjectifScript = {
    'Faire plus de vues et maximiser la portée': 'inciter au partage ou à regarder une autre vidéo — la portée prime, pas la conversion.',
    'Gagner des abonnés qualifiés rapidement': 'donner une raison concrète et précise de s\'abonner (promesse de valeur future, contenu récurrent) — jamais un "abonne-toi" générique.',
    'Générer des ventes via mon contenu': 'inciter à passer à l\'action commerciale (lien, DM, commentaire déclencheur, offre) — sans jamais sonner comme une pub déguisée.',
    'Renforcer mon expertise et ma crédibilité': 'inciter à commenter son avis ou sauvegarder — démontrer une maîtrise réelle du sujet, jamais du contenu superficiel.'
  };
  const objectifInstructionScript = state.objectif
    ? `OBJECTIF DU CRÉATEUR "${state.objectif}" — LE CTA FINAL DOIT : ${codesObjectifScript[state.objectif] || 'servir précisément cet objectif, formulé exactement comme le créateur l\'a choisi.'}`
    : `Aucun objectif précisé : vise un CTA équilibré entre portée et fidélisation.`;

  try {
    // ════════════════════════════════════════════
    //  PHASE 1 — LE DIRECTEUR ÉDITORIAL (raisonnement)
    //  Analyse le sujet, génère 3 angles, sélectionne le meilleur,
    //  choisit la structure, définit la stratégie de hooks.
    // ════════════════════════════════════════════
    const briefPrompt = `Tu es le Directeur Éditorial de Scriptura, le meilleur stratège de contenu viral francophone. Tu ne rédiges PAS encore. Tu réfléchis comme un directeur créatif de haut niveau avant toute écriture.

RÈGLE FONDAMENTALE, au-dessus de toutes les autres : le script final doit donner l'impression d'avoir été écrit par un excellent storyteller spécialisé TikTok — jamais par une IA généraliste. Chaque choix que tu fais ci-dessous doit servir cette règle.

CONTEXTE :
- ${estTexteLong ? 'MATIÈRE FOURNIE PAR LE CRÉATEUR (texte de référence, à NE PAS recopier tel quel : extrais-en le sujet réel, l\'angle et les faits utiles)' : 'Sujet'} : ${sujet}
- Niche : ${niche}
- Plateforme : ${state.plateforme}
- Objectif du créateur : ${state.objectif}
- Durée cible : ${wt.desc}
${audience ? '- Audience : ' + audience : ''}
${format ? '- Format : ' + format : ''}
${selectedTone ? '- Ton souhaité : ' + selectedTone : ''}
${profilLigneScript ? '- ' + profilLigneScript : ''}
${isViralMode ? '\\n- MODE ANALYSE : le créateur veut reproduire la recette de cette vidéo virale :\\n[DEBUT]\\n' + viralVideo + '\\n[FIN]\\nDécode sa structure et sa mécanique pour la réappliquer.' : ''}

TON TRAVAIL DE RÉFLEXION (fais-le sérieusement, c'est ce qui fait la différence) :

1. ANALYSE DU SUJET : Quel est l'enjeu réel, la tension cachée, ce qui rend ce sujet émotionnellement puissant ? Quel est l'angle mort que personne n'exploite ? Si le profil du créateur ci-dessus contient des leçons tirées de ses audits précédents, utilise-les activement pour orienter cette analyse.

2. TROIS ANGLES NARRATIFS DIFFÉRENTS : Propose 3 angles VRAIMENT distincts (pas 3 variantes du même). Pour CHAQUE angle, cherche activement au moins un de ces leviers puissants : l'élément inattendu, la contradiction, la révélation, le conflit, la surprise, le paradoxe, le coût caché, le secret, le risque. Un angle qui n'exploite aucun de ces leviers est un angle faible — remplace-le. Par exemple : un angle contre-intuitif, un angle émotionnel/personnel, un angle révélation/coulisses. Chaque angle doit attaquer le sujet différemment.

3. COMPARAISON ET SÉLECTION : Compare les 3 angles pour ${state.plateforme} et l'objectif "${state.objectif}". L'angle choisi ne doit jamais être simplement "intéressant" : il doit être le PLUS PUISSANT des trois — celui qui a le plus fort potentiel d'arrêt du scroll ET de rétention. Choisis-en UN et justifie en une phrase pourquoi il est le plus fort, pas seulement pourquoi il convient.

4. STRUCTURE NARRATIVE OPTIMALE : Quelle structure sert le mieux cet angle ? (ex: problème→agitation→solution, boucle ouverte, storytelling chronologique, liste à tension croissante, mythe→réalité...). Choisis la meilleure.

5. STRATÉGIE ÉMOTIONNELLE : Quelle émotion dominante veux-tu déclencher ? Quels moments de tension placer, et où mettre les "retention hooks" (relances qui réaccrochent) ?

6. ANGLE DE HOOK GAGNANT : Quel type de hook aura le plus d'impact pour cet angle précis ? Le hook ne doit jamais être seulement accrocheur : il doit provoquer une envie IRRÉPRESSIBLE de continuer. Teste mentalement la direction envisagée : est-elle prévisible ? Ressemble-t-elle à un hook ChatGPT générique ("Voici pourquoi...", "Vous ne devinerez jamais...") ? Crée-t-elle une vraie tension et une boucle de curiosité ? Si elle échoue à l'un de ces tests, cherche une meilleure direction. Donne la direction (pas encore la formulation finale).

7. STRATÉGIE DE CTA : Quel appel à l'action final servira le mieux l'objectif "${state.objectif}" ? Quelle action précise le spectateur doit-il faire à la fin (acheter, commenter un mot, partager, s'abonner pour une raison précise) ?

8. ANTI-RÉPÉTITION : Si le profil du créateur ci-dessus mentionne des angles, hooks ou structures déjà utilisés récemment, ton angle et ta structure choisis DOIVENT en être nettement différents. Ne recycle jamais ce qui a déjà été fait pour ce créateur.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"analyse_strategique":"l'enjeu réel et l'angle mort en 2 phrases percutantes","angle_choisi":"description de l'angle gagnant sélectionné","pourquoi_cet_angle":"justification en 1 phrase : pourquoi c'est le PLUS PUISSANT des 3, pas juste pourquoi il convient","structure":"la structure narrative choisie et son déroulé","emotion_dominante":"l'émotion clé à déclencher","strategie_hook":"la direction du hook le plus percutant, déjà validée contre le test de prévisibilité","strategie_retention":"où placer les relances pour tenir jusqu'au bout","strategie_cta":"l'action précise à demander en fin de script"}`;

    const briefRaw = await callAI(MODEL_RAPIDE, 2000, briefPrompt);
    const brief = parseAIResponse(briefRaw) || {};
    // Si l'utilisateur a collé un texte long, on ne le répète pas dans les
    // étapes suivantes : on utilise l'angle dégagé par le directeur éditorial.
    const sujetCourt = estTexteLong
      ? (brief.angle_choisi || brief.analyse_strategique || sujet.slice(0, 200))
      : sujet;

    // ════════════════════════════════════════════
    //  PHASE 2 — LE RÉDACTEUR EN CHEF (écriture + auto-critique)
    //  Reçoit le brief stratégique, écrit le meilleur contenu,
    //  s'auto-critique et livre la version finale calibrée.
    // ════════════════════════════════════════════
    // Format optionnel ici (contrairement au mode Série) : par défaut, on
    // écrit pour un créateur qui se filme, le cas le plus courant.
    const estFaceless = /faceless|voix off|sans visage/i.test(format);

    const writePrompt = `Tu es le Rédacteur en Chef de Scriptura, capable de rivaliser avec les meilleurs créateurs à 500K+ abonnés. RÈGLE FONDAMENTALE, au-dessus de toutes les autres : ce script doit donner l'impression d'avoir été écrit par un excellent storyteller spécialisé TikTok — jamais par une IA généraliste. Tu reçois le brief stratégique du Directeur Éditorial. Tu dois maintenant EXÉCUTER ce brief avec une qualité exceptionnelle.
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
${audience ? '- AUDIENCE CIBLE : ' + audience + ' — écris en pensant précisément à ce public (vocabulaire, références, niveau de connaissance déjà supposé), pas à un public générique.' : ''}
- Format : ${format || 'non précisé — écris par défaut pour un créateur qui se filme (face caméra)'}
${selectedTone ? '- Ton : ' + selectedTone : ''}

RÈGLES ABSOLUES DE QUALITÉ (non négociables) :

1. RESPECT STRICT DE LA DURÉE (RÈGLE N°1 ABSOLUE) : Le script doit faire EXACTEMENT entre ${wt.min} et ${wt.max} mots au TOTAL (pour ${wt.desc}), répartis en ${wt.blocs} blocs.
   ⚠️ MÉTHODE OBLIGATOIRE : Avant de finaliser, COMPTE mot par mot le total de ton script. S'il fait moins de ${wt.min} mots, tu DOIS ajouter du contenu de valeur pour atteindre la cible. S'il dépasse ${wt.max}, tu DOIS couper. Ne rends JAMAIS un script hors de la fourchette ${wt.min}-${wt.max} mots.
   Un script de ${wt.desc} qui fait moins de ${wt.min} mots est un ÉCHEC TOTAL. Vise le milieu de la fourchette (environ ${Math.round((wt.min + wt.max) / 2)} mots).

2. CHAQUE PHRASE A UNE FONCTION : Interdiction absolue de phrase de remplissage. Chaque phrase doit soit accrocher, soit faire avancer, soit créer une tension, soit relancer. Si une phrase ne sert à rien, supprime-la.

3. UNE IMAGE MENTALE TOUTES LES 3 À 5 SECONDES (essentiel pour le storyboard qui sera généré ensuite à partir de ce texte) : écris comme si tu filmais mentalement chaque instant. Chaque phrase — ou petit groupe de phrases très courtes — doit porter UNE SEULE idée visuelle claire, concrète et filmable (une action, un lieu, un visage, un objet), jamais plusieurs idées mélangées dans une même phrase longue. Change d'image mentale environ toutes les 8 à 14 mots (~3 à 5 secondes à l'oral). Interdiction des phrases analytiques ou à tiroirs qui empilent plusieurs images en une seule construction : découpe-les en plusieurs phrases courtes, chacune avec sa propre image. Ce rythme sert la rétention ET permet un découpage storyboard précis, sans perte de sens.

4. TENSION DU DÉBUT À LA FIN : Applique la stratégie de rétention du brief. Place des relances ("mais attends...", "et c'est là que...", "sauf que...") pour que personne ne décroche.

5. CTA OBLIGATOIRE À LA FIN : Le DERNIER bloc du script DOIT contenir un appel à l'action clair. Jamais un "abonne-toi" générique. ${objectifInstructionScript}
Le CTA doit être naturel, percutant, et donner envie d'agir MAINTENANT. C'est la partie qui transforme une vue en résultat. Ne termine JAMAIS un script sans CTA.

6. HOOKS DIFFÉRENCIANTS ET TESTÉS : Génère 5 hooks qui suivent la direction du brief. Avant de valider CHAQUE hook, teste-le mentalement : est-il prévisible ? Ressemble-t-il à un hook ChatGPT classique ("Voici 5 astuces", "Saviez-vous que", "Dans cette vidéo") ? Crée-t-il une vraie tension psychologique immédiate ? Ouvre-t-il une boucle de curiosité (une question implicite que le spectateur veut absolument voir résolue) ? Promet-il une révélation forte ? Un hook qui échoue à l'un de ces tests est REJETÉ — remplace-le avant de répondre. INTERDIT les formules génériques. Chaque hook doit être IMPOSSIBLE à confondre avec du ChatGPT basique.

7. ${plateformeInstructionScript}

8. ORIENTÉ OBJECTIF : tout, du hook au CTA, sert l'objectif du créateur ci-dessus — pas seulement le dernier bloc.

FORMAT — RÈGLE ABSOLUE, écris VRAIMENT pour ce format (les deux ne se ressemblent JAMAIS) :

${estFaceless ? `>> FORMAT FACELESS (le créateur n'apparaît pas) :
Le "texte" de chaque bloc est la VOIX OFF (ce qu'on entend) — jamais une adresse du type "regarde-moi" ou "je vais te montrer face caméra".
Le "visuel" de chaque bloc décrit précisément ce qui apparaît à l'écran pendant cette voix off (images, texte animé, plans d'illustration, archives).` : `>> FORMAT FACE CAMÉRA (le créateur se filme et parle) :
Le "texte" de chaque bloc est PARLÉ à la première personne, comme si le créateur s'adressait directement à sa caméra — fluide et naturel, jamais de mention "VOIX OFF" ou "TEXTE À L'ÉCRAN" (ce sont des codes faceless, interdits ici).
Le "visuel" de chaque bloc dit COMMENT se filmer : cadrage (gros plan, plan poitrine), énergie et ton, où regarder, quel geste ou expression appuyer le propos.`}
${selectedTone ? `
TON — RÈGLE ABSOLUE, RESPECT STRICT ET EXCLUSIF : le créateur a choisi précisément ce ton : "${selectedTone}". Écris l'INTÉGRALITÉ du script dans CE ton, du hook à la chute, sans jamais dévier vers un autre registre — même partiellement, même une seule phrase. C'est une consigne explicite du créateur, pas une suggestion : la trahir est un échec, quelle que soit la qualité par ailleurs. Un ton satirique ne devient jamais sérieux ou émotionnel en cours de route ; un ton émotionnel ne bascule jamais dans l'ironie ou la moquerie ; un ton analytique ne devient jamais lyrique. Chaque phrase doit rester fidèle au ton choisi, pas seulement le hook ou l'intro.` : ''}

RÈGLES DE QUALITÉ À RESPECTER :
- Un simple prompt ChatGPT ne doit JAMAIS pouvoir reproduire ça. Sois nettement supérieur.
- Le hook doit vraiment arrêter le scroll.
- Le compte de mots doit être dans la cible ${wt.min}-${wt.max}.
- Le dernier bloc DOIT contenir un vrai CTA qui dit quoi faire.
- Chaque phrase a une fonction, aucun remplissage.
- Une seule image mentale par phrase, changement toutes les 3 à 5 secondes.
Écris ta MEILLEURE version — vise l'excellence absolue (score global 90-100). Chaque script doit être digne d'un créateur professionnel.

EVALUATION HONNETE DU SCORE : après avoir écrit, évalue ton propre travail avec RIGUEUR et HONNETETE, comme un critique exigeant. Ne gonfle pas les chiffres artificiellement : un bon score doit être MERITE par la qualité réelle du script.
- "viral" : potentiel de partage réel
- "hook" : le hook arrête-t-il vraiment le scroll en 2 secondes ?
- "engagement" : maintient-il l'attention sans temps mort ?
- "emotion" : provoque-t-il une vraie émotion ?
- "retention" : pourcentage (0-100) de spectateurs qui regarderont jusqu'au bout, selon la force du hook, le rythme et la promesse de la chute.
Si ton script ne mérite pas 90+, réécris-le AVANT de répondre jusqu'à ce qu'il soit réellement excellent.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"score":{"viral":85,"hook":90,"engagement":80,"emotion":88,"retention":82},"analyse":"pourquoi ce sujet+angle peut exploser, en 2-3 phrases percutantes qui reprennent l'angle stratégique","hooks":[{"style":"Type de hook","texte":"le hook complet et percutant"}],"script":[{"temps":"0-3 sec","texte":"...","visuel":"${estFaceless ? "ce qu'on voit à l'écran" : "comment se filmer pour ce bloc"}"}],"legende":"légende prête à copier avec CTA fort, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"]}

Génère exactement 5 hooks. Le script doit avoir ${wt.blocs} blocs et faire IMPÉRATIVEMENT entre ${wt.min} et ${wt.max} mots au total (vise ${Math.round((wt.min + wt.max) / 2)} mots). Compte tes mots avant de répondre. C'est la règle la plus importante.`;

    function scriptEstComplet(p) {
      return !!p && Array.isArray(p.script) && p.script.length > 0 && Array.isArray(p.hooks) && p.hooks.length > 0;
    }

    const writeRaw = await callAI(MODEL_CREATIF, 16000, writePrompt, undefined, rechercheWeb);
    let parsed = parseAIResponse(writeRaw);
    // Réponse tronquée (rare, mais arrive) : une nouvelle tentative silencieuse
    // avant de déranger le créateur avec une erreur qu'il devrait relancer lui-même.
    // parsed peut être un objet "vrai" mais incomplet (ex: {score:{...}} sans script)
    // si la réparation JSON a dû tronquer avant la fin — on vérifie donc les champs
    // essentiels, pas juste la présence de l'objet.
    if (!scriptEstComplet(parsed)) {
      // Recherche web désactivée sur cette tentative de secours : si le 1er
      // essai a échoué (souvent une réponse tronquée par le temps limite), la
      // priorité passe à FINIR le script plutôt qu'à revérifier des faits —
      // la recherche web ajoute justement le temps qui a fait échouer le 1er essai.
      const writeRawRetry = await callAI(MODEL_CREATIF, 16000, writePrompt, undefined, false);
      const parsedRetry = parseAIResponse(writeRawRetry);
      if (scriptEstComplet(parsedRetry)) parsed = parsedRetry;
    }
    if (!scriptEstComplet(parsed)) throw new Error('Réponse incomplète — réessaie, ce sera plus rapide');

    // ── SECOND BROUILLON : régénère UNE fois si le score global est < 90 ──
    // On garde la meilleure des deux versions. C'est un filet de variance
    // créative : parfois un 2e jet est simplement meilleur, au-delà de ce que
    // le Critique/Réviseur peut corriger sur un brouillon donné.
    function scoreGlobal(p) {
      if (!p || !p.score) return 100; // pas de score = on ne bloque pas
      const s = p.score;
      const vals = [s.viral, s.hook, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 100;
    }
    if (!repondreMaintenant && scoreGlobal(parsed) < 90) {
      try {
        const writeRaw2 = await callAI(MODEL_CREATIF, 16000, writePrompt, undefined, rechercheWeb);
        const parsed2 = parseAIResponse(writeRaw2);
        // On garde la meilleure des deux versions (jamais une version tronquée)
        if (scriptEstComplet(parsed2) && scoreGlobal(parsed2) > scoreGlobal(parsed)) {
          parsed = parsed2;
        }
      } catch(e) { /* si la 2e tentative échoue, on garde la première */ }
    }

    // ══════════════════════════════════════
    //  PHASES 3-4 (Critique + Réviseur) — le cœur du renforcement qualité.
    //  Le Critique cherche ACTIVEMENT les faiblesses, y compris en essayant
    //  de RÉFUTER le script (pourquoi un spectateur scrollerait avant la
    //  fin ?). Si un problème significatif ressort, le Réviseur réécrit
    //  UNIQUEMENT les segments faibles identifiés — jamais tout le script.
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

      // Qualité maximale : jusqu'à 2 rondes de critique + révision. Le créateur
      // peut couper court à tout moment via « Répondre maintenant » (le drapeau
      // repondreMaintenant, vérifié en tête de boucle).
      const MAX_PASSES_QUALITE = 2;
      for (let passe = 0; passe < MAX_PASSES_QUALITE; passe++) {
        if (repondreMaintenant) break; // l'utilisateur a demandé son brouillon maintenant
        // ══════════════════════════════════════
        //  PHASE 3 — LE CRITIQUE (agent indépendant)
        //  Juge le travail du rédacteur sans l'avoir écrit. Cherche
        //  volontairement les faiblesses plutôt que de valider par défaut.
        // ══════════════════════════════════════
        const scriptForReview = (parsed.script || []).map((s, i) => '[segment ' + i + ' — ' + s.temps + '] ' + s.texte).join('\n');
        const hooksForReview = (parsed.hooks || []).map((h, i) => (i + 1) + '. ' + h.texte).join('\n');

        const critiquePrompt = `Tu es le Critique Éditorial de Scriptura, un directeur éditorial exigeant et INDÉPENDANT. Tu n'as PAS écrit ce script — ton rôle est de chercher VOLONTAIREMENT ses faiblesses, jamais de le valider par complaisance. RÈGLE FONDAMENTALE : un script de Scriptura ne doit jamais ressembler à ce que produirait une IA généraliste. Si c'est le cas ici, dis-le sans détour.

CONTEXTE :
- Sujet : ${sujetCourt}
- Plateforme : ${state.plateforme}
- Objectif : ${state.objectif}
- Durée cible : ${wt.desc} (${wt.min}-${wt.max} mots)
- Angle stratégique prévu : ${brief.angle_choisi || 'non précisé'}

HOOKS PROPOSÉS (numérotés) :
${hooksForReview}

SCRIPT PROPOSÉ (segments numérotés, ne change jamais leur numéro) :
${scriptForReview}

TON TRAVAIL, EN TROIS TEMPS :

1. DÉTECTION DES FAIBLESSES — cherche, segment par segment : phrases génériques, clichés, longueurs inutiles, répétitions, révélations arrivées trop tôt (qui tuent la tension), baisses de tension, passages oubliables, formulations qui "sentent l'IA" (transitions plates, généralités creuses, ton neutre de manuel). Pour chaque faiblesse, indique le numéro du segment concerné.

2. RÉFUTATION — LE TEST LE PLUS IMPORTANT : essaie volontairement de RÉFUTER ce script. Cherche TOUTES les raisons concrètes pour lesquelles un spectateur ferait défiler la vidéo AVANT LA FIN (hook trop lent, promesse non tenue, passage à vide, prévisibilité, bloc trop long, perte d'intérêt...). Ne laisse la liste vide que si, après un examen sincère et sévère, tu n'as vraiment trouvé aucune raison valable.

3. CONTRÔLE DE VIRALITÉ ET ANTI-IA-GÉNÉRIQUE — note chacun de ces critères avec rigueur, sur 20 : force du hook, intensité de la curiosité créée, rythme narratif, progression dramatique, qualité des transitions, puissance de la révélation, mémorisation finale. Puis réponds honnêtement : ce script, tel quel, paraît-il avoir été écrit par une IA généraliste plutôt que par un storyteller TikTok spécialisé ?

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"verdict":"excellent" ou "à améliorer","note_globale":75,"faiblesses":["faiblesse précise avec le numéro de segment concerné"],"points_forts":["ce qui marche"],"segments_faibles":[{"index":2,"probleme":"description précise et actionnable du problème de ce segment"}],"raisons_de_scroll":["raison concrète 1","raison concrète 2"],"ia_generique":true,"justification_ia_generique":"pourquoi, en une phrase (chaîne vide si non générique)","viralite":{"hook":15,"curiosite":14,"rythme":16,"progression":15,"transitions":14,"revelation":13,"memorisation":15},"instructions_revision":"instructions précises et actionnables pour le réviseur, segment par segment"}`;

        let nouvelleCritique = null;
        try {
          const critiqueRaw = await callAI(MODEL_RAPIDE, 2500, critiquePrompt);
          nouvelleCritique = parseAIResponse(critiqueRaw);
        } catch(e) { /* si le critique échoue (même après réessais), on garde la meilleure version obtenue */ }

        if (!nouvelleCritique) break; // échec technique : on s'arrête là plutôt que de perdre du temps
        critique = nouvelleCritique;

        if (!critiqueIndiqueProbleme(critique)) break; // le script passe le contrôle qualité : terminé

        // ══════════════════════════════════════
        //  PHASE 4 — LE RÉVISEUR (agent indépendant)
        //  Réécrit UNIQUEMENT les segments identifiés comme faibles —
        //  jamais le script entier — pour ne jamais perdre ce qui marche.
        // ══════════════════════════════════════
        const segmentsFaiblesTxt = (critique.segments_faibles || [])
          .map(sf => '- Segment ' + sf.index + ' : ' + sf.probleme).join('\n')
          || (critique.faiblesses || []).map(f => '- ' + f).join('\n')
          || 'Aucun segment précis signalé — applique les instructions générales ci-dessous à l\'ensemble.';
        const raisonsScrollTxt = (critique.raisons_de_scroll || []).map(r => '- ' + r).join('\n');

        const revisePrompt = `Tu es le Réviseur en Chef de Scriptura, expert en réécriture CIBLÉE de contenu viral. Un critique indépendant a évalué le script ci-dessous. RÈGLE ABSOLUE : ne réécris QUE les segments identifiés comme faibles. Conserve TOUS les autres segments EXACTEMENT tels quels (même texte, même timing, même visuel) — ce sont les points forts du script, ne les abîme pas.

SUJET : ${sujetCourt} | PLATEFORME : ${state.plateforme} | OBJECTIF : ${state.objectif}
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
- Le hook doit arrêter le scroll, la tension tenir jusqu'au bout, le CTA final être présent et clair.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hooks":[{"style":"...","texte":"..."}],"script":[{"temps":"0-3 sec","texte":"...","visuel":"..."}]}

Fournis les 5 hooks (réécris-les aussi si le critique a signalé un problème de hook, sinon garde les meilleurs) et le script complet, segment par segment, dans le même ordre.`;

        try {
          const reviseRaw = await callAI(MODEL_CREATIF, 8000, revisePrompt);
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
        const completHooksPrompt = `Tu es le Rédacteur en Chef de Scriptura. Ce script a déjà ${parsed.hooks.length} hook(s) sur les 5 exigés. Génère les ${nbManquants} hook(s) manquant(s), qui arrêtent vraiment le scroll, mais RADICALEMENT différents des hooks déjà existants — jamais une reformulation proche, jamais une formule générique type ChatGPT.

SUJET : ${sujetCourt} | PLATEFORME : ${state.plateforme} | OBJECTIF : ${state.objectif}

HOOKS DÉJÀ EXISTANTS (ne les répète JAMAIS, ni ne t'en approche) :
${hooksExistantsTxt}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après, avec EXACTEMENT ${nbManquants} nouveau(x) hook(s) :
{"hooks":[{"style":"Type de hook","texte":"le hook complet"}]}`;
        const completHooksRaw = await callAI(MODEL_RAPIDE, 1200, completHooksPrompt);
        const completHooks = parseAIResponse(completHooksRaw);
        if (completHooks && Array.isArray(completHooks.hooks) && completHooks.hooks.length) {
          parsed.hooks = parsed.hooks.concat(completHooks.hooks.slice(0, nbManquants));
        }
      } catch (e) { /* on garde les hooks déjà obtenus si la complétion échoue */ }
    }

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
- Garde ${wt.blocs} blocs, un hook fort au début, un CTA clair à la fin
- Chaque phrase garde une fonction, zéro remplissage
- Contexte : ${state.plateforme}, objectif ${state.objectif}, sujet : ${sujetCourt}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"script":[{"temps":"0-3 sec","texte":"...","visuel":"..."}]}`;

      let correctedScript = null;
      try {
        const correctRaw = await callAI(MODEL_CREATIF, 8000, correctionPrompt);
        correctedScript = parseAIResponse(correctRaw);
      } catch(e) { break; /* en cas d'erreur (même après réessais), on garde la version actuelle */ }

      if (correctedScript && correctedScript.script) {
        parsed.script = correctedScript.script;
        wordCount = countScriptWords(parsed.script);
      } else {
        break; // parsing échoué, on garde la version actuelle
      }
    }

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
        themes_traites: sujet.slice(0, 80),
        plateformes: state.plateforme,
        // Anti-répétition (voir renforcement du pipeline) : mémorise l'angle,
        // la structure et le hook principal pour ne jamais les recycler
        // à l'identique lors d'une prochaine génération pour ce créateur.
        angles_recents: brief && brief.angle_choisi ? String(brief.angle_choisi).slice(0, 120) : undefined,
        structures_recentes: brief && brief.structure ? String(brief.structure).slice(0, 100) : undefined,
        hooks_recents: (parsed.hooks && parsed.hooks[0] && parsed.hooks[0].texte) ? String(parsed.hooks[0].texte).slice(0, 140) : undefined
      }
    });

  } catch(e) {
    errorBox.textContent = 'Erreur : ' + e.message;
    errorBox.style.display = 'block';
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
// Durée estimée (ms) de chaque type de génération, pour calibrer la montée de la barre vers 90%.
const GEN_DUREE = {
  script: 78000,
  story: 66000,
  ideas: 12000,
  audit: 18000,
  serie_creation: 30000,
  serie_episode: 30000
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
  story: [
    'Analyse du sujet et de sa tension…',
    'Choix du ton narratif…',
    'Écriture du hook percutant…',
    'Construction de l\'immersion…',
    'Montée de la tension…',
    'Ciselage de la chute et signature…',
    'Perfection narrative finale…'
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
  ]
};
const GEN_TAGLINE = {
  script: 'Ton équipe éditoriale IA au travail',
  ideas: 'Ton directeur éditorial cherche tes idées',
  story: 'Ton storyteller écrit ton récit',
  audit: 'Ton consultant TikTok établit ton diagnostic',
  serie_creation: 'Ton architecte narratif construit ta série',
  serie_episode: 'Ton scénariste écrit ton épisode'
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

  const steps = stepsContainer.querySelectorAll('.gen-step');
  overlay.classList.add('active');

  steps.forEach(s => s.classList.remove('active', 'done'));

  let current = 0;
  const total = steps.length;
  steps[0].classList.add('active');

  // Barre de progression IDENTIQUE au storyboard : monte jusqu'à 90% puis
  // saute à 100% pile quand le résultat est prêt (voir stopGenAnimation).
  const fill = document.getElementById('genProgressFill');
  const pctEl = document.getElementById('genProgressPct');
  if (genProgressCtl) genProgressCtl.stop();
  genProgressCtl = createProgress((p) => {
    if (fill) fill.style.width = p + '%';
    if (pctEl) pctEl.textContent = p + '%';
  }, GEN_DUREE[mode] || 45000);
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

  // Défilement des étapes textuelles (indépendant de la barre)
  genInterval = setInterval(() => {
    if (current < total - 1) {
      steps[current].classList.remove('active');
      steps[current].classList.add('done');
      current++;
      steps[current].classList.add('active');
    }
  }, 3200);
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

function renderResults(d, niche, sujet) {
  const list = document.getElementById('outputList');
  const section = document.getElementById('results');
  document.getElementById('resultsMeta').textContent = niche + ' · ' + state.plateforme;

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

  // Le formulaire de saisie (étape 4) n'a plus sa place une fois le résultat
  // affiché — seul le bouton "✎ Modifier" (voir modifierCriteresScript) le
  // fait réapparaître. Purement une classe CSS (voir showStep) : rien à
  // restaurer explicitement, showStep(4) la rétablit normalement.
  const step4 = document.getElementById('step4');
  if (step4) step4.classList.remove('active');

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
        <div class="legende-block">${d.analyse || ''}</div>
        ${lastGenContext && lastGenContext.brief && lastGenContext.brief.angle_choisi ? `
        <div class="strategy-block">
          <div class="strategy-item"><span class="strategy-tag">◆ Angle retenu</span>${lastGenContext.brief.angle_choisi}</div>
          ${lastGenContext.brief.structure ? `<div class="strategy-item"><span class="strategy-tag">◆ Structure</span>${lastGenContext.brief.structure}</div>` : ''}
          ${lastGenContext.brief.emotion_dominante ? `<div class="strategy-item"><span class="strategy-tag">◆ Émotion clé</span>${lastGenContext.brief.emotion_dominante}</div>` : ''}
        </div>` : ''}
      </div>`
    },
    {
      titre: "5 Hooks — Arrêter le scroll en 2 secondes",
      num: "02",
      content: `<div class="out-section">
        <div class="out-section-label">Hooks · Plusieurs styles</div>
        <div class="hooks-list" id="hooksList">${(d.hooks || []).map((h, i) => `
          <div class="hook-item" data-idx="${i}">
            <span class="hook-style">${h.style}</span>
            <span id="hookText${i}">${h.texte}</span>
          </div>`).join('')}
        </div>
      </div>`
    },
    {
      titre: "Script complet",
      num: "03",
      content: `<div class="out-section">
        <div class="out-section-label">Script · ${state.plateforme}</div>
        <div class="script-block" id="scriptBlock">${(d.script || []).map((s, i) => `
          <div class="script-row" data-idx="${i}">
            <div class="script-text" id="scriptText${i}">${s.texte}</div>
          </div>`).join('')}
        </div>
      </div>`
    },
    {
      titre: "Légende & Hashtags",
      num: "04",
      sansBoutonGenerique: true,
      content: `<div class="out-section">
        <div class="out-section-label">Légende</div>
        <div class="legende-block">${sansHashtags(d.legende || '')}</div>
        <div class="hashtags">${(d.hashtags || []).slice(0, 5).map(h => `<span class="ht">${h.toLowerCase()}</span>`).join('')}</div>
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
            ${t}
          </div>`).join('')}
        </div>
      </div>`
    },
    {
      titre: "Storyboard visuel",
      num: "05",
      content: `<div class="out-section">
        <p style="color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.6;margin-bottom:16px" id="sbDescP">Génère le découpage visuel plan par plan de ton script, avec un prompt d'image pour chaque segment.</p>
        <button class="btn-storyboard" id="sbGenerateBtn" onclick="generateStoryboard()">
          <span class="sb-gen-spinner" id="sbGenSpinner"></span>
          <span id="sbGenText">🎬 Générer le storyboard visuel</span>
        </button>
        <div class="sb-progress-bar" id="sbProgBar1" style="display:none">
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
  const prog = createProgress((p) => {
    const fill = document.getElementById('sbProgFill1');
    const pct = document.getElementById('sbProgPct1');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  });
  prog.start();

  const ctx = lastGenContext;
  const scriptText = currentScript.map(s => `[${s.temps}] ${s.texte}`).join('\n');
  const plat = ctx.plateforme || 'TikTok';

  const carteMiniature = (m) => `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${m}</div>
        ${blocGenImage(storeCopyText(m))}
      </div>`;
  const cartePlan = (i, p) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${p.duree || ''}</span>
          <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
        </div>
        <div class="sb-dit">"${p.text || ''}"</div>
        <div class="sb-visual-label">🎬 Prompt visuel</div>
        <div class="sb-visual">${p.visuel || ''}</div>
        ${blocGenImage(storeCopyText(p.visuel || ''))}
      </div>`;

  // Le conteneur (bouton, spinner, barre de progression compris) est remplacé
  // dès le départ par la grille progressive : le statut d'avancement et les
  // erreurs doivent donc désormais vivre DANS cette nouvelle grille, jamais
  // sur les anciens éléments (btn/spinner/genText), devenus détachés du DOM
  // une fois ce remplacement fait — sinon un échec en cours de lots restait
  // invisible pour l'utilisateur (spinner bloqué indéfiniment).
  const container = document.getElementById('storyboardContainer');
  container.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div>
    <div class="sb-statut" id="sbIdeeStatut">Scriptura crée le storyboard…</div>
    <div class="storyboard-list" id="sbIdeeGrid"></div>`;
  const grid = document.getElementById('sbIdeeGrid');
  const statut = document.getElementById('sbIdeeStatut');

  try {
    // Découpage narratif déterministe (js/storyboard.js), AVANT tout appel IA :
    // le nombre de plans n'est plus limité par ce qu'une seule requête peut
    // produire dans son budget de temps — les visuels sont générés par lots
    // (voir genererVisuelsParLots), donc un script long reste rapide et fiable.
    const plans = segmentNarrativeStoryboard(scriptText);
    if (!plans.length) throw new Error('Script vide');

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
    });
    await promesseMiniature;
    if (statut) statut.remove();

    prog.finish();
    setTimeout(() => { const pb = document.getElementById('sbProgBar1'); if (pb) pb.style.display = 'none'; }, 600);

    const tousLesPrompts2 = (miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + plans.map((p, i) => 'Plan ' + (i + 1) + ' : ' + (p.visuel || '')).join('\n\n');
    grid.insertAdjacentHTML('beforeend', `
      <div class="sb-actions-fin">
        <button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardIdee')">↻ Régénérer</button>
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tousLesPrompts2)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tousLesPrompts2)}')">${ICON_SHARE}</button>
      </div>`);

    // Sauvegarder le storyboard pour qu'il reste après réouverture — mêmes
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
    prog.stop();
    const pb1 = document.getElementById('sbProgBar1');
    if (pb1) setTimeout(() => { pb1.style.display = 'none'; }, 600);
    if (btn) btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (genText) genText.textContent = '🎬 Générer le storyboard visuel';
  }
}





function restart() {
  Object.keys(state).forEach(k => state[k] = '');
  document.getElementById('niche').value = '';
  document.getElementById('sujet').value = '';
  document.getElementById('audience').value = '';
  document.getElementById('format').value = '';
  document.getElementById('viralVideo').value = '';
  document.getElementById('viralVideoField').style.display = 'none';
  document.getElementById('results').style.display = 'none';
  showStep(1);
}

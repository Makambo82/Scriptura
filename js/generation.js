let ideaPlatform = '';
let ideaGoal = '';
let ideaTone = '';

function setupIdeaButtons() {
  const groups = [
    { id: 'ideaPlatformGrid', setter: v => ideaPlatform = v },
    { id: 'ideaGoalGrid', setter: v => ideaGoal = v },
    { id: 'ideaToneGrid', setter: v => ideaTone = v }
  ];
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

  const prompt = `Tu es le Directeur Éditorial de Scriptura, expert en contenu viral francophone et stratège TikTok. Tu génères des idées de vidéos VIRALES et NON GÉNÉRIQUES pour CE créateur précis — jamais une liste interchangeable qu'un autre créateur de la même niche pourrait recevoir à l'identique.

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

MISSION : Génère 12 idées de vidéos à FORT POTENTIEL VIRAL, dans cet ordre de pertinence.

RÈGLES ABSOLUES :
- INTERDIT les idées génériques ("Les 5 erreurs à éviter", "Comment réussir en...", "Mon top 10"). Ça, tout le monde le fait.
- Chaque idée doit avoir un ANGLE UNIQUE, une tension, quelque chose de surprenant ou contre-intuitif
- Les idées doivent exploiter des déclencheurs émotionnels (curiosité, choc, indignation, fascination, peur de rater)
- Adapte au style ${ideaTone || 'de la niche'} et à la plateforme ${ideaPlatform || 'sociale'}
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

Génère exactement 12 idées, toutes différentes, classées de la meilleure opportunité à la moins forte pour ce créateur précis.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 6000, prompt);
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
        ton_prefere: toneCourtDepuisGrille('ideaToneGrid'),
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
  const style    = document.getElementById('style').value.trim();
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
${style ? '- Style : ' + style : ''}
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
    const writePrompt = `Tu es le Rédacteur en Chef de Scriptura, capable de rivaliser avec les meilleurs créateurs à 500K+ abonnés. RÈGLE FONDAMENTALE, au-dessus de toutes les autres : ce script doit donner l'impression d'avoir été écrit par un excellent storyteller spécialisé TikTok — jamais par une IA généraliste. Tu reçois le brief stratégique du Directeur Éditorial. Tu dois maintenant EXÉCUTER ce brief avec une qualité exceptionnelle.

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
${selectedTone ? '- Ton : ' + selectedTone : ''}

RÈGLES ABSOLUES DE QUALITÉ (non négociables) :

1. RESPECT STRICT DE LA DURÉE (RÈGLE N°1 ABSOLUE) : Le script doit faire EXACTEMENT entre ${wt.min} et ${wt.max} mots au TOTAL (pour ${wt.desc}), répartis en ${wt.blocs} blocs.
   ⚠️ MÉTHODE OBLIGATOIRE : Avant de finaliser, COMPTE mot par mot le total de ton script. S'il fait moins de ${wt.min} mots, tu DOIS ajouter du contenu de valeur pour atteindre la cible. S'il dépasse ${wt.max}, tu DOIS couper. Ne rends JAMAIS un script hors de la fourchette ${wt.min}-${wt.max} mots.
   Un script de ${wt.desc} qui fait moins de ${wt.min} mots est un ÉCHEC TOTAL. Vise le milieu de la fourchette (environ ${Math.round((wt.min + wt.max) / 2)} mots).

2. CHAQUE PHRASE A UNE FONCTION : Interdiction absolue de phrase de remplissage. Chaque phrase doit soit accrocher, soit faire avancer, soit créer une tension, soit relancer. Si une phrase ne sert à rien, supprime-la.

3. TENSION DU DÉBUT À LA FIN : Applique la stratégie de rétention du brief. Place des relances ("mais attends...", "et c'est là que...", "sauf que...") pour que personne ne décroche.

4. CTA OBLIGATOIRE À LA FIN : Le DERNIER bloc du script DOIT contenir un appel à l'action clair et adapté à l'objectif "${state.objectif}". Jamais un "abonne-toi" générique. Le CTA doit dire précisément quoi faire ensuite :
- Objectif ventes → inciter à passer à l'action commerciale (lien, DM, commentaire déclencheur, offre)
- Objectif vues → inciter au partage ou à regarder une autre vidéo
- Objectif abonnés → donner une raison concrète de s'abonner (promesse de valeur future)
- Objectif autorité → inciter à commenter son avis ou sauvegarder
Le CTA doit être naturel, percutant, et donner envie d'agir MAINTENANT. C'est la partie qui transforme une vue en résultat. Ne termine JAMAIS un script sans CTA.

5. HOOKS DIFFÉRENCIANTS ET TESTÉS : Génère 5 hooks qui suivent la direction du brief. Avant de valider CHAQUE hook, teste-le mentalement : est-il prévisible ? Ressemble-t-il à un hook ChatGPT classique ("Voici 5 astuces", "Saviez-vous que", "Dans cette vidéo") ? Crée-t-il une vraie tension psychologique immédiate ? Ouvre-t-il une boucle de curiosité (une question implicite que le spectateur veut absolument voir résolue) ? Promet-il une révélation forte ? Un hook qui échoue à l'un de ces tests est REJETÉ — remplace-le avant de répondre. INTERDIT les formules génériques. Chaque hook doit être IMPOSSIBLE à confondre avec du ChatGPT basique.

6. ADAPTÉ À ${state.plateforme} : respecte les codes de rythme de cette plateforme.

7. ORIENTÉ OBJECTIF : tout sert "${state.objectif}" (ventes→conversion, vues→rétention, autorité→crédibilité, abonnés→attachement).

RÈGLES DE QUALITÉ À RESPECTER :
- Un simple prompt ChatGPT ne doit JAMAIS pouvoir reproduire ça. Sois nettement supérieur.
- Le hook doit vraiment arrêter le scroll.
- Le compte de mots doit être dans la cible ${wt.min}-${wt.max}.
- Le dernier bloc DOIT contenir un vrai CTA qui dit quoi faire.
- Chaque phrase a une fonction, aucun remplissage.
Écris ta MEILLEURE version — vise l'excellence absolue (score global 90-100). Chaque script doit être digne d'un créateur professionnel.

EVALUATION HONNETE DU SCORE : après avoir écrit, évalue ton propre travail avec RIGUEUR et HONNETETE, comme un critique exigeant. Ne gonfle pas les chiffres artificiellement : un bon score doit être MERITE par la qualité réelle du script.
- "viral" : potentiel de partage réel
- "hook" : le hook arrête-t-il vraiment le scroll en 2 secondes ?
- "engagement" : maintient-il l'attention sans temps mort ?
- "emotion" : provoque-t-il une vraie émotion ?
- "retention" : pourcentage (0-100) de spectateurs qui regarderont jusqu'au bout, selon la force du hook, le rythme et la promesse de la chute.
Si ton script ne mérite pas 90+, réécris-le AVANT de répondre jusqu'à ce qu'il soit réellement excellent.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"score":{"viral":85,"hook":90,"engagement":80,"emotion":88,"retention":82},"analyse":"pourquoi ce sujet+angle peut exploser, en 2-3 phrases percutantes qui reprennent l'angle stratégique","hooks":[{"style":"Type de hook","texte":"le hook complet et percutant"}],"script":[{"temps":"0-3 sec","texte":"...","visuel":"ce qu'on voit à l'écran"}],"legende":"légende prête à copier avec CTA fort, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"]}

Génère exactement 5 hooks. Le script doit avoir ${wt.blocs} blocs et faire IMPÉRATIVEMENT entre ${wt.min} et ${wt.max} mots au total (vise ${Math.round((wt.min + wt.max) / 2)} mots). Compte tes mots avant de répondre. C'est la règle la plus importante.`;

    const writeRaw = await callAI(MODEL_CREATIF, 8000, writePrompt);
    let parsed = parseAIResponse(writeRaw);
    if (!parsed) throw new Error('Réponse incomplète — réessaie, ce sera plus rapide');

    // ── SCORE RÉEL : régénère UNE fois si le score global est < 90 ──
    function scoreGlobal(p) {
      if (!p || !p.score) return 100; // pas de score = on ne bloque pas
      const s = p.score;
      const vals = [s.viral, s.hook, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 100;
    }
    if (scoreGlobal(parsed) < 90) {
      try {
        const writeRaw2 = await callAI(MODEL_CREATIF, 8000, writePrompt);
        const parsed2 = parseAIResponse(writeRaw2);
        // On garde la meilleure des deux versions
        if (parsed2 && parsed2.score && scoreGlobal(parsed2) > scoreGlobal(parsed)) {
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

      // Bornée à 1 passe (critique + révision au maximum une fois) pour
      // garder un temps de génération raisonnable : au pire 4 appels IA au
      // lieu de 2 avant, plutôt que 6. Toujours au moins un vrai contrôle
      // qualité indépendant, sans le temps d'attente d'une 2e itération.
      const MAX_PASSES_QUALITE = 1;
      for (let passe = 0; passe < MAX_PASSES_QUALITE; passe++) {
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
          const critiqueRes = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL_RAPIDE,
              max_tokens: 2500,
              messages: [{ role: "user", content: critiquePrompt }]
            })
          });
          if (critiqueRes.ok) {
            const critiqueData = await critiqueRes.json();
            const critiqueRaw = critiqueData.content?.map(b => b.text || '').join('') || '';
            nouvelleCritique = parseAIResponse(critiqueRaw);
          }
        } catch(e) { /* si le critique échoue, on garde la meilleure version obtenue */ }

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
          const reviseRes = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: MODEL_CREATIF,
              max_tokens: 8000,
              messages: [{ role: "user", content: revisePrompt }]
            })
          });
          if (!reviseRes.ok) break;
          const reviseData = await reviseRes.json();
          const reviseRaw = reviseData.content?.map(b => b.text || '').join('') || '';
          const revised = parseAIResponse(reviseRaw);
          if (revised && revised.script) {
            parsed.script = revised.script;
            if (revised.hooks) parsed.hooks = revised.hooks;
          } else {
            break; // réponse illisible : on garde la meilleure version obtenue plutôt que de la perdre
          }
        } catch(e) { break; /* si la révision échoue, on garde la version précédente */ }
      }
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

    while ((wordCount < hardMin || wordCount > hardMax) && correctionAttempts < 2) {
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

      const correctRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_CREATIF,
          max_tokens: 8000,
          messages: [{ role: "user", content: correctionPrompt }]
        })
      });

      if (!correctRes.ok) break; // en cas d'erreur, on garde la version actuelle
      const correctData = await correctRes.json();
      const correctRaw = correctData.content?.map(b => b.text || '').join('') || '';
      const correctedScript = parseAIResponse(correctRaw);

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
    lastGenContext = { objectif: state.objectif, plateforme: state.plateforme, niche, sujet, audience, style, tone: selectedTone, duree: selectedDuree, brief: brief, critique: critique };
    currentScript = parsed.script;
    currentHooks = parsed.hooks;

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
        ton_prefere: toneCourtDepuisGrille('toneGrid'),
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
    }
  } finally {
    _regenGratuiteEnCours = false;
  }
}

let genInterval = null;

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
  audit: 'Ton consultant TikTok analyse ton compte',
  serie_creation: 'Ton architecte narratif construit ta série',
  serie_episode: 'Ton scénariste écrit ton épisode'
};

function startGenAnimation(mode) {
  mode = mode || 'script';
  const overlay = document.getElementById('genOverlay');
  const stepsContainer = document.getElementById('genSteps');
  const progress = document.getElementById('genProgress');
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
  progress.style.width = '0%';

  let current = 0;
  const total = steps.length;

  steps[0].classList.add('active');
  progress.style.width = (100 / total) + '%';

  genInterval = setInterval(() => {
    if (current < total - 1) {
      steps[current].classList.remove('active');
      steps[current].classList.add('done');
      current++;
      steps[current].classList.add('active');
      progress.style.width = ((current + 1) / total * 100) + '%';
    }
  }, 3200);
}

function stopGenAnimation() {
  const overlay = document.getElementById('genOverlay');
  const steps = document.querySelectorAll('.gen-step');
  const progress = document.getElementById('genProgress');

  if (genInterval) { clearInterval(genInterval); genInterval = null; }

  // Compléter toutes les étapes
  steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });
  progress.style.width = '100%';

  setTimeout(() => { overlay.classList.remove('active'); }, 400);
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

  // Réinitialiser le storyboard (bouton visible, conteneur vide) pour une nouvelle génération
  const sbBtn = document.getElementById('sbGenerateBtn');
  if (sbBtn) sbBtn.style.display = '';
  const sbCont = document.getElementById('storyboardContainer');
  if (sbCont) sbCont.innerHTML = '';

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
        <div class="hooks-list">${(d.hooks || []).map((h, i) => `
          <div class="hook-item" data-idx="${i}">
            <span class="hook-style">${h.style}</span>
            <span id="hookText${i}">${h.texte}</span>
            <div class="retouche-actions"><button class="btn-regenerate mini hook-retouche-btn" onclick="changerHook(${i})">🔄 Changer ce hook</button></div>
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
            <div class="retouche-actions">
              <button class="btn-regenerate mini" onclick="retoucherSegment(${i}, 'raccourcir')">✂️ Raccourcir</button>
              <button class="btn-regenerate mini" onclick="retoucherSegment(${i}, 'direct')">🎯 Plus direct</button>
            </div>
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
        <div id="storyboardContainer">
          <p style="color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.6;margin-bottom:16px">Génère le découpage visuel plan par plan de ton script, avec un prompt d'image pour chaque segment.</p>
          <button class="btn-storyboard" id="sbGenerateBtn" onclick="generateStoryboard()">
            <span class="sb-gen-spinner" id="sbGenSpinner"></span>
            <span id="sbGenText">🎬 Générer le storyboard visuel</span>
          </button>
          <div class="sb-progress-bar" id="sbProgBar1" style="display:none">
            <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="sbProgFill1"></div></div>
            <div class="sb-progress-bar-pct" id="sbProgPct1">0%</div>
          </div>
        </div>
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

// ── RETOUCHE CIBLÉE (script) ──
// Corrige un seul passage ou un seul hook sans relancer toute la génération.
// Gratuit et illimité (pas de vérification de quota) : c'est une petite
// retouche de texte, pas une nouvelle génération.
function nettoyerTexteRetouche(raw) {
  let t = (raw || '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  t = t.replace(/^["«]\s*/, '').replace(/\s*["»]$/, '');
  return t.trim();
}

async function retoucherSegment(index, action) {
  if (!currentScript || !currentScript[index]) return;
  const row = document.querySelector('.script-row[data-idx="' + index + '"]');
  const textEl = document.getElementById('scriptText' + index);
  if (!row || !textEl) return;
  const boutons = row.querySelectorAll('.retouche-actions button');

  const original = currentScript[index].texte;
  const consigne = action === 'raccourcir'
    ? 'Raccourcis ce passage : garde le sens et l\'essentiel, élimine tout mot superflu, sans perdre d\'information importante.'
    : 'Rends ce passage plus direct et percutant : phrases plus courtes, moins de détours, va droit à l\'essentiel, garde le même sens.';

  boutons.forEach(b => b.disabled = true);
  textEl.style.opacity = '0.5';

  const ctx = lastGenContext || {};
  const prompt = `Tu es le Réviseur en Chef de Scriptura. Retouche UNIQUEMENT le passage suivant, sans rien ajouter d'autre autour.

CONTEXTE : sujet "${ctx.sujet || ''}", plateforme ${ctx.plateforme || ''}, objectif "${ctx.objectif || ''}".

PASSAGE ACTUEL :
${original}

CONSIGNE : ${consigne}

Réponds UNIQUEMENT avec le nouveau texte du passage, sans guillemets, sans commentaire, sans rien avant ni après.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 600, prompt);
    const nouveau = nettoyerTexteRetouche(raw);
    if (!nouveau) throw new Error('réponse vide');
    currentScript[index].texte = nouveau;
    textEl.textContent = nouveau;
    copyTexts[2] = (currentScript || []).map(s => '[' + s.temps + ']\n' + s.texte).join('\n\n');
    sauvegarderRetouche();
  } catch (e) {
    toastRegen('Retouche impossible, réessaie');
  } finally {
    textEl.style.opacity = '';
    boutons.forEach(b => b.disabled = false);
  }
}

async function changerHook(index) {
  if (!currentHooks || !currentHooks[index]) return;
  const item = document.querySelector('.hook-item[data-idx="' + index + '"]');
  const textEl = document.getElementById('hookText' + index);
  if (!item || !textEl) return;
  const btn = item.querySelector('.hook-retouche-btn');

  const original = currentHooks[index];
  const autresHooks = currentHooks.map(h => h.texte).filter((t, i) => i !== index && t);

  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  textEl.style.opacity = '0.5';

  const ctx = lastGenContext || {};
  const prompt = `Tu es le Rédacteur en Chef de Scriptura. Propose UNE nouvelle version du hook suivant, dans le même style ("${original.style || ''}"), mais avec une formulation différente et plus forte.

CONTEXTE : sujet "${ctx.sujet || ''}", plateforme ${ctx.plateforme || ''}, objectif "${ctx.objectif || ''}".

HOOK ACTUEL : "${original.texte || ''}"
${autresHooks.length ? 'AUTRES HOOKS DÉJÀ PROPOSÉS, à ne surtout pas reproduire : ' + autresHooks.join(' / ') : ''}

CONSIGNE : le nouveau hook doit arrêter le scroll en 2 secondes, créer une vraie tension ou curiosité, ne jamais ressembler à une formule générique ("Voici pourquoi...", "Saviez-vous que...", "Dans cette vidéo...").

Réponds UNIQUEMENT avec le nouveau texte du hook, sans guillemets, sans commentaire.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 300, prompt);
    const nouveau = nettoyerTexteRetouche(raw);
    if (!nouveau) throw new Error('réponse vide');
    currentHooks[index].texte = nouveau;
    textEl.textContent = nouveau;
    copyTexts[1] = currentHooks.map(h => h.style + ' :\n' + h.texte).join('\n\n');
    sauvegarderRetouche();
  } catch (e) {
    toastRegen('Impossible de changer ce hook, réessaie');
  } finally {
    textEl.style.opacity = '';
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Changer ce hook'; }
  }
}

async function generateStoryboard() {
  if (!lastGenContext || !currentScript) return;
  if (!_regenGratuiteEnCours) resetRegen('storyboardIdee');

  const btn = document.getElementById('sbGenerateBtn');
  const spinner = document.getElementById('sbGenSpinner');
  const genText = document.getElementById('sbGenText');
  btn.disabled = true;
  spinner.style.display = 'none';
  genText.textContent = 'Scriptura crée le storyboard…';
  const progBar = document.getElementById('sbProgBar1');
  if (progBar) progBar.style.display = 'flex';
  const prog = createProgress((p) => {
    const fill = document.getElementById('sbProgFill1');
    const pct = document.getElementById('sbProgPct1');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  });
  prog.start();

  const ctx = lastGenContext;
  const scriptText = currentScript.map(s => `[${s.temps}] ${s.texte}`).join('\n');
  // Nombre de segments proportionnel à la longueur du script
  const nbMots = scriptText.split(/\s+/).filter(Boolean).length;
  const segMin = Math.max(3, Math.round(nbMots / 18));   // ~18 mots par segment
  const segMax = Math.max(segMin + 1, Math.round(nbMots / 11)); // ~11 mots par segment

  const prompt = `Tu es Scriptura, directeur artistique IA expert en storyboard cinematique pour contenu viral.

Voici le script d'une video pour ${ctx.plateforme} sur : ${ctx.sujet}

SCRIPT :
${scriptText}

MISSION : Decoupe ce script en segments visuels. Le NOMBRE de segments doit s'adapter A LA LONGUEUR du script : vise entre ${segMin} et ${segMax} segments pour ce script precis (ni plus, ni moins). Un script court = peu de segments, un script long = plus de segments. Chaque segment couvre une idee complete (environ 3 a 5 secondes de narration). Ne gonfle JAMAIS artificiellement le nombre de plans.

REGLE DE DECOUPAGE (TRES IMPORTANT) : RESPECTE ABSOLUMENT LES UNITES DE SENS. Ne coupe JAMAIS une phrase ou une idee au milieu. Chaque segment doit contenir une pensee complete et coherente. Si une phrase est trop longue, coupe-la a un endroit NATUREL (apres une virgule, une articulation logique), jamais en plein milieu d'une idee. Un decoupage comme "Et partage cette video a quelqu'un" / "qui en a besoin" est INTERDIT : ces morceaux forment une seule idee et restent ensemble. Privilegie la coherence du sens sur la duree exacte.

STRUCTURE OBLIGATOIRE DE CHAQUE PROMPT VISUEL (integre ces 4 dimensions de facon FLUIDE et naturelle, en une description continue, SANS jamais ecrire les etiquettes) :
1. LE DECOR : le lieu precis, l'epoque, l'ambiance globale de la scene
2. LA MATIERE : les details de structure, les materiaux, les textures
3. LES PERSONNAGES : leur titre/fonction, age, apparence physique, et SURTOUT leurs vetements precis ainsi que leurs gestes et postures
4. LA VIE DE LA SCENE : les elements secondaires (inscriptions, objets, foule…), la gestion de la lumiere et des ombres

Le prompt doit se lire comme une description cinematographique fluide et immersive, jamais comme une liste. Il doit etre riche, precis, anti-scroll, et illustrer les mots exacts prononces pour maximiser la retention. JAMAIS generique (interdit : "une personne qui parle", "un fond").

REGLE SUR LES SCENES MULTIPLES (IMPORTANT) : Si un plan montre plusieurs scenes ou plusieurs moments sur une meme image, ne les separe JAMAIS par une ligne nette, un cadre, un split-screen graphique ou une bordure. Les differentes scenes doivent etre FONDUES ensemble par une transition douce : un fondu stylise en degrade, une fusion progressive des lumieres et des couleurs, ou un raccord visuel fluide. Precise explicitement dans le prompt que les scenes se fondent l'une dans l'autre par un degrade harmonieux, sans separation graphique visible.

FOOTER TECHNIQUE OBLIGATOIRE : termine CHAQUE prompt visuel par " 9:16".

MINIATURE (TRES IMPORTANT) : en plus des segments, cree UN prompt visuel special pour la MINIATURE (image de couverture) de la video. Cette miniature doit etre CAPTIVANTE et ANTI-SCROLL : une image forte qui donne immediatement envie de cliquer, avec un sujet central percutant, une emotion visible, des couleurs contrastees, une composition qui accroche l'oeil en une fraction de seconde. Elle resume la promesse de la video. Termine ce prompt par " 9:16".

Reponds UNIQUEMENT en JSON valide sans texte avant ni apres :
{"miniature":"le prompt de miniature captivant et anti-scroll se terminant par 9:16","storyboard":[{"segment":"0-4 sec","texte_dit":"...","prompt_visuel":"le prompt riche et fluide se terminant par 9:16"}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 8000, prompt);
    const parsed = parseAIResponse(raw);
    // Moteur de découpage par image mentale (narration d'abord, durée en dernier)
    if (parsed && Array.isArray(parsed.storyboard)) parsed.storyboard = segmenterStoryboardScript(parsed.storyboard);
    if (!parsed || !parsed.storyboard) throw new Error('Réponse invalide');

    prog.finish(); // 100% pile au moment où le storyboard s'affiche
    setTimeout(() => { const pb = document.getElementById('sbProgBar1'); if (pb) pb.style.display = 'none'; }, 600);
    // Sauvegarder le storyboard pour qu'il reste après réouverture
    updateGenerationStoryboard({ storyboard: parsed.storyboard, miniature: parsed.miniature || null });
    const container = document.getElementById('storyboardContainer');
    const miniHtml = parsed.miniature ? `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${parsed.miniature}</div>
        ${blocGenImage(storeCopyText(parsed.miniature||''))}
      </div>` : '';
    const tousLesPrompts2 = (parsed.miniature ? 'MINIATURE : ' + parsed.miniature + '\n\n' : '') + parsed.storyboard.map((seg, i) => 'Plan ' + (i+1) + ' : ' + (seg.prompt_visuel||'')).join('\n\n');
    container.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-list">${miniHtml}${parsed.storyboard.map((seg, i) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${seg.segment}</span>
          <span class="sb-index">Plan ${String(i+1).padStart(2,'0')}</span>
        </div>
        <div class="sb-dit">"${seg.texte_dit}"</div>
        <div class="sb-visual-label">🎬 Prompt visuel</div>
        <div class="sb-visual">${seg.prompt_visuel}</div>
        ${blocGenImage(storeCopyText(seg.prompt_visuel||''))}
      </div>`).join('')}
      <div class="sb-actions-fin">
        <button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardIdee')">↻ Régénérer</button>
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tousLesPrompts2)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tousLesPrompts2)}')">${ICON_SHARE}</button>
      </div></div>`;
    // Le bouton "Générer le storyboard" a été remplacé par le storyboard lui-même.
    // Le bouton "Régénérer" (en bas du storyboard) prend désormais le relais.

  } catch(e) {
    if (typeof prog !== 'undefined') prog.stop();
    const pb = document.getElementById('sbProgBar1'); if (pb) pb.style.display = 'none';
    genText.textContent = 'Erreur, réessaie';
    btn.disabled = false;
    spinner.style.display = 'none';
    setTimeout(() => { genText.textContent = '🎬 Générer le storyboard visuel'; }, 2000);
  }
}





function restart() {
  Object.keys(state).forEach(k => state[k] = '');
  document.getElementById('niche').value = '';
  document.getElementById('sujet').value = '';
  document.getElementById('audience').value = '';
  document.getElementById('style').value = '';
  document.getElementById('viralVideo').value = '';
  document.getElementById('viralVideoField').style.display = 'none';
  document.getElementById('results').style.display = 'none';
  showStep(1);
}


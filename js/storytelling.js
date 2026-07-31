// ══════════════════════════════════════
//  GÉNÉRATEUR D'IDÉES
// ══════════════════════════════════════
// ══════════════════════════════════════
//  MODE STORYTELLING (STYLE MAKAMBO)
// ══════════════════════════════════════
let storyFormat = '';
let storyDuree = '';
let storyPlatform = '';
let currentStory = null;
let currentStoryText = '';

function setupStoryButtons() {
  // Format
  const fmtContainer = document.getElementById('storyFormatGrid');
  if (fmtContainer) {
    const fmtBtns = fmtContainer.querySelectorAll('.grid-btn');
    fmtBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        fmtBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storyFormat = btn.dataset.val;
        // Afficher le champ durée seulement si format court
        document.getElementById('storyDureeField').style.display = (storyFormat === 'court') ? 'block' : 'none';
      });
    });
  }
  // Durée
  const durContainer = document.getElementById('storyDureeGrid');
  if (durContainer) {
    const durBtns = durContainer.querySelectorAll('.grid-btn');
    durBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        durBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storyDuree = btn.dataset.val;
      });
    });
  }
  // Plateforme
  const pfContainer = document.getElementById('storyPlatformGrid');
  if (pfContainer) {
    const pfBtns = pfContainer.querySelectorAll('.grid-btn');
    pfBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        pfBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        storyPlatform = btn.dataset.val;
      });
    });
  }
}

function setStoryLoading(on) {
  const btn = document.getElementById('storyGenerateBtn');
  btn.disabled = on;
  document.getElementById('storySpinner').style.display = on ? 'block' : 'none';
  document.getElementById('storyBtnText').textContent = on ? 'Scriptura écrit ton récit…' : '✍️ Créer mon récit';
  if (on) startGenAnimation('story');
  else stopGenAnimation();
}

async function generateStory() {
  if (!_regenGratuiteEnCours) resetRegen('story');
  const input = document.getElementById('storyInput').value.trim();
  const errorBox = document.getElementById('storyErrorBox');
  errorBox.style.display = 'none';

  if (!input) {
    errorBox.textContent = 'Entre un sujet, une idée ou colle un texte pour créer ton récit.';
    errorBox.style.display = 'block'; return;
  }
  if (!storyFormat) {
    errorBox.textContent = 'Choisis un format : narratif long ou court.';
    errorBox.style.display = 'block'; return;
  }
  if (storyFormat === 'court' && !storyDuree) {
    errorBox.textContent = 'Choisis une durée pour le format court.';
    errorBox.style.display = 'block'; return;
  }

  // Vérification limite
  if (!unlocked && usedGen >= MAX_FREE) {
    openPlans('nouveau');
    return;
  }
  // Limite journalière pour les abonnés (anti-abus)
  if (!(await peutGenerer('storyErrorBox'))) return;

  setStoryLoading(true);
  document.getElementById('storyResults').style.display = 'none';

  // Cibles de mots pour le format court
  const wordTargets = {
    '30 secondes': { min: 60, max: 78 },
    '1 minute': { min: 130, max: 155 },
    '2 minutes': { min: 270, max: 310 },
    '3 minutes': { min: 410, max: 460 },
    '5 minutes': { min: 680, max: 780 }
  };
  const wt = wordTargets[storyDuree] || null;

  const longueurInstruction = storyFormat === 'court' && wt
    ? `LONGUEUR : Le récit doit faire ${storyDuree}, soit entre ${wt.min} et ${wt.max} mots au total. Compte tes mots et respecte impérativement cette cible. Condense ta méthode narrative pour tenir dans cette durée sans perdre en impact.`
    : `LONGUEUR : Format narratif long. Déploie pleinement ton histoire, sans restriction de durée. Prends le temps de développer l'immersion, la tension et les rebondissements comme dans un vrai récit captivant.`;

  // Choisir le modèle de référence le plus proche du sujet (via modeles.js)
  let modeleRef = '';
  try {
    if (typeof choisirModele === 'function') {
      const modele = choisirModele(input);
      if (modele) {
        modeleRef = `

════════════════════════════════════════════
MODÈLE DE RÉFÉRENCE (ta signature narrative sur un sujet proche)
Voici l'un de tes propres scripts, à utiliser comme RÉFÉRENCE ABSOLUE de style, de rythme, de ton et de structure. Ne le copie pas, mais IMPRÈGNE-toi de sa manière : la façon dont le hook frappe, dont les phrases sont courtes et rythmées, dont la tension monte, dont l'ironie affleure, dont la triple question et la signature closent le récit. Ton nouveau récit doit avoir EXACTEMENT ce niveau de qualité et cette voix.

TITRE DU MODÈLE : ${modele.titre}
TON : ${modele.ton}

SCRIPT MODÈLE :
${modele.script}
════════════════════════════════════════════
`;
      }
    }
  } catch(e) { /* si modeles.js absent, on continue avec la méthode seule */ }

  // Mémoire du créateur : voir js/profil.js — une ligne de contexte en plus,
  // sans toucher à la méthode narrative ni aux règles ci-dessous.
  const profilLigneStory = ligneProfilPourPrompt(await chargerProfilCreateur());

  const storyPrompt = `Tu es le meilleur storyteller narratif francophone, spécialisé dans les récits immersifs, critiques et stylisés pour les réseaux sociaux. Tu produis un script qui capte l'attention immédiatement, la maintient jusqu'à la fin, et marque émotionnellement le spectateur. Le spectateur doit VIVRE la scène, pas seulement la regarder.

SUJET / TEXTE FOURNI PAR L'UTILISATEUR :
"""
${input}
"""
${storyPlatform ? 'PLATEFORME : ' + storyPlatform : ''}
${profilLigneStory ? profilLigneStory : ''}
${modeleRef}
${longueurInstruction}

MÉTHODE NARRATIVE OBLIGATOIRE (ta signature) :

1. HOOK EN 2 PHRASES BRÈVES : paradoxal, choquant, dérangeant, fataliste ou intrigant. Il doit stopper le scroll immédiatement.
   Exemples du style : "Il n'a pas fait un braquage. Il a juste pris une décision." / "Il voulait devenir le guide du monde arabe. Il a fini lynché dans un tuyau." / "Ils ont vécu 24 ans sans lumière. Et personne n'a rien vu."

2. OUVERTURE : Enchaîne avec "Aujourd'hui, on parle de..." (ou variante fluide) qui pose le personnage ou l'enjeu.

3. CONTEXTE / PORTRAIT : Plante le décor, présente le personnage ou la situation de façon vivante et concrète.

4. IMMERSION EN SECONDE PERSONNE : Utilise "Imaginez, vous êtes..." pour plonger le spectateur DANS la scène. C'est un procédé signature essentiel. Fais-le vivre la situation de l'intérieur.

5. DÉTONATEUR : Une question, une révélation ou une accusation qui fait basculer le récit.

6. MONTÉE DE TENSION avec RELANCES régulières (tous les ~5 secondes de lecture) : des ruptures narratives, des cliffhangers, des "Mais...", "Et là...", "Sauf que...". Personne ne doit décrocher.

7. Le message clé doit apparaître AVANT la fin (pas de réserver tout le sens pour la conclusion).

8. Ajoute au moins un élément qui pousse à SAUVEGARDER : un fait rare, une citation mémorable, une révélation choc, un chiffre marquant.

9. CLÔTURE — TRIPLE QUESTION MIROIR (obligatoire) : Termine par trois questions qui créent une résonance émotionnelle ou intellectuelle, sous cette forme :
   "Alors, que retenir de cette histoire ?
   Que... ?
   Que... ?
   Ou que... ?"
   Ces questions doivent heurter, interpeller, et pousser à commenter/partager.

10. SIGNATURE MÉTAPOÉTIQUE (obligatoire, juste avant ou après la triple question) : Une phrase de forme fixe "Moi, je t'ai pas [X]. Je t'ai [Y]." — poétique, ironique, lucide, qui frappe fort en une seule image, adaptée au sujet.
    Exemple : "Moi, je t'ai pas raconté une fuite. Je t'ai montré ce que devient un empire quand il rentre dans une valise."

TON : Choisis le ton qui sert le mieux le sujet parmi : lucide, ironique, poétique, fataliste, grave, révolté, glacial. Adapte-le à la nature du sujet (un drame historique = poétique/tragique ; une affaire politique = tendu/critique ; un crime = glacial/narratif).

STYLE ET LANGUE :
- Français courant, compréhensible par un ado de 12 ans, avec de subtiles touches d'ironie qui font sourire.
- Phrases brèves et moyennes. Rythme soutenu. Images fortes. Ruptures marquées.
- AUCUN ton générique. Aucune formule plate.

EXIGENCE DE PERFECTION : Avant de livrer, relis ton récit. S'il n'atteint pas un niveau où un storyteller professionnel ne trouverait rien à améliorer, réécris-le. Vérifie que le hook arrête le scroll, que la tension tient du début à la fin, que la triple question et la signature sont présentes et percutantes.

EN PLUS DU RÉCIT, génère aussi :
- 5 HOOKS alternatifs (variations du hook d'ouverture, chacun dans un style différent mais gardant l'esprit paradoxal/choc)
- Une LÉGENDE prête à publier (accrocheuse, avec appel à commenter/partager)
- 8 HASHTAGS pertinents pour la portée

Vise l'excellence absolue (score global 90-100). EVALUATION HONNETE : évalue ton récit avec RIGUEUR, sans gonfler les chiffres. Le score doit être MERITE.
- "viral" : potentiel de partage
- "narration" : qualité du récit, de l'accroche à la chute
- "engagement" : capacité à retenir l'attention sans temps mort
- "emotion" : impact émotionnel réel
- "retention" : pourcentage (0-100) d'auditeurs qui écouteront jusqu'à la chute finale, selon la force de l'accroche, la tension maintenue et la promesse de résolution.
Si ton récit ne mérite pas 90+, réécris-le AVANT de répondre.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"titre":"un titre évocateur pour ce récit","ton":"le ton choisi","score":{"viral":90,"narration":92,"engagement":88,"emotion":91,"retention":85},"hooks":[{"style":"Type de hook","texte":"le hook complet"}],"recit":[{"segment":"Hook","texte":"..."},{"segment":"Contexte","texte":"..."},{"segment":"Immersion","texte":"..."},{"segment":"Tension","texte":"..."},{"segment":"Clôture","texte":"la triple question miroir + la signature métapoétique"}],"legende":"la légende prête à publier, SANS AUCUN hashtag dans le texte (les hashtags vont uniquement dans le champ hashtags séparé)","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"variantes_titre":["titre A percutant","titre B percutant"],"analyse":"analyse critique courte du récit et pourquoi il fonctionne"}

Génère exactement 5 hooks et 2 variantes de titre (A et B) percutantes et différentes à tester. Découpe le récit en segments : chaque segment doit correspondre à environ 5 à 7 secondes de narration à l'oral (soit ~13 à 18 mots par segment). Le nombre de segments s'adapte à la longueur totale du récit. Le dernier segment DOIT contenir la triple question miroir ET la signature métapoétique.`;

  try {
    const raw = await callAI(MODEL_CREATIF, 8000, storyPrompt);
    let parsed = parseAIResponse(raw);
    if (!parsed || !parsed.recit) throw new Error('Réponse incomplète, réessaie');

    // ── SCORE RÉEL : régénère UNE fois si le score global est < 90 ──
    function scoreGlobalStory(p) {
      if (!p || !p.score) return 100;
      const s = p.score;
      const vals = [s.viral, s.narration, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 100;
    }
    if (scoreGlobalStory(parsed) < 90) {
      try {
        const raw2 = await callAI(MODEL_CREATIF, 8000, storyPrompt);
        const parsed2 = parseAIResponse(raw2);
        if (parsed2 && parsed2.recit && parsed2.score && scoreGlobalStory(parsed2) > scoreGlobalStory(parsed)) {
          parsed = parsed2;
        }
      } catch(e) { /* garde la première version si échec */ }
    }

    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen); // met à jour le serveur (empreinte + IP)
      renderGenCounter();
      checkRappelAbonnement();
    }

    renderStory(parsed);
    setTimeout(updateScrollBtn, 300);
    saveGeneration('story', parsed.titre || input.slice(0, 60), parsed);
    updateQuotaJour();

    // Mémoire du créateur (tâche de fond, silencieuse).
    mettreAJourProfilCreateur({
      declare: { duree_moyenne: storyFormat === 'court' ? storyDuree : 'format long' },
      observe: {
        themes_traites: (parsed.titre || input.slice(0, 80)),
        plateformes: storyPlatform
      }
    });

  } catch(e) {
    errorBox.textContent = 'Erreur : ' + e.message;
    errorBox.style.display = 'block';
  } finally {
    setStoryLoading(false);
  }
}

function renderStory(d) {
  const out = document.getElementById('storyOutput');
  const fullText = (d.recit || []).map(s => s.texte).join('\n\n');

  // Stocker pour storyboard et copie
  currentStory = d;
  currentStoryText = fullText;

  // Réinitialiser le storyboard (bouton + texte visibles, conteneur vide) pour une nouvelle génération
  const sbBtnSt = document.getElementById('storyStoryboardBtn');
  if (sbBtnSt) {
    sbBtnSt.style.display = '';
    const descP = sbBtnSt.previousElementSibling;
    if (descP && descP.tagName === 'P') descP.style.display = '';
  }
  const sbContSt = document.getElementById('storyStoryboardOutput');
  if (sbContSt) sbContSt.innerHTML = '';

  // ── SCRIPTURA SCORE (adapté au récit) ──
  let scoreHTML = '';
  if (d.score) {
    const s = d.score;
    const vals = [s.viral, s.narration, s.engagement, s.emotion, s.retention].filter(v => typeof v === 'number');
    const globalScore = vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 0;
    scoreHTML = `
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
          ${metricBar('Force narrative', s.narration)}
          ${metricBar('Engagement', s.engagement)}
          ${metricBar('Force émotionnelle', s.emotion)}
          ${metricBar('Rétention estimée', s.retention)}
        </div>
      </div>`;
  }

  // Construire les sections (comme le mode script : accordéon avec +)
  const sections = [];

  // Section — titre + ton + analyse
  sections.push({
    titre: d.titre || 'Ton récit',
    content: `
      <div class="out-section">
        ${d.ton ? `<div class="story-meta"><span class="script-meta-item">🎭 Ton ${d.ton}</span></div>` : ''}
        ${d.analyse ? `<div class="legende-block" style="margin-top:14px">${d.analyse}</div>` : ''}
      </div>`
  });

  // Section — 5 hooks
  if (d.hooks && d.hooks.length) {
    sections.push({
      titre: '5 Hooks alternatifs',
      content: `
      <div class="out-section">
        <div class="out-section-label">Accroches · Plusieurs styles</div>
        <div class="hooks-list">${d.hooks.map((h, i) => `
          <div class="hook-item">
            <div class="hook-style">${h.style || ('Hook ' + (i+1))}</div>
            <div class="hook-text">${h.texte || ''}</div>
          </div>`).join('')}</div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText((d.hooks || []).map(h => h.texte||'').join('\n\n'))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText((d.hooks || []).map(h => h.texte||'').join('\n\n'))}')">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section — récit complet
  sections.push({
    titre: 'Le récit',
    content: `
      <div class="out-section">
        <div class="story-block">${(d.recit || []).map(s => `
          <div class="story-segment">
            <div class="story-segment-text">${(s.texte || '').replace(/\n/g, '<br/>')}</div>
          </div>`).join('')}</div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyStory(this)">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareStory(this)">${ICON_SHARE}</button></div>
      </div>`
  });

  // Section — Légende & Hashtags (ensemble)
  if (d.legende || (d.hashtags && d.hashtags.length)) {
    // 5 hashtags max, en minuscules
    const tags = (d.hashtags || []).slice(0, 5).map(t => t.toLowerCase());
    sections.push({
      titre: 'Légende & Hashtags',
      content: `
      <div class="out-section">
        ${d.legende ? `<div class="legende-block">${sansHashtags(d.legende)}</div>` : ''}
        ${tags.length ? `<div class="hashtags-wrap" style="margin-top:14px">${tags.map(t => `<span class="hashtag-chip">${t}</span>`).join('')}</div>` : ''}
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText(sansHashtags(d.legende || '') + (tags.length ? '\n\n' + tags.join(' ') : ''))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sansHashtags(d.legende || '') + (tags.length ? '\n\n' + tags.join(' ') : ''))}')">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section — Variantes A/B du titre
  if (d.variantes_titre && d.variantes_titre.length) {
    sections.push({
      titre: 'Variantes A/B du titre',
      content: `<div class="out-section">
        <div class="out-section-label">Titres alternatifs à tester</div>
        <div class="hooks-list">${(d.variantes_titre || []).map((t, i) => `
          <div class="hook-item">
            <span class="hook-style">Version ${i === 0 ? 'A' : 'B'}</span>
            ${t}
          </div>`).join('')}
        </div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, '${storeCopyText((d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'))}')">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText((d.variantes_titre || []).map((t,i) => 'Version ' + (i===0?'A':'B') + ' : ' + t).join('\n\n'))}')">${ICON_SHARE}</button></div>
      </div>`,
      sansBoutonGenerique: true
    });
  }

  // Section — storyboard à la demande
  sections.push({
    titre: 'Storyboard visuel',
    content: `
      <div class="out-section">
        <p style="color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.6;margin-bottom:16px">Génère le découpage visuel plan par plan de ton récit, avec un prompt d'image pour chaque segment.</p>
        <button class="btn-storyboard" id="storyStoryboardBtn" onclick="generateStoryStoryboard()">
          <div class="spinner" id="storyboardSpinner2" style="display:none"></div>
          <span id="storyStoryboardText">🎬 Générer le storyboard visuel</span>
        </button>
        <div class="sb-progress-bar" id="sbProgBar2" style="display:none">
          <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="sbProgFill2"></div></div>
          <div class="sb-progress-bar-pct" id="sbProgPct2">0%</div>
        </div>
        <div id="storyStoryboardOutput"></div>
      </div>`,
    sansBoutonGenerique: true
  });

  // Rendu : score en haut, puis accordéon (1re carte ouverte — clic sur + pour ouvrir)
  out.innerHTML = scoreHTML + sections.map((sec, i) => `
    <div class="out-card sb-appear${i === 0 ? ' open' : ''}" style="animation-delay:${(i + 1) * 0.12}s">
      <div class="out-header" onclick="toggleCard(this.parentElement)">
        <div class="out-title">${sec.titre}</div>
        <div class="out-toggle">+</div>
      </div>
      <div class="out-body">
        ${sec.content}
      </div>
    </div>`).join('');

  out.dataset.fulltext = fullText;

  // Animer les barres de score
  setTimeout(() => {
    document.querySelectorAll('#storyOutput .metric-fill').forEach(bar => {
      bar.style.width = bar.dataset.width + '%';
    });
  }, 100);

  pushNav();
  document.getElementById('storyResults').style.display = 'block';
  document.getElementById('storyResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


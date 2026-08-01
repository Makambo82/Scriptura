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

  // Présélection rapide (locale, sans appel IA) de plusieurs modèles de
  // référence candidats — voir choisirTopModeles() dans js/modeles.js. Le
  // choix final entre ces candidats est fait par le moteur Storytelling
  // lui-même, en silence, dans ce même appel (aucun appel supplémentaire).
  let modeleRef = '';
  try {
    if (typeof choisirTopModeles === 'function') {
      const candidats = choisirTopModeles(input, 3);
      if (candidats.length) {
        const blocsCandidats = candidats.map((m, i) =>
          `── CANDIDAT ${i + 1} ──\nTITRE : ${m.titre}\nTON : ${m.ton}\nSCRIPT :\n${m.script}`
        ).join('\n\n');
        modeleRef = `

════════════════════════════════════════════
MODÈLES DE RÉFÉRENCE CANDIDATS (ta propre signature narrative — ${candidats.length} option${candidats.length > 1 ? 's' : ''} pertinente${candidats.length > 1 ? 's' : ''} pour ce sujet)
${candidats.length > 1 ? 'AVANT D\'ÉCRIRE, choisis EN SILENCE (ne l\'annonce jamais dans ta réponse) celui des candidats ci-dessous dont la structure narrative, le rythme, la progression dramatique et la montée en tension serviront le mieux CE récit précis — pas seulement celui dont le thème ressemble le plus au sujet. Une fois ce choix fait, utilise EXCLUSIVEMENT ce modèle unique comme référence absolue de style, de rythme, de ton et de structure : ne mélange JAMAIS plusieurs modèles entre eux.' : 'Utilise ce script comme RÉFÉRENCE ABSOLUE de style, de rythme, de ton et de structure.'} Ne le copie pas, IMPRÈGNE-toi de sa manière : la façon dont le hook frappe, dont les phrases sont courtes et rythmées, dont la tension monte, dont l'ironie affleure, dont la triple question et la signature closent le récit. Ton nouveau récit doit avoir EXACTEMENT ce niveau de qualité et cette voix.

${blocsCandidats}
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

    lastStoryContext = { sujet: input, plateforme: storyPlatform };
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
        <div class="hooks-list" id="storyHooksList">${d.hooks.map((h, i) => `
          <div class="hook-item" data-idx="${i}">
            <div class="hook-style">${h.style || ('Hook ' + (i+1))}</div>
            <div class="hook-text" id="storyHookText${i}">${h.texte || ''}</div>
            <div class="retouche-actions"><button class="btn-regenerate mini story-hook-retouche-btn" onclick="changerHookStory(${i})">🔄 Changer ce hook</button></div>
          </div>`).join('')}</div>
        <div class="sb-actions-fin"><button class="icon-btn" title="Copier" onclick="copyText(this, texteHooksStory())">${ICON_COPY}</button><button class="icon-btn" title="Partager" onclick="shareText(this, texteHooksStory())">${ICON_SHARE}</button></div>
      </div>`
    });
  }

  // Section — récit complet
  sections.push({
    titre: 'Le récit',
    content: `
      <div class="out-section">
        <div class="story-block" id="storyRecitBlock">${(d.recit || []).map((s, i) => `
          <div class="story-segment" data-idx="${i}">
            <div class="story-segment-text" id="storySegText${i}">${(s.texte || '').replace(/\n/g, '<br/>')}</div>
          </div>`).join('')}</div>
        <div class="script-retouche-libre">
          <label class="idea-section-label" for="storyRetoucheInput">✏️ Demander une retouche</label>
          <textarea class="ctx-textarea" id="storyRetoucheInput" placeholder="Ex : le hook est trop long, raccourcis-le. Change la formulation du passage sur la tension."></textarea>
          <button class="btn-regenerate mini" id="storyRetoucheBtn" onclick="retoucherRecitLibre()">Appliquer les retouches</button>
        </div>
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

// ── RETOUCHE CIBLÉE (storytelling) ──
// Même principe que le mode script (js/generation.js) : un bouton par hook
// pour le régénérer, et un champ de texte libre pour retoucher le récit sans
// tout relancer. Gratuit et illimité, sauvegardé dans l'historique.

// Texte des hooks, calculé en direct (jamais figé au moment du rendu) pour
// que copier/partager reflète toujours la dernière version après retouche.
function texteHooksStory() {
  return ((currentStory && currentStory.hooks) || []).map(h => h.texte || '').join('\n\n');
}

async function changerHookStory(index) {
  if (!currentStory || !currentStory.hooks || !currentStory.hooks[index]) return;
  const item = document.querySelector('#storyHooksList .hook-item[data-idx="' + index + '"]');
  const textEl = document.getElementById('storyHookText' + index);
  if (!item || !textEl) return;
  const btn = item.querySelector('.story-hook-retouche-btn');

  const original = currentStory.hooks[index];
  const autresHooks = currentStory.hooks.map(h => h.texte).filter((t, i) => i !== index && t);

  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  textEl.style.opacity = '0.5';

  const ctx = lastStoryContext || {};
  const prompt = `Tu es le meilleur storyteller narratif francophone de Scriptura. Propose UNE nouvelle version du hook suivant, dans le même style ("${original.style || ''}"), mais avec une formulation différente et plus forte — paradoxale, choquante, dérangeante, fataliste ou intrigante, comme "Il n'a pas fait un braquage. Il a juste pris une décision."

CONTEXTE : sujet "${ctx.sujet || ''}", plateforme ${ctx.plateforme || ''}.

HOOK ACTUEL : "${original.texte || ''}"
${autresHooks.length ? 'AUTRES HOOKS DÉJÀ PROPOSÉS, à ne surtout pas reproduire : ' + autresHooks.join(' / ') : ''}

Réponds UNIQUEMENT avec le nouveau texte du hook, sans guillemets, sans commentaire.`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 300, prompt);
    const nouveau = nettoyerTexteRetouche(raw);
    if (!nouveau) throw new Error('réponse vide');
    currentStory.hooks[index].texte = nouveau;
    textEl.textContent = nouveau;
    sauvegarderRetoucheStory();
  } catch (e) {
    toastRegen('Impossible de changer ce hook, réessaie');
  } finally {
    textEl.style.opacity = '';
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Changer ce hook'; }
  }
}

function rerenderStoryHooksList(avant) {
  const list = document.getElementById('storyHooksList');
  if (!list || !currentStory || !currentStory.hooks) return;
  list.innerHTML = currentStory.hooks.map((h, i) => `
    <div class="hook-item" data-idx="${i}">
      <div class="hook-style">${h.style || ('Hook ' + (i + 1))}</div>
      <div class="hook-text${avant && avant[i] !== h.texte ? ' retouche-flash' : ''}" id="storyHookText${i}">${h.texte || ''}</div>
      <div class="retouche-actions"><button class="btn-regenerate mini story-hook-retouche-btn" onclick="changerHookStory(${i})">🔄 Changer ce hook</button></div>
    </div>`).join('');
}

function rerenderRecitBlock(avant) {
  const block = document.getElementById('storyRecitBlock');
  if (!block || !currentStory || !currentStory.recit) return;
  block.innerHTML = currentStory.recit.map((s, i) => `
    <div class="story-segment" data-idx="${i}">
      <div class="story-segment-text${avant && avant[i] !== s.texte ? ' retouche-flash' : ''}" id="storySegText${i}">${(s.texte || '').replace(/\n/g, '<br/>')}</div>
    </div>`).join('');
}

async function retoucherRecitLibre() {
  const input = document.getElementById('storyRetoucheInput');
  const btn = document.getElementById('storyRetoucheBtn');
  if (!input || !btn || !currentStory || !currentStory.recit) return;
  const instructions = input.value.trim();
  if (!instructions) { input.focus(); return; }

  const avantRecit = currentStory.recit.map(s => s.texte);
  const avantHooks = ((currentStory.hooks) || []).map(h => h.texte);

  const label = btn.textContent;
  btn.disabled = true;
  input.disabled = true;
  btn.textContent = 'Application des retouches…';

  const ctx = lastStoryContext || {};
  const hooksNum = (currentStory.hooks || []).map((h, i) => (i + 1) + '. [' + (h.style || '') + '] ' + h.texte).join('\n');
  const recitNum = currentStory.recit.map((s, i) => '[segment ' + i + ' — ' + (s.segment || '') + '] ' + s.texte).join('\n');

  const prompt = `Tu es le meilleur storyteller narratif francophone de Scriptura. Le créateur a relu son récit et te demande des retouches précises, en langage libre. Applique UNIQUEMENT ce qu'il demande — ne touche à rien d'autre.

CONTEXTE : sujet "${ctx.sujet || ''}", plateforme ${ctx.plateforme || ''}.

HOOKS ACTUELS (numérotés) :
${hooksNum || 'aucun'}

RÉCIT ACTUEL (segments numérotés, ne change jamais leur numéro ni leur fonction narrative) :
${recitNum}

DEMANDES DU CRÉATEUR (peuvent viser un ou plusieurs hooks, un ou plusieurs segments du récit, ou les deux — identifie précisément ce qui est visé par chaque demande) :
"${instructions}"

RÈGLES :
- N'applique QUE ce que le créateur demande. Une demande sur un hook ne touche que ce hook. Une demande sur un segment ne touche que ce segment.
- Tout ce qui n'est concerné par aucune demande doit être recopié EXACTEMENT à l'identique (même texte, même style de hook).
- Si le segment "Clôture" est retouché, conserve impérativement la triple question miroir et la signature métapoétique qui y figurent, sauf si la demande porte explicitement dessus.
- Si une demande est ambiguë (ex. "le hook" sans préciser lequel), applique-la à celui dont le contenu correspond le mieux.
- Renvoie la liste COMPLÈTE des hooks et des segments du récit, dans le même ordre, avec exactement le même nombre de chaque qu'actuellement.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"hooks":[{"style":"...","texte":"..."}],"recit":[{"segment":"...","texte":"..."}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 4000, prompt);
    const parsed = parseAIResponse(raw);
    if (!parsed || !Array.isArray(parsed.recit) || parsed.recit.length !== currentStory.recit.length) {
      throw new Error('réponse invalide');
    }
    if (Array.isArray(parsed.hooks) && currentStory.hooks && parsed.hooks.length === currentStory.hooks.length) {
      currentStory.hooks.forEach((h, i) => {
        if (parsed.hooks[i].texte) h.texte = parsed.hooks[i].texte;
        if (parsed.hooks[i].style) h.style = parsed.hooks[i].style;
      });
    }
    currentStory.recit.forEach((s, i) => { if (parsed.recit[i].texte) s.texte = parsed.recit[i].texte; });

    rerenderRecitBlock(avantRecit);
    rerenderStoryHooksList(avantHooks);
    currentStoryText = currentStory.recit.map(s => s.texte).join('\n\n');
    const out = document.getElementById('storyOutput');
    if (out) out.dataset.fulltext = currentStoryText;
    sauvegarderRetoucheStory();

    const inputApres = document.getElementById('storyRetoucheInput');
    if (inputApres) inputApres.value = '';
    toastRegen('Retouches appliquées');
  } catch (e) {
    toastRegen('Retouche impossible, réessaie');
  } finally {
    const btnApres = document.getElementById('storyRetoucheBtn');
    const inputApres = document.getElementById('storyRetoucheInput');
    if (btnApres) { btnApres.disabled = false; btnApres.textContent = label; }
    if (inputApres) inputApres.disabled = false;
  }
}


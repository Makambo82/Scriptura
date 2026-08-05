// ═══════════════════════════════════════════════════════════
//  MODULE STORYBOARD SEUL
//  Permet à un créateur qui a déjà un script écrit AILLEURS
//  (pas généré par Scriptura) de le coller et d'obtenir un
//  storyboard identique en tout point (découpage, règles,
//  structure des prompts) à celui des modes Script, Récit et Série.
//  Réutilise volontairement le même moteur (segmentNarrativeStoryboard
//  / segmenterStoryboardStory dans js/storyboard.js) et la même
//  structure de prompt que le mode Récit, qui est déjà conçu pour
//  partir d'un bloc de texte libre plutôt que d'un formulaire.
// ═══════════════════════════════════════════════════════════

let sbSeulPlatform = '';

function setupStoryboardSeulButtons() {
  const pfContainer = document.getElementById('sbSeulPlatformGrid');
  if (!pfContainer) return;
  const pfBtns = pfContainer.querySelectorAll('.grid-btn');
  pfBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      pfBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sbSeulPlatform = btn.dataset.val;
    });
  });
}

// Ouvre le module depuis le menu latéral
function openStoryboardSeul() {
  pushNav();
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('flow').style.display = 'none';
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('storyFlow').style.display = 'none';
  const afh = document.getElementById('auditFlow'); if (afh) afh.style.display = 'none';
  const sfh = document.getElementById('serieFlow'); if (sfh) sfh.style.display = 'none';
  const hfh = document.getElementById('historyFlow'); if (hfh) hfh.style.display = 'none';
  document.getElementById('storyboardSeulFlow').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function generateStoryboardSeul() {
  if (!_regenGratuiteEnCours) resetRegen('storyboardSeul');

  const input = document.getElementById('sbSeulInput').value.trim();
  const errorBox = document.getElementById('sbSeulErrorBox');
  errorBox.style.display = 'none';

  if (!input || input.split(/\s+/).filter(Boolean).length < 15) {
    errorBox.textContent = 'Colle un script complet (au moins quelques phrases) pour lancer le storyboard.';
    errorBox.style.display = 'block';
    return;
  }

  // Vérification limite (générations gratuites)
  if (!unlocked && usedGen >= MAX_FREE) {
    openPlans('nouveau');
    return;
  }
  // Limite mensuelle pour les abonnés (anti-abus)
  if (!(await peutGenerer('sbSeulErrorBox'))) return;

  const btn = document.getElementById('sbSeulGenerateBtn');
  const spinner = document.getElementById('sbSeulGenSpinner');
  const btnText = document.getElementById('sbSeulBtnText');
  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Scriptura crée le storyboard…';
  document.getElementById('sbSeulResults').style.display = 'none';

  const progBar = document.getElementById('sbProgBar3');
  if (progBar) progBar.style.display = 'flex';
  const prog = createProgress((p) => {
    const fill = document.getElementById('sbProgFill3');
    const pct = document.getElementById('sbProgPct3');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  });
  prog.start();

  const plat = sbSeulPlatform || 'TikTok';
  const segShort = ['TikTok', 'Instagram Reels', 'YouTube'].includes(plat);
  const segDuration = segShort ? '3 à 5 secondes' : '5 secondes';
  const nbMots = input.split(/\s+/).filter(Boolean).length;
  const segMin = Math.max(3, Math.round(nbMots / 14));
  const segMax = Math.max(segMin + 1, Math.round(nbMots / 9));

  // MÊME structure de prompt que generateStoryStoryboard (js/storyboard.js) :
  // mêmes règles de découpage par image mentale, mêmes 4 dimensions
  // obligatoires du prompt visuel, même footer technique, même miniature.
  const prompt = `Tu es un directeur artistique expert en storyboard vidéo cinématique pour ${plat}. Découpe ce script en segments visuels et écris pour chacun un prompt d'image d'une richesse exceptionnelle.

SCRIPT (fourni tel quel par l'utilisateur, à ne jamais réécrire ni résumer) :
"""
${input}
"""

RÈGLES DE DÉCOUPAGE (TRÈS IMPORTANT) :
- Le NOMBRE de segments doit s'adapter A LA LONGUEUR du script : vise entre ${segMin} et ${segMax} segments pour ce script précis. Un script court = peu de segments, un script long = plus. Ne gonfle JAMAIS artificiellement le nombre de plans.
- Chaque segment dure ${segDuration} maximum
- RESPECTE ABSOLUMENT LES UNITÉS DE SENS : ne coupe JAMAIS une phrase ou une idée au milieu. Chaque segment doit contenir une pensée complète et cohérente (une phrase entière, ou une proposition qui a du sens seule).
- Si une phrase est trop longue pour un seul segment, coupe-la à un endroit NATUREL (après une virgule, une pause logique, une articulation du sens) — jamais en plein milieu d'une idée.
- Un segment mal coupé comme "Et partage cette vidéo à quelqu'un" suivi de "qui en a besoin" est INTERDIT : ces deux morceaux forment une seule idée et doivent rester ensemble.
- Privilégie la cohérence du sens sur la durée exacte : mieux vaut un segment légèrement plus court ou plus long mais qui garde une idée complète.
- Pour chaque segment : le texte exact du script pour ce passage (ne le modifie pas) + un prompt visuel détaillé
- Respecte le nombre de segments indiqué ci-dessus (adapté à la longueur du script)

STRUCTURE OBLIGATOIRE DE CHAQUE PROMPT VISUEL (intègre ces 4 dimensions de façon FLUIDE et naturelle, en une description continue, SANS jamais écrire les étiquettes) :
1. LE DÉCOR : le lieu précis, l'époque, l'ambiance globale de la scène
2. LA MATIÈRE : les détails de structure, les matériaux, les textures
3. LES PERSONNAGES : leur titre/fonction, âge, apparence physique, et SURTOUT leurs vêtements précis ainsi que leurs gestes et postures
4. LA VIE DE LA SCÈNE : les éléments secondaires (inscriptions, objets, foule…), la gestion de la lumière et des ombres

Le prompt doit se lire comme une description cinématographique fluide et immersive, pas comme une liste. Chaque prompt doit être riche, précis, visuel, et permettre de générer une image spectaculaire qui empêche le scroll. Adapte l'ambiance au ton du script.

RÈGLE SUR LES SCÈNES MULTIPLES (IMPORTANT) : Si un plan montre plusieurs scènes ou plusieurs moments sur une même image, ne les sépare JAMAIS par une ligne nette, un cadre, un split-screen graphique ou une bordure. Les différentes scènes doivent être FONDUES ensemble par une transition douce : un fondu stylisé en dégradé, une fusion progressive des lumières et des couleurs, ou un raccord visuel fluide. Précise explicitement dans le prompt que les scènes se fondent l'une dans l'autre par un dégradé harmonieux, sans séparation graphique visible.

FOOTER TECHNIQUE OBLIGATOIRE : termine CHAQUE prompt visuel par " 9:16" (le format vertical).

MINIATURE (TRÈS IMPORTANT) : en plus des segments, crée UN prompt visuel spécial pour la MINIATURE (image de couverture). Elle doit être CAPTIVANTE et ANTI-SCROLL : une image forte qui donne immédiatement envie de cliquer, sujet central percutant, émotion visible, couleurs contrastées, composition qui accroche l'œil instantanément. Elle résume la promesse du script. Termine ce prompt par " 9:16".

EXEMPLE DE DÉCOUPAGE ATTENDU (respecte exactement cette granularité) :

Script source :
"Mnangagwa n'était pas juste un garde du corps. C'était l'ombre de Mugabe au sens littéral : présent à chaque exécution extrajudiciaire, à chaque séance d'interrogatoire aux sous-sols du palais, à chaque décision de disparition. Trente-sept ans à observer comment on brise un homme sans laisser de trace. Comment on terrorise une nation en silence. Comment on préserve le pouvoir en transformant la peur en routine."

Découpage CORRECT (chaque terme d'une série rhétorique = plan distinct) :
- "Mnangagwa n'était pas juste un garde du corps. C'était l'ombre de Mugabe au sens littéral :"
- "présent à chaque exécution extrajudiciaire,"
- "à chaque séance d'interrogatoire aux sous-sols du palais,"
- "à chaque décision de disparition."
- "Trente-sept ans à observer comment on brise un homme sans laisser de trace."
- "Comment on terrorise une nation en silence."
- "Comment on préserve le pouvoir en transformant la peur en routine."

Découpage INTERDIT (ne jamais fusionner les termes d'une anaphore) :
- "Mnangagwa n'était pas juste un garde du corps. C'était l'ombre de Mugabe au sens littéral : présent à chaque exécution extrajudiciaire, à chaque séance d'interrogatoire aux sous-sols du palais, à chaque décision de disparition."
- "Trente-sept ans à observer comment on brise un homme sans laisser de trace. Comment on terrorise une nation en silence. Comment on préserve le pouvoir en transformant la peur en routine."

RÈGLE : dès que deux phrases consécutives ouvrent sur le même mot ou le même patron (Comment…, Ces…, Que…, à chaque…, présent à…, Les…), chacune forme un plan à part entière, quelle que soit sa longueur.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"miniature":"le prompt de miniature captivant et anti-scroll se terminant par 9:16","storyboard":[{"segment":"1","duree":"0-3 sec","texte":"le texte narré","visuel":"le prompt visuel riche et fluide se terminant par 9:16"}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 16000, prompt);
    const parsed = parseAIResponse(raw);
    // Même moteur de découpage par image mentale que les autres modes
    if (parsed && Array.isArray(parsed.storyboard)) parsed.storyboard = segmenterStoryboardStory(parsed.storyboard);
    if (!parsed || !parsed.storyboard) throw new Error('Réponse incomplète');

    prog.finish();
    setTimeout(() => { const pb = document.getElementById('sbProgBar3'); if (pb) pb.style.display = 'none'; }, 600);

    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      renderGenCounter();
      checkRappelAbonnement();
    }

    const titre = 'Storyboard · ' + input.slice(0, 50).trim() + (input.length > 50 ? '…' : '');
    saveGeneration('storyboardSeul', titre, { script: input, plateforme: plat, storyboard_genere: { storyboard: parsed.storyboard, miniature: parsed.miniature || null } });
    updateQuotaJour();

    afficherStoryboardSeulResultat(parsed.storyboard, parsed.miniature || null);

  } catch (e) {
    errorBox.textContent = 'Erreur : ' + e.message + '. Réessaie.';
    errorBox.style.display = 'block';
  } finally {
    if (typeof prog !== 'undefined') prog.stop();
    const pb = document.getElementById('sbProgBar3'); if (pb) setTimeout(() => { pb.style.display = 'none'; }, 600);
    btn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = '🎬 Générer le storyboard';
  }
}

// Affiche le storyboard (nouvelle génération OU réouverture depuis l'historique)
// — même gabarit visuel que les modes Script/Récit.
function afficherStoryboardSeulResultat(board, miniature) {
  const out = document.getElementById('storyboardSeulOutput');
  if (!out) return;
  const miniHtml = miniature ? `
    <div class="sb-segment sb-miniature">
      <div class="sb-head">
        <span class="sb-time">★ Miniature</span>
        <span class="sb-index">Couverture</span>
      </div>
      <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
      <div class="sb-visual">${miniature}</div>
      ${blocGenImage(storeCopyText(miniature || ''))}
    </div>` : '';
  const sbFullText = (miniature ? `MINIATURE : ${miniature}\n\n` : '') + board.map((s, i) => `Plan ${s.segment || (i + 1)} (${s.duree || ''})\n${s.texte || ''}\nVisuel : ${s.visuel || ''}`).join('\n\n');
  out.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" style="margin-top:18px">${miniHtml}${board.map((s, i) => `
    <div class="sb-segment">
      <div class="sb-head">
        <span class="sb-time">${s.duree || ''}</span>
        <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
      </div>
      <div class="sb-dit">"${s.texte || ''}"</div>
      <div class="sb-visual-label">🎬 Prompt visuel</div>
      <div class="sb-visual">${s.visuel || ''}</div>
      ${blocGenImage(storeCopyText(s.visuel || ''))}
    </div>`).join('')}
    <div class="sb-actions-fin">
      <button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardSeul')">↻ Régénérer</button>
      <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(sbFullText)}')">${ICON_COPY}</button>
      <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sbFullText)}')">${ICON_SHARE}</button>
    </div></div>`;
  document.getElementById('sbSeulResults').style.display = 'block';
  setTimeout(updateScrollBtn, 300);
}

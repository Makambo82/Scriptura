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

// ═══════════════════════════════════════════════════════════
//  DÉTECTION : script déjà découpé et numéroté par l'utilisateur
//  Formats reconnus : "1.", "1)", "1 -", "1:", "1\n" en tête de segment,
//  avec au minimum 2 numéros non consécutifs détectés (ex. 1, 3, 5…).
//  Dès la détection, Scriptura BASCULE en mode "prompts seuls" :
//  aucun re-découpage, l'utilisateur est maître du séquençage.
// ═══════════════════════════════════════════════════════════

/**
 * Tente de parser un script numéroté.
 * Retourne un tableau [{num, texte}] ou null si le script n'est pas numéroté.
 */
function parseScriptNumerote(input) {
  // Regex : une ligne qui commence par un chiffre (seul ou multiple) suivi d'un séparateur
  const SEP = /^(\d+)\s*[.)\-:]\s+/;
  const lignes = input.split('\n');

  const segments = [];
  let numCourant = null;
  let texteCourant = [];

  for (const ligne of lignes) {
    const m = ligne.match(SEP);
    if (m) {
      // Sauvegarder le segment précédent
      if (numCourant !== null && texteCourant.join('').trim()) {
        segments.push({ num: numCourant, texte: texteCourant.join('\n').trim() });
      }
      numCourant = parseInt(m[1], 10);
      texteCourant = [ligne.replace(SEP, '').trim()];
    } else if (numCourant !== null) {
      // Suite du segment courant (texte multi-ligne)
      if (ligne.trim()) texteCourant.push(ligne.trim());
    }
  }
  // Dernier segment
  if (numCourant !== null && texteCourant.join('').trim()) {
    segments.push({ num: numCourant, texte: texteCourant.join('\n').trim() });
  }

  // Validation : au moins 2 segments détectés
  if (segments.length < 2) return null;

  // Validation : les numéros ne sont pas tous consécutifs de 1 (sinon c'est peut-être
  // une liste ordinaire, pas un storyboard numéroté). On accepte les deux cas —
  // l'important c'est qu'on a bien un découpage explicite.
  return segments;
}

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
  const adm = document.getElementById('adminFlow'); if (adm) adm.style.display = 'none';
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

  // ── DÉTECTION : script déjà numéroté ? ──────────────────────────────────
  const segmentsNumerotes = parseScriptNumerote(input);
  if (segmentsNumerotes) {
    // MODE PROMPTS SEULS : l'utilisateur a déjà découpé — Scriptura génère
    // uniquement les prompts visuels pour chaque segment tel quel.
    await generatePromptsSeulementPourSegmentsNumerotes(input, segmentsNumerotes);
    return;
  }
  // ── MODE NORMAL : l'IA découpe ET génère les prompts ────────────────────

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
  const prompt = `Tu es un directeur artistique expert en création d'images fixes pour ${plat}. Découpe ce script en segments visuels et écris pour chacun un prompt destiné à un générateur d'images (Midjourney, Firefly, Imagen…), d'une richesse exceptionnelle.

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
3. LES PERSONNAGES : leur titre/fonction, âge, apparence physique, et SURTOUT leurs vêtements précis ainsi que leurs gestes et postures. Si le segment mentionne un nom ou fait référence à un personnage précis (historique, public, fictif), nomme-le explicitement dans le prompt.
4. LA VIE DE LA SCÈNE : les éléments secondaires (inscriptions, objets, foule…), la gestion de la lumière et des ombres

Le prompt décrit une IMAGE FIXE unique — un instant figé, pas une séquence. Pas de mouvement de caméra, pas de transition, pas de durée. Écris une description spatiale et sensorielle immersive, comme si tu décrivais une peinture ou une photographie à couper le souffle. Chaque prompt doit permettre de générer une image spectaculaire qui empêche le scroll.

RÈGLE SUR LES SCÈNES MULTIPLES (IMPORTANT) : Si plusieurs éléments ou lieux doivent coexister, NE FAIS PAS de split, de double cadre, de juxtaposition ni aucune séparation visuelle. Garde LA SCÈNE PRINCIPALE et intègre les éléments secondaires de façon organique dans la même composition (arrière-plan, reflet, détail dans le décor…). Une seule image cohérente, pas de collage.

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
    assainirStoryboard(parsed);

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

// ═══════════════════════════════════════════════════════════
//  MODE SCRIPT PRÉ-DÉCOUPÉ : génère uniquement les prompts visuels
//  L'utilisateur a numéroté ses segments → Scriptura ne redécoupe RIEN.
//  Il génère un prompt visuel pour chaque segment tel quel.
// ═══════════════════════════════════════════════════════════

async function generatePromptsSeulementPourSegmentsNumerotes(input, segments) {
  const errorBox = document.getElementById('sbSeulErrorBox');
  const btn = document.getElementById('sbSeulGenerateBtn');
  const spinner = document.getElementById('sbSeulGenSpinner');
  const btnText = document.getElementById('sbSeulBtnText');

  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Génération des prompts visuels…';
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

  // On liste les segments numérotés pour l'IA avec leur numéro d'origine
  const listeSegments = segments
    .map(s => `Segment ${s.num} : "${s.texte}"`)
    .join('\n');

  const prompt = `Tu es un directeur artistique expert en création d'images fixes pour ${plat}.

L'utilisateur a déjà découpé son script en ${segments.length} segments numérotés. TON SEUL TRAVAIL est de générer un prompt d'image pour chaque segment, dans l'ordre exact fourni. Tu ne modifies pas le découpage, tu ne fusionnes ni ne divises aucun segment.

SEGMENTS À ILLUSTRER :
${listeSegments}

STRUCTURE OBLIGATOIRE DE CHAQUE PROMPT VISUEL (intègre ces 4 dimensions de façon FLUIDE et naturelle, en une description continue, SANS jamais écrire les étiquettes) :
1. LE DÉCOR : le lieu précis, l'époque, l'ambiance globale de la scène
2. LA MATIÈRE : les détails de structure, les matériaux, les textures
3. LES PERSONNAGES : leur titre/fonction, âge, apparence physique, et SURTOUT leurs vêtements précis ainsi que leurs gestes et postures. Si le segment mentionne un nom ou fait référence à un personnage précis (historique, public, fictif), nomme-le explicitement dans le prompt.
4. LA VIE DE LA SCÈNE : les éléments secondaires (inscriptions, objets, foule…), la gestion de la lumière et des ombres

Le prompt décrit une IMAGE FIXE unique — un instant figé, pas une séquence. Pas de mouvement de caméra, pas de transition, pas de durée. Écris une description spatiale et sensorielle immersive, comme si tu décrivais une peinture ou une photographie à couper le souffle. Chaque prompt doit permettre de générer une image spectaculaire qui empêche le scroll.

RÈGLE SUR LES SCÈNES MULTIPLES (IMPORTANT) : Si plusieurs éléments ou lieux doivent coexister, NE FAIS PAS de split, de double cadre, de juxtaposition ni aucune séparation visuelle. Garde LA SCÈNE PRINCIPALE et intègre les éléments secondaires de façon organique dans la même composition (arrière-plan, reflet, détail dans le décor…). Une seule image cohérente, pas de collage.

FOOTER TECHNIQUE OBLIGATOIRE : termine CHAQUE prompt visuel par " 9:16" (le format vertical).

MINIATURE : crée également UN prompt visuel spécial pour la MINIATURE (image de couverture). Elle doit être CAPTIVANTE et ANTI-SCROLL : une image forte qui donne immédiatement envie de cliquer, sujet central percutant, émotion visible, couleurs contrastées, composition qui accroche l'œil instantanément. Termine ce prompt par " 9:16".

CONSIGNE CRITIQUE : le tableau "storyboard" doit contenir EXACTEMENT ${segments.length} entrées, dans le même ordre, avec les mêmes numéros de segment que ceux fournis (${segments.map(s => s.num).join(', ')}). Ne modifie, ne fusionne, ne supprime aucun segment.

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"miniature":"le prompt de miniature captivant et anti-scroll se terminant par 9:16","storyboard":[{"segment":"${segments[0].num}","texte":"le texte exact du segment tel que fourni","visuel":"le prompt visuel riche et fluide se terminant par 9:16"}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 16000, prompt);
    const parsed = parseAIResponse(raw);

    // Vérification : on s'assure que l'IA n'a pas trahi le découpage
    // Si le nombre de segments retournés ne correspond pas, on reconstruit à partir de nos segments
    if (!parsed || !Array.isArray(parsed.storyboard)) throw new Error('Réponse incomplète');

    // Garantie absolue : si l'IA a renvoyé un nombre différent de segments,
    // on force le respect du découpage utilisateur en réassociant les prompts.
    let board = parsed.storyboard;
    if (board.length !== segments.length) {
      board = segments.map((seg, i) => {
        const match = parsed.storyboard.find(s => String(s.segment) === String(seg.num))
                   || parsed.storyboard[i]
                   || {};
        return {
          segment: String(seg.num),
          duree: match.duree || '',
          texte: seg.texte,
          visuel: match.visuel || ''
        };
      });
    } else {
      // Forcer le texte original de l'utilisateur (l'IA ne doit pas le modifier)
      board = board.map((s, i) => ({
        ...s,
        segment: String(segments[i].num),
        texte: segments[i].texte
      }));
    }

    // Assainir tous les prompts du board reconstruit
    const parsedFinal = { storyboard: board, miniature: parsed.miniature || null };
    assainirStoryboard(parsedFinal);
    board = parsedFinal.storyboard;

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
    saveGeneration('storyboardSeul', titre, { script: input, plateforme: plat, storyboard_genere: { storyboard: board, miniature: parsedFinal.miniature || null } });
    updateQuotaJour();

    afficherStoryboardSeulResultat(board, parsedFinal.miniature || null);

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
      <div class="sb-visual">${serieEsc(miniature)}</div>
      ${blocGenImage(storeCopyText(miniature || ''))}
    </div>` : '';
  const sbFullText = (miniature ? `MINIATURE : ${miniature}\n\n` : '') + board.map((s, i) => `Plan ${s.segment || (i + 1)} (${s.duree || ''})\n${s.texte || ''}\nVisuel : ${s.visuel || ''}`).join('\n\n');
  out.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" style="margin-top:18px">${miniHtml}${board.map((s, i) => `
    <div class="sb-segment">
      <div class="sb-head">
        <span class="sb-time">${s.duree || ''}</span>
        <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
      </div>
      <div class="sb-dit">"${serieEsc(s.texte)}"</div>
      <div class="sb-visual-label">🖼️ Prompt visuel</div>
      <div class="sb-visual">${serieEsc(s.visuel)}</div>
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

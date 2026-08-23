// ═══════════════════════════════════════════════════════════
//  MODULE STORYBOARD SEUL
//  Permet à un créateur qui a déjà un script écrit AILLEURS
//  (pas généré par Scriptura) de le coller et d'obtenir un
//  storyboard identique en tout point (découpage, règles,
//  structure des prompts) à celui des modes Script, Récit et Série.
//  Réutilise volontairement le même moteur (segmentNarrativeStoryboard,
//  genererVisuelsParLots dans js/storyboard.js) que le mode Récit, qui
//  est déjà conçu pour partir d'un bloc de texte libre plutôt que d'un
//  formulaire.
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
  // une liste ordinaire, pas un storyboard numéroté). On accepte les deux cas,
  // l'important c'est qu'on a bien un découpage explicite.
  return segments;
}

// Plateformes proposées par Storyboard seul (mêmes valeurs qu'avant la
// conversion en menu déroulant maison, voir platformPickerHTML/js/ui.js :
// "YouTube" et non "YouTube Shorts" comme le mode Script, pour ne rien
// changer aux storyboards déjà générés/enregistrés avec cette valeur).
const SB_SEUL_PLATEFORMES = ['TikTok', 'Instagram Reels', 'YouTube', 'Facebook'];

// Callback du menu déroulant plateforme (voir choisirPlateformeGenerique,
// js/ui.js) : stocke simplement le choix dans la variable d'état du module.
function sbSeulPlateformeChangee(val) {
  sbSeulPlatform = val;
}

// Repart d'un formulaire vide pour un nouveau storyboard, appelée à chaque
// entrée fraîche dans ce module (voir openStoryboardSeul juste en dessous) :
// sans ça, le script collé et la plateforme d'un storyboard précédent
// restaient silencieusement actifs pour le suivant, même sans rapport avec lui.
function restartStoryboardSeul() {
  document.getElementById('sbSeulInput').value = '';
  sbSeulPlatform = '';
  const pfHost = document.getElementById('sbSeulPlatformPickerHost');
  if (pfHost && typeof platformPickerHTML === 'function') {
    pfHost.innerHTML = platformPickerHTML('sbSeulPlatformPicker', '', SB_SEUL_PLATEFORMES, 'sbSeulPlateformeChangee');
  }
  const errorBox = document.getElementById('sbSeulErrorBox');
  if (errorBox) errorBox.style.display = 'none';
  const formCard = document.getElementById('sbSeulFormCard');
  if (formCard) formCard.style.display = '';
  document.getElementById('sbSeulResults').style.display = 'none';
}

// Ouvre le module depuis le menu latéral
function openStoryboardSeul() {
  pushNav();
  masquerTousLesEcrans();
  restartStoryboardSeul();
  // Menus Style + Format (reflètent le choix mémorisé) avant génération.
  const opt = document.getElementById('sbSeulOptionsVisuelles');
  if (opt && typeof optionsStoryboardHTML === 'function') opt.innerHTML = optionsStoryboardHTML();
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
    // MODE PROMPTS SEULS : l'utilisateur a déjà découpé, Scriptura génère
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

  const plat = sbSeulPlatform || 'TikTok';

  try {
    // Découpage narratif déterministe (js/storyboard.js), AVANT tout appel IA :
    // le nombre de plans n'est plus limité par ce qu'une seule requête peut
    // produire dans son budget de temps, les visuels sont générés par lots
    // (voir genererVisuelsParLots), donc un script long reste rapide et fiable.
    const plans = segmentNarrativeStoryboard(input);
    if (!plans.length) throw new Error('Script vide');

    const { miniature, grid } = await rendreStoryboardSeulProgressif(plans, plat, input);

    const board = plans.map((p, i) => ({ segment: String(i + 1), duree: p.duree, texte: p.text, visuel: p.visuel || '' }));

    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      renderGenCounter();
      checkRappelAbonnement();
    }

    const titre = 'Storyboard · ' + input.slice(0, 50).trim() + (input.length > 50 ? '…' : '');
    saveGeneration('storyboardSeul', titre, { script: input, plateforme: plat, storyboard_genere: { storyboard: board, miniature: miniature || null } });
    updateQuotaJour();

    ajouterActionsFinStoryboardSeul(grid, board, miniature, plans);

  } catch (e) {
    errorBox.textContent = 'Erreur : ' + e.message + '. Réessaie.';
    errorBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = 'Générer le storyboard';
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

  const plat = sbSeulPlatform || 'TikTok';

  try {
    // Le découpage est déjà celui de l'utilisateur (segments numérotés) : on
    // ne le touche jamais. Les visuels sont générés par lots (voir
    // genererVisuelsParLots, js/storyboard.js) au lieu d'un seul appel géant,
    // fiable quel que soit le nombre de segments fournis.
    const plansUtilisateur = segments.map(s => ({ text: s.texte, num: s.num }));

    const { miniature, grid } = await rendreStoryboardSeulProgressif(plansUtilisateur, plat, input);

    const board = plansUtilisateur.map(p => ({ segment: String(p.num), texte: p.text, visuel: p.visuel || '' }));

    if (!unlocked && !_regenGratuiteEnCours) {
      usedGen++;
      localStorage.setItem('scriptura_used', usedGen);
      bumpServerQuota(usedGen);
      renderGenCounter();
      checkRappelAbonnement();
    }

    const titre = 'Storyboard · ' + input.slice(0, 50).trim() + (input.length > 50 ? '…' : '');
    saveGeneration('storyboardSeul', titre, { script: input, plateforme: plat, storyboard_genere: { storyboard: board, miniature: miniature || null } });
    updateQuotaJour();

    ajouterActionsFinStoryboardSeul(grid, board, miniature, plansUtilisateur);

  } catch (e) {
    errorBox.textContent = 'Erreur : ' + e.message + '. Réessaie.';
    errorBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = 'Générer le storyboard';
  }
}

// ═══════════════════════════════════════════════════════════
//  AFFICHAGE PROGRESSIF + BARRE DE PROGRESSION
//  Même moteur et mêmes gabarits visuels que les modes Script/Récit/Série
//  (voir js/storyboard.js) : la barre de progression (sbProgBar3, définie
//  dans index.html) monte de façon crédible vers 90% pendant que l'IA
//  travaille, et les cartes de plans apparaissent lot par lot au fur et à
//  mesure, jamais toutes d'un coup à la toute fin.
// ═══════════════════════════════════════════════════════════
async function rendreStoryboardSeulProgressif(plans, plat, texteSource) {
  const btnText = document.getElementById('sbSeulBtnText');
  const progBar = document.getElementById('sbProgBar3');
  if (progBar) progBar.style.display = 'flex';
  const prog = createProgress((p) => {
    const fill = document.getElementById('sbProgFill3');
    const pct = document.getElementById('sbProgPct3');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  });
  prog.start();

  // Empile l'écran nu (formulaire encore visible ici) AVANT de passer au
  // résultat : un « ← Retour » depuis le résultat retombe ainsi sur ce même
  // écran, script encore rempli, jamais sur l'accueil (même mécanique que
  // lancerAnalyseVirale, js/viral.js, et lancerOutilTikTok, js/tiktok-outils.js).
  if (typeof pushNav === 'function') pushNav();
  masquerFormulaireGeneration('sbSeulFormCard');
  document.getElementById('sbSeulResults').style.display = 'block';
  const out = document.getElementById('storyboardSeulOutput');
  out.innerHTML = `<div class="sb-aide">${ICO('bulb')} Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" id="sbSeulGrid" style="margin-top:18px"></div>`;
  const grid = document.getElementById('sbSeulGrid');

  const carteMiniature = (m) => `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">${ICO('image')} Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${serieEsc(m)}</div>
        ${blocGenImage(storeCopyText(m))}
      </div>`;
  const cartePlan = (i, p) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${p.duree || ''}</span>
          <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
        </div>
        <div class="sb-dit">"${serieEsc(p.text || '')}"</div>
        <div class="sb-visual-label">${ICO('image')} Prompt visuel</div>
        <div class="sb-visual">${serieEsc(p.visuel || '')}</div>
        ${blocGenImage(storeCopyText(p.visuel || ''))}
      </div>`;

  let miniature = '';
  const promesseMiniature = genererMiniatureVisuelle(texteSource, plat).then(m => {
    miniature = m;
    if (m) grid.insertAdjacentHTML('afterbegin', carteMiniature(m));
  });

  await genererVisuelsParLots(plans, plat, (lot, indexDepart) => {
    const html = lot.map((p, k) => cartePlan(indexDepart + k, p)).join('');
    grid.insertAdjacentHTML('beforeend', html);
    const fait = Math.min(indexDepart + lot.length, plans.length);
    if (btnText) btnText.textContent = `Scriptura crée le storyboard… ${fait}/${plans.length} plans`;
  });
  await promesseMiniature;

  prog.finish();
  setTimeout(() => { const pb = document.getElementById('sbProgBar3'); if (pb) pb.style.display = 'none'; }, 600);

  return { miniature, grid };
}

// Ajoute les boutons Régénérer/Copier/Partager en fin de grille, une fois le
// storyboard complet, mêmes actions que afficherStoryboardSeulResultat.
function ajouterActionsFinStoryboardSeul(grid, board, miniature, plans) {
  const sbFullText = (miniature ? `MINIATURE : ${miniature}\n\n` : '') + board.map((s, i) => `Plan ${s.segment || (i + 1)} (${s.duree || ''})\n${s.texte || ''}\nVisuel : ${s.visuel || ''}`).join('\n\n');
  grid.insertAdjacentHTML('beforeend', `
    <div class="sb-actions-fin">
      <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(sbFullText)}')">${ICON_COPY}</button>
      <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sbFullText)}')">${ICON_SHARE}</button>
      ${montageBoutonHTML('montageBtnSeul', plans || board)}
    </div>
    ${typeof guideMontageBlocHTML === 'function' ? guideMontageBlocHTML('Seul', plans || board, '', updateGenerationGuideMontage) : ''}`);
  setTimeout(updateScrollBtn, 300);
}

// Affiche le storyboard déjà complet, utilisé UNIQUEMENT pour la
// réouverture depuis l'historique (voir js/historique.js) : ici tout est
// déjà connu, pas de progression à animer. La génération en direct utilise
// désormais rendreStoryboardSeulProgressif ci-dessus. Même gabarit visuel
// que les modes Script/Récit.
function afficherStoryboardSeulResultat(board, miniature, guideSauve) {
  const out = document.getElementById('storyboardSeulOutput');
  if (!out) return;
  masquerFormulaireGeneration('sbSeulFormCard');
  const miniHtml = miniature ? `
    <div class="sb-segment sb-miniature">
      <div class="sb-head">
        <span class="sb-time">★ Miniature</span>
        <span class="sb-index">Couverture</span>
      </div>
      <div class="sb-visual-label">${ICO('image')} Prompt de la miniature (anti-scroll)</div>
      <div class="sb-visual">${serieEsc(miniature)}</div>
      ${blocGenImage(storeCopyText(miniature || ''))}
    </div>` : '';
  const sbFullText = (miniature ? `MINIATURE : ${miniature}\n\n` : '') + board.map((s, i) => `Plan ${s.segment || (i + 1)} (${s.duree || ''})\n${s.texte || ''}\nVisuel : ${s.visuel || ''}`).join('\n\n');
  out.innerHTML = `<div class="sb-aide">${ICO('bulb')} Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" style="margin-top:18px">${miniHtml}${board.map((s, i) => `
    <div class="sb-segment">
      <div class="sb-head">
        <span class="sb-time">${s.duree || ''}</span>
        <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
      </div>
      <div class="sb-dit">"${serieEsc(s.texte)}"</div>
      <div class="sb-visual-label">${ICO('image')} Prompt visuel</div>
      <div class="sb-visual">${serieEsc(s.visuel)}</div>
      ${blocGenImage(storeCopyText(s.visuel || ''))}
    </div>`).join('')}
    <div class="sb-actions-fin">
      <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(sbFullText)}')">${ICON_COPY}</button>
      <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sbFullText)}')">${ICON_SHARE}</button>
      ${montageBoutonHTML('montageBtnSeul', board)}
    </div>
    ${typeof guideMontageBlocHTML === 'function' ? guideMontageBlocHTML('Seul', board, '', updateGenerationGuideMontage, guideSauve) : ''}</div>`;
  document.getElementById('sbSeulResults').style.display = 'block';
  setTimeout(updateScrollBtn, 300);
}

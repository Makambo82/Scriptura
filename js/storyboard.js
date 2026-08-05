// ═══════════════════════════════════════════════════════════
//  MOTEUR DE DÉCOUPAGE PAR IMAGE MENTALE
//  Règle : UN STORYBOARD = UNE SEULE IMAGE MENTALE.
//  Question centrale : « un seul visuel peut-il représenter ce passage ? »
//  Priorités : 1) image mentale 2) scène 3) idée 4) révélation
//              5) émotion 6) durée (EN DERNIER, simple ajustement)
// ═══════════════════════════════════════════════════════════

const MOTS_PAR_SEC = 2.8;   // rythme de narration posée
const DUREE_MIN = 2;        // un plan plus court n'est pas filmable (sauf effet)
const DUREE_MAX = 7;        // au-delà : plusieurs images cachées

// Découpe en phrases, ponctuation conservée
function splitIntoSentences(texte) {
  if (!texte || typeof texte !== 'string') return [];
  return (texte.replace(/\s+/g, ' ')
    .match(/[^.!?…]+[.!?…]+(?:["'»)\]]*)?|\S[^.!?…]*$/g) || [])
    .map(s => s.trim()).filter(Boolean);
}

function dureeDe(texte) {
  return (texte || '').split(/\s+/).filter(Boolean).length / MOTS_PAR_SEC;
}

// Rôle narratif d'une phrase
function classifySentence(phrase) {
  const t = (phrase || '').trim().toLowerCase();
  if (!t) return 'neutre';
  if (t.includes('?')) return 'question';
  if (/^(et )?(mais |or |sauf que|en réalité|en verite|en vérité|voici|voila|voilà|mais voila|mais voilà|le twist|sauf |pourtant|c'est alors|c'est là|c'est la|soudain|jusqu'au jour|ce qu'il ignorait|personne ne savait)/.test(t)) return 'revelation';
  // Ruptures dramatiques : "Et là, silence.", "Et soudain…", "Et puis plus rien."
  if (/^(et là|et la|et soudain|et puis|et d'un coup|et brusquement|puis plus rien|silence)/.test(t)) return 'revelation';
  if (/^(donc |alors |resultat|résultat|c'est pourquoi|du coup|ainsi |par consequent|par conséquent|desormais|désormais|le problème|le probleme)/.test(t)) return 'consequence';
  if (/^(moi,? |toi,? |vous |tu |je t'ai|je t ai|retiens|souviens|imagine|imaginez)/.test(t)) return 'interpellation';
  if (/^(il etait|il était|au debut|au début|a l'epoque|à l'époque|autrefois|d'abord|pour commencer)/.test(t)) return 'preparation';
  return 'neutre';
}

// Empreinte visuelle : ce qui définit l'IMAGE d'une phrase
function empreinteVisuelle(phrase) {
  const t = (phrase || '').toLowerCase();
  const actions = t.match(/\b\w*(brûle|brule|meurt|tombe|sonne|explose|s'effondre|surgit|frappe|court|fuit|fuient|arrive|revient|part|bombard|détruit|detruit|finance|organise|marche|dresse|allie|serre|descend|monte|ouvre|ferme|crie|pleure|rit|regarde|tourne)\w*/g) || [];
  const sujets = t.match(/\b(village|armée|armee|téléphone|telephone|pays|ville|palais|rue|homme|femme|foule|soldat|président|president|renseignement|dissident|coup d'état|coup d'etat|main|porte|voiture|salle|bureau|maison|enfant|mère|mere|père|pere|nuit|jour|ciel|mur)\w*/g) || [];
  return { actions: [...new Set(actions)], sujets: [...new Set(sujets)] };
}

// CONTINUITÉ : cette phrase prolonge-t-elle la même image ? (ne JAMAIS couper)
function prolongeLaMemeImage(precedente, courante) {
  const t = (courante || '').trim().toLowerCase();
  // Subordonnée ou énumération parallèle
  if (/^(qui |que |dont |où |ou |et qui |et que |lequel|laquelle)/.test(t) && !t.includes('?')) return true;
  // Précision immédiate : fragment court SANS image propre (ni action ni sujet visuel).
  // Ne s'applique JAMAIS à une révélation, question ou interpellation (elles ouvrent un plan).
  const cls = classifySentence(courante);
  if (dureeDe(courante) < 1.2 && !/[?!]/.test(courante)
      && cls !== 'revelation' && cls !== 'question' && cls !== 'interpellation') {
    const e = empreinteVisuelle(courante);
    if (e.actions.length === 0 && e.sujets.length === 0) return true;
  }
  // Incise de dialogue
  if (/^(puis il|puis elle|dit-il|dit-elle|répondit|repondit|ajouta)/.test(t)) return true;
  return false;
}

// Score de rupture : 0-100. Au-delà du seuil = nouvelle image = nouveau plan.
function computeNarrativeBreakScore(precedente, courante) {
  if (!precedente) return 100;
  // Règles de continuité : priment sur tout le reste
  if (prolongeLaMemeImage(precedente, courante)) return 0;

  let score = 0;
  const clsPrev = classifySentence(precedente);
  const clsCur = classifySentence(courante);
  const t = (courante || '').trim().toLowerCase();

  // Priorité 4 — révélation jamais collée à sa préparation
  if (clsCur === 'revelation') score += 55;
  if (clsPrev === 'revelation' && clsCur !== 'revelation') score += 50; // la chute a son propre plan
  if ((clsPrev === 'preparation' && clsCur === 'revelation') ||
      (clsPrev === 'revelation' && clsCur === 'preparation')) score += 40;

  // Priorité 5 — question / interpellation = leur propre image
  if (clsCur === 'question') score += 60;
  if (clsPrev === 'question' && clsCur !== 'question') score += 50; // ce qui suit une question a son propre plan
  if (clsCur === 'interpellation' && clsPrev !== 'interpellation') score += 35;
  // Adresse directe qui projette le spectateur ailleurs = changement de scène radical
  if (/^(imagine|imaginez|regarde|regardez|écoute|ecoute|écoutez|vous êtes|tu es|vous voilà)/.test(t)) score += 30;

  // Priorité 1 — IMAGE MENTALE : nouvelle action ou nouveau sujet visuel
  const ePrev = empreinteVisuelle(precedente);
  const eCur = empreinteVisuelle(courante);
  const nouvelleAction = eCur.actions.some(a => !ePrev.actions.includes(a));
  const nouveauSujet = eCur.sujets.some(s => !ePrev.sujets.includes(s));
  if (eCur.actions.length && nouvelleAction) score += 45;
  if (eCur.sujets.length && nouveauSujet && ePrev.sujets.length) score += 25;

  // Priorité 2 — changement de scène (lieu, époque)
  // Lieu nommé en tête de phrase : "À Nefis", "Au Mali", "En Libye" (nom propre = nouvelle scène)
  let changementScene = false;
  if (/^(À|A|Au|Aux|En|Dans|Vers|Depuis|à|au|aux|en|dans|vers|depuis)\s+[A-ZÀ-Ý][a-zà-ÿ]+/.test((courante || '').trim())) {
    score += 45; changementScene = true;
  }
  if (/\b(à |a |dans |vers |depuis )(dakar|paris|londres|new york|afrique|europe|palais|bureau|maison|rue|ville|pays)\b/.test(t)) score += 20;
  if (/\b(deux ans|trois ans|plus tard|à l'époque|aujourd'hui|hier|demain|en \d{4}|le lendemain|quelques années|désormais|maintenant)\b/.test(t)) score += 25;

  // Situation explicite : "Nous sommes à…", "On est à…", "Direction…"
  if (/^(nous sommes|on est|direction |retour |cap sur)/.test(t)) { score += 45; changementScene = true; }

  // Priorité 3 — connecteurs narratifs (indices forts, non mécaniques)
  if (/^(mais|pourtant|cependant|sauf que|c'est alors que|jusqu'au jour où|ce qu'il ignorait|personne ne savait|le problème|désormais|or |alors)/.test(t)) score += 22;
  // Succession temporelle ("Puis…", "Ensuite…") = nouveau moment = nouvelle image
  if (/^(puis |ensuite |après |plus tard|quelques (heures|jours|minutes|semaines|mois|années))/.test(t)) score += 45;

  // Continuité douce : rien de neuf visuellement → on prolonge
  if (!nouvelleAction && !nouveauSujet && eCur.actions.length === 0 && !changementScene
      && clsCur !== 'question' && clsCur !== 'revelation' && clsCur !== 'interpellation'
      && clsPrev !== 'question' && clsPrev !== 'revelation') {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

// Construit les plans : narration d'abord, durée en dernier
function buildNarrativeSegments(texte) {
  const phrases = splitIntoSentences(texte);
  if (!phrases.length) return [];
  const SEUIL = 45;

  const plans = [];
  let courant = [];

  for (let i = 0; i < phrases.length; i++) {
    const prev = i > 0 ? phrases[i - 1] : null;
    const cur = phrases[i];
    const score = computeNarrativeBreakScore(prev, cur);

    if (courant.length === 0) { courant.push(cur); continue; }

    const dureeSiAjout = dureeDe(courant.join(' ') + ' ' + cur);

    // Fragment d'ouverture (lieu/date : "Paris, 1925.") : seulement au TOUT DÉBUT,
    // et seulement s'il n'a ni verbe conjugué ni ponctuation forte.
    const txtCourant = courant.join(' ');
    // Cartouche d'ouverture : "Paris, 1925." — un lieu suivi d'une date, sans verbe.
    // Ce n'est pas une image à lui seul : il rejoint la phrase suivante.
    const estCartouche = /^[A-ZÀ-Ý][\wà-ÿ'-]*\s*,\s*(\d{4}|\d{1,2}\s+\w+|\w+\s+\d{4})\s*\.?$/.test(txtCourant.trim());
    const courantEstFragment = plans.length === 0 && courant.length === 1 && estCartouche;

    if (score >= SEUIL && !courantEstFragment) {
      plans.push(courant.join(' '));
      courant = [cur];
    } else if (dureeSiAjout > DUREE_MAX && !prolongeLaMemeImage(prev, cur)) {
      // Priorité 6 (durée) : garde-fou, jamais critère de décision
      plans.push(courant.join(' '));
      courant = [cur];
    } else {
      courant.push(cur);
    }
  }
  if (courant.length) plans.push(courant.join(' '));

  // Dernier passage : un plan qui dépasse nettement 7s cache souvent plusieurs images
  const final = [];
  for (const plan of plans) {
    const phr = splitIntoSentences(plan);
    if (dureeDe(plan) > DUREE_MAX + 1.5 && phr.length > 2) {
      let buf = [];
      for (let k = 0; k < phr.length; k++) {
        buf.push(phr[k]);
        if (dureeDe(buf.join(' ')) >= 4.5 || k === phr.length - 1) {
          final.push(buf.join(' ')); buf = [];
        }
      }
      if (buf.length) final.push(buf.join(' '));
    } else {
      final.push(plan);
    }
  }
  return final;
}

function estimateDuration(texte) {
  const sec = dureeDe(texte);
  const bas = Math.max(DUREE_MIN, Math.round(sec));
  const haut = Math.max(bas + 1, Math.round(sec) + 1);
  return { seconds: sec, label: bas + '-' + haut + ' sec' };
}

// Fonction centrale partagée par les deux modes
function segmentNarrativeStoryboard(texte) {
  return buildNarrativeSegments(texte).map(t => ({
    text: t.trim(),
    duree: estimateDuration(t).label
  }));
}

// ═══ ADAPTATION AUX DEUX MODES ═══
// L'IA renvoie un storyboard déjà découpé. On reconstruit le texte complet,
// on le re-découpe selon la NARRATION, puis on réassocie les prompts visuels.
// Chaque plan reçoit un prompt DISTINCT (jamais le même recopié).

// Fusionne deux étiquettes de durée consécutives : "0-3 sec" + "4-5 sec" -> "0-5 sec".
function _fusionnerDurees(a, b) {
  const nums = s => (String(s || '').match(/\d+/g) || []).map(Number);
  const na = nums(a), nb = nums(b);
  if (!na.length) return b || a || '';
  if (!nb.length) return a || b || '';
  return na[0] + '-' + nb[nb.length - 1] + ' sec';
}

// Associe à chaque nouveau plan le prompt de l'IA qui couvrait son texte.
// RÈGLE ABSOLUE : un prompt visuel n'est JAMAIS attribué à deux plans. Chaque
// plan affiché a donc une image DISTINCTE.
// Quand la re-segmentation produit plus de plans que l'IA n'a fourni de visuels,
// le plan en trop ne recopie PAS le visuel du voisin (ce qui créait des doublons) :
// il est FUSIONNÉ dans le plan précédent, puisqu'ils partagent la même image mentale.
function _reassocierVisuels(plans, segmentsIA, cleTexte, cleVisuel) {
  const sources = segmentsIA.map(s => ({
    texte: (s[cleTexte] || '').trim().toLowerCase(),
    visuel: (s[cleVisuel] || '').trim(),
    pris: false
  })).filter(s => s.visuel);

  const motsDe = t => new Set((t || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));

  const resultat = [];
  plans.forEach(plan => {
    const motsPlan = motsDe(plan.text);
    let best = -1, bestScore = -1;

    // Chercher UNIQUEMENT parmi les prompts encore libres (un visuel = un seul plan)
    sources.forEach((src, idx) => {
      if (src.pris) return;
      const motsSrc = motsDe(src.texte);
      let common = 0;
      motsSrc.forEach(w => { if (motsPlan.has(w)) common++; });
      if (common > bestScore) { bestScore = common; best = idx; }
    });

    if (best >= 0) {
      // Un visuel libre existe : ce plan est distinct.
      sources[best].pris = true;
      resultat.push({ text: plan.text, duree: plan.duree, visuel: sources[best].visuel });
    } else if (resultat.length) {
      // Plus aucun visuel libre : ce fragment partage l'image du plan précédent.
      // On le fusionne au lieu de recopier le même prompt (fini les doublons).
      const prev = resultat[resultat.length - 1];
      prev.text = (prev.text + ' ' + plan.text).trim();
      prev.duree = _fusionnerDurees(prev.duree, plan.duree);
    } else {
      // Cas extrême (1er plan, aucun visuel encore libre) : prendre le 1er disponible.
      const v = sources.length ? sources[0].visuel : '';
      if (sources.length) sources[0].pris = true;
      resultat.push({ text: plan.text, duree: plan.duree, visuel: v });
    }
  });

  return resultat;
}

// MODE STORYTELLING : { segment, duree, texte, visuel }
function segmenterStoryboardStory(boardIA) {
  if (!Array.isArray(boardIA) || boardIA.length < 2) return boardIA;
  const texteComplet = boardIA.map(s => s.texte || '').join(' ');
  const plans = segmentNarrativeStoryboard(texteComplet);
  if (!plans.length) return boardIA;
  return _reassocierVisuels(plans, boardIA, 'texte', 'visuel').map((p, i) => ({
    segment: String(i + 1),
    duree: p.duree,
    texte: p.text,
    visuel: p.visuel
  }));
}

// MODE J'AI UNE IDÉE : { segment (=durée), texte_dit, prompt_visuel }
function segmenterStoryboardScript(boardIA) {
  if (!Array.isArray(boardIA) || boardIA.length < 2) return boardIA;
  const texteComplet = boardIA.map(s => s.texte_dit || '').join(' ');
  const plans = segmentNarrativeStoryboard(texteComplet);
  if (!plans.length) return boardIA;
  return _reassocierVisuels(plans, boardIA, 'texte_dit', 'prompt_visuel').map(p => ({
    segment: p.duree,
    texte_dit: p.text,
    prompt_visuel: p.visuel
  }));
}


async function generateStoryStoryboard() {
  if (!currentStory || !currentStoryText) return;
  if (!_regenGratuiteEnCours) resetRegen('storyboardStory');

  const btn = document.getElementById('storyStoryboardBtn');
  const out = document.getElementById('storyStoryboardOutput');
  btn.disabled = true;
  document.getElementById('storyboardSpinner2').style.display = 'block';
  document.getElementById('storyStoryboardText').textContent = 'Création du storyboard…';
  const progBar2 = document.getElementById('sbProgBar2');
  if (progBar2) progBar2.style.display = 'flex';
  const prog = createProgress((p) => {
    const fill = document.getElementById('sbProgFill2');
    const pct = document.getElementById('sbProgPct2');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  });
  prog.start();

  const plat = storyPlatform || 'TikTok';
  // Durée de segment selon plateforme
  const segShort = ['TikTok', 'Instagram Reels', 'YouTube'].includes(plat);
  const segDuration = segShort ? '3 à 5 secondes' : '5 secondes';
  // Nombre de segments proportionnel à la longueur du récit
  const nbMotsRecit = (currentStoryText || '').split(/\s+/).filter(Boolean).length;
  // Cadence alignée sur le moteur image-mentale (~3 à 5 s = ~8 à 14 mots/segment),
  // pour que l'IA fournisse un visuel DISTINCT à (presque) chaque plan re-segmenté.
  const segMinR = Math.max(3, Math.round(nbMotsRecit / 14));
  const segMaxR = Math.max(segMinR + 1, Math.round(nbMotsRecit / 9));

  const prompt = `Tu es un directeur artistique expert en storyboard vidéo cinématique pour ${plat}. Découpe ce récit en segments visuels et écris pour chacun un prompt d'image d'une richesse exceptionnelle.

RÉCIT :
"""
${currentStoryText}
"""

RÈGLES DE DÉCOUPAGE (TRÈS IMPORTANT) :
- Le NOMBRE de segments doit s'adapter A LA LONGUEUR du récit : vise entre ${segMinR} et ${segMaxR} segments pour ce récit précis. Un récit court = peu de segments, un récit long = plus. Ne gonfle JAMAIS artificiellement le nombre de plans.
- Chaque segment dure ${segDuration} maximum
- RESPECTE ABSOLUMENT LES UNITÉS DE SENS : ne coupe JAMAIS une phrase ou une idée au milieu. Chaque segment doit contenir une pensée complète et cohérente (une phrase entière, ou une proposition qui a du sens seule).
- Si une phrase est trop longue pour un seul segment, coupe-la à un endroit NATUREL (après une virgule, une pause logique, une articulation du sens) — jamais en plein milieu d'une idée.
- Un segment mal coupé comme "Et partage cette vidéo à quelqu'un" suivi de "qui en a besoin" est INTERDIT : ces deux morceaux forment une seule idée et doivent rester ensemble.
- Privilégie la cohérence du sens sur la durée exacte : mieux vaut un segment légèrement plus court ou plus long mais qui garde une idée complète.
- Pour chaque segment : le texte narré (cohérent) + un prompt visuel détaillé
- Respecte le nombre de segments indiqué ci-dessus (adapté à la longueur du récit)

STRUCTURE OBLIGATOIRE DE CHAQUE PROMPT VISUEL (intègre ces 4 dimensions de façon FLUIDE et naturelle, en une description continue, SANS jamais écrire les étiquettes) :
1. LE DÉCOR : le lieu précis, l'époque, l'ambiance globale de la scène
2. LA MATIÈRE : les détails de structure, les matériaux, les textures
3. LES PERSONNAGES : leur titre/fonction, âge, apparence physique, et SURTOUT leurs vêtements précis ainsi que leurs gestes et postures
4. LA VIE DE LA SCÈNE : les éléments secondaires (inscriptions, objets, foule…), la gestion de la lumière et des ombres

Le prompt doit se lire comme une description cinématographique fluide et immersive, pas comme une liste. Chaque prompt doit être riche, précis, visuel, et permettre de générer une image spectaculaire qui empêche le scroll. Adapte l'ambiance au ton du récit.

RÈGLE SUR LES SCÈNES MULTIPLES (IMPORTANT) : Si un plan montre plusieurs scènes ou plusieurs moments sur une même image, ne les sépare JAMAIS par une ligne nette, un cadre, un split-screen graphique ou une bordure. Les différentes scènes doivent être FONDUES ensemble par une transition douce : un fondu stylisé en dégradé, une fusion progressive des lumières et des couleurs, ou un raccord visuel fluide. Précise explicitement dans le prompt que les scènes se fondent l'une dans l'autre par un dégradé harmonieux, sans séparation graphique visible.

FOOTER TECHNIQUE OBLIGATOIRE : termine CHAQUE prompt visuel par " 9:16" (le format vertical).

MINIATURE (TRÈS IMPORTANT) : en plus des segments, crée UN prompt visuel spécial pour la MINIATURE (image de couverture). Elle doit être CAPTIVANTE et ANTI-SCROLL : une image forte qui donne immédiatement envie de cliquer, sujet central percutant, émotion visible, couleurs contrastées, composition qui accroche l'œil instantanément. Elle résume la promesse du récit. Termine ce prompt par " 9:16".

Réponds UNIQUEMENT en JSON valide sans texte avant ni après :
{"miniature":"le prompt de miniature captivant et anti-scroll se terminant par 9:16","storyboard":[{"segment":"1","duree":"0-3 sec","texte":"le texte narré","visuel":"le prompt visuel riche et fluide se terminant par 9:16"}]}`;

  try {
    const raw = await callAI(MODEL_RAPIDE, 16000, prompt);
    const parsed = parseAIResponse(raw);
    // Moteur de découpage par image mentale (narration d'abord, durée en dernier)
    if (parsed && Array.isArray(parsed.storyboard)) parsed.storyboard = segmenterStoryboardStory(parsed.storyboard);
    if (!parsed || !parsed.storyboard) throw new Error('Réponse incomplète');

    prog.finish(); // 100% pile au moment où le storyboard s'affiche
    setTimeout(() => { const pb = document.getElementById('sbProgBar2'); if (pb) pb.style.display = 'none'; }, 600);
    // Sauvegarder le storyboard pour qu'il reste après réouverture
    updateGenerationStoryboard({ storyboard: parsed.storyboard, miniature: parsed.miniature || null, isStory: true });
    const sbFullText = (parsed.miniature ? `MINIATURE : ${parsed.miniature}\n\n` : '') + parsed.storyboard.map((s, i) => `Plan ${s.segment || ''} (${s.duree || ''})\n${s.texte || ''}\nVisuel : ${s.visuel || ''}`).join('\n\n');
    const miniHtmlSt = parsed.miniature ? `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${parsed.miniature}</div>
        ${blocGenImage(storeCopyText(parsed.miniature||''))}
      </div>` : '';
    out.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" style="margin-top:18px">${miniHtmlSt}${parsed.storyboard.map((s, i) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${s.duree || ''}</span>
          <span class="sb-index">Plan ${String(i+1).padStart(2,'0')}</span>
        </div>
        <div class="sb-dit">"${s.texte || ''}"</div>
        <div class="sb-visual-label">🎬 Prompt visuel</div>
        <div class="sb-visual">${s.visuel || ''}</div>
        ${blocGenImage(storeCopyText(s.visuel||''))}
      </div>`).join('')}
      <div class="sb-actions-fin">
        <button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardStory')">↻ Régénérer</button>
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(sbFullText)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sbFullText)}')">${ICON_SHARE}</button>
      </div></div>`;
    // Masquer le bouton + le texte descriptif après génération (le bouton Régénérer prend le relais)
    if (btn) {
      btn.style.display = 'none';
      // Masquer le paragraphe descriptif juste avant le bouton
      const descP = btn.previousElementSibling;
      if (descP && descP.tagName === 'P') descP.style.display = 'none';
    }

  } catch(e) {
    out.innerHTML = `<div class="error-box" style="display:block;margin-top:14px">Erreur : ${e.message}</div>`;
  } finally {
    if (typeof prog !== 'undefined') prog.stop();
    const pb2 = document.getElementById('sbProgBar2'); if (pb2) setTimeout(() => { pb2.style.display = 'none'; }, 600);
    btn.disabled = false;
    document.getElementById('storyboardSpinner2').style.display = 'none';
    document.getElementById('storyStoryboardText').textContent = '🎬 Générer le storyboard visuel';
  }
}

// Registre global des textes à copier (évite les problèmes d'encodage HTML)
window._copyStore = window._copyStore || {};

function copyText(btn, text) {
  // Si text est une clé du registre, récupérer le vrai texte
  let realText = text;
  if (typeof text === 'string' && text.startsWith('__copykey_') && window._copyStore[text]) {
    realText = window._copyStore[text];
  }
  // Sécurité : si realText n'est pas une string valide, ne rien faire
  if (typeof realText !== 'string') {
    console.error('copyText: texte invalide');
    return;
  }
  const label = btn.innerHTML;
  const done = () => {
    btn.textContent = '✓ Copié !';
    setTimeout(() => btn.innerHTML = label, 2000);
  };
  navigator.clipboard.writeText(realText).then(done).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = realText; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    done();
  });
}

// Enregistre un texte et retourne sa clé
// Retire les hashtags (#mot) d'un texte de légende
function sansHashtags(txt) {
  if (!txt) return '';
  return txt.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
}
function storeCopyText(text) {
  const key = '__copykey_' + (window._copyKeyCounter = (window._copyKeyCounter || 0) + 1);
  window._copyStore[key] = text;
  return key;
}

// ── PARTAGE NATIF (menu du téléphone : WhatsApp, Instagram, etc.) ──
async function shareText(btn, text) {
  // Récupérer le vrai texte si c'est une clé du registre
  let realText = text;
  if (typeof text === 'string' && text.startsWith('__copykey_') && window._copyStore[text]) {
    realText = window._copyStore[text];
  }
  if (typeof realText !== 'string') { console.error('shareText: texte invalide'); return; }
  realText = realText.replace(/\u200B/g, '').trim();

  // API de partage native (mobile)
  if (navigator.share) {
    try {
      await navigator.share({ text: realText + '\n\n— Créé avec Scriptura' });
    } catch(e) { /* l'utilisateur a annulé, on ne fait rien */ }
  } else {
    // Repli desktop : copier dans le presse-papier + message
    try {
      await navigator.clipboard.writeText(realText);
      const label = btn.innerHTML;
      btn.textContent = '✓ Copié (partage indispo)';
      setTimeout(() => btn.innerHTML = label, 2500);
    } catch(err) {
      alert('Le partage n\'est pas disponible sur cet appareil.');
    }
  }
}

// Partage du récit complet
async function shareStory(btn) {
  const text = document.getElementById('storyOutput').dataset.fulltext || '';
  await shareText(btn, text);
}

// Partage d'une idée
async function shareIdea(index, btn) {
  const idea = generatedIdeas[index];
  if (!idea) return;
  const text = idea.titre + '\n\nAngle : ' + idea.angle + '\n\nPourquoi ça marche : ' + idea.pourquoi + '\n\nHook : ' + idea.hook;
  await shareText(btn, text);
}

// ═══════════════════════════════════════════════════════════
//  GÉNÉRATION D'IMAGE — pont vers ChatGPT ou Gemini
// ═══════════════════════════════════════════════════════════
// Ouvre une boîte de dialogue, copie le prompt, puis ouvre l'app choisie.
let _promptAGenerer = '';

// Icônes SVG pour les boutons Copier / Partager
const ICON_COPY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
const ICON_PDF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

// Logos ChatGPT et Gemini pour le sélecteur de génération d'image
const LOGO_CHATGPT = `<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 22a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.09zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.77.77 0 0 0 .39.68l5.84 3.37-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86l-5.84-3.37 2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.78a4.49 4.49 0 0 1-.68 8.1v-5.67a.77.77 0 0 0-.4-.68zm2.01-3.02l-.14-.09-4.78-2.76a.78.78 0 0 0-.78 0L9.4 9.26V6.93a.08.08 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.68 4.65zM8.3 12.86l-2.02-1.17a.07.07 0 0 1-.04-.06V6.05a4.49 4.49 0 0 1 7.37-3.44l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z"/></svg>`;
const LOGO_GEMINI = `<svg viewBox="0 0 24 24" width="26" height="26"><defs><linearGradient id="gemGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4285F4"/><stop offset="50%" stop-color="#9B72CB"/><stop offset="100%" stop-color="#D96570"/></linearGradient></defs><path fill="url(#gemGrad)" d="M12 2c.34 4.9 4.8 9.36 9.7 9.7v.6C16.8 12.64 12.34 17.1 12 22h-.6C11.06 17.1 6.6 12.64 1.7 12.3v-.6C6.6 11.36 11.06 6.9 11.4 2z"/></svg>`;

// Génère le bloc "Générer l'image : [logo ChatGPT] [logo Gemini]" pour un prompt donné.
// promptKey est une clé du registre _copyStore (via storeCopyText).
function blocGenImage(promptKey) {
  return `<div class="genimg-inline">
    <span class="genimg-inline-label">Générer l'image :</span>
    <button class="genimg-logo-btn" title="Ouvrir dans ChatGPT" onclick="genImageDirect('chatgpt', '${promptKey}')">${LOGO_CHATGPT}</button>
    <button class="genimg-logo-btn" title="Ouvrir dans Gemini" onclick="genImageDirect('gemini', '${promptKey}')">${LOGO_GEMINI}</button>
  </div>`;
}

// Clic direct sur un logo : copie le prompt + ouvre l'app choisie (sans boîte de dialogue)
function genImageDirect(cible, promptKey) {
  let texte = promptKey;
  if (typeof promptKey === 'string' && promptKey.startsWith('__copykey_') && window._copyStore[promptKey]) {
    texte = window._copyStore[promptKey];
  }
  texte = (texte || '').replace(/\u200B/g, '').trim();

  // Copier en parallèle (sans bloquer l'ouverture de l'app)
  try { navigator.clipboard.writeText(texte); } catch(e) {}

  let appUrl, webUrl;
  if (cible === 'chatgpt') {
    appUrl = 'chatgpt://?q=' + encodeURIComponent(texte);
    webUrl = 'https://chatgpt.com/?q=' + encodeURIComponent(texte);
  } else {
    appUrl = 'googlegemini://';
    webUrl = 'https://gemini.google.com/app';
  }

  // Repli vers le site si l'app ne s'ouvre pas
  const bascule = setTimeout(() => {
    if (!document.hidden) { window.location.href = webUrl; }
  }, 1500);
  const annuler = () => { clearTimeout(bascule); cleanup(); };
  const onHide = () => { if (document.hidden) annuler(); };
  function cleanup() {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('blur', annuler);
    window.removeEventListener('pagehide', annuler);
  }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', annuler);
  window.addEventListener('pagehide', annuler);

  window.location.href = appUrl;
}

function ouvrirGenImage(promptText) {
  // Récupérer le vrai texte si c'est une clé du registre
  let realText = promptText;
  if (typeof promptText === 'string' && promptText.startsWith('__copykey_') && window._copyStore[promptText]) {
    realText = window._copyStore[promptText];
  }
  _promptAGenerer = (realText || '').replace(/\u200B/g, '').trim();
  const modal = document.getElementById('genImageModal');
  if (modal) modal.classList.add('active');
}

function fermerGenImage() {
  const modal = document.getElementById('genImageModal');
  if (modal) modal.classList.remove('active');
}

// Copie le prompt puis ouvre l'app choisie (chatgpt / gemini)
function lancerGenImage(cible) {
  const texte = _promptAGenerer;

  // 1. Copier le prompt EN PARALLÈLE (sans attendre — sinon iOS bloque l'ouverture d'app)
  try { navigator.clipboard.writeText(texte); } catch(e) { /* silencieux */ }

  // 2. Préparer les liens
  let appUrl, webUrl;
  if (cible === 'chatgpt') {
    appUrl = 'chatgpt://?q=' + encodeURIComponent(texte);
    webUrl = 'https://chatgpt.com/?q=' + encodeURIComponent(texte);
  } else {
    appUrl = 'googlegemini://';  // schéma de l'app Gemini dédiée (app séparée depuis février 2025)
    webUrl = 'https://gemini.google.com/app';
  }

  fermerGenImage();

  // 3. Repli vers le site UNIQUEMENT si rien ne s'est passé (ni app ouverte, ni dialogue affiché).
  // Le blur (perte de focus) détecte aussi le dialogue iOS "Ouvrir dans..." → on annule le repli
  // pour respecter le choix de l'utilisateur s'il annule.
  const bascule = setTimeout(() => {
    if (!document.hidden) { window.location.href = webUrl; }
  }, 1500);
  const annuler = () => { clearTimeout(bascule); cleanup(); };
  const onHide = () => { if (document.hidden) annuler(); };
  function cleanup() {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('blur', annuler);
    window.removeEventListener('pagehide', annuler);
  }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', annuler);      // le dialogue iOS fait perdre le focus → annule le repli
  window.addEventListener('pagehide', annuler);

  // 4. Ouvrir l'app IMMÉDIATEMENT (synchrone, dans le contexte du clic — exigé par iOS)
  window.location.href = appUrl;
}

// ═══════════════════════════════════════════════════════════
//  BARRE DE PROGRESSION ESTIMÉE (storyboard)
// ═══════════════════════════════════════════════════════════
// La barre monte de façon crédible vers 90% pendant que l'IA travaille,
// puis saute à 100% PILE quand le storyboard est prêt et affiché.
// 100% = storyboard visible, toujours.
function createProgress(setLabel, dureeEstimee) {
  let pct = 0;
  let timer = null;
  const DUREE_ESTIMEE = dureeEstimee || 9000; // durée moyenne estimée (défaut ~9s)
  const debut = Date.now();

  function tick() {
    const ecoule = Date.now() - debut;
    // Courbe qui ralentit en approchant 90% (asymptote)
    const ratio = ecoule / DUREE_ESTIMEE;
    const cible = 90 * (1 - Math.exp(-ratio * 1.8)); // monte vers 90% sans jamais dépasser
    pct = Math.min(90, Math.max(pct, cible));
    setLabel(Math.round(pct));
    timer = setTimeout(tick, 120);
  }

  return {
    start() { pct = 0; setLabel(0); tick(); },
    // Termine : saute à 100% (à appeler quand le storyboard est affiché)
    finish() {
      if (timer) clearTimeout(timer);
      pct = 100;
      setLabel(100);
    },
    stop() { if (timer) clearTimeout(timer); }
  };
}

function copyStory(btn) {
  const text = document.getElementById('storyOutput').dataset.fulltext || '';
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

// ══════════════════════════════════════
//  MODE SÉRIE
//  Une série = un concept + N épisodes générés un par un, chacun tenant
//  compte des précédents. L'état vit dans la table Supabase "series".
// ══════════════════════════════════════

let serieNbEpisodes = 5;      // choix par défaut
let serieDuree = '45 à 60 secondes'; // durée cible de chaque épisode
let serieCouranteId = null;   // série ouverte dans le détail

// Le genre choisi doit avoir un effet réel sur la mécanique de la série, pas
// juste apparaître en contexte passif — utilisé à la fois pour la bible
// (promptBible) et pour chaque épisode (genererEpisode).
const CODES_GENRE_SERIE = {
  'Dramatique': 'maximise la tension et les enjeux personnels dans chaque épisode — quelque chose de précis doit être en jeu (perte, échec, confrontation), pas juste "une histoire".',
  'Enquête et révélation': 'chaque épisode dévoile UN élément nouveau qui change la compréhension de ce qui précède — construis une vraie progression d\'indices, jamais une révélation gratuite sans lien avec les épisodes précédents.',
  'Transformation et parcours': 'chaque épisode marque une étape concrète et visible d\'évolution (avant/après, palier franchi) — le spectateur doit sentir une progression réelle épisode après épisode.',
  'Portrait et biographie': 'chaque épisode peut se concentrer sur une figure ou un aspect précis, mais garde un fil conducteur commun qui donne envie de voir "qui" ou "quoi" vient ensuite.',
  'Classement et compte à rebours': 'structure la progression des épisodes du moins fort au plus fort (ou l\'inverse) — la position dans le classement doit créer une attente explicite.',
  'Éducatif et explicatif': 'chaque épisode clarifie un sous-sujet précis et autonome, tout en construisant une compréhension cumulative au fil de la série.'
};
function instructionGenreSerie(genre) {
  return genre
    ? `GENRE "${genre}" — RESPECTE SA MÉCANIQUE : ${CODES_GENRE_SERIE[genre] || 'adapte la structure à ce genre précis.'}`
    : 'Aucun genre précisé : choisis la mécanique narrative la plus pertinente pour le concept.';
}

// Cibles de mots par durée d'épisode (~2,5 mots/seconde, cohérent avec la
// consigne déjà donnée dans le prompt d'écriture) — permet une vérification
// programmatique après génération, comme pour les modes Script et Storytelling.
const WORD_TARGETS_SERIE = {
  '30 à 45 secondes': { min: 75, max: 115 },
  '45 à 60 secondes': { min: 110, max: 150 },
  '60 à 90 secondes': { min: 150, max: 225 },
  'environ 2 minutes': { min: 270, max: 330 }
};

// Recopie la liste des niches depuis le mode audit (mêmes options partout)
function initSerieSelects() {
  const paires = [['auditNiche','serieNiche']];
  paires.forEach(([src, dest]) => {
    const s = document.getElementById(src), d = document.getElementById(dest);
    if (s && d && !d.options.length) d.innerHTML = s.innerHTML;
  });
}

// Charge les séries de l'utilisateur depuis Supabase
async function chargerSeries() {
  const bloc = document.getElementById('serieListeBloc');
  const liste = document.getElementById('serieListe');
  if (!supabaseClient || !liste) return;
  try {
    const { data, error } = await supabaseClient
      .from('series')
      .select('*')
      .eq('code_acces', getUserRef())
      .order('cree_le', { ascending: false });
    if (error) throw error;
    if (!data || !data.length) { if (bloc) bloc.style.display = 'none'; return; }
    liste.innerHTML = data.map(s => {
      const total = s.nb_episodes || 5;
      const fait = s.episode_courant || 0;
      const pct = Math.min(100, Math.round((fait / total) * 100));
      const fini = s.statut === 'terminee' || fait >= total;
      return `<div class="serie-card" onclick="ouvrirSerie('${s.id}')">
        <div class="serie-card-titre">${serieEsc(s.titre || 'Série sans titre')}</div>
        <div class="serie-card-concept">${serieEsc(s.concept || '')}</div>
        <div class="serie-card-bas">
          <span class="serie-progress-txt">${formaterNombre(fait)} / ${formaterNombre(total)} épisodes</span>
          <span class="serie-progress-bar"><span class="serie-progress-fill" style="width:${pct}%"></span></span>
          ${fini ? '<span class="serie-badge-fini">Terminée</span>' : ''}
        </div>
      </div>`;
    }).join('');
    if (bloc) bloc.style.display = 'block';
  } catch(e) { console.warn('Chargement séries échoué', e); }
}

function serieEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function ouvrirCreationSerie() {
  const sf = document.getElementById('serieFlow');
  if (sf) sf.style.display = 'block';
  document.getElementById('serieListeBloc').style.display = 'none';
  document.getElementById('serieCreation').style.display = 'block';
  document.getElementById('serieDetail').style.display = 'none';
  document.getElementById('serieNouvelleBtn').style.display = 'none';
  document.getElementById('serieCreation').scrollIntoView({ behavior:'smooth', block:'start' });
}

// Demande à Scriptura des concepts de série adaptés à la niche
async function proposerConceptsSerie() {
  const err = document.getElementById('serieError');
  const zone = document.getElementById('serieConceptsPropos');
  const niche = document.getElementById('serieNiche')?.value || '';
  if (!niche) {
    err.textContent = 'Choisis ta niche pour que les concepts soient pertinents.';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';
  zone.innerHTML = '<p class="serie-card-concept">Scriptura cherche des concepts…</p>';
  zone.style.display = 'block';
  const style = document.getElementById('serieStyle')?.value || '';
  const genre = document.getElementById('serieGenre')?.value || '';
  const geo = document.getElementById('serieGeo')?.value.trim() || '';
  const prompt = `Tu es un stratège de contenu pour créateurs TikTok francophones.
Propose 3 concepts de SÉRIE (feuilleton en plusieurs épisodes) pour un créateur.
Niche : ${niche}
Zone géographique / contexte culturel : ${geo || 'non précisée — reste général, n\'ancre pas les concepts dans une région particulière'}
Genre souhaité : ${genre || 'libre'}
Style de contenu : ${style}
Un bon concept de série : un fil conducteur clair, chaque épisode autonome mais donnant envie du suivant, et un titre qui promet une suite.
Réponds UNIQUEMENT en JSON, sans texte autour :
[{"titre":"...","pitch":"une phrase qui explique le fil conducteur"}]`;
  try {
    const raw = await callAI(MODEL_CREATIF, 1500, prompt, undefined, nicheNecessiteRecherche(niche));
    const concepts = serieParseJSON(raw);
    if (!Array.isArray(concepts) || !concepts.length) throw new Error('vide');
    zone.innerHTML = concepts.map(c =>
      `<div class="serie-concept-prop" onclick="choisirConcept(this)" data-titre="${serieEsc(c.titre)}">
        <b>${serieEsc(c.titre)}</b><span>${serieEsc(c.pitch || '')}</span>
      </div>`).join('');
  } catch(e) {
    zone.innerHTML = '';
    zone.style.display = 'none';
    err.textContent = 'Impossible de proposer des concepts pour le moment. Réessaie.';
    err.style.display = 'block';
  }
}

function choisirConcept(el) {
  const champ = document.getElementById('serieConcept');
  if (champ) champ.value = el.dataset.titre + ' — ' + (el.querySelector('span')?.textContent || '');
  document.getElementById('serieConceptsPropos').style.display = 'none';
  champ?.scrollIntoView({ behavior:'smooth', block:'center' });
}

// Extraction JSON tolérante (le modèle peut entourer de ```json)
function serieParseJSON(txt) {
  if (!txt) return null;
  let t = String(txt).replace(/```json|```/g, '').trim();
  const d = t.search(/[\[{]/);
  if (d > 0) t = t.slice(d);
  try { return JSON.parse(t); } catch(e) {}
  const fin = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (fin > 0) { try { return JSON.parse(t.slice(0, fin + 1)); } catch(e) {} }
  return null;
}

// Crée la série : Scriptura construit d'abord la bible + l'arc narratif,
// puis enregistre le tout. C'est la bible qui garantit la cohérence ensuite.
// Par quel moyen l'utilisateur crée une série :
// 'illimite' (fondateur), 'pro' (inclus dans l'abonnement Pro),
// 'jeton' (à décompter), ou false (aucun droit).
async function moyenSerie() {
  if (estIllimite()) return 'illimite';
  if (aAccesMode('serie')) return 'pro'; // Pro : la série est incluse
  const jetons = await lireJetonsAudit();
  if (jetons > 0) return 'jeton';
  return false;
}

async function creerSerie() {
  const err = document.getElementById('serieError');
  const concept = document.getElementById('serieConcept')?.value.trim() || '';
  const niche = document.getElementById('serieNiche')?.value || '';
  const format = document.getElementById('serieFormat')?.value || '';
  const style = document.getElementById('serieStyle')?.value || '';
  const genre = document.getElementById('serieGenre')?.value || '';
  const geo = document.getElementById('serieGeo')?.value.trim() || '';
  if (!niche) { err.textContent = 'Choisis ta niche.'; err.style.display = 'block'; return; }
  if (!format) { err.textContent = 'Choisis le format : faceless ou face caméra. La série sera écrite pour ce format.'; err.style.display = 'block'; return; }
  if (!style) { err.textContent = 'Choisis le ton de ta série.'; err.style.display = 'block'; return; }
  if (!genre) { err.textContent = 'Choisis le genre de ta série.'; err.style.display = 'block'; return; }
  if (!concept) { err.textContent = 'Décris ton concept, ou demande des propositions.'; err.style.display = 'block'; return; }
  err.style.display = 'none';

  // Par quel droit cette série est-elle créée ? (Pro incluse, jeton, fondateur)
  // Un jeton ne sera décompté qu'APRÈS une création réussie.
  const moyen = await moyenSerie();
  if (!moyen) {
    openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne');
    return;
  }

  const btn = document.getElementById('serieCreerBtn');
  const spin = document.getElementById('serieSpinner');
  const txt = document.getElementById('serieCreerTxt');
  if (btn) btn.disabled = true;
  if (spin) spin.style.display = 'inline-block';
  if (txt) txt.textContent = 'Construction de ta série…';
  startGenAnimation('serie_creation');

  // Mémoire du créateur : voir js/profil.js — une ligne de contexte en plus,
  // sans toucher aux principes d'écriture ci-dessous.
  const profilLigneSerie = ligneProfilPourPrompt(await chargerProfilCreateur());

  try {
    // 1. La bible : prémisse, univers, ton, règle récurrente, et l'arc épisode par épisode
    const promptBible = `Tu es un architecte de séries pour créateurs TikTok francophones.
Construis la BIBLE d'une série courte, puis son ARC narratif.

CONCEPT DONNÉ PAR LE CRÉATEUR : ${concept}
NICHE : ${niche}
ZONE GÉOGRAPHIQUE / CONTEXTE CULTUREL : ${geo || 'non précisée — reste général, n\'ancre pas la série dans une région particulière'}
GENRE : ${genre}
FORMAT DE PRÉSENTATION : ${format}
TON D'ÉCRITURE : ${style}
NOMBRE D'ÉPISODES : ${serieNbEpisodes}
${profilLigneSerie ? profilLigneSerie : ''}

Principes à respecter (méthode d'écriture épisodique courte) :
- La contrainte crée la structure : définis une règle récurrente que CHAQUE épisode devra respecter.
- Adapte la règle récurrente et le ton au FORMAT : en faceless (sans visage), la signature peut être visuelle ou textuelle (un mot-clé à l'écran, un type de plan récurrent) ; en face caméra, une signature de présence (une accroche parlée, un rituel d'ouverture face public).
- RESPECT STRICT ET EXCLUSIF DU TON CHOISI : le créateur a choisi précisément ce ton : "${style}". Le champ "ton" de la bible doit décrire fidèlement CE ton précis, pas un autre — c'est une consigne explicite du créateur, pas une suggestion.
- ${instructionGenreSerie(genre)}
- Chaque épisode sert UNE seule fonction narrative et se termine sur une tension non résolue.
- L'arc doit monter : accroche, approfondissement, point culminant, résolution au dernier épisode.
- Épisodes pensés pour une durée de ${serieDuree}.

Réponds UNIQUEMENT en JSON, sans texte autour :
{
  "titre": "titre court et accrocheur de la série",
  "premisse": "une phrase : de quoi parle la série et pourquoi on la suit",
  "univers": "le cadre récurrent : époque, lieu, type de personnages",
  "ton": "le registre : rythme, émotion dominante, façon de raconter",
  "regle_recurrente": "la contrainte que chaque épisode respecte (ex : chaque épisode s'ouvre sur une date précise)",
  "arc": [{"episode": 1, "fonction": "ce que cet épisode doit accomplir dans l'histoire", "tension_finale": "la question laissée en suspens"}]
}
L'arc doit contenir exactement ${serieNbEpisodes} entrées.`;

    const rawBible = await callAI(MODEL_CREATIF, 2500, promptBible, undefined, nicheNecessiteRecherche(niche));
    const bible = serieParseJSON(rawBible);
    if (!bible || !bible.premisse) throw new Error('construction impossible');
    bible.duree_episode = serieDuree; // mémorisée pour tous les épisodes à venir
    bible.zone_geo = geo;               // contexte culturel, repris à chaque épisode
    bible.format = format;              // faceless / face caméra : dicte l'écriture de chaque épisode

    const titre = (bible.titre || concept.split('—')[0]).trim().slice(0, 90);
    const { data, error } = await supabaseClient.from('series').insert({
      code_acces: getUserRef(),
      titre: titre,
      concept: concept,
      niche: niche,
      style: style,
      genre: genre,
      bible: bible,
      nb_episodes: serieNbEpisodes,
      episode_courant: 0,
      episodes: []
    }).select().single();
    if (error) throw error;

    // Série créée avec succès : si l'accès venait d'un jeton, on le décompte.
    if (moyen === 'jeton') {
      try { await consommerJetonAudit(); } catch (e) { /* silencieux */ }
    }

    document.getElementById('serieCreation').style.display = 'none';
    document.getElementById('serieConcept').value = '';

    // Mémoire du créateur (tâche de fond, silencieuse).
    mettreAJourProfilCreateur({
      declare: { niche_principale: niche, style_contenu: format, ton_prefere: toneCourtDepuisSelect('serieStyle'), structure_narrative: genre, duree_moyenne: serieDuree },
      observe: { themes_traites: titre, plateformes: 'TikTok' }
    });

    ouvrirSerie(data.id);
  } catch(e) {
    err.textContent = 'Création impossible : ' + (e.message || 'réessaie');
    err.style.display = 'block';
  } finally {
    stopGenAnimation();
    if (btn) btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (txt) txt.textContent = 'Lancer ma série';
  }
}

// Affiche le détail d'une série : épisodes déjà écrits + bouton suivant
async function ouvrirSerie(id) {
  serieCouranteId = id;
  const detail = document.getElementById('serieDetail');
  document.getElementById('serieCreation').style.display = 'none';
  document.getElementById('serieNouvelleBtn').style.display = 'none';
  // La liste laisse place au détail : une seule vue à la fois
  const blocListe = document.getElementById('serieListeBloc');
  if (blocListe) blocListe.style.display = 'none';
  detail.style.display = 'block';
  detail.innerHTML = '<p class="serie-card-concept">Chargement…</p>';
  try {
    const { data, error } = await supabaseClient.from('series').select('*').eq('id', id).single();
    if (error) throw error;
    const total = data.nb_episodes || 5;
    const eps = Array.isArray(data.episodes) ? data.episodes : [];
    // Format réel de la série (bible.format) — data.style est le TON depuis
    // l'ajout du champ Format séparé ; repli pour les séries plus anciennes.
    const b = data.bible || {};
    const formatSerieDetail = b.format
      || ((data.style || '').toLowerCase().includes('faceless') ? 'Faceless' : 'Face caméra');
    const estFaceless = /faceless|voix off|sans visage/i.test(formatSerieDetail);
    const fait = eps.length;
    const pct = Math.min(100, Math.round((fait / total) * 100));
    const fini = fait >= total;

    let html = `<div class="serie-section-label">${serieEsc(data.titre)}</div>
      <div class="serie-card" style="cursor:default">
        <div class="serie-card-concept">${serieEsc(data.concept)}</div>
        <div class="serie-card-bas">
          <span class="serie-progress-txt">${formaterNombre(fait)} / ${formaterNombre(total)} épisodes</span>
          <span class="serie-progress-bar"><span class="serie-progress-fill" style="width:${pct}%"></span></span>
        </div>
      </div>`;

    eps.forEach(ep => {
      // Normalisation rétroactive : si script/directives ont été sauvegardés comme objet
      const scriptStr = typeof ep.script === 'string' ? ep.script :
        (ep.script && typeof ep.script === 'object' ?
          Object.entries(ep.script).map(([k,v]) => k.replace(/_/g,' ').toUpperCase() + '\n' + v).join('\n\n') : '');
      const directivesStr = typeof ep.directives === 'string' ? ep.directives :
        (ep.directives && typeof ep.directives === 'object' ?
          Object.values(ep.directives).filter(Boolean).join('\n\n') : (ep.directives || ''));
      const scriptCopie = storeCopyText((ep.titre ? ep.titre + '\n\n' : '') + scriptStr + (directivesStr ? '\n\n' + directivesStr : ''));
      html += `<div class="serie-episode">
        <div class="serie-episode-num">Épisode ${ep.num} sur ${total}</div>
        <div class="serie-episode-titre">${serieEsc(ep.titre)}</div>
        <div class="serie-episode-txt">${serieEsc(scriptStr)}</div>`;
      // Directives de tournage (adaptées au style)
      if (directivesStr) {
        html += `<div class="serie-directives">
          <div class="serie-directives-titre">${estFaceless ? '🎬 Quoi filmer / montrer' : '🎥 Comment te filmer'}</div>
          <div class="serie-episode-txt">${serieEsc(directivesStr)}</div>
        </div>`;
      }
      // Copier / Partager le script de l'épisode
      html += `<div class="sb-actions-fin">
        <button class="icon-btn" title="Copier l'épisode" onclick="copyText(this, '${scriptCopie}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${scriptCopie}')">${ICON_SHARE}</button>
      </div>`;
      // Storyboard visuel : uniquement pour le faceless
      if (estFaceless) {
        if (ep.storyboard) {
          html += `<div class="serie-storyboard">${renderSerieStoryboard(ep.storyboard, ep.miniature, ep.num)}</div>`;
        } else {
          html += `<div id="serieSbZone${ep.num}"></div>
          <button class="btn-storyboard serie-sb-btn" id="serieSbBtn${ep.num}" onclick="genererStoryboardEpisode(${ep.num})">
            <span class="sb-gen-spinner" id="serieSbSpinner${ep.num}"></span>
            <span id="serieSbBtnText${ep.num}">🎬 Générer le storyboard de cet épisode</span>
          </button>`;
        }
      }
      html += `</div>`;
    });

    html += `<div class="err" id="serieDetailError" style="display:none"></div>`;
    if (fini) {
      html += `<p class="serie-card-concept" style="text-align:center">Série terminée. Belle constance !</p>
        <button class="btn-generate" onclick="chooseMode('serie')">Créer une autre série</button>`;
    } else {
      html += `<button class="btn-generate" id="serieEpBtn" onclick="genererEpisode()">
        <span id="serieEpTxt">Générer l'épisode ${fait + 1}</span>
        <span class="spinner" id="serieEpSpinner"></span>
      </button>`;
    }
    html += `<button class="serie-suggest-btn" onclick="retourListeSeries()">← Retour à mes séries</button>`;
    detail.innerHTML = html;
    detail.scrollIntoView({ behavior:'smooth', block:'start' });
  } catch(e) {
    detail.innerHTML = '<div class="err" style="display:block">Impossible d\'ouvrir cette série.</div>';
  }
}

// Affiche un storyboard de série (liste de plans)
// Génère le storyboard visuel d'un épisode faceless (même moteur que les autres modes)
async function genererStoryboardEpisode(numEp, isRegen) {
  if (!serieCouranteId) return;
  const err = document.getElementById('serieDetailError');
  if (!isRegen) resetRegen('storyboardSerie');
  if (isRegen) {
    const gratuite = regenEstGratuite('storyboardSerie');
    _regenGratuiteEnCours = gratuite;
    const restantes = REGEN_GRATUITES - regenCount.storyboardSerie;
    if (gratuite) {
      toastRegen('Régénération gratuite · ' + restantes + ' restante' + (restantes > 1 ? 's' : ''));
    } else {
      toastRegen('Cette régénération compte dans ton quota');
    }
  }
  try {
    const { data: serie, error } = await supabaseClient.from('series').select('*').eq('id', serieCouranteId).single();
    if (error) throw error;
    const eps = Array.isArray(serie.episodes) ? serie.episodes : [];
    const ep = eps.find(e => e.num === numEp);
    if (!ep) return;

    // Bouton : mêmes petit rond qui tourne + libellé que les autres modes storyboard
    const btn = document.getElementById('serieSbBtn' + numEp);
    const spinner = document.getElementById('serieSbSpinner' + numEp);
    const btnText = document.getElementById('serieSbBtnText' + numEp);
    if (btn) btn.disabled = true;
    if (spinner) spinner.style.display = 'block';
    if (btnText) btnText.textContent = 'Scriptura crée le storyboard…';

    // Statut d'avancement (remplace l'ancienne barre de progression à temps
    // estimé) : affiche la progression RÉELLE, lot par lot.
    const zone = document.getElementById('serieSbZone' + numEp);
    if (zone) zone.innerHTML = '<div class="sb-statut">Scriptura crée le storyboard…</div>';

    const scriptText = ep.script || '';
    const plat = 'TikTok';

    // Découpage narratif déterministe (js/storyboard.js), AVANT tout appel IA :
    // le nombre de plans n'est plus limité par ce qu'une seule requête peut
    // produire dans son budget de temps — les visuels sont générés par lots
    // (voir genererVisuelsParLots), donc un épisode long reste rapide et fiable.
    const plans = segmentNarrativeStoryboard(scriptText);
    if (!plans.length) throw new Error('Script vide');

    let miniature = '';
    const promesseMiniature = genererMiniatureVisuelle(scriptText, plat).then(m => { miniature = m; });

    await genererVisuelsParLots(plans, plat, (lot, indexDepart) => {
      const fait = Math.min(indexDepart + lot.length, plans.length);
      const statutEl = zone ? zone.querySelector('.sb-statut') : null;
      if (statutEl) statutEl.textContent = `Scriptura crée le storyboard… ${fait}/${plans.length} plans`;
    });
    await promesseMiniature;

    const storyboardFinal = plans.map((p, i) => ({ segment: p.duree, texte_dit: p.text, prompt_visuel: p.visuel || '' }));

    // On rattache le storyboard complet (miniature + segments) a l'episode
    const nouveaux = eps.map(e => e.num === numEp
      ? Object.assign({}, e, { storyboard: storyboardFinal, miniature: miniature || null })
      : e);
    await supabaseClient.from('series').update({ episodes: nouveaux }).eq('id', serieCouranteId);
    ouvrirSerie(serieCouranteId);
  } catch(e) {
    const zone2 = document.getElementById('serieSbZone' + numEp);
    if (zone2) zone2.innerHTML = '';
    const btn = document.getElementById('serieSbBtn' + numEp);
    const spinner = document.getElementById('serieSbSpinner' + numEp);
    const btnText = document.getElementById('serieSbBtnText' + numEp);
    if (btn) btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (btnText) btnText.textContent = '🎬 Générer le storyboard de cet épisode';
    if (err) { err.textContent = 'Storyboard impossible : ' + (e.message || 'reessaie'); err.style.display = 'block'; }
  } finally {
    _regenGratuiteEnCours = false;
  }
}

// Affiche un storyboard de serie (miniature + segments, avec boutons image et copie)
function renderSerieStoryboard(sb, miniature, numEp) {
  if (!Array.isArray(sb) || !sb.length) return '';
  const miniHtml = miniature ? `
    <div class="sb-segment sb-miniature">
      <div class="sb-head"><span class="sb-time">★ Miniature</span><span class="sb-index">Couverture</span></div>
      <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
      <div class="sb-visual">${serieEsc(miniature)}</div>
      ${blocGenImage(storeCopyText(miniature))}
    </div>` : '';
  const tous = (miniature ? 'MINIATURE : ' + miniature + '\n\n' : '')
    + sb.map((seg, i) => 'Plan ' + (i+1) + ' : ' + (seg.prompt_visuel || '')).join('\n\n');
  return `<div class="serie-sb-titre">Storyboard</div>
    <div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié et l'app s'ouvre.</div>
    <div class="storyboard-list">${miniHtml}${sb.map((seg, i) => `
      <div class="sb-segment">
        <div class="sb-head"><span class="sb-time">${serieEsc(seg.segment || '')}</span><span class="sb-index">Plan ${String(i+1).padStart(2,'0')}</span></div>
        <div class="sb-dit">"${serieEsc(seg.texte_dit || '')}"</div>
        <div class="sb-visual-label">🎬 Prompt visuel</div>
        <div class="sb-visual">${serieEsc(seg.prompt_visuel || '')}</div>
        ${blocGenImage(storeCopyText(seg.prompt_visuel || ''))}
      </div>`).join('')}
      <div class="sb-actions-fin">
        <button class="btn-regenerate sb-regen" onclick="genererStoryboardEpisode(${numEp}, true)">↻ Régénérer</button>
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tous)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tous)}')">${ICON_SHARE}</button>
      </div></div>`;
}

// Revient à la liste des séries depuis le détail
// Lit les séries de l'utilisateur pour l'historique (les plus récentes d'abord)
async function chargerSeriesHistorique() {
  if (!supabaseClient) return [];
  const code = localStorage.getItem('scriptura_code');
  if (!code) return []; // pas de séries pour un visiteur sans code
  try {
    const { data, error } = await supabaseClient
      .from('series')
      .select('*')
      .eq('code_acces', getUserRef())
      .order('cree_le', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch(e) { console.warn('Chargement séries (historique) échoué', e); return []; }
}

// Ouvre une série depuis l'historique : on va dans le module série, vue détail
function ouvrirSerieDepuisHistorique(id) {
  document.getElementById('historyFlow').style.display = 'none';
  const sf = document.getElementById('serieFlow');
  if (sf) sf.style.display = 'block';
  const bl = document.getElementById('serieListeBloc');
  if (bl) bl.style.display = 'none';
  const cr = document.getElementById('serieCreation');
  if (cr) cr.style.display = 'none';
  const nb = document.getElementById('serieNouvelleBtn');
  if (nb) nb.style.display = 'none';
  if (navStack[navStack.length - 1] !== 'historyFlow') navStack.push('historyFlow');
  ouvrirSerie(id);
}

// Revient à la liste des séries depuis le détail
function retourListeSeries() {
  serieCouranteId = null;
  document.getElementById('serieDetail').style.display = 'none';
  document.getElementById('serieFlow').style.display = 'none';
  // Les séries vivent dans "Mes générations" : on y retourne
  openHistory();
}

// Génère l'épisode suivant, en tenant compte des précédents
async function genererEpisode() {
  if (!serieCouranteId) return;
  const err = document.getElementById('serieDetailError');
  const btn = document.getElementById('serieEpBtn');
  const spin = document.getElementById('serieEpSpinner');
  const txt = document.getElementById('serieEpTxt');

  // L'épisode consomme une génération du quota mensuel
  if (!(await peutGenerer('serieDetailError'))) return;

  if (btn) btn.disabled = true;
  if (spin) spin.style.display = 'inline-block';
  if (txt) txt.textContent = 'Écriture en cours…';
  if (err) err.style.display = 'none';
  startGenAnimation('serie_episode');

  try {
    const { data: serie, error: e1 } = await supabaseClient
      .from('series').select('*').eq('id', serieCouranteId).single();
    if (e1) throw e1;
    const eps = Array.isArray(serie.episodes) ? serie.episodes : [];
    const num = eps.length + 1;
    const total = serie.nb_episodes || 5;

    const precedents = eps.length
      ? eps.map(e => `Épisode ${e.num} : ${e.titre}`).join('\n')
      : '(aucun pour l\'instant, c\'est le premier)';

    const b = serie.bible || {};
    const arc = Array.isArray(b.arc) ? b.arc : [];
    const plan = arc.find(a => a.episode === num) || {};

    // Format de présentation : depuis la bible (nouvelles séries) ; repli pour
    // les séries créées avant le champ Format (on déduit du style enregistré).
    const formatSerie = b.format
      || ((serie.style || '').toLowerCase().includes('faceless') ? 'Faceless' : 'Face caméra');
    const estFaceless = /faceless|voix off|sans visage/i.test(formatSerie);

    const prompt = `Tu écris l'épisode d'une série pour un créateur TikTok francophone.

BIBLE DE LA SÉRIE
Titre : ${serie.titre}
Prémisse : ${b.premisse || serie.concept}
Univers : ${b.univers || ''}
Ton : ${b.ton || ''}
Règle récurrente à respecter absolument : ${b.regle_recurrente || 'aucune'}
Genre : ${serie.genre || ''}
Niche : ${serie.niche}
Zone géographique / contexte culturel : ${b.zone_geo || 'non précisée — reste général'}
Format de présentation : ${formatSerie}
Ton d'écriture : ${serie.style}

ÉPISODE À ÉCRIRE : ${num} sur ${total}
Fonction narrative de cet épisode : ${plan.fonction || 'faire avancer l\'histoire'}
Tension à laisser en suspens à la fin : ${plan.tension_finale || 'une question qui appelle l\'épisode suivant'}

ÉPISODES DÉJÀ PUBLIÉS :
${precedents}

RÈGLES D'ÉCRITURE :
- Ne répète JAMAIS un sujet déjà traité ci-dessus.
- Respecte la règle récurrente de la bible : c'est la signature de la série.
- ${instructionGenreSerie(serie.genre)}
- L'épisode se suffit à lui-même, mais se termine sur la tension indiquée.
- DURÉE CIBLE — RÈGLE ABSOLUE : ${b.duree_episode || "45 à 60 secondes"}. Calibre la longueur du texte en conséquence (environ 2,5 mots par seconde). Compte tes mots avant de répondre.
- Accroche forte dès les 3 premières secondes.
- Annonce dans le script qu'il s'agit de l'épisode ${num} sur ${total}.
${num === total ? '- C\'est le DERNIER épisode : referme l\'arc et conclus la série.' : ''}

FORMAT — RÈGLE ABSOLUE, écris VRAIMENT pour ce format (les deux ne se ressemblent JAMAIS) :

${estFaceless ? `>> FORMAT FACELESS (le créateur n'apparaît pas) :
Le script et le texte à l'écran portent 100 % du récit.
- Écris en DEUX temps clairement séparés : la VOIX OFF (ce qu'on entend) et le TEXTE À L'ÉCRAN (mots-clés forts et courts, ce qu'on lit).
- Accroche dans les 5 PREMIERS MOTS. Phrases courtes, UNE idée par ligne — jamais un paragraphe.
- Fais VOIR par des images concrètes et sensorielles ; bannis les adjectifs vagues ("intense", "incroyable").
- Pense en plans courts : une nouvelle idée visuelle toutes les 2-3 secondes ; une relance d'attention toutes les ~20 secondes.
- AUCUNE adresse directe du type "regarde-moi", "je vais te montrer face caméra".
- Le champ "directives" explique quelles images/séquences filmer ou trouver (archives, plans d'illustration, texte animé).` : `>> FORMAT FACE CAMÉRA (le créateur se filme et parle) :
Le créateur est à l'écran et s'adresse directement à sa caméra, avec un vrai point de vue humain.
- Texte PARLÉ, à la première personne, fluide et naturel, comme quelqu'un qui raconte. Phrases courtes (chaque saut de ligne = une respiration).
- Accroche forte dès la première phrase ; personnalité et énergie assumées.
- AUCUNE mention de "VOIX OFF", "TEXTE À L'ÉCRAN", "ÉCRAN NOIR" : ce sont des codes faceless, interdits ici.
- Le champ "directives" dit COMMENT se filmer : cadrage (gros plan, plan poitrine), décor, énergie et ton, où regarder, quand marquer une pause, quel geste ou expression appuyer le propos.`}

TON — RÈGLE ABSOLUE, RESPECT STRICT ET EXCLUSIF : le créateur a choisi précisément ce ton pour toute la série : "${serie.style}". Écris l'INTÉGRALITÉ de cet épisode dans CE ton, sans jamais dévier vers un autre registre — même partiellement. C'est une consigne explicite du créateur, pas une suggestion : la trahir est un échec, quelle que soit la qualité par ailleurs. Un ton satirique ne devient jamais sérieux ou émotionnel en cours de route ; un ton émotionnel ne bascule jamais dans l'ironie ou la moquerie ; un ton analytique ne devient jamais lyrique.

Réponds UNIQUEMENT en JSON, sans texte autour :
{"titre":"titre court de l'épisode","script":"le script complet prêt à tourner","directives":"les directives de tournage adaptées au format (voir ci-dessus)"}`;

    const raw = await callAI(MODEL_CREATIF, 3000, prompt, undefined, nicheNecessiteRecherche(serie.niche));
    const ep = serieParseJSON(raw);
    // Normalisation : si l'IA retourne script ou directives comme objet, on convertit en texte
    if (ep && ep.script !== null && typeof ep.script === 'object') {
      const v = ep.script.voix_off || ep.script.voix || '';
      const t = ep.script.texte_ecran || ep.script.texte || ep.script.text || '';
      ep.script = [v ? 'VOIX OFF\n' + v : '', t ? 'TEXTE À L\'ÉCRAN\n' + t : ''].filter(Boolean).join('\n\n') || JSON.stringify(ep.script);
    }
    if (ep && ep.directives !== null && typeof ep.directives === 'object') {
      ep.directives = Object.values(ep.directives).filter(Boolean).join('\n\n');
    }
    if (!ep || !ep.script) throw new Error('réponse illisible');

    // ── CONTRÔLE QUALITÉ STRICT DE LA DURÉE (comme les modes Script et Storytelling) ──
    // La consigne de durée dans le prompt ne suffisait pas : contrairement aux
    // autres modes, aucune vérification programmatique n'existait pour les
    // épisodes de série. On compte les mots réels et on corrige si hors cible.
    function countWordsSerie(texte) {
      return (typeof texte === 'string' ? texte : '').split(/\s+/).filter(Boolean).length;
    }
    const wtSerie = WORD_TARGETS_SERIE[b.duree_episode] || WORD_TARGETS_SERIE['45 à 60 secondes'];
    let wordCountSerie = countWordsSerie(ep.script);
    let correctionAttemptsSerie = 0;
    const hardMinSerie = Math.round(wtSerie.min * 0.9);
    const hardMaxSerie = Math.round(wtSerie.max * 1.1);

    while ((wordCountSerie < hardMinSerie || wordCountSerie > hardMaxSerie) && correctionAttemptsSerie < 2) {
      correctionAttemptsSerie++;
      const tropCourtSerie = wordCountSerie < hardMinSerie;
      const correctionPromptSerie = `Tu es le Rédacteur en Chef de Scriptura. L'épisode suivant ne respecte PAS la durée demandée et doit être corrigé.

ÉPISODE ACTUEL (${wordCountSerie} mots) :
${ep.script}

PROBLÈME : Cet épisode fait ${wordCountSerie} mots. La cible pour "${b.duree_episode || '45 à 60 secondes'}" est ${wtSerie.min} à ${wtSerie.max} mots.
${tropCourtSerie ? 'L\'épisode est TROP COURT. Tu dois l\'ALLONGER pour atteindre ' + wtSerie.min + '-' + wtSerie.max + ' mots. Développe l\'immersion et la tension, ajoute des détails concrets, SANS remplissage inutile. Garde le même sujet, le même ton, la même structure.' : 'L\'épisode est TROP LONG. Tu dois le RACCOURCIR pour tomber à ' + wtSerie.min + '-' + wtSerie.max + ' mots. Coupe le superflu, condense, garde uniquement l\'essentiel percutant.'}

RÈGLES :
- Le nouvel épisode DOIT faire entre ${wtSerie.min} et ${wtSerie.max} mots au total. Compte tes mots avant de répondre.
- Garde le ton "${serie.style}" strictement, du début à la fin.
- Garde le même titre, la même tension finale, le même format (${formatSerie}).

Réponds UNIQUEMENT en JSON, sans texte autour :
{"script":"le script complet corrigé"}`;

      let correctedEp = null;
      try {
        const correctRawSerie = await callAI(MODEL_CREATIF, 2500, correctionPromptSerie);
        correctedEp = serieParseJSON(correctRawSerie);
      } catch(e) { break; /* en cas d'erreur, on garde la version actuelle */ }

      if (correctedEp && typeof correctedEp.script === 'string' && correctedEp.script.trim()) {
        ep.script = correctedEp.script;
        wordCountSerie = countWordsSerie(ep.script);
      } else {
        break; // parsing échoué, on garde la version actuelle
      }
    }

    const nouveaux = eps.concat([{ num: num, titre: ep.titre || ('Épisode ' + num), script: ep.script }]);
    const termine = nouveaux.length >= total;
    const { error: e2 } = await supabaseClient.from('series').update({
      episodes: nouveaux,
      episode_courant: nouveaux.length,
      statut: termine ? 'terminee' : 'en_cours'
    }).eq('id', serieCouranteId);
    if (e2) throw e2;

    // Enregistre aussi dans l'historique (et compte dans le quota du mois)
    if (typeof saveGeneration === 'function') {
      try { saveGeneration('serie', serie.titre + ' — épisode ' + num, ep); } catch(e) {}
    }

    stopGenAnimation();
    ouvrirSerie(serieCouranteId);
  } catch(e) {
    stopGenAnimation();
    if (err) { err.textContent = 'Génération impossible : ' + (e.message || 'réessaie'); err.style.display = 'block'; }
    if (btn) btn.disabled = false;
    if (spin) spin.style.display = 'none';
    if (txt) txt.textContent = 'Réessayer';
  }
}

async function chooseMode(mode) {
  pushNav(); // mémoriser l'écran d'où on vient
  // Masquer la page d'accueil et tous les modules
  masquerTousLesEcrans();
  const dsf = document.getElementById('diagSommaireFlow');
  const sf = document.getElementById('serieFlow');
  if (mode === 'audit') {
    // Écran de choix, ouvert à tous (abonné ou non) : diagnostic sommaire
    // via @nom d'utilisateur, ou diagnostic complet par captures (celui-ci
    // reste réservé au Pro/jetons — vérifié dans ouvrirCapturesDepuisChoix,
    // js/diagnostic-sommaire.js, au moment où l'utilisateur choisit cette option).
    if (dsf) dsf.style.display = 'block';
    if (typeof resetDiagnosticSommaireForm === 'function') resetDiagnosticSommaireForm();
  } else if (mode === 'serie') {
    // Inclus dans le plan Pro. Un Creator ou un non-abonné y accède aussi
    // s'il a acheté des jetons (1 jeton = 1 série) ; sinon on présente l'offre.
    if (!aAccesMode('serie')) {
      const jetonsDispo = await lireJetonsAudit();
      if (jetonsDispo <= 0) {
        document.getElementById('homePage').style.display = 'block';
        openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne');
        return;
      }
      // Il possède des jetons : il entre, un jeton sera décompté à la création.
    }
    if (sf) sf.style.display = 'block';
    initSerieSelects();
    // La consultation des séries se fait via "Mes générations".
    // Ce mode ne sert plus qu'à créer : on ouvre direct le formulaire.
    document.getElementById('serieListeBloc').style.display = 'none';
    document.getElementById('serieDetail').style.display = 'none';
    document.getElementById('serieNouvelleBtn').style.display = 'none';
    ouvrirCreationSerie();
  } else if (mode === 'script') {
    document.getElementById('flow').style.display = 'block';
  } else if (mode === 'ideas') {
    document.getElementById('ideasFlow').style.display = 'block';
  } else if (mode === 'story') {
    document.getElementById('storyFlow').style.display = 'block';
  }
  // Apparition en fondu + légère montée de l'écran qu'on vient d'ouvrir
  const ecranDuMode = { audit:'auditFlow', serie:'serieFlow', script:'flow', ideas:'ideasFlow', story:'storyFlow' };
  renderGenCounter();
  updateQuotaJour();
  // On remet la page en haut AVANT d'animer, pour que le fondu soit visible
  window.scrollTo({ top: 0, behavior: 'auto' });
  animerEntreeEcran(document.getElementById(ecranDuMode[mode]));

  // Pré-remplit les champs déjà connus du créateur (mémoire du profil).
  // Asynchrone et sans effet si rien n'est encore connu : ne retarde jamais
  // l'ouverture de l'écran et ne touche jamais un champ déjà rempli.
  if (typeof appliquerProfilCreateur === 'function') appliquerProfilCreateur(mode);
}

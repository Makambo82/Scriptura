// ══════════════════════════════════════
//  MODE SÉRIE
//  Une série = un concept + N épisodes générés un par un, chacun tenant
//  compte des précédents. L'état vit dans la table Supabase "series".
// ══════════════════════════════════════

let serieNbEpisodes = 5;      // choix par défaut
let serieDuree = '45 à 60 secondes'; // durée cible de chaque épisode
let serieCouranteId = null;   // série ouverte dans le détail

// Lit une série via le serveur (clé service_role), vérifie qu'elle
// appartient bien au code courant (voir api/series.js action 'get') :
// la table `series` n'accepte plus l'accès direct du rôle anon.
async function _serieGet(id) {
  const params = new URLSearchParams({ resource: 'series', action: 'get', code: getUserRef(), id });
  const r = await fetch('/api/data?' + params.toString());
  const rep = await r.json();
  if (!rep || !rep.ok || !rep.data) throw new Error('série introuvable');
  return rep.data;
}
// Met à jour une série (episodes/episode_courant/statut) via le serveur,
// voir api/data.js resource 'series' action 'update'.
async function _serieUpdate(id, patch) {
  await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'series', action: 'update', code: getUserRef(), id, patch })
  });
}

// Le genre choisi doit avoir un effet réel sur la mécanique de la série, pas
// juste apparaître en contexte passif, utilisé à la fois pour la bible
// (promptBible) et pour chaque épisode (genererEpisode).
const CODES_GENRE_SERIE = {
  'Dramatique': 'maximise la tension et les enjeux personnels dans chaque épisode, quelque chose de précis doit être en jeu (perte, échec, confrontation), pas juste "une histoire".',
  'Enquête et révélation': 'chaque épisode dévoile UN élément nouveau qui change la compréhension de ce qui précède, construis une vraie progression d\'indices, jamais une révélation gratuite sans lien avec les épisodes précédents.',
  'Transformation et parcours': 'chaque épisode marque une étape concrète et visible d\'évolution (avant/après, palier franchi), le spectateur doit sentir une progression réelle épisode après épisode.',
  'Portrait et biographie': 'chaque épisode peut se concentrer sur une figure ou un aspect précis, mais garde un fil conducteur commun qui donne envie de voir "qui" ou "quoi" vient ensuite.',
  'Classement et compte à rebours': 'structure la progression des épisodes du moins fort au plus fort (ou l\'inverse), la position dans le classement doit créer une attente explicite.',
  'Éducatif et explicatif': 'chaque épisode clarifie un sous-sujet précis et autonome, tout en construisant une compréhension cumulative au fil de la série.'
};
function instructionGenreSerie(genre) {
  return genre
    ? `GENRE "${genre}", RESPECTE SA MÉCANIQUE : ${CODES_GENRE_SERIE[genre] || 'adapte la structure à ce genre précis.'}`
    : 'Aucun genre précisé : choisis la mécanique narrative la plus pertinente pour le concept.';
}

// Cibles de mots par durée d'épisode (~2,5 mots/seconde, cohérent avec la
// consigne déjà donnée dans le prompt d'écriture), permet une vérification
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

// Charge les séries de l'utilisateur, via le serveur (clé service_role) :
// la table `series` n'accepte plus l'accès direct du rôle anon, voir
// supabase/generations_series_rls.sql et api/series.js.
async function chargerSeries() {
  const bloc = document.getElementById('serieListeBloc');
  const liste = document.getElementById('serieListe');
  if (!liste) return;
  try {
    const params = new URLSearchParams({ resource: 'series', action: 'list', code: getUserRef() });
    const r = await fetch('/api/data?' + params.toString());
    const rep = await r.json();
    const data = (rep && rep.ok) ? rep.data : [];
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
          <span class="serie-progress-txt">${formaterNombre(fait)} / ${formaterNombre(total)} épisodes (${pct}%)</span>
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

// Repart d'un formulaire vide pour une nouvelle série, sans ça, la niche/le
// concept/le genre d'une série précédente (annulée ou déjà créée) restaient
// silencieusement actifs pour la suivante, même sans aucun rapport avec elle
// (même défaut de réinitialisation que Script/Idées/Récit, voir restart()).
function restartCreationSerie() {
  document.getElementById('serieNiche').value = '';
  document.getElementById('serieGeo').value = '';
  document.getElementById('serieFormat').value = '';
  document.getElementById('serieStyle').value = '';
  document.getElementById('serieGenre').value = '';
  document.getElementById('serieConcept').value = '';
  const propos = document.getElementById('serieConceptsPropos');
  if (propos) { propos.innerHTML = ''; propos.style.display = 'none'; }
  const err = document.getElementById('serieError');
  if (err) err.style.display = 'none';
  // Durée par épisode et nombre d'épisodes reviennent à leur choix par
  // défaut (45-60 sec, 5 épisodes, déjà .active dans le HTML d'origine).
  serieDuree = '45 à 60 secondes';
  serieNbEpisodes = 5;
  document.querySelectorAll('#serieDureeGrid .grid-btn').forEach(b => b.classList.toggle('active', b.dataset.val === serieDuree));
  document.querySelectorAll('#serieNbGrid .grid-btn').forEach(b => b.classList.toggle('active', b.dataset.val === String(serieNbEpisodes)));
}

function ouvrirCreationSerie() {
  restartCreationSerie();
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
Zone géographique / contexte culturel : ${geo || 'non précisée, reste général, n\'ancre pas les concepts dans une région particulière'}
Genre souhaité : ${genre || 'libre'}
Style de contenu : ${style}
Un bon concept de série : un fil conducteur clair, chaque épisode autonome mais donnant envie du suivant, et un titre qui promet une suite.
${instructionRechercheWeb(niche, 'de proposer des concepts')}Réponds UNIQUEMENT en JSON, sans texte autour :
[{"titre":"...","pitch":"une phrase qui explique le fil conducteur"}]`;
  try {
    let raw = await callAI(MODEL_CREATIF, 1500, prompt, undefined, nicheNecessiteRecherche(niche), undefined, 'creationSerie', undefined, undefined, 'serie');
    let concepts = serieParseJSON(raw);
    // Tentative de secours SANS recherche web : priorité à finir plutôt qu'à
    // revérifier des faits, si le 1er essai a été tronqué par le temps limite.
    if (!Array.isArray(concepts) || !concepts.length) {
      raw = await callAI(MODEL_CREATIF, 1500, prompt, undefined, false, undefined, 'creationSerie', undefined, undefined, 'serie');
      concepts = serieParseJSON(raw);
    }
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
  if (champ) champ.value = el.dataset.titre + ', ' + (el.querySelector('span')?.textContent || '');
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

  // Mémoire du créateur : voir js/profil.js, une ligne de contexte en plus,
  // sans toucher aux principes d'écriture ci-dessous.
  const profilLigneSerie = ligneProfilPourPrompt(await chargerProfilCreateur());

  try {
    // 1. La bible : prémisse, univers, ton, règle récurrente, et l'arc épisode par épisode
    const promptBible = `Tu es un architecte de séries pour créateurs TikTok francophones.
Construis la BIBLE d'une série courte, puis son ARC narratif.

CONCEPT DONNÉ PAR LE CRÉATEUR : ${concept}
NICHE : ${niche}
ZONE GÉOGRAPHIQUE / CONTEXTE CULTUREL : ${geo || 'non précisée, reste général, n\'ancre pas la série dans une région particulière'}
GENRE : ${genre}
FORMAT DE PRÉSENTATION : ${format}
TON D'ÉCRITURE : ${style}
NOMBRE D'ÉPISODES : ${serieNbEpisodes}
${profilLigneSerie ? profilLigneSerie : ''}

Principes à respecter (méthode d'écriture épisodique courte) :
- La contrainte crée la structure : définis une règle récurrente que CHAQUE épisode devra respecter.
- Adapte la règle récurrente et le ton au FORMAT : en faceless (sans visage), la signature peut être visuelle ou textuelle (un mot-clé à l'écran, un type de plan récurrent) ; en face caméra, une signature de présence (une accroche parlée, un rituel d'ouverture face public).
- RESPECT STRICT ET EXCLUSIF DU TON CHOISI : le créateur a choisi précisément ce ton : "${style}". Le champ "ton" de la bible doit décrire fidèlement CE ton précis, pas un autre, c'est une consigne explicite du créateur, pas une suggestion.
- ${instructionGenreSerie(genre)}
- Chaque épisode sert UNE seule fonction narrative et se termine sur une tension non résolue.
- L'arc doit monter : accroche, approfondissement, point culminant, résolution au dernier épisode.
- Épisodes pensés pour une durée de ${serieDuree}.
${instructionRechercheWeb(niche, 'de construire cette bible')}
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

    // Flux activé UNIQUEMENT pour calibrer le % (voir GEN_POIDS.serie_creation,
    // js/generation.js) : un seul appel, aucun aperçu texte affiché (sortie
    // JSON, pas de la prose à lire en direct).
    const onApercuBible = (buf) => { if (genProgressCtl) genProgressCtl.etapeFluxProgres(0, fractionFlux(buf.length, 2500)); };
    let rawBible = await callAI(MODEL_CREATIF, 2500, promptBible, undefined, nicheNecessiteRecherche(niche), undefined, 'creationSerie', undefined, onApercuBible, 'serie');
    let bible = serieParseJSON(rawBible);
    // Tentative de secours SANS recherche web : priorité à finir plutôt qu'à
    // revérifier des faits, si le 1er essai a été tronqué par le temps limite.
    if (!bible || !bible.premisse) {
      rawBible = await callAI(MODEL_CREATIF, 2500, promptBible, undefined, false, undefined, 'creationSerie', undefined, onApercuBible, 'serie');
      bible = serieParseJSON(rawBible);
    }
    if (!bible || !bible.premisse) throw new Error('construction impossible');
    bible.duree_episode = serieDuree; // mémorisée pour tous les épisodes à venir
    bible.zone_geo = geo;               // contexte culturel, repris à chaque épisode
    bible.format = format;              // faceless / face caméra : dicte l'écriture de chaque épisode

    const titre = (bible.titre || concept.split('—')[0]).trim().slice(0, 90);
    const rSave = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: 'series', action: 'save', code: getUserRef(), titre, concept, niche, style, genre, bible,
        nb_episodes: serieNbEpisodes
      })
    });
    const repSave = await rSave.json();
    if (!repSave || !repSave.ok) throw new Error('création impossible');
    const data = repSave.data;

    // Le jeton (si utilisé pour entrer) est désormais décompté côté SERVEUR
    // par /api/generate lui-même (mode 'creationSerie', voir
    // api/_lib/acces.js verifierAccesProOuJeton), plus besoin de le refaire
    // ici : ce serait un double décompte.

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
    const data = await _serieGet(id);
    const total = data.nb_episodes || 5;
    const eps = Array.isArray(data.episodes) ? data.episodes : [];
    // Format réel de la série (bible.format), data.style est le TON depuis
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
          <span class="serie-progress-txt">${formaterNombre(fait)} / ${formaterNombre(total)} épisodes (${pct}%)</span>
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
      // Storyboard visuel : uniquement pour le faceless. Le bouton, la barre
      // de progression et la zone de résultat sont TOUJOURS présents (jamais
      // deux structures DOM différentes selon qu'un storyboard existe déjà) :
      // genererStoryboardEpisode() les retrouve à l'identique en génération
      // comme en régénération, et peut donc reconstruire zone.innerHTML de
      // façon progressive dans les deux cas, sans jamais dépendre d'un
      // rechargement complet de l'écran pour afficher le résultat.
      if (estFaceless) {
        html += `<div class="serie-storyboard">
          ${ep.storyboard ? '' : optionsStoryboardHTML()}
          <button class="btn-storyboard serie-sb-btn" id="serieSbBtn${ep.num}" onclick="genererStoryboardEpisode(${ep.num})" style="${ep.storyboard ? 'display:none' : ''}">
            <span class="sb-gen-spinner" id="serieSbSpinner${ep.num}"></span>
            <span id="serieSbBtnText${ep.num}">Générer le storyboard de cet épisode</span>
          </button>
          <div class="sb-progress-bar" id="serieSbProgBar${ep.num}" style="display:none">
            <div class="sb-progress-bar-track"><div class="sb-progress-bar-fill" id="serieSbProgFill${ep.num}"></div></div>
            <div class="sb-progress-bar-pct" id="serieSbProgPct${ep.num}">0%</div>
          </div>
          <div id="serieSbZone${ep.num}">${ep.storyboard ? renderSerieStoryboard(ep.storyboard, ep.miniature, ep.num, ep.guideMontage) : ''}</div>
        </div>`;
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
  // Bouton : même petit rond qui tourne + libellé que les autres modes storyboard
  const btn = document.getElementById('serieSbBtn' + numEp);
  const spinner = document.getElementById('serieSbSpinner' + numEp);
  const btnText = document.getElementById('serieSbBtnText' + numEp);
  const zone = document.getElementById('serieSbZone' + numEp);
  const progBar = document.getElementById('serieSbProgBar' + numEp);
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'block';
  if (btnText) btnText.textContent = 'Scriptura crée le storyboard…';
  if (progBar) progBar.style.display = 'flex';
  const setPctSerieSb = (p) => {
    const fill = document.getElementById('serieSbProgFill' + numEp);
    const pct = document.getElementById('serieSbProgPct' + numEp);
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  };
  // Créé une fois le nombre de lots connu (voir plus bas, plans.length) :
  // null tant que ce n'est pas le cas (ex. erreur avant ce point), gardé
  // hors du bloc try pour rester visible du finally ci-dessous.
  let prog = null;

  // Rendu progressif, mêmes gabarit et cadre (.out-card) que les modes
  // Script/Récit/Storyboard seul (voir js/storyboard.js) : les plans
  // apparaissent lot par lot au fur et à mesure, jamais tous d'un coup.
  if (zone) zone.innerHTML = `<div class="out-card sb-appear open">
    <div class="out-header" onclick="toggleCard(this.parentElement)">
      <div class="out-title">Storyboard visuel</div>
      <button class="btn-regenerate sb-regen mini" onclick="event.stopPropagation(); genererStoryboardEpisode(${numEp}, true)">↻ Régénérer</button>
      <div class="out-toggle">+</div>
    </div>
    <div class="out-body">
      <div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div>
      <div class="sb-statut" id="serieSbStatut${numEp}">Scriptura crée le storyboard…</div>
      <div class="storyboard-list" id="serieSbGrid${numEp}"></div>
    </div>
  </div>`;
  const grid = document.getElementById('serieSbGrid' + numEp);
  const statut = document.getElementById('serieSbStatut' + numEp);

  const carteMiniature = (m) => `
    <div class="sb-segment sb-miniature">
      <div class="sb-head"><span class="sb-time">★ Miniature</span><span class="sb-index">Couverture</span></div>
      <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
      <div class="sb-visual">${serieEsc(m)}</div>
      ${blocGenImage(storeCopyText(m))}
    </div>`;
  const cartePlan = (i, p) => `
    <div class="sb-segment">
      <div class="sb-head"><span class="sb-time">${serieEsc(p.duree || '')}</span><span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span></div>
      <div class="sb-dit">"${serieEsc(p.text || '')}"</div>
      <div class="sb-visual-label">🎬 Prompt visuel</div>
      <div class="sb-visual">${serieEsc(p.visuel || '')}</div>
      ${blocGenImage(storeCopyText(p.visuel || ''))}
    </div>`;

  try {
    const serie = await _serieGet(serieCouranteId);
    const eps = Array.isArray(serie.episodes) ? serie.episodes : [];
    const ep = eps.find(e => e.num === numEp);
    if (!ep) return;

    // voix_off_propre (texte parlé seul, sans étiquette "VOIX OFF"/"TEXTE À
    // L'ÉCRAN" ni minutage) : source du storyboard depuis ce correctif,
    // ep.script reste le texte formaté affiché/copié par le créateur, mais
    // le faire lire tel quel par le découpage narratif collait ces étiquettes
    // dans les plans, et donc dans la voix off générée ensuite.
    const scriptText = ep.voix_off_propre || ep.script || '';
    const plat = 'TikTok';

    // Découpage narratif déterministe (js/storyboard.js), AVANT tout appel IA :
    // le nombre de plans n'est plus limité par ce qu'une seule requête peut
    // produire dans son budget de temps, les visuels sont générés par lots
    // (voir genererVisuelsParLots), donc un épisode long reste rapide et fiable.
    const plans = segmentNarrativeStoryboard(scriptText);
    if (!plans.length) throw new Error('Script vide');

    // Jalon RÉEL par lot (voir js/storyboard.js, même correctif) : le %
    // avance à chaque lot VRAIMENT reçu, pas sur un minuteur.
    const nbLotsSerieSb = Math.max(1, Math.ceil(plans.length / TAILLE_LOT_VISUELS));
    prog = creerProgressionReelle(setPctSerieSb, Array(nbLotsSerieSb).fill(1));
    prog.start();

    let miniature = '';
    const promesseMiniature = genererMiniatureVisuelle(scriptText, plat).then(m => {
      miniature = m;
      if (m && grid) grid.insertAdjacentHTML('afterbegin', carteMiniature(m));
    });

    await genererVisuelsParLots(plans, plat, (lot, indexDepart) => {
      if (grid) grid.insertAdjacentHTML('beforeend', lot.map((p, k) => cartePlan(indexDepart + k, p)).join(''));
      const fait = Math.min(indexDepart + lot.length, plans.length);
      if (statut) statut.textContent = `Scriptura crée le storyboard… ${fait}/${plans.length} plans`;
      prog.etapeTerminee(Math.floor(indexDepart / TAILLE_LOT_VISUELS));
    });
    await promesseMiniature;
    if (statut) statut.remove();

    prog.finish();
    setTimeout(() => { const pb = document.getElementById('serieSbProgBar' + numEp); if (pb) pb.style.display = 'none'; }, 600);

    const storyboardFinal = plans.map((p, i) => ({ segment: p.duree, texte_dit: p.text, prompt_visuel: p.visuel || '' }));
    const tous = (miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + storyboardFinal.map((s, i) => 'Plan ' + (i + 1) + ' : ' + (s.prompt_visuel || '')).join('\n\n');
    if (grid) grid.insertAdjacentHTML('beforeend', `
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tous)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tous)}')">${ICON_SHARE}</button>
        ${montageBoutonHTML('montageBtnSerie' + numEp, plans)}
      </div>
      <div class="guide-montage-wrap">
        ${guideMontageBoutonHTML('guideBtnSerie' + numEp, 'guideZoneSerie' + numEp, plans, '', g => serieSauverGuideMontage(numEp, g))}
        <div class="guide-montage-zone" id="guideZoneSerie${numEp}"></div>
      </div>`);

    // Masquer le bouton (le storyboard affiché + son bouton "Régénérer" prennent le relais)
    if (btn) btn.style.display = 'none';

    // On rattache le storyboard complet (miniature + segments) a l'episode,
    // persisté APRÈS l'affichage : un échec réseau ici n'efface jamais ce
    // que l'utilisateur voit déjà à l'écran.
    const nouveaux = eps.map(e => e.num === numEp
      ? Object.assign({}, e, { storyboard: storyboardFinal, miniature: miniature || null })
      : e);
    await _serieUpdate(serieCouranteId, { episodes: nouveaux });
  } catch(e) {
    if (statut) statut.remove();
    if (grid) grid.insertAdjacentHTML('beforeend', `<div class="error-box" style="display:block;margin-top:14px">Erreur : ${e.message}. <a onclick="genererStoryboardEpisode(${numEp})" style="text-decoration:underline;cursor:pointer">Réessayer</a></div>`);
    if (err) { err.textContent = 'Storyboard impossible : ' + (e.message || 'reessaie'); err.style.display = 'block'; }
  } finally {
    if (prog) prog.stop();
    const pb = document.getElementById('serieSbProgBar' + numEp);
    if (pb) setTimeout(() => { pb.style.display = 'none'; }, 600);
    if (btn) btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (btnText) btnText.textContent = 'Générer le storyboard de cet épisode';
    _regenGratuiteEnCours = false;
  }
}

// Persiste le guide de montage CapCut d'un épisode (rattaché comme le
// storyboard). Non bloquant : si l'écriture échoue, le guide reste affiché.
async function serieSauverGuideMontage(numEp, guide) {
  if (!serieCouranteId) return;
  try {
    const serie = await _serieGet(serieCouranteId);
    const eps = Array.isArray(serie.episodes) ? serie.episodes : [];
    const nouveaux = eps.map(e => e.num === numEp ? Object.assign({}, e, { guideMontage: guide }) : e);
    await _serieUpdate(serieCouranteId, { episodes: nouveaux });
  } catch (e) { /* non bloquant */ }
}

// Affiche un storyboard de serie (miniature + segments, avec boutons image et copie)
function renderSerieStoryboard(sb, miniature, numEp, guideMontage) {
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
  return `<div class="out-card sb-appear open">
    <div class="out-header" onclick="toggleCard(this.parentElement)">
      <div class="out-title">Storyboard visuel</div>
      <button class="btn-regenerate sb-regen mini" onclick="event.stopPropagation(); genererStoryboardEpisode(${numEp}, true)">↻ Régénérer</button>
      <div class="out-toggle">+</div>
    </div>
    <div class="out-body">
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
          <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tous)}')">${ICON_COPY}</button>
          <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tous)}')">${ICON_SHARE}</button>
          ${montageBoutonHTML('montageBtnSerie' + numEp, sb)}
        </div>
        <div class="guide-montage-wrap">
          ${guideMontage ? '' : guideMontageBoutonHTML('guideBtnSerie' + numEp, 'guideZoneSerie' + numEp, sb, '', g => serieSauverGuideMontage(numEp, g))}
          <div class="guide-montage-zone" id="guideZoneSerie${numEp}">${guideMontage ? renderGuideMontage(guideMontage) : ''}</div>
        </div>
      </div>
    </div>
  </div>`;
}

// Revient à la liste des séries depuis le détail
// Lit les séries de l'utilisateur pour l'historique (les plus récentes d'abord)
async function chargerSeriesHistorique() {
  const code = localStorage.getItem('scriptura_code');
  if (!code) return []; // pas de séries pour un visiteur sans code
  try {
    const params = new URLSearchParams({ resource: 'series', action: 'list', code: getUserRef() });
    const r = await fetch('/api/data?' + params.toString());
    const rep = await r.json();
    return (rep && rep.ok) ? (rep.data || []) : [];
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
    const serie = await _serieGet(serieCouranteId);
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
Zone géographique / contexte culturel : ${b.zone_geo || 'non précisée, reste général'}
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
- DURÉE CIBLE, RÈGLE ABSOLUE : ${b.duree_episode || "45 à 60 secondes"}. Calibre la longueur du texte en conséquence (environ 2,5 mots par seconde). Compte tes mots avant de répondre.
- Accroche forte dès les 3 premières secondes.
- Annonce dans le script qu'il s'agit de l'épisode ${num} sur ${total}.
${num === total ? '- C\'est le DERNIER épisode : referme l\'arc et conclus la série.' : ''}
${instructionRechercheWeb(serie.niche, 'd\'écrire cet épisode')}
FORMAT, RÈGLE ABSOLUE, écris VRAIMENT pour ce format (les deux ne se ressemblent JAMAIS) :

${estFaceless ? `>> FORMAT FACELESS (le créateur n'apparaît pas) :
Le script et le texte à l'écran portent 100 % du récit.
- Écris en DEUX temps clairement séparés : la VOIX OFF (ce qu'on entend) et le TEXTE À L'ÉCRAN (mots-clés forts et courts, ce qu'on lit).
- Accroche dans les 5 PREMIERS MOTS. Phrases courtes, UNE idée par ligne, jamais un paragraphe.
- Fais VOIR par des images concrètes et sensorielles ; bannis les adjectifs vagues ("intense", "incroyable").
- Pense en plans courts : une nouvelle idée visuelle toutes les 2-3 secondes ; une relance d'attention toutes les ~20 secondes.
- AUCUNE adresse directe du type "regarde-moi", "je vais te montrer face caméra".
- Le champ "directives" explique quelles images/séquences filmer ou trouver (archives, plans d'illustration, texte animé).` : `>> FORMAT FACE CAMÉRA (le créateur se filme et parle) :
Le créateur est à l'écran et s'adresse directement à sa caméra, avec un vrai point de vue humain.
- Texte PARLÉ, à la première personne, fluide et naturel, comme quelqu'un qui raconte. Phrases courtes (chaque saut de ligne = une respiration).
- Accroche forte dès la première phrase ; personnalité et énergie assumées.
- AUCUNE mention de "VOIX OFF", "TEXTE À L'ÉCRAN", "ÉCRAN NOIR" : ce sont des codes faceless, interdits ici.
- Le champ "directives" dit COMMENT se filmer : cadrage (gros plan, plan poitrine), décor, énergie et ton, où regarder, quand marquer une pause, quel geste ou expression appuyer le propos.`}

TON, RÈGLE ABSOLUE, RESPECT STRICT ET EXCLUSIF : le créateur a choisi précisément ce ton pour toute la série : "${serie.style}". Écris l'INTÉGRALITÉ de cet épisode dans CE ton, sans jamais dévier vers un autre registre, même partiellement. C'est une consigne explicite du créateur, pas une suggestion : la trahir est un échec, quelle que soit la qualité par ailleurs. Un ton satirique ne devient jamais sérieux ou émotionnel en cours de route ; un ton émotionnel ne bascule jamais dans l'ironie ou la moquerie ; un ton analytique ne devient jamais lyrique.

CHAMP SUPPLÉMENTAIRE OBLIGATOIRE, "voix_off_propre" : en plus de "script" (le texte complet mis en forme, prêt à tourner), renvoie aussi "voix_off_propre" qui contient UNIQUEMENT ce qui doit être entendu à voix haute par une voix off automatique, en phrases normales mises bout à bout, JAMAIS les mots "VOIX OFF", "TEXTE À L'ÉCRAN", "ÉCRAN NOIR", ni aucun minutage entre crochets ou parenthèses (ex: "[0-3s]"), ni le contenu du texte à l'écran lui-même. ${estFaceless ? 'Ce format sépare voix off et texte à l\'écran dans "script" : "voix_off_propre" ne garde QUE la partie parlée, débarrassée de toute étiquette et de tout minutage.' : 'Ce format n\'a pas de séparation voix off / texte à l\'écran : "voix_off_propre" est alors identique à "script".'}

Réponds UNIQUEMENT en JSON, sans texte autour :
{"titre":"titre court de l'épisode","script":"le script complet prêt à tourner","voix_off_propre":"uniquement le texte parlé, sans étiquette ni minutage","directives":"les directives de tournage adaptées au format (voir ci-dessus)"}`;

    // Étape en FLUX (voir onApercu, callAI) : le % avance en continu,
    // réellement proportionnel aux caractères déjà reçus (voir
    // GEN_POIDS.serie_episode, js/generation.js).
    const onApercuEpisode = (buf) => {
      afficherApercuEnDirect(buf, 'script');
      if (genProgressCtl) genProgressCtl.etapeFluxProgres(0, fractionFlux(buf.length, 3000));
    };
    let raw = await callAI(MODEL_CREATIF, 3000, prompt, undefined, nicheNecessiteRecherche(serie.niche), undefined, 'creationSerie', undefined, onApercuEpisode, 'serie');
    let ep = serieParseJSON(raw);
    // Tentative de secours SANS recherche web : priorité à finir plutôt qu'à
    // revérifier des faits, si le 1er essai a été tronqué par le temps limite.
    if (!ep || !ep.script) {
      raw = await callAI(MODEL_CREATIF, 3000, prompt, undefined, false, undefined, 'creationSerie', undefined, onApercuEpisode, 'serie');
      ep = serieParseJSON(raw);
    }
    // Normalisation : si l'IA retourne script ou directives comme objet, on convertit en texte
    if (ep && ep.script !== null && typeof ep.script === 'object') {
      const v = ep.script.voix_off || ep.script.voix || '';
      const t = ep.script.texte_ecran || ep.script.texte || ep.script.text || '';
      // Le champ objet sépare déjà voix off et texte à l'écran : profite-en
      // pour remplir voix_off_propre proprement, avant de fusionner le tout
      // en une seule chaîne "script" pour l'affichage/la copie.
      if (!ep.voix_off_propre) ep.voix_off_propre = v || t;
      ep.script = [v ? 'VOIX OFF\n' + v : '', t ? 'TEXTE À L\'ÉCRAN\n' + t : ''].filter(Boolean).join('\n\n') || JSON.stringify(ep.script);
    }
    if (ep && ep.directives !== null && typeof ep.directives === 'object') {
      ep.directives = Object.values(ep.directives).filter(Boolean).join('\n\n');
    }
    if (!ep || !ep.script) throw new Error('réponse illisible');
    // Filet de sécurité : si l'IA a oublié voix_off_propre (champ nouveau,
    // pas garanti à 100%), on retombe sur script, moins propre pour le
    // faceless, mais jamais pire qu'avant ce correctif.
    if (!ep.voix_off_propre || typeof ep.voix_off_propre !== 'string' || !ep.voix_off_propre.trim()) {
      ep.voix_off_propre = ep.script;
    }

    // ── CONTRÔLE QUALITÉ STRICT DE LA DURÉE (comme les modes Script et Storytelling) ──
    // La consigne de durée dans le prompt ne suffisait pas : contrairement aux
    // autres modes, aucune vérification programmatique n'existait pour les
    // épisodes de série. On compte les mots réels et on corrige si hors cible.
    // IMPORTANT : on compte sur voix_off_propre, jamais sur script. En format
    // faceless, script contient AUSSI les étiquettes VOIX OFF/TEXTE À L'ÉCRAN
    // et le texte à l'écran (jamais lu à voix haute), ce qui gonflait le
    // compte de mots sans rapport avec la durée réelle de la voix off (seule
    // chose qui dicte la durée de la vidéo rendue). En format face caméra,
    // voix_off_propre == script (voir prompt d'écriture), donc identique.
    function countWordsSerie(texte) {
      return (typeof texte === 'string' ? texte : '').split(/\s+/).filter(Boolean).length;
    }
    // Écriture terminée pour de vrai : jalon réel avant le contrôle de durée.
    if (genProgressCtl) genProgressCtl.etapeTerminee(0);
    const wtSerie = WORD_TARGETS_SERIE[b.duree_episode] || WORD_TARGETS_SERIE['45 à 60 secondes'];
    let wordCountSerie = countWordsSerie(ep.voix_off_propre);
    let correctionAttemptsSerie = 0;
    const hardMinSerie = Math.round(wtSerie.min * 0.9);
    const hardMaxSerie = Math.round(wtSerie.max * 1.1);

    while ((wordCountSerie < hardMinSerie || wordCountSerie > hardMaxSerie) && correctionAttemptsSerie < 2) {
      correctionAttemptsSerie++;
      const tropCourtSerie = wordCountSerie < hardMinSerie;
      const correctionPromptSerie = `Tu es le Rédacteur en Chef de Scriptura. L'épisode suivant ne respecte PAS la durée demandée et doit être corrigé.

ÉPISODE ACTUEL, SCRIPT COMPLET :
${ep.script}

TEXTE RÉELLEMENT PARLÉ PAR LA VOIX OFF (${wordCountSerie} mots, c'est LUI qui détermine la durée de la vidéo) :
${ep.voix_off_propre}

PROBLÈME : le texte parlé fait ${wordCountSerie} mots. La cible pour "${b.duree_episode || '45 à 60 secondes'}" est ${wtSerie.min} à ${wtSerie.max} mots DE TEXTE PARLÉ (le texte à l'écran, s'il y en a, ne compte pas : il n'est jamais lu à voix haute et ne dure rien).
${tropCourtSerie ? 'Le texte parlé est TROP COURT. Tu dois l\'ALLONGER pour atteindre ' + wtSerie.min + '-' + wtSerie.max + ' mots parlés. Développe l\'immersion et la tension, ajoute des détails concrets, SANS remplissage inutile. Garde le même sujet, le même ton, la même structure.' : 'Le texte parlé est TROP LONG. Tu dois le RACCOURCIR pour tomber à ' + wtSerie.min + '-' + wtSerie.max + ' mots parlés. Coupe le superflu, condense, garde uniquement l\'essentiel percutant.'}

RÈGLES :
- "voix_off_propre" DOIT faire entre ${wtSerie.min} et ${wtSerie.max} mots au total. Compte tes mots avant de répondre. C'est la seule mesure qui compte, pas la longueur du texte à l'écran.
- Garde le ton "${serie.style}" strictement, du début à la fin.
- Garde le même titre, la même tension finale, le même format (${formatSerie}).
- Renvoie le "script" complet mis à jour, cohérent avec ce nouveau texte parlé (mêmes règles de mise en forme que la génération initiale : ${estFaceless ? 'VOIX OFF / TEXTE À L\'ÉCRAN séparés' : 'texte parlé uniquement, pas d\'étiquette'}).
- Renvoie aussi "voix_off_propre" mis à jour : UNIQUEMENT le texte parlé du nouvel épisode, sans les mots "VOIX OFF", "TEXTE À L'ÉCRAN", "ÉCRAN NOIR" ni aucun minutage entre crochets, même règle que pour la génération initiale.

Réponds UNIQUEMENT en JSON, sans texte autour :
{"script":"le script complet corrigé","voix_off_propre":"uniquement le texte parlé du nouvel épisode, sans étiquette ni minutage"}`;

      let correctedEp = null;
      try {
        const correctRawSerie = await callAI(MODEL_CREATIF, 2500, correctionPromptSerie, undefined, false, undefined, 'creationSerie', undefined, undefined, 'serie');
        correctedEp = serieParseJSON(correctRawSerie);
      } catch(e) { break; /* en cas d'erreur, on garde la version actuelle */ }

      if (correctedEp && typeof correctedEp.script === 'string' && correctedEp.script.trim()) {
        ep.script = correctedEp.script;
        ep.voix_off_propre = (typeof correctedEp.voix_off_propre === 'string' && correctedEp.voix_off_propre.trim())
          ? correctedEp.voix_off_propre
          : ep.script;
        wordCountSerie = countWordsSerie(ep.voix_off_propre);
      } else {
        break; // parsing échoué, on garde la version actuelle
      }
    }
    if (genProgressCtl) genProgressCtl.etapeTerminee(1);

    const nouveaux = eps.concat([{ num: num, titre: ep.titre || ('Épisode ' + num), script: ep.script, voix_off_propre: ep.voix_off_propre || ep.script }]);
    const termine = nouveaux.length >= total;
    await _serieUpdate(serieCouranteId, {
      episodes: nouveaux,
      episode_courant: nouveaux.length,
      statut: termine ? 'terminee' : 'en_cours'
    });

    // Enregistre aussi dans l'historique (et compte dans le quota du mois).
    // serie_id est ajouté uniquement pour cet enregistrement (ep lui-même
    // reste inchangé) : il permet à reopenGeneration (js/historique.js) de
    // rouvrir directement la vraie vue série, avec le storyboard généré
    // depuis, s'il y en a un, plutôt qu'un aperçu figé du script seul.
    if (typeof saveGeneration === 'function') {
      try { saveGeneration('serie', serie.titre + ', épisode ' + num, Object.assign({}, ep, { serie_id: serieCouranteId })); } catch(e) {}
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
    // reste réservé au Pro/jetons, vérifié dans ouvrirCapturesDepuisChoix,
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

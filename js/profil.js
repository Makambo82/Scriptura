// ═══════════════════════════════════════════════════════════
//  PROFIL CRÉATEUR — mémoire vivante, propre à chaque code utilisateur
//  Trois couches : préférences déclarées (ce que le créateur choisit),
//  habitudes observées (ce que Scriptura déduit de son usage), leçons
//  apprises (ce qui marche d'après ses audits et générations passées).
//
//  Ne modifie AUCUN mode existant : ce fichier ne fait que lire le
//  profil pour pré-remplir des champs encore vides, et ajouter UNE
//  ligne de contexte factuelle à la fin des sections "CONTEXTE" déjà
//  présentes dans les prompts. Aucune règle d'analyse ni aucune
//  instruction métier n'est modifiée. Toute erreur (table absente,
//  Supabase indisponible…) est silencieuse : l'app fonctionne à
//  l'identique sans profil, comme pour les quotas serveur.
// ═══════════════════════════════════════════════════════════

function profilVide() {
  return {
    declare: {
      niche_principale: null,
      niches_secondaires: [],
      style_contenu: null,        // format éditorial (faceless, talking head…)
      format: null,               // alias historique, conservé pour compat interne
      ton_prefere: null,
      duree_moyenne: null,
      structure_narrative: null,
      objectifs: []
    },
    observe: {
      themes_traites: [],
      themes_a_eviter: [],
      plateformes: [],
      nb_generations: 0
    },
    lecons: {
      recommandations_permanentes: [],
      dernier_score_audit: null
    },
    maj_le: null
  };
}

let _profilCreateur = null;    // cache en mémoire pour la session en cours
let _profilChargementEnCours = null; // évite les chargements concurrents en double

// Fusion profonde : les scalaires distants gagnent s'ils existent, les
// tableaux distants remplacent ceux du défaut (déjà dédupliqués à la sauvegarde).
function fusionnerProfilProfond(base, source) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], s = source ? source[k] : undefined;
    if (Array.isArray(b)) out[k] = Array.isArray(s) ? s : b;
    else if (b && typeof b === 'object') out[k] = fusionnerProfilProfond(b, s || {});
    else out[k] = (s !== undefined && s !== null && s !== '') ? s : b;
  }
  return out;
}

async function chargerProfilCreateur() {
  if (_profilCreateur) return _profilCreateur;
  if (_profilChargementEnCours) return _profilChargementEnCours;
  _profilChargementEnCours = (async () => {
    const base = profilVide();
    if (!supabaseClient) { _profilCreateur = base; return _profilCreateur; }
    try {
      const { data, error } = await supabaseClient
        .from('profils_createurs')
        .select('profil')
        .eq('code_acces', getUserRef())
        .maybeSingle();
      if (error) throw error;
      _profilCreateur = fusionnerProfilProfond(base, (data && data.profil) || {});
    } catch (e) {
      console.warn('Profil créateur indisponible', e);
      _profilCreateur = base;
    }
    return _profilCreateur;
  })();
  return _profilChargementEnCours;
}

// Ajoute des éléments en tête de liste, sans doublon (insensible à la casse),
// plafonnée pour rester utile dans un prompt : les plus récents priment.
function ajouterListeProfil(liste, valeurs, max) {
  const nouveaux = (Array.isArray(valeurs) ? valeurs : [valeurs]).filter(Boolean);
  const fusion = [...nouveaux, ...(liste || [])];
  const uniques = [];
  const vus = new Set();
  for (const item of fusion) {
    const cle = String(item).trim().toLowerCase();
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    uniques.push(String(item).trim());
    if (uniques.length >= (max || 8)) break;
  }
  return uniques;
}

// Fusionne un patch partiel dans le profil courant et sauvegarde en tâche de
// fond (jamais bloquant, jamais d'exception remontée à l'appelant). Un champ
// absent du patch reste inchangé : on n'écrase jamais une valeur connue par
// du vide, mais une NOUVELLE valeur déclarée remplace bien l'ancienne (le
// créateur peut changer de niche, de ton, etc. — la mémoire suit l'évolution).
async function mettreAJourProfilCreateur(patch) {
  try {
    const profil = await chargerProfilCreateur();

    if (patch.declare) {
      for (const k of Object.keys(patch.declare)) {
        const v = patch.declare[k];
        if (v === undefined) continue;
        if (Array.isArray(profil.declare[k])) {
          profil.declare[k] = ajouterListeProfil(profil.declare[k], v, 6);
        } else if (v !== null && v !== '') {
          profil.declare[k] = v;
        }
      }
    }
    if (patch.observe) {
      if (patch.observe.themes_traites) profil.observe.themes_traites = ajouterListeProfil(profil.observe.themes_traites, patch.observe.themes_traites, 20);
      if (patch.observe.themes_a_eviter) profil.observe.themes_a_eviter = ajouterListeProfil(profil.observe.themes_a_eviter, patch.observe.themes_a_eviter, 10);
      if (patch.observe.plateformes) profil.observe.plateformes = ajouterListeProfil(profil.observe.plateformes, patch.observe.plateformes, 5);
      profil.observe.nb_generations = (profil.observe.nb_generations || 0) + 1;
    }
    if (patch.lecons) {
      if (patch.lecons.recommandations_permanentes) profil.lecons.recommandations_permanentes = ajouterListeProfil(profil.lecons.recommandations_permanentes, patch.lecons.recommandations_permanentes, 8);
      if (patch.lecons.dernier_score_audit != null) profil.lecons.dernier_score_audit = patch.lecons.dernier_score_audit;
    }
    profil.maj_le = new Date().toISOString();
    _profilCreateur = profil;

    if (supabaseClient) {
      await supabaseClient.from('profils_createurs').upsert(
        { code_acces: getUserRef(), profil: profil, maj_le: profil.maj_le },
        { onConflict: 'code_acces' }
      );
    }
  } catch (e) {
    console.warn('Mise à jour du profil créateur échouée', e);
  }
}

// ── Pré-remplissage : ne touche jamais un champ déjà rempli par l'utilisateur ──
// Certains <select> (ex: #niche, #ideaNiche) n'ont pas d'attribut value="" sur
// leur option "Choisir…" : sa valeur par défaut est alors son propre texte,
// donc "vide" doit aussi se vérifier via selectedIndex === 0, pas seulement
// via el.value (qui serait alors non-vide dès le chargement de la page).
function estChampEncoreVide(el) {
  return el.selectedIndex === 0 || !el.value;
}

function preRemplirSiVide(id, valeur) {
  if (!valeur) return;
  const el = document.getElementById(id);
  if (!el || !estChampEncoreVide(el)) return;
  for (const opt of el.options || []) {
    if (opt.value === valeur || opt.text === valeur) { el.value = opt.value; return; }
  }
}

// Lit le libellé court du bouton actif d'une grille de choix (ex: "Storytelling"),
// seul format stable et commun à toutes les grilles de ton de l'app.
function toneCourtDepuisGrille(gridId) {
  const grid = document.getElementById(gridId);
  const actif = grid ? grid.querySelector('.grid-btn.active') : null;
  return actif ? actif.textContent.trim() : null;
}

function preSelectionnerGrilleSiVide(gridId, valeurCible) {
  if (!valeurCible) return;
  const grid = document.getElementById(gridId);
  if (!grid || grid.querySelector('.grid-btn.active')) return;
  const btns = Array.from(grid.querySelectorAll('.grid-btn'));
  const cible = String(valeurCible).trim().toLowerCase();
  const match = btns.find(b => b.textContent.trim().toLowerCase() === cible)
    || btns.find(b => (b.dataset.val || '').toLowerCase().includes(cible));
  if (match) match.click();
}

// Pré-remplit les champs déjà connus pour le mode qu'on vient d'ouvrir.
// Appelée depuis chooseMode() : asynchrone, best-effort, n'écrase jamais un
// champ déjà rempli et ne retarde jamais l'ouverture de l'écran.
async function appliquerProfilCreateur(mode) {
  const profil = await chargerProfilCreateur();
  if (!profil) return;
  const d = profil.declare;

  if (mode === 'script') {
    preRemplirSiVide('niche', d.niche_principale);
    preSelectionnerGrilleSiVide('toneGrid', d.ton_prefere);
    preSelectionnerGrilleSiVide('dureeGrid', d.duree_moyenne);
  } else if (mode === 'ideas') {
    preRemplirSiVide('ideaNiche', d.niche_principale);
    preSelectionnerGrilleSiVide('ideaToneGrid', d.ton_prefere);
  } else if (mode === 'audit') {
    preRemplirSiVide('auditNiche', d.niche_principale);
    preRemplirSiVide('auditObjectif', d.objectifs && d.objectifs[0]);
    preRemplirSiVide('auditStyle', d.style_contenu);
  } else if (mode === 'serie') {
    // initSerieSelects() copie les options juste avant : les selects sont déjà prêts.
    preRemplirSiVide('serieNiche', d.niche_principale);
    preRemplirSiVide('serieStyle', d.style_contenu);
    preRemplirSiVide('serieGenre', d.structure_narrative);
    preSelectionnerGrilleSiVide('serieDureeGrid', d.duree_moyenne);
  }
}

// ── Contexte pour les prompts : une seule ligne factuelle, ajoutée à la
// suite des lignes de contexte déjà existantes (même style, même esprit) ──
function ligneProfilPourPrompt(profil) {
  if (!profil) return '';
  const d = profil.declare, o = profil.observe, l = profil.lecons;
  const bouts = [];
  if (d.niche_principale) bouts.push('niche habituelle : ' + d.niche_principale);
  if (d.style_contenu) bouts.push('format habituel : ' + d.style_contenu);
  if (d.ton_prefere) bouts.push('ton qu\'il choisit le plus souvent : ' + d.ton_prefere);
  if (d.duree_moyenne) bouts.push('durée qu\'il choisit le plus souvent : ' + d.duree_moyenne);
  if (o.themes_traites && o.themes_traites.length) bouts.push('sujets déjà traités récemment, à ne pas répéter à l\'identique : ' + o.themes_traites.slice(0, 5).join(', '));
  if (o.themes_a_eviter && o.themes_a_eviter.length) bouts.push('à éviter pour ce créateur : ' + o.themes_a_eviter.slice(0, 5).join(', '));
  if (l.recommandations_permanentes && l.recommandations_permanentes.length) bouts.push('leçons retenues de ses audits précédents : ' + l.recommandations_permanentes.slice(0, 3).join(' · '));
  if (!bouts.length) return '';
  return 'Profil connu de ce créateur (pour rester cohérent avec ses habitudes, sans le lui redemander) : ' + bouts.join(' ; ') + '.';
}

// Table de correspondance entre les libellés courts des grilles "objectif"
// (mode idées) et les phrases longues utilisées ailleurs (state.objectif,
// #auditObjectif) — même mapping que celui déjà utilisé par useIdeaForScript,
// dupliqué ici en lecture seule pour ne pas toucher au code existant.
const OBJECTIF_COURT_VERS_LONG = {
  'faire des vues': 'Faire plus de vues et maximiser la portée',
  'gagner des abonnés': 'Gagner des abonnés qualifiés rapidement',
  'générer des ventes': 'Générer des ventes via mon contenu',
  'renforcer mon expertise': 'Renforcer mon expertise et ma crédibilité'
};

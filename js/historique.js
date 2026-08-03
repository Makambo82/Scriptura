// Sauvegarde une génération dans Supabase (silencieux, ne bloque jamais l'app)
let currentGenId = null; // id de la génération en cours (pour y rattacher le storyboard)

// Icône marque-page (favori), style TikTok « Enregistrer ». La couleur
// (gris → or quand c'est un favori) est pilotée par la classe .actif en CSS.
const ICON_FAV = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17.06a.6.6 0 0 1-.94.5L12 17.8l-6.06 3.76A.6.6 0 0 1 5 21.06V4a1 1 0 0 1 1-1z"/></svg>';

async function saveGeneration(mode, titre, contenu) {
  if (!supabaseClient) { currentGenId = null; return; }

  // Régénération GRATUITE : on met à jour la ligne existante au lieu d'en créer une
  // nouvelle → ça ne compte pas comme une génération supplémentaire dans le quota.
  if (_regenGratuiteEnCours && currentGenId) {
    try {
      await supabaseClient.from('generations')
        .update({ titre: titre || 'Sans titre', contenu: contenu })
        .eq('id', currentGenId);
    } catch(e) { console.warn('Maj régénération échouée', e); }
    return; // on garde le même currentGenId, aucune nouvelle ligne créée
  }

  // Génération normale (ou 3e régénération+) : nouvelle ligne = compte dans le quota
  currentGenId = null;
  try {
    const { data, error } = await supabaseClient.from('generations').insert({
      code_acces: getUserRef(),
      mode: mode,
      titre: titre || 'Sans titre',
      contenu: contenu
    }).select('id').single();
    if (!error && data) currentGenId = data.id;
  } catch(e) { console.warn('Sauvegarde échouée', e); }
}

// Met à jour une génération existante (pour y rattacher le storyboard généré)
async function updateGenerationStoryboard(storyboardData) {
  if (!supabaseClient || !currentGenId) return;
  try {
    // Récupérer le contenu actuel, y ajouter le storyboard, puis réenregistrer
    const { data } = await supabaseClient.from('generations').select('contenu').eq('id', currentGenId).single();
    if (data && data.contenu) {
      const nouveauContenu = Object.assign({}, data.contenu, { storyboard_genere: storyboardData });
      await supabaseClient.from('generations').update({ contenu: nouveauContenu }).eq('id', currentGenId);
    }
  } catch(e) { console.warn('Maj storyboard échouée', e); }
}

// Sauvegarde une retouche ciblée (segment de script ou hook modifié) sur la
// génération déjà enregistrée, pour qu'elle reste visible en rouvrant depuis
// l'historique — même mécanisme que updateGenerationStoryboard ci-dessus.
async function sauvegarderRetouche() {
  if (!supabaseClient || !currentGenId) return;
  try {
    const { data } = await supabaseClient.from('generations').select('contenu').eq('id', currentGenId).single();
    if (data && data.contenu) {
      const nouveauContenu = Object.assign({}, data.contenu, { script: currentScript, hooks: currentHooks });
      await supabaseClient.from('generations').update({ contenu: nouveauContenu }).eq('id', currentGenId);
    }
  } catch(e) { console.warn('Sauvegarde de la retouche échouée', e); }
}

// Même principe que sauvegarderRetouche, pour le mode Storytelling
// (currentStory.recit / currentStory.hooks au lieu de currentScript / currentHooks).
async function sauvegarderRetoucheStory() {
  if (!supabaseClient || !currentGenId || !currentStory) return;
  try {
    const { data } = await supabaseClient.from('generations').select('contenu').eq('id', currentGenId).single();
    if (data && data.contenu) {
      const nouveauContenu = Object.assign({}, data.contenu, { recit: currentStory.recit, hooks: currentStory.hooks });
      await supabaseClient.from('generations').update({ contenu: nouveauContenu }).eq('id', currentGenId);
    }
  } catch(e) { console.warn('Sauvegarde de la retouche (récit) échouée', e); }
}

// Sauvegarde la recommandation "Et maintenant ?" générée après un audit tout
// juste terminé, pour qu'elle reste identique en rouvrant cet audit depuis
// l'historique (même mécanisme que sauvegarderRetouche/updateGenerationStoryboard).
async function sauvegarderRecommandationAudit(data) {
  if (!supabaseClient || !currentGenId) return;
  try {
    const { data: row } = await supabaseClient.from('generations').select('contenu').eq('id', currentGenId).single();
    if (row && row.contenu) {
      const nouveauContenu = Object.assign({}, row.contenu, { recommandation_ia: data });
      await supabaseClient.from('generations').update({ contenu: nouveauContenu }).eq('id', currentGenId);
    }
  } catch(e) { console.warn('Sauvegarde de la recommandation IA échouée', e); }
}

// Réaffiche un storyboard déjà généré (depuis Mes générations), sans régénérer.
function reafficherStoryboard(sbData, isStory) {
  if (!sbData || !sbData.storyboard) return;
  const board = sbData.storyboard;
  const miniature = sbData.miniature;

  if (isStory) {
    // Mode Storytelling
    const out = document.getElementById('storyStoryboardOutput');
    if (!out) return;
    const miniHtmlSt = miniature ? `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${miniature}</div>
        ${blocGenImage(storeCopyText(miniature||''))}
      </div>` : '';
    out.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" style="margin-top:18px">${miniHtmlSt}${board.map((s, i) => `
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
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText((miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + board.map((s,i) => 'Plan ' + (i+1) + ' : ' + (s.visuel||'')).join('\n\n'))}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText((miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + board.map((s,i) => 'Plan ' + (i+1) + ' : ' + (s.visuel||'')).join('\n\n'))}')">${ICON_SHARE}</button>
      </div></div>`;
    // Cacher le bouton "Générer le storyboard" puisqu'il est déjà là
    const btn = document.getElementById('storyStoryboardBtn');
    if (btn) btn.style.display = 'none';
  } else {
    // Mode J'ai une idée
    const container = document.getElementById('storyboardContainer');
    if (!container) return;
    const miniHtml = miniature ? `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">🖼️ Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${miniature}</div>
        ${blocGenImage(storeCopyText(miniature||''))}
      </div>` : '';
    const tousLesPromptsRe = (miniature ? 'MINIATURE : ' + miniature + '\n\n' : '') + board.map((seg, i) => 'Plan ' + (i+1) + ' : ' + (seg.prompt_visuel||'')).join('\n\n');
    container.innerHTML = `<div class="sb-aide">💡 Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-list">${miniHtml}${board.map((seg, i) => `
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
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(tousLesPromptsRe)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(tousLesPromptsRe)}')">${ICON_SHARE}</button>
      </div></div>`;
    // Cacher le bouton générer
    const btn = document.getElementById('sbGenerateBtn');
    if (btn) btn.style.display = 'none';
  }
}

// Compte les générations faites ce mois-ci par l'utilisateur (anti-abus abonnés).
// typeVoulu : 'creation' (les 3 modes) ou 'audit'. Sans argument, compte tout.
async function countMonthGenerations(typeVoulu) {
  if (!supabaseClient) return 0;
  try {
    // Début du mois courant : le 1er à 00:00
    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    let req = supabaseClient
      .from('generations')
      .select('*', { count: 'exact', head: true })
      .eq('code_acces', getUserRef())
      .gte('cree_le', debutMois.toISOString());
    if (typeVoulu === 'audit') {
      req = req.eq('mode', 'audit');
    } else if (typeVoulu === 'creation') {
      req = req.neq('mode', 'audit');
    }
    const { count, error } = await req;
    if (error) throw error;
    return count || 0;
  } catch(e) { console.warn('Comptage du mois échoué', e); return 0; }
}

// Vérifie si un abonné a atteint sa limite mensuelle de création.
// Retourne true si l'utilisateur PEUT générer, false s'il est bloqué (et affiche le message).
// Palier d'abonnement de l'utilisateur courant
function monPalier() {
  return (localStorage.getItem('scriptura_plan') || PLAN_PAR_DEFAUT).trim().toLowerCase();
}

// Un mode réservé au Pro est-il accessible ?
function aAccesMode(mode) {
  if (!MODES_PRO.includes(mode)) return true;
  // Codes VIP/admin : accès total
  const monCode = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  if (CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode)) return true;
  return unlocked && monPalier() === 'pro';
}

// Parse une date quel que soit le séparateur (yyyy/mm/dd ou yyyy-mm-dd).
// Les slashes ne sont pas fiables selon les navigateurs : on normalise en tirets.
function parseDateFlexible(val) {
  if (!val) return null;
  let s = String(val).trim();
  // Ne garder que la partie date si une heure est présente
  s = s.split('T')[0].split(' ')[0];
  s = s.replace(/\//g, '-'); // slashes -> tirets
  const parts = s.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (y && m && d) return new Date(y, m - 1, d); // date locale, sans souci de fuseau
  }
  const fallback = new Date(val);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// Vérifie EN DIRECT (Supabase) si l'abonnement courant est expiré.
// Renvoie true seulement si une date existe et qu'elle est dépassée.
async function abonnementExpire() {
  if (!unlocked) return false;
  const code = localStorage.getItem('scriptura_code');
  if (!code) return false;
  if (CODES_ILLIMITES.map(c => c.toUpperCase()).includes(code.toUpperCase())) return false;
  if (!supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient
      .from('abonnes').select('expire_le, actif').eq('code', code).maybeSingle();
    if (error || !data) return false; // en cas de doute, on ne bloque pas
    if (data.actif === false) return true; // compte désactivé
    if (!data.expire_le) return false; // pas de date = pas d'expiration
    const expire = parseDateFlexible(data.expire_le);
    if (!expire) return false; // date illisible : on ne bloque pas
    // L'abonné garde accès tout le jour de sa date, bascule expiré le lendemain.
    expire.setHours(23, 59, 59, 999);
    return expire < new Date();
  } catch(e) { return false; } // réseau incertain : on n'enferme pas l'abonné dehors
}

// Déconnecte un abonné expiré et lui propose de renouveler.
function gererAbonnementExpire() {
  unlocked = false;
  localStorage.setItem('scriptura_unlocked', 'false');
  localStorage.removeItem('scriptura_expire');
  renderGenCounter();
  if (typeof openPlans === 'function') openPlans('expire');
}

async function peutGenerer(errorBoxId) {
  // Les non-abonnés sont gérés par le système de générations gratuites, pas ici.
  if (!unlocked) return true;

  // Codes VIP/admin : générations vraiment illimitées, aucun quota mensuel.
  const monCode = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  if (CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode)) return true;

  // Abonnement expiré ? On bloque et on renvoie vers le renouvellement.
  if (await abonnementExpire()) { gererAbonnementExpire(); return false; }

  const limite = limitesDuPalier().creation;
  const faitesCeMois = await countMonthGenerations('creation');
  if (faitesCeMois >= limite) {
    openPlans('quota');
    return false;
  }
  return true;
}

// Vérifie le quota d'audits du mois (compteur séparé de la création).
// Lit le nombre de jetons d'analyse de l'abonné courant, directement depuis
// Supabase (jamais mis en cache : ça change à chaque audit).
async function lireJetonsAudit() {
  if (!supabaseClient) return 0;
  const code = localStorage.getItem('scriptura_code');
  if (!code) return 0;
  try {
    const { data, error } = await supabaseClient
      .from('abonnes')
      .select('jetons_audit')
      .eq('code', code)
      .maybeSingle();
    if (error || !data) return 0;
    return parseInt(data.jetons_audit) || 0;
  } catch(e) { console.warn('Lecture jetons échouée', e); return 0; }
}

// Décrémente d'un jeton l'abonné courant, après un audit consommé sur jeton.
async function consommerJetonAudit() {
  if (!supabaseClient) return;
  const code = localStorage.getItem('scriptura_code');
  if (!code) return;
  try {
    const actuels = await lireJetonsAudit();
    const nouveau = Math.max(0, actuels - 1);
    await supabaseClient.from('abonnes').update({ jetons_audit: nouveau }).eq('code', code);
  } catch(e) { console.warn('Décompte jeton échoué', e); }
}

// Décide si l'utilisateur peut lancer un audit, et par quel moyen.
// Retourne : 'pro' (analyse mensuelle incluse), 'jeton' (à décompter),
// ou false (pas le droit — on lui a proposé d'acheter).
async function peutAuditer() {
  const monCode = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  // Abonnement expiré ? on bloque avant tout (sauf codes illimités, gérés plus bas)
  if (!CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode) && await abonnementExpire()) {
    gererAbonnementExpire();
    return false;
  }
  if (CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode)) return 'illimite';

  // 1. D'abord les analyses incluses dans le plan Pro (elles se rechargent)
  const limiteIncluse = limitesDuPalier().audit;
  if (limiteIncluse > 0) {
    const faits = await countMonthGenerations('audit');
    if (faits < limiteIncluse) return 'pro';
  }

  // 2. Ensuite les jetons achetés (ne périment pas)
  const jetons = await lireJetonsAudit();
  if (jetons > 0) return 'jeton';

  // 3. Rien de disponible : on propose d'acheter selon le profil
  openPlans(unlocked ? 'achat-jeton-creator' : 'achat-jeton-nonabonne');
  return false;
}

// Supprime une ou plusieurs générations dans Supabase
async function deleteGenerations(ids) {
  if (!supabaseClient || !ids || !ids.length) return false;
  try {
    const { error } = await supabaseClient
      .from('generations')
      .delete()
      .in('id', ids);
    if (error) throw error;
    return true;
  } catch(e) { console.warn('Suppression échouée', e); return false; }
}

// Supprime des séries (table dédiée)
async function deleteSeries(ids) {
  if (!supabaseClient || !ids || !ids.length) return false;
  try {
    const { error } = await supabaseClient
      .from('series')
      .delete()
      .in('id', ids);
    if (error) throw error;
    return true;
  } catch(e) { console.warn('Suppression série échouée', e); return false; }
}

// Suppression mixte : répartit les ids entre générations et séries.
// Les ids de série sont préfixés "serie:".
async function deleteMixte(ids) {
  const idsSeries = ids.filter(x => String(x).startsWith('serie:')).map(x => x.slice(6));
  const idsGen = ids.filter(x => !String(x).startsWith('serie:'));
  let ok = true;
  if (idsGen.length) ok = await deleteGenerations(idsGen) && ok;
  if (idsSeries.length) ok = await deleteSeries(idsSeries) && ok;
  return ok;
}

// Ouvre le panneau historique
async function openHistory() {
  pushNav(); // mémoriser l'écran d'où on vient
  _selectMode = false;
  _favFilter = false;
  if (typeof _selectedIds !== 'undefined') _selectedIds.clear();
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('flow').style.display = 'none';
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('storyFlow').style.display = 'none';
  document.getElementById('historyFlow').style.display = 'block';
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
  // Pré-remplir le code si connu
  const code = localStorage.getItem('scriptura_code');
  if (code) document.getElementById('historyCodeInput').value = code;
  renderHistory();
}

// Synchronise avec le code d'accès saisi
async function syncHistory() {
  const code = document.getElementById('historyCodeInput').value.trim().toUpperCase();
  if (code) {
    localStorage.setItem('scriptura_code', code);
  }
  renderHistory();
}

// Affiche la liste des générations
let _selectMode = false;
let _selectedIds = new Set();
let _favFilter = false; // filtre "Favoris" en haut : n'afficher que les favoris

// ══════════════════════════════════════
//  GLISSEMENT POUR SUPPRIMER (Mes générations)
//  Glisser une carte vers la gauche révèle un bouton "Supprimer".
//  Le panier reste disponible : deux façons de supprimer, au choix.
//  Ne se déclenche jamais en mode sélection, ni sur un défilement vertical.
// ══════════════════════════════════════
let _swipeDepart = null;

function fermerTousLesSwipes(sauf) {
  document.querySelectorAll('.swipe-wrap.ouvert').forEach(w => {
    if (w !== sauf) w.classList.remove('ouvert');
  });
}

function initSwipeHistorique() {
  const liste = document.getElementById('historyList');
  if (!liste || liste.dataset.swipeInit === '1') return;
  liste.dataset.swipeInit = '1';

  liste.addEventListener('touchstart', function(e) {
    if (_selectMode) return; // en mode sélection, on ne glisse pas
    const wrap = e.target.closest('.swipe-wrap');
    if (!wrap) return;
    const t = e.touches[0];
    _swipeDepart = { x: t.clientX, y: t.clientY, wrap: wrap, decide: false, horizontal: false };
  }, { passive: true });

  liste.addEventListener('touchmove', function(e) {
    if (!_swipeDepart) return;
    const t = e.touches[0];
    const dx = t.clientX - _swipeDepart.x;
    const dy = t.clientY - _swipeDepart.y;
    // On tranche une seule fois du sens : si c'est vertical, on laisse
    // la page défiler normalement et on abandonne le glissement.
    if (!_swipeDepart.decide) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // trop tôt pour décider
      _swipeDepart.decide = true;
      _swipeDepart.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!_swipeDepart.horizontal) { _swipeDepart = null; return; }
    }
  }, { passive: true });

  liste.addEventListener('touchend', function(e) {
    if (!_swipeDepart || !_swipeDepart.horizontal) { _swipeDepart = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - _swipeDepart.x;
    const wrap = _swipeDepart.wrap;
    if (dx < -40) {            // glissé vers la gauche : on révèle
      fermerTousLesSwipes(wrap);
      wrap.classList.add('ouvert');
    } else if (dx > 20) {      // glissé vers la droite : on referme
      wrap.classList.remove('ouvert');
    }
    _swipeDepart = null;
  }, { passive: true });

  // Un clic ailleurs referme la carte ouverte
  liste.addEventListener('click', function(e) {
    if (e.target.closest('.swipe-action')) return; // sauf sur le bouton lui-même
    const wrap = e.target.closest('.swipe-wrap');
    fermerTousLesSwipes(wrap && wrap.classList.contains('ouvert') ? null : wrap);
  });
}

// Titre court et propre pour la liste « Mes générations ».
// Un script lancé depuis une recommandation reçoit un « sujet » composé
// (« Titre. Angle : … Hook suggéré : … ») qui était enregistré tel quel comme
// titre : dans la liste, on ne garde que le titre, sans l'angle ni le hook.
// Le contexte complet reste stocké à part et sert quand on rouvre la génération.
function histTitreCourt(titre) {
  let t = String(titre == null ? '' : titre);
  t = t.split(/\s*\.?\s*(?:Angle\s*:|Hook\s+suggéré\s*:|Pourquoi\s+ça\s+marche\s*:)/i)[0];
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return t || 'Sans titre';
}

async function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:40px">Chargement…</p>';

  let gens = await loadGenerations();
  // Les épisodes de série ne s'affichent pas isolément : masqués ici
  // (ils restent enregistrés pour le comptage du quota).
  gens = gens.filter(g => g.mode !== 'serie');
  const series = await chargerSeriesHistorique();

  // Cache complet (non filtré) : permet de redessiner instantanément après un
  // changement de favori, sans nouvel aller-retour serveur.
  window._historyDataAll = gens;
  window._historySeriesAll = series;
  dessinerHistorique();
}

// Dessine la liste à partir du cache mémoire (aucun rechargement réseau).
// Appelée par renderHistory après chargement, et directement après un
// changement de favori pour un affichage immédiat.
function dessinerHistorique() {
  const list = document.getElementById('historyList');
  let gens = (window._historyDataAll || []).slice();
  let series = (window._historySeriesAll || []).slice();

  // Rien du tout (aucune génération ni série) : état vide global.
  if (!gens.length && !series.length) {
    list.innerHTML = '<div class="history-empty"><p>Aucune génération pour l\'instant.</p><p style="font-size:0.88rem;opacity:0.6;margin-top:8px">Tes scripts, idées et récits apparaîtront ici automatiquement.</p></div>';
    document.getElementById('historyToolbar').style.display = 'none';
    _favFilter = false;
    document.body.classList.remove('hist-select');
    return;
  }

  // Filtre "Favoris" (bouton en haut) : ne garder que les favoris.
  if (_favFilter) {
    gens = gens.filter(g => g.favori);
    series = series.filter(s => s.favori);
  }

  window._historyData = gens;
  window._historySeries = series;

  // Barre d'outils (sélection multiple + filtre favoris)
  const toolbar = document.getElementById('historyToolbar');
  toolbar.style.display = 'flex';
  updateHistoryToolbar();

  // Filtre actif mais aucun favori : message dédié, on garde la barre pour ressortir.
  if (_favFilter && !gens.length && !series.length) {
    list.innerHTML = '<div class="history-empty"><p>Aucun favori pour l\'instant.</p><p style="font-size:0.88rem;opacity:0.6;margin-top:8px">Appuie sur le marque-page d\'une génération pour l\'ajouter à tes favoris.</p></div>';
    return;
  }

  const modeLabels = { script: '🎬 Script', ideas: '💡 Idées', story: '✍️ Récit', audit: '📊 Diagnostic', serie: '🎞️ Série' };
  const modeColors = { script: '#C9A84C', ideas: '#E2C87A', story: '#C9A84C', audit: '#E2C87A', serie: '#C9A84C' };

  // Séries et générations sont fusionnées dans UNE seule liste,
  // triée du plus récent au plus ancien (peu importe le type).
  const items = [];

  (series || []).forEach(s => {
    const total = s.nb_episodes || 5;
    const fait = Array.isArray(s.episodes) ? s.episodes.length : (s.episode_courant || 0);
    const pct = Math.min(100, Math.round((fait / total) * 100));
    const fini = s.statut === 'terminee' || fait >= total;
    const sid = 'serie:' + s.id;
    const checked = _selectedIds.has(sid) ? 'checked' : '';
    const selectClass = _selectMode ? ' selecting' : '';
    const estFav = !!s.favori;
    const html = `
      <div class="swipe-wrap" data-swipe="${sid}">
      ${!_selectMode ? `<button class="swipe-action" onclick="deleteOneSerie('${s.id}')">Supprimer</button>` : ''}
      <div class="history-card${selectClass}${estFav ? ' favori' : ''}${_selectedIds.has(sid) ? ' selected' : ''}" data-id="${sid}">
        ${_selectMode ? `<label class="history-check" onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleSelect('${sid}')"/></label>` : ''}
        <div class="history-card-body" onclick="${_selectMode ? `toggleSelect('${sid}')` : `ouvrirSerieDepuisHistorique('${s.id}')`}">
          <div class="history-card-head">
            <span class="history-mode" style="color:#C9A84C">🎞️ Série</span>
            ${fini ? '<span class="serie-badge-fini">Terminée</span>' : `<span class="history-date">${formaterNombre(fait)}/${formaterNombre(total)} épisodes</span>`}
          </div>
          <div class="history-title">${serieEsc(s.titre || 'Série sans titre')}</div>
          <div class="serie-progress-bar" style="margin-top:10px"><span class="serie-progress-fill" style="width:${pct}%"></span></div>
        </div>
        ${!_selectMode ? `<div class="history-actions">
          <button class="history-fav${estFav ? ' actif' : ''}" onclick="event.stopPropagation(); toggleFavori('${sid}')" title="${estFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${ICON_FAV}</button>
          <button class="history-delete" onclick="event.stopPropagation(); deleteOneSerie('${s.id}')" aria-label="Supprimer">🗑</button>
        </div>` : ''}
      </div></div>`;
    items.push({ t: new Date(s.cree_le).getTime() || 0, fav: estFav, html: html });
  });

  gens.forEach((g, i) => {
    const date = new Date(g.cree_le);
    const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' à ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const checked = _selectedIds.has(g.id) ? 'checked' : '';
    const selectClass = _selectMode ? ' selecting' : '';
    const estFav = !!g.favori;
    const html = `
      <div class="swipe-wrap" data-swipe="${g.id}">
      ${!_selectMode ? `<button class="swipe-action" onclick="deleteOne('${g.id}')">Supprimer</button>` : ''}
      <div class="history-card${selectClass}${estFav ? ' favori' : ''}" data-id="${g.id}">
        ${_selectMode ? `<label class="history-check" onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleSelect('${g.id}')"/></label>` : ''}
        <div class="history-card-body" onclick="${_selectMode ? `toggleSelect('${g.id}')` : `reopenGeneration(${i})`}">
          <div class="history-card-head">
            <span class="history-mode" style="color:${modeColors[g.mode] || '#C9A84C'}">${modeLabels[g.mode] || g.mode}</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-title">${serieEsc(histTitreCourt(g.titre))}</div>
          ${!_selectMode ? '<div class="history-reopen">Appuie pour rouvrir cette génération →</div>' : ''}
        </div>
        ${!_selectMode ? `<div class="history-actions">
          <button class="history-fav${estFav ? ' actif' : ''}" onclick="event.stopPropagation(); toggleFavori('${g.id}')" title="${estFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${ICON_FAV}</button>
          <button class="history-delete" onclick="event.stopPropagation(); deleteOne('${g.id}')" aria-label="Supprimer">🗑</button>
        </div>` : ''}
      </div></div>`;
    items.push({ t: date.getTime() || 0, fav: estFav, html: html });
  });

  // Les favoris (épinglés) d'abord, puis le plus récent au plus ancien.
  items.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || b.t - a.t);
  list.innerHTML = items.map(x => x.html).join('');
  initSwipeHistorique();
}

function updateHistoryToolbar() {
  const toolbar = document.getElementById('historyToolbar');
  if (!toolbar) return;
  // En mode sélection, la barre flotte en bas de l'écran (toujours accessible
  // pendant le défilement) ; sinon elle reste en ligne en haut de la liste.
  toolbar.classList.toggle('flottant', _selectMode);
  document.body.classList.toggle('hist-select', _selectMode);
  if (_selectMode) {
    const n = _selectedIds.size;
    const totalDispo = (window._historyData ? window._historyData.length : 0) + (window._historySeries ? window._historySeries.length : 0);
    const toutCoche = n > 0 && n >= totalDispo;
    toolbar.innerHTML = `
      <button class="hist-tool-btn" onclick="exitSelectMode()">Annuler</button>
      <button class="hist-tool-btn" onclick="${toutCoche ? 'toutDeselectionner()' : 'toutSelectionner()'}">${toutCoche ? 'Aucun' : 'Tout'}</button>
      <span class="hist-tool-count">${n}</span>
      <button class="hist-tool-btn fav" onclick="favoriSelected()" ${n === 0 ? 'disabled' : ''} title="Mettre en favori">${ICON_FAV}<span class="hist-tool-lbl">Favoris</span></button>
      <button class="hist-tool-btn danger" onclick="deleteSelected()" ${n === 0 ? 'disabled' : ''} title="Supprimer">🗑<span class="hist-tool-lbl">Supprimer</span></button>`;
  } else {
    toolbar.innerHTML = `
      <button class="hist-tool-btn" onclick="enterSelectMode()">Sélectionner</button>
      <button class="hist-tool-btn fav${_favFilter ? ' actif' : ''}" onclick="toggleFavFilter()" title="N'afficher que les favoris">${ICON_FAV}<span class="hist-tool-lbl">Favoris</span></button>`;
  }
}

// Filtre "Favoris" en haut : bascule entre "tout" et "seulement les favoris".
function toggleFavFilter() {
  _favFilter = !_favFilter;
  renderHistory();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Retrouve un élément (génération ou série) dans le cache complet.
function _histItem(id) {
  const estSerie = String(id).startsWith('serie:');
  const arr = estSerie ? window._historySeriesAll : window._historyDataAll;
  const item = (arr || []).find(x => (estSerie ? ('serie:' + x.id) : x.id) === id);
  return { estSerie, rawId: estSerie ? id.slice(6) : id, item };
}

// Enregistre l'état favori côté serveur, en arrière-plan (ne bloque jamais
// l'interface). L'affichage, lui, a déjà été mis à jour tout de suite.
function _persisterFavori(table, ids, valeur) {
  if (!supabaseClient || !ids.length) return;
  try {
    supabaseClient.from(table).update({ favori: valeur }).in('id', ids)
      .then(function (r) { if (r && r.error) console.warn('Favori non enregistré', r.error); })
      .catch(function (e) { console.warn('Favori non enregistré', e); });
  } catch (e) { console.warn('Favori non enregistré', e); }
}

// Ajoute/retire UNE génération (ou série) des favoris. Réponse INSTANTANÉE :
// l'étoile devient dorée et l'élément remonte en haut tout de suite ;
// l'enregistrement se fait en arrière-plan.
function toggleFavori(id) {
  const { estSerie, rawId, item } = _histItem(id);
  if (!item) return;
  const nouveau = !item.favori;
  item.favori = nouveau;          // maj optimiste du cache
  dessinerHistorique();           // affichage immédiat (doré + épinglé)
  _persisterFavori(estSerie ? 'series' : 'generations', [rawId], nouveau);
}

// Met en favori (ou retire) toutes les cartes cochées, en une fois et sans délai.
function favoriSelected() {
  const ids = Array.from(_selectedIds);
  if (!ids.length) return;
  // Si tout le lot est déjà en favori → on retire ; sinon → on met en favori.
  const tousDejaFav = ids.every(id => { const r = _histItem(id); return r.item && r.item.favori; });
  const nouveau = !tousDejaFav;
  ids.forEach(id => { const r = _histItem(id); if (r.item) r.item.favori = nouveau; });
  _selectMode = false;
  _selectedIds.clear();
  dessinerHistorique();           // affichage immédiat
  const idsSeries = ids.filter(x => String(x).startsWith('serie:')).map(x => x.slice(6));
  const idsGen = ids.filter(x => !String(x).startsWith('serie:'));
  _persisterFavori('generations', idsGen, nouveau);
  _persisterFavori('series', idsSeries, nouveau);
}

function enterSelectMode() {
  _selectMode = true;
  _selectedIds.clear();
  renderHistory();
}

function exitSelectMode() {
  _selectMode = false;
  _selectedIds.clear();
  renderHistory();
}

// Coche toutes les générations ET toutes les séries affichées
function toutSelectionner() {
  _selectedIds.clear();
  if (window._historyData) window._historyData.forEach(g => _selectedIds.add(g.id));
  if (window._historySeries) window._historySeries.forEach(s => _selectedIds.add('serie:' + s.id));
  renderHistory();
}

function toutDeselectionner() {
  _selectedIds.clear();
  renderHistory();
}

function toggleSelect(id) {
  if (_selectedIds.has(id)) _selectedIds.delete(id);
  else _selectedIds.add(id);
  updateHistoryToolbar();
  // Mettre à jour l'apparence de la carte
  const card = document.querySelector(`.history-card[data-id="${id}"]`);
  if (card) {
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = _selectedIds.has(id);
    card.classList.toggle('selected', _selectedIds.has(id));
  }
}

async function deleteOne(id) {
  // On retrouve le titre ici plutôt que de le passer dans le bouton :
  // un titre contenant un guillemet ou un retour à la ligne cassait le clic.
  const g = (window._historyData || []).find(x => x.id === id);
  let titre = (g && g.titre) ? String(g.titre) : 'cette génération';
  if (titre.length > 60) titre = titre.slice(0, 60) + '…';
  titre = titre.replace(/\s+/g, ' ').trim();
  if (!confirm('Supprimer « ' + titre + ' » ?\n\nCette action est définitive.')) return;
  const ok = await deleteGenerations([id]);
  if (ok) {
    renderHistory();
  } else {
    alert('La suppression a échoué. Réessaie.');
  }
}

async function deleteSelected() {
  const ids = Array.from(_selectedIds);
  if (!ids.length) return;
  if (!confirm('Supprimer ' + ids.length + ' élément' + (ids.length > 1 ? 's' : '') + ' ?\n\nCette action est définitive.')) return;
  const ok = await deleteMixte(ids);
  if (ok) {
    _selectMode = false;
    _selectedIds.clear();
    renderHistory();
  } else {
    alert('La suppression a échoué. Réessaie.');
  }
}

// Supprime une seule série depuis son panier
async function deleteOneSerie(id) {
  // Titre retrouvé ici (et non passé dans le bouton) pour éviter qu'un
  // guillemet dans le titre ne casse le clic.
  const s = (window._historySeries || []).find(x => x.id === id);
  let titre = (s && s.titre) ? String(s.titre).replace(/\s+/g, ' ').trim() : 'cette série';
  if (titre.length > 60) titre = titre.slice(0, 60) + '…';
  if (!confirm('Supprimer la série « ' + titre + ' » et tous ses épisodes ?\n\nCette action est définitive.')) return;
  const ok = await deleteSeries([id]);
  if (ok) renderHistory();
  else alert('La suppression a échoué. Réessaie.');
}

// Rouvre une génération complète dans son mode d'origine (avec hooks, script, légende,
// hashtags, storyboard à la demande — exactement comme à la génération)
function reopenGeneration(i) {
  const g = window._historyData[i];
  if (!g || !g.contenu) return;
  // Empiler 'historyFlow' pour que Retour ramène à la liste des générations
  if (navStack[navStack.length - 1] !== 'historyFlow') navStack.push('historyFlow');
  _skipPush = true; // empêcher les fonctions render d'empiler par-dessus

  document.getElementById('historyFlow').style.display = 'none';
  document.getElementById('homePage').style.display = 'none';
  document.getElementById('flow').style.display = 'none';
  document.getElementById('ideasFlow').style.display = 'none';
  document.getElementById('storyFlow').style.display = 'none';
  const afh = document.getElementById('auditFlow');
  if (afh) afh.style.display = 'none';
  const sfh0 = document.getElementById('serieFlow');
  if (sfh0) sfh0.style.display = 'none';

  // Mémoriser l'id pour pouvoir re-rattacher un storyboard généré ensuite
  currentGenId = g.id || null;

  if (g.mode === 'script') {
    document.getElementById('flow').style.display = 'block';
    currentScript = g.contenu.script;
    currentHooks = g.contenu.hooks;
    lastGenContext = g.contenu.context || { sujet: g.titre, plateforme: 'TikTok' };
    renderResults(g.contenu, g.contenu.niche || '', g.titre || '');
    // Réafficher le storyboard sauvegardé s'il existe
    if (g.contenu.storyboard_genere) {
      setTimeout(() => reafficherStoryboard(g.contenu.storyboard_genere, false), 200);
    }
  } else if (g.mode === 'story') {
    document.getElementById('storyFlow').style.display = 'block';
    lastStoryContext = { sujet: g.titre || '', plateforme: '' };
    renderStory(g.contenu);
    if (g.contenu.storyboard_genere) {
      setTimeout(() => reafficherStoryboard(g.contenu.storyboard_genere, true), 200);
    }
  } else if (g.mode === 'ideas') {
    document.getElementById('ideasFlow').style.display = 'block';
    renderIdeas(g.contenu.idees, g.contenu.niche || '');
  } else if (g.mode === 'audit') {
    const af = document.getElementById('auditFlow');
    if (af) af.style.display = 'block';
    // On rouvre un audit déjà fait : pas de capture ici, on montre le résultat.
    if (typeof masquerUICaptureAudit === 'function') masquerUICaptureAudit();
    renderAudit(g.contenu);
  } else if (g.mode === 'serie') {
    // Un épisode de série : on le réaffiche seul, dans le module série
    const sfh = document.getElementById('serieFlow');
    if (sfh) sfh.style.display = 'block';
    const blocL = document.getElementById('serieListeBloc');
    if (blocL) blocL.style.display = 'none';
    const crea = document.getElementById('serieCreation');
    if (crea) crea.style.display = 'none';
    const nouv = document.getElementById('serieNouvelleBtn');
    if (nouv) nouv.style.display = 'none';
    const det = document.getElementById('serieDetail');
    if (det) {
      const c = g.contenu || {};
      det.style.display = 'block';
      det.innerHTML = '<div class="serie-section-label">' + serieEsc(g.titre || 'Épisode') + '</div>'
        + '<div class="serie-episode">'
        + '<div class="serie-episode-titre">' + serieEsc(c.titre || '') + '</div>'
        + '<div class="serie-episode-txt">' + serieEsc(c.script || '') + '</div>'
        + '</div>'
        + '<button class="serie-suggest-btn" onclick="retourListeSeries()">← Retour à mes séries</button>';
    }
  }

  _skipPush = false; // réactiver l'empilement normal
  window.scrollTo({ top: 0, behavior: 'auto' });
}


// Récupère l'historique des générations de l'utilisateur
// ══════════════════════════════════════
//  POP-UP DE RAPPEL DES RECOMMANDATIONS
//  Dès le lendemain d'un audit, si l'abonné rouvre Scriptura, on lui
//  rappelle sa reco principale et on demande s'il a commencé.
//  Ne s'affiche qu'une fois par audit (mémorisé en localStorage).
// ══════════════════════════════════════

// Extrait la recommandation principale d'un audit sauvegardé.
function recoPrincipale(contenu) {
  if (!contenu || typeof contenu !== 'object') return null;
  const pa = contenu.plan_action_30j || {};
  // Priorité : la première action concrète du plan des 30 jours
  if (Array.isArray(pa.sujets_a_faire) && pa.sujets_a_faire.length) {
    return pa.sujets_a_faire[0];
  }
  if (pa.frequence) return pa.frequence;
  // Sinon, le levier du score (dimension la plus faible), déjà calculé à l'affichage
  if (contenu.mesures) {
    const s = calculerScores(contenu.mesures);
    if (s.levier_dim) return 'Travailler en priorité : ' + s.levier_dim;
  }
  return null;
}

let _rappelAuditCourant = null;

async function verifierRappelAudit() {
  if (!supabaseClient || !unlocked) return; // réservé aux abonnés connectés
  try {
    const { data, error } = await supabaseClient
      .from('generations')
      .select('*')
      .eq('code_acces', getUserRef())
      .eq('mode', 'audit')
      .order('cree_le', { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return;

    const audit = data[0];
    // Déjà rappelé pour cet audit ? on n'insiste pas.
    const dejaVu = localStorage.getItem('scriptura_rappel_' + audit.id);
    if (dejaVu) return;

    // Au moins le lendemain : l'audit doit dater d'un autre jour que today.
    const dateAudit = new Date(audit.cree_le);
    const auj = new Date();
    const memeJour = dateAudit.toDateString() === auj.toDateString();
    if (memeJour) return; // pas le jour même, on attend au moins demain

    const reco = recoPrincipale(audit.contenu);
    if (!reco) return; // rien à rappeler

    _rappelAuditCourant = audit;
    const recoEl = document.getElementById('auditRappelReco');
    if (recoEl) recoEl.textContent = reco;
    document.getElementById('auditRappelStep1').style.display = 'block';
    document.getElementById('auditRappelStep2').style.display = 'none';
    document.getElementById('auditRappelOverlay').classList.add('active');
  } catch(e) { console.warn('Rappel audit échoué', e); }
}

// Depuis le pop-up de rappel (le lendemain d'un audit) : génère directement
// les 10 idées à partir de la niche et l'objectif de l'audit sauvegardé.
function genererIdeesDepuisRappel() {
  const audit = _rappelAuditCourant;
  fermerRappelAudit();
  const contenu = (audit && audit.contenu) ? audit.contenu : {};
  // Si la niche n'est pas dans l'audit sauvegardé, lancerIdeesDepuisAudit
  // ouvrira le formulaire vierge au lieu de générer à l'aveugle.
  lancerIdeesDepuisAudit(contenu.niche || '', contenu.objectif || '');
}

function auditRappelRepondre(aCommence) {
  if (_rappelAuditCourant) {
    localStorage.setItem('scriptura_rappel_' + _rappelAuditCourant.id, aCommence ? 'oui' : 'non');
  }
  document.getElementById('auditRappelStep1').style.display = 'none';
  const step2 = document.getElementById('auditRappelStep2');
  const rep = document.getElementById('auditRappelReponse');
  const btns = document.getElementById('auditRappelStep2Btns');
  if (aCommence) {
    rep.textContent = 'Excellent. La régularité fait toute la différence — continue sur cette lancée, tu es sur la bonne voie.';
    btns.innerHTML = '<button class="rappel-btn rappel-btn-oui" onclick="fermerRappelAudit()">Continuer</button>';
  } else {
    rep.textContent = 'Pas de souci. Le plus dur, c\'est de commencer. Laisse Scriptura te trouver des idées de contenu, tout de suite.';
    btns.innerHTML =
      '<button class="rappel-btn rappel-btn-oui" onclick="genererIdeesDepuisRappel()">Trouver des idées maintenant</button>' +
      '<button class="rappel-btn rappel-btn-non" onclick="fermerRappelAudit()">Plus tard</button>';
  }
  step2.style.display = 'block';
}

function fermerRappelAudit() {
  const el = document.getElementById('auditRappelOverlay');
  if (el) el.classList.remove('active');
}

async function loadGenerations() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('generations')
      .select('*')
      .eq('code_acces', getUserRef())
      .order('cree_le', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  } catch(e) { console.warn('Chargement échoué', e); return []; }
}



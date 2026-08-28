// ── ICÔNES MAISON (trait fin, style du logo) ──
// Source unique pour toutes les icônes en ligne des écrans de résultats
// (diagnostic, audit, recommandations…), en remplacement des emojis système
// qui s'affichaient différemment selon l'appareil. `ICO('nom')` renvoie un
// SVG inline sizé en 1em (classe .ico, voir css/style.css) qui hérite de la
// couleur du texte (currentColor), donc respecte l'or, l'émeraude, etc.
// Chargé avant audit.js / diagnostic-*.js (voir ordre des <script>).
const _ICO_PATHS = {
  chart: '<path d="M4 19h16"/><rect x="5.5" y="13" width="3" height="6" rx=".6"/><rect x="10.5" y="9" width="3" height="10" rx=".6"/><rect x="15.5" y="6" width="3" height="13" rx=".6"/>',
  trend: '<path d="M4 5v14h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 9.5h16"/><path d="M8 3.5v4"/><path d="M16 3.5v4"/>',
  film: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M8 6v12"/><path d="M16 6v12"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  bolt: '<path d="M13 2 5 13h6l-1 9 9-12h-6l1-8Z"/>',
  bulb: '<path d="M9.5 18.5h5"/><path d="M10.5 21h3"/><path d="M12 3.5c-3.6 0-6 2.7-5.4 6.1.3 1.7 1.4 2.9 2.4 3.9.6.6.9 1.2 1 2h4c.1-.8.4-1.4 1-2 1-1 2.1-2.2 2.4-3.9C18 6.2 15.6 3.5 12 3.5Z"/>',
  flame: '<path d="M12 3c1 3-2 4.2-2 7a2 2 0 0 0 4 0c0-.6-.2-1.1-.5-1.6 2 1 3.5 2.9 3.5 5.1a5 5 0 0 1-10 0C7 12 9.5 9.3 12 3Z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  warn: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10.5v3.5"/><path d="M12 17h.01"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>',
  magnet: '<path d="M7 3H4v8a8 8 0 0 0 16 0V3h-3v8a5 5 0 0 1-10 0V3Z"/><path d="M4 7.5h3"/><path d="M17 7.5h3"/>',
  pen: '<path d="M4 20s1-4 3-6l9-9 3 3-9 9c-2 2-6 3-6 3Z"/><path d="M13.5 6.5l3 3"/>',
  people: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.6a3 3 0 0 1 0 5.8"/><path d="M17 14.4a5.5 5.5 0 0 1 3.5 4.6"/>',
  clipboard: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v1.2H9V4.5Z"/><path d="M9 11h6"/><path d="M9 14.5h6"/><path d="M9 18h4"/>',
  link: '<path d="M9 12h6"/><path d="M10 8H7a4 4 0 0 0 0 8h3"/><path d="M14 16h3a4 4 0 0 0 0-8h-3"/>',
  trophy: '<path d="M7 5h10v3a5 5 0 0 1-10 0V5Z"/><path d="M7 6H4.5v1.5A2.5 2.5 0 0 0 7 10"/><path d="M17 6h2.5v1.5A2.5 2.5 0 0 1 17 10"/><path d="M12 13v3"/><path d="M8.5 20h7"/><path d="M10 20v-1.2a2 2 0 0 1 4 0V20"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.7"/><path d="M4 17l4.5-4.5 3.5 3 3-2.5L20.5 17"/>',
  download: '<path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  folder: '<path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z"/>',
  coins: '<circle cx="8.5" cy="15.5" r="5"/><circle cx="15.5" cy="8.5" r="5"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'
};
function ICO(nom, cls) {
  const p = _ICO_PATHS[nom];
  if (!p) return '';
  return '<svg class="' + (cls || 'ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

// ── MENU DÉROULANT MAISON (remplace les <select> à choix nombreux) ──
// Sur mobile, la liste d'un <select> natif est dessinée par l'OS (plein
// écran sur iOS Safari) : aucun contrôle possible sur sa hauteur ou son
// apparence depuis la page. Ce composant construit un menu maison (bouton +
// liste limitée à ~6 choix visibles, petite flèche de défilement discrète)
// tout en laissant le <select> original dans le DOM, masqué : .value,
// .selectedIndex et tout addEventListener('change') déjà branché ailleurs
// (js/app.js, js/generation.js…) continuent de fonctionner sans y toucher.
// Les options sont relues en direct à CHAQUE ouverture (jamais mises en
// cache) : certains select se remplissent après coup (ex. #serieNiche,
// recopié depuis #auditNiche au moment d'ouvrir le mode Série).
function initCustomSelect(select) {
  // toggleInit : déjà pris en charge par initToggleButtons (≤4 choix, voir
  // plus bas), jamais les deux mécanismes sur le même <select>.
  if (!select || select.dataset.customInit === '1' || select.dataset.toggleInit === '1') return;
  select.dataset.customInit = '1';

  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.innerHTML = '<span class="cs-label"></span>'
    + '<svg class="cs-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  wrap.appendChild(trigger);

  const panel = document.createElement('div');
  panel.className = 'custom-select-panel';
  panel.innerHTML = '<div class="custom-select-scroll-hint top" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></div>'
    + '<div class="custom-select-list" role="listbox"></div>'
    + '<div class="custom-select-scroll-hint bottom" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></div>';
  wrap.appendChild(panel);

  const list = panel.querySelector('.custom-select-list');
  const hintTop = panel.querySelector('.custom-select-scroll-hint.top');
  const hintBottom = panel.querySelector('.custom-select-scroll-hint.bottom');
  const labelEl = trigger.querySelector('.cs-label');

  function majTrigger() {
    const opt = select.options[select.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : '';
    trigger.classList.toggle('placeholder', !select.value);
  }

  function majIndicateurs() {
    hintTop.classList.toggle('visible', list.scrollTop > 4);
    hintBottom.classList.toggle('visible', list.scrollTop + list.clientHeight < list.scrollHeight - 4);
  }

  function construireListe() {
    list.innerHTML = '';
    Array.prototype.forEach.call(select.options, function (opt) {
      const item = document.createElement('div');
      item.className = 'custom-select-option' + (opt.value === select.value ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.innerHTML = '<svg class="cs-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg><span>' + (opt.textContent || '') + '</span>';
      item.addEventListener('click', function () {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        majTrigger();
        fermer();
      });
      list.appendChild(item);
    });
  }

  function fermer() {
    wrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function ouvrir() {
    if (wrap.classList.contains('open')) return;
    document.querySelectorAll('.custom-select.open').forEach(function (autre) {
      if (autre !== wrap) autre.classList.remove('open');
    });
    construireListe();
    wrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    // Repart de l'option déjà choisie, pas toujours du tout début de la liste.
    const selected = list.querySelector('.custom-select-option.selected');
    if (selected) list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2 + selected.clientHeight / 2);
    majIndicateurs();
  }

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    if (wrap.classList.contains('open')) fermer(); else ouvrir();
  });
  list.addEventListener('scroll', majIndicateurs);
  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) fermer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && wrap.classList.contains('open')) { fermer(); trigger.focus(); }
  });

  // Certains endroits du code posent select.value directement (ex.
  // preRemplirSiVide, js/profil.js) sans jamais déclencher 'change' : sans
  // cette interception, le bouton affiché resterait bloqué sur l'ancien
  // libellé. Délègue entièrement au setter natif, se contente d'écouter.
  const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (nativeValueDesc && nativeValueDesc.set) {
    Object.defineProperty(select, 'value', {
      get: function () { return nativeValueDesc.get.call(select); },
      set: function (v) { nativeValueDesc.set.call(select, v); majTrigger(); },
      configurable: true
    });
  }
  select.addEventListener('change', majTrigger);

  majTrigger();
}

// Convertit TOUS les <select> d'un conteneur (le document entier par défaut)
// en menu déroulant maison, plutôt qu'une liste d'ids à maintenir à la main
// (l'ancienne approche) : un <select> ajouté quelque part sans être recopié
// dans cette liste restait natif, non stylé, silencieusement, exactement le
// bug remonté par le propriétaire (Style graphique/Format du storyboard,
// jamais présents dans la liste). Les <select> à 4 choix ou moins destinés
// aux boutons cliquables (initToggleButtons ci-dessous) s'excluent d'eux-
// mêmes via le garde croisé toggleInit/customInit ci-dessus et ci-dessous,
// quel que soit l'ordre d'appel.
function initCustomSelectsIn(racine) {
  (racine || document).querySelectorAll('select').forEach(initCustomSelect);
}
function initCustomSelects() {
  initCustomSelectsIn(document);
}
// Observe le DOM en continu pour convertir automatiquement tout nouveau
// <select> inséré après coup (résultats de script/récit/série/storyboard
// seul, panneau montage...), sans dépendre d'un appel manuel ajouté à
// chaque nouvel endroit qui pose un <select> par innerHTML, cause exacte du
// bug initial. Un seul observateur pour toute la session, jamais réinstallé.
function initCustomSelectsWatch() {
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'SELECT') initCustomSelect(node);
        else if (node.querySelectorAll) initCustomSelectsIn(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── BOUTONS CLIQUABLES MAISON (remplace un <select> à 4 choix ou moins) ──
// Règle produit : 4 choix ou moins → menu direct, cliquable en un tap (tous
// les choix visibles d'un coup) ; au-delà de 4 → menu déroulant (voir
// initCustomSelect ci-dessus). Même mécanique de compatibilité : le <select>
// original reste dans le DOM, masqué, .value/.selectedIndex/addEventListener
// ('change') déjà branchés ailleurs (js/audit.js, js/serie.js,
// js/generation.js…) continuent de fonctionner sans y toucher, y compris un
// .value= posé silencieusement par preRemplirSiVide (js/profil.js).
function initToggleButtons(select) {
  if (!select || select.dataset.toggleInit === '1' || select.dataset.customInit === '1') return;
  select.dataset.toggleInit = '1';

  const wrap = document.createElement('div');
  wrap.className = 'toggle-group';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const row = document.createElement('div');
  row.className = 'btn-grid';
  wrap.appendChild(row);

  function construireBoutons() {
    row.innerHTML = '';
    Array.prototype.forEach.call(select.options, function (opt) {
      if (!opt.value) return; // saute le placeholder "Choisis…"
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'grid-btn' + (opt.value === select.value ? ' active' : '');
      btn.textContent = opt.textContent;
      btn.addEventListener('click', function () {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      row.appendChild(btn);
    });
  }

  const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (nativeValueDesc && nativeValueDesc.set) {
    Object.defineProperty(select, 'value', {
      get: function () { return nativeValueDesc.get.call(select); },
      set: function (v) { nativeValueDesc.set.call(select, v); construireBoutons(); },
      configurable: true
    });
  }
  select.addEventListener('change', construireBoutons);

  construireBoutons();
}

function initToggleButtonsAll() {
  ['format', 'auditObjectif', 'auditStyle', 'serieFormat'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) initToggleButtons(el);
  });
}

// ── MASQUER/RÉVÉLER LE FORMULAIRE DE SAISIE UNE FOIS LE RÉSULTAT AFFICHÉ ──
// Une fois une génération réussie, son formulaire (niche, sujet, ton…) n'a
// plus sa place à l'écran : seul le résultat compte. masquerFormulaireGeneration
// le cache (appelée depuis chaque fonction de rendu de résultat) ; le bouton
// "✎ Modifier" du résultat appelle afficherFormulaireGeneration pour le faire
// réapparaître, sans jamais toucher aux valeurs déjà saisies, seulement leur
// visibilité, afin de changer ses critères et régénérer.
function masquerFormulaireGeneration(formId) {
  const form = document.getElementById(formId);
  if (form) form.style.display = 'none';
}
function afficherFormulaireGeneration(formId, resultsId) {
  // Empile l'écran résultat AVANT de le masquer : un "← Retour" pendant la
  // modification retombe ainsi directement sur ce résultat (formulaire
  // remasqué, voir showScreen dans js/navigation.js), jamais plus loin en arrière.
  if (typeof pushNav === 'function') pushNav();
  const form = document.getElementById(formId);
  const results = document.getElementById(resultsId);
  if (results) results.style.display = 'none';
  if (form) {
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── DÉMARRER UN MODE DEPUIS L'ACCUEIL (formulaire garanti vierge) ──
// Utilisée UNIQUEMENT par les 3 tuiles de l'accueil (Idées/Script/Récit) :
// contrairement à chooseMode() seul, elle repart toujours d'un formulaire
// vide (niche, sujet, ton, durée, plateforme…), pour qu'un sujet resté dans
// le champ après une génération précédente (sans rapport) ne s'applique
// jamais silencieusement à la suivante. Volontairement à part de chooseMode()
// : plusieurs chemins internes (lancerIdeesDepuisAudit, demarrerIdeesDepuisSommaire…)
// appellent chooseMode() eux-mêmes pour ouvrir l'écran PUIS pré-remplissent
// un champ précis, un reset à l'intérieur de chooseMode() effacerait ce
// pré-remplissage juste après qu'il ait été posé.
function demarrerModeDepuisAccueil(mode) {
  if (mode === 'script' && typeof restart === 'function') restart();
  else if (mode === 'ideas' && typeof restartIdeas === 'function') restartIdeas();
  else if (mode === 'story' && typeof restartStory === 'function') restartStory();
  chooseMode(mode);
}

// ── BOUTON D'ACCUEIL « Commencer » → mode « focus » ──
// Au clic, l'accueil passe en mode focus : on masque tout le reste (grand
// titre, sections « Comment ça marche / Pourquoi / Tarifs / FAQ », salutation)
// et il ne reste que le cadre du statut, les 5 modes et le footer. Un bouton
// « ← Retour » (haut-gauche) revient à l'accueil complet.
async function revelerModes() {
  const cta = document.getElementById('heroCta');
  const modes = document.getElementById('heroModes');
  const hint = document.getElementById('heroModesHint');
  if (cta) cta.style.display = 'none';
  if (modes) modes.style.display = ''; // retombe sur le display:grid du CSS
  animerHeroModes(modes);
  document.body.classList.add('hero-focus');
  window.scrollTo({ top: 0, behavior: 'auto' });

  // L'invitation "Commence par analyser ton compte" et le badge "Commence
  // ici" (voir aFaitAnalyseCompte, js/recommandations.js) ne s'affichent
  // que si ce n'est pas déjà fait, sinon on continue de pousser vers une
  // étape déjà franchie. `hint` reste caché (son display:none inline
  // d'origine) pendant la vérification, pour ne jamais l'afficher puis le
  // masquer aussitôt (effet de clignotement).
  const dejaAnalyse = (typeof aFaitAnalyseCompte === 'function') ? await aFaitAnalyseCompte() : false;
  if (hint) hint.style.display = dejaAnalyse ? 'none' : '';
  const badge = document.getElementById('auditModeBadge');
  if (badge) badge.style.display = dejaAnalyse ? 'none' : '';
}

// Fait entrer les 6 boutons de mode un par un, alternant gauche/droite
// (audit à gauche, virale à droite, série à gauche...), jamais tous en même
// temps. Réutilise @keyframes liftInLeft/liftInRight (css/style.css, déjà
// utilisées par .reveal-left/.reveal-right au défilement) mais posées ici
// directement en `style.animation` inline, pas via une classe .reveal-*
// gardée par IntersectionObserver : ces boutons vivent sous #heroModes,
// display:none par défaut, donc jamais "vus" par l'observateur de scroll
// tant qu'on ne clique pas sur "Commencer". Rejoué à chaque clic (pas
// seulement la première fois) : le forçage de reflow (offsetWidth) relance
// l'animation même si revelerModes() a déjà tourné dans cette session.
function animerHeroModes(modes) {
  if (!modes) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const btns = modes.querySelectorAll('.hero-mode-btn');
  btns.forEach((btn, i) => {
    const sens = i % 2 === 0 ? 'liftInLeft' : 'liftInRight';
    btn.style.animation = 'none';
    void btn.offsetWidth;
    btn.style.animation = sens + ' .7s cubic-bezier(.2,.7,.2,1) both ' + (i * 0.08).toFixed(2) + 's';
  });
}

// Remet l'accueil dans son état complet (bouton Commencer visible, modes cachés).
function resetAccueilFocus() {
  document.body.classList.remove('hero-focus');
  const cta = document.getElementById('heroCta');
  const modes = document.getElementById('heroModes');
  const hint = document.getElementById('heroModesHint');
  if (modes) modes.style.display = 'none';
  if (hint) hint.style.display = 'none';
  if (cta) cta.style.display = '';
}

// « ← Retour » : quitte le mode focus et revient à l'accueil complet.
function quitterFocus() {
  resetAccueilFocus();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Libellé du bouton selon le statut : un abonné voit une invitation à agir
// (tirée au hasard parmi plusieurs, pour ne pas figer le texte à chaque
// visite), un nouveau visiteur voit l'offre gratuite.
const HERO_CTA_PHRASES_ABONNE = [
  'Que veux-tu créer ?',
  'Tu as une idée en tête ?',
  "Qu'est-ce qu'on écrit aujourd'hui ?",
  'Ton prochain contenu commence ici.',
  'Prêt à faire exploser ton compte ?',
  "Envie de percer aujourd'hui ?",
  'On fait grandir ton audience ?',
  'Tu commences par quoi ?',
  'Par quoi on commence ?',
  "On s'y met ?"
];
// Tirée une seule fois par visite (pas à chaque appel de majHeroCta, qui est
// rappelée souvent, après chaque génération, changement de quota…) pour que
// le texte reste stable pendant toute la session au lieu de changer sous les yeux.
let _heroCtaPhraseAbonne = null;
function majHeroCta() {
  const lbl = document.getElementById('heroCtaLabel');
  if (!lbl) return;
  if (typeof unlocked !== 'undefined' && unlocked) {
    if (!_heroCtaPhraseAbonne) {
      _heroCtaPhraseAbonne = HERO_CTA_PHRASES_ABONNE[Math.floor(Math.random() * HERO_CTA_PHRASES_ABONNE.length)];
    }
    lbl.textContent = _heroCtaPhraseAbonne;
  } else {
    lbl.textContent = 'Commence gratuitement';
  }
  const free = document.getElementById('heroFree');
  if (free) {
    const dejaAbonne = typeof unlocked !== 'undefined' && unlocked;
    const maxGratuit = typeof MAX_FREE !== 'undefined' ? MAX_FREE : 5;
    free.textContent = dejaAbonne ? 'Aucun compte requis' : `Aucun compte requis • ${maxGratuit} générations offertes`;
  }
}

function openModal() {
  // Fermer le paywall et le rappel s'ils sont ouverts (sinon ils masquent cette modal)
  const pw = document.getElementById('paywall');
  if (pw) pw.classList.remove('active');
  const rappel = document.getElementById('rappelOverlay');
  if (rappel) rappel.classList.remove('active');
  document.getElementById('modalOverlay').classList.add('active');
  setTimeout(() => document.getElementById('codeInput').focus(), 100);
}


// ── RÉVÉLATION AU DÉFILEMENT (page d'accueil) ──
// Ajoute .visible dès qu'un bloc .reveal/.reveal-left/.reveal-right entre
// dans l'écran (voir @media prefers-reduced-motion:no-preference,
// css/style.css, pour l'animation elle-même). Un seul observateur pour
// toute la page, jamais réinstallé. Si IntersectionObserver n'existe pas
// (très vieux navigateur), affiche tout immédiatement plutôt que de
// laisser des blocs invisibles sans jamais les révéler.
function initScrollReveal() {
  const els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => observer.observe(el));
}

// ── TICKER D'ACCUEIL, un mot à la fois ──
// Remplace l'ancienne bande défilante continue : un mot glisse d'un côté,
// tient 2s, ressort de l'autre (voir @keyframes tickerSweepLTR/RTL,
// css/style.css), la direction alterne à chaque mot. En mouvement réduit,
// l'animation CSS est coupée par le média query, donc `animationend` ne se
// déclenche jamais, ce qui figerait le mot sur le premier pour toujours,
// on bascule alors sur une simple alternance par minuterie, sans glissement.
// Fonctionnalités reprises mot pour mot des boutons du héro/pied de page
// (voir .mode-label et footer-link-btn, index.html) pour rester cohérent
// avec le wording déjà utilisé ailleurs sur la page.
const TICKER_MOTS = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'Facebook', 'Écris-moi un script', 'Trouve-moi des idées', 'Raconte-moi une histoire', 'Storyboard d\'un script', 'Crée-moi une série', 'Analyse mon compte TikTok', 'Analyse-moi une vidéo TikTok', 'Transcrire une vidéo TikTok', 'Télécharger une vidéo TikTok', 'Scripts viraux', 'Hooks irrésistibles', 'Contenu faceless', 'Finance', 'Bien-être', 'Business', 'Histoire', 'Géopolitique', 'Développement personnel'];
function initTicker() {
  const el = document.getElementById('tickerWord');
  if (!el) return;
  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0;
  function motSuivant() {
    el.textContent = TICKER_MOTS[i % TICKER_MOTS.length];
    if (!reduit) {
      el.classList.remove('tk-ltr', 'tk-rtl');
      void el.offsetWidth; // force le navigateur à relire le style avant de rajouter la classe, sinon l'animation ne se relance pas au 2e mot
      el.classList.add(i % 2 === 0 ? 'tk-ltr' : 'tk-rtl');
    }
    i++;
  }
  if (reduit) {
    motSuivant();
    setInterval(motSuivant, 2000);
  } else {
    el.addEventListener('animationend', motSuivant);
    motSuivant();
  }
}

// ── BOUTON INTELLIGENT HAUT/BAS ──
// Descend en bas si on est en haut, remonte en haut si on est en bas.
function scrollSmart() {
  // Couper net toute inertie de scroll manuel en cours : on "fixe" la position
  // actuelle en instantané. Sans ça, sur mobile, le premier clic ne fait
  // qu'arrêter le mouvement du doigt et il faut recliquer.
  window.scrollTo({ top: window.scrollY, behavior: 'auto' });
  // Puis on lance le défilement automatique au tour de boucle suivant,
  // pour que le navigateur ait bien enregistré l'arrêt avant de repartir.
  const cible = (_scrollDir === 'down') ? document.body.scrollHeight : 0;
  requestAnimationFrame(() => {
    window.scrollTo({ top: cible, behavior: 'smooth' });
  });
}
// Garde l'ancien nom au cas où il est appelé ailleurs
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

let _lastScrollY = 0;
let _scrollDir = 'down'; // sens courant du scroll
// Logo discret pendant le travail (retour propriétaire) : dès qu'on quitte le
// haut de page, le logo de la nav s'atténue (voir .logo, css/style.css), pour
// ne pas « pousser » la marque en continu pendant la lecture/écriture. Il
// reprend sa pleine présence au survol (CSS seul) ou en remontant en haut.
function majLogoNav() {
  document.body.classList.toggle('nav-scrolled', window.scrollY > 80);
}
function updateScrollBtn() {
  majLogoNav();
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  // La page est-elle assez longue pour scroller ?
  const scrollable = document.body.scrollHeight > window.innerHeight + 200;
  if (!scrollable) { btn.classList.remove('visible'); return; }

  btn.classList.add('visible');

  const y = window.scrollY;
  // Détecter le sens du scroll (avec un petit seuil pour éviter les micro-mouvements)
  if (y > _lastScrollY + 4) _scrollDir = 'down';
  else if (y < _lastScrollY - 4) _scrollDir = 'up';
  _lastScrollY = y;

  // La flèche suit le sens du scroll. Une icône SVG dessinée à la main
  // (pas un caractère "↓"/"↑") tournée à 180°, contrairement au glyphe
  // Unicode, son centrage dans le cercle reste identique sur tous les
  // navigateurs (le rendu de "↓" variait entre Safari iOS et Chrome).
  const icone = document.getElementById('scrollTopIcon');
  if (icone) icone.style.transform = (_scrollDir === 'down') ? '' : 'rotate(180deg)';
  btn.setAttribute('title', (_scrollDir === 'down') ? 'Descendre en bas' : 'Remonter en haut');
}
window.addEventListener('scroll', updateScrollBtn);
window.addEventListener('resize', updateScrollBtn);

// ── MENU LATÉRAL (SIDEBAR) ──
// L'icône du bouton reflète l'état : panneau gauche plein quand le menu est
// fermé, panneau creux (juste le contour) une fois ouvert. Mise à jour ici,
// dans openSidebar/closeSidebar directement, pour rester juste peu importe
// le déclencheur (bouton, overlay, ✕ dans le menu, sidebarGo).
function majMenuToggleIcon(ouvert) {
  const fill = document.getElementById('menuToggleFill');
  const btn = document.getElementById('menuToggleBtn');
  if (fill) fill.style.display = ouvert ? 'none' : '';
  if (btn) btn.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
}
function openSidebar() {
  document.getElementById('sidebar').classList.add('active');
  document.getElementById('sidebarOverlay').classList.add('active');
  majMenuToggleIcon(true);
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('active');
  document.getElementById('sidebarOverlay').classList.remove('active');
  majMenuToggleIcon(false);
}
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('active')) closeSidebar();
  else openSidebar();
}
function sidebarGo(action) {
  closeSidebar();
  if (action === 'history') { openHistory(); }
  else if (action === 'admin') { ouvrirTableauDeBord(); }
  else if (action === 'code') { openModal(); }
  else if (action === 'storyboardSeul') { if (typeof openStoryboardSeul === 'function') openStoryboardSeul(); }
  else if (action === 'subscribe') {
    // Ouvre le pop-up de choix des plans (Creator / Pro) ; l'utilisateur
    // choisit son plan avant d'être redirigé vers WhatsApp.
    if (typeof openPlans === 'function') openPlans('abonnement');
  }
}
// "Changer de code d'accès" (panneau latéral, visible uniquement pour un
// abonné) : ouvre la même fenêtre de saisie que "J'ai un code" (verifyCode(),
// js/auth.js, recharge systématiquement la page à la validation, quel que
// soit le point d'entrée).
function changerCodeAcces() {
  closeSidebar();
  openModal();
}

function seDeconnecter() {
  unlocked = false;
  localStorage.setItem('scriptura_unlocked', 'false');
  localStorage.removeItem('scriptura_code');
  localStorage.removeItem('scriptura_expire');
  localStorage.removeItem('scriptura_is_admin');
  localStorage.removeItem('scriptura_illimite');
  document.body.classList.remove('is-unlocked');
  closeSidebar();
  location.reload();
}


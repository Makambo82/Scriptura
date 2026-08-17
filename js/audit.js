let auditCaptures = []; // { nom, dataUrl, mediaType, base64 }
const AUDIT_MAX = 16;

// Ajoute les fichiers choisis (galerie ou appareil photo)
async function ajouterCaptures(files) {
  const err = document.getElementById('auditError');
  err.style.display = 'none';
  const liste = Array.from(files || []);
  for (const f of liste) {
    if (auditCaptures.length >= AUDIT_MAX) {
      err.textContent = 'Maximum ' + AUDIT_MAX + ' captures.';
      err.style.display = 'block';
      break;
    }
    if (!f.type.startsWith('image/')) continue;
    try {
      const compresse = await compresserImage(f);
      // On mémorise l'étape où la capture a été ajoutée : ça permet de dire
      // si elle correspond bien à la donnée demandée à ce moment-là.
      compresse.etape = (typeof auditAffineMode !== 'undefined' && auditAffineMode) ? null : auditEtapeIndex;
      auditCaptures.push(compresse);
    } catch(e) { console.warn('Capture ignorée', e); }
  }
  document.getElementById('auditInput').value = '';
  awConfirmSaut = false; // une capture vient d'arriver : on lève un éventuel avertissement de saut
  renderCaptures();
  if (typeof renderAuditWizard === 'function') renderAuditWizard();
  detecterTypesCaptures(); // reconnaissance en arrière-plan, sans bloquer
}

// Types de données attendues, pour l'affichage
const AUDIT_TYPES = {
  1: "Vue d'ensemble",
  2: "Détail vidéo",
  3: "Top contenus",
  4: "Audience"
};

// Demande à l'IA (Haiku, rapide et bon marché) de reconnaître chaque capture.
// N'analyse rien : sert juste à confirmer à l'utilisateur que Scriptura
// a bien identifié ce qu'il envoie. N'empêche jamais de lancer l'audit.
async function detecterTypesCaptures() {
  if (!auditCaptures.length) return;
  // On marque tout comme "en cours" pour un retour visuel immédiat
  auditCaptures.forEach(c => { if (c.type === undefined) c.type = 'attente'; });
  renderCaptures();
  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'classify',
        images: auditCaptures.map(c => ({ base64: c.base64, mediaType: c.mediaType })),
        code_acces: localStorage.getItem('scriptura_code') || null
      })
    });
    if (!res.ok) throw new Error('classification indisponible');
    const data = await res.json();
    const brut = (data.content || []).map(b => b.text || '').join('');
    const types = JSON.parse(brut.replace(/```json|```/g, '').trim());
    if (!Array.isArray(types)) throw new Error('réponse illisible');
    auditCaptures.forEach((c, i) => { c.type = (types[i] != null) ? types[i] : null; });
  } catch(e) {
    // En cas d'échec, on n'affiche aucun symbole plutôt qu'une fausse info
    console.warn('Détection des captures indisponible', e);
    auditCaptures.forEach(c => { c.type = null; });
  }
  renderCaptures();
}

// Réduit la taille de l'image avant envoi (les captures de téléphone sont lourdes)
function compresserImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('lecture impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image invalide'));
      img.onload = () => {
        // Compression adaptative : au-delà de 8 captures, on réduit un peu plus
        // pour que le poids TOTAL de l'envoi reste dans les limites du serveur.
        // 1100 px reste largement suffisant pour lire des chiffres de statistiques.
        const beaucoup = auditCaptures.length >= 8;
        const MAX = beaucoup ? 1100 : 1400;
        const QUALITE = beaucoup ? 0.72 : 0.82;
        let { width, height } = img;
        if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', QUALITE);
        resolve({
          nom: file.name || 'capture',
          dataUrl: dataUrl,
          mediaType: 'image/jpeg',
          base64: dataUrl.split(',')[1]
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Affiche les vignettes des captures ajoutées
function renderCaptures() {
  const zone = document.getElementById('auditThumbs');
  const btn = document.getElementById('auditBtn');
  if (!zone) return;
  zone.innerHTML = auditCaptures.map((c, i) => {
    return `
    <div class="audit-thumb">
      <img src="${c.dataUrl}" alt="capture ${i+1}"/>
      ${badgeCapture(c)}
      <button class="audit-thumb-del" onclick="retirerCapture(${i})" title="Retirer">✕</button>
    </div>`;
  }).join('');
  renderCouverture();
  // La visibilité du bouton dépend de l'étape (bouton visible seulement à
  // l'étape finale, ou en mode affiner), géré par l'assistant guidé.
  if (typeof majAffichageBoutonAudit === 'function') majAffichageBoutonAudit();
  else if (btn) btn.style.display = auditCaptures.length ? 'flex' : 'none';
  // Met à jour le statut ✅/⏳ de l'étape courante (la reconnaissance IA est async).
  if (typeof majStatutEtape === 'function') majStatutEtape();
}

// Badge d'une vignette : ✅ si c'est bien la donnée demandée à l'étape où elle
// a été ajoutée, ⚠️ si l'image n'est pas reconnue OU ne correspond pas à cette
// étape, … pendant l'analyse. (Reconnaissance globale via detecterTypesCaptures.)
function badgeCapture(c) {
  if (c.type === 'attente') return '<span class="thumb-badge attente">…</span>';
  if (c.type === 0) return '<span class="thumb-badge alerte" title="Cette image ne correspond à aucune des 5 données attendues">⚠️</span>';
  if (AUDIT_TYPES[c.type]) {
    const attendu = (c.etape != null) ? AUDIT_ETAPE_TYPE[c.etape] : null;
    if (attendu && c.type !== attendu) {
      const t = 'Cette capture ressemble à : ' + AUDIT_TYPES[c.type] + ', pas à la donnée demandée à cette étape';
      return '<span class="thumb-badge alerte" title="' + t + '">⚠️</span>';
    }
    return '<span class="thumb-badge ok" title="' + AUDIT_TYPES[c.type] + ' reconnue">✅</span>';
  }
  return '';
}

// Récapitule les données reconnues et celles qui manquent encore.
function renderCouverture() {
  const zone = document.getElementById('auditCouverture');
  if (!zone) return;
  const typesVus = new Set(auditCaptures.map(c => c.type).filter(t => AUDIT_TYPES[t]));
  const enAttente = auditCaptures.some(c => c.type === 'attente');
  if (!auditCaptures.length || enAttente) { zone.innerHTML = ''; return; }
  // Le "détail vidéo" couvre 2 des 5 données (meilleure + pire) : on ne peut pas
  // les distinguer visuellement, donc on reste factuel sur ce qui est reconnu.
  const lignes = Object.keys(AUDIT_TYPES).map(k => {
    const vu = typesVus.has(Number(k));
    return `<div class="couv-ligne ${vu ? 'vue' : 'manque'}">${vu ? '✅' : '○'} ${AUDIT_TYPES[k]}</div>`;
  }).join('');
  const nbAlerte = auditCaptures.filter(c => c.type === 0).length;
  const note = nbAlerte
    ? `<div class="couv-note">${formaterNombre(nbAlerte)} capture${nbAlerte > 1 ? 's' : ''} non reconnue${nbAlerte > 1 ? 's' : ''}. Tu peux quand même lancer le diagnostic : Scriptura te dira à la fin ce qui lui a manqué.</div>`
    : '';
  zone.innerHTML = `<div class="couv-titre">Ce que Scriptura a reconnu</div>${lignes}${note}`;
}

function retirerCapture(i) {
  auditCaptures.splice(i, 1);
  renderCaptures();
}

// ═══════════════════════════════════════════════════════════
//  ASSISTANT DE CAPTURE GUIDÉ, une donnée TikTok à la fois
//  Même exigence qu'avant (5 données, jusqu'à 16 captures) : on ne fait que
//  guider l'utilisateur écran par écran pour réduire la confusion. Toute la
//  mécanique (auditCaptures, reconnaissance IA, lancerAudit) reste inchangée.
// ═══════════════════════════════════════════════════════════
// ORDRE DES ÉTAPES, pensé pour que l'utilisateur enchaîne les onglets de
// l'écran "Analytique" sans quitter TikTok Studio : Vue d'ensemble → Contenu →
// Spectateurs sont trois onglets voisins. La meilleure/pire vidéo passe EN
// DERNIER car elle oblige à sortir d'Analytique pour ouvrir chaque vidéo.
//
// Chaque étape peut porter des "exemples" : de vraies captures TikTok Studio,
// annotées d'une flèche rouge, montrant précisément l'écran à photographier.
// Elles s'affichent SOUS le schéma indicatif (voir renderAuditWizard) et sont
// chargées en différé (loading="lazy") pour ne pas ralentir la page.
const AUDIT_ETAPES = [
  {
    titre: "Vue d'ensemble · 60 jours",
    path: "TikTok Studio → Analyses → Vue d'ensemble → Période : 60 jours",
    tip: "Cet écran montre tes vues de publication, tes vues de profil, tes J'aime, tes commentaires et tes partages sur la période. Pense bien à sélectionner « 60 jours ».",
    label: "Ajouter : vue d'ensemble",
    schema: `<svg viewBox="0 0 200 110" fill="none"><line x1="20" y1="92" x2="188" y2="92" stroke="rgba(255,255,255,0.15)"/><rect x="34" y="62" width="16" height="30" rx="2" fill="#C9A84C" opacity="0.8"/><rect x="66" y="48" width="16" height="44" rx="2" fill="#C9A84C" opacity="0.8"/><rect x="98" y="54" width="16" height="38" rx="2" fill="#C9A84C" opacity="0.8"/><rect x="130" y="34" width="16" height="58" rx="2" fill="#C9A84C" opacity="0.8"/><rect x="162" y="22" width="16" height="70" rx="2" fill="#E2C87A"/></svg>`,
    exemples: [
      { src: "assets/audit/ov.webp", cap: "Onglet « Vue d'ensemble », période 60 jours." }
    ]
  },
  {
    titre: "Top contenus · 60 jours",
    path: "TikTok Studio → Analyses → Contenu → Période : 60 jours → « Les plus vues »",
    tip: "La liste de tes vidéos classées par vues : elle situe tes deux vidéos par rapport au reste de ton compte. Descends jusqu'en bas (10 vidéos) : le plus souvent, il faut deux captures.",
    label: "Ajouter : top contenus",
    schema: `<svg viewBox="0 0 200 110" fill="none"><rect x="20" y="16" width="30" height="22" rx="3" fill="rgba(201,168,76,0.28)"/><rect x="58" y="20" width="110" height="6" rx="3" fill="#E2C87A"/><rect x="58" y="30" width="70" height="5" rx="3" fill="rgba(255,255,255,0.25)"/><rect x="20" y="46" width="30" height="22" rx="3" fill="rgba(201,168,76,0.22)"/><rect x="58" y="50" width="90" height="6" rx="3" fill="#C9A84C"/><rect x="58" y="60" width="60" height="5" rx="3" fill="rgba(255,255,255,0.22)"/><rect x="20" y="76" width="30" height="22" rx="3" fill="rgba(201,168,76,0.16)"/><rect x="58" y="80" width="70" height="6" rx="3" fill="rgba(201,168,76,0.6)"/><rect x="58" y="90" width="45" height="5" rx="3" fill="rgba(255,255,255,0.2)"/></svg>`,
    exemples: [
      { src: "assets/audit/top-1.webp", cap: "Onglet « Contenu » → « Les plus vues » (n° 1 à 5)." },
      { src: "assets/audit/top-2.webp", cap: "Descends pour la suite (jusqu'à la n° 10)." }
    ]
  },
  {
    titre: "Ton audience",
    path: "TikTok Studio → Analyses → Spectateurs → Sexe, Âge et Emplacements",
    tip: "Qui te regarde : sexe, âge, pays. En bas de l'écran, appuie tour à tour sur « Sexe », « Âge » puis « Emplacements » et prends une capture de chacun, l'emplacement (pays) est le plus important pour savoir si ton contenu parle à la bonne audience.",
    label: "Ajouter : audience",
    schema: `<svg viewBox="0 0 200 110" fill="none"><circle cx="58" cy="55" r="28" stroke="rgba(255,255,255,0.15)" stroke-width="12" fill="none"/><circle cx="58" cy="55" r="28" stroke="#C9A84C" stroke-width="12" fill="none" stroke-dasharray="105 71" transform="rotate(-90 58 55)"/><circle cx="58" cy="55" r="28" stroke="#E2C87A" stroke-width="12" fill="none" stroke-dasharray="48 128" stroke-dashoffset="-105" transform="rotate(-90 58 55)"/><rect x="104" y="34" width="66" height="8" rx="4" fill="#E2C87A"/><rect x="104" y="51" width="48" height="8" rx="4" fill="#C9A84C"/><rect x="104" y="68" width="30" height="8" rx="4" fill="rgba(201,168,76,0.5)"/></svg>`,
    exemples: [
      { src: "assets/audit/audience.webp", cap: "Onglet « Spectateurs » → une capture par onglet : Sexe, Âge, Emplacements." }
    ]
  },
  {
    titre: "Ta vidéo la plus performante · analyse complète",
    path: "Depuis ton profil, ouvre ta MEILLEURE vidéo, puis appuie sur « Plus de données » (bandeau du bas). Autre méthode : les trois points « ⋯ » à droite de la vidéo → « Données analytiques ».",
    tip: "Sur l'écran des données, descends jusqu'à la courbe de rétention. Si tout ne tient pas, prends deux captures : les indicateurs en haut (dont les nouveaux abonnés gagnés par la vidéo), puis la courbe plus bas.",
    label: "Ajouter : meilleure vidéo",
    schema: `<svg viewBox="0 0 200 110" fill="none"><line x1="20" y1="92" x2="188" y2="92" stroke="rgba(255,255,255,0.15)"/><polyline points="24,28 44,40 70,56 100,60 140,62 184,66" stroke="#E2C87A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
    exemples: [
      { src: "assets/audit/video-indicateurs.webp", cap: "Les indicateurs de la vidéo (dont les nouveaux abonnés gagnés)." },
      { src: "assets/audit/video-retention.webp", cap: "Plus bas sur le même écran : la courbe de rétention." }
    ]
  },
  {
    titre: "Ta vidéo la moins performante · analyse complète",
    path: "Depuis ton profil, ouvre ta MOINS bonne vidéo, puis appuie sur « Plus de données » (bandeau du bas). Autre méthode : les trois points « ⋯ » à droite de la vidéo → « Données analytiques ».",
    tip: "Même écran que pour ta meilleure vidéo : les indicateurs en haut, puis la courbe de rétention plus bas (deux captures si nécessaire). C'est la comparaison des deux qui révèle ce qui marche.",
    label: "Ajouter : vidéo la moins performante",
    schema: `<svg viewBox="0 0 200 110" fill="none"><line x1="20" y1="92" x2="188" y2="92" stroke="rgba(255,255,255,0.15)"/><polyline points="24,26 40,52 60,74 90,84 140,88 184,90" stroke="#C9A84C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
    exemples: [
      { src: "assets/audit/video-indicateurs.webp", cap: "Mêmes écrans, pour ta vidéo la moins bonne : les indicateurs…" },
      { src: "assets/audit/video-retention.webp", cap: "…puis la courbe de rétention plus bas." }
    ]
  }
];

// Type de donnée attendu à chaque étape (voir AUDIT_TYPES), dans le MÊME ordre
// que AUDIT_ETAPES ci-dessus : 1 = vue d'ensemble, 3 = top contenus,
// 4 = audience, 2 = détail vidéo (meilleure ET pire, que la reconnaissance ne
// sait pas distinguer, c'est normal et sans conséquence).
const AUDIT_ETAPE_TYPE = [1, 3, 4, 2, 2];

let auditEtapeIndex = 0;   // 0..AUDIT_ETAPES.length (la dernière = profil + lancement)
let auditAffineMode = false;
let awConfirmSaut = false; // true quand on demande "continuer sans la capture ?"

function auditSurEtapeFinale() { return auditEtapeIndex >= AUDIT_ETAPES.length; }

// Statut ✅/⏳ de l'étape courante, mis à jour quand la reconnaissance IA arrive.
function majStatutEtape() {
  if (awConfirmSaut) return; // ne pas écraser l'avertissement de saut
  const el = document.getElementById('awStatut');
  if (!el) return;
  if (auditAffineMode || auditSurEtapeFinale()) { el.innerHTML = ''; return; }
  const attendu = AUDIT_ETAPE_TYPE[auditEtapeIndex];
  if (auditCaptures.some(c => c.type === 'attente')) {
    el.innerHTML = '<span class="aw-statut attente">⏳ Scriptura lit ta capture…</span>';
  } else if (auditCaptures.some(c => c.type === attendu)) {
    el.innerHTML = '<span class="aw-statut ok">✅ Cette donnée est bien reconnue</span>';
  } else {
    el.innerHTML = '';
  }
}

// Prépare l'écran audit : mode normal (parcours guidé) ou mode "affiner"
// (ajout direct de captures + relance, sans re-parcourir les 5 étapes).
function initAuditWizard(affine) {
  auditAffineMode = !!affine;
  auditEtapeIndex = affine ? AUDIT_ETAPES.length : 0;
  awConfirmSaut = false; // repart propre à chaque entrée dans l'audit
  // Mode normal (pas "affiner") : formulaire ET captures vides, sinon les
  // captures et le contexte (niche, objectif…) d'un audit précédent (ou
  // annulé) restaient silencieusement actifs pour le suivant, même sans
  // aucun rapport avec lui (même défaut que Script/Idées/Récit/Série, voir
  // restart() dans js/generation.js). "Affiner" doit à l'inverse TOUJOURS
  // garder captures et contexte : c'est tout son principe.
  if (!affine) {
    auditCaptures.length = 0;
    ['auditNiche', 'auditObjectif', 'auditFrequence', 'auditStyle'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
  renderAuditWizard();
}

// Masque toute l'UI de capture (utilisé pour afficher un audit déjà enregistré).
function masquerUICaptureAudit() {
  ['auditWizard', 'auditContextCard', 'auditAffineNote', 'auditDrop', 'auditThumbs', 'auditCouverture', 'auditBtn']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  // On sort toujours du mode "affiner" en montrant un résultat propre, sinon
  // il resterait bloqué à true indéfiniment (rien d'autre ne le remet à
  // false), et auditRetour() finirait par re-afficher le même résultat en
  // boucle au lieu de quitter le module au clic suivant sur "← Retour".
  auditAffineMode = false;
}

function majAffichageBoutonAudit() {
  const btn = document.getElementById('auditBtn');
  if (!btn) return;
  const pret = auditCaptures.length > 0 && (auditSurEtapeFinale() || auditAffineMode);
  btn.style.display = pret ? 'flex' : 'none';
}

function renderAuditWizard() {
  const wiz = document.getElementById('auditWizard');
  const card = document.getElementById('awCard');
  const nav = document.getElementById('awNav');
  const count = document.getElementById('awCount');
  const barFill = document.getElementById('awBarFill');
  const ctx = document.getElementById('auditContextCard');
  const affineNote = document.getElementById('auditAffineNote');
  const drop = document.getElementById('auditDrop');
  const thumbs = document.getElementById('auditThumbs');
  const couv = document.getElementById('auditCouverture');
  const dropLabel = drop ? drop.querySelector('.audit-drop-label') : null;

  if (thumbs) thumbs.style.display = '';
  if (drop) drop.style.display = '';

  // ── Mode "affiner" : pas de re-parcours, on montre l'ajout + le rappel ──
  if (auditAffineMode) {
    if (wiz) wiz.style.display = 'none';
    if (ctx) ctx.style.display = 'none';
    if (affineNote) affineNote.style.display = 'block';
    if (couv) couv.style.display = '';
    if (dropLabel) dropLabel.textContent = 'Ajouter une capture';
    majAffichageBoutonAudit();
    return;
  }

  if (affineNote) affineNote.style.display = 'none';
  const finale = auditSurEtapeFinale();

  if (!finale) {
    // ── Étapes de capture guidées (une donnée à la fois) ──
    const e = AUDIT_ETAPES[auditEtapeIndex];
    if (wiz) wiz.style.display = '';
    if (count) count.textContent = 'Étape ' + (auditEtapeIndex + 1) + ' / ' + AUDIT_ETAPES.length;
    if (barFill) barFill.style.width = Math.round((auditEtapeIndex / AUDIT_ETAPES.length) * 100) + '%';
    // Exemples réels (captures TikTok Studio annotées d'une flèche rouge) :
    // montrent l'écran exact à photographier. Chargés en différé (lazy).
    const exHtml = (e.exemples && e.exemples.length)
      ? '<div class="aw-ex"><div class="aw-ex-titre">📸 L\'écran exact à capturer</div><div class="aw-ex-grid">' +
        e.exemples.map(x =>
          '<figure class="aw-ex-item"><img src="' + x.src + '" loading="lazy" decoding="async" alt="Exemple : ' + auditEsc(e.titre) + '" class="aw-ex-img"><figcaption>' + x.cap + '</figcaption></figure>'
        ).join('') +
        '</div></div>'
      : '';
    if (card) card.innerHTML =
      '<div class="aw-schema">' + e.schema + '</div>' +
      '<div class="aw-schema-note">schéma indicatif</div>' +
      '<div class="aw-title">' + e.titre + '</div>' +
      '<div class="aw-path">' + e.path + '</div>' +
      (e.tip ? '<div class="aw-tip">' + e.tip + '</div>' : '') +
      exHtml +
      '<div id="awStatut"></div>';
    if (nav) {
      let b = '';
      if (auditEtapeIndex > 0) b += '<button onclick="auditStepPrecedent()">← Précédent</button>';
      const labelSuite = awConfirmSaut ? 'Continuer quand même →'
        : (auditEtapeIndex === AUDIT_ETAPES.length - 1 ? 'Terminer →' : 'Suivant →');
      b += '<button class="aw-primary" onclick="auditStepSuivant()">' + labelSuite + '</button>';
      nav.innerHTML = b;
    }
    if (ctx) ctx.style.display = 'none';
    if (couv) couv.style.display = 'none';
    if (dropLabel) dropLabel.textContent = e.label;
    // Statut de l'étape : avertissement de saut prioritaire, sinon ✅/⏳.
    if (awConfirmSaut) {
      const st = document.getElementById('awStatut');
      if (st) st.innerHTML = '<span class="aw-statut alerte">⚠️ Tu n\'as pas ajouté « ' + e.titre + ' ». Ajoute-la maintenant, ou continue quand même.</span>';
    } else {
      majStatutEtape();
    }
  } else {
    // ── Étape finale : récap + retour possible, puis profil + lancement ──
    if (wiz) wiz.style.display = '';
    if (count) count.textContent = 'Dernière étape';
    if (barFill) barFill.style.width = '100%';
    if (card) card.innerHTML =
      '<div class="aw-title">Presque terminé 🎯</div>' +
      '<div class="aw-tip">Renseigne ton profil ci-dessous, vérifie tes captures, puis lance le diagnostic. Il te manque une donnée ? Ajoute-la, ou reviens en arrière.</div>';
    if (nav) nav.innerHTML = '<button onclick="auditStepPrecedent()">← Revoir mes captures</button>';
    if (ctx) ctx.style.display = '';
    if (couv) couv.style.display = '';
    if (dropLabel) dropLabel.textContent = 'Ajouter une capture oubliée';
  }
  majAffichageBoutonAudit();
}

function auditStepSuivant() {
  // Avant d'avancer : la donnée de cette étape est-elle bien présente ?
  if (!auditSurEtapeFinale()) {
    const attendu = AUDIT_ETAPE_TYPE[auditEtapeIndex];
    const enAttente = auditCaptures.some(c => c.type === 'attente');
    const present = auditCaptures.some(c => c.type === attendu);
    if (!present && !enAttente && !awConfirmSaut) {
      // Rien pour cette donnée : on prévient, sans bloquer. Un 2e clic passe.
      awConfirmSaut = true;
      renderAuditWizard();
      return;
    }
  }
  awConfirmSaut = false;
  if (auditEtapeIndex < AUDIT_ETAPES.length) auditEtapeIndex++;
  renderAuditWizard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function auditStepPrecedent() {
  awConfirmSaut = false;
  if (auditEtapeIndex > 0) auditEtapeIndex--;
  renderAuditWizard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


// ═══════════════════════════════════════════════════════════
//  AUDIT, Prompt d'analyse + branchement IA + affichage
// ═══════════════════════════════════════════════════════════

// Échappe le HTML pour un affichage sûr. Couvre aussi les guillemets (pas
// seulement &<>) : cette fonction est réutilisée par d'autres fichiers pour
// échapper du texte inséré dans des attributs (ex. onclick="...'...'"), où
// un guillemet non échappé permettrait de sortir de l'attribut.
function auditEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Analyse détaillée « musclée » : garantit qu'un diagnostic de CONTENU récent
// (sommaire) de SON compte existe AVANT l'appel /api/audit, pour que le serveur
// croise contenu × diffusion (synthese_croisee, voir api/audit.js).
//   • Réutilise la dernière sommaire de SON compte si elle est récente (< 10 j).
//   • Sinon en lance une nouvelle en tâche de fond, avec le @pseudo réutilisé de
//     la dernière sommaire, ou demandé UNE seule fois s'il est inconnu.
// Best-effort et SANS quota : n'échoue jamais l'audit (déjà payé), ne décompte
// aucune analyse sommaire (c'est un enrichissement, pas une génération demandée).
async function assurerContenuPourAudit(onScan) {
  try {
    if (typeof _recentesGenerationsDe !== 'function' || typeof _diagnostiquerContenu !== 'function') return;
    const sommaires = await _recentesGenerationsDe('diagnosticSommaire', 8);
    const miennes = (sommaires || []).filter(g => g && g.contenu && g.contenu.estMonCompte !== false);

    // Récente = moins de 10 jours : au-delà, le compte a pu évoluer, on rescanne.
    const FRAICHEUR_MS = 10 * 24 * 3600 * 1000;
    const recente = miennes.find(g => {
      const t = Date.parse(g.cree_le || g.created_at || '');
      return Number.isFinite(t) && (Date.now() - t) < FRAICHEUR_MS;
    });
    if (recente) return; // le serveur la récupérera telle quelle

    // Pas de sommaire récente : il faut un @pseudo. On réutilise celui de la
    // dernière sommaire de son compte, sinon on le demande une seule fois.
    let pseudo = (miennes[0] && miennes[0].contenu && miennes[0].contenu.username) || '';
    if (!pseudo && typeof prompt === 'function') {
      const saisi = prompt("Pour une analyse plus fine, indique ton @nom d'utilisateur TikTok (on lit tes vidéos publiques pour croiser avec tes statistiques). Laisse vide pour ignorer.");
      pseudo = (saisi || '').trim().replace(/^@+/, '');
    }
    if (!pseudo || !/^[a-zA-Z0-9._]{2,24}$/.test(pseudo)) return; // ignoré proprement

    if (typeof onScan === 'function') onScan();

    // Scan de contenu silencieux (mêmes sources que le diagnostic sommaire).
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 50000);
    let donnees;
    try {
      const rep = await fetch('/api/username-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: pseudo }),
        signal: ctrl.signal
      });
      donnees = await rep.json();
      if (!rep.ok) return; // best-effort : l'audit continue sans ce contexte
    } catch (e) { return; }
    finally { clearTimeout(minuteur); }

    const parsed = await _diagnostiquerContenu(donnees, pseudo);
    if (!parsed || parsed.profil_trouve === false) return;

    // Sauvegardée comme sommaire de SON compte : /api/audit la croisera, et elle
    // resservira à la prochaine analyse détaillée (et au rapport fusionné).
    // Aucun décompte de quota (auto:true la marque comme enrichissement).
    if (typeof saveGeneration === 'function') {
      await saveGeneration('diagnosticSommaire', 'Analyse de contenu · @' + pseudo, {
        username: pseudo, diagnostic: parsed, estMonCompte: true, auto: true
      });
    }
  } catch (e) { /* silencieux : l'audit se déroule sans ce contexte */ }
}

async function lancerAudit() {
  const err = document.getElementById('auditError');
  const out = document.getElementById('auditOutput');
  const btn = document.getElementById('auditBtn');
  const spin = document.getElementById('auditSpinner');
  const btnText = document.getElementById('auditBtnText');

  if (!auditCaptures.length) {
    err.textContent = 'Ajoute au moins une capture de tes statistiques.';
    err.style.display = 'block';
    return;
  }

  // Le style de contenu est requis : sans lui, les recommandations peuvent
  // supposer un format inadapté (ex : "filme-toi" pour un créateur faceless).
  if (!document.getElementById('auditStyle')?.value) {
    err.textContent = 'Choisis ton format de contenu pour un diagnostic adapté.';
    err.style.display = 'block';
    document.getElementById('auditStyle')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Droit d'auditer : 'pro' (analyse incluse), 'jeton' (à décompter),
  // 'illimite' (code VIP), ou false (peutAuditer a déjà proposé l'achat).
  const moyenAudit = await peutAuditer();
  if (!moyenAudit) return;

  err.style.display = 'none';
  out.innerHTML = '';

  if (spin) spin.style.display = 'inline-block';
  if (btnText) btnText.textContent = 'Diagnostic en cours…';
  if (btn) btn.disabled = true;
  startGenAnimation('audit');

  try {
    // Analyse détaillée « musclée » : on s'assure d'abord d'avoir un diagnostic
    // de contenu récent de SON compte, que le serveur croisera avec les
    // statistiques des captures (best-effort, ne bloque jamais l'audit).
    await assurerContenuPourAudit(() => { if (btnText) btnText.textContent = 'Lecture de tes vidéos…'; });
    if (btnText) btnText.textContent = 'Diagnostic en cours…';

    const images = auditCaptures.map(c => ({ base64: c.base64, mediaType: c.mediaType }));
    // Garde-fou : le serveur refuse les envois trop lourds. On vérifie AVANT
    // d'envoyer pour donner un message clair plutôt qu'une erreur technique.
    const poidsMo = images.reduce((t, im) => t + (im.base64 ? im.base64.length : 0), 0) / (1024 * 1024);
    if (poidsMo > 4) {
      throw new Error('Tes captures sont trop lourdes au total (' + poidsMo.toFixed(1) + ' Mo). Retire les captures les moins utiles et relance le diagnostic.');
    }
    const objectif = document.getElementById('auditObjectif')?.value || '';
    const niche = document.getElementById('auditNiche')?.value || '';
    const frequence = document.getElementById('auditFrequence')?.value || '';
    const style = document.getElementById('auditStyle')?.value || '';

    // Un seul essai (avec recherche web si la niche le demande) suivi, en cas
    // d'échec technique, d'un essai de secours SANS recherche : même principe
    // que Script/Récit/Série/Idées (voir js/generation.js, js/storytelling.js,
    // js/serie.js), l'audit est l'appel le plus lourd de l'app (images +
    // modèle Sonnet), donc le plus exposé à une réponse tronquée par le temps
    // limite ; sans ce filet, l'utilisateur devait relancer tout le diagnostic
    // à la main (retélécharger ses captures).
    async function appelAudit(noWebSearch) {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_AUDIT,
          max_tokens: 8000,
          images: images,
          objectif: objectif,
          niche: niche,
          frequence: frequence,
          style: style,
          code_acces: localStorage.getItem('scriptura_code') || null,
          no_web_search: !!noWebSearch
        })
      });

      if (res.status === 403) {
        if (typeof gererAbonnementExpire === 'function') gererAbonnementExpire();
        throw new Error('Ton abonnement a expiré. Renouvelle pour relancer un diagnostic.');
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'erreur serveur');
      }

      const raw = (data.content?.map(b => b.text || '').join('') || '').trim();
      if (!raw) throw new Error('Réponse vide du modèle.');

      // Isole le JSON même si le modèle ajoute du texte autour
      let jsonStr = raw;
      const d = raw.indexOf('{'), f = raw.lastIndexOf('}');
      if (d !== -1 && f !== -1) jsonStr = raw.slice(d, f + 1);

      return JSON.parse(jsonStr);
    }

    let parsed;
    try {
      parsed = await appelAudit(false);
    } catch (e) {
      // L'abonnement expiré n'est pas une erreur technique récupérable par un
      // second essai : on la laisse remonter directement.
      if (/abonnement a expiré/.test(e.message || '')) throw e;
      try {
        parsed = await appelAudit(true);
      } catch (e2) {
        throw new Error('Le modèle a mal formaté sa réponse. Réessaie.');
      }
    }

    // ── Contrôle de couverture ──
    // Les 5 données sont exigées. Un audit partiel présenté comme complet
    // serait trompeur, donc on préfère refuser et dire ce qui manque.
    // Tolérant sur le format (true, "true", 1) car le modèle varie parfois.
    // Si le champ "couverture" est totalement absent, on n'a rien à vérifier :
    // on laisse passer plutôt que de bloquer tout le monde sur un oubli du modèle.
    const REQUIS = [
      ['vue_ensemble_60j', "Vue d'ensemble · 60 jours"],
      ['meilleure_video',  "Analyse complète de ta vidéo la plus performante"],
      ['pire_video',       "Analyse complète de ta vidéo la moins performante"],
      ['top_contenus_60j', "Top contenus · 60 jours"],
      ['audience',         "Ton audience (âge, sexe, emplacements)"]
    ];
    const estVrai = v => v === true || v === 'true' || v === 1 || v === '1';
    const couv = parsed.couverture;
    const couvFournie = couv && typeof couv === 'object';
    const manquantes = couvFournie
      ? REQUIS.filter(([k]) => !estVrai(couv[k])).map(([, label]) => label)
      : [];
    const horsSujet = couvFournie ? (parseInt(couv.captures_hors_sujet) || 0) : 0;

    if (manquantes.length) {
      let m = '<div class="audit-result"><div class="audit-block">';
      m += '<div class="audit-block-title">Diagnostic impossible pour le moment</div>';
      m += '<div class="audit-diag-constat">Il manque ' + manquantes.length +
           ' donnée' + (manquantes.length > 1 ? 's' : '') +
           ' sur 5 pour faire un diagnostic fiable. Plutôt que de te donner une analyse bancale, voici ce qu\'il reste à envoyer :</div>';
      m += '<ul style="margin:14px 0 0;padding-left:18px;line-height:1.7">';
      manquantes.forEach(x => { m += '<li>' + auditEsc(x) + '</li>'; });
      m += '</ul>';
      if (horsSujet > 0) {
        m += '<div class="audit-diag-interp" style="margin-top:14px">' + horsSujet +
             ' capture' + (horsSujet > 1 ? 's' : '') + ' ne correspond' + (horsSujet > 1 ? 'ent' : '') +
             ' pas à un écran de statistiques TikTok.</div>';
      }
      m += '<div class="audit-diag-action" style="margin-top:14px">→ Ajoute les captures manquantes, puis relance le diagnostic. Si un écran est trop long, tu peux le couper en plusieurs captures.</div>';
      m += '</div></div>';
      out.innerHTML = m;
      out.style.display = 'block';
      return;
    }

    const scoreObtenu = parsed.mesures
      ? (calculerScores(parsed.mesures).global ?? null)
      : (parsed.tiktok_score?.global ?? null);

    // Sauvegardé et attendu AVANT renderAudit() : cette fonction déclenche en
    // tâche de fond la génération de "Et maintenant ?" (voir js/recommandations.js,
    // afficherEtMaintenant), qui a besoin de currentGenId déjà positionné sur
    // CET audit pour pouvoir y rattacher sa recommandation une fois prête.
    if (typeof saveGeneration === 'function') {
      try { await saveGeneration('audit', 'Diagnostic TikTok, score ' + (scoreObtenu ?? '?'), Object.assign({}, parsed, { niche: niche, objectif: objectif })); }
      catch(e) { /* silencieux */ }
    }

    renderAudit(parsed, niche, objectif, style);
    // Referme l'UI de capture (visible pendant le mode "affiner") : ce
    // nouveau résultat remplace celui qu'on complétait, plus besoin de la
    // zone d'upload, voir masquerUICaptureAudit et auditRetour.
    masquerUICaptureAudit();

    // Mémoire du créateur : ce que cet audit vient de révéler, comme "leçons
    // apprises" (tâche de fond, silencieuse). Ne modifie ni ne relit les
    // règles d'analyse elles-mêmes, uniquement le résultat déjà produit.
    const P = parsed.piliers || {};
    const leconsAudit = [P.meilleure_video?.formule, P.comparatif?.conclusion].filter(Boolean);
    const aEviterAudit = Array.isArray(parsed.plan_action_30j?.erreurs_a_eviter) ? parsed.plan_action_30j.erreurs_a_eviter : [];
    mettreAJourProfilCreateur({
      declare: { niche_principale: niche, style_contenu: style, objectifs: objectif },
      observe: { themes_a_eviter: aEviterAudit, plateformes: 'TikTok' },
      lecons: { recommandations_permanentes: leconsAudit, dernier_score_audit: scoreObtenu }
    });

    // Le jeton (si utilisé) est désormais décompté côté SERVEUR par
    // /api/audit lui-même (voir api/_lib/acces.js verifierQuota), plus
    // besoin de le refaire ici : ce serait un double décompte.

  } catch (e) {
    err.textContent = 'Diagnostic impossible : ' + (e.message || 'réessaie dans un instant');
    err.style.display = 'block';
  } finally {
    stopGenAnimation();
    if (spin) spin.style.display = 'none';
    if (btnText) btnText.textContent = 'Faire mon diagnostic';
    if (btn) btn.disabled = false;
  }
}

// Dernier audit affiché (pour le bouton "idées correctives")
let lastAudit = null;

const SCORE_DIMS = [
  { key: 'engagement',   label: 'Engagement',       max: 20, icone: '📈' },
  { key: 'retention',    label: 'Rétention',        max: 20, icone: '⏱️' },
  { key: 'storytelling', label: 'Accroche & rythme',     max: 20, icone: '🎬' },
  { key: 'sujets',       label: 'Choix des sujets', max: 20, icone: '🎯' },
  { key: 'regularite',   label: 'Régularité',       max: 20, icone: '📅' }
];

// Conseils génériques par dimension, utilisés UNIQUEMENT en repli quand le
// modèle n'a pas renvoyé d'axes prioritaires : on prend alors les 3 dimensions
// les plus faibles du score et on leur associe une piste concrète.
const AXE_CONSEILS = {
  engagement:   { pourquoi: "Peu de likes, commentaires ou partages au regard des vues.", action: "Termine chaque vidéo par une question ou un appel clair à commenter et partager." },
  retention:    { pourquoi: "Les spectateurs décrochent avant la fin de la vidéo.", action: "Raccourcis, coupe les temps morts et relance l'intérêt toutes les quelques secondes." },
  storytelling: { pourquoi: "L'accroche ou le rythme ne retiennent pas assez tôt.", action: "Soigne les 3 premières secondes et garde un rythme serré, sans intro molle." },
  sujets:       { pourquoi: "Les sujets ne servent pas assez ton objectif ou ton audience.", action: "Réutilise le mécanisme qui a déjà fait réagir ton audience, sur des sujets variés." },
  regularite:   { pourquoi: "Le rythme de publication est irrégulier.", action: "Fixe une cadence tenable (ex. 3 à 4 vidéos par semaine) et tiens-la." }
};

// ═══════════════════════════════════════════════════════════
//  MOTEUR DE SCORING
//  Le modèle n'attribue aucune note : il extrait des mesures brutes et
//  répond OUI / PARTIEL / NON à des critères fermés. Tout le calcul est
//  fait ici, donc deux analyses des mêmes captures donnent le même score.
//  Les seuils sont des repères de marché, ajustables en un seul endroit.
// ═══════════════════════════════════════════════════════════

// Formate un nombre au format Scriptura : point pour les milliers,
// virgule pour les décimales (ex : 102.450,74). Pas de décimales si entier.
function formaterNombre(n) {
  if (n == null || n === '' || isNaN(n)) return '';
  n = Number(n);
  const neg = n < 0;
  n = Math.abs(n);
  const [entier, decimales] = n.toFixed(2).split('.');
  const avecMilliers = entier.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (decimales === '00') ? '' : ',' + decimales;
  return (neg ? '-' : '') + avecMilliers + dec;
}

function sNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = (typeof v === 'number')
    ? v
    : parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Interpolation linéaire entre paliers, où PLUS HAUT est MEILLEUR.
// Les paliers sont des repères, pas des marches : 2,99 % et 3,00 % donnent
// des notes quasi identiques au lieu de basculer d'un cran.
// Format : [[seuil, points], ...] du plus exigeant au moins exigeant,
// le dernier seuil devant être 0.
function sPalierHaut(v, paliers) {
  if (v === null) return null;
  if (v >= paliers[0][0]) return paliers[0][1];
  for (let i = 0; i < paliers.length - 1; i++) {
    const [sHaut, pHaut] = paliers[i];
    const [sBas, pBas]   = paliers[i + 1];
    if (v >= sBas) {
      if (sHaut === sBas) return pBas;
      return pBas + ((v - sBas) / (sHaut - sBas)) * (pHaut - pBas);
    }
  }
  return paliers[paliers.length - 1][1];
}

// Même principe, mais PLUS BAS est MEILLEUR.
// Format : [[seuil, points], ...] du plus exigeant au moins exigeant.
function sPalierBas(v, paliers) {
  if (v === null) return null;
  if (v <= paliers[0][0]) return paliers[0][1];
  for (let i = 0; i < paliers.length - 1; i++) {
    const [sBas, pHaut]  = paliers[i];
    const [sHaut, pBas]  = paliers[i + 1];
    if (v <= sHaut) {
      if (sHaut === sBas) return pBas;
      return pHaut + ((v - sBas) / (sHaut - sBas)) * (pBas - pHaut);
    }
  }
  return paliers[paliers.length - 1][1];
}

// Note en bande : plein score dans la zone optimale, dégradation douce en
// dehors. Sert à la régularité, où publier PLUS n'est pas publier MIEUX.
function sBande(v, min, max, ptsMax) {
  if (v === null) return null;
  if (v >= min && v <= max) return ptsMax;
  const ecart = v < min ? (min - v) / Math.max(min, 0.001) : (v - max) / Math.max(max, 0.001);
  return Math.max(ptsMax * 0.15, ptsMax * (1 - Math.min(1, ecart) * 0.75));
}

// Critère fermé : OUI = plein, PARTIEL = moitié, NON = 0, sinon non mesurable
function sCritere(rep, max) {
  if (rep === null || rep === undefined) return null;
  const k = String(rep).trim().toUpperCase();
  if (k === 'OUI') return max;
  if (k === 'PARTIEL') return max / 2;
  if (k === 'NON') return 0;
  return null;
}

// Agrège les sous-critères mesurables et ramène sur le total de la dimension.
// Un critère non mesurable est ignoré au lieu de compter zéro, sinon une
// donnée manquante ferait chuter la note comme si elle était mauvaise.
function sAgrege(parts, maxDim) {
  const ok = parts.filter(p => p.obtenu !== null);
  if (!ok.length) return null;
  const maxDispo = ok.reduce((s, p) => s + p.max, 0);
  const obtenu   = ok.reduce((s, p) => s + p.obtenu, 0);
  return Math.round((obtenu / maxDispo) * maxDim);
}

function scoreEngagement(m) {
  const e = (m && m.engagement) || {};
  const vues = sNum(e.vues);
  if (!vues || vues <= 0) return null;
  const likes = sNum(e.likes), coms = sNum(e.commentaires), parts = sNum(e.partages);
  const ratio = x => x === null ? null : (x / vues) * 100;

  // Taux d'engagement par vues = (likes + commentaires + partages) / vues.
  // C'est la mesure de référence du secteur. Moyenne TikTok 2026 : 3,85 %,
  // zone correcte pour un petit compte : 3 à 5 %.
  const dispo = [likes, coms, parts].filter(x => x !== null);
  const tauxGlobal = dispo.length ? (dispo.reduce((a, b) => a + b, 0) / vues) * 100 : null;

  return sAgrege([
    { obtenu: sPalierHaut(tauxGlobal,   [[8,12],[6,10.5],[5,9],[3.85,7.5],[2.5,5.5],[1.5,3.5],[0,1]]), max: 12 },
    { obtenu: sPalierHaut(ratio(coms),  [[1,4],[0.5,3.4],[0.25,2.8],[0.1,2],[0.03,1.2],[0,0.4]]),      max: 4 },
    { obtenu: sPalierHaut(ratio(parts), [[2,4],[1,3.4],[0.5,2.8],[0.25,2.2],[0.1,1.4],[0,0.4]]),       max: 4 }
  ], 20);
}

function scoreRetention(m) {
  const src = [(m && m.retention_meilleure) || {}, (m && m.retention_pire) || {}];
  const moyenne = cle => {
    const v = src.map(o => sNum(o[cle])).filter(x => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  // Repère du secteur : les vidéos qui dépassent 40 à 60 % de complétion
  // gardent une exposition durable dans le fil "Pour toi".
  return sAgrege([
    { obtenu: sPalierHaut(moyenne('taux_moyen_pct'), [[60,12],[45,10.5],[35,8.5],[25,6],[15,3.5],[0,1]]), max: 12 },
    { obtenu: sPalierHaut(moyenne('completion_pct'), [[30,8],[20,6.5],[10,5],[5,3.5],[2,2],[0,0.5]]),     max: 8 }
  ], 20);
}

function scoreStorytelling(m) {
  const s = (m && m.storytelling) || {};
  // Le point de décrochage a été retiré du score après vérification sur des
  // données réelles : une vidéo virale décrochait à 0:01 et un échec à 0:02.
  // Sur TikTok, la masse quitte dans la première seconde même sur un bon
  // contenu, donc cette seconde ne distingue rien. Ce qui sépare vraiment les
  // deux, c'est le taux moyen et la complétion, déjà notés en Rétention.
  return sAgrege([
    { obtenu: sCritere(s.hook_present,       5), max: 5 },
    { obtenu: sCritere(s.faible_chute_debut, 5), max: 5 },
    { obtenu: sCritere(s.retention_stable,   5), max: 5 },
    { obtenu: sCritere(s.bonne_fin,          5), max: 5 }
  ], 20);
}

function scoreSujets(m) {
  const s = (m && m.sujets) || {};
  return sAgrege([
    { obtenu: sCritere(s.themes_repetes,          5), max: 5 },
    { obtenu: sCritere(s.coherence_editoriale,    5), max: 5 },
    { obtenu: sCritere(s.adequation_objectif,     5), max: 5 },
    { obtenu: sCritere(s.performances_homogenes,  5), max: 5 }
  ], 20);
}

function scoreRegularite(m) {
  const r = (m && m.regularite) || {};
  const nb    = sNum(r.nb_videos_periode);
  const jours = sNum(r.periode_jours);
  const trou  = sNum(r.plus_long_trou_jours);
  // Ramené à une cadence hebdomadaire pour rester comparable d'une période à l'autre
  const parSemaine = (nb !== null && jours !== null && jours > 0) ? (nb / jours) * 7 : null;
  // Ne PAS récompenser la surpublication : les comptes qui publient moins de
  // six fois par semaine obtiennent nettement plus d'engagement que ceux qui
  // saturent. La zone optimale est donc une bande, pas une échelle croissante.
  return sAgrege([
    { obtenu: sBande(parSemaine, 3, 6, 10),                          max: 10 },
    { obtenu: sPalierBas(trou, [[2,10],[4,8.5],[7,7],[14,4.5],[30,2],[90,0]]), max: 10 }
  ], 20);
}

function calculerScores(mesures) {
  const s = {
    engagement:   scoreEngagement(mesures),
    retention:    scoreRetention(mesures),
    storytelling: scoreStorytelling(mesures),
    sujets:       scoreSujets(mesures),
    regularite:   scoreRegularite(mesures)
  };
  const mesurees = SCORE_DIMS.filter(d => s[d.key] !== null);
  const maxDispo = mesurees.reduce((a, d) => a + d.max, 0);
  const obtenu   = mesurees.reduce((a, d) => a + s[d.key], 0);
  s.global = maxDispo > 0 ? Math.round((obtenu / maxDispo) * 100) : null;
  // Le levier est la dimension mesurée la plus faible en proportion de son total
  let levier = null, plusBas = 2;
  mesurees.forEach(d => {
    const part = s[d.key] / d.max;
    if (part < plusBas) { plusBas = part; levier = d.label; }
  });
  s.levier_dim = levier;
  return s;
}

function auditNum(v) {
  return Number.isFinite(v) ? v : (parseInt(v) || 0);
}

// Version texte de l'audit, pour les boutons Copier et Partager.
// Reprend le même contenu que l'affichage, sans le HTML.
// ══════════════════════════════════════
//  EXPORT PDF DE L'AUDIT
//  Met en page le diagnostic aux couleurs de Scriptura, avec gestion
//  automatique des sauts de page pour ne jamais couper une phrase.
// ══════════════════════════════════════
function telechargerAuditPDF() {
  const lib = window.jspdf || window.jsPDF;
  if (!lib) {
    alert("Le module PDF n'a pas pu être chargé. Vérifie ta connexion et réessaie.");
    return;
  }
  const { jsPDF } = lib;
  const a = lastAudit;
  if (!a) return;
  const ts = a.mesures ? calculerScores(a.mesures) : (a.tiktok_score || {});

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const LARGEUR = 210, HAUTEUR = 297;
  const MARGE = 18;
  const UTILE = LARGEUR - MARGE * 2;
  let y = 0;

  const OR = [201, 168, 76];
  const OR_CLAIR = [226, 200, 122];
  const FOND = [28, 28, 30];
  const BLANC = [255, 255, 255];
  const GRIS = [175, 175, 178];

  // Peint le fond sombre sur la page courante
  function fondPage() {
    doc.setFillColor(FOND[0], FOND[1], FOND[2]);
    doc.rect(0, 0, LARGEUR, HAUTEUR, 'F');
  }
  // Ajoute une page si la place manque
  function place(h) {
    if (y + h > HAUTEUR - MARGE) {
      doc.addPage();
      fondPage();
      y = MARGE;
    }
  }
  function titreSection(txt) {
    place(14);
    y += 4;
    doc.setTextColor(OR[0], OR[1], OR[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(String(txt).toUpperCase(), MARGE, y);
    y += 2;
    doc.setDrawColor(OR[0], OR[1], OR[2]);
    doc.setLineWidth(0.3);
    doc.line(MARGE, y, MARGE + UTILE, y);
    y += 6;
  }
  function paragraphe(txt, couleur, taille, gras) {
    if (!txt) return;
    doc.setFont('helvetica', gras ? 'bold' : 'normal');
    doc.setFontSize(taille || 10);
    const c = couleur || BLANC;
    doc.setTextColor(c[0], c[1], c[2]);
    const lignes = doc.splitTextToSize(String(txt), UTILE);
    lignes.forEach(l => {
      place(6);
      doc.text(l, MARGE, y);
      y += 5;
    });
    y += 1.5;
  }

  // ── Page 1 : en-tête ──
  fondPage();
  y = MARGE + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLANC[0], BLANC[1], BLANC[2]);
  doc.text('SCRIPT', MARGE, y);
  const largeurScript = doc.getTextWidth('SCRIPT');
  doc.setTextColor(OR[0], OR[1], OR[2]);
  doc.text('URA', MARGE + largeurScript, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
  doc.text('Diagnostic TikTok', MARGE, y);
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.text(dateStr, MARGE + UTILE, y, { align: 'right' });
  y += 8;

  // ── Le score ──
  if (ts && ts.global != null) {
    place(30);
    doc.setFillColor(38, 38, 41);
    doc.roundedRect(MARGE, y, UTILE, 24, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(OR_CLAIR[0], OR_CLAIR[1], OR_CLAIR[2]);
    doc.text(String(ts.global) + '/100', MARGE + 8, y + 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
    doc.text('ADN TikTok Score', MARGE + 8, y + 21);
    y += 30;
  }

  // ── Les dimensions ──
  if (typeof SCORE_DIMS !== 'undefined' && Array.isArray(SCORE_DIMS)) {
    titreSection('Détail par dimension');
    SCORE_DIMS.forEach(d => {
      const v = (ts && ts[d.key] != null) ? (ts[d.key] + ' / ' + d.max) : 'non mesuré';
      place(7);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(BLANC[0], BLANC[1], BLANC[2]);
      doc.text(String(d.label), MARGE, y);
      doc.setTextColor(OR_CLAIR[0], OR_CLAIR[1], OR_CLAIR[2]);
      doc.text(String(v), MARGE + UTILE, y, { align: 'right' });
      y += 6.5;
    });
    if (ts && ts.levier_dim) {
      y += 2;
      paragraphe('Levier principal : ' + ts.levier_dim, OR_CLAIR, 10, true);
    }
  }

  // ── Les piliers ──
  const P = a.piliers || {};
  const ajouteBloc = (titre, lignes) => {
    const utiles = (lignes || []).filter(Boolean);
    if (!utiles.length) return;
    titreSection(titre);
    utiles.forEach(x => paragraphe(x, BLANC, 10));
  };

  ajouteBloc('Performance globale', [
    P.performance_globale && P.performance_globale.constat,
    P.performance_globale && P.performance_globale.blocage,
    (P.performance_globale && P.performance_globale.action) ? 'À faire : ' + P.performance_globale.action : null
  ]);
  ajouteBloc('Meilleure vidéo', [
    P.meilleure_video && P.meilleure_video.constat,
    P.meilleure_video && P.meilleure_video.formule
  ]);
  ajouteBloc('Vidéo la plus faible', [P.pire_video && P.pire_video.constat]);
  ajouteBloc('Comparatif', [P.comparatif && P.comparatif.conclusion, P.comparatif && P.comparatif.conversion, P.comparatif && P.comparatif.representativite]);

  const ed = P.editorial;
  if (ed && ((ed.sujets_notes && ed.sujets_notes.length) || ed.recommandation)) {
    titreSection('Analyse éditoriale');
    (ed.sujets_notes || []).forEach(s => paragraphe((s.sujet || '') + ' : ' + (s.note || ''), BLANC, 10));
    if (ed.recommandation) paragraphe('À faire : ' + ed.recommandation, OR_CLAIR, 10);
  }

  ajouteBloc('Audience', [
    P.audience && P.audience.constat,
    P.audience && P.audience.alignement
  ]);

  // ── Plan d'action ──
  const pa = a.plan_action_30j;
  if (pa) {
    titreSection("Plan d'action 30 jours");
    if (pa.frequence) paragraphe('Fréquence : ' + pa.frequence, BLANC, 10);
    if (pa.duree_ideale) paragraphe('Durée idéale : ' + pa.duree_ideale, BLANC, 10);
    (pa.sujets_a_faire || []).forEach(s => paragraphe('• ' + s, BLANC, 10));
    if ((pa.erreurs_a_eviter || []).length) {
      y += 2;
      paragraphe('À éviter :', OR_CLAIR, 10, true);
      (pa.erreurs_a_eviter || []).forEach(s => paragraphe('• ' + s, GRIS, 10));
    }
  }

  // ── Pied de page sur chaque page ──
  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 124);
    doc.text('Scriptura, Diagnostic TikTok', MARGE, HAUTEUR - 10);
    doc.text(p + ' / ' + total, MARGE + UTILE, HAUTEUR - 10, { align: 'right' });
  }

  const nom = 'Diagnostic-TikTok-Scriptura-' + new Date().toISOString().slice(0, 10) + '.pdf';
  doc.save(nom);
}

function auditTexteBrut(a, ts) {
  const L = [];
  L.push('DIAGNOSTIC TIKTOK · SCRIPTURA');
  L.push('');
  if (ts && ts.global != null) L.push('ADN TikTok Score : ' + ts.global + '/100');
  SCORE_DIMS.forEach(d => {
    const v = (ts && ts[d.key] != null) ? (ts[d.key] + '/' + d.max) : 'non mesuré';
    L.push('  ' + d.label + ' : ' + v);
  });
  if (ts && ts.levier_dim) L.push('Levier principal : ' + ts.levier_dim);

  const P = a.piliers || {};
  const bloc = (titre, lignes) => {
    const utiles = lignes.filter(Boolean);
    if (!utiles.length) return;
    L.push('', titre.toUpperCase());
    utiles.forEach(x => L.push(x));
  };

  bloc('Performance globale', [
    P.performance_globale && P.performance_globale.constat,
    P.performance_globale && P.performance_globale.blocage,
    (P.performance_globale && P.performance_globale.action) ? '→ ' + P.performance_globale.action : null
  ]);
  bloc('Meilleure vidéo', [
    P.meilleure_video && P.meilleure_video.constat,
    P.meilleure_video && P.meilleure_video.formule
  ]);
  bloc('Vidéo la plus faible', [P.pire_video && P.pire_video.constat]);
  bloc('Comparatif', [P.comparatif && P.comparatif.conclusion, P.comparatif && P.comparatif.conversion, P.comparatif && P.comparatif.representativite]);

  const ed = P.editorial;
  if (ed && ((ed.sujets_notes && ed.sujets_notes.length) || ed.recommandation)) {
    L.push('', 'ANALYSE ÉDITORIALE');
    (ed.sujets_notes || []).forEach(s => L.push('  ' + (s.sujet || '') + ' : ' + (s.note || '')));
    if (ed.recommandation) L.push('→ ' + ed.recommandation);
  }

  bloc('Audience', [
    P.audience && P.audience.constat,
    P.audience && P.audience.alignement
  ]);

  const pa = a.plan_action_30j;
  if (pa && typeof pa === 'object') {
    const lignes = [];
    if (pa.frequence) lignes.push('Fréquence : ' + pa.frequence);
    if (pa.duree_ideale) lignes.push('Durée idéale : ' + pa.duree_ideale);
    if (Array.isArray(pa.sujets_a_faire) && pa.sujets_a_faire.length)
      lignes.push('Sujets à faire : ' + pa.sujets_a_faire.join(', '));
    if (Array.isArray(pa.erreurs_a_eviter) && pa.erreurs_a_eviter.length)
      lignes.push('À éviter : ' + pa.erreurs_a_eviter.join(', '));
    bloc('Plan des 30 prochains jours', lignes);
  }

  return L.join('\n');
}

// Palette du score ADN TikTok selon son niveau, un repère de couleur
// immédiat (rouge/orange/émeraude), partagé entre le diagnostic complet
// (renderAudit) et le diagnostic sommaire (js/diagnostic-sommaire.js) qui
// utilisent tous les deux ce même anneau de score.
// Une seule couleur par palier (pas un dégradé de deux teintes) : le chiffre
// et l'anneau doivent être EXACTEMENT la même couleur, pas juste la même
// famille, rouge, orange ou vert, sans ambiguïté, comme chez Vervox.
function paletteScoreAudit(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return { texte: 'var(--gold-light)', ringA: 'var(--gold-light)', ringB: 'var(--gold-light)' };
  }
  if (score < 50) return { texte: '#EF4444', ringA: '#EF4444', ringB: '#EF4444' };
  if (score < 70) return { texte: '#F59E0B', ringA: '#F59E0B', ringB: '#F59E0B' };
  return { texte: 'var(--emerald-light)', ringA: 'var(--emerald-light)', ringB: 'var(--emerald-light)' };
}

// Classe de couleur d'un badge de score sur un barème quelconque (ex: 8/20,
// 24/30) : mêmes seuils proportionnels que paletteScoreAudit, rouge en
// dessous de 50 % du maximum, orange entre 50 % et 70 %, émeraude à partir
// de 70 %. Partagé avec js/diagnostic-sommaire.js (mêmes cartes de dimension).
function niveauScoreSur(valeur, max) {
  if (typeof valeur !== 'number' || Number.isNaN(valeur) || !max) return 'niveau-neutre';
  const pct = (valeur / max) * 100;
  if (pct < 50) return 'niveau-rouge';
  if (pct < 70) return 'niveau-orange';
  return 'niveau-vert';
}

// "Santé du compte" à partir du score global, n'existait auparavant que
// dans le diagnostic sommaire ; ajoutée ici pour que les deux diagnostics
// (complet et sommaire) affichent ce repère de façon cohérente.
function santeCompteDepuisScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 70) return { label: 'Excellente', niveau: 'niveau-vert' };
  if (score >= 50) return { label: 'Bonne', niveau: 'niveau-orange' };
  if (score >= 30) return { label: 'Fragile', niveau: 'niveau-rouge' };
  return { label: 'Critique', niveau: 'niveau-rouge' };
}

// Niveau de couleur à partir du libellé de santé rapporté par l'IA
// (diagnostic sommaire : "Excellente"/"Bonne"/"Fragile"/"Critique").
function niveauDepuisLabelSante(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('excellent')) return 'niveau-vert';
  if (l.includes('bonne')) return 'niveau-orange';
  if (l.includes('fragile') || l.includes('critique')) return 'niveau-rouge';
  return 'niveau-neutre';
}

function renderAudit(a, nicheCtx, objectifCtx, styleCtx) {
  lastAudit = a;
  const out = document.getElementById('auditOutput');
  if (!out) return;
  if (!a || typeof a !== 'object') {
    out.innerHTML = '<div class="err" style="display:block">Réponse illisible.</div>';
    return;
  }

  // Contexte du compte analysé, pour les opportunités personnalisées en fin de rapport.
  // Priorité aux valeurs passées par l'appelant (audit qui vient d'être lancé), puis à
  // celles enregistrées avec l'audit (audit rouvert depuis l'historique), puis au formulaire.
  const oppNiche = nicheCtx || a.niche || document.getElementById('auditNiche')?.value || '';
  const oppObjectif = objectifCtx || a.objectif || document.getElementById('auditObjectif')?.value || '';
  const oppStyle = styleCtx || document.getElementById('auditStyle')?.value || '';

  let html = '<div class="audit-result">';

  // ── TikTok Score ──
  // Si le modèle a fourni des mesures brutes, le score est calculé ici par
  // le moteur (reproductible). Sinon c'est un audit enregistré avant le
  // moteur : on relit l'ancien champ tiktok_score tel quel.
  const ts = a.mesures ? calculerScores(a.mesures) : (a.tiktok_score || {});

  // Une dimension n'est notée que si le modèle a renvoyé un vrai nombre.
  // Sinon elle est "non mesurée", surtout pas 0/20, qui ferait croire
  // à une mauvaise note alors que c'est la donnée qui manque.
  const dimValeur = v => {
    const n = (typeof v === 'number') ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  // Le score global est recalculé ici à partir des seules dimensions
  // réellement mesurées, puis ramené sur 100. Sans ça, un compte à qui
  // il manque une capture plafonnerait mécaniquement (ex. 80/100 maximum).
  // On ne se fie pas à l'arithmétique du modèle.
  const dimsMesurees = SCORE_DIMS.filter(d => dimValeur(ts[d.key]) !== null);
  const maxMesure = dimsMesurees.reduce((s, d) => s + d.max, 0);
  const obtenu = dimsMesurees.reduce((s, d) => s + dimValeur(ts[d.key]), 0);
  const global = maxMesure > 0 ? Math.round((obtenu / maxMesure) * 100) : auditNum(ts.global);
  const partiel = dimsMesurees.length > 0 && dimsMesurees.length < SCORE_DIMS.length;

  // Circonférence de l'anneau (rayon 74) pour le calcul du remplissage
  const RING_R = 74, RING_C = 2 * Math.PI * RING_R;
  const scoreAffiche = (global == null || Number.isNaN(global)) ? '·' : global;
  // Couleur selon le niveau du score : rouge en dessous de 50, orange entre
  // 50 et 70, émeraude à partir de 70, un repère visuel immédiat plutôt
  // qu'une seule nuance de doré quel que soit le résultat.
  const paletteScore = paletteScoreAudit(global);
  const ringColorA = paletteScore.ringA;
  const ringColorB = paletteScore.ringB;

  html += `
    <div class="audit-score-card">
      <div class="audit-score-label">ADN TIKTOK SCORE</div>
      <div class="audit-ring-wrap">
        <svg class="audit-ring" viewBox="0 0 170 170">
          <defs>
            <linearGradient id="auditRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${ringColorA}"/>
              <stop offset="100%" stop-color="${ringColorB}"/>
            </linearGradient>
          </defs>
          <circle class="audit-ring-track" cx="85" cy="85" r="${RING_R}"/>
          <circle class="audit-ring-fill" id="auditRingFill" cx="85" cy="85" r="${RING_R}"
            stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}"/>
        </svg>
        <div class="audit-ring-center">
          <div class="audit-score-num" style="color:${paletteScore.texte}"><span id="auditScoreNum">0</span><span class="audit-score-suffix">/100</span></div>
        </div>
      </div>
      ${partiel ? `<div class="audit-score-phrase">Calculé sur ${dimsMesurees.length} dimension${dimsMesurees.length > 1 ? 's' : ''} sur ${SCORE_DIMS.length}, les autres n'ont pas pu être mesurées avec les captures fournies.</div>` : ''}
      ${ts.levier ? `<div class="audit-score-phrase">${auditEsc(ts.levier)}</div>`
        : (ts.levier_dim ? `<div class="audit-score-phrase">Ton levier le plus fort aujourd'hui : ${auditEsc(ts.levier_dim)}.</div>` : '')}
    </div>`;

  // ── Tes 3 axes prioritaires (digest actionnable, juste sous le score) ──
  // On prend d'abord ce que le modèle a renvoyé ; à défaut, on retombe sur les
  // dimensions les plus faibles du score, pour que le bloc s'affiche toujours.
  let axesPrio = Array.isArray(a.axes_prioritaires)
    ? a.axes_prioritaires.filter(x => x && (x.titre || x.action || x.pourquoi))
    : [];
  if (!axesPrio.length && dimsMesurees.length) {
    axesPrio = dimsMesurees
      .map(d => ({ d, part: dimValeur(ts[d.key]) / d.max }))
      .sort((x, y) => x.part - y.part)
      .slice(0, 3)
      .map(({ d }) => ({ titre: d.label, pourquoi: (AXE_CONSEILS[d.key] || {}).pourquoi || '', action: (AXE_CONSEILS[d.key] || {}).action || '' }));
  }
  if (axesPrio.length) {
    const n = Math.min(3, axesPrio.length);
    html += `<div class="audit-prio"><div class="audit-prio-titre">Tes ${n} axe${n > 1 ? 's' : ''} prioritaire${n > 1 ? 's' : ''}</div>`;
    axesPrio.slice(0, 3).forEach((ax, i) => {
      html += `<div class="audit-prio-item">
        <div class="audit-prio-num">${i + 1}</div>
        <div class="audit-prio-body">
          <div class="audit-prio-t">${auditEsc(ax.titre || ('Axe ' + (i + 1)))}</div>
          ${ax.pourquoi ? `<div class="audit-prio-why">${auditEsc(ax.pourquoi)}</div>` : ''}
          ${ax.action ? `<div class="audit-prio-action">→ ${auditEsc(ax.action)}</div>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
  }

  // Dimensions du score, petites cartes avec badge coloré selon le niveau
  // (rouge/orange/émeraude), même langage visuel que le score global et que
  // les cartes du diagnostic sommaire (.ds-dim-card, réutilisées ici).
  const hasDims = dimsMesurees.length > 0;
  if (hasDims) {
    html += '<div class="ds-dims-grid">';
    SCORE_DIMS.forEach(d => {
      const v = dimValeur(ts[d.key]);
      if (v === null) {
        html += `
        <div class="ds-dim-card" style="opacity:.5">
          <div class="ds-dim-head">
            <span class="ds-dim-icon">${d.icone}</span>
            <span class="ds-dim-name">${d.label}</span>
            <span class="score-badge niveau-neutre">·</span>
          </div>
        </div>`;
        return;
      }
      html += `
        <div class="ds-dim-card">
          <div class="ds-dim-head">
            <span class="ds-dim-icon">${d.icone}</span>
            <span class="ds-dim-name">${d.label}</span>
            <span class="score-badge ${niveauScoreSur(v, d.max)}">${v}/${d.max}</span>
          </div>
        </div>`;
    });
    html += '</div>';
  }

  const sante = santeCompteDepuisScore(global);
  if (sante) {
    html += `<div class="ds-sante-row"><span class="ds-tag ${sante.niveau}">Santé du compte : ${sante.label}</span></div>`;
  }

  // Synthèse croisée CONTENU (analyse par @pseudo, ~6 mois de vraies vidéos)
  // × DISTRIBUTION (captures : rétention, trafic, démographie). Présente
  // seulement si un diagnostic sommaire de son compte a nourri l'audit.
  const syn = a.synthese_croisee || {};
  if (syn.disponible !== false && syn.constat) {
    html += `<div class="score-card ds-evolution pivot">
      <div class="ds-section-row"><div class="audit-section-label" style="margin-bottom:0">Contenu × Distribution</div><span class="ds-tag ds-tag-alert">Synthèse croisée</span></div>
      <p class="audit-diag-constat" style="margin-top:10px">${auditEsc(syn.constat)}</p>
      ${Array.isArray(syn.points) && syn.points.length ? `<ul class="ds-niche-analyse">${syn.points.map(p => `<li>${auditEsc(p)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  const P = a.piliers || {};
  const dispo = p => p && p.disponible !== false && (p.constat || p.conclusion || p.formule || (p.sujets_notes && p.sujets_notes.length));

  // Intertitre : ouvre la partie diagnostic, pour séparer visuellement le
  // score (le verdict) de son explication détaillée.
  const yaDiagnostic = dispo(P.performance_globale) || dispo(P.meilleure_video)
    || dispo(P.pire_video) || dispo(P.comparatif) || dispo(P.editorial)
    || (P.niche && P.niche.disponible !== false && P.niche.nom) || dispo(P.audience);
  if (yaDiagnostic) html += '<div class="audit-section-label">Le diagnostic</div>';

  // ── Pilier : performance globale ──
  if (dispo(P.performance_globale)) {
    const p = P.performance_globale;
    html += auditBlock('📊 Performance globale', `
      ${p.constat ? `<div class="audit-diag-constat">${auditEsc(p.constat)}</div>` : ''}
      ${p.blocage ? `<div class="audit-diag-interp">🚧 ${auditEsc(p.blocage)}</div>` : ''}
      ${p.action ? `<div class="audit-diag-action">→ ${auditEsc(p.action)}</div>` : ''}
    `);
  }

  // ── Comparatif meilleure / pire ──
  const mv = P.meilleure_video, pv = P.pire_video, comp = P.comparatif;
  // Abonnés gagnés par chaque vidéo (donnée extraite des captures détail, fiable,
  // pas une estimation du modèle). Affiché tel quel si visible.
  const M = a.mesures || {};
  const foll = v => (v != null && v !== '' && !isNaN(v)) ? Number(v) : null;
  const folBest = foll(M.retention_meilleure && M.retention_meilleure.nouveaux_followers);
  const folWorst = foll(M.retention_pire && M.retention_pire.nouveaux_followers);
  const badgeFoll = n => `<div class="audit-vs-fol">🧲 ${formaterNombre(n)} abonné${n > 1 ? 's' : ''} gagné${n > 1 ? 's' : ''} par cette vidéo</div>`;
  if (dispo(mv) || dispo(pv) || dispo(comp)) {
    let inner = '';
    if (dispo(mv)) {
      inner += `<div class="audit-vs-col audit-vs-best">
        <div class="audit-vs-tag">✅ Meilleure vidéo</div>
        ${mv.constat ? `<div class="audit-vs-text">${auditEsc(mv.constat)}</div>` : ''}
        ${mv.formule ? `<div class="audit-vs-formule">💡 ${auditEsc(mv.formule)}</div>` : ''}
        ${folBest != null ? badgeFoll(folBest) : ''}
      </div>`;
    }
    if (dispo(pv)) {
      const sec = pv.seconde_decrochage;
      inner += `<div class="audit-vs-col audit-vs-worst">
        <div class="audit-vs-tag">⚠️ Vidéo faible${sec != null ? ', décroche à ' + auditEsc(sec) + 's' : ''}</div>
        ${pv.constat ? `<div class="audit-vs-text">${auditEsc(pv.constat)}</div>` : ''}
        ${folWorst != null ? badgeFoll(folWorst) : ''}
      </div>`;
    }
    html += auditBlock('⚡ Comparatif', `<div class="audit-vs">${inner}</div>
      ${dispo(comp) && comp.conclusion ? `<div class="audit-vs-concl">${auditEsc(comp.conclusion)}</div>` : ''}
      ${dispo(comp) && comp.conversion ? `<div class="audit-vs-repres">🧲 ${auditEsc(comp.conversion)}</div>` : ''}
      ${dispo(comp) && comp.representativite ? `<div class="audit-vs-repres">📊 ${auditEsc(comp.representativite)}</div>` : ''}`);
  }

  // ── Éditorial ──
  if (dispo(P.editorial)) {
    const e = P.editorial;
    let inner = '';
    if (Array.isArray(e.sujets_notes) && e.sujets_notes.length) {
      inner += '<div class="audit-sujets">';
      e.sujets_notes.forEach(s => {
        inner += `<div class="audit-sujet"><span>${auditEsc(s.sujet)}</span><b>${auditEsc(s.note)}</b></div>`;
      });
      inner += '</div>';
    }
    if (e.recommandation) inner += `<div class="audit-diag-action">→ ${auditEsc(e.recommandation)}</div>`;
    html += auditBlock('📝 Analyse éditoriale', inner);
  }

  // ── Niche (clarté du positionnement) ──
  if (dispo(P.niche) || (P.niche && P.niche.nom)) {
    const n = P.niche;
    const nicheOk = n.etat === 'claire';
    html += `<div class="audit-block">
      <div class="audit-block-title" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span>🎯 Ta niche</span>
        <span class="ds-tag${nicheOk ? ' ds-tag-ok' : ''}">${nicheOk ? 'Niche claire' : 'Niche encore floue'}</span>
      </div>
      ${n.nom ? `<div class="audit-diag-constat">${auditEsc(n.nom)}</div>` : ''}
      ${Array.isArray(n.analyse) && n.analyse.length ? `<ul class="ds-niche-analyse">${n.analyse.map(p => `<li>${auditEsc(p)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  // ── Analyse détaillée (tirée uniquement du top contenus) ──
  const ad = P.analyse_detaillee;
  if (ad && ad.disponible !== false && (ad.videos_au_dessus_moyenne != null || (Array.isArray(ad.concepts_recurrents) && ad.concepts_recurrents.length))) {
    const concepts = Array.isArray(ad.concepts_recurrents) ? ad.concepts_recurrents : [];
    html += `<div class="audit-block">
      <div class="audit-block-title">📊 Analyse détaillée</div>
      <div class="ds-mini-stats" style="grid-template-columns:1fr 1fr">
        <div class="ds-mini-stat"><b>${auditEsc(ad.videos_au_dessus_moyenne ?? '·')}${ad.total_videos_analysees ? ' / ' + auditEsc(ad.total_videos_analysees) : ''}</b><span>Au-dessus de la moyenne</span></div>
        <div class="ds-mini-stat"><b>${concepts.length || '·'}</b><span>Concepts récurrents</span></div>
      </div>
      ${concepts.length ? `<ul class="ds-niche-analyse" style="margin-top:14px">${concepts.map(c => `<li>${auditEsc(c.theme)} <span style="color:var(--muted)">(${auditEsc(c.occurrences)} vidéos)</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  // ── Audience ──
  if (dispo(P.audience)) {
    const au = P.audience;
    html += auditBlock('👥 Audience', `
      ${au.constat ? `<div class="audit-diag-constat">${auditEsc(au.constat)}</div>` : ''}
      ${au.alignement ? `<div class="audit-diag-interp">${auditEsc(au.alignement)}</div>` : ''}
    `);
  }

  // ── Plan d'action 30 jours ──
  const pa = a.plan_action_30j;
  if (pa && typeof pa === 'object') {
    html += '<div class="audit-section-label">Passe à l\'action</div>';
    let items = '';
    if (pa.frequence) items += `<li><b>Fréquence :</b> ${auditEsc(pa.frequence)}</li>`;
    if (pa.duree_ideale) items += `<li><b>Durée idéale :</b> ${auditEsc(pa.duree_ideale)}</li>`;
    if (pa.type_hook) items += `<li><b>Hook :</b> ${auditEsc(pa.type_hook)}</li>`;
    if (Array.isArray(pa.sujets_a_faire) && pa.sujets_a_faire.length)
      items += `<li><b>Sujets à faire :</b> ${pa.sujets_a_faire.map(auditEsc).join(', ')}</li>`;
    if (Array.isArray(pa.erreurs_a_eviter) && pa.erreurs_a_eviter.length)
      items += `<li><b>À éviter :</b> ${pa.erreurs_a_eviter.map(auditEsc).join(', ')}</li>`;
    if (items) {
      html += `<div class="audit-block audit-plan">
        <div class="audit-block-title">🎯 Ton plan des 30 prochains jours</div>
        <ul class="audit-plan-list">${items}</ul>
      </div>`;
    }
  }

  // ── Données manquantes ──
  // ── Pour un audit plus complet ──
  // Liste ce qui a manqué à Scriptura pour aller plus loin. S'affiche seulement
  // s'il manque vraiment quelque chose : un audit complet n'affiche rien.
  const manquantes = Array.isArray(a.donnees_manquantes) ? a.donnees_manquantes.filter(Boolean) : [];
  if (manquantes.length) {
    html += auditBlock('📋 Pour un audit plus complet',
      '<ul class="audit-manquantes">' +
      manquantes.map(m => `<li>${auditEsc(m)}</li>`).join('') +
      '</ul>' +
      '<button class="btn-storyboard audit-refaire" onclick="affinerAudit()">Refaire l\'audit avec les captures manquantes</button>');
  }

  // ── Copier / Partager ──
  const txtAudit = auditTexteBrut(a, ts);
  html += `<div class="sb-actions-fin">
    <button class="icon-btn" title="Copier l'audit" onclick="copyText(this, '${storeCopyText(txtAudit)}')">${ICON_COPY}</button>
    <button class="icon-btn" title="Partager l'audit" onclick="shareText(this, '${storeCopyText(txtAudit)}')">${ICON_SHARE}</button>
    <button class="icon-btn" title="Télécharger en PDF" onclick="telechargerAuditPDF()">${ICON_PDF}</button>
  </div>`;

  // ── Pont vers le contenu ── (la recommandation IA ci-dessous propose déjà
  // "Créer le script" et "Voir d'autres recommandations", ce bouton faisait doublon)
  html += `<div id="auditOpportunites"></div></div>`;

  out.innerHTML = html;
  animerScoreAudit(global, RING_C);
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // "Et maintenant ?" : générée après coup, en tâche de fond, pour ne jamais
  // retarder l'affichage du rapport lui-même. niche/objectif sont transmis
  // explicitement car, sur un audit tout juste terminé, le Profil Créateur
  // n'a pas encore fini de les enregistrer en mémoire (ça se fait plus bas,
  // après cet appel) : on ne veut pas attendre pour les connaître.
  if (typeof afficherEtMaintenant === 'function') afficherEtMaintenant(a, ts, oppNiche, oppObjectif);
}

// Fait apparaître la forme du radar en fondu, une fois le SVG dans le DOM.
function animerRadar() {
  const shape = document.getElementById('auditRadarShape');
  if (!shape) return;
  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduit) { shape.style.opacity = '1'; return; }
  shape.style.opacity = '0';
  shape.style.transform = 'scale(0.4)';
  requestAnimationFrame(() => {
    shape.style.opacity = '1';
    shape.style.transform = 'scale(1)';
  });
}

// Dessine un radar (toile d'araignée) des dimensions du score.
// SVG pur, sans librairie. Chaque branche = une dimension, la distance au
// centre = la note en proportion de son maximum.
function radarSVG(ts, dimValeur) {
  const cx = 160, cy = 130, rayonMax = 74;
  const dims = SCORE_DIMS;
  const n = dims.length;
  const point = (i, rayon) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + rayon * Math.cos(angle), cy + rayon * Math.sin(angle)];
  };

  let grille = '';
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const pts = dims.map((_, i) => point(i, rayonMax * f).map(v => v.toFixed(1)).join(',')).join(' ');
    grille += `<polygon class="audit-radar-grid" points="${pts}"/>`;
  });
  let branches = '', labels = '';
  dims.forEach((d, i) => {
    const [bx, by] = point(i, rayonMax);
    branches += `<line class="audit-radar-spoke" x1="${cx}" y1="${cy}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>`;
    const [lx, ly] = point(i, rayonMax + 16);
    const v = dimValeur(ts[d.key]);
    const ancre = Math.abs(lx - cx) < 5 ? 'middle' : (lx > cx ? 'start' : 'end');
    labels += `<text class="audit-radar-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${ancre}" dominant-baseline="middle">${d.label}</text>`;
    if (v !== null) {
      labels += `<text class="audit-radar-val" x="${lx.toFixed(1)}" y="${(ly + 12).toFixed(1)}" text-anchor="${ancre}" dominant-baseline="middle">${v}/${d.max}</text>`;
    }
  });
  const pts = dims.map((d, i) => {
    const v = dimValeur(ts[d.key]);
    const frac = v === null ? 0 : Math.max(0, Math.min(1, v / d.max));
    return point(i, rayonMax * frac).map(x => x.toFixed(1)).join(',');
  }).join(' ');
  const dots = dims.map((d, i) => {
    const v = dimValeur(ts[d.key]);
    if (v === null) return '';
    const [px, py] = point(i, rayonMax * Math.max(0, Math.min(1, v / d.max)));
    return `<circle class="audit-radar-dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3"/>`;
  }).join('');

  return `<div class="audit-radar-wrap">
    <svg class="audit-radar" viewBox="0 0 320 260" id="auditRadarSvg">
      ${grille}${branches}
      <polygon class="audit-radar-shape" id="auditRadarShape" points="${pts}" style="opacity:0"/>
      ${dots}
      ${labels}
    </svg>
  </div>`;
}

// Anime l'anneau de score et le compteur de 0 jusqu'à la valeur finale.
// Respecte la préférence système "réduire les animations".
function animerScoreAudit(valeur, circonference) {
  const numEl = document.getElementById('auditScoreNum');
  const ringEl = document.getElementById('auditRingFill');
  if (valeur == null || Number.isNaN(valeur)) {
    if (numEl) numEl.textContent = '·';
    return;
  }
  const cible = Math.max(0, Math.min(100, valeur));
  const offsetFinal = circonference * (1 - cible / 100);

  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduit) {
    if (numEl) numEl.textContent = cible;
    if (ringEl) ringEl.style.strokeDashoffset = offsetFinal;
    return;
  }

  // L'anneau part sur sa transition CSS après un court délai (sinon le
  // navigateur applique la valeur finale sans transition au premier rendu).
  if (ringEl) requestAnimationFrame(() => { ringEl.style.strokeDashoffset = offsetFinal; });

  // Le chiffre monte en parallèle, calé sur la même durée que l'anneau.
  const duree = 1300;
  const debut = performance.now();
  function tick(maintenant) {
    const t = Math.min(1, (maintenant - debut) / duree);
    const adouci = 1 - Math.pow(1 - t, 3); // easing cubic-out, comme l'anneau
    if (numEl) numEl.textContent = Math.round(cible * adouci);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function auditBlock(titre, inner) {
  return `<div class="audit-block"><div class="audit-block-title">${titre}</div>${inner}</div>`;
}

// Pont audit → mode idées : envoie le problème principal vers le générateur d'idées
// Ramène à la zone d'upload en gardant les captures déjà chargées, pour en
// ajouter d'autres (ex : sources de trafic) puis relancer. Le relancement
// passe par lancerAudit → peutAuditer, donc il consomme bien un audit du mois.
function affinerAudit() {
  const out = document.getElementById('auditOutput');
  if (out) out.innerHTML = ''; // on efface l'ancien résultat, les captures restent

  // Le contexte (objectif, niche, fréquence, style) est déjà rempli et
  // conservé : inutile de re-parcourir les 5 étapes. Le mode "affiner" de
  // l'assistant montre directement l'ajout de captures + le rappel + la relance.
  initAuditWizard(true);

  const drop = document.getElementById('auditDrop');
  if (drop) drop.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const input = document.getElementById('auditInput');
  if (input) setTimeout(() => input.click(), 400);
}

// Bouton "← Retour" en haut du module diagnostic complet. En mode "affiner"
// (après clic sur "Refaire l'audit avec les captures manquantes"), le
// résultat précédent a été effacé de l'écran mais lastAudit le garde encore
// en mémoire : Retour doit le restaurer plutôt que quitter tout le module,
// sinon le diagnostic déjà généré serait perdu pour rien à chaque clic.
function auditRetour() {
  if (auditAffineMode && lastAudit) {
    renderAudit(lastAudit);
    masquerUICaptureAudit();
    return;
  }
  navBack();
}

// Pré-remplit le mode idées à partir d'une niche + objectif connus (issus d'un
// audit, à l'écran ou sauvegardé) et lance directement la génération.
function lancerIdeesDepuisAudit(niche, objectif) {
  chooseMode('ideas');

  const nicheField = document.getElementById('ideaNiche');
  const geoField = document.getElementById('ideaGeo');
  if (geoField) geoField.value = ''; // ne jamais hériter d'une ancienne saisie

  // Niche inconnue (audit ancien, enregistré avant qu'on la sauvegarde) :
  // on ouvre le formulaire vierge pour que l'utilisateur la choisisse,
  // plutôt que de générer avec une valeur résiduelle qui n'est pas la sienne.
  if (!niche) {
    if (nicheField) {
      nicheField.selectedIndex = 0;
      nicheField.dispatchEvent(new Event('change'));
    }
    const info = document.getElementById('ideasFlow');
    if (info) info.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (nicheField) {
    nicheField.value = niche;
    nicheField.dispatchEvent(new Event('change')); // met à jour l'affichage du champ géo lié
  }

  const mapObjectif = {
    'Faire plus de vues et maximiser la portée': 'faire des vues',
    'Gagner des abonnés qualifiés rapidement': 'gagner des abonnés',
    'Générer des ventes via mon contenu': 'générer des ventes',
    'Renforcer mon expertise et ma crédibilité': 'renforcer mon expertise'
  };
  const goalVal = mapObjectif[objectif];
  if (goalVal) {
    const btn = document.querySelector('#ideaGoalGrid .grid-btn[data-val="' + goalVal + '"]');
    if (btn) btn.click();
  }

  // Exception : si la niche exige une zone géo et qu'on ne l'a pas, on laisse
  // le formulaire ouvert pour que l'utilisateur la précise (sinon échec).
  const geoRequise = ['Histoire', 'Géopolitique & Actualité', 'Culture & Société', 'Spiritualité & Philosophie', 'Lifestyle'];
  const geoVal = document.getElementById('ideaGeo')?.value.trim();
  if (niche && geoRequise.includes(niche) && !geoVal) {
    const info = document.getElementById('ideasFlow');
    if (info) info.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  generateIdeas();

}

// ═══════════════════════════════════════════════════════════
//  "ET MAINTENANT ?", pont audit → recommandation IA → script
//  À la fin de chaque analyse, la recommandation personnalisée (titre,
//  angle, justifications, potentiel) est générée par le moteur partagé
//  js/recommandations.js (voir afficherEtMaintenant), à partir de ce
//  diagnostic (stats, points forts/faibles, meilleures et moins bonnes
//  vidéos, audience) ET de la mémoire du créateur. Ne consomme aucun
//  quota : c'est un prolongement de l'audit déjà payé.
// ═══════════════════════════════════════════════════════════

// Reformule le diagnostic déjà affiché en texte compact pour le prompt,
// on ne réutilise que des champs déjà lus ailleurs dans ce fichier (piliers,
// plan d'action), sans toucher aux règles d'analyse ni au prompt de l'audit.
function texteDiagnosticOpportunites(a, ts) {
  const P = a.piliers || {};
  const lignes = [];
  if (ts && ts.global != null) {
    lignes.push('Score ADN TikTok global : ' + ts.global + '/100' + (ts.levier_dim ? ' (levier principal : ' + ts.levier_dim + ')' : ''));
  }
  if (P.performance_globale) {
    if (P.performance_globale.constat) lignes.push('Performance globale : ' + P.performance_globale.constat);
    if (P.performance_globale.blocage) lignes.push('Blocage identifié : ' + P.performance_globale.blocage);
  }
  if (P.meilleure_video) {
    if (P.meilleure_video.constat) lignes.push('Meilleure vidéo : ' + P.meilleure_video.constat);
    if (P.meilleure_video.formule) lignes.push('Formule qui marche chez ce créateur : ' + P.meilleure_video.formule);
  }
  if (P.pire_video && P.pire_video.constat) lignes.push('Vidéo la plus faible : ' + P.pire_video.constat);
  if (P.comparatif && P.comparatif.conclusion) lignes.push('Comparatif meilleure/pire vidéo : ' + P.comparatif.conclusion);
  if (P.editorial) {
    if (Array.isArray(P.editorial.sujets_notes) && P.editorial.sujets_notes.length) {
      lignes.push('Sujets déjà traités : ' + P.editorial.sujets_notes.map(s => (s.sujet || '') + ' (' + (s.note || '') + ')').join(', '));
    }
    if (P.editorial.recommandation) lignes.push('Recommandation éditoriale : ' + P.editorial.recommandation);
  }
  if (P.niche && P.niche.nom) {
    lignes.push('Niche (' + (P.niche.etat === 'claire' ? 'claire' : 'encore floue') + ') : ' + P.niche.nom);
    if (Array.isArray(P.niche.analyse) && P.niche.analyse.length) lignes.push('Analyse de positionnement : ' + P.niche.analyse.join(' '));
  }
  if (P.analyse_detaillee && Array.isArray(P.analyse_detaillee.concepts_recurrents) && P.analyse_detaillee.concepts_recurrents.length) {
    lignes.push('Concepts récurrents dans le top contenus : ' + P.analyse_detaillee.concepts_recurrents.map(c => c.theme + ' (' + c.occurrences + ' vidéos)').join(', '));
  }
  if (P.audience) {
    if (P.audience.constat) lignes.push('Audience : ' + P.audience.constat);
    if (P.audience.alignement) lignes.push('Alignement audience/contenu : ' + P.audience.alignement);
  }
  const pa = a.plan_action_30j;
  if (pa && typeof pa === 'object') {
    if (Array.isArray(pa.sujets_a_faire) && pa.sujets_a_faire.length) lignes.push('Sujets à explorer selon le plan : ' + pa.sujets_a_faire.join(', '));
    if (Array.isArray(pa.erreurs_a_eviter) && pa.erreurs_a_eviter.length) lignes.push('Erreurs à éviter : ' + pa.erreurs_a_eviter.join(', '));
    if (pa.type_hook) lignes.push('Type de hook recommandé pour ce compte : ' + pa.type_hook);
  }
  return lignes.filter(Boolean).join('\n');
}

// Fait apparaître un écran en fondu + légère montée.
// On retire puis remet la classe (avec un reflow forcé) pour que l'animation
// se relance à chaque navigation, et pas seulement la première fois.
function animerEntreeEcran(el) {
  if (!el) return;
  el.classList.remove('screen-appear');
  void el.offsetWidth; // force le navigateur à recalculer : relance l'animation
  el.classList.add('screen-appear');
}

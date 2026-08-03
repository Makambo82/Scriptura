// ══════════════════════════════════════
//  SYSTÈME DE LIMITE — 5 GÉNÉRATIONS GRATUITES
// ══════════════════════════════════════
const CODES_VALIDES = ["SCRIPTURA-JUIL-2026", "SCRIPTURA-AOUT-2026"]; // À changer chaque mois
const MAX_FREE = 5;

// ═══ RÉGÉNÉRATIONS GRATUITES ═══
// À chaque nouveau contenu, l'utilisateur a REGEN_GRATUITES régénérations gratuites.
// Au-delà, la régénération compte comme une génération normale (soustraite du quota).
const REGEN_GRATUITES = 2;
// Compteur par type de contenu (réinitialisé à chaque NOUVELLE génération de ce type)
let regenCount = { script: 0, story: 0, storyboardIdee: 0, storyboardStory: 0 };
// Flag : la génération en cours est-elle une régénération gratuite ? (ne compte pas au quota)
let _regenGratuiteEnCours = false;

// Détermine si une régénération est gratuite, et incrémente le compteur.
// Retourne true si gratuite (ne pas compter), false si elle doit compter.
function regenEstGratuite(type) {
  regenCount[type] = (regenCount[type] || 0) + 1;
  return regenCount[type] <= REGEN_GRATUITES;
}
// Réinitialise le compteur d'un type (à appeler quand un NOUVEAU contenu est généré, pas régénéré)
function resetRegen(type) {
  regenCount[type] = 0;
}

let usedGen = parseInt(localStorage.getItem('scriptura_used') || '0');
let unlocked = localStorage.getItem('scriptura_unlocked') === 'true';

// Ligne "Ton code" à afficher dans le pop-up d'infos : le code personnel de
// l'utilisateur (abonné OU acheteur de jetons). Rien si aucun code enregistré.
function ligneCodeInfos() {
  const code = (localStorage.getItem('scriptura_code') || '').trim();
  if (!code) return '';
  const codeEchappe = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return '<div class="infos-ligne"><span class="infos-label">Ton code</span>'
    + '<span class="infos-val" style="cursor:pointer;user-select:all" title="Toucher pour copier"'
    + ' onclick="copierCodeInfos(this, \'' + codeEchappe + '\')">' + code + ' ⧉</span></div>';
}

// Copie le code dans le presse-papier, avec un retour visuel bref.
function copierCodeInfos(el, code) {
  try {
    if (navigator.clipboard) navigator.clipboard.writeText(code);
    const avant = el.textContent;
    el.textContent = 'Copié ✓';
    setTimeout(function () { el.textContent = avant; }, 1200);
  } catch (e) { /* silencieux */ }
}

// Pop-up d'informations sur l'abonnement (plan, expiration, décompte)
async function ouvrirInfosAbonne() {
  const overlay = document.getElementById('infosAbonneOverlay');
  const corps = document.getElementById('infosAbonneCorps');
  if (!overlay || !corps) return;

  const monCode = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  const estIllimite = CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode);

  corps.innerHTML = '<p class="serie-card-concept">Chargement…</p>';
  overlay.classList.add('active');

  let html = '';

  // ── CAS 1 : accès illimité (fondateur) ──
  if (estIllimite) {
    html += ligneCodeInfos();
    html += `<div class="infos-ligne"><span class="infos-label">Ton offre</span><span class="infos-val">Accès complet</span></div>`;
    html += `<div class="infos-ligne"><span class="infos-label">Validité</span><span class="infos-val">Illimitée</span></div>`;
    html += `<div class="infos-ligne"><span class="infos-label">Générations</span><span class="infos-val">Illimitées</span></div>`;
    html += `<div class="infos-ligne"><span class="infos-label">Diagnostics TikTok</span><span class="infos-val">Illimités</span></div>`;
    corps.innerHTML = html;
    return;
  }

  const jetons = await lireJetonsAudit();

  // ── CAS 2 : non-abonné (avec ou sans jetons achetés) ──
  if (!unlocked) {
    const resteGratuit = Math.max(0, MAX_FREE - usedGen);
    html += ligneCodeInfos();
    html += `<div class="infos-ligne"><span class="infos-label">Ton offre</span><span class="infos-val">Plan gratuit</span></div>`;
    html += `<div class="infos-ligne"><span class="infos-label">Générations gratuites</span><span class="infos-val">${formaterNombre(usedGen)} / ${formaterNombre(MAX_FREE)} · ${formaterNombre(resteGratuit)} restantes</span></div>`;
    html += `<div class="infos-ligne"><span class="infos-label">Jetons</span><span class="infos-val">${formaterNombre(jetons)} jeton${jetons > 1 ? 's' : ''}</span></div>`;
    corps.innerHTML = html;
    return;
  }

  // ── CAS 3 : abonné (Creator ou Pro) ──
  const plan = (typeof monPalier === 'function') ? monPalier() : 'creator';
  const planNom = plan === 'pro' ? 'Pro' : 'Creator';
  html += ligneCodeInfos();
  html += `<div class="infos-ligne"><span class="infos-label">Ton offre</span><span class="infos-val">Plan ${planNom}</span></div>`;

  // Validité : lue en direct depuis Supabase (fiable pour tous)
  let expireStr = localStorage.getItem('scriptura_expire');
  if (supabaseClient && monCode) {
    try {
      const { data, error } = await supabaseClient
        .from('abonnes').select('expire_le').eq('code', monCode).maybeSingle();
      if (!error && data && data.expire_le) {
        expireStr = data.expire_le;
        localStorage.setItem('scriptura_expire', expireStr);
      }
    } catch(e) { /* on garde le localStorage si la lecture échoue */ }
  }
  if (expireStr) {
    const dd = new Date(expireStr);
    const dateFmt = dd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    html += `<div class="infos-ligne"><span class="infos-label">Validité</span><span class="infos-val">${dateFmt}</span></div>`;
  }

  // Générations de création du mois
  const limites = limitesDuPalier();
  const faitesCrea = await countMonthGenerations('creation');
  const resteCrea = Math.max(0, limites.creation - faitesCrea);
  html += `<div class="infos-ligne"><span class="infos-label">Générations</span><span class="infos-val">${formaterNombre(faitesCrea)} / ${formaterNombre(limites.creation)} · ${formaterNombre(resteCrea)} restantes</span></div>`;

  // Analyses incluses (Pro) : expirent avec l'abonnement
  if (limites.audit > 0) {
    const faitsAudit = await countMonthGenerations('audit');
    const resteAudit = Math.max(0, limites.audit - faitsAudit);
    html += `<div class="infos-ligne"><span class="infos-label">Diagnostics TikTok</span><span class="infos-val">${formaterNombre(faitsAudit)} / ${formaterNombre(limites.audit)} · ${formaterNombre(resteAudit)} restants</span></div>`;
  }

  // Jetons achetés à l'unité : séparés, sans plafond, ne périment pas
  html += `<div class="infos-ligne"><span class="infos-label">Jetons</span><span class="infos-val">${formaterNombre(jetons)} jeton${jetons > 1 ? 's' : ''}</span></div>`;

  corps.innerHTML = html;
}

function fermerInfosAbonne() {
  const o = document.getElementById('infosAbonneOverlay');
  if (o) o.classList.remove('active');
}

function renderGenCounter() {
  // Le libellé du bouton d'accueil dépend du statut abonné : on le met à jour ici,
  // là où on connaît déjà `unlocked`.
  if (typeof majHeroCta === 'function') majHeroCta();
  // Liste de tous les conteneurs de compteur (les 3 modes)
  const counters = [
    { counter: document.getElementById('genCounter'), dots: document.getElementById('genCounterDots'), num: document.getElementById('usedNum') },
    { counter: document.getElementById('genCounterIdeas'), dots: document.querySelector('#genCounterIdeas .genCounterDotsShared'), num: document.querySelector('#genCounterIdeas .usedNumShared') },
    { counter: document.getElementById('genCounterStory'), dots: document.querySelector('#genCounterStory .genCounterDotsShared'), num: document.querySelector('#genCounterStory .usedNumShared') },
    { counter: document.getElementById('genCounterHome'), dots: document.getElementById('genCounterDotsHome'), num: document.getElementById('usedNumHome') }
  ];

  for (const c of counters) {
    if (!c.counter) continue;

    if (unlocked) {
      // Abonné actif : bandeau PREMIUM (pastille dorée + halo + scintillement),
      // pour qu'il se sente distingué du non-abonné.
      c.counter.classList.remove('pulse');
      c.counter.classList.add('is-premium');
      // Libellé de la pastille : Fondateur pour le compte admin, sinon
      // "Abonné Creator" / "Abonné Pro" selon le plan.
      let badgeTxt;
      if (typeof estCodeAdmin === 'function' && estCodeAdmin()) {
        badgeTxt = 'Fondateur';
      } else {
        const palier = (typeof monPalier === 'function') ? monPalier() : 'creator';
        badgeTxt = (palier === 'pro') ? 'Abonné Pro' : 'Abonné Creator';
      }
      c.counter.innerHTML =
        '<span class="abonne-badge"><span class="abonne-star">★</span> ' + badgeTxt + '</span>' +
        '<span class="quota-jour" style="color:rgba(255,255,255,0.55);font-size:0.82rem"></span>';
      c.counter.style.cursor = 'pointer';
      c.counter.onclick = ouvrirInfosAbonne;
      continue;
    }
    // Non-abonné (ou abonnement expiré, qui repasse unlocked=false) : on attire l'œil
    c.counter.classList.remove('is-premium');
    c.counter.classList.add('pulse');

    // Reconstruire le contenu (au cas où il aurait été remplacé par "illimité")
    if (!c.dots || !c.counter.querySelector('.gen-counter-dots')) {
      c.counter.innerHTML = '<span>Générations gratuites · <strong>' + usedGen + '</strong> / ' + MAX_FREE + ' utilisées</span><div class="gen-counter-dots"></div>';
    }
    // Le bandeau du non-abonné est cliquable : il ouvre ses infos (gratuites + jetons)
    c.counter.style.cursor = 'pointer';
    c.counter.onclick = ouvrirInfosAbonne;

    const dotsEl = c.counter.querySelector('.gen-counter-dots');
    if (dotsEl) {
      dotsEl.innerHTML = '';
      for (let i = 0; i < MAX_FREE; i++) {
        const d = document.createElement('div');
        d.className = 'gcdot' + (i < usedGen ? ' used' : '');
        dotsEl.appendChild(d);
      }
    }
    const numEl = c.counter.querySelector('strong');
    if (numEl) numEl.textContent = usedGen;
  }
}

// Met à jour l'affichage du quota journalier pour les abonnés
async function updateQuotaJour() {
  if (!unlocked) return;
  // Codes VIP/admin : on affiche "illimité", pas de quota.
  const monCode = (localStorage.getItem('scriptura_code') || '').toUpperCase();
  if (CODES_ILLIMITES.map(c => c.toUpperCase()).includes(monCode)) {
    document.querySelectorAll('.quota-jour').forEach(el => { el.textContent = '  ·  illimité'; });
    return;
  }
  const faites = await countMonthGenerations('creation');
  const limiteCreation = limitesDuPalier().creation;
  const faitesAff = Math.min(faites, limiteCreation);
  const els = document.querySelectorAll('.quota-jour');
  els.forEach(el => {
    el.textContent = '  ·  ' + faitesAff + '/' + limiteCreation;
  });
}

function openPaywall() {
  // État par défaut (quota de création épuisé) : on présente Creator.
  // choisirPlan() personnalise ensuite si l'utilisateur vient du choix de plan.
  const tag = document.querySelector('#paywall .paywall-tag');
  const titre = document.querySelector('#paywall h3');
  const desc = document.querySelector('#paywall p');
  const prix = document.querySelector('#paywall .paywall-price');
  const wa = document.querySelector('#paywall .paywall-wa');
  if (tag) tag.textContent = 'Accès Créateur';
  if (titre) titre.innerHTML = 'Tu as utilisé tes<br/>générations du mois.';
  if (desc) desc.textContent = 'Passe au plan Creator pour continuer à générer chaque mois, ou au plan Pro pour débloquer aussi le diagnostic TikTok.';
  if (prix) prix.textContent = '5.000 FCFA';
  if (wa) wa.href = 'https://wa.me/22995056424?text=' + encodeURIComponent(PLANS.creator.wa);
  document.getElementById('paywall').classList.add('active');
}
function closePaywall() {
  document.getElementById('paywall').classList.remove('active');
}

// ── Fenêtre de choix des plans ──
// contexte : 'nouveau' (non-abonné épuisé, montre les 2 plans),
//            'upgrade' (Creator veut l'audit, met le Pro en avant),
//            'quota' (quota du mois atteint).
function openPlans(contexte) {
  contexte = contexte || 'nouveau';
  const tag = document.getElementById('plansTag');
  const titre = document.getElementById('plansTitle');
  const intro = document.getElementById('plansIntro');
  const cardCreator = document.getElementById('planCardCreator');
  const cardPro = document.getElementById('planCardPro');
  const proBadge = document.getElementById('planProBadge');

  // Réglages par défaut, puis on ajuste selon le contexte
  if (cardCreator) cardCreator.style.display = '';
  if (cardPro) cardPro.style.display = '';
  if (intro) intro.style.display = 'none';
  if (proBadge) { proBadge.textContent = 'Recommandé'; proBadge.style.display = ''; }
  const packsBloc = document.getElementById('packsAudit');
  if (packsBloc) packsBloc.style.display = 'none'; // masqué sauf en contexte d'achat

  if (contexte === 'expire') {
    // Ancien abonné dont l'abonnement est arrivé à échéance : on propose de renouveler.
    if (tag) tag.textContent = 'Abonnement expiré';
    if (titre) titre.innerHTML = 'Ton abonnement<br/>est arrivé à échéance';
    if (intro) { intro.textContent = 'Renouvelle pour retrouver ton accès et continuer à créer sans interruption.'; intro.style.display = 'block'; }
  } else if (contexte === 'upgrade') {
    // Abonné Creator qui veut l'analyse TikTok : on ne remontre pas Creator
    if (tag) tag.textContent = 'Passe au Pro';
    if (titre) titre.innerHTML = 'Cette fonctionnalité<br/>est dans le plan Pro';
    if (intro) { intro.textContent = 'Tu as déjà le plan Creator. Le plan Pro ajoute le diagnostic TikTok (propulsé par notre IA la plus avancée) et le mode Crée-moi une série.'; intro.style.display = 'block'; }
    if (cardCreator) cardCreator.style.display = 'none';
    if (proBadge) proBadge.style.display = 'none';
  } else if (contexte === 'quota') {
    // Quota mensuel atteint : on explique, et on propose une éventuelle
    // montée en gamme — mais jamais le plan que l'utilisateur a déjà.
    const palier = (typeof monPalier === 'function') ? monPalier() : 'creator';
    if (tag) tag.textContent = 'Limite du mois atteinte';
    if (titre) titre.innerHTML = 'Tu as utilisé tes<br/>générations du mois';
    if (palier === 'pro') {
      // Aucun plan au-dessus : message seul, pas de carte.
      if (intro) { intro.textContent = 'Ton quota se recharge au début du mois prochain.'; intro.style.display = 'block'; }
      if (cardCreator) cardCreator.style.display = 'none';
      if (cardPro) cardPro.style.display = 'none';
    } else {
      // Creator : on masque Creator (déjà pris) et on propose Pro.
      if (intro) { intro.textContent = 'Ton quota se recharge au début du mois prochain. Ou passe au plan Pro pour en faire plus, dès maintenant.'; intro.style.display = 'block'; }
      if (cardCreator) cardCreator.style.display = 'none';
      if (proBadge) proBadge.style.display = 'none';
    }
  } else if (contexte === 'decouverte-audit') {
    // Non-abonné qui clique sur l'audit : c'est une fonctionnalité Pro, on le
    // dit sans prétendre qu'il a épuisé ses générations gratuites.
    if (tag) tag.textContent = 'Fonctionnalité Pro';
    if (titre) titre.innerHTML = 'Le diagnostic<br/>TikTok est dans le Pro';
    if (intro) { intro.textContent = 'Ce diagnostic fait partie du plan Pro. Voici les deux offres pour débloquer Scriptura.'; intro.style.display = 'block'; }
  } else if (contexte === 'achat-jeton-creator') {
    // Abonné Creator qui veut une analyse OU une série : c'est du Pro,
    // et on propose aussi les jetons au tarif Creator (moins cher).
    // 1 jeton = 1 analyse OU 1 série.
    if (tag) tag.textContent = 'Diagnostic & Série';
    if (titre) titre.innerHTML = 'Débloque le diagnostic<br/>et le mode Série';
    if (intro) { intro.textContent = 'Tu as déjà le plan Creator. Le plan Pro ajoute le diagnostic TikTok et le mode Crée-moi une série. Sinon, achète des jetons : 1 jeton = 1 diagnostic OU 1 série.'; intro.style.display = 'block'; }
    if (cardCreator) cardCreator.style.display = 'none';
    if (proBadge) proBadge.style.display = 'none';
    if (packsBloc) { remplirPacks('creator'); packsBloc.style.display = 'block'; }
  } else if (contexte === 'achat-jeton-nonabonne') {
    // Non-abonné : Pro complet OU jetons au tarif non-abonné.
    // 1 jeton = 1 analyse OU 1 série.
    if (tag) tag.textContent = 'Diagnostic & Série';
    if (titre) titre.innerHTML = 'Débloque le diagnostic<br/>et le mode Série';
    if (intro) { intro.textContent = 'Le diagnostic TikTok et le mode Crée-moi une série font partie du plan Pro. Prends le Pro pour tout débloquer, ou achète des jetons : 1 jeton = 1 diagnostic OU 1 série.'; intro.style.display = 'block'; }
    if (cardCreator) cardCreator.style.display = 'none';
    if (proBadge) proBadge.style.display = 'none';
    if (packsBloc) { remplirPacks('nonabonne'); packsBloc.style.display = 'block'; }
  } else {
    // Non-abonné qui a épuisé ses générations gratuites (sans jetons affichés)
    if (tag) tag.textContent = 'Choisis ton offre';
    if (titre) titre.innerHTML = 'Tu as utilisé tes<br/>5 générations gratuites';
    if (intro) { intro.textContent = 'Pour continuer à créer sans attendre, choisis le plan qui te convient.'; intro.style.display = 'block'; }
  }

  const el = document.getElementById('plansOverlay');
  if (el) el.classList.add('active');
}
function closePlans() {
  const el = document.getElementById('plansOverlay');
  if (el) el.classList.remove('active');
}

// Détails de chaque plan, source unique pour l'affichage et le message WhatsApp
const PLANS = {
  creator: {
    nom: 'Creator',
    prix: '5.000 FCFA',
    titre: 'Passe au plan Creator',
    desc: 'Les 3 modes de création, 50 générations par mois.',
    wa: 'Bonjour, je veux le plan Creator de Scriptura — 5.000 FCFA/mois'
  },
  pro: {
    nom: 'Pro',
    prix: '10.000 FCFA',
    titre: 'Passe au plan Pro',
    desc: 'Tout Creator + le diagnostic TikTok et le mode Crée-moi une série. 70 générations + 5 diagnostics par mois.',
    wa: 'Bonjour, je veux le plan Pro de Scriptura — 10.000 FCFA/mois'
  }
};

// Packs de jetons a l'unite, tarifes selon le profil de l'acheteur.
// 1 jeton = 1 analyse de compte OU 1 série.
const PACKS_AUDIT = {
  creator: [
    { qte: 1, prix: 2500, label: '1 jeton' },
    { qte: 2, prix: 4000, label: '2 jetons' },
    { qte: 3, prix: 6000, label: '3 jetons' }
  ],
  nonabonne: [
    { qte: 1, prix: 3500, label: '1 jeton' },
    { qte: 2, prix: 6000, label: '2 jetons' },
    { qte: 3, prix: 9000, label: '3 jetons' }
  ]
};

// Remplit la grille de packs selon le profil ('creator' ou 'nonabonne').
function remplirPacks(profil) {
  const grid = document.getElementById('packsGrid');
  if (!grid) return;
  const packs = PACKS_AUDIT[profil] || PACKS_AUDIT.nonabonne;
  _packsProfilCourant = profil;
  grid.innerHTML = packs.map(function(p, i) {
    const prixFmt = formaterNombre(p.prix) + ' FCFA';
    return '<button class="pack-btn" onclick="acheterPack(' + i + ')">'
      + '<span class="pack-label"><b>' + p.label + '</b></span>'
      + '<span class="pack-price">' + prixFmt + '</span></button>';
  }).join('');
}

let _packsProfilCourant = 'nonabonne';
function acheterPack(index) {
  const packs = PACKS_AUDIT[_packsProfilCourant] || PACKS_AUDIT.nonabonne;
  const p = packs[index];
  if (!p) return;
  const prixFmt = formaterNombre(p.prix) + ' FCFA';
  const msg = 'Bonjour, je veux acheter ' + p.label + ' Scriptura (diagnostic ou série) — ' + prixFmt;
  window.open('https://wa.me/22995056424?text=' + encodeURIComponent(msg), '_blank');
}

// L'utilisateur a choisi un plan : on ferme la fenêtre de choix et on ouvre
// le paywall d'abonnement, adapté au plan sélectionné.
// L'utilisateur a choisi un plan : on ouvre directement WhatsApp avec le
// message pré-rempli. Plus de fenêtre intermédiaire.
function choisirPlan(cle) {
  const p = PLANS[cle];
  if (!p) return;
  closePlans();
  window.open('https://wa.me/22995056424?text=' + encodeURIComponent(p.wa), '_blank');
}


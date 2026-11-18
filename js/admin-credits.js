// ═══════════════════════════════════════════════════════════
//  CARTE « CRÉDITS API » DU TABLEAU DE BORD (fondateur)
//
//  Répond à : « est-ce qu'on peut voir le crédit restant des API de l'app ? ».
//  Deux natures de chiffres, étiquetées à l'écran pour ne jamais être
//  confondues :
//    RÉEL   : ElevenLabs et TikHub exposent leur solde, l'app le lit.
//    ESTIMÉ : Anthropic et Together n'ont aucun point d'accès pour leur solde.
//             Le fondateur saisit son solde à chaque recharge, l'app retranche
//             ce qu'elle mesure elle-même depuis (voir api/_lib/depenses.js).
//  Calculs côté serveur (api/_lib/credits-api.js) : ce fichier ne fait
//  qu'afficher, et n'invente jamais un chiffre.
// ═══════════════════════════════════════════════════════════

let _creditsApi = { etat: null, chargement: false, erreur: '', formOuvert: null, formErreur: '' };

const CREDITS_NOMS = { elevenlabs: 'ElevenLabs', tikhub: 'TikHub', anthropic: 'Anthropic', together: 'Together' };
const CREDITS_ROLES = {
  elevenlabs: 'Voix off et transcription',
  tikhub: 'Données TikTok',
  anthropic: 'Écriture par l\'IA',
  together: 'Images et vidéos'
};
// Console de recharge de chaque fournisseur, pour agir en un clic.
const CREDITS_LIENS = {
  elevenlabs: 'https://elevenlabs.io/app/subscription',
  tikhub: 'https://tikhub.io',
  anthropic: 'https://console.anthropic.com/settings/billing',
  together: 'https://api.together.ai/settings/organization/~current/billing'
};
const CREDITS_NIVEAUX = {
  ok: { couleur: 'var(--emerald-light)', libelle: 'OK' },
  bas: { couleur: 'var(--gold-light)', libelle: 'Bas' },
  critique: { couleur: '#f87171', libelle: 'Critique' },
  epuise: { couleur: '#f87171', libelle: 'Épuisé' }
};

function creditsUsd(centimes) {
  return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
}
function creditsUsdBrut(usd) {
  return Number(usd).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' $';
}
function creditsDate(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function creditsPastille(niveau, estime) {
  const n = CREDITS_NIVEAUX[niveau];
  const nature = estime
    ? '<span class="credits-tag" style="color:var(--gold-light);border-color:var(--border)">estimé</span>'
    : '<span class="credits-tag" style="color:var(--emerald-light);border-color:var(--emerald-border)">réel</span>';
  const etat = n
    ? `<span class="credits-tag" style="color:${n.couleur};border-color:${n.couleur}">${n.libelle}</span>`
    : (estime ? '' : '<span class="credits-tag" style="color:var(--muted);border-color:var(--border-soft)">non lu</span>');
  return nature + ' ' + etat;
}

function creditsBarre(pourcent, niveau) {
  const n = CREDITS_NIVEAUX[niveau] || CREDITS_NIVEAUX.ok;
  const p = Math.max(0, Math.min(100, pourcent));
  return `<div class="credits-barre" role="img" aria-label="${p} % restant"><i style="width:${p}%;background:${n.couleur}"></i></div>`;
}

function creditsMessageIndisponible(f, d) {
  const detail = d.detail ? ' (' + escAdmin(d.detail) + ')' : '';
  if (d.raison === 'cle_absente') return 'Clé absente côté serveur (variable d\'environnement ' + (f === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'TIKHUB_API_KEY') + ' sur Vercel).';
  // Une clé API a des permissions : celle-ci sert à travailler (générer des voix,
  // lire des profils) mais pas à lire SON PROPRE solde. Ce n'est pas une panne,
  // c'est un réglage de la clé chez le fournisseur, puis « Actualiser ».
  if (d.raison === 'droit_lecture' && f === 'elevenlabs') {
    return 'La clé ElevenLabs sert à générer des voix, mais n\'a pas le droit de lire l\'abonnement. Dans ElevenLabs, ouvre cette clé et active la permission «&nbsp;User&nbsp;: Read&nbsp;», puis clique sur Actualiser.';
  }
  if (d.raison === 'droit_lecture' && f === 'tikhub') {
    return 'La clé TikHub fonctionne pour lire les profils, mais n\'a pas la permission de lire les informations du compte. Dans ton tableau de bord TikHub, ouvre cette clé, ajoute la permission liée au compte utilisateur (souvent nommée «&nbsp;User&nbsp;»), puis clique sur Actualiser.' + (d.detail ? ' Réponse de TikHub&nbsp;: «&nbsp;' + escAdmin(d.detail) + '&nbsp;».' : '');
  }
  if (d.raison === 'format_inconnu' && f === 'tikhub') {
    const champs = Array.isArray(d.champs) && d.champs.length
      ? ' Champs reçus : ' + d.champs.map(c => escAdmin(c.cle) + ' = ' + escAdmin(c.valeur)).join(' · ') + '.'
      : '';
    return 'TikHub répond, mais je ne reconnais pas le champ du solde.' + champs;
  }
  if (d.raison === 'injoignable') return 'Fournisseur injoignable pour le moment.' + detail;
  return 'Lecture impossible (' + escAdmin(d.raison || 'erreur inconnue') + ').' + detail;
}

function creditsLigneReelle(f, d) {
  if (!d.disponible) {
    return `<div class="credits-ligne" data-fournisseur="${f}">
      <div class="credits-tete"><strong>${CREDITS_NOMS[f]}</strong> ${creditsPastille(null, false)}</div>
      <div class="credits-role">${CREDITS_ROLES[f]}</div>
      <div class="ideas-sub" style="margin-top:6px;line-height:1.5">${creditsMessageIndisponible(f, d)}</div>
      ${creditsLien(f)}
    </div>`;
  }
  let corps = '';
  if (f === 'elevenlabs') {
    const jours = d.remiseAZeroUnix ? Math.max(0, Math.ceil((d.remiseAZeroUnix * 1000 - Date.now()) / 86400000)) : null;
    corps = `<div class="credits-valeur">${formaterNombre(d.restants)} <span>crédits restants sur ${formaterNombre(d.limite)}</span></div>
      ${creditsBarre(d.pourcentRestant, d.niveau)}
      <div class="credits-detail">${d.palier ? 'Offre ' + escAdmin(d.palier) + '. ' : ''}${jours !== null ? 'Remise à zéro dans ' + jours + ' jour' + (jours > 1 ? 's' : '') + '.' : ''}</div>`;
  } else {
    corps = `<div class="credits-valeur">${creditsUsdBrut(d.soldeUsd)} <span>de solde</span></div>
      <div class="credits-detail">Une analyse de compte consomme quelques millièmes de dollar&nbsp;: sous 1 $, pense à recharger.</div>`;
  }
  return `<div class="credits-ligne" data-fournisseur="${f}">
    <div class="credits-tete"><strong>${CREDITS_NOMS[f]}</strong> ${creditsPastille(d.niveau, false)}</div>
    <div class="credits-role">${CREDITS_ROLES[f]}</div>
    ${corps}
    ${creditsLien(f)}
  </div>`;
}

function creditsLien(f, extra) {
  return `<div class="credits-actions">${extra || ''}<a class="credits-lien" href="${CREDITS_LIENS[f]}" target="_blank" rel="noopener">Recharger sur ${CREDITS_NOMS[f]} ↗</a></div>`;
}

function creditsFormulaire(f, d) {
  const prix = f === 'together' && d.prixUsd
    ? `<div class="credits-form-prix">
        <label>Prix d'une image ($)<input type="text" inputmode="decimal" class="ctx-input" id="creditsPrixImage" value="${escAdmin(String(d.prixUsd.image).replace('.', ','))}"/></label>
        <label>Prix d'une vidéo ($)<input type="text" inputmode="decimal" class="ctx-input" id="creditsPrixVideo" value="${escAdmin(String(d.prixUsd.video).replace('.', ','))}"/></label>
      </div>
      <div class="credits-detail">Prix par défaut à ajuster d'après ta facture Together : ils dépendent du modèle d'image choisi.</div>`
    : '';
  return `<div class="credits-form" id="creditsForm-${f}">
    <label>Solde affiché sur ta console ($)
      <input type="text" inputmode="decimal" class="ctx-input" id="creditsSolde-${f}" placeholder="ex : 25,40" autocomplete="off"/>
    </label>
    ${prix}
    <div class="err" id="creditsFormErr-${f}" style="display:${_creditsApi.formErreur && _creditsApi.formOuvert === f ? 'block' : 'none'};margin-top:10px">${escAdmin(_creditsApi.formErreur)}</div>
    <button type="button" class="btn-generate" style="margin-top:12px;width:100%" id="creditsEnregistrer-${f}" onclick="enregistrerSoldeCredits('${f}')">Enregistrer mon solde</button>
  </div>`;
}

function creditsLigneEstimee(f, d) {
  const ouvert = _creditsApi.formOuvert === f;
  const bouton = `<button type="button" class="credits-btn" onclick="basculerSaisieCredits('${f}')">${d.saisie ? 'Mettre à jour mon solde' : 'Renseigner mon solde'}</button>`;
  let corps = '';
  if (!d.saisie || !d.estimation) {
    corps = `<div class="ideas-sub" style="margin-top:6px;line-height:1.6">${CREDITS_NOMS[f]} ne permet pas de lire le solde par programme. Renseigne celui de ta console&nbsp;: l'app retranchera ensuite ce qu'elle dépense, et te préviendra avant la panne.</div>`;
  } else {
    const e = d.estimation;
    const rythme = e.rythmeParJourCentimes !== null
      ? `Rythme d'environ ${creditsUsd(e.rythmeParJourCentimes)} par jour${e.joursRestants !== null ? ', soit environ ' + e.joursRestants + ' jour' + (e.joursRestants > 1 ? 's' : '') + ' devant toi' : ''}.`
      : 'Le rythme s\'affichera après une journée de recul.';
    const derive = e.joursDepuisSaisie > 21
      ? `<div class="credits-detail" style="color:var(--gold-light)">Solde saisi il y a ${e.joursDepuisSaisie} jours&nbsp;: relis ta console et mets à jour, l'estimation dérive avec le temps.</div>`
      : '';
    const together = f === 'together' && d.compte
      ? `<div class="credits-detail">Mesuré depuis le début : ${formaterNombre(d.compte.image)} image${d.compte.image > 1 ? 's' : ''}, ${formaterNombre(d.compte.video)} vidéo${d.compte.video > 1 ? 's' : ''} (prix supposé ${creditsUsdBrut(d.prixUsd.image)} et ${creditsUsdBrut(d.prixUsd.video)}).</div>`
      : '';
    corps = `<div class="credits-valeur">≈ ${creditsUsd(e.restantCentimes)} <span>restants (estimation)</span></div>
      ${creditsBarre(e.pourcentRestant, e.niveau)}
      <div class="credits-detail">Saisi le ${escAdmin(creditsDate(d.saisie.le))}&nbsp;: ${creditsUsd(e.soldeSaisiCentimes)}. Dépensé depuis&nbsp;: ${creditsUsd(e.depuisCentimes)}. ${rythme}</div>
      ${together}${derive}`;
  }
  return `<div class="credits-ligne" data-fournisseur="${f}">
    <div class="credits-tete"><strong>${CREDITS_NOMS[f]}</strong> ${creditsPastille(d.niveau, true)}</div>
    <div class="credits-role">${CREDITS_ROLES[f]}</div>
    ${corps}
    ${ouvert ? creditsFormulaire(f, d) : ''}
    ${creditsLien(f, ouvert ? '' : bouton)}
  </div>`;
}

function carteCreditsApiHTML() {
  const { etat, chargement, erreur } = _creditsApi;
  const enTete = (classe, sous) => `<div class="score-card${classe}" id="adminCreditsApi">
    <div class="score-title">Crédits <span class="ia-majuscule">API</span></div>
    ${sous}`;
  if (!etat) {
    return enTete('', `<div class="ideas-sub" style="margin-top:8px">${erreur ? 'Indisponible : ' + escAdmin(erreur) : 'Lecture des soldes en cours…'}</div>
      ${erreur ? '<button type="button" class="credits-btn" style="margin-top:10px" onclick="chargerCreditsApi(true)">Réessayer</button>' : ''}</div>`);
  }
  const f = etat.fournisseurs;
  const suivis = [f.elevenlabs.disponible, f.tikhub.disponible, !!f.anthropic.estimation, !!f.together.estimation].filter(Boolean).length;
  const message = suivis === 0 && etat.niveau === 'ok'
    ? 'Aucun solde n\'est suivi pour l\'instant&nbsp;: renseigne tes soldes Anthropic et Together, et corrige les clés ci-dessous.'
    : {
    ok: suivis === 4 ? 'Tout est couvert pour l\'instant.' : 'Rien d\'urgent sur les fournisseurs suivis.',
    bas: 'Un fournisseur sera bientôt à court&nbsp;: recharge avant la panne.',
    critique: 'Un fournisseur est presque à sec&nbsp;: recharge maintenant.',
    epuise: 'Un fournisseur est à sec : plus aucun appel ne peut aboutir pour lui.'
  }[etat.niveau] || '';
  const alerte = etat.niveau !== 'ok' ? ' score-card-alerte' : '';
  return enTete(alerte, `<div class="ideas-sub" style="margin-top:8px;line-height:1.5">${message} <span style="opacity:.7">${suivis} fournisseur${suivis > 1 ? 's' : ''} sur 4 suivi${suivis > 1 ? 's' : ''}.</span></div>
    ${creditsLigneEstimee('anthropic', f.anthropic)}
    ${creditsLigneReelle('elevenlabs', f.elevenlabs)}
    ${creditsLigneEstimee('together', f.together)}
    ${creditsLigneReelle('tikhub', f.tikhub)}
    <div class="credits-pied">
      <button type="button" class="credits-btn" onclick="chargerCreditsApi(true)"${chargement ? ' disabled' : ''}>${chargement ? 'Actualisation…' : '↻ Actualiser'}</button>
      <span>Dernière actualisation ${escAdmin(tempsRelatifCourt(etat.actualiseLe))}.</span>
    </div>
  </div>`);
}

function rafraichirCarteCreditsApi() {
  const zone = document.getElementById('adminCreditsApi');
  if (zone) zone.outerHTML = carteCreditsApiHTML();
}

async function appelCreditsApi(corps) {
  const r = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'admin-stats', code_acces: localStorage.getItem('scriptura_code') || null, ...corps })
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

async function chargerCreditsApi(actualiser) {
  _creditsApi.chargement = true;
  if (actualiser) rafraichirCarteCreditsApi();
  try {
    const { r, data } = await appelCreditsApi({ action: 'credits-api', actualiser: actualiser === true });
    // Une réponse « ok » sans le détail des fournisseurs (route inattendue,
    // déploiement en cours) ne doit jamais atteindre l'affichage : elle le
    // ferait planter, et avec lui tout le Tableau de bord.
    if (!r.ok || !data.ok || !data.fournisseurs) throw new Error((data && data.error && data.error.message) || (data && data.indisponible ? 'base de données indisponible' : r.ok ? 'réponse inattendue' : 'HTTP ' + r.status));
    _creditsApi.etat = data;
    _creditsApi.erreur = '';
  } catch (e) {
    _creditsApi.erreur = (e && e.message) || 'erreur inconnue';
    console.warn('Crédits API indisponibles :', e);
  }
  _creditsApi.chargement = false;
  rafraichirCarteCreditsApi();
}

function basculerSaisieCredits(f) {
  _creditsApi.formOuvert = _creditsApi.formOuvert === f ? null : f;
  _creditsApi.formErreur = '';
  rafraichirCarteCreditsApi();
  const champ = document.getElementById('creditsSolde-' + f);
  if (champ) champ.focus();
}

function creditsLireNombre(id) {
  const el = document.getElementById(id);
  if (!el) return undefined;
  const brut = String(el.value || '').trim().replace(/\s/g, '').replace(',', '.');
  return brut === '' ? undefined : Number(brut);
}

async function enregistrerSoldeCredits(f) {
  const solde = creditsLireNombre('creditsSolde-' + f);
  const montrerErreur = (m) => {
    _creditsApi.formErreur = m;
    const el = document.getElementById('creditsFormErr-' + f);
    if (el) { el.textContent = m; el.style.display = 'block'; }
  };
  if (solde === undefined || !Number.isFinite(solde) || solde < 0) { montrerErreur('Entre le solde en dollars, par exemple 25,40.'); return; }
  const corps = { action: 'credits-api-solde', fournisseur: f, soldeUsd: solde };
  if (f === 'together') {
    const pi = creditsLireNombre('creditsPrixImage'), pv = creditsLireNombre('creditsPrixVideo');
    if ((pi !== undefined && !Number.isFinite(pi)) || (pv !== undefined && !Number.isFinite(pv))) { montrerErreur('Les prix doivent être des nombres, par exemple 0,04.'); return; }
    if (pi !== undefined) corps.prixImageUsd = pi;
    if (pv !== undefined) corps.prixVideoUsd = pv;
  }
  const btn = document.getElementById('creditsEnregistrer-' + f);
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try {
    const { r, data } = await appelCreditsApi(corps);
    if (!r.ok || data.ok === false) throw new Error((data && data.error && data.error.message) || 'HTTP ' + r.status);
    if (data.fournisseurs) _creditsApi.etat = data;
    _creditsApi.formOuvert = null;
    _creditsApi.formErreur = '';
    rafraichirCarteCreditsApi();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer mon solde'; }
    montrerErreur((e && e.message) || 'Enregistrement impossible.');
  }
}

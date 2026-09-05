// ═══════════════════════════════════════════════════════════
//  PREUVE SOCIALE, uniquement des chiffres VRAIS
//
//  Ce module affichait auparavant trois messages entièrement INVENTÉS :
//    - « 348 créateurs utilisent Scriptura », un compteur qui partait d'une
//      base codée en dur et montait de +1 à chaque affichage, mémorisé dans
//      le localStorage DU VISITEUR (donc un chiffre différent par appareil,
//      qui ne mesurait rien) ;
//    - « Untel vient de s'abonner », un prénom tiré au hasard dans une liste
//      d'une centaine de noms écrite dans le code ;
//    - « Un créateur vient de générer un script il y a 3 min », avec un
//      délai lui aussi tiré au sort.
//
//  Pourquoi c'était le risque le plus sérieux du produit : Scriptura se vend
//  sur la CRÉDIBILITÉ (des scores calculés par le code, jamais notés par
//  l'IA, justement pour qu'on puisse les vérifier). Or n'importe qui ouvrant
//  les outils de développement de son navigateur voyait ces chiffres
//  fabriqués en trente secondes. Un créateur qui découvre ça ne se dit pas
//  « la preuve sociale est exagérée », il se dit « les scores aussi sont
//  peut-être inventés ». Ça contredisait l'argument de vente central.
//
//  Désormais : les chiffres viennent des vraies générations enregistrées
//  (voir handlePreuveSociale, api/data.js), ou RIEN ne s'affiche.
//
//  RÈGLE DE FOND, celle qui rend ce module honnête : en dessous des seuils
//  ci-dessous, on n'affiche PAS. Pas de repli, pas de message de secours,
//  pas de « rejoins les premiers créateurs ». Une preuve sociale absente ne
//  coûte qu'une occasion manquée ; une preuve sociale fausse coûte la
//  confiance, et elle ne revient pas.
// ═══════════════════════════════════════════════════════════

// Un chiffre trop petit ne prouve rien et se retourne contre le produit :
// « 2 créateurs cette semaine » est un argument CONTRE l'abonnement. Sous ces
// seuils, on se tait, et c'est très bien : ça se remettra à parler tout seul
// quand ce sera vrai, sans qu'on ait à retoucher au code.
const PREUVE_MIN_CREATEURS = 5;
const PREUVE_MIN_GENERATIONS = 20;

let _preuveMessages = [];
let _preuveIndex = 0;

// Construit la liste des messages AFFICHABLES à partir des vrais chiffres.
// Chaque message n'entre dans la liste que s'il a franchi son seuil : une
// liste vide veut dire qu'on n'a rien d'honnête à dire, et le module reste
// alors silencieux pour toute la visite.
function construirePreuveMessages(donnees) {
  const messages = [];
  if (!donnees) return messages;
  const createurs = parseInt(donnees.creatoursSemaine, 10) || 0;
  const generations = parseInt(donnees.generationsSemaine, 10) || 0;
  const nb = (n) => (typeof formaterNombre === 'function' ? formaterNombre(n) : String(n));

  if (createurs >= PREUVE_MIN_CREATEURS) {
    messages.push('<strong>' + nb(createurs) + '</strong> créateurs ont utilisé Scriptura cette semaine');
  }
  if (generations >= PREUVE_MIN_GENERATIONS) {
    messages.push('<strong>' + nb(generations) + '</strong> contenus générés cette semaine');
  }
  return messages;
}

function showSocialNotif() {
  const el = document.getElementById('socialNotif');
  if (!el || !_preuveMessages.length) return;
  el.innerHTML = '<span class="social-dot"></span>' + _preuveMessages[_preuveIndex % _preuveMessages.length];
  _preuveIndex++;
  el.classList.add('visible');
  // Disparaît après 10s, un clic ne l'affecte pas.
  setTimeout(() => { el.classList.remove('visible'); }, 10000);
}

// Les chiffres sont lus UNE SEULE FOIS par visite, jamais à chaque
// affichage : ils bougent à l'échelle de la semaine, les rafraîchir toutes
// les 40 secondes ne changerait rien à ce que voit le visiteur et
// multiplierait les requêtes pour rien.
async function startSocialProof() {
  try {
    const r = await fetch('/api/data?resource=preuveSociale');
    _preuveMessages = construirePreuveMessages(await r.json());
  } catch (e) {
    _preuveMessages = []; // panne : on se tait, on n'invente pas
  }
  // Rien d'honnête à dire : aucun minuteur n'est même armé, la notification
  // ne s'affichera pas une seule fois de la visite.
  if (!_preuveMessages.length) return;
  setTimeout(() => {
    showSocialNotif();
    setInterval(showSocialNotif, 40000); // 10s visible + 30s de pause
  }, 5000);
}

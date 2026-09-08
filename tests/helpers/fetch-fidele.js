// ═══════════════════════════════════════════════════════════
//  UN FAUX `fetch` QUI SE COMPORTE COMME UN VRAI
//
//  POURQUOI CE FICHIER EXISTE, et c'est un vrai enseignement de session : en
//  corrigeant api/montage-media.js pour qu'il ne fasse plus confiance à
//  `rep.json()` (une passerelle en panne répond du HTML, et le créateur lisait
//  « Unexpected token '<' »), sept tests sont tombés d'un coup.
//
//  Pas parce que le correctif était mauvais : parce que les mocks renvoyaient
//  `{ ok: true, json: async () => ... }`, un objet qui n'a PAS de `.text()`,
//  alors qu'une vraie réponse fetch en a toujours une. Les tests validaient
//  donc du code qui ne pouvait fonctionner qu'avec eux.
//
//  UN MOCK INFIDÈLE EST PIRE QU'UN TEST MANQUANT : il donne une confiance que
//  rien ne justifie, et il INTERDIT les corrections qu'il ne comprend pas.
//  Celui-ci dérive `text()` du même corps que `json()`, ajoute `status`, et
//  laisse tout le reste passer tel quel.
// ═══════════════════════════════════════════════════════════

// Complète UNE réponse simulée. Ne remplace jamais ce que le test a fourni
// explicitement : un test qui veut un corps illisible (du HTML, du vide)
// donne son propre `text` et il est respecté.
function reponseFidele(rep) {
  if (!rep || typeof rep !== 'object') return rep;

  // DÉJÀ FIDÈLE : on ne touche à rien. C'est le cas d'une VRAIE réponse fetch,
  // et il est vital de la laisser passer intacte : la copier avec `{ ...rep }`
  // perdrait toutes ses méthodes, qui vivent sur son prototype. Un test qui
  // restaure le vrai fetch doit retrouver le vrai fetch.
  if (typeof rep.text === 'function' && typeof rep.status === 'number') return rep;

  const complete = { ...rep };

  if (typeof complete.status !== 'number') {
    // Un vrai fetch porte toujours un statut. Sans lui, un code qui distingue
    // une panne passagère (5xx, à réessayer) d'un refus définitif ne peut pas
    // être testé du tout.
    complete.status = complete.ok === false ? 500 : 200;
  }

  if (typeof complete.text !== 'function' && typeof rep.json === 'function') {
    complete.text = async () => {
      const corps = await rep.json();
      return corps === undefined ? '' : JSON.stringify(corps);
    };
  }

  return complete;
}

// Enveloppe le gestionnaire de fetch d'un test. Usage :
//   global.fetch = fetchFidele(async (url, opts) => { ... });
function fetchFidele(gestionnaire) {
  return async (...args) => reponseFidele(await gestionnaire(...args));
}

// À appeler UNE FOIS en haut d'un fichier de test qui pose ses propres mocks
// de fetch. Toute affectation ultérieure de `global.fetch` est enveloppée
// automatiquement, y compris celles écrites dans le fichier avant cet appel :
// ça évite de réécrire une à une dix-huit fonctions fléchées, et surtout ça
// couvre les mocks qui seront ajoutés demain sans que personne y pense.
//
// La restauration du vrai fetch en fin de test reste sûre : reponseFidele rend
// une vraie réponse telle quelle (voir la garde ci-dessus).
function rendreLesMocksFideles() {
  const deja = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  if (deja && deja.get) return;   // déjà installé, ne pas empiler
  let actuel = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    get() { return actuel; },
    set(v) { actuel = typeof v === 'function' ? fetchFidele(v) : v; }
  });
}

module.exports = { reponseFidele, fetchFidele, rendreLesMocksFideles };

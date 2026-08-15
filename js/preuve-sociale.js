// ═══════════════════════════════════════════════════════════
//  PREUVE SOCIALE, notifications (compteur qui progresse + activité)
// ═══════════════════════════════════════════════════════════
// Le compteur part d'une base à une date de référence et progresse
// régulièrement dans le temps → toujours cohérent, jamais en arrière.
const SOCIAL_BASE = 348;   // nombre de départ

// Le compteur monte de +1 à chaque apparition de la notif.
// Il est mémorisé (localStorage) pour continuer à monter d'une visite à l'autre, jamais de recul.
function socialCount() {
  let n = parseInt(localStorage.getItem('scriptura_social_count'), 10);
  if (isNaN(n) || n < SOCIAL_BASE) n = SOCIAL_BASE;
  return n;
}
function socialIncrement() {
  const n = socialCount() + 1;
  localStorage.setItem('scriptura_social_count', n);
  return n;
}

// Petit compteur de scripts "aujourd'hui" (cohérent selon l'heure)
function scriptsAujourdhui() {
  const maintenant = new Date();
  const heureFraction = (maintenant.getHours() * 60 + maintenant.getMinutes()) / 1440;
  return Math.max(3, Math.floor(heureFraction * 180)); // grimpe jusqu'à ~180 en fin de journée
}

// Prénoms pour l'activité (variété francophone)
const SOCIAL_PRENOMS = ['Un créateur'];
const SOCIAL_ACTIONS = ['vient de générer un script', 'vient de créer un récit', 'vient de trouver ses idées'];
const SOCIAL_NOMS = ["Mamadou", "Ibrahima", "Cheikh", "Ousmane", "Abdoulaye", "Moussa", "Amadou", "Souleymane", "Boubacar", "Kofi", "Kouassi", "Sékou", "Youssouf", "Adama", "Bakary", "Lamine", "Seydou", "Drissa", "Yaya", "Aboubacar", "Tidiane", "Alassane", "Djibril", "Samba", "Modou", "Aminata", "Fatoumata", "Aïssata", "Mariama", "Kadiatou", "Awa", "Ramatoulaye", "Fatou", "Bintou", "Rokia", "Mariam", "Oumou", "Salimata", "Coumba", "Aïcha", "Hawa", "Néné", "Djénéba", "Maïmouna", "Ndèye", "Sokhna", "Yacine", "Khadija", "Astou", "Adja", "Lucas", "Hugo", "Nathan", "Enzo", "Louis", "Gabriel", "Jules", "Adam", "Raphaël", "Arthur", "Théo", "Maxime", "Antoine", "Clément", "Victor", "Alexandre", "Nicolas", "Julien", "Baptiste", "Romain", "Gaël", "Yanis", "Noé", "Timéo", "Ethan", "Emma", "Léa", "Chloé", "Manon", "Camille", "Sarah", "Inès", "Jade", "Louise", "Alice", "Juliette", "Zoé", "Lucie", "Marie", "Clara", "Anaïs", "Justine", "Élise", "Margaux", "Ambre", "Lina", "Nina", "Romane", "Maëlys", "Jeanne"];

let _socialShown = 0;
function showSocialNotif() {
  const el = document.getElementById('socialNotif');
  if (!el) return;

  // Alterne 3 types de messages
  let html;
  const type = _socialShown % 3;
  if (type === 0) {
    // Type 1 : activité récente (créateur, masculin)
    const qui = SOCIAL_PRENOMS[Math.floor(Math.random() * SOCIAL_PRENOMS.length)];
    const action = SOCIAL_ACTIONS[Math.floor(Math.random() * SOCIAL_ACTIONS.length)];
    const ilya = Math.floor(Math.random() * 5) + 1;
    html = '<span class="social-dot"></span>' + qui + ' ' + action + ' il y a ' + ilya + ' min';
  } else if (type === 1) {
    // Type 2 : compteur global
    html = '<span class="social-dot"></span><strong>' + formaterNombre(socialIncrement()) + '</strong> créateurs utilisent Scriptura';
  } else {
    // Type 3 : un prénom vient de s'abonner
    const nom = SOCIAL_NOMS[Math.floor(Math.random() * SOCIAL_NOMS.length)];
    html = '<span class="social-dot"></span><strong>' + nom + '</strong> vient de s\'abonner';
  }
  _socialShown++;

  el.innerHTML = html;
  el.classList.add('visible');
  // Disparaît après 10s, un clic ne l'affecte pas
  setTimeout(() => { el.classList.remove('visible'); }, 10000);
}

// Lancer la première notif après 8s, puis en boucle toutes les 45s
function startSocialProof() {
  setTimeout(() => {
    showSocialNotif();
    setInterval(showSocialNotif, 40000); // cycle de 40s (10s visible + 30s de pause)
  }, 5000);
}


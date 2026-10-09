// Publie les tests en échec en ANNOTATIONS GitHub Actions (::error::).
//   node tests/helpers/annoter-echecs-ci.js resultat.tap
// Appelé par .github/workflows/tests.yml, étape « Résumé des échecs ».
//
// Pourquoi : le journal brut d'un job est servi hors de l'API GitHub et reste
// illisible depuis une session Claude Code distante. Deux CI rouges (27 sept.,
// 9 oct.) sont ainsi restées sans diagnostic. Les annotations, elles, se lisent
// par l'API (repos/{o}/{r}/check-runs/<id>/annotations).
// GitHub n'en garde que 10 par étape : 9 échecs détaillés, puis la liste
// complète des noms dans la dixième.
const fs = require('fs');

function lireEchecs(tap) {
  const echecs = [];
  let cur = null, dansErreur = false;
  for (const ligne of tap.split('\n')) {
    const m = ligne.match(/^not ok \d+ - (.*)$/);
    if (m) { cur = { nom: m[1], erreur: [] }; echecs.push(cur); dansErreur = false; continue; }
    if (/^(ok|not ok) /.test(ligne)) { cur = null; continue; }
    if (!cur) continue;
    const e = ligne.match(/^ {2}error: (.*)$/);
    if (e) {
      dansErreur = true;
      const val = e[1].replace(/^\|-?$/, '').replace(/^'(.*)'$/, '$1');
      if (val) cur.erreur.push(val);
      continue;
    }
    if (dansErreur && /^ {4}/.test(ligne)) { cur.erreur.push(ligne.trim()); continue; }
    if (/^ {2}(\S+:|\.\.\.)/.test(ligne)) dansErreur = false;
  }
  return echecs;
}

const echapperMessage = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const echapperPropriete = (s) => echapperMessage(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

function annotations(echecs) {
  const out = echecs.slice(0, 9).map(({ nom, erreur }) =>
    `::error title=${echapperPropriete('Test en échec : ' + nom).slice(0, 250)}::${echapperMessage((erreur.join(' / ') || 'voir le journal').slice(0, 900))}`);
  if (echecs.length) out.push(`::error title=${echecs.length} test(s) en échec%2C liste complète::${echapperMessage(echecs.map(e => e.nom).join('\n'))}`);
  return out;
}

if (require.main === module) {
  const fichier = process.argv[2] || 'resultat.tap';
  if (!fs.existsSync(fichier)) process.exit(0);
  for (const l of annotations(lireEchecs(fs.readFileSync(fichier, 'utf8')))) console.log(l);
}

module.exports = { lireEchecs, annotations };

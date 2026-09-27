// Petit serveur statique en Node pur (aucune dépendance), pour servir la
// racine du dépôt pendant les tests, exactement comme `python3 -m http.server`
// utilisé manuellement pendant le développement. Évite de supposer que
// python3 est disponible dans l'environnement CI.
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// Démarre le serveur sur un port libre choisi par l'OS (0), retourne son URL
// de base et une fonction pour l'arrêter. `demarrerServeur` est appelé une
// fois par fichier de test (voir tests/*.test.js), jamais partagé entre
// fichiers, pour que les tests restent indépendants et parallélisables.
function demarrerServeur() {
  return new Promise((resolve, reject) => {
    const serveur = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const cheminDemande = urlPath === '/' ? '/index.html' : urlPath;
      const cheminAbsolu = path.normalize(path.join(RACINE, cheminDemande));
      // Empêche de sortir de la racine du dépôt (../, etc.).
      if (!cheminAbsolu.startsWith(RACINE)) {
        res.writeHead(403); res.end('Interdit'); return;
      }
      fs.readFile(cheminAbsolu, (err, contenu) => {
        if (err) {
          // Repli SPA (même règle que "rewrites" dans vercel.json, voir
          // js/app.js ROUTES_PAGES / js/navigation.js synchroniserAdresseEcran) :
          // un fichier RÉEL (js/css/assets/api) garde toujours la priorité
          // (déjà géré ci-dessus, on n'atteint ce repli QUE s'il n'existe
          // pas) ; tout le reste retombe sur index.html, jamais un 404 brut -
          // sans ça, un test qui recharge la page après une navigation
          // interne (l'adresse a changé, voir history.replaceState) se
          // retrouve sur une page vide, aucun script chargé, exactement le
          // symptôme qui a révélé ce manque (ouvrirTableauDeBord is not
          // defined après un reload sur /tableau-de-bord).
          const cheminIndex = path.join(RACINE, 'index.html');
          fs.readFile(cheminIndex, (err2, contenuIndex) => {
            if (err2) { res.writeHead(404); res.end('Introuvable : ' + cheminDemande); return; }
            res.writeHead(200, { 'Content-Type': TYPES_MIME['.html'] });
            res.end(contenuIndex);
          });
          return;
        }
        const ext = path.extname(cheminAbsolu);
        res.writeHead(200, { 'Content-Type': TYPES_MIME[ext] || 'application/octet-stream' });
        res.end(contenu);
      });
    });
    serveur.on('error', reject);
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address();
      resolve({
        baseUrl: 'http://127.0.0.1:' + port,
        arreter: () => new Promise(r => serveur.close(r))
      });
    });
  });
}

module.exports = { demarrerServeur };

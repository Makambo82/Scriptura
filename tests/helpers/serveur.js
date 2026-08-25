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
        if (err) { res.writeHead(404); res.end('Introuvable : ' + cheminDemande); return; }
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

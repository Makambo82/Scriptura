// Trouvé en creusant le code (piste "autre idée" proposée au propriétaire) :
// le logo du footer ("Une création MAKAMBO") était encodé en base64
// directement dans index.html, à pleine résolution photo (1948×3464px,
// 468 Ko en base64) pour un badge affiché à 36×36px. Chaque visiteur
// téléchargeait ça au chargement de la page, un vrai coût en data mobile
// pour un public qui paie en Mobile Money. Extrait en fichier statique
// (img/makambo.jpg, redimensionné et compressé, 2,6 Ko) servi via <img src>
// normal, avec mise en cache navigateur, au lieu d'un blob inline
// retéléchargé à chaque chargement de page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('logo du footer : fichier statique léger, jamais réintégré en base64 dans index.html', () => {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.ok(!html.includes('data:image/jpeg;base64,'), 'aucune image ne doit être ré-embarquée en base64 dans index.html');
  assert.ok(html.includes('img/makambo.jpg'), 'le footer doit référencer le fichier statique');

  const imgPath = path.join(__dirname, '..', 'img', 'makambo.jpg');
  assert.ok(fs.existsSync(imgPath), 'img/makambo.jpg doit exister');
  const taille = fs.statSync(imgPath).size;
  assert.ok(taille < 20 * 1024, 'le logo doit rester léger (moins de 20 Ko), taille actuelle : ' + taille + ' octets');
});

// Lance Chromium headless pour les tests. En local, dans cet environnement
// de développement, un Chromium est déjà pré-installé à un chemin fixe (voir
// CLAUDE.md) : on le préfère quand il existe, pour ne rien télécharger. En
// CI (voir .github/workflows/tests.yml, qui installe son propre Chromium au
// début du job), ce chemin n'existe pas : Playwright résout alors le
// navigateur normalement.
const { chromium } = require('playwright-core');
const fs = require('fs');

const path = require('path');

// Le numéro de version du Chromium pré-installé CHANGE d'un environnement à
// l'autre (chromium-1194 jusqu'en octobre, chromium-1243 en novembre, avec
// un dossier chrome-linux puis chrome-linux64). Un chemin figé faisait
// échouer TOUS les tests navigateur en local dès que l'image changeait, et
// le repli de Playwright cherchait encore une autre version absente. On
// cherche donc n'importe quel Chromium sous /opt/pw-browsers, le plus récent
// d'abord. CHROMIUM_PATH permet de forcer un chemin précis.
function cheminChromiumLocal() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const racine = '/opt/pw-browsers';
  if (!fs.existsSync(racine)) return null;
  const dossiers = fs.readdirSync(racine)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dossiers) {
    for (const sous of ['chrome-linux64', 'chrome-linux']) {
      const exe = path.join(racine, d, sous, 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}
const CHEMIN_CHROMIUM_LOCAL = cheminChromiumLocal();

async function lancerNavigateur() {
  const options = CHEMIN_CHROMIUM_LOCAL ? { executablePath: CHEMIN_CHROMIUM_LOCAL } : {};
  return chromium.launch(options);
}

// Variante pour les tests qui ouvrent le MICRO (prise de voix off). Chromium
// fournit un micro factice qui émet un bip continu, et accepte la demande
// d'autorisation sans interaction : sans ces deux drapeaux, getUserMedia reste
// bloqué indéfiniment en headless et le test expire au lieu d'échouer
// clairement.
async function lancerNavigateurAvecMicro() {
  const options = CHEMIN_CHROMIUM_LOCAL ? { executablePath: CHEMIN_CHROMIUM_LOCAL } : {};
  options.args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  return chromium.launch(options);
}

module.exports = { lancerNavigateur, lancerNavigateurAvecMicro };

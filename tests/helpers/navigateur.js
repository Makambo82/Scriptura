// Lance Chromium headless pour les tests. En local, dans cet environnement
// de développement, un Chromium est déjà pré-installé à un chemin fixe (voir
// CLAUDE.md) : on le préfère quand il existe, pour ne rien télécharger. En
// CI (voir .github/workflows/tests.yml, qui installe son propre Chromium au
// début du job), ce chemin n'existe pas : Playwright résout alors le
// navigateur normalement.
const { chromium } = require('playwright-core');
const fs = require('fs');

const CHEMIN_CHROMIUM_LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function lancerNavigateur() {
  const options = fs.existsSync(CHEMIN_CHROMIUM_LOCAL) ? { executablePath: CHEMIN_CHROMIUM_LOCAL } : {};
  return chromium.launch(options);
}

module.exports = { lancerNavigateur };

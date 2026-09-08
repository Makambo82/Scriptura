// VRAI INCIDENT, 8 septembre : trois commits d'affilée sont partis en
// production avec une CI ROUGE, alors que la suite locale était verte à
// 574/574. La cause n'était dans aucun test : render-service/server.js
// commence par `require('express')`, express vit dans
// render-service/node_modules, et node_modules/ est ignoré par git. Ma copie
// de travail l'avait, le runner GitHub non. Les fichiers de test qui chargent
// le service ne se chargeaient donc même pas là-bas.
//
// C'est le pire genre de défaut : INVISIBLE en local, par construction. Et il
// se voyait à peine sur la CI, où il ressemblait à un simple « 1 test qui
// échoue » au milieu de 568, sans dire lequel.
//
// CE TEST NE VÉRIFIE PAS QU'EXPRESS EST INSTALLÉ (ce serait circulaire : il
// échouerait alors exactement comme les autres, sans expliquer pourquoi). Il
// vérifie que le WORKFLOW installe les dépendances du service de rendu tant
// que des tests en dépendent, et il le dit en clair.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');

test('si un test charge le service de rendu, la CI installe ses dépendances', () => {
  const dependants = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => /require\(\s*['"]\.\.\/render-service\//.test(
      fs.readFileSync(path.join(__dirname, f), 'utf8')));

  if (!dependants.length) return; // plus aucun test n'en dépend : rien à exiger

  const workflow = fs.readFileSync(
    path.join(RACINE, '.github/workflows/tests.yml'), 'utf8');

  // On exige l'INSTALLATION, pas une ligne de commande au caractère près : la
  // vraie règle est « les dépendances du service sont là sur la CI ». Fixer la
  // commande exacte a fait tomber ce test à l'ajout de --ignore-scripts, qui
  // corrigeait pourtant un vrai échec de CI (voir le workflow). Un test qui
  // refuse une amélioration de la chose qu'il protège est trop serré.
  assert.match(workflow, /npm ci(?:\s+--[\w-]+)*\s+--prefix render-service/,
    'REGRESSION : ' + dependants.length + ' fichier(s) de test chargent '
    + 'render-service/server.js (' + dependants.join(', ') + '), mais le workflow '
    + 'n\'installe plus les dépendances du service. Or server.js commence par '
    + 'require(\'express\'), qui vit dans render-service/node_modules, ignoré par git. '
    + 'Ces tests ne se chargeront PAS sur la CI, et le défaut est invisible en local '
    + 'puisque le dossier existe sur nos machines. C\'est exactement ce qui a fait '
    + 'partir trois commits en production avec une CI rouge le 8 septembre.');
});

test('le service de rendu déclare bien les dépendances qu\'il exige', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(RACINE, 'render-service/package.json'), 'utf8'));
  const source = fs.readFileSync(
    path.join(RACINE, 'render-service/server.js'), 'utf8');

  // Modules chargés par le service, hors modules natifs de Node.
  const natifs = new Set(['child_process', 'fs', 'path', 'os', 'crypto', 'http',
    'https', 'url', 'stream', 'util', 'events', 'zlib', 'buffer']);
  const requis = new Set();
  const motif = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = motif.exec(source))) {
    const nom = m[1];
    if (nom.startsWith('.') || nom.startsWith('node:') || natifs.has(nom)) continue;
    requis.add(nom.split('/')[0]);
  }

  const declares = Object.keys(pkg.dependencies || {});
  for (const nom of requis) {
    assert.ok(declares.includes(nom),
      'REGRESSION : render-service/server.js charge « ' + nom + ' » sans que '
      + 'render-service/package.json le déclare. Un `npm ci` propre, ici comme sur '
      + 'l\'hôte de production, ne l\'installerait pas : le service ne démarrerait '
      + 'même pas, et le rendu vidéo tomberait entièrement. Déclarées : '
      + declares.join(', '));
  }

  assert.ok(fs.existsSync(path.join(RACINE, 'render-service/package-lock.json')),
    'REGRESSION : render-service/package-lock.json a disparu. `npm ci` refuse de '
    + 'tourner sans lui, donc l\'étape d\'installation de la CI échouerait.');
});

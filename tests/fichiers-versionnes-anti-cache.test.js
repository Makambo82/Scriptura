// Vrai incident de production (retour propriétaire, 5 septembre) : après un
// déploiement, un abonné Pro ne voyait pas les boutons de montage tout juste
// ouverts à son plan, alors qu'un compte Creator connecté quelques minutes
// plus tôt les voyait. Le code ne fait pourtant AUCUNE différence entre les
// deux plans (vérifié : mêmes valeurs de peutMonterVideo(), même classe
// posée, même affichage). La différence venait de ce que chaque session avait
// réellement chargé : la session fraîchement connectée avait rechargé les
// fichiers, l'autre tournait encore sur des js/*.js et css/style.css gardés
// en cache par le navigateur.
//
// C'est le pire genre de panne : le navigateur mélange de l'ANCIEN et du
// NOUVEAU (ici un js/api.js à jour avec un js/app.js ou un css/style.css
// périmé), donc du code neuf appelle des choses qui n'existent pas encore,
// ou pose une classe dont la règle d'affichage manque. Rien ne casse
// bruyamment, la fonctionnalité est juste absente, et c'est indétectable
// depuis un téléphone.
//
// La parade : chaque fichier local porte un ?v=... dans son URL. index.html
// est, lui, toujours revalidé (voir vercel.json, max-age=0 must-revalidate),
// donc changer ce numéro suffit à forcer le téléchargement de TOUS les
// fichiers d'un coup, sans jamais laisser un mélange.
//
// Ce test ne vérifie pas QUELLE version est utilisée (elle change à chaque
// livraison), il verrouille le MÉCANISME : aucun fichier local sans version,
// et une seule et même version pour tous, sinon le mélange redevient possible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Uniquement les fichiers SERVIS PAR NOUS (js/... et css/...). Les scripts de
// CDN externes sont déjà versionnés dans leur propre URL (@2, @2.5.1...) et
// ne nous appartiennent pas.
function referencesLocales() {
  const refs = [];
  const reScript = /<script\s+src="(js\/[^"]+)"/g;
  const reStyle = /<link\s+rel="stylesheet"\s+href="(css\/[^"]+)"/g;
  let m;
  while ((m = reScript.exec(HTML))) refs.push(m[1]);
  while ((m = reStyle.exec(HTML))) refs.push(m[1]);
  return refs;
}

test('tout fichier local de index.html porte un numéro de version anti-cache', () => {
  const refs = referencesLocales();
  assert.ok(refs.length >= 20, 'les références locales doivent être trouvées : ' + refs.length);
  const sansVersion = refs.filter(r => !/\?v=[^"]+$/.test(r));
  assert.deepEqual(sansVersion, [],
    'REGRESSION : ces fichiers seraient servis depuis le cache après un déploiement, '
    + 'donc mélangés avec des fichiers à jour : ' + JSON.stringify(sansVersion));
});

test('tous les fichiers partagent LA MÊME version, sinon le mélange reste possible', () => {
  const versions = Array.from(new Set(referencesLocales().map(r => (r.match(/\?v=([^"]+)$/) || [])[1])));
  assert.equal(versions.length, 1,
    'une seule version doit être utilisée partout, sinon un fichier peut rester en arrière : '
    + JSON.stringify(versions));
  assert.ok(versions[0] && versions[0].length >= 3, 'la version doit être renseignée : ' + versions[0]);
});

test('le CSS et le JS sont bien tous les deux versionnés (le CSS seul suffisait à casser la fonctionnalité)', () => {
  const refs = referencesLocales();
  assert.ok(refs.some(r => r.startsWith('css/')), 'la feuille de style doit être versionnée');
  assert.ok(refs.filter(r => r.startsWith('js/')).length >= 20, 'tous les scripts doivent être versionnés');
});

// Retour du propriétaire, capture à l'appui : « la taille des textes de
// boutons n'est pas la même partout, je parle des boutons à l'intérieur des
// modes », avec la rangée du montage donnée comme RÉFÉRENCE.
//
// Il avait raison, et c'était pire que ce que sa capture montrait. Mesuré
// dans le navigateur sur douze écrans de mode, les textes de boutons allaient
// de 0.52rem (.btn-actualiser) à 0.84rem (.car-format-btn) : seize tailles
// différentes, réglées une par une au fil des livraisons, chacune raisonnable
// dans son coin et l'ensemble incohérent.
//
// CE TEST NE COMPARE PAS À UNE VALEUR ÉCRITE EN DUR, il compare les boutons
// ENTRE EUX. C'est ce qui compte, et c'est ce qui survivra : le jour où on
// décidera que la référence est 0.60rem, il suffira que tous suivent. Un test
// écrit sur « 9.92px » aurait fallu le réécrire, et on l'aurait réécrit sans
// vérifier que tous avaient bougé.
//
// IL ATTRAPE AUSSI LE PIÈGE DE SPÉCIFICITÉ qui m'a occupé en écrivant la
// règle : .btn-regenerate.mini et .aw-nav button ont une spécificité
// supérieure à un sélecteur de classe simple. Un bloc groupé écrit sans eux
// perdrait en silence, et ces boutons-là resteraient à l'ancienne taille au
// milieu des autres.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

// Les écrans de MODE, pas l'accueil : c'est le périmètre qu'il a nommé.
const MODES = [
  ['script', () => { chooseMode('script'); if (typeof showStep === 'function') showStep(2); }],
  ['idées', () => chooseMode('ideas')],
  ['récit', () => chooseMode('story')],
  ['carrousel', () => chooseMode('carrousel')],
  ['diagnostic', () => chooseMode('audit')],
  ['historique', () => openHistory()],
  ['montage manuel', () => ouvrirMontageManuelAccueil()],
  ['outils TikTok', () => ouvrirOutilsTikTok()],
  ['storyboard seul', () => openStoryboardSeul()],
  ['montage storyboard', () => ouvrirMontage([{ text: 'Un plan.', visuel: 'décor' }], null)]
];

// Ce qui n'est PAS « un bouton à l'intérieur d'un mode », et pourquoi. Ces
// zones sont communes à toute l'app ou ont leur propre échelle.
//
// LES SÉLECTEURS SONT VÉRIFIÉS DANS index.html, pas devinés : mon premier jet
// écartait « .app-footer » et « .top-bar », qui n'existent pas. Quatre-vingts
// liens de pied de page entraient donc dans la mesure et devenaient la taille
// « majoritaire », faisant échouer le test sur une app pourtant correcte. Un
// filtre qui se trompe de nom ne proteste pas, il laisse tout passer.
const HORS_PERIMETRE = ['nav', 'footer', '.sidebar', '.plans-modal',
  '.paywall', '.modal', '#homePage', '.pricing-jeton'];

// Et ce qui n'est pas un bouton du tout, malgré la balise : le déclencheur de
// menu déroulant est un <button> (voir initCustomSelect, js/ui.js) mais c'est
// un CHAMP, qui affiche une valeur choisie. Il a la taille d'un champ, 1rem,
// et c'est voulu.
const PAS_DES_BOUTONS = ['custom-select-trigger'];

async function ouvrirApp(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(async () => { await document.fonts.ready; });
  return page;
}

async function allerA(page, ouvrir) {
  await page.evaluate(() => {
    unlocked = true;
    localStorage.setItem('scriptura_code', 'CELINE7F2A');
    localStorage.setItem('scriptura_unlocked', 'true');
    document.body.classList.add('is-unlocked', 'peut-monter-video');
    if (typeof closePlans === 'function') closePlans();
    if (typeof goHome === 'function') goHome();
  });
  await page.waitForTimeout(200);
  await page.evaluate('(' + ouvrir.toString() + ')()');
  await page.waitForTimeout(400);
}

async function releverBoutons(page, hors, pasBoutons) {
  return page.evaluate(({ hors, pasBoutons }) => {
    const out = [];
    document.querySelectorAll('button, label[class*="btn"], .ds-scope-btn').forEach(b => {
      if (b.offsetParent === null) return;
      if (b.getBoundingClientRect().width < 2) return;
      if (hors.some(s => b.closest(s))) return;
      if (pasBoutons.some(c => b.classList.contains(c))) return;
      const txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
      // Un bouton à ICÔNE SEULE n'a pas de texte à dimensionner : sa
      // font-size règle un pictogramme, l'aligner le rendrait minuscule.
      if (!/\p{L}{2}/u.test(txt)) return;
      const s = getComputedStyle(b);
      out.push({ cls: (b.className || b.tagName).toString().trim().slice(0, 40),
        txt: txt.slice(0, 26), px: s.fontSize, esp: s.letterSpacing });
    });
    return out;
  }, { hors, pasBoutons });
}

test('tous les boutons des modes ont la MÊME taille de texte', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const tous = [];
    for (const [nom, ouvrir] of MODES) {
      await allerA(page, ouvrir);
      (await releverBoutons(page, HORS_PERIMETRE, PAS_DES_BOUTONS)).forEach(b => tous.push({ ...b, ecran: nom }));
    }

    // Un test qui ne trouve rien passerait au vert sans rien prouver.
    assert.ok(tous.length >= 15,
      'REGRESSION : seulement ' + tous.length + ' boutons trouvés sur ' + MODES.length
      + ' écrans de mode. Les écrans ou les classes ont dû changer : ce test ne vérifie plus '
      + 'rien, en restant vert.');

    const tailles = [...new Set(tous.map(b => b.px))];
    if (tailles.length > 1) {
      // On nomme la taille MAJORITAIRE et ceux qui s'en écartent : le message
      // doit dire quoi corriger, pas seulement que quelque chose cloche.
      const compte = {};
      tous.forEach(b => { compte[b.px] = (compte[b.px] || 0) + 1; });
      const majoritaire = Object.keys(compte).sort((a, b) => compte[b] - compte[a])[0];
      const ecarts = [...new Map(tous.filter(b => b.px !== majoritaire)
        .map(b => [b.cls, b])).values()]
        .map(b => '  ' + b.px.padEnd(9) + b.cls + ' · « ' + b.txt + ' » [' + b.ecran + ']');
      assert.fail(
        'REGRESSION : les boutons des modes n\'ont plus tous la même taille de texte. Le '
        + 'propriétaire a donné la rangée du montage comme référence, et l\'app en était à seize '
        + 'tailles différentes avant d\'être unifiée. Majoritaire : ' + majoritaire
        + ' (' + compte[majoritaire] + ' boutons). S\'en écartent :\n' + ecarts.join('\n'));
    }
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('et le même espacement, sauf le bouton retour qui est en minuscules', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const tous = [];
    for (const [nom, ouvrir] of MODES) {
      await allerA(page, ouvrir);
      (await releverBoutons(page, HORS_PERIMETRE, PAS_DES_BOUTONS)).forEach(b => tous.push({ ...b, ecran: nom }));
    }

    // Une taille commune ne suffit pas à faire se ressembler deux boutons :
    // c'est le couple taille + espacement qui décide. Mesuré avant
    // unification : les espacements allaient de 0.06em à 0.16em.
    const capitales = tous.filter(b => !/btn-back/.test(b.cls));
    const espacements = [...new Set(capitales.map(b => b.esp))];

    assert.ok(capitales.length >= 12,
      'REGRESSION : seulement ' + capitales.length + ' boutons en capitales relevés. Ce test ne '
      + 'compare plus assez de choses pour prouver quoi que ce soit.');

    assert.equal(espacements.length, 1,
      'REGRESSION : les boutons des modes n\'ont plus le même espacement de lettres. Deux boutons '
      + 'de même taille mais d\'espacements différents ne se ressemblent toujours pas. Vu : '
      + espacements.join(', ') + '\n'
      + [...new Map(capitales.map(b => [b.cls, b])).values()]
        .map(b => '  ' + b.esp.padEnd(10) + b.cls + ' · « ' + b.txt + ' »').join('\n'));

    // Le bouton retour, lui, DOIT s'en écarter : il est le seul en minuscules
    // (décision du propriétaire), et les minuscules n'ont pas besoin de
    // tracking. Il partage en revanche la taille commune.
    const retour = tous.find(b => /btn-back/.test(b.cls));
    assert.ok(retour, 'le bouton retour doit être visible sur au moins un mode');
    assert.notEqual(retour.esp, espacements[0],
      'REGRESSION : le bouton retour a reçu l\'espacement des boutons en capitales. Il est en '
      + 'minuscules, et espacer des minuscules les fait paraître délavées.');
    assert.equal(retour.px, capitales[0].px,
      'REGRESSION : le bouton retour n\'a plus la taille commune (' + retour.px + ' contre '
      + capitales[0].px + '). Seul son ESPACEMENT devait rester à part, pas sa taille.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// CE QUE LE BALAYAGE NE VOIT PAS, ET IL FAUT LE SAVOIR : il n'atteint que les
// écrans de FORMULAIRE, soit 9 des 30 classes alignées. Les boutons des écrans
// de RÉSULTAT (copier, partager, régénérer, outils d'historique, boutons de
// fenêtre) demandent d'avoir généré quelque chose, ce qu'un test ne fait pas.
//
// Ce troisième test couvre celles-là autrement : il lit la feuille de style et
// vérifie qu'AUCUNE règle placée APRÈS le bloc d'unification ne vient
// redéclarer une taille ou un espacement pour l'un de ces sélecteurs. C'est
// exactement la façon dont l'unification se déferait sans bruit : pas en
// modifiant le bloc, mais en ajoutant une règle plus bas, qui gagne par
// l'ordre du fichier.
test('aucune règle ajoutée plus bas ne défait l\'unification', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

  const repere = '── TAILLE DES BOUTONS DANS LES MODES ──';
  const i = css.indexOf(repere);
  assert.ok(i > 0,
    'REGRESSION : le bloc « ' + repere + ' » a disparu de css/style.css. C\'est lui qui donne '
    + 'leur taille commune à tous les boutons des modes.');

  // Les sélecteurs du bloc, lus dans le bloc lui-même plutôt que recopiés
  // ici : une liste recopiée finit toujours par diverger de la vraie.
  const bloc = css.slice(i, css.indexOf('}', css.indexOf('{', i)) + 1);
  const selecteurs = bloc.slice(bloc.lastIndexOf('*/') + 2, bloc.indexOf('{'))
    .split(',').map(s => s.trim()).filter(Boolean);

  assert.ok(selecteurs.length >= 25,
    'REGRESSION : le bloc ne liste plus que ' + selecteurs.length + ' sélecteurs. Des boutons '
    + 'ont dû en sortir et sont retournés à leur ancienne taille : ' + selecteurs.join(', '));

  // LE CONTRÔLE DU COMPLÉMENT, et c'est lui qui fait le vrai travail. Une
  // vérification de nombre ne suffit pas : retirer un sélecteur du bloc en
  // laissait 29 sur 30, le compte passait, et ce bouton-là repartait seul à
  // son ancienne taille. Vérifié, cette morsure-là ne mordait pas.
  //
  // On prend donc le problème par l'autre bout : TOUTE règle qui déclare une
  // taille de police pour un sélecteur de bouton doit être soit dans le bloc,
  // soit dans cette liste d'exclusions, chacune motivée. Il n'y a pas de
  // troisième possibilité, et un bouton nouvellement ajouté avec sa propre
  // taille tombera ici plutôt que de passer inaperçu.
  const HORS_UNIFICATION = {
    // Icône seule : la taille dimensionne un pictogramme, pas un texte.
    '.genimg-btn-icon': 'icône seule', '.hero-cta-arrow': 'icône seule',
    '#scrollTopBtn': 'icône seule', '.action-btn.icon-only': 'icône seule',
    '.btn-montage-icon': 'icône seule', '.nav-subscribe-btn .sidebar-icon': 'icône seule',
    // L'accueil a sa propre échelle, voulue plus grande.
    '.hero-cta-label': 'accueil', '.hero-mode-btn': 'accueil',
    '.hero-mode-btn.primary .mode-label': 'accueil',
    '.hero-mode-btn.primary .mode-desc': 'accueil',
    '.hero-mode-btn.audit .mode-label': 'accueil',
    '.hero-mode-btn.audit .mode-badge': 'accueil',
    '.hero-mode-btn .mode-badge.mode-badge-pro': 'accueil',
    '.example-cta': 'lien de l\'accueil', '.salutation-swap-menu button': 'menu de l\'accueil',
    // Communs à toute l'app, hors des modes.
    '.footer-link-btn': 'pied de page', '.footer-wa-btn': 'pied de page',
    '.nav-history-btn': 'barre du haut', '.nav-subscribe-cta': 'barre du haut',
    '.nav-generations-btn': 'barre du haut', '.sidebar-item': 'menu latéral',
    '.sidebar-compte': 'menu latéral', '.icon-btn': 'barre du haut',
    // Fenêtre d'abonnement, pas un mode.
    '.plan-btn': 'carte de tarif', '.plan-btn-creator': 'carte de tarif',
    '.plan-btn-pro': 'carte de tarif', '.plan-toggle-btn': 'carte de tarif',
    '.pack-btn': 'carte de tarif', '.pricing-jeton button': 'carte de tarif',
    // Cas particuliers assumés.
    '.serie-suggest-btn': 'une phrase entière, pas un libellé de bouton',
    '.custom-select-trigger': 'un champ, pas un bouton',
    '.montage-trigger-btn': 'pastille flottante', '.creer-panneau .hero-mode-btn': 'accueil',
    '.salutation-swap-btn': 'icône seule', '.outils-btn-row.ds-scope .sb-gen-spinner': 'indicateur',
    '.audit-affiner-btn': 'modificateur de couleur, sans taille propre',
    '.genimg-logo-btn': 'icône seule', '.script-edit-btn.actif': 'variante d\'état',
    '.hist-tool-btn.actif': 'variante d\'état', '.hist-tool-btn.danger': 'variante d\'état',
    '.car-format-btn.actif': 'variante d\'état', '.grid-btn.active': 'variante d\'état',
    '.ds-scope-btn.actif': 'variante d\'état', '.plan-toggle-btn.active': 'variante d\'état',
    '.aw-nav button.aw-primary': 'variante d\'état', '.btn-montage-lancer': 'dans le bloc',
    '.rappel-btn-oui': 'variante d\'état', '.rappel-btn-non': 'variante d\'état'
  };

  const avantBloc = css.slice(0, i);
  const orphelins = [];
  const regles = avantBloc.matchAll(/(?:^|\})\s*([^{}@\/]+?)\{([^{}]*)\}/gs);
  for (const r of regles) {
    if (!/font-size:\s*[0-9.]+rem/.test(r[2])) continue;
    for (let sel of r[1].split(',')) {
      sel = sel.trim().replace(/\s+/g, ' ');
      if (!/btn|button|\bcta\b/i.test(sel)) continue;
      if (/:hover|:active|:disabled|::/.test(sel)) continue;
      if (selecteurs.includes(sel)) continue;
      if (HORS_UNIFICATION[sel]) continue;
      orphelins.push(sel);
    }
  }

  assert.deepEqual([...new Set(orphelins)], [],
    'REGRESSION : ces sélecteurs de bouton déclarent leur PROPRE taille de police sans être dans '
    + 'le bloc d\'unification ni dans la liste des exclusions motivées. Soit c\'est un bouton de '
    + 'mode et il doit rejoindre le bloc, soit il est hors périmètre et sa raison doit être écrite '
    + 'dans HORS_UNIFICATION, ici même. Un bouton retiré du bloc en douce retombe ici :\n  '
    + [...new Set(orphelins)].join('\n  '));

  // Les commentaires sont retirés AVANT l'analyse : sans ça, un commentaire
  // collé devant une règle entre dans le sélecteur capturé, et le message
  // d'échec devient illisible (« /* … */\n.bt redéclare … »).
  const apres = css.slice(i + bloc.length).replace(/\/\*[\s\S]*?\*\//g, '');

  // LA SEULE EXCEPTION AUTORISÉE, et elle est documentée dans la feuille de
  // style : le bouton retour garde son espacement de 0.02em parce qu'il est
  // le seul en minuscules. Sa TAILLE, elle, reste soumise au bloc, et le
  // deuxième test ci-dessus le vérifie à l'écran.
  const EXCEPTION = { selecteur: '.btn-back', propriete: 'letter-spacing' };

  const fautes = [];
  for (const sel of selecteurs) {
    // Toute règle suivante dont le sélecteur contient celui-ci et qui
    // redéclare l'une des deux propriétés unifiées.
    const motif = new RegExp('(?:^|\\}|,)\\s*([^{}]*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '(?![\\w-])[^{}]*)\\{([^{}]*)\\}', 'g');
    let m;
    while ((m = motif.exec(apres))) {
      const cible = m[1].trim();
      if (/:hover|:active|:disabled|::/.test(cible)) continue;
      const props = /font-size|letter-spacing/.exec(m[2]);
      if (!props) continue;
      if (cible === EXCEPTION.selecteur && props[0] === EXCEPTION.propriete) continue;
      fautes.push(cible.slice(0, 60) + ' redéclare ' + props[0]);
    }
  }

  assert.deepEqual([...new Set(fautes)], [],
    'REGRESSION : une règle placée APRÈS le bloc d\'unification redéclare la taille ou '
    + 'l\'espacement de boutons qu\'il est censé aligner. Elle gagne par l\'ordre du fichier, et '
    + 'ces boutons-là repartiront seuls dans leur coin, sans que rien ne le signale à l\'écran '
    + 'avant qu\'on ne le voie :\n  ' + [...new Set(fautes)].join('\n  '));
});

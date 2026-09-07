// Retour terrain d'un vrai créateur, et c'est le plus instructif reçu jusqu'ici.
// Il a fait le diagnostic gratuit, il a été convaincu (« c'est très
// professionnel »), et la question posée juste après était : « y a-t-il
// d'autres réglages ? Paramétrer mon TikTok, le VPN... ? »
//
// Il savait CE QUI n'allait pas, et pas QUOI FAIRE. Alors il a deviné, et il a
// deviné mal.
//
// CE QUI EXISTAIT DÉJÀ en fin de diagnostic : une idée en teaser avec bandeau
// d'abonnement, un bouton « Débloquer l'analyse détaillée », et « Analyser un
// autre compte ». Trois suites, dont deux mènent à payer et la troisième à
// recommencer. Aucune ne disait « voilà comment on corrige ce qu'on vient de
// te montrer, vas-y, c'est gratuit ».
//
// CE QUE CES TESTS VERROUILLENT :
//   1. le pas suivant existe, il est GRATUIT, et il est posé AVANT les murs
//      payants (un créateur doit sentir l'app réparer quelque chose avant
//      qu'on lui demande un franc) ;
//   2. il désigne la bonne dimension, mesurée EN PART de son maximum ;
//   3. il n'invente pas un défaut à un compte qui va bien ;
//   4. il ne s'affiche JAMAIS sur le compte d'un concurrent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrir(navigateur, baseUrl) {
  const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page;
}

// Un diagnostic minimal : seules les notes comptent pour le pas suivant.
const dim = (score, dispo) => ({ score: score, disponible: dispo !== false });

test('le pas suivant vise la dimension la plus faible EN PART de son maximum', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(() => {
      const dim = (s, dispo) => ({ score: s, disponible: dispo !== false });
      const texte = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

      // LE PIÈGE DU BARÈME : l'Engagement vaut 30 points, la Viralité 10.
      // Un compte à 12/30 en engagement (40%) et 6/10 en viralité (60%) a son
      // VRAI point faible sur l'engagement, alors que 6 est plus petit que 12.
      const piegeBareme = {
        engagement: dim(12), vues_moyennes: dim(20), regularite: dim(16),
        croissance_abonnes: dim(12), viralite: dim(6)
      };

      // Régularité au plus bas : 4/20 = 20%.
      const irregulier = {
        engagement: dim(27), vues_moyennes: dim(21), regularite: dim(4),
        croissance_abonnes: dim(13), viralite: dim(8)
      };

      // Une dimension NON MESURÉE ne doit jamais être désignée comme le point
      // faible : « non mesurée » ne veut pas dire « mauvaise ».
      const nonMesuree = {
        engagement: dim(27), vues_moyennes: { score: null, disponible: false },
        regularite: dim(18), croissance_abonnes: dim(13), viralite: dim(9)
      };

      return {
        piegeBareme: texte(dsPasSuivantHTML(piegeBareme)),
        cleBareme: dsDimensionLaPlusFaible(piegeBareme).cle,
        irregulier: texte(dsPasSuivantHTML(irregulier)),
        cleIrregulier: dsDimensionLaPlusFaible(irregulier).cle,
        cleNonMesuree: dsDimensionLaPlusFaible(nonMesuree).cle,
        rienDeMesurable: dsPasSuivantHTML({}),
        htmlIrregulier: dsPasSuivantHTML(irregulier)
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    assert.equal(vu.cleBareme, 'engagement',
      'REGRESSION : la dimension la plus faible est comparée en POINTS BRUTS. L\'Engagement vaut 30 et '
      + 'la Viralité 10 : à comparer 12 et 6 directement, les petites dimensions seraient toujours '
      + 'désignées comme le point faible, et le créateur enverrait son effort au mauvais endroit.');
    assert.match(vu.piegeBareme, /ne réagissent pas/,
      'le texte doit correspondre à la dimension désignée : ' + vu.piegeBareme);

    assert.equal(vu.cleIrregulier, 'regularite', 'régularité à 20% : c\'est bien elle la plus faible');
    assert.match(vu.irregulier, /trop rarement/,
      'REGRESSION : le constat ne correspond pas à la dimension faible. Vu : ' + vu.irregulier);
    assert.match(vu.irregulier, /manque de temps/,
      'la CAUSE doit être dite, pas seulement le symptôme : c\'est elle qui explique pourquoi '
      + 'Scriptura sert à quelque chose. Vu : ' + vu.irregulier);

    assert.notEqual(vu.cleNonMesuree, 'vues_moyennes',
      'REGRESSION : une dimension NON MESURÉE est désignée comme le point faible. « Non mesurée » ne '
      + 'veut pas dire « mauvaise », et on enverrait le créateur corriger un défaut inventé.');

    assert.equal(vu.rienDeMesurable, '',
      'REGRESSION : un diagnostic sans aucune dimension mesurable affiche quand même un pas suivant. '
      + 'Il n\'y a alors rien d\'honnête à dire.');

    assert.match(vu.htmlIrregulier, /<button[^>]*onclick=/,
      'REGRESSION : le pas suivant n\'a pas de bouton. C\'est TOUT son intérêt : le créateur vient '
      + 'd\'apprendre ce qui cloche, il doit pouvoir agir sans chercher où cliquer.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('un compte solide ne se voit pas inventer un défaut', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await ouvrir(navigateur, baseUrl);
    const vu = await page.evaluate(() => {
      const dim = (s) => ({ score: s, disponible: true });
      const texte = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
      // Tout au-dessus de 80% de son maximum : le plus faible reste bon.
      const solide = {
        engagement: dim(27), vues_moyennes: dim(22), regularite: dim(17),
        croissance_abonnes: dim(13), viralite: dim(9)
      };
      return { texte: texte(dsPasSuivantHTML(solide)), html: dsPasSuivantHTML(solide) };
    });

    assert.match(vu.texte, /déjà solide/,
      'REGRESSION : on annonce un point faible à un compte qui tourne au-dessus de 80% partout. Un '
      + 'diagnostic qui invente un défaut perd exactement la crédibilité qu\'il vient de gagner. '
      + 'Vu : ' + vu.texte);
    assert.doesNotMatch(vu.texte, /ne réagissent pas|trop rarement|ne sort vraiment du lot/,
      'et il ne doit pas garder le constat alarmiste : ' + vu.texte);
    assert.match(vu.html, /<button/,
      'le pas suivant reste proposé, il change juste de ton : ' + vu.html);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('gratuit et AVANT les murs payants, et jamais sur un concurrent', async () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'diagnostic-sommaire.js'), 'utf8');

  // Sur un concurrent, ces conseils n'ont aucun sens : ce n'est pas son compte.
  assert.match(src, /\$\{moi \? dsPasSuivantHTML\(d\) : ''\}/,
    'REGRESSION : le pas suivant s\'affiche aussi sur l\'analyse d\'un concurrent. On conseillerait au '
    + 'créateur de corriger le compte de quelqu\'un d\'autre.');

  // L'ORDRE EST LA MOITIÉ DE LA CORRECTION : le geste gratuit doit venir AVANT
  // le teaser d'abonnement et avant le bouton « Débloquer l'analyse détaillée ».
  // Nommer son problème puis lui présenter un prix, c'est précisément ce qui
  // avait envoyé ce créateur chercher un VPN.
  // L'USAGE dans le gabarit, jamais la simple mention du nom : la DÉFINITION
  // de la fonction se trouve toujours plus haut dans le fichier, un indexOf
  // sur « dsPasSuivantHTML(d) » la trouvait elle, et les deux comparaisons de
  // position ci-dessous étaient donc vraies quoi qu'il arrive. Vérifié : avec
  // le bloc réellement déplacé après les murs payants, le test passait quand
  // même.
  const iPas = src.indexOf("${moi ? dsPasSuivantHTML(d) : ''}");
  const iTeaser = src.indexOf('${opportuniteHtml}');
  const iMur = src.indexOf('${moi ? ctaDetailleHtml : ctaConcurrentHtml}');
  assert.ok(iPas > 0 && iTeaser > 0 && iMur > 0, 'les trois blocs doivent exister');
  assert.ok(iPas < iTeaser,
    'REGRESSION : le pas suivant gratuit passe APRÈS le teaser d\'abonnement. Le créateur voit un prix '
    + 'avant d\'avoir pu essayer quoi que ce soit.');
  assert.ok(iPas < iMur,
    'REGRESSION : le pas suivant gratuit passe APRÈS le mur payant de l\'analyse détaillée.');

  // ── LES ICÔNES RESTENT COLLÉES AU DIAGNOSTIC ──
  // Défaut réellement introduit en livrant ce bloc, et vu par le propriétaire
  // sur sa capture : en insérant le pas suivant entre la fin du diagnostic et
  // les trois icônes (copier / partager / télécharger), celles-ci se sont
  // retrouvées SOUS la carte d'action, orphelines entre deux sections titrées.
  // Elles copient LE DIAGNOSTIC ; posées après une carte « Et maintenant », on
  // croit qu'elles copient cette carte.
  //
  // Le commentaire d'origine de actionsFinHtml disait déjà pourquoi elles sont
  // là : « pour rester au même endroit relatif dans les deux diagnostics ».
  // Les déplacer désaligne aussi le diagnostic sommaire de l'analyse détaillée.
  const iActions = src.indexOf('${actionsFinHtml}');
  assert.ok(iActions > 0, 'les actions de fin doivent exister');
  assert.ok(iActions < iPas,
    'REGRESSION : les trois icônes (copier / partager / télécharger) passent APRÈS le pas suivant. '
    + 'Elles se rapportent au DIAGNOSTIC : posées sous une carte « Et maintenant », plus rien ne dit '
    + 'ce qu\'elles copient, et le diagnostic sommaire cesse d\'être disposé comme l\'analyse détaillée.');

  // Aucun appel IA : il est servi à des visiteurs gratuits, à chaque
  // diagnostic. Tout vient de notes déjà calculées.
  const bloc = src.slice(src.indexOf('function dsPasSuivantHTML'), src.indexOf('function dsPasSuivantHTML') + 1400);
  assert.ok(!/callAI|genererRecommandations|await /.test(bloc),
    'REGRESSION : le pas suivant déclenche un appel IA. Il est affiché à CHAQUE diagnostic, y compris '
    + 'aux visiteurs gratuits : il doit rester à coût nul.');
});

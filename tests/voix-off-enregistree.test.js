// Suggestion d'un vrai utilisateur, relayée par le propriétaire : « permettre
// que l'utilisateur puisse enregistrer sa propre voix en direct sur l'app ».
//
// POURQUOI ÇA COMPTE AUSSI ÉCONOMIQUEMENT : la voix générée est facturée AU
// CARACTÈRE chez ElevenLabs, à chaque génération ET à chaque « Régénérer »,
// et elle ne consomme aucun quota côté créateur. C'est donc le propriétaire
// qui paie. Une voix enregistrée ne coûte rien à personne.
//
// LE MICRO EST VRAIMENT OUVERT DANS CES TESTS. Chromium fournit un micro
// factice (voir lancerNavigateurAvecMicro) : on enregistre pour de bon, on
// récupère un vrai fichier audio, et on vérifie ce qui en est fait. Un test
// qui se contenterait de simuler MediaRecorder ne prouverait rien du chemin
// réel, qui est justement l'endroit où ça peut casser.
//
// LES DEUX ÉCRANS DE MONTAGE SONT TESTÉS ENSEMBLE. Ce projet a livré deux fois
// aujourd'hui une fonctionnalité d'un seul côté en oubliant l'autre (import
// MP3, bouton musique) : le test refuse que ça recommence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateurAvecMicro } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

async function ouvrirApp(navigateur, baseUrl) {
  const contexte = await navigateur.newContext({
    viewport: { width: 414, height: 900 },
    permissions: ['microphone']
  });
  const page = await contexte.newPage();
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return page;
}

test('la répartition des durées suit le nombre de mots de chaque plan', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    // C'est le cœur du compromis : un enregistrement n'a pas les horodatages
    // caractère par caractère d'ElevenLabs, donc on répartit au prorata des
    // mots. Un partage à parts égales décalerait les images de plusieurs
    // secondes sur un plan long.
    const vu = await page.evaluate(() => {
      const plans = ['un', 'deux mots ici trois', 'a b c d e f g h i j'];  // 1, 4, 10 mots
      const d = repartirDureesParMots(plans, 30);
      return {
        durees: d,
        total: Math.round(d.reduce((a, b) => a + b, 0) * 1000) / 1000,
        egales: repartirDureesParMots(['a', 'b'], 0),
        aucunPlan: repartirDureesParMots([], 10),
        // Cas où la durée ne suffit pas à donner une seconde à chacun.
        troisSecondesPourCinq: repartirDureesParMots(['a', 'b', 'c', 'd', 'e'], 3)
      };
    });

    assert.equal(vu.total, 30,
      'REGRESSION : la somme des durées ne fait plus la durée de l\'enregistrement (' + vu.total
      + 's pour 30s). Les images ne couvriraient plus exactement la voix off.');

    assert.ok(vu.durees[2] > vu.durees[1] && vu.durees[1] > vu.durees[0],
      'REGRESSION : les durées ne suivent plus la longueur des plans. Un plan de dix mots doit durer '
      + 'plus longtemps qu\'un plan d\'un mot, sinon les images se décalent de la narration. Vu : '
      + JSON.stringify(vu.durees));

    // Le plancher d'une seconde, comme dans le service de rendu : en dessous
    // on ne voit pas l'image passer.
    assert.ok(vu.durees.every(d => d >= 1),
      'REGRESSION : un plan tombe sous une seconde (' + JSON.stringify(vu.durees) + '). '
      + 'À cette durée l\'image clignote au lieu d\'être vue.');

    assert.deepEqual(vu.aucunPlan, [], 'aucun plan : aucune durée, sans planter');
    assert.deepEqual(vu.egales, [0, 0], 'durée nulle : aucune durée inventée');
    assert.equal(Math.round(vu.troisSecondesPourCinq.reduce((a, b) => a + b, 0)), 3,
      'REGRESSION : quand la durée ne suffit pas à donner une seconde à chaque plan, le total doit '
      + 'rester exact plutôt que d\'être gonflé par le plancher. Vu : '
      + JSON.stringify(vu.troisSecondesPourCinq));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('l\'extension du fichier suit son VRAI type, jamais son nom', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const vu = await page.evaluate(() => ({
      webm: extensionAudioDepuisType('audio/webm;codecs=opus'),
      mp4: extensionAudioDepuisType('audio/mp4'),
      ogg: extensionAudioDepuisType('audio/ogg;codecs=opus'),
      mpeg: extensionAudioDepuisType('audio/mpeg'),
      vide: extensionAudioDepuisType('')
    }));

    // Le montage storyboard téléversait « voix-off.mp3 » en dur, ce qui était
    // juste tant que la voix venait d'ElevenLabs et devient faux dès qu'elle
    // vient du micro : un webm nommé .mp3 ment sur ce qu'il est, et certains
    // lecteurs le refusent.
    assert.equal(vu.webm, 'webm', 'un enregistrement Chrome/Android est du webm');
    assert.equal(vu.mp4, 'm4a', 'un enregistrement iPhone est du mp4/AAC');
    assert.equal(vu.ogg, 'ogg');
    assert.equal(vu.mpeg, 'mp3', 'la voix ElevenLabs reste du mp3');
    assert.equal(vu.vide, 'mp3', 'type inconnu : on retombe sur le cas le plus courant');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('on enregistre vraiment, et le micro est relâché après', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    const vu = await page.evaluate(async () => {
      const niveaux = [];
      // On intercepte le flux micro pour pouvoir vérifier APRÈS coup qu'il a
      // bien été coupé. Sans ça, on ne saurait pas si la pastille rouge du
      // téléphone reste allumée, et c'est justement ce qui inquiète les gens.
      const vraiGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let fluxOuvert = null;
      navigator.mediaDevices.getUserMedia = async (c) => {
        fluxOuvert = await vraiGetUserMedia(c);
        return fluxOuvert;
      };
      await demarrerEnregistrementVoix(n => niveaux.push(n));
      const pendant = enregistrementVoixEnCours();
      await new Promise(r => setTimeout(r, 900));
      const prise = await arreterEnregistrementVoix();
      return {
        pendant, apres: enregistrementVoixEnCours(),
        octets: prise.blob.size, type: prise.type, duree: prise.duree,
        url: prise.url.slice(0, 5),
        niveauxRecus: niveaux.length,
        fluxIntercepte: !!fluxOuvert,
        // Une piste micro laissée ouverte garde la pastille rouge allumée sur
        // le téléphone : c'est inquiétant, et à juste titre mal vu.
        pistesEncoreVivantes: fluxOuvert
          ? fluxOuvert.getTracks().filter(t => t.readyState === 'live').length
          : -1
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.pendant, true, 'l\'enregistrement doit se signaler comme en cours');
    assert.equal(vu.apres, false,
      'REGRESSION : l\'enregistrement se croit encore en cours après avoir été arrêté. Le bouton '
      + 'resterait bloqué sur « Terminer » et une seconde prise serait impossible.');

    assert.ok(vu.octets > 0,
      'REGRESSION : l\'enregistrement est vide (' + vu.octets + ' octets). Le fichier partirait au '
      + 'montage et la vidéo serait muette.');
    assert.match(vu.type, /^audio\//,
      'REGRESSION : le fichier produit n\'est pas de l\'audio : ' + vu.type);
    assert.equal(vu.url, 'blob:', 'une URL d\'objet, pour pouvoir se réécouter avant de monter');
    assert.ok(vu.duree > 0.5 && vu.duree < 5,
      'REGRESSION : la durée mesurée (' + vu.duree + 's) ne correspond pas à la prise. C\'est elle '
      + 'qui répartit les images sur la narration : fausse, tout le montage se décale.');
    assert.ok(vu.niveauxRecus > 0,
      'REGRESSION : aucun niveau sonore remonté pendant la prise. Sans la jauge, on découvre qu\'on '
      + 'était trop loin du micro APRÈS avoir lu tout son texte.');

    assert.equal(vu.fluxIntercepte, true,
      'le flux micro doit avoir été ouvert, sinon la vérification suivante ne prouve rien');
    assert.equal(vu.pistesEncoreVivantes, 0,
      'REGRESSION : ' + vu.pistesEncoreVivantes + ' piste(s) micro restent OUVERTES après la prise. '
      + 'La pastille rouge « micro actif » resterait allumée sur le téléphone, le navigateur '
      + 'continuerait d\'écouter pour rien, et c\'est le genre de détail qui fait désinstaller une '
      + 'app.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les DEUX écrans de montage proposent d\'enregistrer sa voix', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    const vu = await page.evaluate(() => {
      const lire = (id) => {
        const z = document.getElementById(id);
        return z ? z.innerHTML : null;
      };
      unlocked = true;
      document.body.classList.add('is-unlocked', 'peut-monter-video');
      ouvrirMontage([{ text: 'Un plan de test.', visuel: 'un décor' }], null);
      const storyboard = lire('montageVoixZone');
      goHome();
      ouvrirMontageManuelAccueil();
      const manuel = lire('omVoixZone');
      return { storyboard, manuel };
    });

    for (const [nom, html] of Object.entries(vu)) {
      assert.ok(html !== null,
        'REGRESSION : la zone voix off de l\'écran « ' + nom + ' » est introuvable. Ce test ne '
        + 'vérifie plus rien, en restant vert.');
      assert.match(html, /Enregistrer ma voix/,
        'REGRESSION : l\'écran « ' + nom + ' » ne propose plus d\'enregistrer sa voix. Ce projet a '
        + 'déjà livré deux fois une fonctionnalité d\'un seul côté en oubliant l\'autre : c\'est '
        + 'exactement ce que ce test empêche. Vu : ' + String(html).slice(0, 220));
    }

    assert.match(vu.storyboard, /Générer avec l'IA/,
      'et la voix IA reste proposée à côté : l\'enregistrement s\'ajoute à ce chemin, il ne le '
      + 'remplace pas.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('une prise devient la voix off du montage, avec ses durées', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    const vu = await page.evaluate(async () => {
      unlocked = true;
      document.body.classList.add('is-unlocked');
      ouvrirMontage([
        { text: 'Un premier plan très court.', visuel: 'a' },
        { text: 'Et un second plan nettement plus long que le premier, avec bien plus de mots dedans.', visuel: 'b' }
      ], null);
      await demarrerPriseVoixMontage();
      const pendant = {
        drapeau: montageVoixPriseEnCours,
        html: document.getElementById('montageVoixZone').innerHTML
      };
      // PRISE ASSEZ LONGUE POUR QUE LA RÉPARTITION AU PRORATA S'APPLIQUE.
      // En dessous d'une seconde par plan, le plancher prend le dessus et les
      // durées deviennent égales : c'est le comportement voulu, mais ça ne
      // teste pas le prorata. Mon premier jet enregistrait 0,9s pour deux
      // plans et échouait pour cette raison, pas à cause du code.
      await new Promise(r => setTimeout(r, 2600));
      await arreterPriseVoixMontage();
      // LA PRISE N'EST PAS ENCORE LA VOIX DU MONTAGE : elle attend d'être
      // validée. C'est la demande du propriétaire, « Refaire / Garder ».
      const avantValidation = {
        voixDejaPosee: !!montageVoixOff,
        html: document.getElementById('montageVoixZone').innerHTML
      };
      garderPriseVoixMontage();
      return {
        avantValidation,
        pendant,
        voix: montageVoixOff ? {
          enregistree: !!montageVoixOff.enregistree,
          nbDurees: montageVoixOff.durations.length,
          durees: montageVoixOff.durations,
          octets: montageVoixOff.blob.size
        } : null,
        drapeauApres: montageVoixPriseEnCours,
        htmlApres: document.getElementById('montageVoixZone').innerHTML
      };
    });

    assert.equal(vu.pendant.drapeau, true, 'la prise doit être signalée comme en cours');
    assert.match(vu.pendant.html, /montageVoixChrono/,
      'REGRESSION : aucun chronomètre pendant la prise. C\'est le seul repère quand on lit un texte '
      + 'les yeux sur l\'écran.');
    assert.match(vu.pendant.html, /Un premier plan très court/,
      'REGRESSION : le texte à lire n\'est plus affiché pendant l\'enregistrement. Le créateur devrait '
      + 'le retenir par cœur ou changer d\'écran en pleine prise.');

    assert.ok(vu.voix, 'REGRESSION : la prise ne devient pas la voix off du montage.');
    assert.equal(vu.voix.enregistree, true,
      'REGRESSION : la voix n\'est pas marquée comme enregistrée. C\'est ce drapeau qui empêche le '
      + 'bouton « Régénérer » de la remplacer par une voix IA, et qui corrige l\'extension du '
      + 'fichier au téléversement.');
    assert.equal(vu.voix.nbDurees, 2,
      'REGRESSION : il faut UNE durée par plan, sinon le rendu refuse le montage. Vu : '
      + vu.voix.nbDurees);
    assert.ok(vu.voix.durees[1] > vu.voix.durees[0],
      'REGRESSION : le plan le plus long ne dure pas plus longtemps. Les images se décaleraient de '
      + 'la narration. Vu : ' + JSON.stringify(vu.voix.durees));
    assert.ok(vu.voix.octets > 0, 'et le fichier n\'est pas vide');

    assert.equal(vu.avantValidation.voixDejaPosee, false,
      'REGRESSION : la prise devient la voix off du montage AVANT d\'être validée. Une prise ratée '
      + 'remplacerait alors celle qui marchait, à la seconde où on relâche le bouton, sans qu\'on '
      + 'ait pu l\'écouter.');
    assert.match(vu.avantValidation.html, /Garder/,
      'REGRESSION : aucun bouton « Garder » après la prise. On ne pourrait plus la valider, donc '
      + 'plus jamais s\'en servir.');
    assert.match(vu.avantValidation.html, /Refaire/,
      'et « Refaire » doit être là aussi : écouter sans pouvoir refaire ne sert à rien.');

    assert.equal(vu.drapeauApres, false, 'la prise est terminée');
    // UNE FOIS VALIDÉE, plus de « Refaire » ni de « Garder » : demande du
    // propriétaire. Ces deux boutons servent à trancher sur une prise qu'on
    // vient d'écouter ; la décision prise, ils n'ont plus d'objet.
    assert.doesNotMatch(vu.htmlApres, /Refaire|Garder/,
      'REGRESSION : « Refaire » ou « Garder » restent affichés après validation. Ils invitent '
      + 'à défaire une décision qui vient d\'être prise. Vu : ' + String(vu.htmlApres).slice(0, 200));
    assert.doesNotMatch(vu.htmlApres, /Régénérer la voix off/,
      'REGRESSION : le bouton de régénération IA est proposé sur une voix ENREGISTRÉE. Un appui '
      + 'remplacerait la voix du créateur par une voix inventée, sans prévenir, en facturant '
      + 'ElevenLabs au propriétaire.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Retour du propriétaire, capture à l'appui : une fois la voix enregistrée, la
// rangée « Changer de fichier / Enregistrer ma voix » restait affichée AU-DESSUS
// du lecteur, alors qu'elle ne répond plus à aucune question. Il l'a entourée
// en rouge, et il a raison : à cet instant on veut s'écouter, pas se redemander
// comment obtenir une voix.
//
// LES ACTIONS PASSENT SOUS LE LECTEUR : on écoute d'abord, on décide ensuite.
test('une fois la voix prête, les façons de l\'obtenir laissent place aux actions', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    const vu = await page.evaluate(async () => {
      unlocked = true;
      document.body.classList.add('is-unlocked', 'peut-monter-video');
      ouvrirMontageManuelAccueil();
      const zone = () => document.getElementById('omVoixZone');
      // ON RELÈVE LE TEXTE DES BOUTONS, PAS LE HTML BRUT. Piège trouvé en
      // vérifiant qu'une morsure mordait : l'attribut onclick contient le nom
      // de la fonction (omGarderPrise), donc chercher « Garder » dans le HTML
      // le trouvait TOUJOURS, même quand le bouton affichait autre chose. Le
      // test passait au vert sur un libellé faux.
      const libelles = () => [...zone().querySelectorAll('button')]
        .map(b => b.textContent.replace(/\s+/g, ' ').trim());
      const avant = libelles();

      await omDemarrerPriseVoix();
      await new Promise(r => setTimeout(r, 900));
      await omArreterPriseVoix();
      const aValider = libelles();
      omGarderPrise();
      const apres = libelles();

      // Position relative du lecteur et des boutons : les actions doivent
      // venir APRÈS lui, pas avant.
      const lecteur = zone().querySelector('audio');
      const boutons = zone().querySelector('.montage-musique-choix');
      return {
        avant, aValider, apres,
        aUnLecteur: !!lecteur,
        boutonsApresLecteur: !!(lecteur && boutons
          && (lecteur.compareDocumentPosition(boutons) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
      };
    });

    // Avant : on ne sait pas encore d'où viendra la voix, les deux chemins
    // doivent être là.
    const contient = (liste, mot) => liste.some(t => t.includes(mot));

    assert.ok(contient(vu.avant, 'Choisir un fichier audio'),
      'sans voix, le choix du fichier est proposé. Vu : ' + JSON.stringify(vu.avant));
    assert.ok(contient(vu.avant, 'Enregistrer ma voix'),
      'et l\'enregistrement aussi. Vu : ' + JSON.stringify(vu.avant));

    // Après : ces deux-là ont fait leur travail.
    assert.ok(!contient(vu.apres, 'Choisir un fichier audio'),
      'REGRESSION : « Choisir un fichier audio » reste affiché alors que la voix est déjà là. '
      + 'C\'est exactement ce que le propriétaire a entouré en rouge : une question déjà répondue, '
      + 'posée une seconde fois au-dessus du lecteur.');
    assert.ok(!contient(vu.apres, 'Enregistrer ma voix'),
      'REGRESSION : « Enregistrer ma voix » reste affiché après la prise. Il est remplacé par '
      + '« Refaire », qui dit ce qu\'il fait vraiment à ce moment-là.');

    // L'état intermédiaire : deux boutons, et rien d'autre à décider.
    assert.ok(contient(vu.aValider, 'Garder'),
      'REGRESSION : la prise ne peut plus être validée. Elle serait enregistrée pour rien.');
    assert.ok(contient(vu.aValider, 'Refaire'),
      'REGRESSION : impossible de refaire une prise qu\'on vient de trouver mauvaise en l\'écoutant.');
    assert.ok(!contient(vu.aValider, 'Changer de fichier'),
      'REGRESSION : « Changer de fichier » apparaît alors qu\'une prise attend d\'être validée. À cet '
      + 'instant il n\'y a que deux décisions à prendre, la garder ou la refaire : une troisième '
      + 'option brouille le choix.');

    assert.equal(vu.aUnLecteur, true, 'on doit pouvoir se réécouter avant de monter');
    assert.ok(!contient(vu.apres, 'Refaire') && !contient(vu.apres, 'Garder'),
      'REGRESSION : « Refaire » ou « Garder » restent affichés une fois la voix validée. '
      + 'Demande du propriétaire : la décision prise, ces deux boutons n\'ont plus d\'objet.');
    assert.ok(contient(vu.apres, 'Changer de fichier'),
      'REGRESSION : plus aucun moyen de revenir sur sa voix une fois validée. Le créateur devrait '
      + 'recommencer tout son montage, images comprises, pour changer une voix off ratée. C\'est le '
      + 'dernier garde-fou après le retrait de « Refaire ».');

    assert.equal(vu.boutonsApresLecteur, true,
      'REGRESSION : les actions sont repassées AU-DESSUS du lecteur. On écoute d\'abord, on décide '
      + 'ensuite : c\'est l\'ordre demandé, et c\'est aussi l\'ordre logique.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Demande du propriétaire : deux boutons sous le lecteur, « Refaire » et
// « Garder ». Ce n'est pas qu'une question de boutons, c'est un changement de
// COMPORTEMENT : jusqu'ici la prise devenait la voix off du montage à la
// seconde où on relâchait « Terminer ».
//
// CE QUE ÇA PROTÈGE, ET C'EST TOUT L'INTÉRÊT : on a déjà une voix qui marche,
// on tente une meilleure prise, elle est ratée. Avant, l'ancienne était
// écrasée et perdue. Maintenant on écoute, et si c'est mauvais on reprend ou
// on s'en va : la voix qui marchait est toujours là.
test('une prise ratée ne détruit pas la voix qui marchait', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateurAvecMicro();
  try {
    const page = await ouvrirApp(navigateur, baseUrl);

    const vu = await page.evaluate(async () => {
      unlocked = true;
      document.body.classList.add('is-unlocked');
      ouvrirMontage([{ text: 'Un plan.', visuel: 'a' }, { text: 'Un autre plan bien plus long.', visuel: 'b' }], null);

      // Première prise, validée : c'est la voix qui marche.
      await demarrerPriseVoixMontage();
      await new Promise(r => setTimeout(r, 2600));
      await arreterPriseVoixMontage();
      garderPriseVoixMontage();
      const bonne = { url: montageVoixOff.url, octets: montageVoixOff.blob.size };

      // Deuxième prise, qu'on juge ratée en l'écoutant.
      await demarrerPriseVoixMontage();
      await new Promise(r => setTimeout(r, 900));
      await arreterPriseVoixMontage();
      const pendantDoute = {
        voixTouchee: montageVoixOff.url !== bonne.url,
        aUneJauge: !!montagePriseAValider
      };

      // On reprend : la prise ratée est jetée, la bonne est toujours là.
      await demarrerPriseVoixMontage();
      const apresReprise = { voixTouchee: montageVoixOff.url !== bonne.url };
      annulerPriseVoixMontage();

      return {
        pendantDoute, apresReprise,
        voixFinale: montageVoixOff ? { url: montageVoixOff.url, octets: montageVoixOff.blob.size } : null,
        bonne
      };
    });

    assert.equal(vu.pendantDoute.aUneJauge, true,
      'la seconde prise doit exister, sinon ce test ne prouve rien');
    assert.equal(vu.pendantDoute.voixTouchee, false,
      'REGRESSION : la nouvelle prise a REMPLACÉ la voix off avant d\'être validée. Le créateur qui '
      + 'tente une meilleure prise et la rate perd celle qui marchait, sans avertissement et sans '
      + 'retour possible.');

    assert.equal(vu.apresReprise.voixTouchee, false,
      'REGRESSION : appuyer sur « Refaire » a détruit la voix off en place. Or reprendre, c\'est '
      + 'refaire la PRISE, pas effacer ce qu\'on avait déjà.');

    assert.ok(vu.voixFinale, 'REGRESSION : la voix off a disparu au passage.');
    assert.equal(vu.voixFinale.url, vu.bonne.url,
      'REGRESSION : ce n\'est plus la voix validée qui est en place.');
    assert.equal(vu.voixFinale.octets, vu.bonne.octets, 'et c\'est bien le même fichier');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

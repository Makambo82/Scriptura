// Bug réel signalé par le propriétaire (capture d'écran) : "Analyse-moi une
// vidéo TikTok" échouait systématiquement avec l'erreur API Anthropic
// "messages.0.content.0.image.source.base64.media_type: Field required."
//
// Cause d'origine : extraireFrameHook (api/tiktok-video.js) renvoyait la 1re
// frame de la vidéo comme une simple CHAÎNE base64, jamais un objet, et le
// client passait cette chaîne brute telle quelle à callAI. Corrigé en
// enveloppant chaque frame dans { base64, mediaType: 'image/jpeg' } dès sa
// réception côté client.
//
// Depuis la refonte « copier Vervox dans les limites de nos API » (analyse
// visuelle multi-frames début/milieu/fin plutôt qu'une seule image), le
// serveur renvoie désormais un TABLEAU `frames` (au lieu d'un `frame_hook`
// unique) et js/api.js accepte un tableau de fichiers joints. Ce test
// verrouille : chaque frame du tableau devient bien son propre content
// block image, avec media_type et data corrects, dans l'ordre reçu.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const RAPPORT_MINIMAL = {
  niche: 'test',
  sujet: 'sujet test',
  hook: { technique: 'test', verbatim: 'test', pourquoi: 'test' },
  recette: [{ temps: '0-5s', titre: 'test', detail: 'test' }],
  modele: [{ temps: '0-5s', gabarit: 'test' }],
  pourquoi_viral: ['test'],
  a_reprendre: [{ titre: 'test', detail: 'test' }],
  signaux: { hook_fort: true, boucle_ouverte: false, cliffhanger: false, deuxieme_personne: true, details_concrets: true, escalade: false, question_rhetorique: false, archetypes: false, appel_action: false, angle_original: true, sujet_precis: true, hook_visuel: true }
};

const FRAMES_TEST = ['RkFLRUJBU0U2NA==', 'RkFLRUJBU0U2NB==', 'RkFLRUJBU0U2NC==']; // début / milieu / fin, factices

test('analyse virale : les frames vidéo (base64) sont bien enveloppées en { base64, mediaType } avant d\'être envoyées à l\'IA, une par frame', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let contenuRecu = null;

    await poserMocksReseau(page, {
      generate: (body) => {
        contenuRecu = body?.messages?.[0]?.content;
        return { content: [{ text: JSON.stringify(RAPPORT_MINIMAL) }] };
      }
    });
    await page.route('**/api/tiktok-video**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, transcript: 'Ceci est le transcript de test de la vidéo, assez long pour passer le seuil minimal.',
        description: '', stats: { vues: 1000 }, langue: 'fr',
        frames: FRAMES_TEST // tableau de chaînes brutes, comme le serveur réel
      })
    }));

    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await connecterAbonne(page, { code: 'FRAMEHOOKTEST1', plan: 'creator' });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      if (typeof masquerTousLesEcrans === 'function') masquerTousLesEcrans();
      const flow = document.getElementById('viralFlow') || document.getElementById('viralAnaFlow');
      if (flow) flow.style.display = 'block';
      document.getElementById('viralAnaLien').value = 'https://www.tiktok.com/@test/video/123456';
    });
    await page.evaluate(() => lancerAnalyseVirale());
    await page.waitForTimeout(600);

    assert.ok(Array.isArray(contenuRecu), 'le message envoyé à l\'IA doit contenir un tableau (texte + images jointes) quand des frames sont disponibles : ' + JSON.stringify(contenuRecu));
    const blocsImage = contenuRecu.filter(b => b.type === 'image');
    assert.equal(blocsImage.length, FRAMES_TEST.length, 'un content block "image" par frame reçue du serveur : ' + JSON.stringify(contenuRecu));
    blocsImage.forEach((bloc, i) => {
      assert.equal(bloc.source.media_type, 'image/jpeg', 'media_type doit être renseigné sur chaque frame (c\'était le champ manquant qui faisait échouer l\'appel API)');
      assert.equal(bloc.source.data, FRAMES_TEST[i], 'les données base64 de chaque frame doivent être transmises telles quelles, dans l\'ordre chronologique');
    });

    // Le rapport doit s'afficher normalement, la panne ne doit plus se reproduire.
    const erreurAffichee = await page.evaluate(() => document.getElementById('viralAnaError')?.textContent?.trim() || '');
    assert.equal(erreurAffichee, '', 'aucune erreur ne doit être affichée à l\'utilisateur : ' + erreurAffichee);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

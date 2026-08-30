// Bug réel signalé par le propriétaire (capture d'écran) : "Analyse-moi une
// vidéo TikTok" échouait systématiquement avec l'erreur API Anthropic
// "messages.0.content.0.image.source.base64.media_type: Field required."
//
// Cause : extraireFrameHook (api/tiktok-video.js) renvoie la 1re frame de la
// vidéo comme une simple CHAÎNE base64 (img.toString('base64')), jamais un
// objet. Le client (js/viral.js) stockait cette chaîne brute dans
// `frameHook` et la passait telle quelle à callAI comme `fichierJoint`.
// Mais js/api.js construit le content block image à partir de
// `fichierJoint.mediaType` et `fichierJoint.base64` (voir ligne ~176) : sur
// une chaîne, ces deux propriétés valent undefined, donc l'image partait à
// l'IA sans son type ni ses données, rejetée à chaque fois par l'API.
// Corrigé en enveloppant la chaîne dans { base64, mediaType: 'image/jpeg' }
// dès sa réception côté client.
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

test('analyse virale : la frame vidéo (base64) est bien enveloppée en { base64, mediaType } avant d\'être envoyée à l\'IA', async () => {
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
        frame_hook: 'RkFLRUJBU0U2NA==' // "FAKEBASE64" en base64, chaîne brute comme le serveur réel
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

    assert.ok(Array.isArray(contenuRecu), 'le message envoyé à l\'IA doit contenir un tableau (texte + image jointe) quand une frame est disponible : ' + JSON.stringify(contenuRecu));
    const blocImage = contenuRecu.find(b => b.type === 'image');
    assert.ok(blocImage, 'un content block de type "image" doit être présent : ' + JSON.stringify(contenuRecu));
    assert.equal(blocImage.source.media_type, 'image/jpeg', 'media_type doit être renseigné (c\'était le champ manquant qui faisait échouer l\'appel API)');
    assert.equal(blocImage.source.data, 'RkFLRUJBU0U2NA==', 'les données base64 de la frame doivent être transmises telles quelles');

    // Le rapport doit s'afficher normalement, la panne ne doit plus se reproduire.
    const erreurAffichee = await page.evaluate(() => document.getElementById('viralAnaError')?.textContent?.trim() || '');
    assert.equal(erreurAffichee, '', 'aucune erreur ne doit être affichée à l\'utilisateur : ' + erreurAffichee);

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

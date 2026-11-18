const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const RACINE = path.join(__dirname, '..');

test('api/transcribe-upload.js : présent, protégé, utilise cloud_storage_url', () => {
  const f = path.join(RACINE, 'api', 'transcribe-upload.js');
  assert.ok(fs.existsSync(f), 'api/transcribe-upload.js doit exister');
  const src = fs.readFileSync(f, 'utf8');
  assert.match(src, /cloud_storage_url/, 'doit utiliser cloud_storage_url ElevenLabs');
  assert.match(src, /verifierQuota\(droits, 'analyseVirale'/, 'doit consommer le quota analyseVirale');
  assert.match(src, /droits\.plan !== 'creator'/, 'doit vérifier le plan Creator/Pro');
  assert.match(src, /supprimerFichier/, 'doit supprimer le fichier après transcription');
});

test('vercel.json : transcribe-upload déclarée avec maxDuration >= 240', () => {
  const v = JSON.parse(fs.readFileSync(path.join(RACINE, 'vercel.json'), 'utf8'));
  assert.ok(v.functions && v.functions['api/transcribe-upload.js'], 'fonction déclarée');
  assert.ok(v.functions['api/transcribe-upload.js'].maxDuration >= 240, 'au moins 4 minutes');
});

test('index.html : radio button + input fichier', () => {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  assert.match(html, /outilsModeLienBtn/, 'bouton mode lien présent');
  assert.match(html, /outilsModeFichierBtn/, 'bouton mode fichier présent');
  assert.match(html, /outilsFichierInput/, 'input file présent');
  assert.match(html, /outilsChampFichier/, 'wrapper fichier présent');
});

test('js/tiktok-outils.js : mode fichier branché', () => {
  const src = fs.readFileSync(path.join(RACINE, 'js', 'tiktok-outils.js'), 'utf8');
  assert.match(src, /outilsChoisirMode/, 'fonction outilsChoisirMode présente');
  assert.match(src, /_outilsMode === 'fichier'/, 'gestion du mode fichier présente');
  assert.match(src, /uploaderAssetMontage/, 'réutilise uploaderAssetMontage de js/api.js');
  assert.match(src, /\/api\/transcribe-upload/, 'appelle la bonne route');
});

// ── Comportement réel dans le navigateur (ajout du 18 novembre) ──
// Le 17 novembre, js/tiktok-outils.js et l'API ont été livrés SANS les
// éléments de index.html dont ils dépendent : le mode fichier était
// invisible en production. Ce test ouvre vraiment l'écran et l'utilise.
test('Outils TikTok : le mode galerie s\'affiche, masque Télécharger et refuse un fichier de plus de 50 Mo', async () => {
  const { demarrerServeur } = require('./helpers/serveur');
  const { lancerNavigateur } = require('./helpers/navigateur');
  const { poserMocksReseau } = require('./helpers/mocks');
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => ouvrirOutilsTikTok());

    const visible = (sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && el.offsetParent !== null; }, sel);
    assert.ok(await visible('#outilsModeLienBtn'), 'le choix « Lien TikTok » doit être visible');
    assert.ok(await visible('#outilsModeFichierBtn'), 'le choix « Vidéo de ma galerie » doit être visible');
    assert.ok(await visible('#outilsLien'), 'mode lien par défaut : le champ du lien est visible');
    assert.ok(await visible('#outilsTelechargementBtn'), 'mode lien : Télécharger est proposé');

    await page.click('#outilsModeFichierBtn');
    assert.ok(!(await visible('#outilsLien')), 'mode fichier : le champ du lien disparaît');
    assert.ok(await visible('#outilsFichierBtn'), 'mode fichier : le bouton de choix du fichier apparaît');
    assert.ok(!(await visible('#outilsTelechargementBtn')),
      'REGRESSION : en mode fichier, Télécharger réclamait un lien TikTok que l\'utilisateur n\'a pas');

    // 51 Mo : au-delà du plafond par fichier de Supabase (plan gratuit)
    // Fichier creux (truncate) : 51 Mo annoncés, presque rien sur le disque.
    // Playwright refuse un contenu en mémoire de plus de 50 Mo.
    const os = require('os');
    const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptura-'));
    const lourd = path.join(dossierTmp, 'trop-lourde.mp4');
    fs.closeSync(fs.openSync(lourd, 'w')); fs.truncateSync(lourd, 51 * 1024 * 1024);
    try { await page.setInputFiles('#outilsFichierInput', lourd); }
    finally { fs.rmSync(dossierTmp, { recursive: true, force: true }); }
    const err = await page.evaluate(() => { const e = document.getElementById('outilsError'); return e.offsetParent !== null ? e.textContent : ''; });
    assert.match(err, /50 Mo/, 'un fichier de plus de 50 Mo doit être refusé avec la limite affichée');

    await page.setInputFiles('#outilsFichierInput', { name: 'ma video.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(1024 * 1024) });
    const info = await page.evaluate(() => { const e = document.getElementById('outilsFichierInfo'); return e.offsetParent !== null ? e.textContent : ''; });
    assert.match(info, /ma video\.mp4.*prête à transcrire/, 'un fichier valide est annoncé prêt');

    await page.click('#outilsModeLienBtn');
    assert.ok(await visible('#outilsTelechargementBtn'), 'retour au mode lien : Télécharger revient');
    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

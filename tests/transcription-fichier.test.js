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

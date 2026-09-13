// LOT 2, AUDIT A6 — Grâce contrôlée dans resoudreDroits (api/_lib/acces.js).
//
// Avant ce correctif, une panne Supabase donnait un accès Creator gratuit à
// N'IMPORTE QUEL code, y compris inventé (voir tests/alerte-acces-degrade.test.js
// pour l'historique de cette faille). Le correctif distingue :
//   CAS 1 : un code déjà validé AVEC SUCCÈS par cette instance, panne
//           ensuite → conserve ses VRAIS droits pendant une fenêtre de
//           grâce bornée (30 min, GRACE_DUREE_MS).
//   CAS 2 : un code jamais validé, panne → aucun accès.
//   CAS 3 : clé service_role absente → aucun accès (aucun CAS 1 possible
//           sans jamais avoir pu lire Supabase).
//   CAS 4 : panne réseau (exception) → même traitement que CAS 1/2 selon
//           que le code a ou non déjà réussi.
// Ce fichier teste les 7 scénarios demandés dans l'audit.
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_BASE = {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
  CODE_ADMIN: 'ADMIN-TEST-GRACE'
};
function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, ENV_BASE, extra || {});
  return () => { process.env = avant; };
}

// État mutable du faux Supabase : `panne` bascule à la demande DANS un même
// test, pour simuler "sain, puis en panne" sur la même instance de module
// (le cache de grâce vit dans le module, il faut donc importer UNE SEULE
// fois par test pour que CAS 1 ait un sens).
function poserFetchMock(etat) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/erreurs_generation')) return { ok: true, json: async () => ({}) };
    if (u.includes('/rest/v1/abonnes')) {
      if (etat.panne) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => (etat.rows || []) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

const importerAcces = () => import('../api/_lib/acces.js?t=' + Date.now() + Math.random());

test('1. Supabase opérationnel + code valide : accès normal, aucune grâce impliquée', async () => {
  const restaurer = poserEnv();
  const etat = { panne: false, rows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] };
  poserFetchMock(etat);
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('ABONNE-PRO-REEL');
    assert.equal(droits.ok, true);
    assert.equal(droits.plan, 'pro');
    assert.ok(!droits.viaGrace);
  } finally { restaurer(); }
});

test('2. Supabase opérationnel + code invalide (inconnu) : non-abonné, jamais de plan', async () => {
  const restaurer = poserEnv();
  const etat = { panne: false, rows: [] };
  poserFetchMock(etat);
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-INEXISTANT');
    assert.equal(droits.ok, true);
    assert.equal(droits.plan, null);
    assert.equal(droits.codeInconnu, true);
  } finally { restaurer(); }
});

test('3. Supabase indisponible + identité DÉJÀ CONNUE (CAS 1) : grâce accordée avec les VRAIS droits', async () => {
  const restaurer = poserEnv();
  const etat = { panne: false, rows: [{ actif: true, plan: 'creator', jetons_audit: 2 }] };
  poserFetchMock(etat);
  try {
    const { resoudreDroits } = await importerAcces();
    // D'abord, une vraie validation réussie (mémorise la grâce).
    const avant = await resoudreDroits('ABONNE-CREATOR-CONNU');
    assert.equal(avant.plan, 'creator');

    // Puis Supabase tombe.
    etat.panne = true;
    const pendant = await resoudreDroits('ABONNE-CREATOR-CONNU');
    assert.equal(pendant.ok, true);
    assert.equal(pendant.plan, 'creator', 'la grâce doit rendre les VRAIS droits, pas un Creator par défaut générique');
    assert.equal(pendant.jetons, 2, 'les droits complets (jetons inclus) doivent être ceux réellement validés');
    assert.equal(pendant.viaGrace, true);
    assert.equal(pendant.panne, true);
  } finally { restaurer(); }
});

test('4. Supabase indisponible + identité INCONNUE (CAS 2) : aucun accès, jamais de Creator par défaut', async () => {
  const restaurer = poserEnv();
  const etat = { panne: true };
  poserFetchMock(etat);
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('CODE-JAMAIS-VU');
    assert.equal(droits.ok, true, 'jamais un refus dur');
    assert.equal(droits.plan, null, 'aucun accès pour un code jamais validé pendant une panne');
    assert.ok(!droits.viaGrace);
  } finally { restaurer(); }
});

test('5. Clé serveur absente (CAS 3) : aucun accès possible, pour personne', async () => {
  const restaurer = poserEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  try {
    const { resoudreDroits } = await importerAcces();
    const droits = await resoudreDroits('N-IMPORTE-QUEL-CODE');
    assert.equal(droits.ok, true);
    assert.equal(droits.plan, null, 'sans configuration, aucun CAS 1 n\'est possible : jamais de Creator par défaut');
    assert.equal(droits.nonConfigure, true);
  } finally { restaurer(); }
});

test('6. Grâce EXPIRÉE : un code déjà connu ne conserve plus son accès au-delà de la fenêtre de grâce', async () => {
  const restaurer = poserEnv();
  const etat = { panne: false, rows: [{ actif: true, plan: 'pro', jetons_audit: 0 }] };
  poserFetchMock(etat);
  const dateOriginal = Date.now;
  try {
    const { resoudreDroits } = await importerAcces();
    const avant = await resoudreDroits('ABONNE-GRACE-EXPIRE');
    assert.equal(avant.plan, 'pro');

    etat.panne = true;
    // 31 minutes plus tard (GRACE_DUREE_MS = 30 min) : la grâce doit avoir expiré.
    const maintenantReel = Date.now();
    Date.now = () => maintenantReel + 31 * 60 * 1000;
    const apresExpiration = await resoudreDroits('ABONNE-GRACE-EXPIRE');
    assert.equal(apresExpiration.plan, null, 'REGRESSION : la grâce ne doit jamais durer indéfiniment');
    assert.ok(!apresExpiration.viaGrace);
  } finally {
    Date.now = dateOriginal;
    restaurer();
  }
});

test('7. Aucun accès illimité après panne prolongée : un accès en grâce ne prolonge PAS la grâce elle-même', async () => {
  const restaurer = poserEnv();
  const etat = { panne: false, rows: [{ actif: true, plan: 'creator', jetons_audit: 0 }] };
  poserFetchMock(etat);
  const dateOriginal = Date.now;
  try {
    const { resoudreDroits } = await importerAcces();
    await resoudreDroits('ABONNE-PANNE-LONGUE'); // validation réelle, t=0

    etat.panne = true;
    const maintenantReel = Date.now();
    // t = 20 min : encore dans la fenêtre, la grâce doit fonctionner.
    Date.now = () => maintenantReel + 20 * 60 * 1000;
    const a20min = await resoudreDroits('ABONNE-PANNE-LONGUE');
    assert.equal(a20min.plan, 'creator', 'encore dans la fenêtre de grâce à 20 min');

    // t = 35 min DEPUIS LE DÉBUT (pas depuis le dernier accès en grâce) :
    // la fenêtre doit être expirée, même si un accès en grâce a eu lieu à
    // t=20 min. Une grâce qui se prolongerait à chaque appel dégradé
    // permettrait un accès illimité pendant une panne qui dure des heures.
    Date.now = () => maintenantReel + 35 * 60 * 1000;
    const a35min = await resoudreDroits('ABONNE-PANNE-LONGUE');
    assert.equal(a35min.plan, null,
      'REGRESSION : la grâce ne doit jamais se prolonger indéfiniment via des accès répétés pendant la panne');
  } finally {
    Date.now = dateOriginal;
    restaurer();
  }
});

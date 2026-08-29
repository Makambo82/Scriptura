// Vérifie que le fondateur peut supprimer DÉFINITIVEMENT un code désactivé
// depuis le tableau de bord, sans passer par Supabase (retour direct :
// "est-il possible que tu supprimes les codes que j'ai désactivés, ou je
// dois le faire moi-même dans Supabase ?" → un bouton dans l'app). Le
// bouton n'apparaît QUE pour un code déjà désactivé, jamais pour un code
// actif ni pour le fondateur, et une confirmation est obligatoire avant
// tout appel réseau (action irréversible, contrairement à la désactivation).
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau, connecterAbonne } = require('./helpers/mocks');

const CODES = [
  { code: 'SCRIPTURA-CELINE', plan: 'creator', actif: true, expire_le: null },
  { code: 'FIFA', plan: 'creator', actif: true, expire_le: null },
  { code: 'BRAD-A3M8', plan: 'creator', actif: false, expire_le: null }
];

test('bouton "Supprimer" : visible seulement pour un code désactivé (jamais le fondateur ni un code actif)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {
      data: (body) => body.resource === 'admin-stats'
        ? { codes: CODES, parModePlan: {}, erreursParMode: {}, erreursTotal: 0, actifs: 2, creator: 2, pro: 0, total: 3 }
        : undefined
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'SCRIPTURA-CELINE', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleListeAbonnesAdmin());
    await page.waitForTimeout(300);

    const lignes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#listeAbonnesAdminList > div')).map(div => ({
        code: div.querySelector('.admin-code-clic')?.textContent || '',
        aBoutonSupprimer: !!div.querySelector('.history-delete')
      }));
    });
    const fondateur = lignes.find(l => l.code.includes('SCRIPTURA-CELINE'));
    const actif = lignes.find(l => l.code.includes('FIFA'));
    const desactive = lignes.find(l => l.code.includes('BRAD-A3M8'));
    assert.ok(fondateur && !fondateur.aBoutonSupprimer, 'le fondateur ne doit jamais avoir de bouton supprimer');
    assert.ok(actif && !actif.aBoutonSupprimer, 'un code actif ne doit pas avoir de bouton supprimer');
    assert.ok(desactive && desactive.aBoutonSupprimer, 'un code désactivé doit avoir un bouton supprimer');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('clic sur "Supprimer" : annulé sans confirmation, exécuté avec confirmation (et retire la ligne)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    let appelsSuppression = 0;
    await poserMocksReseau(page, {
      data: (body) => {
        if (body.resource === 'admin-stats' && body.action === 'supprimer-abonne') {
          appelsSuppression++;
          return { ok: true, code: body.code };
        }
        if (body.resource === 'admin-stats') {
          return { codes: CODES, parModePlan: {}, erreursParMode: {}, erreursTotal: 0, actifs: 2, creator: 2, pro: 0, total: 3 };
        }
        return undefined;
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'SCRIPTURA-CELINE', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleListeAbonnesAdmin());
    await page.waitForTimeout(300);

    // ── Annulé (confirm() renvoie false) : aucun appel réseau, la ligne reste ──
    await page.evaluate(() => { window.confirm = () => false; });
    await page.evaluate(() => {
      const div = Array.from(document.querySelectorAll('#listeAbonnesAdminList > div')).find(d => d.textContent.includes('BRAD-A3M8'));
      div.querySelector('.history-delete').click();
    });
    await page.waitForTimeout(200);
    assert.equal(appelsSuppression, 0, 'aucun appel serveur tant que la confirmation n\'a pas été donnée');
    const presenteApresAnnulation = await page.evaluate(() => document.getElementById('listeAbonnesAdminList').textContent.includes('BRAD-A3M8'));
    assert.equal(presenteApresAnnulation, true, 'la ligne doit rester présente après une annulation');

    // ── Confirmé (confirm() renvoie true) : appel serveur, ligne retirée ──
    await page.evaluate(() => { window.confirm = () => true; });
    await page.evaluate(() => {
      const div = Array.from(document.querySelectorAll('#listeAbonnesAdminList > div')).find(d => d.textContent.includes('BRAD-A3M8'));
      div.querySelector('.history-delete').click();
    });
    await page.waitForTimeout(300);
    assert.equal(appelsSuppression, 1, 'un seul appel serveur après confirmation');
    const presenteApresSuppression = await page.evaluate(() => document.getElementById('listeAbonnesAdminList').textContent.includes('BRAD-A3M8'));
    assert.equal(presenteApresSuppression, false, 'la ligne doit disparaître après une suppression réussie');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('serveur refuse (code introuvable ou encore actif) : la ligne reste, pas de fausse suppression', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await poserMocksReseau(page, {
      data: (body) => {
        if (body.resource === 'admin-stats' && body.action === 'supprimer-abonne') {
          return { ok: false, erreur: 'rien_a_supprimer' };
        }
        if (body.resource === 'admin-stats') {
          return { codes: CODES, parModePlan: {}, erreursParMode: {}, erreursTotal: 0, actifs: 2, creator: 2, pro: 0, total: 3 };
        }
        return undefined;
      }
    });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('scriptura_is_admin', 'true');
      localStorage.setItem('scriptura_illimite', 'true');
    });
    await connecterAbonne(page, { code: 'SCRIPTURA-CELINE', plan: 'admin' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      supabaseClient = { from() { return { select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
    });
    await page.evaluate(() => ouvrirTableauDeBord());
    await page.waitForTimeout(300);
    await page.evaluate(() => toggleListeAbonnesAdmin());
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.confirm = () => true; });
    await page.evaluate(() => {
      const div = Array.from(document.querySelectorAll('#listeAbonnesAdminList > div')).find(d => d.textContent.includes('BRAD-A3M8'));
      div.querySelector('.history-delete').click();
    });
    await page.waitForTimeout(300);
    const toujoursPresente = await page.evaluate(() => document.getElementById('listeAbonnesAdminList').textContent.includes('BRAD-A3M8'));
    assert.equal(toujoursPresente, true, 'un refus serveur ne doit jamais retirer la ligne côté client');

    if (erreursJs.length) throw new Error('Exceptions JS : ' + erreursJs.join(' | '));
  } finally {
    await navigateur.close();
    await arreter();
  }
});

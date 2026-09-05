// Deux retours du propriétaire sur le Tableau de bord, capture à l'appui.
//
// 1) « Je viens de faire une génération avec un navigateur sans code et ça
//    n'est pas marqué dans Non-abonné. » Vérification faite : le comptage
//    était JUSTE (une génération anonyme part bien avec un code_acces
//    anon_..., et tombe bien dans Non-abonné, voir
//    tests/admin-stats-fondateur-exclu-abonnes.test.js). Le vrai problème
//    était l'AFFICHAGE : la grille fait 400 px de large pour 304 px visibles
//    sur un iPhone, donc la colonne Non-abonné est hors écran tant qu'on n'a
//    pas fait glisser le tableau. Décision du propriétaire après diagnostic :
//    on GARDE ce défilement (« c'est le fondateur seul qui y a accès donc il
//    sait qu'il faut glisser »), des colonnes larges se lisant mieux que des
//    colonnes comprimées. Voir le test ci-dessous, qui verrouille ce choix.
//
// 2) « Cet utilisateur est actuellement connecté et le tableau de bord met
//    qu'il est inactif depuis 14 jours. » Deux causes : « inactif » ne
//    regardait QUE les générations (ouvrir l'app ne comptait pas), et la
//    durée « 14 j » était écrite EN DUR dans le libellé, identique pour un
//    abonné inscrit la veille et pour un parti depuis six mois.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const ilYaJours = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

async function ouvrirAdmin(page, baseUrl, reponse) {
  await poserMocksReseau(page, {
    data: (body) => (body.resource === 'admin-stats' ? reponse : undefined)
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('scriptura_unlocked', 'true');
    localStorage.setItem('scriptura_code', 'ADMINTEST');
    localStorage.setItem('scriptura_is_admin', 'true');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
}

// CHOIX ASSUMÉ DU PROPRIÉTAIRE, à ne pas "corriger" par bonne intention.
//
// Première réaction au diagnostic : rendre le tableau assez compact pour
// tenir entier sur un téléphone. Livré, puis retiré à sa demande : « laisse
// ça glissable comme ça, c'est le fondateur seul qui y a accès donc il sait
// qu'il faut glisser. » L'argument tient : cet écran n'a qu'un utilisateur,
// et des colonnes larges se lisent mieux que des colonnes comprimées.
//
// Ce test garde donc le comportement VOULU : le tableau déborde, on le fait
// glisser, la colonne Non-abonné est atteignable, et la colonne des noms de
// mode reste figée pour qu'on sache toujours quelle ligne on lit.
test('le tableau reste glissable, et Non-abonné est atteignable en glissant', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 360, height: 800 } });
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await ouvrirAdmin(page, baseUrl, {
      ok: true, codesActifsRecents: [], derniereActiviteParCode: {},
      erreursParMode: {}, erreursTotal: 0, erreursRecentes: [],
      parModePlan: {
        fondateur: { script: 5, diagnosticSommaire: 3 },
        pro: {}, creator: {},
        nonAbonne: { script: 2, diagnosticSommaire: 7 }
      }
    });

    const html = await page.evaluate(async () => await chargerCarteModes());
    await page.evaluate((h) => {
      document.querySelectorAll('section').forEach(s => { s.style.display = 'none'; });
      const d = document.createElement('div');
      d.id = 'zoneModes'; d.style.cssText = 'padding:16px';
      d.innerHTML = h;
      document.body.appendChild(d);
    }, html);
    await page.waitForTimeout(150);

    const vu = await page.evaluate(() => {
      const wrap = document.getElementById('zoneModes');
      const scroll = wrap.querySelector('.admin-modes-scroll');
      const entetes = Array.from(wrap.querySelector('.admin-modes-header').querySelectorAll('span'));
      const cellules = Array.from(wrap.querySelector('.admin-modes-row').querySelectorAll('span'));
      // On glisse jusqu'au bout, comme le ferait le fondateur au doigt.
      scroll.scrollLeft = scroll.scrollWidth;
      const zone = scroll.getBoundingClientRect();
      const derniere = cellules[cellules.length - 1].getBoundingClientRect();
      return {
        glissable: scroll.scrollWidth > scroll.clientWidth,
        overflowX: getComputedStyle(scroll).overflowX,
        derniereColonne: entetes[entetes.length - 1].textContent.trim(),
        valeurNonAbonne: cellules[cellules.length - 1].textContent.trim(),
        nonAbonneVisibleApresGlissement: derniere.left >= zone.left - 1 && derniere.right <= zone.right + 1,
        nomDeModeFige: getComputedStyle(cellules[0]).position
      };
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    assert.equal(vu.glissable, true,
      'CHOIX ASSUMÉ : le tableau doit rester plus large que l\'écran et se faire glisser');
    assert.equal(vu.overflowX, 'auto', 'et le conteneur doit permettre de glisser');
    assert.match(vu.derniereColonne, /Non-abonné/);
    assert.equal(vu.nonAbonneVisibleApresGlissement, true,
      'une fois glissé au bout, la colonne Non-abonné doit être entièrement lisible');
    assert.equal(vu.valeurNonAbonne, '7', 'et sa valeur doit être la bonne');
    assert.equal(vu.nomDeModeFige, 'sticky',
      'la colonne des noms de mode reste figée, sinon on perd la ligne qu\'on lit en glissant');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('« Inactif » tient compte de la PRÉSENCE, pas seulement des générations', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage();
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));

    await ouvrirAdmin(page, baseUrl, {
      ok: true,
      codes: [
        // Connecté à l'instant, mais n'a jamais rien généré : c'est le cas
        // exact du propriétaire. Il ne doit PAS être déclaré inactif.
        { code: 'FIFAB5S9', plan: 'creator', actif: true, expire_le: null },
        // Vraiment parti depuis longtemps.
        { code: 'PARTI1', plan: 'pro', actif: true, expire_le: null },
        // Jamais vu du tout : on ne sait rien, on ne doit donc inventer
        // aucune durée.
        { code: 'INCONNU1', plan: 'creator', actif: true, expire_le: null },
        // Désactivé : n'a rien à faire dans cette carte.
        { code: 'DESACTIVE1', plan: 'creator', actif: false, expire_le: null }
      ],
      codesActifsRecents: [],
      derniereActiviteParCode: {
        FIFAB5S9: new Date().toISOString(),
        PARTI1: ilYaJours(41)
      },
      erreursParMode: {}, erreursTotal: 0, erreursRecentes: [],
      parModePlan: { fondateur: {}, pro: {}, creator: {}, nonAbonne: {} }
    });

    const vu = await page.evaluate(async () => {
      await chargerCarteAbonnes();
      await chargerCarteModes();
      const d = document.createElement('div');
      d.id = 'zoneInactifs';
      d.innerHTML = carteInactifsAdmin();
      document.body.appendChild(d);
      return Array.from(d.querySelectorAll('.audit-sujet')).map(l => l.textContent.trim());
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');
    const tout = vu.join(' | ');
    assert.ok(!/FIFAB5S9/.test(tout),
      'REGRESSION : un abonné connecté à l\'instant était affiché « Inactif depuis 14 j » : ' + tout);
    assert.ok(!/DESACTIVE1/.test(tout), 'un abonné désactivé n\'a rien à faire dans cette carte : ' + tout);
    assert.match(tout, /PARTI1/, 'un abonné réellement parti doit rester signalé : ' + tout);
    assert.match(tout, /41 j/,
      'REGRESSION : la durée était écrite EN DUR ("14 j") pour tout le monde : ' + tout);
    assert.match(tout, /INCONNU1[\s\S]*Jamais vu|Jamais vu[\s\S]*INCONNU1/,
      'sans aucune donnée, on le dit franchement plutôt que d\'inventer un nombre : ' + tout);
  } finally {
    await navigateur.close();
    await arreter();
  }
});

// Côté serveur : c'est là que la vraie date est construite. On vérifie que
// les DEUX sources sont croisées (générations et présence), que la plus
// récente gagne, et que la casse du code n'a aucune importance (un code créé
// à la main en casse mixte dans `abonnes` est un cas réel déjà connu).
const path = require('node:path');

test('la dernière activité croise les générations ET la présence, quelle que soit la casse', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.CODE_ADMIN = 'SCRIPTURA-CELINE';

  const fetchOriginal = global.fetch;
  const vuPresence = { appele: false };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    const ok = (rows) => ({ ok: true, status: 200, json: async () => rows,
      headers: { get: (h) => h.toLowerCase() === 'content-range' ? '*/0' : null } });

    if (u.pathname === '/rest/v1/presence') {
      vuPresence.appele = true;
      // La présence connaît un abonné que les générations ignorent, et elle
      // le connaît PLUS RÉCEMMENT : c'est tout l'objet du correctif.
      return ok([
        { ref: 'FIFAB5S9', derniere_activite: ilYaJours(0) },
        { ref: 'ANCIEN1', derniere_activite: ilYaJours(60) }
      ]);
    }
    if (u.pathname === '/rest/v1/abonnes' && method === 'HEAD') return ok(null);
    if (u.pathname === '/rest/v1/abonnes') {
      return ok([
        { code: 'FIFAB5S9', plan: 'creator', actif: true, expire_le: null },
        { code: 'Ancien1', plan: 'pro', actif: true, expire_le: null }
      ]);
    }
    if (u.pathname === '/rest/v1/generations') {
      const select = u.searchParams.get('select') || '';
      if (select.includes('mode')) {
        return ok([
          // Une génération ANCIENNE pour FIFAB5S9 : la présence, plus
          // récente, doit l'emporter.
          { mode: 'script', code_acces: 'FIFAB5S9', cree_le: ilYaJours(20) },
          // Et une génération RÉCENTE pour un code en casse mixte côté
          // abonnés : elle doit quand même être retrouvée.
          { mode: 'story', code_acces: 'ANCIEN1', cree_le: ilYaJours(3) }
        ]);
      }
      return ok([]);
    }
    return ok([]);
  };

  try {
    const handlerModule = await import(path.join(__dirname, '..', 'api', 'data.js') + '?t=' + Date.now());
    const res = { _json: null, status() { return this; }, json(o) { this._json = o; return this; } };
    await handlerModule.default({ method: 'POST', body: { resource: 'admin-stats', code_acces: 'SCRIPTURA-CELINE' } }, res);

    const parCode = res._json && res._json.derniereActiviteParCode;
    assert.ok(parCode, 'la réponse doit porter la dernière activité par code : ' + JSON.stringify(res._json));
    assert.equal(vuPresence.appele, true,
      'REGRESSION : sans lire la présence, un abonné connecté qui ne génère rien passe pour mort');

    const jours = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
    assert.ok(jours(parCode.FIFAB5S9) <= 1,
      'la présence (aujourd\'hui) doit primer sur une génération vieille de 20 jours : ' + parCode.FIFAB5S9);
    assert.equal(jours(parCode.ANCIEN1), 3,
      'la génération (3 j) doit primer sur une présence vieille de 60 jours, et la clé être en majuscules : '
      + JSON.stringify(parCode));
  } finally {
    global.fetch = fetchOriginal;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CODE_ADMIN;
  }
});

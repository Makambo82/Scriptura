// Question du propriétaire : « est-ce que l'app est parfaitement calibrée
// pour mobile et PC ? » Mesuré plutôt que supposé, sur six largeurs et huit
// écrans, et ce test fige les deux constats qui comptent vraiment.
//
// 1. LE DÉBORDEMENT HORIZONTAL. C'est le défaut qui ruine une app sur
//    téléphone : un seul élément trop large et TOUTE la page se met à glisser
//    latéralement, sur tous les écrans à la fois. Un test qui vérifie la mise
//    en page écran par écran ne l'attrape pas ; il faut mesurer la largeur
//    réelle du document contre celle de la fenêtre.
//
// 2. LES CIBLES TACTILES, mesurées AU DOIGT et non à la boîte. Un bouton peut
//    être petit à l'écran et large au toucher (remplissage transparent,
//    pseudo-élément), et l'inverse est vrai aussi. Lire des dimensions CSS
//    donne donc une fausse réponse dans les deux sens : on sonde la page avec
//    elementFromPoint, comme le ferait un vrai pouce.
//    L'audit avait trouvé la croix du tiroir à 23x29 et le bouton « Retour »
//    à 61x11, très en dessous des 44x44 recommandés par Apple comme par
//    Material.
const test = require('node:test');
const assert = require('node:assert/strict');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const LARGEURS = [
  { nom: 'Android compact', l: 360, h: 740 },
  { nom: 'iPhone 14', l: 390, h: 844 },
  { nom: 'iPad portrait', l: 768, h: 1024 },
  { nom: 'Ordinateur', l: 1280, h: 800 }
];

async function ouvrir(navigateur, baseUrl, vp) {
  const page = await navigateur.newPage({ viewport: { width: vp.l, height: vp.h } });
  await poserMocksReseau(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return page;
}

test('aucun débordement horizontal, d\'un Android compact à un grand écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const fautifs = [];
    for (const vp of LARGEURS) {
      const page = await ouvrir(navigateur, baseUrl, vp);
      const erreursJs = [];
      page.on('pageerror', e => erreursJs.push(e.message));

      // On passe par les écrans principaux : un débordement peut n'exister
      // que sur un seul mode.
      for (const aller of [null, 'script', 'story', 'carrousel', 'serie', 'audit']) {
        if (aller) {
          await page.evaluate((m) => { if (typeof chooseMode === 'function') chooseMode(m); }, aller);
          await page.waitForTimeout(250);
        }
        const r = await page.evaluate(() => {
          const largeur = document.documentElement.clientWidth;
          const trop = document.documentElement.scrollWidth - largeur;
          const qui = [];
          if (trop > 1) {
            document.querySelectorAll('body *').forEach(el => {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') return;
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.height === 0) return;
              if (b.right > largeur + 1) {
                qui.push((el.id ? '#' + el.id : '.' + String(el.className).split(/\s+/)[0])
                  + ' déborde de ' + Math.round(b.right - largeur) + 'px');
              }
            });
          }
          return { trop, qui: [...new Set(qui)].slice(0, 4) };
        });
        if (r.trop > 1) fautifs.push(vp.nom + ' / ' + (aller || 'accueil') + ' : +' + r.trop + 'px (' + r.qui.join(', ') + ')');
      }
      assert.deepEqual(erreursJs, [], 'aucune erreur JS sur ' + vp.nom);
      await page.close();
    }

    assert.deepEqual(fautifs, [],
      'REGRESSION : la page déborde horizontalement. ' + fautifs.join(' | ') + '. Un seul élément trop '
      + 'large fait glisser TOUTE la page latéralement, sur tous les écrans à la fois.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

test('les commandes principales restent atteignables au pouce (44px)', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const trop = [];
    // Les commandes ICÔNES ou omniprésentes : celles qu'on vise vite, et dont
    // un ratage coûte le plus. Les boutons pleins de texte, larges par nature,
    // ne sont pas dans cette liste.
    const CIBLES = [
      { sel: '.sidebar-close', ouvrir: 'openSidebar' },
      { sel: '#creerBtn', ouvrir: null },
      { sel: '.btn-back', ouvrir: null },
      { sel: '.preuve-galerie-arrow', ouvrir: null }
    ];

    for (const vp of LARGEURS.slice(0, 2)) { // les deux téléphones : c'est là que le pouce compte
      const page = await ouvrir(navigateur, baseUrl, vp);
      await page.evaluate(() => { if (typeof chooseMode === 'function') chooseMode('script'); });
      await page.waitForTimeout(300);

      for (const c of CIBLES) {
        if (c.ouvrir) {
          await page.evaluate((f) => { if (typeof window[f] === 'function') window[f](); }, c.ouvrir);
          await page.waitForTimeout(300);
        }
        const mesure = await page.evaluate((sel) => {
          const el = Array.from(document.querySelectorAll(sel))
            .find(e => {
              const b = e.getBoundingClientRect();
              const cs = getComputedStyle(e);
              return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
                && b.top > 0 && b.bottom < innerHeight && b.left > 0 && b.right < innerWidth;
            });
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          const touche = (x, y) => {
            const t = document.elementFromPoint(x, y);
            return !!t && (t === el || el.contains(t));
          };
          if (!touche(cx, cy)) return null; // recouvert : un autre test s'en charge
          const portee = (dx, dy) => {
            let d = 0;
            for (let k = 2; k <= 24; k += 2) { if (!touche(cx + dx * k, cy + dy * k)) break; d = k; }
            return d;
          };
          return { h: portee(0, -1) + portee(0, 1), l: portee(-1, 0) + portee(1, 0) };
        }, c.sel);

        if (!mesure) continue; // absente de cet écran : rien à mesurer
        if (mesure.h < 40 || mesure.l < 40) {
          trop.push(vp.nom + ' ' + c.sel + ' : ' + mesure.l + 'x' + mesure.h + ' atteignable');
        }
      }
      await page.close();
    }

    assert.deepEqual(trop, [],
      'REGRESSION : commande(s) trop petite(s) au pouce. ' + trop.join(' | ') + '. Apple et Material '
      + 'recommandent 44x44 minimum, et ce sont les commandes qu\'on vise le plus vite.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

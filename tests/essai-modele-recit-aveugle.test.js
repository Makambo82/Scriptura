// La critique et la révision du récit tournent sur Sonnet, trois fois le prix
// de Haiku en entrée comme en sortie, et sur les deux passes les plus lourdes
// du mode. Valent-elles leur prix ? Ça ne se tranche pas au calcul, seulement
// à l'œil, et à l'aveugle : celui qui règle le modèle lui-même sait lequel il
// vient de choisir et lit le résultat en le sachant.
//
// DEUX PIÈGES, ET CE FICHIER NE SERT QU'À ÇA :
//
// 1. LE PARTAGE DE CONSTANTE. MODEL_QUALITE_RECIT servait DEUX rôles sans
//    rapport : la critique/révision du récit, et la SECONDE TENTATIVE DU JUGE
//    dans trois modes (script, récit, série). Le juge principal tourne sur
//    Haiku ; sa relance n'a de sens que sur un modèle réellement différent.
//    Basculer « la constante du récit » sur Haiku pour économiser aurait donc
//    fait retomber le juge de secours sur le modèle du juge principal, et
//    supprimé en silence la seule raison d'être de cette relance, dans trois
//    modes dont le score, pilier de crédibilité de l'app.
//
// 2. LE TIRAGE PAR APPEL. La critique et la révision du MÊME récit doivent
//    tomber sur le MÊME modèle. Un tirage par appel livrerait un récit
//    critiqué par l'un et révisé par l'autre : plus rien de comparable, et
//    l'essai conclurait sur du bruit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrerServeur } = require('./helpers/serveur');
const { lancerNavigateur } = require('./helpers/navigateur');
const { poserMocksReseau } = require('./helpers/mocks');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

test('les deux rôles ne partagent plus une seule constante de modèle', () => {
  const api = lire('api.js');
  assert.match(api, /const MODEL_JUGE_SECOURS = /,
    'REGRESSION : la constante du juge de secours a disparu. Les deux rôles repartagent une seule '
    + 'valeur, et le prochain qui touche au modèle du récit basculera le juge sans le voir.');
  assert.match(api, /const MODEL_QUALITE_RECIT = /, 'la constante de la critique/révision doit rester');

  // Le point qui compte vraiment : les trois juges de secours ne doivent plus
  // JAMAIS lire la constante du récit. C'est ce lien-là qui était le piège.
  for (const f of ['generation.js', 'serie.js']) {
    assert.ok(!lire(f).includes('MODEL_QUALITE_RECIT'),
      'REGRESSION : ' + f + ' lit encore MODEL_QUALITE_RECIT. Ce fichier n\'a pas de récit à '
      + 'critiquer : c\'est son JUGE DE SECOURS qui est branché dessus, et changer le modèle du '
      + 'récit le casserait sans qu\'aucun test du mode récit ne bronche.');
  }
  const st = lire('storytelling.js');
  assert.match(st, /evaluerRecitGenere\(texteFinal, MODEL_JUGE_SECOURS\)/,
    'REGRESSION : la seconde tentative du juge du récit ne passe plus par sa propre constante.');
});

test('la critique ET la révision passent par la même fonction, jamais par la constante', () => {
  const st = lire('storytelling.js');
  const critique = /callAI\(modeleQualiteRecit\(\), 2500,/.test(st);
  const revision = /callAI\(modeleQualiteRecit\(\), 8000,/.test(st);
  assert.ok(critique, 'REGRESSION : la critique du récit n\'appelle plus modeleQualiteRecit().');
  assert.ok(revision, 'REGRESSION : la révision du récit n\'appelle plus modeleQualiteRecit().');
  assert.ok(!/callAI\(MODEL_QUALITE_RECIT/.test(st),
    'REGRESSION : une des deux passes lit encore la constante en dur. Elle échapperait alors à '
    + 'l\'essai, qui comparerait un bras à lui-même sans le dire.');

  // UN SEUL tirage, au début de la génération. Deux appels signifieraient un
  // modèle par passe, donc un récit mi-Sonnet mi-Haiku.
  const tirages = (st.match(/tirerModeleQualiteRecit\(\)/g) || []).length;
  assert.equal(tirages, 1,
    'REGRESSION : ' + tirages + ' tirage(s) dans storytelling.js. Il en faut exactement UN, au début '
    + 'de generateStory : un tirage par passe donnerait un récit critiqué par un modèle et révisé '
    + 'par l\'autre, et l\'essai conclurait sur du bruit.');
});

test('à l\'aveugle : tiré une fois, stable pour tout le récit, et muet à l\'écran', async () => {
  const { baseUrl, arreter } = await demarrerServeur();
  const navigateur = await lancerNavigateur();
  try {
    const page = await navigateur.newPage({ viewport: { width: 414, height: 900 } });
    await poserMocksReseau(page);
    const erreursJs = [];
    page.on('pageerror', e => erreursJs.push(e.message));
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const vu = await page.evaluate(() => {
      const out = {};

      // ── Hors essai : comportement rigoureusement identique à avant ──
      localStorage.removeItem('scriptura_essai_modele_recit');
      localStorage.setItem('scriptura_is_admin', 'true');
      tirerModeleQualiteRecit();
      out.horsEssai = modeleQualiteRecit();

      // ── Un NON-ADMIN ne peut pas l'armer, et un essai déjà armé ne
      //    l'atteint pas : un créateur qui paie n'est pas un cobaye ──
      localStorage.setItem('scriptura_is_admin', 'false');
      out.armementRefuse = armerEssaiModeleRecit();
      localStorage.setItem('scriptura_essai_modele_recit', '1');
      tirerModeleQualiteRecit();
      out.nonAdmin = modeleQualiteRecit();

      // ── Admin, essai armé : le tirage tombe dans la paire, et RESTE le
      //    même tant qu'on ne retire pas ──
      localStorage.setItem('scriptura_is_admin', 'true');
      out.armementAccepte = armerEssaiModeleRecit();
      const stables = [];
      const vus = {};
      for (let i = 0; i < 40; i++) {
        tirerModeleQualiteRecit();
        const a = modeleQualiteRecit();
        const b = modeleQualiteRecit();   // la seconde passe du MÊME récit
        stables.push(a === b);
        vus[a] = true;
      }
      out.stable = stables.every(Boolean);
      out.modelesVus = Object.keys(vus).sort();

      // ── Le tirage est noté, mais rien n'est écrit à l'écran ──
      localStorage.removeItem('scriptura_essai_modele_recit_tirages');
      tirerModeleQualiteRecit();
      noterTirageEssaiRecit('Le récit de test');
      out.notes = JSON.parse(localStorage.getItem('scriptura_essai_modele_recit_tirages') || '[]');
      out.pageMuette = !document.body.innerText.match(/sonnet|haiku/i);

      // ── Désarmement : on revient exactement au modèle normal ──
      desarmerEssaiModeleRecit();
      tirerModeleQualiteRecit();
      out.apresDesarmement = modeleQualiteRecit();
      out.constante = MODEL_QUALITE_RECIT;
      return out;
    });

    assert.deepEqual(erreursJs, [], 'aucune erreur JS');

    assert.equal(vu.horsEssai, vu.constante,
      'REGRESSION : hors essai, le récit ne part plus sur son modèle normal. Un dispositif de mesure '
      + 'qui change le produit quand il est éteint ne mesure plus rien.');

    assert.equal(vu.armementRefuse, false,
      'REGRESSION : un compte non-admin peut armer l\'essai.');
    assert.equal(vu.nonAdmin, vu.constante,
      'REGRESSION : un essai resté armé s\'applique à un compte non-admin. Un créateur qui paie se '
      + 'retrouverait cobaye sans le savoir, et sur la passe qui décide de la qualité livrée.');

    assert.equal(vu.armementAccepte, true, 'l\'admin doit pouvoir armer');
    assert.equal(vu.stable, true,
      'REGRESSION : les deux passes d\'un même récit ne tombent pas sur le même modèle. Le récit livré '
      + 'serait critiqué par l\'un et révisé par l\'autre, et l\'essai comparerait du bruit.');
    assert.deepEqual(vu.modelesVus, ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
      'REGRESSION : sur 40 tirages, les deux bras ne sont pas sortis. Vus : '
      + JSON.stringify(vu.modelesVus) + '. Un essai qui ne tire qu\'un seul modèle ne compare rien.');

    assert.equal(vu.notes.length, 1, 'le tirage doit être noté pour pouvoir être révélé après coup');
    assert.equal(vu.notes[0].titre, 'Le récit de test', 'noté avec le titre, sinon impossible à relier');
    assert.match(vu.notes[0].modele, /sonnet|haiku/,
      'le modèle tiré doit être noté : ' + JSON.stringify(vu.notes[0]));
    assert.equal(vu.pageMuette, true,
      'REGRESSION : le nom d\'un modèle s\'affiche dans la page. L\'essai n\'est plus à l\'aveugle, et '
      + 'c\'est tout ce qui le rendait honnête.');

    assert.equal(vu.apresDesarmement, vu.constante,
      'REGRESSION : après désarmement, le récit ne revient pas sur son modèle normal. L\'essai est '
      + 'temporaire, il doit se retirer sans laisser de trace.');
  } finally {
    await navigateur.close();
    await arreter();
  }
});

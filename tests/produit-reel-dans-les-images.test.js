// LA fonctionnalité que le propriétaire attendait depuis longtemps, dans ses
// mots : « un utilisateur qui veut vendre un produit charge la photo de son
// produit. S'il faisait une vidéo face caméra, il garderait le produit en
// main. Même sans nous, il demanderait à ChatGPT ou Gemini de générer des
// images où on voit le produit en utilisation : un habit porté, une montre
// au poignet, une pommade tenue en main. Avec nous ce n'était pas possible,
// ça me fait très mal. »
//
// Ça avait été refusé deux fois, et pour une raison qui était vraie ALORS :
// on n'envoyait qu'un TEXTE au générateur d'images, qui ne pouvait donc
// produire qu'un SOSIE (faux logo, étiquette en charabia). La tentative
// suivante, DÉTOURER la photo pour la coller dans un décor, a raté deux fois,
// d'où l'abandon. Le détourage n'était pas la bonne route : on passe
// maintenant la photo au modèle EN RÉFÉRENCE, et c'est lui qui redessine la
// scène autour du vrai produit.
//
// Ce fichier verrouille les trois choses qui font que cette fonctionnalité
// tient ou s'effondre :
//   1. la photo part VRAIMENT, et seulement sur les plans marqués ;
//   2. un échec ne livre JAMAIS une image sans le produit (le sosie est pire
//      que rien, c'est la règle du propriétaire, et le prompt de ces plans-là
//      réclame « le produit de l'image de référence ») ;
//   3. un PDF n'est jamais envoyé comme photo de produit.
const test = require('node:test');
const assert = require('node:assert/strict');

const PHOTO = { base64: 'UklGRhIAAABXRUJQ', mediaType: 'image/jpeg' };

function poserEnv(extra) {
  const avant = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://exemple.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'cle-service-role-test',
    TOGETHER_API_KEY: 'cle-together-test',
    CODE_ADMIN: 'ADMIN-TEST'
  }, extra || {});
  return () => { process.env = avant; };
}

function creerRes() {
  const res = { statutRecu: null, corpsRecu: null, headers: {} };
  res.status = (s) => { res.statutRecu = s; return res; };
  res.json = (b) => { res.corpsRecu = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.send = (b) => { res.corpsRecu = b; return res; };
  return res;
}

// Mock réseau : les droits et le quota passent, et chaque appel à Together
// est enregistré pour qu'on puisse regarder EXACTEMENT ce qui a été envoyé.
function poserFetchMock(reponsePourAppel) {
  const appels = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) {
      return { ok: true, json: async () => ([{ code_acces: 'ADMIN-TEST', plan: 'pro', statut: 'actif' }]) };
    }
    if (u.includes('/rest/v1/rpc/')) return { ok: true, json: async () => true };
    if (u.includes('api.together.xyz')) {
      const corps = JSON.parse(opts.body);
      appels.push(corps);
      return reponsePourAppel(corps, appels.length);
    }
    return { ok: true, json: async () => ({}) };
  };
  return appels;
}

const OK_IMAGE = { ok: true, json: async () => ({ data: [{ b64_json: 'AAAA' }] }) };

async function appeler(body) {
  const mod = await import('../api/montage-media.js?t=' + Math.random());
  const res = creerRes();
  await mod.default(
    { method: 'POST', query: { action: 'images' }, body },
    res
  );
  return res;
}

test('la photo du produit part au générateur, et SEULEMENT sur les plans marqués', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    const res = await appeler({
      prompts: ['a hand holding the product shown in the reference image 9:16', 'a woman looking at the sea 9:16'],
      format: '9:16',
      code_acces: 'ADMIN-TEST',
      produit: PHOTO,
      avecProduit: [true, false]
    });

    assert.equal(res.statutRecu, 200, 'la génération doit aboutir : ' + JSON.stringify(res.corpsRecu));
    assert.equal(appels.length, 2, 'deux prompts, deux appels');

    const avec = appels[0], sans = appels[1];
    const reference = avec.reference_images ? avec.reference_images[0] : avec.image_url;
    assert.ok(reference,
      'REGRESSION : le plan marqué part SANS la photo du produit. C\'est toute la fonctionnalité : '
      + 'sans référence, le modèle invente un objet, et le créateur reçoit un faux produit. Envoyé : '
      + JSON.stringify(Object.keys(avec)));
    assert.ok(String(reference).startsWith('data:image/jpeg;base64,'),
      'la photo doit partir en data URI complet, pas en base64 nu : ' + String(reference).slice(0, 40));
    assert.ok(String(reference).includes(PHOTO.base64), 'c\'est bien la photo du créateur qui part');

    assert.ok(!sans.reference_images && !sans.image_url,
      'REGRESSION : la photo est envoyée sur un plan NON marqué. Le produit sur chaque image en ferait '
      + 'une publicité, et chaque référence coûte plus cher pour rien.');
  } finally {
    restaurer();
  }
});

// Deuxième retour du propriétaire, et c'est LE point qui manquait : « un
// utilisateur peut charger la photo de son produit qui n'est pas sur fond
// blanc, ni noir, ni transparent. C'est à toi de savoir détecter le produit à
// vendre et de le mettre dans ses conditions réelles d'utilisation, sans
// détourer. »
//
// Sa vraie photo est prise sur un sol d'atelier, avec des outils autour. Une
// image de référence livrée sans consigne, c'est le risque que le modèle
// reproduise l'atelier avec, ou qu'il hésite sur ce qui EST le produit. Le
// découpage se fait donc dans la tête du modèle : on lui dit que seul le
// produit compte, et on le lui NOMME. Aucun ciseau, juste une consigne.
test('la consigne dit au modèle d\'ignorer le fond de la photo et de garder le seul produit', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    await appeler({
      prompts: ['a woman walking in a sunlit street 9:16'],
      format: '9:16', code_acces: 'ADMIN-TEST',
      produit: { ...PHOTO, nom: 'a brown leather bracelet' },
      avecProduit: [true]
    });

    const envoye = appels[0].prompt;
    assert.match(envoye, /a brown leather bracelet/,
      'REGRESSION : le produit détecté n\'est plus nommé au modèle. C\'est ce nom qui lui permet de '
      + 'reconnaître l\'objet à garder au milieu d\'une photo encombrée : ' + envoye);
    assert.match(envoye, /ONLY the product/i,
      'REGRESSION : plus rien ne dit de ne garder QUE le produit. Sans ça, le fond de la photo du '
      + 'créateur (un sol d\'atelier, une table encombrée) peut se retrouver dans l\'image livrée.');
    assert.match(envoye, /background[\s\S]*must NOT appear/i,
      'REGRESSION : la consigne n\'exclut plus explicitement le fond de la photo de référence');
    assert.match(envoye, /same colours[\s\S]*same logo/i,
      'REGRESSION : la fidélité exacte du produit n\'est plus exigée. C\'est toute la raison d\'être '
      + 'de la référence : le client qui reçoit le vrai produit doit voir le même.');
    assert.ok(/\s9:16$/.test(envoye),
      'REGRESSION : le format n\'est plus le dernier élément du prompt. Les générateurs le lisent à la '
      + 'fin ; ailleurs, il est ignoré et l\'image sort au mauvais cadrage. Reçu : ' + envoye.slice(-60));
  } finally {
    restaurer();
  }
});

test('sans nom détecté, la consigne reste valable et ne dit pas n\'importe quoi', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    // La détection peut échouer (photo illisible, réponse invalide). La
    // référence garde tout son sens : elle désigne « le produit », sans nom.
    await appeler({
      prompts: ['a hand on a table 9:16'], format: '9:16', code_acces: 'ADMIN-TEST',
      produit: PHOTO, avecProduit: [true]
    });
    const envoye = appels[0].prompt;
    assert.match(envoye, /ONLY the product/i, 'la consigne d\'ignorer le fond reste, elle vaut sans nom');
    assert.ok(!/which is\s*\./.test(envoye) && !/which is\s*,/.test(envoye),
      'REGRESSION : une phrase tronquée part au modèle quand le nom manque : ' + envoye);
  } finally {
    restaurer();
  }
});

test('la consigne produit ne pollue JAMAIS une image ordinaire', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    await appeler({
      prompts: ['a storm over the ocean 9:16', 'a hand holding it 9:16'],
      format: '9:16', code_acces: 'ADMIN-TEST',
      produit: { ...PHOTO, nom: 'a white cream tube' },
      avecProduit: [false, true]
    });
    assert.ok(!/REFERENCE IMAGE/i.test(appels[0].prompt),
      'REGRESSION : un plan sans produit reçoit la consigne de référence. Elle parlerait d\'une image '
      + 'de référence qui n\'est pas jointe, et le modèle inventerait un produit pour lui obéir.');
    assert.match(appels[1].prompt, /REFERENCE IMAGE/i, 'le plan marqué, lui, la reçoit bien');
  } finally {
    restaurer();
  }
});

test('sans plan marqué, l\'appel est exactement celui d\'avant', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    await appeler({ prompts: ['a quiet kitchen at dawn 9:16'], format: '9:16', code_acces: 'ADMIN-TEST' });
    assert.equal(appels.length, 1);
    assert.ok(!('reference_images' in appels[0]) && !('image_url' in appels[0]),
      'REGRESSION : un appel sans produit emporte un paramètre de référence. Hors objectif Ventes, '
      + 'RIEN ne doit changer.');
  } finally {
    restaurer();
  }
});

test('si la référence échoue, on ne livre JAMAIS une image sans le produit', async () => {
  const restaurer = poserEnv();
  // Together refuse les DEUX formes de paramètre : la seule issue honnête est
  // l'échec. Livrer l'image quand même donnerait un produit inventé sur un
  // prompt qui réclame « le produit de l'image de référence ».
  const appels = poserFetchMock(() => ({
    ok: false, status: 400,
    json: async () => ({ error: { message: 'Unknown parameter: reference_images / image_url' } })
  }));
  try {
    const res = await appeler({
      prompts: ['a hand holding the product shown in the reference image 9:16'],
      format: '9:16', code_acces: 'ADMIN-TEST',
      produit: PHOTO, avecProduit: [true]
    });

    assert.equal(res.statutRecu, 200, 'la route répond, c\'est l\'image qui échoue');
    assert.equal(res.corpsRecu.images[0], null,
      'REGRESSION : une image est livrée alors que le produit n\'a pas pu être intégré. Le prompt de ce '
      + 'plan demande le produit de la photo : sans elle, le modèle en invente un. Un sosie est pire que rien.');
    assert.match(String(res.corpsRecu.erreurs[0]), /produit n'a pas pu être intégré/,
      'l\'erreur doit dire au créateur CE QUI a échoué, pas un message générique : ' + res.corpsRecu.erreurs[0]);

    // Les deux formes de paramètre ont bien été tentées avant d'abandonner.
    const formes = appels.map(a => (a.reference_images ? 'reference_images' : (a.image_url ? 'image_url' : 'aucune')));
    assert.deepEqual(formes, ['reference_images', 'image_url'],
      'REGRESSION : les deux formes documentées ne sont plus essayées. Tentées : ' + formes.join(', '));
  } finally {
    restaurer();
  }
});

test('une erreur ordinaire ne fait pas rejouer l\'appel avec l\'autre forme', async () => {
  const restaurer = poserEnv();
  // Une panne, une modération, un quota côté Together : réessayer avec un
  // autre nom de paramètre ne réparerait rien et se ferait facturer deux fois.
  const appels = poserFetchMock(() => ({
    ok: false, status: 500, json: async () => ({ error: { message: 'Internal server error' } })
  }));
  try {
    await appeler({
      prompts: ['a hand holding the product shown in the reference image 9:16'],
      format: '9:16', code_acces: 'ADMIN-TEST',
      produit: PHOTO, avecProduit: [true]
    });
    assert.equal(appels.length, 1,
      'REGRESSION : ' + appels.length + ' appels facturés pour une erreur qui n\'a rien à voir avec le '
      + 'nom du paramètre. Seul un refus explicite du paramètre justifie de réessayer.');
  } finally {
    restaurer();
  }
});

test('un PDF joint n\'est jamais envoyé comme photo de produit', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    await appeler({
      prompts: ['a hand holding a product 9:16'], format: '9:16', code_acces: 'ADMIN-TEST',
      produit: { base64: 'JVBERi0xLjQK', mediaType: 'application/pdf' },
      avecProduit: [true]
    });
    assert.ok(!appels[0].reference_images && !appels[0].image_url,
      'REGRESSION : un PDF part comme image de référence. Une brochure nourrit l\'écriture du script, '
      + 'elle ne se met pas dans la main de quelqu\'un.');
  } finally {
    restaurer();
  }
});

test('une photo trop lourde est refusée avec un message clair, sans rien dépenser', async () => {
  const restaurer = poserEnv();
  const appels = poserFetchMock(() => OK_IMAGE);
  try {
    const res = await appeler({
      prompts: ['a hand holding the product shown in the reference image 9:16'],
      format: '9:16', code_acces: 'ADMIN-TEST',
      produit: { base64: 'A'.repeat(5 * 1024 * 1024), mediaType: 'image/png' },
      avecProduit: [true]
    });
    assert.equal(res.statutRecu, 400);
    assert.match(String(res.corpsRecu.error.message), /trop lourde/);
    assert.equal(appels.length, 0,
      'REGRESSION : on a appelé Together malgré une photo hors limites. La requête aurait cassé côté '
      + 'hébergeur, avec une erreur incompréhensible pour le créateur, et facturée.');
  } finally {
    restaurer();
  }
});

// Carte « Crédits API » du Tableau de bord (demande du propriétaire, 18
// novembre : « est-ce possible de voir le crédit restant des API de l'app ? »).
//
// Anthropic et Together n'exposent aucun solde par programme : l'app compte ce
// qu'elle dépense (api/_lib/depenses.js) et le propriétaire saisit son solde à
// chaque recharge. ElevenLabs et TikHub, eux, se lisent directement. Ces tests
// verrouillent les chiffres (un solde faux est pire que pas de solde), le fait
// qu'une panne de comptage ne bloque jamais une génération, et qu'aucun secret
// ne sort de la réponse.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/fetch-fidele').rendreLesMocksFideles();

const importer = (chemin) => import(chemin + '?t=' + Date.now() + '-' + Math.random());

function poserEnv() {
  process.env.SUPABASE_URL = 'https://exemple.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-role-test';
  process.env.CODE_ADMIN = 'ADMIN-TEST';
  process.env.ELEVENLABS_API_KEY = 'cle-eleven';
  process.env.TIKHUB_API_KEY = 'cle-tikhub';
}
function retirerEnv() {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CODE_ADMIN', 'ELEVENLABS_API_KEY', 'TIKHUB_API_KEY']) delete process.env[k];
}
const reponse = (corps, status = 200) => ({ ok: status < 400, status, text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)), json: async () => corps });

// ───────── calculs purs ─────────

test('dépense Anthropic : tarifs Haiku et Sonnet, cache, recherches web, modèle inconnu = tarif Sonnet', async () => {
  const { depenseAnthropicCentimes } = await importer('../api/_lib/depenses.js');
  // Haiku 4.5 : 1 $ le million en entrée, 5 $ en sortie
  assert.equal(depenseAnthropicCentimes([
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_entree_2026-11', used: 1000000 },
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_sortie_2026-11', used: 1000000 }
  ]), 600);
  // Sonnet 4.6 : 3 $ et 15 $
  assert.equal(depenseAnthropicCentimes([
    { ref: 'depense_anthropic_claude-sonnet-4-6_entree_2026-11', used: 1000000 },
    { ref: 'depense_anthropic_claude-sonnet-4-6_sortie_2026-11', used: 1000000 }
  ]), 1800);
  // lecture du cache : 10 % du prix d'entrée ; écriture : 125 %
  assert.equal(depenseAnthropicCentimes([
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_cachelu_2026-11', used: 1000000 },
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_cacheecrit_2026-11', used: 1000000 }
  ]), 135);
  // 100 recherches web = 1 $
  assert.equal(depenseAnthropicCentimes([{ ref: 'depense_anthropic_claude-haiku-4-5-20251001_recherches_2026-11', used: 100 }]), 100);
  // un modèle inconnu est facturé au tarif Sonnet : on surestime plutôt que de laisser croire à plus de marge
  assert.equal(depenseAnthropicCentimes([{ ref: 'depense_anthropic_modele-futur_entree_2026-11', used: 1000000 }]), 300);
  // les mois s'additionnent ; les lignes étrangères et les valeurs nulles sont ignorées
  assert.equal(depenseAnthropicCentimes([
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_entree_2026-10', used: 500000 },
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_entree_2026-11', used: 500000 },
    { ref: 'usage_FIFA_creation_2026-11', used: 999999999 },
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_sortie_2026-11', used: 0 },
    null
  ]), 100);
  assert.equal(depenseAnthropicCentimes(undefined), 0);
});

test('dépense Together : images et vidéos au prix réglé, prix par défaut sinon', async () => {
  const { depenseTogetherCentimes } = await importer('../api/_lib/depenses.js');
  const lignes = [
    { ref: 'depense_together_image_2026-11', used: 10 },
    { ref: 'depense_together_video_2026-11', used: 2 },
    { ref: 'depense_together_image_2026-10', used: 5 }
  ];
  assert.equal(depenseTogetherCentimes(lignes), 76, '15 images x 0,04 $ + 2 vidéos x 0,08 $ = 0,76 $');
  assert.equal(depenseTogetherCentimes(lignes, { image: 0.1 }), 166, 'un prix d\'image réglé remplace celui par défaut, la vidéo garde le sien');
});

test('solde estimé : on ne retranche que ce qui s\'est dépensé APRÈS la saisie', async () => {
  const { estimerSolde } = await importer('../api/_lib/depenses.js');
  const maintenant = new Date('2026-11-18T12:00:00Z');
  const saisiLe = '2026-11-10T12:00:00Z'; // il y a 8 jours
  // 2 500 centimes saisis, 1 000 déjà mesurés AVANT la saisie, 3 000 mesurés maintenant : 2 000 dépensés depuis
  const e = estimerSolde({ soldeSaisiCentimes: 2500, baseCentimes: 1000, depenseTotaleCentimes: 3000, saisiLe, maintenant });
  assert.equal(e.depuisCentimes, 2000, 'REGRESSION : la dépense d\'avant la saisie ne doit pas être comptée deux fois');
  assert.equal(e.restantCentimes, 500);
  assert.equal(e.pourcentRestant, 20);
  assert.equal(e.niveau, 'bas', '20 % restants : alerte « bas »');
  assert.equal(e.joursDepuisSaisie, 8);
  assert.equal(e.rythmeParJourCentimes, 250);
  assert.equal(e.joursRestants, 2);
});

test('solde estimé : niveaux ok / bas / critique / épuisé, et jamais de solde négatif affiché', async () => {
  const { estimerSolde } = await importer('../api/_lib/depenses.js');
  const maintenant = new Date('2026-11-18T12:00:00Z');
  const calc = (depense, saisiLe) => estimerSolde({ soldeSaisiCentimes: 10000, baseCentimes: 0, depenseTotaleCentimes: depense, saisiLe: saisiLe || '2026-10-01T00:00:00Z', maintenant });
  assert.equal(calc(1000).niveau, 'ok');
  assert.equal(calc(8000).niveau, 'bas');
  assert.equal(calc(9500).niveau, 'critique');
  const vide = calc(12000);
  assert.equal(vide.niveau, 'epuise');
  assert.equal(vide.restantCentimes, 0, 'un solde estimé ne s\'affiche jamais en négatif');
  // un gros reste mais un rythme qui le vide en moins de 5 jours : alerte quand même
  assert.equal(estimerSolde({ soldeSaisiCentimes: 10000, baseCentimes: 0, depenseTotaleCentimes: 5000, saisiLe: '2026-11-15T12:00:00Z', maintenant }).niveau, 'bas',
    'REGRESSION : 50 % restants mais 17 $ par jour, la panne arrive dans 3 jours');
  // rythme non calculé avant une journée de recul : une grosse génération juste après la saisie ne fait pas hurler
  const frais = estimerSolde({ soldeSaisiCentimes: 10000, baseCentimes: 0, depenseTotaleCentimes: 3000, saisiLe: '2026-11-18T08:00:00Z', maintenant });
  assert.equal(frais.rythmeParJourCentimes, null);
  assert.equal(frais.niveau, 'ok');
  assert.equal(estimerSolde({ soldeSaisiCentimes: undefined, saisiLe: null }), null);
});

// ───────── mesure des dépenses ─────────

test('noterDepenseAnthropic : un compteur par type non nul, ref mensuelle, jamais d\'exception', async () => {
  poserEnv();
  const { noterDepenseAnthropic } = await importer('../api/_lib/depenses.js');
  const appels = [];
  const f0 = global.fetch;
  global.fetch = async (url, opts) => { appels.push({ url: String(url), corps: JSON.parse(opts.body) }); return reponse(true); };
  try {
    await noterDepenseAnthropic('claude-haiku-4-5-20251001', {
      input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 2 }
    }, new Date('2026-11-18T10:00:00Z'));
    const parRef = Object.fromEntries(appels.map(a => [a.corps.p_ref, a.corps.p_increment]));
    assert.deepEqual(parRef, {
      'depense_anthropic_claude-haiku-4-5-20251001_entree_2026-11': 1200,
      'depense_anthropic_claude-haiku-4-5-20251001_sortie_2026-11': 340,
      'depense_anthropic_claude-haiku-4-5-20251001_recherches_2026-11': 2
    });
    assert.ok(appels.every(a => a.url.endsWith('/rest/v1/rpc/consommer_usage')), 'compté par la fonction atomique déjà installée, aucun SQL à lancer');
    appels.length = 0;
    await noterDepenseAnthropic('claude-haiku-4-5-20251001', undefined);
    await noterDepenseAnthropic('', { input_tokens: 5 });
    await noterDepenseAnthropic('claude-haiku-4-5-20251001', { input_tokens: 0, output_tokens: -3 });
    assert.equal(appels.length, 0, 'rien à compter : aucun appel réseau');
  } finally { global.fetch = f0; retirerEnv(); }
});

test('noterDepenseAnthropic / Together : une panne ou un Supabase muet ne fait JAMAIS échouer une génération', async () => {
  poserEnv();
  const { noterDepenseAnthropic, noterDepenseTogether } = await importer('../api/_lib/depenses.js');
  const f0 = global.fetch;
  try {
    global.fetch = async () => { throw new Error('réseau coupé'); };
    await noterDepenseAnthropic('claude-haiku-4-5-20251001', { input_tokens: 10, output_tokens: 10 });
    await noterDepenseTogether('image', 1);
    global.fetch = async () => reponse({ message: 'panne' }, 503);
    await noterDepenseAnthropic('claude-haiku-4-5-20251001', { input_tokens: 10 });
    // pas de clé service_role : on ne tente rien
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let appele = false; global.fetch = async () => { appele = true; return reponse(true); };
    await noterDepenseTogether('video', 1);
    assert.equal(appele, false);
  } finally { global.fetch = f0; retirerEnv(); }
});

test('noterDepenseTogether : image et vidéo comptées par mois, autre type ignoré', async () => {
  poserEnv();
  const { noterDepenseTogether } = await importer('../api/_lib/depenses.js');
  const refs = [];
  const f0 = global.fetch;
  global.fetch = async (url, opts) => { refs.push(JSON.parse(opts.body).p_ref); return reponse(true); };
  try {
    await noterDepenseTogether('image', 1, new Date('2026-11-02T00:00:00Z'));
    await noterDepenseTogether('video', 1, new Date('2026-12-01T00:00:00Z'));
    await noterDepenseTogether('audio', 1);
    assert.deepEqual(refs, ['depense_together_image_2026-11', 'depense_together_video_2026-12']);
  } finally { global.fetch = f0; retirerEnv(); }
});

// ───────── lecture des soldes : action admin-stats « credits-api » ─────────

function mockRes() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

// Faux Supabase + faux fournisseurs. `lignes` = contenu de usage_serveur.
function poserReseau({ lignes = [], eleven, tikhub } = {}) {
  const journal = { eleven: 0, tikhub: 0, ecritures: [] };
  const base = [...lignes];
  const f0 = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/abonnes')) return reponse([]);
    if (u.includes('/rest/v1/usage_serveur?on_conflict=ref')) {
      const l = JSON.parse(opts.body);
      journal.ecritures.push(l);
      const i = base.findIndex(x => x.ref === l.ref);
      if (i >= 0) base[i] = l; else base.push(l);
      return reponse([]);
    }
    if (u.includes('/rest/v1/usage_serveur?select=')) {
      const motif = decodeURIComponent(u.match(/ref=like\.([^&]+)/)[1]).replace(/%/g, '');
      return reponse(base.filter(l => l.ref.startsWith(motif)));
    }
    if (u.startsWith('https://api.elevenlabs.io/v1/user/subscription')) {
      journal.eleven++;
      assert.equal(opts.headers['xi-api-key'], 'cle-eleven', 'la clé part dans le bon en-tête, jamais dans l\'URL');
      return eleven ? eleven() : reponse({ tier: 'creator', character_count: 25000, character_limit: 100000, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 5 * 86400 });
    }
    if (u.startsWith('https://api.tikhub.io/api/v1/tikhub/user/get_user_info')) {
      journal.tikhub++;
      return tikhub ? tikhub() : reponse({ code: 200, data: { user_data: { balance: 12.3456, free_credit: 0.5, email: 'secret@exemple.com',
      // PIÈGE : un nom qui ressemble à un champ utile (« credit ») ET à un secret (« token ») : seule
      // la liste noire des secrets l'empêche de sortir, la liste blanche des champs utiles le laisserait passer
      credit_token: 'SECRET-TOKEN-VALUE' },
      api_key_data: { api_key: 'sk-tikhub-SECRET', rate_limit: 10 } } });
    }
    return reponse({});
  };
  return { journal, restaurer: () => { global.fetch = f0; } };
}

async function etat(options, corps) {
  const { creditsApiEtat, _viderCacheCredits } = await importer('../api/_lib/credits-api.js');
  _viderCacheCredits();
  return creditsApiEtat({ url: 'https://exemple.supabase.co', key: 'k' }, corps || {});
}

test('ElevenLabs : crédits restants lus en direct, remise à zéro et niveau calculés', async () => {
  poserEnv();
  const { restaurer } = poserReseau();
  try {
    const e = await etat();
    const el = e.fournisseurs.elevenlabs;
    assert.equal(el.disponible, true);
    assert.equal(el.mode, 'reel');
    assert.equal(el.restants, 75000);
    assert.equal(el.pourcentRestant, 75);
    assert.equal(el.niveau, 'ok');
    assert.equal(el.palier, 'creator');
  } finally { restaurer(); retirerEnv(); }
});

test('ElevenLabs : niveaux bas, critique, épuisé selon la part restante', async () => {
  poserEnv();
  try {
    for (const [utilises, niveau] of [[85000, 'bas'], [95000, 'critique'], [100000, 'epuise']]) {
      const { restaurer } = poserReseau({ eleven: () => reponse({ character_count: utilises, character_limit: 100000 }) });
      try { assert.equal((await etat()).fournisseurs.elevenlabs.niveau, niveau, utilises + ' utilisés'); } finally { restaurer(); }
    }
  } finally { retirerEnv(); }
});

test('ElevenLabs : clé sans droit de lecture, clé absente, panne : une raison claire, jamais une exception', async () => {
  poserEnv();
  try {
    let r = poserReseau({ eleven: () => reponse({ detail: { status: 'missing_permissions', message: 'The API key is missing the permission user_read' } }, 401) });
    try {
      const el = (await etat()).fournisseurs.elevenlabs;
      assert.equal(el.disponible, false);
      assert.equal(el.raison, 'droit_lecture', 'une clé restreinte sert à générer mais pas à lire l\'abonnement : message dédié');
    } finally { r.restaurer(); }
    r = poserReseau({ eleven: () => { throw new Error('délai dépassé'); } });
    try { assert.equal((await etat()).fournisseurs.elevenlabs.raison, 'injoignable'); } finally { r.restaurer(); }
    delete process.env.ELEVENLABS_API_KEY;
    r = poserReseau();
    try { assert.equal((await etat()).fournisseurs.elevenlabs.raison, 'cle_absente'); } finally { r.restaurer(); }
  } finally { retirerEnv(); }
});

test('TikHub : solde lu, et AUCUN secret (clé, e-mail) ne remonte dans la réponse', async () => {
  poserEnv();
  const { restaurer } = poserReseau();
  try {
    const e = await etat();
    const t = e.fournisseurs.tikhub;
    assert.equal(t.disponible, true);
    assert.equal(t.soldeUsd, 12.3456);
    assert.equal(t.niveau, 'ok');
    const brut = JSON.stringify(e);
    assert.ok(!/SECRET|secret@exemple|sk-tikhub|cle-tikhub|cle-eleven|cle-service-role/.test(brut),
      'REGRESSION CRITIQUE : une clé ou un e-mail est sorti dans la réponse du Tableau de bord');
  } finally { restaurer(); retirerEnv(); }
});

test('TikHub : format de réponse inconnu => raison claire ET champs reçus montrés pour calibrer', async () => {
  poserEnv();
  const { restaurer } = poserReseau({ tikhub: () => reponse({ code: 200, data: { user_data: { free_credit: 0.5 }, api_key_data: { rate_limit: 10, api_key: 'SECRET' } } }) });
  try {
    const t = (await etat()).fournisseurs.tikhub;
    assert.equal(t.disponible, false);
    assert.equal(t.raison, 'format_inconnu');
    assert.ok(t.champs.some(c => c.cle.endsWith('free_credit') && c.valeur === 0.5), 'les champs utiles sont montrés tels que reçus');
    assert.ok(!JSON.stringify(t).includes('SECRET'));
  } finally { restaurer(); retirerEnv(); }
});

test('TikHub : clé sans la permission de lire le compte (403 réel du 18 novembre) => raison dédiée et message propre, jamais le JSON brut', async () => {
  poserEnv();
  const refus = { detail: { code: 403, request_id: '63f581d5-a009-4c1e-8b20-9ec2faeff7d1', message: 'API Token lacks required permissions, please edit the API Token scopes at user dashboard' } };
  const { restaurer } = poserReseau({ tikhub: () => reponse(refus, 403) });
  try {
    const t = (await etat()).fournisseurs.tikhub;
    assert.equal(t.disponible, false);
    assert.equal(t.raison, 'droit_lecture', 'REGRESSION : un 403 « permissions » doit être expliqué comme un réglage de clé, pas comme une panne http_403');
    assert.equal(t.detail, 'API Token lacks required permissions, please edit the API Token scopes at user dashboard',
      'seul le message du fournisseur remonte, sans les accolades ni le request_id, et sans être coupé en plein mot');
  } finally { restaurer(); retirerEnv(); }
});

test('TikHub : niveaux sur le solde en dollars', async () => {
  poserEnv();
  try {
    for (const [solde, niveau] of [[5, 'ok'], [0.6, 'bas'], [0.1, 'critique'], [0, 'epuise']]) {
      const { restaurer } = poserReseau({ tikhub: () => reponse({ data: { user_data: { balance: solde } } }) });
      try { assert.equal((await etat()).fournisseurs.tikhub.niveau, niveau, solde + ' $'); } finally { restaurer(); }
    }
  } finally { retirerEnv(); }
});

test('cache de 5 minutes sur les appels externes ; « actualiser » le contourne', async () => {
  poserEnv();
  const { journal, restaurer } = poserReseau();
  try {
    const { creditsApiEtat, _viderCacheCredits } = await importer('../api/_lib/credits-api.js');
    _viderCacheCredits();
    const cfg = { url: 'https://exemple.supabase.co', key: 'k' };
    await creditsApiEtat(cfg); await creditsApiEtat(cfg); await creditsApiEtat(cfg);
    assert.equal(journal.eleven, 1, 'dix ouvertures du tableau de bord ne doivent pas coûter dix appels ElevenLabs');
    assert.equal(journal.tikhub, 1);
    await creditsApiEtat(cfg, { actualiser: true });
    assert.equal(journal.eleven, 2, '« Actualiser » relit vraiment');
  } finally { restaurer(); retirerEnv(); }
});

test('estimation Anthropic : sans saisie => pas de chiffre inventé ; avec saisie => solde moins la dépense depuis', async () => {
  poserEnv();
  const depenses = [
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_entree_2026-11', used: 4000000 },
    { ref: 'depense_anthropic_claude-haiku-4-5-20251001_sortie_2026-11', used: 1000000 }
  ]; // 4 $ + 5 $ = 9 $ mesurés au total
  let r = poserReseau({ lignes: depenses });
  try {
    const a = (await etat()).fournisseurs.anthropic;
    assert.equal(a.saisie, null);
    assert.equal(a.estimation, null, 'REGRESSION : sans solde saisi, aucun « solde restant » ne doit être affiché');
    assert.equal(a.depenseMesureeCentimes, 900);
  } finally { r.restaurer(); }
  const il = (j) => new Date(Date.now() - j * 86400000).toISOString();
  r = poserReseau({ lignes: [...depenses,
    { ref: 'credits_solde_anthropic', used: 2000, maj_le: il(4) },  // 20 $ saisis il y a 4 jours
    { ref: 'credits_base_anthropic', used: 500 }                    // dont 5 $ déjà mesurés à ce moment-là
  ] });
  try {
    const a = (await etat()).fournisseurs.anthropic;
    assert.equal(a.mode, 'estime');
    assert.equal(a.estimation.depuisCentimes, 400, '9 $ mesurés - 5 $ d\'avant la saisie = 4 $');
    assert.equal(a.estimation.restantCentimes, 1600);
    assert.equal(a.estimation.pourcentRestant, 80);
    assert.equal(a.niveau, 'ok');
  } finally { r.restaurer(); retirerEnv(); }
});

test('estimation Together : prix unitaires réglés par le propriétaire, compteurs affichés', async () => {
  poserEnv();
  const il = (j) => new Date(Date.now() - j * 86400000).toISOString();
  const { restaurer } = poserReseau({ lignes: [
    { ref: 'depense_together_image_2026-11', used: 100 },
    { ref: 'depense_together_video_2026-11', used: 5 },
    { ref: 'credits_prix_together_image', used: 50000 },   // 0,05 $ l'image
    { ref: 'credits_solde_together', used: 1000, maj_le: il(2) },
    { ref: 'credits_base_together', used: 0 }
  ] });
  try {
    const t = (await etat()).fournisseurs.together;
    assert.deepEqual(t.prixUsd, { image: 0.05, video: 0.08 });
    assert.deepEqual(t.compte, { image: 100, video: 5 });
    assert.equal(t.depenseMesureeCentimes, 540, '100 x 0,05 $ + 5 x 0,08 $ = 5,40 $');
    assert.equal(t.estimation.restantCentimes, 460);
  } finally { restaurer(); retirerEnv(); }
});

// ───────── saisie du solde ─────────

test('saisie du solde : fige le solde ET la dépense déjà mesurée, valorisée avec les NOUVEAUX prix', async () => {
  poserEnv();
  const { journal, restaurer } = poserReseau({ lignes: [
    { ref: 'depense_together_image_2026-11', used: 100 },
    { ref: 'depense_together_video_2026-11', used: 10 }
  ] });
  try {
    const { creditsApiSaisie } = await importer('../api/_lib/credits-api.js');
    const r = await creditsApiSaisie({ url: 'https://exemple.supabase.co', key: 'k' },
      { fournisseur: 'together', soldeUsd: 25.4, prixImageUsd: 0.05, prixVideoUsd: 0.1 });
    assert.equal(r.status, 200);
    const ecrit = Object.fromEntries(journal.ecritures.map(l => [l.ref, l.used]));
    assert.equal(ecrit.credits_prix_together_image, 50000);
    assert.equal(ecrit.credits_prix_together_video, 100000);
    assert.equal(ecrit.credits_solde_together, 2540, '25,40 $ en centimes');
    assert.equal(ecrit.credits_base_together, 600, 'REGRESSION : 100 x 0,05 $ + 10 x 0,10 $ = 6 $, avec les prix saisis et non les prix par défaut');
    const ordre = journal.ecritures.map(l => l.ref);
    assert.ok(ordre.indexOf('credits_prix_together_image') < ordre.indexOf('credits_base_together'), 'les prix sont écrits avant la base qui en dépend');
    assert.ok(journal.ecritures.every(l => typeof l.maj_le === 'string'), 'la date de saisie est enregistrée');
  } finally { restaurer(); retirerEnv(); }
});

test('saisie du solde : fournisseur inconnu, solde ou prix invalides refusés, rien n\'est écrit', async () => {
  poserEnv();
  const { journal, restaurer } = poserReseau();
  try {
    const { creditsApiSaisie } = await importer('../api/_lib/credits-api.js');
    const cfg = { url: 'https://exemple.supabase.co', key: 'k' };
    for (const corps of [
      { fournisseur: 'elevenlabs', soldeUsd: 10 },
      { fournisseur: 'anthropic', soldeUsd: -5 },
      { fournisseur: 'anthropic', soldeUsd: 'abc' },
      { fournisseur: 'anthropic', soldeUsd: 99999999 },
      { fournisseur: 'together', soldeUsd: 10, prixImageUsd: -1 },
      { fournisseur: 'together', soldeUsd: 10, prixVideoUsd: 500 },
      {}, null
    ]) assert.equal((await creditsApiSaisie(cfg, corps)).status, 400, JSON.stringify(corps));
    assert.equal(journal.ecritures.length, 0);
  } finally { restaurer(); retirerEnv(); }
});

test('saisie du solde : Supabase qui refuse l\'écriture => erreur claire, pas de succès affiché à tort', async () => {
  poserEnv();
  const f0 = global.fetch;
  global.fetch = async (url) => String(url).includes('on_conflict') ? reponse({ message: 'denied' }, 403) : reponse([]);
  try {
    const { creditsApiSaisie } = await importer('../api/_lib/credits-api.js');
    const r = await creditsApiSaisie({ url: 'https://exemple.supabase.co', key: 'k' }, { fournisseur: 'anthropic', soldeUsd: 10 });
    assert.equal(r.status, 502);
    assert.match(r.error, /Enregistrement impossible/);
  } finally { global.fetch = f0; retirerEnv(); }
});

// ───────── accès : fondateur seulement, via api/data.js ─────────

test('api/data.js : les deux actions crédits sont réservées au fondateur et renvoient l\'état complet', async () => {
  poserEnv();
  const { restaurer } = poserReseau();
  try {
    const { default: handler } = await importer('../api/data.js');
    for (const action of ['credits-api', 'credits-api-solde']) {
      const refus = mockRes();
      await handler({ method: 'POST', body: { resource: 'admin-stats', action, code_acces: 'PAS-ADMIN', fournisseur: 'anthropic', soldeUsd: 10 } }, refus);
      assert.equal(refus._status, 403, action + ' : un non-fondateur ne doit rien lire ni écrire');
    }
    const lecture = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'credits-api', code_acces: 'ADMIN-TEST' } }, lecture);
    assert.equal(lecture._status, 200);
    assert.equal(lecture._json.ok, true);
    assert.deepEqual(Object.keys(lecture._json.fournisseurs).sort(), ['anthropic', 'elevenlabs', 'tikhub', 'together']);

    const saisie = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'credits-api-solde', code_acces: 'ADMIN-TEST', fournisseur: 'anthropic', soldeUsd: 30 } }, saisie);
    assert.equal(saisie._status, 200);
    assert.equal(saisie._json.fournisseurs.anthropic.saisie.soldeUsd, 30, 'la réponse renvoie l\'état à jour, l\'écran n\'a pas à relire');

    const mauvaise = mockRes();
    await handler({ method: 'POST', body: { resource: 'admin-stats', action: 'credits-api-solde', code_acces: 'ADMIN-TEST', fournisseur: 'anthropic', soldeUsd: -1 } }, mauvaise);
    assert.equal(mauvaise._status, 400);
    assert.equal(mauvaise._json.ok, false);
  } finally { restaurer(); retirerEnv(); }
});

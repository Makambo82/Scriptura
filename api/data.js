// ═══════════════════════════════════════════════════════════
//  /api/data, REGROUPE 4 routes légères qui étaient chacune leur propre
//  fonction serverless (generations, series, profil-createur, admin-stats) :
//  le plan Vercel Hobby plafonne à 12 fonctions serverless par déploiement,
//  ce plafond a été dépassé silencieusement (chaque déploiement depuis a
//  échoué au build, la prod est restée figée sur un ancien commit sans que
//  personne ne le remarque). Consolidation mécanique, comportement de
//  chaque route inchangé : seul le point d'entrée devient commun, un champ
//  `resource` (query pour GET, corps JSON pour POST) sélectionne la route
//  d'origine. Voir api/montage-media.js et api/tiktok-video.js, même
//  logique appliquée aux autres groupes de routes.
//
//  resource=generations | series | profil | admin-stats
// ═══════════════════════════════════════════════════════════

import { resoudreDroits } from './_lib/acces.js';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

// ═══ GENERATIONS (voir l'ancien api/generations.js) ═══

async function ligneGenerationAppartientA(cfg, id, code) {
  const r = await fetch(
    cfg.url + '/rest/v1/generations?id=eq.' + encodeURIComponent(id) + '&select=code_acces,contenu',
    { headers: entetes(cfg.key) }
  );
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) && rows[0];
  if (!row || row.code_acces !== code) return null;
  return row;
}

const HIST_TAILLE_PAGE = 50;

async function handleGenerations(req, res, cfg, body) {
  if (req.method === 'GET') {
    const action = req.query && req.query.action;
    const code = (req.query && req.query.code) || '';
    if (!code) return res.status(200).json({ ok: false, data: [] });

    if (action === 'list') {
      const offset = Math.max(0, parseInt((req.query && req.query.offset) || '0', 10) || 0);
      const r = await fetch(
        cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) +
        '&select=*&order=cree_le.desc&offset=' + offset + '&limit=' + HIST_TAILLE_PAGE,
        { headers: entetes(cfg.key) }
      );
      const data = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, data: Array.isArray(data) ? data : [] });
    }

    if (action === 'count') {
      const type = (req.query && req.query.type) || '';
      let url = cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) + '&select=id';
      if (type === 'audit' || type === 'diagnosticSommaire' || type === 'analyseVirale') {
        url += '&mode=eq.' + encodeURIComponent(type);
      } else if (type === 'creation') {
        url += '&mode=not.in.(audit,diagnosticSommaire,analyseVirale)';
      }
      if (req.query && req.query.depuis) url += '&cree_le=gte.' + encodeURIComponent(req.query.depuis);
      const r = await fetch(url, { headers: { ...entetes(cfg.key), Prefer: 'count=exact' }, method: 'HEAD' });
      const c = r.headers.get('content-range');
      const count = c ? (parseInt(c.split('/')[1], 10) || 0) : 0;
      return res.status(200).json({ ok: true, count });
    }

    if (action === 'last') {
      const mode = (req.query && req.query.mode) || '';
      const limit = Math.max(1, Math.min(50, parseInt((req.query && req.query.limit) || '1', 10) || 1));
      let url = cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) + '&select=*&order=cree_le.desc&limit=' + limit;
      if (mode) url += '&mode=eq.' + encodeURIComponent(mode);
      const r = await fetch(url, { headers: entetes(cfg.key) });
      const rows = await r.json().catch(() => []);
      const arr = Array.isArray(rows) ? rows : [];
      return res.status(200).json({ ok: true, data: limit === 1 ? (arr[0] || null) : arr });
    }

    return res.status(400).json({ ok: false, error: 'action inconnue' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const action = body.action;
  const code = body.code || '';
  if (!code) return res.status(400).json({ ok: false, error: 'code manquant' });

  if (action === 'save') {
    const r = await fetch(cfg.url + '/rest/v1/generations', {
      method: 'POST',
      headers: { ...entetes(cfg.key), Prefer: 'return=representation' },
      body: JSON.stringify({ code_acces: code, mode: body.mode, titre: body.titre || 'Sans titre', contenu: body.contenu })
    });
    const data = await r.json().catch(() => null);
    const row = Array.isArray(data) && data[0];
    return res.status(200).json({ ok: !!row, id: row ? row.id : null });
  }

  if (action === 'save-regen') {
    const ligne = await ligneGenerationAppartientA(cfg, body.id, code);
    if (!ligne) return res.status(200).json({ ok: false });
    await fetch(cfg.url + '/rest/v1/generations?id=eq.' + encodeURIComponent(body.id), {
      method: 'PATCH',
      headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
      body: JSON.stringify({ titre: body.titre || 'Sans titre', contenu: body.contenu })
    });
    return res.status(200).json({ ok: true });
  }

  if (action === 'patch') {
    const ligne = await ligneGenerationAppartientA(cfg, body.id, code);
    if (!ligne) return res.status(200).json({ ok: false });
    const nouveauContenu = Object.assign({}, ligne.contenu || {}, body.champs || {});
    await fetch(cfg.url + '/rest/v1/generations?id=eq.' + encodeURIComponent(body.id), {
      method: 'PATCH',
      headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
      body: JSON.stringify({ contenu: nouveauContenu })
    });
    return res.status(200).json({ ok: true });
  }

  if (action === 'favori') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return res.status(200).json({ ok: true });
    const url = cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) +
      '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
    const r = await fetch(url, { method: 'PATCH', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' }, body: JSON.stringify({ favori: !!body.valeur }) });
    return res.status(200).json({ ok: r.ok });
  }

  if (action === 'delete') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return res.status(200).json({ ok: true });
    const url = cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) +
      '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
    const r = await fetch(url, { method: 'DELETE', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: r.ok });
  }

  return res.status(400).json({ ok: false, error: 'action inconnue' });
}

// ═══ SERIES (voir l'ancien api/series.js) ═══

async function ligneSerieAppartientA(cfg, id, code) {
  const r = await fetch(cfg.url + '/rest/v1/series?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: entetes(cfg.key) });
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) && rows[0];
  if (!row || row.code_acces !== code) return null;
  return row;
}

async function handleSeries(req, res, cfg, body) {
  if (req.method === 'GET') {
    const action = req.query && req.query.action;
    const code = (req.query && req.query.code) || '';
    if (!code) return res.status(200).json({ ok: false, data: [] });

    if (action === 'list') {
      const r = await fetch(cfg.url + '/rest/v1/series?code_acces=eq.' + encodeURIComponent(code) + '&select=*&order=cree_le.desc', { headers: entetes(cfg.key) });
      const data = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, data: Array.isArray(data) ? data : [] });
    }

    if (action === 'get') {
      const serie = await ligneSerieAppartientA(cfg, req.query.id, code);
      return res.status(200).json({ ok: !!serie, data: serie || null });
    }

    return res.status(400).json({ ok: false, error: 'action inconnue' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const action = body.action;
  const code = body.code || '';
  if (!code) return res.status(400).json({ ok: false, error: 'code manquant' });

  if (action === 'save') {
    const r = await fetch(cfg.url + '/rest/v1/series', {
      method: 'POST',
      headers: { ...entetes(cfg.key), Prefer: 'return=representation' },
      body: JSON.stringify({
        code_acces: code, titre: body.titre, concept: body.concept, niche: body.niche, style: body.style,
        genre: body.genre, bible: body.bible, nb_episodes: body.nb_episodes, episode_courant: 0, episodes: []
      })
    });
    const data = await r.json().catch(() => null);
    const row = Array.isArray(data) && data[0];
    return res.status(200).json({ ok: !!row, data: row || null });
  }

  if (action === 'update') {
    const ligne = await ligneSerieAppartientA(cfg, body.id, code);
    if (!ligne) return res.status(200).json({ ok: false });
    const champsAutorises = ['episodes', 'episode_courant', 'statut'];
    const patch = {};
    for (const k of champsAutorises) if (body.patch && body.patch[k] !== undefined) patch[k] = body.patch[k];
    await fetch(cfg.url + '/rest/v1/series?id=eq.' + encodeURIComponent(body.id), {
      method: 'PATCH', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' }, body: JSON.stringify(patch)
    });
    return res.status(200).json({ ok: true });
  }

  if (action === 'favori') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return res.status(200).json({ ok: true });
    const url = cfg.url + '/rest/v1/series?code_acces=eq.' + encodeURIComponent(code) +
      '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
    const r = await fetch(url, { method: 'PATCH', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' }, body: JSON.stringify({ favori: !!body.valeur }) });
    return res.status(200).json({ ok: r.ok });
  }

  if (action === 'delete') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return res.status(200).json({ ok: true });
    const url = cfg.url + '/rest/v1/series?code_acces=eq.' + encodeURIComponent(code) +
      '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
    const r = await fetch(url, { method: 'DELETE', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: r.ok });
  }

  return res.status(400).json({ ok: false, error: 'action inconnue' });
}

// ═══ PROFIL CRÉATEUR (voir l'ancien api/profil-createur.js) ═══

async function handleProfil(req, res, cfg, body) {
  if (req.method === 'GET') {
    const code = (req.query && req.query.code) || '';
    if (!code) return res.status(200).json({ profil: {} });
    const r = await fetch(
      cfg.url + '/rest/v1/profils_createurs?code_acces=eq.' + encodeURIComponent(code) + '&select=profil',
      { headers: entetes(cfg.key) }
    );
    const rows = await r.json().catch(() => []);
    const profil = (Array.isArray(rows) && rows[0] && rows[0].profil) || {};
    return res.status(200).json({ profil });
  }

  if (req.method === 'POST') {
    const code = (body && body.code) || '';
    const profil = (body && body.profil) || {};
    if (!code) return res.status(400).json({ error: { message: 'code manquant' } });
    const r = await fetch(cfg.url + '/rest/v1/profils_createurs', {
      method: 'POST',
      headers: { ...entetes(cfg.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ code_acces: code, profil, maj_le: new Date().toISOString() })
    });
    if (!r.ok) return res.status(200).json({ ok: false });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
}

// ═══ ADMIN STATS (voir l'ancien api/admin-stats.js) ═══

async function handleAdminStats(req, res, cfg, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Réservé au fondateur', code: 'ACCES_REFUSE' } });
  }

  // Bascule actif/inactif d'un code depuis le tableau de bord (interrupteur
  // par ligne, voir toggleActifAbonneAdmin, js/admin.js). Jamais pour le
  // fondateur/VIP : ces codes ne vivent pas dans cette table.
  if (body?.action === 'toggle-actif') {
    const cible = String(body?.code || '').trim().toUpperCase();
    if (!cible) return res.status(400).json({ error: { message: 'Code manquant' } });
    try {
      const r = await fetch(
        cfg.url + '/rest/v1/abonnes?code=eq.' + encodeURIComponent(cible),
        { method: 'PATCH', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' }, body: JSON.stringify({ actif: !!body?.actif }) }
      );
      if (!r.ok) throw new Error('maj échouée (' + r.status + ')');
      return res.status(200).json({ ok: true, code: cible, actif: !!body?.actif });
    } catch (e) {
      return res.status(200).json({ indisponible: true });
    }
  }

  // Détail des générations par mode POUR UN CODE PRÉCIS (clic sur un code
  // dans la liste, voir toggleGenerationsParCode, js/admin.js). Toutes
  // périodes confondues (contrairement à la carte globale "Générations par
  // mode", limitée à 30 jours) : pour un seul abonné, le total depuis
  // toujours est plus parlant qu'une fenêtre glissante.
  if (body?.action === 'generations-par-code') {
    const cible = String(body?.code || '').trim().toUpperCase();
    if (!cible) return res.status(400).json({ error: { message: 'Code manquant' } });
    try {
      const r = await fetch(
        cfg.url + '/rest/v1/generations?select=mode&code_acces=eq.' + encodeURIComponent(cible),
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rows = await r.json().catch(() => []);
      const parMode = {};
      (Array.isArray(rows) ? rows : []).forEach(row => { const m = row.mode || 'autre'; parMode[m] = (parMode[m] || 0) + 1; });
      return res.status(200).json({ parMode });
    } catch (e) {
      return res.status(200).json({ indisponible: true });
    }
  }

  // Création d'un nouvel abonné depuis le tableau de bord (voir
  // creerAbonneAdmin, js/admin.js). Format du code identique à celui créé
  // à la main aujourd'hui : PRÉNOM + 4 caractères, dont au moins un chiffre
  // (voir prenomDepuisCode, js/recommandations.js, qui s'appuie sur cette
  // convention pour retrouver le prénom à l'affichage). Expire dans 30
  // jours par défaut (abonnement mensuel), modifiable ensuite dans
  // Supabase si besoin.
  if (body?.action === 'creer-abonne') {
    const plan = String(body?.plan || '').trim().toLowerCase();
    if (plan !== 'creator' && plan !== 'pro') return res.status(400).json({ error: { message: 'Plan invalide' } });
    // Même alphabet que LETTRES dans prenomDepuisCode (js/recommandations.js) :
    // lettres accentuées comprises, tout le reste filtré.
    const prenom = String(body?.prenom || '').trim().toUpperCase().replace(/[^A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/g, '');
    if (!prenom) return res.status(400).json({ error: { message: 'Prénom invalide' } });
    const ALPHABET_SUFFIXE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffixe = '';
    for (let i = 0; i < 4; i++) suffixe += ALPHABET_SUFFIXE[Math.floor(Math.random() * ALPHABET_SUFFIXE.length)];
    if (!/[0-9]/.test(suffixe)) {
      const pos = Math.floor(Math.random() * 4);
      suffixe = suffixe.slice(0, pos) + String(Math.floor(Math.random() * 10)) + suffixe.slice(pos + 1);
    }
    const code = prenom + suffixe;
    const expireLe = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
    try {
      const r = await fetch(cfg.url + '/rest/v1/abonnes', {
        method: 'POST',
        headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
        body: JSON.stringify({ code, plan, actif: true, expire_le: expireLe, jetons_audit: 0 })
      });
      if (!r.ok) throw new Error('création échouée (' + r.status + ')');
      return res.status(200).json({ ok: true, code, plan, expireLe });
    } catch (e) {
      return res.status(200).json({ indisponible: true });
    }
  }

  try {
    const entetesCompte = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, Prefer: 'count=exact' };
    const compter = async (filtre) => {
      const r = await fetch(cfg.url + '/rest/v1/abonnes?select=code' + filtre, { method: 'HEAD', headers: entetesCompte });
      const c = r.headers.get('content-range');
      return c ? parseInt(c.split('/')[1], 10) || 0 : 0;
    };
    // Liste détaillée des codes (pour le détail dépliable de la carte
    // "Abonnés actifs", voir chargerCarteAbonnes/toggleListeAbonnesAdmin,
    // js/admin.js) : ne contient jamais le fondateur/VIP, ces codes vivent
    // en variables d'environnement (CODE_ADMIN/CODES_ILLIMITES/
    // CODES_SECOURS, voir api/verify-code.js), jamais dans cette table.
    const listeCodes = fetch(
      cfg.url + '/rest/v1/abonnes?select=code,plan,actif&order=code.asc',
      { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
    ).then(r => r.json()).catch(() => []);

    const [total, actifs, creator, pro, codes] = await Promise.all([
      compter(''), compter('&actif=eq.true'), compter('&actif=eq.true&plan=eq.creator'), compter('&actif=eq.true&plan=eq.pro'), listeCodes
    ]);

    let parMode = {};
    try {
      const depuis30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const rModes = await fetch(
        cfg.url + '/rest/v1/generations?select=mode&cree_le=gte.' + encodeURIComponent(depuis30),
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rows = await rModes.json().catch(() => []);
      (Array.isArray(rows) ? rows : []).forEach(r => { const m = r.mode || 'autre'; parMode[m] = (parMode[m] || 0) + 1; });
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    return res.status(200).json({ total, actifs, creator, pro, parMode, codes: Array.isArray(codes) ? codes : [] });
  } catch (e) {
    return res.status(200).json({ indisponible: true });
  }
}

// ═══ POINT D'ENTRÉE COMMUN ═══

export default async function handler(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const resource = req.method === 'GET' ? (req.query && req.query.resource) : body.resource;

  // admin-stats vérifie ses droits lui-même (voir handleAdminStats) même
  // sans clé service_role configurée, jamais de repli silencieux pour une
  // route qui expose des données d'abonnés.
  if (resource === 'admin-stats') {
    const cfg = config();
    if (!cfg) return res.status(200).json({ indisponible: true });
    return handleAdminStats(req, res, cfg, body);
  }

  const cfg = config();
  if (!cfg) {
    // Pas de clé service role : dégradation identique à chaque route d'origine.
    if (resource === 'profil') return res.status(200).json({ profil: {} });
    return res.status(200).json({ ok: false, indisponible: true, data: [] });
  }

  try {
    if (resource === 'generations') return await handleGenerations(req, res, cfg, body);
    if (resource === 'series') return await handleSeries(req, res, cfg, body);
    if (resource === 'profil') return await handleProfil(req, res, cfg, body);
    return res.status(400).json({ ok: false, error: 'resource inconnue' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'erreur' });
  }
}

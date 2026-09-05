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

import { resoudreDroits, lireUsageMontageImages, lireUsageImages, lireUsageAnonyme } from './_lib/acces.js';

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

// ═══ ERREURS DE GÉNÉRATION (journal, voir callAI, js/api.js) ═══
// Écrit un échec définitif (toutes les tentatives épuisées côté client)
// dans erreurs_generation (voir supabase/erreurs_generation.sql). Appel
// fire-and-forget côté client : la réponse n'est jamais attendue par
// l'utilisateur, donc on dégrade toujours en 200 plutôt que de renvoyer
// une erreur qui n'intéresse personne.
async function handleErreur(req, res, cfg, body) {
  try {
    const mode = typeof body?.mode === 'string' && body.mode ? body.mode.slice(0, 60) : 'inconnu';
    const code = typeof body?.code === 'string' && body.code ? body.code.slice(0, 60) : null;
    const detail = typeof body?.detail === 'string' ? body.detail.slice(0, 300) : '';
    await fetch(cfg.url + '/rest/v1/erreurs_generation', {
      method: 'POST',
      headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
      body: JSON.stringify({ mode, code_acces: code, detail })
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}

// ═══ PASSES DE GÉNÉRATION (mesure, voir passes_generation.sql) ═══
// Une ligne par génération réussie, pour savoir si la boucle de correction de
// durée et la boucle qualité (Critique + Réviseur) gagnent vraiment leur coût.
// Aucune donnée de contenu : uniquement des compteurs. Appel fire-and-forget
// côté client, donc on dégrade toujours en 200 plutôt que de renvoyer une
// erreur que personne n'attend.
async function handlePasses(req, res, cfg, body) {
  try {
    const entier = (v, max) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, max);
    };
    const ligne = {
      mode: typeof body?.mode === 'string' && body.mode ? body.mode.slice(0, 40) : 'inconnu',
      code_acces: typeof body?.code === 'string' && body.code ? body.code.slice(0, 60) : null,
      duree_cible: typeof body?.duree_cible === 'string' ? body.duree_cible.slice(0, 40) : '',
      mots_final: entier(body?.mots_final, 100000),
      dans_cible: !!body?.dans_cible,
      corrections_duree: entier(body?.corrections_duree, 20),
      critiques: entier(body?.critiques, 20),
      revisions: entier(body?.revisions, 20),
      second_brouillon: !!body?.second_brouillon
    };
    await fetch(cfg.url + '/rest/v1/passes_generation', {
      method: 'POST',
      headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
      body: JSON.stringify(ligne)
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
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
    // ilike (et non eq) : certains codes en base ne sont pas stockés en
    // majuscules (ex. codes créés à la main dans Supabase avant l'ajout du
    // générateur automatique, comme "Tiktok-F18"). Un eq.MAJUSCULE sur un
    // code réellement mixte-casse ne matche aucune ligne, échoue en
    // silence (Prefer: return=minimal renvoie 200 même sur 0 ligne
    // affectée) et laisse l'UI mentir sur l'état réel de l'abonné.
    const cible = String(body?.code || '').trim();
    if (!cible) return res.status(400).json({ error: { message: 'Code manquant' } });
    try {
      const r = await fetch(
        cfg.url + '/rest/v1/abonnes?code=ilike.' + encodeURIComponent(cible),
        { method: 'PATCH', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' }, body: JSON.stringify({ actif: !!body?.actif }) }
      );
      if (!r.ok) throw new Error('maj échouée (' + r.status + ')');
      return res.status(200).json({ ok: true, code: cible, actif: !!body?.actif });
    } catch (e) {
      return res.status(200).json({ indisponible: true });
    }
  }

  // Suppression DÉFINITIVE d'un code désactivé (retour propriétaire : "je
  // dois le faire moi-même dans Supabase ?", voir supprimerAbonneAdmin,
  // js/admin.js). Garde-fou volontaire : la clause &actif=eq.false dans la
  // requête elle-même fait qu'un code encore actif ne peut JAMAIS être
  // supprimé par cette route, même appelée directement sans passer par le
  // bouton (qui ne l'affiche que pour les codes déjà désactivés) ; 0 ligne
  // supprimée dans ce cas, jamais une erreur qui laisserait croire à une
  // suppression partielle.
  if (body?.action === 'supprimer-abonne') {
    // ilike, même raison que toggle-actif ci-dessus : un code stocké en
    // casse mixte (ex. "Tiktok-F18") ne matche jamais un eq.MAJUSCULE, donc
    // la suppression échoue toujours avec "rien_a_supprimer" pour ces codes.
    const cible = String(body?.code || '').trim();
    if (!cible) return res.status(400).json({ error: { message: 'Code manquant' } });
    try {
      const r = await fetch(
        cfg.url + '/rest/v1/abonnes?code=ilike.' + encodeURIComponent(cible) + '&actif=eq.false',
        { method: 'DELETE', headers: { ...entetes(cfg.key), Prefer: 'return=representation' } }
      );
      if (!r.ok) throw new Error('suppression échouée (' + r.status + ')');
      const supprimees = await r.json().catch(() => []);
      if (!Array.isArray(supprimees) || !supprimees.length) {
        return res.status(200).json({ ok: false, erreur: 'rien_a_supprimer' });
      }
      return res.status(200).json({ ok: true, code: cible });
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
    // ilike, même raison que toggle-actif/supprimer-abonne : un code en
    // casse mixte ne doit pas se voir afficher "0 génération" juste parce
    // que le filtre force une casse différente de celle stockée.
    const cible = String(body?.code || '').trim();
    if (!cible) return res.status(400).json({ error: { message: 'Code manquant' } });
    try {
      const r = await fetch(
        cfg.url + '/rest/v1/generations?select=mode&code_acces=ilike.' + encodeURIComponent(cible),
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

  // Création d'un nouvel abonné Creator/Pro, OU vente de jetons à l'unité
  // (nouveau code ou ajout sur un code existant), depuis le tableau de bord
  // (voir creerAbonneAdmin, js/admin.js). Format du code identique à celui
  // créé à la main aujourd'hui : PRÉNOM + 4 caractères (lettre, chiffre,
  // lettre, chiffre, ex. A3M8, voir prenomDepuisCode, js/recommandations.js,
  // qui s'appuie sur cette convention pour retrouver le prénom à l'affichage).
  // Creator/Pro expire dans 30 jours par défaut (abonnement mensuel), modifiable
  // ensuite dans Supabase si besoin.
  if (body?.action === 'creer-abonne') {
    const plan = String(body?.plan || '').trim().toLowerCase();
    if (plan !== 'creator' && plan !== 'pro' && plan !== 'jeton') return res.status(400).json({ error: { message: 'Plan invalide' } });
    // Même alphabet que LETTRES dans prenomDepuisCode (js/recommandations.js) :
    // lettres accentuées comprises, tout le reste filtré.
    const genererCode = (prenomBrut) => {
      const prenom = String(prenomBrut || '').trim().toUpperCase().replace(/[^A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/g, '');
      if (!prenom) return null;
      const LETTRES_SUFFIXE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const CHIFFRES_SUFFIXE = '0123456789';
      const lettreAlea = () => LETTRES_SUFFIXE[Math.floor(Math.random() * LETTRES_SUFFIXE.length)];
      const chiffreAlea = () => CHIFFRES_SUFFIXE[Math.floor(Math.random() * CHIFFRES_SUFFIXE.length)];
      return prenom + lettreAlea() + chiffreAlea() + lettreAlea() + chiffreAlea();
    };

    if (plan === 'jeton') {
      // Achat de jetons à l'unité (voir PACKS_AUDIT, js/abonnement.js : 1/2/3
      // jetons, réglé manuellement par le fondateur après paiement WhatsApp).
      // Plafonné large (50) : simple garde-fou contre une saisie erronée,
      // pas une vraie limite métier.
      const qte = Math.min(50, Math.max(1, parseInt(body?.qte, 10) || 1));
      const codeExistant = String(body?.codeExistant || '').trim().toUpperCase();

      if (codeExistant) {
        // Abonné Creator/Pro (ou déjà jeton) qui achète des jetons en plus :
        // ADDITIONNÉS sur SA MÊME ligne, jamais une seconde ligne "jeton"
        // séparée pour ce code. Une deuxième ligne rendrait le solde
        // silencieusement invisible : resoudreDroits/verify-code.js lisent
        // `abonnes?code=eq....` SANS tri explicite et ne gardent que la
        // première ligne renvoyée (rows[0]) ; si la ligne Creator/Pro (jetons
        // à 0) sortait en premier, le jeton acheté ne serait jamais vu. Une
        // seule ligne par code élimine ce risque à la racine.
        try {
          // ilike : le fondateur tape ce code à la main, casse au clavier
          // non garantie, et un code stocké en casse mixte (ex.
          // "Tiktok-F18") ne doit pas ressortir "code_introuvable" pour ça.
          const rLire = await fetch(
            cfg.url + '/rest/v1/abonnes?code=ilike.' + encodeURIComponent(codeExistant) + '&select=jetons_audit',
            { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
          );
          const rows = await rLire.json().catch(() => []);
          if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: false, erreur: 'code_introuvable' });
          const total = (parseInt(rows[0].jetons_audit, 10) || 0) + qte;
          const rMaj = await fetch(cfg.url + '/rest/v1/abonnes?code=ilike.' + encodeURIComponent(codeExistant), {
            method: 'PATCH',
            headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
            body: JSON.stringify({ jetons_audit: total })
          });
          if (!rMaj.ok) throw new Error('mise à jour échouée (' + rMaj.status + ')');
          return res.status(200).json({ ok: true, code: codeExistant, plan: 'jeton', jetons: total, existant: true });
        } catch (e) {
          return res.status(200).json({ indisponible: true });
        }
      }

      // Nouveau code jeton (visiteur non-abonné) : SANS expire_le, un jeton
      // se consomme à l'usage, il n'expire jamais par la date (voir
      // verify-code.js/resoudreDroits, qui refuseraient sinon l'accès à un
      // jeton payé mais pas encore utilisé après 30 jours).
      const code = genererCode(body?.prenom);
      if (!code) return res.status(400).json({ error: { message: 'Prénom invalide' } });
      try {
        const r = await fetch(cfg.url + '/rest/v1/abonnes', {
          method: 'POST',
          headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
          body: JSON.stringify({ code, plan: 'jeton', actif: true, expire_le: null, jetons_audit: qte })
        });
        if (!r.ok) throw new Error('création échouée (' + r.status + ')');
        return res.status(200).json({ ok: true, code, plan: 'jeton', jetons: qte });
      } catch (e) {
        return res.status(200).json({ indisponible: true });
      }
    }

    // plan === 'creator' | 'pro' (comportement inchangé) : expire dans 30
    // jours par défaut (abonnement mensuel), modifiable ensuite dans
    // Supabase si besoin. Format du code : PRÉNOM + 4 caractères (lettre,
    // chiffre, lettre, chiffre, ex. A3M8, voir prenomDepuisCode,
    // js/recommandations.js, qui s'appuie sur cette convention).
    const code = genererCode(body?.prenom);
    if (!code) return res.status(400).json({ error: { message: 'Prénom invalide' } });
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
    // Le fondateur ne devrait normalement jamais avoir de ligne dans
    // `abonnes` (voir commentaire plus bas), mais un compte fondateur créé
    // avant la mise en place de CODE_ADMIN peut très bien en avoir gardé
    // une, ce que l'UI sait déjà afficher à part (ligne "Fondateur"
    // verrouillée, voir estFondateur, js/admin.js). Cette ligne reste dans
    // `listeCodes`/`codes` pour cet affichage, mais est exclue des
    // COMPTAGES ci-dessous (ilike, insensible à la casse, même raison que
    // toggle-actif/supprimer-abonne plus haut) : sinon "Abonnés actifs" et
    // la répartition par plan comptent le fondateur comme un abonné, même
    // quand il n'y a encore aucun vrai abonné.
    const codeFondateur = (process.env.CODE_ADMIN || '').trim().toUpperCase();
    const filtreSansFondateur = codeFondateur ? '&code=not.ilike.' + encodeURIComponent(codeFondateur) : '';
    const entetesCompte = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, Prefer: 'count=exact' };
    const compter = async (filtre) => {
      const r = await fetch(cfg.url + '/rest/v1/abonnes?select=code' + filtre + filtreSansFondateur, { method: 'HEAD', headers: entetesCompte });
      const c = r.headers.get('content-range');
      return c ? parseInt(c.split('/')[1], 10) || 0 : 0;
    };
    // Liste détaillée des codes (pour le détail dépliable de la carte
    // "Abonnés actifs", voir chargerCarteAbonnes/toggleListeAbonnesAdmin,
    // js/admin.js) : ne contient jamais le fondateur/VIP, ces codes vivent
    // en variables d'environnement (CODE_ADMIN/CODES_ILLIMITES/
    // CODES_SECOURS, voir api/verify-code.js), jamais dans cette table.
    // PAS filtrée sur le fondateur (contrairement aux comptages ci-dessus) :
    // si une ligne fondateur existe quand même, l'UI a besoin de la voir
    // pour l'afficher à part (estFondateur), jamais pour la compter.
    const listeCodes = fetch(
      cfg.url + '/rest/v1/abonnes?select=code,plan,actif,expire_le&order=code.asc',
      { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
    ).then(r => r.json()).catch(() => []);

    const [total, actifs, creator, pro, codes] = await Promise.all([
      compter(''), compter('&actif=eq.true'), compter('&actif=eq.true&plan=eq.creator'), compter('&actif=eq.true&plan=eq.pro'), listeCodes
    ]);

    // parModePlan : mêmes générations, scindées par plan (Fondateur/Pro/
    // Creator/Non-abonné) pour repérer ce qui pousse réellement à l'upgrade
    // (voir carteModesAdmin, js/admin.js). `code_acces` recroisé avec la
    // liste `codes` déjà chargée ci-dessus (même Promise.all), pas de
    // requête supplémentaire pour ça. Fondateur identifié via CODE_ADMIN
    // (jamais dans la table `abonnes`, voir verify-code.js). Jeton/VIP (un
    // code EXISTE mais ne correspond à aucun plan Pro/Creator reconnu, ex.
    // code désactivé/expiré) ne rentrent dans aucun des quatre compteurs,
    // hors du périmètre de cette comparaison.
    //
    // Retour propriétaire (bug réel : une analyse sommaire faite sans code
    // n'apparaissait dans AUCUNE colonne, pas même Non-abonné) : un
    // non-abonné n'envoie JAMAIS un code_acces vide. getUserRef() (js/api.js)
    // renvoie toujours anon_<horodatage>_<aléa> pour quiconque n'a pas de
    // code, y compris les non-abonnés (voir aussi handlePresence, plus haut
    // dans ce fichier, même identifiant). Un code_acces vide ne se produit
    // donc jamais en pratique ; en le testant seul, ces générations
    // tombaient dans le `planParCode[...]` non trouvé juste en dessous,
    // c'est-à-dire nulle part.
    let parMode = {};
    let parModePlan = { fondateur: {}, pro: {}, creator: {}, nonAbonne: {} };
    try {
      const depuis30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const rModes = await fetch(
        cfg.url + '/rest/v1/generations?select=mode,code_acces&cree_le=gte.' + encodeURIComponent(depuis30),
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rows = await rModes.json().catch(() => []);
      // Clé en MAJUSCULES des deux côtés (retour propriétaire, même famille
      // de bug que Non-abonné ci-dessous) : un code d'abonné stocké en casse
      // mixte dans `abonnes` (ex. "Tiktok-F18", cas déjà connu, voir
      // toggle-actif/supprimer-abonne/generations-par-code plus haut, tous
      // en ilike pour cette raison) ne matchait jamais r.code_acces, TOUJOURS
      // en majuscules côté client (voir auth.js, .toUpperCase() avant
      // d'enregistrer scriptura_code). Sans normaliser ici aussi, ces
      // générations disparaissaient silencieusement du tableau, ni Creator/
      // Pro ni Non-abonné.
      const planParCode = {};
      (Array.isArray(codes) ? codes : []).forEach(c => { planParCode[String(c.code || '').toUpperCase()] = c.plan; });
      (Array.isArray(rows) ? rows : []).forEach(r => {
        const m = r.mode || 'autre';
        parMode[m] = (parMode[m] || 0) + 1;
        if (codeFondateur && String(r.code_acces || '').toUpperCase() === codeFondateur) {
          parModePlan.fondateur[m] = (parModePlan.fondateur[m] || 0) + 1;
          return;
        }
        if (!r.code_acces || /^anon_/.test(r.code_acces)) {
          parModePlan.nonAbonne[m] = (parModePlan.nonAbonne[m] || 0) + 1;
          return;
        }
        const plan = planParCode[String(r.code_acces).toUpperCase()];
        if (plan === 'creator' || plan === 'pro') {
          parModePlan[plan][m] = (parModePlan[plan][m] || 0) + 1;
        }
      });
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    // Codes ayant généré quelque chose dans les 14 derniers jours (voir
    // carteInactifsAdmin, js/admin.js) : sert à repérer les abonnés qui ont
    // arrêté d'utiliser l'app sans se désabonner.
    let codesActifsRecents = [];
    try {
      const depuis14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const rActifs = await fetch(
        cfg.url + '/rest/v1/generations?select=code_acces&cree_le=gte.' + encodeURIComponent(depuis14),
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rowsActifs = await rActifs.json().catch(() => []);
      const set = new Set();
      (Array.isArray(rowsActifs) ? rowsActifs : []).forEach(r => { if (r.code_acces) set.add(r.code_acces); });
      codesActifsRecents = Array.from(set);
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    // Échecs de génération des 7 derniers jours (voir carteErreursAdmin,
    // js/admin.js, et le journal côté client dans callAI, js/api.js).
    // Table optionnelle (supabase/erreurs_generation.sql, à exécuter par le
    // propriétaire) : reste à 0 tant qu'elle n'existe pas, dégradation
    // silencieuse comme le reste de cette route.
    let erreursParMode = {};
    let erreursTotal = 0;
    try {
      const depuis7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const rErr = await fetch(
        cfg.url + '/rest/v1/erreurs_generation?select=mode&cree_le=gte.' + encodeURIComponent(depuis7),
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rowsErr = await rErr.json().catch(() => []);
      (Array.isArray(rowsErr) ? rowsErr : []).forEach(r => { const m = r.mode || 'autre'; erreursParMode[m] = (erreursParMode[m] || 0) + 1; erreursTotal++; });
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    // Détail brut de chaque échec (voir toggleDetailErreursMode,
    // js/admin.js) : le fondateur peut cliquer un mode dans la carte pour
    // voir ce qui s'est réellement passé, pas seulement un compte. Requête
    // SÉPARÉE de celle ci-dessus (qui doit rester exhaustive pour un total
    // exact) : celle-ci est limitée aux 50 plus récents, uniquement pour
    // l'affichage du détail, jamais pour le comptage.
    let erreursRecentes = [];
    try {
      const depuis7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const rErrDetail = await fetch(
        cfg.url + '/rest/v1/erreurs_generation?select=mode,detail,code_acces,cree_le&cree_le=gte.' + encodeURIComponent(depuis7) + '&order=cree_le.desc&limit=50',
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rowsErrDetail = await rErrDetail.json().catch(() => []);
      erreursRecentes = Array.isArray(rowsErrDetail) ? rowsErrDetail : [];
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    // Passes de perfectionnement des 14 derniers jours (voir
    // cartePassesAdmin, js/admin.js, et passes_generation.sql). Fenêtre plus
    // large que celle des échecs : on cherche une TENDANCE d'usage, pas un
    // incident, et il faut assez de générations pour que les pourcentages
    // veuillent dire quelque chose. Table optionnelle, comme le reste de cette
    // route : absente, la carte ne s'affiche simplement pas.
    let passes = [];
    try {
      const depuis14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const rPasses = await fetch(
        cfg.url + '/rest/v1/passes_generation?select=mode,duree_cible,mots_final,dans_cible,corrections_duree,critiques,revisions,second_brouillon&cree_le=gte.' + encodeURIComponent(depuis14) + '&order=cree_le.desc&limit=500',
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rowsPasses = await rPasses.json().catch(() => []);
      passes = Array.isArray(rowsPasses) ? rowsPasses : [];
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    // Vidéos réellement montées sur 30 jours (voir carteMontagesAdmin,
    // js/admin.js, et supabase/montages_rendus.sql). Même fenêtre que
    // `parMode` : le montage est un usage occasionnel, une semaine ne
    // dirait rien. Table optionnelle comme le reste de cette route :
    // absente, la carte ne s'affiche simplement pas.
    let montages = [];
    try {
      const depuis30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const rMontages = await fetch(
        cfg.url + '/rest/v1/montages_rendus?select=plan,nb_plans,duree_video_s,duree_rendu_ms,format,sous_titres,musique,filigrane,cree_le&cree_le=gte.'
        + encodeURIComponent(depuis30) + '&order=cree_le.desc&limit=500',
        { headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } }
      );
      const rowsMontages = await rMontages.json().catch(() => []);
      montages = Array.isArray(rowsMontages) ? rowsMontages : [];
    } catch (e) { /* section optionnelle, ne bloque pas le reste des stats */ }

    return res.status(200).json({
      total, actifs, creator, pro, parMode, parModePlan, codes: Array.isArray(codes) ? codes : [],
      codesActifsRecents, erreursParMode, erreursTotal, erreursRecentes, passes, montages
    });
  } catch (e) {
    return res.status(200).json({ indisponible: true });
  }
}

// ═══ PRÉSENCE (voir envoyerPresence, js/app.js) ═══
// Écrit toujours avec la clé publishable (même RLS ouverte que l'ancien
// appel direct au client, voir supabase/presence.sql), jamais besoin de la
// clé service_role : le signal "je suis encore là" ne doit jamais dépendre
// de sa configuration. Passe par le serveur (et non plus directement du
// client à Supabase) uniquement pour lire pays/navigateur depuis des
// en-têtes DE CONFIANCE (x-vercel-ip-country, injecté par la plateforme,
// jamais fourni par le client lui-même) : un visiteur ne peut pas se
// prétendre dans un autre pays. Jamais d'IP stockée (décision propriétaire,
// donnée personnelle identifiante hors de propos ici, voir
// supabase/presence.sql).
const PRESENCE_URL = 'https://nlkfqxllunbvppulpnzl.supabase.co';
const PRESENCE_KEY = 'sb_publishable_PqRwwhtRedPMvETLCp562g_7HKFsjLl';

function detecterNavigateur(ua) {
  if (!ua || typeof ua !== 'string') return null;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  let nom = 'Autre';
  if (/EdgA|Edge|Edg\//i.test(ua)) nom = 'Edge';
  else if (/OPR|Opera/i.test(ua)) nom = 'Opera';
  else if (/(Chrome|CriOS)\//i.test(ua) && !/Chromium/i.test(ua)) nom = 'Chrome';
  else if (/FxiOS|Firefox/i.test(ua)) nom = 'Firefox';
  else if (/Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Android/i.test(ua)) nom = 'Safari';
  return nom + (mobile ? ' mobile' : '');
}

async function handlePresence(req, res, body) {
  const ref = typeof body.ref === 'string' ? body.ref.trim().slice(0, 120) : '';
  if (!ref) return res.status(200).json({ ok: false });
  const paysEntete = req.headers['x-vercel-ip-country'];
  const pays = (Array.isArray(paysEntete) ? paysEntete[0] : paysEntete || '').toString().trim().slice(0, 8) || null;
  const uaEntete = req.headers['user-agent'];
  const navigateur = detecterNavigateur(Array.isArray(uaEntete) ? uaEntete[0] : uaEntete);
  try {
    const r = await fetch(PRESENCE_URL + '/rest/v1/presence?on_conflict=ref', {
      method: 'POST',
      headers: {
        apikey: PRESENCE_KEY, Authorization: 'Bearer ' + PRESENCE_KEY,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify([{ ref, derniere_activite: new Date().toISOString(), abonne: !!body.abonne, pays, navigateur }])
    });
    return res.status(200).json({ ok: r.ok });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}

// ═══ QUOTA MONTAGE (images), pour le panneau "Ton accès Scriptura" ═══
// Retour propriétaire : afficher le quota d'images de montage comme les
// autres compteurs (Générations, Diagnostic sommaire...). Impossible de
// réutiliser handleGenerations/action=count : les images de montage ne sont
// jamais insérées dans `generations`, seul `usage_serveur` (service_role
// uniquement) connaît le vrai décompte, voir lireUsageMontageImages.
async function handleQuotaMontage(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  const code = (req.query && req.query.code) || '';
  if (!code) return res.status(200).json({ ok: false, concerne: false });
  const droits = await resoudreDroits(code);
  const usage = await lireUsageMontageImages(droits, code);
  if (!usage) return res.status(200).json({ ok: true, concerne: false });
  return res.status(200).json({ ok: true, concerne: true, ...usage });
}

// ═══ QUOTA CARROUSEL (images), budget SÉPARÉ du montage ═══
// Le créateur doit voir ce qu'il lui reste AVANT de dépenser, sinon il
// découvre la limite en pleine génération, par un refus. Même source de
// vérité que le verrou serveur (usage_serveur via lireUsageImages), jamais
// un compteur local qu'un rechargement remettrait à zéro.
async function handleQuotaCarrousel(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  const code = (req.query && req.query.code) || '';
  if (!code) return res.status(200).json({ ok: false, concerne: false });
  const droits = await resoudreDroits(code);
  const usage = await lireUsageImages(droits, code, 'carrouselImages');
  if (!usage) return res.status(200).json({ ok: true, concerne: false });
  return res.status(200).json({ ok: true, concerne: true, ...usage });
}

// Lecture seule du VRAI compteur de générations gratuites (usage_serveur,
// IP), pour que l'affichage client (fetchServerQuota, js/api.js) suive la
// même source que le verrou serveur réel (verifierLimiteAnonyme,
// api/generate.js), au lieu de la table `quotas` séparée écrite en clair
// par le navigateur (voir lireUsageAnonyme, api/_lib/acces.js).
async function handleQuotaGenerationGratuite(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Méthode non autorisée' });
  const used = await lireUsageAnonyme(req, 'generate_creation', true);
  if (used == null) return res.status(200).json({ ok: false });
  return res.status(200).json({ ok: true, used });
}

// ═══ POINT D'ENTRÉE COMMUN ═══

export default async function handler(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const resource = req.method === 'GET' ? (req.query && req.query.resource) : body.resource;

  if (resource === 'presence') return handlePresence(req, res, body);
  if (resource === 'quotaMontage') return handleQuotaMontage(req, res);
  if (resource === 'quotaCarrousel') return handleQuotaCarrousel(req, res);
  if (resource === 'quotaGenerationGratuite') return handleQuotaGenerationGratuite(req, res);

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
    if (resource === 'erreur') return await handleErreur(req, res, cfg, body);
    if (resource === 'passes') return await handlePasses(req, res, cfg, body);
    return res.status(400).json({ ok: false, error: 'resource inconnue' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'erreur' });
  }
}

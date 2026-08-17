// ═══════════════════════════════════════════════════════════
//  /api/generations, Accès à la table `generations` (historique de tout ce
//  qu'un créateur a généré : script, récit, idées, storyboard, diagnostics,
//  audits). Remplace les appels Supabase directs de js/historique.js et
//  js/diagnostic-sommaire.js : la table n'accepte plus l'accès du rôle anon
//  (voir supabase/generations_series_rls.sql), un utilisateur pouvait
//  sinon lire, modifier ou supprimer la ligne de n'importe qui d'autre en
//  appelant Supabase directement (aucune vérification n'existait, ni côté
//  RLS, ni même côté client pour les suppressions/favoris en masse).
//
//  Chaque action qui touche une ligne PRÉCISE (patch/save-regen/favori/
//  delete) vérifie d'abord que `code_acces` de la ligne correspond bien au
//  `code` fourni, avant de faire quoi que ce soit. Comme le reste de
//  l'app, l'identité reste le code d'accès (aucune session réelle n'existe
//  dans Scriptura) : ce verrou empêche un appel Supabase direct de
//  contourner ce contrôle, il ne peut pas prouver cryptographiquement la
//  possession du code, seulement s'assurer qu'AUCUNE opération ne peut se
//  faire sans le fournir et qu'il correspond bien à la ligne visée.
// ═══════════════════════════════════════════════════════════

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

// Vérifie que la ligne `id` appartient bien à `code`. Renvoie la ligne
// (avec `contenu`) si oui, null sinon (absente OU code différent).
async function ligneAppartientA(cfg, id, code) {
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

export default async function handler(req, res) {
  const cfg = config();
  if (!cfg) return res.status(200).json({ ok: false, indisponible: true });

  try {
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
        // limit=1 (défaut) -> une seule ligne (data = objet ou null).
        // limit>1 -> plusieurs (data = tableau), voir js/diagnostic-fusion.js.
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

    if (req.method !== 'POST') {
      return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const action = body.action;
    const code = body.code || '';
    if (!code) return res.status(400).json({ ok: false, error: 'code manquant' });

    if (action === 'save') {
      const r = await fetch(cfg.url + '/rest/v1/generations', {
        method: 'POST',
        headers: { ...entetes(cfg.key), Prefer: 'return=representation' },
        body: JSON.stringify({
          code_acces: code,
          mode: body.mode,
          titre: body.titre || 'Sans titre',
          contenu: body.contenu
        })
      });
      const data = await r.json().catch(() => null);
      const row = Array.isArray(data) && data[0];
      return res.status(200).json({ ok: !!row, id: row ? row.id : null });
    }

    if (action === 'save-regen') {
      // Régénération gratuite : met à jour une ligne existante au lieu d'en
      // créer une nouvelle (ne compte pas dans le quota). Vérifie d'abord
      // que cette ligne appartient bien à ce code.
      const ligne = await ligneAppartientA(cfg, body.id, code);
      if (!ligne) return res.status(200).json({ ok: false });
      await fetch(cfg.url + '/rest/v1/generations?id=eq.' + encodeURIComponent(body.id), {
        method: 'PATCH',
        headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
        body: JSON.stringify({ titre: body.titre || 'Sans titre', contenu: body.contenu })
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'patch') {
      // Lit le contenu actuel, fusionne les champs fournis, réécrit :
      // couvre le storyboard rattaché, le guide de montage, les retouches
      // de script/récit, la recommandation post-audit, la comparaison
      // concurrent (diagnostic sommaire). Vérifie l'appartenance avant
      // toute écriture.
      const ligne = await ligneAppartientA(cfg, body.id, code);
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
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
        body: JSON.stringify({ favori: !!body.valeur })
      });
      return res.status(200).json({ ok: r.ok });
    }

    if (action === 'delete') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return res.status(200).json({ ok: true });
      // La clause code_acces=eq.<code> restreint la suppression aux SEULES
      // lignes qui appartiennent à ce code, même si un id d'un autre
      // utilisateur était glissé dans la liste.
      const url = cfg.url + '/rest/v1/generations?code_acces=eq.' + encodeURIComponent(code) +
        '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
      const r = await fetch(url, { method: 'DELETE', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' } });
      return res.status(200).json({ ok: r.ok });
    }

    return res.status(400).json({ ok: false, error: 'action inconnue' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'erreur' });
  }
}

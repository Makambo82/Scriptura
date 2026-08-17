// ═══════════════════════════════════════════════════════════
//  /api/series, Accès à la table `series` (mode Série : bible, épisodes).
//  Même principe que api/generations.js : la table n'accepte plus l'accès
//  direct du rôle anon (voir supabase/generations_series_rls.sql), toute
//  opération qui touche une série précise vérifie d'abord que
//  `code_acces` correspond au `code` fourni.
// ═══════════════════════════════════════════════════════════

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

async function ligneAppartientA(cfg, id, code) {
  const r = await fetch(
    cfg.url + '/rest/v1/series?id=eq.' + encodeURIComponent(id) + '&select=*',
    { headers: entetes(cfg.key) }
  );
  const rows = await r.json().catch(() => []);
  const row = Array.isArray(rows) && rows[0];
  if (!row || row.code_acces !== code) return null;
  return row;
}

export default async function handler(req, res) {
  const cfg = config();
  if (!cfg) return res.status(200).json({ ok: false, indisponible: true });

  try {
    if (req.method === 'GET') {
      const action = req.query && req.query.action;
      const code = (req.query && req.query.code) || '';
      if (!code) return res.status(200).json({ ok: false, data: [] });

      if (action === 'list') {
        const r = await fetch(
          cfg.url + '/rest/v1/series?code_acces=eq.' + encodeURIComponent(code) + '&select=*&order=cree_le.desc',
          { headers: entetes(cfg.key) }
        );
        const data = await r.json().catch(() => []);
        return res.status(200).json({ ok: true, data: Array.isArray(data) ? data : [] });
      }

      if (action === 'get') {
        const serie = await ligneAppartientA(cfg, req.query.id, code);
        return res.status(200).json({ ok: !!serie, data: serie || null });
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
      const r = await fetch(cfg.url + '/rest/v1/series', {
        method: 'POST',
        headers: { ...entetes(cfg.key), Prefer: 'return=representation' },
        body: JSON.stringify({
          code_acces: code,
          titre: body.titre,
          concept: body.concept,
          niche: body.niche,
          style: body.style,
          genre: body.genre,
          bible: body.bible,
          nb_episodes: body.nb_episodes,
          episode_courant: 0,
          episodes: []
        })
      });
      const data = await r.json().catch(() => null);
      const row = Array.isArray(data) && data[0];
      return res.status(200).json({ ok: !!row, data: row || null });
    }

    if (action === 'update') {
      // `patch` : sous-ensemble parmi episodes/episode_courant/statut,
      // toujours envoyé par le client déjà calculé (même logique métier
      // qu'avant, seule l'écriture change de chemin). Vérifie
      // l'appartenance avant toute écriture.
      const ligne = await ligneAppartientA(cfg, body.id, code);
      if (!ligne) return res.status(200).json({ ok: false });
      const champsAutorises = ['episodes', 'episode_courant', 'statut'];
      const patch = {};
      for (const k of champsAutorises) if (body.patch && body.patch[k] !== undefined) patch[k] = body.patch[k];
      await fetch(cfg.url + '/rest/v1/series?id=eq.' + encodeURIComponent(body.id), {
        method: 'PATCH',
        headers: { ...entetes(cfg.key), Prefer: 'return=minimal' },
        body: JSON.stringify(patch)
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'favori') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return res.status(200).json({ ok: true });
      const url = cfg.url + '/rest/v1/series?code_acces=eq.' + encodeURIComponent(code) +
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
      const url = cfg.url + '/rest/v1/series?code_acces=eq.' + encodeURIComponent(code) +
        '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
      const r = await fetch(url, { method: 'DELETE', headers: { ...entetes(cfg.key), Prefer: 'return=minimal' } });
      return res.status(200).json({ ok: r.ok });
    }

    return res.status(400).json({ ok: false, error: 'action inconnue' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'erreur' });
  }
}

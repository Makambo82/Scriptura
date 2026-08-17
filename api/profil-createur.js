// ═══════════════════════════════════════════════════════════
//  /api/profil-createur, Lecture/écriture du Profil Créateur (mémoire
//  vivante par code, voir js/profil.js). Jusqu'ici, le client lisait/
//  écrivait `profils_createurs` en direct sur Supabase avec la clé
//  publique : n'importe qui pouvait lire ou modifier le profil de
//  n'importe quel code d'accès. Passe désormais par la clé service_role,
//  la table `profils_createurs` n'accepte plus l'accès direct du rôle anon
//  (voir supabase/profils_createurs_rls.sql).
//
//  GET  ?code=XXX        -> { profil } (objet vide si absent)
//  POST { code, profil } -> { ok:true }
// ═══════════════════════════════════════════════════════════

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function entetes(key) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
}

export default async function handler(req, res) {
  const cfg = config();
  if (!cfg) return res.status(200).json({ profil: {} }); // pas configuré : dégradation, comme avant

  try {
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
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const code = (body && body.code) || '';
      const profil = (body && body.profil) || {};
      if (!code) return res.status(400).json({ error: { message: 'code manquant' } });
      const r = await fetch(cfg.url + '/rest/v1/profils_createurs', {
        method: 'POST',
        headers: { ...entetes(cfg.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ code_acces: code, profil, maj_le: new Date().toISOString() })
      });
      if (!r.ok) return res.status(200).json({ ok: false }); // best-effort, ne bloque jamais l'app
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  } catch (e) {
    return res.status(200).json({ ok: false, profil: {} }); // ne jamais casser l'app pour ça
  }
}

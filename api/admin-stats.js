// ═══════════════════════════════════════════════════════════
//  /api/admin-stats, Statistiques d'abonnés pour le Tableau de bord
//  fondateur (js/admin.js chargerCarteAbonnes). Lit `abonnes` avec la clé
//  service_role : nécessaire depuis que la RLS interdit au rôle anon tout
//  accès direct à cette table (voir supabase/abonnes_rls.sql). Avant,
//  js/admin.js interrogeait Supabase directement avec la clé publique,
//  protégé seulement par une classe CSS (body.is-admin) : n'importe qui
//  pouvait falsifier ce flag dans localStorage. Ici l'admin est vérifié
//  côté SERVEUR (resoudreDroits) avant de renvoyer la moindre donnée.
// ═══════════════════════════════════════════════════════════

import { resoudreDroits } from './_lib/acces.js';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Réservé au fondateur', code: 'ACCES_REFUSE' } });
  }

  const cfg = config();
  if (!cfg) {
    return res.status(200).json({ indisponible: true });
  }

  try {
    const entetes = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, Prefer: 'count=exact' };
    const compter = async (filtre) => {
      const r = await fetch(cfg.url + '/rest/v1/abonnes?select=code' + filtre, { method: 'HEAD', headers: entetes });
      const c = r.headers.get('content-range');
      return c ? parseInt(c.split('/')[1], 10) || 0 : 0;
    };
    const [total, actifs, creator, pro] = await Promise.all([
      compter(''),
      compter('&actif=eq.true'),
      compter('&actif=eq.true&plan=eq.creator'),
      compter('&actif=eq.true&plan=eq.pro')
    ]);

    // Générations par mode, 30 derniers jours (js/admin.js chargerCarteModes,
    // qui lisait `generations` en direct avec la clé anon avant que la
    // table ne soit verrouillée, voir supabase/generations_series_rls.sql).
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

    return res.status(200).json({ total, actifs, creator, pro, parMode });
  } catch (e) {
    return res.status(200).json({ indisponible: true });
  }
}

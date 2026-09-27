// ═══════════════════════════════════════════════════════════
//  /api/cron-nettoyage-montages, PURGE QUOTIDIENNE (Vercel Cron, voir
//  vercel.json) des vidéos montées jamais téléchargées.
//
//  Retour propriétaire (27/09) : « supprimer après téléchargement » (déjà en
//  place, voir api/montage-media.js action=confirmer-telechargement) laisse
//  un trou - une vidéo rendue puis jamais téléchargée (abandon, onglet
//  fermé) reste dans le Storage pour toujours. Ce fichier ferme ce trou :
//  toute vidéo listée dans `montages_video` (voir supabase/montages_video.sql)
//  depuis plus de 3 jours est supprimée du Storage ET de cette table, qu'elle
//  ait été téléchargée ou non.
//
//  PROTÉGÉ par CRON_SECRET (variable d'environnement Vercel à ajouter en
//  plus de MONTAGE_RENDER_URL/TOKEN, voir README) : sans elle, cette route
//  supprimerait des fichiers sur simple appel HTTP public, n'importe qui
//  pourrait la déclencher à volonté. Refus de fonctionner plutôt qu'un
//  repli non protégé (même règle que verifierAccesMontage ailleurs) :
//  jamais de purge tant que CRON_SECRET n'est pas configurée.
// ═══════════════════════════════════════════════════════════

const RETENTION_JOURS = 3;

function cheminDepuisUrlStorage(valeur) {
  if (typeof valeur !== 'string' || !valeur) return null;
  let u;
  try { u = new URL(valeur); } catch (e) { return null; }
  const m = /^\/storage\/v1\/object\/(?:sign|public)\/montages\/(.+)$/.exec(u.pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(500).json({ error: { message: 'CRON_SECRET absente : purge refusée plutôt que non protégée.' } });
  }
  if (req.headers?.authorization !== 'Bearer ' + secret) {
    return res.status(401).json({ error: { message: 'Non autorisé' } });
  }

  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(200).json({ ok: false, purgees: 0 });

  const seuil = new Date(Date.now() - RETENTION_JOURS * 24 * 60 * 60 * 1000).toISOString();
  const entetes = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  try {
    const rListe = await fetch(
      url + '/rest/v1/montages_video?cree_le=lt.' + encodeURIComponent(seuil) + '&select=id,url',
      { headers: entetes }
    );
    const lignes = await rListe.json().catch(() => []);
    if (!Array.isArray(lignes) || !lignes.length) return res.status(200).json({ ok: true, purgees: 0 });

    const chemins = [...new Set(lignes.map(l => cheminDepuisUrlStorage(l.url)).filter(Boolean))];
    if (chemins.length) {
      const rRemove = await fetch(url + '/storage/v1/object/remove/montages', {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify({ prefixes: chemins })
      });
      // Le fichier reste dans le Storage tant qu'on n'est pas sûr qu'il ait
      // vraiment été retiré : la ligne DB reste alors en place, retentée au
      // prochain passage plutôt que de perdre la trace d'un fichier orphelin.
      if (!rRemove.ok) {
        return res.status(200).json({ ok: false, purgees: 0, erreur: 'retrait Storage échoué (' + rRemove.status + ')' });
      }
    }

    const ids = lignes.map(l => l.id);
    await fetch(url + '/rest/v1/montages_video?id=in.(' + ids.join(',') + ')', {
      method: 'DELETE',
      headers: { ...entetes, Prefer: 'return=minimal' }
    });
    return res.status(200).json({ ok: true, purgees: lignes.length });
  } catch (e) {
    return res.status(200).json({ ok: false, purgees: 0, erreur: e.message || 'inconnue' });
  }
}

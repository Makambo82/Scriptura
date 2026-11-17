// api/transcribe-upload.js
// Reçoit un chemin Supabase Storage (bucket `montages`, déjà utilisé par
// le montage vidéo), génère une URL signée de lecture (2h), puis demande
// à ElevenLabs Scribe de transcrire depuis cette URL.
//
// Aucun octet de vidéo ne traverse Vercel : le navigateur dépose
// directement dans Supabase via uploaderAssetMontage (js/api.js), qui
// utilise déjà des slots signés. Vercel ne voit que le chemin.
//
// Sécurité : le bucket `montages` est déjà protégé par verifierAccesMontage
// (Creator/Pro), on refait la vérification ici (défense en profondeur),
// et on consomme le quota `analyseVirale` comme une transcription par URL
// (même coût ElevenLabs, même usage).
//
// Le fichier est supprimé du stockage après transcription (décision produit,
// le fichier n'a plus de valeur). La suppression est best-effort, jamais
// bloquante.

import { resoudreDroits, verifierQuota, codeAccesRefuse } from './_lib/acces.js';

const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_TRANSCRIPT = 8000;
const BUCKET = 'montages';
// Doit rester synchronisé avec MONTAGE_STORAGE_CHEMIN_RE (api/data.js).
const CHEMIN_RE = /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_.-]{1,80}$/;

function config() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function urlSigneeLecture(cfg, chemin) {
  const r = await fetch(cfg.url + '/storage/v1/object/sign/' + BUCKET + '/' + chemin, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 2 * 60 * 60 })
  });
  const data = await r.json().catch(() => ({}));
  const m = /token=([^"\\&]+)/.exec(JSON.stringify(data || {}));
  if (!r.ok || !m) return null;
  return cfg.url + '/storage/v1/object/sign/' + BUCKET + '/' + chemin + '?token=' + m[1];
}

async function supprimerFichier(cfg, chemin) {
  // Best-effort, jamais bloquant : une suppression ratée ne doit pas faire
  // échouer la transcription. Un cron de nettoyage pourra rattraper.
  try {
    await fetch(cfg.url + '/storage/v1/object/' + BUCKET + '/' + chemin, {
      method: 'DELETE',
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key }
    });
  } catch (e) { /* silencieux */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const cfg = config();
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!cfg) return res.status(500).json({ error: { message: 'Stockage non configuré.' } });
  if (!elevenKey) return res.status(500).json({ error: { message: 'ELEVENLABS_API_KEY absente côté serveur.' } });

  try {
    const { chemin, code_acces } = req.body || {};
    if (!chemin || typeof chemin !== 'string' || !CHEMIN_RE.test(chemin)) {
      return res.status(400).json({ error: { message: 'Chemin invalide.' } });
    }

    // 1. Droits (Creator/Pro, comme le bucket `montages`)
    const droits = await resoudreDroits(code_acces);
    if (!droits.ok) {
      return res.status(403).json({ error: { message: 'Accès refusé : ' + droits.raison, code: codeAccesRefuse(droits) } });
    }
    if (droits.anonyme) {
      return res.status(403).json({ error: { message: 'Réservé aux abonnés Creator et Pro.', code: 'ACCES_REFUSE' } });
    }
    if (droits.plan !== 'creator' && droits.plan !== 'pro' && !droits.illimite && !droits.isAdmin) {
      return res.status(403).json({ error: { message: 'Réservé aux abonnés Creator et Pro.', code: 'ACCES_REFUSE' } });
    }

    // 2. Quota (même compteur que la transcription par URL)
    const verdict = await verifierQuota(droits, 'analyseVirale', code_acces);
    if (!verdict.ok) {
      return res.status(403).json({ error: { message: "Quota d'analyses vidéo atteint.", code: 'QUOTA_ATTEINT', raison: verdict.raison } });
    }

    // 3. URL signée de lecture
    const urlSignee = await urlSigneeLecture(cfg, chemin);
    if (!urlSignee) {
      return res.status(502).json({ error: { message: 'Fichier introuvable dans le stockage.' } });
    }

    // 4. ElevenLabs Scribe, mode cloud_storage_url (2 Go max, formats majeurs)
    const form = new FormData();
    form.append('cloud_storage_url', urlSignee);
    form.append('model_id', 'scribe_v1');

    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 240000); // 4 min
    let stt = null;
    try {
      const r = await fetch(ELEVEN_STT, {
        method: 'POST',
        headers: { 'xi-api-key': elevenKey },
        body: form,
        signal: ctrl.signal
      });
      const txt = await r.text();
      let data = null;
      try { data = JSON.parse(txt); } catch (e) {}
      if (r.ok) stt = { ok: true, text: (data && data.text) || '', lang: data && (data.language_code || data.language) };
      else stt = { ok: false, message: (data && (data.detail?.message || data.detail || data.message)) || txt.slice(0, 300) };
    } catch (e) {
      stt = { ok: false, message: 'délai dépassé ou réseau (' + (e && e.message) + ')' };
    } finally {
      clearTimeout(minuteur);
    }

    // 5. Suppression du fichier après transcription (best-effort)
    await supprimerFichier(cfg, chemin);

    if (!stt.ok) {
      return res.status(200).json({ ok: false, raison: 'stt_echec', error: { message: stt.message } });
    }
    const transcript = (stt.text || '').trim().slice(0, MAX_TRANSCRIPT);
    return res.status(200).json({
      ok: transcript.length > 10,
      transcript,
      langue: stt.lang || null,
      raison: transcript.length > 10 ? null : 'sans_parole'
    });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

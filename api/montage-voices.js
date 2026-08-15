// ═══════════════════════════════════════════════════════════
//  /api/montage-voices, Liste des voix ElevenLabs disponibles pour le
//  montage, pour le sélecteur côté client (voir js/montage.js).
//
//  Configurée via ELEVENLABS_VOICES, un tableau JSON dans Vercel :
//  [{"id":"21m00Tcm4TlvDq8ikWAM","label":"Rachel"}, {"id":"...","label":"..."}]
//  À défaut (variable absente ou invalide), repli sur une seule voix
//  construite à partir de ELEVENLABS_VOICE_ID (l'ancienne configuration à
//  voix unique continue de fonctionner sans rien changer).
// ═══════════════════════════════════════════════════════════

function obtenirVoixDisponibles() {
  const brut = process.env.ELEVENLABS_VOICES;
  if (brut) {
    try {
      const liste = JSON.parse(brut);
      if (Array.isArray(liste) && liste.length && liste.every(v => v && v.id)) {
        // .trim() : un espace ou un retour à la ligne collé par erreur en
        // copiant l'ID dans Vercel suffit à faire échouer ElevenLabs avec
        // "The string did not match the expected pattern", mieux vaut
        // nettoyer ici que de dépendre d'une saisie parfaite.
        return liste.map(v => ({ id: String(v.id).trim(), label: String(v.label || v.name || v.id).trim() }));
      }
    } catch (e) { /* tombe sur le repli ci-dessous */ }
  }
  const idUnique = (process.env.ELEVENLABS_VOICE_ID || '').trim();
  return idUnique ? [{ id: idUnique, label: 'Voix par défaut' }] : [];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  }
  return res.status(200).json({ voices: obtenirVoixDisponibles() });
}

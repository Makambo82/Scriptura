// ═══════════════════════════════════════════════════════════
//  CRÉATION VIDÉO AUTOMATIQUE — depuis le storyboard de "J'ai une idée"
//  et de "Storytelling". Fichier INDÉPENDANT, appelle /api/generate-video.
//  Réservé aux abonnés (coût réel par vidéo : images + voix + calcul).
// ═══════════════════════════════════════════════════════════

const MAX_SEGMENTS_VIDEO = 14;

function normaliserSegmentsPourVideo(storyboard, mode) {
  // Mode script : {segment, texte_dit, prompt_visuel}
  // Mode story  : {segment, duree, texte, visuel}
  return (storyboard || []).map(s => ({
    texte: (mode === 'script' ? s.texte_dit : s.texte) || '',
    visuel: (mode === 'script' ? s.prompt_visuel : s.visuel) || ''
  })).filter(s => s.texte && s.visuel);
}

async function creerVideoDepuisStoryboard(storyboard, mode, titre, idBoutonZone) {
  if (!unlocked) {
    openPlans('video');
    return;
  }

  // Le titre n'est pas toujours transmis directement (évite de le glisser
  // dans un attribut onclick) : on le retrouve depuis le contexte du mode.
  if (!titre) {
    titre = mode === 'script'
      ? (lastGenContext && lastGenContext.sujet) || 'Vidéo Scriptura'
      : (currentStory && currentStory.titre) || 'Vidéo Scriptura';
  }

  const segments = normaliserSegmentsPourVideo(storyboard, mode);
  if (!segments.length) {
    toastRegen('Storyboard vide, impossible de créer la vidéo');
    return;
  }
  if (segments.length > MAX_SEGMENTS_VIDEO) {
    toastRegen('Storyboard trop long pour la vidéo automatique (max ' + MAX_SEGMENTS_VIDEO + ' plans)');
    return;
  }

  const zone = document.getElementById(idBoutonZone);
  if (zone) zone.innerHTML = '<div class="ideas-sub">🎬 Création de la vidéo en cours — jusqu\'à quelques minutes, ne quitte pas cet écran…</div>';

  startGenAnimation('video');

  try {
    const res = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments,
        mode,
        titre: titre || 'Vidéo Scriptura',
        code_acces: localStorage.getItem('scriptura_code') || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Échec de la création vidéo');

    if (zone) {
      zone.innerHTML = `
        <div class="score-card">
          <div class="score-title">🎬 VIDÉO PRÊTE</div>
          <video src="${data.url}" controls playsinline style="width:100%;max-width:340px;border-radius:8px;margin-top:14px;display:block"></video>
          <a class="btn-generate" style="display:inline-flex;margin-top:14px" href="${data.url}" download target="_blank" rel="noopener">⬇ Télécharger la vidéo</a>
        </div>`;
    }
  } catch (e) {
    if (zone) zone.innerHTML = `<div class="error-box" style="display:block">Erreur : ${e.message} — réessaie, ou vérifie que le storyboard n'est pas trop long.</div>`;
  } finally {
    stopGenAnimation();
  }
}

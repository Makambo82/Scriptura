// ═══════════════════════════════════════════════════════════
//  /api/montage-media, REGROUPE 4 routes du montage qui étaient chacune
//  leur propre fonction serverless (montage-download, montage-voices,
//  montage-tts, montage-images) : le plan Vercel Hobby plafonne à 12
//  fonctions serverless par déploiement, dépassé silencieusement (voir
//  api/data.js pour le détail de l'incident). Consolidation mécanique,
//  comportement de chaque route inchangé : un champ `action` (query pour
//  toutes, GET comme POST) sélectionne la route d'origine.
//
//  action=download | voices | tts | images
// ═══════════════════════════════════════════════════════════

import { resoudreDroits, verifierAccesMontage, verifierQuota, rembourserUsage } from './_lib/acces.js';

// ══ LIRE UNE RÉPONSE QUI N'EST PAS FORCÉMENT DU JSON ══
//
// UNE FAMILLE DE DÉFAUTS, PAS UN CAS ISOLÉ, et c'est pour ça que ça vit ici.
// Ce fichier appelle trois fournisseurs (Together pour les images, ElevenLabs
// pour la voix et la musique). Chacun peut répondre autre chose que du JSON :
// une passerelle en panne renvoie du HTML, un 502 renvoie parfois un corps
// vide. `await rep.json()` lève alors une SyntaxError, et ce qui arrivait sous
// les yeux du créateur, c'était « Unexpected token '<', "<html> <h"... is not
// valid JSON ». Deux endroits faisaient exactement ça, et un troisième
// (la musique) s'en gardait déjà, preuve que le piège était connu sans avoir
// été traité partout.
//
// Rend l'objet analysé, ou null. Jamais d'exception : c'est l'appelant qui
// décide quoi dire et s'il faut réessayer, en connaissant le statut HTTP.
function analyserJson(brut) {
  if (!brut) return null;
  try { return JSON.parse(brut); } catch (e) { return null; }
}

async function lireJsonOuNull(rep) {
  return analyserJson(await rep.text().catch(() => ''));
}

// ═══ DOWNLOAD (voir l'ancien api/montage-download.js) ═══
//
// LOT 4B, audit ID 6 (Gate Phase 2B) : flux reconstitué AVANT tout correctif
// (exigé par la tâche) -
//   1. render-service (Railway) rend la vidéo, l'UPLOAD lui-même dans le
//      bucket Storage `montages` (privé) et la SIGNE (voir urlAssetApprouvee
//      et /storage/v1/object/sign/montages/<chemin>, render-service/server.js) ;
//   2. POST /api/montage-render (ce dépôt) relaie cette URL SIGNÉE telle
//      quelle au navigateur (`{url: dataProxy.url}`), sans jamais la stocker
//      ni l'associer à un `code_acces` nulle part côté serveur - render-service
//      ne reçoit JAMAIS le `code_acces` de l'appelant (voir le corps envoyé à
//      /render, api/montage-render.js), il ne peut donc pas l'inscrire dans
//      le chemin de l'objet qu'il crée ;
//   3. js/montage.js transmet cette URL telle quelle à `?action=download`,
//      uniquement pour la PROXIER (fetch serveur, Content-Disposition:
//      attachment), afin d'éviter tout souci CORS et d'obtenir le fichier via
//      navigator.share (voir prechargerVideoMontage/partagerVideoMontage,
//      js/montage.js) - cette route ne reçoit JAMAIS code_acces, ce n'était
//      pas un oubli (voir la limite assumée ci-dessous).
//
// CE QUI EST VÉRIFIABLE SANS CHANGER LE CONTRAT FRONTEND, ET DONC CORRIGÉ ICI :
// l'ancienne vérification ne portait que sur le NOM D'HÔTE (une regex figée
// sur un seul sous-domaine, jamais dérivée de SUPABASE_URL) - un projet
// Supabase sert PLUSIEURS API sous LE MÊME NOM D'HÔTE (Storage, REST,
// Auth...), donc une url malveillante du type https://<même hôte>/rest/v1/
// <table> passait cette vérification alors qu'elle ne pointe pas du tout
// vers un objet Storage. Repris ICI À L'IDENTIQUE le contrôle déjà audité de
// render-service (urlAssetApprouvee, render-service/server.js, audit A1) :
// origine EXACTE dérivée de SUPABASE_URL (jamais un hôte codé en dur) ET
// chemin sous /storage/v1/object/(public|sign)/montages/ - jamais une autre
// route Supabase du même projet.
//
// CE QUI RESTE RÉELLEMENT OUVERT, ASSUMÉ ET DOCUMENTÉ (pas une négligence,
// une limite de ce qui est vérifiable sans changer d'architecture) : cette
// route ne peut PAS vérifier que l'appelant est bien le créateur qui a
// commandé CE rendu précis, puisque cette identité n'existe nulle part dans
// le chemin de l'objet ni dans une table qui l'associerait à cette URL (voir
// point 2 ci-dessus). La fermer proprement demanderait de changer le
// CONTRAT (faire transiter code_acces jusqu'à render-service, lui faire
// inscrire ce code dans le chemin de l'objet, ou tenir une table de
// correspondance url signée <-> code_acces) : un changement d'architecture,
// explicitement hors du périmètre de ce lot. Le Gate Phase 2B avait déjà
// qualifié ce risque de FAIBLE, n'accordant aucun accès nouveau au-delà de
// ce qu'une URL signée déjà connue permettrait de toute façon : ce correctif
// referme la vraie ouverture (élargissement SSRF vers d'autres routes
// Supabase du même hôte), pas celle, architecturale, qui reste.
function origineStorageApprouvee() {
  const base = process.env.SUPABASE_URL || '';
  if (!base) return '';
  try { return new URL(base).origin; } catch (e) { return ''; }
}

function urlStorageMontageApprouvee(valeur) {
  if (typeof valeur !== 'string' || !valeur) return false;
  let u;
  try { u = new URL(valeur); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  const origine = origineStorageApprouvee();
  if (!origine || u.origin !== origine) return false;
  return u.pathname.startsWith('/storage/v1/object/public/montages/')
    || u.pathname.startsWith('/storage/v1/object/sign/montages/');
}

async function handleDownload(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const cible = req.query?.url;
  if (!cible || typeof cible !== 'string') {
    return res.status(400).json({ error: { message: 'Paramètre url manquant' } });
  }
  if (!urlStorageMontageApprouvee(cible)) {
    return res.status(403).json({ error: { message: 'URL non autorisée' } });
  }

  try {
    const rep = await fetch(cible);
    if (!rep.ok || !rep.body) {
      return res.status(502).json({ error: { message: 'Vidéo introuvable côté serveur distant' } });
    }
    res.setHeader('Content-Type', rep.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="scriptura-montage.mp4"');
    const buffer = Buffer.from(await rep.arrayBuffer());
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ VOIX (partagé entre voices et tts, voir les anciens api/montage-voices.js / api/montage-tts.js) ═══

function obtenirVoixDisponibles() {
  const brut = process.env.ELEVENLABS_VOICES;
  if (brut) {
    try {
      const liste = JSON.parse(brut);
      if (Array.isArray(liste) && liste.length && liste.every(v => v && v.id)) {
        // description optionnelle (retour propriétaire : afficher la
        // caractéristique de chaque voix, ex. "voix masculine posée de la
        // quarantaine", sous son nom au moment de choisir) : réglée dans
        // cette même variable d'environnement, jamais codée en dur ici,
        // cohérent avec id/label déjà entièrement configurés côté Vercel.
        return liste.map(v => ({
          id: String(v.id).trim(),
          label: String(v.label || v.name || v.id).trim(),
          description: v.description ? String(v.description).trim() : ''
        }));
      }
    } catch (e) { /* tombe sur le repli ci-dessous */ }
  }
  const idUnique = (process.env.ELEVENLABS_VOICE_ID || '').trim();
  return idUnique ? [{ id: idUnique, label: 'Voix par défaut', description: '' }] : [];
}

async function handleVoices(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });
  return res.status(200).json({ voices: obtenirVoixDisponibles() });
}

// ═══ TTS (voir l'ancien api/montage-tts.js) ═══

function retirerMinuterie(texte) {
  return texte
    .replace(/^\s*[([]?\s*\d+\s*(?:à|-|–)\s*\d+\s*(?:sec(?:ondes?)?)?\s*[)\]]?\s*[:\-–,]?\s*/i, '')
    .replace(/^\s*[([]?\s*\d{1,2}:\d{2}(?:\s*(?:à|-|–)\s*\d{1,2}:\d{2})?\s*[)\]]?\s*[:\-–,]?\s*/i, '')
    .trim();
}

// Sous-titres incrustés dans la vidéo (retour propriétaire : le montage
// sans sous-titres "ne se sent pas fini" pour du TikTok). Style choisi
// explicitement : ni un carton par plan (trop long à lire, peu dynamique),
// ni le mot par mot façon karaoké (v2 potentielle, demande un montage plus
// fin) mais des petits groupes de mots - le repère visuel TikTok le plus
// courant. Découpage à partir de l'horodatage caractère par caractère
// renvoyé par ElevenLabs (déjà là pour caler la durée de chaque plan,
// jusqu'ici jeté après usage).
// 2e passe (retour propriétaire : "2 mots ça fait beau, ça peut aller
// jusqu'à 4 mots") : seuils à paliers plutôt qu'un simple "2 longs ou 3
// courts" - un groupe s'arrête dès qu'il atteint 4 mots (plafond dur), ou
// avant si les mots sont assez longs pour bien remplir l'écran à 3 ou 2
// mots (mots courts -> jusqu'à 4 ; mots longs -> 2 suffisent).
const SOUS_TITRE_SEUIL_2_MOTS = 10; // caractères cumulés à partir desquels 2 mots suffisent
const SOUS_TITRE_SEUIL_3_MOTS = 15; // caractères cumulés à partir desquels 3 mots suffisent
const SOUS_TITRE_MAX_MOTS = 4;

function extraireMots(texte, debutsTemps, finsTemps) {
  const mots = [];
  let i = 0;
  while (i < texte.length) {
    while (i < texte.length && /\s/.test(texte[i])) i++;
    if (i >= texte.length) break;
    const debutIdx = i;
    while (i < texte.length && !/\s/.test(texte[i])) i++;
    const finIdx = i - 1;
    mots.push({
      texte: texte.slice(debutIdx, i),
      debut: debutsTemps[debutIdx] ?? 0,
      fin: finsTemps[finIdx] ?? (debutsTemps[debutIdx] ?? 0)
    });
  }
  return mots;
}

function regrouperEnSousTitres(mots) {
  const groupes = [];
  let courant = [];
  let longueurCourante = 0;
  for (const mot of mots) {
    courant.push(mot);
    longueurCourante += mot.texte.length;
    // Comparaisons en === (pas >=) sur le nombre de mots : un seuil de
    // longueur atteint APRÈS avoir déjà dépassé son propre palier de mots
    // (ex. 3 mots déjà accumulés qui franchissent seulement maintenant le
    // seuil des 2 mots) ne doit jamais clore le groupe à retardement, sinon
    // le seuil "3 mots" ou le plafond "4 mots" n'a jamais l'occasion de
    // s'appliquer (bug réel trouvé par le test de ce fichier).
    const quatreMots = courant.length >= SOUS_TITRE_MAX_MOTS;
    const troisMotsLongs = courant.length === 3 && longueurCourante >= SOUS_TITRE_SEUIL_3_MOTS;
    const deuxMotsLongs = courant.length === 2 && longueurCourante >= SOUS_TITRE_SEUIL_2_MOTS;
    if (quatreMots || troisMotsLongs || deuxMotsLongs) {
      groupes.push(courant);
      courant = [];
      longueurCourante = 0;
    }
  }
  if (courant.length) groupes.push(courant);
  return groupes.map(g => ({
    texte: g.map(m => m.texte).join(' '),
    debut: Math.round(g[0].debut * 100) / 100,
    fin: Math.round(g[g.length - 1].fin * 100) / 100
  }));
}

async function handleTts(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (ELEVENLABS_API_KEY)' } });
  const voixDisponibles = obtenirVoixDisponibles();
  if (!voixDisponibles.length) {
    return res.status(500).json({ error: { message: 'Voix absente côté serveur (ELEVENLABS_VOICE_ID ou ELEVENLABS_VOICES), choisis-en une dans ta bibliothèque de voix ElevenLabs et copie son ID.' } });
  }

  const droits = await resoudreDroits(body?.code_acces);
  const acces = verifierAccesMontage(droits);
  if (!acces.ok) {
    return res.status(403).json({ error: { message: 'Montage vidéo réservé aux abonnés Creator et Pro', code: 'ACCES_REFUSE' } });
  }

  // Un plafond trop bas ici causait un vrai bug silencieux : le montage
  // manuel (js/montage-manuel.js) peut avoir bien plus de 40 images/lignes
  // (retour direct : 53 images, bouton "Démarrer le montage" resté grisé
  // sans aucune explication). L'ancien code TRONQUAIT silencieusement les
  // segments au-delà de MAX_SEGMENTS, renvoyant donc moins de durées que
  // d'images attendues côté client, qui ne validait jamais cette égalité.
  // Refuser clairement AVANT de tronquer, plutôt que de corrompre l'état.
  const MAX_SEGMENTS = 200;
  const segmentsBruts = Array.isArray(body?.segments) ? body.segments : [];
  if (segmentsBruts.length > MAX_SEGMENTS) {
    return res.status(400).json({ error: { message: `Trop de plans pour une seule voix off (${segmentsBruts.length}, max ${MAX_SEGMENTS}).` } });
  }
  const segments = segmentsBruts.map(s => retirerMinuterie(String(s || '').trim()));
  if (!segments.length || segments.every(s => !s)) {
    return res.status(400).json({ error: { message: 'Aucun texte à narrer' } });
  }

  // LOT 2, audit A7/A15 : la voix off (ElevenLabs, facturé au caractère)
  // n'avait jusqu'ici AUCUN quota, seulement la vérification de plan
  // ci-dessus - un appel direct et répété à cette route coûtait donc à
  // volonté. Décompté ici, une fois la requête validée, remboursé si
  // ElevenLabs échoue (même principe que les images du même montage).
  const quotaVoix = await verifierQuota(droits, 'montageVoix', body?.code_acces);
  if (!quotaVoix.ok) {
    return res.status(403).json({ error: { message: 'Limite de générations de voix off du mois atteinte pour ton plan.', code: 'QUOTA_ATTEINT' } });
  }
  const rembourserVoix = async () => { if (quotaVoix.consomme) await rembourserUsage(droits, 'montageVoix', body?.code_acces, 1); };

  const voixDemandee = typeof body?.voiceId === 'string' ? body.voiceId : '';
  const voixChoisie = voixDisponibles.find(v => v.id === voixDemandee) || voixDisponibles[0];
  const voiceId = voixChoisie.id;

  // Vitesse de lecture (retour propriétaire) : voice_settings.speed
  // d'ElevenLabs accepte 0.25-4.0 côté API, mais la qualité se dégrade
  // nettement en dehors de 0.5-1.5 (voix déformée), plage exposée côté
  // client (voir js/montage.js et js/montage-manuel.js). Toujours calée
  // dans cette plage ici aussi, même si le client est censé déjà la
  // respecter : jamais une valeur hors-plage envoyée telle quelle à
  // ElevenLabs à cause d'un appel direct de l'API sans passer par l'UI.
  const vitesseDemandee = Number(body?.speed);
  const speed = Number.isFinite(vitesseDemandee) ? Math.min(1.5, Math.max(0.5, vitesseDemandee)) : 1;

  const debutsCaracteres = [];
  let curseur = 0;
  for (const s of segments) {
    debutsCaracteres.push(curseur);
    curseur += s.length + 1;
  }
  const texteComplet = segments.join(' ');

  try {
    const rep = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '/with-timestamps',
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texteComplet, model_id: 'eleven_multilingual_v2', voice_settings: { speed } })
      }
    );
    // Même garde que pour les images (voir genererAvecForme) : une passerelle
    // en panne répond du HTML, et `await rep.json()` transformait ça en
    // « Erreur serveur : Unexpected token '<'… » affiché au créateur.
    const data = await lireJsonOuNull(rep);
    if (data === null) {
      await rembourserVoix();
      return res.status(502).json({
        error: { message: 'Le service de voix off a répondu quelque chose d\'illisible (statut ' + rep.status + ')' }
      });
    }
    if (!rep.ok) {
      await rembourserVoix();
      const message = data?.detail?.message || data?.message || 'La voix off n\'a pas pu être générée';
      return res.status(502).json({ error: { message } });
    }

    const align = data?.alignment;
    if (!data?.audio_base64 || !align || !Array.isArray(align.character_start_times_seconds)) {
      await rembourserVoix();
      return res.status(502).json({ error: { message: 'Réponse ElevenLabs inattendue (pas d\'horodatage)' } });
    }
    const debutsTemps = align.character_start_times_seconds;
    const finsTemps = align.character_end_times_seconds;
    const nbCaracteres = debutsTemps.length;

    const dureeTotale = finsTemps[finsTemps.length - 1] || 0;
    let durations;
    if (nbCaracteres === texteComplet.length) {
      durations = segments.map((s, i) => {
        const debut = debutsTemps[debutsCaracteres[i]] ?? 0;
        const fin = (i < segments.length - 1)
          ? (debutsTemps[debutsCaracteres[i + 1]] ?? dureeTotale)
          : dureeTotale;
        return Math.max(0.5, Math.round((fin - debut) * 100) / 100);
      });
    } else {
      const totalCaracteres = segments.reduce((s, t) => s + t.length, 0) || 1;
      durations = segments.map(s => Math.max(0.5, Math.round((s.length / totalCaracteres) * dureeTotale * 100) / 100));
    }

    if (durations.length && dureeTotale > 0) {
      durations[durations.length - 1] = Math.round((durations[durations.length - 1] + 0.3) * 100) / 100;
    }

    // Sous-titres : seulement si l'horodatage couvre bien le texte entier
    // (même garde que pour `durations` ci-dessus) - sinon aucun sous-titre
    // plutôt qu'un calage approximatif, un montage sans sous-titres reste
    // utilisable, un montage avec des sous-titres mal calés est pire.
    const captions = nbCaracteres === texteComplet.length
      ? regrouperEnSousTitres(extraireMots(texteComplet, debutsTemps, finsTemps))
      : [];

    return res.status(200).json({
      audioBase64: data.audio_base64,
      mimeType: 'audio/mpeg',
      durations,
      totalDuration: dureeTotale,
      captions
    });
  } catch (e) {
    await rembourserVoix();
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ MUSIQUE DE FOND (Eleven Music, retour propriétaire : le montage "pas
// assez premium" en comparaison d'un montage CapCut fait à la main - le
// manque le plus flagrant identifié, aucune musique nulle part sous la
// narration) ═══
//
// POST https://api.elevenlabs.io/v1/music, même clé API que la voix off
// (ELEVENLABS_API_KEY), réservée aux comptes ElevenLabs payants avec
// l'accès Music activé (voir retour propriétaire : à vérifier/activer
// elle-même dans son compte, rien à configurer de plus ici). Contrairement
// à /text-to-speech/.../with-timestamps (JSON avec audio en base64), cet
// endpoint renvoie l'AUDIO BRUT directement (Content-Type: audio/mpeg),
// pas du JSON - assumé pour offrir la même forme de réponse au client que
// la voix off (audioBase64), pour rester cohérent avec le flux
// upload-vers-Supabase déjà en place (voir js/montage.js).
const MUSIQUE_PROMPT_DEFAUT = 'Calm, subtle instrumental background music for narration, unobtrusive, gentle, no vocals, no lyrics, low energy, cinematic ambient pad';
const MUSIQUE_DUREE_MIN_MS = 3000;
const MUSIQUE_DUREE_MAX_MS = 600000;

async function handleMusic(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (ELEVENLABS_API_KEY)' } });

  const droits = await resoudreDroits(body?.code_acces);
  const acces = verifierAccesMontage(droits);
  if (!acces.ok) {
    return res.status(403).json({ error: { message: 'Montage vidéo réservé aux abonnés Creator et Pro', code: 'ACCES_REFUSE' } });
  }

  const dureeDemandeeMs = Math.round(Number(body?.dureeMs) || 0);
  if (!dureeDemandeeMs) {
    return res.status(400).json({ error: { message: 'Durée manquante (dureeMs), calée sur la durée totale de la voix off' } });
  }
  // Bornes imposées par l'API (3s à 10min) : jamais un dépassement silencieux,
  // on cale sur la borne la plus proche plutôt que d'envoyer une valeur
  // qu'ElevenLabs refuserait.
  const dureeMs = Math.min(MUSIQUE_DUREE_MAX_MS, Math.max(MUSIQUE_DUREE_MIN_MS, dureeDemandeeMs));

  // LOT 2, audit A7/A15 : la musique de fond (ElevenLabs Music, facturé à la
  // durée) n'avait jusqu'ici AUCUN quota, seulement la vérification de plan
  // ci-dessus. Décompté ici, remboursé si ElevenLabs échoue.
  const quotaMusique = await verifierQuota(droits, 'montageMusique', body?.code_acces);
  if (!quotaMusique.ok) {
    return res.status(403).json({ error: { message: 'Limite de générations de musique du mois atteinte pour ton plan.', code: 'QUOTA_ATTEINT' } });
  }
  const rembourserMusique = async () => { if (quotaMusique.consomme) await rembourserUsage(droits, 'montageMusique', body?.code_acces, 1); };

  try {
    const rep = await fetch('https://api.elevenlabs.io/v1/music', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: MUSIQUE_PROMPT_DEFAUT,
        music_length_ms: dureeMs,
        model_id: 'music_v2',
        force_instrumental: true
      })
    });

    if (!rep.ok) {
      // Erreur : ElevenLabs répond en JSON même quand un succès renverrait de
      // l'audio brut (voir en-tête ci-dessus). La réponse d'erreur peut ne pas
      // être du JSON valide, jamais un plantage pour autant : c'est le seul
      // des trois appels qui s'en gardait déjà, il passe sur la fonction
      // commune pour que les trois se comportent pareil.
      const data = await lireJsonOuNull(rep);
      await rembourserMusique();
      const message = data?.detail?.message || data?.message
        || (rep.status === 401 ? 'Accès refusé par ElevenLabs (vérifie que l\'accès à Music est bien activé sur ton compte)' : 'La musique de fond n\'a pas pu être générée');
      return res.status(502).json({ error: { message } });
    }

    const tampon = Buffer.from(await rep.arrayBuffer());
    if (!tampon.length) {
      await rembourserMusique();
      return res.status(502).json({ error: { message: 'Réponse ElevenLabs vide (pas de musique reçue)' } });
    }
    return res.status(200).json({ audioBase64: tampon.toString('base64'), mimeType: 'audio/mpeg' });
  } catch (e) {
    await rembourserMusique();
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ IMAGES (voir l'ancien api/montage-images.js) ═══

const CONCURRENCE_MAX = 1;
const TENTATIVES_MAX = 3;
// GPT Image 2 (via Together) : testé à la suite de FLUX.1-schnell (instable
// côté Together), GPT Image 1.5 et Gemini 3 Pro Image, en modèle principal,
// pour comparer coût et fiabilité réels. Tailles héritées des tests
// précédents (carré/portrait/paysage fixes) : à ajuster si Together les
// refuse pour ce modèle précis, l'erreur remontée par genererUneImage le dira.
// Réglable par variable d'environnement (retour propriétaire : "essayer
// d'autres modèles pour réduire les coûts", GPT Image 2 étant nettement
// plus cher que la moyenne des modèles Together) SANS redéploiement de
// code à chaque essai : change TOGETHER_IMAGE_MODEL sur Vercel, redéploie
// juste la variable, génère de vraies images sur le site pour comparer.
const MODELE = process.env.TOGETHER_IMAGE_MODEL || 'openai/gpt-image-2';

// ══ LA VRAIE PHOTO DU PRODUIT, DONNÉE AU MODÈLE EN RÉFÉRENCE ══
//
// C'est LA fonctionnalité qui manquait à l'objectif « Générer des ventes »,
// et le propriétaire l'a dit sans détour : « ça me fait très mal qu'on n'ait
// pas pu faire ça ». Un créateur qui vend une montre veut une image où on
// PORTE sa montre ; une pommade, une main qui tient SON tube. C'est ce que
// tout le monde fait ailleurs en donnant la photo à ChatGPT ou Gemini.
//
// POURQUOI ÇA MARCHE MAINTENANT, alors que ça avait été abandonné. L'ancienne
// tentative essayait de DÉTOURER la photo et de la COLLER dans un décor
// généré : deux essais ratés côté Carrousel, et la décision « si l'app ne
// peut pas détourer parfaitement, on laisse tomber ». Le détourage n'a jamais
// été la bonne route. Ici, on ne découpe rien : la photo part au modèle
// d'images COMME RÉFÉRENCE, et c'est lui qui redessine toute la scène autour
// du vrai produit. GPT Image 2, déjà notre modèle par défaut, accepte
// jusqu'à 16 images de référence et est explicitement fait pour la cohérence
// produit. Le commentaire qui disait « le générateur ne reçoit qu'un TEXTE »
// décrivait notre code, pas l'état de l'art.
//
// DEUX FORMES DE PARAMÈTRE, essayées dans l'ordre. Selon les modèles,
// Together attend `reference_images` (un tableau, forme multi-images) ou
// `image_url` (une seule image). On tente la première, et on ne passe à la
// suivante QUE si l'API refuse explicitement le paramètre. Le nom peut être
// figé sans redéployer de code (TOGETHER_IMAGE_REF_PARAM), même convention
// que TOGETHER_IMAGE_MODEL au-dessus.
const PARAMS_REFERENCE = (process.env.TOGETHER_IMAGE_REF_PARAM || 'reference_images,image_url')
  .split(',').map(s => s.trim()).filter(Boolean);
// Un modèle dédié peut être choisi pour les seules images à produit (par
// exemple un modèle d'édition), sans toucher aux images ordinaires.
const MODELE_PRODUIT = process.env.TOGETHER_IMAGE_PRODUCT_MODEL || MODELE;
// ~4 Mo de base64, soit environ 3 Mo de photo : au-delà, c'est la requête
// entière qui casse côté Vercel, avec une erreur incompréhensible pour le
// créateur. Le client compresse déjà ses photos (voir compresserImage,
// js/generation.js), ce plafond n'est qu'un garde-fou.
const REFERENCE_MAX_CARACTERES = 4 * 1024 * 1024;

const DIMENSIONS_FORMAT = {
  '9:16': { w: 1024, h: 1536 },
  '16:9': { w: 1536, h: 1024 },
  '1:1':  { w: 1024, h: 1024 },
};

function attendre(ms) { return new Promise(r => setTimeout(r, ms)); }

function versionSure(prompt) {
  const sansFormat = prompt.replace(/\s*9:16\s*$/i, '').trim();
  return sansFormat + '. Safe-for-work, tasteful and dignified, non-explicit, no nudity, no gore, no graphic violence, fully clothed, respectful fine-art composition. 9:16';
}

function estBlocageNSFW(message) {
  return /nsfw|not safe|safety|flagged|content policy|may contain|moderat/i.test(String(message));
}

// ══ LA CONSIGNE QUI FAIT LE TRAVAIL DU DÉTOURAGE, SANS DÉTOURER ══
//
// Retour du propriétaire, et c'est le point qui manquait : « l'utilisateur
// peut charger une photo de son produit qui n'est pas sur fond blanc, ni
// noir, ni transparent. C'est à toi de savoir détecter le produit à vendre
// et de le mettre dans ses conditions réelles d'utilisation, sans détourer. »
//
// Il a raison, et c'est exactement le piège d'une image de référence : sa
// photo est prise sur un sol d'atelier, avec des outils autour. Sans rien
// dire, le modèle peut très bien reproduire l'atelier avec, ou hésiter sur
// ce qui EST le produit au milieu de tout ça.
//
// Le découpage se fait donc dans la TÊTE DU MODÈLE, pas au pixel : on lui dit
// que seul le produit compte, que le fond de la photo n'existe pas, et on lui
// NOMME le produit (« a brown leather bracelet »), ce qui suffit à le
// désigner dans une photo encombrée. C'est ce qu'un humain ferait en
// pointant l'objet du doigt : aucun ciseau, juste une consigne.
//
// POSÉE ICI, ET PAS DANS LE PROMPT ÉCRIT PAR L'IA, volontairement : le
// serveur est le seul endroit qui SAIT quelles images portent une référence.
// Une consigne confiée au rédacteur serait oubliée un jour sur un plan, et
// ce plan-là sortirait avec le sol de l'atelier en fond, sans que rien ne le
// signale.
function consigneProduitReference(nomProduit) {
  const nom = String(nomProduit || '').trim();
  return ' IMPORTANT, REFERENCE IMAGE: the attached reference image shows the exact real product to feature'
    + (nom ? ', which is ' + nom : '')
    + '. Reproduce THAT product exactly as it appears in the reference: same shape, same proportions, same '
    + 'colours, same materials, same markings, same logo and same text on it. Do not redesign it, do not '
    + 'stylise it, do not invent any label. Use ONLY the product itself from the reference image: its '
    + 'background, the surface it sits on, the lighting around it and any other object visible in it are '
    + 'irrelevant and must NOT appear in the generated image. Rebuild the entire scene described above '
    + 'around that product, showing it naturally in real use.';
}

// L'API a-t-elle refusé LE PARAMÈTRE de référence lui-même (nom inconnu de ce
// modèle), plutôt que la demande ? C'est la seule erreur qui justifie de
// réessayer avec l'autre forme : sur toute autre erreur, insister ne ferait
// que rejouer le même échec en le facturant.
function estParametreRefuse(message) {
  const m = String(message);
  return /reference_image|image_url/i.test(m)
    && /unknown|unrecogni|unsupported|not supported|not permitted|invalid|extra|unexpected/i.test(m);
}

async function genererAvecForme(apiKey, prompt, dims, reference, nomParam) {
  let promptCourant = prompt;
  let dejaSecurise = false;
  for (let tentative = 1; tentative <= TENTATIVES_MAX; tentative++) {
    const corps = {
      model: reference ? MODELE_PRODUIT : MODELE,
      prompt: promptCourant, width: dims.w, height: dims.h, response_format: 'base64'
    };
    if (reference) {
      if (nomParam === 'reference_images') corps.reference_images = [reference];
      else corps[nomParam] = reference;
    }
    const rep = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(corps)
    });

    // ── UNE RÉPONSE N'EST PAS TOUJOURS DU JSON, ET ÇA COÛTAIT DEUX FOIS ──
    //
    // `await rep.json()` était appelé sans garde. Quand Together répond autre
    // chose que du JSON, ce qui arrive pour toutes les pannes qui ne viennent
    // pas de l'application (502/503 d'une passerelle, page Cloudflare, corps
    // vide), cette ligne lève une SyntaxError, et deux choses se passaient :
    //
    // 1. Le créateur lisait « Unexpected token '<', "<html> <h"... is not
    //    valid JSON » dans la boîte d'erreur du montage. C'est le message que
    //    l'app AFFICHE, pas un détail de console.
    // 2. Pire : la SyntaxError sortait de la boucle AVANT toute lecture du
    //    statut. Les retentatives ne se déclenchaient donc jamais pour la
    //    panne passagère qu'elles existent précisément pour absorber.
    //
    // Ça vaut aussi pour le CHOIX DU MODÈLE : un modèle jugé « instable »
    // a pu l'être à travers ce filtre, ses erreurs de passerelle apparaissant
    // comme des échecs définitifs et incompréhensibles.
    const brut = await rep.text().catch(() => '');
    const data = analyserJson(brut);

    if (data === null) {
      const apercu = brut.replace(/\s+/g, ' ').trim().slice(0, 120);
      const message = 'Le service d\'images a répondu quelque chose d\'illisible (statut '
        + rep.status + (apercu ? ', « ' + apercu + ' »' : ', réponse vide') + ')';
      // 5xx et 429 : panne passagère côté fournisseur, exactement le cas des
      // retentatives. Le reste ne s'arrangera pas en réessayant.
      if ((rep.status >= 500 || rep.status === 429) && tentative < TENTATIVES_MAX) {
        await attendre(1500 * tentative);
        continue;
      }
      throw new Error(message);
    }

    if (rep.ok) {
      const image = (data.data || [])[0];
      const b64 = image && (image.b64_json || image.base64);
      if (!b64) throw new Error('Aucune image renvoyée par Together AI');
      return { base64: b64, mimeType: 'image/png' };
    }
    const message = data?.error?.message || data?.error || 'Échec de génération (statut ' + rep.status + ')';
    if (reference && estParametreRefuse(message)) {
      const e = new Error(message);
      e.parametreRefuse = true;
      throw e;
    }
    if (estBlocageNSFW(message) && !dejaSecurise && tentative < TENTATIVES_MAX) {
      promptCourant = versionSure(prompt);
      dejaSecurise = true;
      continue;
    }
    const limiteDebit = rep.status === 429 || /rate.?limit/i.test(String(message));
    if (limiteDebit && tentative < TENTATIVES_MAX) { await attendre(1500 * tentative); continue; }
    throw new Error(message);
  }
}

// La consigne s'insère AVANT le format final (" 9:16"), qui doit rester le
// tout dernier élément du prompt : c'est là que les générateurs le lisent, et
// versionSure() plus haut compte aussi dessus pour reconstruire un prompt
// adouci après un blocage de modération.
function promptAvecProduit(prompt, nomProduit) {
  const ratio = (String(prompt).match(/\s(\d{1,2}:\d{1,2})\s*$/) || [])[1];
  const sansRatio = ratio ? String(prompt).replace(/\s\d{1,2}:\d{1,2}\s*$/, '') : String(prompt);
  return sansRatio + consigneProduitReference(nomProduit) + (ratio ? ' ' + ratio : '');
}

async function genererUneImage(apiKey, prompt, dims, reference, nomProduit) {
  const promptFinal = reference ? promptAvecProduit(prompt, nomProduit) : prompt;
  const formes = reference ? PARAMS_REFERENCE : [null];
  let derniere = null;
  for (const forme of formes) {
    try {
      return await genererAvecForme(apiKey, promptFinal, dims, reference, forme);
    } catch (e) {
      derniere = e;
      if (!e.parametreRefuse) throw e;
    }
  }
  // AUCUN REPLI SANS LE PRODUIT, volontairement. Le prompt de ces plans-là
  // demande le vrai produit en main ou porté : le générer sans la photo
  // donnerait un SOSIE, avec un faux logo et une étiquette en charabia.
  // Le propriétaire l'a tranché une fois pour toutes : sur un contenu qui
  // vend, un sosie est pire que rien. On échoue donc franchement, en
  // remontant le message de l'API, plutôt que de livrer un faux produit.
  throw derniere || new Error('Échec de génération avec la photo du produit');
}

async function handleImages(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (TOGETHER_API_KEY)' } });

  // Deux consommateurs d'images, DEUX BUDGETS SÉPARÉS (décision du
  // propriétaire) : le montage vidéo et le carrousel. Le coût unitaire est
  // le même, mais les partager obligerait l'abonné à arbitrer entre deux
  // fonctions qu'il a déjà payées. Le client dit lequel via `usage` ; toute
  // valeur inconnue retombe sur le montage, qui était le seul appelant
  // jusqu'ici, donc aucun appel existant ne change de comportement.
  const pourCarrousel = body?.usage === 'carrousel';
  const modeQuota = pourCarrousel ? 'carrouselImages' : 'montageImages';

  const droits = await resoudreDroits(body?.code_acces);
  const acces = verifierAccesMontage(droits);
  if (!acces.ok) {
    return res.status(403).json({
      error: {
        message: pourCarrousel
          ? 'Génération d\'images du carrousel réservée aux abonnés Creator et Pro'
          : 'Montage vidéo réservé aux abonnés Creator et Pro',
        code: 'ACCES_REFUSE'
      }
    });
  }

  const MAX_PROMPTS = 40;
  const prompts = Array.isArray(body?.prompts) ? body.prompts.slice(0, MAX_PROMPTS).map(p => String(p || '').trim()) : [];
  if (!prompts.length || prompts.every(p => !p)) {
    return res.status(400).json({ error: { message: 'Aucun prompt à générer' } });
  }

  // Quota d'images du mois (retour propriétaire : compté en images, pas en
  // montages, voir LIMITES_MOIS.montageImages / carrouselImages) - décompté
  // en un seul appel atomique pour tout le lot, avant de dépenser un centime
  // chez Together. Seuls les prompts non vides comptent (les vides ne
  // génèrent rien, voir plus bas "Prompt vide").
  const nbAGenerer = prompts.filter(p => p).length;
  const quota = await verifierQuota(droits, modeQuota, body?.code_acces, nbAGenerer);
  if (!quota.ok) {
    return res.status(403).json({
      error: {
        message: pourCarrousel
          ? 'Quota d\'images de carrousel du mois atteint pour ton plan'
          : 'Quota d\'images du mois atteint pour ton plan',
        code: 'QUOTA_ATTEINT'
      }
    });
  }

  const dims = DIMENSIONS_FORMAT[body?.format] || DIMENSIONS_FORMAT['9:16'];

  // La photo du produit, et la liste des plans qui doivent le montrer. Seuls
  // les plans marqués la reçoivent : montrer le produit sur CHAQUE image en
  // ferait une publicité, et coûterait plus cher sans rien apporter.
  // UNE IMAGE, JAMAIS UN PDF : le créateur peut joindre une brochure pour
  // nourrir l'écriture, mais on ne donne au générateur d'images que ce qui
  // en est vraiment une.
  const produit = body?.produit;
  const mediaProduit = String(produit?.mediaType || '');
  let referenceProduit = null;
  if (produit && typeof produit.base64 === 'string' && produit.base64 && /^image\//i.test(mediaProduit)) {
    if (produit.base64.length > REFERENCE_MAX_CARACTERES) {
      return res.status(400).json({ error: { message: 'Photo du produit trop lourde (max ~3 Mo). Reprends-la ou allège-la, elle doit juste montrer le produit.' } });
    }
    referenceProduit = 'data:' + mediaProduit + ';base64,' + produit.base64;
  }
  const avecProduit = Array.isArray(body?.avecProduit) ? body.avecProduit : [];
  // Le NOM du produit, tel que l'app l'a détecté sur la photo (voir
  // analyserProduitCharge, js/niche-auto.js) : c'est lui qui permet au modèle
  // de reconnaître l'objet à garder au milieu d'une photo encombrée. Facultatif,
  // parce qu'une détection peut échouer : la consigne reste alors valable, elle
  // désigne simplement « le produit » sans le nommer.
  const nomProduit = String(produit?.nom || '').trim().slice(0, 120);

  const resultats = new Array(prompts.length).fill(null);
  const erreurs = new Array(prompts.length).fill(null);

  let curseur = 0;
  async function travailleur() {
    while (curseur < prompts.length) {
      const i = curseur++;
      if (!prompts[i]) { erreurs[i] = 'Prompt vide'; continue; }
      const reference = (referenceProduit && avecProduit[i]) ? referenceProduit : null;
      try { resultats[i] = await genererUneImage(apiKey, prompts[i], dims, reference, nomProduit); }
      catch (e) {
        erreurs[i] = reference
          ? 'Ton produit n\'a pas pu être intégré à cette image : ' + (e.message || 'erreur inconnue')
          : (e.message || 'Erreur inconnue');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCE_MAX, prompts.length) }, travailleur));

  // ── REMBOURSEMENT DES IMAGES QUI N'ONT PAS ABOUTI ──
  // Le quota est réservé pour TOUT le lot avant de générer (voir plus haut) :
  // c'est la seule façon de le faire de façon atomique, et il faut bien
  // décider avant de dépenser chez Together. Mais sans ce remboursement, un
  // lot de 8 fonds dont 3 échouent décomptait 8 images à un créateur qui n'en
  // a reçu que 5. Il payait de son quota mensuel des images qu'il n'a jamais
  // eues, et il n'avait aucun moyen de le savoir ni de les récupérer.
  //
  // ON NE REMBOURSE QUE CE QUI A ÉTÉ DÉBITÉ : les prompts vides n'ont jamais
  // été réservés (nbAGenerer les exclut déjà), ils ne sont donc pas comptés
  // ici non plus, sinon chaque prompt vide fabriquerait du quota.
  //
  // Et seulement si le compteur a réellement bougé (`quota.consomme`) : un
  // admin, un compte illimité ou une panne SQL passent le quota sans rien
  // débiter, leur "rembourser" reviendrait à créer du quota de nulle part.
  const nbEchecsFactures = prompts.reduce(
    (n, p, i) => n + ((p && !resultats[i]) ? 1 : 0), 0
  );
  if (nbEchecsFactures > 0 && quota.consomme) {
    await rembourserUsage(droits, modeQuota, body?.code_acces, nbEchecsFactures);
  }

  return res.status(200).json({ images: resultats, erreurs });
}

// ═══ ANIMATION IA (Agnes AI) — PHASE 1, VALIDATION UNIQUEMENT ═══
//
// Retour propriétaire (25/09) : une API tierce "gratuite illimitée" pour
// animer une image en mini-clip vidéo, apportée sans documentation
// vérifiable (platform.agnes-ai.com et apihub.agnes-ai.com bloqués par le
// proxy réseau côté outillage, jamais consultés). Avant d'y bâtir quoi que
// ce soit dans le pipeline de rendu final (render-service), cette action ne
// sert qu'à JUGER SUR PIÈCE : qualité réelle, délai réel, fiabilité réelle.
// Volontairement réservée au fondateur (droits.isAdmin), jamais montrée aux
// abonnés Creator/Pro tant que rien de tout ça n'est confirmé.
//
// Ne rejoint JAMAIS le pipeline de montage final à ce stade : le résultat
// est republié dans le Storage Supabase (bucket `montages`, dossier
// test-animations/) uniquement pour être prévisualisé côté client via une
// URL signée, exactement le même principe de confiance que le reste du
// montage (jamais l'URL du fournisseur tiers renvoyée telle quelle au
// navigateur, voir urlStorageMontageApprouvee plus haut).
const AGNES_URL_CREATION = 'https://apihub.agnes-ai.com/v1/videos';
const AGNES_URL_POLLING = 'https://apihub.agnes-ai.com/agnesapi';
const AGNES_MODELE = 'agnes-video-v2.0';
// 121 images à 24 i/s ≈ 5 s, le plus court des trois formats documentés par
// Agnes AI (121/153/241) : cette phase ne sert qu'à juger la qualité et le
// délai réel, pas à produire un plan complet, donc le format le moins
// coûteux et le plus rapide à obtenir.
const AGNES_NUM_FRAMES = 121;
const AGNES_FRAME_RATE = 24;
const AGNES_STATUTS_OK = new Set(['completed', 'succeeded', 'done']);
const AGNES_STATUTS_ECHEC = new Set(['failed', 'error', 'cancelled']);
const AGNES_PROMPT_DEFAUT = 'Animate this exact image as the starting frame. '
  + 'Preserve subject identity, face, pose, clothing, composition. '
  + 'Natural subtle motion, cinematic. 9:16, no text, no watermark.';

// Slash final retiré (même incident déjà corrigé ailleurs, voir api/data.js) :
// ce fichier n'avait encore jamais eu besoin d'ÉCRIRE dans le Storage
// (origineStorageApprouvee plus haut ne fait que LIRE la variable pour
// vérifier une origine).
function supabaseStockage() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

// Identique à l'extraction déjà utilisée pour signer les autres objets du
// bucket `montages` (voir api/data.js, render-service/server.js) : le champ
// exact varie selon la version de l'API Storage (signedURL, signedUrl...),
// la seule chose stable est la présence d'un paramètre token= dans l'URL.
function extraireJetonSigne(reponse) {
  const brut = JSON.stringify(reponse || {});
  const m = /token=([^"\\&]+)/.exec(brut);
  return m ? m[1] : '';
}

async function handleAnimateCreate(req, res, body) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (AGNES_API_KEY)' } });

  const droits = await resoudreDroits(body?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Animation IA en test, réservée au fondateur pour l\'instant.' } });
  }

  const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
  const mimeType = (typeof body?.mimeType === 'string' && /^image\//i.test(body.mimeType)) ? body.mimeType : 'image/png';
  if (!imageBase64) return res.status(400).json({ error: { message: 'Image manquante' } });

  const quota = await verifierQuota(droits, 'montageAnimations', body?.code_acces);
  if (!quota.ok) {
    return res.status(403).json({ error: { message: 'Limite d\'animations du mois atteinte.', code: 'QUOTA_ATTEINT' } });
  }

  try {
    const rep = await fetch(AGNES_URL_CREATION, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AGNES_MODELE,
        prompt: AGNES_PROMPT_DEFAUT,
        image: 'data:' + mimeType + ';base64,' + imageBase64,
        num_frames: AGNES_NUM_FRAMES,
        frame_rate: AGNES_FRAME_RATE
      })
    });
    const data = await lireJsonOuNull(rep);
    if (data === null) {
      if (quota.consomme) await rembourserUsage(droits, 'montageAnimations', body?.code_acces, 1);
      return res.status(502).json({ error: { message: 'Agnes AI a répondu quelque chose d\'illisible (statut ' + rep.status + ')' } });
    }
    const taskId = data.video_id || data.id || data.task_id;
    if (!rep.ok || !taskId) {
      if (quota.consomme) await rembourserUsage(droits, 'montageAnimations', body?.code_acces, 1);
      const message = data?.error?.message || data?.error || data?.message || 'Échec de la création (statut ' + rep.status + ')';
      return res.status(502).json({ error: { message } });
    }
    return res.status(200).json({ taskId: String(taskId) });
  } catch (e) {
    if (quota.consomme) await rembourserUsage(droits, 'montageAnimations', body?.code_acces, 1);
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

async function handleAnimatePoll(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: { message: 'Méthode non autorisée' } });

  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Clé API absente côté serveur (AGNES_API_KEY)' } });

  const droits = await resoudreDroits(req.query?.code_acces);
  if (!droits.isAdmin) {
    return res.status(403).json({ error: { message: 'Animation IA en test, réservée au fondateur pour l\'instant.' } });
  }

  const taskId = typeof req.query?.taskId === 'string' ? req.query.taskId : '';
  if (!taskId) return res.status(400).json({ error: { message: 'taskId manquant' } });

  try {
    const rep = await fetch(
      AGNES_URL_POLLING + '?video_id=' + encodeURIComponent(taskId) + '&model_name=' + encodeURIComponent(AGNES_MODELE),
      { headers: { Authorization: 'Bearer ' + apiKey } }
    );
    const data = await lireJsonOuNull(rep);
    if (data === null) {
      return res.status(502).json({ error: { message: 'Agnes AI a répondu quelque chose d\'illisible (statut ' + rep.status + ')' } });
    }
    const statut = String(data.status || '').toLowerCase();
    if (AGNES_STATUTS_ECHEC.has(statut)) {
      return res.status(200).json({ status: 'failed', message: String(data.error || data.message || 'Animation échouée').slice(0, 200) });
    }
    if (!AGNES_STATUTS_OK.has(statut)) {
      return res.status(200).json({ status: 'pending', progress: Number(data.progress) || 0 });
    }

    const urlSource = data?.metadata?.url || data?.url || data?.output?.url;
    if (typeof urlSource !== 'string' || !urlSource) {
      return res.status(502).json({ error: { message: 'Animation terminée mais aucune URL renvoyée par Agnes AI' } });
    }

    // Jamais l'URL du fournisseur tiers renvoyée telle quelle au navigateur
    // (voir en-tête de section) : rapatriée ici, republiée dans NOTRE
    // Storage, seule une URL signée Supabase repart vers le client.
    const stockage = supabaseStockage();
    if (!stockage) {
      return res.status(500).json({ error: { message: 'Stockage Supabase non configuré côté serveur' } });
    }
    const repVideo = await fetch(urlSource);
    if (!repVideo.ok) {
      return res.status(502).json({ error: { message: 'Vidéo Agnes AI introuvable au téléchargement (statut ' + repVideo.status + ')' } });
    }
    const tampon = Buffer.from(await repVideo.arrayBuffer());
    const chemin = 'test-animations/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4';
    const repUpload = await fetch(stockage.url + '/storage/v1/object/montages/' + chemin, {
      method: 'POST',
      headers: { apikey: stockage.key, Authorization: 'Bearer ' + stockage.key, 'Content-Type': 'video/mp4' },
      body: tampon
    });
    if (!repUpload.ok) {
      const detail = await repUpload.text().catch(() => '');
      return res.status(502).json({ error: { message: 'Échec de la republication dans le Storage (statut ' + repUpload.status + (detail ? ' : ' + detail.slice(0, 150) : '') + ')' } });
    }
    const repSign = await fetch(stockage.url + '/storage/v1/object/sign/montages/' + chemin, {
      method: 'POST',
      headers: { apikey: stockage.key, Authorization: 'Bearer ' + stockage.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    const dataSign = await lireJsonOuNull(repSign);
    const token = extraireJetonSigne(dataSign);
    if (!repSign.ok || !token) {
      return res.status(502).json({ error: { message: 'Vidéo republiée mais impossible d\'obtenir un lien de lecture' } });
    }
    return res.status(200).json({ status: 'completed', url: stockage.url + '/storage/v1/object/sign/montages/' + chemin + '?token=' + token });
  } catch (e) {
    return res.status(500).json({ error: { message: 'Erreur serveur : ' + (e.message || 'inconnue') } });
  }
}

// ═══ POINT D'ENTRÉE COMMUN ═══

export default async function handler(req, res) {
  const action = req.query?.action;

  if (action === 'download') return handleDownload(req, res);
  if (action === 'voices') return handleVoices(req, res);
  if (action === 'animate-poll') return handleAnimatePoll(req, res);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (action === 'tts') return handleTts(req, res, body);
  if (action === 'music') return handleMusic(req, res, body);
  if (action === 'images') return handleImages(req, res, body);
  if (action === 'animate-create') return handleAnimateCreate(req, res, body);

  return res.status(400).json({ error: { message: 'action inconnue' } });
}

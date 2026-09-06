// ═══════════════════════════════════════════════════════════
//  MOTEUR DE DÉCOUPAGE PAR IMAGE MENTALE
//  Règle : UN STORYBOARD = UNE SEULE IMAGE MENTALE.
//  Question centrale : « un seul visuel peut-il représenter ce passage ? »
//  Priorités : 1) image mentale 2) scène 3) idée 4) révélation
//              5) émotion 6) durée (EN DERNIER, simple ajustement)
// ═══════════════════════════════════════════════════════════

const MOTS_PAR_SEC = 2.8;   // rythme de narration posée
const DUREE_MIN = 2;        // un plan plus court n'est pas filmable (sauf effet)
const DUREE_MAX = 7;        // au-delà : plusieurs images cachées

// Rythme de PAROLE de référence pour tout ce qui PROMET une durée au
// créateur (cibles de mots et minutage affiché des modes Script et Récit).
// Volontairement distinct de MOTS_PAR_SEC ci-dessus : ce dernier est un
// SEUIL DE DÉCOUPAGE en plans, calibré empiriquement avec DUREE_MAX pour
// décider quand une phrase mérite son propre visuel, jamais une promesse de
// durée faite à l'utilisateur.
// 2,5 mots/seconde = ~150 mots/minute : un débit TikTok francophone naturel
// (parole brute ~168 mots/min) moins la respiration réelle d'une vidéo
// (silences, temps de lecture du texte à l'écran, battements). C'est la
// valeur déjà retenue par le mode Série (voir WORD_TARGETS_SERIE, js/serie.js),
// désormais partagée par les trois modes : avant ça, Script et Récit
// promettaient des durées à ~2,4 mots/s pendant que leur minutage s'affichait
// à 2,8, et un script "2 minutes" parfaitement calibré affichait une timeline
// qui s'arrêtait à 1min44.
const MOTS_PAR_SEC_PARLE = 2.5;

// Durée parlée réelle d'un texte, en secondes (sert aux promesses de durée,
// voir MOTS_PAR_SEC_PARLE). Même comptage de mots que partout ailleurs.
function dureeParleeDe(texte) {
  return (texte || '').split(/\s+/).filter(Boolean).length / MOTS_PAR_SEC_PARLE;
}

// Découpe en phrases, ponctuation conservée
function splitIntoSentences(texte) {
  if (!texte || typeof texte !== 'string') return [];
  return (texte.replace(/\s+/g, ' ')
    .match(/[^.!?…]+[.!?…]+(?:["'»)\]]*)?|\S[^.!?…]*$/g) || [])
    .map(s => s.trim()).filter(Boolean);
}

function dureeDe(texte) {
  return (texte || '').split(/\s+/).filter(Boolean).length / MOTS_PAR_SEC;
}

// Rôle narratif d'une phrase
function classifySentence(phrase) {
  const t = (phrase || '').trim().toLowerCase();
  if (!t) return 'neutre';
  if (t.includes('?')) return 'question';
  if (/^(et )?(mais |or |sauf que|en réalité|en verite|en vérité|voici|voila|voilà|mais voila|mais voilà|le twist|sauf |pourtant|c'est alors|c'est là|c'est la|soudain|jusqu'au jour|ce qu'il ignorait|personne ne savait)/.test(t)) return 'revelation';
  // Ruptures dramatiques : "Et là, silence.", "Et soudain…", "Et puis plus rien."
  if (/^(et là|et la|et soudain|et puis|et d'un coup|et brusquement|puis plus rien|silence)/.test(t)) return 'revelation';
  if (/^(donc |alors |resultat|résultat|c'est pourquoi|du coup|ainsi |par consequent|par conséquent|desormais|désormais|le problème|le probleme)/.test(t)) return 'consequence';
  if (/^(moi,? |toi,? |vous |tu |je t'ai|je t ai|retiens|souviens|imagine|imaginez)/.test(t)) return 'interpellation';
  if (/^(il etait|il était|au debut|au début|a l'epoque|à l'époque|autrefois|d'abord|pour commencer)/.test(t)) return 'preparation';
  return 'neutre';
}

// Empreinte visuelle : ce qui définit l'IMAGE d'une phrase
function empreinteVisuelle(phrase) {
  const t = (phrase || '').toLowerCase();
  const actions = t.match(/\b\w*(brûle|brule|meurt|tombe|sonne|explose|s'effondre|surgit|frappe|court|fuit|fuient|arrive|revient|part|bombard|détruit|detruit|finance|organise|marche|dresse|allie|serre|descend|monte|ouvre|ferme|crie|pleure|rit|regarde|tourne)\w*/g) || [];
  const sujets = t.match(/\b(village|armée|armee|téléphone|telephone|pays|ville|palais|rue|homme|femme|foule|soldat|président|president|renseignement|dissident|coup d'état|coup d'etat|main|porte|voiture|salle|bureau|maison|enfant|mère|mere|père|pere|nuit|jour|ciel|mur)\w*/g) || [];
  return { actions: [...new Set(actions)], sujets: [...new Set(sujets)] };
}

// Détecte une série rhétorique intentionnelle : deux phrases consécutives
// qui ouvrent sur le même patron (anaphore). Dans ce cas, chaque terme
// mérite son propre plan, même s'il est court ou sans image propre.
function detecteSerieRhethorique(precedente, courante) {
  if (!precedente || !courante) return false;
  const prev = (precedente || '').trim().toLowerCase();
  const cur  = (courante  || '').trim().toLowerCase();

  // Mêmes 2 premiers mots → patron anaphorique explicite
  const w = s => s.split(/\s+/).slice(0, 2).join(' ');
  if (w(prev) === w(cur) && w(prev).length > 4) return true;

  // Séries connues
  if (/^comment /.test(prev) && /^comment /.test(cur)) return true;
  if (/^ces /.test(prev)     && /^ces /.test(cur))     return true;
  if (/^(que |ou que )/.test(prev) && /^(que |ou que )/.test(cur)) return true;
  if (/^(à chaque|a chaque|présent à|present a)/.test(prev) &&
      /^(à chaque|a chaque|présent à|present a)/.test(cur))  return true;
  if (/^(les |chaque )/.test(prev) && /^(les |chaque )/.test(cur)) return true;

  return false;
}

// CONTINUITÉ : cette phrase prolonge-t-elle la même image ? (ne JAMAIS couper)
function prolongeLaMemeImage(precedente, courante) {
  // Exception prioritaire : série rhétorique = chaque terme = plan distinct
  if (detecteSerieRhethorique(precedente, courante)) return false;

  const t = (courante || '').trim().toLowerCase();
  // Subordonnée ou énumération parallèle
  if (/^(qui |que |dont |où |ou |et qui |et que |lequel|laquelle)/.test(t) && !t.includes('?')) return true;
  // Précision immédiate : fragment court SANS image propre (ni action ni sujet visuel).
  // Ne s'applique JAMAIS à une révélation, question ou interpellation (elles ouvrent un plan).
  const cls = classifySentence(courante);
  if (dureeDe(courante) < 1.2 && !/[?!]/.test(courante)
      && cls !== 'revelation' && cls !== 'question' && cls !== 'interpellation') {
    const e = empreinteVisuelle(courante);
    if (e.actions.length === 0 && e.sujets.length === 0) return true;
  }
  // Incise de dialogue
  if (/^(puis il|puis elle|dit-il|dit-elle|répondit|repondit|ajouta)/.test(t)) return true;
  return false;
}

// Score de rupture : 0-100. Au-delà du seuil = nouvelle image = nouveau plan.
function computeNarrativeBreakScore(precedente, courante) {
  if (!precedente) return 100;
  // Règles de continuité : priment sur tout le reste
  if (prolongeLaMemeImage(precedente, courante)) return 0;

  let score = 0;
  const clsPrev = classifySentence(precedente);
  const clsCur = classifySentence(courante);
  const t = (courante || '').trim().toLowerCase();

  // Priorité 4, révélation jamais collée à sa préparation
  if (clsCur === 'revelation') score += 55;
  if (clsPrev === 'revelation' && clsCur !== 'revelation') score += 50; // la chute a son propre plan
  if ((clsPrev === 'preparation' && clsCur === 'revelation') ||
      (clsPrev === 'revelation' && clsCur === 'preparation')) score += 40;

  // Priorité 5, question / interpellation = leur propre image
  if (clsCur === 'question') score += 60;
  if (clsPrev === 'question' && clsCur !== 'question') score += 50; // ce qui suit une question a son propre plan
  if (clsCur === 'interpellation' && clsPrev !== 'interpellation') score += 35;
  // Adresse directe qui projette le spectateur ailleurs = changement de scène radical
  if (/^(imagine|imaginez|regarde|regardez|écoute|ecoute|écoutez|vous êtes|tu es|vous voilà)/.test(t)) score += 30;

  // Priorité 1, IMAGE MENTALE : nouvelle action ou nouveau sujet visuel
  const ePrev = empreinteVisuelle(precedente);
  const eCur = empreinteVisuelle(courante);
  const nouvelleAction = eCur.actions.some(a => !ePrev.actions.includes(a));
  const nouveauSujet = eCur.sujets.some(s => !ePrev.sujets.includes(s));
  if (eCur.actions.length && nouvelleAction) score += 45;
  if (eCur.sujets.length && nouveauSujet && ePrev.sujets.length) score += 25;

  // Priorité 2, changement de scène (lieu, époque)
  // Lieu nommé en tête de phrase : "À Nefis", "Au Mali", "En Libye" (nom propre = nouvelle scène)
  let changementScene = false;
  if (/^(À|A|Au|Aux|En|Dans|Vers|Depuis|à|au|aux|en|dans|vers|depuis)\s+[A-ZÀ-Ý][a-zà-ÿ]+/.test((courante || '').trim())) {
    score += 45; changementScene = true;
  }
  if (/\b(à |a |dans |vers |depuis )(dakar|paris|londres|new york|afrique|europe|palais|bureau|maison|rue|ville|pays)\b/.test(t)) score += 20;
  if (/\b(deux ans|trois ans|plus tard|à l'époque|aujourd'hui|hier|demain|en \d{4}|le lendemain|quelques années|désormais|maintenant)\b/.test(t)) score += 25;

  // Situation explicite : "Nous sommes à…", "On est à…", "Direction…"
  if (/^(nous sommes|on est|direction |retour |cap sur)/.test(t)) { score += 45; changementScene = true; }

  // Série rhétorique (anaphore intentionnelle) : martelage = rupture = nouveau plan
  if (detecteSerieRhethorique(precedente, courante)) score += 45;

  // Priorité 3, connecteurs narratifs (indices forts, non mécaniques)
  if (/^(mais|pourtant|cependant|sauf que|c'est alors que|jusqu'au jour où|ce qu'il ignorait|personne ne savait|le problème|désormais|or |alors)/.test(t)) score += 22;
  // Succession temporelle ("Puis…", "Ensuite…") = nouveau moment = nouvelle image
  if (/^(puis |ensuite |après |plus tard|quelques (heures|jours|minutes|semaines|mois|années))/.test(t)) score += 45;

  // Continuité douce : rien de neuf visuellement → on prolonge
  if (!nouvelleAction && !nouveauSujet && eCur.actions.length === 0 && !changementScene
      && clsCur !== 'question' && clsCur !== 'revelation' && clsCur !== 'interpellation'
      && clsPrev !== 'question' && clsPrev !== 'revelation') {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

// Construit les plans : narration d'abord, durée en dernier
function buildNarrativeSegments(texte) {
  const phrases = splitIntoSentences(texte);
  if (!phrases.length) return [];
  const SEUIL = 45;

  const plans = [];
  let courant = [];

  for (let i = 0; i < phrases.length; i++) {
    const prev = i > 0 ? phrases[i - 1] : null;
    const cur = phrases[i];
    const score = computeNarrativeBreakScore(prev, cur);

    if (courant.length === 0) { courant.push(cur); continue; }

    const dureeSiAjout = dureeDe(courant.join(' ') + ' ' + cur);

    // Fragment d'ouverture (lieu/date : "Paris, 1925.") : seulement au TOUT DÉBUT,
    // et seulement s'il n'a ni verbe conjugué ni ponctuation forte.
    const txtCourant = courant.join(' ');
    // Cartouche d'ouverture : "Paris, 1925.", un lieu suivi d'une date, sans verbe.
    // Ce n'est pas une image à lui seul : il rejoint la phrase suivante.
    const estCartouche = /^[A-ZÀ-Ý][\wà-ÿ'-]*\s*,\s*(\d{4}|\d{1,2}\s+\w+|\w+\s+\d{4})\s*\.?$/.test(txtCourant.trim());
    const courantEstFragment = plans.length === 0 && courant.length === 1 && estCartouche;

    if (score >= SEUIL && !courantEstFragment) {
      plans.push(courant.join(' '));
      courant = [cur];
    } else if (dureeSiAjout > DUREE_MAX && !prolongeLaMemeImage(prev, cur)) {
      // Priorité 6 (durée) : garde-fou, jamais critère de décision
      plans.push(courant.join(' '));
      courant = [cur];
    } else {
      courant.push(cur);
    }
  }
  if (courant.length) plans.push(courant.join(' '));

  // Dernier passage : un plan qui dépasse nettement 7s cache souvent plusieurs images
  const final = [];
  for (const plan of plans) {
    const phr = splitIntoSentences(plan);
    if (dureeDe(plan) > DUREE_MAX + 1.5 && phr.length > 2) {
      let buf = [];
      for (let k = 0; k < phr.length; k++) {
        buf.push(phr[k]);
        if (dureeDe(buf.join(' ')) >= 4.5 || k === phr.length - 1) {
          final.push(buf.join(' ')); buf = [];
        }
      }
      if (buf.length) final.push(buf.join(' '));
    } else {
      final.push(plan);
    }
  }
  return final;
}

function estimateDuration(texte) {
  const sec = dureeDe(texte);
  const bas = Math.max(DUREE_MIN, Math.round(sec));
  const haut = Math.max(bas + 1, Math.round(sec) + 1);
  return { seconds: sec, label: bas + '-' + haut + ' sec' };
}

// Fonction centrale partagée par tous les modes de storyboard : découpe un
// texte en plans, 100% déterministe, sans appel IA.
function segmentNarrativeStoryboard(texte) {
  return buildNarrativeSegments(texte).map(t => ({
    text: t.trim(),
    duree: estimateDuration(t).label
  }));
}

// ═══ GÉNÉRATION DES VISUELS PAR LOTS ═══
// Le découpage en plans est désormais TOUJOURS fixé avant d'appeler l'IA,
// par le moteur narratif ci-dessus (récit, script généré, script collé), ou
// par le découpage numéroté de l'utilisateur (storyboard-seul). L'IA n'a
// donc plus qu'UN travail : écrire un prompt visuel par plan déjà donné,
// jamais segmenter elle-même. C'est ce qui a remplacé le plafond fixe à 40
// plans : au lieu de brider le nombre de plans d'un contenu long, chaque
// appel IA ne porte plus que sur un LOT de taille fixe (TAILLE_LOT_VISUELS),
// donc reste rapide et fiable quelle que soit la longueur totale, et le
// storyboard s'affiche progressivement, lot après lot, au lieu d'attendre
// une seule réponse géante.
const TAILLE_LOT_VISUELS = 15;

const STRUCTURE_PROMPT_VISUEL = `STRUCTURE OBLIGATOIRE DE CHAQUE PROMPT VISUEL (intègre ces 4 dimensions de façon FLUIDE et naturelle, en une description continue, SANS jamais écrire les étiquettes) :
1. LE DÉCOR : le lieu précis, l'époque, l'ambiance globale de la scène
2. LA MATIÈRE : les détails de structure, les matériaux, les textures
3. LES PERSONNAGES : leur titre/fonction, âge, apparence physique, et SURTOUT leurs vêtements précis ainsi que leurs gestes et postures. Si le segment mentionne un nom ou fait référence à un personnage précis (historique, public, fictif), nomme-le explicitement dans le prompt.
   PERSONNE RÉELLE CONNUE (chef d'État, personnalité publique, figure historique) : en plus de le nommer, décris ses 2 ou 3 SIGNES PHYSIQUES LES PLUS RECONNAISSABLES pour que le portrait peint l'évoque vraiment, forme du visage, coupe/barbe/calvitie caractéristique, lunettes, tenue emblématique, âge à l'époque évoquée. Le but est un portrait peint qui rappelle nettement la personne (une évocation picturale, pas une fausse photo). Reste factuel et neutre, sans caricature ni élément dégradant.
   ORIGINE ETHNIQUE, RÈGLE LA PLUS IMPORTANTE DE TOUT LE PROMPT (les générateurs d'images ont un biais très fort : sans description physique explicite, ils dessinent TOUJOURS des personnes blanches/européennes, même si le pays ou le nom indique clairement le contraire, un script de géopolitique africaine doit montrer des personnages africains) :
   • Déduis l'origine du contexte (pays, région, nom, sujet). Un simple mot de nationalité ("Congolese", "Ivorian") NE SUFFIT PAS : le modèle l'ignore.
   • Décris TOUJOURS l'apparence physique de façon EXPLICITE et CONCRÈTE, teinte de peau, traits du visage, texture des cheveux, placée AU TOUT DÉBUT de la description du personnage, avant les vêtements. Exemples : pour un personnage africain "a Black African man with deep dark brown skin, broad nose, full lips and short tightly-coiled black hair"; pour une femme est-asiatique "an East Asian woman with light warm skin, monolid eyes and straight black hair". Répète l'ascendance ("African", "Black", "of Central African descent"…) au moins une fois de plus dans le prompt pour l'ancrer.
   • Ne te contente JAMAIS d'un mot de nationalité seul : sans les descripteurs physiques ci-dessus, l'image sera fausse. C'est la règle à ne jamais sacrifier, même si le reste du prompt est déjà long.
4. LA VIE DE LA SCÈNE : les éléments secondaires (inscriptions, objets, foule…), la gestion de la lumière et des ombres

Le prompt décrit une IMAGE FIXE unique, un instant figé, pas une séquence. Pas de mouvement de caméra, pas de transition, pas de durée.

STYLE / MÉDIUM, RÈGLE ABSOLUE : le style graphique (peinture, cinéma, aquarelle, etc.) est ajouté AUTOMATIQUEMENT à la fin du prompt selon le choix du créateur. Ne spécifie donc TOI-MÊME aucun médium ni style de rendu (n'écris jamais "oil painting", "photo", "cartoon", "3D render"…). Concentre-toi UNIQUEMENT sur la SCÈNE : composition, décor, matières, couleurs, personnages, et surtout les jeux de LUMIÈRE et d'OMBRE. C'est une IMAGE FIXE : bannis tout vocabulaire de mouvement ou de tournage (mouvement de caméra, réglages d'objectif, grain de pellicule, bruit, son). Chaque prompt doit être riche, précis, visuel et spectaculaire, pour empêcher le scroll.

RÈGLE SUR LES SCÈNES MULTIPLES (IMPORTANT) : Si plusieurs éléments ou lieux doivent coexister, NE FAIS PAS de split, de double cadre, de juxtaposition ni aucune séparation visuelle. Garde LA SCÈNE PRINCIPALE et intègre les éléments secondaires de façon organique dans la même composition (arrière-plan, reflet, détail dans le décor…). Une seule image cohérente, pas de collage.

LANGUE, RÈGLE ABSOLUE : écris CHAQUE prompt visuel intégralement en ANGLAIS, même si tout le reste de cette conversation est en français. Les générateurs d'images (Midjourney, Firefly, Imagen, DALL·E…) sont entraînés très majoritairement sur des prompts anglais et suivent bien plus précisément des instructions en anglais, un prompt en français produit des résultats nettement moins fidèles. Aucun mot de français dans le prompt final.

FOOTER TECHNIQUE OBLIGATOIRE : termine CHAQUE prompt visuel par " 9:16" (le format vertical).`;

// Prompt de la miniature (couverture) : appel séparé, indépendant du nombre
// de plans, toujours rapide, même pour un contenu très long, car sa sortie
// reste courte quelle que soit la taille de l'entrée.
async function genererMiniatureVisuelle(texteComplet, plat) {
  const prompt = `Tu es un directeur artistique expert en création d'images fixes pour ${plat}. Voici le texte complet d'un contenu :
"""
${tronquerSansCouperEmoji(texteComplet || '', 4000)}
"""
Crée UN SEUL prompt visuel pour la MINIATURE (image de couverture) de ce contenu. Elle doit être CAPTIVANTE et ANTI-SCROLL : une image forte qui donne immédiatement envie de cliquer, sujet central percutant, émotion visible, couleurs contrastées, composition qui accroche l'œil instantanément. Elle résume la promesse du contenu.

${STRUCTURE_PROMPT_VISUEL}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après : {"miniature":"le prompt de miniature se terminant par 9:16"}`;
  try {
    const raw = await callAI(MODEL_RAPIDE, 1200, prompt, undefined, undefined, undefined, undefined, undefined, undefined, 'storyboard');
    const parsed = parseAIResponse(raw);
    const m = (parsed && parsed.miniature) ? parsed.miniature : '';
    return m ? assainirPromptVisuel(m, 'Miniature') : '';
  } catch (e) {
    return ''; // jamais bloquant : le storyboard reste utilisable sans miniature
  }
}

// Génère le prompt visuel de chaque plan {text}, lot par lot. onLot(lot,
// indexDepart) est appelé après CHAQUE lot avec les plans de ce lot (déjà
// enrichis de leur .visuel), pour un affichage progressif.
// Produit réel chargé par le créateur (objectif Ventes) : sa vraie photo est
// disponible, on ne doit donc JAMAIS en faire générer une imitation.
//
// Demande du propriétaire : « que le produit soit représenté exactement,
// parce que c'est un produit à vendre ». La limite est technique et nette :
// le générateur d'images ne reçoit qu'un TEXTE (voir api/montage-media.js,
// aucune image de référence). Même avec la description la plus rigoureuse,
// il produira un produit RESSEMBLANT, jamais le sien : logo faux, texte de
// l'étiquette en charabia, proportions différentes. Sur une vidéo de vente,
// un sosie est pire que rien, le client qui reçoit le vrai produit voit la
// différence.
//
// D'où la règle : les images générées ne montrent JAMAIS le produit. Elles
// filment la scène, le problème, l'émotion, le décor.
//
// L'INSERTION DE LA VRAIE PHOTO A ÉTÉ RETIRÉE, décision du propriétaire après
// deux essais ratés côté Carrousel : « si l'app ne peut pas parfaitement
// détourer le produit et le mettre dans des décors, on laisse tomber cette
// partie ». Le marquage des plans ("produit": true) n'a donc plus d'objet et
// a disparu du prompt. Seule l'interdiction de dessiner une imitation reste,
// et elle vaut par elle-même.
function regleProduitReelVisuels(aUnProduit) {
  if (!aUnProduit) return '';
  return `
PRODUIT RÉEL, RÈGLE ABSOLUE : le créateur vend un produit précis. Aucun de tes prompts ne doit le représenter, ni un emballage, ni un tube, ni un flacon, ni une boîte, ni une étiquette, ni un logo. Une imitation générée serait forcément différente du vrai produit, et ruinerait la vidéo de vente : sur un contenu qui vend, un sosie est pire que rien.
Décris à la place ce qui ENTOURE le produit : la personne, son geste, son émotion, le décor, la lumière, le problème vécu, le résultat ressenti. Un plan peut montrer une main qui se tend, un regard dans un miroir, une salle de bain au petit matin, jamais l'objet lui-même.`;
}

async function genererVisuelsParLots(plans, plat, onLot, aUnProduit) {
  for (let i = 0; i < plans.length; i += TAILLE_LOT_VISUELS) {
    const lot = plans.slice(i, i + TAILLE_LOT_VISUELS);
    const listeTextes = lot.map((p, k) => `${k + 1}. "${p.text}"`).join('\n');
    const prompt = `Tu es un directeur artistique expert en création d'images fixes pour ${plat}.

Voici une liste de textes narrés, déjà découpés en plans (NE LES MODIFIE PAS, NE LES FUSIONNE PAS, NE LES DIVISE PAS) :
${listeTextes}

Pour CHACUN, dans le même ordre, écris un prompt destiné à un générateur d'images (Midjourney, Firefly, Imagen…), d'une richesse exceptionnelle.

${STRUCTURE_PROMPT_VISUEL}
${regleProduitReelVisuels(aUnProduit)}

Réponds UNIQUEMENT en JSON valide sans texte avant ni après, avec EXACTEMENT ${lot.length} éléments dans le tableau, dans le même ordre que la liste ci-dessus :
{"visuels":["prompt du texte 1 se terminant par 9:16","prompt du texte 2 se terminant par 9:16"]}`;

    // callAI a déjà ses propres tentatives internes ; on retente le LOT entier
    // une fois de plus avant d'abandonner, pour ne marquer un plan en échec
    // qu'en dernier recours plutôt qu'au premier accroc réseau.
    let visuels = [];
    for (let tentative = 0; tentative < 2 && visuels.length < lot.length; tentative++) {
      try {
        const raw = await callAI(MODEL_RAPIDE, Math.max(2000, lot.length * 350), prompt, undefined, undefined, undefined, undefined, undefined, undefined, 'storyboard');
        const parsed = parseAIResponse(raw);
        if (parsed && Array.isArray(parsed.visuels)) visuels = parsed.visuels;
      } catch (e) { /* nouvelle tentative si le budget le permet encore */ }
    }

    for (let k = 0; k < lot.length; k++) {
      // Deux formes tolérées : une simple chaîne (la seule demandée
      // désormais), ou un objet {prompt, ...}. On garde la seconde : un
      // storyboard enregistré avant le retrait de l'insertion produit, rouvert
      // depuis l'historique, ne doit pas se retrouver sans visuels.
      const brut = visuels[k];
      const texte = (brut && typeof brut === 'object') ? brut.prompt : brut;
      lot[k].visuel = texte
        ? assainirPromptVisuel(texte, 'Plan ' + (i + k + 1))
        : 'Prompt visuel indisponible pour ce plan, clique sur ↻ Régénérer pour réessayer.';
    }
    if (onLot) onLot(lot, i);
  }
  return plans;
}


async function generateStoryStoryboard() {
  if (!currentStory || !currentStoryText) return;
  if (!_regenGratuiteEnCours) resetRegen('storyboardStory');

  const btn = document.getElementById('storyStoryboardBtn');
  const out = document.getElementById('storyStoryboardOutput');
  btn.disabled = true;
  document.getElementById('storyboardSpinner2').style.display = 'block';
  document.getElementById('storyStoryboardText').textContent = 'Création du storyboard…';
  const progBar2 = document.getElementById('sbProgBar2');
  if (progBar2) progBar2.style.display = 'flex';
  const setPctSb2 = (p) => {
    const fill = document.getElementById('sbProgFill2');
    const pct = document.getElementById('sbProgPct2');
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  };

  const plat = storyPlatform || 'TikTok';

  const carteMiniature = (m) => `
      <div class="sb-segment sb-miniature">
        <div class="sb-head">
          <span class="sb-time">★ Miniature</span>
          <span class="sb-index">Couverture</span>
        </div>
        <div class="sb-visual-label">${ICO('image')} Prompt de la miniature (anti-scroll)</div>
        <div class="sb-visual">${auditEsc(m)}</div>
        ${blocGenImage(storeCopyText(m))}
      </div>`;
  const cartePlan = (i, p) => `
      <div class="sb-segment">
        <div class="sb-head">
          <span class="sb-time">${auditEsc(p.duree || '')}</span>
          <span class="sb-index">Plan ${String(i + 1).padStart(2, '0')}</span>
        </div>
        <div class="sb-dit">"${auditEsc(p.text || '')}"</div>
        <div class="sb-visual-label">${ICO('image')} Prompt visuel</div>
        <div class="sb-visual">${auditEsc(p.visuel || '')}</div>
        ${blocGenImage(storeCopyText(p.visuel || ''))}
      </div>`;

  // Déclaré AVANT le try (bug corrigé, retour terrain, audit du 2 septembre
  // 2026) : un `const prog` déclaré DANS le try n'est pas visible dans le
  // `finally` (portée de bloc), le minuteur de progression pouvait tourner
  // indéfiniment après une erreur précoce (ex. "Récit vide"). Même correctif
  // que js/generation.js/js/serie.js.
  let prog = null;
  try {
    // Découpage narratif déterministe (moteur en tête de fichier), AVANT tout
    // appel IA : le nombre de plans n'est plus limité par ce qu'une seule
    // requête peut produire dans son budget de temps.
    const plans = segmentNarrativeStoryboard(currentStoryText);
    if (!plans.length) throw new Error('Récit vide');

    // Un jalon RÉEL par lot (le nombre de lots dépend du nombre de plans,
    // connu seulement maintenant) : le % avance à chaque lot VRAIMENT reçu,
    // pas sur un minuteur (voir creerProgressionReelle, plus haut).
    const nbLots = Math.max(1, Math.ceil(plans.length / TAILLE_LOT_VISUELS));
    prog = creerProgressionReelle(setPctSb2, Array(nbLots).fill(1));
    prog.start();

    out.innerHTML = `<div class="sb-actions-top"><button class="btn-regenerate sb-regen" onclick="regenererContenu('storyboardStory')">↻ Régénérer</button></div><div class="sb-aide">${ICO('bulb')} Clique sur un logo (ChatGPT ou Gemini) sous chaque prompt : le texte est copié automatiquement et l'app s'ouvre.</div><div class="storyboard-grid" id="storyStoryboardGrid" style="margin-top:18px"></div>`;
    const grid = document.getElementById('storyStoryboardGrid');

    let miniature = '';
    const promesseMiniature = genererMiniatureVisuelle(currentStoryText, plat).then(m => {
      miniature = m;
      if (m) grid.insertAdjacentHTML('afterbegin', carteMiniature(m));
    });

    // Les plans s'affichent lot par lot, au fur et à mesure que l'IA répond,
    // pas d'attente d'une réponse géante unique pour tout voir apparaître.
    await genererVisuelsParLots(plans, plat, (lot, indexDepart) => {
      const html = lot.map((p, k) => cartePlan(indexDepart + k, p)).join('');
      grid.insertAdjacentHTML('beforeend', html);
      const fait = Math.min(indexDepart + lot.length, plans.length);
      document.getElementById('storyStoryboardText').textContent = `Création du storyboard… ${fait}/${plans.length} plans`;
      prog.etapeTerminee(Math.floor(indexDepart / TAILLE_LOT_VISUELS));
    });
    await promesseMiniature;

    prog.finish();
    setTimeout(() => { const pb = document.getElementById('sbProgBar2'); if (pb) pb.style.display = 'none'; }, 600);

    const sbFullText = (miniature ? `MINIATURE : ${miniature}\n\n` : '') + plans.map((p, i) => `Plan ${i + 1} (${p.duree || ''})\n${p.text || ''}\nVisuel : ${p.visuel || ''}`).join('\n\n');
    grid.insertAdjacentHTML('beforeend', `
      <div class="sb-actions-fin">
        <button class="icon-btn" title="Copier tous les prompts" onclick="copyText(this, '${storeCopyText(sbFullText)}')">${ICON_COPY}</button>
        <button class="icon-btn" title="Partager" onclick="shareText(this, '${storeCopyText(sbFullText)}')">${ICON_SHARE}</button>
        ${montageBoutonHTML('montageBtnStory', plans)}
      </div>
      ${typeof guideMontageBlocHTML === 'function' ? guideMontageBlocHTML('Story', plans, '', updateGenerationGuideMontage) : ''}`);

    // Sauvegarder le storyboard pour qu'il reste après réouverture, mêmes
    // champs qu'avant (segment/duree/texte/visuel), pour rester compatible
    // avec l'historique et le rapport fusionné.
    const storyboardPourSauvegarde = plans.map((p, i) => ({ segment: String(i + 1), duree: p.duree, texte: p.text, visuel: p.visuel || '' }));
    updateGenerationStoryboard({ storyboard: storyboardPourSauvegarde, miniature: miniature || null, isStory: true });

    // Masquer le bouton + le texte descriptif après génération (le bouton Régénérer prend le relais)
    if (btn) {
      btn.style.display = 'none';
      // Masquer le paragraphe descriptif juste avant le bouton
      const descP = btn.previousElementSibling;
      if (descP && descP.tagName === 'P') descP.style.display = 'none';
    }

  } catch(e) {
    // Ajouté APRÈS ce qui a déjà pu s'afficher (plans des lots précédents) :
    // un échec en cours de route ne fait plus disparaître ce qui a déjà réussi.
    out.insertAdjacentHTML('beforeend', `<div class="error-box" style="display:block;margin-top:14px">Erreur : ${e.message}</div>`);
  } finally {
    if (prog) prog.stop();
    const pb2 = document.getElementById('sbProgBar2'); if (pb2) setTimeout(() => { pb2.style.display = 'none'; }, 600);
    btn.disabled = false;
    document.getElementById('storyboardSpinner2').style.display = 'none';
    document.getElementById('storyStoryboardText').textContent = 'Générer le storyboard visuel';
  }
}

// Registre global des textes à copier (évite les problèmes d'encodage HTML)
window._copyStore = window._copyStore || {};

function copyText(btn, text) {
  // Si text est une clé du registre, récupérer le vrai texte
  let realText = text;
  if (typeof text === 'string' && text.startsWith('__copykey_') && window._copyStore[text]) {
    realText = window._copyStore[text];
  }
  // Sécurité : si realText n'est pas une string valide, ne rien faire
  if (typeof realText !== 'string') {
    console.error('copyText: texte invalide');
    return;
  }
  const label = btn.innerHTML;
  // .copie-ok : confirmation en émeraude (doctrine de la palette, --emerald
  // dans css/style.css), retirée en même temps que le libellé d'origine.
  const done = () => {
    btn.textContent = '✓ Copié !';
    btn.classList.add('copie-ok');
    setTimeout(() => { btn.innerHTML = label; btn.classList.remove('copie-ok'); }, 2000);
  };
  navigator.clipboard.writeText(realText).then(done).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = realText; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    done();
  });
}

// Enregistre un texte et retourne sa clé
// Retire les hashtags (#mot) d'un texte de légende
function sansHashtags(txt) {
  if (!txt) return '';
  return txt.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
}
function storeCopyText(text) {
  const key = '__copykey_' + (window._copyKeyCounter = (window._copyKeyCounter || 0) + 1);
  window._copyStore[key] = text;
  return key;
}

// ── PARTAGE NATIF (menu du téléphone : WhatsApp, Instagram, etc.) ──
async function shareText(btn, text) {
  // Récupérer le vrai texte si c'est une clé du registre
  let realText = text;
  if (typeof text === 'string' && text.startsWith('__copykey_') && window._copyStore[text]) {
    realText = window._copyStore[text];
  }
  if (typeof realText !== 'string') { console.error('shareText: texte invalide'); return; }
  realText = realText.replace(/\u200B/g, '').trim();

  // API de partage native (mobile)
  if (navigator.share) {
    try {
      await navigator.share({ text: realText + '\n\nCréé avec Scriptura' });
    } catch(e) { /* l'utilisateur a annulé, on ne fait rien */ }
  } else {
    // Repli desktop : copier dans le presse-papier + message
    try {
      await navigator.clipboard.writeText(realText);
      const label = btn.innerHTML;
      btn.textContent = '✓ Copié (partage indispo)';
      setTimeout(() => btn.innerHTML = label, 2500);
    } catch(err) {
      alert('Le partage n\'est pas disponible sur cet appareil.');
    }
  }
}

// Partage du récit complet
async function shareStory(btn) {
  const text = document.getElementById('storyOutput').dataset.fulltext || '';
  await shareText(btn, text);
}

// Partage d'une idée
async function shareIdea(index, btn) {
  const idea = generatedIdeas[index];
  if (!idea) return;
  const text = idea.titre + '\n\nAngle : ' + idea.angle + '\n\nPourquoi ça marche : ' + idea.pourquoi + '\n\nHook : ' + idea.hook;
  await shareText(btn, text);
}

// ═══════════════════════════════════════════════════════════
//  GÉNÉRATION D'IMAGE, pont vers ChatGPT ou Gemini
// ═══════════════════════════════════════════════════════════
// Ouvre une boîte de dialogue, copie le prompt, puis ouvre l'app choisie.
let _promptAGenerer = '';

// Icônes SVG pour les boutons Copier / Partager
const ICON_COPY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
const ICON_PDF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

// Logos ChatGPT et Gemini pour le sélecteur de génération d'image
const LOGO_CHATGPT = `<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 22a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.09zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.77.77 0 0 0 .39.68l5.84 3.37-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86l-5.84-3.37 2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.78a4.49 4.49 0 0 1-.68 8.1v-5.67a.77.77 0 0 0-.4-.68zm2.01-3.02l-.14-.09-4.78-2.76a.78.78 0 0 0-.78 0L9.4 9.26V6.93a.08.08 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.68 4.65zM8.3 12.86l-2.02-1.17a.07.07 0 0 1-.04-.06V6.05a4.49 4.49 0 0 1 7.37-3.44l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z"/></svg>`;
const LOGO_GEMINI = `<svg viewBox="0 0 24 24" width="26" height="26"><defs><linearGradient id="gemGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4285F4"/><stop offset="50%" stop-color="#9B72CB"/><stop offset="100%" stop-color="#D96570"/></linearGradient></defs><path fill="url(#gemGrad)" d="M12 2c.34 4.9 4.8 9.36 9.7 9.7v.6C16.8 12.64 12.34 17.1 12 22h-.6C11.06 17.1 6.6 12.64 1.7 12.3v-.6C6.6 11.36 11.06 6.9 11.4 2z"/></svg>`;

// Génère le bloc "Générer l'image : [logo ChatGPT] [logo Gemini]" pour un prompt donné.
// promptKey est une clé du registre _copyStore (via storeCopyText).
function blocGenImage(promptKey) {
  return `<div class="genimg-inline">
    <span class="genimg-inline-label">Générer l'image :</span>
    <button class="genimg-logo-btn" title="Ouvrir dans ChatGPT" onclick="genImageDirect('chatgpt', '${promptKey}')">${LOGO_CHATGPT}</button>
    <button class="genimg-logo-btn" title="Ouvrir dans Gemini" onclick="genImageDirect('gemini', '${promptKey}')">${LOGO_GEMINI}</button>
  </div>`;
}

// Clic direct sur un logo : copie le prompt + ouvre l'app choisie (sans boîte de dialogue)
function genImageDirect(cible, promptKey) {
  let texte = promptKey;
  if (typeof promptKey === 'string' && promptKey.startsWith('__copykey_') && window._copyStore[promptKey]) {
    texte = window._copyStore[promptKey];
  }
  texte = (texte || '').replace(/\u200B/g, '').trim();

  // Le prompt contient déjà le style + le format choisis avant génération
  // (footer ajouté par assainirPromptVisuel) : on le copie tel quel.

  // Copier en parallèle (sans bloquer l'ouverture de l'app)
  try { navigator.clipboard.writeText(texte); } catch(e) {}

  let appUrl, webUrl;
  if (cible === 'chatgpt') {
    appUrl = 'chatgpt://?q=' + encodeURIComponent(texte);
    webUrl = 'https://chatgpt.com/?q=' + encodeURIComponent(texte);
  } else {
    appUrl = 'googlegemini://';
    webUrl = 'https://gemini.google.com/app';
  }

  // Repli vers le site si l'app ne s'ouvre pas
  const bascule = setTimeout(() => {
    if (!document.hidden) { window.location.href = webUrl; }
  }, 1500);
  const annuler = () => { clearTimeout(bascule); cleanup(); };
  const onHide = () => { if (document.hidden) annuler(); };
  function cleanup() {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('blur', annuler);
    window.removeEventListener('pagehide', annuler);
  }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', annuler);
  window.addEventListener('pagehide', annuler);

  window.location.href = appUrl;
}

function ouvrirGenImage(promptText) {
  // Récupérer le vrai texte si c'est une clé du registre
  let realText = promptText;
  if (typeof promptText === 'string' && promptText.startsWith('__copykey_') && window._copyStore[promptText]) {
    realText = window._copyStore[promptText];
  }
  _promptAGenerer = (realText || '').replace(/\u200B/g, '').trim();
  const modal = document.getElementById('genImageModal');
  if (modal) modal.classList.add('active');
}

function fermerGenImage() {
  const modal = document.getElementById('genImageModal');
  if (modal) modal.classList.remove('active');
}

// Copie le prompt puis ouvre l'app choisie (chatgpt / gemini)
function lancerGenImage(cible) {
  const texte = _promptAGenerer;

  // 1. Copier le prompt EN PARALLÈLE (sans attendre, sinon iOS bloque l'ouverture d'app)
  try { navigator.clipboard.writeText(texte); } catch(e) { /* silencieux */ }

  // 2. Préparer les liens
  let appUrl, webUrl;
  if (cible === 'chatgpt') {
    appUrl = 'chatgpt://?q=' + encodeURIComponent(texte);
    webUrl = 'https://chatgpt.com/?q=' + encodeURIComponent(texte);
  } else {
    appUrl = 'googlegemini://';  // schéma de l'app Gemini dédiée (app séparée depuis février 2025)
    webUrl = 'https://gemini.google.com/app';
  }

  fermerGenImage();

  // 3. Repli vers le site UNIQUEMENT si rien ne s'est passé (ni app ouverte, ni dialogue affiché).
  // Le blur (perte de focus) détecte aussi le dialogue iOS "Ouvrir dans..." → on annule le repli
  // pour respecter le choix de l'utilisateur s'il annule.
  const bascule = setTimeout(() => {
    if (!document.hidden) { window.location.href = webUrl; }
  }, 1500);
  const annuler = () => { clearTimeout(bascule); cleanup(); };
  const onHide = () => { if (document.hidden) annuler(); };
  function cleanup() {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('blur', annuler);
    window.removeEventListener('pagehide', annuler);
  }
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', annuler);      // le dialogue iOS fait perdre le focus → annule le repli
  window.addEventListener('pagehide', annuler);

  // 4. Ouvrir l'app IMMÉDIATEMENT (synchrone, dans le contexte du clic, exigé par iOS)
  window.location.href = appUrl;
}

// ═══════════════════════════════════════════════════════════
//  BARRE DE PROGRESSION ESTIMÉE (storyboard)
// ═══════════════════════════════════════════════════════════
// La barre monte de façon crédible vers 90% pendant que l'IA travaille,
// puis saute à 100% PILE quand le storyboard est prêt et affiché.
// 100% = storyboard visible, toujours.
function createProgress(setLabel, dureeEstimee) {
  let pct = 0;
  let timer = null;
  const DUREE_ESTIMEE = dureeEstimee || 9000; // durée moyenne estimée (défaut ~9s)
  const debut = Date.now();

  function tick() {
    const ecoule = Date.now() - debut;
    // Courbe qui ralentit en approchant 90% (asymptote)
    const ratio = ecoule / DUREE_ESTIMEE;
    const cible = 90 * (1 - Math.exp(-ratio * 1.8)); // monte vers 90% sans jamais dépasser
    pct = Math.min(90, Math.max(pct, cible));
    setLabel(Math.round(pct));
    timer = setTimeout(tick, 120);
  }

  return {
    start() { pct = 0; setLabel(0); tick(); },
    // Termine : saute à 100% (à appeler quand le storyboard est affiché)
    finish() {
      if (timer) clearTimeout(timer);
      pct = 100;
      setLabel(100);
    },
    stop() { if (timer) clearTimeout(timer); },
    // No-op : cette barre est une pure estimation de temps, sans notion de
    // jalon ou de flux. Présents uniquement pour que TOUT appelant puisse
    // appeler ces deux méthodes sans jamais avoir à savoir laquelle des deux
    // barres (estimée ou réelle, voir creerProgressionReelle) est active.
    etapeTerminee() {},
    etapeFluxProgres() {}
  };
}

// ═══════════════════════════════════════════════════════════
//  BARRE DE PROGRESSION RÉELLE (phases à jalons + flux continu)
// ═══════════════════════════════════════════════════════════
// Contrairement à createProgress ci-dessus (estimation de temps pure, qui
// monte tout seul même si le serveur est bloqué), celle-ci reflète le VRAI
// travail en cours (retour direct du propriétaire : "que le pourcentage
// progresse réellement au rythme réel du travail de génération") :
// - chaque étape ATOMIQUE (pas de flux, ex. le brief ou la critique) fait
//   sauter le % à sa borne haute dès qu'elle se termine VRAIMENT
//   (etapeTerminee), jamais avant ;
// - l'étape qui fait le vrai gros du travail (l'écriture, en flux via
//   onApercu/api/generate.js, voir js/api.js callAI) avance en CONTINU,
//   proportionnellement aux caractères RÉELLEMENT reçus du modèle jusqu'ici
//   (etapeFluxProgres) : si le réseau ou le modèle cale, le % cale aussi,
//   jamais une fausse impression de mouvement.
// `poidsEtapes` : poids relatif de chaque étape du pipeline. On utilise le
// max_tokens de l'appel qui la compose comme proxy (le meilleur repère
// disponible du temps réel qu'elle prendra), pas une durée devinée à la main.
// `dureeEstimeeTotale` (optionnel, ms) : calibre le FLUAGE ci-dessous ; à
// défaut, ~8s par étape (repère raisonnable pour un appel IA courant).
//
// Retour direct du propriétaire : sur une étape ATOMIQUE un peu longue (le
// brief, la critique, la révision…), le % restait figé du début à la fin de
// l'appel puis sautait d'un coup, donnant l'impression que "ça ne bouge
// qu'à la fin" alors que l'IA travaille depuis le début de l'étape. Un
// FLUAGE comble maintenant cette attente : pendant qu'une étape est en
// cours SANS jalon ni flux reçu, le % avance tout seul vers la borne haute
// de CETTE étape (jamais au-delà, jamais 100%), sur une courbe qui ralentit
// en approchant la borne (même principe que createProgress ci-dessus, mais
// bornée à la bande de l'étape courante au lieu de toute la barre). Dès
// qu'un jalon réel (etapeTerminee) ou un flux réel (etapeFluxProgres)
// arrive, il prend le dessus (appliquer() est monotone, le plus grand des
// deux gagne) : le fluage ne fait jamais mentir un jalon réel, il comble
// seulement le silence entre deux jalons.
function creerProgressionReelle(setPct, poidsEtapes, dureeEstimeeTotale) {
  const total = poidsEtapes.reduce((s, w) => s + w, 0) || 1;
  const cumul = [0];
  poidsEtapes.forEach(w => cumul.push(cumul[cumul.length - 1] + w));
  const dureeTotale = dureeEstimeeTotale || poidsEtapes.length * 8000;

  let etapeCourante = 0;
  let dernierPct = 0;
  let debutEtape = Date.now();
  let timerFluage = null;
  function appliquer(p) {
    // Jamais en arrière, jamais 100% avant finish() (réservé à la vraie fin
    // du pipeline, voir plus bas) : un jalon intermédiaire ne doit jamais
    // laisser croire que c'est terminé.
    dernierPct = Math.max(dernierPct, Math.min(99, Math.round(p)));
    setPct(dernierPct);
  }
  function tickFluage() {
    const basIdx = Math.min(etapeCourante, cumul.length - 1);
    const hautIdx = Math.min(etapeCourante + 1, cumul.length - 1);
    const bas = cumul[basIdx] / total, haut = cumul[hautIdx] / total;
    const dureeEtape = Math.max(1000, ((poidsEtapes[basIdx] || 1) / total) * dureeTotale);
    const ratio = (Date.now() - debutEtape) / dureeEtape;
    // Va jusqu'à 92% de la bande de l'étape en cours, jamais plus : seul un
    // jalon réel peut franchir cette borne (etapeTerminee/etapeFluxProgres).
    const cibleBande = bas + Math.min(0.92, 1 - Math.exp(-ratio * 1.5)) * (haut - bas);
    appliquer(cibleBande * 100);
    timerFluage = setTimeout(tickFluage, 200);
  }
  return {
    // Marque l'étape `i` (0-based) comme réellement terminée : le % saute
    // au moins à sa borne haute. Monotone (jamais en arrière), sans effet
    // si `i` a déjà été dépassée.
    etapeTerminee(i) {
      etapeCourante = Math.max(etapeCourante, i + 1);
      debutEtape = Date.now();
      appliquer((cumul[etapeCourante] / total) * 100);
    },
    // Progression CONTINUE à l'intérieur de l'étape `i`, celle qui reçoit
    // un flux : `fraction` (0..1) = travail réellement reçu jusqu'ici pour
    // cette étape (voir fractionFlux ci-dessous).
    etapeFluxProgres(i, fraction) {
      const bas = cumul[i] / total, haut = cumul[i + 1] / total;
      appliquer((bas + Math.min(1, Math.max(0, fraction)) * (haut - bas)) * 100);
    },
    start() {
      dernierPct = 0; etapeCourante = 0; debutEtape = Date.now(); setPct(0);
      if (timerFluage) clearTimeout(timerFluage);
      tickFluage();
    },
    // Termine : saute à 100% (à appeler quand le résultat est réellement affiché).
    finish() {
      if (timerFluage) clearTimeout(timerFluage);
      dernierPct = 100; setPct(100);
    },
    stop() { if (timerFluage) clearTimeout(timerFluage); }
  };
}

// Estimation grossière de la longueur de texte à attendre pour UN appel IA
// donné, à partir de son max_tokens (le seul repère disponible avant coup) :
// sert UNIQUEMENT à calibrer la vitesse d'avancement du %, jamais à couper
// la génération réelle. ~3.3 caractères par token en français (mesuré sur
// les générations Scriptura). La fraction est de toute façon plafonnée à 1
// si le texte réellement reçu dépasse cette estimation (le modèle a écrit
// plus long que prévu, ça arrive), le % ne dépasse simplement jamais la
// borne haute de l'étape avant qu'elle soit vraiment marquée terminée.
function fractionFlux(bufferLength, maxTokens) {
  const caracteresCibles = Math.max(200, maxTokens * 3.3);
  return Math.min(1, bufferLength / caracteresCibles);
}

function copyStory(btn) {
  const text = document.getElementById('storyOutput').dataset.fulltext || '';
  const label = btn.innerHTML;
  const confirmer = () => {
    btn.textContent = '✓ Copié !';
    btn.classList.add('copie-ok');
    setTimeout(() => { btn.innerHTML = label; btn.classList.remove('copie-ok'); }, 2000);
  };
  navigator.clipboard.writeText(text).then(confirmer).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    confirmer();
  });
}

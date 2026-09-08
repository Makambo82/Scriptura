#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  BANC D'ESSAI DES MODÈLES D'IMAGES
//
//  « Compare les modèles » (propriétaire). Le montage vidéo est la seule
//  fonction dont le coût variable est sérieux : une image générée est
//  facturée à chaque plan, et le rythme demandé (un plan toutes les 2 à 5
//  secondes) en demande beaucoup. À 0,05 € l'image, aucune structure
//  d'abonnement ne donne une offre confortable ; à 0,004 €, la question ne se
//  pose plus. Tout dépend donc du modèle, et le choix ne peut pas se faire sur
//  une grille tarifaire : un modèle deux fois moins cher qui rate une image
//  sur trois coûte plus cher, et une image ratée est une image que l'abonné
//  voit.
//
//  CE QUE CE BANC MESURE VRAIMENT, sur les MÊMES prompts, en parallèle :
//    - le prix payé par image RÉUSSIE, retentatives comprises ;
//    - le taux d'échec et sa raison (modération, paramètre refusé, panne) ;
//    - la latence, parce qu'elle se voit : le créateur attend devant la barre ;
//    - les dimensions réellement renvoyées, qui ne sont pas toujours celles
//      demandées et qui décident du recadrage ;
//    - et le résultat À L'ŒIL, dans une planche-contact HTML, parce que c'est
//      le seul juge qui compte pour un visuel.
//
//  USAGE
//    TOGETHER_API_KEY=... node outils/comparer-modeles-images.js
//    TOGETHER_API_KEY=... node outils/comparer-modeles-images.js \
//        --modeles=black-forest-labs/FLUX.1-schnell,openai/gpt-image-2 \
//        --prompts=3 --sortie=/tmp/comparaison
//
//  Le banc ne touche À RIEN dans l'app : il appelle Together directement, avec
//  la même charge utile que api/montage-media.js. Aucun quota d'abonné n'est
//  consommé, mais L'ARGENT EST BIEN DÉPENSÉ (c'est le but). Le coût total
//  prévu est affiché et confirmé avant le premier appel.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ── Prix, à vérifier avant toute décision ──
// Relevés sur la grille publique de Together (septembre 2026). Ils sont ICI et
// pas éparpillés dans le code : quand un prix change, un seul endroit bouge.
// `mp` = facturé au mégapixel, `image` = facturé à l'image.
const PRIX = {
  'openai/gpt-image-2':                  { usd: 0.053,  unite: 'image' },
  'openai/gpt-image-1.5':                { usd: 0.04,   unite: 'image' },
  'black-forest-labs/FLUX.2-pro':        { usd: 0.03,   unite: 'image' },
  'black-forest-labs/FLUX.1-dev':        { usd: 0.025,  unite: 'mp' },
  'black-forest-labs/FLUX.1-schnell':    { usd: 0.0027, unite: 'mp' },
  'black-forest-labs/FLUX.1.1-pro':      { usd: 0.04,   unite: 'image' },
  'google/imagen-4.0-ultra':             { usd: 0.06,   unite: 'mp' }
};
const USD_VERS_EUR = 0.92;

// Les candidats par défaut. gpt-image-2 est le modèle en production : il sert
// de référence, on ne compare pas dans le vide.
const MODELES_DEFAUT = [
  'openai/gpt-image-2',
  'black-forest-labs/FLUX.1-schnell',
  'black-forest-labs/FLUX.1-dev',
  'black-forest-labs/FLUX.2-pro'
];

// ── Dimensions ──
// Celles de l'app aujourd'hui, ET celles qu'elle devrait demander.
//
// L'APP DEMANDE DU 1024x1536, C'EST-À-DIRE DU 2:3, alors que la vidéo finale
// est en 1080x1920, c'est-à-dire du 9:16. Le service de rendu recadre
// (scale ... force_original_aspect_ratio=increase, crop, voir
// render-service/server.js) : 15,6 % de la largeur de CHAQUE image payée est
// jetée, et le cadrage vu par le spectateur n'est pas celui que le modèle a
// composé. Le prompt, lui, dit bien « 9:16 » au modèle (versionSure), donc les
// deux se contredisent déjà.
//
// Le banc génère donc dans les deux dimensions : le surcoût du 2:3 est réel
// pour tout modèle facturé au mégapixel, et le gain de cadrage se juge à l'œil.
const DIMENSIONS = {
  'actuel-2:3': { w: 1024, h: 1536 },
  'vrai-9:16':  { w: 896,  h: 1600 }
};

// ── Prompts ──
// De VRAIS prompts de storyboard Scriptura, respectant STRUCTURE_PROMPT_VISUEL
// (décor, matière, personnages avec description physique explicite, vie de la
// scène). Comparer sur « a cat » ne dirait rien : ce qui sépare ces modèles,
// c'est justement leur tenue sur un prompt long, avec des personnes nommées et
// une origine ethnique à respecter, ce que l'app leur demande vraiment.
const PROMPTS = [
  'A rural classroom in northern Rwanda in 1994, late afternoon light through wooden shutters. '
  + 'Rough plastered walls, a worn blackboard, wooden benches, red dust on the concrete floor. '
  + 'A Black African man in his early thirties with deep dark brown skin, broad nose, full lips and '
  + 'short tightly-coiled black hair, wearing a faded blue short-sleeved shirt and grey trousers, '
  + 'stands writing on the blackboard, his back to the empty benches. Above him a wooden false '
  + 'ceiling with a barely visible cut hatch. Dust floating in the shafts of light, warm ochre '
  + 'palette, painterly fine-art composition, cinematic depth. 9:16',

  'A modern smartphone lying face up on a rumpled dark bedsheet at night, screen glowing cold blue '
  + 'in an otherwise unlit bedroom. Fingerprints and micro-scratches visible on the glass, the '
  + 'reflection of a face barely suggested. A young West African woman with warm dark brown skin '
  + 'and long braided hair lies half in shadow beside it, eyes open, not touching the phone. '
  + 'Alarm clock reading 3:12. Cold blue and deep charcoal palette, tight intimate framing, '
  + 'photographic realism with soft grain. 9:16',

  'A crowded outdoor market street in Abidjan at midday, corrugated iron roofs and hand-painted '
  + 'shop signs, motorbikes weaving between stalls. Wooden crates of mangoes and folded printed '
  + 'fabrics stacked high. In the foreground a Black African woman in her forties with dark brown '
  + 'skin, high cheekbones and a yellow patterned headwrap, wearing a green wax-print dress, counts '
  + 'banknotes with a focused expression while a customer waits. Harsh overhead sun, strong shadows, '
  + 'saturated warm colours, documentary photographic style. 9:16',

  'An empty attic at dusk, seen from inside as a heavy wooden door is pushed open. Thick dust, '
  + 'cobwebs between exposed roof beams, an old leather suitcase and a stack of yellowed newspapers. '
  + 'A single shaft of orange light from a small round window cuts across the floorboards. No people. '
  + 'Muted sepia and dust-grey palette, high contrast, painterly stillness, a held breath. 9:16',

  'A brown leather bracelet with a hammered brass clasp, worn on the wrist of a Black African man '
  + 'with dark brown skin, resting on a weathered wooden workbench in a small artisan workshop. '
  + 'Hand tools, leather offcuts and a coffee cup blurred in the background. Warm tungsten light '
  + 'from the left, shallow depth of field, the leather grain and stitching sharply visible. '
  + 'Rich warm browns and amber, product photography with a human, lived-in feel. 9:16'
];

const TENTATIVES_MAX = 3;   // identique à api/montage-media.js

function lireArgs() {
  const a = {};
  for (const brut of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(brut);
    if (m) a[m[1]] = m[2];
    else if (brut.startsWith('--')) a[brut.slice(2)] = true;
  }
  return a;
}

function coutEur(modele, dims) {
  const p = PRIX[modele];
  if (!p) return null;              // prix inconnu : on le dira, on ne l'inventera pas
  const mp = (dims.w * dims.h) / 1e6;
  return (p.unite === 'mp' ? p.usd * mp : p.usd) * USD_VERS_EUR;
}

// Même consigne de repli que l'app : sur un refus de modération, elle réessaie
// avec une version « sage » du prompt. Un modèle qui oblige souvent à ce repli
// coûte deux appels au lieu d'un, et c'est ça qu'on veut voir.
function versionSure(prompt) {
  return prompt.replace(/\s*9:16\s*$/i, '').trim()
    + '. Safe-for-work, tasteful and dignified, non-explicit, no nudity, no gore, no graphic '
    + 'violence, fully clothed, respectful fine-art composition. 9:16';
}

function estBlocageNSFW(message) {
  return /nsfw|not safe|safety|flagged|content policy|may contain|moderat/i.test(String(message));
}

async function genererUne(cle, modele, prompt, dims) {
  let promptCourant = prompt;
  let dejaSecurise = false;
  const journal = [];

  for (let tentative = 1; tentative <= TENTATIVES_MAX; tentative++) {
    const t0 = Date.now();
    let rep, brut;
    try {
      rep = await fetch('https://api.together.xyz/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cle, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modele, prompt: promptCourant,
          width: dims.w, height: dims.h, response_format: 'base64'
        })
      });
      brut = await rep.text();
    } catch (e) {
      journal.push({ tentative, ms: Date.now() - t0, erreur: 'réseau : ' + e.message });
      continue;
    }
    const ms = Date.now() - t0;

    // MÊME GARDE QUE L'APP, et c'est en lançant ce banc que le défaut a été
    // trouvé côté app : une réponse non-JSON (passerelle en panne, proxy qui
    // refuse l'hôte) doit dire ce qu'elle est, pas « Unexpected token 'H' ».
    // Un banc qui ment sur la raison d'un échec ferait condamner un modèle
    // innocent, c'est-à-dire exactement ce qu'il est censé éviter.
    let data = null;
    try { data = brut ? JSON.parse(brut) : null; } catch (e) { data = null; }
    if (data === null) {
      const apercu = String(brut || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      journal.push({ tentative, ms, erreur: 'réponse illisible (statut ' + rep.status + ') : ' + (apercu || 'corps vide') });
      if (rep.status >= 500 || rep.status === 429) { await new Promise(r => setTimeout(r, 800 * tentative)); continue; }
      return { ok: false, journal, appels: tentative, fatal: true };
    }

    if (rep.ok) {
      const image = (data.data || [])[0];
      const b64 = image && (image.b64_json || image.base64);
      if (b64) {
        journal.push({ tentative, ms, ok: true });
        return { ok: true, b64, journal, appels: tentative };
      }
      journal.push({ tentative, ms, erreur: 'réponse sans image' });
      continue;
    }

    const msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + rep.status);
    journal.push({ tentative, ms, erreur: String(msg).slice(0, 200) });

    // Un refus de modération ne se rejoue pas à l'identique : c'est le seul cas
    // où insister a un sens, et seulement une fois.
    if (estBlocageNSFW(msg) && !dejaSecurise) {
      promptCourant = versionSure(prompt);
      dejaSecurise = true;
      continue;
    }
    // Modèle inconnu ou clé refusée : inutile de payer deux fois pour l'apprendre.
    if (rep.status === 401 || rep.status === 403 || /model.*(not found|unknown|invalid)/i.test(msg)) {
      return { ok: false, journal, appels: tentative, fatal: true };
    }
    await new Promise(r => setTimeout(r, 800 * tentative));
  }
  return { ok: false, journal, appels: TENTATIVES_MAX };
}

function planche(resultats, modeles, cles, sortie) {
  const ligne = (m) => cles.map(k => {
    const r = resultats[m][k];
    const cell = r && r.ok
      ? `<img src="${r.fichier}" alt="">`
      : `<div class="rate">échec<br><span>${(r && r.journal.slice(-1)[0] && r.journal.slice(-1)[0].erreur || '').replace(/</g, '&lt;').slice(0, 120)}</span></div>`;
    return `<td>${cell}</td>`;
  }).join('');

  return `<!doctype html><meta charset="utf-8"><title>Comparaison des modèles d'images</title>
<style>
 body{background:#0f1115;color:#e8e6e1;font:14px/1.5 system-ui,sans-serif;margin:24px}
 h1{color:#d4af5f;font-size:20px;margin:0 0 4px}
 p.sub{opacity:.65;margin:0 0 20px}
 table{border-collapse:collapse}
 th{color:#d4af5f;font-size:13px;text-align:left;padding:8px;vertical-align:bottom;position:sticky;top:0;background:#0f1115}
 td{padding:6px;vertical-align:top}
 img{width:190px;display:block;border-radius:6px}
 .rate{width:190px;height:285px;display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:#1c1f26;border:1px solid #3a2020;border-radius:6px;color:#e07a5f;text-align:center;padding:8px}
 .rate span{opacity:.6;font-size:11px;margin-top:6px}
 th.m{color:#e8e6e1;font-weight:600;white-space:nowrap;padding-right:16px}
 .prix{color:#4fb286;font-weight:600}
</style>
<h1>Comparaison des modèles d'images</h1>
<p class="sub">Mêmes prompts, mêmes dimensions. Le prix est celui payé par image RÉUSSIE, retentatives comprises.</p>
<table>
<tr><th></th>${cles.map((k, i) => `<th>Prompt ${i + 1}</th>`).join('')}</tr>
${modeles.map(m => {
    const r = Object.values(resultats[m]);
    const ok = r.filter(x => x && x.ok).length;
    const appels = r.reduce((s, x) => s + (x ? x.appels : 0), 0);
    const pu = resultats[m]._coutUnitaire;
    const parReussie = ok ? (appels * pu) / ok : null;
    return `<tr><th class="m">${m}<br>`
      + `<span class="prix">${parReussie === null ? 'prix inconnu' : parReussie.toFixed(4) + ' € / image réussie'}</span><br>`
      + `<span style="opacity:.6;font-weight:400">${ok}/${r.length} réussies, ${appels} appels</span></th>`
      + ligne(m) + '</tr>';
  }).join('\n')}
</table>`;
}

async function main() {
  const args = lireArgs();
  const cle = process.env.TOGETHER_API_KEY;
  if (!cle) {
    console.error('TOGETHER_API_KEY absente. Lance :\n  TOGETHER_API_KEY=... node outils/comparer-modeles-images.js');
    process.exit(1);
  }

  const modeles = args.modeles ? String(args.modeles).split(',').map(s => s.trim()) : MODELES_DEFAUT;
  const nbPrompts = Math.min(parseInt(args.prompts, 10) || PROMPTS.length, PROMPTS.length);
  const nomDims = args.dimensions || 'actuel-2:3';
  const dims = DIMENSIONS[nomDims];
  if (!dims) {
    console.error('Dimensions inconnues : ' + nomDims + '. Choix : ' + Object.keys(DIMENSIONS).join(', '));
    process.exit(1);
  }
  const sortie = args.sortie || path.join(process.cwd(), 'comparaison-modeles');
  fs.mkdirSync(sortie, { recursive: true });

  // LE COÛT EST ANNONCÉ AVANT, ET DEMANDE UNE CONFIRMATION. Ce banc dépense de
  // l'argent réel : il ne doit jamais partir sur un --modeles mal tapé.
  let prevu = 0, inconnus = [];
  for (const m of modeles) {
    const c = coutEur(m, dims);
    if (c === null) inconnus.push(m); else prevu += c * nbPrompts;
  }
  console.log('\nBanc d\'essai des modèles d\'images');
  console.log('  dimensions : ' + nomDims + ' (' + dims.w + 'x' + dims.h + ', '
    + ((dims.w * dims.h) / 1e6).toFixed(2) + ' MP)');
  console.log('  modèles    : ' + modeles.length + ' × ' + nbPrompts + ' prompts = '
    + (modeles.length * nbPrompts) + ' images');
  console.log('  coût prévu : ~' + prevu.toFixed(2) + ' € (hors retentatives)'
    + (inconnus.length ? ', prix inconnu pour : ' + inconnus.join(', ') : ''));
  console.log('  sortie     : ' + sortie + '\n');

  if (!args.oui) {
    console.log('Relance avec --oui pour lancer vraiment (rien n\'a été dépensé).');
    return;
  }

  const resultats = {};
  for (const m of modeles) {
    resultats[m] = { _coutUnitaire: coutEur(m, dims) || 0 };
    for (let i = 0; i < nbPrompts; i++) {
      process.stdout.write('  ' + m.padEnd(38) + ' prompt ' + (i + 1) + '… ');
      const r = await genererUne(cle, m, PROMPTS[i], dims);
      if (r.ok) {
        const nom = m.replace(/[^\w.-]/g, '_') + '_p' + (i + 1) + '.png';
        fs.writeFileSync(path.join(sortie, nom), Buffer.from(r.b64, 'base64'));
        r.fichier = nom;
        const ms = r.journal.reduce((s, j) => s + j.ms, 0);
        console.log('ok en ' + (ms / 1000).toFixed(1) + ' s, ' + r.appels + ' appel(s)');
      } else {
        console.log('ÉCHEC : ' + ((r.journal.slice(-1)[0] || {}).erreur || 'raison inconnue'));
      }
      resultats[m]['p' + (i + 1)] = r;
      if (r.fatal) break;   // clé ou modèle invalide : les autres prompts échoueraient pareil
    }
  }

  const cles = Array.from({ length: nbPrompts }, (_, i) => 'p' + (i + 1));
  fs.writeFileSync(path.join(sortie, 'index.html'), planche(resultats, modeles, cles, sortie));
  fs.writeFileSync(path.join(sortie, 'mesures.json'), JSON.stringify(resultats, (k, v) => k === 'b64' ? undefined : v, 2));

  console.log('\n── Résultat ──');
  console.log('modèle'.padEnd(38) + 'réussies'.padStart(10) + 'appels'.padStart(8)
    + '€/réussie'.padStart(12) + 'latence moy.'.padStart(14));
  for (const m of modeles) {
    const r = Object.entries(resultats[m]).filter(([k]) => k !== '_coutUnitaire').map(([, v]) => v);
    if (!r.length) continue;
    const ok = r.filter(x => x.ok).length;
    const appels = r.reduce((s, x) => s + x.appels, 0);
    const ms = r.reduce((s, x) => s + x.journal.reduce((a, j) => a + j.ms, 0), 0) / r.length;
    const pu = resultats[m]._coutUnitaire;
    const parReussie = ok ? (appels * pu) / ok : null;
    console.log(m.padEnd(38) + (ok + '/' + r.length).padStart(10) + String(appels).padStart(8)
      + (parReussie === null ? 'inconnu' : parReussie.toFixed(4) + ' €').padStart(12)
      + ((ms / 1000).toFixed(1) + ' s').padStart(14));
  }
  console.log('\nPlanche-contact : ' + path.join(sortie, 'index.html'));
  console.log('Regarde les images AVANT le tableau : le prix ne décide de rien si le visuel ne tient pas.');
}

main().catch(e => { console.error(e); process.exit(1); });

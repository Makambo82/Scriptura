# Service de rendu vidéo Scriptura

Rend le montage vidéo final (images + voix off → mp4) avec FFmpeg, **hors
Vercel**, pour échapper aux limites du plan gratuit (300 s / 1 Go) qui
forçaient des compromis sur la qualité et la synchro. Ici : un seul graphe
FFmpeg, durées respectées au millième, fondu croisé varié entre chaque plan,
animations Ken Burns variées, sortie 1080×1920.

## Ce que fait le service

- `GET /` → `OK` (santé, utilisé par l'hébergeur).
- `POST /render` avec `{ "images": [{ "url": "...", "duration": 2.5 }, ...], "audioUrl": "...", "captions": [{ "texte": "...", "debut": 0, "fin": 1.5 }, ...], "musicUrl": "...", "musicVolume": 0.15, "watermark": true }`
  → rend la vidéo, la ré-uploade dans Supabase Storage (bucket `montages`,
  dossier `rendus/`), renvoie `{ "url": "https://.../montage-....mp4" }`.
  `captions` est optionnel : sans lui (ou tableau vide), le flux vidéo est
  simplement copié, pas de ré-encodage. Avec lui, les sous-titres sont
  incrustés (police DejaVu Sans, voir Dockerfile) et le mux final ré-encode
  la vidéo (un peu plus lent, nécessaire pour appliquer le filtre). Les
  chiffres/statistiques dans le texte des sous-titres sont automatiquement
  colorés en doré (retour propriétaire, "pro CapCut" : accroche l'œil en
  premier sur TikTok).
  `musicUrl` est optionnel (musique de fond instrumentale, générée par
  Eleven Music, voir `api/montage-media.js` action=music) : sans lui, seule
  la voix off est présente. Avec lui, la musique est mélangée sous la voix
  off et bouclée si plus courte que la vidéo. `musicVolume` (0.05 à 0.5,
  choisi par montage via le menu "Volume de la musique" côté client) règle
  le niveau de la musique relatif à la voix off (toujours à 1.0) ; ignoré
  hors plage (ramené à la borne la plus proche) ou absent (retombe sur
  `MONTAGE_MUSIC_VOLUME`, 0.15 par défaut, variable d'environnement de ce
  service).
  Chaque plan reçoit aussi automatiquement un léger étalonnage
  (contraste/saturation, réglable via
  `MONTAGE_GRADE_CONTRASTE`/`MONTAGE_GRADE_SATURATION`), toujours actif,
  aucun champ de requête associé.
  `watermark` (booléen, coché par défaut côté client) affiche "SCRIPTURA"
  en petit, semi-transparent, coin bas-droit, sur toute la durée de la
  vidéo ; indépendant de `captions`.

## Déploiement sur Northflank (recommandé)

Railway a longtemps été recommandé ici, mais la période d'essai gratuite
s'épuise et Railway refuse les cartes prépayées pour passer au plan payant
(retour propriétaire) : Northflank la remplace. Construit toujours à partir
du `Dockerfile` de ce dossier (build par conteneur, pas de détection
automatique ambiguë comme Railway/Nixpacks, voir la mise en garde
"sous-titres" ci-dessous) et propose un plan gratuit avec assez de RAM pour
un rendu occasionnel.

**Important pour les sous-titres** : c'est le `Dockerfile` qui installe la
police nécessaire au rendu des sous-titres (`fonts-dejavu-core`), absente
d'une image Node de base. Vérifie que Northflank construit bien à partir de
ce `Dockerfile` (build type **Dockerfile**, pas un buildpack auto-détecté)
— sinon un montage AVEC sous-titres échouera au rendu (ou les sous-titres
resteront invisibles selon la version de libass) ; un montage sans
sous-titres continue de fonctionner normalement dans les deux cas.

1. Va sur https://northflank.com → connecte-toi avec **GitHub**.
2. Crée un **Project** (ou réutilise un projet existant), puis **Create new
   service** → **Deployment** → **Import from Git repository** → choisis
   `Makambo82/Scriptura`, branche `main`.
3. **Build configuration** :
   - **Build context / répertoire de build** : `render-service` (c'est le
     monorepo qu'on cible, pas la racine du dépôt).
   - **Build type** : **Dockerfile** (le `render-service/Dockerfile` doit
     être détecté automatiquement une fois le répertoire de build réglé).
4. **Environnement / Secrets** (mêmes variables que Railway, un nom parfois
   différent selon l'onglet Northflank utilisé, mêmes valeurs) :
   - `SUPABASE_URL` — même valeur que sur Vercel.
   - `SUPABASE_SERVICE_ROLE_KEY` — même valeur que sur Vercel (audit A3 :
     le bucket `montages` est privé depuis ce correctif, un upload à la clé
     anon échouerait désormais). Ne JAMAIS confondre avec `SUPABASE_ANON_KEY`
     (retirée, elle n'a plus aucun usage dans ce service) : la clé
     service_role contourne la RLS, elle doit rester une variable
     d'environnement serveur, jamais dans du code versionné.
   - `ALLOWED_ORIGIN` — l'URL du site, ex. `https://scriptura-v1.vercel.app`
     (ou `*` pour tout autoriser).
   - `MONTAGE_TOKEN` — **OBLIGATOIRE**, un secret long et aléatoire (ex.
     généré avec `openssl rand -hex 32`). Le service **refuse de démarrer**
     si cette variable est absente (voir le message d'erreur explicite dans
     les logs Northflank au démarrage) : `POST /render` accepterait sinon
     n'importe quelle requête, de n'importe où, sans aucune vérification
     (le rendu FFmpeg coûte du temps de calcul facturé par l'hébergeur).
     Chaque requête doit porter la MÊME valeur dans l'en-tête HTTP
     `x-montage-token`, comparée en temps constant (jamais un `===` nu, qui
     laisserait fuiter le secret par le temps de réponse). Cette variable
     doit être renseignée avec la MÊME valeur côté Vercel, sous le nom
     `MONTAGE_RENDER_TOKEN` (voir plus bas) : deux noms différents pour la
     même valeur, l'un pour ce service, l'autre pour le proxy Vercel qui
     l'appelle. Ne jamais écrire la valeur réelle du jeton dans ce dépôt,
     dans un commit, ou dans une réponse HTTP.
   - *(optionnel)* `MONTAGE_WIDTH` / `MONTAGE_HEIGHT` / `MONTAGE_FPS` /
     `MONTAGE_TRANSITION` pour ajuster résolution, cadence et durée de fondu.
   - *(optionnel)* `MONTAGE_BATCH` — nombre de plans rendus ensemble (défaut 3,
     abaissé après un vrai OOM en production sur un montage à 53 plans). Si un
     rendu échoue encore par saturation mémoire (« FFmpeg a été interrompu par
     le système (signal SIGKILL) »), baisse-le encore (2) ou augmente la RAM
     allouée au service côté Northflank ; si tu as beaucoup de RAM, monte-le
     (moins de coupures nettes entre lots).
   - Ne règle pas `PORT` toi-même : le service lit `process.env.PORT` s'il
     est fourni, sinon retombe sur 3000 (voir `Dockerfile`, `EXPOSE 3000`).
     Northflank doit pointer son "port" de service vers 3000 (réglage
     **Ports** du service, pas une variable d'environnement).
5. **Networking → Ports** : ajoute un port public sur 3000, protocole HTTP.
   Northflank génère alors une URL publique (ex.
   `https://<service>--<project>.code.run` ou un nom similaire, visible
   dans l'onglet **Ports**/**Networking** du service). C'est cette URL
   qu'on branche côté site (voir plus bas).

## Alternatives (même dossier, mêmes variables)

- **Render.com** : New + → Web Service → repo `Makambo82/Scriptura`, Root
  Directory `render-service`, Environment `Node`, Build `npm install`, Start
  `npm start`. Le plus simple, mais le tier gratuit (512 Mo) peut manquer de
  mémoire sur un gros montage 1080p, et 2 Go coûte ~25 $/mois.
- **Fly.io** : `fly launch` dans `render-service/` (le `Dockerfile` est
  fourni). Le moins cher au repos (scale-to-zero), mais nécessite la ligne de
  commande.
- **Railway** : facture à l'usage, donne assez de RAM pour les gros montages
  1080p — abandonné ici seulement parce que l'essai gratuit s'épuisait et que
  Railway n'acceptait pas nos cartes prépayées pour passer au plan payant,
  pas pour une raison technique. Repère à connaître si Railway redevient une
  option : **Settings → Build** doit afficher **Dockerfile** (pas Nixpacks),
  sans quoi les sous-titres échouent silencieusement (même mise en garde
  que ci-dessus pour Northflank).

## Brancher le site sur le service

Le navigateur n'appelle JAMAIS ce service directement (l'URL et le jeton ne
doivent jamais vivre dans du code servi au client, ce serait publié en clair
pour n'importe qui). C'est `/api/montage-render` (dans le dépôt principal)
qui proxie vers ce service, côté serveur uniquement.

Sur **Vercel**, projet du site principal → *Settings* → *Environment
Variables*, ajoute :

- `MONTAGE_RENDER_URL` — l'URL de ce service (ex.
  `https://scriptura-render--mon-projet.code.run` sur Northflank, ou
  `https://scriptura-render.onrender.com` sur Render).
- `MONTAGE_RENDER_TOKEN` — **OBLIGATOIRE**, la MÊME valeur que `MONTAGE_TOKEN`
  réglé ci-dessus côté Northflank/Render/Fly/Railway. Sans elle,
  `/api/montage-render` refuse la requête (500, "MONTAGE_RENDER_TOKEN
  absente") plutôt que d'appeler le service de rendu sans authentification.

Puis redéploie (un nouveau push suffit, ou "Redeploy" sur le dernier
déploiement). `MONTAGE_RENDER_URL` et `MONTAGE_RENDER_TOKEN` sont désormais
toutes les deux requises : sans l'une ou l'autre, `/api/montage-render`
refuse la requête (le repli sur un rendu FFmpeg local à Vercel a été
retiré, voir api/montage-render.js).

**Démarrage refusé côté render-service.** Si `MONTAGE_TOKEN` n'est pas
réglée sur l'hébergeur du service de rendu, le processus se termine
immédiatement au lancement (`process.exit(1)`) avec un message explicite
dans les logs - jamais un service qui démarre quand même sans protection.
Railway (ou l'hébergeur choisi) affichera ce déploiement comme en échec :
c'est le comportement voulu, pas un bug. Configure `MONTAGE_TOKEN` puis
relance.

## Test rapide

```bash
curl https://scriptura-render.onrender.com/           # → OK
```

Puis lance un montage depuis le site : la vidéo doit sortir en 1080p, chaque
image calée exactement sur sa portion de voix off, avec des transitions
variées.

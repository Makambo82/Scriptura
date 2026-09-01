# Service de rendu vidéo Scriptura

Rend le montage vidéo final (images + voix off → mp4) avec FFmpeg, **hors
Vercel**, pour échapper aux limites du plan gratuit (300 s / 1 Go) qui
forçaient des compromis sur la qualité et la synchro. Ici : un seul graphe
FFmpeg, durées respectées au millième, fondu croisé varié entre chaque plan,
animations Ken Burns variées, sortie 1080×1920.

## Ce que fait le service

- `GET /` → `OK` (santé, utilisé par l'hébergeur).
- `POST /render` avec `{ "images": [{ "url": "...", "duration": 2.5 }, ...], "audioUrl": "...", "captions": [{ "texte": "...", "debut": 0, "fin": 1.5 }, ...] }`
  → rend la vidéo, la ré-uploade dans Supabase Storage (bucket `montages`,
  dossier `rendus/`), renvoie `{ "url": "https://.../montage-....mp4" }`.
  `captions` est optionnel : sans lui (ou tableau vide), le flux vidéo est
  simplement copié, pas de ré-encodage. Avec lui, les sous-titres sont
  incrustés (police DejaVu Sans, voir Dockerfile) et le mux final ré-encode
  la vidéo (un peu plus lent, nécessaire pour appliquer le filtre).

## Déploiement sur Railway (recommandé)

Railway facture à l'usage (idéal pour un rendu occasionnel) et donne assez de
RAM pour les gros montages 1080p.

**Important pour les sous-titres** : Railway détecte automatiquement s'il
doit utiliser le `Dockerfile` de ce dossier ou construire le service
lui-même (Nixpacks) sans lui. Si un déploiement existant tournait déjà
AVANT l'ajout des sous-titres, vérifie dans **Settings → Build** que la
méthode de build est bien **Dockerfile** (pas Nixpacks) : c'est le
`Dockerfile` qui installe la police nécessaire au rendu des sous-titres
(`fonts-dejavu-core`), absente d'une image Node de base. Sans ça, un
montage AVEC sous-titres échouera au rendu (ou les sous-titres resteront
invisibles selon la version de libass) — un montage sans sous-titres
continue de fonctionner normalement dans les deux cas.

1. Va sur https://railway.app → connecte-toi avec **GitHub**.
2. **New Project** → **Deploy from GitHub repo** → choisis `Makambo82/Scriptura`.
3. Une fois le service créé, ouvre-le → **Settings** :
   - **Root Directory** : `render-service`
   - **Start Command** : `npm start` (souvent détecté automatiquement).
4. **Variables** (onglet *Variables*) :
   - `SUPABASE_URL` — même valeur que sur Vercel.
   - `SUPABASE_ANON_KEY` — même valeur que sur Vercel.
   - `ALLOWED_ORIGIN` — l'URL du site, ex. `https://scriptura-v1.vercel.app`
     (ou `*` pour tout autoriser).
   - `MONTAGE_TOKEN` — **fortement recommandé** : un mot de passe simple
     (ex. généré avec `openssl rand -hex 32`). Sans lui, ce service accepte
     n'importe quelle requête `POST /render` venue de n'importe où, sans
     vérification (le rendu FFmpeg coûte du temps de calcul facturé par
     l'hébergeur). S'il est défini ici, il doit être renseigné avec la
     MÊME valeur côté Vercel (voir plus bas).
   - *(optionnel)* `MONTAGE_WIDTH` / `MONTAGE_HEIGHT` / `MONTAGE_FPS` /
     `MONTAGE_TRANSITION` pour ajuster résolution, cadence et durée de fondu.
   - *(optionnel)* `MONTAGE_BATCH` — nombre de plans rendus ensemble (défaut 3,
     abaissé après un vrai OOM en production sur un montage à 53 plans). Si un
     rendu échoue encore par saturation mémoire (« FFmpeg a été interrompu par
     le système (signal SIGKILL) »), baisse-le encore (2) ou augmente la RAM
     du conteneur côté Railway ; si tu as beaucoup de RAM, monte-le (moins de
     coupures nettes entre lots).
   - Ne touche pas à `PORT` : Railway le fournit automatiquement, le service
     l'utilise déjà.
5. **Settings → Networking → Generate Domain** : Railway crée l'URL publique
   (ex. `https://scriptura-render-production.up.railway.app`). C'est cette URL
   qu'on branche côté site.

## Alternatives (même dossier, mêmes variables)

- **Render.com** : New + → Web Service → repo `Makambo82/Scriptura`, Root
  Directory `render-service`, Environment `Node`, Build `npm install`, Start
  `npm start`. Le plus simple, mais le tier gratuit (512 Mo) peut manquer de
  mémoire sur un gros montage 1080p, et 2 Go coûte ~25 $/mois.
- **Fly.io** : `fly launch` dans `render-service/` (le `Dockerfile` est
  fourni). Le moins cher au repos (scale-to-zero), mais nécessite la ligne de
  commande.

## Brancher le site sur le service

Le navigateur n'appelle JAMAIS ce service directement (l'URL et le jeton ne
doivent jamais vivre dans du code servi au client, ce serait publié en clair
pour n'importe qui). C'est `/api/montage-render` (dans le dépôt principal)
qui proxie vers ce service, côté serveur uniquement.

Sur **Vercel**, projet du site principal → *Settings* → *Environment
Variables*, ajoute :

- `MONTAGE_RENDER_URL` — l'URL de ce service (ex. `https://scriptura-render.onrender.com`).
- `MONTAGE_RENDER_TOKEN` — **la même valeur** que `MONTAGE_TOKEN` réglé ci-dessus.

Puis redéploie (un nouveau push suffit, ou "Redeploy" sur le dernier
déploiement). Tant que `MONTAGE_RENDER_URL` n'est pas réglée sur Vercel, le
site continue d'utiliser le rendu Vercel local (`/api/montage-render`,
FFmpeg auto-hébergé, plus limité) — aucune coupure pendant la migration.

## Test rapide

```bash
curl https://scriptura-render.onrender.com/           # → OK
```

Puis lance un montage depuis le site : la vidéo doit sortir en 1080p, chaque
image calée exactement sur sa portion de voix off, avec des transitions
variées.

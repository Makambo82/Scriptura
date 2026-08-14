# Service de rendu vidéo Scriptura

Rend le montage vidéo final (images + voix off → mp4) avec FFmpeg, **hors
Vercel**, pour échapper aux limites du plan gratuit (300 s / 1 Go) qui
forçaient des compromis sur la qualité et la synchro. Ici : un seul graphe
FFmpeg, durées respectées au millième, fondu croisé varié entre chaque plan,
animations Ken Burns variées, sortie 1080×1920.

## Ce que fait le service

- `GET /` → `OK` (santé, utilisé par l'hébergeur).
- `POST /render` avec `{ "images": [{ "url": "...", "duration": 2.5 }, ...], "audioUrl": "..." }`
  → rend la vidéo, la ré-uploade dans Supabase Storage (bucket `montages`,
  dossier `rendus/`), renvoie `{ "url": "https://.../montage-....mp4" }`.

## Déploiement sur Railway (recommandé)

Railway facture à l'usage (idéal pour un rendu occasionnel) et donne assez de
RAM pour les gros montages 1080p.

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
   - `MONTAGE_TOKEN` — *(optionnel)* un mot de passe simple ; s'il est défini,
     il doit être renseigné aussi côté site (voir plus bas).
   - *(optionnel)* `MONTAGE_WIDTH` / `MONTAGE_HEIGHT` / `MONTAGE_FPS` /
     `MONTAGE_TRANSITION` pour ajuster résolution, cadence et durée de fondu.
   - *(optionnel)* `MONTAGE_BATCH` — nombre de plans rendus ensemble (défaut 6).
     Si un rendu échoue par saturation mémoire (« FFmpeg killed / code null »)
     sur un conteneur limité, baisse-le (4, voire 3) ; si tu as beaucoup de RAM,
     monte-le (moins de coupures nettes entre lots).
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

Dans `js/montage.js`, renseigne la constante en haut du fichier :

```js
const MONTAGE_RENDER_URL = 'https://scriptura-render.onrender.com'; // ton URL Render
```

Si `MONTAGE_TOKEN` est défini côté service, renseigne le même :

```js
const MONTAGE_RENDER_TOKEN = 'le-meme-jeton';
```

Tant que `MONTAGE_RENDER_URL` est vide, le site continue d'utiliser l'ancien
rendu Vercel (`/api/montage-render`) — aucune coupure pendant la migration.

## Test rapide

```bash
curl https://scriptura-render.onrender.com/           # → OK
```

Puis lance un montage depuis le site : la vidéo doit sortir en 1080p, chaque
image calée exactement sur sa portion de voix off, avec des transitions
variées.

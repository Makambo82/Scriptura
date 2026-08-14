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

## Déploiement sur Render.com (recommandé)

1. Va sur https://render.com → **New +** → **Web Service**.
2. Connecte le dépôt GitHub `Makambo82/Scriptura`.
3. Réglages :
   - **Root Directory** : `render-service`
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : au moins **Starter** (512 Mo). Le tier gratuit peut
     suffire pour de petits montages mais s'endort après 15 min d'inactivité
     (premier rendu lent, ~1 min de réveil).
4. **Environment Variables** (onglet *Environment*) :
   - `SUPABASE_URL` — même valeur que sur Vercel.
   - `SUPABASE_ANON_KEY` — même valeur que sur Vercel.
   - `ALLOWED_ORIGIN` — l'URL du site, ex. `https://scriptura-v1.vercel.app`
     (ou `*` pour tout autoriser).
   - `MONTAGE_TOKEN` — *(optionnel)* un mot de passe simple ; s'il est défini,
     il doit être renseigné aussi côté site (voir plus bas).
   - *(optionnel)* `MONTAGE_WIDTH` / `MONTAGE_HEIGHT` / `MONTAGE_FPS` /
     `MONTAGE_TRANSITION` pour ajuster résolution, cadence et durée de fondu.
5. **Create Web Service**. Render construit et déploie. Note l'URL publique
   (ex. `https://scriptura-render.onrender.com`).

> Portable : le même dossier se déploie sur **Railway** (New Project → Deploy
> from repo → root `render-service`) ou **Fly.io** (`fly launch` dans le
> dossier, le `Dockerfile` est fourni). Mêmes variables d'environnement.

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

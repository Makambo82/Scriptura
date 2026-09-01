# Image portable pour Render / Railway / Fly.io (ou tout hôte Docker).
# Sur Render en mode "Node" natif, ce Dockerfile est optionnel : l'hôte lance
# directement `npm install && npm start`. On le fournit pour les hôtes qui
# préfèrent un conteneur.
FROM node:20-slim

WORKDIR /app

# Police + fontconfig, pour les sous-titres incrustés (filtre "subtitles",
# libass) : node:20-slim n'embarque AUCUNE police par défaut, un rendu de
# sous-titres sans ça échoue (ou ffmpeg plante carrément, selon la version
# de libass) plutôt que de simplement les sauter. DejaVu Sans est le choix
# le plus sûr : dans les dépôts Debian de base (jamais un téléchargement
# externe à faire confiance), lisible, accents français correctement gérés.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Dépendances d'abord (cache Docker)
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]

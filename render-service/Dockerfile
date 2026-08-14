# Image portable pour Render / Railway / Fly.io (ou tout hôte Docker).
# Sur Render en mode "Node" natif, ce Dockerfile est optionnel : l'hôte lance
# directement `npm install && npm start`. On le fournit pour les hôtes qui
# préfèrent un conteneur.
FROM node:20-slim

WORKDIR /app

# Dépendances d'abord (cache Docker)
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]

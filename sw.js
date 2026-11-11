// sw.js
// ─────────────────────────────────────────────────────────
// VERSION : à bumper à chaque déploiement, exactement comme
// ?v=... dans index.html. Sans ça, le navigateur ne voit aucune
// différence dans ce fichier et garde l'ancienne version en cache.
// Commande : sed -i "s|^// VERSION=.*|// VERSION=$(date +%Y%m%d)-1|" sw.js
// ─────────────────────────────────────────────────────────
// VERSION=20261111-1

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

if (workbox) {
  workbox.setConfig({ debug: false });
  // Ne PAS appeler skipWaiting() ni clientsClaim() ici : on veut une
  // mise à jour PROPOSÉE, pas imposée (voir js/pwa.js, le bouton
  // "Recharger"). C'est le message SKIP_WAITING qui déclenche l'activation.

  // ── Réception du message d'activation immédiate ────────
  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  const { registerRoute } = workbox.routing;
  const { NetworkFirst, NetworkOnly, StaleWhileRevalidate, CacheFirst } = workbox.strategies;
  const { ExpirationPlugin } = workbox.expiration;
  const { CacheableResponsePlugin } = workbox.cacheableResponse;

  // 1. API Scriptura : JAMAIS de cache. Ni POST de génération, ni GET
  //    de quota, ni analyse. Le mode hors ligne ne doit jamais
  //    contourner les quotas ni servir du contenu périmé.
  registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkOnly()
  );

  // 2. Supabase : jamais de cache non plus (session périmée = bug).
  registerRoute(
    ({ url }) => url.hostname.endsWith('.supabase.co'),
    new NetworkOnly()
  );

  // 3. Navigation (index.html, toutes les routes SPA via /idees, /audit,
  //    etc. définies dans js/app.js, ROUTES_PAGES) : NetworkFirst avec
  //    timeout. En ligne : toujours la dernière version (ton anti-cache
  //    Vercel est respecté). Hors ligne : dernière version connue.
  registerRoute(
    ({ request }) => request.mode === 'navigate',
    new NetworkFirst({
      cacheName: 'pages',
      networkTimeoutSeconds: 3,
    })
  );

  // 4. JS, CSS, polices : StaleWhileRevalidate. Grâce à ton ?v=...,
  //    une nouvelle version = nouvelle URL = pas dans le cache = réseau.
  //    L'ancienne version reste cachée mais n'est plus demandée.
  registerRoute(
    ({ request }) => ['script', 'style', 'font'].includes(request.destination),
    new StaleWhileRevalidate({
      cacheName: 'static-resources',
      plugins: [
        new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      ],
    })
  );

  // 5. Images (preuves TikTok, posters de démo, OG image) : CacheFirst.
  registerRoute(
    ({ request }) => request.destination === 'image',
    new CacheFirst({
      cacheName: 'images',
      plugins: [
        new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 24 * 60 * 60 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    })
  );

  // 6. CDN externes (jsPDF, Supabase JS, Google Fonts) : SWR.
  registerRoute(
    ({ url }) =>
      url.origin === 'https://cdn.jsdelivr.net' ||
      url.origin === 'https://fonts.googleapis.com' ||
      url.origin === 'https://fonts.gstatic.com',
    new StaleWhileRevalidate({ cacheName: 'cdn' })
  );

  // 7. Page de debug : on l'exclut explicitement. C'est du noindex,
  //    aucun intérêt à la mettre en cache, et ça évite qu'un vieux
  //    debug-tendances.html ne réapparaisse après un nettoyage.
  registerRoute(
    ({ url }) => url.pathname === '/debug-tendances.html',
    new NetworkOnly()
  );
}

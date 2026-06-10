const CACHE_NAME = "carsharing-map-v5"; // bumped: URiDE +5 stations, auto-update scripts added 2026-06-10
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.json",
  "./lib/leaflet.css",
  "./lib/leaflet.js",
  "./lib/leaflet.markercluster.js",
  "./lib/MarkerCluster.css",
  "./lib/MarkerCluster.Default.css",
  "./data/uride_stations.json",
  "./data/gosmart_stations.json",
  "./data/irent_stations.json",
  "./data/zones.json",
  "./data/metro_lines.json",
  "./data/metro_stations.json",
  "./icon-192.png",
  "./icon-512.png"
];

// On install, cache all static assets
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[Service Worker] Pre-caching static assets");
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// On activate, clean up old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event handler
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // For Leaflet tiles (from cartocdn.com), use Cache-First to save mobile data
  if (url.hostname.includes("basemaps.cartocdn.com")) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => new Response("", { status: 404 }));
      })
    );
    return;
  }

  // Standard Stale-While-Revalidate for other assets
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
        console.log("[Service Worker] Fetch failed, returning cache if available:", err);
      });

      return cachedResponse || fetchPromise;
    })
  );
});

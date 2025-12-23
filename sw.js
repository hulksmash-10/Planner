const CACHE = "planner-flat-v3.7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=37",
  "./manifest.webmanifest",
  "./app.js",
  "./sw.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        try {
          if (event.request.method === "GET" && res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
        } catch (_) {}
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});





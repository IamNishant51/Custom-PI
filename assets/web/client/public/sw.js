const CACHE = "custom-pi-v2";
const ASSETS = ["/", "/index.html", "/assets/index.css", "/assets/index.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener("fetch", (e) => {
  // Network-first for API, stale-while-revalidate for assets
  if (e.request.url.includes("/api/")) {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(staleWhileRevalidate(e.request));
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (req.method === "GET" || req.method === "HEAD") {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return caches.match(req);
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  fetch(req).then((res) => {
    if (req.method === "GET" || req.method === "HEAD") {
      cache.put(req, res);
    }
  });
  return cached || fetch(req);
}

// Minimal service worker — mostly here so the browser considers the site
// "installable." Caches the app shell so a repeat visit works offline too.
//
// Network-first, falling back to cache only when the network fails — NOT
// cache-first. A cache-first strategy (the previous version of this file)
// means every visit silently serves whatever was cached on a *prior*
// visit, and only refreshes the cache quietly in the background for next
// time — so a real code change can deploy successfully and a hard refresh
// still won't show it, because the service worker hands back the old
// version before the browser ever asks the network. Network-first fixes
// that: online visitors always get the current deploy, and the cache is
// purely an offline fallback.

const CACHE = "csb-shell-v2"; // bumped so every existing browser drops the old (cache-first) cache
const SHELL = ["/", "/styles.css", "/app.js", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never cache API calls — always go to the network for live data.
  if (request.url.includes("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

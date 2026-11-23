// Offline support: the app shell is served from cache (refreshed in the background);
// reading libraries from the CDN are cached the first time they are used.
const SHELL = "recipebox-shell-v1";
const LIBS = "recipebox-libs-v1";
const FILES = ["./", "index.html", "style.css", "parser.js", "store.js", "app.js", "manifest.webmanifest",
  "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, LIBS].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname.endsWith("googleapis.com")) return; // Gemini: always live
  if (url.origin === location.origin) {
    if (url.pathname.endsWith("family.enc.json")) return; // always fetch the newest family collection
    // Stale-while-revalidate: instant from cache, updated for next time.
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|tessdata|unpkg\.com/.test(url.hostname + url.pathname)) {
    e.respondWith(caches.open(LIBS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  }
});

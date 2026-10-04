/* 最小 service worker:只缓存带哈希的静态资源(/assets/*)。
   API、音频与 index.html 一律走网络;不做离线学习(设计文档 5.4)。 */
const CACHE = "enjoy-web-assets-v1";
const MAX_ENTRIES = 80;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/assets/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      // 缺失的资源可能被 SPA 回退成 200 的 index.html:不缓存 HTML
      const type = response.headers.get("content-type") || "";
      if (response.ok && !type.includes("text/html")) {
        await cache.put(request, response.clone());
        event.waitUntil(trim(cache).catch(() => undefined));
      }
      return response;
    }),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
}

/**
 * Service worker — mantém o aplicativo disponível offline (chão de fábrica sem sinal).
 * Estratégia: cache primeiro, com atualização em segundo plano.
 * Ao alterar qualquer arquivo do aplicativo, incremente CACHE_VERSION.
 * REV 1.15: os arquivos são baixados direto do servidor (sem o cache HTTP do navegador), para a
 * página e os scripts chegarem sempre na mesma versão.
 */
const CACHE_VERSION = "lean-chrono-v31";
const APP_SHELL = [
  "./",
  "./index.html",
  "./mfv.html",
  "./yamazumi.html",
  "./plano.html",
  "./style.css",
  "./icon.svg",
  "./manifest.webmanifest",
  "./js/calc.js",
  "./js/xlsx.js",
  "./js/xlsx-template.js",
  "./js/mfv-calc.js",
  "./js/mfv-app.js",
  "./js/yamazumi-calc.js",
  "./js/yamazumi-app.js",
  "./js/plano-calc.js",
  "./js/plano-app.js",
  "./js/storage.js",
  "./js/ui.js",
  "./js/app.js",
  "./js/ai.js",
  "./js/ai-ui.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

const CACHE_NAME = "paper-library-shell-v14";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./styles/app.css?v=14",
  "./src/app.js?v=14",
  "./src/catalogue.js?v=10",
  "./src/external-sources.js?v=10",
  "./src/foliate-reader.js?v=14",
  "./src/importer.js?v=14",
  "./src/reader.js?v=10",
  "./src/storage.js",
  "./src/utils.js",
  "./vendor/foliate-js/view.js?v=14",
  "./vendor/foliate-js/mobi.js",
  "./vendor/foliate-js/pdf.js",
  "./vendor/foliate-js/epubcfi.js",
  "./vendor/foliate-js/progress.js",
  "./vendor/foliate-js/overlayer.js",
  "./vendor/foliate-js/text-walker.js",
  "./vendor/foliate-js/paginator.js",
  "./vendor/foliate-js/fixed-layout.js",
  "./vendor/foliate-js/search.js",
  "./vendor/foliate-js/vendor/fflate.js",
  "./vendor/foliate-js/vendor/pdfjs/pdf.mjs",
  "./vendor/foliate-js/vendor/pdfjs/pdf.worker.mjs",
  "./vendor/foliate-js/vendor/pdfjs/text_layer_builder.css",
  "./vendor/foliate-js/vendor/pdfjs/annotation_layer_builder.css",
  "./vendor/jszip.min.js",
  "./vendor/epub.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("paper-library-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          return (await caches.match(request))
            || caches.match(new URL("./index.html", self.registration.scope).href);
        })
    );
    return;
  }

  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

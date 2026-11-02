/* Appavet service worker — offline app shell.
   Same-origin files: fetched from the network when online (cached copy as fallback),
   so updates pushed to GitHub show up on the next load and everything works offline.
   Bump CACHE when the list of shell files changes. */
'use strict';

var CACHE = 'rumi-shell-v5';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './jalali.js',
  './security.js',
  './sync.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './icon.svg',
  './fonts/Barbra-High.ttf',
  './fonts/inter-latin-400-normal.woff2',
  './fonts/inter-latin-500-normal.woff2',
  './fonts/inter-latin-600-normal.woff2',
  './fonts/inter-latin-700-normal.woff2',
  './fonts/vazirmatn-arabic-400-normal.woff2',
  './fonts/vazirmatn-arabic-500-normal.woff2',
  './fonts/vazirmatn-arabic-700-normal.woff2',
  './fonts/vazirmatn-latin-400-normal.woff2',
  './fonts/vazirmatn-latin-500-normal.woff2',
  './fonts/vazirmatn-latin-700-normal.woff2',
  './fonts/fonts.css'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's HTTP cache, so a new version never stores old files
      .then(function (c) { return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isFont = /^fonts\.(googleapis|gstatic)\.com$/.test(url.host);
  // Never touch other requests (the GitHub API in particular must always hit the network).
  if (!sameOrigin && !isFont) return;

  // Network first (so a new version shows up right away when online), cache as fallback
  // (offline, or the network takes longer than 3 s).
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      // 'no-cache' = always ask the server whether the file changed (cheap 304 if not),
      // instead of trusting the browser's 10-minute HTTP cache from GitHub Pages.
      var netReq = !sameOrigin ? req
        : req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) // page loads can't be copied with options
        : new Request(req, { cache: 'no-cache' });
      var network = fetch(netReq).then(function (res) {
        if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
      var fallback = function () {
        return cache.match(req, { ignoreSearch: sameOrigin }).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return cache.match('./index.html');
          return network; // nothing cached: keep waiting for the network
        });
      };
      var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); }).then(fallback);
      return Promise.race([network.catch(fallback), timeout]);
    })
  );
});

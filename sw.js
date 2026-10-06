'use strict';
/* Service worker: la app se instala y abre sin conexión.
   - Archivos de la app: primero la red (así siempre ves la última versión) y, si no hay
     conexión, la copia guardada.
   - Fuentes y librerías de CDN: primero la copia guardada (no cambian).
   - GitHub y las API de IA nunca pasan por aquí: van siempre a la red.
   Si agregas un archivo .js a index.html, agrégalo también a SHELL. */

const CACHE = 'realize-v4';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/wordlist.js',
  'js/phrases.js',
  'js/core.js',
  'js/srs.js',
  'js/samples.js',
  'js/store.js',
  'js/learning.js',
  'js/ai.js',
  'js/audio.js',
  'js/ui/base.js',
  'js/ui/home.js',
  'js/ui/progress.js',
  'js/ui/words.js',
  'js/ui/settings.js',
  'js/ui/session.js',
  'js/ui/router.js',
  'js/ui/actions.js',
  'js/ui/events.js',
  'js/ui/groups.js',
  'js/ui/select.js',
  'js/importance.js',
  'js/reading.js',
  'js/sync.js',
  'js/history.js',
  'js/ui/welcome.js'
];
const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (CDN.includes(url.hostname)) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

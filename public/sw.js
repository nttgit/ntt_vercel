const CACHE_NAME = 'gdhaha-pwa-v22';
const RUNTIME_CACHE = CACHE_NAME + '-runtime'; // ảnh Blob tải về khi xem (để xem offline sau đó)
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/event.html',
  '/style.css',
  '/app.js',
  '/vendor/vercel-blob-client.js',
  '/assets/logo_giadinhhaha.jpg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Pacifico&display=swap'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Opened cache');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Giữ lại cache hiện hành + runtime hiện hành; xoá các bản cũ.
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('Clearing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', event => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Ảnh trên Vercel Blob: cache-first ở runtime → lần đầu tải mạng, sau đó xem được offline.
  if (url.hostname.endsWith('.blob.vercel-storage.com')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        cache.match(req).then(hit => {
          if (hit) return hit;
          return fetch(req).then(resp => {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          }).catch(() => hit); // offline & chưa cache → đành chịu
        })
      )
    );
    return;
  }

  // Mặc định: cache-first cho app shell, fallback offline cho điều hướng.
  event.respondWith(
    caches.match(req).then(response => {
      // Return cached version or fetch from network
      return response || fetch(req).catch(() => {
        // Fallback for offline if fetching fails (e.g. return dashboard.html for navigation)
        if (req.mode === 'navigate') {
          return caches.match('/dashboard.html');
        }
      });
    })
  );
});

/* Swanada Cross-Origin Isolation Service Worker */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Bypass large ONNX model streams, cross-origin CDN requests, and non-HTTP protocols
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.origin !== self.location.origin ||
    url.pathname.endsWith('.onnx')
  ) {
    return;
  }

  const fetchPromise =
    req.mode === 'navigate' ? fetch(req, { cache: 'no-cache' }) : fetch(req);

  event.respondWith(
    fetchPromise
      .then((res) => {
        if (!res || res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      })
      .catch(() => fetch(req))
  );
});

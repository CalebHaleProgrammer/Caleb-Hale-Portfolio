/*
 * coi-serviceworker.js
 *
 * Makes a static page cross-origin isolated (adds Cross-Origin-Opener-Policy
 * and Cross-Origin-Embedder-Policy to same-origin responses) without needing
 * control over server response headers — e.g. on GitHub Pages. This unlocks
 * SharedArrayBuffer, which @ffmpeg/ffmpeg (0.12+) requires in the browser.
 *
 * This one file plays two roles:
 *   1. Loaded normally by the page via <script src="coi-serviceworker.js">,
 *      it registers itself as a service worker.
 *   2. Loaded BY THE BROWSER as that service worker, it intercepts fetches
 *      and adds the required headers to the responses.
 * (`document` only exists in role 1, so that's how the two branches split.)
 *
 * Requirements (per the standard technique this implements):
 *   - Must be its own file, served from the same origin as the page —
 *     it cannot be inlined, bundled, or loaded from a CDN.
 *   - The page must be served over HTTPS (or localhost).
 *   - Put it next to the page (or in a folder above it) and add:
 *       <script src="coi-serviceworker.js"></script>
 *
 * On first load it will register the worker and reload the page once so
 * the new headers take effect — that single reload is expected.
 *
 * Customize via a global `window.coi` object before this script runs:
 *   window.coi = { shouldRegister: () => true, shouldDeregister: () => false }
 */
(function () {
  const inServiceWorker = typeof document === 'undefined';

  if (inServiceWorker) {
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('message', (event) => {
      if (event.data === 'deregister') {
        self.registration.unregister().then(() => self.clients.matchAll())
          .then((clients) => clients.forEach((client) => client.navigate(client.url)));
      }
    });

    self.addEventListener('fetch', (event) => {
      const request = event.request;
      if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

      event.respondWith(
        fetch(request).then((response) => {
          if (response.status === 0) return response; // opaque cross-origin response, leave as-is
          const headers = new Headers(response.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
          });
        }).catch((err) => console.error('[coi-serviceworker] fetch failed:', err))
      );
    });

    return; // nothing else to do inside the worker
  }

  // ---- page context ----
  const coi = window.coi || {};

  if (window.crossOriginIsolated) return; // already isolated, nothing to do
  if (!window.isSecureContext) {
    console.warn('[coi-serviceworker] page is not HTTPS/localhost — cross-origin isolation is unavailable.');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    console.warn('[coi-serviceworker] this browser does not support service workers.');
    return;
  }

  const reloadedBySelf = sessionStorage.getItem('coiReloadedBySelf');
  sessionStorage.removeItem('coiReloadedBySelf');
  const shouldRegister = coi.shouldRegister ? coi.shouldRegister() : !reloadedBySelf;
  const shouldDeregister = coi.shouldDeregister ? coi.shouldDeregister() : false;
  const doReload = coi.doReload || function () {
    sessionStorage.setItem('coiReloadedBySelf', 'true');
    window.location.reload();
  };

  navigator.serviceWorker.getRegistration(window.location.href).then((registration) => {
    if (shouldDeregister && registration) {
      registration.unregister().then(() => window.location.reload());
      return;
    }
    if (registration && registration.active && !reloadedBySelf) {
      // already registered from a previous visit but this load isn't isolated yet — let the browser catch up
      return;
    }
    if (!shouldRegister) return;
    navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
      console.log('[coi-serviceworker] registered, reloading to activate cross-origin isolation…');
      reg.addEventListener('updatefound', doReload);
      if (reg.active) doReload();
    }).catch((err) => console.error('[coi-serviceworker] registration failed:', err));
  });
})();

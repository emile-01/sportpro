const CACHE = 'menya-v8';
const BASE = new URL('./', self.registration.scope).href;
const SHELL = [BASE, BASE + 'manifest.json', BASE + 'menya-192.png', BASE + 'menya-512.png', BASE + 'menya-badge.png', BASE + 'logo-mark.png', BASE + 'logo-mark-preview.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* network first, but if the network is slow (bad Wi-Fi), serve the saved copy after 4 seconds */
const NET_MS = 4000;
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range') || new URL(r.url).origin !== location.origin) return;
  e.respondWith(new Promise(resolve => {
    let done = false;
    const saved = () => caches.match(r).then(hit => hit || (r.mode === 'navigate' ? caches.match(BASE) : null));
    const timer = setTimeout(() => saved().then(hit => { if (hit && !done) { done = true; resolve(hit); } }), NET_MS);
    fetch(r, { cache: 'no-cache' }).then(res => {
      clearTimeout(timer);
      if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); }
      if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      saved().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } });
    });
  }));
});

/* ===== PUSH: show a notification when the server sends one (works with the app closed) =====
   Understands 3 payload shapes:
   1) Firebase data message   { data:{ title, body, url, tag } }
   2) Firebase notification   { notification:{ title, body }, fcmOptions:{ link } }
   3) Plain Web Push          { title, body, url, tag }                                          */
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; }
  catch (x) { try { p = { body: e.data.text() }; } catch (y) {} }
  const d = Object.assign({}, p, p.notification || {}, p.data || {});
  const title = d.title || 'Menya';
  const body = d.body || 'Open Menya to see what is new.';
  const url = d.url || (p.fcmOptions && p.fcmOptions.link) || './';
  const tag = d.tag || 'menya';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .catch(() => [])
      .then(list => {
        /* app is open and on screen: the in-app bell already shows it, so stay quiet */
        if (list.some(c => c.visibilityState === 'visible')) return;
        return self.registration.showNotification(title, {
          body,
          icon: BASE + 'menya-192.png',
          badge: BASE + 'menya-badge.png',
          tag,
          renotify: true,
          vibrate: [120, 60, 120],
          data: { url }
        });
      })
  );
});

/* ===== notification tap: open the channel or room it came from ===== */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const u = (e.notification.data && e.notification.data.url) || './';
  const url = new URL(u, BASE).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus().then(w => (w && 'navigate' in w ? w.navigate(url) : null));
      }
      return self.clients.openWindow(url);
    })
  );
});

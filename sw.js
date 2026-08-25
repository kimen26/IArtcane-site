// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — service worker (D-013)
// 1) Shell offline minimal : l'app s'ouvre sans réseau (cache-first statique,
//    fallback navigation → index.html pré-caché). Les uploads partiront au
//    retour du réseau (hors scope : on assure juste l'ouverture + capture).
// 2) Web Share Target : « Partager avec » une photo Android → la PWA installée
//    reçoit le POST multipart, stocke les images dans le cache 'share-inbox'
//    et redirige vers la vue Capturer (app.js les y récupère en File).
// VERSION : garder en sync avec le cache-buster ?v= de index.html.
// ═══════════════════════════════════════════════════════════════════════════
const VERSION = 'iartcane-2026-08-25e'; // sync : ?v=2026-08-25e dans index.html
const SHELL_CACHE = `shell-${VERSION}`;
const SHARE_CACHE = 'share-inbox'; // hors purge : survit aux changements de VERSION
const V = '?v=2026-08-25e'; // query des assets versionnés (sync index.html)
const SHELL = [
  './', './index.html',
  // CSS modulaire (D-039) : tokens → base → components → vues
  './styles/tokens.css' + V, './styles/base.css' + V, './styles/components.css' + V,
  './styles/views/collection.css' + V, './styles/views/objet.css' + V,
  './styles/views/capture.css' + V, './styles/views/artistes.css' + V,
  './styles/views/activite.css' + V, './styles/views/sources.css' + V,
  './styles/views/categories.css' + V, './styles/views/maison.css' + V,
  './app.js' + V, './config.js' + V,
  // JS core (D-039) — importés sans query par app.js : pré-cachés nus.
  // Les js/views/*.js restent en cache runtime (limite offline connue : une vue
  // jamais visitée ne s'ouvre pas hors ligne).
  './js/core/state.js', './js/core/dom.js', './js/core/format.js', './js/core/data.js',
  './manifest.webmanifest',
  './assets/logo.png', './assets/logo-glyph.png', './assets/mark-cygne.svg',
  './assets/favicon.png', './assets/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k !== SHELL_CACHE && k !== SHARE_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // JAMAIS de cache sur l'API / le storage Supabase : URLs signées qui expirent
  // en 3600 s et données vivantes — réseau direct, sans interception.
  if (url.hostname.endsWith('supabase.co')) return;

  // Web Share Target : POST multipart depuis « Partager avec » (PWA installée).
  if (e.request.method === 'POST') {
    if (url.pathname === new URL('./share-target', self.registration.scope).pathname) {
      e.respondWith(handleShareTarget(e.request));
    }
    return;
  }
  if (e.request.method !== 'GET') return;

  // Cache-first : réponse en cache (shell + CDN statique déjà vu) sinon réseau
  // avec mise en cache des réponses OK ; hors ligne, la navigation retombe sur
  // le shell pré-caché.
  e.respondWith(
    caches.match(e.request).then(hit => hit ?? fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});

// Chaque image du partage est rangée sous une clé synthétique (nom et type MIME
// en headers x-name/x-type — app.js reconstruit des File), puis redirection
// 303 vers la vue Capturer avec le flag partage=1 (en query : les fragments ne
// traversent pas toujours les redirections).
async function handleShareTarget(request) {
  const form = await request.formData();
  const files = form.getAll('photos').filter(f => f && f.size && /^image\//.test(f.type));
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all(files.map((f, i) => cache.put(
    new Request(new URL(`./__share__/${i}`, self.registration.scope)),
    new Response(f, {
      headers: { 'x-name': f.name || `partage-${i}.jpg`, 'x-type': f.type || 'image/jpeg' },
    })
  )));
  return Response.redirect('./?partage=1#/capture', 303);
}

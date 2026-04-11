// ═══════════════════════════════════════════════════════════════
//  카드 트래커 — Service Worker
//  전략: Cache-First (앱 셸) + Network-First (동기화 API)
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME    = 'card-tracker-v1';
const FONT_CACHE    = 'card-fonts-v1';
const RUNTIME_CACHE = 'card-runtime-v1';

// 앱 셸: 설치 시 반드시 캐시할 핵심 파일
const APP_SHELL = [
  '/card-tracker/',
  '/card-tracker/index.html',
  '/card-tracker/manifest.json'
];

// 외부 도메인 분류
const SYNC_DOMAINS = ['api.jsonbin.io', 'api.anthropic.com'];
const FONT_DOMAINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── 설치 ────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install failed:', err))
  );
});

// ── 활성화: 이전 캐시 정리 ─────────────────────────────────────
self.addEventListener('activate', event => {
  const VALID = [CACHE_NAME, FONT_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !VALID.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch 전략 ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // GET 이외 패스 (JSONBin PUT/POST 등)
  if (event.request.method !== 'GET') return;

  // 동기화 API → Network-Only (오프라인 시 그냥 실패)
  if (SYNC_DOMAINS.some(d => url.hostname.includes(d))) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // 구글 폰트 → Cache-First
  if (FONT_DOMAINS.some(d => url.hostname.includes(d))) {
    event.respondWith(cacheFirst(event.request, FONT_CACHE));
    return;
  }

  // 앱 셸 → Stale-While-Revalidate
  if (url.pathname.startsWith('/card-tracker')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 그 외 → Network-First
  event.respondWith(networkFirst(event.request));
});

// ── 전략 함수 ───────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName || CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('오프라인', { status: 503 });
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch {
    return await cache.match(request) || new Response('Offline', { status: 503 });
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── 메시지 처리 ─────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'SYNC_NOW') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage('DO_SYNC'));
    });
  }
});

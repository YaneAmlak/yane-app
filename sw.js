/* ============================================================
   سرویس‌ورکر — کش اپ برای کار بدون اینترنت

   دو راهبرد جدا:
   - فایل‌های خودِ کد اپ (APP_ASSETS): Network-First — همیشه اول
     تلاش می‌کنه از اینترنت بگیره تا آخرین نسخه باشه؛ فقط اگه
     اینترنت نبود از کش می‌خونه. برای همین دیگه لازم نیست هر دیپلوی
     شماره CACHE_NAME رو دستی بالا ببریم.
   - کتابخانه‌های حجیم/کم‌تغییر (VENDOR_ASSETS): Cache-First مثل قبل
     — چون به‌ندرت عوض می‌شن، سریع‌تره و برای حالت آفلاین مطمئن‌تره.
   ============================================================ */
const CACHE_NAME = 'anbar-app-v185';

const APP_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/utils.js',
  './js/jdate.js',
  './js/config.js',
  './js/backend.js',
  './js/db.js',
  './js/search.js',
  './js/smart-names.js',
  './js/orders.js',
  './js/archive.js',
  './js/aliases.js',
  './js/alias-seed.js',
  './js/packsize.js',
  './js/packsize-seed.js',
  './js/migrate-legacy-data.js',
  './js/customproducts.js',
  './js/clients-core.js',
  './js/clients.js',
  './js/listings-core.js',
  './js/listings.js',
  './js/collab.js',
  './js/adbuilder-core.js',
  './js/adbuilder.js',
  './js/subscription-core.js',
  './js/subscription.js',
  './js/help-core.js',
  './js/help.js',
  './js/today-core.js',
  './js/today.js',
  './js/converter-core.js',
  './js/converter.js',
  './js/voice.js',
  './js/daily-plan-core.js',
  './js/quicknote-core.js',
  './js/quicknote.js',
  './js/daily-plan.js',
  './js/support-core.js',
  './js/support.js',
  './js/deals-core.js',
  './js/deals.js',
  './js/cards-core.js',
  './js/cards.js',
  './js/card-alert.js',
  './js/pay-alert.js',
  './js/push.js',
  './js/local-reminders.js',
  './js/app-update.js',
  './js/app.js',
  './js/parse-worker.js',
  './js/parsers/parser-core.js',
  './js/parsers/csv.js',
  './js/parsers/excel.js',
  './js/parsers/pdf.js',
  './js/parsers/index.js'
];

const VENDOR_ASSETS = [
  './vendor/supabase.min.js',
  './vendor/fonts/Vazirmatn-Regular.woff2',
  './vendor/fonts/Vazirmatn-Medium.woff2',
  './vendor/fonts/Vazirmatn-Bold.woff2',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

const ASSETS = APP_ASSETS.concat(VENDOR_ASSETS);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // cache:'reload' → هنگام نصب، کش HTTP مرورگر/هاست دور زده می‌شود تا نسخه‌ی جدید کتابخانه‌ها
      // (نه نسخه‌ی قدیمیِ باقی‌مانده در کش HTTP) داخل کش جدید قرار بگیرد
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppAsset(pathname) {
  if (pathname.endsWith('/') || pathname.endsWith('/index.html')) return true;
  return /\.(js|css|html|webmanifest)$/.test(pathname) && !pathname.includes('/vendor/');
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // درخواست‌های خارجی (در صورت وجود) را نادیده بگیر

  if (isAppAsset(url.pathname)) {
    // Network-First: اول اینترنت، فقط اگه نشد از کش
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((hit) => {
            if (hit) return hit;
            if (e.request.mode === 'navigate') return caches.match('./index.html');
            return new Response('', { status: 408 });
          })
        )
    );
    return;
  }

  // Cache-First برای کتابخانه‌ها/فونت‌ها/آیکون‌ها (بدون تغییر نسبت به قبل)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => new Response('', { status: 408 }));
    })
  );
});

/* ============================================================
   اعلان روی گوشی (Web Push): نمایش اعلان و باز کردن صفحه‌ی «بازدیدها» با لمس آن
   ============================================================ */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'یانه', {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/favicon.png',
    tag: d.tag || 'yane',
    renotify: true,
    dir: 'rtl',
    lang: 'fa',
    data: { url: d.url || '#card-views' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = String((e.notification.data && e.notification.data.url) || '#card-views');
  const screen = hash.replace(/^#/, '');
  const target = new URL('./' + hash, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    if (open) {
      return open.focus().then(() => { try { open.postMessage({ type: 'open-screen', screen }); } catch (x) { /* بی‌اثر */ } });
    }
    return self.clients.openWindow(target);
  }));
});

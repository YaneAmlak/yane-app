'use strict';
/* ============================================================
   پیام «نسخهٔ جدید آماده است» — فقط داخل اپ اندروید (APK)
   • شمارهٔ نسخهٔ همین APK: APP_BUILD (هر APK جدید یکی بالا ببر)
   • آخرین نسخه از جدول app_update در Supabase خوانده می‌شود
   • اگر آخرین نسخه بزرگ‌تر بود، کارت دانلود نشان داده می‌شود
   ============================================================ */
const AppUpdate = (() => {
  const APP_BUILD = 12;

  const isNative = () => {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  };

  function show(info) {
    if (document.getElementById('app-update-card')) return;
    const force = !!info.force;
    const box = document.createElement('div');
    box.id = 'app-update-card';
    box.setAttribute('dir', 'rtl');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:16px;z-index:99999;background:#0f766e;color:#fff;'
      + 'border-radius:14px;padding:14px;box-shadow:0 6px 24px rgba(0,0,0,.35);font-family:inherit;line-height:1.7';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;margin-bottom:4px';
    title.textContent = force ? 'برای ادامه باید اپ را به‌روز کنی' : 'نسخهٔ جدید Yane آماده است';
    box.appendChild(title);
    if (info.note) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:13px;opacity:.95;margin-bottom:8px;white-space:pre-line';
      note.textContent = info.note;
      box.appendChild(note);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:6px';
    const dl = document.createElement('button');
    dl.textContent = 'دانلود و نصب';
    dl.style.cssText = 'flex:1;border:0;border-radius:10px;padding:10px;font:inherit;font-weight:700;background:#fff;color:#0f766e';
    dl.onclick = () => { try { window.open(info.download_url, '_system'); } catch (e) { location.href = info.download_url; } };
    row.appendChild(dl);
    if (!force) {
      const later = document.createElement('button');
      later.textContent = 'بعداً';
      later.style.cssText = 'border:1px solid rgba(255,255,255,.7);border-radius:10px;padding:10px 16px;font:inherit;background:transparent;color:#fff';
      later.onclick = () => box.remove();
      row.appendChild(later);
    }
    box.appendChild(row);
    document.body.appendChild(box);
  }

  async function check() {
    try {
      if (!isNative()) return;
      const c = window.APP_CONFIG || {};
      if (!c.supabaseUrl || !c.supabaseAnonKey) return;
      const res = await fetch(c.supabaseUrl + '/rest/v1/app_update?select=latest_build,download_url,note,force&limit=1', {
        headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + c.supabaseAnonKey }
      });
      if (!res.ok) return;
      const rows = await res.json();
      const info = rows && rows[0];
      if (!info || !info.download_url) return;
      if (Number(info.latest_build) > APP_BUILD) show(info);
    } catch (e) { /* بدون اینترنت یا خطا: بی‌صدا رد می‌شود */ }
  }

  /* شمارهٔ build همین نسخه را زیر صفحهٔ خانه نشان می‌دهد تا بشود فهمید کدام APK نصب است */
  function start() {
    try {
      if (isNative()) {
        const f = document.querySelector('.home-foot');
        if (f && f.textContent.indexOf('build') < 0) f.textContent += ' — build ' + APP_BUILD;
      }
    } catch (e) { /* بی‌اثر */ }
    setTimeout(check, 3000);
  }
  return { check, start, APP_BUILD };
})();
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AppUpdate.start());
  else AppUpdate.start();
}

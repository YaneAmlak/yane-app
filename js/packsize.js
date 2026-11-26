'use strict';
/* ============================================================
   اندازه بسته/کارتن محصولات
   ------------------------------------------------------------
   برای هر «کد کالا» می‌توان تعداد واحد در هر بسته (و در صورت نیاز
   یک یادداشت کوتاه) ثبت کرد. کاملاً دائمی و مشترک بین دستگاه‌هاست.

   نکته مهم (رفع باگ ۱): مثل aliases.js، قبلاً همه چیز زیر یک کلید
   settings به‌صورت یک آبجکت JSON واحد ذخیره می‌شد و در ذخیره‌های
   نزدیک‌به‌هم (seed + ویرایش دستی) داده گم می‌شد. حالا هر کد یک ردیف
   مستقل است (DB.setPackSize/removePackSize/...). `map` فقط کش محلی
   برای خواندن سریع (sync) است.

   نکته مهم (رفع باگ ۲): قبلاً setFor/removeFor فقط وقتی «آنلاین به‌نظر
   می‌رسید» مستقیم به سرور می‌نوشتند، بدون محافظ زمانی و بدون نوشتن
   محلی. اگر دقیقاً همان لحظه اینترنت قطع می‌شد (مثلاً حالت هواپیما)،
   اپ هنوز `isOffline()` را به‌روز نکرده بود، درخواست واقعی به سرور
   می‌رفت و تا ابد بدون جواب می‌ماند — دکمه‌ی «ذخیره» کاملاً بی‌واکنش
   می‌شد. حالا مثل نام‌های مستعار: همیشه اول محلی ذخیره می‌شود (هرگز
   گم نمی‌شود)، تلاش سرور حداکثر ۸ ثانیه صبر می‌کند، و اگر سرور در
   دسترس نبود، پرچم «هماهنگ‌نشده» گذاشته می‌شود تا با برگشت اینترنت
   خودکار دوباره تلاش شود.
   ============================================================ */

const PackSize = (() => {
  const PENDING_KEY = 'tamis-packsize-pending';
  const LEGACY_DIRTY_KEY = 'tamis-packsize-dirty'; // نسخه‌ی قبلی؛ دیگر استفاده نمی‌شود و پاک می‌شود
  let map = {}; // { [code]: { size: number, note?: string } }
  let notifier = null;
  let lastNotify = 0;
  let flushing = false;

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout: پاسخی از سرور دریافت نشد')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
  function setNotifier(fn) { notifier = fn; }
  function notify() {
    const now = Date.now();
    if (!notifier || now - lastNotify < 15000) return; // جلوگیری از پیام تکراری
    lastNotify = now;
    try { notifier(); } catch (e) { /* بی‌اثر */ }
  }
  function currentUid() {
    try { const u = (typeof Backend !== 'undefined' && Backend.getUser) ? Backend.getUser() : null; return u && u.id ? String(u.id) : ''; } catch (e) { return ''; }
  }
  function logIssue(ctx, e) {
    try {
      if (typeof Backend !== 'undefined' && Backend.logError && Backend.isActive()) Backend.logError(ctx, e, 'packsize').catch(() => {});
    } catch (er) { /* بی‌اثر */ }
  }

  /* صف «تغییرات هنوز ارسال‌نشده به سرور»: فقط همان کارهایی که کاربر صراحتاً انجام داده (ثبت/حذف برای یک کد).
     برای هر کد فقط آخرین تغییر نگه‌داری می‌شود. هیچ‌وقت از «نبودنِ یک کد در حافظه‌ی محلی» نتیجه‌ی حذف
     گرفته نمی‌شود: نسخه‌ی محلی فقط بخشی از داده‌هاست، نه آینه‌ی کامل سرور. */
  function readOps() {
    try {
      const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      return (v && v.uid && v.uid === currentUid() && Array.isArray(v.ops)) ? v.ops : [];
    } catch (e) { return []; }
  }
  function writeOps(ops) {
    try {
      if (ops.length) localStorage.setItem(PENDING_KEY, JSON.stringify({ uid: currentUid(), ops }));
      else localStorage.removeItem(PENDING_KEY);
    } catch (e) { /* localStorage در دسترس نیست؛ فقط قابلیت هماهنگ‌سازی خودکار کمتر می‌شود */ }
  }
  function removeLegacyFlag() { try { localStorage.removeItem(LEGACY_DIRTY_KEY); } catch (e) { /* بی‌اثر */ } }
  function pushOp(op) {
    const ops = readOps().filter((o) => String(o.code) !== String(op.code));
    ops.push(op);
    writeOps(ops);
  }

  function applyOps(base, ops) {
    const out = {};
    Object.keys(base || {}).forEach((k) => { out[k] = Object.assign({}, base[k]); });
    for (const op of ops) {
      const code = String(op.code);
      if (op.t === 'set') {
        out[code] = { size: Number(op.size) };
        if (op.note) out[code].note = String(op.note);
      } else if (op.t === 'rm') {
        delete out[code];
      }
    }
    return out;
  }

  async function init() {
    removeLegacyFlag();
    await flushPending(); // اگر تغییری از قبل در صف مانده، تا جای ممکن همین‌جا ارسال می‌شود
    let base;
    try {
      base = await DB.getAllPackSizes();
    } catch (e1) {
      logIssue('packsize-load', e1);
      try { base = await DB.getLocalPackSizes(); } catch (e2) { base = {}; }
    }
    map = applyOps(base, readOps());
  }

  function getAll() { return map; }

  function getFor(code) { return map[String(code)] || null; }

  // نتیجه‌ی DB.* را در کش محلی اعمال می‌کند؛ اگر سرور هماهنگ نشد، همان تغییر (فقط همان) در صف می‌رود
  function applyResult(key, value, res, op) {
    if (value === null) delete map[key]; else map[key] = value;
    if (!res.synced) {
      pushOp(op);
      if (res.error) logIssue('packsize-save', res.error);
      notify();
    }
    return { value, synced: res.synced };
  }

  async function setFor(code, size, note) {
    const key = String(code);
    const n = Number(size);
    if (!n || n <= 0) return removeFor(code);
    const res = await DB.setPackSize(key, n, note);
    const value = { size: n };
    const nt = String(note || '').trim();
    if (nt) value.note = nt;
    return applyResult(key, value, res, { t: 'set', code: key, size: n, note: nt || undefined });
  }

  async function removeFor(code) {
    const key = String(code);
    const res = await DB.removePackSize(key);
    return applyResult(key, null, res, { t: 'rm', code: key });
  }

  /* افزودن دسته‌جمعی (برای دیتای اولیه/شناخته‌شده) — فقط اگر از قبل برای آن کد چیزی ثبت نشده باشد */
  async function bulkSet(entries) {
    await DB.bulkSetPackSizes(entries);
    for (const e of entries || []) {
      const key = String(e.code);
      if (map[key]) continue; // چیزی که کاربر یا seed قبلی ثبت کرده را بازنویسی نمی‌کند
      if (!e.size) continue;
      map[key] = { size: Number(e.size) };
      if (e.note) map[key].note = String(e.note);
    }
    return map;
  }

  /* ارسال صف به سرور به‌ترتیب؛ هر مورد بعد از موفقیت برداشته می‌شود؛ با اولین شکست متوقف می‌شود.
     فقط همان تغییراتی که کاربر خودش انجام داده اعمال می‌شود؛ هیچ ردیف دیگری روی سرور دست نمی‌خورد. */
  async function flushPending() {
    if (flushing || typeof Backend === 'undefined' || !Backend.isActive || !Backend.isActive() || Backend.isOffline()) return false;
    const ops = readOps();
    if (!ops.length) return false;
    // محافظ همیشگی: صف تغییرات آفلاین باید کوچک باشد (کارهای واقعیِ یک کاربر روی گوشی خودش).
    // اگر به هر دلیلی (باگ آینده، خرابی localStorage) این عدد غیرمنطقی بزرگ شد، به‌جای اجرای
    // کورکورانه‌ی صف (که می‌تواند تغییرات ناخواسته‌ی زیادی روی سرور اعمال کند)، متوقف و لاگ می‌شود.
    if (ops.length > 300) {
      logIssue('sync-queue-too-large', new Error('pending ops = ' + ops.length));
      return false;
    }
    flushing = true;
    try {
      while (ops.length) {
        const op = ops[0];
        if (op.t === 'set') await withTimeout(Backend.setPackSize(op.code, op.size, op.note), 8000);
        else await withTimeout(Backend.removePackSize(op.code), 8000);
        ops.shift();
        writeOps(ops);
      }
      return true;
    } catch (e) {
      logIssue('packsize-flush', e);
      return false; // بقیه‌ی صف می‌ماند؛ بار بعد دوباره تلاش می‌شود
    } finally { flushing = false; }
  }

  async function flushIfDirty() {
    if (!readOps().length) return;
    const done = await flushPending();
    if (done) {
      try { map = applyOps(await Backend.getAllPackSizes(), readOps()); } catch (e) { /* کش فعلی می‌ماند */ }
    }
  }

  return { init, setNotifier, flushIfDirty, getAll, getFor, setFor, removeFor, bulkSet };
})();

if (typeof globalThis !== 'undefined') globalThis.PackSize = PackSize;
if (typeof module !== 'undefined' && module.exports) module.exports = PackSize;

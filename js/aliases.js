'use strict';
/* ============================================================
   نام‌های مستعار محصولات
   ------------------------------------------------------------
   برخی محصولات (مثلاً خط تولید درماليفت) با اسمی که داروخانه‌ها/
   مشتری‌ها می‌گویند (مثل «درمالیفت شماره ۱») در فایل انبار پیدا
   نمی‌شوند، چون اسم ثبت‌شده در فایل با اسم رایج فرق دارد.
   این ماژول اجازه می‌دهد برای هر «کد کالا» چند عبارت مستعار ثبت شود
   تا جستجو آن‌ها را هم بشناسد. کاملاً دائمی است.

   نکته مهم (رفع باگ): قبلاً همهٔ نام‌های مستعار زیر یک کلید settings
   به‌صورت یک آبجکت JSON واحد ذخیره می‌شد. هر بار ذخیره، کل آبجکت را
   جایگزین می‌کرد؛ اگر دو عملیات نزدیک به هم اتفاق می‌افتاد (مثلاً
   AliasSeed سیستم + ویرایش دستی، یا دو تب باز)، آخری که ذخیره می‌کرد
   نسخهٔ قدیمی خودش را کامل جایگزین می‌کرد و تغییرات دیگری گم می‌شد
   («گاهی کامل، گاهی فقط سیستمی، گاهی هیچی»). حالا هر alias یک ردیف
   مستقل است (DB.addAlias/removeAlias/...)، پس هر عملیات فقط همان یک
   ردیف را دست می‌زند و رقابت بین ذخیره‌های هم‌زمان از بین می‌رود.
   `map` اینجا فقط یک کش محلی برای خواندن سریع (sync) است.

   نکته مهم (رفع باگ ۲): قبلاً اگر ذخیره روی سرور شکست می‌خورد (چه
   واقعاً آفلاین، چه فقط یک درخواست ناموفق)، خطا مدیریت‌نشده می‌ماند:
   در بهترین حالت تغییر فقط محلی می‌ماند و بعد از ریلود (وقتی دوباره
   با سرور می‌خواند) بی‌صدا گم می‌شد؛ در بدترین حالت اصلاً ذخیره
   نمی‌شد. حالا هر تغییر همیشه اول محلی ذخیره می‌شود (هرگز گم نمی‌شود)
   و اگر سرور شکست بخورد، پرچم «هماهنگ‌نشده» گذاشته می‌شود تا با
   برگشت اینترنت خودکار دوباره تلاش شود.
   ============================================================ */

const Aliases = (() => {
  const PENDING_KEY = 'tamis-aliases-pending';
  const LEGACY_DIRTY_KEY = 'tamis-aliases-dirty'; // نسخه‌ی قبلی؛ دیگر استفاده نمی‌شود و پاک می‌شود
  let map = {}; // { [code]: string[] } — کش محلی
  let notifier = null;
  let lastNotify = { local: 0, fail: 0 };
  let flushing = false;
  let mutations = 0; // با هر تغییرِ محلی زیاد می‌شود؛ برای دور ریختن نتیجه‌ی قدیمیِ refresh

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout: پاسخی از سرور دریافت نشد')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
  function setNotifier(fn) { notifier = fn; }
  function notify(kind) {
    const now = Date.now();
    if (!notifier || now - (lastNotify[kind] || 0) < 15000) return; // جلوگیری از پیام تکراری
    lastNotify[kind] = now;
    try { notifier(kind); } catch (e) { /* بی‌اثر */ }
  }
  function currentUid() {
    try { const u = (typeof Backend !== 'undefined' && Backend.getUser) ? Backend.getUser() : null; return u && u.id ? String(u.id) : ''; } catch (e) { return ''; }
  }
  function logIssue(ctx, e) {
    try {
      if (typeof Backend !== 'undefined' && Backend.logError && Backend.isActive()) Backend.logError(ctx, e, 'aliases').catch(() => {});
    } catch (er) { /* لاگ‌گیری نباید خودش خطای تازه بسازد */ }
  }

  /* صف «تغییرات هنوز ارسال‌نشده به سرور»: فقط همان کارهایی که کاربر صراحتاً انجام داده
     (افزودن/حذف یک نام مشخص). هیچ‌وقت از «نبودنِ یک مورد در حافظه‌ی محلی» نتیجه‌ی حذف گرفته نمی‌شود:
     نسخه‌ی محلی فقط بخشی از داده‌هاست، نه آینه‌ی کامل سرور. */
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

  // تغییرات در صف را روی یک نقشه اعمال می‌کند (نسخه‌ی کپی؛ ورودی دست نمی‌خورد)
  function applyOps(base, ops) {
    const out = {};
    Object.keys(base || {}).forEach((k) => { out[k] = (base[k] || []).slice(); });
    for (const op of ops) {
      const code = String(op.code);
      if (op.t === 'add') {
        const arr = out[code] || (out[code] = []);
        if (!arr.some((x) => Utils.norm(x) === Utils.norm(op.alias))) arr.push(op.alias);
      } else if (op.t === 'rm') {
        const arr = (out[code] || []).filter((x) => Utils.norm(x) !== Utils.norm(op.alias));
        if (arr.length) out[code] = arr; else delete out[code];
      }
    }
    return out;
  }

  async function init() {
    removeLegacyFlag();
    await flushPending(); // اگر تغییری از قبل در صف مانده، تا جای ممکن همین‌جا ارسال می‌شود
    let base;
    try {
      base = await DB.getAllAliases();
    } catch (e1) {
      logIssue('aliases-load', e1);
      try { base = await DB.getLocalAliases(); } catch (e2) { base = {}; }
    }
    map = applyOps(base, readOps());
  }

  function getAll() { return map; }

  function getFor(code) { return map[String(code)] || []; }

  // نتیجه‌ی DB.* را در کش محلی اعمال می‌کند؛ اگر سرور هماهنگ نشد، همان تغییر (فقط همان) در صف می‌رود
  // { arr, synced } برمی‌گرداند: synced=false یعنی پیام هشدار از قبل نمایش داده شده
  function applyResult(key, res, ops) {
    mutations++;
    if (res.arr.length) map[key] = res.arr; else delete map[key];
    if (!res.synced) {
      writeOps(readOps().concat(ops));
      if (res.error) logIssue('alias-save', res.error);
      notify(res.offline ? 'local' : 'fail');
    }
    return { arr: res.arr, synced: res.synced };
  }

  async function addAlias(code, alias) {
    const key = String(code);
    const av = String(alias || '').trim();
    if (!av) return { arr: getFor(key), synced: true };
    const already = getFor(key).some((x) => Utils.norm(x) === Utils.norm(av));
    if (already) return { arr: getFor(key), synced: true };
    const res = await DB.addAlias(key, av);
    // لیست نهایی از روی «نمای کامل» (map) ساخته می‌شود، نه از کش محلی گوشی که فقط بخشی از داده‌هاست؛
    // وگرنه نام‌های مستعاری که از سرور آمده‌اند (هم‌تیمی/دستگاه دیگر) موقع افزودن از نمایش می‌پرند.
    const cur = getFor(key);
    const next = cur.some((x) => Utils.norm(x) === Utils.norm(av)) ? cur.slice() : cur.concat(av);
    return applyResult(key, Object.assign({}, res, { arr: next }), [{ t: 'add', code: key, alias: av }]);
  }

  async function removeAlias(code, alias) {
    const key = String(code);
    const res = await DB.removeAlias(key, alias);
    const next = getFor(key).filter((x) => x !== alias);
    return applyResult(key, Object.assign({}, res, { arr: next }), [{ t: 'rm', code: key, alias }]);
  }

  /* ویرایش (تغییر نام) یک نام مستعار موجود، بدون نیاز به حذف و افزودن دوباره */
  async function renameAlias(code, oldAlias, newAlias) {
    const key = String(code);
    const nv = String(newAlias || '').trim();
    if (!nv) return { arr: getFor(key), synced: true };
    const res = await DB.renameAlias(key, oldAlias, nv);
    const cur = getFor(key).slice();
    const idx = cur.findIndex((x) => x === oldAlias);
    if (idx !== -1) {
      const dup = cur.findIndex((x, i) => i !== idx && Utils.norm(x) === Utils.norm(nv));
      if (dup !== -1) cur.splice(idx, 1); else cur[idx] = nv;
    }
    return applyResult(key, Object.assign({}, res, { arr: cur }), [{ t: 'rm', code: key, alias: oldAlias }, { t: 'add', code: key, alias: nv }]);
  }

  /* افزودن دسته‌جمعی (برای دیتای اولیه/شناخته‌شده) — بدون تغییر رفتار قبلی */
  async function bulkAdd(entries) {
    await DB.bulkAddAliases(entries);
    for (const e of entries || []) {
      const key = String(e.code);
      const arr = map[key] ? map[key].slice() : [];
      for (const a of (e.aliases || [])) {
        const av = String(a || '').trim();
        if (av && !arr.some((x) => Utils.norm(x) === Utils.norm(av))) arr.push(av);
      }
      if (arr.length) map[key] = arr;
    }
    return map;
  }

  /* ارسال صف به سرور به‌ترتیب؛ هر مورد بعد از موفقیت از صف برداشته می‌شود؛ با اولین شکست متوقف می‌شود.
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
        if (op.t === 'add') await withTimeout(Backend.addAlias(op.code, op.alias), 8000);
        else await withTimeout(Backend.removeAlias(op.code, op.alias), 8000);
        ops.shift();
        writeOps(ops);
      }
      return true;
    } catch (e) {
      logIssue('aliases-flush', e);
      return false; // بقیه‌ی صف می‌ماند؛ بار بعد دوباره تلاش می‌شود
    } finally { flushing = false; }
  }

  async function flushIfDirty() {
    const had = readOps().length > 0;
    if (!had) return;
    const done = await flushPending();
    if (done) {
      try { map = applyOps(await Backend.getAllAliases(), readOps()); } catch (e) { /* کش فعلی می‌ماند */ }
    }
  }

  /* بازخوانی از سرور (برای دیدن نام‌های مستعاری که کاربران/دستگاه‌های دیگر اضافه کرده‌اند).
     تغییرات هنوز-ارسال‌نشده‌ی همین گوشی دوباره روی نتیجه اعمال می‌شود. اگر در حین خواندن
     تغییری محلی انجام شده باشد، نتیجه‌ی قدیمی دور ریخته می‌شود. true یعنی کش تغییر کرد. */
  async function refresh() {
    if (flushing || typeof Backend === 'undefined' || !Backend.isActive || !Backend.isActive() || Backend.isOffline()) return false;
    const before = mutations;
    let base;
    try { base = await withTimeout(DB.getAllAliases(), 12000); } catch (e) { return false; }
    if (before !== mutations || flushing) return false;
    const next = applyOps(base, readOps());
    const sig = (m) => Object.keys(m).sort().map((k) => k + ':' + (m[k] || []).slice().sort().join('|')).join(';');
    if (sig(next) === sig(map)) return false;
    map = next;
    return true;
  }

  return { init, setNotifier, flushIfDirty, refresh, getAll, getFor, addAlias, removeAlias, renameAlias, bulkAdd };
})();

if (typeof globalThis !== 'undefined') globalThis.Aliases = Aliases;
if (typeof module !== 'undefined' && module.exports) module.exports = Aliases;

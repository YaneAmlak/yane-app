'use strict';
/* ============================================================
   محصولات دستی (کد اختیاری)
   ------------------------------------------------------------
   برخی محصولات کد رسمی در فایل انبار ندارند یا اصلاً داخل فایل
   انبار نیستند. این ماژول اجازه می‌دهد کاربر خودش این محصولات را
   با یک «کد اختیاری» دلخواه تعریف کند.
   نکته‌ی حیاتی: این محصولات کاملاً از فایل‌های انبار جدا نگه‌داری
   می‌شوند — با وارد کردن فایل جدید، جایگزینی یا حذف فایل انبار،
   هیچ‌وقت پاک/بازنویسی نمی‌شوند. فقط با حذف دستی خود کاربر پاک می‌شوند.
   این اطلاعات کاملاً شخصی هر کاربر است (نه عمومی/مشترک بین شرکت‌ها؛
   در حالت Backend اختصاصی همان حساب کاربری در سرور ذخیره می‌شود،
   جدول settings، کلید customProducts).

   نکته مهم (رفع باگ): اگر ذخیره روی سرور شکست می‌خورد (شبکه ناپایدار
   یا واقعاً آفلاین)، خطا مدیریت‌نشده می‌ماند و بعد از ریلود — وقتی
   دوباره با سرور می‌خواند — نسخه‌ی قدیمی سرور جایگزین تغییر محلی
   می‌شد و آن از بین می‌رفت. حالا مثل سبد خرید، تا وقتی ذخیره روی
   سرور تأیید نشود، نسخه‌ی محلی (که شامل تغییر تازه است) دست‌نخورده
   می‌ماند و با برگشت اینترنت دوباره تلاش می‌شود.
   ============================================================ */

const CustomProducts = (() => {
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout: پاسخی از سرور دریافت نشد')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  const SETTING_KEY = 'customProducts';
  const DIRTY_KEY = 'tamis-customproducts-dirty';
  let list = []; // [{ code, name, warehouse, stock, priceToman, note }]
  let notifier = null;
  let lastNotify = { local: 0, fail: 0 };

  function setNotifier(fn) { notifier = fn; }
  function notify(kind) {
    const now = Date.now();
    if (!notifier || now - (lastNotify[kind] || 0) < 15000) return;
    lastNotify[kind] = now;
    try { notifier(kind); } catch (e) { /* بی‌اثر */ }
  }
  function currentUid() {
    try { const u = (typeof Backend !== 'undefined' && Backend.getUser) ? Backend.getUser() : null; return u && u.id ? String(u.id) : ''; } catch (e) { return ''; }
  }
  function setDirty(on) {
    try {
      if (on) localStorage.setItem(DIRTY_KEY, JSON.stringify({ uid: currentUid(), at: Date.now() }));
      else localStorage.removeItem(DIRTY_KEY);
    } catch (e) { /* localStorage در دسترس نیست؛ فقط قابلیت بازیابی خودکار کمتر می‌شود */ }
  }
  function isDirty() {
    try {
      const v = JSON.parse(localStorage.getItem(DIRTY_KEY) || 'null');
      return !!(v && v.uid && v.uid === currentUid());
    } catch (e) { return false; }
  }
  function logIssue(ctx, e) {
    try {
      if (typeof Backend !== 'undefined' && Backend.logError && Backend.isActive()) Backend.logError(ctx, e, 'custom-products').catch(() => {});
    } catch (er) { /* بی‌اثر */ }
  }

  async function init() {
    try {
      list = (isDirty()
        ? (await DB.getLocalSetting(SETTING_KEY, null))
        : (await DB.getSetting(SETTING_KEY, null))) || [];
    } catch (e1) {
      logIssue('custom-products-load', e1);
      try { list = (await DB.getLocalSetting(SETTING_KEY, null)) || []; } catch (e2) { list = []; }
    }
    if (isDirty()) setTimeout(() => { flushIfDirty(); }, 0);
  }

  function getAll() { return list.slice(); }

  function getFor(code) { return list.find((x) => String(x.code) === String(code)) || null; }

  /* اگر ذخیره روی سرور شکست بخورد، خطا مدیریت‌نشده رها نمی‌شود: پرچم «هماهنگ‌نشده» گذاشته می‌شود
     تا با برگشت اینترنت دوباره تلاش شود، و کاربر یک پیام واضح می‌بیند — نه پیام خام دیتابیس. */
  // خروجی: true یعنی واقعاً روی سرور هم ذخیره شد؛ false یعنی فقط محلی (پیام هشدار از قبل نشان داده شده)
  async function persist() {
    const online = DB.useBackend();
    try {
      await withTimeout(DB.setSetting(SETTING_KEY, list), 8000);
      if (online) { setDirty(false); return true; }
      // آفلاین واقعی: نوشتن محلی موفق بود ولی هنوز روی سرور نیست
      setDirty(true);
      notify('local');
      return false;
    } catch (e) {
      // آنلاین به‌نظر می‌رسید ولی درخواست شکست خورد (شبکه ناپایدار/تایم‌اوت)
      logIssue('custom-products-save', e);
      setDirty(true);
      notify('fail');
      // DB.setSetting همیشه محلی را قبل از تلاش روی سرور می‌نویسد، پس دیتا از دست نرفته؛
      // throw نمی‌کنیم تا UI موفقیت را نشان دهد (مثل سبد خرید)
      return false;
    }
  }

  function codeExists(code, excludeCode) {
    const c = String(code).trim();
    return list.some((x) => String(x.code) === c && (excludeCode === undefined || String(x.code) !== String(excludeCode)));
  }

  /* افزودن محصول دستی جدید. برمی‌گرداند: {ok:true, item} یا {ok:false, error} */
  async function add(item) {
    const code = String(item.code || '').trim();
    const name = String(item.name || '').trim();
    if (!code) return { ok: false, error: 'کد اختیاری را وارد کنید.' };
    if (!name) return { ok: false, error: 'نام محصول را وارد کنید.' };
    if (codeExists(code)) return { ok: false, error: 'این کد قبلاً برای یک محصول دستی دیگر استفاده شده.' };
    const entry = {
      code,
      name,
      warehouse: String(item.warehouse || '1'),
      stock: (item.stock === '' || item.stock === undefined || item.stock === null) ? null : Number(item.stock),
      priceToman: (item.priceToman === '' || item.priceToman === undefined || item.priceToman === null) ? null : Number(item.priceToman),
      note: String(item.note || '').trim() || undefined,
      manual: true,
      createdAt: new Date().toISOString()
    };
    list.push(entry);
    const synced = await persist();
    return { ok: true, item: entry, synced };
  }

  /* ویرایش محصول دستی موجود (بر اساس کد فعلی‌اش) */
  async function update(code, patch) {
    const idx = list.findIndex((x) => String(x.code) === String(code));
    if (idx === -1) return { ok: false, error: 'محصول دستی پیدا نشد.' };
    const newCode = patch.code !== undefined ? String(patch.code).trim() : list[idx].code;
    if (!newCode) return { ok: false, error: 'کد اختیاری را وارد کنید.' };
    if (String(newCode) !== String(code) && codeExists(newCode)) {
      return { ok: false, error: 'این کد قبلاً برای یک محصول دستی دیگر استفاده شده.' };
    }
    const cur = list[idx];
    const next = {
      ...cur,
      code: newCode,
      name: patch.name !== undefined ? String(patch.name).trim() : cur.name,
      warehouse: patch.warehouse !== undefined ? String(patch.warehouse) : cur.warehouse,
      stock: patch.stock !== undefined ? ((patch.stock === '' || patch.stock === null) ? null : Number(patch.stock)) : cur.stock,
      priceToman: patch.priceToman !== undefined ? ((patch.priceToman === '' || patch.priceToman === null) ? null : Number(patch.priceToman)) : cur.priceToman,
      note: patch.note !== undefined ? (String(patch.note).trim() || undefined) : cur.note
    };
    list[idx] = next;
    const synced = await persist();
    return { ok: true, item: list[idx], synced };
  }

  async function remove(code) {
    list = list.filter((x) => String(x.code) !== String(code));
    return { synced: await persist() };
  }

  async function removeAll() {
    list = [];
    return { synced: await persist() };
  }

  /* هماهنگ‌سازی بعد از شکست: نسخه‌ی محلی (که شامل تغییرات هنگام قطعی است) را روی سرور می‌نویسد */
  let flushing = false;
  async function flushIfDirty() {
    if (flushing || !isDirty() || !DB.useBackend()) return;
    flushing = true;
    try { await persist(); } catch (e) { /* پرچم می‌ماند؛ بار بعد دوباره تلاش می‌شود */ } finally { flushing = false; }
  }

  /* تبدیل به شکل استاندارد محصول (برای ادغام با محصولات فایل انبار در جستجو/لیست) */
  function toProductShape(item) {
    return {
      code: item.code,
      name: item.name,
      warehouse: item.warehouse,
      stock: item.stock,
      priceToman: item.priceToman,
      unit: 'عدد',
      manual: true
    };
  }

  function getAllAsProducts() {
    return list.map(toProductShape);
  }

  return { init, setNotifier, flushIfDirty, getAll, getFor, add, update, remove, removeAll, getAllAsProducts };
})();

if (typeof globalThis !== 'undefined') globalThis.CustomProducts = CustomProducts;
if (typeof module !== 'undefined' && module.exports) module.exports = CustomProducts;

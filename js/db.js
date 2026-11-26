'use strict';
/* ============================================================
   لایه داده — رابط یکسان برای هر دو حالت:
   • حالت محلی (IndexedDB) — مثل نسخه قبلی، بدون حساب کاربری
   • حالت Backend (Supabase) — جداسازی کامل اطلاعات هر کاربر
   توابع و امضای آنها دقیقاً مثل قبل است تا بقیه برنامه تغییری نکند.
   ============================================================ */

const DB = (() => {
  const DB_NAME = 'anbar_app_db';
  const DB_VERSION = 5; // نسخه ۵: حذف object store قدیمی webcache (نسخه ۴: افزودن aliases و packsizes)

  let _db = null;

  function useBackend() { return Backend.isActive() && !Backend.isOffline(); }

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('products')) {
          const st = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          st.createIndex('by_warehouse', 'warehouse', { unique: false });
          st.createIndex('by_code', 'code', { unique: false });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'warehouse' }); // کلید: '1' یا '2'
        }
        if (!db.objectStoreNames.contains('orders')) {
          const st = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
          st.createIndex('by_created', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('cart')) {
          db.createObjectStore('cart', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('packs')) {
          db.createObjectStore('packs', { keyPath: 'id', autoIncrement: true }); // پک‌های ذخیره‌شده
        }
        // قابلیت جستجوی اینترنتی حذف شده؛ store قدیمی آن را از دستگاه کاربران فعلی پاک کن
        if (db.objectStoreNames.contains('webcache')) db.deleteObjectStore('webcache');
        // نکته مهم: یک ردیف جدا به‌ازای هر «کد کالا» (نه یک آبجکت واحد
        // زیر settings) تا ذخیره‌های هم‌زمان همدیگر را کامل جایگزین نکنند.
        if (!db.objectStoreNames.contains('aliases')) {
          db.createObjectStore('aliases', { keyPath: 'code' }); // { code, aliases: [] }
        }
        if (!db.objectStoreNames.contains('packsizes')) {
          db.createObjectStore('packsizes', { keyPath: 'code' }); // { code, size, note? }
        }
      };
      req.onsuccess = (e) => {
        _db = e.target.result;
        _db.onversionchange = () => { try { _db.close(); } catch (err) { /* بی‌اثر */ } _db = null; }; // ارتقای نسخه در تب دیگر مسدود نشود
        resolve(_db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      let t;
      try {
        t = db.transaction(store, mode);
      } catch (e) { reject(e); return; }
      const st = t.objectStore(store);
      let out;
      try { out = fn(st); } catch (e) { reject(e); return; }
      const p = (out && typeof out.then === 'function') ? out : Promise.resolve(out);
      let settled = false;
      p.then((val) => {
        if (t.readyState === 'done') { settled = true; resolve(val); }
        else {
          t.oncomplete = () => { settled = true; resolve(val); };
          t.onerror = (e) => { if (!settled) { settled = true; reject(e.target.error); } };
        }
      }, (err) => {
        if (!settled) { settled = true; reject(err); }
        try { t.abort(); } catch (e) {}
      });
      t.onabort = (e) => { if (!settled) { settled = true; reject(e.target.error); } };
    }));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /* ---------- محصولات ---------- */

  function getAllProducts() {
    if (useBackend()) {
      return Backend.getAllProducts().then((list) => {
        cacheProductsLocally(list);
        return list;
      });
    }
    return tx('products', 'readonly', (st) => reqToPromise(st.getAll()));
  }

  function cacheProductsLocally(list) {
    open().then((db) => {
      try {
        const t = db.transaction('products', 'readwrite');
        const st = t.objectStore('products');
        st.clear();
        (list || []).forEach((p) => {
          const copy = Object.assign({}, p);
          delete copy.id;
          st.put(copy);
        });
      } catch (e) { /* بی‌اثر — کش صرفاً یک بهبود جانبی است */ }
    }).catch(() => {});
  }

  function replaceWarehouseProducts(warehouse, products) {
    if (useBackend()) return Backend.replaceWarehouseProducts(warehouse, products);
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(['products', 'files'], 'readwrite');
      const st = t.objectStore('products');
      const idx = st.index('by_warehouse');
      let keys = [];
      const req = idx.getAllKeys(String(warehouse));
      req.onsuccess = () => {
        keys = req.result || [];
        keys.forEach((k) => st.delete(k));
        products.forEach((p) => {
          p.warehouse = String(warehouse);
          st.put(p);
        });
      };
      t.oncomplete = () => resolve({ deleted: keys.length, inserted: products.length });
      t.onerror = (e) => reject(e.target.error);
    }));
  }

  /* ---------- فایل‌های انبار ---------- */

  function getAllFiles() {
    if (useBackend()) return Backend.getAllFiles();
    return tx('files', 'readonly', (st) => reqToPromise(st.getAll()));
  }

  function getFile(warehouse) {
    if (useBackend()) return Backend.getFile(warehouse);
    return tx('files', 'readonly', (st) => reqToPromise(st.get(String(warehouse))));
  }

  function putFile(meta) {
    if (useBackend()) return Backend.putFile(meta);
    return tx('files', 'readwrite', (st) => st.put(meta));
  }

  function deleteFile(warehouse) {
    if (useBackend()) return Backend.deleteFile(warehouse);
    return tx('files', 'readwrite', (st) => st.delete(String(warehouse)));
  }

  /* ---------- سفارش‌ها ---------- */

  function localPutOrder(order) {
    return tx('orders', 'readwrite', (st) => st.put(order)).catch(() => {});
  }

  function getAllOrders(opts) {
    if (useBackend()) return Backend.getOrders(opts);
    return tx('orders', 'readonly', (st) => reqToPromise(st.getAll()));
  }

  /* سفارش‌های همگام‌نشده‌ی ذخیره‌شده روی همین گوشی (حتی وقتی اپ آنلاین است) */
  function getLocalPendingOrders() {
    return tx('orders', 'readonly', (st) => reqToPromise(st.getAll()))
      .then((l) => (l || []).filter((o) => o && o.pendingSync))
      .catch(() => []);
  }

  function getOrdersCount() {
    if (useBackend()) return Backend.getOrdersCount();
    return tx('orders', 'readonly', (st) => reqToPromise(st.count()));
  }

  function getOrder(id) {
    if (useBackend()) return Backend.getOrder(id);
    return tx('orders', 'readonly', (st) => reqToPromise(st.get(Number(id))));
  }

  function putOrder(order) {
    if (useBackend()) {
      return Backend.putOrder(order).then((saved) => { localPutOrder(saved); return saved; });
    }
    return tx('orders', 'readwrite', (st) =>
      reqToPromise(st.put(order)).then((key) => { order.id = key; return order; })
    );
  }

  function deleteOrder(id) {
    tx('orders', 'readwrite', (st) => st.delete(typeof id === 'number' ? id : String(id))).catch(() => {});
    if (useBackend()) return Backend.deleteOrder(id);
    return tx('orders', 'readwrite', (st) => st.delete(Number(id)));
  }

  /* حذف فقط از حافظه‌ی محلی گوشی، بدون دست‌زدن به سرور (برای پاک‌کردن نسخه‌ی صف بعد از ارسال موفق) */
  function deleteLocalOrder(id) {
    return tx('orders', 'readwrite', (st) => st.delete(typeof id === 'number' ? id : String(id))).catch(() => {});
  }

  function getDeletedOrders() {
    if (useBackend()) return Backend.getDeletedOrders();
    return Promise.resolve([]);
  }
  function restoreOrder(id) {
    if (useBackend()) return Backend.restoreOrder(id);
    return Promise.resolve();
  }
  function permanentlyDeleteOrder(id) {
    tx('orders', 'readwrite', (st) => st.delete(typeof id === 'number' ? id : String(id))).catch(() => {});
    if (useBackend()) return Backend.permanentlyDeleteOrder(id);
    return Promise.resolve();
  }

  /* ---------- تنظیمات ---------- */

  function localSetSetting(key, value) {
    return tx('settings', 'readwrite', (st) => st.put({ key, value })).catch(() => {});
  }

  function getSetting(key, def) {
    if (useBackend()) return Backend.getSetting(key, def);
    return getLocalSetting(key, def);
  }

  /* خواندن فقط از حافظه‌ی محلی گوشی (صرف‌نظر از وضعیت اتصال) */
  function getLocalSetting(key, def) {
    return tx('settings', 'readonly', (st) => reqToPromise(st.get(key)).then((r) => (r ? r.value : def)));
  }

  function setSetting(key, value) {
    if (useBackend()) {
      localSetSetting(key, value);
      return Backend.setSetting(key, value);
    }
    return localSetSetting(key, value);
  }

  function getAllSettings() {
    if (useBackend()) return Backend.getSettings();
    return tx('settings', 'readonly', (st) => reqToPromise(st.getAll()));
  }

  /* ---------- پیش‌نویس سفارش (سبد خرید) ---------- */

  function localPutCart(items, info) {
    return tx('cart', 'readwrite', (st) => st.put({ id: 'current', items: items || [], info: info || {}, updatedAt: new Date().toISOString() })).catch(() => {});
  }

  function getCart() {
    if (useBackend()) return Backend.getCart();
    return tx('cart', 'readonly', (st) => reqToPromise(st.get('current')).then((r) => ({
      items: (r && r.items) || [],
      info: (r && r.info) || {}
    })));
  }

  /* خواندن سبد فقط از حافظه‌ی محلی گوشی (برای وقتی که آخرین تغییرات هنوز به سرور نرسیده) */
  function getLocalCart() {
    return tx('cart', 'readonly', (st) => reqToPromise(st.get('current')).then((r) => ({
      items: (r && r.items) || [],
      info: (r && r.info) || {}
    })));
  }

  function putCart(items, info) {
    if (useBackend()) {
      localPutCart(items, info);
      return Backend.putCart(items, info);
    }
    // مسیر محلی: خطا را قورت نمی‌دهیم تا اگر ذخیره‌ی محلی هم شکست خورد معلوم شود
    return tx('cart', 'readwrite', (st) => st.put({ id: 'current', items: items || [], info: info || {}, updatedAt: new Date().toISOString() }));
  }

  function clearCart() {
    localPutCart([], {}).catch(() => {});
    if (useBackend()) return Backend.clearCart();
    return tx('cart', 'readwrite', (st) => st.delete('current'));
  }

  /* ---------- نام‌های مستعار (هر ردیف = یک کد کالا) ---------- */

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout: پاسخی از سرور دریافت نشد')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  function getAllAliases() {
    if (useBackend()) return Backend.getAllAliases();
    return localGetAllAliases();
  }

  /* خواندن فقط از حافظه‌ی محلی گوشی (صرف‌نظر از وضعیت اتصال) — پایه‌ی سازگاری در حالت آفلاین */
  function localGetAllAliases() {
    return tx('aliases', 'readonly', (st) => reqToPromise(st.getAll())).then((rows) => {
      const map = {};
      (rows || []).forEach((r) => { map[r.code] = r.aliases || []; });
      return map;
    });
  }
  const getLocalAliases = localGetAllAliases;

  function localAddAlias(code, alias) {
    const key = String(code);
    return tx('aliases', 'readwrite', (st) => reqToPromise(st.get(key)).then((r) => {
      const arr = (r && r.aliases) ? r.aliases.slice() : [];
      const av = String(alias || '').trim();
      if (av && !arr.some((x) => Utils.norm(x) === Utils.norm(av))) arr.push(av);
      return reqToPromise(st.put({ code: key, aliases: arr })).then(() => arr);
    }));
  }

  function localRemoveAlias(code, alias) {
    const key = String(code);
    return tx('aliases', 'readwrite', (st) => reqToPromise(st.get(key)).then((r) => {
      const arr = ((r && r.aliases) || []).filter((x) => x !== alias);
      const put = arr.length ? reqToPromise(st.put({ code: key, aliases: arr })) : reqToPromise(st.delete(key));
      return put.then(() => arr);
    }));
  }

  function localRenameAlias(code, oldAlias, newAlias) {
    const key = String(code);
    const nv = String(newAlias || '').trim();
    return tx('aliases', 'readwrite', (st) => reqToPromise(st.get(key)).then((r) => {
      const arr = (r && r.aliases) ? r.aliases.slice() : [];
      const idx = arr.findIndex((x) => x === oldAlias);
      if (idx === -1 || !nv) return arr;
      const dupIdx = arr.findIndex((x, i) => i !== idx && Utils.norm(x) === Utils.norm(nv));
      if (dupIdx !== -1) arr.splice(idx, 1); else arr[idx] = nv;
      return reqToPromise(st.put({ code: key, aliases: arr })).then(() => arr);
    }));
  }

  /* نام مستعار دائمی و مشترک بین دستگاه‌هاست؛ برای همین همیشه محلی هم ذخیره می‌شود، حتی وقتی سرور
     در دسترس است — اگر ثبت روی سرور شکست بخورد (شبکه ناپایدار)، چیزی از دست نمی‌رود و می‌توان
     بعداً دوباره تلاش کرد. خروجی هرگز reject نمی‌شود مگر ذخیره‌ی محلی هم شکست بخورد. */
  async function addAlias(code, alias) {
    const arr = await localAddAlias(code, alias);
    if (!useBackend()) return { arr, synced: false, offline: true };
    try { await withTimeout(Backend.addAlias(code, alias), 8000); return { arr, synced: true }; }
    catch (e) { return { arr, synced: false, error: e }; }
  }

  async function removeAlias(code, alias) {
    const arr = await localRemoveAlias(code, alias);
    if (!useBackend()) return { arr, synced: false, offline: true };
    try { await withTimeout(Backend.removeAlias(code, alias), 8000); return { arr, synced: true }; }
    catch (e) { return { arr, synced: false, error: e }; }
  }

  async function renameAlias(code, oldAlias, newAlias) {
    const arr = await localRenameAlias(code, oldAlias, newAlias);
    if (!useBackend()) return { arr, synced: false, offline: true };
    try { await withTimeout(Backend.renameAlias(code, oldAlias, newAlias), 8000); return { arr, synced: true }; }
    catch (e) { return { arr, synced: false, error: e }; }
  }

  function bulkAddAliases(entries) {
    if (useBackend()) return Backend.bulkAddAliases(entries);
    return tx('aliases', 'readwrite', (st) => Promise.all((entries || []).map((e) => {
      const key = String(e.code);
      return reqToPromise(st.get(key)).then((r) => {
        const arr = (r && r.aliases) ? r.aliases.slice() : [];
        for (const a of (e.aliases || [])) {
          const av = String(a || '').trim();
          if (av && !arr.some((x) => Utils.norm(x) === Utils.norm(av))) arr.push(av);
        }
        if (arr.length) return st.put({ code: key, aliases: arr });
      });
    })));
  }

  /* ---------- اندازه بسته/کارتن (هر ردیف = یک کد کالا) ---------- */

  function getAllPackSizes() {
    if (useBackend()) return Backend.getAllPackSizes();
    return localGetAllPackSizes();
  }

  /* خواندن فقط از حافظه‌ی محلی گوشی (صرف‌نظر از وضعیت اتصال) */
  function localGetAllPackSizes() {
    return tx('packsizes', 'readonly', (st) => reqToPromise(st.getAll())).then((rows) => {
      const map = {};
      (rows || []).forEach((r) => {
        map[r.code] = { size: r.size };
        if (r.note) map[r.code].note = r.note;
      });
      return map;
    });
  }
  const getLocalPackSizes = localGetAllPackSizes;

  function localSetPackSize(code, size, note) {
    const key = String(code);
    const n = Number(size);
    const row = { code: key, size: n };
    const nt = String(note || '').trim();
    if (nt) row.note = nt;
    return tx('packsizes', 'readwrite', (st) => st.put(row));
  }

  function localRemovePackSize(code) {
    return tx('packsizes', 'readwrite', (st) => st.delete(String(code)));
  }

  /* اندازه‌ی بسته دائمی و مشترک بین دستگاه‌هاست؛ برای همین همیشه محلی هم ذخیره می‌شود، حتی وقتی
     سرور در دسترس است — رفع باگ: قبلاً وقتی آنلاین به‌نظر می‌رسید (حتی لحظه‌ای بعد از قطع واقعی
     اینترنت)، فقط به سرور نوشته می‌شد، بدون محافظ زمانی؛ اگر جواب نمی‌آمد، دکمه‌ی «ذخیره» برای
     همیشه بدون واکنش می‌ماند. حالا مثل نام‌های مستعار: اول محلی، بعد تلاش سرور با سقف ۸ ثانیه؛
     خروجی هرگز reject نمی‌شود مگر ذخیره‌ی محلی هم شکست بخورد. */
  async function setPackSize(code, size, note) {
    const key = String(code);
    const n = Number(size);
    if (!n || n <= 0) return removePackSize(code);
    await localSetPackSize(key, n, note);
    if (!useBackend()) return { synced: false, offline: true };
    try { await withTimeout(Backend.setPackSize(key, n, note), 8000); return { synced: true }; }
    catch (e) { return { synced: false, error: e }; }
  }

  async function removePackSize(code) {
    const key = String(code);
    await localRemovePackSize(key);
    if (!useBackend()) return { synced: false, offline: true };
    try { await withTimeout(Backend.removePackSize(key), 8000); return { synced: true }; }
    catch (e) { return { synced: false, error: e }; }
  }

  function bulkSetPackSizes(entries) {
    if (useBackend()) return Backend.bulkSetPackSizes(entries);
    return tx('packsizes', 'readwrite', (st) => Promise.all((entries || []).map((e) => {
      const key = String(e.code);
      return reqToPromise(st.get(key)).then((r) => {
        if (r) return;
        if (!e.size) return;
        const row = { code: key, size: Number(e.size) };
        if (e.note) row.note = String(e.note);
        return st.put(row);
      });
    })));
  }

  /* ---------- پاک‌سازی کلی ---------- */

  function wipeAll() {
    if (useBackend()) {
      return Backend.wipePersonal();
    }
    return open().then((db) => Promise.all(
      ['products', 'files', 'orders', 'cart', 'settings', 'packs', 'aliases', 'packsizes'].map((s) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(s, 'readwrite');
          t.objectStore(s).clear();
          t.oncomplete = resolve;
          t.onerror = (e) => reject(e.target.error);
        }))
    ));
  }

  return {
    open, getAllProducts, replaceWarehouseProducts,
    getAllFiles, getFile, putFile, deleteFile,
    getAllOrders, getLocalPendingOrders, deleteLocalOrder, getLocalCart, getOrdersCount, getOrder, putOrder, deleteOrder, getDeletedOrders, restoreOrder, permanentlyDeleteOrder,
    getSetting, getLocalSetting, setSetting, getAllSettings,
    getCart, putCart, putLocalCart: localPutCart, clearCart,
    getAllAliases, getLocalAliases, addAlias, removeAlias, renameAlias, bulkAddAliases,
    getAllPackSizes, getLocalPackSizes, setPackSize, removePackSize, bulkSetPackSizes,
    wipeAll, useBackend
  };
})();

if (typeof globalThis !== 'undefined') globalThis.DB = DB;
if (typeof module !== 'undefined' && module.exports) module.exports = DB;

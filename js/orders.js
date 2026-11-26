'use strict';
/* ============================================================
   مدیریت سفارش: سبد خرید، ثبت سفارش، ویرایش سفارش، خروجی (متن / PDF / Excel)
   ============================================================ */

const OrderManager = (() => {
  let cart = []; // [{code, name, stock, priceToman, warehouse, qty}]
  let cartInfo = { visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' };
  let seq = 1;

  /* اگر promise ظرف ms میلی‌ثانیه تمام نشود، رد می‌شود — برای جلوگیری از
     معطلی طولانی (دقیقه‌ها) وقتی شبکه واقعاً قطع است ولی هنوز به‌عنوان
     آنلاین شناخته می‌شود (مثلاً بلافاصله بعد از فعال‌شدن حالت هواپیما). */
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout: پاسخی از سرور دریافت نشد')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  /* ---- سبد خرید: پرچم «آخرین تغییرات فقط روی این گوشی ذخیره شده» ----
     اگر ذخیره روی سرور شکست بخورد، نسخه‌ی محلی جدیدتر از سرور است. با این پرچم
     بعد از ریلود، سبد محلی (نه سرورِ قدیمی) خوانده و دوباره به سرور فرستاده می‌شود. */
  const CART_DIRTY_KEY = 'tamis-cart-dirty';
  function currentUid() {
    try { const u = (typeof Backend !== 'undefined' && Backend.getUser) ? Backend.getUser() : null; return u && u.id ? String(u.id) : ''; } catch (e) { return ''; }
  }
  function setCartDirty(on) {
    try {
      if (on) localStorage.setItem(CART_DIRTY_KEY, JSON.stringify({ uid: currentUid(), at: Date.now() }));
      else localStorage.removeItem(CART_DIRTY_KEY);
    } catch (e) { /* localStorage در دسترس نیست؛ فقط قابلیت بازیابی کمتر می‌شود */ }
  }
  function isCartDirty() {
    try {
      const v = JSON.parse(localStorage.getItem(CART_DIRTY_KEY) || 'null');
      return !!(v && v.uid && v.uid === currentUid());
    } catch (e) { return false; }
  }
  function logIssue(ctx, e) {
    try {
      if (typeof Backend !== 'undefined' && Backend.logError && Backend.isActive()) Backend.logError(ctx, e, 'cart').catch(() => {});
    } catch (er) { /* لاگ‌گیری نباید خودش خطای تازه بسازد */ }
  }
  let notifier = null;
  let lastNotify = { local: 0, fail: 0 };
  function setNotifier(fn) { notifier = fn; }
  function notify(kind) {
    const now = Date.now();
    if (!notifier || now - (lastNotify[kind] || 0) < 30000) return; // جلوگیری از پیام تکراری
    lastNotify[kind] = now;
    try { notifier(kind); } catch (e) { /* بی‌اثر */ }
  }

  async function init() {
    const dirty = isCartDirty();
    try {
      let c;
      try {
        c = dirty ? await DB.getLocalCart() : await DB.getCart();
      } catch (e1) {
        // سرور جواب نداد: سبد خالی نگذار (چون تغییر بعدی سبد سرور را با خالی بازنویسی می‌کرد)؛ آخرین سبد محلی
        logIssue('cart-load', e1);
        c = await DB.getLocalCart();
      }
      cart = c.items || [];
      cartInfo = Object.assign({ visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' }, c.info || {});
    } catch (e) { cart = []; cartInfo = { visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' }; }
    try {
      seq = (await DB.getSetting('orderSeq', 1)) || 1;
    } catch (e) { seq = 1; }
    if (dirty) setTimeout(() => { flushCartIfDirty(); }, 0);
  }

  let flushing = false;
  async function flushCartIfDirty() {
    if (flushing || !isCartDirty() || !DB.useBackend()) return;
    flushing = true;
    try { await persist(true); } catch (e) { /* persist خودش لاگ کرده؛ بار بعد دوباره تلاش می‌شود */ } finally { flushing = false; }
  }

  function getCart() { return cart; }
  function getCartInfo() { return cartInfo; }
  function setCartInfo(info) {
    cartInfo = Object.assign({ visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' }, cartInfo, info || {});
    return persist();
  }
  function cartCount() { return cart.reduce((s, i) => s + (i.isJor ? (i.jorCount || 0) : i.qty), 0); }
  function cartItemCount() { return cart.length; }
  function cartTotal() { return cart.reduce((s, i) => s + i.qty * (i.priceToman || 0), 0); }
  function overStockItems() { return cart.filter((i) => i.stock !== null && i.qty > i.stock); }

  /* ---- ذخیره‌ی سبد ----
     ۱) ابتدا فوری روی خود گوشی ذخیره می‌شود (اپ هیچ‌وقت منتظر سرور نمی‌ماند).
     ۲) ارسال به سرور در پس‌زمینه، تک‌صفی و تجمیعی انجام می‌شود (نسخه‌ی قدیمی روی جدید نمی‌افتد).
     ۳) در صورت شکست، با فاصله‌ی چند ثانیه خودکار دوباره تلاش می‌شود؛ پرچم «dirty» هم تا
        تأیید سرور می‌ماند و تایمر ۶۰ثانیه‌ای/رویداد online هم دوباره می‌فرستد. */
  let cartVersion = 0;        // با هر تغییر سبد زیاد می‌شود
  let syncRunning = false;
  let retryTimer = null;
  let failStreak = 0;
  const RETRY_MS = [3000, 10000, 30000];

  function scheduleRetry() {
    if (retryTimer || failStreak > RETRY_MS.length) return; // بعد از چند بار، تایمر ۶۰ثانیه‌ی اپ ادامه می‌دهد
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isCartDirty()) syncCartToServer(true);
    }, RETRY_MS[failStreak - 1]);
  }

  async function syncCartToServer(quiet) {
    if (syncRunning) return;
    syncRunning = true;
    try {
      for (;;) {
        if (!DB.useBackend()) return; // آفلاین: پرچم dirty می‌ماند تا بعداً ارسال شود
        const v = cartVersion;
        try {
          await withTimeout(Backend.putCart(cart, cartInfo), 15000);
        } catch (e) {
          failStreak++;
          if (failStreak === 1) logIssue('cart-save', e); // فقط اولین شکست هر دوره لاگ می‌شود (بدون شلوغی لاگ)
          if (!quiet) notify('local');
          scheduleRetry();
          return;
        }
        failStreak = 0;
        if (v === cartVersion) { setCartDirty(false); return; } // سرور آخرین نسخه را دارد
        // در حین ارسال سبد تغییر کرده؛ نسخه‌ی جدیدتر هم ارسال شود
      }
    } finally { syncRunning = false; }
  }

  async function persist(quiet) {
    const viaServer = DB.useBackend();
    const backendOn = typeof Backend !== 'undefined' && Backend.isActive && Backend.isActive();
    if (viaServer) {
      cartVersion++;
      setCartDirty(true);                       // تا تأیید سرور، نسخه‌ی محلی معتبر است
      try { await DB.putLocalCart(cart, cartInfo); } catch (e) { /* ذخیره‌ی محلی خطا را خودش قورت می‌دهد */ }
      syncCartToServer(quiet);                  // عمداً await نمی‌شود
      return;
    }
    // مسیر آفلاین/محلی
    try {
      await withTimeout(DB.putCart(cart, cartInfo), 10000);
      if (backendOn) setCartDirty(true);        // فقط محلی؛ بعداً باید به سرور برسد
    } catch (e) {
      logIssue('cart-save-local', e);
      if (!quiet) notify('fail');
      throw e;                                  // ذخیره‌ی محلی هم شکست خورد
    }
  }

  /* «جور»: چند کد مختلف (هر کدام با تعداد دلخواه خودش) در یک قلم واحد
     در سبد قرار می‌گیرند. کدهای تک‌تک نمایش داده نمی‌شوند، ولی مبلغ نهایی
     دقیقاً برابر مجموع (تعداد هر کد × قیمت همان کد) است — بدون گرد کردن،
     تا جمع فاکتور هیچ‌وقت اشتباه نشود. جزئیات هر کد فقط برای مرجع داخلی
     نگه داشته می‌شود (جایی نمایش داده نمی‌شود).
     items: [{ code, name, warehouse, qty, priceToman }] */
  async function addJorToCart(groupName, items, totalQty, offer) {
    const list = (items || []).filter(Boolean);
    if (!list.length) throw new Error('هیچ کدی برای جور انتخاب نشده است.');
    const pieceCount = Math.max(1, Math.round(totalQty || 1));
    const priced = list.filter((i) => i.priceToman !== null && i.priceToman !== undefined);
    const missingPrice = priced.length < list.length;
    const avgPrice = priced.length ? Math.round(priced.reduce((s, i) => s + i.priceToman, 0) / priced.length) : null;
    const name = (groupName || '').trim() || 'جور';
    cart.push({
      whKey: 'jor:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      code: '',
      name,
      stock: null,
      priceToman: missingPrice ? null : (avgPrice * pieceCount),
      warehouse: '',
      qty: 1,
      offer: offer || '',
      isJor: true,
      jorCount: pieceCount,
      jorItems: list.map((i) => ({ code: i.code, name: i.name, warehouse: i.warehouse, priceToman: i.priceToman }))
    });
    await persist();
    return { avgPrice, pieceCount, missingPrice };
  }

  async function addToCart(product, qty, offer) {
    const n = Math.max(1, Math.round(qty || 1));
    const off = String(offer || '').trim();
    const price = product.priceToman === null || product.priceToman === undefined ? product.priceToman : Math.round(product.priceToman);
    const ex = cart.find((i) => i.whKey === product.whKey);
    if (ex) {
      ex.qty += n;
      if (off) ex.offer = off; // اگر آفر جدید وارد شد، جایگزین قبلی می‌شود
    } else {
      cart.push({
        whKey: product.whKey || (product.warehouse + '|' + product.code),
        code: product.code,
        name: product.name,
        stock: product.stock,
        priceToman: price,
        warehouse: product.warehouse,
        qty: n,
        offer: off
      });
    }
    await persist();
  }

  let qtyPersistTimer = null;
  async function setQty(whKey, qty) {
    const idx = cart.findIndex((i) => i.whKey === whKey);
    if (idx < 0) return;
    const n = Math.max(0, Math.round(qty || 0));
    if (n === 0) cart.splice(idx, 1);
    else cart[idx].qty = n;
    // Debounce ذخیره‌سازی: با کلیک‌های سریع پشت‌سرهم روی +/-، به‌جای یک
    // درخواست جدا برای هر کلیک، فقط آخرین مقدار بعد از ۳۰۰ میلی‌ثانیه سکون
    // ذخیره می‌شود. تغییر تعداد در حافظه فوری است (UI بلافاصله به‌روز می‌شود)؛
    // فقط ارسال به دیتابیس/سرور با تأخیر و در پس‌زمینه انجام می‌شود.
    if (qtyPersistTimer) clearTimeout(qtyPersistTimer);
    qtyPersistTimer = setTimeout(() => {
      qtyPersistTimer = null;
      // خطا داخل persist لاگ می‌شود و به کاربر اعلام می‌شود؛ اینجا فقط از unhandled rejection جلوگیری می‌کنیم
      persist().catch(() => {});
    }, 300);
  }

  async function removeItem(whKey) {
    const idx = cart.findIndex((i) => i.whKey === whKey);
    if (idx >= 0) cart.splice(idx, 1);
    await persist();
  }

  /* تنظیم آفر یک قلم خاص از سبد — مستقل از سایر قلم‌ها و بدون تأثیر روی مبلغ */
  async function setItemOffer(whKey, offer) {
    const it = cart.find((i) => i.whKey === whKey);
    if (!it) return;
    it.offer = String(offer || '').trim();
    await persist();
  }

  async function clearCart() {
    cart = [];
    cartInfo = { visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' };
    cartVersion++; // هر ارسال در جریان با نسخه‌ی قدیمی، بعدش سبد خالی را دوباره می‌فرستد
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    await DB.clearCart();
  }

  /* فقط وضعیت محلی (حافظهٔ اپ) را خالی می‌کند، بدون حذف از سرور — برای
     خروج از حساب (logout): نباید سبد واقعی کاربر روی سرور برای همیشه پاک
     شود فقط به‌خاطر اینکه یک‌بار خارج شده؛ دفعهٔ بعد که دوباره وارد شود،
     باید همان سبدش را از سرور پس بگیرد. */
  function resetCartLocal() {
    cart = [];
    cartInfo = { visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' };
  }

  /* ساخت اقلام با محاسبه خودکار مبلغ هر ردیف (آفر فقط اطلاعات است و در مبلغ تأثیر ندارد) */
  function buildItems(rawItems) {
    return rawItems.map((i) => {
      const qty = Math.max(1, Math.round(i.qty || 1));
      const out = {
        whKey: i.whKey,
        code: i.code,
        name: i.name,
        stock: i.stock,
        priceToman: i.priceToman,
        warehouse: i.warehouse,
        qty,
        offer: i.offer || '',
        lineTotal: Math.round(qty * (i.priceToman || 0))
      };
      if (i.isJor) {
        out.isJor = true;
        out.jorCount = (i.jorCount || 0) * qty; // اگر خود قلم جور هم چند برابر سفارش داده شد
        out.jorItems = i.jorItems;
      }
      return out;
    });
  }

  function orderTotal(items) { return items.reduce((s, i) => s + i.lineTotal, 0); }
  function orderCount(items) { return items.reduce((s, i) => s + (i.isJor ? (i.jorCount || 0) : i.qty), 0); }

  async function saveOrder(info) {
    const items = buildItems(cart);
    const inf = Object.assign({ visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' }, info || {});
    let wasOffline = !DB.useBackend();
    let saveError = null;
    const order = {
      no: seq,
      createdAt: new Date().toISOString(),
      items,
      total: orderTotal(items),
      count: orderCount(items),
      visitorName: inf.visitorName,
      pharmacyName: inf.pharmacyName,
      pharmacyAddress: inf.pharmacyAddress,
      pharmacyArea: inf.pharmacyArea,
      pharmacyPhone: inf.pharmacyPhone,
      note: inf.note,
      offer: inf.offer,
      pendingSync: wasOffline
    };
    try {
      await withTimeout(DB.putOrder(order), 10000);
    } catch (e) {
      // شبکه واقعاً وصل نیست (یا خیلی کند/قطعه) — فوراً کل اپ را آفلاین
      // علامت بزن و به‌جای شکست کامل، محلی ذخیره کن تا سفارش گم نشود.
      // علت واقعی خطا را ثبت کن (قبلاً بی‌صدا قورت داده می‌شد)
      saveError = e;
      try { if (typeof Backend !== 'undefined' && Backend.logError) Backend.logError('order-save', e, 'order').catch(() => {}); } catch (er) { /* بی‌اثر */ }
      if (typeof Backend !== 'undefined' && Backend.forceOfflineMode) Backend.forceOfflineMode();
      wasOffline = true;
      order.pendingSync = true;
      delete order.id;
      await DB.putOrder(order);
    }
    // فقط در حافظه (ذخیره نمی‌شود) تا UI دلیل واقعی را نشان دهد
    if (saveError) order.saveError = (typeof Backend !== 'undefined' && Backend.faErr) ? Backend.faErr(saveError) : String(saveError.message || saveError);
    seq = Math.max(seq, Number(order.no) || 0) + 1; // اگر شماره از سرور اصلاح شد، شمارنده هم جلو می‌رود
    // سفارش تا اینجا با موفقیت ذخیره شده؛ خطای کارهای جانبی نباید «شکست ثبت سفارش» گزارش شود
    // (وگرنه کاربر دوباره ثبت می‌کند و سفارش تکراری ساخته می‌شود)
    try { await DB.setSetting('orderSeq', seq); } catch (e) { logIssue('order-seq-save', e); }
    cart = [];
    cartInfo = { visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' };
    try { await DB.clearCart(); } catch (e) {
      // سبد سرور هنوز پر است؛ پرچم می‌گذاریم تا سبد خالی محلی دوباره به سرور برود و بعد از ریلود قلم‌های سفارش‌داده‌شده برنگردند
      logIssue('cart-clear', e);
      setCartDirty(true);
    }
    return order;
  }

  /* ویرایش سفارش ثبت‌شده — همان id حفظ می‌شود (سفارش تکراری ساخته نمی‌شود) */
  async function updateOrder(id, changes) {
    const existing = await DB.getOrder(Number(id));
    if (!existing) throw new Error('سفارش پیدا نشد.');
    if (changes.items) {
      existing.items = buildItems(changes.items);
      existing.total = orderTotal(existing.items);
      existing.count = orderCount(existing.items);
    }
    if (changes.info) {
      const inf = Object.assign({ visitorName: '', pharmacyName: '', pharmacyAddress: '', pharmacyArea: '', pharmacyPhone: '', note: '', offer: '' }, changes.info);
      existing.visitorName = inf.visitorName;
      existing.pharmacyName = inf.pharmacyName;
      existing.pharmacyAddress = inf.pharmacyAddress;
      existing.pharmacyArea = inf.pharmacyArea;
      existing.pharmacyPhone = inf.pharmacyPhone;
      existing.note = inf.note;
      existing.offer = inf.offer;
    }
    await DB.putOrder(existing);
    return existing;
  }

  async function deleteOrder(id) {
    await DB.deleteOrder(id);
  }

  /* ---------- متن سفارش برای پیام‌رسان ---------- */

  function warehouseLabel(wh) {
    return App.warehouseName(wh);
  }

  function buildOrderText(order, whFilter) {
    const items = whFilter ? order.items
      .filter((it) => it.isJor
        ? (it.jorItems || []).some((x) => String(x.warehouse) === String(whFilter))
        : String(it.warehouse) === String(whFilter))
      : order.items;
    const lines = [];
    lines.push('🧾 فهرست سفارش' + (whFilter ? ' (' + warehouseLabel(whFilter) + ')' : ''));
    lines.push('📅 ' + Utils.faFullDate(order.createdAt) + ' — ' + Utils.faTime(order.createdAt));
    if (order.visitorName) lines.push('👤 ویزیتور: ' + order.visitorName);
    if (order.pharmacyName) lines.push('🏥 داروخانه: ' + order.pharmacyName);
    if (order.pharmacyAddress) lines.push('📍 آدرس: ' + order.pharmacyAddress);
    if (order.pharmacyPhone) lines.push('📞 تلفن: ' + order.pharmacyPhone);
    if (order.note) lines.push('📝 توضیحات: ' + order.note);
    lines.push('');
    lines.push('━━━━━━━━━━━━━━');
    lines.push('');
    items.forEach((it, i) => {
      lines.push((i + 1) + ') ' + it.name);
      if (it.isJor) {
        const subs = whFilter ? (it.jorItems || []).filter((x) => String(x.warehouse) === String(whFilter)) : (it.jorItems || []);
        lines.push('   ⭐ جور — ' + Utils.faNum(subs.length) + ' قلم');
        lines.push('   تعداد کل: ' + Utils.faNum(it.jorCount || 0) + (it.offer ? '   |   آفر: ' + it.offer : ''));
      } else {
        lines.push('   کد: ' + it.code);
        lines.push('   تعداد: ' + Utils.faNum(it.qty) + (it.offer ? '   |   آفر: ' + it.offer : ''));
      }
      lines.push('');
    });
    lines.push('━━━━━━━━━━━━━━');
    const count = items.reduce((s, i) => s + (i.isJor ? (i.jorCount || 0) : i.qty), 0);
    lines.push('📦 تعداد اقلام: ' + Utils.faNum(items.length) + '   |   تعداد کل: ' + Utils.faNum(count));
    return lines.join('\n');
  }

  /* ---------- کپی و اشتراک‌گذاری ---------- */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // روش جایگزین برای WebViewهای قدیمی
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) { return false; }
    }
  }

  async function shareText(text) {
    if (navigator.share && navigator.canShare && navigator.canShare({ text })) {
      try {
        await navigator.share({ text });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
        // ادامه با کپی
      }
    }
    const ok = await copyText(text);
    return ok ? 'copied' : 'failed';
  }

  /* ---------- خروجی PDF ---------- */

  function sanitizeFilePart(s) {
    return String(s || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  }

  function orderFilename(order, ext) {
    const j = Utils.toJalali(order.createdAt);
    const dateStr = j ? (j.jy + '-' + String(j.jm).padStart(2, '0') + '-' + String(j.jd).padStart(2, '0')) : 'order';
    const pharmacy = sanitizeFilePart(order.pharmacyName);
    const namePrefix = pharmacy ? pharmacy + '-' : 'Safaresh-';
    return namePrefix + dateStr + (ext || '');
  }

  function jorWarehouseLabel(it) {
    const whs = Array.from(new Set((it.jorItems || []).map((x) => String(x.warehouse || ''))));
    if (whs.length === 1) return warehouseLabel(whs[0]);
    return 'ترکیبی';
  }

  function buildOrderHtml(order) {
    const rows = order.items.map((it, i) => it.isJor ? `
      <tr>
        <td>${i + 1}</td>
        <td>—</td>
        <td class="td-name">${Utils.esc(it.name)} <span style="color:#7c3aed;font-weight:700">(جور — ${Utils.faNum((it.jorItems || []).length)} قلم)</span></td>
        <td>${Utils.esc(jorWarehouseLabel(it))}</td>
        <td>${it.offer ? Utils.esc(it.offer) : '—'}</td>
        <td>${Utils.faNum(it.jorCount || 0)}</td>
        <td>—</td>
        <td>${Utils.faNum(it.lineTotal)}<div class="pdf-rial">${Utils.faNum((it.lineTotal || 0) * 10)} ریال</div></td>
      </tr>` : `
      <tr>
        <td>${i + 1}</td>
        <td>${Utils.esc(it.code)}</td>
        <td class="td-name">${Utils.esc(it.name)}</td>
        <td>${Utils.esc(warehouseLabel(it.warehouse))}</td>
        <td>${it.offer ? Utils.esc(it.offer) : '—'}</td>
        <td>${Utils.faNum(it.qty)}</td>
        <td>${Utils.faNum(it.priceToman)}<div class="pdf-rial">${Utils.faNum((it.priceToman || 0) * 10)} ریال</div></td>
        <td>${Utils.faNum(it.lineTotal)}<div class="pdf-rial">${Utils.faNum((it.lineTotal || 0) * 10)} ریال</div></td>
      </tr>`).join('');
    const infoRows = [];
    if (order.visitorName) infoRows.push(`<div class="pdf-info-row"><span>ویزیتور:</span><b>${Utils.esc(order.visitorName)}</b></div>`);
    if (order.pharmacyName) infoRows.push(`<div class="pdf-info-row"><span>داروخانه:</span><b>${Utils.esc(order.pharmacyName)}</b></div>`);
    if (order.pharmacyAddress) infoRows.push(`<div class="pdf-info-row"><span>آدرس:</span><b>${Utils.esc(order.pharmacyAddress)}</b></div>`);
    if (order.pharmacyPhone) infoRows.push(`<div class="pdf-info-row"><span>تلفن:</span><b dir="ltr" style="unicode-bidi:embed">${Utils.esc(order.pharmacyPhone)}</b></div>`);
    if (order.note) infoRows.push(`<div class="pdf-info-row"><span>توضیحات:</span><b>${Utils.esc(order.note)}</b></div>`);
    return `
      <div class="pdf-order">
        <div class="pdf-head">
          <div class="pdf-brand">Yane</div>
          <h2>فهرست سفارش</h2>
          <div class="pdf-date">${Utils.faFullDate(order.createdAt)} — ${Utils.faTime(order.createdAt)}</div>
        </div>
        ${infoRows.length ? `<div class="pdf-info">${infoRows.join('')}</div>` : ''}
        <table class="pdf-table">
          <thead><tr><th>#</th><th>کد کالا</th><th>نام محصول</th><th>انبار</th><th>آفر</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ کل</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="pdf-total">
          <span>مبلغ نهایی سفارش:</span>
          <div>
            <strong>${Utils.faNum(order.total)} تومان</strong>
            <div class="pdf-rial pdf-rial-total">${Utils.faNum((order.total || 0) * 10)} ریال</div>
          </div>
        </div>
        <div class="pdf-foot">تاریخ چاپ: ${Utils.faFullDate(new Date().toISOString())}</div>
      </div>`;
  }

  async function exportPdf(order) {
    const container = document.getElementById('print-area');
    container.innerHTML = buildOrderHtml(order);
    container.hidden = false;
    const node = container.firstElementChild;
    try {
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const imgH = canvas.height * pw / canvas.width;
      let position = 0;
      doc.addImage(img, 'JPEG', 0, position, pw, imgH, undefined, 'FAST');
      let heightLeft = imgH;
      position = -ph + imgH;
      while (heightLeft > ph) {
        position -= ph;
        doc.addPage();
        doc.addImage(img, 'JPEG', 0, position, pw, imgH, undefined, 'FAST');
        heightLeft -= ph;
      }
      doc.save(orderFilename(order, '.pdf'));
      return true;
    } finally {
      container.hidden = true;
      container.innerHTML = '';
    }
  }

  /* ---------- خروجی Excel ---------- */

  async function exportExcel(order) {
    const rows = [
      ['تاریخ', Utils.faFullDate(order.createdAt) + ' ' + Utils.faTime(order.createdAt)],
      ['ویزیتور', order.visitorName || ''],
      ['داروخانه', order.pharmacyName || ''],
      ['آدرس', order.pharmacyAddress || ''],
      ['تلفن', order.pharmacyPhone || ''],
      ['توضیحات', order.note || ''],
      [],
      ['ردیف', 'کد کالا', 'نام محصول', 'انبار', 'آفر', 'تعداد', 'قیمت واحد (تومان)', 'مبلغ کل (تومان)']
    ];
    order.items.forEach((it, i) => {
      if (it.isJor) {
        rows.push([i + 1, '', it.name + '  (جور — ' + Utils.faNum((it.jorItems || []).length) + ' قلم)', jorWarehouseLabel(it), it.offer || '', it.jorCount || 0, '', it.lineTotal]);
      } else {
        rows.push([i + 1, it.code, it.name, warehouseLabel(it.warehouse), it.offer || '', it.qty, Math.round(it.priceToman || 0), it.lineTotal]);
      }
    });
    rows.push([]);
    rows.push(['', '', '', '', '', '', 'مبلغ نهایی', Math.round(order.total)]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!views'] = [{ rightToLeft: true }];
    ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 40 }, { wch: 18 }, { wch: 8 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سفارش');
    XLSX.writeFile(wb, orderFilename(order, '.xlsx'));
    return true;
  }

  return {
    init, setNotifier, flushCartIfDirty, getCart, getCartInfo, setCartInfo, cartCount, cartItemCount, cartTotal, overStockItems,
    addToCart, addJorToCart, setQty, setItemOffer, removeItem, clearCart, resetCartLocal, saveOrder, updateOrder, deleteOrder,
    buildOrderText, copyText, shareText, exportPdf, exportExcel, orderFilename, warehouseLabel
  };
})();

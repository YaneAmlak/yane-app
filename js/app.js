'use strict';
/* ============================================================
   اپلیکیشن Tamis — منطق رابط کاربری
   ============================================================ */

const App = (() => {
  /* هماهنگی ارتفاع شیت‌ها/دیالوگ‌ها با باز و بسته شدن کیبورد گوشی —
     بدون این، وقتی کیبورد باز است، شیت طبق ارتفاع کامل صفحه (که شامل
     پشت کیبورد هم می‌شود) رسم می‌شود و دکمه‌های پایین شیت (مثلاً «افزودن
     به سفارش») زیر کیبورد پنهان می‌مانند. */
  (function setupViewportVar() {
    const setVar = () => {
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      document.documentElement.style.setProperty('--app-vvh', h + 'px');
    };
    setVar();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setVar);
      window.visualViewport.addEventListener('scroll', setVar);
    }
    window.addEventListener('resize', setVar);
  })();

  const state = {
    screen: 'home',
    savingOrder: false,
    ordersSearchQuery: '',
    products: [],
    files: { 1: null, 2: null },
    orders: [],
    settings: {
      priceUnit: 'rial',          // auto | rial | toman
      wh1Name: 'انبار ۱',
      wh2Name: 'انبار ۲'
    },
    whFilter: 'all',              // all | 1 | 2
    searchQuery: '',
    currentOrderId: null,
    archiveQuery: '',
    pharmacyKey: null,
    edit: { orderId: null, items: [], info: {} },
    import: { step: 'wh', warehouse: null, file: null, result: null, inputRows: null },
    jorSelection: new Map() // whKey -> { product, qty } — انتخاب‌های در حال «جور»
  };

  /* ---------- توابع کمکی ---------- */

  function $id(id) { return document.getElementById(id); }

  function warehouseName(wh) {
    return String(wh) === '1' ? state.settings.wh1Name : state.settings.wh2Name;
  }

  function whShort(wh) { return warehouseName(wh) || (String(wh) === '1' ? 'انبار ۱' : 'انبار ۲'); } // نام جایگزین تعریف‌شده در تنظیمات

  function showToast(msg, type) {
    const root = $id('toast-root');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2300);
    setTimeout(() => t.remove(), 2700);
  }

  /* ---------- پنجره‌ها و دکمه‌ی برگشت ----------
     هر پنجره‌ی باز (دیالوگ یا شیت) یک ورودی در تاریخچه می‌گذارد؛ دکمه‌ی برگشت گوشی اول
     بالاترین پنجره را می‌بندد و فقط اگر پنجره‌ای نبود یک صفحه به عقب می‌رود. */
  const modalStack = [];
  let histBusy = 0;            // تعداد history.back()های در راه (برگشت‌های خودمان)
  let histTimer = null;
  const histQueue = [];        // pushهایی که باید بعد از تمام شدن برگشت در راه انجام شوند
  let modalSeq = 0;
  function histDoPush(item) {
    try { history.pushState(item.st, '', item.url); if (item.entry) item.entry.pushed = true; } catch (e) { /* بی‌اثر */ }
  }
  function histFlush() {
    while (histQueue.length && histBusy === 0) histDoPush(histQueue.shift());
  }
  function histPush(st, url, entry) {
    if (histBusy > 0) { histQueue.push({ st, url, entry }); return; }
    histDoPush({ st, url, entry });
  }
  function histBackOwn() {     // برگشتِ خودمان (popstate آن نادیده گرفته می‌شود)
    histBusy++;
    try { history.back(); } catch (e) { histBusy--; return; }
    clearTimeout(histTimer);
    histTimer = setTimeout(() => { histBusy = 0; histFlush(); }, 1500);   // اگر popstate نیامد گیر نکند
  }
  function registerModal(closeByBack) {
    const entry = { closeByBack, done: false, pushed: false, id: ++modalSeq };
    modalStack.push(entry);
    histPush({ modal: entry.id }, location.href, entry);
    return function release() {   // بستن با دکمه/لمس بیرون
      if (entry.done) return;
      entry.done = true;
      const i = modalStack.indexOf(entry); if (i >= 0) modalStack.splice(i, 1);
      if (!entry.pushed) {        // هنوز وارد تاریخچه نشده: فقط از صف بردار
        const q = histQueue.findIndex((x) => x.entry === entry); if (q >= 0) histQueue.splice(q, 1);
        return;
      }
      // فقط اگر بالاترین ورودی تاریخچه همین پنجره است برش می‌داریم؛
      // اگر صفحه‌ای روی آن آمده، ورودیِ مانده بعداً هنگام برگشت خودکار رد می‌شود.
      let top = null; try { top = history.state; } catch (e) { top = null; }
      if (top && top.modal === entry.id) histBackOwn();
    };
  }

  /* ---------- دیالوگ ---------- */

  /* آیکن و رنگ پنجره: دکمه‌ی «حذف» (btn-danger) خودکار آیکن سطل قرمز می‌گیرد */
  const DLG_ICONS = {
    warn: ['amber', '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'],
    trash: ['red', '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'],
    chat: ['teal', '<path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z"/><path d="M12 9v6M9 12h6"/>'],
    info: ['teal', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'],
    check: ['green', '<path d="M5 12l5 5 9-10"/>']
  };

  /* { title, message, html, buttons:[{label,value,kind}], icon, input:{placeholder,value,maxLength}, stack }
     مقدار دکمه‌ای که value آن '__input__' باشد، متن واردشده را برمی‌گرداند؛ بستن با لمس بیرون → null */
  function showDialog({ title, message, html, buttons, icon, input, stack }) {
    return new Promise((resolve) => {
      const root = $id('dialog-root');
      if (root.__release) { root.__release(); root.__release = null; }
      root.innerHTML = '';
      const list = buttons || [{ label: 'باشه', value: true }];
      const key = icon || (list.some((b) => b.kind === 'btn-danger') ? 'trash' : 'info');
      const ic = DLG_ICONS[key] || DLG_ICONS.info;
      const overlay = document.createElement('div');
      overlay.className = 'overlay center';
      const dlg = document.createElement('div');
      dlg.className = 'dialog';
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      const ico = document.createElement('div');
      ico.className = 'dialog-ico tone-' + ic[0];
      ico.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ic[1] + '</svg>';
      dlg.appendChild(ico);
      if (title) {
        const h = document.createElement('div');
        h.className = 'dialog-title';
        h.textContent = title;
        dlg.appendChild(h);
      }
      if (message) {
        const p = document.createElement('div');
        p.className = 'dialog-msg';
        p.textContent = message;
        dlg.appendChild(p);
      }
      if (html) {
        const d = document.createElement('div');
        d.className = 'dialog-msg';
        d.innerHTML = html;
        dlg.appendChild(d);
      }
      let field = null;
      if (input) {
        field = document.createElement('input');
        field.type = 'text';
        field.className = 'dialog-input';
        field.autocomplete = 'off';
        field.placeholder = input.placeholder || '';
        field.value = input.value || '';
        if (input.maxLength) field.maxLength = input.maxLength;
        dlg.appendChild(field);
      }
      const btns = document.createElement('div');
      btns.className = 'dialog-btns' + (stack ? ' stack' : '');
      list.forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'btn ' + (b.kind || 'btn-ghost');
        btn.textContent = b.label;
        btn.onclick = () => { cleanup(); resolve(b.value === '__input__' ? (field ? field.value : '') : b.value); };
        btns.appendChild(btn);
      });
      dlg.appendChild(btns);
      overlay.appendChild(dlg);
      root.appendChild(overlay);
      const release = registerModal(() => { root.innerHTML = ''; resolve(null); });
      root.__release = release;
      function cleanup() { root.innerHTML = ''; release(); }
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { cleanup(); resolve(null); }
      });
      if (field) {
        field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cleanup(); resolve(field.value); } });
        setTimeout(() => { try { field.focus(); } catch (x) { /* بی‌اثر */ } }, 60);
      }
    });
  }

  /* جایگزین window.prompt: متن واردشده یا null (انصراف) */
  function showPrompt({ title, message, placeholder, value, maxLength, confirmLabel, icon }) {
    return showDialog({
      title, message, icon: icon || 'chat', input: { placeholder, value, maxLength },
      buttons: [{ label: 'انصراف', value: null }, { label: confirmLabel || 'تأیید', kind: 'btn-primary', value: '__input__' }]
    });
  }

  /* ---------- شیت ---------- */

  function showSheet({ title, html, onMount }) {
    const root = $id('sheet-root');
    if (root.__release) { root.__release(); root.__release = null; }
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    const handle = document.createElement('div');
    handle.className = 'sheet-handle';
    sheet.appendChild(handle);
    if (title) {
      const h = document.createElement('div');
      h.className = 'sheet-title';
      h.textContent = title;
      sheet.appendChild(h);
    }
    const body = document.createElement('div');
    body.innerHTML = html || '';
    sheet.appendChild(body);
    overlay.appendChild(sheet);
    root.appendChild(overlay);
    const release = registerModal(() => { root.innerHTML = ''; });
    root.__release = release;
    const close = () => { root.innerHTML = ''; release(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    if (onMount) onMount(body, close);
    return { close };
  }

  /* ---------- ناوبری ---------- */

  /* آیکون خطی هر برگه کنار عنوان هدر (به‌جای ایموجی) */
  const LOGO_SVG = '<svg width="30" height="30" viewBox="0 0 100 100"><rect width="100" height="100" rx="23" fill="#fff"/><g transform="translate(2 1.5)"><path d="M50 11 L74 29 V51 H26 V29 Z" fill="#0f766e" stroke="#0f766e" stroke-width="3.5" stroke-linejoin="round"/><circle cx="50" cy="35" r="6" fill="#fff"/><rect x="46" y="50" width="8" height="35" rx="3" fill="#0f766e"/><rect x="53" y="64" width="12" height="6.5" rx="2" fill="#f59e0b"/><rect x="53" y="75" width="8.5" height="6.5" rx="2" fill="#f59e0b"/></g></svg>';
  const P_HOME = '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>';
  const SCREEN_ICONS = {
    listings: P_HOME,
    listing: P_HOME + '<path d="M10 14h4M10 17h4"/>',
    clients: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5.2a3 3 0 010 5.6M18 14.4c1.8.8 3 2.6 3 5.6"/>',
    client: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 16c.8-1.6 2-2.2 3.5-2.2s2.7.6 3.5 2.2M15 10h3M15 13h3"/>',
    subscription: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    ad: '<path d="M3 11v3a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15 9a4 4 0 010 6M18 6a8 8 0 010 12"/>',
    tutorial: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5M9 7h6"/>',
    collab: '<circle cx="8" cy="8" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.3c3 .3 5.5 2 5.5 5.7"/>',
    'card-views': '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    deals: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 14l2 2 4-4"/>',
    'quick-note': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    converter: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'
  };
  function paintTopbarIcon(name) {
    const el = $id('topbar-icon'); if (!el) return;
    if (name === 'home') { el.innerHTML = LOGO_SVG; el.classList.add('logo'); el.hidden = false; return; }
    el.classList.remove('logo');
    const p = SCREEN_ICONS[name];
    if (!p) { el.innerHTML = ''; el.hidden = true; return; }
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
    el.hidden = false;
  }

  const TITLES = {
    home: 'Yane',
    estelam: 'استعلام',
    converter: '🔁 تبدیل رهن و اجاره',
    'quick-note': '📅 برنامه روزانه',
    deals: '📑 قراردادها و معامله‌ها',
    'card-views': '👁 بازدیدها',
    listings: '🏠 فایل‌ها',
    collab: '🤝 همکاری‌ها',
    tutorial: 'آموزش',
    support: '💬 پشتیبانی',
    ad: 'ساخت آگهی دیوار',
    subscription: 'اشتراک من',
    listing: 'جزئیات فایل',
    clients: '👥 مشتری‌ها',
    client: 'پرونده‌ی مشتری',
    products: 'جستجو و مشاهده محصولات',
    order: 'ثبت سفارش',
    orders: 'سفارش‌های ثبت‌شده',
    'order-detail': 'جزئیات سفارش',
    archive: 'آرشیو داروخانه‌ها',
    pharmacy: 'پرونده داروخانه',
    'edit-order': 'ویرایش سفارش',
    'orders-trash': '🗑 سطل زباله',
    'target-pharmacies': '🎯 داروخانه‌های هدف',
    'weekly-visits': '📅 برنامه هفتگی ویزیت',
    files: 'مدیریت فایل‌های انبار',
    import: 'وارد کردن فایل انبار',
    'suggest-names': '🏷 اسم‌های پیشنهادی',
    'product-attrs': '🧪 مشخصه‌های محصول',
    settings: 'تنظیمات',
    help: 'راهنما',
    admin: 'مدیریت کاربران'
  };

  /* ---------- ناوبری با دکمهٔ بک گوشی/مرورگر ---------- */
  // بدون این بخش، دکمهٔ بک گوشی هیچ تاریخچه‌ای برای برگشت پیدا نمی‌کند و
  // کل اپ را می‌بندد. راه‌حل: هر بار که به صفحهٔ جدیدی می‌رویم یک ورودی به
  // تاریخچهٔ مرورگر اضافه می‌کنیم؛ با زدن بک، همان منطق «صفحهٔ والد» که
  // دکمهٔ بک داخل اپ استفاده می‌کند اجرا می‌شود، به‌جای خروج از اپ.
  let suppressHistoryPush = false;

  function parentScreenOf(name) {
    if (name === 'products' && state.editAddMode && state.edit && state.edit.orderId) return 'edit-order';
    if (name === 'order-detail') return 'orders';
    if (name === 'orders-trash') return 'orders';
    if (name === 'edit-order') return 'order-detail';
    if (name === 'pharmacy') return 'archive';
    if (name === 'admin') return 'settings';
    if (name === 'archive') return 'home';
    if (name === 'target-pharmacies') return 'home';
    if (name === 'weekly-visits') return 'home';
    if (name === 'estelam') return 'home';
    if (name === 'converter') return 'home';
    if (name === 'quick-note') return 'home';
    if (name === 'deals') return 'home';
    if (name === 'card-views') return 'home';
    if (name === 'listing') return 'listings';
    if (name === 'listings') return 'home';
    if (name === 'collab') return 'home';
    if (name === 'tutorial') return 'home';
    if (name === 'support') return 'settings';
    if (name === 'ad') return 'home';
    if (name === 'subscription') return 'settings';
    if (name === 'client') return 'clients';
    if (name === 'clients') return 'home';
    if (name === 'suggest-names') return 'home';
    if (name === 'product-attrs') return 'home';
    if (name === 'import') return 'files';
    if (name === 'help') return 'settings';
    if (name === 'settings' || name === 'files') return 'home';
    if (name === 'order' || name === 'orders') return 'home';
    if (name === 'products') return 'home';
    return 'home';
  }

  /* برگشت = دقیقاً یک صفحه به عقب (هر جا). هر صفحه یک ورودی در تاریخچه دارد و
     با popstate همان صفحه‌ی قبلی نشان داده می‌شود؛ ورودی‌های تکراری/مانده رد می‌شوند. */
  let firstNav = true;
  let exitArmed = false;
  const trail = [];            // مسیر صفحه‌های باز شده (برای برگشتِ اپ اندروید)
  let nativeBackActive = false;

  window.addEventListener('popstate', (ev) => {
    if (histBusy > 0) { histBusy--; if (histBusy === 0) { clearTimeout(histTimer); histFlush(); } return; }   // برگشتِ خودمان
    if (modalStack.length) {                          // پنجره‌ی باز: فقط همان بسته شود
      const m = modalStack.pop(); m.done = true; m.closeByBack();
      return;
    }
    const st = ev.state || {};
    if (st.root && state.screen === 'home') {          // برگشت از خانه به ریشه: خروج با دو بار برگشت
      if (!exitArmed) {
        exitArmed = true;
        showToast('برای خروج، یک بار دیگر برگشت را بزن');
        setTimeout(() => {
          exitArmed = false;
          let cur = null; try { cur = history.state; } catch (e) { cur = null; }
          if (state.screen === 'home' && cur && cur.root && !modalStack.length) histPush({ guard: true }, location.pathname + location.search);
        }, 2000);
      }
      return;
    }
    if (st.modal) { try { history.back(); } catch (e) { /* بی‌اثر */ } return; }   // ورودیِ مانده‌ی پنجره‌ی بسته‌شده
    const target = st.screen || 'home';
    if (target === state.screen) {
      if (target !== 'home' || st.screen) { try { history.back(); } catch (e) { /* بی‌اثر */ } }   // ورودی تکراری
      return;
    }
    suppressHistoryPush = true;
    try { showScreen(target); } finally { suppressHistoryPush = false; }
    trail.pop();
  });

  /* برگشت داخل APK اندروید: دکمه‌ی برگشت مستقیم به همین تابع می‌رسد (افزونه‌ی @capacitor/app)،
     پس به تاریخچه‌ی WebView وابسته نیست: پنجره → صفحه‌ی قبلی → خانه (دو بار برای خروج). */
  function nativeBack() {
    if (modalStack.length) {
      const m = modalStack.pop(); m.done = true; m.closeByBack();
      return;
    }
    if (state.screen !== 'home') {
      const prev = trail.pop() || parentScreenOf(state.screen);
      suppressHistoryPush = true;
      try { showScreen(prev); } finally { suppressHistoryPush = false; }
      return;
    }
    if (exitArmed) {
      try { window.Capacitor.Plugins.App.exitApp(); } catch (e) { /* بی‌اثر */ }
      return;
    }
    exitArmed = true;
    showToast('برای خروج، یک بار دیگر برگشت را بزن');
    setTimeout(() => { exitArmed = false; }, 2000);
  }
  function wireNativeBack() {
    try {
      const AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!AppPlugin || !AppPlugin.addListener) return;
      nativeBackActive = true;
      AppPlugin.addListener('backButton', () => { nativeBack(); });
    } catch (e) { nativeBackActive = false; }
  }
  wireNativeBack();

  function showScreen(name, opts = {}) {
    if (state.screen === 'products' && name !== 'products' && state.jorSelection.size > 0) {
      state.jorSelection.clear();
    }
    if (!suppressHistoryPush) {
      if (firstNav) {                       // اولین صفحه: ورودی فعلی تاریخچه را جایگزین کن (ریشه)
        firstNav = false;
        try { history.replaceState({ screen: name, root: true }, '', location.pathname + location.search); } catch (e) { /* بی‌اثر */ }
        // ورودی نگهبان روی ریشه: اولین برگشت از خانه فقط پیام «دو بار برگشت» نشان می‌دهد
        if (name === 'home') histPush({ guard: true }, location.pathname + location.search);
      } else if (name !== state.screen) {   // همان صفحه دوباره باز نشود در تاریخچه
        histPush({ screen: name }, '#' + name);
        if (name === 'home') trail.length = 0; else { trail.push(state.screen); if (trail.length > 60) trail.shift(); }
      }
    }
    if (name !== 'products') state.editAddMode = false;
    state.screen = name;
    document.body.dataset.screen = name;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = $id('screen-' + name);
    if (el) el.classList.add('active');
    $id('topbar-title').textContent = (opts.title || TITLES[name] || '').replace(/^[^\p{L}\p{N}]+/u, '');
    paintTopbarIcon(name);
    paintHello();
    const back = name === 'home';
    $id('btn-back').hidden = back;
    $id('topbar-actions').innerHTML = '';
    updateTopbarUser();
    window.scrollTo(0, 0);
    updateCartFab();
    updateJorFab();
    updateEditAddBanner();
    if (name === 'products') onShowProducts();
    if (name === 'order') renderOrderScreen();
    if (name === 'orders') renderOrdersList();
    if (name === 'orders-trash') renderOrdersTrash();
    if (name === 'order-detail') {
      if (opts.order) state.currentOrderId = opts.order.id;
      renderOrderDetail();
    }
    if (name === 'files') renderFilesScreen();
    if (name === 'import') renderImportScreen();
    if (name === 'settings') renderSettings();
    if (name === 'archive') renderArchive();
    if (name === 'target-pharmacies') renderTargetPharmacies();
    if (name === 'weekly-visits') { state.wvSelMode = false; state.wvSel = new Set(); renderWeeklyVisits(); }
    if (name === 'estelam') renderEstelamScreen();
    if (name === 'converter') Converter.render();
    if (name === 'quick-note') { QuickNote.render(); DailyPlan.render(); } else if (typeof Voice !== 'undefined') Voice.stopAll();
    if (name === 'deals') Deals.render();
    if (name === 'card-views') Cards.render();
    if (name === 'listings') Listings.renderList();
    if (name === 'collab') Collab.render();
    if (name === 'tutorial') Help.render();
    if (name === 'support') Support.render();
    if (name === 'ad') AdBuilder.render();
    if (name === 'subscription') Subscription.render();
    if (name === 'listing') Listings.renderDetail();
    if (name === 'clients') Clients.renderList();
    if (name === 'client') Clients.renderDetail();
    if (name === 'suggest-names') { snSelMode = false; snSel.clear(); renderSuggestNames(); }
    if (name === 'product-attrs') renderAttrs();
    if (name === 'pharmacy') renderPharmacy();
    if (name === 'edit-order') renderEditOrder();
    if (name === 'admin') renderAdmin();
    if (name === 'home') renderHome();
  }

  $id('btn-back').addEventListener('click', () => {
    if (state.screen === 'home') return;
    if (nativeBackActive) { nativeBack(); return; }
    const before = state.screen;
    try { history.back(); } catch (e) { showScreen(parentScreenOf(before)); return; }
    // اگر تاریخچه‌ای برای برگشت نبود (مثلاً بعد از بارگذاری مجدد)، به صفحه‌ی والد برو
    setTimeout(() => { if (state.screen === before && !modalStack.length) showScreen(parentScreenOf(before)); }, 450);
  });

  function updateCartFab() {
    const fab = $id('cart-fab');
    const n = OrderManager.cartCount();
    const badge = $id('cart-fab-badge');
    const totalEl = $id('cart-fab-total');
    if (n > 0 && state.screen !== 'order' && state.screen !== 'edit-order' && !state.editAddMode) {
      fab.hidden = false;
      badge.hidden = false;
      badge.textContent = Utils.faNum(n);
      if (totalEl) { totalEl.hidden = false; totalEl.textContent = Utils.formatMoney(OrderManager.cartTotal()); }
    } else {
      fab.hidden = true;
      badge.hidden = true;
      if (totalEl) totalEl.hidden = true;
    }
  }

  /* ============================================================
     سیستم حساب کاربری
     ============================================================ */

  /* نام نمایشی کاربر */
  function userLabel() {
    const u = Backend.getUser();
    if (!u) return '';
    return u.full_name || u.email || '';
  }

  /* دکمه کاربر در نوار بالا */
  function updateTopbarUser() {
    const actions = $id('topbar-actions');
    if (!actions) return;
    if (!Backend.isActive()) return;
    const u = Backend.getUser();
    if (!u) return;
    actions.querySelectorAll('.topbar-user').forEach((x) => x.remove());   // بی‌تکرار (initApp و showScreen هر دو صدا می‌زنند)
    const btn = document.createElement('button');
    btn.className = 'topbar-user';
    btn.innerHTML = '👤 ' + Utils.esc(userLabel() || 'حساب');
    btn.onclick = () => showScreen('settings');
    actions.appendChild(btn);
  }

  /* نمایش صفحه ورود (overlay تمام‌صفحه؛ کلاس صفحه‌ها برداشته می‌شود تا برنامه دیده نشود) */
  function showLoginScreen() {
    const login = $id('screen-login');
    if (!login) return;
    login.hidden = false;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $id('topbar').style.display = 'none';
    $id('cart-fab').hidden = true;
  }

  /* تب‌های ورود / ساخت حساب و نمایش رمز در صفحه‌ی ورود */
  function wireLoginUi() {
    const tabL = $id('lg-tab-login');
    const tabR = $id('lg-tab-register');
    if (!tabL || !tabR) return;
    const setTab = (reg) => {
      tabL.classList.toggle('on', !reg);
      tabR.classList.toggle('on', reg);
      tabL.setAttribute('aria-selected', String(!reg));
      tabR.setAttribute('aria-selected', String(reg));
      $id('lg-name-row').hidden = !reg;
      $id('lg-steps').hidden = !reg;
      $id('login-submit').hidden = reg;
      $id('register-submit').hidden = !reg;
      loginStatus('');
    };
    tabL.onclick = () => setTab(false);
    tabR.onclick = () => setTab(true);
    const eye = $id('lg-eye');
    const pass = $id('login-pass');
    if (eye && pass) {
      eye.onclick = () => {
        const show = pass.type === 'password';
        pass.type = show ? 'text' : 'password';
        eye.setAttribute('aria-label', show ? 'پنهان کردن رمز' : 'نمایش رمز');
      };
    }
    setTab(false);
  }

  function hideLoginScreen() {
    const login = $id('screen-login');
    if (login) { login.hidden = true; login.classList.remove('active'); }
    $id('topbar').style.display = '';
  }

  /* ---------- صفحه راه‌اندازی سیستم ورود (زمانی که پیکربندی ناقص باشد) ---------- */

  function showSetupScreen(errMsg) {
    const s = $id('screen-setup');
    if (!s) return;
    s.hidden = false;
    // بدون پیکربندی/ورود هیچ بخشی از برنامه نمایش داده نشود
    document.querySelectorAll('.screen').forEach((sc) => sc.classList.remove('active'));
    $id('topbar').style.display = 'none';
    $id('cart-fab').hidden = true;
    const status = $id('setup-status');
    if (status) {
      status.textContent = errMsg ? '⚠️ ' + errMsg : '';
      status.hidden = !errMsg;
    }
  }

  /* ---------- حالت «فقط آنلاین»: صفحه‌ی «اینترنت قطع است»، نوار هشدار و بارگذاری مجدد ---------- */
  function showOfflineScreen() {
    document.querySelectorAll('.screen').forEach((sc) => sc.classList.remove('active'));
    ['screen-login', 'screen-setup'].forEach((id) => { const e = $id(id); if (e) e.hidden = true; });
    const tb = $id('topbar'); if (tb) tb.style.display = 'none';
    const fab = $id('cart-fab'); if (fab) fab.hidden = true;
    const el = $id('screen-offline'); if (el) el.hidden = false;
  }

  let connWatchStarted = false;
  function startConnectionWatch(startedOffline) {
    if (connWatchStarted) return;
    connWatchStarted = true;
    let lost = !!startedOffline;
    let fails = 0;
    let reloading = false;
    const bar = () => $id('offline-bar');
    function setLost() {
      if (lost) return;
      lost = true;
      if (Backend.forceOfflineMode) Backend.forceOfflineMode();
      const b = bar(); if (b) b.hidden = false;
    }
    function recovered() {
      if (!lost || reloading) return;
      reloading = true;
      const b = bar(); if (b) b.hidden = true;
      const o = $id('screen-offline'); if (o) o.hidden = true;
      location.reload();
    }
    async function check() {
      if (reloading || !Backend.isActive()) return;
      if (navigator.onLine === false) { fails = 2; setLost(); return; }
      let ok = false;
      try { ok = await Backend.pingServer(); } catch (e) { ok = false; }
      if (ok) { fails = 0; recovered(); return; }
      fails++;
      if (fails >= 2) setLost();
    }
    window.addEventListener('offline', () => { fails = 2; setLost(); });
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 5000);
  }

  /* ---------- صفحه انسداد در صورت پایان/تعلیق اشتراک ---------- */
  function showExpiredScreen(status) {
    document.querySelectorAll('.screen').forEach((sc) => sc.classList.remove('active'));
    const tb = $id('topbar'); if (tb) tb.style.display = 'none';
    const fab = $id('cart-fab'); if (fab) fab.hidden = true;
    let el = $id('screen-expired');
    if (!el) {
      el = document.createElement('div');
      el.id = 'screen-expired';
      el.style.cssText = 'position:fixed;inset:0;background:#f1f4f8;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow-y:auto;padding:24px 16px 40px;text-align:center;direction:rtl;font-family:inherit;gap:14px;';
      document.body.appendChild(el);
    }
    const isSuspended = status && status.reason === 'suspended';
    const title = isSuspended ? '⛔ حساب شما غیرفعال شده است' : '⏳ اشتراک شما تمام شده است';
    const msg = isSuspended
      ? 'دسترسی این حساب توسط مدیر مجموعه غیرفعال شده است.'
      : 'یک پلن انتخاب کن، پرداخت را ثبت کن و بعد از تایید ادامه بده.';
    el.innerHTML = `
      <div style="font-size:44px">${isSuspended ? '⛔' : '⏳'}</div>
      <h2 style="margin:0">${Utils.esc(title)}</h2>
      <p style="margin:0;color:#555;max-width:320px">${Utils.esc(msg)}</p>
      ${isSuspended ? '' : '<div id="exp-sub" style="width:100%;max-width:460px;text-align:right"></div>'}
      <button id="expired-logout" class="btn btn-ghost" style="margin-top:8px">خروج از حساب</button>
    `;
    if (!isSuspended && $id('exp-sub')) Subscription.mountInto($id('exp-sub'), { blocked: true });
    const btn = $id('expired-logout');
    if (btn) btn.onclick = async () => { await Backend.signOut(); location.reload(); };
  }

  function wireSetupButtons() {
    const save = $id('setup-save');
    if (save) save.onclick = () => {
      const url = ($id('setup-url') ? $id('setup-url').value : '').trim();
      const key = ($id('setup-key') ? $id('setup-key').value : '').trim();
      const status = $id('setup-status');
      if (!url || !key) {
        if (status) { status.textContent = 'لطفاً آدرس و کلید را وارد کنید.'; status.hidden = false; }
        return;
      }
      try { localStorage.setItem('anbar-supabase-config', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key })); } catch (e) {}
      location.reload();
    };
  }

  function loginStatus(msg, type) {
    const el = $id('login-status');
    if (el) {
      el.textContent = msg;
      el.className = 'login-status' + (type ? ' ' + type : '');
      el.hidden = !msg;
    }
  }

  async function handleLogin() {
    const email = ($id('login-email') ? $id('login-email').value : '').trim();
    const pass = $id('login-pass') ? $id('login-pass').value : '';
    const companyCode = ($id('login-company-code') ? $id('login-company-code').value : '').trim();
    if (!email || !pass) { loginStatus('ایمیل و رمز عبور را وارد کنید.', 'error'); return; }
    loginStatus('در حال ورود…');
    try {
      await Backend.signIn(email, pass, companyCode);
      hideLoginScreen();
      const sub = Backend.subscriptionStatus();
      if (!sub.active) { showExpiredScreen(sub); return; }
      await initApp();
    } catch (e) {
      loginStatus(Backend.faErr(e), 'error');
    }
  }

  async function handleRegister() {
    const name = ($id('login-name') ? $id('login-name').value : '').trim();
    const companyCode = ($id('login-company-code') ? $id('login-company-code').value : '').trim();
    const email = ($id('login-email') ? $id('login-email').value : '').trim();
    const pass = $id('login-pass') ? $id('login-pass').value : '';
    if (!name) { loginStatus('نام خود را وارد کنید.', 'error'); return; }
    if (!companyCode && !(window.APP_CONFIG && window.APP_CONFIG.crmOnly)) { loginStatus('کد شرکت را وارد کنید.', 'error'); return; }
    if (!email || !pass) { loginStatus('ایمیل و رمز عبور را وارد کنید.', 'error'); return; }
    loginStatus('در حال ساخت حساب…');
    try {
      const res = await Backend.signUp(name, email, pass, companyCode);
      if (res.needsConfirm) {
        loginStatus('حساب ساخته شد؛ لطفاً ایمیل تأیید را باز کنید و سپس وارد شوید.', 'ok');
        return;
      }
      hideLoginScreen();
      await initApp();
    } catch (e) {
      loginStatus(Backend.faErr(e), 'error');
    }
  }

  async function handleLogout() {
    await Backend.signOut();
    state.orders = [];
    state.products = [];
    state.files = { 1: null, 2: null };
    Aliases.init().catch(() => {});
    OrderManager.resetCartLocal(); // فقط نمایش محلی؛ سبد واقعی روی سرور دست‌نخورده می‌ماند
    location.reload();
  }

  /* ---------- بخش مدیریت (فقط مدیر) ---------- */

  let admTab = 'req';   /* تب فعال صفحه‌ی مدیریت: req | users | gift */

  function renderAdmin() {
    const wrap = $id('admin-content');
    if (!Backend.isAdmin()) {
      wrap.innerHTML = '<div class="empty-state"><p>فقط مدیر می‌تواند این بخش را ببیند.</p></div>';
      return;
    }
    wrap.innerHTML = '<div class="progress-box"><div class="dz-icon">⏳</div><div class="progress-text">در حال بارگذاری…</div></div>';
    Promise.all([
      Backend.adminListCompanies().catch(() => []),
      Backend.adminListUsers(),
      Backend.adminGetErrorLogs(30).catch(() => [])
    ]).then(([companies, users, errorLogs]) => {
      const usersById = {};
      users.forEach((u) => { usersById[u.id] = u; });
      const errorLogsHtml = `
        <details class="adm-log">
          <summary><span>🐞 لاگ خطاهای اخیر</span><span class="adm-log-n${errorLogs.length ? ' bad' : ''}">${errorLogs.length ? Utils.faNum(errorLogs.length) : 'بدون خطا'}</span></summary>
          <div class="adm-log-body">
            ${errorLogs.length ? '<div style="text-align:left;margin-bottom:6px"><button class="btn btn-ghost btn-sm" id="admin-clear-errors">پاک‌کردن لاگ‌ها</button></div>' : ''}
            ${errorLogs.length ? errorLogs.map((l) => {
              const u = usersById[l.user_id];
              return `<div class="od-info-row" style="align-items:flex-start;flex-direction:column;gap:2px">
                <span class="lbl" style="min-width:0">${Utils.esc(l.context)} — ${u ? Utils.esc(u.full_name || u.email) : 'کاربر ناشناس'} — ${Utils.faDate(l.created_at)} ${Utils.faTime(l.created_at)}</span>
                <span class="val" style="font-weight:400;color:var(--muted);font-size:12.5px;word-break:break-word">${Utils.esc(l.message)}${l.screen ? ' (صفحه: ' + Utils.esc(l.screen) + ')' : ''}</span>
              </div>`;
            }).join('') : '<div class="empty-state" style="padding:8px 0"><p>خطایی ثبت نشده — همه‌چیز آرومه ✅</p></div>'}
          </div>
        </details>`;
      const companiesHtml = `
        <div class="set-card">
          <div class="set-title" style="display:flex;align-items:center;justify-content:space-between">
            <span>🏢 شرکت‌ها</span>
            <button class="btn btn-primary btn-sm" id="admin-add-company">+ شرکت جدید</button>
          </div>
          ${companies.length ? companies.map((c) => `
            <div class="od-info-row" data-company-row="${Utils.esc(c.id)}">
              <span class="lbl">${Utils.esc(c.name)} <span style="color:var(--muted);font-size:12px">(کد: ${Utils.esc(c.company_code)})</span></span>
              <span class="val" style="display:flex;align-items:center;gap:8px">
                ${Utils.faNum(c.userCount)} نفر
                <button class="btn ${c.active ? 'btn-ghost' : 'btn-primary'} btn-sm" data-company-toggle="${Utils.esc(c.id)}" data-active="${c.active ? '1' : '0'}">${c.active ? 'غیرفعال کردن' : 'فعال کردن'}</button>
              </span>
            </div>`).join('') : '<div class="empty-state" style="padding:10px 0"><p>هنوز شرکتی ثبت نشده.</p></div>'}
        </div>`;

      const activeUsers = users.filter((u) => !u.archived_at);
      const archivedUsers = users.filter((u) => u.archived_at);
      const cardsAll = activeUsers.map((u) => renderAdminUserCard(u)).join('');
      const archivedHtml = archivedUsers.length
        ? `<details class="au-archive"><summary>📦 بایگانی (${Utils.faNum(archivedUsers.length)} کاربر)</summary>${archivedUsers.map((u) => renderArchivedUserCard(u)).join('')}</details>`
        : '';
      const searchHtml = '<div class="au-search"><input type="search" id="admin-user-search" placeholder="جستجوی نام یا ایمیل…" autocomplete="off"><div class="au-count" id="admin-user-count"></div></div>';
      const usersInner = users.length
        ? searchHtml + `<div id="admin-users-list">${cardsAll}</div>${archivedHtml}`
        : '<div class="empty-state"><p>کاربری ثبت نشده است.</p></div>';
      const tabs = [['req', 'درخواست‌ها', '<span class="adm-n" id="adm-req-count">۰</span>'], ['users', 'کاربران', '<span class="adm-n">' + Utils.faNum(activeUsers.length) + '</span>'], ['gift', 'هدیه', '']];
      wrap.innerHTML = `<div class="adm-tabs">${tabs.map(([k, lb, ex]) => `<button type="button" class="${admTab === k ? 'on' : ''}" data-adm-tab="${k}">${lb}${ex ? ' ' + ex : ''}</button>`).join('')}</div>
        <div class="adm-pane" data-adm-pane="req"${admTab === 'req' ? '' : ' hidden'}><div id="admin-sub-requests"></div></div>
        <div class="adm-pane" data-adm-pane="users"${admTab === 'users' ? '' : ' hidden'}>${usersInner}${errorLogsHtml}</div>
        <div class="adm-pane" data-adm-pane="gift"${admTab === 'gift' ? '' : ' hidden'}><div id="admin-sub-gift"></div></div>`;
      Subscription.mountAdmin($id('admin-sub-requests'), users, $id('admin-sub-gift'));
      wireAdminTabs();
      if (!users.length) { wireErrorLogControls(); return; }
      wireErrorLogControls();
      wireAdminList();
      wirePlanControls();
      wireUserDeleteControls();
      wireArchiveControls();
      wireUserSearch();
    }).catch((e) => {
      wrap.innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + Utils.esc(Backend.faErr(e)) + '</p></div>';
    });
  }

  function wireAdminTabs() {
    const wrap = $id('admin-content');
    if (!wrap) return;
    wrap.querySelectorAll('[data-adm-tab]').forEach((b) => b.addEventListener('click', () => {
      admTab = b.dataset.admTab;
      wrap.querySelectorAll('[data-adm-tab]').forEach((x) => x.classList.toggle('on', x === b));
      wrap.querySelectorAll('[data-adm-pane]').forEach((p) => { p.hidden = p.dataset.admPane !== admTab; });
    }));
  }

  /* «آخرین فعالیت» کاربر برای پنل مدیریت */
  function seenAgo(iso) {
    if (!iso) return { text: 'هنوز ثبت نشده', live: false };
    const t = new Date(iso).getTime();
    if (isNaN(t)) return { text: 'هنوز ثبت نشده', live: false };
    const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (m < 6) return { text: 'همین الان', live: true };
    if (m < 60) return { text: Utils.faNum(m) + ' دقیقه پیش', live: false };
    if (m < 1440) return { text: Utils.faNum(Math.floor(m / 60)) + ' ساعت پیش', live: false };
    return { text: Utils.faNum(Math.floor(m / 1440)) + ' روز پیش', live: false };
  }
  function seenHtml(u) {
    const s = seenAgo(u.last_seen_at);
    return `<div class="au-seen${s.live ? ' live' : ''}">آخرین فعالیت: ${s.text}</div>`;
  }

  function renderAdminUserCard(u) {
    const expVal = u.plan_expires_at ? String(u.plan_expires_at).slice(0, 10) : '';
    const now = Date.now();
    const exp = u.plan_expires_at ? new Date(u.plan_expires_at).getTime() : null;
    const isExpired = u.plan_status === 'suspended' || (exp !== null && !isNaN(exp) && exp < now);
    const isOwner = String(u.email || '').toLowerCase() === '1989alikh1368@gmail.com';
    let badge = '<span class="au-badge ok">فعال</span>';
    if (u.role === 'admin') badge = isOwner ? '<span class="au-badge owner">👑 مدیر اصلی</span>' : '<span class="au-badge admin">مدیر</span>';
    else if (isExpired) badge = '<span class="au-badge bad">غیرفعال</span>';
    const shown = u.full_name || u.email || '—';
    const initial = Array.from(String(shown).trim())[0] || '👤';
    const id = Utils.esc(u.id);
    return `
    <div class="au-card" data-au-search="${Utils.esc((String(u.full_name || '') + ' ' + String(u.email || '')).toLowerCase())}">
      ${u.role === 'admin' ? `<div class="au-head">
        <div class="au-avatar">${Utils.esc(initial.toUpperCase())}</div>
        <div class="au-info"><div class="au-name">${Utils.esc(shown)}</div><div class="au-mail" dir="ltr">${Utils.esc(u.email || 'ایمیل ثبت نشده')}</div>${seenHtml(u)}</div>
        ${badge}
      </div>` : `
      <details class="au-more">
      <summary class="au-head">
        <div class="au-avatar">${Utils.esc(initial.toUpperCase())}</div>
        <div class="au-info"><div class="au-name">${Utils.esc(shown)}</div><div class="au-mail" dir="ltr">${Utils.esc(u.email || 'ایمیل ثبت نشده')}</div>${seenHtml(u)}</div>
        ${badge}<span class="au-chev" aria-hidden="true">›</span>
      </summary>
      <div class="au-body">
        <label class="au-field"><span>💳 پلن</span>
          <select data-plan-name="${id}">
            <option value="trial" ${u.plan_name === 'trial' ? 'selected' : ''}>آزمایشی</option>
            <option value="basic" ${u.plan_name === 'basic' ? 'selected' : ''}>پایه</option>
            <option value="pro" ${u.plan_name === 'pro' ? 'selected' : ''}>حرفه‌ای</option>
            <option value="business" ${u.plan_name === 'business' ? 'selected' : ''}>سازمانی</option>
          </select>
        </label>
        <label class="au-field"><span>وضعیت</span>
          <select data-plan-status="${id}">
            <option value="active" ${u.plan_status !== 'suspended' ? 'selected' : ''}>فعال</option>
            <option value="suspended" ${u.plan_status === 'suspended' ? 'selected' : ''}>غیرفعال</option>
          </select>
        </label>
        <div class="au-field au-full"><span>📅 تاریخ انقضا</span>
          ${JDate.html('pe-' + u.id, expVal, { yearsBack: 0, yearsFwd: 8, attrs: 'data-plan-expires="' + id + '"' })}
        </div>
        <div class="au-actions">
          <button class="btn btn-primary" data-plan-save="${id}">💾 ذخیره اشتراک</button>
          <button class="btn btn-ghost au-del" data-user-archive="${id}" data-user-name="${Utils.esc(u.full_name || u.email || '')}">📦 بایگانی کاربر</button>
        </div>
      </div>
      </details>`}
    </div>`;
  }

  function wireUserSearch() {
    const inp = $id('admin-user-search');
    const wrap = $id('admin-content');
    if (!inp || !wrap) return;
    const norm = (t) => String(t || '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
    const apply = () => {
      const q = norm(inp.value);
      let shown = 0;
      let total = 0;
      wrap.querySelectorAll('.au-card').forEach((c) => {
        total++;
        const hit = !q || norm(c.getAttribute('data-au-search')).includes(q);
        c.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      wrap.querySelectorAll('.set-card').forEach((g) => {
        if (!g.querySelector('.au-card')) return;
        g.style.display = [...g.querySelectorAll('.au-card')].some((c) => c.style.display !== 'none') ? '' : 'none';
      });
      const cnt = $id('admin-user-count');
      if (cnt) cnt.textContent = q ? (Utils.faNum(shown) + ' از ' + Utils.faNum(total) + ' کاربر') : (Utils.faNum(total) + ' کاربر');
    };
    inp.addEventListener('input', apply);
    apply();
  }

  function renderArchivedUserCard(u) {
    const shown = u.full_name || u.email || '—';
    const initial = Array.from(String(shown).trim())[0] || '👤';
    const id = Utils.esc(u.id);
    const when = u.archived_at ? (Utils.faDate(u.archived_at)) : '';
    return `
    <div class="au-card" data-au-search="${Utils.esc((String(u.full_name || '') + ' ' + String(u.email || '')).toLowerCase())}">
      <div class="au-head">
        <div class="au-avatar">${Utils.esc(initial.toUpperCase())}</div>
        <div class="au-info">
          <div class="au-name">${Utils.esc(shown)}</div>
          <div class="au-mail" dir="ltr">${Utils.esc(u.email || 'ایمیل ثبت نشده')}</div>
        </div>
        <span class="au-badge bad">📦 بایگانی${when ? ' · ' + Utils.esc(when) : ''}</span>
      </div>
      <div class="au-actions" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px">
        <button class="btn btn-ghost" data-user-view="${id}" data-user-name="${Utils.esc(shown)}">👁 اطلاعات</button>
        <button class="btn btn-primary" data-user-restore="${id}">♻️ بازگردانی</button>
        <button class="btn btn-ghost au-del" data-user-del="${id}" data-user-email="${Utils.esc(u.email || '')}" data-user-name="${Utils.esc(shown)}">🗑 حذف</button>
      </div>
    </div>`;
  }

  function wireArchiveControls() {
    const wrap = $id('admin-content');
    if (!wrap) return;
    wrap.querySelectorAll('[data-user-archive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const who = btn.dataset.userName || 'این کاربر';
        const res = await showDialog({
          title: 'بایگانی کاربر',
          message: 'حساب «' + who + '» غیرفعال می‌شود و دیگر نمی‌تواند وارد شود، ولی اطلاعاتش می‌ماند و از بخش بایگانی قابل مشاهده و بازگردانی است.',
          buttons: [{ label: 'انصراف', value: false }, { label: 'بایگانی', value: true, kind: 'btn-primary' }]
        });
        if (!res) return;
        btn.disabled = true;
        try {
          await Backend.adminArchiveUser(btn.dataset.userArchive);
          showToast('کاربر بایگانی شد', 'ok');
          renderAdmin();
        } catch (e) { showToast('خطا: ' + Backend.faErr(e), 'error'); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll('[data-user-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await Backend.adminRestoreUser(btn.dataset.userRestore);
          showToast('کاربر بازگردانی شد', 'ok');
          renderAdmin();
        } catch (e) { showToast('خطا: ' + Backend.faErr(e), 'error'); btn.disabled = false; }
      });
    });
    wrap.querySelectorAll('[data-user-view]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const d = await Backend.adminUserData(btn.dataset.userView);
          const clients = d.clients || [];
          const listings = d.listings || [];
          const typeFa = { sale: 'فروش', mortgage: 'رهن و اجاره', rent: 'رهن و اجاره', buy: 'خرید' };
          const row = (a, b) => `<div class="od-info-row"><span class="lbl">${Utils.esc(a)}</span><span class="val" style="font-weight:400">${Utils.esc(b)}</span></div>`;
          const cHtml = clients.length ? clients.map((c) => row(c.name || '—', [typeFa[c.intent] || c.intent || '', c.phone || '', c.areas || ''].filter(Boolean).join(' · '))).join('') : '<div class="empty-state" style="padding:8px 0"><p>مشتری‌ای ثبت نشده.</p></div>';
          const lHtml = listings.length ? listings.map((l) => row((typeFa[l.type] || l.type || '') + ' — ' + (l.area || ''), [l.size ? l.size + ' متر' : '', l.price ? Utils.faNum(l.price) + ' تومان' : '', l.owner_name || '', l.owner_phone || ''].filter(Boolean).join(' · '))).join('') : '<div class="empty-state" style="padding:8px 0"><p>فایلی ثبت نشده.</p></div>';
          showSheet({
            title: '👁 ' + (btn.dataset.userName || 'اطلاعات کاربر'),
            html: `<div class="set-title">👥 مشتری‌ها (${Utils.faNum(clients.length)})</div>${cHtml}<div class="set-title" style="margin-top:12px">🏠 فایل‌ها (${Utils.faNum(listings.length)})</div>${lHtml}`,
            onMount() {}
          });
        } catch (e) { showToast('خطا: ' + Backend.faErr(e), 'error'); }
        btn.disabled = false;
      });
    });
  }

  function wireErrorLogControls() {
    const btn = $id('admin-clear-errors');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const res = await showDialog({
        title: 'پاک‌کردن لاگ خطاها',
        message: 'همهٔ لاگ‌های خطای ثبت‌شده پاک شوند؟',
        buttons: [{ label: 'انصراف', value: false }, { label: 'پاک کن', value: true, kind: 'btn-danger' }]
      });
      if (!res) return;
      try {
        await Backend.adminClearErrorLogs();
        showToast('لاگ‌ها پاک شدند', 'success');
        renderAdmin();
      } catch (e) { showToast('خطا: ' + Backend.faErr(e), 'error'); }
    });
  }

  function wireCompanyControls() {
    const wrap = $id('admin-content');
    if (!wrap) return;
    const addBtn = $id('admin-add-company');
    if (addBtn) addBtn.addEventListener('click', () => {
      showSheet({
        title: '🏢 شرکت جدید',
        html: `
          <div class="set-row"><label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام شرکت</label>
          <input type="text" id="new-company-name" placeholder="مثلاً داروخانه‌های البرز" autocomplete="off"></div>
          <div class="set-row" style="margin-top:8px"><label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">کد شرکت (برای ثبت‌نام کاربرها)</label>
          <input type="text" id="new-company-code" placeholder="مثلاً ALBORZ1404" autocomplete="off" dir="ltr"></div>
          <div class="dialog-btns" style="margin-top:12px">
            <button id="new-company-cancel" class="btn btn-ghost">انصراف</button>
            <button id="new-company-ok" class="btn btn-primary">ساخت شرکت</button>
          </div>`,
        onMount(body, close) {
          body.querySelector('#new-company-cancel').onclick = close;
          body.querySelector('#new-company-ok').onclick = async () => {
            const name = body.querySelector('#new-company-name').value.trim();
            const code = body.querySelector('#new-company-code').value.trim();
            if (!code) { showToast('کد شرکت را وارد کنید', 'error'); return; }
            try {
              await Backend.adminCreateCompany(name, code);
              close();
              showToast('شرکت ساخته شد ✓', 'success');
              renderAdmin();
            } catch (e) {
              showToast('خطا: ' + Backend.faErr(e), 'error');
            }
          };
        }
      });
    });
    wrap.querySelectorAll('[data-company-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.companyToggle;
        const nextActive = btn.dataset.active !== '1';
        try {
          await Backend.adminSetCompanyActive(id, nextActive);
          showToast(nextActive ? 'شرکت فعال شد' : 'شرکت غیرفعال شد — کد آن دیگر برای ثبت‌نام کار نمی‌کند', 'success');
          renderAdmin();
        } catch (e) {
          showToast('خطا: ' + Backend.faErr(e), 'error');
        }
      });
    });
  }

  function wirePlanControls() {
    const wrap = $id('admin-content');
    if (!wrap) return;
    wrap.querySelectorAll('[data-plan-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.planSave;
        const planName = wrap.querySelector(`[data-plan-name="${CSS.escape(userId)}"]`).value;
        const status = wrap.querySelector(`[data-plan-status="${CSS.escape(userId)}"]`).value;
        const expEl = wrap.querySelector(`[data-plan-expires="${CSS.escape(userId)}"]`);
        const dateVal = expEl.value;
        if (JDate.isPartial(expEl)) { showToast('تاریخ انقضا کامل یا معتبر نیست', 'error'); return; }
        const compEl = wrap.querySelector(`[data-plan-company="${CSS.escape(userId)}"]`);
        const companyName = compEl ? compEl.value.trim() : undefined;
        const expiresAt = dateVal ? new Date(dateVal + 'T23:59:59').toISOString() : null;
        btn.disabled = true; btn.textContent = 'در حال ذخیره…';
        try {
          await Backend.adminSetPlan(userId, { planName, expiresAt, status, companyName });
          showToast('اشتراک به‌روزرسانی شد', 'ok');
          renderAdmin();
        } catch (e) {
          showToast('خطا: ' + Backend.faErr(e), 'error');
          btn.disabled = false; btn.textContent = '💾 ذخیره اشتراک';
        }
      });
    });
  }

  /* حذف کامل یک کاربر توسط مدیر (حساب + داده‌های شخصی)؛ کاربر باید دوباره ثبت‌نام کند */
  function wireUserDeleteControls() {
    const wrap = $id('admin-content');
    if (!wrap) return;
    wrap.querySelectorAll('[data-user-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userDel;
        const email = btn.dataset.userEmail || '';
        const who = btn.dataset.userName || email || 'این کاربر';
        const res = await showDialog({
          title: 'حذف دائمی کاربر',
          message: 'حساب «' + who + '» و همه‌ی اطلاعات ثبت‌شده‌اش برای همیشه حذف می‌شود. این کار قابل برگشت نیست.',
          buttons: [{ label: 'انصراف', value: false }, { label: 'حذف دائمی', value: true, kind: 'btn-danger' }]
        });
        if (!res) return;
        btn.disabled = true;
        try {
          await Backend.adminDeleteUser(userId);
          showToast('کاربر حذف شد', 'success');
          renderAdmin();
        } catch (e) {
          btn.disabled = false;
          showToast('خطا: ' + Backend.faErr(e), 'error');
        }
      });
    });
  }

  function wireAdminList() {
    const list = $id('admin-content');
    if (!list) return;
    list.querySelectorAll('[data-admin-user]').forEach((card) => {
      card.addEventListener('click', async () => {
        const userId = card.dataset.adminUser;
        let orders;
        try {
          orders = await Backend.adminGetOrders(userId);
        } catch (err) {
          // قبلاً خطا بی‌صدا گم می‌شد و صفحه چیزی نشان نمی‌داد
          showToast('خطا در دریافت سفارش‌ها: ' + Backend.faErr(err) + ' | ' + String((err && err.message) || err).slice(0, 120), 'error');
          try { Backend.logError('admin-orders', err, 'admin').catch(() => {}); } catch (er) { /* بی‌اثر */ }
          return;
        }
        orders.forEach((o) => { if (!Array.isArray(o.items)) o.items = []; });
        $id('admin-content').innerHTML = `
          <button class="btn btn-ghost btn-sm" id="admin-back" style="margin-bottom:10px">→ بازگشت به کاربران</button>
          <div class="result-count">سفارش‌های این کاربر (${Utils.faNum(orders.length)})</div>
          ${orders.length ? orders.map((o) => `
            <div class="admin-order"><div class="order-card" style="cursor:pointer">
              <div class="oc-no">${Utils.faNum(o.no)}</div>
              <div class="oc-body">
                <div class="oc-title">سفارش شماره ${Utils.faNum(o.no)}</div>
                <div class="oc-sub">${Utils.faFullDate(o.createdAt)} — ${Utils.faTime(o.createdAt)} | ${Utils.faNum(o.items.length)} قلم${o.pharmacyName ? ' | ' + Utils.esc(o.pharmacyName) : ''}</div>
              </div>
              <div class="oc-total"><div class="t">${Utils.faNum(o.total)}</div><div class="d">تومان</div></div>
              <button class="oc-edit" data-admin-del="${o.id}" title="حذف سفارش" aria-label="حذف سفارش">🗑</button>
            </div>
            <div class="admin-order-detail" hidden>${adminOrderDetailHtml(o)}</div></div>`).join('') : '<div class="empty-state"><p>سفارشی ندارد.</p></div>'}
          <div class="dialog-btns" style="margin-top:12px">
            <button class="btn btn-ghost" id="admin-done" style="flex:1">تمام شد</button>
          </div>`;
        $id('admin-back').onclick = renderAdmin;
        $id('admin-done').onclick = renderAdmin;
        // با لمس هر سفارش، جزئیات اقلام (فقط‌خواندنی) باز/بسته می‌شود
        $id('admin-content').querySelectorAll('.admin-order .order-card').forEach((card) => card.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-admin-del]')) return;
          const d = card.parentElement.querySelector('.admin-order-detail');
          if (d) d.hidden = !d.hidden;
        }));
        $id('admin-content').querySelectorAll('[data-admin-copy]').forEach((b) => b.addEventListener('click', async () => {
          const ord = orders.find((x) => String(x.id) === String(b.dataset.adminCopy));
          if (ord) await adminCopyOrder(ord);
        }));
        const delBtns = $id('admin-content').querySelectorAll('[data-admin-del]');
        delBtns.forEach((b) => b.addEventListener('click', async () => {
          const res = await showDialog({
            title: 'حذف سفارش کاربر',
            message: 'این سفارش برای همیشه حذف شود؟',
            buttons: [
              { label: 'انصراف', value: false },
              { label: 'حذف', value: true, kind: 'btn-danger' }
            ]
          });
          if (res) {
            await Backend.adminDeleteOrder(b.dataset.adminDel);
            showToast('سفارش حذف شد');
            // نمایش دوباره سفارش‌های همان کاربر
            const orders2 = await Backend.adminGetOrders(userId);
            (b.closest('.admin-order') || b.closest('.order-card')).remove();
            if (!orders2.length) $id('admin-content').innerHTML = '<div class="empty-state"><p>سفارشی ندارد.</p></div>';
          }
        }));
      });
    });
  }

  /* ---------- صفحه اصلی ---------- */

  /* تاریخ امروز (شمسی) زیر عنوان نوار بالا؛ فقط در صفحه‌ی خانه */
  function paintHello() {
    const sub = $id('topbar-sub'); if (!sub) return;
    const j = Utils.toJalali(new Date());
    sub.textContent = state.screen === 'home' && j ? Utils.faWeekday(new Date()) + ' ' + Utils.faDigits(j.jd) + ' ' + Utils.JALALI_MONTHS[j.jm - 1] : '';
  }

  /* ---------- نوار یادآوری اعلان روی گوشی (صفحه‌ی اصلی) ---------- */
  const PUSH_SNOOZE_KEY = 'yane_push_snooze_until';
  async function paintPushBanner() {
    const home = $id('screen-home');
    if (!home) return;
    let bar = $id('push-banner');
    const hide = () => { if (bar) bar.hidden = true; };
    try {
      if (!Backend.isActive() || typeof Push === 'undefined') return hide();
      let until = 0;
      try { until = Number(localStorage.getItem(PUSH_SNOOZE_KEY) || 0); } catch (e) { /* بی‌اثر */ }
      if (until > Date.now()) return hide();
      const st = await Push.status();
      if (st.state !== 'off' && st.state !== 'install') return hide();
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'push-banner';
        bar.className = 'push-banner';
        home.insertBefore(bar, home.firstChild);
      }
      const isInstall = st.state === 'install';
      bar.innerHTML = `
        <div class="push-banner-text">🔔 ${isInstall
          ? 'برای دریافت اعلان درخواست بازدید روی آیفون، اول برنامه را به صفحه‌ی اصلی اضافه کن (Share ← Add to Home Screen).'
          : 'اعلان را فعال کن تا درخواست بازدید مشتری‌ها را فوری روی گوشی ببینی.'}</div>
        <div class="push-banner-actions">
          ${isInstall ? '' : '<button class="btn btn-primary btn-sm" id="push-banner-on">فعال کن</button>'}
          <button class="btn btn-ghost btn-sm" id="push-banner-later">بعداً</button>
        </div>`;
      bar.hidden = false;
      const later = $id('push-banner-later');
      if (later) later.onclick = () => {
        try { localStorage.setItem(PUSH_SNOOZE_KEY, String(Date.now() + 7 * 24 * 3600 * 1000)); } catch (e) { /* بی‌اثر */ }
        hide();
      };
      const on = $id('push-banner-on');
      if (on) on.onclick = async () => {
        on.disabled = true;
        try {
          await Push.enable();
          showToast('اعلان فعال شد', 'ok');
          hide();
        } catch (e) {
          showToast(e && e.userFacing ? e.message : 'فعال‌سازی اعلان انجام نشد', 'error');
          on.disabled = false;
        }
      };
    } catch (e) { hide(); }
  }

  async function renderHome() {
    paintHello();
    paintPushBanner();
    if (typeof Collab !== 'undefined') Collab.refreshBadge();
    if (typeof Help !== 'undefined') Help.paintTip();
    const products = Searcher.getProducts();
    const files = state.files;
    const lastUpd = [files[1], files[2]]
      .filter(Boolean)
      .map((f) => f.uploadedAt)
      .sort()
      .pop();
    const stats = [
      { num: Utils.faNum(products.length), label: 'محصول' },
      { num: lastUpd ? Utils.faDateShort(lastUpd) : '—', label: 'آخرین به‌روزرسانی' },
      { num: Utils.faNum(state.ordersTotalCount !== undefined ? state.ordersTotalCount : state.orders.length), label: 'سفارش' }
    ];
    $id('home-stats').innerHTML = stats.map((s) =>
      `<div class="stat-card"><div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div></div>`
    ).join('');
    if (products.length === 0) {
      $id('home-stats').innerHTML = `
        <div class="info-note" style="grid-column:1/-1">
          هنوز فایل انباری وارد نشده است. ابتدا از بخش «مدیریت فایل‌های انبار» فایل انبار خود (PDF / Excel / CSV) را وارد کنید.
        </div>`;
    }
    if (Backend.isActive()) Clients.updateBadge();
    if (window.APP_CONFIG && window.APP_CONFIG.crmOnly) { Today.render(); return; }   // نسخه‌ی CRM: نشان‌های انبار/ویزیت لازم نیست و جدولشان وجود ندارد
    const tpCard = document.querySelector('[data-action="target-pharmacies"]');
    if (tpCard) {
      if (!Backend.isActive()) { tpCard.hidden = true; }
      else { tpCard.hidden = false; updateTargetPharmacyBadge(); }
    }
    const snCard = $id('home-suggest-names'); // فقط با حساب کاربری/دیتابیس (ذخیره‌ی موقت نداریم)
    if (snCard) snCard.hidden = !Backend.isActive();
    const atCard = $id('home-product-attrs');
    if (atCard) atCard.hidden = !Backend.isActive();
    const wvCard = document.querySelector('[data-action="weekly-visits"]');
    if (wvCard) {
      if (!Backend.isActive()) { wvCard.hidden = true; }
      else { wvCard.hidden = false; updateWeeklyVisitBadge(); }
    }
  }

  /* ---------- صفحه محصولات ---------- */

  function onShowProducts() {
    $id('prod-search').value = state.searchQuery;
    syncChips();
    wireTagBar(); renderTagBar(); // نوار برند/دسته (فقط با حساب کاربری)
    renderResults();
  }

  function syncChips() {
    document.querySelectorAll('#wh-chips .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.wh === state.whFilter);
      if (c.dataset.wh === '1') c.textContent = state.settings.wh1Name;
      if (c.dataset.wh === '2') c.textContent = state.settings.wh2Name;
    });
  }

  function renderResults() {
    const q = state.searchQuery.trim();
    const wh = state.whFilter;
    let list = q
      ? Searcher.search(q, { warehouse: wh })
      : Searcher.browse(wh);
    list = applyTagFilter(list, q, wh); // فقط وقتی برند/دسته انتخاب شده؛ وگرنه بدون تغییر
    if (q) list = rankByAttrs(q, list); // فقط با مشخصه‌های تأییدشده؛ بدون آن‌ها ترتیب قبلی و بدون حذف نتیجه
    const sugg = q ? getSmartSuggestions(q, wh, list) : []; // موتور فهم نام محصولات (فقط پیشنهاد؛ نتایج فعلی دست‌نخورده)
    const tbody = $id('prod-tbody');
    const empty = $id('prod-empty');
    $id('prod-count').textContent = list.length
      ? Utils.faNum(list.length) + ' محصول' + (q ? ' برای «' + q + '»' : '')
      : '';

    if (!list.length && !sugg.length) {
      tbody.innerHTML = '';
      $id('prod-empty-text').textContent = q ? 'محصولی برای «' + q + '» پیدا نشد.' : 'محصولی در این انبار نیست.';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const showWh = wh === 'all';
    tbody.innerHTML = list.map((p) => {
      const key = Utils.esc(p.warehouse + '|' + p.code);
      const whBadge = showWh
        ? `<span class="wh-badge ${p.warehouse === '2' ? 'wh2' : ''}">${Utils.esc(whShort(p.warehouse))}</span>` : '';
      const manualBadge = p.manual ? '<span class="wh-badge" style="background:#fef3c7;color:#92400e">🆔 دستی</span>' : '';
      const noStock = p.stock === null || p.stock === undefined;
      const stockCls = noStock ? 'pc-stock-na' : (p.stock < 10 ? 'pc-stock-low' : '');
      const productAliases = Aliases.getFor(p.code);
      const aliasHtml = productAliases.length
        ? productAliases.map((a) => `<button type="button" class="pc-tag pc-alias" data-alias-manage="${key}">🏷 ${Utils.esc(a)}</button>`).join('')
        : `<button type="button" class="pc-tag pc-ico" data-alias-manage="${key}" aria-label="نام مستعار" title="نام مستعار">🏷</button>`;
      const pkInfo = PackSize.getFor(p.code);
      const packHtml = pkInfo
        ? `<button type="button" class="pc-tag pc-pack" data-packsize-manage="${key}" title="${pkInfo.note ? Utils.esc(pkInfo.note) : 'ویرایش بسته'}">📦 ${Utils.faNum(pkInfo.size)} تایی${pkInfo.note ? ' *' : ''}</button>`
        : `<button type="button" class="pc-tag pc-ico" data-packsize-manage="${key}" aria-label="تنظیم بسته" title="تنظیم بسته">📦</button>`;
      const snList = suggestNamesMap[String(p.code)];
      const snHtml = snList && snList.length
        ? `<button type="button" class="pc-tag pc-ico" data-sn-view="${key}" aria-label="اسم‌های پیشنهادی" title="اسم‌های پیشنهادی">🪟</button>` : '';
      const priceTxt = p.priceToman === null || p.priceToman === undefined ? '—' : Utils.faNum(p.priceToman);
      return `<tr class="pc-row" data-whkey="${key}"><td class="pc-cell">
        <div class="pc-codecol"><span class="pc-code">${Utils.esc(p.code || '—')}</span>${whBadge}${manualBadge}</div>
        <div class="pc-main">
          <div class="pc-name">${Utils.esc(p.name)}</div>
          <div class="pc-tags">${aliasHtml}${packHtml}${snHtml}</div>
        </div>
        <div class="pc-num ${stockCls}">${noStock ? '—' : Utils.faNum(p.stock)}</div>
        <div class="pc-num pc-price ${p.priceToman === null ? 'price-null' : ''}">${priceTxt}</div>
        <div class="pc-actions">
          <label class="pc-jor" title="جور" aria-label="جور">
            <input type="checkbox" class="jor-check" data-jor-toggle="${key}" ${state.jorSelection.has(p.warehouse + '|' + p.code) ? 'checked' : ''}>
            <span>⭐</span>
          </label>
          <button type="button" class="pc-add" data-add="${key}" aria-label="افزودن به سفارش">+</button>
        </div>
      </td></tr>`;
    }).join('');
    if (sugg.length) tbody.insertAdjacentHTML('beforeend', smartSuggestHtml(sugg));
  }

  /* ---------- پیشنهادهای هوشمند نام محصول (SmartNames) ----------
     فقط محصولات واقعی انبار؛ هیچ انتخاب/افزودن خودکاری انجام نمی‌شود.
     هر خطایی در این بخش بی‌صدا نادیده گرفته می‌شود تا جست‌وجوی اصلی هرگز آسیب نبیند. */
  let smartAliasHooked = false;
  function getSmartSuggestions(q, wh, list) {
    try {
      if (typeof SmartNames === 'undefined') return [];
      hookAttrs();
      if (!smartAliasHooked) { SmartNames.setAliasLookup((c) => Aliases.getFor(c).concat(tagNamesByCode[String(c)] || [])); smartAliasHooked = true; } // «اسم‌های پیشنهادی» عمداً روی جست‌وجو اثر ندارند؛ فقط با آیکون 🪟 کنار محصول دیده می‌شوند
      const exclude = new Set(list.map((p) => p.warehouse + '|' + p.code));
      const res = SmartNames.suggest(q, Searcher.getProducts(), { warehouse: wh, exclude, limit: 30 });
      return tagFilterActive() ? res.filter((x) => passesTagFilter(x.p)) : res;
    } catch (e) { return []; }
  }

  function smartSuggestHtml(sugg) {
    try {
      const showWh = state.whFilter === 'all';
      const head = `<tr class="pc-suggest-head"><td class="pc-cell">💡 پیشنهادهای مرتبط — انتخاب با شماست</td></tr>`;
      const rows = sugg.map(({ p, tier, why, weak }) => {
        const key = Utils.esc(p.warehouse + '|' + p.code);
        const whBadge = showWh ? `<span class="wh-badge ${p.warehouse === '2' ? 'wh2' : ''}">${Utils.esc(whShort(p.warehouse))}</span>` : '';
        const noStock = p.stock === null || p.stock === undefined;
        const stockCls = noStock ? 'pc-stock-na' : (p.stock < 10 ? 'pc-stock-low' : '');
        const priceTxt = p.priceToman === null || p.priceToman === undefined ? '—' : Utils.faNum(p.priceToman);
        const atOpenAttr = Backend.isActive() ? ` data-at-open="${Utils.esc(p.code)}" style="cursor:pointer" title="ویرایش مشخصه‌های محصول"` : '';
        const tags = why.map((w) => `<span class="pc-tag pc-suggest-tag"${atOpenAttr}>${Utils.esc(w)}</span>`).join('') +
          (tier === 2 ? ((weak && weak.length) ? Array.from(new Set(weak)) : ['نوع پوست/ویژگی در نام ذکر نشده']).map((w) => `<span class="pc-tag pc-suggest-tag pc-suggest-weak"${atOpenAttr}>${Utils.esc(w)}</span>`).join('') : '');
        return `<tr class="pc-row pc-suggest-row" data-whkey="${key}"><td class="pc-cell">
          <div class="pc-codecol"><span class="pc-code">${Utils.esc(p.code || '—')}</span>${whBadge}</div>
          <div class="pc-main"><div class="pc-name">${Utils.esc(p.name)}</div><div class="pc-tags">${tags}</div></div>
          <div class="pc-num ${stockCls}">${noStock ? '—' : Utils.faNum(p.stock)}</div>
          <div class="pc-num pc-price ${p.priceToman === null ? 'price-null' : ''}">${priceTxt}</div>
          <div class="pc-actions">
            <label class="pc-jor" title="جور" aria-label="جور"><input type="checkbox" class="jor-check" data-jor-toggle="${key}" ${state.jorSelection.has(p.warehouse + '|' + p.code) ? 'checked' : ''}><span>⭐</span></label>
            <button type="button" class="pc-add" data-add="${key}" aria-label="افزودن به سفارش">+</button>
          </div>
        </td></tr>`;
      }).join('');
      return head + rows;
    } catch (e) { return ''; }
  }


  /* ---------- مشخصه‌های محصول (جدول product_attrs؛ مشترک در شرکت) ----------
     نوع محصول (فوم/ژل/کرم/شامپو…)، نوع پوست و حجم هر کد کالا. فقط «تأییدشده‌ها» روی جست‌وجو اثر دارند؛
     «پیشنهادی‌ها» (حدس خودکار از نام) تا تأیید شما هیچ اثری ندارند. جدول‌های فعلی دست‌نخورده‌اند. */
  let attrsMap = {}; // { [code]: { form, skins[], uses[], volume, status } }
  let attrsHooked = false;
  let attrsWired = false;
  let atGroups = [];
  const atOpen = new Set();

  function hookAttrs() {
    if (attrsHooked || typeof SmartNames === 'undefined') return;
    SmartNames.setAttrsLookup((c) => attrsMap[String(c)] || null);
    attrsHooked = true;
  }
  async function loadAttrsTask() {
    if (!Backend.isActive() || Backend.isOffline()) return;
    try { attrsMap = await Backend.getProductAttrs(); } catch (e) { attrsMap = {}; /* جدول هنوز ساخته نشده: بی‌صدا */ }
    try { registerAttrTypes(await Backend.getAttrTypes()); } catch (e) { /* جدول انواع سفارشی هنوز ساخته نشده: بی‌صدا */ }
    hookAttrs();
  }
  // نوع محصول / کاربردِ سفارشی کاربر → فرهنگ موتور (شناسه‌ی c-<id>)
  function registerAttrTypes(list) {
    if (typeof SmartNames === 'undefined') return;
    SmartNames.extend((list || []).map((t) => ({
      id: 'c-' + t.id,
      type: t.kind === 'use' ? 'use' : 'form',
      label: t.label,
      phrases: (t.phrases && t.phrases.length) ? t.phrases : [t.label],
      dom: t.dom || undefined,
      anchor: t.kind !== 'use'
    })));
  }
  // مواردی که خود کاربر ساخته (شناسه c-…) اول لیست می‌آیند تا پیدا شوند
  const customFirst = (arr) => arr.filter((g) => String(g.id).startsWith('c-')).concat(arr.filter((g) => !String(g.id).startsWith('c-')));
  const AT_SKINTYPES = ['s-oily', 's-dry', 's-sensitive', 's-combo', 's-normal', 's-acne', 's-all'];

  // شیت افزودن نوع محصول یا کاربرد جدید؛ onDone بعد از ثبت موفق صدا زده می‌شود
  function openAttrTypeSheet(onDone) {
    showSheet({
      title: '➕ نوع محصول یا کاربرد جدید',
      html: `
        <label style="font-size:12.5px">این مورد چیست؟</label>
        <select id="att-kind" style="width:100%;margin:4px 0 8px"><option value="form">نوع محصول (مثل فوم، مسواک، پن)</option><option value="use">کاربرد (مثل ضد خارش)</option></select>
        <label style="font-size:12.5px">نام</label>
        <input id="att-label" type="text" style="width:100%;margin:4px 0 8px" placeholder="مثلاً: ضد خارش">
        <label style="font-size:12.5px">عبارت‌هایی که مردم برای آن می‌گویند (با ویرگول جدا کنید)</label>
        <textarea id="att-phrases" rows="3" style="width:100%;margin:4px 0 8px" placeholder="مثلاً: خارش، سوزش، التهاب"></textarea>
        <label style="font-size:12.5px">حوزه (فقط اگر مو یا دهان است)</label>
        <select id="att-dom" style="width:100%;margin:4px 0 10px"><option value="">— ندارد —</option><option value="hair">مو</option><option value="oral">دهان و دندان</option></select>
        <button class="btn btn-primary btn-lg" id="att-save">ثبت</button>
        <div class="dialog-btns" style="margin-top:10px"><button class="btn btn-ghost" id="att-cancel" style="flex:1">انصراف</button></div>`,
      onMount(body, close) {
        body.querySelector('#att-cancel').onclick = () => { close(); if (onDone) onDone(); };
        body.querySelector('#att-save').onclick = async () => {
          const label = body.querySelector('#att-label').value.trim();
          if (!label) { showToast('نام را بنویسید', 'error'); return; }
          const phrases = Array.from(new Set([label].concat(body.querySelector('#att-phrases').value.split(/[\n,،;؛]+/).map((x) => x.trim()).filter(Boolean))));
          try {
            const r = await Backend.addAttrType({ kind: body.querySelector('#att-kind').value, label, phrases, dom: body.querySelector('#att-dom').value || null });
            if (r.dup) { showToast('این مورد قبلاً ثبت شده', 'error'); return; }
            registerAttrTypes([r.row]);
          } catch (err) { showToast('ثبت نشد. SQL جدول انواع (مایگریشن ۲۰۲۶۱۰۱۹) اجرا شده؟', 'error'); return; }
          showToast('ثبت شد', 'success');
          close(); if (onDone) onDone();
        };
      }
    });
  }

  // ذخیره‌ی سریع از ردیف «ناقص»
  async function quickSaveAttr(btn) {
    const wrap = btn.closest('[data-at-quick]');
    if (!wrap) return;
    const code = wrap.dataset.atQuick;
    const p = Searcher.getProducts().find((x) => String(x.code) === String(code));
    if (!p) return;
    const form = wrap.querySelector('[data-q="form"]').value;
    if (!form) { showToast('نوع محصول را انتخاب کنید', 'error'); return; }
    const volTxt = wrap.querySelector('[data-q="vol"]').value.trim();
    const volKey = volTxt ? SmartNames.volumeOf(volTxt) : null;
    if (volTxt && !volKey) { showToast('حجم را مثل «۱۰۰ میل» یا «۵۰ گرم» بنویسید', 'error'); return; }
    const cur = attrsMap[String(code)] || null;
    const base = cur || SmartNames.inferAttrs(p.name || '');
    const extras = (base.skins || []).filter((id) => !AT_SKINTYPES.includes(id));
    const skin = wrap.querySelector('[data-q="skin"]').value;
    btn.disabled = true;
    try {
      const useSel = wrap.querySelector('[data-q="use"]').value;
      const uses = (base.uses || []).concat(useSel && !(base.uses || []).includes(useSel) ? [useSel] : []);
      await saveAttrRows([{ code, form, skins: extras.concat(skin ? [skin] : []), uses, volume: volKey, status: 'confirmed' }]);
      showToast('ذخیره شد', 'success');
    } catch (err) { showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error'); btn.disabled = false; return; }
    renderAttrs();
  }
  function attrsAny() { for (const k in attrsMap) return true; return false; }
  // مرتب‌سازی نتایج جست‌وجوی اصلی با مشخصه‌های تأییدشده (هیچ نتیجه‌ای حذف نمی‌شود)
  function rankByAttrs(q, list) {
    try {
      if (typeof SmartNames === 'undefined' || !attrsAny()) return list;
      hookAttrs();
      return SmartNames.rank(q, list);
    } catch (e) { return list; }
  }
  function uniqByCode(list) {
    const seen = new Set();
    return list.filter((p) => !seen.has(p.code) && seen.add(p.code));
  }
  function volLabel(v) { return v ? String(v).replace(/ml$/, ' میل').replace(/g$/, ' گرم') : ''; }
  function attrParts(a, withVol) {
    const parts = [a && a.form ? SmartNames.labelOf(a.form) : 'نوع محصول نامشخص'];
    ((a && a.skins) || []).forEach((id) => parts.push(SmartNames.labelOf(id)));
    if (withVol && a && a.volume) parts.push(volLabel(a.volume));
    return parts;
  }
  async function saveAttrRows(rows) {
    await Backend.upsertProductAttrs(rows);
    rows.forEach((r) => { attrsMap[String(r.code)] = { form: r.form || null, skins: r.skins || [], uses: r.uses || [], volume: r.volume || null, status: r.status }; });
  }

  function renderAttrs() {
    const list = $id('at-list'), emptyEl = $id('at-empty');
    if (!attrsWired) {
      attrsWired = true;
      let tmr = null;
      $id('at-search').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(renderAttrs, 150); });
      $id('at-filter').addEventListener('change', renderAttrs);
      $id('at-auto').addEventListener('click', autoSuggestAttrs);
      $id('at-newtype').addEventListener('click', () => openAttrTypeSheet(renderAttrs));
      list.addEventListener('click', async (e) => {
        const qs = e.target.closest('[data-at-qsave]');
        if (qs) { await quickSaveAttr(qs); return; }
        const ed = e.target.closest('[data-at-edit]');
        if (ed) { openAttrEditSheet(ed.dataset.atEdit); return; }
        const tg = e.target.closest('[data-at-toggle]');
        if (tg) { const k = tg.dataset.atToggle; if (atOpen.has(k)) atOpen.delete(k); else atOpen.add(k); renderAttrs(); return; }
        const cf = e.target.closest('[data-at-confirm]');
        if (cf) {
          const g = atGroups[Number(cf.dataset.atConfirm)];
          if (!g) return;
          cf.disabled = true;
          try {
            await saveAttrRows(g.entries.map(({ p, a }) => ({ code: p.code, form: a.form, skins: a.skins, uses: a.uses, volume: a.volume, status: 'confirmed' })));
            showToast(Utils.faNum(g.entries.length) + ' محصول تأیید شد', 'success');
          } catch (err) { showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error'); }
          renderAttrs();
        }
      });
    }
    if (!Backend.isActive()) {
      list.innerHTML = ''; $id('at-stats').textContent = '';
      $id('at-empty-text').textContent = 'این بخش فقط با ورود به حساب کاربری و اتصال به سرور کار می‌کند.';
      emptyEl.hidden = false;
      return;
    }
    hookAttrs();
    const all = uniqByCode(Searcher.getProducts());
    let nConf = 0, nSug = 0;
    all.forEach((p) => { const a = attrsMap[String(p.code)]; if (a) { if (a.status === 'confirmed') nConf++; else nSug++; } });
    $id('at-stats').textContent = 'کل محصولات: ' + Utils.faNum(all.length) + ' — تأییدشده: ' + Utils.faNum(nConf) + ' — پیشنهادی: ' + Utils.faNum(nSug) + ' — بدون مشخصه: ' + Utils.faNum(all.length - nConf - nSug);
    const q = ($id('at-search').value || '').trim();
    const f = $id('at-filter').value;
    const base = q ? uniqByCode(Searcher.search(q, { warehouse: 'all', limit: 300 })) : all;
    const entries = base.map((p) => ({ p, a: attrsMap[String(p.code)] || null })).filter(({ a }) => {
      if (f === 'suggested') return a && a.status === 'suggested' && a.form;
      if (f === 'confirmed') return a && a.status === 'confirmed';
      return !a || (a.status === 'suggested' && !a.form); // incomplete
    });
    if (!entries.length) {
      list.innerHTML = ''; atGroups = [];
      $id('at-empty-text').textContent = f === 'suggested' ? 'پیشنهادی در انتظار تأیید نیست. «ساخت پیشنهاد خودکار» را بزنید.' : (f === 'confirmed' ? 'هنوز مشخصه‌ای تأیید نشده.' : 'محصول ناقصی نیست.');
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    const rowHtml = ({ p, a }) => `<div class="pc-row" data-at-edit="${Utils.esc(p.code)}" style="cursor:pointer;padding:6px 0;border-top:1px solid var(--border,#eee)">
        <span class="pc-code">${Utils.esc(p.code || '—')}</span>
        <div class="pc-name">${Utils.esc(p.name)}</div>${a && a.volume ? `<span class="pc-tag">${Utils.esc(volLabel(a.volume))}</span>` : ''}</div>`;
    if (f === 'incomplete') {
      atGroups = [];
      const formOpts = customFirst(SmartNames.groupsOfType('form'));
      const useOpts = customFirst(SmartNames.groupsOfType('use'));
      const skinOpts = SmartNames.groupsOfType('skin').filter((g) => AT_SKINTYPES.includes(g.id));
      const opt = (g, sel) => `<option value="${Utils.esc(g.id)}" ${g.id === sel ? 'selected' : ''}>${Utils.esc(g.label)}</option>`;
      const quickRow = ({ p, a }) => {
        const base = a || SmartNames.inferAttrs(p.name || '');
        const skinSel = (base.skins || []).find((id) => AT_SKINTYPES.includes(id)) || '';
        const key = Utils.esc(p.code);
        return `<div data-at-quick="${key}" style="padding:8px 0;border-top:1px solid var(--border,#eee)">
          <div data-at-edit="${key}" style="cursor:pointer"><span class="pc-code">${Utils.esc(p.code || '—')}</span><div class="pc-name">${Utils.esc(p.name)}</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            <select data-q="form" style="flex:1 1 120px"><option value="">نوع محصول…</option>${formOpts.map((g) => opt(g, base.form)).join('')}</select>
            <select data-q="skin" style="flex:1 1 120px"><option value="">بدون نوع پوست خاص</option>${skinOpts.map((g) => opt(g, skinSel)).join('')}</select>
            <select data-q="use" style="flex:1 1 120px"><option value="">+ کاربرد (اختیاری)</option>${useOpts.map((g) => opt(g, '')).join('')}</select>
            <input data-q="vol" type="text" placeholder="حجم" value="${Utils.esc(base.volume ? volLabel(base.volume) : '')}" style="flex:1 1 70px;max-width:100px">
            <button type="button" class="btn btn-primary" data-at-qsave="${key}">✅ ذخیره</button>
          </div></div>`;
      };
      list.innerHTML = '<div class="set-card">' + entries.slice(0, 150).map(quickRow).join('') + '</div>' + (entries.length > 150 ? '<div style="font-size:12px;color:var(--muted);margin:6px 2px">… و ' + Utils.faNum(entries.length - 150) + ' محصول دیگر (جستجو کنید)</div>' : '');
      return;
    }
    const groups = new Map();
    entries.forEach((e) => {
      const k = attrParts(e.a, false).join(' · ');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    });
    atGroups = Array.from(groups.entries()).sort((x, y) => y[1].length - x[1].length).map(([key, ents]) => ({ key, entries: ents }));
    list.innerHTML = atGroups.map((g, i) => {
      const open = atOpen.has(g.key);
      const shown = open ? g.entries : g.entries.slice(0, 5);
      return `<div class="set-card" style="margin-bottom:10px">
        <div style="font-weight:600;margin-bottom:6px">${Utils.esc(g.key)} <span style="color:var(--muted);font-weight:400">(${Utils.faNum(g.entries.length)} محصول)</span></div>
        ${f === 'suggested' ? `<button type="button" class="btn btn-primary" data-at-confirm="${i}" style="width:100%;margin-bottom:6px">✅ تأیید همه‌ی ${Utils.faNum(g.entries.length)} محصول این گروه</button>` : ''}
        ${shown.map(rowHtml).join('')}
        ${g.entries.length > 5 ? `<button type="button" class="btn btn-ghost" data-at-toggle="${Utils.esc(g.key)}" style="width:100%;margin-top:6px">${open ? 'بستن' : 'نمایش همه'}</button>` : ''}
      </div>`;
    }).join('');
  }

  // پیشنهاد خودکار از روی نام: فقط برای محصولاتی که هنوز ردیفی ندارند؛ ردیف‌های موجود هرگز بازنویسی نمی‌شوند
  async function autoSuggestAttrs() {
    if (!Backend.isActive() || Backend.isOffline()) { showToast('اتصال به سرور برقرار نیست', 'error'); return; }
    const rows = [];
    uniqByCode(Searcher.getProducts()).forEach((p) => {
      if (attrsMap[String(p.code)]) return;
      const r = SmartNames.inferAttrs(p.name || '');
      if (!r.form && !r.skins.length && !r.uses.length && !r.volume) return;
      rows.push({ code: p.code, form: r.form, skins: r.skins, uses: r.uses, volume: r.volume, status: 'suggested' });
    });
    if (!rows.length) { showToast('محصول جدیدی برای پیشنهاد نبود'); return; }
    const btn = $id('at-auto'); btn.disabled = true;
    try {
      await saveAttrRows(rows);
      showToast(Utils.faNum(rows.length) + ' پیشنهاد ساخته شد (تا تأیید شما اثری ندارند)', 'success');
    } catch (err) { showToast('ذخیره نشد. SQL مایگریشن اجرا شده؟ اتصال را هم بررسی کنید.', 'error'); }
    btn.disabled = false;
    renderAttrs();
  }

  function openAttrEditSheet(code) {
    const p = Searcher.getProducts().find((x) => String(x.code) === String(code));
    if (!p) return;
    const cur = attrsMap[String(code)] || null;
    const inf = cur ? null : SmartNames.inferAttrs(p.name || '');
    const form = cur ? cur.form : (inf && inf.form);
    const skins = new Set(cur ? cur.skins : (inf ? inf.skins : []));
    const uses = new Set(cur ? cur.uses : (inf ? inf.uses : []));
    const vol = cur ? cur.volume : (inf && inf.volume);
    const chk = (g, set, nm) => `<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:13px"><input type="checkbox" data-${nm}="${Utils.esc(g.id)}" ${set.has(g.id) ? 'checked' : ''}> ${Utils.esc(g.label)}</label>`;
    showSheet({
      title: '🧪 مشخصه‌های محصول',
      html: `
        <div class="pc-name" style="margin-bottom:8px">${Utils.esc(p.name)} <span class="pc-code">${Utils.esc(p.code)}</span></div>
        <label style="font-size:12.5px">نوع محصول</label>
        <select id="ate-form" style="width:100%;margin:4px 0 8px"><option value="">— نامشخص —</option>${customFirst(SmartNames.groupsOfType('form')).map((g) => `<option value="${Utils.esc(g.id)}" ${g.id === form ? 'selected' : ''}>${Utils.esc(g.label)}</option>`).join('')}</select>
        <label style="font-size:12.5px">نوع پوست / ویژگی</label>
        <div style="margin:4px 0 8px">${SmartNames.groupsOfType('skin').map((g) => chk(g, skins, 'ate-skin')).join('')}</div>
        <label style="font-size:12.5px">کاربرد</label>
        <div style="margin:4px 0 8px;max-height:240px;overflow:auto">${customFirst(SmartNames.groupsOfType('use')).map((g) => chk(g, uses, 'ate-use')).join('')}</div>
        <label style="font-size:12.5px">حجم / وزن (مثلاً ۱۰۰ میل یا ۵۰ گرم)</label>
        <input id="ate-vol" type="text" value="${Utils.esc(vol ? volLabel(vol) : '')}" style="width:100%;margin:4px 0 10px">
        <button class="btn btn-primary btn-lg" id="ate-save">✅ تأیید و ذخیره</button>
        <div class="dialog-btns" style="margin-top:10px">
          ${cur ? '<button class="btn btn-ghost" id="ate-del" style="flex:1">حذف مشخصه‌ها</button>' : ''}
          <button class="btn btn-ghost" id="ate-newtype" style="flex:1">➕ نوع/کاربرد جدید</button>
          <button class="btn btn-ghost" id="ate-cancel" style="flex:1">انصراف</button>
        </div>`,
      onMount(body, close) {
        body.querySelector('#ate-cancel').onclick = close;
        body.querySelector('#ate-newtype').onclick = () => openAttrTypeSheet(() => openAttrEditSheet(code));
        const del = body.querySelector('#ate-del');
        if (del) del.onclick = async () => {
          try { await Backend.deleteProductAttrs([code]); delete attrsMap[String(code)]; } catch (err) { showToast('حذف نشد. دوباره تلاش کنید.', 'error'); return; }
          close(); refreshAfterAttrs();
        };
        body.querySelector('#ate-save').onclick = async () => {
          const volTxt = body.querySelector('#ate-vol').value.trim();
          const volKey = volTxt ? SmartNames.volumeOf(volTxt) : null;
          if (volTxt && !volKey) { showToast('حجم را مثل «۱۰۰ میل» یا «۵۰ گرم» بنویسید', 'error'); return; }
          const row = {
            code,
            form: body.querySelector('#ate-form').value || null,
            skins: Array.from(body.querySelectorAll('[data-ate-skin]:checked')).map((i) => i.dataset.ateSkin),
            uses: Array.from(body.querySelectorAll('[data-ate-use]:checked')).map((i) => i.dataset.ateUse),
            volume: volKey,
            status: 'confirmed'
          };
          try { await saveAttrRows([row]); } catch (err) { showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error'); return; }
          close(); refreshAfterAttrs();
        };
      }
    });
  }
  function refreshAfterAttrs() {
    if (state.screen === 'product-attrs') renderAttrs();
    else if (state.screen === 'products') renderResults();
  }

  /* ---------- مدیریت اسم‌های پیشنهادی محصولات ----------
     داده در جدول product_suggest_names (مشترک در شرکت) ذخیره می‌شود و موتور SmartNames از آن
     برای پیشنهاد محصولات مرتبط استفاده می‌کند. جدا از نام‌های مستعار؛ هیچ ذخیره‌ی محلی/موقت ندارد.
     canEditSuggestNames: فعلاً همه‌ی کاربران واردشده؛ برای قفل «فقط مدیر» بعداً همین یک تابع
     (و policyهای دیتابیس) عوض می‌شود. */
  let suggestNamesMap = {}; // { [code]: [name,...] }
  let snSelMode = false;     // حالت «انتخاب چند محصول» برای ثبت گروهی
  const snSel = new Set();   // کلیدهای انتخاب‌شده: 'انبار|کد'
  let snShown = [];          // محصولات نمایش‌داده‌شده‌ی فعلی
  function canEditSuggestNames() { return Backend.isActive(); }
  const snKey = (t) => (typeof SmartNames !== 'undefined' ? SmartNames.normText(t) : String(t || '').trim().toLowerCase()).replace(/ /g, '');

  async function loadSuggestNamesTask() {
    if (!Backend.isActive() || Backend.isOffline()) return;
    try { suggestNamesMap = await Backend.getSuggestNames(); } catch (e) { suggestNamesMap = {}; /* جدول هنوز ساخته نشده یا قطع اتصال: بی‌صدا؛ بقیه‌ی اپ بی‌تأثیر */ }
  }

  let snWired = false;
  function renderSuggestNames() {
    const list = $id('sn-list'), emptyEl = $id('sn-empty'), countEl = $id('sn-count');
    if (!snWired) {
      snWired = true;
      let tmr = null;
      $id('sn-search').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(renderSuggestNames, 150); });
      list.addEventListener('click', (e) => {
        const row = e.target.closest('[data-sn-key]');
        if (!row) return;
        if (snSelMode) {
          const k = row.dataset.snKey;
          if (snSel.has(k)) snSel.delete(k); else snSel.add(k);
          renderSuggestNames();
          return;
        }
        const p = findProductByWhKey(row.dataset.snKey);
        if (p) openSuggestNamesSheet(p);
      });
      $id('sn-sel-toggle').addEventListener('click', () => {
        snSelMode = !snSelMode;
        if (!snSelMode) snSel.clear();
        renderSuggestNames();
      });
      $id('sn-sel-all').addEventListener('click', () => {
        snShown.forEach((p) => snSel.add(p.warehouse + '|' + p.code));
        renderSuggestNames();
      });
      $id('sn-bulk-btn').addEventListener('click', () => { if (snSel.size) openBulkSuggestSheet(); });
    }
    if (!Backend.isActive()) {
      list.innerHTML = ''; countEl.textContent = '';
      $id('sn-empty-text').textContent = 'این بخش فقط با ورود به حساب کاربری و اتصال به سرور کار می‌کند.';
      emptyEl.hidden = false;
      return;
    }
    const q = ($id('sn-search').value || '').trim();
    let products;
    if (q) products = Searcher.search(q, { warehouse: 'all', limit: 60 });
    else {
      const seen = new Set();
      products = Searcher.getProducts().filter((p) => suggestNamesMap[String(p.code)] && !seen.has(p.code) && seen.add(p.code)).slice(0, 100);
    }
    snShown = products;
    $id('sn-sel-toggle').textContent = snSelMode ? '✖️ خروج از انتخاب' : '☑️ انتخاب چند محصول';
    $id('sn-sel-all').hidden = !snSelMode || !products.length;
    const bulkBtn = $id('sn-bulk-btn');
    bulkBtn.hidden = !(snSelMode && snSel.size);
    bulkBtn.textContent = '➕ ثبت اسم برای ' + Utils.faNum(snSel.size) + ' محصول انتخاب‌شده';
    countEl.textContent = q ? Utils.faNum(products.length) + ' محصول' : (products.length ? 'محصولاتی که اسم ثبت‌شده دارند' : '');
    if (!products.length) {
      list.innerHTML = '';
      $id('sn-empty-text').textContent = q ? 'محصولی پیدا نشد.' : 'هنوز اسمی ثبت نشده. بالا محصول را جستجو کنید.';
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    list.innerHTML = products.map((p) => {
      const names = suggestNamesMap[String(p.code)] || [];
      const key = Utils.esc(p.warehouse + '|' + p.code);
      const tags = names.length
        ? names.slice(0, 6).map((n) => `<span class="pc-tag pc-alias">${Utils.esc(n)}</span>`).join('') + (names.length > 6 ? `<span class="pc-tag">+${Utils.faNum(names.length - 6)}</span>` : '')
        : '<span class="pc-tag pc-ico">🏷 افزودن اسم</span>';
      const sel = snSel.has(p.warehouse + '|' + p.code);
      return `<div class="set-card sn-row ${sel ? 'sn-selected' : ''}" data-sn-key="${key}" style="cursor:pointer">
        <div class="pc-codecol">${snSelMode ? `<span class="sn-check">${sel ? '✅' : '⬜'}</span>` : ''}<span class="pc-code">${Utils.esc(p.code || '—')}</span></div>
        <div class="pc-name">${Utils.esc(p.name)}</div>
        <div class="pc-tags">${tags}</div>
      </div>`;
    }).join('');
  }

  /* ثبت گروهی: یک بار نوشتن اسم‌ها برای همه‌ی محصولات انتخاب‌شده (مثلاً همه‌ی محصولات یک سری) */
  function openBulkSuggestSheet() {
    const keys = Array.from(snSel);
    const prods = keys.map(findProductByWhKey).filter(Boolean);
    const codes = Array.from(new Set(prods.map((p) => String(p.code))));
    if (!codes.length) return;
    const preview = prods.slice(0, 5).map((p) => '• ' + Utils.esc(p.name)).join('<br>') + (prods.length > 5 ? '<br>… و ' + Utils.faNum(prods.length - 5) + ' محصول دیگر' : '');
    showSheet({
      title: '🏷 ثبت گروهی اسم — ' + Utils.faNum(codes.length) + ' محصول',
      html: `
        <div class="qty-sheet-info" style="font-size:12.5px;line-height:1.9">${preview}</div>
        <p style="font-size:12.5px;color:var(--muted);margin:8px 0">اسم‌ها برای همه‌ی محصولات بالا ثبت می‌شوند (با ویرگول یا خط جدید جدا کنید). مثلاً: سیکالیفت، ترمیم‌کننده</p>
        <textarea id="snb-input" rows="3" style="width:100%" placeholder="مثلاً: سیکالیفت، ترمیم‌کننده درمالیفت"></textarea>
        <button class="btn btn-primary btn-lg" id="snb-save" style="margin-top:8px">ثبت برای همه</button>
        <div class="dialog-btns" style="margin-top:12px"><button class="btn btn-ghost" id="snb-cancel" style="flex:1">انصراف</button></div>`,
      onMount(body, close) {
        const input = body.querySelector('#snb-input');
        body.querySelector('#snb-cancel').onclick = close;
        body.querySelector('#snb-save').onclick = async () => {
          if (!canEditSuggestNames()) return;
          const names = Array.from(new Map((input.value || '').split(/[\n,،;؛]+/).map((x) => x.trim()).filter(Boolean).map((x) => [snKey(x), x])).values());
          if (!names.length) { showToast('اسمی نوشته نشده', 'error'); return; }
          try {
            await Backend.addSuggestNamesBulk(codes, names);
          } catch (err) {
            showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
            return;
          }
          let added = 0;
          codes.forEach((c) => {
            const cur = suggestNamesMap[c] || [];
            names.forEach((nm) => {
              if (!cur.some((x) => snKey(x) === snKey(nm))) { cur.push(nm); added++; }
            });
            suggestNamesMap[c] = cur;
          });
          close();
          snSelMode = false; snSel.clear();
          renderSuggestNames();
          showToast(added ? Utils.faNum(added) + ' اسم ثبت شد ✓' : 'همه‌ی این اسم‌ها از قبل ثبت شده بودند', added ? 'success' : undefined);
        };
        setTimeout(() => input.focus(), 60);
      }
    });
  }

  function openSuggestNamesSheet(product) {
    const code = String(product.code);
    showSheet({
      title: '🏷 اسم‌های پیشنهادی — ' + product.name,
      html: `
        <div class="qty-sheet-info">کد: ${Utils.esc(product.code)}</div>
        <p style="font-size:12.5px;color:var(--muted);margin:6px 0 10px">هر اسمی که داروخانه‌ها برای این محصول می‌گویند را بنویسید (چند اسم را با ویرگول یا خط جدید جدا کنید).</p>
        <div id="sn-names"></div>
        <div class="set-row" style="margin-top:10px">
          <textarea id="sn-input" rows="3" placeholder="مثلاً: ژل آبی، آبرسان شماره ۱" style="width:100%"></textarea>
        </div>
        <button class="btn btn-primary btn-lg" id="sn-add-btn" style="margin-top:8px">➕ افزودن</button>
        <div class="dialog-btns" style="margin-top:12px"><button class="btn btn-ghost" id="sn-done" style="flex:1">تمام شد</button></div>`,
      onMount(body, close) {
        const listEl = body.querySelector('#sn-names');
        const input = body.querySelector('#sn-input');
        const cur = () => suggestNamesMap[code] || [];
        const dbErr = () => showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید (یا جدول دیتابیس ساخته نشده).', 'error');
        const render = () => {
          const names = cur();
          listEl.innerHTML = names.length ? names.map((n) => `
            <div class="pack-item" data-sn-row="${Utils.esc(n)}">
              <div class="pack-info"><div class="pack-name" data-sn-text>${Utils.esc(n)}</div></div>
              <div class="pack-btns">
                <button class="btn btn-ghost btn-sm" data-sn-edit="${Utils.esc(n)}">✏️</button>
                <button class="btn btn-danger btn-sm" data-sn-del="${Utils.esc(n)}" aria-label="حذف">🗑</button>
              </div>
            </div>`).join('') : '<div class="empty-state" style="padding:14px"><p>هنوز اسمی ثبت نشده.</p></div>';
        };
        const add = async () => {
          if (!canEditSuggestNames()) return;
          const parts = (input.value || '').split(/[\n,،;؛]+/).map((x) => x.trim()).filter(Boolean);
          if (!parts.length) return;
          let added = 0, dups = 0;
          for (const nm of parts) {
            if (cur().some((x) => snKey(x) === snKey(nm))) { dups++; continue; }
            try {
              const r = await Backend.addSuggestName(code, nm);
              if (r.dup) { dups++; continue; }
              suggestNamesMap[code] = cur().concat(nm); added++;
            } catch (err) { dbErr(); break; }
          }
          input.value = '';
          render();
          if (added) showToast(Utils.faNum(added) + ' اسم اضافه شد ✓' + (dups ? ' (' + Utils.faNum(dups) + ' تکراری رد شد)' : ''), 'success');
          else if (dups) showToast('این اسم قبلاً برای این محصول ثبت شده', 'error');
        };
        listEl.addEventListener('click', async (e) => {
          const del = e.target.closest('[data-sn-del]');
          if (del) {
            try { await Backend.removeSuggestName(code, del.dataset.snDel); } catch (err) { dbErr(); return; }
            suggestNamesMap[code] = cur().filter((x) => x !== del.dataset.snDel);
            if (!suggestNamesMap[code].length) delete suggestNamesMap[code];
            render(); showToast('اسم حذف شد');
            return;
          }
          const edit = e.target.closest('[data-sn-edit]');
          if (edit) {
            const old = edit.dataset.snEdit;
            const row = e.target.closest('[data-sn-row]');
            row.querySelector('[data-sn-text]').outerHTML = `<input type="text" data-sn-edit-input value="${Utils.esc(old)}" style="width:100%">`;
            row.querySelector('.pack-btns').innerHTML = `<button class="btn btn-primary btn-sm" data-sn-save="${Utils.esc(old)}">✔️</button><button class="btn btn-ghost btn-sm" data-sn-cancel>✖️</button>`;
            const ei = row.querySelector('[data-sn-edit-input]'); ei.focus(); ei.select();
            return;
          }
          const save = e.target.closest('[data-sn-save]');
          if (save) {
            const old = save.dataset.snSave;
            const nv = (e.target.closest('[data-sn-row]').querySelector('[data-sn-edit-input]').value || '').trim();
            if (!nv) { showToast('اسم نمی‌تواند خالی باشد', 'error'); return; }
            if (snKey(nv) !== snKey(old) && cur().some((x) => snKey(x) === snKey(nv))) { showToast('این اسم قبلاً ثبت شده', 'error'); return; }
            let r;
            try { r = await Backend.renameSuggestName(code, old, nv); } catch (err) { dbErr(); return; }
            if (r.dup) { showToast('این اسم قبلاً ثبت شده', 'error'); return; }
            suggestNamesMap[code] = cur().map((x) => (x === old ? nv : x));
            render(); showToast('اسم ویرایش شد ✓', 'success');
            return;
          }
          if (e.target.closest('[data-sn-cancel]')) render();
        });
        body.querySelector('#sn-add-btn').onclick = add;
        body.querySelector('#sn-done').onclick = () => { close(); if (state.screen === 'suggest-names') renderSuggestNames(); else if (state.screen === 'products') renderResults(); };
        render();
        setTimeout(() => input.focus(), 60);
      }
    });
  }


  /* ---------- برند ← دسته ← محصولات (نوار بالای صفحه‌ی محصولات) ----------
     داده در product_tags / product_tag_links (مشترک در شرکت). دسته همیشه زیرمجموعه‌ی یک برند است (parent_id).
     فقط فیلتر نمایش است: با انتخاب برند، نتایج به محصولات آن برند محدود می‌شود؛ با انتخاب دسته‌ی آن برند، به محصولات آن دسته.
     برندِ بدون دسته مستقیم همه‌ی محصولاتش را نشان می‌دهد. بدون انتخاب، صفحه مثل قبل است. ذخیره‌ی محلی/موقت ندارد.
     هر محصولِ عضو یک دسته، خودکار عضو برند آن هم می‌شود. canEditTags: بعداً برای قفل «فقط مدیر» عوض می‌شود. */
  let tagList = [];                 // [{id, kind, name, parent_id}]
  let tagLinkSets = new Map();      // tagId -> Set(code)
  const tagActive = { brand: null, category: null }; // id انتخاب‌شده
  let tagNamesByCode = {};          // code -> [نام برند/دسته] برای موتور پیشنهاد
  function canEditTags() { return Backend.isActive(); }
  const KIND_FA = { brand: 'برند', category: 'دسته' };
  const tagById = (id) => tagList.find((t) => t.id === id);
  // ترتیب نمایش: sort_order (جابجایی دستی) و سپس زمان ساخت
  const sortTags = (arr) => arr.slice().sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (a.id - b.id));
  const tagChildren = (brandId) => sortTags(tagList.filter((t) => t.kind === 'category' && t.parent_id === brandId));
  const nextTagOrder = (siblings) => siblings.reduce((m, t) => Math.max(m, t.sort_order || 0), 0) + 1;
  // برنامه‌ی ذخیره‌ی ترتیب جدید: فقط موارد تغییرکرده؛ newIds = ترتیب جدید شناسه‌ها
  function planReorder(siblings, newIds) {
    const out = [];
    newIds.forEach((id, i) => {
      const t = siblings.find((x) => x.id === id);
      if (t && t.sort_order !== i + 1) out.push({ id, sort_order: i + 1 });
    });
    return out;
  }

  function rebuildTagIndex() {
    tagLinkSets = new Map();
    tagNamesByCode = {};
    tagList.forEach((t) => tagLinkSets.set(t.id, new Set()));
  }
  function reindexNames() {
    tagNamesByCode = {};
    tagList.forEach((t) => (tagLinkSets.get(t.id) || new Set()).forEach((c) => indexLink(t.id, c)));
  }
  function indexLink(tagId, code) {
    const set = tagLinkSets.get(tagId) || new Set();
    set.add(String(code)); tagLinkSets.set(tagId, set);
    const t = tagById(tagId);
    if (t) { const arr = tagNamesByCode[String(code)] || (tagNamesByCode[String(code)] = []); if (!arr.includes(t.name)) arr.push(t.name); }
  }
  function unindexLink(tagId, code) {
    const set = tagLinkSets.get(tagId); if (set) set.delete(String(code));
    const t = tagById(tagId);
    if (t && tagNamesByCode[String(code)]) tagNamesByCode[String(code)] = tagNamesByCode[String(code)].filter((n) => n !== t.name);
  }

  async function loadProductTagsTask() {
    if (!Backend.isActive() || Backend.isOffline()) return;
    try {
      const r = await Backend.getProductTags();
      tagList = r.tags || [];
      rebuildTagIndex();
      (r.links || []).forEach((l) => indexLink(l.tag_id, l.code));
    } catch (e) { tagList = []; rebuildTagIndex(); /* جدول هنوز ساخته نشده یا قطع اتصال: بی‌صدا */ }
  }

  // افزودن محصولات به برند/دسته؛ عضویت در دسته خودکار عضویت در برند آن هم هست
  async function linkTagProducts(tag, codes) {
    await Backend.addProductTagLinks(tag.id, codes);
    codes.forEach((c) => indexLink(tag.id, c));
    if (tag.kind === 'category' && tag.parent_id) {
      await Backend.addProductTagLinks(tag.parent_id, codes);
      codes.forEach((c) => indexLink(tag.parent_id, c));
    }
  }
  // خارج‌کردن یک محصول؛ اگر از برند خارج شود، از دسته‌های همان برند هم خارج می‌شود
  async function unlinkTagProduct(tag, code) {
    if (tag.kind === 'brand') {
      for (const ch of tagChildren(tag.id)) {
        if ((tagLinkSets.get(ch.id) || new Set()).has(String(code))) { await Backend.removeProductTagLink(ch.id, code); unindexLink(ch.id, code); }
      }
    }
    await Backend.removeProductTagLink(tag.id, code);
    unindexLink(tag.id, code);
  }
  // بعد از حذف برند/دسته در دیتابیس: وضعیت محلی را هم‌گام کن (حذف برند، دسته‌هایش را هم می‌برد)
  function dropTagLocally(id) {
    const gone = new Set([id]);
    tagList.filter((t) => t.parent_id === id).forEach((t) => gone.add(t.id));
    tagList = tagList.filter((t) => !gone.has(t.id));
    gone.forEach((g) => tagLinkSets.delete(g));
    if (gone.has(tagActive.brand)) { tagActive.brand = null; tagActive.category = null; }
    if (gone.has(tagActive.category)) tagActive.category = null;
    reindexNames();
  }

  function tagFilterActive() { return !!(tagActive.brand || tagActive.category); }
  function passesTagFilter(p) {
    const code = String(p.code);
    for (const kind of ['brand', 'category']) {
      const id = tagActive[kind];
      if (id && !(tagLinkSets.get(id) && tagLinkSets.get(id).has(code))) return false;
    }
    return true;
  }
  function applyTagFilter(list, q, wh) {
    if (!tagFilterActive()) return list;
    if (q) return list.filter(passesTagFilter);
    return Searcher.browse(wh, 100000).filter(passesTagFilter).slice(0, 500);
  }

  function renderTagBar() {
    const bars = $id('tag-bars');
    if (!bars) return;
    bars.hidden = !Backend.isActive();
    if (bars.hidden) return;
    const chip = (t) => `<button type="button" class="tag-chip ${tagActive[t.kind] === t.id ? 'active' : ''}" data-tag-toggle="${t.id}" data-tag-kind="${t.kind}">${tagActive[t.kind] === t.id ? '✓ ' : ''}${Utils.esc(t.name)}<small>${Utils.faNum((tagLinkSets.get(t.id) || new Set()).size)}</small></button>`;
    const brands = sortTags(tagList.filter((t) => t.kind === 'brand'));
    $id('tag-chips-brand').innerHTML = brands.length ? brands.map(chip).join('') : '<span class="tag-empty">برندی ثبت نشده. با ＋ اولین برند را بساز.</span>';
    $id('tag-manage-brand').hidden = !brands.length;
    const b = tagActive.brand ? tagById(tagActive.brand) : null;
    $id('tag-sub').hidden = !b;
    if (b) {
      const cats = tagChildren(b.id);
      $id('tag-sub-title').textContent = 'دسته‌های ' + b.name;
      $id('tag-chips-category').innerHTML = cats.length ? cats.map(chip).join('') : '<span class="tag-empty">دسته‌ای ندارد؛ همه‌ی محصولات این برند نمایش داده می‌شود.</span>';
      $id('tag-manage-category').hidden = !cats.length;
    }
  }

  let tagBarWired = false;
  function wireTagBar() {
    if (tagBarWired) return;
    const bars = $id('tag-bars');
    if (!bars) return;
    tagBarWired = true;
    wireTagDrag(bars);
    bars.addEventListener('click', (e) => {
      if (tagDragJustEnded) return; // کلیکِ بعد از رها کردن درگ، انتخاب چیپ نیست
      const tog = e.target.closest('[data-tag-toggle]');
      if (tog) {
        const id = Number(tog.dataset.tagToggle), kind = tog.dataset.tagKind;
        tagActive[kind] = tagActive[kind] === id ? null : id;
        if (kind === 'brand') tagActive.category = null; // با عوض‌شدن برند، دسته‌ی قبلی بی‌اعتبار است
        renderTagBar(); renderResults();
        return;
      }
      const add = e.target.closest('[data-tag-add]');
      if (add) { openAddTagSheet(add.dataset.tagAdd); return; }
      const man = e.target.closest('[data-tag-manage]');
      if (man) openManageTagsSheet(man.dataset.tagManage);
    });
  }

  /* جابجایی چیپ‌ها با نگه‌داشتن (حدود نیم ثانیه) و کشیدن؛ هم برای برندها و هم دسته‌ها.
     ترتیب جدید در دیتابیس (sort_order) ذخیره می‌شود و برای همه‌ی کاربران یکسان است. */
  let tagDragJustEnded = false;
  function wireTagDrag(root) {
    let timer = null, st = null;
    const blockScroll = (e) => { if (e.cancelable) e.preventDefault(); };
    function cleanup() {
      clearTimeout(timer); timer = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('touchmove', blockScroll);
      if (st) { if (st.clone) st.clone.remove(); st.chip.classList.remove('tag-drag-src'); }
      st = null;
    }
    function startDrag() {
      if (!st) return;
      st.dragging = true;
      const r = st.chip.getBoundingClientRect();
      st.dx = st.x - r.left; st.dy = st.y - r.top;
      const clone = st.chip.cloneNode(true);
      clone.classList.add('tag-drag-clone');
      clone.style.width = r.width + 'px'; clone.style.height = r.height + 'px';
      clone.style.left = r.left + 'px'; clone.style.top = r.top + 'px';
      document.body.appendChild(clone);
      st.clone = clone;
      st.chip.classList.add('tag-drag-src');
      document.addEventListener('touchmove', blockScroll, { passive: false }); // جلوگیری از اسکرول صفحه هنگام کشیدن
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* ignore */ } }
    }
    function onMove(e) {
      if (!st) return;
      if (!st.dragging) {
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 9) cleanup(); // حرکت قبل از نگه‌داشتن = اسکرول، نه درگ
        return;
      }
      st.clone.style.left = (e.clientX - st.dx) + 'px';
      st.clone.style.top = (e.clientY - st.dy) + 'px';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const targ = under && under.closest ? under.closest('.tag-chip[data-tag-toggle]') : null;
      if (!targ || targ === st.chip || targ.parentElement !== st.box) return;
      const sibs = Array.from(st.box.querySelectorAll('.tag-chip[data-tag-toggle]'));
      if (sibs.indexOf(st.chip) < sibs.indexOf(targ)) st.box.insertBefore(st.chip, targ.nextSibling);
      else st.box.insertBefore(st.chip, targ);
    }
    function onCancel() { const was = st && st.dragging; cleanup(); if (was) renderTagBar(); }
    async function onUp() {
      if (!st) return;
      if (!st.dragging) { cleanup(); return; }
      const kind = st.kind;
      const ids = Array.from(st.box.querySelectorAll('.tag-chip[data-tag-toggle]')).map((c) => Number(c.dataset.tagToggle));
      cleanup();
      tagDragJustEnded = true; setTimeout(() => { tagDragJustEnded = false; }, 350);
      const sibs = kind === 'brand' ? sortTags(tagList.filter((t) => t.kind === 'brand')) : tagChildren(tagActive.brand);
      const plan = planReorder(sibs, ids);
      if (!plan.length) { renderTagBar(); return; }
      try { await Backend.reorderProductTags(plan); }
      catch (err) { showToast('ترتیب ذخیره نشد. اتصال اینترنت را بررسی کنید (یا SQL ترتیب اجرا نشده).', 'error'); renderTagBar(); return; }
      plan.forEach((u) => { const t = tagById(u.id); if (t) t.sort_order = u.sort_order; });
      renderTagBar();
    }
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('.tag-chip')) e.preventDefault(); });
    root.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.tag-chip[data-tag-toggle]');
      if (!chip || !canEditTags() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      cleanup();
      st = { chip, box: chip.parentElement, kind: chip.dataset.tagKind, x: e.clientX, y: e.clientY, dragging: false };
      timer = setTimeout(startDrag, 380);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }

  function openAddTagSheet(kind) {
    const parent = kind === 'category' ? tagById(tagActive.brand) : null;
    if (kind === 'category' && !parent) { showToast('اول یک برند را انتخاب کنید', 'error'); return; }
    showSheet({
      title: kind === 'brand' ? '➕ افزودن برند' : '➕ افزودن دسته به «' + parent.name + '»',
      html: `
        <div class="set-row"><input type="text" id="tg-name" placeholder="${kind === 'brand' ? 'مثلاً: درمالیفت' : 'مثلاً: فوم'}" autocomplete="off" style="width:100%"></div>
        <button class="btn btn-primary btn-lg" id="tg-save" style="margin-top:8px">ثبت و انتخاب محصولات</button>
        <div class="dialog-btns" style="margin-top:12px"><button class="btn btn-ghost" id="tg-cancel" style="flex:1">انصراف</button></div>`,
      onMount(body, close) {
        const input = body.querySelector('#tg-name');
        body.querySelector('#tg-cancel').onclick = close;
        const save = async () => {
          const nm = (input.value || '').trim();
          if (!nm) return;
          if (!canEditTags()) return;
          const pid = parent ? parent.id : null;
          if (tagList.some((t) => t.kind === kind && (t.parent_id || null) === pid && snKey(t.name) === snKey(nm))) { showToast('این ' + KIND_FA[kind] + ' قبلاً ثبت شده', 'error'); return; }
          let r;
          const sibs = kind === 'brand' ? tagList.filter((t) => t.kind === 'brand') : tagChildren(pid);
          try { r = await Backend.addProductTag(kind, nm, pid, nextTagOrder(sibs)); } catch (err) { showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید (یا SQL دیتابیس اجرا نشده).', 'error'); return; }
          if (r.dup) { showToast('این ' + KIND_FA[kind] + ' قبلاً ثبت شده', 'error'); return; }
          tagList.push(r.tag); tagLinkSets.set(r.tag.id, new Set());
          if (kind === 'brand') { tagActive.brand = r.tag.id; tagActive.category = null; } else tagActive.category = r.tag.id;
          close(); renderTagBar(); renderResults();
          openAssignTagSheet(r.tag);
        };
        body.querySelector('#tg-save').onclick = save;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        setTimeout(() => input.focus(), 60);
      }
    });
  }

  // انتخاب محصولات یک برند/دسته: جستجو، تیک‌زدن هر محصول، یا «افزودن همه‌ی نتایج»
  function openAssignTagSheet(tag) {
    const parent = tag.kind === 'category' ? tagById(tag.parent_id) : null;
    showSheet({
      title: '📦 محصولات ' + KIND_FA[tag.kind] + ' «' + tag.name + '»' + (parent ? ' (' + parent.name + ')' : ''),
      html: `
        <div id="as-count" style="font-size:12.5px;color:var(--muted);margin-bottom:6px"></div>
        <input type="search" id="as-search" placeholder="جستجوی محصول: نام یا کد" autocomplete="off" style="width:100%">
        <button class="btn btn-ghost" id="as-all" style="margin-top:6px;width:100%" hidden></button>
        <div id="as-list" style="margin-top:8px;max-height:46vh;overflow:auto"></div>
        <div class="dialog-btns" style="margin-top:12px"><button class="btn btn-ghost" id="as-done" style="flex:1">تمام شد</button></div>`,
      onMount(body, close) {
        const input = body.querySelector('#as-search'), listEl = body.querySelector('#as-list');
        const allBtn = body.querySelector('#as-all'), countEl = body.querySelector('#as-count');
        let shown = [];
        const dbErr = () => showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
        const set = () => tagLinkSets.get(tag.id) || new Set();
        const render = () => {
          const q = (input.value || '').trim();
          const linked = set();
          shown = q ? Searcher.search(q, { warehouse: 'all', limit: 60 })
            : Searcher.getProducts().filter((p) => linked.has(String(p.code))).slice(0, 100);
          const seen = new Set(); shown = shown.filter((p) => !seen.has(p.code) && seen.add(p.code));
          countEl.textContent = Utils.faNum(linked.size) + ' محصول در این ' + KIND_FA[tag.kind];
          const notIn = shown.filter((p) => !linked.has(String(p.code)));
          allBtn.hidden = !q || !notIn.length;
          allBtn.textContent = '➕ افزودن همه‌ی ' + Utils.faNum(notIn.length) + ' نتیجه';
          listEl.innerHTML = shown.length ? shown.map((p) => `
            <div class="pack-item" data-as-code="${Utils.esc(String(p.code))}" style="cursor:pointer">
              <div class="pack-info"><div class="pack-name">${linked.has(String(p.code)) ? '✅' : '⬜'} ${Utils.esc(p.name)}</div><div style="font-size:11.5px;color:var(--muted)">${Utils.esc(String(p.code))}</div></div>
            </div>`).join('') : `<div class="empty-state" style="padding:14px"><p>${q ? 'محصولی پیدا نشد.' : 'برای افزودن محصول، بالا جستجو کنید.'}</p></div>`;
        };
        let tmr = null;
        input.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(render, 150); });
        listEl.addEventListener('click', async (e) => {
          const row = e.target.closest('[data-as-code]'); if (!row) return;
          const code = row.dataset.asCode;
          try {
            if (set().has(code)) await unlinkTagProduct(tag, code);
            else await linkTagProducts(tag, [code]);
          } catch (err) { dbErr(); return; }
          render();
        });
        allBtn.onclick = async () => {
          const codes = shown.map((p) => String(p.code)).filter((c) => !set().has(c));
          if (!codes.length) return;
          try { await linkTagProducts(tag, codes); } catch (err) { dbErr(); return; }
          showToast(Utils.faNum(codes.length) + ' محصول اضافه شد ✓', 'success');
          render();
        };
        body.querySelector('#as-done').onclick = () => { close(); renderTagBar(); if (state.screen === 'products') renderResults(); };
        render();
      }
    });
  }

  function openManageTagsSheet(kind) {
    const brand = kind === 'category' ? tagById(tagActive.brand) : null;
    if (kind === 'category' && !brand) return;
    showSheet({
      title: '⚙️ مدیریت ' + (kind === 'brand' ? 'برندها' : 'دسته‌های ' + brand.name),
      html: `<div id="mg-list"></div><div class="dialog-btns" style="margin-top:12px"><button class="btn btn-ghost" id="mg-done" style="flex:1">تمام شد</button></div>`,
      onMount(body, close) {
        const listEl = body.querySelector('#mg-list');
        const dbErr = () => showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
        const items = () => (kind === 'brand' ? sortTags(tagList.filter((t) => t.kind === 'brand')) : tagChildren(brand.id));
        const render = () => {
          const arr = items();
          listEl.innerHTML = arr.length ? arr.map((t) => `
            <div class="pack-item" data-mg-row="${t.id}">
              <div class="pack-info"><div class="pack-name" data-mg-text>${Utils.esc(t.name)}</div><div style="font-size:11.5px;color:var(--muted)">${Utils.faNum((tagLinkSets.get(t.id) || new Set()).size)} محصول${t.kind === 'brand' && tagChildren(t.id).length ? ' · ' + Utils.faNum(tagChildren(t.id).length) + ' دسته' : ''}</div></div>
              <div class="pack-btns">
                <button class="btn btn-ghost btn-sm" data-mg-products="${t.id}" title="محصولات">📦</button>
                <button class="btn btn-ghost btn-sm" data-mg-edit="${t.id}">✏️</button>
                <button class="btn btn-danger btn-sm" data-mg-del="${t.id}" aria-label="حذف">🗑</button>
              </div>
            </div>`).join('') : '<div class="empty-state" style="padding:14px"><p>موردی ثبت نشده.</p></div>';
        };
        listEl.addEventListener('click', async (e) => {
          const prodBtn = e.target.closest('[data-mg-products]');
          if (prodBtn) { const t = tagById(Number(prodBtn.dataset.mgProducts)); if (t) { close(); openAssignTagSheet(t); } return; }
          const del = e.target.closest('[data-mg-del]');
          if (del) {
            const t = tagById(Number(del.dataset.mgDel)); if (!t) return;
            const nCh = t.kind === 'brand' ? tagChildren(t.id).length : 0;
            const ch = await showDialog({
              title: 'حذف ' + KIND_FA[t.kind],
              message: '«' + t.name + '» حذف شود؟' + (nCh ? ' ' + Utils.faNum(nCh) + ' دسته‌ی این برند هم حذف می‌شود.' : '') + ' فقط برند/دسته و اتصال‌هایش پاک می‌شود؛ هیچ محصولی حذف نمی‌شود.',
              buttons: [{ label: 'انصراف', value: 'no', kind: 'btn-ghost' }, { label: 'حذف', value: 'yes', kind: 'btn-danger' }]
            });
            if (ch !== 'yes') return;
            try { await Backend.removeProductTag(t.id); } catch (err) { dbErr(); return; }
            dropTagLocally(t.id);
            if (kind === 'category' && !tagById(tagActive.brand)) { close(); }
            else render();
            renderTagBar(); if (state.screen === 'products') renderResults();
            return;
          }
          const edit = e.target.closest('[data-mg-edit]');
          if (edit) {
            const id = Number(edit.dataset.mgEdit), t = tagById(id);
            const row = e.target.closest('[data-mg-row]');
            row.querySelector('[data-mg-text]').outerHTML = `<input type="text" data-mg-input value="${Utils.esc(t.name)}" style="width:100%">`;
            row.querySelector('.pack-btns').innerHTML = `<button class="btn btn-primary btn-sm" data-mg-save="${id}">✔️</button><button class="btn btn-ghost btn-sm" data-mg-cancel>✖️</button>`;
            const inp = row.querySelector('[data-mg-input]'); inp.focus(); inp.select();
            return;
          }
          const save = e.target.closest('[data-mg-save]');
          if (save) {
            const id = Number(save.dataset.mgSave), t = tagById(id);
            const nv = (e.target.closest('[data-mg-row]').querySelector('[data-mg-input]').value || '').trim();
            if (!nv) { showToast('نام نمی‌تواند خالی باشد', 'error'); return; }
            if (snKey(nv) !== snKey(t.name) && tagList.some((x) => x.kind === t.kind && x.parent_id === t.parent_id && x.id !== id && snKey(x.name) === snKey(nv))) { showToast('این نام قبلاً ثبت شده', 'error'); return; }
            let r;
            try { r = await Backend.renameProductTag(id, nv); } catch (err) { dbErr(); return; }
            if (r.dup) { showToast('این نام قبلاً ثبت شده', 'error'); return; }
            t.name = nv; reindexNames();
            render(); renderTagBar();
            showToast('ویرایش شد ✓', 'success');
            return;
          }
          if (e.target.closest('[data-mg-cancel]')) render();
        });
        body.querySelector('#mg-done').onclick = () => { close(); renderTagBar(); };
        render();
      }
    });
  }

  /* ادغام محصولات فایل انبار با محصولات دستی (کد اختیاری) کاربر —
     محصولات دستی همیشه اضافه می‌شوند و هرگز با تغییر فایل انبار حذف نمی‌شوند */
  async function loadAllProductsMerged() {
    const wh = await DB.getAllProducts();
    const custom = CustomProducts.getAllAsProducts();
    return wh.concat(custom);
  }

  function findProductByWhKey(whKey) {
    const [wh, code] = whKey.split('|');
    return state.products.find((p) => String(p.warehouse) === String(wh) && p.code === code);
  }

  /* شیت مدیریت نام‌های مستعار یک محصول — برای اسم‌هایی که داروخانه‌ها می‌گویند
     ولی در فایل انبار با اسم دیگری ثبت شده (مثلاً خط تولید درماليفت) */
  function openAliasSheet(product) {
    showSheet({
      title: '🏷 نام مستعار — ' + product.name,
      html: `
        <div class="qty-sheet-info">کد: ${Utils.esc(product.code)} | ${Utils.esc(warehouseName(product.warehouse))}</div>
        <p style="font-size:12.5px;color:var(--muted);margin:6px 0 10px">
          اگر داروخانه‌ها این محصول را با اسم دیگری صدا می‌زنند (مثلاً «درمالیفت شماره ۱»)، آن اسم را اینجا اضافه کنید تا در جستجو هم پیدا شود.
        </p>
        <div id="alias-list"></div>
        <div class="set-row" style="margin-top:10px">
          <input type="text" id="alias-input" placeholder="مثلاً: درمالیفت شماره ۱ پوست خشک" autocomplete="off">
        </div>
        <button class="btn btn-primary btn-lg" id="alias-add-btn" style="margin-top:8px">➕ افزودن نام مستعار</button>
        <div class="dialog-btns" style="margin-top:12px">
          <button class="btn btn-ghost" id="alias-done" style="flex:1">تمام شد</button>
        </div>`,
      onMount(body, close) {
        const listEl = body.querySelector('#alias-list');
        const input = body.querySelector('#alias-input');
        const render = () => {
          const aliases = Aliases.getFor(product.code);
          listEl.innerHTML = aliases.length ? aliases.map((a) => `
            <div class="pack-item" data-alias-row="${Utils.esc(a)}">
              <div class="pack-info"><div class="pack-name" data-alias-text>${Utils.esc(a)}</div></div>
              <div class="pack-btns">
                <button class="btn btn-ghost btn-sm" data-alias-edit="${Utils.esc(a)}">✏️</button>
                <button class="btn btn-danger btn-sm" data-alias-del="${Utils.esc(a)}" aria-label="حذف">🗑</button>
              </div>
            </div>`).join('')
            : '<div class="empty-state" style="padding:14px"><p>هنوز نام مستعاری ثبت نشده.</p></div>';
        };
        const addAlias = async () => {
          const v = (input.value || '').trim();
          if (!v) return;
          let res;
          try {
            res = await Aliases.addAlias(product.code, v);
          } catch (err) {
            showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
            return;
          }
          Searcher.setAliases(Aliases.getAll());
          input.value = '';
          render();
          // اگر هماهنگ نشد، Aliases خودش پیام هشدار را نشان داده؛ اینجا فقط برای حالت موفق پیام «✓» می‌دهیم
          if (res.synced) showToast('نام مستعار اضافه شد ✓', 'success');
        };
        listEl.addEventListener('click', async (e) => {
          const del = e.target.closest('[data-alias-del]');
          if (del) {
            let res;
            try {
              res = await Aliases.removeAlias(product.code, del.dataset.aliasDel);
            } catch (err) {
              showToast('حذف نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
              return;
            }
            Searcher.setAliases(Aliases.getAll());
            render();
            if (res.synced) showToast('نام مستعار حذف شد');
            return;
          }
          const edit = e.target.closest('[data-alias-edit]');
          if (edit) {
            const old = edit.dataset.aliasEdit;
            const row = e.target.closest('[data-alias-row]');
            const textEl = row.querySelector('[data-alias-text]');
            textEl.outerHTML = `<input type="text" class="alias-edit-input" data-alias-edit-input value="${Utils.esc(old)}" style="width:100%">`;
            const editInput = row.querySelector('[data-alias-edit-input]');
            row.querySelector('.pack-btns').innerHTML = `
              <button class="btn btn-primary btn-sm" data-alias-save="${Utils.esc(old)}">✔️</button>
              <button class="btn btn-ghost btn-sm" data-alias-cancel>✖️</button>`;
            editInput.focus();
            editInput.select();
            return;
          }
          const save = e.target.closest('[data-alias-save]');
          if (save) {
            const old = save.dataset.aliasSave;
            const row = e.target.closest('[data-alias-row]');
            const editInput = row.querySelector('[data-alias-edit-input]');
            const nv = (editInput.value || '').trim();
            if (!nv) { showToast('نام نمی‌تواند خالی باشد', 'error'); return; }
            let res;
            try {
              res = await Aliases.renameAlias(product.code, old, nv);
            } catch (err) {
              showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
              return;
            }
            Searcher.setAliases(Aliases.getAll());
            render();
            if (res.synced) showToast('نام مستعار ویرایش شد ✓', 'success');
            return;
          }
          const cancel = e.target.closest('[data-alias-cancel]');
          if (cancel) { render(); return; }
        });
        body.querySelector('#alias-add-btn').onclick = addAlias;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } });
        body.querySelector('#alias-done').onclick = () => { close(); renderResults(); };
        render();
        setTimeout(() => { input.focus(); }, 60);
      }
    });
  }

  /* شیت مدیریت اندازه «بسته» یک محصول — قابل تنظیم روی هر محصولی */
  function openPackSizeSheet(product) {
    const info = PackSize.getFor(product.code);
    showSheet({
      title: '📦 بسته — ' + product.name,
      html: `
        <div class="qty-sheet-info">کد: ${Utils.esc(product.code)} | ${Utils.esc(warehouseName(product.warehouse))}</div>
        <div class="set-row" style="margin-top:10px">
          <label>تعداد در هر بسته</label>
          <input type="number" inputmode="numeric" id="pksz-size" placeholder="مثلاً: 12" value="${info ? Utils.esc(String(info.size)) : ''}">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label>یادداشت (اختیاری)</label>
          <input type="text" id="pksz-note" placeholder="مثلاً: ۴۰ بسته در هر کارتن" value="${info && info.note ? Utils.esc(info.note) : ''}">
        </div>
        <button class="btn btn-primary btn-lg" id="pksz-save" style="margin-top:12px">💾 ذخیره</button>
        <div class="dialog-btns" style="margin-top:10px">
          ${info ? '<button class="btn btn-danger" id="pksz-remove" style="flex:1">🗑 حذف</button>' : ''}
          <button class="btn btn-ghost" id="pksz-cancel" style="flex:1">انصراف</button>
        </div>`,
      onMount(body, close) {
        body.querySelector('#pksz-save').onclick = async () => {
          const size = body.querySelector('#pksz-size').value;
          const note = body.querySelector('#pksz-note').value;
          if (!size || Number(size) <= 0) { showToast('تعداد در بسته را وارد کنید', 'error'); return; }
          let res;
          try {
            res = await PackSize.setFor(product.code, size, note);
          } catch (err) {
            // فقط اگر خودِ ذخیره‌ی محلی هم شکست بخورد (نادر)؛ پنجره باز می‌ماند تا مقدار واردشده از بین نرود
            showToast('ذخیره نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
            return;
          }
          close();
          renderResults();
          // اگر هماهنگ نشد، PackSize خودش پیام هشدار را نشان داده؛ اینجا فقط برای حالت موفق پیام «✓» می‌دهیم
          if (res.synced) showToast('اندازه بسته ذخیره شد ✓', 'success');
        };
        const rm = body.querySelector('#pksz-remove');
        if (rm) rm.onclick = async () => {
          let res;
          try {
            res = await PackSize.removeFor(product.code);
          } catch (err) {
            showToast('حذف نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', 'error');
            return;
          }
          close();
          renderResults();
          if (res.synced) showToast('اندازه بسته حذف شد');
        };
        body.querySelector('#pksz-cancel').onclick = close;
        setTimeout(() => { body.querySelector('#pksz-size').focus(); }, 60);
      }
    });
  }

  /* ---------- جور: انتخاب چند کد و ترکیب در یک قلم واحد سبد ---------- */

  function openQuickCartSheet() {
    const renderRows = () => {
      const cart = OrderManager.getCart();
      return cart.map((it) => {
        const overStock = it.stock !== null && it.qty > it.stock;
        const warnHtml = overStock
          ? `<div class="ci-warn danger">⚠️ موجودی: ${it.stock === null ? 'نامشخص' : Utils.faNum(it.stock)} — بیشتر از موجودی!</div>`
          : '';
        const subLine = it.isJor
          ? `⭐ جور — ${Utils.faNum(it.jorCount || 0)} عدد در ${Utils.faNum((it.jorItems || []).length)} قلم`
          : `کد: ${Utils.esc(it.code)} | ${Utils.esc(warehouseName(it.warehouse))}`;
        return `<div class="cart-item">
          <div class="ci-top">
            <div>
              <div class="ci-name">${Utils.esc(it.name)}</div>
              <div class="ci-sub">${subLine}</div>
            </div>
            <button class="ci-remove" data-qc-rm="${Utils.esc(it.whKey)}" aria-label="حذف">✕</button>
          </div>
          <div class="ci-body">
            <div class="qty-stepper">
              <button class="qty-btn" data-qc-dec="${Utils.esc(it.whKey)}">−</button>
              <span class="qty-val">${Utils.faNum(it.qty)}</span>
              <button class="qty-btn" data-qc-inc="${Utils.esc(it.whKey)}">+</button>
            </div>
            <div class="ci-price">
              <div class="line">${Utils.formatMoney(it.lineTotal !== undefined ? it.lineTotal : it.qty * (it.priceToman || 0))}</div>
            </div>
          </div>
          <div class="ci-offer-row">
            <span class="ci-offer-label">آفر:</span>
            <input class="ci-offer-input" data-qc-offer="${Utils.esc(it.whKey)}" value="${Utils.esc(it.offer || '')}" placeholder="آفر این محصول (اختیاری)" autocomplete="off">
          </div>
          ${warnHtml}
        </div>`;
      }).join('');
    };
    showSheet({
      title: '🧾 سبد سفارش فعلی',
      html: `
        <div id="qc-list">${renderRows()}</div>
        <div class="os-row os-total" style="margin-top:10px">
          <span>مبلغ کل</span><strong id="qc-total">${Utils.formatMoney(OrderManager.cartTotal())}</strong>
        </div>
        <div class="dialog-btns" style="margin-top:12px">
          <button id="qc-continue" class="btn btn-ghost">ادامه جستجو</button>
          <button id="qc-checkout" class="btn btn-primary">تکمیل و ثبت سفارش</button>
        </div>
        <button id="qc-clear" class="btn btn-danger btn-sm" style="width:100%;margin-top:8px">🗑 خالی کردن سبد</button>`,
      onMount(body, close) {
        const listEl = body.querySelector('#qc-list');
        const totalEl = body.querySelector('#qc-total');
        const refresh = () => {
          listEl.innerHTML = renderRows();
          totalEl.textContent = Utils.formatMoney(OrderManager.cartTotal());
          updateCartFab();
          if (!OrderManager.getCart().length) close();
        };
        listEl.addEventListener('input', (e) => {
          const inp = e.target.closest('[data-qc-offer]');
          if (inp) OrderManager.setItemOffer(inp.dataset.qcOffer, inp.value);
        });
        listEl.addEventListener('click', async (e) => {
          const inc = e.target.closest('[data-qc-inc]');
          const dec = e.target.closest('[data-qc-dec]');
          const rm = e.target.closest('[data-qc-rm]');
          const cart = OrderManager.getCart();
          if (inc) {
            const it = cart.find((i) => i.whKey === inc.dataset.qcInc);
            if (it) { await OrderManager.setQty(it.whKey, it.qty + 1); refresh(); }
          } else if (dec) {
            const it = cart.find((i) => i.whKey === dec.dataset.qcDec);
            if (it) { await OrderManager.setQty(it.whKey, it.qty - 1); refresh(); }
          } else if (rm) {
            await OrderManager.removeItem(rm.dataset.qcRm);
            refresh();
            showToast('از سفارش حذف شد');
          }
        });
        body.querySelector('#qc-continue').onclick = close;
        body.querySelector('#qc-checkout').onclick = () => { close(); showScreen('order'); };
        body.querySelector('#qc-clear').onclick = async () => {
          const res = await showDialog({
            title: 'خالی کردن سبد',
            message: 'همه اقلام سبد سفارش حذف شود؟',
            buttons: [
              { label: 'انصراف', value: false },
              { label: 'خالی کن', value: true, kind: 'btn-danger' }
            ]
          });
          if (res) {
            await OrderManager.clearCart();
            close();
            updateCartFab();
            showToast('سبد خالی شد');
          }
        };
      }
    });
  }

  function updateJorFab() {
    let fab = $id('jor-fab');
    if (state.jorSelection.size === 0 || state.screen !== 'products') {
      if (fab) fab.hidden = true;
      return;
    }
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'jor-fab';
      fab.className = 'cart-fab';
      Object.assign(fab.style, {
        bottom: 'calc(92px + env(safe-area-inset-bottom))',
        width: 'auto', height: '44px', borderRadius: '22px', padding: '0 16px',
        whiteSpace: 'nowrap', fontSize: '13px', fontWeight: '700',
        background: 'linear-gradient(135deg,#7c3aed,#5b21b6)'
      });
      document.body.appendChild(fab);
      fab.addEventListener('click', openJorReviewSheet);
    }
    fab.hidden = false;
    fab.innerHTML = '⭐ تکمیل جور (' + Utils.faNum(state.jorSelection.size) + ')';
  }

  function jorSuggestedName() {
    const names = Array.from(state.jorSelection.values()).map((v) => v.product.name.trim());
    if (!names.length) return 'جور';
    // برند مشترک: بخش بعد از آخرین "-" در نام، اگر بین همه یکسان بود
    const brands = names.map((n) => { const i = n.lastIndexOf('-'); return i >= 0 ? n.slice(i + 1).trim() : ''; });
    const brand = brands.every((b) => b && b === brands[0]) ? brands[0] : '';
    // بخش مشترک ابتدای نام‌ها (حداکثر ۲ کلمه) به‌عنوان دستهٔ کلی
    const wordLists = names.map((n) => (n.split('-')[0] || n).trim().split(/\s+/));
    let common = [];
    for (let i = 0; i < 2; i++) {
      const w = wordLists[0][i];
      if (w && wordLists.every((wl) => wl[i] === w)) common.push(w);
      else break;
    }
    const category = common.join(' ');
    return [category, brand, 'جور'].filter(Boolean).join(' ');
  }

  function openJorReviewSheet() {
    const entries = Array.from(state.jorSelection.entries());
    if (!entries.length) return;
    const rows = entries.map(([whKey, { product }]) => `
      <div class="pack-item" data-jor-row="${Utils.esc(whKey)}">
        <div class="pack-info">
          <div class="pack-name">${Utils.esc(product.name)}</div>
          <div class="pack-note">قیمت واحد: ${Utils.formatMoney(product.priceToman)}</div>
        </div>
        <div class="pack-btns"><button class="btn btn-danger btn-sm" data-jor-remove="${Utils.esc(whKey)}" aria-label="حذف">🗑</button></div>
      </div>`).join('');
    const priced = entries.filter(([, { product }]) => product.priceToman !== null && product.priceToman !== undefined);
    const avgPrice = priced.length ? Math.round(priced.reduce((s, [, { product }]) => s + product.priceToman, 0) / priced.length) : null;
    const hasMissingPrice = priced.length < entries.length;
    showSheet({
      title: '⭐ تکمیل جور',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام این قلم در سبد/فاکتور:</label>
          <input type="text" id="jor-name-input" value="${Utils.esc(jorSuggestedName())}" autocomplete="off">
        </div>
        <div id="jor-review-list" style="margin-top:10px">${rows}</div>
        ${hasMissingPrice ? '<div class="ci-warn" style="margin-top:8px">⚠️ برخی اقلام انتخابی قیمت ندارند؛ در میانگین قیمت لحاظ نشده‌اند.</div>' : ''}
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">تعداد کل (مجموع همه کدهای بالا):</label>
          <input type="number" id="jor-total-qty" class="qty-sheet-num" value="1" min="1" inputmode="numeric">
        </div>
        <div class="ci-offer-row" style="margin-top:10px">
          <span class="ci-offer-label">آفر:</span>
          <input type="text" id="jor-offer" class="ci-offer-input" placeholder="آفر این جور (اختیاری)" autocomplete="off">
        </div>
        <div class="qty-sheet-info" id="jor-total-line" style="margin-top:10px;font-weight:700">جمع تقریبی: ${avgPrice === null ? '—' : Utils.formatMoney(avgPrice)}</div>
        <div class="dialog-btns" style="margin-top:12px">
          <button id="jor-cancel-all" class="btn btn-ghost">لغو جور</button>
          <button id="jor-confirm" class="btn btn-primary">افزودن به سبد</button>
        </div>`,
      onMount(body, close) {
        const qtyInput = body.querySelector('#jor-total-qty');
        const totalLine = body.querySelector('#jor-total-line');
        setTimeout(() => { qtyInput.focus(); qtyInput.select(); }, 60);
        const updateTotal = () => {
          const n = Math.max(1, parseInt(qtyInput.value, 10) || 1);
          totalLine.textContent = 'جمع تقریبی: ' + (avgPrice === null ? '—' : Utils.formatMoney(avgPrice * n));
        };
        qtyInput.addEventListener('input', updateTotal);
        body.querySelector('#jor-review-list').addEventListener('click', (e) => {
          const rm = e.target.closest('[data-jor-remove]');
          if (!rm) return;
          state.jorSelection.delete(rm.dataset.jorRemove);
          const chk = document.querySelector(`[data-jor-toggle="${CSS.escape(rm.dataset.jorRemove)}"]`);
          if (chk) chk.checked = false;
          close();
          updateJorFab();
          if (state.jorSelection.size) openJorReviewSheet();
        });
        body.querySelector('#jor-cancel-all').onclick = () => {
          state.jorSelection.forEach((_, whKey) => {
            const chk = document.querySelector(`[data-jor-toggle="${CSS.escape(whKey)}"]`);
            if (chk) chk.checked = false;
          });
          state.jorSelection.clear();
          close();
          updateJorFab();
        };
        body.querySelector('#jor-confirm').onclick = async () => {
          if (hasMissingPrice) {
            const ok = await showDialog({
              title: '⚠️ قیمت ناقص',
              message: 'برخی اقلام انتخابی قیمت ندارند. با این وجود جور تکمیل شود؟',
              buttons: [
                { label: 'انصراف', value: false },
                { label: 'بله، ادامه بده', value: true, kind: 'btn-primary' }
              ]
            });
            if (!ok) return;
          }
          const name = body.querySelector('#jor-name-input').value;
          const offer = body.querySelector('#jor-offer').value;
          const totalQty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
          const items = Array.from(state.jorSelection.values()).map(({ product }) => ({
            code: product.code, name: product.name, warehouse: product.warehouse, priceToman: product.priceToman
          }));
          try {
            await OrderManager.addJorToCart(name, items, totalQty, offer);
            state.jorSelection.forEach((_, whKey) => {
              const chk = document.querySelector(`[data-jor-toggle="${CSS.escape(whKey)}"]`);
              if (chk) chk.checked = false;
            });
            state.jorSelection.clear();
            close();
            updateJorFab();
            updateCartFab();
            showToast('جور به سبد اضافه شد ✓', 'success');
          } catch (err) {
            showToast('خطا: ' + Backend.faErr(err), 'error');
          }
        };
      }
    });
  }

  /* ---------- افزودن به سفارش (شیت تعداد) ---------- */

  function openQtySheet(product, addFn) {
    const doAdd = addFn || ((p, n, offer) => OrderManager.addToCart(p, n, offer));
    const stock = product.stock;
    const stockTxt = stock === null || stock === undefined ? 'موجودی: نامشخص' : 'موجودی: ' + Utils.faNum(stock);
    const aliasList = (Aliases.getFor(product.code) || []).join('، ');
    const packInfo = PackSize.getFor(product.code);
    showSheet({
      title: 'افزودن به سفارش',
      html: `
        <div class="qty-sheet-info">${Utils.esc(product.name)}<br>کد: ${Utils.esc(product.code)} | ${Utils.esc(warehouseName(product.warehouse))}
        ${aliasList ? '<br>🏷 نام مستعار: ' + Utils.esc(aliasList) : ''}
        ${packInfo ? '<br>📦 پک: ' + Utils.esc(String(packInfo.size)) + (packInfo.note ? ' — ' + Utils.esc(packInfo.note) : '') : ''}</div>
        <input type="number" id="qty-input" class="qty-sheet-num" value="1" min="1" inputmode="numeric">
        <div class="qty-sheet-info" id="qty-stock-line">${stockTxt} | قیمت واحد: ${Utils.formatMoney(product.priceToman)}</div>
        <div id="qty-warn" class="ci-warn" hidden>⚠️ تعداد از موجودی بیشتر است!</div>
        <div class="ci-offer-row" style="margin-top:10px">
          <span class="ci-offer-label">آفر:</span>
          <input type="text" id="qty-offer" class="ci-offer-input" placeholder="آفر این محصول (اختیاری)" autocomplete="off">
        </div>
        <div class="dialog-btns">
          <button id="qty-cancel" class="btn btn-ghost">انصراف</button>
          <button id="qty-ok" class="btn btn-primary">افزودن به سفارش</button>
        </div>`,
      onMount(body, close) {
        const input = body.querySelector('#qty-input');
        const offerInput = body.querySelector('#qty-offer');
        const warn = body.querySelector('#qty-warn');
        const stockLine = body.querySelector('#qty-stock-line');
        const check = () => {
          const n = parseInt(input.value, 10) || 0;
          if (stock !== null && stock !== undefined && n > stock) {
            warn.hidden = false;
            stockLine.innerHTML = stockTxt + ' | قیمت واحد: ' + Utils.formatMoney(product.priceToman) + ' — <b style="color:var(--danger)">تعداد ' + Utils.faNum(n) + ' از موجودی بیشتر است</b>';
          } else {
            warn.hidden = true;
            stockLine.innerHTML = stockTxt + ' | قیمت واحد: ' + Utils.formatMoney(product.priceToman);
          }
        };
        input.addEventListener('input', check);
        body.querySelector('#qty-cancel').onclick = close;
        const okBtn = body.querySelector('#qty-ok');
        okBtn.onclick = async () => {
          if (okBtn.disabled) return;   // لمس سریع/دوباره: تا پایان افزودن قبلی نادیده گرفته می‌شود
          okBtn.disabled = true;
          const n = parseInt(input.value, 10) || 1;
          try {
            await doAdd(product, n, offerInput.value);
          } catch (err) {
            // خطا نباید به Unhandled Promise تبدیل شود؛ شیت باز می‌ماند و کاربر می‌تواند دوباره تلاش کند
            okBtn.disabled = false;
            showToast('افزودن ناموفق بود. دوباره تلاش کنید.', 'error');
            return;
          }
          close();
          showToast('به سفارش اضافه شد ✓', 'success');
          updateCartFab();
        };
        setTimeout(() => { input.focus(); input.select(); }, 60);
      }
    });
  }

  /* ---------- صفحه سفارش (سبد) ---------- */

  /* پر کردن فیلدهای اطلاعات سفارش از پیش‌نویس ذخیره‌شده */
  function fillOrderInfo() {
    const info = OrderManager.getCartInfo();
    if (!$id('oi-visitor')) return;
    $id('oi-visitor').value = info.visitorName || '';
    $id('oi-pharmacy').value = info.pharmacyName || '';
    $id('oi-address').value = info.pharmacyAddress || '';
    if ($id('oi-area')) $id('oi-area').value = info.pharmacyArea || '';
    $id('oi-phone').value = info.pharmacyPhone || '';
    $id('oi-note').value = info.note || '';
    if ($id('oi-offer')) $id('oi-offer').value = info.offer || '';
    // گزینه‌های آفر از سفارش‌های قبلی (برای انتخاب سریع)
    const dl = $id('offer-list');
    if (dl) {
      const offers = Array.from(new Set((state.orders || []).map((o) => (o.offer || '').trim()).filter(Boolean)));
      dl.innerHTML = offers.map((v) => '<option value="' + Utils.esc(v) + '"></option>').join('');
    }
  }

  /* خواندن فیلدهای اطلاعات سفارش از فرم */
  function readOrderInfo() {
    return {
      visitorName: ($id('oi-visitor') ? $id('oi-visitor').value : '').trim(),
      pharmacyName: ($id('oi-pharmacy') ? $id('oi-pharmacy').value : '').trim(),
      pharmacyAddress: ($id('oi-address') ? $id('oi-address').value : '').trim(),
      pharmacyArea: ($id('oi-area') ? $id('oi-area').value : '').trim(),
      pharmacyPhone: ($id('oi-phone') ? $id('oi-phone').value : '').trim(),
      note: ($id('oi-note') ? $id('oi-note').value : '').trim(),
      offer: ($id('oi-offer') ? $id('oi-offer').value : '').trim()
    };
  }

  function renderOrderScreen() {
    fillOrderInfo();
    const cart = OrderManager.getCart();
    const wrap = $id('order-items');
    const empty = $id('order-empty');
    const summary = $id('order-summary');
    const actions = $id('order-actions');
    if (!cart.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      summary.hidden = true;
      actions.hidden = true;
      return;
    }
    empty.hidden = true;
    summary.hidden = false;
    actions.hidden = false;
    const over = OrderManager.overStockItems().map((i) => i.whKey);
    wrap.innerHTML = cart.map((it) => {
      const overStock = it.stock !== null && it.qty > it.stock;
      const warnHtml = overStock
        ? `<div class="ci-warn danger">⚠️ موجودی: ${it.stock === null ? 'نامشخص' : Utils.faNum(it.stock)} — تعداد سفارش (${Utils.faNum(it.qty)}) بیشتر از موجودی است!</div>`
        : '';
      const subLine = it.isJor
        ? `⭐ جور — ${Utils.faNum(it.jorCount || 0)} عدد در ${Utils.faNum((it.jorItems || []).length)} قلم`
        : `کد: ${Utils.esc(it.code)} | ${Utils.esc(warehouseName(it.warehouse))}`;
      return `<div class="cart-item">
        <div class="ci-top">
          <div>
            <div class="ci-name">${Utils.esc(it.name)}</div>
            <div class="ci-sub">${subLine}</div>
          </div>
          <button class="ci-remove" data-rm="${Utils.esc(it.whKey)}" aria-label="حذف">✕</button>
        </div>
        <div class="ci-body">
          <div class="qty-stepper">
            <button class="qty-btn" data-dec="${Utils.esc(it.whKey)}">−</button>
            <span class="qty-val">${Utils.faNum(it.qty)}</span>
            <button class="qty-btn" data-inc="${Utils.esc(it.whKey)}">+</button>
          </div>
          <div class="ci-price">
            <div class="unit">${Utils.faNum(it.priceToman)} تومان × ${Utils.faNum(it.qty)}</div>
            <div class="line">${Utils.formatMoney(it.lineTotal !== undefined ? it.lineTotal : it.qty * (it.priceToman || 0))}</div>
          </div>
        </div>
        <div class="ci-offer-row">
          <span class="ci-offer-label">آفر:</span>
          <input class="ci-offer-input" data-offer="${Utils.esc(it.whKey)}" value="${Utils.esc(it.offer || '')}" placeholder="آفر این محصول (اختیاری)" autocomplete="off">
        </div>
        ${warnHtml}
      </div>`;
    }).join('');

    $id('order-count').textContent = Utils.faNum(OrderManager.cartItemCount()) + ' قلم / ' + Utils.faNum(OrderManager.cartCount()) + ' عدد';
    $id('order-total').textContent = Utils.formatMoney(OrderManager.cartTotal());
    updateCartFab();
  }

  $id('order-items').addEventListener('click', async (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const rm = e.target.closest('[data-rm]');
    const cart = OrderManager.getCart();
    if (inc) {
      const it = cart.find((i) => i.whKey === inc.dataset.inc);
      if (it) { await OrderManager.setQty(it.whKey, it.qty + 1); renderOrderScreen(); }
    } else if (dec) {
      const it = cart.find((i) => i.whKey === dec.dataset.dec);
      if (it) { await OrderManager.setQty(it.whKey, it.qty - 1); renderOrderScreen(); }
    } else if (rm) {
      await OrderManager.removeItem(rm.dataset.rm);
      renderOrderScreen();
      showToast('از سفارش حذف شد');
    }
  });

  /* آفر هر قلم — مستقل و بدون تأثیر روی مبلغ (بدون رندر مجدد تا فوکوس حفظ شود) */
  $id('order-items').addEventListener('input', (e) => {
    const inp = e.target.closest('[data-offer]');
    if (inp) OrderManager.setItemOffer(inp.dataset.offer, inp.value);
  });

  $id('btn-clear-order').addEventListener('click', async () => {
    const res = await showDialog({
      title: 'خالی کردن سبد',
      message: 'همه اقلام سبد سفارش حذف شود؟',
      buttons: [
        { label: 'انصراف', value: false },
        { label: 'خالی کن', value: true, kind: 'btn-danger' }
      ]
    });
    if (res) { await OrderManager.clearCart(); renderOrderScreen(); showToast('سبد خالی شد'); }
  });

  $id('btn-save-order').addEventListener('click', async () => {
    if (state.savingOrder) return; // جلوگیری از دوبار-کلیک/ثبت تکراری
    const over = OrderManager.overStockItems();
    const total = OrderManager.cartTotal();
    let res;
    if (over.length) {
      const list = over.map((i) => `• ${Utils.esc(i.name)} — تعداد سفارش ${Utils.faNum(i.qty)} از موجودی (${Utils.faNum(i.stock)}) بیشتر است`).join('<br>');
      res = await showDialog({
        title: '⚠️ هشدار موجودی',
        html: `موجودی انبار برای برخی اقلام کافی نیست:<br><br>${list}<br><br>با این وجود سفارش ثبت شود؟`,
        buttons: [
          { label: 'برگشت', value: false },
          { label: 'بله، ثبت کن', value: true, kind: 'btn-primary' }
        ]
      });
    } else {
      res = await showDialog({
        title: 'ثبت سفارش',
        message: 'سفارش با ' + Utils.faNum(OrderManager.cartItemCount()) + ' قلم به مبلغ ' + Utils.formatMoney(total) + ' ثبت شود؟',
        buttons: [
          { label: 'انصراف', value: false },
          { label: 'ثبت سفارش', value: true, kind: 'btn-primary' }
        ]
      });
    }
    if (!res) return;
    if (state.savingOrder) return; // دفاع مجدد: اگر بین باز بودن دیالوگ، کلیک دیگری قبلاً ثبت را شروع کرده
    state.savingOrder = true;
    const btn = $id('btn-save-order');
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'در حال ثبت...';
    try {
      const order = await OrderManager.saveOrder(readOrderInfo());
      state.orders.unshift(order);
      fillOrderInfo(); // پاک‌کردن فرم بعد از ثبت
      updateCartFab();
      if (order.pendingSync) {
        showToast('سفارش شماره ' + Utils.faNum(order.no) + ' فقط روی این گوشی ذخیره شد ⚠️', 'error');
        await showOfflineSaveNotice(order);
      } else {
        showToast('سفارش شماره ' + Utils.faNum(order.no) + ' ثبت شد ✓', 'success');
      }
      showScreen('order-detail', { order });
    } catch (err) {
      showToast('خطا در ثبت سفارش: ' + Backend.faErr(err), 'error');
    } finally {
      state.savingOrder = false;
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  });

  /* ---------- سفارش‌های قبلی ---------- */

  const ORDERS_PAGE_SIZE = 150;

  async function loadOrders() {
    state.ordersOffset = 0;
    state.ordersFullyLoaded = false;
    const list = await DB.getAllOrders({ limit: ORDERS_PAGE_SIZE, offset: 0 });
    const serverCount = list.length;
    if (DB.useBackend()) {
      // سفارش‌های ذخیره‌شده‌ی آفلاین روی این گوشی هم نمایش و خودکار ارسال شوند
      const pend = await DB.getLocalPendingOrders();
      pend.forEach((p) => { if (!list.some((o) => o.id === p.id)) list.push(p); });
    }
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    state.orders = list;
    state.ordersOffset = serverCount;
    state.ordersHasMore = serverCount === ORDERS_PAGE_SIZE;
    if (!state.ordersHasMore) state.ordersFullyLoaded = true;
    try { state.ordersTotalCount = await DB.getOrdersCount(); } catch (e) { state.ordersTotalCount = state.orders.length; }
  }

  async function loadMoreOrders() {
    if (state.ordersFullyLoaded || state.loadingMoreOrders) return;
    state.loadingMoreOrders = true;
    try {
      const more = await DB.getAllOrders({ limit: ORDERS_PAGE_SIZE, offset: state.ordersOffset });
      more.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      state.orders = state.orders.concat(more);
      state.ordersOffset += more.length;
      state.ordersHasMore = more.length === ORDERS_PAGE_SIZE;
      if (!state.ordersHasMore) state.ordersFullyLoaded = true;
    } finally {
      state.loadingMoreOrders = false;
    }
  }

  /* برای صفحاتی که به کل تاریخچه نیاز دارند (آرشیو داروخانه‌ها) — تا
     تمام‌شدن صفحه‌ها ادامه می‌دهد، فقط یک‌بار در طول نشست انجام می‌شود. */
  async function ensureAllOrdersLoaded() {
    while (!state.ordersFullyLoaded) {
      await loadMoreOrders();
    }
  }

  function renderOrdersList() {
    const wrap = $id('orders-list');
    const empty = $id('orders-empty');
    const searchEmpty = $id('orders-search-empty');
    const pendingCount = state.orders.filter((o) => o.pendingSync).length;
    const banner = $id('orders-sync-banner');
    if (banner) {
      if (pendingCount > 0) {
        banner.hidden = false;
        banner.textContent = '📴 ' + Utils.faNum(pendingCount) + ' سفارش هنوز به سرور ارسال نشده — با وصل‌بودن اینترنت خودکار ارسال می‌شن؛ اگه صبر نمی‌کنی، وارد هرکدوم شو و «ارسال به سرور» رو بزن.';
      } else {
        banner.hidden = true;
      }
    }
    if (!state.orders.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      if (searchEmpty) searchEmpty.hidden = true;
      return;
    }
    empty.hidden = true;
    const q = Utils.norm((state.ordersSearchQuery || '').trim());
    const list = q
      ? state.orders.filter((o) => {
          const hay = Utils.norm([o.pharmacyName, o.visitorName, String(o.no)].filter(Boolean).join(' '));
          return hay.includes(q);
        })
      : state.orders;
    if (searchEmpty) searchEmpty.hidden = list.length > 0;
    const loadMoreBtn = $id('orders-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.hidden = !state.ordersHasMore;
      loadMoreBtn.textContent = state.loadingMoreOrders ? 'در حال بارگذاری...' : 'بارگذاری سفارش‌های قدیمی‌تر';
      loadMoreBtn.disabled = !!state.loadingMoreOrders;
    }
    wrap.innerHTML = list.map((o) => `
      <div class="order-card" data-oid="${o.id}">
        <div class="oc-no">${Utils.faNum(o.no)}</div>
        <div class="oc-body">
          <div class="oc-title">سفارش شماره ${Utils.faNum(o.no)} ${o.pendingSync ? '<span class="jor-badge" style="background:#fee2e2;color:#b91c1c;border-color:#fca5a5">📴 همگام‌نشده</span>' : ''}</div>
          <div class="oc-sub">${Utils.faFullDate(o.createdAt)} — ${Utils.faTime(o.createdAt)} | ${Utils.faNum(o.items.length)} قلم${o.pharmacyName ? ' | ' + Utils.esc(o.pharmacyName) : ''}</div>
        </div>
        <div class="oc-total">
          <div class="t">${Utils.faNum(o.total)}</div>
          <div class="d">تومان</div>
        </div>
        <button class="oc-edit" data-edit-oid="${o.id}" title="ویرایش سفارش" aria-label="ویرایش">✏️</button>
      </div>`).join('');
  }

  $id('orders-search').addEventListener('input', (e) => {
    state.ordersSearchQuery = e.target.value;
    renderOrdersList();
  });

  $id('orders-load-more').addEventListener('click', async () => {
    renderOrdersList(); // نمایش «در حال بارگذاری...»
    try {
      await loadMoreOrders();
    } catch (e) {
      showToast('خطا در بارگذاری: ' + Backend.faErr(e), 'error');
    }
    renderOrdersList();
  });

  $id('orders-list').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-oid]');
    if (editBtn) {
      startEditOrder(Number(editBtn.dataset.editOid));
      return;
    }
    const card = e.target.closest('[data-oid]');
    if (card) {
      state.currentOrderId = Number(card.dataset.oid);
      showScreen('order-detail');
    }
  });

  /* ---------- سطل زبالهٔ سفارش‌ها ---------- */

  $id('btn-orders-trash').addEventListener('click', () => showScreen('orders-trash'));

  function renderOrdersTrash() {
    const wrap = $id('orders-trash-list');
    const empty = $id('orders-trash-empty');
    const clearAllBtn = $id('btn-trash-clear-all');
    wrap.innerHTML = '<div class="progress-box"><div class="dz-icon">⏳</div><div class="progress-text">در حال بارگذاری…</div></div>';
    DB.getDeletedOrders().then((list) => {
      if (!list.length) {
        wrap.innerHTML = '';
        empty.hidden = false;
        if (clearAllBtn) clearAllBtn.hidden = true;
        return;
      }
      empty.hidden = true;
      if (clearAllBtn) clearAllBtn.hidden = false;
      wrap.innerHTML = list.map((o) => {
        const daysLeft = Math.max(0, 7 - Math.floor((Date.now() - new Date(o.deletedAt || o.createdAt).getTime()) / 86400000));
        return `
        <div class="order-card" style="cursor:default">
          <div class="oc-no">${Utils.faNum(o.no)}</div>
          <div class="oc-body">
            <div class="oc-title">سفارش شماره ${Utils.faNum(o.no)}</div>
            <div class="oc-sub">${Utils.faFullDate(o.createdAt)} | ${Utils.faNum(o.items.length)} قلم${o.pharmacyName ? ' | ' + Utils.esc(o.pharmacyName) : ''}</div>
            <div class="oc-sub" style="color:${daysLeft <= 2 ? 'var(--danger)' : 'var(--muted)'}">⏳ ${daysLeft > 0 ? Utils.faNum(daysLeft) + ' روز تا پاک‌سازی خودکار' : 'امروز/فردا پاک می‌شه'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-primary btn-sm" data-restore-oid="${o.id}">↩️ بازیابی</button>
            <button class="btn btn-danger btn-sm" data-purge-oid="${o.id}">حذف کامل</button>
          </div>
        </div>`;
      }).join('');
    }).catch((e) => {
      wrap.innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + Utils.esc(Backend.faErr(e)) + '</p></div>';
    });
  }

  $id('btn-trash-clear-all').addEventListener('click', async () => {
    const res = await showDialog({
      title: 'پاک کردن کامل سطل زباله',
      message: 'همه‌ی سفارش‌های داخل سطل زباله برای همیشه پاک بشن؟ این کار قابل بازگشت نیست.',
      buttons: [
        { label: 'انصراف', value: false },
        { label: 'پاک کن', value: true, kind: 'btn-danger' }
      ]
    });
    if (!res) return;
    try {
      const list = await DB.getDeletedOrders();
      for (const o of list) {
        await DB.permanentlyDeleteOrder(o.id);
      }
      showToast('سطل زباله خالی شد ✓', 'success');
      renderOrdersTrash();
    } catch (err) {
      showToast('خطا: ' + Backend.faErr(err), 'error');
    }
  });

  $id('orders-trash-list').addEventListener('click', async (e) => {
    const rb = e.target.closest('[data-restore-oid]');
    if (rb) {
      try {
        await DB.restoreOrder(rb.dataset.restoreOid);
        state.orders = await DB.getAllOrders();
        showToast('سفارش بازیابی شد ✓', 'success');
        renderOrdersTrash();
      } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
      return;
    }
    const pb = e.target.closest('[data-purge-oid]');
    if (pb) {
      const res = await showDialog({
        title: 'حذف کامل و دائمی',
        message: 'این سفارش برای همیشه پاک می‌شود و دیگر قابل بازیابی نیست. مطمئنی؟',
        buttons: [
          { label: 'انصراف', value: false },
          { label: 'حذف کامل', value: true, kind: 'btn-danger' }
        ]
      });
      if (!res) return;
      try {
        await DB.permanentlyDeleteOrder(pb.dataset.purgeOid);
        showToast('برای همیشه حذف شد', 'success');
        renderOrdersTrash();
      } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
    }
  });

  /* ---------- داروخانه‌های هدف (لید/پیگیری آینده) ---------- */

  const TP_STATUS_LABEL = { pending: 'در انتظار پیگیری', contacted: 'تماس گرفته شد', converted: '✅ مشتری شد' };
  const TP_STATUS_COLOR = { pending: 'var(--muted)', contacted: 'var(--amber)', converted: 'var(--brand-dark)' };

  async function updateTargetPharmacyBadge() {
    const badge = $id('tp-badge');
    if (!badge || !Backend.isActive()) { if (badge) badge.textContent = 'برای پیگیری آینده'; return; }
    try {
      const list = await Backend.getTargetPharmacies();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = list.filter((t) => t.status !== 'converted' && t.followUpDate && new Date(t.followUpDate) <= today).length;
      badge.textContent = due > 0 ? '⏰ ' + Utils.faNum(due) + ' مورد آماده پیگیری' : 'برای پیگیری آینده';
      badge.style.color = due > 0 ? 'var(--danger)' : '';
      badge.style.fontWeight = due > 0 ? '700' : '';
    } catch (e) { badge.textContent = 'برای پیگیری آینده'; }
  }

  /* ---------- آکاردئون خیابان‌ها (داروخانه‌های هدف + آرشیو) ---------- */
  state.accOpen = { tp: new Set(), arch: new Set() };

  function accSection(scope, key, titleInner, bodyHtml, forceOpen) {
    const open = !!forceOpen || state.accOpen[scope].has(key);
    return `
      <div class="arch-group-title acc-title" role="button" tabindex="0" aria-expanded="${open}" data-acc-key="${Utils.esc(key)}"
           style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${titleInner}</span><span class="acc-arrow" aria-hidden="true">${open ? '▾' : '◂'}</span>
      </div>
      <div class="acc-body"${open ? '' : ' hidden'}>${bodyHtml}</div>`;
  }

  function accToolbar(count, unit) {
    if (unit) {
      return '<div class="acc-bar"><span>' + Utils.faNum(count) + ' ' + unit + '</span>'
        + (count > 1 ? '<button type="button" class="acc-all" data-acc-all>⇅ باز/بستن همه</button>' : '') + '</div>';
    }
    return count > 1
      ? '<div style="margin-bottom:6px"><button type="button" class="btn btn-ghost btn-sm" data-acc-all>⇅ باز/بستن همه‌ی خیابان‌ها</button></div>'
      : '';
  }

  function wireAccordion(listId, scope) {
    const root = $id(listId);
    const setOpen = (title, open) => {
      const body = title.nextElementSibling;
      if (!body || !body.classList.contains('acc-body')) return;
      body.hidden = !open;
      title.setAttribute('aria-expanded', String(open));
      const arrow = title.querySelector('.acc-arrow');
      if (arrow) arrow.textContent = open ? '▾' : '◂';
      const key = title.dataset.accKey;
      if (open) state.accOpen[scope].add(key); else state.accOpen[scope].delete(key);
    };
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-acc-all]')) {
        const titles = Array.from(root.querySelectorAll('.acc-title'));
        const anyClosed = titles.some((t) => t.getAttribute('aria-expanded') !== 'true');
        titles.forEach((t) => setOpen(t, anyClosed));
        return;
      }
      const t = e.target.closest('.acc-title');
      if (t) setOpen(t, t.getAttribute('aria-expanded') !== 'true');
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest('.acc-title');
      if (t) { e.preventDefault(); setOpen(t, t.getAttribute('aria-expanded') !== 'true'); }
    });
  }

  async function renderTargetPharmacies() {
    const wrap = $id('tp-list');
    const empty = $id('tp-empty');
    wrap.innerHTML = '<div class="progress-box"><div class="dz-icon">⏳</div><div class="progress-text">در حال بارگذاری…</div></div>';
    try {
      const list = await Backend.getTargetPharmacies();
      if (!list.length) {
        wrap.innerHTML = '';
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const rowHtml = (t) => {
        const isDue = t.status !== 'converted' && t.followUpDate && new Date(t.followUpDate) <= today;
        return `
        <div class="order-card" style="cursor:pointer;flex-wrap:wrap" data-tp-open="${t.id}">
          <div class="oc-body">
            <div class="oc-title">${Utils.esc(t.name)} ${isDue ? '<span class="jor-badge" style="background:#fee2e2;color:#b91c1c;border-color:#fca5a5">⏰ زمان پیگیریه</span>' : ''}</div>
            <div class="oc-sub">${t.address ? Utils.esc(t.address) : ''}${t.phone ? (t.address ? ' | ' : '') + Utils.esc(t.phone) : ''}</div>
            <div class="oc-sub" style="color:${TP_STATUS_COLOR[t.status] || 'var(--muted)'}">${TP_STATUS_LABEL[t.status] || t.status}${t.followUpDate ? ' | پیگیری: ' + Utils.faDate(t.followUpDate) : ''}</div>
            ${t.note ? '<div class="oc-sub" style="margin-top:2px">📝 ' + Utils.esc(t.note) + '</div>' : ''}
          </div>
        </div>`;
      };
      // دسته‌بندی بر اساس منطقه/خیابان (مثل آرشیو سفارش‌ها)
      const groupMap = new Map();
      list.forEach((t) => {
        const area = (t.area || '').trim();
        const key = area || '__none__';
        if (!groupMap.has(key)) groupMap.set(key, { area: area || 'بدون منطقه', items: [] });
        groupMap.get(key).items.push(t);
      });
      const groups = Array.from(groupMap.values());
      groups.sort((a, b) => (a.area === 'بدون منطقه' ? 1 : b.area === 'بدون منطقه' ? -1 : Utils.norm(a.area).localeCompare(Utils.norm(b.area), 'fa')));
      const isDueItem = (t) => t.status !== 'converted' && t.followUpDate && new Date(t.followUpDate) <= today;
      wrap.innerHTML = '<div class="acc-card">' + accToolbar(groups.length, 'خیابان') + groups.map((g) => accSection(
        'tp', g.area,
        `<span class="acc-ico">📍</span><span class="acc-name">${Utils.esc(g.area)}</span>`
          + `<span class="acc-count">${Utils.faNum(g.items.length)}</span>`
          + (g.items.some(isDueItem) ? '<span class="acc-due" title="زمان پیگیری رسیده">⏰</span>' : ''),
        g.items.map(rowHtml).join(''),
        g.items.some(isDueItem)
      )).join('') + '</div>';
    } catch (e) {
      wrap.innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + Utils.esc(Backend.faErr(e)) + '</p></div>';
    }
  }

  function openTargetPharmacySheet(existing) {
    showSheet({
      title: existing ? '✏️ ویرایش داروخانه هدف' : '➕ افزودن داروخانه هدف',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام داروخانه *</label>
          <input type="text" id="tp-name" value="${existing ? Utils.esc(existing.name) : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">آدرس</label>
          <input type="text" id="tp-address" value="${existing ? Utils.esc(existing.address || '') : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">منطقه/خیابان (برای دسته‌بندی)</label>
          <input type="text" id="tp-area" value="${existing ? Utils.esc(existing.area || '') : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">شماره تلفن</label>
          <input type="tel" id="tp-phone" value="${existing ? Utils.esc(existing.phone || '') : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">توضیحات (چی گفتن، چرا الان سفارش نمی‌دن و…)</label>
          <textarea id="tp-note" rows="3" style="width:100%;resize:vertical">${existing ? Utils.esc(existing.note || '') : ''}</textarea>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">تاریخ پیگیری بعدی (شمسی)</label>
          <div style="display:flex;gap:6px">
            <select id="tp-followup-day" style="flex:1"></select>
            <select id="tp-followup-month" style="flex:1.6"></select>
            <select id="tp-followup-year" style="flex:1"></select>
          </div>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">وضعیت</label>
          <select id="tp-status" style="width:100%">
            <option value="pending" ${(!existing || existing.status === 'pending') ? 'selected' : ''}>در انتظار پیگیری</option>
            <option value="contacted" ${existing && existing.status === 'contacted' ? 'selected' : ''}>تماس گرفته شد</option>
            <option value="converted" ${existing && existing.status === 'converted' ? 'selected' : ''}>✅ مشتری شد</option>
          </select>
        </div>
        <div class="dialog-btns" style="margin-top:14px">
          ${existing ? '<button id="tp-delete" class="btn btn-danger">🗑 حذف</button>' : '<button id="tp-cancel" class="btn btn-ghost">انصراف</button>'}
          <button id="tp-save" class="btn btn-primary">${existing ? 'ذخیره تغییرات' : 'افزودن'}</button>
        </div>`,
      onMount(body, close) {
        setTimeout(() => body.querySelector('#tp-name').focus(), 60);
        const cancelBtn = body.querySelector('#tp-cancel');
        if (cancelBtn) cancelBtn.onclick = close;

        // پر کردن انتخابگر تاریخ شمسی
        const dayEl = body.querySelector('#tp-followup-day');
        const monthEl = body.querySelector('#tp-followup-month');
        const yearEl = body.querySelector('#tp-followup-year');
        const todayJ = Utils.toJalali(new Date());
        let initJ = { jy: todayJ.jy, jm: todayJ.jm, jd: todayJ.jd };
        let hasDate = false;
        if (existing && existing.followUpDate) {
          const j = Utils.toJalali(new Date(existing.followUpDate));
          if (j) { initJ = j; hasDate = true; }
        }
        dayEl.innerHTML = '<option value="">روز</option>' + Array.from({ length: 31 }, (_, i) => i + 1)
          .map((d) => `<option value="${d}" ${hasDate && d === initJ.jd ? 'selected' : ''}>${Utils.faDigits(d)}</option>`).join('');
        monthEl.innerHTML = '<option value="">ماه</option>' + Utils.JALALI_MONTHS
          .map((m, i) => `<option value="${i + 1}" ${hasDate && (i + 1) === initJ.jm ? 'selected' : ''}>${m}</option>`).join('');
        const yStart = todayJ.jy - 1;
        yearEl.innerHTML = '<option value="">سال</option>' + Array.from({ length: 5 }, (_, i) => yStart + i)
          .map((y) => `<option value="${y}" ${hasDate && y === initJ.jy ? 'selected' : ''}>${Utils.faDigits(y)}</option>`).join('');

        const delBtn = body.querySelector('#tp-delete');
        if (delBtn) {
          delBtn.onclick = async () => {
            const res = await showDialog({
              title: 'حذف داروخانه هدف',
              message: 'این مورد حذف شود؟',
              buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
            });
            if (!res) return;
            try {
              await Backend.deleteTargetPharmacy(existing.id);
              close();
              renderTargetPharmacies();
              updateTargetPharmacyBadge();
              showToast('حذف شد', 'success');
            } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
          };
        }
        body.querySelector('#tp-save').onclick = async () => {
          const name = body.querySelector('#tp-name').value.trim();
          if (!name) { showToast('نام داروخانه رو وارد کن', 'error'); return; }
          const jd = parseInt(dayEl.value, 10);
          const jm = parseInt(monthEl.value, 10);
          const jy = parseInt(yearEl.value, 10);
          let followUpDate = null;
          if (jd && jm && jy) {
            const [gy, gm, gd] = Utils.jalaliToGregorian(jy, jm, jd);
            followUpDate = gy + '-' + String(gm).padStart(2, '0') + '-' + String(gd).padStart(2, '0');
          }
          const payload = {
            id: existing ? existing.id : undefined,
            name,
            address: body.querySelector('#tp-address').value.trim(),
            phone: body.querySelector('#tp-phone').value.trim(),
            area: body.querySelector('#tp-area').value.trim(),
            note: body.querySelector('#tp-note').value.trim(),
            followUpDate,
            status: body.querySelector('#tp-status').value
          };
          try {
            await Backend.putTargetPharmacy(payload);
            close();
            renderTargetPharmacies();
            updateTargetPharmacyBadge();
            showToast(existing ? 'ذخیره شد ✓' : 'اضافه شد ✓', 'success');
          } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  $id('btn-tp-add').addEventListener('click', () => openTargetPharmacySheet(null));
  $id('tp-list').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-tp-open]');
    if (!row) return;
    try {
      const list = await Backend.getTargetPharmacies();
      const item = list.find((t) => String(t.id) === row.dataset.tpOpen);
      if (item) openTargetPharmacySheet(item);
    } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
  });

  /* ---------- برنامه هفتگی ویزیت ---------- */

  const WV_DOW_NAMES = ['', 'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const WV_TYPE_LABEL = { pharmacy: '💊 داروخانه', doctor: '🩺 پزشک' };

  function persianDowOf(date) {
    const jsDay = date.getDay(); // ۰=یکشنبه میلادی ... ۶=شنبه میلادی
    return jsDay === 6 ? 1 : jsDay + 2; // ۱=شنبه ... ۷=جمعه
  }
  function todayPersianDow() { return persianDowOf(new Date()); }

  /* ---- هفته‌های ماه (۱ تا ۴) ----
     قاعده: هفته ۱ از «اولین شنبه‌ی ماه» شروع می‌شود و هفته‌های ۱ تا ۳ هفت‌روزه‌اند.
     هفته ۴ از شنبه‌ی چهارم تا آخر ماه است و روزهای قبل از اولین شنبه هم جزو هفته ۴ حساب می‌شوند.
     هر مورد برنامه یک «ماسک هفته‌ها» دارد: بیت۰ = هفته ۱ ... بیت۳ = هفته ۴ (۱۵ = هر هفته). */
  const WV_ALL_WEEKS = 15;

  function wvMonthInfo(date) {
    const d = date || new Date();
    const [jy, jm, jd] = Utils.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const day1 = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (jd - 1));
    const dow1 = persianDowOf(day1);
    let len = jd;
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    for (let k = 0; k < 32; k++) {
      t.setDate(t.getDate() + 1);
      const j = Utils.gregorianToJalali(t.getFullYear(), t.getMonth() + 1, t.getDate());
      if (j[1] !== jm) break;
      len = j[2];
    }
    return { jy, jm, jd, len, first: dow1 === 1 ? 1 : 9 - dow1 }; // first = روز ماهِ اولین شنبه
  }
  function wvWeekOfDate(date) {
    const m = wvMonthInfo(date);
    if (m.jd < m.first) return 4;
    return Math.min(4, Math.floor((m.jd - m.first) / 7) + 1);
  }
  function wvWeekRangeText(week, date) {
    const m = wvMonthInfo(date);
    const mn = Utils.JALALI_MONTHS[m.jm - 1];
    if (week < 4) {
      const s = m.first + 7 * (week - 1);
      return Utils.faNum(s) + ' تا ' + Utils.faNum(s + 6) + ' ' + mn;
    }
    let t = Utils.faNum(m.first + 21) + ' تا آخر ' + mn;
    if (m.first > 1) t += ' و ' + Utils.faNum(1) + ' تا ' + Utils.faNum(m.first - 1);
    return t;
  }
  function wvWeeksOf(v) {
    const m = Math.floor(Number(v && v.weeks));
    return m >= 1 && m <= WV_ALL_WEEKS ? m : WV_ALL_WEEKS;
  }
  function wvHasWeek(v, w) { return ((wvWeeksOf(v) >> (w - 1)) & 1) === 1; }
  function wvFirstWeek(mask) { for (let w = 1; w <= 4; w++) if ((mask >> (w - 1)) & 1) return w; return 1; }
  function wvWeeksLabel(mask) {
    if (mask === WV_ALL_WEEKS) return '';
    const ws = [1, 2, 3, 4].filter((w) => (mask >> (w - 1)) & 1);
    if (ws.length === 1) return 'فقط هفته ' + Utils.faNum(ws[0]);
    return 'هفته ' + ws.slice(0, -1).map((w) => Utils.faNum(w)).join('، ') + ' و ' + Utils.faNum(ws[ws.length - 1]);
  }
  // انتخابگر هفته‌ها (چهار دکمه + میان‌بر)؛ html را در یک div بگذارید و wvWeeksPickerBind را روی همان div صدا بزنید
  function wvWeeksPickerHtml(mask) {
    const chips = [1, 2, 3, 4].map((w) => {
      const on = (mask >> (w - 1)) & 1;
      return `<button type="button" class="wv-wk${on ? ' on' : ''}" data-wk="${w}" aria-pressed="${on ? 'true' : 'false'}">هفته ${Utils.faNum(w)}</button>`;
    }).join('');
    return `<div class="wv-wk-row">${chips}</div>
      <div class="wv-wk-quick"><button type="button" data-wk-set="15">همه (هر هفته)</button><button type="button" data-wk-set="5">۱ و ۳ (فرد)</button><button type="button" data-wk-set="10">۲ و ۴ (زوج)</button></div>`;
  }
  function wvWeeksPickerBind(root) {
    const paint = (mask) => root.querySelectorAll('.wv-wk').forEach((b) => {
      const on = (mask >> (parseInt(b.dataset.wk, 10) - 1)) & 1;
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    root.querySelectorAll('.wv-wk').forEach((b) => b.addEventListener('click', () => {
      const on = !b.classList.contains('on');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }));
    root.querySelectorAll('[data-wk-set]').forEach((b) => b.addEventListener('click', () => paint(parseInt(b.dataset.wkSet, 10))));
    return {
      get() { let m = 0; root.querySelectorAll('.wv-wk.on').forEach((b) => { m |= 1 << (parseInt(b.dataset.wk, 10) - 1); }); return m; },
      set: paint
    };
  }

  function isSameLocalDay(iso) {
    if (!iso) return false;
    const a = new Date(iso), b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  async function updateWeeklyVisitBadge() {
    const badge = $id('wv-badge');
    if (!badge || !Backend.isActive()) { if (badge) badge.textContent = 'مسیر هفتگی ویزیت'; return; }
    try {
      const list = await Backend.getWeeklyVisits();
      const dow = todayPersianDow();
      const wk = wvWeekOfDate(new Date());
      const today = list.filter((v) => v.dayOfWeek === dow && wvHasWeek(v, wk));
      const remaining = today.filter((v) => !isSameLocalDay(v.lastVisitedAt)).length;
      if (today.length === 0) { badge.textContent = 'امروز موردی نداری'; badge.style.color = ''; badge.style.fontWeight = ''; }
      else if (remaining === 0) { badge.textContent = '✅ همه ویزیت‌های امروز انجام شد'; badge.style.color = 'var(--brand-dark)'; badge.style.fontWeight = '700'; }
      else { badge.textContent = '📍 ' + Utils.faNum(remaining) + ' مورد باقی‌مانده امروز'; badge.style.color = 'var(--danger)'; badge.style.fontWeight = '700'; }
    } catch (e) { badge.textContent = 'مسیر هفتگی ویزیت'; }
  }

  // بخش‌بندی لیست یک روز: چند مورد پشت‌سرهم با «منطقه/خیابان» یکسان = یک گروه (زیرشاخه‌ها)
  // خروجی: [{ start, end, area, group }] که group فقط وقتی true است که حداقل ۲ مورد باشد
  function wvGroupRuns(list) {
    const runs = [];
    let i = 0;
    while (i < list.length) {
      const key = wvNameKey(list[i].area);
      let j = i + 1;
      if (key) while (j < list.length && wvNameKey(list[j].area) === key) j++;
      runs.push({ start: i, end: j - 1, area: String(list[i].area || '').trim(), group: !!key && j - i >= 2 });
      i = j;
    }
    return runs;
  }

  const WV_TYPE_ICON = { pharmacy: '💊', doctor: '🩺' };

  /* ردیف‌های یک روز از برنامه ویزیت (فشرده): دستگیره‌ی دراگ، شماره، نام، برچسب هفته‌ها، «ویزیت شد» و حذف
     opts: { selMode, sel:Set<string> } — در حالت انتخاب چندتایی به‌جای دستگیره یک چک‌باکس است */
  function wvCardsHtml(list, opts) {
    const o = opts || {};
    const selMode = !!o.selMode;
    const sel = o.sel || new Set();
    const card = (v, i, inGroup) => {
      const done = isSameLocalDay(v.lastVisitedAt);
      const picked = selMode && sel.has(String(v.id));
      const sub = [];
      if (v.area && !inGroup) sub.push('🗺 ' + Utils.esc(v.area));
      if (v.address) sub.push(Utils.esc(v.address));
      if (v.phone) sub.push(Utils.esc(v.phone));
      if (v.note) sub.push('📝 ' + Utils.esc(v.note));
      const pill = wvWeeksLabel(wvWeeksOf(v));
      const lead = selMode
        ? `<span class="wv-chk${picked ? ' on' : ''}" aria-hidden="true">${picked ? '✓' : ''}</span>`
        : `<span class="wv-handle" data-wv-handle="${v.id}" role="button" aria-label="جابه‌جایی با کشیدن" title="بکشید">⠿</span>`;
      const acts = selMode ? '' : `<span class="wv-acts">
          <button type="button" class="${done ? 'wv-undo' : 'wv-ok'}" data-wv-done="${v.id}" data-wv-done-val="${done ? '0' : '1'}" aria-label="${done ? 'برگردان' : 'ویزیت شد'}" title="${done ? 'برگردان' : 'ویزیت شد'}">${done ? '↩' : '✓'}</button>
          <button type="button" class="wv-x" data-wv-del="${v.id}" aria-label="حذف از برنامه" title="حذف">✕</button>
        </span>`;
      return `
        <div class="wv-row${done ? ' done' : ''}${picked ? ' sel' : ''}" data-wv-card="${v.id}">
          ${lead}<span class="wv-num">${Utils.faNum(i + 1)}</span>
          <div class="wv-main" data-wv-open="${v.id}">
            <div class="wv-name">${WV_TYPE_ICON[v.type] || ''} ${Utils.esc(v.name)}</div>
            ${sub.length ? '<div class="wv-sub">' + sub.join(' · ') + '</div>' : ''}
          </div>
          ${pill ? '<span class="wv-pill">' + pill + '</span>' : ''}
          ${acts}
        </div>`;
    };
    return wvGroupRuns(list).map((r, ri) => {
      if (!r.group) return card(list[r.start], r.start, false);
      const items = list.slice(r.start, r.end + 1);
      const allPicked = selMode && items.every((v) => sel.has(String(v.id)));
      const lead = selMode
        ? `<span class="wv-chk${allPicked ? ' on' : ''}" aria-hidden="true">${allPicked ? '✓' : ''}</span>`
        : `<span class="wv-ghandle" role="button" aria-label="جابه‌جایی کل گروه با کشیدن" title="کل گروه را بکشید">⠿</span>`;
      return `
        <div class="wv-group" data-wv-group="${ri}">
          <div class="wv-group-head"${selMode ? ` data-wv-pickgroup="${r.start}"` : ''}>${lead}<span>🗺 ${Utils.esc(r.area)}</span><i>${Utils.faNum(items.length)} مورد</i></div>
          ${items.map((v, k) => card(v, r.start + k, true)).join('')}
        </div>`;
    }).join('');
  }

  /* ---- منطق خالص (بدون DOM) برای دراگ ---- */
  // اندیس مقصد = تعداد کارت‌های «دیگر» که مرکزشان بالاتر از انگشت/ماوس است
  function wvDropIndex(otherMids, y) {
    let to = 0;
    for (const m of otherMids) if (y > m) to++;
    return to;
  }
  // لیست جدید بعد از جابه‌جایی + فقط ردیف‌هایی که شماره‌شان باید عوض شود (شماره‌ها ۱ تا n)
  function wvReorderPlan(list, from, to) {
    const next = list.slice();
    if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return { list: next, updates: [] };
    const moved = next.splice(from, 1)[0];
    next.splice(to, 0, moved);
    const updates = [];
    next.forEach((v, i) => { if (v.visitOrder !== i + 1) updates.push({ id: v.id, visitOrder: i + 1 }); });
    return { list: next, updates };
  }
  // جابه‌جایی کل یک «گروه» (یا یک مورد تکی) به جایگاه تازه بین گروه‌ها/موارد؛ runIdx و to اندیس در wvGroupRuns هستند
  function wvGroupReorderPlan(list, runIdx, to) {
    const runs = wvGroupRuns(list);
    if (runIdx < 0 || runIdx >= runs.length || to < 0 || to >= runs.length || runIdx === to) return { list: list.slice(), updates: [] };
    const blocks = runs.map((r) => list.slice(r.start, r.end + 1));
    const moved = blocks.splice(runIdx, 1)[0];
    blocks.splice(to, 0, moved);
    const next = [].concat(...blocks);
    const updates = [];
    next.forEach((v, i) => { if (v.visitOrder !== i + 1) updates.push({ id: v.id, visitOrder: i + 1 }); });
    return { list: next, updates };
  }
  // نام‌ها را از متن چندخطی/جداشده با ویرگول استخراج می‌کند (بدون تکرار، بدون شماره‌ی ابتدای خط)
  function wvNameKey(n) { return String(n || '').replace(/\s+/g, ' ').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase(); }
  function parseWvNames(text) {
    const seen = new Set();
    const out = [];
    String(text || '').split(/[\n\r,،;؛]+/).forEach((raw) => {
      const name = raw.replace(/^[\s\-•*·]+/, '').replace(/^[0-9۰-۹]+\s*[).\-–:]\s*/, '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      const key = wvNameKey(name);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(name);
    });
    return out;
  }

  function wvPaintWeekBar() {
    const seg = $id('wv-week-seg');
    if (!seg) return;
    const cur = wvWeekOfDate(new Date());
    seg.innerHTML = [1, 2, 3, 4].map((w) =>
      `<button type="button" class="${w === state.wvSelectedWeek ? 'act' : ''}${w === cur ? ' today' : ''}" data-wv-week="${w}" aria-pressed="${w === state.wvSelectedWeek}">هفته ${Utils.faNum(w)}</button>`
    ).join('');
    $id('wv-week-range').textContent = wvWeekRangeText(state.wvSelectedWeek, new Date());
  }

  function wvSelectedItems() {
    const sel = state.wvSel || new Set();
    return (state.wvCurrentList || []).filter((v) => sel.has(String(v.id)));
  }

  // لیست «همین روز و همین هفته» را بدون خواندن دوباره از سرور نشان می‌دهد (برای انتخاب/دراگ)
  function paintWvList() {
    const wrap = $id('wv-list');
    const empty = $id('wv-empty');
    const clearBtn = $id('btn-wv-clear-day');
    const list = state.wvCurrentList || [];
    const selMode = !!state.wvSelMode;
    if (!state.wvSel) state.wvSel = new Set();
    const sel = state.wvSel;
    const ids = new Set(list.map((v) => String(v.id)));
    Array.from(sel).forEach((id) => { if (!ids.has(id)) sel.delete(id); });
    $id('wv-tools').hidden = selMode;
    $id('wv-selbar').hidden = !selMode;
    $id('wv-bottombar').hidden = !(selMode && sel.size > 0);
    if (selMode) {
      $id('wv-sel-count').textContent = Utils.faNum(sel.size) + ' مورد انتخاب شد';
      $id('wv-sel-all').textContent = list.length && sel.size === list.length ? 'برداشتن همه' : 'انتخاب همه';
    }
    if (!list.length) {
      wrap.innerHTML = '';
      empty.querySelector('p').textContent = 'برای ' + WV_DOW_NAMES[state.wvSelectedDow] + ' در هفته‌ی ' + Utils.faNum(state.wvSelectedWeek) + ' موردی ثبت نشده است.';
      empty.hidden = false;
      clearBtn.hidden = true;
      return;
    }
    empty.hidden = true;
    wrap.innerHTML = wvCardsHtml(list, { selMode, sel });
    clearBtn.textContent = '🗑 حذف همه‌ی برنامه‌ی ' + WV_DOW_NAMES[state.wvSelectedDow] + ' این هفته (' + Utils.faNum(list.length) + ' مورد)';
    clearBtn.hidden = selMode;
  }

  async function renderWeeklyVisits() {
    const chipsWrap = $id('wv-day-chips');
    if (!state.wvSelectedDow) state.wvSelectedDow = todayPersianDow();
    if (!state.wvSelectedWeek) state.wvSelectedWeek = wvWeekOfDate(new Date());
    wvPaintWeekBar();
    chipsWrap.className = 'wv-strip';
    const todayDow = todayPersianDow();
    chipsWrap.innerHTML = WV_DOW_NAMES.map((name, i) => i === 0 ? '' :
      `<button type="button" class="wv-day ${i === state.wvSelectedDow ? 'active' : ''} ${i === todayDow ? 'today' : ''}" data-wv-day="${i}" aria-label="${name}${i === todayDow ? ' (امروز)' : ''}"><span class="wv-l">${name}</span><i class="wv-dot"></i></button>`
    ).join('');
    chipsWrap.querySelectorAll('[data-wv-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.wvSelectedDow = parseInt(btn.dataset.wvDay, 10);
        state.wvSel = new Set();
        renderWeeklyVisits();
      });
    });

    const wrap = $id('wv-list');
    $id('wv-empty').hidden = true;
    $id('btn-wv-clear-day').hidden = true;
    wrap.innerHTML = '<div class="progress-box"><div class="dz-icon">⏳</div><div class="progress-text">در حال بارگذاری…</div></div>';
    try {
      const all = await Backend.getWeeklyVisits();
      const wk = state.wvSelectedWeek;
      chipsWrap.querySelectorAll('[data-wv-day]').forEach((btn) => {
        btn.classList.toggle('has', all.some((v) => v.dayOfWeek === parseInt(btn.dataset.wvDay, 10) && wvHasWeek(v, wk)));
      });
      state.wvCurrentList = all.filter((v) => v.dayOfWeek === state.wvSelectedDow && wvHasWeek(v, wk));
      paintWvList();
    } catch (e) {
      wrap.innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + Utils.esc(Backend.faErr(e)) + '</p></div>';
    }
  }

  function openWeeklyVisitSheet(existing) {
    showSheet({
      title: existing ? '✏️ ویرایش مورد ویزیت' : '➕ افزودن به برنامه ویزیت',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نوع</label>
          <select id="wv-type" style="width:100%">
            <option value="pharmacy" ${(!existing || existing.type === 'pharmacy') ? 'selected' : ''}>💊 داروخانه</option>
            <option value="doctor" ${existing && existing.type === 'doctor' ? 'selected' : ''}>🩺 پزشک</option>
          </select>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام *</label>
          <input type="text" id="wv-name" value="${existing ? Utils.esc(existing.name) : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">روز هفته</label>
          <select id="wv-day" style="width:100%">
            ${WV_DOW_NAMES.map((n, i) => i === 0 ? '' : `<option value="${i}" ${(existing ? existing.dayOfWeek : state.wvSelectedDow) === i ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">هفته‌های ماه <span style="opacity:.75">(پیش‌فرض: هر هفته)</span></label>
          <div id="wv-weeks-box">${wvWeeksPickerHtml(existing ? wvWeeksOf(existing) : WV_ALL_WEEKS)}</div>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">ترتیب ویزیت در این روز (اختیاری، عدد کوچیک‌تر زودتر)</label>
          <input type="number" id="wv-order" value="${existing && existing.visitOrder ? existing.visitOrder : ''}" inputmode="numeric" placeholder="مثلاً ۱">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">آدرس</label>
          <input type="text" id="wv-address" value="${existing ? Utils.esc(existing.address || '') : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">منطقه/خیابان</label>
          <input type="text" id="wv-area" value="${existing ? Utils.esc(existing.area || '') : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">شماره تلفن</label>
          <input type="tel" id="wv-phone" value="${existing ? Utils.esc(existing.phone || '') : ''}" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">توضیحات</label>
          <textarea id="wv-note" rows="3" style="width:100%;resize:vertical">${existing ? Utils.esc(existing.note || '') : ''}</textarea>
        </div>
        <div class="dialog-btns" style="margin-top:14px">
          ${existing ? '<button id="wv-delete" class="btn btn-danger">🗑 حذف</button>' : '<button id="wv-cancel" class="btn btn-ghost">انصراف</button>'}
          <button id="wv-save" class="btn btn-primary">${existing ? 'ذخیره تغییرات' : 'افزودن'}</button>
        </div>`,
      onMount(body, close) {
        setTimeout(() => body.querySelector('#wv-name').focus(), 60);
        const weeksPicker = wvWeeksPickerBind(body.querySelector('#wv-weeks-box'));
        const cancelBtn = body.querySelector('#wv-cancel');
        if (cancelBtn) cancelBtn.onclick = close;
        const delBtn = body.querySelector('#wv-delete');
        if (delBtn) {
          delBtn.onclick = async () => {
            const res = await showDialog({
              title: 'حذف از برنامه ویزیت',
              message: 'این مورد حذف شود؟',
              buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
            });
            if (!res) return;
            try {
              await Backend.deleteWeeklyVisit(existing.id);
              close();
              renderWeeklyVisits();
              updateWeeklyVisitBadge();
              showToast('حذف شد', 'success');
            } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
          };
        }
        body.querySelector('#wv-save').onclick = async () => {
          const name = body.querySelector('#wv-name').value.trim();
          if (!name) { showToast('نام رو وارد کن', 'error'); return; }
          const payload = {
            id: existing ? existing.id : undefined,
            name,
            type: body.querySelector('#wv-type').value,
            dayOfWeek: parseInt(body.querySelector('#wv-day').value, 10),
            visitOrder: parseInt(body.querySelector('#wv-order').value, 10) || 0,
            address: body.querySelector('#wv-address').value.trim(),
            area: body.querySelector('#wv-area').value.trim(),
            phone: body.querySelector('#wv-phone').value.trim(),
            note: body.querySelector('#wv-note').value.trim(),
            weeks: weeksPicker.get()
          };
          if (!payload.weeks) { showToast('حداقل یک هفته را انتخاب کن', 'error'); return; }
          try {
            if (!existing && !payload.visitOrder) {
              // مورد جدید بدون شماره‌ی ترتیب: به‌جای رفتن به ابتدای لیست، ته همان روز اضافه شود
              const sameDay = (await Backend.getWeeklyVisits()).filter((v) => v.dayOfWeek === payload.dayOfWeek);
              payload.visitOrder = Math.max(0, sameDay.length, ...sameDay.map((v) => v.visitOrder || 0)) + 1;
            }
            await Backend.putWeeklyVisit(payload);
            close();
            state.wvSelectedDow = payload.dayOfWeek;
            if (!((payload.weeks >> (state.wvSelectedWeek - 1)) & 1)) state.wvSelectedWeek = wvFirstWeek(payload.weeks);
            renderWeeklyVisits();
            updateWeeklyVisitBadge();
            showToast(existing ? 'ذخیره شد ✓' : 'اضافه شد ✓', 'success');
          } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  $id('btn-wv-add').addEventListener('click', () => openWeeklyVisitSheet(null));
  /* ===== برنامه‌های ذخیره‌شده (قالب روز/هفته): ذخیره برای همیشه و فعال‌سازی دوباره در هفته‌های بعد =====
     قالب‌ها در جدول تنظیمات کاربر (کلید wvTemplates) نگهداری می‌شوند؛ نیازی به تغییر دیتابیس نیست. */
  const WV_TPL_KEY = 'wvTemplates';
  const WV_TPL_MAX = 30;

  function wvTplId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // فقط فیلدهای لازم، مرتب‌شده و با شماره‌ی ردیف ۱..n در هر روز (شناسه و «ویزیت شد» ذخیره نمی‌شود)
  function wvSnapshotItems(list) {
    const sorted = list.slice().sort((a, b) =>
      (a.dayOfWeek - b.dayOfWeek) || ((a.visitOrder || 0) - (b.visitOrder || 0)) || (Number(a.id || 0) - Number(b.id || 0)));
    const perDay = {};
    return sorted.map((v) => {
      perDay[v.dayOfWeek] = (perDay[v.dayOfWeek] || 0) + 1;
      return { name: v.name, type: v.type || 'pharmacy', dayOfWeek: v.dayOfWeek, visitOrder: perDay[v.dayOfWeek],
        address: v.address || '', phone: v.phone || '', area: v.area || '', note: v.note || '', weeks: wvWeeksOf(v) };
    });
  }

  // محاسبه‌ی «چه چیزی اضافه و چه چیزی حذف شود» برای فعال‌سازی یک قالب
  // mode: 'replace' = جایگزین برنامه‌ی فعلی همان روز/هفته | 'add' = اضافه به موجودی (تکراری‌ها نادیده)
  function wvPlanApply(tpl, existing, opts) {
    const mode = opts && opts.mode === 'add' ? 'add' : 'replace';
    const isDay = tpl.kind === 'day';
    const target = isDay ? Number((opts && opts.targetDow) || tpl.dow) : null;
    const rows = [];
    const deleteIds = [];
    let skipped = 0;
    const days = isDay ? [target] : [1, 2, 3, 4, 5, 6, 7];
    const scope = existing.filter((v) => days.includes(v.dayOfWeek));
    if (mode === 'replace') scope.forEach((v) => deleteIds.push(v.id));
    const next = {}; const have = {};
    days.forEach((d) => {
      const cur = mode === 'add' ? scope.filter((v) => v.dayOfWeek === d) : [];
      next[d] = mode === 'add' ? Math.max(0, cur.length, ...cur.map((v) => v.visitOrder || 0)) + 1 : 1;
      have[d] = new Set(cur.map((v) => wvNameKey(v.name)));
    });
    (tpl.items || []).forEach((it) => {
      const name = String((it && it.name) || '').trim();
      const d = isDay ? target : Number(it && it.dayOfWeek);
      if (!name || !days.includes(d)) return;
      const key = wvNameKey(name);
      if (have[d].has(key)) { skipped++; return; }
      have[d].add(key);
      rows.push({ name, type: it.type === 'doctor' ? 'doctor' : 'pharmacy', dayOfWeek: d, visitOrder: next[d]++,
        address: it.address || '', phone: it.phone || '', area: it.area || '', note: it.note || '', weeks: wvWeeksOf(it) });
    });
    return { rows, deleteIds, skipped };
  }

  async function loadWvTemplates() {
    const v = await Backend.getSetting(WV_TPL_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  // اول موارد جدید درج می‌شود و بعد قدیمی‌ها حذف؛ اگر درج شکست بخورد هیچ چیز از بین نمی‌رود
  async function applyWvTemplate(tpl, opts) {
    const all = await Backend.getWeeklyVisits();
    const plan = wvPlanApply(tpl, all, opts);
    if (!plan.rows.length) return { added: 0, removed: 0, skipped: plan.skipped, deleteFailed: false };
    await Backend.addWeeklyVisitsBulk(plan.rows);
    let deleteFailed = false;
    if (plan.deleteIds.length) {
      try { await Backend.deleteWeeklyVisitsBulk(plan.deleteIds); } catch (e) {
        deleteFailed = true;
        try { Backend.logError('wv-template-delete-old', e, 'weekly-visits').catch(() => {}); } catch (er) { /* بی‌اثر */ }
      }
    }
    return { added: plan.rows.length, removed: deleteFailed ? 0 : plan.deleteIds.length, skipped: plan.skipped, deleteFailed };
  }

  function wvTplKindLabel(t) { return t.kind === 'week' ? 'کل هفته' : ('روز ' + (WV_DOW_NAMES[t.dow] || '')); }

  function openWvTemplatesSheet() {
    const dayName = WV_DOW_NAMES[state.wvSelectedDow] || '';
    showSheet({
      title: '💾 برنامه‌های ذخیره‌شده',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام برنامه (اختیاری)</label>
          <input type="text" id="wvt-name" placeholder="مثلاً برنامه عادی هفته" autocomplete="off" maxlength="60">
        </div>
        <div class="dialog-btns" style="margin-top:10px">
          <button id="wvt-save-day" class="btn btn-primary">💾 ذخیره ${Utils.esc(dayName)}</button>
          <button id="wvt-save-week" class="btn btn-primary">💾 ذخیره کل هفته</button>
        </div>
        <div style="margin-top:16px;font-weight:700;font-size:13px">ذخیره‌شده‌ها</div>
        <div id="wvt-list" style="margin-top:8px"></div>
        <div class="dialog-btns" style="margin-top:10px"><button id="wvt-close" class="btn btn-ghost">بستن</button></div>`,
      onMount(body, close) {
        const box = body.querySelector('#wvt-list');
        let tpls = [];
        body.querySelector('#wvt-close').onclick = close;
        async function paint() {
          box.innerHTML = '<div class="oc-sub">در حال بارگذاری…</div>';
          try { tpls = await loadWvTemplates(); } catch (e) {
            box.innerHTML = '<div class="oc-sub">خطا در بارگذاری: ' + Utils.esc(Backend.faErr(e)) + '</div>';
            return;
          }
          box.innerHTML = tpls.length ? tpls.map((t) => `
            <div class="order-card" style="cursor:default;margin-bottom:8px;padding:10px">
              <div class="oc-body">
                <div class="oc-title">${t.kind === 'week' ? '📅' : '🗓'} ${Utils.esc(t.name)}</div>
                <div class="oc-sub">${Utils.esc(wvTplKindLabel(t))} · ${Utils.faNum((t.items || []).length)} مورد${t.createdAt ? ' · ' + Utils.faDateShort(t.createdAt) : ''}</div>
              </div>
              <div class="wv-actions">
                <button class="btn btn-primary btn-sm" data-wvt-apply="${Utils.esc(t.id)}">▶ فعال‌سازی</button>
                <button class="wv-del" data-wvt-del="${Utils.esc(t.id)}" aria-label="حذف برنامه ذخیره‌شده">🗑</button>
              </div>
            </div>`).join('') : '<div class="oc-sub">هنوز برنامه‌ای ذخیره نشده. ابتدا برنامه‌ی همین روز یا کل هفته را ذخیره کنید.</div>';
        }
        async function saveCurrent(kind) {
          const btns = body.querySelectorAll('#wvt-save-day,#wvt-save-week');
          btns.forEach((b) => { b.disabled = true; });
          try {
            const all = await Backend.getWeeklyVisits();
            const dow = state.wvSelectedDow;
            const src = kind === 'day' ? all.filter((v) => v.dayOfWeek === dow) : all;
            if (!src.length) { showToast(kind === 'day' ? 'این روز خالی است؛ چیزی برای ذخیره نیست' : 'برنامه‌ی هفته خالی است', 'error'); return; }
            const list = await loadWvTemplates();
            if (list.length >= WV_TPL_MAX) { showToast('حداکثر ' + Utils.faNum(WV_TPL_MAX) + ' برنامه قابل ذخیره است؛ یکی را حذف کن', 'error'); return; }
            const typed = body.querySelector('#wvt-name').value.trim();
            const name = (typed || ((kind === 'day' ? WV_DOW_NAMES[dow] : 'کل هفته') + ' — ' + Utils.faDateShort(new Date().toISOString()))).slice(0, 60);
            list.unshift({ id: wvTplId(), name, kind, dow: kind === 'day' ? dow : null, createdAt: new Date().toISOString(), items: wvSnapshotItems(src) });
            await Backend.setSetting(WV_TPL_KEY, list);
            body.querySelector('#wvt-name').value = '';
            showToast('برنامه ذخیره شد ✓', 'success');
            await paint();
          } catch (e) {
            try { Backend.logError('wv-template-save', e, 'weekly-visits').catch(() => {}); } catch (er) { /* بی‌اثر */ }
            showToast('ذخیره نشد: ' + Backend.faErr(e), 'error');
          } finally { btns.forEach((b) => { b.disabled = false; }); }
        }
        body.querySelector('#wvt-save-day').onclick = () => saveCurrent('day');
        body.querySelector('#wvt-save-week').onclick = () => saveCurrent('week');
        box.addEventListener('click', async (e) => {
          const del = e.target.closest('[data-wvt-del]');
          const app = e.target.closest('[data-wvt-apply]');
          if (del) {
            const t = tpls.find((x) => x.id === del.dataset.wvtDel);
            const ok = await showDialog({
              title: 'حذف برنامه ذخیره‌شده', message: t ? '«' + t.name + '» حذف شود؟ (برنامه‌ی فعلی هفته تغییری نمی‌کند)' : 'حذف شود؟',
              buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
            });
            if (!ok) return;
            try {
              const list = (await loadWvTemplates()).filter((x) => x.id !== del.dataset.wvtDel);
              await Backend.setSetting(WV_TPL_KEY, list);
              await paint();
            } catch (er) { showToast('خطا: ' + Backend.faErr(er), 'error'); }
          } else if (app) {
            const t = tpls.find((x) => x.id === app.dataset.wvtApply);
            if (t) openWvApplySheet(t);
          }
        });
        paint();
      }
    });
  }

  async function openWvApplySheet(tpl) {
    let all;
    try { all = await Backend.getWeeklyVisits(); } catch (e) { showToast('خطا: ' + Backend.faErr(e), 'error'); return; }
    const isDay = tpl.kind === 'day';
    showSheet({
      title: '▶ فعال‌سازی «' + tpl.name + '»',
      html: `
        <div class="oc-sub" style="margin-bottom:8px">${Utils.esc(wvTplKindLabel(tpl))} · ${Utils.faNum((tpl.items || []).length)} مورد</div>
        ${isDay ? `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">روزی که می‌خواهی این برنامه در آن فعال شود</label>
          <select id="wva-day" style="width:100%">
            ${WV_DOW_NAMES.map((n, i) => i === 0 ? '' : `<option value="${i}" ${(tpl.dow || state.wvSelectedDow) === i ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>` : ''}
        <div id="wva-info" class="info-note" style="margin-top:10px"></div>
        <div class="dialog-btns" style="margin-top:14px;flex-wrap:wrap">
          <button id="wva-cancel" class="btn btn-ghost">بازگشت</button>
          <button id="wva-add" class="btn btn-ghost">➕ اضافه کن</button>
          <button id="wva-replace" class="btn btn-danger">♻️ جایگزین کن</button>
        </div>`,
      onMount(body, close) {
        const sel = body.querySelector('#wva-day');
        const info = body.querySelector('#wva-info');
        const opts = (mode) => ({ mode, targetDow: sel ? parseInt(sel.value, 10) : null });
        const refresh = () => {
          const r = wvPlanApply(tpl, all, opts('replace'));
          info.textContent = (isDay
            ? 'الان در این روز ' + Utils.faNum(r.deleteIds.length) + ' مورد هست. «جایگزین کن» آن‌ها را حذف و برنامه‌ی ذخیره‌شده را می‌گذارد.'
            : 'الان در کل هفته ' + Utils.faNum(r.deleteIds.length) + ' مورد هست. «جایگزین کن» همه را حذف و برنامه‌ی ذخیره‌شده‌ی هفته را می‌گذارد.')
            + ' «اضافه کن» موجودی را نگه می‌دارد و فقط موارد جدید را ته لیست می‌افزاید.';
        };
        if (sel) sel.addEventListener('change', refresh);
        refresh();
        body.querySelector('#wva-cancel').onclick = () => openWvTemplatesSheet();
        const run = async (mode) => {
          const btns = body.querySelectorAll('button');
          btns.forEach((b) => { b.disabled = true; });
          try {
            const o = opts(mode);
            const res = await applyWvTemplate(tpl, o);
            if (!res.added) {
              btns.forEach((b) => { b.disabled = false; });
              showToast(res.skipped ? 'همه‌ی این موارد از قبل در برنامه هست' : 'این برنامه مورد قابل افزودنی ندارد', 'error');
              return;
            }
            close();
            if (isDay) state.wvSelectedDow = o.targetDow;
            renderWeeklyVisits();
            updateWeeklyVisitBadge();
            showToast(res.deleteFailed
              ? 'برنامه‌ی جدید اضافه شد ولی حذف موارد قبلی ناموفق بود؛ موارد تکراری را دستی حذف کنید.'
              : 'برنامه فعال شد ✓ (' + Utils.faNum(res.added) + ' مورد' + (res.skipped ? '، ' + Utils.faNum(res.skipped) + ' تکراری نادیده' : '') + ')',
              res.deleteFailed ? 'error' : 'success');
          } catch (e) {
            btns.forEach((b) => { b.disabled = false; });
            try { Backend.logError('wv-template-apply', e, 'weekly-visits').catch(() => {}); } catch (er) { /* بی‌اثر */ }
            showToast('فعال‌سازی ناموفق بود؛ برنامه‌ی فعلی تغییری نکرد: ' + Backend.faErr(e), 'error');
          }
        };
        body.querySelector('#wva-add').onclick = () => run('add');
        body.querySelector('#wva-replace').onclick = async () => {
          const r = wvPlanApply(tpl, all, opts('replace'));
          if (r.deleteIds.length) {
            const ok = await showDialog({
              title: 'جایگزینی برنامه',
              message: Utils.faNum(r.deleteIds.length) + ' مورد فعلی حذف و ' + Utils.faNum(r.rows.length) + ' مورد ذخیره‌شده جایگزین می‌شود. ادامه بدهم؟',
              buttons: [{ label: 'انصراف', value: false }, { label: 'جایگزین کن', value: true, kind: 'btn-danger' }]
            });
            if (!ok) return;
          }
          run('replace');
        };
      }
    });
  }

  const wvTplBtn = $id('btn-wv-tpl');
  if (wvTplBtn) wvTplBtn.addEventListener('click', () => openWvTemplatesSheet());
  const wvBulkBtn = $id('btn-wv-bulk');
  if (wvBulkBtn) wvBulkBtn.addEventListener('click', () => openWeeklyVisitBulkSheet());

  /* افزودن چندتایی: مثلاً «خیابان نصیرآباد» + نام‌ها: مرندی، رضایی، صفری
     در برگه‌ی اصلی این‌ها بر اساس منطقه/خیابان زیرشاخه‌ی هم نمایش داده می‌شوند */
  function openWeeklyVisitBulkSheet() {
    showSheet({
      title: '📋 افزودن چند مورد با هم',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نوع</label>
          <select id="wvb-type" style="width:100%">
            <option value="pharmacy" selected>💊 داروخانه</option>
            <option value="doctor">🩺 پزشک</option>
          </select>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">روز هفته</label>
          <select id="wvb-day" style="width:100%">
            ${WV_DOW_NAMES.map((n, i) => i === 0 ? '' : `<option value="${i}" ${state.wvSelectedDow === i ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">هفته‌های ماه (برای همه) <span style="opacity:.75">(پیش‌فرض: هر هفته)</span></label>
          <div id="wvb-weeks-box">${wvWeeksPickerHtml(WV_ALL_WEEKS)}</div>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">منطقه/خیابان (برای همه، اختیاری؛ موارد زیر همین عنوان قرار می‌گیرند)</label>
          <input type="text" id="wvb-area" placeholder="مثلاً خیابان نصیرآباد" autocomplete="off">
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام‌ها (هر نام در یک خط، یا با ویرگول جدا کنید) *</label>
          <textarea id="wvb-names" rows="6" style="width:100%;resize:vertical" placeholder="مرندی&#10;رضایی&#10;صفری"></textarea>
          <div id="wvb-count" style="font-size:12px;color:var(--muted);margin-top:4px">۰ مورد</div>
        </div>
        <div class="dialog-btns" style="margin-top:14px">
          <button id="wvb-cancel" class="btn btn-ghost">انصراف</button>
          <button id="wvb-save" class="btn btn-primary">افزودن همه</button>
        </div>`,
      onMount(body, close) {
        const ta = body.querySelector('#wvb-names');
        setTimeout(() => ta.focus(), 60);
        const bulkWeeks = wvWeeksPickerBind(body.querySelector('#wvb-weeks-box'));
        body.querySelector('#wvb-cancel').onclick = close;
        ta.addEventListener('input', () => {
          body.querySelector('#wvb-count').textContent = Utils.faNum(parseWvNames(ta.value).length) + ' مورد';
        });
        body.querySelector('#wvb-save').onclick = async () => {
          const names = parseWvNames(ta.value);
          if (!names.length) { showToast('حداقل یک نام وارد کن', 'error'); return; }
          if (names.length > 60) { showToast('در هر بار حداکثر ۶۰ مورد اضافه کن', 'error'); return; }
          const dow = parseInt(body.querySelector('#wvb-day').value, 10);
          const type = body.querySelector('#wvb-type').value;
          const area = body.querySelector('#wvb-area').value.trim();
          const weeks = bulkWeeks.get();
          if (!weeks) { showToast('حداقل یک هفته را انتخاب کن', 'error'); return; }
          const saveBtn = body.querySelector('#wvb-save');
          saveBtn.disabled = true;
          try {
            const sameDay = (await Backend.getWeeklyVisits()).filter((v) => v.dayOfWeek === dow);
            const have = new Set(sameDay.map((v) => wvNameKey(v.name)));
            const fresh = names.filter((n) => !have.has(wvNameKey(n)));
            const skipped = names.length - fresh.length;
            if (!fresh.length) { saveBtn.disabled = false; showToast('همه‌ی این نام‌ها قبلاً در این روز ثبت شده‌اند', 'error'); return; }
            let next = Math.max(0, sameDay.length, ...sameDay.map((v) => v.visitOrder || 0)) + 1;
            const rows = fresh.map((name) => ({ name, type, dayOfWeek: dow, visitOrder: next++, area, address: '', phone: '', note: '', weeks }));
            await Backend.addWeeklyVisitsBulk(rows);
            close();
            state.wvSelectedDow = dow;
            if (!((weeks >> (state.wvSelectedWeek - 1)) & 1)) state.wvSelectedWeek = wvFirstWeek(weeks);
            renderWeeklyVisits();
            updateWeeklyVisitBadge();
            showToast(Utils.faNum(rows.length) + ' مورد اضافه شد ✓' + (skipped ? ' (' + Utils.faNum(skipped) + ' تکراری نادیده گرفته شد)' : ''), 'success');
          } catch (err) {
            saveBtn.disabled = false;
            showToast('خطا: ' + Backend.faErr(err), 'error');
          }
        };
      }
    });
  }

  /* ترتیب جدید را نشان بده و ذخیره کن؛ اگر ذخیره شکست خورد، لیست از سرور دوباره خوانده می‌شود */
  async function wvSaveReorder(plan) {
    if (!plan.updates.length) return;
    plan.list.forEach((v, i) => { v.visitOrder = i + 1; });
    state.wvCurrentList = plan.list;
    paintWvList();
    try {
      await Backend.reorderWeeklyVisits(plan.updates);
    } catch (err) {
      try { Backend.logError('wv-reorder', err, 'weekly-visits').catch(() => {}); } catch (er) { /* بی‌اثر */ }
      showToast('ذخیره‌ی ترتیب ناموفق بود؛ لیست دوباره خوانده شد.', 'error');
      renderWeeklyVisits();
    }
  }
  function applyWvReorder(from, to) { return wvSaveReorder(wvReorderPlan(state.wvCurrentList || [], from, to)); }
  function applyWvGroupReorder(runIdx, to) { return wvSaveReorder(wvGroupReorderPlan(state.wvCurrentList || [], runIdx, to)); }

  /* دراگ با کشیدن دستگیره‌ی ⠿ (لمس و ماوس؛ با اسکرول خودکار نزدیک لبه‌ی صفحه)
     دستگیره‌ی کنار هر مورد = جابه‌جایی همان مورد؛ دستگیره‌ی کنار نام گروه = جابه‌جایی کل گروه با هم */
  (function initWvDrag() {
    const wrap = $id('wv-list');
    let d = null;
    const clearMarks = () => wrap.querySelectorAll('.wv-drop-before,.wv-drop-after')
      .forEach((el) => el.classList.remove('wv-drop-before', 'wv-drop-after'));
    function update() {
      if (!d) return;
      d.el.style.transform = 'translateY(' + ((d.lastY - d.startY) + (window.scrollY - d.startScroll)) + 'px)';
      const others = d.items.filter((c) => c !== d.el);
      const mids = others.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
      d.to = wvDropIndex(mids, d.lastY);
      clearMarks();
      if (d.to !== d.from && others.length) {
        if (d.to === 0) others[0].classList.add('wv-drop-before');
        else others[d.to - 1].classList.add('wv-drop-after');
      }
    }
    async function finish(e, cancelled) {
      if (!d || (e && e.pointerId !== d.pid)) return;
      const cur = d;
      d = null;
      clearInterval(cur.timer);
      clearMarks();
      cur.el.classList.remove('wv-dragging');
      cur.el.style.transform = '';
      try { cur.handle.releasePointerCapture(cur.pid); } catch (er) { /* بی‌اثر */ }
      if (cancelled || cur.to === cur.from) return;
      if (cur.kind === 'group') await applyWvGroupReorder(cur.from, cur.to);
      else await applyWvReorder(cur.from, cur.to);
    }
    wrap.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.wv-handle, .wv-ghandle');
      if (!handle || d) return;
      const isGroup = handle.classList.contains('wv-ghandle');
      const el = handle.closest(isGroup ? '.wv-group' : '.wv-row');
      const items = isGroup ? Array.from(wrap.children) : Array.from(wrap.querySelectorAll('.wv-row[data-wv-card]'));
      const from = items.indexOf(el);
      if (from < 0) return;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (er) { /* بی‌اثر */ }
      d = { kind: isGroup ? 'group' : 'row', el, handle, pid: e.pointerId, items, from, to: from, startY: e.clientY, lastY: e.clientY, startScroll: window.scrollY, timer: null };
      el.classList.add('wv-dragging');
      d.timer = setInterval(() => {
        if (!d) return;
        if (d.lastY < 90) window.scrollBy(0, -14);
        else if (d.lastY > window.innerHeight - 90) window.scrollBy(0, 14);
        update();
      }, 30);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.pid) return;
      d.lastY = e.clientY;
      update();
    });
    wrap.addEventListener('pointerup', (e) => { finish(e, false); });
    wrap.addEventListener('pointercancel', (e) => { finish(e, true); });
  })();

  $id('wv-week-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wv-week]');
    if (!btn) return;
    state.wvSelectedWeek = parseInt(btn.dataset.wvWeek, 10);
    state.wvSel = new Set();
    renderWeeklyVisits();
  });

  $id('btn-wv-clear-day').addEventListener('click', async () => {
    const list = state.wvCurrentList || [];
    if (!list.length) return;
    const dayName = WV_DOW_NAMES[state.wvSelectedDow];
    const res = await showDialog({
      title: 'حذف برنامه‌ی ' + dayName + ' (هفته‌ی ' + Utils.faNum(state.wvSelectedWeek) + ')',
      message: 'همه‌ی ' + Utils.faNum(list.length) + ' مورد برنامه‌ی ' + dayName + ' که در هفته‌ی ' + Utils.faNum(state.wvSelectedWeek) + ' دیده می‌شوند حذف شود؟ این کار قابل برگشت نیست (مواردی که در چند هفته تکرار می‌شوند از همه‌ی هفته‌ها حذف می‌شوند). اگر لازم داری، قبلش از «برنامه‌های ذخیره‌شده» نسخه‌ی پشتیبان بگیر.',
      buttons: [{ label: 'انصراف', value: false }, { label: 'حذف همه', value: true, kind: 'btn-danger' }]
    });
    if (!res) return;
    try {
      await Backend.deleteWeeklyVisitsBulk(list.map((v) => v.id));
      showToast('برنامه‌ی ' + dayName + ' حذف شد', 'success');
      renderWeeklyVisits();
      updateWeeklyVisitBadge();
    } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
  });

  /* ---- انتخاب چندتایی: انتقال به روز/هفته، افزودن به هفته‌ها، حذف ---- */
  function wvLeaveSelection() { state.wvSelMode = false; state.wvSel = new Set(); }

  $id('btn-wv-select').addEventListener('click', () => { state.wvSelMode = true; state.wvSel = new Set(); paintWvList(); });
  $id('wv-sel-exit').addEventListener('click', () => { wvLeaveSelection(); paintWvList(); });
  $id('wv-sel-all').addEventListener('click', () => {
    const list = state.wvCurrentList || [];
    const sel = state.wvSel || (state.wvSel = new Set());
    if (list.length && sel.size === list.length) sel.clear();
    else list.forEach((v) => sel.add(String(v.id)));
    paintWvList();
  });

  function openWvMoveSheet() {
    const items = wvSelectedItems();
    if (!items.length) return;
    const first = wvWeeksOf(items[0]);
    const common = items.every((v) => wvWeeksOf(v) === first) ? first : WV_ALL_WEEKS;
    showSheet({
      title: '↔ انتقال ' + Utils.faNum(items.length) + ' مورد',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">روز هفته</label>
          <select id="wvm-day" style="width:100%">
            <option value="0">بدون تغییر</option>
            ${WV_DOW_NAMES.map((n, i) => i === 0 ? '' : `<option value="${i}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="set-row" style="margin-top:12px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="wvm-chg"> تغییر هفته‌های ماه</label>
          <div id="wvm-weeks" class="wv-wk-off" style="margin-top:8px">${wvWeeksPickerHtml(common)}</div>
        </div>
        <div class="dialog-btns" style="margin-top:14px">
          <button id="wvm-cancel" class="btn btn-ghost">انصراف</button>
          <button id="wvm-ok" class="btn btn-primary">انتقال</button>
        </div>`,
      onMount(body, close) {
        const picker = wvWeeksPickerBind(body.querySelector('#wvm-weeks'));
        body.querySelector('#wvm-chg').onchange = (ev) => body.querySelector('#wvm-weeks').classList.toggle('wv-wk-off', !ev.target.checked);
        body.querySelector('#wvm-cancel').onclick = close;
        body.querySelector('#wvm-ok').onclick = async () => {
          const dow = parseInt(body.querySelector('#wvm-day').value, 10) || 0;
          const chg = body.querySelector('#wvm-chg').checked;
          const mask = picker.get();
          if (!dow && !chg) { showToast('روز یا هفته‌ها را برای تغییر مشخص کن', 'error'); return; }
          if (chg && !mask) { showToast('حداقل یک هفته را انتخاب کن', 'error'); return; }
          const okBtn = body.querySelector('#wvm-ok');
          okBtn.disabled = true;
          try {
            const patch = {};
            if (dow) patch.day_of_week = dow;
            if (chg) patch.weeks = mask;
            await Backend.updateWeeklyVisitsBulk(items.map((v) => v.id), patch);
            if (dow && dow !== state.wvSelectedDow) {
              // موارد منتقل‌شده ته روز مقصد قرار می‌گیرند (ترتیب نسبی خودشان حفظ می‌شود)
              const all = await Backend.getWeeklyVisits();
              const movedIds = new Set(items.map((v) => String(v.id)));
              const base = Math.max(0, ...all.filter((v) => v.dayOfWeek === dow && !movedIds.has(String(v.id))).map((v) => v.visitOrder || 0));
              const ordered = items.slice().sort((x, y) => ((x.visitOrder || 0) - (y.visitOrder || 0)) || (Number(x.id) - Number(y.id)));
              await Backend.reorderWeeklyVisits(ordered.map((v, i) => ({ id: v.id, visitOrder: base + i + 1 })));
            }
            if (dow) state.wvSelectedDow = dow;
            if (chg && !((mask >> (state.wvSelectedWeek - 1)) & 1)) state.wvSelectedWeek = wvFirstWeek(mask);
            wvLeaveSelection();
            close();
            renderWeeklyVisits();
            updateWeeklyVisitBadge();
            showToast(Utils.faNum(items.length) + ' مورد منتقل شد ✓', 'success');
          } catch (err) {
            okBtn.disabled = false;
            showToast('خطا: ' + Backend.faErr(err), 'error');
          }
        };
      }
    });
  }

  function openWvAddWeeksSheet() {
    const items = wvSelectedItems();
    if (!items.length) return;
    showSheet({
      title: '🗓 افزودن ' + Utils.faNum(items.length) + ' مورد به هفته‌ها',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:6px">این موارد در هفته‌های انتخابی هم دیده شوند (هفته‌های فعلی‌شان حفظ می‌شود)</label>
          <div id="wva-weeks">${wvWeeksPickerHtml(0)}</div>
        </div>
        <div class="dialog-btns" style="margin-top:14px">
          <button id="wva-cancel" class="btn btn-ghost">انصراف</button>
          <button id="wva-ok" class="btn btn-primary">افزودن</button>
        </div>`,
      onMount(body, close) {
        const picker = wvWeeksPickerBind(body.querySelector('#wva-weeks'));
        body.querySelector('#wva-cancel').onclick = close;
        body.querySelector('#wva-ok').onclick = async () => {
          const add = picker.get();
          if (!add) { showToast('حداقل یک هفته را انتخاب کن', 'error'); return; }
          const okBtn = body.querySelector('#wva-ok');
          okBtn.disabled = true;
          try {
            const buckets = new Map();
            items.forEach((v) => {
              const m = wvWeeksOf(v) | add;
              if (m === wvWeeksOf(v)) return;
              if (!buckets.has(m)) buckets.set(m, []);
              buckets.get(m).push(v.id);
            });
            for (const [m, ids] of buckets) await Backend.updateWeeklyVisitsBulk(ids, { weeks: m });
            wvLeaveSelection();
            close();
            renderWeeklyVisits();
            updateWeeklyVisitBadge();
            showToast('انجام شد ✓', 'success');
          } catch (err) {
            okBtn.disabled = false;
            showToast('خطا: ' + Backend.faErr(err), 'error');
          }
        };
      }
    });
  }

  $id('wv-sel-move').addEventListener('click', openWvMoveSheet);
  $id('wv-sel-addweeks').addEventListener('click', openWvAddWeeksSheet);
  $id('wv-sel-del').addEventListener('click', async () => {
    const items = wvSelectedItems();
    if (!items.length) return;
    const res = await showDialog({
      title: 'حذف موارد انتخاب‌شده',
      message: Utils.faNum(items.length) + ' مورد حذف شود؟ این کار قابل برگشت نیست (مواردی که در چند هفته تکرار می‌شوند از همه‌ی هفته‌ها حذف می‌شوند).',
      buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
    });
    if (!res) return;
    try {
      await Backend.deleteWeeklyVisitsBulk(items.map((v) => v.id));
      wvLeaveSelection();
      showToast('حذف شد', 'success');
      renderWeeklyVisits();
      updateWeeklyVisitBadge();
    } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
  });

  $id('wv-list').addEventListener('click', async (e) => {
    if (state.wvSelMode) {
      const list = state.wvCurrentList || [];
      const sel = state.wvSel || (state.wvSel = new Set());
      const grp = e.target.closest('[data-wv-pickgroup]');
      if (grp) {
        const run = wvGroupRuns(list).find((r) => r.start === parseInt(grp.dataset.wvPickgroup, 10));
        if (run) {
          const items = list.slice(run.start, run.end + 1);
          const all = items.every((v) => sel.has(String(v.id)));
          items.forEach((v) => { if (all) sel.delete(String(v.id)); else sel.add(String(v.id)); });
          paintWvList();
        }
        return;
      }
      const row = e.target.closest('.wv-row[data-wv-card]');
      if (row) {
        const id = row.dataset.wvCard;
        if (sel.has(id)) sel.delete(id); else sel.add(id);
        paintWvList();
      }
      return;
    }
    const delBtn = e.target.closest('[data-wv-del]');
    if (delBtn) {
      const item = (state.wvCurrentList || []).find((v) => String(v.id) === delBtn.dataset.wvDel);
      const res = await showDialog({
        title: 'حذف از برنامه ویزیت',
        message: item ? '«' + item.name + '» حذف شود؟' : 'این مورد حذف شود؟',
        buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
      });
      if (!res) return;
      try {
        await Backend.deleteWeeklyVisit(delBtn.dataset.wvDel);
        showToast('حذف شد', 'success');
        renderWeeklyVisits();
        updateWeeklyVisitBadge();
      } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
      return;
    }
    const doneBtn = e.target.closest('[data-wv-done]');
    if (doneBtn) {
      try {
        await Backend.markWeeklyVisitDone(doneBtn.dataset.wvDone, doneBtn.dataset.wvDoneVal === '1');
        renderWeeklyVisits();
        updateWeeklyVisitBadge();
      } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
      return;
    }
    const row = e.target.closest('[data-wv-open]');
    if (!row) return;
    try {
      const list = await Backend.getWeeklyVisits();
      const item = list.find((v) => String(v.id) === row.dataset.wvOpen);
      if (item) openWeeklyVisitSheet(item);
    } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
  });


  /* ===== استعلام (شخصی و دائمی): یادداشت تسویه/مطالبات هر داروخانه؛ جدا از برنامه‌ی هفتگی ===== */
  const EST_TXT = { good: '👍 خوش‌حساب', hard: '🟠 سخت‌حساب', bad: '👎 بدحساب' };

  // آخرین استعلام هر داروخانه (کلید: نام نرمال‌شده)
  function estLatestMap(list) {
    const sorted = list.slice().sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')) || (Number(y.id) - Number(x.id)));
    const map = {};
    sorted.forEach((e) => { const k = wvNameKey(e.pharmacyName); if (k && !map[k]) map[k] = e; });
    return map;
  }
  /* ===== بخش استعلام (شخصی): هر داروخانه یک ردیف، خیابان‌ها گروه (باز/بسته)، 👍/👎 رنگی، متن و سابقه ===== */
  if (!state.estColl) state.estColl = new Set();
  if (!state.estHist) state.estHist = new Set();

  // گروه‌ها: هر داروخانه یک ردیف (آخرین وضعیت)، گروه‌بندی بر اساس خیابان
  function estGroups(all, q) {
    const byName = {};
    all.forEach((e) => { const k = wvNameKey(e.pharmacyName); if (k) (byName[k] = byName[k] || []).push(e); });
    const rows = Object.keys(byName).map((k) => {
      const arr = byName[k].slice().sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')) || (Number(y.id) - Number(x.id)));
      const last = arr[0];
      const area = last.area || (arr.find((x) => x.area) || {}).area || '';
      return { key: k, name: last.pharmacyName, area, entries: arr, last };
    }).filter((r) => {
      if (!q) return true;
      return wvNameKey(r.name).includes(q) || wvNameKey(r.area).includes(q) || r.entries.some((e) => wvNameKey(e.note).includes(q));
    });
    const gmap = {};
    rows.forEach((r) => {
      const gk = wvNameKey(r.area);
      if (!gmap[gk]) gmap[gk] = { key: gk, label: r.area, rows: [] };
      gmap[gk].rows.push(r);
    });
    const groups = Object.keys(gmap).sort((x, y) => (x === '' ? 1 : y === '' ? -1 : (x < y ? -1 : x > y ? 1 : 0))).map((k) => {
      gmap[k].rows.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      return gmap[k];
    });
    return groups;
  }

  // آیکون شست و آیکون ساده‌ی «سخت‌حساب» (SVG؛ بدون وابستگی به فونت)
  function estThumb(dir, color) {
    const d = 'M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.3l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 7.59 6.59C7.22 6.95 7 7.45 7 8v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z';
    return `<svg viewBox="0 0 24 24" width="17" height="17" fill="${color}" aria-hidden="true" style="${dir === 'down' ? 'transform:rotate(180deg)' : ''}"><path d="${d}"/></svg>`;
  }
  function estPill(verdict, on, label) {
    const cls = `est-pill ${verdict}${on ? ' on' : ''}`;
    const dot = verdict === 'hard' ? '<span class="est-dot-x">!</span>'
      : estThumb(verdict === 'bad' ? 'down' : 'up', on ? '#fff' : '#94a3b8');
    return `<button type="button" class="${cls}" data-est-vote="${verdict}" data-est-name="__NAME__" data-est-area="__AREA__" aria-label="${label}" title="${label}"><span class="est-dot">${dot}</span>${on ? '<span class="est-plabel">' + label + '</span>' : ''}</button>`;
  }

  function estRowHtml(r) {
    const v = r.last.verdict;
    const en = Utils.esc(r.name), ea = Utils.esc(r.area || '');
    const open = state.estHist.has(r.key);
    const pill = (verdict, label) => estPill(verdict, v === verdict, label).replace('__NAME__', en).replace('__AREA__', ea);
    const hist = open ? '<div class="est-hist">' + r.entries.map((e) => `
        <div class="est-hitem ${e.verdict}">
          <div class="est-hhead">${EST_TXT[e.verdict] || ''}${e.createdAt ? ' · ' + Utils.esc(Utils.faDateShort(e.createdAt)) : ''}</div>
          ${e.note ? '<div class="est-hnote">' + Utils.esc(e.note) + '</div>' : ''}
          <button type="button" class="est-del" data-est-del="${Utils.esc(String(e.id))}">🗑 حذف این مورد</button>
        </div>`).join('') + '</div>' : '';
    const noteCls = v === 'bad' ? ' est-note-bad' : v === 'hard' ? ' est-note-hard' : '';
    return `<div class="est-row ${v}">
      <div class="est-row-top">
        <span class="est-pname">${en}</span>
        <span class="est-btns">${pill('bad', 'بدحساب')}${pill('hard', 'سخت‌حساب')}${pill('good', 'خوش‌حساب')}</span>
      </div>
      <div class="est-row-bot">
        ${r.last.note ? '<span class="est-lastnote' + noteCls + '">' + Utils.esc(r.last.note) + '</span>' : '<span class="est-lastnote"></span>'}
        <button type="button" class="est-link" data-est-note data-est-name="${en}" data-est-area="${ea}">✎ متن</button>
        <button type="button" class="est-link" data-est-hist="${Utils.esc(r.key)}">🕘 سابقه (${Utils.faNum(r.entries.length)})</button>
        <button type="button" class="est-link est-link-del" data-est-delall="${Utils.esc(r.key)}">🗑 حذف داروخانه</button>
      </div>
      ${hist}
    </div>`;
  }

  function estPaint() {
    const wrap = $id('est-list'), empty = $id('est-empty'), count = $id('est-count'), bar = $id('est-listbar');
    const all = state.estAll || [];
    const q = wvNameKey($id('est-search').value || '');
    const groups = estGroups(all, q);
    const nRows = groups.reduce((s, g) => s + g.rows.length, 0);
    count.textContent = nRows ? Utils.faNum(nRows) + ' داروخانه' : '';
    empty.hidden = all.length > 0;
    bar.hidden = groups.length === 0;
    const anyColl = groups.some((g) => state.estColl.has(g.key));
    $id('est-collapse-all').textContent = anyColl ? '▾ باز کردن همه' : '▸ بستن همه';
    if (!groups.length) {
      wrap.innerHTML = all.length ? '<div class="empty-state"><p>موردی با این جستجو پیدا نشد.</p></div>' : '';
      return;
    }
    wrap.innerHTML = groups.map((g) => {
      const coll = state.estColl.has(g.key);
      return `<div class="est-group${coll ? ' collapsed' : ''}">
        <div class="est-group-head" data-est-toggle="${Utils.esc(g.key)}">
          <span>🗺 ${Utils.esc(g.label || 'بدون منطقه')}</span>
          <i>${Utils.faNum(g.rows.length)} داروخانه</i>
          <span class="wv-chev">${coll ? '▸' : '▾'}</span>
        </div>
        <div class="est-group-body">${g.rows.map(estRowHtml).join('')}</div>
      </div>`;
    }).join('');
  }

  async function renderEstelamScreen() {
    $id('est-list').innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    try {
      state.estAll = await Backend.getEstelam();
      estPaint();
    } catch (err) {
      $id('est-list').innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + Utils.esc(Backend.faErr(err)) + '</p></div>';
    }
  }

  // ثبت سریع 👍/👎 (با همان خیابان ردیف)
  async function estVote(name, area, verdict) {
    try {
      await Backend.putEstelam({ pharmacyName: name, area, verdict, note: '' });
      showToast('ثبت شد ✓', 'success');
      await renderEstelamScreen();
    } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  function openEstelamSheet(prefill) {
    const pre = prefill || {};
    const names = Array.from(new Set([
      ...(state.estAll || []).map((e) => e.pharmacyName),
      ...((state.wvCurrentList || []).map((v) => v.name))
    ].filter(Boolean))).sort();
    showSheet({
      title: '＋ ثبت استعلام',
      html: `
        <div class="set-row">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">نام داروخانه *</label>
          <input type="text" id="est-f-name" list="est-f-names" value="${Utils.esc(pre.name || '')}" autocomplete="off">
          <datalist id="est-f-names">${names.map((n) => `<option value="${Utils.esc(n)}"></option>`).join('')}</datalist>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">وضعیت حساب *</label>
          <div style="display:flex;gap:8px">
            <button type="button" class="est-pick" data-v="bad">👎 بدحساب</button>
            <button type="button" class="est-pick" data-v="hard">🟠 سخت‌حساب</button>
            <button type="button" class="est-pick" data-v="good">👍 خوش‌حساب</button>
          </div>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">متن (اختیاری)</label>
          <textarea id="est-f-note" rows="3" style="width:100%;resize:vertical"></textarea>
        </div>
        <div class="set-row" style="margin-top:10px">
          <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:4px">منطقه/خیابان (اختیاری)</label>
          <input type="text" id="est-f-area" value="${Utils.esc(pre.area || '')}" autocomplete="off">
        </div>
        <div class="dialog-btns" style="margin-top:14px">
          <button id="est-f-cancel" class="btn btn-ghost">انصراف</button>
          <button id="est-f-save" class="btn btn-primary">ثبت</button>
        </div>`,
      onMount(body, close) {
        let verdict = pre.verdict || null;
        const paint = () => body.querySelectorAll('.est-pick').forEach((b) => b.classList.toggle('on', b.dataset.v === verdict));
        paint();
        body.querySelectorAll('.est-pick').forEach((b) => b.addEventListener('click', () => { verdict = b.dataset.v; paint(); }));
        setTimeout(() => body.querySelector('#est-f-name').focus(), 60);
        body.querySelector('#est-f-cancel').onclick = close;
        body.querySelector('#est-f-save').onclick = async () => {
          const name = body.querySelector('#est-f-name').value.trim();
          if (!name) { showToast('نام داروخانه را وارد کن', 'error'); return; }
          if (!verdict) { showToast('خوش‌حساب یا بدحساب را انتخاب کن', 'error'); return; }
          const btn = body.querySelector('#est-f-save'); btn.disabled = true;
          try {
            await Backend.putEstelam({ pharmacyName: name, area: body.querySelector('#est-f-area').value.trim(), verdict, note: body.querySelector('#est-f-note').value.trim() });
            close();
            showToast('استعلام ثبت شد ✓', 'success');
            if (state.screen === 'estelam') await renderEstelamScreen();
            if (state.screen === 'weekly-visits') await renderWeeklyVisits();
          } catch (err) { btn.disabled = false; showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  Clients.init({ $id, showScreen, showSheet, showDialog, showToast, openListing: (id) => Listings.open(id) });
  Today.init({ $id, showToast, showSheet, supportUnread: () => Support.unreadCount(), openSupport: () => showScreen('support'), planDue: () => DailyPlan.dueCount(), openPlan: () => showScreen('quick-note'), openAdmin: () => showScreen('admin'), openClient: (id) => Clients.open(id), openDeals: () => showScreen('deals'), openCards: () => showScreen('card-views'), subWarn: () => Subscription.warning(), openSub: () => showScreen('subscription') });
  Listings.init({ $id, showScreen, showSheet, showDialog, showToast, openClient: (id) => Clients.open(id), makeCard: (l) => Cards.openCreate(l), openAd: (l) => { AdBuilder.target(l.id); showScreen('ad'); } });
  Converter.init({ $id, showToast });
  QuickNote.init({ $id, showToast });
  DailyPlan.init({ $id, showToast, showSheet, showDialog, openClient: (id) => Clients.open(id) });
  Support.init({ $id, showToast, showSheet });
  Deals.init({ $id, showSheet, showDialog, showToast });
  $id('bottom-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bn]'); if (!b) return;
    if (b.dataset.bn === 'home') { window.scrollTo(0, 0); return; }
    showScreen(b.dataset.bn);
  });
  Collab.init({ $id, showSheet, showDialog, showToast });
  Help.init({ $id, showScreen });
  AdBuilder.init({ $id, showToast, showScreen, showDialog, showPrompt, openListing: (id) => { Listings.open(id); } });
  Subscription.init({ $id, showToast, showScreen, showDialog, showPrompt, onAdminChange: () => { renderAdmin(); PayAlert.refresh(false); } });
  $id('hh-help').addEventListener('click', () => { Help.reset(); showScreen('tutorial'); });
  CardAlert.init({ $id, showToast, openCards: () => showScreen('card-views'), onChange: () => { if (state.screen === 'home') Today.render(); } });
  PayAlert.init({ $id, showToast, openAdmin: () => showScreen('admin'), onChange: () => { if (state.screen === 'home') Today.render(); } });
  Cards.init({ $id, showSheet, showDialog, showToast, openClient: (id) => Clients.open(id), baseHref: () => (window.APP_CONFIG && window.APP_CONFIG.publicUrl) || location.href });
  Push.init({ showScreen });
  if (typeof LocalReminders !== 'undefined') LocalReminders.init({ showScreen });
  $id('btn-est-add').addEventListener('click', () => openEstelamSheet());
  $id('est-search').addEventListener('input', estPaint);
  $id('est-list').addEventListener('click', async (e) => {
    const vote = e.target.closest('[data-est-vote]');
    if (vote) { await estVote(vote.dataset.estName, vote.dataset.estArea || '', vote.dataset.estVote); return; }
    const note = e.target.closest('[data-est-note]');
    if (note) { openEstelamSheet({ name: note.dataset.estName, area: note.dataset.estArea || '' }); return; }
    const hist = e.target.closest('[data-est-hist]');
    if (hist) { const k = hist.dataset.estHist; if (state.estHist.has(k)) state.estHist.delete(k); else state.estHist.add(k); estPaint(); return; }
    const tog = e.target.closest('[data-est-toggle]');
    if (tog) { const k = tog.dataset.estToggle; if (state.estColl.has(k)) state.estColl.delete(k); else state.estColl.add(k); estPaint(); return; }
    const delAll = e.target.closest('[data-est-delall]');
    if (delAll) {
      const key = delAll.dataset.estDelall;
      const mine = (state.estAll || []).filter((x) => wvNameKey(x.pharmacyName) === key);
      const ok = await showDialog({
        title: 'حذف داروخانه',
        message: 'همه‌ی ' + Utils.faNum(mine.length) + ' ثبت استعلام این داروخانه برای همیشه حذف شود؟',
        buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
      });
      if (!ok) return;
      try {
        for (const x of mine) await Backend.deleteEstelam(x.id);
        state.estHist.delete(key);
        showToast('داروخانه حذف شد', 'success');
        await renderEstelamScreen();
      } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); await renderEstelamScreen(); }
      return;
    }
    const del = e.target.closest('[data-est-del]');
    if (!del) return;
    const res = await showDialog({
      title: 'حذف استعلام',
      message: 'این مورد از سابقه برای همیشه حذف شود؟',
      buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }]
    });
    if (!res) return;
    try {
      await Backend.deleteEstelam(del.dataset.estDel);
      showToast('حذف شد', 'success');
      await renderEstelamScreen();
    } catch (err) { showToast('خطا: ' + Backend.faErr(err), 'error'); }
  });

  $id('est-collapse-all').addEventListener('click', () => {
    const groups = estGroups(state.estAll || [], wvNameKey($id('est-search').value || ''));
    const anyColl = groups.some((g) => state.estColl.has(g.key));
    groups.forEach((g) => { if (anyColl) state.estColl.delete(g.key); else state.estColl.add(g.key); });
    estPaint();
  });

  function jorWarehouseLabel(it) {
    const whs = Array.from(new Set((it.jorItems || []).map((x) => String(x.warehouse || ''))));
    if (whs.length === 1) return warehouseName(whs[0]);
    return 'ترکیبی';
  }

  async function showOfflineSaveNotice(order) {
    const reason = order.saveError ? ('\n\nعلت: ' + order.saveError) : '';
    await showDialog({
      title: '⚠️ سفارش هنوز به سرور نرسیده',
      message: 'این سفارش فقط روی همین گوشی ذخیره شد و مدیر آن را نمی‌بیند. اپ را باز نگه دارید و از صفحه سفارش، دکمه «ارسال به سرور» را بزنید. اگر پیام «نشست منقضی شده» است، خارج و دوباره وارد شوید. داده‌های اپ را پاک نکنید.' + reason,
      buttons: [{ label: 'متوجه شدم', value: true, kind: 'btn-primary' }]
    });
  }

  /* ارسال یک سفارش آفلاین به سرور — هم دکمه دستی هم Sync خودکار از این استفاده می‌کنند */
  // جلوگیری از ارسال هم‌زمان یک سفارش (ارسال دستی + خودکار)
  const syncInFlight = new Map();
  function syncOneOrder(order) {
    const key = String(order.no) + '|' + String(order.createdAt);
    if (syncInFlight.has(key)) return syncInFlight.get(key);
    const p = syncOneOrderInner(order).finally(() => syncInFlight.delete(key));
    syncInFlight.set(key, p);
    return p;
  }

  async function syncOneOrderInner(order) {
    const oldLocalId = order.id;
    const payload = { ...order };
    delete payload.id;
    delete payload.pendingSync;
    const saved = await Backend.putOrder(payload);
    if (oldLocalId !== undefined && oldLocalId !== null) {
      await DB.deleteLocalOrder(oldLocalId); // فقط نسخه‌ی محلی؛ قبلاً ممکن بود روی سرور هم حذف نرم بزند
    }
    order.id = saved.id;
    order.no = saved.no; // ممکن است هنگام ثبت به‌خاطر شماره تکراری اصلاح شده باشد
    order.pendingSync = false;
    await DB.putOrder(order);
  }

  const syncLogged = new Set();
  let autoSyncing = false;
  async function autoSyncPendingOrders() {
    if (autoSyncing) return;
    if (!Backend.isActive()) return;
    if (Backend.isOffline()) await Backend.recheckConnection();
    if (!DB.useBackend()) return;
    const pending = state.orders.filter((o) => o.pendingSync);
    if (!pending.length) return;
    autoSyncing = true;
    let okCount = 0;
    for (const order of pending) {
      try {
        await syncOneOrder(order);
        okCount++;
      } catch (e) {
        // فقط یک بار برای هر سفارش در هر نشست لاگ می‌شود (جلوگیری از اسپم)
        const key = String(order.no);
        if (!syncLogged.has(key)) { syncLogged.add(key); try { Backend.logError('order-sync #' + order.no, e, 'orders').catch(() => {}); } catch (er) { /* بی‌اثر */ } }
        // خطای شبکه = بقیه هم شکست می‌خورند، توقف؛ خطای دیگر = فقط همین سفارش مشکل دارد، ادامه
        if (/network|fetch|timeout|timed out/i.test(String(e && e.message ? e.message : e))) break;
      }
    }
    autoSyncing = false;
    if (okCount > 0) {
      showToast(Utils.faNum(okCount) + ' سفارش به‌صورت خودکار به سرور ارسال شد ✓', 'success');
      if (state.screen === 'orders') renderOrdersList();
      if (state.screen === 'order-detail') renderOrderDetail();
      updateCartFab();
    }
  }

  // اگر پروفایل/پلن هنگام ورود خوانده نشده بود، بعداً دوباره تأیید می‌شود؛ اگر اشتراک واقعاً معلق/منقضی بود صفحه‌اش نمایش داده می‌شود
  function recheckSubscriptionIfUnverified() {
    Backend.refreshProfileIfUnverified().then((changed) => {
      if (!changed) return;
      const sub = Backend.subscriptionStatus();
      if (!sub.active) showExpiredScreen(sub);
    }).catch(() => {});
  }
  // پیام ساده به کاربر وقتی ذخیره‌ی سبد روی سرور شکست می‌خورد (جزئیات فنی نشان داده نمی‌شود)
  OrderManager.setNotifier((kind) => {
    if (kind === 'local') showToast('اینترنت ناپایدار است؛ تغییر سبد فعلاً فقط روی این گوشی ذخیره شد و بعداً خودکار ارسال می‌شود.', 'error');
    else showToast('ذخیره‌ی سبد ناموفق بود. سبد را بررسی کنید و اگر تکرار شد، اپ را دوباره باز کنید.', 'error');
  });
  // یک پیام یکسان برای هر دو حالت («واقعاً آفلاین» و «آنلاین به‌نظر می‌رسید ولی درخواست شکست خورد»)،
  // چون از نگاه کاربر هر دو یعنی «الان اینترنت نبود» — داده گم نمی‌شود، فقط هنوز روی سرور نیست و خودش بعداً می‌رود
  Aliases.setNotifier(() => {
    showToast('اینترنت وصل نبود؛ نام مستعار فعلاً فقط روی این گوشی ذخیره شد و به‌محض وصل‌شدن اینترنت خودکار ارسال می‌شود.', 'error');
  });
  CustomProducts.setNotifier(() => {
    showToast('اینترنت وصل نبود؛ محصول دستی فعلاً فقط روی این گوشی ذخیره شد و به‌محض وصل‌شدن اینترنت خودکار ارسال می‌شود.', 'error');
  });
  PackSize.setNotifier(() => {
    showToast('اینترنت وصل نبود؛ اندازه‌ی بسته فعلاً فقط روی این گوشی ذخیره شد و به‌محض وصل‌شدن اینترنت خودکار ارسال می‌شود.', 'error');
  });
  /* به‌روزرسانی نام‌های مستعار جستجو: اگر کاربر/دستگاه دیگری نام مستعار تازه‌ای ثبت کرده باشد،
     بدون نیاز به بستن و باز کردن اپ در جستجو دیده شود */
  let aliasRefreshAt = 0;
  async function refreshAliasSearch(force) {
    const now = Date.now();
    if (!force && now - aliasRefreshAt < 120000) return;
    aliasRefreshAt = now;
    try {
      if (await Aliases.refresh()) {
        Searcher.setAliases(Aliases.getAll());
        if (state.screen === 'products') renderResults();
      }
    } catch (e) { /* بی‌اثر */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { refreshAliasSearch(false); Backend.touchLastSeen(); if (typeof DailyPlan !== 'undefined') DailyPlan.syncReminders(); }
  });

  window.addEventListener('online', () => {
    autoSyncPendingOrders(); OrderManager.flushCartIfDirty(); recheckSubscriptionIfUnverified();
    Aliases.flushIfDirty().finally(() => refreshAliasSearch(true)); CustomProducts.flushIfDirty(); PackSize.flushIfDirty();
  });
  window.addEventListener('offline', () => { if (Backend.forceOfflineMode) Backend.forceOfflineMode(); });
  // بازبینی دوره‌ای هم به‌عنوان پشتیبان، چون رویداد online همیشه در مرورگرهای
  // موبایل قابل‌اعتماد نیست (مثلاً وقتی وای‌فای وصله ولی اینترنت واقعی نداره)
  setInterval(() => {
    if (document.visibilityState === 'visible') Backend.touchLastSeen();
    if (window.APP_CONFIG && window.APP_CONFIG.crmOnly) { recheckSubscriptionIfUnverified(); return; }
    autoSyncPendingOrders(); OrderManager.flushCartIfDirty(); recheckSubscriptionIfUnverified();
    Aliases.flushIfDirty().finally(() => refreshAliasSearch(false)); CustomProducts.flushIfDirty(); PackSize.flushIfDirty();
  }, 60000);

  /* جزئیات فقط‌خواندنی یک سفارش برای پنل مدیر (اقلام + اطلاعات داروخانه) */
  function adminOrderDetailHtml(o) {
    const info = [];
    const add = (lbl, v) => { if (v) info.push(`<div class="od-info-row"><span class="lbl">${lbl}</span><span class="val">${Utils.esc(v)}</span></div>`); };
    add('ویزیتور', o.visitorName);
    add('داروخانه', o.pharmacyName);
    add('آدرس', o.pharmacyAddress);
    add('منطقه', o.pharmacyArea);
    add('تلفن', o.pharmacyPhone);
    add('یادداشت', o.note);
    add('آفر', o.offer);
    const items = Array.isArray(o.items) ? o.items : [];
    const rows = items.map((it, i) => it.isJor ? `
      <tr><td>${i + 1}</td><td>—</td><td>${Utils.esc(it.name)} (جُر)</td><td>${Utils.esc(jorWarehouseLabel(it))}</td><td>${it.offer ? Utils.esc(it.offer) : '—'}</td><td>${Utils.faNum(it.jorCount || 0)}</td><td>—</td><td>${Utils.faNum(it.lineTotal)}</td></tr>` : `
      <tr><td>${i + 1}</td><td>${Utils.esc(it.code)}</td><td>${Utils.esc(it.name)}</td><td>${Utils.esc(warehouseName(it.warehouse))}</td><td>${it.offer ? Utils.esc(it.offer) : '—'}</td><td>${Utils.faNum(it.qty)}</td><td>${Utils.faNum(it.priceToman)}</td><td>${Utils.faNum(it.lineTotal)}</td></tr>`).join('');
    return `
      ${info.length ? `<div class="od-info">${info.join('')}</div>` : ''}
      <div class="od-table-wrap">
        <table class="od-table">
          <thead><tr><th>#</th><th>کد کالا</th><th>نام کالا</th><th>انبار</th><th>آفر</th><th>تعداد</th><th>قیمت واحد</th><th>قیمت کل</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">اقلامی ثبت نشده.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="oh-total" style="margin:8px 0">جمع کل: ${Utils.formatMoney(o.total)}</div>
      <button class="btn btn-ghost btn-sm" data-admin-copy="${o.id}" style="width:100%;margin-bottom:8px">📋 کپی متن سفارش</button>`;
  }

  /* کپی متن یک سفارش در پنل مدیر (همان قالب و همان انتخاب انبار صفحه سفارش کاربر) */
  async function adminCopyOrder(order) {
    const wh = await showDialog({
      title: 'کپی سفارش',
      message: 'فقط اقلام کدام انبار کپی شود؟',
      buttons: [
        { label: warehouseName('2'), value: '2' },
        { label: warehouseName('1'), value: '1' },
        { label: 'انصراف', value: null, kind: 'btn-ghost' }
      ]
    });
    if (!wh) return;
    const items = Array.isArray(order.items) ? order.items : [];
    const has = items.some((it) => it.isJor
      ? (it.jorItems || []).some((x) => String(x.warehouse) === String(wh))
      : String(it.warehouse) === String(wh));
    if (!has) { showToast('هیچ قلمی از این انبار در سفارش نیست'); return; }
    const ok = await OrderManager.copyText(OrderManager.buildOrderText(Object.assign({}, order, { items }), wh));
    showToast(ok ? 'متن سفارش کپی شد ✓' : 'کپی انجام نشد', ok ? 'success' : 'error');
  }

  function renderOrderDetail() {
    const order = state.orders.find((o) => o.id === state.currentOrderId);
    const wrap = $id('od-content');
    if (!order) {
      wrap.innerHTML = '<div class="empty-state"><p>سفارش پیدا نشد.</p></div>';
      return;
    }
    const rows = order.items.map((it, i) => it.isJor ? `
      <tr>
        <td>${i + 1}</td>
        <td>—</td>
        <td>${Utils.esc(it.name)} <span class="jor-badge">⭐ جور</span></td>
        <td>${Utils.esc(jorWarehouseLabel(it))}</td>
        <td>${it.offer ? Utils.esc(it.offer) : '—'}</td>
        <td>${Utils.faNum(it.jorCount || 0)}</td>
        <td>—</td>
        <td>${Utils.faNum(it.lineTotal)}</td>
      </tr>` : `
      <tr>
        <td>${i + 1}</td>
        <td>${Utils.esc(it.code)}</td>
        <td>${Utils.esc(it.name)}</td>
        <td>${Utils.esc(warehouseName(it.warehouse))}</td>
        <td>${it.offer ? Utils.esc(it.offer) : '—'}</td>
        <td>${Utils.faNum(it.qty)}</td>
        <td>${Utils.faNum(it.priceToman)}</td>
        <td>${Utils.faNum(it.lineTotal)}</td>
      </tr>`).join('');
    const infoRows = [];
    if (order.visitorName) infoRows.push(`<div class="od-info-row"><span class="lbl">👤 ویزیتور</span><span class="val">${Utils.esc(order.visitorName)}</span></div>`);
    if (order.pharmacyName) infoRows.push(`<div class="od-info-row"><span class="lbl">🏥 داروخانه</span><span class="val">${Utils.esc(order.pharmacyName)}</span></div>`);
    if (order.pharmacyAddress) infoRows.push(`<div class="od-info-row"><span class="lbl">📍 آدرس</span><span class="val">${Utils.esc(order.pharmacyAddress)}</span></div>`);
    if (order.pharmacyArea) infoRows.push(`<div class="od-info-row"><span class="lbl">🗺 منطقه</span><span class="val">${Utils.esc(order.pharmacyArea)}</span></div>`);
    if (order.pharmacyPhone) infoRows.push(`<div class="od-info-row"><span class="lbl">📞 تلفن</span><span class="val" dir="ltr" style="unicode-bidi:embed">${Utils.esc(order.pharmacyPhone)}</span></div>`);
    if (order.note) infoRows.push(`<div class="od-info-row"><span class="lbl">📝 توضیحات</span><span class="val">${Utils.esc(order.note)}</span></div>`);
    if (order.offer) infoRows.push(`<div class="od-info-row"><span class="lbl">🏷️ آفر</span><span class="val">${Utils.esc(order.offer)}</span></div>`);
    wrap.innerHTML = `
      <div class="od-hero">
        <div class="oh-no">سفارش شماره ${Utils.faNum(order.no)}</div>
        <div class="oh-date">${Utils.faFullDate(order.createdAt)} — ${Utils.faTime(order.createdAt)}</div>
        <div class="oh-total">مبلغ کل: ${Utils.formatMoney(order.total)}</div>
      </div>
      ${order.pendingSync ? `
      <div class="ci-warn danger" style="margin-bottom:10px">
        📴 این سفارش هنوز به سرور ارسال نشده و فقط روی همین گوشیه — مدیر و بقیه نمی‌بیننش.
        <button class="btn btn-primary btn-sm" id="od-sync" style="margin-top:8px;width:100%">📤 ارسال به سرور</button>
      </div>` : ''}
      ${infoRows.length ? `<div class="od-info">${infoRows.join('')}</div>` : ''}
      <div class="od-table-wrap">
        <table class="od-table">
          <thead><tr><th>#</th><th>کد کالا</th><th>نام محصول</th><th>انبار</th><th>آفر</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ کل</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="btn btn-primary btn-lg" id="od-edit" style="margin-bottom:10px">✏️ ویرایش سفارش</button>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" id="od-copy">📋 کپی متن</button>
        <button class="btn btn-ghost btn-sm" id="od-share">📤 اشتراک‌گذاری</button>
      </div>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" id="od-pdf">📄 خروجی PDF</button>
        <button class="btn btn-ghost btn-sm" id="od-xlsx">📊 خروجی Excel</button>
      </div>
      <button class="btn btn-danger btn-lg" id="od-delete" style="margin-top:6px">🗑 حذف سفارش</button>`;

    const wire = (id, fn) => { const el = $id(id); if (el) el.addEventListener('click', fn); };
    wire('od-sync', async () => {
      if (!DB.useBackend()) { showToast('اینترنت وصل نیست یا وارد حساب نیستی', 'error'); return; }
      const btn = $id('od-sync');
      if (btn) { btn.disabled = true; btn.textContent = 'در حال ارسال...'; }
      try {
        await syncOneOrder(order);
        showToast('سفارش با موفقیت به سرور ارسال شد ✓', 'success');
        renderOrderDetail();
      } catch (err) {
        showToast('خطا در ارسال: ' + Backend.faErr(err), 'error');
        if (btn) { btn.disabled = false; btn.textContent = '📤 ارسال به سرور'; }
      }
    });
    wire('od-edit', () => startEditOrder(order.id));
    const askWarehouseChoice = () => showDialog({
      title: 'کپی/اشتراک‌گذاری',
      message: 'فقط اقلام کدام انبار کپی شود؟',
      buttons: [
        { label: warehouseName('2'), value: '2' },
        { label: warehouseName('1'), value: '1' },
        { label: 'انصراف', value: null, kind: 'btn-ghost' }
      ]
    });

    const hasWarehouseItems = (wh) => order.items.some((it) => it.isJor
      ? (it.jorItems || []).some((x) => String(x.warehouse) === String(wh))
      : String(it.warehouse) === String(wh));

    wire('od-copy', async () => {
      const wh = await askWarehouseChoice();
      if (!wh) return;
      if (!hasWarehouseItems(wh)) { showToast('هیچ قلمی از این انبار در سفارش نیست'); return; }
      const ok = await OrderManager.copyText(OrderManager.buildOrderText(order, wh));
      showToast(ok ? 'متن سفارش کپی شد ✓' : 'کپی انجام نشد', ok ? 'success' : 'error');
    });
    wire('od-share', async () => {
      const wh = await askWarehouseChoice();
      if (!wh) return;
      if (!hasWarehouseItems(wh)) { showToast('هیچ قلمی از این انبار در سفارش نیست'); return; }
      const res = await OrderManager.shareText(OrderManager.buildOrderText(order, wh));
      if (res === 'shared') return;
      if (res === 'copied') showToast('متن کپی شد — در پیام‌رسان قرار دهید ✓', 'success');
      else if (res === 'failed') showToast('اشتراک‌گذاری ممکن نشد', 'error');
    });
    wire('od-pdf', async () => {
      showToast('در حال ساخت PDF…');
      try {
        await OrderManager.exportPdf(order);
        showToast('خروجی PDF ساخته شد ✓', 'success');
      } catch (err) {
        showToast('خطا در ساخت PDF: ' + Backend.faErr(err), 'error');
      }
    });
    wire('od-xlsx', async () => {
      try {
        await OrderManager.exportExcel(order);
        showToast('خروجی Excel ساخته شد ✓', 'success');
      } catch (err) {
        showToast('خطا در ساخت Excel: ' + Backend.faErr(err), 'error');
      }
    });
    wire('od-delete', async () => {
      const res = await showDialog({
        title: 'حذف سفارش',
        message: 'سفارش شماره ' + Utils.faNum(order.no) + ' حذف شود؟ (تا ۷ روز از سطل زباله قابل بازگردوندنه، بعدش خودکار برای همیشه پاک می‌شه)',
        buttons: [
          { label: 'انصراف', value: false },
          { label: 'حذف', value: true, kind: 'btn-danger' }
        ]
      });
      if (res) {
        await OrderManager.deleteOrder(order.id);
        state.orders = state.orders.filter((o) => o.id !== order.id);
        showToast('سفارش حذف شد (توی سطل زباله موجوده)');
        showScreen('orders');
      }
    });
  }

  /* ---------- ویرایش سفارش ---------- */

  /* بنر بالای صفحه‌ی جستجوی کامل، وقتی از «ویرایش سفارش» برای افزودن محصول آمده‌ایم */
  function updateEditAddBanner() {
    const host = $id('screen-products');
    if (!host) return;
    let bar = $id('edit-add-banner');
    const active = state.screen === 'products' && state.editAddMode && state.edit && state.edit.orderId;
    if (!active) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'edit-add-banner';
      bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;'
        + 'background:var(--brand-soft);border:1.5px solid var(--brand);border-radius:14px;'
        + 'padding:10px 12px;margin-bottom:10px;font-size:13px;color:var(--brand-dark)';
      host.insertBefore(bar, host.firstChild);
    }
    const order = state.orders.find((o) => o.id === state.edit.orderId);
    bar.innerHTML = '<span>✏️ افزودن محصول به سفارش' + (order ? ' شماره ' + Utils.faNum(order.no) : '') + '</span>'
      + '<button type="button" class="btn btn-primary btn-sm" id="edit-add-back">↩ بازگشت به ویرایش</button>';
    $id('edit-add-back').onclick = () => showScreen('edit-order');
  }

  /* نگه‌داشتن فیلدهای تایپ‌شده‌ی ویرایش، قبل از رفتن به صفحه‌ی جستجو */
  function syncEditInfoFromForm() {
    const e = state.edit;
    if (!e || !e.info) return;
    const val = (id, cur) => ($id(id) ? $id(id).value : cur);
    e.info.visitorName = val('ed-visitor', e.info.visitorName);
    e.info.pharmacyName = val('ed-pharmacy', e.info.pharmacyName);
    e.info.pharmacyAddress = val('ed-address', e.info.pharmacyAddress);
    e.info.pharmacyArea = val('ed-area', e.info.pharmacyArea);
    e.info.pharmacyPhone = val('ed-phone', e.info.pharmacyPhone);
    e.info.note = val('ed-note', e.info.note);
    e.info.offer = val('ed-offer', e.info.offer);
  }

  function startEditOrder(orderId) {
    const order = state.orders.find((o) => o.id === Number(orderId));
    if (!order) { showToast('سفارش پیدا نشد', 'error'); return; }
    state.edit = {
      orderId: order.id,
      items: (order.items || []).map((i) => ({ ...i })),
      info: {
        visitorName: order.visitorName || '',
        pharmacyName: order.pharmacyName || '',
        pharmacyAddress: order.pharmacyAddress || '',
        pharmacyArea: order.pharmacyArea || '',
        pharmacyPhone: order.pharmacyPhone || '',
        note: order.note || '',
        offer: order.offer || ''
      }
    };
    showScreen('edit-order');
  }

  function renderEditOrder() {
    const e = state.edit;
    const wrap = $id('edit-content');
    if (!e || !e.orderId) {
      wrap.innerHTML = '<div class="empty-state"><p>سفارشی برای ویرایش انتخاب نشده است.</p></div>';
      return;
    }
    const order = state.orders.find((o) => o.id === e.orderId);
    if (!order) {
      wrap.innerHTML = '<div class="empty-state"><p>سفارش پیدا نشد.</p></div>';
      return;
    }
    const info = e.info;
    wrap.innerHTML = `
      <div class="set-card">
        <div class="set-title">✏️ ویرایش سفارش شماره ${Utils.faNum(order.no)} — ${Utils.faFullDate(order.createdAt)}</div>
        <div class="set-row">
          <label>نام ویزیتور</label>
          <input type="text" id="ed-visitor" value="${Utils.esc(info.visitorName)}" autocomplete="off">
        </div>
        <div class="set-row">
          <label>نام داروخانه</label>
          <input type="text" id="ed-pharmacy" value="${Utils.esc(info.pharmacyName)}" autocomplete="off">
        </div>
        <div class="set-row">
          <label>آدرس داروخانه</label>
          <input type="text" id="ed-address" value="${Utils.esc(info.pharmacyAddress)}" autocomplete="off">
        </div>
        <div class="set-row">
          <label>منطقه/خیابان (برای دسته‌بندی آرشیو)</label>
          <input type="text" id="ed-area" value="${Utils.esc(info.pharmacyArea || '')}" autocomplete="off">
        </div>
        <div class="set-row">
          <label>شماره تلفن داروخانه</label>
          <input type="tel" id="ed-phone" value="${Utils.esc(info.pharmacyPhone)}" autocomplete="off">
        </div>
        <div class="set-row">
          <label>توضیحات</label>
          <textarea id="ed-note" rows="2">${Utils.esc(info.note)}</textarea>
        </div>
        <div class="set-row">
          <label>آفر (توضیح تجاری)</label>
          <input type="text" id="ed-offer" value="${Utils.esc(info.offer)}" placeholder="مثلاً: ۱۰٪ تخفیف، یک عدد هدیه…" autocomplete="off">
        </div>
      </div>
      <div class="set-card">
        <div class="set-title">محصولات سفارش</div>
        <div id="edit-items"></div>
        <button class="btn btn-ghost btn-sm" id="ed-add-product" style="width:100%;margin-top:10px">➕ افزودن محصول</button>
        <div class="os-row os-total" style="margin-top:10px">
          <span>مبلغ کل سفارش</span><strong id="edit-total"></strong>
        </div>
      </div>
      <div class="order-actions">
        <button class="btn btn-primary btn-lg" id="ed-save">💾 ذخیره تغییرات</button>
        <button class="btn btn-ghost btn-lg" id="ed-cancel">انصراف</button>
      </div>`;
    renderEditItems();
  }

  function renderEditItems() {
    const e = state.edit;
    const wrap = $id('edit-items');
    if (!wrap) return;
    if (!e.items.length) {
      wrap.innerHTML = '<div class="empty-state" style="padding:14px"><p>محصولی در سفارش نیست.</p></div>';
      $id('edit-total').textContent = '—';
      return;
    }
    wrap.innerHTML = e.items.map((it) => `
      <div class="cart-item">
        <div class="ci-top">
          <div>
            <div class="ci-name">${Utils.esc(it.name)}</div>
            <div class="ci-sub">کد: ${Utils.esc(it.code)} | ${Utils.esc(warehouseName(it.warehouse))} | قیمت واحد: ${Utils.faNum(it.priceToman)}</div>
          </div>
          <button class="ci-remove" data-rm="${Utils.esc(it.whKey)}" aria-label="حذف">✕</button>
        </div>
        <div class="ci-body">
          <div class="qty-stepper">
            <button class="qty-btn" data-dec="${Utils.esc(it.whKey)}">−</button>
            <span class="qty-val">${Utils.faNum(it.qty)}</span>
            <button class="qty-btn" data-inc="${Utils.esc(it.whKey)}">+</button>
          </div>
          <div class="ci-price">
            <div class="unit">${Utils.faNum(it.priceToman)} تومان × ${Utils.faNum(it.qty)}</div>
            <div class="line">${Utils.formatMoney(it.qty * (it.priceToman || 0))}</div>
          </div>
        </div>
        <div class="ci-offer-row">
          <span class="ci-offer-label">آفر:</span>
          <input class="ci-offer-input" data-edit-offer="${Utils.esc(it.whKey)}" value="${Utils.esc(it.offer || '')}" placeholder="آفر این محصول (اختیاری)" autocomplete="off">
        </div>
      </div>`).join('');
    const total = e.items.reduce((s, i) => s + i.qty * (i.priceToman || 0), 0);
    $id('edit-total').textContent = Utils.formatMoney(total);
  }

  function addEditProduct(product, qty, offer) {
    const e = state.edit;
    if (!e || !e.items) return;
    const n = Math.max(1, parseInt(qty, 10) || 1);
    const whKey = product.warehouse + '|' + product.code;
    const ex = e.items.find((i) => i.whKey === whKey);
    if (ex) { ex.qty += n; if (offer) ex.offer = offer; }
    else e.items.push({ ...product, whKey, qty: n, offer: offer || '' });
    renderEditItems();
  }

  async function saveEditOrder() {
    const e = state.edit;
    if (!e || !e.orderId) return;
    if (!e.items.length) { showToast('حداقل یک محصول لازم است.', 'error'); return; }
    const info = {
      visitorName: ($id('ed-visitor') ? $id('ed-visitor').value : '').trim(),
      pharmacyName: ($id('ed-pharmacy') ? $id('ed-pharmacy').value : '').trim(),
      pharmacyAddress: ($id('ed-address') ? $id('ed-address').value : '').trim(),
      pharmacyArea: ($id('ed-area') ? $id('ed-area').value : '').trim(),
      pharmacyPhone: ($id('ed-phone') ? $id('ed-phone').value : '').trim(),
      note: ($id('ed-note') ? $id('ed-note').value : '').trim(),
      offer: ($id('ed-offer') ? $id('ed-offer').value : '').trim()
    };
    try {
      const updated = await OrderManager.updateOrder(e.orderId, { items: e.items, info });
      await loadOrders();
      state.currentOrderId = updated.id;
      showToast('سفارش ویرایش و ذخیره شد ✓', 'success');
      showScreen('order-detail', { order: updated });
    } catch (err) {
      showToast('خطا در ذخیره ویرایش: ' + Backend.faErr(err), 'error');
    }
  }

  $id('edit-content').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const rm = e.target.closest('[data-rm]');
    const edAdd = e.target.closest('#ed-add-product');
    const edSave = e.target.closest('#ed-save');
    const edCancel = e.target.closest('#ed-cancel');
    const items = state.edit.items;
    if (inc) {
      const it = items.find((i) => i.whKey === inc.dataset.inc);
      if (it) { it.qty += 1; renderEditItems(); }
    } else if (dec) {
      const it = items.find((i) => i.whKey === dec.dataset.dec);
      if (it) { it.qty -= 1; if (it.qty <= 0) items.splice(items.indexOf(it), 1); renderEditItems(); }
    } else if (rm) {
      const idx = items.findIndex((i) => i.whKey === rm.dataset.rm);
      if (idx >= 0) { items.splice(idx, 1); renderEditItems(); }
    } else if (edAdd) {
      syncEditInfoFromForm();
      state.editAddMode = true;
      showScreen('products');
    } else if (edSave) {
      saveEditOrder();
    } else if (edCancel) {
      showScreen('order-detail');
    }
  });

  /* آفر هر قلم در ویرایش — مستقل و بدون تأثیر روی مبلغ (بدون رندر مجدد تا فوکوس حفظ شود) */
  $id('edit-content').addEventListener('input', (e) => {
    const inp = e.target.closest('[data-edit-offer]');
    if (inp) {
      const it = state.edit.items.find((i) => i.whKey === inp.dataset.editOffer);
      if (it) it.offer = inp.value;
    }
  });

  /* ---------- آرشیو داروخانه‌ها ---------- */

  async function renderArchive() {
    if (!state.ordersFullyLoaded) {
      const listEl = $id('arch-list');
      if (listEl) listEl.innerHTML = '<div class="empty-state"><p>در حال بارگذاری کامل سابقه سفارش‌ها...</p></div>';
      await ensureAllOrdersLoaded();
      if (state.screen !== 'archive') return; // کاربر صفحه را عوض کرده
    }
    const q = state.archiveQuery;
    const pharmacies = Archive.searchPharmacies(Archive.groupByPharmacy(state.orders), q);
    const without = Archive.ordersWithoutPharmacy(state.orders);
    const list = $id('arch-list');
    const empty = $id('arch-empty');
    const count = $id('arch-count');
    count.textContent = pharmacies.length
      ? Utils.faNum(pharmacies.length) + ' داروخانه' + (q ? ' برای «' + q + '»' : '')
      : '';
    const showWithout = without.length && (!q || Utils.norm('سفارش‌های بدون داروخانه ' + without.length).includes(q));
    if (!pharmacies.length && !showWithout) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const pharmacyCard = (ph) => `
      <div class="ph-card" data-key="${Utils.esc(ph.key)}">
        <div class="ph-top">
          <div class="ph-name">🏥 ${Utils.esc(ph.name)}</div>
          <div class="ph-count">${Utils.faNum(ph.orderCount)} سفارش</div>
        </div>
        <div class="ph-sub">📞 ${Utils.esc(ph.phone || '—')}${ph.address ? ' | 📍 ' + Utils.esc(ph.address) : ''}</div>
        <div class="ph-sub">آخرین سفارش: ${Utils.faFullDate(ph.lastDate)} | جمع مبلغ: ${Utils.formatMoney(ph.total)}</div>
        ${ph.visitors ? `<div class="ph-sub">👤 ${Utils.esc(ph.visitors)}</div>` : ''}
      </div>`;
    // دسته‌بندی بر اساس منطقه/خیابان — هر گروه با یک سرتیتر جدا
    const groups = Archive.groupByArea(pharmacies);
    const groupsHtml = '<div class="acc-card">' + accToolbar(groups.length, 'خیابان') + groups.map((g) => accSection(
      'arch', g.area,
      `<span class="acc-ico">📍</span><span class="acc-name">${Utils.esc(g.area)}</span><span class="acc-count">${Utils.faNum(g.count)}</span>`,
      g.pharmacies.map(pharmacyCard).join(''),
      !!q  // هنگام جستجو، گروه‌های نتیجه باز باشند
    )).join('') + '</div>';
    list.innerHTML = groupsHtml
      + (showWithout ? `
      <div class="ph-card ph-null" data-key="__none__">
        <div class="ph-name">سفارش‌های بدون داروخانه</div>
        <div class="ph-sub">${Utils.faNum(without.length)} سفارش — با «ویرایش سفارش» نام داروخانه را اضافه کنید.</div>
      </div>` : '');
  }

  wireAccordion('arch-list', 'arch');
  wireAccordion('tp-list', 'tp');

  $id('arch-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-key]');
    if (card) {
      state.pharmacyKey = card.dataset.key;
      showScreen('pharmacy');
    }
  });

  /* ---------- پرونده داروخانه ---------- */

  function orderCardHtml(o) {
    const itemOffers = (o.items || []).filter((i) => i.offer).map((i) => i.name + ': ' + i.offer);
    return `
      <div class="order-card" data-oid="${o.id}">
        <div class="oc-no">${Utils.faNum(o.no)}</div>
        <div class="oc-body">
          <div class="oc-title">سفارش شماره ${Utils.faNum(o.no)}</div>
          <div class="oc-sub">${Utils.faFullDate(o.createdAt)} — ${Utils.faTime(o.createdAt)} | ${Utils.faNum(o.items.length)} قلم</div>
          ${o.note ? `<div class="oc-sub">📝 ${Utils.esc(o.note)}</div>` : ''}
          ${o.offer ? `<div class="oc-sub">🏷️ آفر: ${Utils.esc(o.offer)}</div>` : ''}
          ${itemOffers.length ? `<div class="oc-sub">آفر اقلام: ${Utils.esc(itemOffers.join(' | '))}</div>` : ''}
        </div>
        <div class="oc-total">
          <div class="t">${Utils.faNum(o.total)}</div>
          <div class="d">تومان</div>
        </div>
        <button class="oc-edit" data-edit-oid="${o.id}" title="ویرایش سفارش" aria-label="ویرایش">✏️</button>
      </div>`;
  }

  async function renderPharmacy() {
    const key = state.pharmacyKey;
    const wrap = $id('pharmacy-content');
    if (!state.ordersFullyLoaded) {
      if (wrap) wrap.innerHTML = '<div class="empty-state"><p>در حال بارگذاری کامل سابقه سفارش‌ها...</p></div>';
      await ensureAllOrdersLoaded();
      if (state.screen !== 'pharmacy') return;
    }
    if (key === '__none__') {
      const orders = Archive.ordersWithoutPharmacy(state.orders);
      wrap.innerHTML = `
        <div class="ph-hero">
          <div class="phh-name">سفارش‌های بدون داروخانه</div>
          <div class="phh-sub">با «ویرایش سفارش» نام داروخانه را اضافه کنید تا به آرشیو منتقل شود.</div>
          <div class="phh-stats"><span>${Utils.faNum(orders.length)} سفارش</span></div>
        </div>
        ${orders.map(orderCardHtml).join('') || '<div class="empty-state"><p>سفارشی نیست.</p></div>'}`;
      return;
    }
    const ph = Archive.groupByPharmacy(state.orders).find((p) => p.key === key);
    if (!ph) {
      wrap.innerHTML = '<div class="empty-state"><p>داروخانه پیدا نشد.</p></div>';
      return;
    }
    wrap.innerHTML = `
      <div class="ph-hero">
        <div class="phh-name">🏥 ${Utils.esc(ph.name)}</div>
        ${ph.phone ? `<div class="phh-sub">📞 <span dir="ltr" style="unicode-bidi:embed">${Utils.esc(ph.phone)}</span></div>` : ''}
        ${ph.address ? `<div class="phh-sub">📍 ${Utils.esc(ph.address)}</div>` : ''}
        ${ph.area ? `<div class="phh-sub">🗺 منطقه: ${Utils.esc(ph.area)}</div>` : ''}
        ${ph.visitors ? `<div class="phh-sub">👤 ویزیتور: ${Utils.esc(ph.visitors)}</div>` : ''}
        <div class="phh-stats">
          <span>${Utils.faNum(ph.orderCount)} سفارش</span>
          <span>جمع مبلغ: ${Utils.formatMoney(ph.total)}</span>
        </div>
      </div>
      <button class="btn btn-primary btn-lg" id="ph-new-order" style="margin-bottom:12px">➕ سفارش جدید برای این داروخانه</button>
      <div class="result-count">سفارش‌های این داروخانه (جدیدترین اول)</div>
      ${ph.orders.map(orderCardHtml).join('')}`;
  }

  $id('pharmacy-content').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-oid]');
    if (editBtn) {
      startEditOrder(Number(editBtn.dataset.editOid));
      return;
    }
    const card = e.target.closest('[data-oid]');
    if (card) {
      state.currentOrderId = Number(card.dataset.oid);
      showScreen('order-detail');
      return;
    }
    const newOrder = e.target.closest('#ph-new-order');
    if (newOrder) {
      const key = state.pharmacyKey;
      const ph = Archive.groupByPharmacy(state.orders).find((p) => p.key === key);
      OrderManager.setCartInfo({
        pharmacyName: ph ? ph.name : '',
        pharmacyAddress: ph ? ph.address : '',
        pharmacyArea: ph ? ph.area : '',
        pharmacyPhone: ph ? ph.phone : ''
      });
      showScreen('products');
      showToast('اطلاعات داروخانه ثبت شد — حالا محصولات را جستجو و اضافه کن ✓', 'success');
    }
  });

  /* ---------- مدیریت فایل‌ها ---------- */

  async function loadFiles() {
    const files = await DB.getAllFiles();
    state.files = { 1: null, 2: null };
    files.forEach((f) => { state.files[f.warehouse] = f; });
  }

  function renderFilesScreen() {
    const wrap = $id('files-content');
    const card = (wh) => {
      const f = state.files[wh];
      const isWh2 = String(wh) === '2';
      const fileHtml = f
        ? `<div class="fc-file"><div class="fn">📄 ${Utils.esc(f.fileName)}</div>
            <div class="fm">${Utils.fileSize(f.fileSize)} | ${Utils.faNum(f.rowCount)} محصول | واحد: ${f.unit === 'rial' ? 'ریال (تبدیل به تومان)' : 'تومان'}</div>
            <div class="fm">آخرین به‌روزرسانی: ${Utils.faDate(f.uploadedAt)} — ${Utils.faTime(f.uploadedAt)}</div></div>`
        : `<div class="fc-file"><div class="fm">فایلی وارد نشده است.</div></div>`;
      return `<div class="file-card ${isWh2 ? 'wh2' : ''}">
        <div class="fc-head">
          <div class="fc-title">${Utils.esc(warehouseName(wh))}</div>
          <span class="wh-badge ${isWh2 ? 'wh2' : ''}">${Utils.esc(whShort(wh))}</span>
        </div>
        ${fileHtml}
        <div class="fc-actions">
          <button class="btn btn-primary btn-sm" data-import="${wh}">${f ? '🔄 جایگزینی فایل' : '📥 وارد کردن فایل'}</button>
          ${f ? `<button class="btn btn-ghost btn-sm" data-del="${wh}">🗑 حذف فایل</button>` : ''}
        </div>
      </div>`;
    };
    wrap.innerHTML = card(1) + card(2) + `
      <div class="info-note">
        <b>نکته:</b> با وارد کردن فایل جدید برای هر انبار، اطلاعات قبلی همان انبار حذف و داده‌های جدید جایگزین می‌شود.
        فرمت‌های قابل قبول: <b>PDF</b> (متنی یا اسکن‌شده)، <b>Excel</b> (XLSX / XLS) و <b>CSV</b>.
        اگر قیمت فایل به ریال باشد، به‌صورت خودکار به تومان تبدیل می‌شود.
      </div>`;
  }

  $id('files-content').addEventListener('click', (e) => {
    const imp = e.target.closest('[data-import]');
    const del = e.target.closest('[data-del]');
    if (imp) {
      state.import = { step: 'wh', warehouse: Number(imp.dataset.import), file: null, result: null, inputRows: null };
      showScreen('import');
    } else if (del) {
      handleDeleteFile(del.dataset.del);
    }
  });

  async function handleDeleteFile(wh) {
    const f = state.files[wh];
    const res = await showDialog({
      title: 'حذف فایل انبار (' + whShort(wh) + ')',
      message: 'فایل «' + (f ? f.fileName : '') + '» و تمام محصولات آن انبار حذف شود؟',
      buttons: [
        { label: 'انصراف', value: false },
        { label: 'حذف', value: true, kind: 'btn-danger' }
      ]
    });
    if (!res) return;
    const all = await DB.getAllProducts();
    const keep = all.filter((p) => String(p.warehouse) !== String(wh)).concat(CustomProducts.getAllAsProducts());
    await DB.replaceWarehouseProducts(wh, []);
    await DB.deleteFile(wh);
    Searcher.setProducts(keep);
    state.products = keep;
    await loadFiles();
    renderFilesScreen();
    showToast('فایل انبار (' + whShort(wh) + ') حذف شد');
  }

  /* ---------- ویزارد وارد کردن ---------- */

  function renderImportScreen() {
    const wrap = $id('import-content');
    const st = state.import;
    if (st.step === 'wh') {
      wrap.innerHTML = `
        <div class="imp-step">
          <div class="imp-label">کدام انبار؟</div>
          <div class="wh-select-row">
            <button class="wh-select ${st.warehouse === 1 ? 'selected' : ''}" data-wh="1">
              <div class="w-title">${Utils.esc(state.settings.wh1Name)}</div>
            </button>
            <button class="wh-select ${st.warehouse === 2 ? 'selected' : ''}" data-wh="2">
              <div class="w-title">${Utils.esc(state.settings.wh2Name)}</div>
            </button>
          </div>
        </div>
        ${st.warehouse ? `
        <div class="imp-step">
          <div class="imp-label">انتخاب فایل (${Utils.esc(whShort(st.warehouse))})</div>
          <div class="drop-zone" id="drop-zone">
            <div class="dz-icon">📁</div>
            <div class="dz-title">فایل انبار را انتخاب کنید</div>
            <div class="dz-sub">PDF • Excel (XLSX) • CSV — از حافظه گوشی</div>
          </div>
          <div id="file-selected" class="info-note" hidden></div>
        </div>` : ''}
        <div class="info-note" id="imp-hint" ${st.warehouse ? 'hidden' : ''}>
          ابتدا انباری که می‌خواهید فایلش را وارد یا جایگزین کنید انتخاب کنید.<br>
          با وارد کردن فایل جدید، <b>فایل قبلی همان انبار جایگزین</b> می‌شود.
        </div>`;
    } else if (st.step === 'progress') {
      wrap.innerHTML = `
        <div class="progress-box">
          <div class="dz-icon">⏳</div>
          <div class="progress-text" id="imp-progress-text">در حال پردازش…</div>
          <div class="progress-bar"><div id="imp-progress-bar" style="width:5%"></div></div>
        </div>`;
    } else if (st.step === 'preview') {
      const r = st.result;
      const unitLabel = r.detectedUnit === 'rial' ? 'ریال' : 'تومان';
      const sample = r.products.slice(0, 8);
      wrap.innerHTML = `
        <div class="preview-box">
          <div class="pv-row"><span class="lbl">فایل</span><span class="val">${Utils.esc(st.file.name)}</span></div>
          <div class="pv-row"><span class="lbl">تعداد محصول</span><span class="val">${Utils.faNum(r.products.length)}</span></div>
          <div class="pv-row"><span class="lbl">واحد قیمت در فایل</span>
            <span class="unit-radio">
              <label><input type="radio" name="unit" value="toman" ${r.detectedUnit !== 'rial' ? 'checked' : ''}> تومان</label>
              <label><input type="radio" name="unit" value="rial" ${r.detectedUnit === 'rial' ? 'checked' : ''}> ریال</label>
            </span>
          </div>
          <div class="pv-row"><span class="lbl">نحوه نمایش</span><span class="val">همیشه به تومان ${unitLabel === 'ریال' ? '(÷۱۰)' : ''}</span></div>
        </div>
        ${r.warnings && r.warnings.length ? `<div class="warn-list">${r.warnings.slice(0, 6).map((w) => `<div class="warn-item">⚠️ ${Utils.esc(w)}</div>`).join('')}</div>` : ''}
        <div class="preview-box" style="margin-top:12px">
          <div class="pv-row"><span class="lbl">پیش‌نمایش</span></div>
          <div class="pv-table-wrap">
            <table class="pv-table">
              <thead><tr><th>کد کالا</th><th>نام محصول</th><th>موجودی</th><th>قیمت (تومان)</th></tr></thead>
              <tbody>${sample.map((p) => `<tr>
                <td>${Utils.esc(p.code)}</td><td>${Utils.esc(p.name)}</td>
                <td>${p.stock === null ? '—' : Utils.faNum(p.stock)}</td>
                <td>${p.priceToman === null ? '—' : Utils.faNum(p.priceToman)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          ${r.products.length > 8 ? `<div style="color:var(--muted);font-size:11.5px;text-align:center;margin-top:6px">… و ${Utils.faNum(r.products.length - 8)} محصول دیگر</div>` : ''}
        </div>
        <div style="height:12px"></div>
        <button class="btn btn-primary btn-lg" id="imp-confirm">
          ${state.files[st.warehouse] ? '🔄 جایگزینی فایل قبلی (' + whShort(st.warehouse) + ')' : '📥 ذخیره فایل (' + whShort(st.warehouse) + ')'}
        </button>
        <button class="btn btn-ghost btn-lg" id="imp-back" style="margin-top:10px">بازگشت</button>`;
    } else if (st.step === 'ocr') {
      wrap.innerHTML = `
        <div class="preview-box" style="text-align:center">
          <div class="dz-icon">🔍</div>
          <p style="font-weight:700">این فایل PDF اسکن‌شده است (بدون متن دیجیتال)</p>
          <p style="color:var(--muted);font-size:13px;margin:8px 0 14px">
            با خواندن OCR متن از روی تصویر استخراج می‌شود. این کار بسته به تعداد صفحه‌ها چند لحظه تا یک دقیقه طول می‌کشد. دقت OCR به کیفیت تصویر بستگی دارد.
          </p>
          <div class="dialog-btns">
            <button class="btn btn-ghost" id="ocr-cancel">بازگشت</button>
            <button class="btn btn-primary" id="ocr-go">🔎 خواندن با OCR</button>
          </div>
        </div>`;
    }
  }

  $id('import-content').addEventListener('click', async (e) => {
    const st = state.import;
    const whSel = e.target.closest('[data-wh]');
    if (whSel) {
      st.warehouse = Number(whSel.dataset.wh);
      renderImportScreen();
      return;
    }
    const dz = e.target.closest('#drop-zone');
    if (dz) {
      const input = $id('file-input');
      input.value = '';
      input.click();
      return;
    }
    const confirm = e.target.closest('#imp-confirm');
    if (confirm) {
      await confirmImport();
      return;
    }
    const back = e.target.closest('#imp-back');
    if (back) {
      state.import.step = 'wh';
      renderImportScreen();
      return;
    }
    const ocrGo = e.target.closest('#ocr-go');
    if (ocrGo) {
      await runImport(true);
      return;
    }
    const ocrCancel = e.target.closest('#ocr-cancel');
    if (ocrCancel) {
      state.import.step = 'wh';
      renderImportScreen();
      return;
    }
  });

  $id('file-input').addEventListener('change', async () => {
    const input = $id('file-input');
    const file = input.files && input.files[0];
    if (!file) return;
    state.import.file = file;
    await runImport(false);
  });

  $id('import-content').addEventListener('change', async (e) => {
    if (e.target && e.target.name === 'unit' && state.import.step === 'preview') {
      const unit = e.target.value;
      await rebuildImportWithUnit(unit);
    }
  });

  async function rebuildImportWithUnit(unit) {
    const st = state.import;
    st.step = 'progress';
    renderImportScreen();
    await new Promise((r) => setTimeout(r, 30));
    try {
      const table = ParserCore.buildTable(st.inputRows, {
        colMap: st.result.source === 'pdf' ? { code: 0, name: 1, stock: 2, price: 3 } : null,
        priceUnit: unit === 'auto' ? undefined : unit
      });
      st.result = { ...st.result, products: table.products, warnings: table.warnings, detectedUnit: unit };
      st.step = 'preview';
      renderImportScreen();
    } catch (err) {
      showToast('خطا: ' + Backend.faErr(err), 'error');
      st.step = 'preview';
      renderImportScreen();
    }
  }

  /* اجرای پردازش فایل (Excel/CSV/PDF متنی) روی یک Web Worker جدا، تا با
     فایل‌های حجیم رابط کاربری قفل نشود. برای PDF اسکن‌شده (OCR) استفاده
     نمی‌شود — آن مسیر همچنان مستقیم و در رشتهٔ اصلی اجرا می‌شود (پایین). */
  function parseFileInWorker(file, opts, onStatus, onProgress) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker('js/parse-worker.js');
      } catch (e) {
        reject(e);
        return;
      }
      worker.onmessage = (e) => {
        const msg = e.data || {};
        if (msg.type === 'status') { onStatus(msg.message); }
        else if (msg.type === 'progress') { onProgress(msg.done, msg.total); }
        else if (msg.type === 'done') { worker.terminate(); resolve(msg.result); }
        else if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message)); }
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'خطای Worker')); };
      worker.postMessage({ file, opts });
    });
  }

  async function runImport(forceOcr) {
    const st = state.import;
    if (!st.file) return;
    st.step = 'progress';
    renderImportScreen();
    const bar = $id('imp-progress-bar');
    const txt = $id('imp-progress-text');
    const setP = (p) => { if (bar) bar.style.width = Math.max(5, Math.min(100, p)) + '%'; };
    const onStatus = (m) => { if (txt) txt.textContent = m; };
    const onProgress = (done, total) => { setP((done / total) * 85); };
    try {
      const opts = {
        warehouse: st.warehouse,
        priceUnit: state.settings.priceUnit === 'auto' ? undefined : state.settings.priceUnit
      };
      let result;
      if (forceOcr) {
        // مسیر OCR: نیاز به Canvas دارد، پس مستقیم در رشتهٔ اصلی اجرا می‌شود
        result = await FileImporter.parseFile(st.file, { ...opts, forceOcr: true, onStatus, onProgress });
      } else {
        try {
          result = await parseFileInWorker(st.file, opts, onStatus, onProgress);
        } catch (workerErr) {
          // اگر Worker به هر دلیلی در دسترس نبود (مثلاً مرورگر خیلی قدیمی)،
          // به همان روش قبلی (رشتهٔ اصلی) برمی‌گردیم تا کاربر گیر نکند
          result = await FileImporter.parseFile(st.file, { ...opts, forceOcr: false, onStatus, onProgress });
        }
      }
      if (result.needsOcr) {
        st.step = 'ocr';
        renderImportScreen();
        return;
      }
      setP(100);
      st.result = result;
      st.inputRows = result.table && result.table.rawRows ? result.table.rawRows : (result.inputRows || null);
      st.step = 'preview';
      renderImportScreen();
    } catch (err) {
      showToast('خواندن فایل ناموفق بود: ' + Backend.faErr(err), 'error');
      st.step = 'wh';
      renderImportScreen();
    }
  }

  async function confirmImport() {
    const st = state.import;
    const wh = st.warehouse;
    if (!st.result.products.length) {
      await showDialog({
        title: '⚠️ فایل خالی است',
        message: 'هیچ محصولی در فایل «' + st.file.name + '» پیدا نشد. برای جلوگیری از خالی‌شدن ناخواسته‌ی انبار ' + whShort(wh) + '، جایگزینی انجام نمی‌شود. لطفاً فایل درست رو دوباره انتخاب کن.',
        buttons: [{ label: 'باشه', value: true, kind: 'btn-primary' }]
      });
      return;
    }
    const oldFile = state.files[wh];
    const oldName = oldFile ? '«' + oldFile.fileName + '»' : 'فایلی وارد نشده';
    const res = await showDialog({
      title: 'جایگزینی فایل انبار (' + whShort(wh) + ')',
      html: `فایل فعلی: ${Utils.esc(oldName)}<br>فایل جدید: «${Utils.esc(st.file.name)}» با ${Utils.faNum(st.result.products.length)} محصول<br><br>اطلاعات قبلی این انبار حذف و با فایل جدید جایگزین می‌شود. ادامه می‌دهید؟`,
      buttons: [
        { label: 'انصراف', value: false },
        { label: 'جایگزینی', value: true, kind: 'btn-primary' }
      ]
    });
    if (!res) return;
    try {
      const meta = {
        ...st.result.meta,
        warehouse: String(wh),
        unit: st.result.detectedUnit,
        uploadedAt: new Date().toISOString(),
        rowCount: st.result.products.length
      };
      await DB.replaceWarehouseProducts(wh, st.result.products);
      await DB.putFile(meta);
      state.products = await loadAllProductsMerged();
      Searcher.setProducts(state.products);
      await loadFiles();
      showToast('فایل انبار ' + whShort(wh) + ' با موفقیت جایگزین شد ✓', 'success');
      state.import = { step: 'wh', warehouse: null, file: null, result: null, inputRows: null };
      showScreen('files');
    } catch (err) {
      // نمایش متن دقیق خطای Supabase (کد + جزئیات + هینت) — نه فقط پنهان‌کردن
      const msg = err && err.message ? err.message : String(err);
      const code = err && err.code ? err.code : '';
      const details = err && err.details ? err.details : '';
      const hint = err && err.hint ? err.hint : '';
      const detailLines = [msg];
      if (code) detailLines.push('کد: ' + code);
      if (details) detailLines.push('جزئیات: ' + details);
      if (hint) detailLines.push('راهنمای سرور: ' + hint);
      console.error('[import-error]', detailLines.join(' | '));
      if (Backend.isAdmin()) {
        showDialog({
          title: 'خطا در ذخیره فایل انبار',
          html: '<div style="direction:ltr;text-align:left;font-size:12px;line-height:1.8;word-break:break-all;background:#f8fafc;border-radius:10px;padding:10px">' +
            detailLines.map((l) => Utils.esc(l)).join('<br>') + '</div><br>' +
            '<b>راهنمای رفع:</b><br>' +
            '۱) مطمئن شوید اسکریپت <b>supabase/schema.sql</b> (جداول + RLS) در SQL Editor اجرا شده است.<br>' +
            '۲) اگر خطای RLS است، کاربر باید وارد حساب شده باشد (session معتبر).<br>' +
            '۳) اگر خطای «relation does not exist» است، جدول مربوطه ساخته نشده است.<br>' +
            '۴) فایل‌های بزرگ به‌صورت خودکار تکه‌تکه ذخیره می‌شوند.',
          buttons: [{ label: 'باشه', value: true, kind: 'btn-primary' }]
        });
      } else {
        showToast('ذخیره فایل انبار ناموفق بود: ' + Backend.faErr(err), 'error');
      }
      // برگشت به پیش‌نمایش تا کاربر بتواند دوباره تلاش کند
      if (state.import && state.import.step === 'preview') renderImportScreen();
    }
  }

  /* ---------- تنظیمات ---------- */

  function renderSettings() {
    const s = state.settings;
    $id('settings-content').innerHTML = `
      <div class="set-card">
        <div class="set-title">حساب کاربری</div>
        <div class="od-info-row"><span class="lbl">👤 نام</span><span class="val">${Utils.esc(userLabel() || '—')}</span></div>
        <div class="od-info-row"><span class="lbl">📧 ایمیل</span><span class="val" dir="ltr" style="unicode-bidi:embed">${Utils.esc(Backend.isActive() && Backend.getUser() ? Backend.getUser().email : '—')}</span></div>
        <div class="od-info-row"><span class="lbl">نقش</span><span class="val">${Backend.isAdmin() ? (String((Backend.getUser() || {}).email || '').toLowerCase() === '1989alikh1368@gmail.com' ? '👑 صاحب و مدیر اصلی' : 'مدیر') : 'کاربر'}</span></div>
        ${(Backend.isActive() && !Backend.isAdmin()) ? (() => {
          const u = Backend.getUser();
          const planLabels = { trial: 'آزمایشی', basic: 'پایه', pro: 'حرفه\u200cای', business: 'سازمانی' };
          const planLabel = planLabels[u.plan_name] || u.plan_name || '—';
          const expLabel = u.plan_expires_at ? Utils.faDate(u.plan_expires_at) : 'نامحدود';
          return `<div class="od-info-row"><span class="lbl">💳 پلن</span><span class="val">${Utils.esc(planLabel)}</span></div>
          <div class="od-info-row"><span class="lbl">📅 انقضا</span><span class="val">${Utils.esc(expLabel)}</span></div>`;
        })() : ''}
        ${Backend.isActive() ? `<div class="btn-row" style="margin-top:10px">
          ${Backend.isAdmin() ? '<button class="btn btn-primary btn-sm" id="set-admin" style="flex:1">🛡 مدیریت کاربران</button>' : '<button class="btn btn-primary btn-sm" id="set-sub" style="flex:1">💳 اشتراک من</button>'}
          <button class="btn btn-ghost btn-sm" id="set-logout" style="flex:1">خروج از حساب</button>
        </div>` : ''}
      </div>

      <div class="set-card">
        <div class="set-title">سایر</div>
        <button class="btn btn-ghost btn-sm" id="set-support" style="width:100%;margin-bottom:8px">💬 پشتیبانی</button>
<button class="btn btn-danger btn-sm" id="set-wipe" style="width:100%">🗑 پاک کردن داده‌های من</button>
      </div>

      <div class="about-line">Yane — نسخه ۱٫۳${Backend.isActive() ? ' • سیستم حساب کاربری' : ''}<br>${Backend.isActive() ? 'اطلاعات شما بهصورت امن در سرور ذخیره می‌شود' : 'بدون نیاز به اینترنت • داده‌ها روی گوشی ذخیره می‌شود'}</div>`;

    const setSub = $id('set-sub');
    if (setSub) setSub.onclick = () => showScreen('subscription');
    const setAdmin = $id('set-admin');
    if (setAdmin) setAdmin.onclick = () => showScreen('admin');
    const setSupport = $id('set-support');
      if (setSupport) setSupport.onclick = () => showScreen('support');
      const setLogout = $id('set-logout');
    if (setLogout) setLogout.onclick = handleLogout;
    $id('set-wipe').onclick = async () => {
      const wipeTitle = Backend.isActive() ? 'پاک کردن داده‌های حساب من' : 'پاک کردن همه داده‌ها';
      const wipeMsg = Backend.isActive()
        ? 'همه سفارش‌ها، محصولات دستی (کد اختیاری) و تنظیمات حساب شما حذف می‌شود (فایل انبار مشترک باقی می‌ماند). مطمئن هستید؟'
        : 'همه محصولات، فایل‌ها، محصولات دستی (کد اختیاری) و سفارش‌ها از گوشی حذف می‌شود. مطمئن هستید؟';
      const r1 = await showDialog({
        title: wipeTitle,
        message: wipeMsg,
        buttons: [
          { label: 'انصراف', value: false },
          { label: 'ادامه', value: true, kind: 'btn-danger' }
        ]
      });
      if (!r1) return;
      const r2 = await showDialog({
        title: 'تأیید نهایی',
        message: 'این عمل قابل بازگشت نیست. داده‌ها برای همیشه پاک شود؟',
        buttons: [
          { label: 'انصراف', value: false },
          { label: 'بله، پاک کن', value: true, kind: 'btn-danger' }
        ]
      });
      if (!r2) return;
      await DB.wipeAll();
      state.products = [];
      state.orders = [];
      state.files = { 1: null, 2: null };
      state.settings = { priceUnit: 'rial', wh1Name: 'انبار ۱', wh2Name: 'انبار ۲' };
      Searcher.setProducts([]);
      await Aliases.init();
      Searcher.setAliases(Aliases.getAll());
      await PackSize.init();
      await CustomProducts.removeAll();
      await OrderManager.init();
      showToast('همه داده‌ها پاک شد', 'success');
      showScreen('home');
    };
  }

  /* ---------- رویدادهای سراسری ---------- */

  function wireGlobalEvents() {
    /* با لمس هر کادر متن/عدد، مکان‌نما دقیقاً بعد از آخرین حرف یا عدد می‌نشیند */
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      const ok = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|tel|url|email|password)$/.test(el.type));
      if (!ok || el.readOnly || el.disabled) return;
      const toEnd = () => { try { const n = el.value.length; el.setSelectionRange(n, n); } catch (x) { /* بی‌اثر */ } };
      toEnd(); setTimeout(toEnd, 0); setTimeout(toEnd, 60);
    });
    // دکمه‌های صفحه اصلی
    document.querySelector('.home-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-action]');
      if (!card) return;
      const action = card.dataset.action;
      if (action === 'search') {
        state.searchQuery = '';
        state.whFilter = 'all';
        showScreen('products');
        setTimeout(() => { $id('prod-search').focus(); }, 120);
      } else if (action === 'warehouse') {
        state.searchQuery = '';
        state.whFilter = 'all';
        showScreen('products');
      } else if (action === 'converter') {
        showScreen('converter');
      } else if (action === 'quick-note') {
        showScreen('quick-note');
      } else if (action === 'deals') {
        showScreen('deals');
      } else if (action === 'card-views') {
        showScreen('card-views');
      } else if (action === 'listings') {
        showScreen('listings');
      } else if (action === 'collab') {
        showScreen('collab');
      } else if (action === 'ad') {
        AdBuilder.reset();
        showScreen('ad');
      } else if (action === 'clients') {
        showScreen('clients');
      } else if (action === 'estelam') {
        showScreen('estelam');
      } else if (action === 'suggest-names') {
        showScreen('suggest-names');
      } else if (action === 'product-attrs') {
        showScreen('product-attrs');
      } else if (action === 'order') {
        showScreen('order');
      } else if (action === 'orders') {
        showScreen('orders');
      } else if (action === 'archive') {
        state.archiveQuery = '';
        showScreen('archive');
      } else if (action === 'target-pharmacies') {
        showScreen('target-pharmacies');
      } else if (action === 'weekly-visits') {
        showScreen('weekly-visits');
      } else if (action === 'files') {
        showScreen('files');
      } else if (action === 'settings') {
        showScreen('settings');
      }
    });

    // جستجوی صفحه اصلی
    const homeSearch = $id('home-search');
    homeSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.searchQuery = homeSearch.value;
        state.whFilter = 'all';
        showScreen('products');
      }
    });
    homeSearch.addEventListener('search', () => {
      if (document.activeElement === homeSearch && homeSearch.value === '') {
        state.searchQuery = '';
        showScreen('products');
      }
    });

    // جستجوی صفحه محصولات
    const prodSearch = $id('prod-search');
    prodSearch.addEventListener('input', Utils.debounce(() => {
      state.searchQuery = prodSearch.value;
      renderResults();
    }, 140));

    // چیپ انبار
    $id('wh-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        state.whFilter = chip.dataset.wh;
        syncChips();
        renderResults();
      }
    });

    // افزودن از جدول
    $id('prod-tbody').addEventListener('click', (e) => {
      const atTag = e.target.closest('[data-at-open]');
      if (atTag) { openAttrEditSheet(atTag.dataset.atOpen); return; } // لمس برچسب نتیجه ← ویرایش مشخصه‌های همان محصول
      const aliasBtn = e.target.closest('[data-alias-manage]');
      if (aliasBtn) {
        const p = findProductByWhKey(aliasBtn.dataset.aliasManage);
        if (p) openAliasSheet(p);
        return;
      }
      const snBtn = e.target.closest('[data-sn-view]');
      if (snBtn) {
        const p = findProductByWhKey(snBtn.dataset.snView);
        if (p) showSheet({
          title: '🏷 اسم‌های پیشنهادی',
          html: `<div class="pc-name" style="margin-bottom:8px">${Utils.esc(p.name)}</div><div>${(suggestNamesMap[String(p.code)] || []).map((n) => `<span class="pc-tag pc-alias">${Utils.esc(n)}</span>`).join(' ')}</div><div class="dialog-btns" style="margin-top:12px"><button class="btn btn-ghost" id="snv-close" style="flex:1">بستن</button></div>`,
          onMount(body, close) { body.querySelector('#snv-close').onclick = close; }
        });
        return;
      }
      const pkszBtn = e.target.closest('[data-packsize-manage]');
      if (pkszBtn) {
        const p = findProductByWhKey(pkszBtn.dataset.packsizeManage);
        if (p) openPackSizeSheet(p);
        return;
      }
      const btn = e.target.closest('[data-add]');
      if (btn) {
        const p = findProductByWhKey(btn.dataset.add);
        if (p) {
          if (state.editAddMode && state.edit && state.edit.orderId) openQtySheet(p, (prod, n, offer) => addEditProduct(prod, n, offer));
          else openQtySheet(p);
        }
        return;
      }
      const jorChk = e.target.closest('[data-jor-toggle]');
      if (jorChk) {
        const whKey = jorChk.dataset.jorToggle;
        if (jorChk.checked) {
          const p = findProductByWhKey(whKey);
          if (p) state.jorSelection.set(whKey, { product: p });
        } else {
          state.jorSelection.delete(whKey);
        }
        updateJorFab();
      }
    });

    // دکمه شناور سبد
    $id('cart-fab').addEventListener('click', () => openQuickCartSheet());

    // فیلدهای اطلاعات سفارش — ذخیره خودکار در پیش‌نویس
    const oiMap = {
      'oi-visitor': 'visitorName',
      'oi-pharmacy': 'pharmacyName',
      'oi-address': 'pharmacyAddress',
      'oi-area': 'pharmacyArea',
      'oi-phone': 'pharmacyPhone',
      'oi-note': 'note',
      'oi-offer': 'offer'
    };
    Object.keys(oiMap).forEach((id) => {
      const el = $id(id);
      if (el) el.addEventListener('input', () => {
        const info = OrderManager.getCartInfo();
        info[oiMap[id]] = el.value;
        OrderManager.setCartInfo(info);
      });
    });

    // جستجوی آرشیو داروخانه‌ها
    $id('arch-search').addEventListener('input', Utils.debounce(() => {
      state.archiveQuery = $id('arch-search').value;
      renderArchive();
    }, 140));
  }

  /* ---------- سرویس‌ورکر ---------- */

  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  /* ---------- راه‌اندازی ---------- */

  /* هشدار مشکلات دیتابیس/اتصال — فقط یک‌بار تا شلوغ نشود */
  let dbIssueNotified = false;
  function notifyDbIssue(e) {
    if (dbIssueNotified) return;
    dbIssueNotified = true;
    const msg = String(e && e.message ? e.message : e);
    console.error('[db]', msg);
    const shown = Backend.isAdmin() ? msg : Backend.faErr(e);
    showToast('خطای دیتابیس: ' + shown + (Backend.isActive() && Backend.isAdmin() ? ' — مطمئن شوید اسکریپت supabase/schema.sql در Supabase اجرا شده است.' : ''), 'error');
    Backend.logError('db-init', e, state.screen).catch(() => {});
  }

  /* هر تابع زیر مستقلاً خطای خودش را می‌گیرد (مثل قبل) تا اگر یکی
     شکست بخورد، بقیه و مهم‌تر از همه نمایش صفحه متوقف نشود. تنها
     تفاوت با قبل این است که این توابع حالا موازی اجرا می‌شوند، نه
     پشت‌سرهم — به‌جز جایی که وابستگی واقعی وجود دارد (زیر initApp
     توضیح داده شده). */

  async function loadSettingsTask() {
    try {
      const settingsArr = await DB.getAllSettings();
      settingsArr.forEach((s) => {
        if (s.key === 'priceUnit') state.settings.priceUnit = s.value;
        if (s.key === 'wh1Name') state.settings.wh1Name = s.value;
        if (s.key === 'wh2Name') state.settings.wh2Name = s.value;
      });
    } catch (e) { notifyDbIssue(e); }
  }

  async function loadOrderManagerTask() {
    try { await OrderManager.init(); } catch (e) { notifyDbIssue(e); }
  }

  async function loadCustomProductsTask() {
    try { await CustomProducts.init(); } catch (e) { notifyDbIssue(e); }
  }

  async function loadFilesTask() {
    try { await loadFiles(); } catch (e) { state.files = { 1: null, 2: null }; notifyDbIssue(e); }
  }

  async function loadOrdersTask() {
    try { await loadOrders(); } catch (e) { state.orders = []; notifyDbIssue(e); }
  }

  async function runMigrationTask() {
    try { await runLegacyAliasPackMigration(); } catch (e) { notifyDbIssue(e); }
  }

  async function loadAliasesTask() {
    try {
      await Aliases.init();
      await AliasSeed.run();
    } catch (e) { notifyDbIssue(e); }
  }

  async function loadPackSizeTask() {
    try {
      await PackSize.init();
      await runPackSizeSeed();
    } catch (e) { notifyDbIssue(e); }
  }

  async function initApp() {
    try {
      await DB.open();
    } catch (e) {
      showToast('دیتابیس گوشی در دسترس نیست', 'error');
      return;
    }

    /* گروه ۱ — کاملاً مستقل از هم، موازی اجرا می‌شوند. شامل migration هم
       هست چون migration به هیچ‌کدام از این‌ها وابسته نیست؛ فقط قبل از
       گروه ۲ (زیر) باید تمام شده باشد که همینجا با await تضمین می‌شود. */
    const crmOnly = !!(window.APP_CONFIG && window.APP_CONFIG.crmOnly);   // نسخه‌ی CRM: جدول‌های انبار/سفارش وجود ندارند
    if (!crmOnly) await Promise.all([
      loadSettingsTask(),
      loadOrderManagerTask(),
      loadCustomProductsTask(),
      loadFilesTask(),
      loadOrdersTask(),
      runMigrationTask()
    ]);

    /* گروه ۲ — نام‌های مستعار و پک‌ها، هر دو باید بعد از migration بالا
       اجرا شوند (وابستگی واقعی، حفظ شده)، ولی به هم وابسته نیستند. */
    if (!crmOnly) await Promise.all([
      loadAliasesTask(),
      loadPackSizeTask()
    ]);
    if (!crmOnly) Searcher.setAliases(Aliases.getAll());

    /* گروه ۳ — به CustomProducts.init() (در گروه ۱ بالا) وابسته است. */
    try {
      state.products = crmOnly ? [] : await loadAllProductsMerged();
    } catch (e) { state.products = []; notifyDbIssue(e); }
    Searcher.setProducts(state.products);
    if (!crmOnly) {
      Searcher.setAliases(Aliases.getAll());
      await loadAttrsTask();        // مشخصه‌های محصول (خطا بی‌صدا)
      await loadSuggestNamesTask(); // اسم‌های پیشنهادی (فقط خواندن از دیتابیس؛ خطا بقیه‌ی اپ را متوقف نمی‌کند)
      await loadProductTagsTask();  // برند/دسته (همین‌طور؛ خطا بی‌صدا)

      autoSyncPendingOrders();
      if (Backend.isActive() && !Backend.isOffline()) Backend.purgeOldTrash().catch(() => {});
    }

    // اتصال رویدادها و نمایش صفحه — همیشه اجرا می‌شود
    wireGlobalEvents();
    showScreen('home'); // نمایش صفحه اصلی (بعد از ورود / حالت محلی)
    updateTopbarUser();
    CardAlert.start();   // اعلان لحظه‌ای «مشتری می‌خواهد ملک را ببیند»
    PayAlert.start();    // مدیر: درخواست‌های پرداخت در انتظار تایید

    // سبد سفارش قبلیِ ذخیره‌شده ولی هنوز ثبت‌نشده — به کاربر اطلاع بده
    // تا فراموش نکند و سبدش گم نشود
    try {
      if (!crmOnly && OrderManager.cartItemCount() > 0) {
        const total = OrderManager.cartTotal();
        const choice = await showDialog({
          title: '🛒 سبد سفارش قبلی',
          message: 'یک سبد سفارشِ ذخیره‌شده و هنوز ثبت‌نشده با ' + Utils.faNum(OrderManager.cartItemCount()) + ' قلم به مبلغ ' + Utils.formatMoney(total) + ' پیدا شد.',
          buttons: [
            { label: 'حذف سبد', value: 'delete', kind: 'btn-danger' },
            { label: 'ادامهٔ سبد', value: 'continue', kind: 'btn-ghost' },
            { label: 'ثبت به‌عنوان سفارش', value: 'submit', kind: 'btn-primary' }
          ]
        });
        if (choice === 'delete') {
          await OrderManager.clearCart();
          showToast('سبد قبلی حذف شد');
        } else if (choice === 'submit') {
          try {
            const order = await OrderManager.saveOrder(OrderManager.getCartInfo());
            state.orders.unshift(order);
            showToast('سفارش شماره ' + Utils.faNum(order.no) + (order.pendingSync ? ' فقط روی این گوشی ذخیره شد ⚠️' : ' ثبت شد ✓'), order.pendingSync ? 'error' : 'success');
            if (order.pendingSync) await showOfflineSaveNotice(order);
            showScreen('order-detail', { order });
          } catch (err) {
            showToast('خطا در ثبت سفارش: ' + Backend.faErr(err), 'error');
          }
        } else {
          showScreen('order');
        }
      }
    } catch (e) { /* بی‌اثر */ }

    // در اولین اجرا، راهنمای کوچک (در حالت حساب کاربری نمایش داده نمی‌شود)
    try {
      if (crmOnly) return;
      const seen = await DB.getSetting('welcomeSeen', false);
      if (!Backend.isActive() && !seen && state.products.length === 0) {
        await DB.setSetting('welcomeSeen', true);
        showDialog({
          title: 'خوش آمدید 👋',
          message: 'این اپ برای مدیریت انبار و ثبت سفارش است.\nبرای شروع، از «مدیریت فایل‌های انبار» فایل انبار خود را وارد کنید.' + (Backend.isActive() ? '' : ' همه‌چیز روی گوشی شما ذخیره می‌شود و بدون اینترنت کار می‌کند.'),
          buttons: [{ label: 'شروع', value: true, kind: 'btn-primary' }]
        });
      }
    } catch (e) { /* بی‌اثر */ }
  }

  async function init() {
    // ثبت سرویس‌ورکر همین اول کار — مستقل از وضعیت شبکه یا Backend،
    // تا کش همیشه در اسرع وقت آماده شود (نه در انتهای initApp()).
    registerSW();
    if (window.APP_CONFIG && window.APP_CONFIG.crmOnly) document.body.classList.add('crm-only');
    // خطاهای پیش‌بینی‌نشده را ثبت کن (بدون تغییر رابط کاربری)
    window.addEventListener('unhandledrejection', (ev) => {
      console.error('Unhandled rejection:', ev && ev.reason);
    });
    window.addEventListener('error', (ev) => {
      console.error('Global error:', ev && ev.message);
    });
    // راه‌اندازی لایه Backend (سیستم حساب کاربری)
    const bk = await Backend.init();
    Backend.touchLastSeen();
    if (typeof DailyPlan !== 'undefined') DailyPlan.syncReminders();
    // برنامه فقط آنلاین کار می‌کند: بدون ارتباط با سرور، فقط صفحه‌ی «اینترنت قطع است» و دیگر هیچ
    startConnectionWatch(!!bk.offline);
    if (bk.offline) {
      showOfflineScreen();
      return;
    }
    if (bk.needsSetup) {
      // در نسخه Deploy اگر پیکربندی ناقص باشد، صفحه راه‌اندازی نمایش داده می‌شود
      showSetupScreen(bk.error || '');
      wireSetupButtons();
      return;
    }
    if (bk.active) {
      if (!bk.user) {
        // Backend فعال ولی کاربر وارد نشده → نمایش صفحه ورود
        showLoginScreen();
        const loginBtn = $id('login-submit');
        const regBtn = $id('register-submit');
        if (loginBtn) loginBtn.onclick = handleLogin;
        if (regBtn) regBtn.onclick = handleRegister;
        wireLoginUi();
        return;
      }
      hideLoginScreen();
      // بررسی اشتراک: مدیر همیشه عبور می‌کند؛ بقیه اگر منقضی/تعلیق باشند مسدود می‌شوند
      const sub = Backend.subscriptionStatus();
      if (!sub.active) {
        showExpiredScreen(sub);
        return;
      }
    }
    await initApp();
  }

  /* ---------- دکمه «نصب برنامه» (PWA) — فقط داخل صفحه ورود ---------- */
  let deferredInstallPrompt = null;
  function isStandalone() {
    return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isStandalone()) return;
    deferredInstallPrompt = e;
    const btn = $id('install-fab');
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    const btn = $id('install-fab');
    if (btn) btn.hidden = true;
    deferredInstallPrompt = null;
  });
  /* آیفون/آیپد: مرورگرها دکمه‌ی نصب خودکار ندارند؛ آموزش «افزودن به صفحه‌ی اصلی» را خود اپ نشان می‌دهد */
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  }
  function showIosInstallGuide() {
    const inSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(navigator.userAgent || '');
    const warn = inSafari ? '' : '<p style="color:#b91c1c;font-weight:700;margin-bottom:8px">این صفحه را در مرورگر Safari باز کن؛ در این مرورگر نصب ممکن نیست.</p>';
    showDialog({
      title: 'نصب روی آیفون', icon: 'info',
      html: warn + '<ol style="padding-right:18px;line-height:2;text-align:right"><li>دکمه‌ی <b>Share</b> (مربع با فلش رو به بالا، پایین Safari) را بزن.</li><li>گزینه‌ی <b>Add to Home Screen</b> را بزن.</li><li>روی <b>Add</b> بزن.</li><li>از این به بعد اپ را از <b>آیکن صفحه‌ی اصلی</b> باز کن.</li></ol>',
      buttons: [{ label: 'متوجه شدم', kind: 'btn-primary', value: true }]
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    const dl = $id('lg-dl');
    if (dl && !isStandalone() && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) dl.hidden = false;
    const btn = $id('install-fab');
    if (!btn) return;
    if (isIOS() && !isStandalone()) btn.hidden = false;
    btn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) { if (isIOS()) showIosInstallGuide(); return; }
      btn.hidden = true;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    });
  });

  /* ---------- گیر انداختن خطاهای عمومی و ناگهانی ----------
     هر خطای مدیریت‌نشدهٔ JS یا Promise رد شده، به سرور لاگ می‌شه (اگه
     کاربر لاگین باشه) تا مدیر بدون نیاز به گزارش دستی کاربر، خبردار بشه. */
  window.addEventListener('error', (e) => {
    try { Backend.logError('window-error', e.error || e.message, state.screen).catch(() => {}); } catch (er) { /* بی‌اثر */ }
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { Backend.logError('unhandled-rejection', e.reason, state.screen).catch(() => {}); } catch (er) { /* بی‌اثر */ }
  });

  document.addEventListener('DOMContentLoaded', init);

  return { warehouseName, whShort, showToast };
})();

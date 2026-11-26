'use strict';
/* ============================================================
   لایه Backend — سیستم حساب کاربری با Supabase
   ------------------------------------------------------------
   • احراز هویت (ورود / ساخت حساب / خروج)
   • جداسازی کامل اطلاعات هر کاربر در سمت سرور
     (Row Level Security در Postgres — نه فقط در ظاهر برنامه)
   • فایل‌ها و محصولات انبار: مشترک بین همه کاربران
   • سفارش‌ها / پک‌ها / تنظیمات / سبد: اختصاصی هر کاربر
   • حساب مدیر (Admin) با دسترسی مدیریت
   ============================================================ */

const Backend = (() => {
  let supabase = null;
  let currentUser = null; // { id, email, full_name, role }
  let mode = 'local';     // 'local' | 'backend'
  let offlineMode = false; // true وقتی ارتباط با سرور برقرار نیست (برنامه فقط آنلاین کار می‌کند؛ ورود یا داده‌ی آفلاین وجود ندارد)

  // کلید قدیمیِ هویت کش‌شده؛ فقط برای پاک‌سازی از گوشی‌هایی که نسخه‌ی قبلی را داشته‌اند
  const LEGACY_CACHED_USER_KEY = 'anbar-cached-user';

  function cfg() { return (window.APP_CONFIG || {}); }

  function isActive() { return mode === 'backend'; }
  function isOffline() { return offlineMode; }

  /* بازبینی زنده‌ی اتصال به سرور؛ پرچم آفلاین را بر اساس نتیجه تنظیم می‌کند. */
  async function recheckConnection() {
    if (!isActive()) return false;
    const ok = await serverReachable();
    offlineMode = !ok;
    return ok;
  }

  /* علامت‌گذاری فوری قطع اتصال — وقتی مرورگر رویداد واقعی قطع‌شدن شبکه را می‌دهد. */
  function forceOfflineMode() { if (isActive()) offlineMode = true; }

  function getUser() { return currentUser; }

  /* آیا سرور واقعاً در دسترس است؟ (navigator.onLine با وای‌فایِ بدون اینترنت هم true می‌ماند)
     هر پاسخ HTTP یعنی در دسترس؛ فقط خطای شبکه/تایم‌اوت یعنی قطع. */
  async function serverReachable() {
    try {
      const c = cfg();
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      try {
        await fetch(String(c.supabaseUrl).replace(/\/+$/, '') + '/auth/v1/health', { headers: { apikey: c.supabaseAnonKey }, signal: ctl.signal, cache: 'no-store' });
      } finally { clearTimeout(t); }
      return true;
    } catch (e) { return false; }
  }

  async function init() {
    const c = cfg();
    if (!c.backendEnabled) {
      mode = 'local';
      return { active: false, local: true };
    }
    if (!c.supabaseUrl || !c.supabaseAnonKey) {
      mode = 'local';
      return { active: false, needsSetup: true, error: 'پیکربندی Supabase کامل نیست.' };
    }
    if (!/^https:\/\/[\w.-]+\.supabase\.co/.test(c.supabaseUrl)) {
      mode = 'local';
      return { active: false, needsSetup: true, error: 'آدرس Supabase معتبر نیست. باید به شکل https://XXXX.supabase.co باشد.' };
    }
    if (!window.supabase) {
      mode = 'local';
      return { active: false, needsSetup: true, error: 'کتابخانه Supabase در دسترس نیست.' };
    }
    try { localStorage.removeItem(LEGACY_CACHED_USER_KEY); } catch (e) { /* بی‌اثر */ }
    try {
      supabase = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
      mode = 'backend';
      // برنامه فقط آنلاین کار می‌کند: بدون ارتباط با سرور نه ورودی هست و نه هویت کش‌شده‌ای
      if (navigator.onLine === false || !(await serverReachable())) {
        offlineMode = true;
        currentUser = null;
        return { active: true, user: null, offline: true };
      }
      offlineMode = false;
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        // نشست‌های قدیمی (قبل از این قفل) یا حساب‌بدون‌شرکت/شرکت‌غیرفعال: خروج و ورود مجدد با کد شرکت
        let member = !!c.crmOnly;   // نسخه‌ی مستقل: عضویت شرکت لازم نیست
        if (!c.crmOnly && isCompanyOk(session.user.id)) {
          const { data: ok, error: mErr } = await supabase.rpc('my_company_ok');
          if (mErr) throw mErr; // خطای شبکه → مسیر catch
          member = ok === true;
        }
        if (!member) {
          try { await supabase.auth.signOut(); } catch (e) { /* بی‌اثر */ }
          clearCompanyOk();
          return { active: true, user: null };
        }
        await loadProfile(session.user);
        return { active: true, user: currentUser };
      }
      return { active: true, user: null };
    } catch (e) {
      // قطع ارتباط حین راه‌اندازی → صفحه‌ی «اینترنت قطع است» (نه ورود، نه صفحه‌ی راه‌اندازی)
      if (navigator.onLine === false || !(await serverReachable())) {
        mode = 'backend';
        offlineMode = true;
        currentUser = null;
        return { active: true, user: null, offline: true };
      }
      mode = 'local';
      return { active: false, needsSetup: true, error: e.message };
    }
  }

  async function fetchProfileRow(userId) {
    const { data, error } = await supabase.from('profiles')
      .select('full_name, role, plan_name, plan_status, plan_expires_at, company_name')
      .eq('id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function applyProfileRow(u, data) {
    u.full_name = data.full_name || u.full_name;
    u.role = data.role || 'user';
    u.plan_name = data.plan_name || 'trial';
    u.plan_status = data.plan_status || 'active';
    u.plan_expires_at = data.plan_expires_at || null;
    u.company_name = data.company_name || '';
  }

  /* profileSource: 'server' = از سرور خوانده شد | 'default' = ردیف پروفایل وجود ندارد (وضعیت اشتراک نامشخص است، ورود مسدود نمی‌شود) */
  async function loadProfile(user) {
    currentUser = {
      id: user.id,
      email: user.email || '',
      full_name: (user.user_metadata && user.user_metadata.full_name) || '',
      role: 'user',
      plan_name: 'trial',
      plan_status: 'active',
      plan_expires_at: null,
      company_name: '',
      profileSource: 'default'
    };
    let row = null;
    // خطای شبکه/سرور در خواندن پروفایل بالا می‌رود (init آن را «آفلاین» می‌داند)؛
    // وضعیت اشتراک فقط از سرور تعیین می‌شود و جایی ذخیره نمی‌شود
    row = await fetchProfileRow(user.id);
    if (row) {
      applyProfileRow(currentUser, row);
      currentUser.profileSource = 'server';
      return currentUser;
    }
    // ردیف پروفایل هنوز ساخته نشده: خطا ثبت می‌شود و ورود مسدود نمی‌شود
    try { logError('profile-load', new Error('profile row not found'), 'auth').catch(() => {}); } catch (e) { /* لاگ نباید ورود را خراب کند */ }
    return currentUser;
  }

  /* اگر پروفایل هنگام ورود خوانده نشده بود، بعداً دوباره تلاش می‌شود. خروجی true یعنی الان از سرور تأیید شد */
  async function refreshProfileIfUnverified() {
    if (!supabase || !currentUser || offlineMode) return false;
    if (currentUser.profileSource !== 'default') return false;
    try {
      const row = await fetchProfileRow(currentUser.id);
      if (!row) return false;
      applyProfileRow(currentUser, row);
      currentUser.profileSource = 'server';
      return true;
    } catch (e) { return false; } // خطای اولیه قبلاً ثبت شده؛ هر ۶۰ ثانیه لاگ تکراری نمی‌سازیم
  }

  function subscriptionStatus() {
    if (!currentUser) return { active: false, reason: 'no-user' };
    if (currentUser.role === 'admin') return { active: true, isAdmin: true };
    // ردیف پروفایل وجود ندارد: ورود مسدود نمی‌شود ولی «فعالِ تأییدشده» هم نیست
    if (currentUser.profileSource === 'default') return { active: true, unverified: true };
    if (currentUser.plan_status === 'suspended') return { active: false, reason: 'suspended' };
    if (currentUser.plan_expires_at) {
      const exp = new Date(currentUser.plan_expires_at).getTime();
      if (!isNaN(exp) && exp < Date.now()) return { active: false, reason: 'expired', expiredAt: currentUser.plan_expires_at };
    }
    return { active: true };
  }

  const COMPANY_OK_KEY = 'tamis-company-ok';
  function markCompanyOk(userId) { try { localStorage.setItem(COMPANY_OK_KEY, userId); } catch (e) { /* بی‌اثر */ } }
  function isCompanyOk(userId) { try { return localStorage.getItem(COMPANY_OK_KEY) === userId; } catch (e) { return false; } }
  function clearCompanyOk() { try { localStorage.removeItem(COMPANY_OK_KEY); } catch (e) { /* بی‌اثر */ } }

  async function signIn(email, password, companyCode) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    if (cfg().crmOnly) { await loadProfile(data.user); return currentUser; }
    // تطبیق کد شرکت با شرکت ثبت‌شده‌ی همین کاربر (سمت سرور؛ مدیر معاف است)
    const { data: ok, error: rpcErr } = await supabase.rpc('check_login_company', { p_code: (companyCode || '').trim() });
    if (rpcErr || ok !== true) {
      try { await supabase.auth.signOut(); } catch (e) { /* بی‌اثر */ }
      clearCompanyOk();
      if (rpcErr) throw new Error('بررسی کد شرکت ممکن نشد. اتصال اینترنت را بررسی کنید.');
      throw new Error((companyCode || '').trim() ? 'کد شرکت اشتباه است.' : 'کد شرکت را وارد کنید.');
    }
    markCompanyOk(data.user.id);
    await loadProfile(data.user);
    return currentUser;
  }

  async function signUp(fullName, email, password, companyCode) {
    if (cfg().crmOnly) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw new Error(error.message);
      if (data && data.session && data.session.user) { await loadProfile(data.session.user); return { user: currentUser, needsConfirm: false }; }
      return { user: null, needsConfirm: true };
    }
    const code = (companyCode || '').trim();
    if (!code) throw new Error('کد شرکت را وارد کنید.');
    // پیش‌بررسی فقط برای پیام خطای سریع و خوانا به کاربر است.
    // اعتبارسنجی اصلی و غیرقابل‌دورزدن در تریگر handle_new_user سمت سرور انجام می‌شود
    // (migration: 20260930_enforce_company_code_server_side.sql).
    // خروجی RPC هرچه باشد (UUID تکی / آرایه‌ی ردیف‌ها / آبجکت / null) نرمال می‌شود:
    const { data: preCheck, error: rpcErr } = await supabase.rpc('verify_company_code', { p_code: code });
    if (rpcErr) throw new Error('بررسی کد شرکت ممکن نشد. اتصال اینترنت را بررسی کنید.');
    let found = preCheck;
    if (Array.isArray(found)) found = found.length ? found[0] : null;
    if (found && typeof found === 'object') found = found.company_id || null;
    if (!found) throw new Error('کد شرکت نامعتبر است.');
    // فقط متن کد فرستاده می‌شود؛ سرور خودش آن را با جدول companies تطبیق می‌دهد.
    // (company_id از کلاینت دیگر پذیرفته نمی‌شود تا جعل‌شدنی نباشد.)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, company_code: code } }
    });
    if (error) throw new Error(error.message);
    if (data && data.session && data.session.user) {
      markCompanyOk(data.session.user.id); // کد شرکت همین الان توسط تریگر سرور تأیید شده
      await loadProfile(data.session.user);
      return { user: currentUser, needsConfirm: false };
    }
    return { user: null, needsConfirm: true };
  }

  async function logError(context, err, screen) {
    try {
      if (!supabase || !currentUser) return;
      await supabase.from('error_logs').insert({
        user_id: currentUser.id,
        context: String(context || '').slice(0, 200),
        message: String((err && err.message) || err || '').slice(0, 1000),
        stack: err && err.stack ? String(err.stack).slice(0, 3000) : null,
        screen: screen || null,
        app_version: (window.APP_CONFIG && window.APP_CONFIG.version) || null
      });
    } catch (e) { /* بی‌اثر — لاگ‌گیری هرگز نباید خودش باعث خطای جدید بشه */ }
  }

  async function adminGetErrorLogs(limit) {
    const { data, error } = await supabase.from('error_logs')
      .select('id, user_id, context, message, stack, screen, created_at')
      .order('created_at', { ascending: false })
      .limit(limit || 100);
    if (error) throw error;
    return data || [];
  }

  async function adminClearErrorLogs() {
    const { error } = await supabase.from('error_logs').delete().gte('id', 0);
    if (error) throw error;
  }

  
  async function signOut() {
    try { unsubscribeCardEvents(); } catch (e) { /* بی‌اثر */ }
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    offlineMode = false;
    try { localStorage.removeItem(LEGACY_CACHED_USER_KEY); } catch (e) { /* بی‌اثر */ }
    clearCompanyOk();
  }

  function uid() { return currentUser ? currentUser.id : null; }

  function isAdmin() { return currentUser && currentUser.role === 'admin'; }

  function faErr(e) {
    const m = String(e && e.message ? e.message : e);
    if (/invalid login credentials/i.test(m)) return 'ایمیل یا رمز عبور اشتباه است.';
    if (/already registered/i.test(m)) return 'این ایمیل قبلاً ثبت شده است.';
    if (/^\s*همکاری:/.test(m)) return m.replace(/^\s*همکاری:\s*/, ''); // پیام خودمان از تابع‌های تعامل
    if (/کد شرکت/i.test(m)) return m; // پیام خودمان از Trigger سمت سرور — همان‌طور نمایش داده شود
    if (/database error saving new user|unexpected_failure/i.test(m)) return 'کد شرکت نامعتبر یا غیرفعال است، یا خطایی در ساخت حساب رخ داد.';
    if (/password should be at least/i.test(m)) return 'رمز عبور باید حداقل ۶ کاراکتر باشد.';
    if (/valid email/i.test(m)) return 'ایمیل معتبر نیست.';
    if (/network|fetch|failed to fetch/i.test(m)) return 'اتصال به اینترنت برقرار نیست.';
    if (/jwt expired|invalid jwt|session.*expired|refresh_token/i.test(m)) return 'نشست شما منقضی شده، دوباره وارد شوید.';
    if (/duplicate key|unique constraint/i.test(m)) return 'این مورد قبلاً ثبت شده است.';
    if (/permission denied|row-level security|rls/i.test(m)) return 'دسترسی به این عملیات مجاز نیست.';
    if (/violates foreign key/i.test(m)) return 'این مورد به رکورد دیگری وابسته است و قابل انجام نیست.';
    if (/timeout|timed out/i.test(m)) return 'زمان پاسخ سرور به پایان رسید، دوباره تلاش کنید.';
    if (/could not find the table|schema cache|relation .* does not exist|PGRST205|42P01/i.test(m)) return 'جدول این بخش هنوز در دیتابیس ساخته نشده. فایل migration مربوطه را در Supabase اجرا کنید.';
    return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.';
  }

  const ORDER_DB = { no: 'no', createdAt: 'created_at', deletedAt: 'deleted_at', items: 'items', total: 'total', count: 'count', visitorName: 'visitor_name', pharmacyName: 'pharmacy_name', pharmacyAddress: 'pharmacy_address', pharmacyArea: 'pharmacy_area', pharmacyPhone: 'pharmacy_phone', note: 'note', offer: 'offer' };
  const PROD_DB = { warehouse: 'warehouse', code: 'code', name: 'name', stock: 'stock', price: 'price', priceToman: 'price_toman', unit: 'unit', normName: 'norm_name', normCode: 'norm_code', importedAt: 'imported_at' };
  const FILE_DB = { warehouse: 'warehouse', fileName: 'file_name', fileSize: 'file_size', fileType: 'file_type', uploadedAt: 'uploaded_at', rowCount: 'row_count', unit: 'unit' };

  function mapToDb(obj, map) {
    const out = {};
    for (const k of Object.keys(map)) {
      if (obj[k] !== undefined && obj[k] !== null) out[map[k]] = obj[k];
    }
    return out;
  }
  function mapFromDb(row, map) {
    if (!row) return null;
    const out = {};
    for (const k of Object.keys(map)) out[k] = row[map[k]];
    if (row.id !== undefined) out.id = row.id;
    if (row.user_id !== undefined) out.user_id = row.user_id;
    return out;
  }

  /* این تابع «سفارش‌های خودِ همین کاربر» است (صفحه‌ی سفارش‌ها/آرشیو داروخانه‌ها).
     رفع باگ: قبلاً فیلتر user_id نداشت و فقط به RLS تکیه می‌کرد؛ چون Policy جدول orders
     برای مدیر عمداً همه‌ی سفارش‌ها را هم اجازه می‌دهد (برای پنل «مدیریت کاربران»)، وقتی
     خودِ مدیر این صفحه‌ی شخصی‌اش را باز می‌کرد، سفارش‌های همه‌ی کاربران قاطی سفارش‌های
     خودش دیده می‌شد. سفارش‌های همه‌ی یک کاربر خاص برای پنل مدیر همچنان از تابع جدای
     adminGetOrders(userId) می‌آید که از قبل درست فیلتر شده و اینجا دست نخورده. */
  async function getOrders(opts) {
    let q = supabase.from('orders').select('*').eq('user_id', uid()).is('deleted_at', null).order('created_at', { ascending: false });
    if (opts && opts.limit) q = q.range(opts.offset || 0, (opts.offset || 0) + opts.limit - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, ORDER_DB));
  }

  async function getOrdersCount() {
    const { count, error } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('user_id', uid()).is('deleted_at', null);
    if (error) throw error;
    return count || 0;
  }

  async function getDeletedOrders() {
    const { data, error } = await supabase.from('orders').select('*').eq('user_id', uid()).not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, ORDER_DB));
  }

  /* پاک‌سازی خودکار سطل زباله — سفارش‌هایی که بیش از ۷ روز پیش حذف
     (soft-delete) شده‌اند، برای همیشه پاک می‌شوند. هر بار اپ باز می‌شود
     صدا زده می‌شود؛ نیازی به Cron سمت سرور نیست. */
  async function purgeOldTrash() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('orders').delete().eq('user_id', uid()).not('deleted_at', 'is', null).lt('deleted_at', cutoff);
    if (error) throw error;
  }

  /* ---------- داروخانه‌های هدف (لید/پیگیری آینده) ---------- */
  const TARGET_PH_DB = { id: 'id', name: 'name', address: 'address', phone: 'phone', area: 'area', note: 'note', followUpDate: 'follow_up_date', status: 'status', createdAt: 'created_at' };

  async function getTargetPharmacies() {
    const { data, error } = await supabase.from('target_pharmacies').select('*').order('follow_up_date', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, TARGET_PH_DB));
  }

  async function putTargetPharmacy(tp) {
    const row = mapToDb(tp, TARGET_PH_DB);
    delete row.id;
    row.user_id = uid();
    let data;
    if (tp.id !== undefined && tp.id !== null) {
      const { data: d, error } = await supabase.from('target_pharmacies').update(row).eq('id', Number(tp.id)).eq('user_id', uid()).select().single();
      if (error) throw error;
      data = d;
    } else {
      const { data: d, error } = await supabase.from('target_pharmacies').insert(row).select().single();
      if (error) throw error;
      data = d;
    }
    return mapFromDb(data, TARGET_PH_DB);
  }

  async function deleteTargetPharmacy(id) {
    const { error } = await supabase.from('target_pharmacies').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  /* ---------- استعلام (شخصی و دائمی؛ مستقل از برنامه هفتگی) ---------- */
  const EST_DB = { id: 'id', pharmacyName: 'pharmacy_name', area: 'area', verdict: 'verdict', note: 'note', createdAt: 'created_at' };

  async function getEstelam() {
    const { data, error } = await supabase.from('estelam').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, EST_DB));
  }

  async function putEstelam(e) {
    if (!uid()) throw new Error('ورود لازم است.');
    if (!['good', 'hard', 'bad'].includes(e.verdict)) throw new Error('وضعیت حساب معتبر نیست.');
    const name = String(e.pharmacyName || '').trim();
    if (!name) throw new Error('نام داروخانه خالی است.');
    const row = { pharmacy_name: name, area: String(e.area || '').trim(), verdict: e.verdict, note: String(e.note || '').trim(), user_id: uid() };
    const { data, error } = await supabase.from('estelam').insert(row).select().single();
    if (error) throw error;
    return mapFromDb(data, EST_DB);
  }

  async function deleteEstelam(id) {
    const { error } = await supabase.from('estelam').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  async function restoreOrder(id) {
    const { error } = await supabase.from('orders').update({ deleted_at: null }).eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  async function permanentlyDeleteOrder(id) {
    const { error } = await supabase.from('orders').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  async function getOrder(id) {
    const { data, error } = await supabase.from('orders').select('*').eq('id', Number(id)).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    return mapFromDb(data, ORDER_DB);
  }

  async function putOrder(order) {
    const row = { ...mapToDb(order, ORDER_DB), user_id: uid() };
    let data;
    if (order.id !== undefined && order.id !== null) {
      const { data: d, error } = await supabase.from('orders').update(row).eq('id', Number(order.id)).eq('user_id', uid()).select().single();
      if (error) throw error;
      data = d;
    } else {
      // اگر شماره سفارش تکراری بود (Unique: user_id + no)، شماره بعدی آزاد را از سرور
      // می‌گیریم و دوباره تلاش می‌کنیم؛ سفارش نه گم می‌شود و نه با شماره تکراری ثبت می‌شود.
      let attempt = 0;
      for (;;) {
        const { data: d, error } = await supabase.from('orders').insert(row).select().single();
        if (!error) { data = d; break; }
        if (error.code !== '23505' || attempt >= 3 || row.no === undefined || row.no === null) throw error;
        // آیا همین سفارش قبلاً ثبت شده؟ (تایم‌اوت بعد از ذخیره‌ی موفق، دو تب، یا ارسال دستی و خودکار همزمان)
        // همان شماره + همان زمان ساخت = همان سفارش؛ دوباره ثبت نمی‌شود و شماره هم عوض نمی‌شود.
        if (row.created_at) {
          const { data: same } = await supabase.from('orders').select('id')
            .eq('user_id', uid()).eq('no', row.no).eq('created_at', row.created_at).limit(1);
          if (same && same.length) { data = same[0]; break; }
        }
        attempt += 1;
        const { data: mx, error: mxErr } = await supabase.from('orders')
          .select('no').eq('user_id', uid()).order('no', { ascending: false }).limit(1);
        if (mxErr) throw mxErr;
        const top = mx && mx.length ? Number(mx[0].no) || 0 : 0;
        row.no = Math.max(top, Number(row.no) || 0) + 1;
        order.no = row.no;
      }
    }
    if (data && data.id !== undefined) order.id = data.id;
    return order;
  }

  async function deleteOrder(id) {
    const { error } = await supabase.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  async function getSettings() {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;
    return (data || []).map((r) => ({ key: r.key, value: r.value }));
  }

  async function getSetting(key, def) {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return data ? data.value : def;
  }

  async function setSetting(key, value) {
    const { error } = await supabase.from('settings').upsert({ user_id: uid(), key, value }, { onConflict: 'user_id,key' });
    if (error) throw error;
  }

  async function getCart() {
    const { data, error } = await supabase.from('cart').select('items, info').eq('user_id', uid()).maybeSingle();
    if (error) throw error;
    return { items: (data && data.items) || [], info: (data && data.info) || {} };
  }

  async function putCart(items, info) {
    const { error } = await supabase.from('cart').upsert({ user_id: uid(), items, info, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  async function clearCart() {
    const { error } = await supabase.from('cart').delete().eq('user_id', uid());
    if (error) throw error;
  }

  /* خواندن صفحه‌به‌صفحه از سرور (۱۰۰۰ ردیف در هر درخواست، مرتب‌شده روی id).
     قبلاً یک درخواست بدون محدودیت زده می‌شد و PostgREST بی‌صدا فقط ۱۰۰۰ ردیف اول
     را برمی‌گرداند؛ بقیه ردیف‌ها گم می‌شدند. حالا همه صفحه‌ها گرفته می‌شود. */
  const PAGE_SIZE = 1000;
  async function fetchAllPages(buildQuery) {
    const out = [];
    let from = 0;
    for (;;) {
      const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data || [];
      for (const r of rows) out.push(r);
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return out;
  }

  async function getAllProducts() {
    const rows = await fetchAllPages(() => {
      let q = supabase.from('products').select('*').order('id', { ascending: true });
      if (uid()) q = q.eq('user_id', uid());
      return q;
    });
    return rows.map((r) => mapFromDb(r, PROD_DB));
  }

  function enrichError(context, err) {
    const e = new Error(context + (err && err.message ? ': ' + err.message : ''));
    e.code = (err && err.code) || null;
    e.details = (err && err.details) || null;
    e.hint = (err && err.hint) || null;
    e.raw = err || null;
    return e;
  }

  const INSERT_BATCH = 300; // تکه‌های ۳۰۰ ردیف — جلوگیری از محدودیت درخواست PostgREST

  function cleanProductRow(p, warehouse) {
    const r = mapToDb(p, PROD_DB);
    r.warehouse = String(warehouse);
    r.user_id = uid();
    ['stock', 'price', 'price_toman'].forEach((k) => {
      if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'number') {
        const n = Number(r[k]);
        r[k] = isNaN(n) ? null : n;
      }
    });
    ['code', 'name', 'unit', 'norm_name', 'norm_code'].forEach((k) => {
      if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') r[k] = String(r[k]);
    });
    return r;
  }

  async function replaceWarehouseProducts(warehouse, products) {
    const rawRows = (products || []).map((p) => cleanProductRow(p, warehouse));
    const byCode = new Map();
    const noCode = [];
    for (const r of rawRows) {
      if (r.code) byCode.set(String(r.code), r);
      else noCode.push(r);
    }
    const rows = [...byCode.values(), ...noCode];
    const total = rows.length;

    // ۱) محصولات موجود این انبار برای همین کاربر (id + code)
    // نکته: صفحه‌بندی (range) باید همراه با order صریح باشه، وگرنه
    // ترتیب صفحات پایدار نیست و ممکنه بعضی ردیف‌های موجود بین دو صفحه
    // جا بیفتن یا تکراری خونده بشن → کدهای «از قبل موجود» گم می‌شن،
    // اپ فکر می‌کنه جدیدن، و تلاش برای INSERT دوبارهٔ همون کد باعث
    // خطای duplicate key می‌شه.
    const existingByCode = new Map();
    const existingRows = [];
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: page, error: selErr } = await supabase.from('products')
          .select('id, code')
          .eq('user_id', uid())
          .eq('warehouse', String(warehouse))
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (selErr) throw enrichError('خطا در خواندن محصولات قبلی انبار', selErr);
        (page || []).forEach((r) => {
          existingRows.push(r);
          if (r.code !== null && r.code !== undefined && String(r.code) !== '') {
            existingByCode.set(String(r.code), r.id);
          }
        });
        if (!page || page.length < PAGE) break;
        from += PAGE;
      }
    }

    // ۲) ذخیره تکه‌تکه (batch) — بدون ON CONFLICT
    let inserted = 0, updated = 0;
    for (let i = 0; i < total; i += INSERT_BATCH) {
      const chunk = rows.slice(i, i + INSERT_BATCH);
      const toInsert = [];
      const toUpdate = [];
      for (const r of chunk) {
        const key = (r.code !== null && r.code !== undefined && String(r.code) !== '') ? String(r.code) : null;
        const id = key !== null ? existingByCode.get(key) : undefined;
        if (id !== undefined) toUpdate.push({ ...r, id });
        else toInsert.push(r);
      }
      if (toInsert.length) {
        const { error } = await supabase.from('products').insert(toInsert);
        if (error) {
          throw enrichError(
            'خطا در درج محصولات انبار (تکه ' + (Math.floor(i / INSERT_BATCH) + 1) + ' از ' + Math.ceil(Math.max(total, 1) / INSERT_BATCH) + ')',
            error
          );
        }
        inserted += toInsert.length;
      }
      if (toUpdate.length) {
        const { error } = await supabase.from('products').upsert(toUpdate, { onConflict: 'id' });
        if (error) throw enrichError('خطا در به‌روزرسانی محصولات انبار', error);
      }
      updated += toUpdate.length;
    }

    // ۳) حذف محصولات مازاد (که در فایل جدید نیستند) — فقط برای همین کاربر و انبار
    let deleted = 0;
    try {
      const newCodes = new Set(rows.filter((r) => r.code !== null && r.code !== undefined && String(r.code) !== '').map((r) => String(r.code)));
      const toDelete = (existingRows || [])
        .filter((r) => r.code === null || r.code === undefined || String(r.code) === '' || !newCodes.has(String(r.code)))
        .map((r) => r.id);
      for (let i = 0; i < toDelete.length; i += INSERT_BATCH) {
        const ids = toDelete.slice(i, i + INSERT_BATCH);
        const { error } = await supabase.from('products').delete().eq('user_id', uid()).in('id', ids);
        if (error) throw error;
      }
      deleted = toDelete.length;
    } catch (e2) {
      throw enrichError('محصولات جدید ذخیره شدند ولی حذف محصولات مازاد ناموفق بود', e2);
    }

    return { deleted, inserted, updated };
  }

  /* ---------- نام‌های مستعار محصولات (هر ردیف = یک alias، نه یک آبجکت واحد) ----------
     قبلاً همهٔ نام‌های مستعار زیر یک کلید settings به‌صورت یک آبجکت JSON
     واحد ذخیره می‌شد؛ هر ذخیره کل آبجکت را جایگزین می‌کرد و اگر دو
     عملیات (مثلاً seed سیستم + ویرایش دستی) نزدیک به هم اتفاق می‌افتاد،
     آخری کامل جایگزین اولی می‌شد و تغییرات گم می‌شد. حالا هر alias یک
     ردیف مستقل در جدول product_aliases است. */

  async function getAllAliases() {
    // سرور در هر درخواست حداکثر ۱۰۰۰ ردیف می‌دهد؛ پس صفحه‌به‌صفحه می‌خوانیم تا هیچ نام مستعاری جا نماند
    const PAGE = 1000;
    const map = {};
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await supabase.from('product_aliases').select('code, alias')
        .order('code', { ascending: true }).order('alias', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      (data || []).forEach((r) => {
        if (!map[r.code]) map[r.code] = [];
        map[r.code].push(r.alias);
      });
      if (!data || data.length < PAGE) break;
    }
    return map;
  }

  async function addAlias(code, alias) {
    const av = String(alias || '').trim();
    if (!av) return;
    const { error } = await supabase.from('product_aliases')
      .insert({ user_id: uid(), code: String(code), alias: av });
    if (error && error.code !== '23505') throw error; // 23505 = تکراری، بی‌خطر
  }

  async function removeAlias(code, alias) {
    const { error } = await supabase.from('product_aliases')
      .delete().eq('code', String(code)).eq('alias', alias);
    if (error) throw error;
  }

  async function renameAlias(code, oldAlias, newAlias) {
    const nv = String(newAlias || '').trim();
    if (!nv) return;
    const { error } = await supabase.from('product_aliases')
      .update({ alias: nv })
      .eq('code', String(code)).eq('alias', oldAlias);
    if (error && error.code !== '23505') throw error;
  }

  async function bulkAddAliases(entries) {
    const rows = [];
    for (const e of entries || []) {
      for (const a of (e.aliases || [])) {
        const av = String(a || '').trim();
        if (av) rows.push({ user_id: uid(), code: String(e.code), alias: av });
      }
    }
    if (!rows.length) return;
    const { error } = await supabase.from('product_aliases')
      .upsert(rows, { onConflict: 'company_id,code,alias', ignoreDuplicates: true });
    if (error) throw error;
  }

  /* ---------- اسم‌های پیشنهادی محصولات (جدول product_suggest_names؛ مشترک در شرکت) ----------
     کاملاً جدا از product_aliases. هیچ ذخیره‌ی محلی/موقت ندارد: فقط دیتابیس. */
  async function getSuggestNames() {
    const PAGE = 1000;
    const map = {};
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await supabase.from('product_suggest_names').select('code, name')
        .order('code', { ascending: true }).order('name', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      (data || []).forEach((r) => {
        if (!map[r.code]) map[r.code] = [];
        map[r.code].push(r.name);
      });
      if (!data || data.length < PAGE) break;
    }
    return map;
  }

  // برمی‌گرداند { dup:true } اگر اسم (با هر املای فاصله/نیم‌فاصله) قبلاً برای همین کد ثبت شده باشد
  async function addSuggestName(code, name) {
    const nv = String(name || '').trim();
    if (!nv) return { dup: false, empty: true };
    const { error } = await supabase.from('product_suggest_names')
      .insert({ user_id: uid(), code: String(code), name: nv });
    if (error) { if (error.code === '23505') return { dup: true }; throw error; }
    return { dup: false };
  }

  // ثبت گروهی: names برای همه‌ی codes. موارد تکراری (سمت سرور) بی‌صدا نادیده گرفته می‌شوند.
  async function addSuggestNamesBulk(codes, names) {
    const rows = [];
    for (const c of codes || []) {
      for (const n of names || []) {
        const nv = String(n || '').trim();
        if (nv) rows.push({ user_id: uid(), code: String(c), name: nv });
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('product_suggest_names')
        .upsert(rows.slice(i, i + 200), { onConflict: 'company_id,code,name_key', ignoreDuplicates: true });
      if (error) throw error;
    }
    return rows.length;
  }

  /* ---------- مشخصه‌های محصولات (جدول product_attrs؛ مشترک در شرکت) ----------
     نوع محصول، نوع پوست، کاربرد، حجم. status: 'suggested' | 'confirmed'. فقط دیتابیس؛ ذخیره‌ی محلی ندارد. */
  async function getProductAttrs() {
    const PAGE = 1000;
    const map = {};
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await supabase.from('product_attrs')
        .select('code, form_id, skin_ids, use_ids, volume, status')
        .order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      (data || []).forEach((r) => {
        map[r.code] = { form: r.form_id || null, skins: r.skin_ids || [], uses: r.use_ids || [], volume: r.volume || null, status: r.status === 'confirmed' ? 'confirmed' : 'suggested' };
      });
      if (!data || data.length < PAGE) break;
    }
    return map;
  }

  // rows: [{ code, form, skins[], uses[], volume, status }] — upsert روی (company_id, code)
  async function upsertProductAttrs(rows) {
    const payload = (rows || []).map((r) => ({
      user_id: uid(),
      code: String(r.code),
      form_id: r.form || null,
      skin_ids: r.skins || [],
      use_ids: r.uses || [],
      volume: r.volume || null,
      status: r.status === 'confirmed' ? 'confirmed' : 'suggested'
    }));
    for (let i = 0; i < payload.length; i += 200) {
      const { error } = await supabase.from('product_attrs')
        .upsert(payload.slice(i, i + 200), { onConflict: 'company_id,code' });
      if (error) throw error;
    }
    return payload.length;
  }

  /* ---------- نوع محصول / کاربرد سفارشی (product_attr_types؛ مشترک در شرکت) ---------- */
  async function getAttrTypes() {
    const { data, error } = await supabase.from('product_attr_types')
      .select('id, kind, label, phrases, dom').order('id', { ascending: true }).limit(2000);
    if (error) throw error;
    return (data || []).map((r) => ({ id: r.id, kind: r.kind, label: r.label, phrases: r.phrases || [], dom: r.dom || null }));
  }

  // برمی‌گرداند { dup:true } اگر همین نام قبلاً ثبت شده باشد؛ وگرنه { row }
  async function addAttrType(t) {
    const { data, error } = await supabase.from('product_attr_types')
      .insert({ user_id: uid(), kind: t.kind === 'use' ? 'use' : 'form', label: String(t.label || '').trim(), phrases: t.phrases || [], dom: t.dom || null })
      .select('id, kind, label, phrases, dom').single();
    if (error) { if (error.code === '23505') return { dup: true }; throw error; }
    return { row: { id: data.id, kind: data.kind, label: data.label, phrases: data.phrases || [], dom: data.dom || null } };
  }

  async function deleteProductAttrs(codes) {
    const list = (codes || []).map(String);
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await supabase.from('product_attrs').delete().in('code', list.slice(i, i + 200));
      if (error) throw error;
    }
  }

  /* ---------- برند و دسته‌بندی (product_tags / product_tag_links؛ مشترک در شرکت) ---------- */
  async function getProductTags() {
    const PAGE = 1000;
    const tags = [], links = [];
    for (let from = 0; from < 100000; from += PAGE) {
      let { data, error } = await supabase.from('product_tags').select('id, kind, name, parent_id, sort_order')
        .order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error && error.code === '42703') { // ستون sort_order هنوز ساخته نشده (SQL ترتیب اجرا نشده): بدون آن بخوان
        ({ data, error } = await supabase.from('product_tags').select('id, kind, name, parent_id')
          .order('id', { ascending: true }).range(from, from + PAGE - 1));
      }
      if (error) throw error;
      (data || []).forEach((r) => tags.push(r));
      if (!data || data.length < PAGE) break;
    }
    for (let from = 0; from < 200000; from += PAGE) {
      const { data, error } = await supabase.from('product_tag_links').select('tag_id, code')
        .order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      (data || []).forEach((r) => links.push(r));
      if (!data || data.length < PAGE) break;
    }
    return { tags, links };
  }

  // { dup:true } اگر همین نام (با هر املای فاصله/نیم‌فاصله) قبلاً برای همین نوع ثبت شده؛ وگرنه { tag:{id,kind,name} }
  async function addProductTag(kind, name, parentId, sortOrder) {
    const nv = String(name || '').trim();
    if (!nv) return { empty: true };
    const row = { user_id: uid(), kind, name: nv };
    if (kind === 'category') row.parent_id = parentId; // دسته همیشه زیرمجموعه‌ی یک برند است
    let res = await supabase.from('product_tags')
      .insert(sortOrder != null ? { ...row, sort_order: sortOrder } : row).select('*').single();
    if (res.error && res.error.code === '42703' && sortOrder != null) { // ستون sort_order نیست: بدون آن
      res = await supabase.from('product_tags').insert(row).select('*').single();
    }
    if (res.error) { if (res.error.code === '23505') return { dup: true }; throw res.error; }
    return { tag: res.data };
  }

  async function renameProductTag(id, name) {
    const nv = String(name || '').trim();
    if (!nv) return { empty: true };
    const { error } = await supabase.from('product_tags').update({ name: nv }).eq('id', id);
    if (error) { if (error.code === '23505') return { dup: true }; throw error; }
    return { dup: false };
  }

  // ذخیره‌ی ترتیب جدید: updates = [{id, sort_order}]
  async function reorderProductTags(updates) {
    const results = await Promise.all((updates || []).map((u) =>
      supabase.from('product_tags').update({ sort_order: u.sort_order }).eq('id', u.id)));
    const bad = results.find((r) => r.error);
    if (bad) throw bad.error;
  }

  async function removeProductTag(id) { // اتصال‌ها خودکار (cascade) پاک می‌شوند؛ خود محصولات هرگز
    const { error } = await supabase.from('product_tags').delete().eq('id', id);
    if (error) throw error;
  }

  async function addProductTagLinks(tagId, codes) {
    const rows = (codes || []).map((c) => ({ user_id: uid(), tag_id: tagId, code: String(c) }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('product_tag_links')
        .upsert(rows.slice(i, i + 200), { onConflict: 'tag_id,code', ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  async function removeProductTagLink(tagId, code) {
    const { error } = await supabase.from('product_tag_links').delete().eq('tag_id', tagId).eq('code', String(code));
    if (error) throw error;
  }

  async function removeSuggestName(code, name) {
    const { error } = await supabase.from('product_suggest_names')
      .delete().eq('code', String(code)).eq('name', name);
    if (error) throw error;
  }

  async function renameSuggestName(code, oldName, newName) {
    const nv = String(newName || '').trim();
    if (!nv) return { dup: false, empty: true };
    const { error } = await supabase.from('product_suggest_names')
      .update({ name: nv }).eq('code', String(code)).eq('name', oldName);
    if (error) { if (error.code === '23505') return { dup: true }; throw error; }
    return { dup: false };
  }

  /* ---------- اندازه بسته/کارتن (هر ردیف = یک کد کالا) ---------- */

  async function getAllPackSizes() {
    const { data, error } = await supabase.from('pack_sizes').select('code, size, note');
    if (error) throw error;
    const map = {};
    (data || []).forEach((r) => {
      map[r.code] = { size: r.size };
      if (r.note) map[r.code].note = r.note;
    });
    return map;
  }

  async function setPackSize(code, size, note) {
    const row = { user_id: uid(), code: String(code), size: Number(size) };
    const nt = note ? String(note).trim() : '';
    row.note = nt || null;
    const { error } = await supabase.from('pack_sizes').upsert(row, { onConflict: 'company_id,code' });
    if (error) throw error;
  }

  async function removePackSize(code) {
    const { error } = await supabase.from('pack_sizes').delete().eq('code', String(code));
    if (error) throw error;
  }

  async function bulkSetPackSizes(entries) {
    const { data: existing, error: selErr } = await supabase.from('pack_sizes').select('code');
    if (selErr) throw selErr;
    const have = new Set((existing || []).map((r) => String(r.code)));
    const rows = [];
    for (const e of entries || []) {
      const key = String(e.code);
      if (have.has(key) || !e.size) continue;
      const row = { user_id: uid(), code: key, size: Number(e.size) };
      if (e.note) row.note = String(e.note);
      rows.push(row);
    }
    if (!rows.length) return;
    const { error } = await supabase.from('pack_sizes').insert(rows);
    if (error) throw error;
  }

  /* ---------- فایل‌های انبار (مشترک بین همه کاربران) ---------- */

  async function getAllFiles() {
    const q = supabase.from('warehouse_files').select('*');
    if (uid()) q.eq('user_id', uid());
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, FILE_DB));
  }

  async function getFile(warehouse) {
    const q = supabase.from('warehouse_files').select('*').eq('warehouse', String(warehouse));
    if (uid()) q.eq('user_id', uid());
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return mapFromDb(data, FILE_DB);
  }

  async function putFile(meta) {
    const row = { ...mapToDb(meta, FILE_DB), warehouse: String(meta.warehouse), user_id: uid() };
    const { data: existing, error: selErr } = await supabase.from('warehouse_files')
      .select('id')
      .eq('user_id', uid())
      .eq('warehouse', String(meta.warehouse))
      .maybeSingle();
    if (selErr) throw selErr;
    if (existing && existing.id !== undefined) {
      const { id, ...fields } = row;
      const { error } = await supabase.from('warehouse_files').update(fields).eq('id', existing.id).eq('user_id', uid());
      if (error) throw error;
    } else {
      const { error } = await supabase.from('warehouse_files').insert(row);
      if (error) throw error;
    }
  }

  async function deleteFile(warehouse) {
    const q = supabase.from('warehouse_files').delete().eq('warehouse', String(warehouse));
    if (uid()) q.eq('user_id', uid());
    const { error } = await q;
    if (error) throw error;
  }

  async function wipePersonal() {
    for (const t of ['orders', 'product_aliases', 'pack_sizes', 'cart']) {
      const { error } = await supabase.from(t).delete().eq('user_id', uid());
      if (error) throw error;
    }
    const { error } = await supabase.from('settings').delete().eq('user_id', uid());
    if (error) throw error;
  }

  /* ثبت «آخرین فعالیت» کاربر: بی‌صدا و کم‌تکرار (حداکثر هر ۵ دقیقه یک بار) و هیچ‌وقت کاربر را منتظر نمی‌گذارد */
  let lastSeenSentAt = 0;
  function touchLastSeen() {
    try {
      if (!supabase || !currentUser || isOffline()) return;
      const now = Date.now();
      if (now - lastSeenSentAt < 5 * 60 * 1000) return;
      lastSeenSentAt = now;
      Promise.resolve(supabase.rpc('touch_last_seen')).then(() => {}, () => { lastSeenSentAt = 0; });
    } catch (e) { /* بی‌اثر */ }
  }

  async function adminListUsers() {
    const data = await fetchAllPages(() => supabase.from('profiles')
      .select('id, full_name, email, role, plan_name, plan_status, plan_expires_at, company_name, company_id')
      .order('id', { ascending: true }));
    let countByUser = {};
    let rpcOk = false;
    try {
      const { data: counts, error: rpcErr } = await supabase.rpc('admin_user_order_counts');
      if (!rpcErr) {
        (counts || []).forEach((row) => { countByUser[row.user_id] = row.order_count; });
        rpcOk = true;
      }
    } catch (e) { /* اگر migration مربوطه هنوز اجرا نشده، پایین fallback می‌کنیم */ }
    const archivedAt = {};
    try {
      const { data: arch, error: archErr } = await supabase.from('profiles').select('id, archived_at').not('archived_at', 'is', null);
      if (!archErr) (arch || []).forEach((r) => { archivedAt[r.id] = r.archived_at; });
    } catch (e) { /* ستون بایگانی هنوز ساخته نشده */ }
    const lastSeen = {};
    try {
      const { data: seen, error: seenErr } = await supabase.from('profiles').select('id, last_seen_at').not('last_seen_at', 'is', null);
      if (!seenErr) (seen || []).forEach((r) => { lastSeen[r.id] = r.last_seen_at; });
    } catch (e) { /* ستون آخرین فعالیت هنوز ساخته نشده */ }
    const out = [];
    for (const u of (data || [])) {
      let count = countByUser[u.id] || 0;
      if (!rpcOk) {
        try {
          const { count: c } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', u.id);
          count = c || 0;
        } catch (e) { /* بی‌اثر */ }
      }
      out.push({
        id: u.id, full_name: u.full_name, email: u.email || '', role: u.role,
        orderCount: count,
        plan_name: u.plan_name || 'trial',
        plan_status: u.plan_status || 'active',
        plan_expires_at: u.plan_expires_at || null,
        company_name: u.company_name || '',
        company_id: u.company_id || null,
        archived_at: archivedAt[u.id] || null,
        last_seen_at: lastSeen[u.id] || null
      });
    }
    return out;
  }

  async function adminListCompanies() {
    const { data, error } = await supabase.from('companies')
      .select('id, name, company_code, active, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    let counts = {};
    try {
      const { data: c } = await supabase.rpc('admin_company_user_counts');
      (c || []).forEach((row) => { counts[row.company_id] = row.user_count; });
    } catch (e) { /* بی‌اثر — فقط شمارش نمایشی است */ }
    return (data || []).map((c) => ({
      id: c.id, name: c.name, company_code: c.company_code, active: c.active,
      created_at: c.created_at, userCount: counts[c.id] || 0
    }));
  }

  async function adminCreateCompany(name, companyCode) {
    const code = (companyCode || '').trim();
    if (!code) throw new Error('کد شرکت را وارد کنید.');
    const { data, error } = await supabase.from('companies')
      .insert({ name: (name || '').trim() || code, company_code: code })
      .select().single();
    if (error) {
      if (String(error.message || '').includes('duplicate') || error.code === '23505') {
        throw new Error('این کد شرکت قبلاً استفاده شده است.');
      }
      throw new Error(error.message);
    }
    return data;
  }

  async function adminSetCompanyActive(companyId, active) {
    const { error } = await supabase.from('companies').update({ active }).eq('id', companyId);
    if (error) throw new Error(error.message);
  }

  /* ---------- اشتراک و پرداخت کارت‌به‌کارت ---------- */
  async function refreshProfile() {
    if (!currentUser) return null;
    const row = await fetchProfileRow(currentUser.id);
    if (row) { applyProfileRow(currentUser, row); currentUser.profileSource = 'server'; }
    return currentUser;
  }
  async function getSubscriptionPrices() {
    const { data, error } = await supabase.from('subscription_prices').select('days, amount, label').order('days', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function getSubscriptionConfig() {
    const { data, error } = await supabase.from('subscription_config').select('card_number, card_owner, support_note').maybeSingle();
    if (error) throw error;
    return data || { card_number: '', card_owner: '', support_note: '' };
  }
  async function getMySubscriptionRequests() {
    const { data, error } = await supabase.from('subscription_requests').select('id, days, amount, tracking_code, status, admin_note, created_at, decided_at')
      .eq('user_id', uid()).order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data || [];
  }
  async function requestSubscription(days, tracking, last4) {
    const { data, error } = await supabase.rpc('request_subscription', { p_days: days, p_tracking: tracking, p_last4: last4 || null });
    if (error) throw error;
    return data;
  }
  /* ---------- پشتیبانی (تیکت) ---------- */
  async function supportCreate(subject, body) {
    const { data, error } = await supabase.rpc('support_create', { p_subject: subject || '', p_body: body });
    if (error) throw error;
    return data;
  }
  async function supportReply(id, body) {
    const { error } = await supabase.rpc('support_reply', { p_ticket_id: Number(id), p_body: body });
    if (error) throw error;
  }
  async function supportClose(id) {
    const { error } = await supabase.rpc('support_close', { p_ticket_id: Number(id) });
    if (error) throw error;
  }
  async function supportMyList() {
    const { data, error } = await supabase.rpc('support_my_list');
    if (error) throw error;
    return data || [];
  }
  async function supportAdminList(status) {
    const { data, error } = await supabase.rpc('support_admin_list', { p_status: status || 'open' });
    if (error) throw error;
    return data || [];
  }
  async function supportThread(id) {
    const { data, error } = await supabase.rpc('support_thread', { p_ticket_id: Number(id) });
    if (error) throw error;
    return data || [];
  }
  async function supportUnreadCount() {
    const { data, error } = await supabase.rpc('support_unread_count');
    if (error) throw error;
    return Number(data) || 0;
  }

  async function adminGetSubscriptionRequests(status) {
    const { data, error } = await supabase.rpc('admin_subscription_requests', { p_status: status || 'pending' });
    if (error) throw error;
    return data || [];
  }
  async function adminDecideSubscription(id, approve, note) {
    const { data, error } = await supabase.rpc('admin_decide_subscription', { p_id: id, p_approve: !!approve, p_note: note || null });
    if (error) throw error;
    return data;
  }
  async function adminGiftDays(userId, days) {
    const { data, error } = await supabase.rpc('admin_gift_days', { p_user: userId, p_days: days });
    if (error) throw error;
    return data;
  }

  async function adminSetPlan(userId, { planName, expiresAt, status, companyName }) {
    const patch = {};
    if (planName !== undefined) patch.plan_name = planName;
    if (expiresAt !== undefined) patch.plan_expires_at = expiresAt || null;
    if (status !== undefined) patch.plan_status = status;
    if (companyName !== undefined) patch.company_name = companyName;
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
  }

  async function adminGetOrders(userId) {
    // صفحه‌به‌صفحه (۱۰۰۰ تایی)؛ ترتیب همان قبلی (جدیدترین اول) با id برای ثابت‌ماندن مرز صفحه‌ها
    const rows = await fetchAllPages(() => supabase.from('orders').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }));
    return rows.map((r) => mapFromDb(r, ORDER_DB));
  }

  async function adminDeleteOrder(id) {
    const { error } = await supabase.from('orders').delete().eq('id', Number(id));
    if (error) throw error;
  }

  /* حذف کامل یک کاربر (فقط مدیر؛ تابع admin_delete_user در دیتابیس نقش مدیر را خودش چک می‌کند) */
  async function adminDeleteUser(userId) {
    const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
    if (error) throw error;
  }

  async function adminArchiveUser(userId) {
    const { error } = await supabase.rpc('admin_archive_user', { p_user: userId });
    if (error) throw error;
  }
  async function adminRestoreUser(userId) {
    const { error } = await supabase.rpc('admin_restore_user', { p_user: userId });
    if (error) throw error;
  }
  async function adminUserData(userId) {
    const { data, error } = await supabase.rpc('admin_user_data', { p_user: userId });
    if (error) throw error;
    return data || {};
  }

  /* ---------- برنامه هفتگی ویزیت ---------- */
  const WEEKLY_VISIT_DB = { id: 'id', name: 'name', type: 'type', dayOfWeek: 'day_of_week', visitOrder: 'visit_order', address: 'address', phone: 'phone', area: 'area', note: 'note', lastVisitedAt: 'last_visited_at', createdAt: 'created_at', weeks: 'weeks' };

  // آیا ستون weeks در دیتابیس هست؟ (null = هنوز معلوم نیست). برای کار کردن اپ جدید قبل از اجرای migration
  let weeklyHasWeeksCol = null;
  function weeklyFitRow(row) {
    if (row.weeks === undefined) return row;
    if (weeklyHasWeeksCol === false) {
      if (Number(row.weeks) !== 15) throw new Error('ستون «هفته‌ها» هنوز در دیتابیس نیست؛ ابتدا migration برنامه هفتگی (20261011) را اجرا کنید.');
      delete row.weeks;
    }
    return row;
  }

  async function getWeeklyVisits() {
    const { data, error } = await supabase.from('weekly_visits').select('*').order('day_of_week', { ascending: true }).order('visit_order', { ascending: true }).order('id', { ascending: true });
    if (error) throw error;
    if (data && data.length) weeklyHasWeeksCol = Object.prototype.hasOwnProperty.call(data[0], 'weeks');
    return (data || []).map((r) => mapFromDb(r, WEEKLY_VISIT_DB));
  }

  async function putWeeklyVisit(v) {
    const row = mapToDb(v, WEEKLY_VISIT_DB);
    delete row.id;
    row.user_id = uid();
    // «هر هفته» پیش‌فرض ستون است؛ در درج جدید ارسال نمی‌شود (سازگار با قبل از اجرای migration هفته‌ها)
    if (v.id === undefined || v.id === null) { if (Number(row.weeks) === 15) delete row.weeks; }
    weeklyFitRow(row);
    let data;
    if (v.id !== undefined && v.id !== null) {
      const { data: d, error } = await supabase.from('weekly_visits').update(row).eq('id', Number(v.id)).eq('user_id', uid()).select().single();
      if (error) throw error;
      data = d;
    } else {
      const { data: d, error } = await supabase.from('weekly_visits').insert(row).select().single();
      if (error) throw error;
      data = d;
    }
    return mapFromDb(data, WEEKLY_VISIT_DB);
  }

  async function markWeeklyVisitDone(id, done) {
    const { data, error } = await supabase.from('weekly_visits')
      .update({ last_visited_at: done ? new Date().toISOString() : null })
      .eq('id', Number(id)).eq('user_id', uid()).select().single();
    if (error) throw error;
    return mapFromDb(data, WEEKLY_VISIT_DB);
  }

  /* افزودن چندتایی در یک درخواست (یا همه ثبت می‌شوند یا هیچ‌کدام) */
  async function addWeeklyVisitsBulk(list) {
    const rows = list.map((v) => { const r = mapToDb(v, WEEKLY_VISIT_DB); delete r.id; r.user_id = uid(); if (Number(r.weeks) === 15) delete r.weeks; return weeklyFitRow(r); });
    const { data, error } = await supabase.from('weekly_visits').insert(rows).select();
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, WEEKLY_VISIT_DB));
  }

  /* ذخیره‌ی ترتیب جدید بعد از دراگ: فقط ردیف‌هایی که شماره‌شان عوض شده، ۱۰ تا ۱۰ تا */
  async function reorderWeeklyVisits(updates) {
    for (let i = 0; i < updates.length; i += 10) {
      await Promise.all(updates.slice(i, i + 10).map(async (u) => {
        const { error } = await supabase.from('weekly_visits')
          .update({ visit_order: Number(u.visitOrder) }).eq('id', Number(u.id)).eq('user_id', uid());
        if (error) throw error;
      }));
    }
  }

  /* تغییر گروهیِ روز و/یا هفته‌ها برای چند مورد (۱۰۰ تا ۱۰۰ تا)؛ فقط ردیف‌های خود کاربر
     patch: { day_of_week?, weeks? } */
  async function updateWeeklyVisitsBulk(ids, patch) {
    const body = {};
    if (patch && patch.day_of_week !== undefined) body.day_of_week = Number(patch.day_of_week);
    if (patch && patch.weeks !== undefined) body.weeks = Number(patch.weeks);
    weeklyFitRow(body);
    if (!Object.keys(body).length) return;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).map(Number);
      const { error } = await supabase.from('weekly_visits').update(body).in('id', chunk).eq('user_id', uid());
      if (error) throw error;
    }
  }

  /* حذف چندتایی (۱۰۰ تا ۱۰۰ تا)؛ فقط ردیف‌های خود کاربر */
  async function deleteWeeklyVisitsBulk(ids) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).map(Number);
      const { error } = await supabase.from('weekly_visits').delete().in('id', chunk).eq('user_id', uid());
      if (error) throw error;
    }
  }

  async function deleteWeeklyVisit(id) {
    const { error } = await supabase.from('weekly_visits').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  /* ---------- پرونده‌ی مشتری (CRM مشاور) ---------- */
  const CLIENT_DB = { name: 'name', phone: 'phone', intent: 'intent', budgetMax: 'budget_max', rentMax: 'rent_max', areas: 'areas', minSize: 'min_size', mustHaves: 'must_haves', stage: 'stage', lostReason: 'lost_reason', nextFollowupDate: 'next_followup_date', createdAt: 'created_at', updatedAt: 'updated_at' };
  const CNOTE_DB = { clientId: 'client_id', kind: 'kind', text: 'text', createdAt: 'created_at' };

  /* «رهن» و «اجاره» یکی شده‌اند؛ ردیف‌های قدیمیِ mortgage هنگام خواندن به rent تبدیل می‌شوند (دیتابیس دست نمی‌خورد) */
  const mapClient = (r) => { const o = mapFromDb(r, CLIENT_DB); if (o && o.intent === 'mortgage') o.intent = 'rent'; return o; };
  const mapListing = (r) => { const o = mapFromDb(r, LISTING_DB); if (o && o.type === 'mortgage') o.type = 'rent'; return o; };

  async function getClients() {
    const { data, error } = await supabase.from('clients').select('*').eq('user_id', uid()).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapClient(r));
  }

  /* ایجاد/ویرایش. فیلدهای null عمداً هم نوشته می‌شوند (پاک کردن مقدار) — برخلاف mapToDb */
  async function putClient(c) {
    if (!uid()) throw new Error('ورود لازم است.');
    const row = { user_id: uid(), updated_at: new Date().toISOString() };
    for (const k of Object.keys(CLIENT_DB)) {
      if (k === 'createdAt' || k === 'updatedAt') continue;
      if (c[k] !== undefined) row[CLIENT_DB[k]] = c[k];
    }
    let data;
    if (c.id !== undefined && c.id !== null) {
      const { data: d, error } = await supabase.from('clients').update(row).eq('id', Number(c.id)).eq('user_id', uid()).select().single();
      if (error) throw error;
      data = d;
    } else {
      const { data: d, error } = await supabase.from('clients').insert(row).select().single();
      if (error) throw error;
      data = d;
    }
    return mapClient(data);
  }

  async function deleteClient(id) {
    const { error } = await supabase.from('clients').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  async function getClientNotes(clientId) {
    const { data, error } = await supabase.from('client_notes').select('*').eq('user_id', uid()).eq('client_id', Number(clientId)).order('created_at', { ascending: false }).order('id', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, CNOTE_DB));
  }

  /* فقط زمان یادداشت‌ها (برای تشخیص «سرد شده») — سبک، بدون متن */
  async function getClientNotesIndex() {
    const { data, error } = await supabase.from('client_notes').select('client_id,created_at').eq('user_id', uid()).order('created_at', { ascending: false }).limit(3000);
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, CNOTE_DB));
  }

  async function addClientNote(n) {
    if (!uid()) throw new Error('ورود لازم است.');
    const text = String(n.text || '').trim();
    if (!text) throw new Error('متن یادداشت خالی است.');
    if (!['note', 'call', 'visit', 'reject'].includes(n.kind || 'note')) throw new Error('نوع یادداشت معتبر نیست.');
    const row = { user_id: uid(), client_id: Number(n.clientId), kind: n.kind || 'note', text };
    const { data, error } = await supabase.from('client_notes').insert(row).select().single();
    if (error) throw error;
    return mapFromDb(data, CNOTE_DB);
  }

  /* ---------- برنامه‌ی روزانه (داخل یادداشت سریع) ---------- */
  const TASK_DB = { title: 'title', date: 'task_date', time: 'task_time', clientId: 'client_id', done: 'done', doneAt: 'done_at', source: 'source', remind: 'remind', createdAt: 'created_at', updatedAt: 'updated_at' };
  const mapTask = (r) => { const o = mapFromDb(r, TASK_DB); if (o) { o.remind = o.remind !== false; o.time = o.time ? String(o.time).slice(0, 5) : null; o.date = String(o.date || '').slice(0, 10); o.done = !!o.done; } return o; };

  /* کارهای از تاریخ fromISO به بعد + همه‌ی کارهای انجام‌نشده (برای «عقب‌افتاده») */
  async function getDailyTasks(fromISO) {
    if (!uid()) throw new Error('ورود لازم است.');
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromISO || '')) ? fromISO : '1970-01-01';
    const { data, error } = await supabase.from('daily_tasks').select('*').eq('user_id', uid())
      .or('task_date.gte.' + from + ',done.eq.false').order('task_date', { ascending: true }).order('task_time', { ascending: true, nullsFirst: false }).limit(1000);
    if (error) throw error;
    return (data || []).map(mapTask);
  }
  async function addDailyTasks(list) {
    if (!uid()) throw new Error('ورود لازم است.');
    const rows = (list || []).map((t) => ({ user_id: uid(), title: t.title, task_date: t.date, task_time: t.time || null, client_id: t.clientId == null ? null : Number(t.clientId), source: t.source === 'voice' ? 'voice' : 'text' }));
    if (!rows.length) return [];
    const { data, error } = await supabase.from('daily_tasks').insert(rows).select();
    if (error) throw error;
    return (data || []).map(mapTask);
  }
  /* patch: هر زیرمجموعه‌ای از { title, date, time, clientId, done } */
  async function updateDailyTask(id, patch) {
    if (!uid()) throw new Error('ورود لازم است.');
    const row = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.date !== undefined) row.task_date = patch.date;
    if (patch.time !== undefined) row.task_time = patch.time || null;
    if (patch.clientId !== undefined) row.client_id = patch.clientId == null ? null : Number(patch.clientId);
    if (patch.remind !== undefined) row.remind = !!patch.remind;
    if (patch.done !== undefined) { row.done = !!patch.done; row.done_at = patch.done ? new Date().toISOString() : null; }
    const { data, error } = await supabase.from('daily_tasks').update(row).eq('id', Number(id)).eq('user_id', uid()).select().single();
    if (error) throw error;
    return mapTask(data);
  }
  async function deleteDailyTask(id) {
    if (!uid()) throw new Error('ورود لازم است.');
    const { error } = await supabase.from('daily_tasks').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  /* حذف گروهی (همه‌ی کارهای یک روز/عقب‌افتاده‌ها)؛ فقط کارهای خودِ کاربر */
  async function deleteDailyTasks(ids) {
    if (!uid()) throw new Error('ورود لازم است.');
    const list = (ids || []).map(Number).filter((n) => Number.isFinite(n));
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await supabase.from('daily_tasks').delete().in('id', list.slice(i, i + 100)).eq('user_id', uid());
      if (error) throw error;
    }
    return list.length;
  }

  async function deleteClientNote(id) {
    const { error } = await supabase.from('client_notes').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  /* ---------- فایل‌های ملکی ---------- */
  const LISTING_DB = { type: 'type', area: 'area', size: 'size', floor: 'floor', age: 'age', price: 'price', deposit: 'deposit', rentMonthly: 'rent_monthly', features: 'features', ownerName: 'owner_name', ownerPhone: 'owner_phone', address: 'exact_address', status: 'status', collabOpen: 'collab_open', collabSharePct: 'collab_share_pct', isMine: 'is_mine', createdAt: 'created_at', updatedAt: 'updated_at' };

  /* لیست مشترک فایل‌های تعاملی (فقط مشخصات کلی؛ سمت سرور فیلتر می‌شود) */
  async function getCollabListings() {
    const { data, error } = await supabase.rpc('collab_listings');
    if (error) throw error;
    return (data || []).map((r) => mapListing(r));
  }

  const COLLAB_DB = { role: 'role', status: 'status', sharePct: 'share_pct', clientSummary: 'client_summary', listingId: 'listing_id', type: 'type', area: 'area', size: 'size', floor: 'floor', age: 'age', price: 'price', deposit: 'deposit', rentMonthly: 'rent_monthly', features: 'features', otherName: 'other_name', ownerContact: 'owner_contact', commission: 'commission', myDoneAt: 'my_done_at', otherDoneAt: 'other_done_at', myRating: 'my_rating', otherAvg: 'other_avg', otherCount: 'other_count', createdAt: 'created_at', acceptedAt: 'accepted_at', doneAt: 'done_at' };

  async function getMyCollabs() {
    try { await supabase.rpc('collab_autoconfirm'); } catch (e) { /* migration هنوز اجرا نشده: بی‌اثر */ }
    const { data, error } = await supabase.rpc('collab_my_list');
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, COLLAB_DB));
  }
  async function requestCollab(listingId, summary) {
    const { data, error } = await supabase.rpc('collab_request', { p_listing_id: Number(listingId), p_client_summary: summary });
    if (error) throw error;
    return data;
  }
  async function respondCollab(id, accept, contact) {
    const { error } = await supabase.rpc('collab_respond', { p_collab_id: Number(id), p_accept: !!accept, p_contact: contact || null });
    if (error) throw error;
  }
  async function doneCollab(id, commission) {
    const { error } = await supabase.rpc('collab_done', { p_collab_id: Number(id), p_commission: commission == null ? null : Number(commission) });
    if (error) throw error;
  }
  async function rateCollab(id, stars) {
    const { error } = await supabase.rpc('collab_rate', { p_collab_id: Number(id), p_stars: Number(stars) });
    if (error) throw error;
  }
  async function cancelCollab(id) {
    const { error } = await supabase.rpc('collab_cancel', { p_collab_id: Number(id) });
    if (error) throw error;
  }

  async function getListings() {
    const { data, error } = await supabase.from('listings').select('*').eq('user_id', uid()).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapListing(r));
  }

  /* فیلدهای null عمداً نوشته می‌شوند (پاک کردن مقدار) */
  async function putListing(l) {
    if (!uid()) throw new Error('ورود لازم است.');
    const row = { user_id: uid(), updated_at: new Date().toISOString() };
    for (const k of Object.keys(LISTING_DB)) {
      if (k === 'createdAt' || k === 'updatedAt') continue;
      if (l[k] !== undefined) row[LISTING_DB[k]] = l[k];
    }
    let data;
    if (l.id !== undefined && l.id !== null) {
      delete row.user_id;
      const { data: d, error } = await supabase.from('listings').update(row).eq('id', Number(l.id)).eq('user_id', uid()).select().single();
      if (error) throw error;
      data = d;
    } else {
      const { data: d, error } = await supabase.from('listings').insert(row).select().single();
      if (error) throw error;
      data = d;
    }
    return mapListing(data);
  }

  /* ---------- قراردادها و معامله‌ها ---------- */
  const DEAL_DB = { kind: 'kind', clientName: 'client_name', clientPhone: 'client_phone', otherName: 'other_name', otherPhone: 'other_phone', property: 'property', dealDate: 'deal_date', endDate: 'end_date', trackAfter: 'track_after', trackRenewal: 'track_renewal', done: 'reminders_done', notes: 'notes', createdAt: 'created_at', updatedAt: 'updated_at' };

  async function getDeals() {
    if (!uid()) throw new Error('ورود لازم است.');
    const { data, error } = await supabase.from('deals').select('*').eq('user_id', uid()).order('deal_date', { ascending: false }).limit(2000);
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, DEAL_DB));
  }
  async function putDeal(d) {
    if (!uid()) throw new Error('ورود لازم است.');
    const row = { user_id: uid(), updated_at: new Date().toISOString() };
    for (const k of Object.keys(DEAL_DB)) {
      if (k === 'createdAt' || k === 'updatedAt') continue;
      if (d[k] !== undefined) row[DEAL_DB[k]] = d[k];
    }
    let data;
    if (d.id !== undefined && d.id !== null) {
      delete row.user_id;
      const { data: x, error } = await supabase.from('deals').update(row).eq('id', Number(d.id)).eq('user_id', uid()).select().single();
      if (error) throw error;
      data = x;
    } else {
      const { data: x, error } = await supabase.from('deals').insert(row).select().single();
      if (error) throw error;
      data = x;
    }
    return mapFromDb(data, DEAL_DB);
  }
  async function deleteDeal(id) {
    const { error } = await supabase.from('deals').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }

  /* ---------- کارت ملک ---------- */
  const CARD_DB = { listingId: 'listing_id', clientId: 'client_id', token: 'token', note: 'note', contactName: 'contact_name', contactPhone: 'contact_phone', contactAgency: 'contact_agency', createdAt: 'created_at', revokedAt: 'revoked_at' };
  const EVENT_DB = { cardId: 'card_id', session: 'session', kind: 'kind', seconds: 'seconds', seen: 'seen', visitorName: 'visitor_name', visitorPhone: 'visitor_phone', createdAt: 'created_at', updatedAt: 'updated_at' };

  async function getCards() {
    if (!uid()) throw new Error('ورود لازم است.');
    const { data, error } = await supabase.from('listing_cards').select('*').eq('user_id', uid()).order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, CARD_DB));
  }
  async function getCardEvents() {
    if (!uid()) throw new Error('ورود لازم است.');
    const { data, error } = await supabase.from('card_events').select('*').eq('user_id', uid()).order('created_at', { ascending: false }).limit(5000);
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, EVENT_DB));
  }
  async function createCard(c) {
    if (!uid()) throw new Error('ورود لازم است.');
    const row = { user_id: uid(), listing_id: Number(c.listingId), client_id: c.clientId == null ? null : Number(c.clientId), note: c.note, contact_name: c.contactName, contact_phone: c.contactPhone, contact_agency: c.contactAgency || null };
    const { data, error } = await supabase.from('listing_cards').insert(row).select().single();
    if (error) throw error;
    return mapFromDb(data, CARD_DB);
  }
  async function revokeCard(id, revoked) {
    const { error } = await supabase.from('listing_cards').update({ revoked_at: revoked ? new Date().toISOString() : null }).eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }
  async function deleteCard(id) {
    const { error } = await supabase.from('listing_cards').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }
  async function markCardEventsSeen(ids) {
    let q = supabase.from('card_events').update({ seen: true }).eq('user_id', uid()).eq('seen', false);
    if (Array.isArray(ids)) q = q.in('id', ids.map(Number));
    const { error } = await q;
    if (error) throw error;
    try { window.dispatchEvent(new CustomEvent('card-events-seen', { detail: { ids: Array.isArray(ids) ? ids : null } })); } catch (e) { /* بی‌اثر */ }
  }
  /* درخواست‌های دیده‌نشده‌ی «می‌خواهم ببینم» */
  /* ---------- اعلان روی گوشی (Web Push) ---------- */
  async function getPushPublicKey() {
    const { data, error } = await supabase.rpc('push_public_key');
    if (error) throw error;
    return data || null;
  }
  async function savePushSubscription(s) {
    const { error } = await supabase.rpc('push_save_subscription', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_ua: s.userAgent || null });
    if (error) throw error;
  }
  async function removePushSubscription(endpoint) {
    const { error } = await supabase.rpc('push_remove_subscription', { p_endpoint: endpoint });
    if (error) throw error;
  }
  async function sendCardNotifyTest() {
    const { data, error } = await supabase.rpc('card_notify_test');
    if (error) throw error;
    return data === true;
  }
  async function getUnseenWantEvents() {
    if (!uid()) throw new Error('ورود لازم است.');
    const { data, error } = await supabase.from('card_events').select('*').eq('user_id', uid()).eq('kind', 'want').eq('seen', false).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return (data || []).map((r) => mapFromDb(r, EVENT_DB));
  }
  /* اعلان لحظه‌ای (Supabase Realtime): هر رویداد جدید کارت‌های این کاربر */
  let cardChannel = null;
  function subscribeCardEvents(onEvent, onStatus) {
    unsubscribeCardEvents();
    if (!supabase || !uid() || typeof supabase.channel !== 'function') return false;
    const u = uid();
    cardChannel = supabase.channel('card-events-' + u)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'card_events', filter: 'user_id=eq.' + u },
        (p) => { const r = p && p.new; if (r) onEvent(mapFromDb(r, EVENT_DB)); })
      .subscribe((status) => { if (onStatus) onStatus(status); });
    return true;
  }
  function unsubscribeCardEvents() {
    if (cardChannel && supabase) { try { supabase.removeChannel(cardChannel); } catch (e) { /* بی‌اثر */ } }
    cardChannel = null;
  }
  async function countUnseenCardEvents() {
    const { count, error } = await supabase.from('card_events').select('id', { count: 'exact', head: true }).eq('user_id', uid()).eq('seen', false);
    if (error) throw error;
    return count || 0;
  }

  async function deleteListing(id) {
    const { error } = await supabase.from('listings').delete().eq('id', Number(id)).eq('user_id', uid());
    if (error) throw error;
  }
  return {
    isActive, isOffline, recheckConnection, forceOfflineMode, pingServer: serverReachable, init, getUser, signIn, signUp, signOut, isAdmin, faErr,
    subscriptionStatus, refreshProfileIfUnverified, adminSetPlan, adminArchiveUser, adminRestoreUser, adminUserData,
    refreshProfile, getSubscriptionPrices, getSubscriptionConfig, getMySubscriptionRequests, requestSubscription,
    supportCreate, supportReply, supportClose, supportMyList, supportAdminList, supportThread, supportUnreadCount,
  adminGetSubscriptionRequests, adminDecideSubscription, adminGiftDays,
    getOrders, getOrdersCount, getOrder, putOrder, deleteOrder, getDeletedOrders, restoreOrder, permanentlyDeleteOrder, purgeOldTrash,

    getTargetPharmacies, putTargetPharmacy, deleteTargetPharmacy,
    getEstelam, putEstelam, deleteEstelam,
    
    getDeals, putDeal, deleteDeal,
    getCards, getCardEvents, createCard, revokeCard, deleteCard, markCardEventsSeen, countUnseenCardEvents, getUnseenWantEvents, sendCardNotifyTest, getPushPublicKey, savePushSubscription, removePushSubscription, subscribeCardEvents, unsubscribeCardEvents,
    getMyCollabs, requestCollab, respondCollab, cancelCollab, doneCollab, rateCollab,
    getListings, getCollabListings, putListing, deleteListing,
    getClients, putClient, deleteClient, getClientNotes, getClientNotesIndex, addClientNote, deleteClientNote,
    getDailyTasks, addDailyTasks, updateDailyTask, deleteDailyTask, deleteDailyTasks,
    getWeeklyVisits, putWeeklyVisit, markWeeklyVisitDone, deleteWeeklyVisit, addWeeklyVisitsBulk, reorderWeeklyVisits, deleteWeeklyVisitsBulk, updateWeeklyVisitsBulk,
    getSettings, getSetting, setSetting,
    getCart, putCart, clearCart,
    getAllProducts, replaceWarehouseProducts,
    getAllAliases, addAlias, removeAlias, renameAlias, bulkAddAliases,
    getSuggestNames, addSuggestName, addSuggestNamesBulk, removeSuggestName, renameSuggestName,
    getProductAttrs, upsertProductAttrs, deleteProductAttrs, getAttrTypes, addAttrType,
    getProductTags, addProductTag, renameProductTag, reorderProductTags, removeProductTag, addProductTagLinks, removeProductTagLink,
    getAllPackSizes, setPackSize, removePackSize, bulkSetPackSizes,
    getAllFiles, getFile, putFile, deleteFile,
    wipePersonal,
    touchLastSeen, adminListUsers, adminGetOrders, adminDeleteOrder, adminDeleteUser,
    logError, adminGetErrorLogs, adminClearErrorLogs,
    adminListCompanies, adminCreateCompany, adminSetCompanyActive
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Backend = Backend;
if (typeof module !== 'undefined' && module.exports) module.exports = Backend;

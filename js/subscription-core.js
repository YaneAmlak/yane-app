'use strict';
/* ============================================================
   اشتراک — منطق خالص (بدون DOM/دیتابیس؛ قابل تست در Node)
   پلن‌ها: ۳۰ / ۶۰ / ۹۰ روزه (قیمت‌ها از دیتابیس می‌آید؛ اعداد زیر فقط پیش‌فرض نمایش است)
   دوره‌ی آموزشی: ۱۸ روز
   ============================================================ */
const SubscriptionCore = (() => {
  const TRIAL_DAYS = 18;
  const WARN_DAYS = 5;
  const DAY = 86400000;

  /* ترتیب نمایش: بلندترین بالا */
  const PLANS = [
    { days: 90, label: 'سه‌ماهه', badge: 'به‌صرفه‌ترین', amount: 749000 },
    { days: 60, label: 'دو‌ماهه', badge: 'پیشنهادی', amount: 539000 },
    { days: 30, label: 'ماهانه', badge: '', amount: 299000 }
  ];

  /* قیمت‌های دیتابیس روی پیش‌فرض‌ها می‌نشیند (فقط پلن‌های شناخته‌شده) */
  function applyPrices(rows) {
    const by = {};
    (rows || []).forEach((r) => { if (r && Number(r.amount) > 0) by[Number(r.days)] = r; });
    return PLANS.map((p) => {
      const r = by[p.days];
      return Object.assign({}, p, r ? { amount: Number(r.amount), label: r.label || p.label } : {});
    });
  }

  const groupDigits = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  const toFa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const toEn = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const money = (n) => toFa(groupDigits(n));

  /* روزی چند تومان (به نزدیک‌ترین ۱۰) و صرفه‌جویی نسبت به خرید ماهانه (به نزدیک‌ترین ۱٬۰۰۰) */
  const perDay = (plan) => Math.round(plan.amount / plan.days / 10) * 10;
  function saving(plan, plans) {
    const month = (plans || PLANS).find((p) => p.days === 30);
    if (!month || plan.days === 30) return 0;
    const s = month.amount * (plan.days / 30) - plan.amount;
    return s > 0 ? Math.round(s / 1000) * 1000 : 0;
  }

  /* وضعیت اشتراک کاربر: kind = admin | trial | paid | unlimited | expired | suspended */
  function status(user, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    if (!user) return { kind: 'none', daysLeft: 0 };
    if (user.role === 'admin') return { kind: 'admin', daysLeft: Infinity };
    if (user.plan_status === 'suspended') return { kind: 'suspended', daysLeft: 0 };
    if (!user.plan_expires_at) return { kind: 'unlimited', daysLeft: Infinity };
    const exp = new Date(user.plan_expires_at).getTime();
    if (isNaN(exp)) return { kind: 'unlimited', daysLeft: Infinity };
    const left = Math.ceil((exp - now) / DAY);
    const kind = exp <= now ? 'expired' : (user.plan_name === 'trial' ? 'trial' : 'paid');
    const out = { kind, daysLeft: Math.max(0, left), expiresAt: user.plan_expires_at, warn: kind !== 'expired' && left <= WARN_DAYS };
    if (kind === 'trial') {
      out.totalDays = TRIAL_DAYS;
      out.elapsed = Math.min(TRIAL_DAYS, Math.max(0, TRIAL_DAYS - left));
      out.pct = Math.round(out.elapsed / TRIAL_DAYS * 100);
    }
    return out;
  }

  /* تاریخ پایان بعد از تایید: از «پایان فعلی اگر نگذشته، وگرنه امروز» + روزهای پلن */
  function newExpiry(currentISO, days, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const cur = currentISO ? new Date(currentISO).getTime() : NaN;
    const base = !isNaN(cur) && cur > now ? cur : now;
    return new Date(base + days * DAY).toISOString();
  }

  const bad = (m) => Object.assign(new Error(m), { userFacing: true });

  /* اعتبارسنجی فرم پرداخت */
  function validateRequest(f, plans) {
    const days = Number(f && f.days);
    if (!(plans || PLANS).some((p) => p.days === days)) throw bad('یک پلن انتخاب کن.');
    const tracking = toEn(f && f.tracking).replace(/\s+/g, '').trim();
    if (tracking.length < 3) throw bad('کد پیگیری تراکنش را وارد کن.');
    if (tracking.length > 40 || !/^[A-Za-z0-9\-_.]+$/.test(tracking)) throw bad('کد پیگیری فقط حرف انگلیسی و عدد دارد.');
    const l4 = toEn(f && f.last4).replace(/\s+/g, '');
    if (l4 && !/^\d{4}$/.test(l4)) throw bad('۴ رقم آخر کارت باید دقیقاً ۴ عدد باشد.');
    return { days, tracking, last4: l4 || null };
  }

  const REQ_STATUS = { pending: 'در انتظار تایید', approved: 'تایید شد', rejected: 'رد شد' };

  return { TRIAL_DAYS, WARN_DAYS, PLANS, applyPrices, money, toFa, toEn, perDay, saving, status, newExpiry, validateRequest, REQ_STATUS };
})();
if (typeof globalThis !== 'undefined') globalThis.SubscriptionCore = SubscriptionCore;
if (typeof module !== 'undefined' && module.exports) module.exports = SubscriptionCore;

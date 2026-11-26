'use strict';
/* ============================================================
   قراردادها و معامله‌ها (رادار تمدید + پیام بعد از معامله) — منطق خالص
   (بدون DOM/دیتابیس؛ قابل تست در Node)
   ============================================================ */
const DealsCore = (() => {
  const U = (typeof Utils !== 'undefined') ? Utils : require('./utils.js');
  const CC = (typeof ClientsCore !== 'undefined') ? ClientsCore : require('./clients-core.js');
  const bad = (m) => Object.assign(new Error(m), { userFacing: true });

  const LEAD_DEFAULT = 60;    // یادآوری تمدید: چند روز قبل از پایان قرارداد
  const GRACE_DAYS = 45;      // یادآوریِ بعد از معامله که بیشتر از این عقب افتاده، «از دست رفته» است (برای قراردادهای قدیمیِ واردشده)
  const UPCOMING_DAYS = 14;   // «به‌زودی» = سررسید در ۱۴ روز آینده
  const AFTER_MONTHS = [1, 6, 12];
  const RENEW_STALE_DAYS = 30; // بعد از پایان قرارداد این‌قدر هم یادآوری می‌ماند

  const pad = (n) => String(n).padStart(2, '0');
  const parts = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
  const fmt = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysBetween = (aISO, bISO) => { const a = parts(aISO), b = parts(bISO); return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000); };

  /* ماه تقویمی؛ اگر روز در ماه مقصد نبود به آخر ماه می‌رود (۳۱ ژانویه + ۱ ماه = ۲۸ فوریه) */
  function addMonthsISO(iso, n) {
    const [y, m, d] = parts(iso);
    const t = (y * 12 + (m - 1)) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
    return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  }
  function addDaysISO(iso, n) {
    const [y, m, d] = parts(iso);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  const text = (v, max, label) => {
    const s = String(v == null ? '' : v).trim();
    if (s.length > max) throw bad(label + ' حداکثر ' + U.faDigits(max) + ' حرف باشد.');
    return s || null;
  };
  const phone = (v, label) => {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return null;
    const p = CC.normalizePhone(raw);
    if (!CC.isMobile(p) && p.length < 7) throw bad(label + ' معتبر نیست.');
    return p;
  };

  function validateDeal(f) {
    f = f || {};
    if (f.kind !== 'rent' && f.kind !== 'sale') throw bad('نوع معامله را انتخاب کن.');
    const clientName = text(f.clientName, 200, 'نام');
    if (!clientName) throw bad(f.kind === 'rent' ? 'نام مستأجر را وارد کن.' : 'نام خریدار را وارد کن.');
    const dealDate = parts(f.dealDate) ? String(f.dealDate).slice(0, 10) : null;
    if (!dealDate) throw bad('تاریخ معامله را وارد کن.');
    let endDate = null;
    if (f.kind === 'rent') {
      if (!parts(f.endDate)) throw bad('تاریخ پایان قرارداد را وارد کن.');
      endDate = String(f.endDate).slice(0, 10);
      if (endDate <= dealDate) throw bad('تاریخ پایان باید بعد از تاریخ معامله باشد.');
    }
    return {
      kind: f.kind, clientName, clientPhone: phone(f.clientPhone, 'شماره'), otherName: text(f.otherName, 200, 'نام طرف مقابل'),
      otherPhone: phone(f.otherPhone, 'شماره‌ی طرف مقابل'), property: text(f.property, 200, 'مشخصات ملک'),
      dealDate, endDate, trackAfter: f.trackAfter !== false, trackRenewal: f.kind === 'rent' && f.trackRenewal !== false,
      notes: text(f.notes, 500, 'یادداشت')
    };
  }

  /* یادآوری‌ها: { due[], upcoming[] }. هر مورد: { key, dealId, deal, step, state, dueDate, label, daysToEnd }
     • بعد از معامله: ۱، ۶ و ۱۲ ماه (فقط اگر عقب‌افتادگی ≤ GRACE_DAYS)
     • تمدید: LEAD روز قبل از پایان تا ۳۰ روز بعد از پایان */
  function buildReminders(deals, todayISO, opts) {
    const o = Object.assign({ leadDays: LEAD_DEFAULT, graceDays: GRACE_DAYS, upcomingDays: UPCOMING_DAYS }, opts || {});
    const today = todayISO || CC.isoDate(new Date());
    const due = [], upcoming = [];
    const push = (deal, step, dueDate, label, daysToEnd) => {
      const diff = daysBetween(today, dueDate);   // مثبت = آینده
      const item = { key: deal.id + ':' + step, dealId: deal.id, deal, step, dueDate, label, daysToEnd: daysToEnd == null ? null : daysToEnd };
      if (diff <= 0) { item.state = 'due'; due.push(item); }
      else if (diff <= o.upcomingDays) { item.state = 'upcoming'; upcoming.push(item); }
    };
    (deals || []).forEach((deal) => {
      const done = deal.done || {};
      if (deal.trackAfter !== false) {
        AFTER_MONTHS.forEach((n) => {
          const step = 'm' + n;
          if (done[step]) return;
          const d = addMonthsISO(deal.dealDate, n);
          if (daysBetween(today, d) < -o.graceDays) return;
          push(deal, step, d, U.faDigits(n) + ' ماه بعد از معامله');
        });
      }
      if (deal.kind === 'rent' && deal.trackRenewal !== false && deal.endDate && !done.renew) {
        const toEnd = daysBetween(today, deal.endDate);
        if (toEnd >= -RENEW_STALE_DAYS) push(deal, 'renew', addDaysISO(deal.endDate, -o.leadDays), 'تمدید قرارداد', toEnd);
      }
    });
    const byDue = (a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.key).localeCompare(String(b.key));
    return { due: due.sort(byDue), upcoming: upcoming.sort(byDue) };
  }

  const DEFAULT_TEMPLATES = {
    m1: 'سلام {name} عزیز، امیدوارم از {property} راضی باشید و همه‌چیز خوب پیش رفته باشد. اگر کاری از دست من برمی‌آید در خدمتم. {agency}',
    m6: 'سلام {name} عزیز، شش ماه از معامله‌ی ما می‌گذرد؛ خواستم احوالتان را بپرسم. اگر مشکلی هست یا کمکی لازم دارید در خدمتم. {agency}',
    m12: 'سلام {name} عزیز، یک سال از معامله‌ی ما گذشته و خیلی خوشحالم که همراهتان بودم. اگر دوستان یا آشنایانی برای خرید، فروش یا اجاره‌ی ملک کمک می‌خواهند، خوشحال می‌شوم معرفی‌شان کنید. {agency}',
    renewTenant: 'سلام {name} عزیز، قرارداد اجاره‌ی {property} حدود {days} تمام می‌شود. اگر قصد تمدید یا جابه‌جایی دارید خوشحال می‌شوم کمک کنم. {agency}',
    renewOwner: 'سلام {name} عزیز، قرارداد اجاره‌ی {property} حدود {days} تمام می‌شود. برای تمدید یا پیدا کردن مستأجر جدید در خدمتم. {agency}'
  };
  const TEMPLATE_LABELS = { m1: 'پیام ۱ ماه بعد', m6: 'پیام ۶ ماه بعد', m12: 'پیام ۱۲ ماه بعد (درخواست معرفی)', renewTenant: 'تمدید — پیام به مستأجر', renewOwner: 'تمدید — پیام به مالک' };

  function mergeTemplates(saved) {
    const out = {};
    Object.keys(DEFAULT_TEMPLATES).forEach((k) => {
      const s = saved && typeof saved[k] === 'string' ? saved[k].trim() : '';
      out[k] = s && s.length <= 600 ? s : DEFAULT_TEMPLATES[k];
    });
    return out;
  }

  function fillTemplate(tpl, vars) {
    const v = Object.assign({ name: '', property: 'ملک', days: '', agency: '' }, vars || {});
    return String(tpl).replace(/\{(name|property|days|agency)\}/g, (_, k) => v[k] || (k === 'property' ? 'ملک' : '')).replace(/ {2,}/g, ' ').replace(/ +([،.])/g, '$1').trim();
  }

  const daysText = (n) => (n > 1 ? U.faDigits(n) + ' روز دیگر' : n === 1 ? 'فردا' : n === 0 ? 'امروز' : U.faDigits(-n) + ' روز پیش');

  /* پیام‌های آماده‌ی یک یادآوری: [{ to, label, phone, text }] */
  function messagesFor(item, templates, agency) {
    const t = templates || DEFAULT_TEMPLATES, d = item.deal, prop = d.property || '';
    const base = { property: prop, agency: agency || '' };
    if (item.step === 'renew') {
      const days = item.daysToEnd != null && item.daysToEnd >= 0 ? daysText(item.daysToEnd) : 'تمام شده';
      const out = [{ to: 'client', label: (d.clientName || 'مستأجر') + ' (مستأجر)', phone: d.clientPhone || null, text: fillTemplate(t.renewTenant, Object.assign({ name: d.clientName, days }, base)) }];
      if (d.otherName || d.otherPhone) out.push({ to: 'other', label: (d.otherName || 'مالک') + ' (مالک)', phone: d.otherPhone || null, text: fillTemplate(t.renewOwner, Object.assign({ name: d.otherName || '', days }, base)) });
      return out;
    }
    return [{ to: 'client', label: d.clientName, phone: d.clientPhone || null, text: fillTemplate(t[item.step], Object.assign({ name: d.clientName }, base)) }];
  }

  /* شماره‌ی ایران → بین‌المللی برای wa.me؛ بدون شماره: انتخاب مخاطب داخل واتساپ */
  function waLink(phoneNumber, text) {
    let p = CC.normalizePhone(phoneNumber || '').replace(/\D/g, '');
    if (/^09\d{9}$/.test(p)) p = '98' + p.slice(1);
    else if (/^9\d{9}$/.test(p)) p = '98' + p;
    return 'https://wa.me/' + (p.length >= 10 ? p : '') + '?text=' + encodeURIComponent(text);
  }

  /* تنظیمات ذخیره‌شده → مقدار قطعی (فاصله‌ی تمدید ۷ تا ۱۸۰ روز) */
  function normalizeSettings(saved) {
    const n = Number(saved && saved.leadDays);
    return { leadDays: Number.isFinite(n) && n >= 7 && n <= 180 ? Math.round(n) : LEAD_DEFAULT, templates: mergeTemplates(saved && saved.templates) };
  }
  function validateSettings(f) {
    const raw = String((f && f.leadDays) == null ? '' : f.leadDays).trim();
    const n = raw ? CC.parseDecimal(raw) : LEAD_DEFAULT;
    if (isNaN(n) || n < 7 || n > 180) throw bad('فاصله‌ی یادآوری تمدید باید بین ۷ تا ۱۸۰ روز باشد.');
    const templates = {};
    Object.keys(DEFAULT_TEMPLATES).forEach((k) => {
      const s = String((f && f.templates && f.templates[k]) || '').trim();
      if (s.length > 600) throw bad('«' + TEMPLATE_LABELS[k] + '» حداکثر ۶۰۰ حرف باشد.');
      templates[k] = s || DEFAULT_TEMPLATES[k];
    });
    return { leadDays: Math.round(n), templates };
  }

  const markDone = (done, step, todayISO) => Object.assign({}, done || {}, { [step]: todayISO });

  return { LEAD_DEFAULT, GRACE_DAYS, UPCOMING_DAYS, AFTER_MONTHS, DEFAULT_TEMPLATES, TEMPLATE_LABELS, addMonthsISO, addDaysISO, daysBetween,
    validateDeal, buildReminders, mergeTemplates, normalizeSettings, validateSettings, fillTemplate, messagesFor, waLink, markDone, daysText };
})();

if (typeof globalThis !== 'undefined') globalThis.DealsCore = DealsCore;
if (typeof module !== 'undefined' && module.exports) module.exports = DealsCore;

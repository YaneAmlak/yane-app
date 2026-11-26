'use strict';
/* ============================================================
   تبدیل رهن و اجاره — منطق خالص (بدون DOM/دیتابیس؛ قابل تست در Node)
   اصل: «اجاره‌ی ماهانه‌ی معادل» T = اجاره + رهن ÷ ضریب ثابت می‌ماند.
   ضریب = هر ۱ میلیون اجاره معادل چند میلیون رهن است.
   ============================================================ */
const ConverterCore = (() => {
  const U = (typeof Utils !== 'undefined') ? Utils : require('./utils.js');
  const CC = (typeof ClientsCore !== 'undefined') ? ClientsCore : require('./clients-core.js');
  const bad = (m) => Object.assign(new Error(m), { userFacing: true });
  const M = 1e6;
  const money = (n) => CC.fmtShort(n) + ' تومان';

  /* ورودی میلیون تومان → تومان؛ خالی = null */
  function parseMillions(text, label) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    const n = CC.parseDecimal(raw);
    if (isNaN(n) || n < 0 || n > 1e7) throw bad((label || 'مبلغ') + ' معتبر نیست.');
    return Math.round(n * M);
  }

  /* تنظیمات: ضریب (۱ تا ۵۰۰)، پله‌ی رهن (میلیون)، نام مشاوره و لوگو */
  function validateSettings(s) {
    s = s || {};
    const num = (v, lo, hi, label) => {
      const raw = String(v == null ? '' : v).trim();
      if (!raw) return null;
      const n = CC.parseDecimal(raw);
      if (isNaN(n) || n < lo || n > hi) throw bad(label + ' معتبر نیست.');
      return n;
    };
    const ratio = num(s.ratio, 1, 500, 'ضریب تبدیل');
    const stepM = num(s.stepM, 1, 100000, 'پله‌ی رهن');
    return {
      ratio,
      stepM: stepM == null ? 100 : stepM,
      agency: String(s.agency || '').trim().slice(0, 60),
      logo: typeof s.logo === 'string' && s.logo.startsWith('data:image/') && s.logo.length < 200000 ? s.logo : ''
    };
  }

  const equivalent = (deposit, rent, ratio) => (rent || 0) + (deposit || 0) / ratio;
  const rentFor = (T, deposit, ratio) => T - deposit / ratio;
  const depositFor = (T, rent, ratio) => (T - rent) * ratio;

  /* ورودی‌ها + تنظیمات → نتیجه‌ی کامل؛ خطا با throw (userFacing) */
  function calculate(input, settings) {
    const st = settings || {};
    if (!st.ratio) throw bad('اول ضریب تبدیل را در بخش «تنظیمات» وارد کن.');
    const deposit = parseMillions(input.deposit, 'رهن');
    const rent = parseMillions(input.rent, 'اجاره');
    if (!deposit && !rent) throw bad('رهن یا اجاره را وارد کن.');
    const ifDeposit = parseMillions(input.ifDeposit, 'رهن جدید');
    const ifRent = parseMillions(input.ifRent, 'اجاره‌ی جدید');
    const ratio = st.ratio;
    const D = deposit || 0, R = rent || 0;
    const T = Math.round(equivalent(D, R, ratio));
    const step = Math.round((st.stepM || 100) * M);

    /* جدول سناریوها: رهن از (پایه − ۲ پله) تا (پایه + ۴ پله)؛ ردیفی که اجاره‌اش منفی شود «رهن کامل» است و جدول همان‌جا تمام می‌شود */
    const rows = [];
    for (let k = -2; k <= 4; k++) {
      const dep = D + k * step;
      if (dep < 0) continue;
      const r = rentFor(T, dep, ratio);
      if (r <= 0) { rows.push({ k, deposit: Math.round(Math.min(dep, T * ratio)), rent: 0, full: true, base: false }); break; }
      rows.push({ k, deposit: dep, rent: Math.round(r), full: false, base: k === 0 });
    }

    let whatIfDeposit = null, whatIfRent = null;
    if (ifDeposit != null) {
      const r = rentFor(T, ifDeposit, ratio);
      whatIfDeposit = { deposit: ifDeposit, rent: Math.max(0, Math.round(r)), full: r <= 0 };
    }
    if (ifRent != null) {
      const d = depositFor(T, ifRent, ratio);
      whatIfRent = { rent: ifRent, deposit: Math.max(0, Math.round(d)), over: d < 0 };
    }

    return { deposit: D, rent: R, equivalent: T, ratio, step, rows, whatIfDeposit, whatIfRent };
  }

  const rowText = (r) => (r.full ? 'رهن کامل ' + money(r.deposit) + ' (بدون اجاره)' : 'رهن ' + money(r.deposit) + ' ← اجاره ' + money(r.rent));
  const whatIfTitleD = (w) => 'اگر رهن ' + money(w.deposit) + ' شود';
  const whatIfTitleR = (w) => 'اگر اجاره ' + money(w.rent) + ' شود';
  const whatIfValueD = (w) => (w.full ? 'رهن کامل (بدون اجاره)' : 'اجاره‌ی ماهانه ' + money(w.rent));
  const whatIfValueR = (w) => (w.over ? 'بیشتر از اجاره‌ی معادل است' : 'رهن ' + money(w.deposit));

  /* مدل متنی/تصویری کارت — منبع واحد برای تصویر کارت، پیام واتساپ و صفحه
     current: شرایط فعلی ؛ whatIf: سناریوی «اگر…» ؛ rows: جدول سناریوها ؛ lines: فهرست ساده (سازگاری) */
  function buildCardModel(res, settings) {
    const st = settings || {};
    const lines = [];
    lines.push({ kind: 'base', text: 'مبنا: رهن ' + money(res.deposit) + (res.rent ? ' + اجاره ' + money(res.rent) : '') });
    res.rows.forEach((r) => lines.push({ kind: r.base ? 'rowBase' : 'row', text: rowText(r) }));
    const whatIf = [];
    if (res.whatIfDeposit) whatIf.push({ title: whatIfTitleD(res.whatIfDeposit), value: whatIfValueD(res.whatIfDeposit), big: res.whatIfDeposit.full ? 'رهن کامل' : money(res.whatIfDeposit.rent), caption: res.whatIfDeposit.full ? 'بدون اجاره' : 'اجاره‌ی ماهانه' });
    if (res.whatIfRent) whatIf.push({ title: whatIfTitleR(res.whatIfRent), value: whatIfValueR(res.whatIfRent), big: res.whatIfRent.over ? 'بیشتر از معادل' : money(res.whatIfRent.deposit), caption: res.whatIfRent.over ? 'اجاره‌ی معادل کمتر است' : 'رهن' });
    whatIf.forEach((w) => lines.push({ kind: 'whatif', text: w.title + ': ' + w.value }));
    const current = [{ label: 'رهن', value: res.deposit ? money(res.deposit) : '—' }, { label: 'اجاره‌ی ماهانه', value: res.rent ? money(res.rent) : '—' }];
    const rows = res.rows.map((r) => ({ deposit: money(r.deposit), rent: r.full ? 'رهن کامل' : money(r.rent), base: !!r.base, full: !!r.full }));
    return {
      agency: st.agency || '', logo: st.logo || '', title: 'تبدیل رهن و اجاره',
      current, equivalent: money(res.equivalent), whatIf, rows,
      note: 'ضریب تبدیل: هر ۱ میلیون اجاره = ' + U.faDigits(res.ratio) + ' میلیون رهن', lines
    };
  }

  /* پیام واتساپ: ساختاردار و خوانا */
  function buildShareText(res, settings) {
    const m = buildCardModel(res, settings);
    const bar = '━━━━━━━━━━━━━━';
    const out = [];
    if (m.agency) out.push('🏢 *' + m.agency + '*');
    out.push(bar, '🔁 *' + m.title + '*', bar, '', '📌 *شرایط فعلی*');
    m.current.forEach((c) => { if (c.value !== '—') out.push('▫️ ' + c.label + ': ' + c.value); });
    out.push('▫️ اجاره‌ی ماهانه‌ی معادل: ' + m.equivalent);
    m.whatIf.forEach((w) => { out.push('', '🎯 *' + w.title + '*', '✅ ' + w.value); });
    out.push('', '📊 *جدول پیشنهادی*');
    m.rows.forEach((r) => out.push((r.base ? '✅ ' : '▫️ ') + (r.full ? 'رهن کامل ' + r.deposit + ' (بدون اجاره)' : 'رهن ' + r.deposit + ' ← اجاره ' + r.rent) + (r.base ? ' (فعلی)' : '')));
    out.push('', 'ℹ️ ' + m.note);
    return out.join('\n');
  }

  return { M, parseMillions, validateSettings, equivalent, calculate, buildCardModel, buildShareText, money };
})();

if (typeof globalThis !== 'undefined') globalThis.ConverterCore = ConverterCore;
if (typeof module !== 'undefined' && module.exports) module.exports = ConverterCore;

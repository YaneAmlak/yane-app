'use strict';
/* ============================================================
   یادداشت سریع — منطق خالص (بدون DOM/دیتابیس؛ قابل تست در Node)
   • فهرست مشتری‌ها: اخیر (بر اساس آخرین یادداشت) یا جستجو
   • نوع یادداشت، پیگیری بعدی، اعتبارسنجی
   ============================================================ */
const QuickNoteCore = (() => {
  const CC = () => (typeof ClientsCore !== 'undefined' ? ClientsCore : require('./clients-core.js'));

  const KINDS = ['note', 'call', 'visit', 'reject'];
  const FOLLOWUPS = [
    { key: 'today', label: 'امروز', days: 0 },
    { key: 'tomorrow', label: 'فردا', days: 1 },
    { key: 'd2', label: 'پس‌فردا', days: 2 },
    { key: 'd3', label: '۳ روز دیگر', days: 3 },
    { key: 'week', label: 'هفته‌ی دیگر', days: 7 },
    { key: 'custom', label: 'دلخواه…', days: null },
    { key: 'none', label: 'بدون تغییر', days: null }
  ];
  const MAX_TEXT = 2000;

  const kindLabel = (k) => CC().NOTE_KINDS[k] || k;

  /* مشتری‌های بسته‌شده (معامله/از دست رفته) در فهرست سریع نمی‌آیند */
  const isOpen = (c) => c && c.stage !== 'won' && c.stage !== 'lost';

  /* جستجو: نام، شماره، محله؛ حداکثر limit مورد */
  function searchClients(clients, q, limit) {
    const C = CC();
    const out = (clients || []).filter((c) => isOpen(c) && C.matchesQuery(c, q));
    return out.slice(0, limit || 6);
  }

  /* مشتری‌هایی که اخیراً یادداشت داشته‌اند، بعد بقیه بر اساس تازگی ثبت */
  function recentClients(clients, notes, limit) {
    const last = {};
    (notes || []).forEach((n) => {
      const t = String(n.createdAt || '');
      if (!last[n.clientId] || t > last[n.clientId]) last[n.clientId] = t;
    });
    const open = (clients || []).filter(isOpen);
    const stamp = (c) => last[c.id] || String(c.updatedAt || c.createdAt || '');
    return open.slice().sort((a, b) => stamp(b).localeCompare(stamp(a))).slice(0, limit || 6);
  }

  /* کلید پیگیری → تاریخ ISO (یا null برای «بدون تغییر») */
  function followupDate(key, fromISO, customISO) {
    if (key === 'custom') return /^\d{4}-\d{2}-\d{2}$/.test(String(customISO || '')) ? String(customISO) : null;
    const f = FOLLOWUPS.find((x) => x.key === key);
    if (!f || f.days === null) return null;
    return CC().addDaysISO(f.days, fromISO);
  }

  /* خطا با userFacing=true برای نمایش مستقیم به کاربر */
  const bad = (msg) => Object.assign(new Error(msg), { userFacing: true });

  function validateNote(f) {
    if (!f || f.clientId === undefined || f.clientId === null || f.clientId === '') throw bad('یک مشتری انتخاب کن.');
    const kind = f.kind || 'note';
    if (!KINDS.includes(kind)) throw bad('نوع یادداشت معتبر نیست.');
    const text = String(f.text || '').trim();
    if (!text) throw bad('متن یادداشت را بنویس.');
    if (text.length > MAX_TEXT) throw bad('یادداشت خیلی بلند است (حداکثر ' + MAX_TEXT + ' حرف).');
    const fu = FOLLOWUPS.some((x) => x.key === (f.followup || 'none')) ? (f.followup || 'none') : 'none';
    let customDate = null;
    if (fu === 'custom') {
      customDate = /^\d{4}-\d{2}-\d{2}$/.test(String(f.customDate || '')) ? String(f.customDate) : null;
      if (!customDate) throw bad('تاریخ پیگیری را کامل انتخاب کن.');
      const t = f.todayISO || CC().isoDate(new Date());
      if (customDate < t) throw bad('تاریخ پیگیری نباید گذشته باشد.');
    }
    return { clientId: f.clientId, kind, text, followup: fu, customDate };
  }

  return { KINDS, FOLLOWUPS, MAX_TEXT, kindLabel, searchClients, recentClients, followupDate, validateNote };
})();
if (typeof globalThis !== 'undefined') globalThis.QuickNoteCore = QuickNoteCore;
if (typeof module !== 'undefined' && module.exports) module.exports = QuickNoteCore;

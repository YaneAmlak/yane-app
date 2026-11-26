'use strict';
/* ============================================================
   صفحه‌ی «امروز» — منطق خالص (بدون DOM/دیتابیس؛ قابل تست در Node)
   ============================================================ */
const TodayCore = (() => {
  const CC = (typeof ClientsCore !== 'undefined') ? ClientsCore : require('./clients-core.js');
  const COLD_DAYS = 7;   // بی‌تماس‌تر از این تعداد روز = «سرد شده»

  const dayOf = (iso) => String(iso || '').slice(0, 10);
  function daysBetween(aISO, bISO) {
    return Math.round((new Date(aISO + 'T12:00:00') - new Date(bISO + 'T12:00:00')) / 86400000);
  }

  /* آخرین روز یادداشت هر مشتری */
  function lastContactMap(notes) {
    const m = {};
    (notes || []).forEach((n) => { const d = dayOf(n.createdAt); if (d && (!m[n.clientId] || d > m[n.clientId])) m[n.clientId] = d; });
    return m;
  }

  /* خروجی: { overdue[], today[], cold[{client,days}], noFollowup[{client,days}], urgent }
     • مشتری بسته‌شده (معامله/از دست رفته) هرگز نمی‌آید
     • مشتری با پیگیریِ آینده «برنامه‌دار» است و در سرد/بدون‌پیگیری نمی‌آید */
  function buildToday(clients, notes, todayISO) {
    const t = todayISO || CC.isoDate(new Date());
    const active = (clients || []).filter((c) => c.stage !== 'won' && c.stage !== 'lost');
    const byDate = (a, b) => String(a.nextFollowupDate).localeCompare(String(b.nextFollowupDate));
    const overdue = active.filter((c) => CC.followupState(c, t) === 'overdue').sort(byDate);
    const today = active.filter((c) => CC.followupState(c, t) === 'today');
    const last = lastContactMap(notes);
    const cold = [], noFollowup = [];
    active.filter((c) => !c.nextFollowupDate).forEach((c) => {
      const days = daysBetween(t, last[c.id] || dayOf(c.createdAt) || t);
      (days >= COLD_DAYS ? cold : noFollowup).push({ client: c, days });
    });
    cold.sort((a, b) => b.days - a.days);
    noFollowup.sort((a, b) => String(a.client.createdAt).localeCompare(String(b.client.createdAt)));
    return { overdue, today, cold, noFollowup, urgent: overdue.length + today.length };
  }

  const coldText = (days) => (days >= 30 ? 'بیش از ۳۰ روز' : CC.fmtShort(days) + ' روز') + ' بدون تماس';


  /* ---------- پنهان‌کردن ردیف‌ها (✕) ----------
     حالت 'd' = فقط برای امروز (فردا دوباره می‌آید)؛ حالت 't' = تا وقتی «نشانه»ی مشتری عوض نشده
     (یادداشت یا پیگیری تازه که ثبت شود، دوباره نشان داده می‌شود) */
  const attToken = (c, lastMap) => ((lastMap || {})[c.id] || '') + '|' + (c.nextFollowupDate || '') + '|' + (c.stage || '');
  function hideEntry(store, key, mode, today, token) {
    const s = Object.assign({}, store || {});
    s[key] = mode === 't' ? { m: 't', d: today, t: String(token || '') } : { m: 'd', d: today };
    return s;
  }
  function isHidden(store, key, today, token) {
    const e = store && store[key];
    if (!e) return false;
    return e.m === 't' ? e.t === String(token || '') : e.d === today;
  }
  function prune(store, today) {
    const s = {};
    Object.keys(store || {}).forEach((k) => { const e = store[k]; if (e && (e.m === 't' || e.d === today)) s[k] = e; });
    const ks = Object.keys(s);
    if (ks.length > 300) ks.sort((a, b) => String(s[a].d).localeCompare(String(s[b].d))).slice(0, ks.length - 300).forEach((k) => { delete s[k]; });
    return s;
  }

  return { COLD_DAYS, buildToday, lastContactMap, daysBetween, coldText, attToken, hideEntry, isHidden, prune };
})();

if (typeof globalThis !== 'undefined') globalThis.TodayCore = TodayCore;
if (typeof module !== 'undefined' && module.exports) module.exports = TodayCore;

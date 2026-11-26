'use strict';
/* ============================================================
   هشدار لحظه‌ای «مشتری می‌خواهد ملک را ببیند»
   • اپ باز است: Supabase Realtime → بنر بالای صفحه + لرزش + صدا + دکمه‌ی تماس
   • بنر تا زدن «دیدم» (یا باز کردن صفحه‌ی بازدیدها) می‌ماند؛ روی صفحه‌ی خانه هم می‌ماند
   CardAlert.init({ $id, showToast, openCards, onChange }) ؛ CardAlert.start() ؛ CardAlert.stop()
   CardAlert.load() → فهرست هشدارهای دیده‌نشده ؛ CardAlert.dismiss(ids)
   ============================================================ */
const CardAlert = (() => {
  const K = CardsCore;
  let ctx = null, list = [], notified = new Set(), audio = null, started = false, timer = null;
  const esc = (s) => Utils.esc(s);

  function init(c) {
    ctx = c;
    const root = ctx.$id('card-alert-root');
    if (root) root.addEventListener('click', onClick);
    /* مرورگرها صدا را فقط بعد از یک لمس اجازه می‌دهند */
    const unlock = () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !audio) audio = new AC();
        if (audio && audio.state === 'suspended') audio.resume();
      } catch (e) { /* بی‌اثر */ }
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('card-events-seen', () => { refresh(false); });
    document.addEventListener('visibilitychange', () => { if (started && document.visibilityState === 'visible') refresh(true); });
  }

  async function load() {
    if (!Backend.isActive() || Backend.isOffline()) return [];
    const evs = await Backend.getUnseenWantEvents();
    if (!evs.length) return [];
    const [cards, clients, listings] = await Promise.all([Backend.getCards(), Backend.getClients(), Backend.getListings()]);
    return K.wantAlerts(cards, evs, clients, listings);
  }

  /* notify=true: هر درخواست تازه (که قبلاً اعلام نشده) لرزش و صدا دارد */
  async function refresh(notify) {
    let next;
    try { next = await load(); } catch (e) { return list; }
    const fresh = next.filter((a) => !notified.has(String(a.eventId)));
    next.forEach((a) => notified.add(String(a.eventId)));
    list = next;
    paint();
    if (notify && fresh.length) alarm();
    if (ctx && ctx.onChange) ctx.onChange(list);
    return list;
  }

  function alarm() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch (e) { /* بی‌اثر */ }
    try {
      if (!audio || audio.state !== 'running') return;
      [0, 0.28, 0.56].forEach((t, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, audio.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.24);
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.26);
      });
    } catch (e) { /* بی‌اثر */ }
  }

  /* همه‌ی درخواست‌های دیده‌نشده زیر هم: اسم، ملک، ساعت، تماس و «دیدم» برای هرکدام */
  function paint() {
    const root = ctx && ctx.$id('card-alert-root'); if (!root) return;
    if (!list.length) { root.innerHTML = ''; return; }
    const rows = list.map((a) => `<div class="ca-row">
        <div class="ca-text"><b>${esc(a.clientName || 'یک مشتری (نام ثبت نشده)')}</b><div class="ca-sub">${esc(a.listingTitle)}${a.timeText ? ' · ' + esc(a.timeText) : ''}${a.phone ? ' · ' + esc(Utils.faText(a.phone)) : ''}</div></div>
        <div class="ca-actions">
          ${a.telHref ? `<a class="ca-btn ca-call" href="${esc(a.telHref)}" data-ca-call="1">📞</a>` : ''}
          <button type="button" class="ca-btn" data-ca-one="${esc(a.eventId)}">دیدم</button>
        </div></div>`).join('');
    root.innerHTML = `<div class="card-alert" role="alert">
      <div class="ca-head"><b>🙋 ${list.length > 1 ? Utils.faDigits(list.length) + ' درخواست بازدید' : 'درخواست بازدید'}</b>
        <span><button type="button" class="ca-btn" data-ca-open="1">بازدیدها</button>${list.length > 1 ? '<button type="button" class="ca-btn" data-ca-all="1">دیدم همه</button>' : ''}</span></div>
      <div class="ca-list">${rows}</div></div>`;
  }

  async function dismiss(ids) {
    try { await Backend.markCardEventsSeen(ids && ids.length ? ids : undefined); }
    catch (e) { if (ctx) ctx.showToast('خطا: ' + Backend.faErr(e), 'error'); return; }
    await refresh(false);
  }

  function onClick(e) {
    if (e.target.closest('[data-ca-call]')) return;   // خودِ لینک تماس
    if (e.target.closest('[data-ca-open]')) { if (ctx.openCards) ctx.openCards(); return; }
    const one = e.target.closest('[data-ca-one]');
    if (one) { dismiss([one.dataset.caOne]); return; }
    if (e.target.closest('[data-ca-all]')) { dismiss(list.map((a) => a.eventId)); }
  }

  function start() {
    if (!ctx || started || !Backend.isActive() || Backend.isOffline()) return;
    started = true;
    refresh(false);
    Backend.subscribeCardEvents((ev) => { if (ev && ev.kind === 'want') refresh(true); }, (status) => {
      /* بعد از قطع و وصل شدن اتصال، موارد از دست‌رفته را بگیر */
      if (status === 'SUBSCRIBED') refresh(true);
    });
    timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(true); }, 60000);   // پشتیبان اگر اتصال زنده قطع شد
  }

  function stop() {
    started = false; list = []; notified = new Set();
    if (timer) { clearInterval(timer); timer = null; }
    try { Backend.unsubscribeCardEvents(); } catch (e) { /* بی‌اثر */ }
    paint();
  }

  return { init, start, stop, load, dismiss, refresh };
})();
if (typeof globalThis !== 'undefined') globalThis.CardAlert = CardAlert;

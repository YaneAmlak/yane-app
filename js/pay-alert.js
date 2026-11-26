'use strict';
/* ============================================================
   هشدار «درخواست پرداخت/تمدید در انتظار تایید» — فقط برای مدیر
   • هماهنگ با هشدار کارت‌ها (CardAlert): بنر بالای صفحه + لرزش + صدا برای درخواست تازه
   • روی صفحه‌ی خانه داخل «امروز» دیده می‌شود (Today)؛ بنر شناور روی بقیه‌ی صفحه‌ها (CSS)
   • تا وقتی درخواست تایید/رد نشده بماند، جلوی چشم می‌ماند؛ تایید فقط از صفحه‌ی مدیریت
   PayAlert.init({ $id, showToast, openAdmin, onChange }) ؛ PayAlert.start() ؛ PayAlert.stop()
   PayAlert.load() → فهرست درخواست‌های در انتظار ؛ PayAlert.refresh(notify)
   ============================================================ */
const PayAlert = (() => {
  let ctx = null, list = [], notified = new Set(), audio = null, started = false, timer = null;
  const esc = (s) => Utils.esc(s);

  function init(c) {
    ctx = c;
    const root = ctx.$id('pay-alert-root');
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
    document.addEventListener('visibilitychange', () => { if (started && document.visibilityState === 'visible') refresh(true); });
  }

  const isAdmin = () => { try { return !!(Backend.isActive() && !Backend.isOffline() && Backend.isAdmin()); } catch (e) { return false; } };

  async function load() {
    if (!isAdmin()) return [];
    try { return (await Backend.adminGetSubscriptionRequests('pending')) || []; } catch (e) { return []; }
  }

  /* notify=true: هر درخواست تازه (که قبلاً اعلام نشده) لرزش و صدا دارد */
  async function refresh(notify) {
    const next = await load();
    const fresh = next.filter((q) => !notified.has(String(q.id)));
    next.forEach((q) => notified.add(String(q.id)));
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

  /* متن یک درخواست: نام — مبلغ — مدت */
  function titleOf(q) {
    const who = q.full_name || q.email || 'کاربر';
    const money = typeof SubscriptionCore !== 'undefined' ? SubscriptionCore.money(q.amount) : String(q.amount);
    return who + ' — ' + money + ' تومان (' + Utils.faDigits(q.days) + ' روز)';
  }
  const subOf = (q) => 'کد پیگیری: ' + q.tracking_code + (q.created_at ? ' · ' + Utils.faDate(q.created_at) : '');

  function paint() {
    const root = ctx && ctx.$id('pay-alert-root'); if (!root) return;
    if (!list.length) { root.innerHTML = ''; return; }
    const SHOW = 3;
    const rows = list.slice(0, SHOW).map((q) => `<div class="ca-row">
        <div class="ca-text"><b>${esc(titleOf(q))}</b><div class="ca-sub">${esc(subOf(q))}</div></div></div>`).join('');
    const more = list.length > SHOW ? `<div class="ca-more">و ${Utils.faDigits(list.length - SHOW)} درخواست دیگر</div>` : '';
    root.innerHTML = `<div class="card-alert pay-alert" role="alert">
      <div class="ca-head"><b>💳 ${list.length > 1 ? Utils.faDigits(list.length) + ' درخواست پرداخت' : 'درخواست پرداخت'} در انتظار تایید</b>
        <span><button type="button" class="ca-btn" data-pa-open="1">بررسی</button></span></div>
      <div class="ca-list">${rows}</div>${more}</div>`;
  }

  function onClick(e) {
    if (e.target.closest('[data-pa-open]') && ctx.openAdmin) ctx.openAdmin();
  }

  function start() {
    if (!ctx || started || !isAdmin()) return;
    started = true;
    refresh(false);
    timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(true); }, 30000);
  }

  function stop() {
    started = false; list = []; notified = new Set();
    if (timer) { clearInterval(timer); timer = null; }
    paint();
  }

  return { init, start, stop, load, refresh, titleOf, subOf };
})();
if (typeof globalThis !== 'undefined') globalThis.PayAlert = PayAlert;

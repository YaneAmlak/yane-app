'use strict';
/* ============================================================
   هشدار محلی (اعلان روی خودِ گوشی) برای APK اندروید — فقط داخل Capacitor
   • WebView اندروید Web Push ندارد؛ پس هشدار کارهای ساعت‌دار با افزونه‌ی بومی LocalNotifications روی گوشی زمان‌بندی می‌شود
   • بدون سرور و بدون سرویس گوگل؛ حتی وقتی اپ بسته است می‌آید
   • LocalReminders.init({ showScreen }) ؛ .available() ؛ .ensurePermission() ؛ .sync(DailyPlanCore, tasks, cfg) ؛ .plan(...)
   • plan() تابعِ خالص است (برای تست): فهرست اعلان‌های آینده را از روی کارها و تنظیم هشدار می‌سازد
   ============================================================ */
const LocalReminders = (() => {
  const g = globalThis;
  const CHANNEL = 'yane-reminders';
  const HORIZON_DAYS = 14;     // فقط کارهای دو هفته‌ی آینده زمان‌بندی می‌شود
  const MAX_ITEMS = 60;
  let ctx = null, lastSig = '', running = false, queued = null;

  const cap = () => { const c = g.Capacitor; return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() ? c : null; };
  const plugin = () => { const c = cap(); return c && c.Plugins && c.Plugins.LocalNotifications ? c.Plugins.LocalNotifications : null; };
  const available = () => !!plugin();
  const fa = (n) => (g.Utils && g.Utils.faDigits ? g.Utils.faDigits(n) : String(n));

  function whenText(off) {
    if (off === 0) return 'الان';
    if (off === 1440) return 'فردا';
    if (off % 60 === 0) return fa(off / 60) + ' ساعت دیگر';
    return fa(off) + ' دقیقه دیگر';
  }

  /* فهرست اعلان‌های آینده؛ شناسه‌ی هر اعلان از روی (شناسه‌ی کار، جایگاه زمان) ثابت می‌ماند */
  function plan(P, tasks, cfg, nowMs, limit) {
    const c = P.normalizeReminders(cfg);
    if (!c.on) return [];
    const out = [];
    (tasks || []).forEach((t) => {
      if (!P.taskReminds(t, c)) return;
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.date || '')), tm = /^(\d{2}):(\d{2})/.exec(String(t.time || ''));
      if (!d || !tm) return;
      const due = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(tm[1]), Number(tm[2]), 0, 0).getTime();
      c.offsets.forEach((off) => {
        const at = due - off * 60000;
        if (at <= nowMs + 5000 || at > nowMs + HORIZON_DAYS * 86400000) return;
        const k = P.REMIND_OPTIONS.indexOf(off);
        out.push({
          id: (Number(t.id) % 200000) * 10 + k, at, taskId: t.id, off,
          title: 'یانه · یادآوری',
          body: String(t.title || '').slice(0, 120) + ' — ' + whenText(off) + ' (' + P.timeText(t.time) + ')'
        });
      });
    });
    out.sort((a, b) => a.at - b.at);
    return out.slice(0, limit || MAX_ITEMS);
  }

  async function permission(ask) {
    const LN = plugin();
    if (!LN) return 'unsupported';
    let p = await LN.checkPermissions();
    let st = p && p.display;
    if (st === 'granted') return 'granted';
    if (!ask || st === 'denied') return st || 'denied';
    p = await LN.requestPermissions();
    return (p && p.display) || 'denied';
  }
  /* true = اجازه هست (و در صورت نیاز از کاربر پرسیده می‌شود) */
  async function ensurePermission() { return (await permission(true)) === 'granted'; }

  async function run(P, tasks, cfg) {
    const LN = plugin();
    if (!LN) return false;
    const list = plan(P, tasks, cfg, Date.now());
    const sig = JSON.stringify(list.map((x) => [x.id, x.at, x.body]));
    if (sig === lastSig) return true;                       // چیزی عوض نشده
    if ((await permission(false)) !== 'granted') return false;
    try { await LN.createChannel({ id: CHANNEL, name: 'یادآوری کارها', description: 'هشدار کارهای ساعت‌دار برنامه‌ی روزانه', importance: 4, visibility: 1, vibration: true }); } catch (e) { /* کانال از قبل هست */ }
    const pend = await LN.getPending();
    if (pend && pend.notifications && pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
    if (list.length) {
      await LN.schedule({ notifications: list.map((x) => ({
        id: x.id, title: x.title, body: x.body, channelId: CHANNEL,
        schedule: { at: new Date(x.at), allowWhileIdle: true },
        extra: { screen: 'quick-note' }
      })) });
    }
    lastSig = sig;
    return true;
  }

  /* همزمانی امن: اگر حین کار، درخواست تازه‌تری رسید، بعد از پایان فقط آخرینش اجرا می‌شود */
  async function sync(P, tasks, cfg) {
    if (!available()) return false;
    if (running) { queued = [P, tasks, cfg]; return true; }
    running = true;
    try { return await run(P, tasks, cfg); }
    catch (e) { return false; }
    finally {
      running = false;
      if (queued) { const q = queued; queued = null; sync(q[0], q[1], q[2]); }
    }
  }

  function init(c) {
    ctx = c;
    const LN = plugin();
    if (!LN || typeof LN.addListener !== 'function') return;
    try {
      LN.addListener('localNotificationActionPerformed', (ev) => {
        const s = ev && ev.notification && ev.notification.extra && ev.notification.extra.screen;
        if (/^[a-z-]{1,30}$/.test(String(s || '')) && ctx && ctx.showScreen) ctx.showScreen(s);
      });
    } catch (e) { /* بی‌اثر */ }
  }

  return { init, available, ensurePermission, sync, plan, whenText };
})();
if (typeof globalThis !== 'undefined') globalThis.LocalReminders = LocalReminders;
if (typeof module !== 'undefined' && module.exports) module.exports = LocalReminders;

'use strict';
/* ============================================================
   اعلان مستقیم روی گوشی (Web Push) — سمت اپ
   Push.init({ showScreen }) ؛ Push.status() ؛ Push.enable() ؛ Push.disable()
   • یک‌بار اجازه‌ی مرورگر؛ بعدش بدون ربات و بدون شناسه‌ی چت
   • اشتراک دستگاه در سرور ذخیره می‌شود (push_save_subscription) و سرور هنگام «می‌خواهم ببینم» اعلان می‌فرستد
   • اندروید: مستقیم؛ آیفون: فقط بعد از «Add to Home Screen»
   ============================================================ */
const Push = (() => {
  let ctx = null;
  const g = globalThis;

  /* کلید عمومی VAPID (base64url) → Uint8Array برای subscribe */
  function urlBase64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (String(b64).length % 4)) % 4);
    const raw = g.atob((String(b64) + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  const fail = (m) => Object.assign(new Error(m), { userFacing: true });

  const supported = () => !!(g.navigator && 'serviceWorker' in g.navigator && 'PushManager' in g && 'Notification' in g);
  const isIOS = () => /iPhone|iPad|iPod/.test((g.navigator && g.navigator.userAgent) || '');
  const isStandalone = () => {
    try { return !!(g.navigator.standalone || (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches)); } catch (e) { return false; }
  };
  const needsInstall = () => isIOS() && !isStandalone();

  async function registration() {
    const ready = g.navigator.serviceWorker.ready;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(fail('سرویس‌ورکر آماده نیست؛ صفحه را یک بار تازه کن.')), 6000));
    return Promise.race([ready, timeout]);
  }

  /* وضعیت برای نمایش در صفحه: { state: unsupported|install|denied|unconfigured|off|on } */
  async function status() {
    if (!supported()) return { state: 'unsupported' };
    if (needsInstall()) return { state: 'install' };
    if (g.Notification.permission === 'denied') return { state: 'denied' };
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub && g.Notification.permission === 'granted') return { state: 'on' };
    } catch (e) { /* بی‌اثر؛ خاموش فرض می‌شود */ }
    return { state: 'off' };
  }

  async function enable() {
    if (!supported()) throw fail('این مرورگر اعلان مستقیم را پشتیبانی نمی‌کند.');
    if (needsInstall()) throw fail('روی آیفون اول اپ را به صفحه‌ی اصلی اضافه کن (Share ← Add to Home Screen)، بعد از آن باز کن.');
    const key = await Backend.getPushPublicKey();
    if (!key) throw fail('اعلان روی گوشی هنوز در سرور راه‌اندازی نشده؛ به مدیر بگو.');
    const perm = g.Notification.permission === 'granted' ? 'granted' : await g.Notification.requestPermission();
    if (perm !== 'granted') throw fail('اجازه‌ی اعلان داده نشد. از تنظیمات مرورگر برای این سایت فعالش کن.');
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    const j = sub.toJSON ? sub.toJSON() : sub;
    await Backend.savePushSubscription({ endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth, userAgent: (g.navigator.userAgent || '').slice(0, 300) });
    return true;
  }

  async function disable() {
    if (!supported()) return false;
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    try { await Backend.removePushSubscription(sub.endpoint); } catch (e) { /* سرور نرسید؛ ادامه می‌دهیم */ }
    await sub.unsubscribe();
    return true;
  }

  /* لمس اعلان وقتی اپ باز است: سرویس‌ورکر پیام می‌دهد تا صفحه عوض شود */
  function init(c) {
    ctx = c;
    try {
      if (g.navigator && g.navigator.serviceWorker) {
        g.navigator.serviceWorker.addEventListener('message', (e) => {
          const d = e && e.data;
          if (d && d.type === 'open-screen' && /^[a-z-]{1,30}$/.test(String(d.screen || '')) && ctx && ctx.showScreen) ctx.showScreen(d.screen);
        });
      }
    } catch (e) { /* بی‌اثر */ }
  }

  return { init, status, enable, disable, supported, needsInstall, urlBase64ToUint8Array };
})();
if (typeof globalThis !== 'undefined') globalThis.Push = Push;
if (typeof module !== 'undefined' && module.exports) module.exports = Push;

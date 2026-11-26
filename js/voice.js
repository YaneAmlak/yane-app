'use strict';
/* ============================================================
   دیکته‌ی صوتی فارسی — ماژول مشترک (یادداشت سریع، برنامه‌ی روزانه)
   • مرورگر/PWA: تشخیص گفتار خودِ مرورگر (Web Speech API، fa-IR)
   • APK اندروید (Capacitor): افزونه‌ی بومی SpeechRecognition (WebView اندروید Web Speech API را پشتیبانی نمی‌کند)
   • هیچ فایل صوتی ذخیره یا ارسال نمی‌شود
   • مرورگرهای بدون پشتیبانی (مثل بعضی آیفون‌ها): دکمه‌ی میکروفون مخفی می‌شود و کاربر از میکروفون کیبورد استفاده می‌کند
   Voice.supported(env?) ؛ Voice.create(opts) → { start, stop, toggle, active }
   Voice.attach({ textarea, button, status, onChange, env? }) → { supported, stop }
   Voice.stopAll()
   ============================================================ */
const Voice = (() => {
  const MAX_MS = 120000;   // سقف یک نوبت ضبط
  const live = new Set();

  const globalEnv = () => (typeof window !== 'undefined' ? window : globalThis);
  const getCtor = (env) => { const e = env || globalEnv(); return e.SpeechRecognition || e.webkitSpeechRecognition || null; };
  /* داخل APK (Capacitor) فقط افزونه‌ی بومی؛ بدون آن (ساخت قدیمی APK) دکمه مخفی می‌شود، نه خطای «مجاز نیست» */
  const nativeCap = (env) => { const c = (env || globalEnv()).Capacitor; return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() ? c : null; };
  const nativePlugin = (env) => { const c = nativeCap(env); return c && c.Plugins && c.Plugins.SpeechRecognition ? c.Plugins.SpeechRecognition : null; };
  const supported = (env) => (nativeCap(env) ? !!nativePlugin(env) : !!getCtor(env));

  const ERRORS = {
    'not-allowed': 'دسترسی به میکروفون مجاز نیست. در تنظیمات مرورگر اجازه‌ی میکروفون را بده.',
    'service-not-allowed': 'دسترسی به میکروفون مجاز نیست. در تنظیمات مرورگر اجازه‌ی میکروفون را بده.',
    'audio-capture': 'میکروفون پیدا نشد.',
    'network': 'برای تشخیص گفتار به اینترنت نیاز است.',
    'language-not-supported': 'زبان فارسی روی این گوشی پشتیبانی نمی‌شود.',
    'native-denied': 'اجازه‌ی میکروفون داده نشد. در تنظیمات گوشی › برنامه‌ها › Yane › مجوزها، میکروفون را روشن کن.',
    'native-unavailable': 'تشخیص گفتار روی این گوشی فعال نیست. برنامه‌ی Google را نصب یا به‌روز کن.'
  };

  /* ---------- نسخه‌ی بومی (APK) ----------
     افزونه هر نوبت را با سکوتِ کاربر تمام می‌کند؛ آخرین نتیجه‌ی موقت همان نتیجه‌ی نهایی است و نوبت بعدی خودکار شروع می‌شود. */
  function createNative(o, plug) {
    const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
    let want = false, state = 'idle', timer = null, last = '', restarts = 0, handles = [];
    const setState = (s) => { if (s !== state) { state = s; if (o.onState) o.onState(s); } };
    const commit = () => { const t = last; last = ''; if (t && o.onFinal) o.onFinal(t); if (o.onInterim) o.onInterim(''); };
    const fail = (code) => { want = false; if (o.onError) o.onError(code, ERRORS[code] || 'تشخیص گفتار انجام نشد. دوباره امتحان کن.'); finish(); };
    function finish() {
      want = false;
      if (timer) { ct(timer); timer = null; }
      handles.forEach((h) => { try { if (h && h.remove) h.remove(); } catch (e) { /* بی‌اثر */ } });
      handles = []; last = ''; restarts = 0;
      live.delete(api);
      if (o.onInterim) o.onInterim('');
      setState('idle');
    }
    const listen = () => plug.start({ language: o.lang || 'fa-IR', maxResults: 1, partialResults: true, popup: false });
    async function begin() {
      try {
        const perm = await plug.requestPermissions();
        const granted = perm && (perm.speechRecognition === 'granted' || perm.speechRecognition === undefined);
        if (!granted) return fail('native-denied');
        const av = plug.available ? await plug.available() : { available: true };
        if (av && av.available === false) return fail('native-unavailable');
        if (!want) return;   // کاربر وسط مجوزخواهی منصرف شد
        handles.push(await plug.addListener('partialResults', (d) => {
          const m = d && (d.matches || d.value);
          const t = String((m && m[0]) || '').trim();
          if (t) { last = t; restarts = 0; if (o.onInterim) o.onInterim(t); }
        }));
        handles.push(await plug.addListener('listeningState', async (d) => {
          if (!d || d.status !== 'stopped') return;
          commit();
          if (want && restarts < 6) { restarts++; try { await listen(); } catch (e) { fail('native-unavailable'); } } else finish();
        }));
        await listen();
      } catch (e) {
        const msg = String((e && e.message) || e || '').toLowerCase();
        fail(/permission|denied/.test(msg) ? 'native-denied' : 'native-unavailable');
      }
    }
    function start() {
      if (want) return true;
      want = true; live.add(api); setState('listening');
      timer = st(() => stop(), MAX_MS);
      begin();
      return true;
    }
    async function stop() {
      if (!want) return;
      want = false;
      try { await plug.stop(); } catch (e) { /* بی‌اثر */ }
      commit();
      finish();
    }
    const api = { start, stop, toggle: () => (want ? (stop(), false) : start()), active: () => want };
    return api;
  }

  /* opts: { lang, onInterim(text), onFinal(text), onState(state), onError(code, message), env, now, setTimeout, clearTimeout } */
  function create(opts) {
    const o = opts || {};
    if (nativeCap(o.env)) { const plug = nativePlugin(o.env); return plug ? createNative(o, plug) : null; }
    const Ctor = getCtor(o.env);
    if (!Ctor) return null;
    const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
    let rec = null, want = false, state = 'idle', timer = null, silentEnds = 0;
    let seen = -1;   // آخرین نتیجه‌ی نهایی‌ای که اعلام شد (مرورگرهای اندروید گاهی تکراری می‌فرستند)

    const setState = (s) => { if (s !== state) { state = s; if (o.onState) o.onState(s); } };

    function build() {
      const r = new Ctor();
      r.lang = o.lang || 'fa-IR';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (ev) => {
        silentEnds = 0;
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          const text = String((res[0] && res[0].transcript) || '').trim();
          if (!text) continue;
          if (res.isFinal) { if (i > seen) { seen = i; if (o.onFinal) o.onFinal(text); } }
          else interim += (interim ? ' ' : '') + text;
        }
        if (o.onInterim) o.onInterim(interim);
      };
      r.onerror = (ev) => {
        const code = ev && ev.error;
        if (code === 'no-speech' || code === 'aborted') return;   // سکوت: خودِ onend دوباره شروع می‌کند
        want = false;
        if (o.onError) o.onError(code, ERRORS[code] || 'تشخیص گفتار انجام نشد. دوباره امتحان کن.');
      };
      r.onend = () => {
        if (want && silentEnds < 4) { silentEnds++; seen = -1; try { r.start(); return; } catch (e) { /* ادامه: پایان */ } }
        finish();
      };
      return r;
    }

    function finish() {
      want = false;
      if (timer) { ct(timer); timer = null; }
      rec = null; seen = -1; silentEnds = 0;
      live.delete(api);
      if (o.onInterim) o.onInterim('');
      setState('idle');
    }

    function start() {
      if (want) return true;
      try { rec = build(); want = true; seen = -1; silentEnds = 0; rec.start(); }
      catch (e) { want = false; rec = null; if (o.onError) o.onError('start', 'شروع میکروفون ممکن نشد.'); return false; }
      live.add(api);
      setState('listening');
      timer = st(() => stop(), MAX_MS);
      return true;
    }
    function stop() {
      if (!want && !rec) return;
      want = false;
      try { if (rec) rec.stop(); } catch (e) { /* بی‌اثر */ }
      if (!rec) finish();
    }

    const api = { start, stop, toggle: () => (want ? (stop(), false) : start()), active: () => want };
    return api;
  }

  /* اتصال به یک کادر متن و یک دکمه. متنِ از قبل نوشته‌شده حفظ می‌شود؛ هر جمله‌ی تازه به انتها اضافه می‌شود. */
  function attach(a) {
    const { textarea, button, status } = a;
    const env = a.env;
    if (!textarea || !button) return { supported: false, stop() {} };
    if (!supported(env)) { button.hidden = true; if (status) status.textContent = ''; return { supported: false, stop() {} }; }
    button.hidden = false;
    let base = '', committed = '';
    const join = (x, y) => (x && y ? x.replace(/\s+$/, '') + ' ' + y : x + y);
    const paint = (interim) => {
      textarea.value = join(join(base, committed), interim || '');
      if (a.onChange) a.onChange(textarea.value);
      try { textarea.dispatchEvent(new (env && env.Event ? env.Event : Event)('input', { bubbles: true })); } catch (e) { /* بی‌اثر */ }
    };
    const setStatus = (t, isErr) => { if (status) { status.textContent = t || ''; status.classList.toggle('is-err', !!isErr); } };
    const ctl = create({
      env,
      onInterim: (t) => { paint(t); },
      onFinal: (t) => { committed = join(committed, t); paint(''); },
      onState: (s) => {
        const on = s === 'listening';
        button.classList.toggle('is-listening', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.setAttribute('aria-label', on ? 'توقف ضبط' : 'شروع گفتن');
        if (on) setStatus('در حال گوش دادن… صحبت کن، بعد دوباره بزن تا تمام شود.'); else if (!status || !status.classList.contains('is-err')) setStatus('');
      },
      onError: (code, msg) => { setStatus(msg, true); }
    });
    button.addEventListener('click', () => {
      if (ctl.active()) { ctl.stop(); return; }
      base = textarea.value || ''; committed = '';
      setStatus('');
      ctl.start();
    });
    return { supported: true, stop: () => ctl.stop() };
  }

  const stopAll = () => { Array.from(live).forEach((c) => c.stop()); };

  return { supported, create, attach, stopAll, ERRORS, MAX_MS };
})();
if (typeof globalThis !== 'undefined') globalThis.Voice = Voice;
if (typeof module !== 'undefined' && module.exports) module.exports = Voice;

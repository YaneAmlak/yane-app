'use strict';
/* ============================================================
   برنامه‌ی روزانه — رابط کاربری (تب دومِ صفحه‌ی «یادداشت سریع»)
   • ماژول مستقل از QuickNote؛ فقط روی شناسه‌های dp-* و تب‌ها (qn-tabs) کار می‌کند
   • ورودی: متن یا صدا (Voice) → تحلیل (DailyPlanCore.parse) → مرور و اصلاح → ثبت
   • داده فقط روی سرور؛ هیچ‌چیز در گوشی ذخیره نمی‌شود
   DailyPlan.init({ $id, showToast, showSheet, showDialog, openClient }) ؛ DailyPlan.render() ؛ DailyPlan.dueCount()
   ============================================================ */
const DailyPlan = (() => {
  const P = DailyPlanCore;
  let ctx = null;
  const st = { tasks: [], clients: [], day: null, review: null, usedVoice: false, mic: null, busy: false, rem: P.normalizeReminders(null), askedPush: false };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);
  const today = () => P.todayISO();
  const isOpen = (c) => c && c.stage !== 'won' && c.stage !== 'lost';
  const clientOf = (t) => (t.clientId == null ? null : st.clients.find((c) => String(c.id) === String(t.clientId)) || null);
  const fa = (n) => Utils.faDigits(n);

  const CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const MIC_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  function init(c) {
    ctx = c;
    $('screen-quick-note').dataset.tab = 'plan';   // این صفحه فقط «برنامه‌ی روزانه» است
    $('dp-body').addEventListener('click', onClick);
    const mic = Voice.attach({ textarea: $('dp-text'), button: $('dp-mic'), status: $('dp-mic-status'), onChange: () => { st.usedVoice = true; } });
    st.mic = mic;
    $('dp-mic-hint').hidden = mic.supported;
    $('dp-mic').innerHTML = MIC_SVG;
  }

  function setTab(tab) {
    const sc = $('screen-quick-note');
    sc.dataset.tab = tab === 'plan' ? 'plan' : 'note';
    const tabs = $('qn-tabs');   // در این نسخه تب‌ها حذف شده‌اند؛ نبودنشان خطا نیست
    if (tabs) tabs.querySelectorAll('[data-qn-tab]').forEach((b) => { const on = b.dataset.qnTab === sc.dataset.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (sc.dataset.tab === 'plan') render(); else if (typeof Voice !== 'undefined') Voice.stopAll();
  }

  /* ---------- بارگذاری ---------- */
  async function load() {
    const t = today();
    const [tasks, clients, rem] = await Promise.all([
      Backend.getDailyTasks(P.addDays(t, -30)), Backend.getClients(),
      Backend.getSetting('daily_reminders', null).catch(() => null)   // تنظیم هشدار؛ نبودنش خطا نیست
    ]);
    st.rem = P.normalizeReminders(rem);
    st.tasks = tasks;
    st.clients = (clients || []).filter(isOpen);
  }

  async function render() {
    if (!ctx) return;
    if ($('screen-quick-note').dataset.tab !== 'plan') return;   // تب یادداشت مشتری است؛ بی‌خودی بارگذاری نکن
    const guard = $('dp-guard'), main = $('dp-main');
    if (!Backend.isActive()) { guard.textContent = 'این بخش نیاز به ورود به حساب دارد.'; guard.hidden = false; main.hidden = true; return; }
    guard.hidden = true; main.hidden = false;
    st.day = today();   // هر بار که صفحه باز می‌شود، همیشه روی روز جاری
    try { await load(); }
    catch (e) { guard.textContent = 'خطا: ' + Backend.faErr(e); guard.hidden = false; main.hidden = true; return; }
    paint();
  }

  /* شمارنده‌ی صفحه‌ی «امروز» (کارهای باز امروز + عقب‌افتاده) */
  async function dueCount() {
    if (!Backend.isActive() || Backend.isOffline()) return { open: 0, overdue: 0, total: 0 };
    const tasks = await Backend.getDailyTasks(today());
    return P.dueCount(tasks, today());
  }

  /* ---------- نمایش ---------- */
  /* هشدار محلی (فقط داخل APK): با هر تغییرِ کارها یا تنظیم، زمان‌بندی روی گوشی به‌روز می‌شود */
  function syncLocal() {
    try { if (typeof LocalReminders !== 'undefined' && LocalReminders.available()) LocalReminders.sync(P, st.tasks, st.rem).catch(() => {}); } catch (e) { /* بی‌اثر */ }
  }
  /* بدون باز کردن صفحه (مثلاً هنگام شروع اپ): کارها و تنظیم را می‌خواند و هشدارها را زمان‌بندی می‌کند */
  async function syncReminders() {
    try {
      if (typeof LocalReminders === 'undefined' || !LocalReminders.available() || !Backend.isActive() || Backend.isOffline()) return;
      const [tasks, rem] = await Promise.all([Backend.getDailyTasks(today()), Backend.getSetting('daily_reminders', null).catch(() => null)]);
      st.rem = P.normalizeReminders(rem);
      await LocalReminders.sync(P, tasks, st.rem);
      markNative();
    } catch (e) { /* بی‌اثر */ }
  }
  function paint() { paintNav(); paintDay(); }

  const CAL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';

  function paintNav() {
    const t = today(), d = st.day;
    const full = Utils.faFullDate(P.fromISO(d));
    const label = P.dayLabel(d, t);
    const strip = P.weekOf(d).map((w) => `<button type="button" class="dp-wd${w.iso === d ? ' on' : ''}${w.iso === t ? ' now' : ''}" data-dp-day="${w.iso}"${w.iso === d ? ' aria-current="date"' : ''}><span>${esc(w.name)}</span><b>${fa(w.jd)}</b></button>`).join('');
    $('dp-nav').innerHTML = `<div class="dp-nav-top">
        <div class="dp-day"><b>${esc(label)}</b>${label === full ? '' : `<small>${esc(full)}</small>`}</div>
        ${d === t ? '' : '<button type="button" class="dp-nav-today" data-dp-nav="0">امروز</button>'}
        <button type="button" class="dp-cal-b" data-dp-cal="1" aria-label="انتخاب تاریخ">${CAL_SVG}<span>${esc(d === t ? full : 'تقویم')}</span></button>
      </div>
      <div class="dp-week">${strip}</div>
      <div class="dp-rem">
        <button type="button" class="dp-rem-t" data-dp-rem="1"><span aria-hidden="true">${st.rem.on ? '🔔' : '🔕'}</span> هشدار کارها: <b>${esc(P.remindSummary(st.rem))}</b></button>
        <button type="button" class="dp-sw${st.rem.on ? ' on' : ''}" data-dp-remtoggle="1" role="switch" aria-checked="${st.rem.on ? 'true' : 'false'}" aria-label="هشدار همه‌ی کارها"><i></i></button>
      </div>`;
  }

  /* تقویم ماهانه‌ی شمسی (برگه‌ی پایین): با انتخاب هر روز بسته می‌شود و همان روز نمایش داده می‌شود */
  function openCalendar() {
    let cur = P.jalaliParts(st.day);
    ctx.showSheet({
      title: 'انتخاب تاریخ',
      html: '<div id="dp-cal"></div>',
      onMount: (body, close) => {
        const box = body.querySelector('#dp-cal');
        const paint = () => {
          const g = P.jalaliMonthGrid(cur.jy, cur.jm), t = today();
          const head = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map((n) => `<i>${n}</i>`).join('');
          const cells = '<span></span>'.repeat(g.offset) + g.days.map((x) => `<button type="button" class="dp-cd${x.iso === st.day ? ' on' : ''}${x.iso === t ? ' now' : ''}" data-cal-day="${x.iso}">${fa(x.jd)}</button>`).join('');
          box.innerHTML = `<div class="dp-cal-h"><button type="button" class="dp-nav-b" data-cal-m="-1" aria-label="ماه قبل">›</button><b>${esc(g.title)}</b><button type="button" class="dp-nav-b" data-cal-m="1" aria-label="ماه بعد">‹</button></div>
            <div class="dp-cal-g dp-cal-w">${head}</div><div class="dp-cal-g">${cells}</div>
            <button type="button" class="btn btn-ghost dp-cal-today" data-cal-today="1">امروز</button>`;
        };
        paint();
        box.addEventListener('click', (e) => {
          const m = e.target.closest('[data-cal-m]');
          if (m) { cur = P.jalaliAddMonth(cur.jy, cur.jm, Number(m.dataset.calM)); paint(); return; }
          const pick = (iso) => { st.day = iso; close(); paintNav(); paintDay(); };
          const d = e.target.closest('[data-cal-day]'); if (d) { pick(d.dataset.calDay); return; }
          if (e.target.closest('[data-cal-today]')) pick(today());
        });
      }
    });
  }

  function taskHtml(t, o) {
    const cl = clientOf(t), opt = o || {};
    const meta = [];
    if (t.time) meta.push(`<span class="dp-time">${esc(P.timeText(t.time))}</span>`);
    if (opt.showDate) meta.push(`<span class="dp-date">${esc(P.dayLabel(t.date, today()))}</span>`);
    if (cl) meta.push(`<button type="button" class="dp-cl" data-dp-client="${esc(cl.id)}">👤 ${esc(cl.name)}</button>`);
    return `<div class="dp-task${t.done ? ' is-done' : ''}" data-dp-id="${esc(t.id)}">
      <button type="button" class="dp-check" data-dp-toggle="${esc(t.id)}" role="checkbox" aria-checked="${t.done ? 'true' : 'false'}" aria-label="${t.done ? 'برگرداندن به انجام‌نشده' : 'انجام شد'}">${CHECK_SVG}</button>
      <div class="dp-body" data-dp-edit="${esc(t.id)}" role="button" tabindex="0">
        <span class="dp-title">${esc(t.title)}</span>
        ${meta.length ? `<span class="dp-meta">${meta.join('')}</span>` : ''}
      </div>
      ${t.time && !t.done ? `<button type="button" class="dp-bell${t.remind !== false ? ' on' : ''}${st.rem.on ? '' : ' g-off'}" data-dp-bell="${esc(t.id)}" aria-pressed="${t.remind !== false ? 'true' : 'false'}" aria-label="${t.remind !== false ? 'خاموش کردن هشدار این کار' : 'روشن کردن هشدار این کار'}">${t.remind !== false ? '🔔' : '🔕'}</button>` : ''}
      ${opt.move ? `<button type="button" class="dp-move" data-dp-move="${esc(t.id)}">امروز</button>` : ''}
      ${t.done ? `<button type="button" class="dp-del" data-dp-del="${esc(t.id)}" aria-label="حذف این کار">×</button>` : ''}
    </div>`;
  }

  function paintDay() {
    const v = P.dayView(st.tasks, st.day, today());
    const prog = v.total ? `<div class="dp-prog"><i style="width:${v.pct}%"></i></div><div class="dp-prog-t">${fa(v.done)} از ${fa(v.total)} کار انجام شد</div>` : '';
    const overdue = v.overdue.length
      ? `<div class="dp-sec dp-over"><div class="dp-sec-h"><b>⚠️ عقب‌افتاده (${fa(v.overdue.length)})</b><button type="button" class="dp-link" data-dp-moveall="1">همه را به امروز ببر</button><button type="button" class="dp-link dp-danger" data-dp-delall="over">حذف همه</button></div>${v.overdue.map((t) => taskHtml(t, { showDate: true, move: true })).join('')}</div>` : '';
    const empty = !v.items.length && !v.overdue.length
      ? `<div class="dp-empty"><b>${st.day === today() ? 'برنامه‌ی امروز خالی است' : 'برای این روز کاری ثبت نشده'}</b><span>بالا بگو یا بنویس، مثلاً «فردا ساعت ده بازدید پونک»</span></div>` : '';
    $('dp-list').innerHTML = prog + overdue + (v.items.length ? `<div class="dp-sec">${v.items.length > 1 ? `<div class="dp-sec-h"><b>کارهای این روز (${fa(v.items.length)})</b><button type="button" class="dp-link dp-danger" data-dp-delall="day">حذف همه</button></div>` : ''}${v.items.map((t) => taskHtml(t)).join('')}</div>` : '') + empty;
    syncLocal();
  }

  /* گزینه‌های تاریخ برای مرور و ویرایش: امروز تا ۳۰ روز بعد (+ تاریخ فعلی اگر بیرون این بازه بود) */
  function dateOptions(selected) {
    const t = today(), list = [];
    for (let i = 0; i <= 30; i++) list.push(P.addDays(t, i));
    if (selected && !list.includes(selected) && P.isValidISO(selected)) { list.push(selected); list.sort(); }
    return list.map((iso) => {
      const lab = P.dayLabel(iso, t), full = Utils.faFullDate(P.fromISO(iso));
      return `<option value="${iso}"${iso === selected ? ' selected' : ''}>${esc(lab === full ? full : lab + ' · ' + full)}</option>`;
    }).join('');
  }
  function clientOptions(selected) {
    const sorted = st.clients.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fa'));
    return '<option value="">بدون مشتری</option>' + sorted.map((c) => `<option value="${esc(c.id)}"${String(c.id) === String(selected) ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  /* ---------- رویدادها ---------- */
  async function onClick(e) {
    const t = e.target;
    const dayBtn = t.closest('[data-dp-day]');
    if (dayBtn) { st.day = dayBtn.dataset.dpDay; paintNav(); paintDay(); return; }
    if (t.closest('[data-dp-cal]')) { openCalendar(); return; }
    const nav = t.closest('[data-dp-nav]');
    if (nav) { const n = Number(nav.dataset.dpNav); st.day = n === 0 ? today() : P.addDays(st.day, n); paintNav(); paintDay(); return; }
    if (t.closest('#dp-analyze')) { analyze(); return; }
    if (t.closest('#dp-clear')) { clearInput(); return; }
    const da = t.closest('[data-dp-delall]');
    if (da) { deleteAll(da.dataset.dpDelall); return; }
    const cl = t.closest('[data-dp-client]');
    if (cl) { e.stopPropagation(); if (ctx.openClient) ctx.openClient(cl.dataset.dpClient); return; }
    const tg = t.closest('[data-dp-toggle]');
    if (tg) { toggle(tg.dataset.dpToggle); return; }
    const mv = t.closest('[data-dp-move]');
    if (mv) { moveToToday([mv.dataset.dpMove]); return; }
    if (t.closest('[data-dp-moveall]')) { moveToToday(P.dayView(st.tasks, today(), today()).overdue.map((x) => x.id)); return; }
    const dl = t.closest('[data-dp-del]');
    if (dl) { removeTask(dl.dataset.dpDel); return; }
    const bell = t.closest('[data-dp-bell]');
    if (bell) { toggleBell(bell.dataset.dpBell); return; }
    if (t.closest('[data-dp-remtoggle]')) { toggleGlobal(); return; }
    if (t.closest('[data-dp-rem]')) { openRemSheet(); return; }
    const ed = t.closest('[data-dp-edit]');
    if (ed) { openEdit(ed.dataset.dpEdit); }
  }

  function clearInput() {
    if (st.mic) st.mic.stop();
    $('dp-text').value = ''; st.usedVoice = false; $('dp-mic-status').textContent = '';
  }

  const setBusy = (on) => { st.busy = on; const b = $('dp-analyze'); if (b) b.disabled = on; };

  /* «تحلیل و افزودن به برنامه»: کارها بدون مرحله‌ی تأیید مستقیم وارد لیست می‌شوند؛ برای اصلاح، هر کار را بزن */
  async function analyze() {
    if (st.busy) return;
    if (st.mic) st.mic.stop();
    const text = $('dp-text').value.trim();
    if (!text) { ctx.showToast('برنامه را بگو یا بنویس.', 'error'); return; }
    // کارِ بدون تاریخ برای روزی ثبت می‌شود که کاربر الان روی آن است؛ تا وقتی خودش روز را عوض نکند همین می‌ماند
    const items = P.parse(text, { today: today(), defaultDate: st.day, clients: st.clients });
    if (!items.length) { ctx.showToast('کاری پیدا نشد؛ مثلاً بنویس «فردا ساعت ده بازدید پونک».', 'error'); return; }
    try {
      const source = st.usedVoice ? 'voice' : 'text';
      const rows = P.validateTasks(items.map((x) => Object.assign({}, x, { source })));
      setBusy(true);
      const saved = await Backend.addDailyTasks(rows);
      st.tasks = st.tasks.concat(saved);
      const other = saved.filter((x) => x.date !== st.day).length;
      setBusy(false);
      clearInput();
      ctx.showToast(fa(saved.length) + ' کار به برنامه اضافه شد ✓' + (other ? ' (' + fa(other) + ' کار برای روزهای دیگر)' : ''), 'success');
      paint();
      if (saved.some((x) => x.time)) ensurePush();
    } catch (err) {
      setBusy(false);
      ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error');
    }
  }

  /* حذف همه‌ی کارهای روزِ انتخاب‌شده («day») یا همه‌ی عقب‌افتاده‌ها («over») با یک تأیید */
  async function deleteAll(kind) {
    const v = P.dayView(st.tasks, st.day, today());
    const list = kind === 'over' ? v.overdue : v.items;
    if (!list.length) return;
    const what = kind === 'over' ? 'عقب‌افتاده' : 'این روز';
    const ok = await ctx.showDialog({ title: 'حذف همه', message: fa(list.length) + ' کار ' + what + ' حذف شود؟ این کار برگشت ندارد.', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف همه', value: true }] });
    if (!ok) return;
    try {
      const ids = list.map((x) => x.id);
      await Backend.deleteDailyTasks(ids);
      const gone = new Set(ids.map(String));
      st.tasks = st.tasks.filter((x) => !gone.has(String(x.id)));
      paintDay();
      ctx.showToast(fa(ids.length) + ' کار حذف شد', 'success');
    } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); await render(); }
  }

  async function toggle(id) {
    const t = st.tasks.find((x) => String(x.id) === String(id)); if (!t) return;
    const prev = t.done;
    t.done = !prev; paintDay();
    try { await Backend.updateDailyTask(t.id, { done: t.done }); }
    catch (err) { t.done = prev; paintDay(); ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  /* حذفِ کارِ انجام‌شده با ×؛ برای جلوگیری از لمسِ اشتباه، تأیید می‌گیرد */
  async function removeTask(id) {
    const t = st.tasks.find((x) => String(x.id) === String(id)); if (!t) return;
    const ok = await ctx.showDialog({ title: 'حذف کار', message: 'این کار حذف شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true }] });
    if (!ok) return;
    try { await Backend.deleteDailyTask(t.id); st.tasks = st.tasks.filter((x) => x !== t); paintDay(); ctx.showToast('حذف شد', 'success'); }
    catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  async function moveToToday(ids) {
    if (!ids || !ids.length) return;
    try {
      await Promise.all(ids.map((id) => Backend.updateDailyTask(id, { date: today() })));
      st.tasks.forEach((x) => { if (ids.map(String).includes(String(x.id))) x.date = today(); });
      paintDay();
      ctx.showToast(fa(ids.length) + ' کار به امروز منتقل شد ✓', 'success');
    } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); await render(); }
  }

  /* ---------- هشدار (یادآوری) ---------- */
  async function saveRem() { await Backend.setSetting('daily_reminders', { on: st.rem.on, offsets: st.rem.offsets, native_at: st.rem.nativeAt || null }); }
  const remWith = (patch) => P.normalizeReminders(Object.assign({ on: st.rem.on, offsets: st.rem.offsets, native_at: st.rem.nativeAt }, patch));

  /* داخل APK: ثبت می‌کند «هشدارها روی همین گوشی زمان‌بندی می‌شود» تا سرور برای این کاربر Push نفرستد و اعلان دوتایی نیاید */
  async function markNative() {
    try {
      if (typeof LocalReminders === 'undefined' || !LocalReminders.available() || !Backend.isActive() || Backend.isOffline()) return;
      const last = st.rem.nativeAt ? Date.parse(st.rem.nativeAt) : 0;
      if (Date.now() - last < 6 * 3600 * 1000) return;
      st.rem = remWith({ native_at: new Date().toISOString() });
      await saveRem();
    } catch (e) { /* بی‌اثر */ }
  }

  /* اجازه‌ی اعلان را (فقط یک بار در هر نشست) با پیام روشن می‌پرسد؛ بدون آن هشدار نمی‌رسد */
  async function ensurePush() {
    if (!st.rem.on) return;
    if (typeof LocalReminders !== 'undefined' && LocalReminders.available()) {   // داخل APK: اعلان محلی
      if (st.askedPush) return;
      st.askedPush = true;
      const okN = await ctx.showDialog({ title: 'فعال‌سازی اعلان', message: 'برای اینکه هشدار کارها به‌موقع برسد، اجازه‌ی اعلان را بده.', buttons: [{ label: 'بعداً', value: false }, { label: 'فعال کن', value: true }] });
      if (!okN) return;
      try {
        if (await LocalReminders.ensurePermission()) { ctx.showToast('اعلان فعال شد ✓', 'success'); syncLocal(); }
        else ctx.showToast('اجازه‌ی اعلان داده نشد؛ از تنظیمات گوشی برای Yane فعالش کن.', 'error');
      } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
      return;
    }
    if (typeof Push === 'undefined') return;
    let s; try { s = await Push.status(); } catch (e) { return; }
    if (!s || s.state === 'on') return;
    if (s.state === 'unsupported') { ctx.showToast('این مرورگر اعلان را پشتیبانی نمی‌کند؛ هشدار کار نخواهد کرد.', 'error'); return; }
    if (s.state === 'install') { ctx.showToast('روی آیفون اول اپ را به صفحه‌ی اصلی اضافه کن (Share ← Add to Home Screen) تا هشدار کار کند.', 'error'); return; }
    if (s.state === 'denied') { ctx.showToast('اعلان برای این برنامه بسته است؛ از تنظیمات گوشی فعالش کن.', 'error'); return; }
    if (st.askedPush) return;
    st.askedPush = true;
    const ok = await ctx.showDialog({ title: 'فعال‌سازی اعلان', message: 'برای اینکه هشدار کارها به‌موقع برسد، اجازه‌ی اعلان را بده.', buttons: [{ label: 'بعداً', value: false }, { label: 'فعال کن', value: true }] });
    if (!ok) return;
    try { await Push.enable(); ctx.showToast('اعلان فعال شد ✓', 'success'); }
    catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
  }

  async function toggleGlobal() {
    const prev = st.rem.on;
    st.rem = remWith({ on: !prev });
    paintNav(); paintDay();
    try { await saveRem(); ctx.showToast(st.rem.on ? 'هشدار کارها روشن شد' : 'هشدار همه‌ی کارها خاموش شد', 'success'); if (st.rem.on) ensurePush(); }
    catch (err) { st.rem = remWith({ on: prev }); paintNav(); paintDay(); ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  async function toggleBell(id) {
    const t = st.tasks.find((x) => String(x.id) === String(id)); if (!t) return;
    const prev = t.remind !== false;
    t.remind = !prev; paintDay();
    try {
      await Backend.updateDailyTask(t.id, { remind: t.remind });
      ctx.showToast(t.remind ? (st.rem.on ? 'هشدار این کار روشن شد' : 'هشدار این کار روشن است، ولی هشدار کلی خاموش است') : 'هشدار این کار خاموش شد', 'success');
      if (t.remind) ensurePush();
    } catch (err) { t.remind = prev; paintDay(); ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  function openRemSheet() {
    let on = st.rem.on, sel = st.rem.offsets.slice();
    ctx.showSheet({
      title: '🔔 هشدار کارها',
      html: '<div id="dp-rs"></div>',
      onMount(body, close) {
        const box = body.querySelector('#dp-rs');
        const draw = () => {
          box.innerHTML = `<label class="dp-rs-sw"><input type="checkbox" id="dprs-on"${on ? ' checked' : ''}> هشدار برای کارهای ساعت‌دار</label>
            <div class="dp-rs-t">چه زمانی یادآوری شود؟ (تا ${fa(P.MAX_OFFSETS)} مورد)</div>
            <div class="dp-rs-chips">${P.REMIND_OPTIONS.map((n) => `<button type="button" class="dp-chip${sel.includes(n) ? ' on' : ''}" data-off="${n}"${on ? '' : ' disabled'}>${esc(P.offsetLabel(n))}</button>`).join('')}</div>
            <div class="dp-rs-note">هشدار به‌صورت اعلان روی گوشی می‌آید و صدای معمولی اعلان‌های گوشی را دارد. اگر گوشی روی بی‌صدا یا «مزاحم نشوید» باشد، فقط نمایش داده می‌شود. هر کار را هم می‌توانی با زنگوله‌ی کنارش جدا خاموش کنی.</div>
            <div class="dialog-btns"><button class="btn btn-ghost" id="dprs-cancel">انصراف</button><button class="btn btn-primary" id="dprs-save">ذخیره</button></div>`;
        };
        draw();
        box.addEventListener('change', (e) => { if (e.target.id === 'dprs-on') { on = e.target.checked; draw(); } });
        box.addEventListener('click', async (e) => {
          const chip = e.target.closest('[data-off]');
          if (chip) {
            const n = Number(chip.dataset.off);
            if (sel.includes(n)) { if (sel.length > 1) sel = sel.filter((x) => x !== n); else ctx.showToast('حداقل یک زمان باید انتخاب باشد.', 'error'); }
            else if (sel.length >= P.MAX_OFFSETS) ctx.showToast('حداکثر ' + fa(P.MAX_OFFSETS) + ' زمان را می‌شود انتخاب کرد.', 'error');
            else sel.push(n);
            draw(); return;
          }
          if (e.target.closest('#dprs-cancel')) { close(); return; }
          if (e.target.closest('#dprs-save')) {
            const prev = st.rem;
            st.rem = remWith({ on, offsets: sel });
            try { await saveRem(); close(); paintNav(); paintDay(); ctx.showToast('تنظیم هشدار ذخیره شد ✓', 'success'); if (st.rem.on) ensurePush(); }
            catch (err) { st.rem = prev; ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
          }
        });
      }
    });
  }

  function openEdit(id) {
    const t = st.tasks.find((x) => String(x.id) === String(id)); if (!t) return;
    ctx.showSheet({
      title: '✏️ ویرایش کار',
      html: `<div class="set-row"><label>عنوان</label><input type="text" id="dpe-title" value="${esc(t.title)}" maxlength="${P.MAX_TITLE}" autocomplete="off"></div>
        <div class="set-row"><label>تاریخ</label><select id="dpe-date">${dateOptions(t.date)}</select></div>
        <div class="set-row"><label>ساعت (اختیاری)</label><input type="time" id="dpe-time" value="${esc(t.time || '')}"></div>
        <div class="set-row"><label>مشتری (اختیاری)</label><select id="dpe-client">${clientOptions(t.clientId)}</select></div>
        <div class="dialog-btns"><button class="btn btn-ghost" id="dpe-del" style="color:var(--danger)">حذف</button><button class="btn btn-ghost" id="dpe-cancel">انصراف</button><button class="btn btn-primary" id="dpe-save">ذخیره</button></div>`,
      onMount(body, close) {
        const q = (s) => body.querySelector(s);
        q('#dpe-cancel').onclick = close;
        q('#dpe-del').onclick = async () => {
          const ok = await ctx.showDialog({ title: 'حذف کار', message: 'این کار حذف شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true }] });
          if (!ok) return;
          try { await Backend.deleteDailyTask(t.id); st.tasks = st.tasks.filter((x) => x !== t); close(); paintDay(); ctx.showToast('حذف شد', 'success'); }
          catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
        q('#dpe-save').onclick = async () => {
          const btn = q('#dpe-save');
          try {
            const v = P.validateTask({ title: q('#dpe-title').value, date: q('#dpe-date').value, time: q('#dpe-time').value, clientId: q('#dpe-client').value });
            btn.disabled = true;
            const saved = await Backend.updateDailyTask(t.id, { title: v.title, date: v.date, time: v.time, clientId: v.clientId });
            Object.assign(t, saved);
            close(); paintDay(); ctx.showToast('ذخیره شد ✓', 'success');
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  return { init, render, dueCount, setTab, syncReminders };
})();
if (typeof globalThis !== 'undefined') globalThis.DailyPlan = DailyPlan;

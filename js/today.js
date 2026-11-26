'use strict';
/* ============================================================
   صفحه‌ی «امروز» — بالای صفحه‌ی اصلی در نسخه‌ی CRM
   Today.init({ $id, showToast, openClient }) ؛ Today.render()
   ============================================================ */
const Today = (() => {
  const C = ClientsCore, T = TodayCore;
  const SHOW = 5;   // حداکثر ردیف در هر بخش
  let ctx = null;
  const st = { clients: [], notes: [], more: {}, loaded: false, dealsDue: 0, cardsNew: 0, wants: [], pays: [], sub: null, plan: null, support: null, hide: {} };
  const esc = (s) => Utils.esc(s);

  function init(c) {
    ctx = c;
    ctx.$id('today-box').addEventListener('click', onClick);
  }

  async function render() {
    const box = ctx && ctx.$id('today-box'); if (!box) return;
    if (!Backend.isActive()) { box.innerHTML = ''; return; }
    try {
      const [clients, notes] = await Promise.all([Backend.getClients(), Backend.getClientNotesIndex()]);
      st.clients = clients; st.notes = notes; st.loaded = true;
      st.hide = loadHide(C.isoDate(new Date()));
      st.dealsDue = await countDealsDue();
      st.cardsNew = await countCardsNew();
        st.sub = ctx.subWarn ? await ctx.subWarn() : null;
      st.wants = await loadWants();
      st.pays = await loadPays();
      st.support = ctx.supportUnread ? await ctx.supportUnread().catch(() => null) : null;   // پشتیبانی؛ خطا یا نبودن جدول = نمایش داده نشود
      st.plan = ctx.planDue ? await ctx.planDue().catch(() => null) : null;   // برنامه‌ی روزانه؛ خطا یا نبودن جدول = نمایش داده نشود
    } catch (err) {
      if (!st.loaded) { box.innerHTML = '<div class="info-note">امروز: ' + esc(Backend.faErr(err)) + '</div>'; return; }
    }
    paint();
  }

  /* یادآوری‌های قرارداد/معامله (رادار تمدید + پیام بعد از معامله)؛ اگر جدول هنوز ساخته نشده یا خطا بود، ۰ */
  async function countDealsDue() {
    try {
      if (typeof DealsCore === 'undefined') return 0;
      const [deals, saved] = await Promise.all([Backend.getDeals(), Backend.getSetting('deal_settings', {}).catch(() => ({}))]);
      return DealsCore.buildReminders(deals, C.isoDate(new Date()), { leadDays: DealsCore.normalizeSettings(saved || {}).leadDays }).due.length;
    } catch (e) { return 0; }
  }

  /* بازدیدهای دیده‌نشده‌ی کارت ملک؛ اگر جدول هنوز ساخته نشده یا خطا بود، ۰ */
  async function countCardsNew() {
    try { return Backend.countUnseenCardEvents ? await Backend.countUnseenCardEvents() : 0; } catch (e) { return 0; }
  }

  /* درخواست‌های «می‌خواهم ببینم»ِ دیده‌نشده؛ تا زدن «دیدم» روی صفحه‌ی خانه می‌مانند */
  async function loadWants() {
    try { return typeof CardAlert !== 'undefined' ? await CardAlert.load() : []; } catch (e) { return []; }
  }

  /* درخواست‌های پرداخت در انتظار (فقط مدیر): بالای همه؛ تا تایید/رد می‌ماند */
  async function loadPays() {
    try { return typeof PayAlert !== 'undefined' ? await PayAlert.load() : []; } catch (e) { return []; }
  }
  function paysRowHtml() {
    return st.pays.slice(0, 3).map((q) => `<div class="td-alert td-pay" data-today-pay="1">
      <div class="td-main"><div class="td-kicker">💳 درخواست پرداخت</div><div class="td-name">${esc(PayAlert.titleOf(q))}</div><div class="td-sub">${esc(PayAlert.subOf(q))}</div></div>
      <button class="td-alert-btn" data-today-pay="1">بررسی</button></div>`).join('')
      + (st.pays.length > 3 ? `<div class="td-note" data-today-pay="1"><b>و ${Utils.faDigits(st.pays.length - 3)} درخواست پرداخت دیگر</b></div>` : '');
  }

  /* ---------- پنهان‌کردن با ✕ (بدون سوال؛ فقط یک «برگردان» کوتاه) ---------- */
  const HIDE_KEY = 'yane-today-hide';
  function loadHide(today) {
    try {
      const raw = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(HIDE_KEY) || '{}') : {};
      return T.prune(raw && typeof raw === 'object' ? raw : {}, today);
    } catch (e) { return {}; }
  }
  function saveHide() { try { if (typeof localStorage !== 'undefined') localStorage.setItem(HIDE_KEY, JSON.stringify(st.hide)); } catch (e) { /* بی‌اثر */ } }
  const xBtn = (key, mode, token) => `<button type=\"button\" class=\"td-x\" data-td-hide=\"${esc(key)}\" data-td-mode=\"${mode}\" data-td-token=\"${esc(token || '')}\" aria-label=\"پنهان کن\">✕</button>`;
  function showUndo(undo) {
    const root = ctx && ctx.$id ? ctx.$id('toast-root') : null;
    if (!root || typeof document === 'undefined') return;
    const t = document.createElement('div');
    t.className = 'toast td-undo';
    t.innerHTML = '<span>پنهان شد</span><button type=\"button\">برگردان</button>';
    let gone = false;
    const rm = () => { if (!gone) { gone = true; t.remove(); } };
    t.querySelector('button').addEventListener('click', () => { undo(); rm(); });
    root.appendChild(t);
    setTimeout(rm, 5000);
  }
  function hideItem(key, mode, token) {
    const today = C.isoDate(new Date());
    st.hide = T.hideEntry(st.hide, key, mode, today, token);
    saveHide(); paint();
    showUndo(() => { delete st.hide[key]; saveHide(); paint(); });
  }

  const PHONE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>';

  /* درخواست‌های «می‌خواهم ببینم»: بنر قرمز یک‌خطی؛ تا زدن «دیدم» می‌ماند */
  function wantsRowHtml() {
    return st.wants.map((a) => `<div class="td-alert" data-today-cards="1">
      <div class="td-main"><div class="td-kicker">درخواست تازه</div><div class="td-name">${esc(CardsCore.alertText(a).replace('🙋 ', ''))}</div></div>
      ${a.telHref ? `<a class="td-alert-btn" href="${esc(a.telHref)}" data-today-tel="1" aria-label="تماس">تماس</a>` : ''}<button class="td-alert-btn ghost" data-today-want-seen="${esc(a.eventId)}">دیدم</button></div>`).join('');
  }

  /* ردیف‌های داخل نوار «امروز»: هر کدام یک ✕ دارند */
  const note = (attr, key, title, sub, cls) => `<div class="td-note has-x${cls ? ' ' + cls : ''}" ${attr}="1"><b>${title}</b><span>${sub}</span>${xBtn(key, 'd')}</div>`;

  /* برنامه‌ی روزانه: کارهای باز امروز + عقب‌افتاده؛ با لمس، تب «برنامه روزانه» باز می‌شود */
  function planRowHtml() {
    const p = st.plan; if (!p || !p.total) return '';
    const sub = p.overdue ? Utils.faDigits(p.overdue) + ' کار از روزهای قبل عقب‌افتاده' + (p.open ? ' · ' + Utils.faDigits(p.open) + ' کار امروز' : '') : 'برای امروز برنامه‌ریزی کرده‌ای';
    return note('data-today-plan', 'plan', '📅 ' + Utils.faDigits(p.total) + ' کار در برنامه‌ی روزانه', sub, 'td-plan' + (p.overdue ? ' td-warn' : ''));
  }

  /* پشتیبانی: کاربر = پاسخ جدید؛ مدیر = پیام‌های منتظر جواب؛ با لمس صفحه‌ی پشتیبانی باز می‌شود */
  function supportRowHtml() {
    const s = st.support; if (!s || !s.count) return '';
    const t = s.admin ? Utils.faDigits(s.count) + ' پیام پشتیبانی منتظر جواب' : Utils.faDigits(s.count) + ' پاسخ جدید از پشتیبانی';
    return `<div class="td-note td-warn" data-today-support="1"><b>💬 ${t}</b><span>برای دیدن بزن</span></div>`;
  }

  /* هشدار پایان اشتراک: بیرون از نوار می‌ماند (مهم و کم‌پیش‌آمد) */
  function subRowHtml() {
    return st.sub ? `<div class="td-note td-warn" data-today-sub="1"><b>اشتراکت ${st.sub.days > 0 ? Utils.faDigits(st.sub.days) + ' روز دیگر' : 'امروز'} تمام می‌شود</b><span>قبل از موعد تمدید کن؛ روزها به پایان اشتراک اضافه می‌شود</span></div>` : '';
  }

  const CAL_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';

  /* انتخاب دستی روز/تاریخ پیگیری (شمسی) + میان‌بُرهای فردا / ۳ روز / هفته */
  function openPicker(id) {
    const c = st.clients.find((x) => String(x.id) === String(id));
    if (!c || !ctx.showSheet) return;
    ctx.showSheet({
      title: 'پیگیری بعدی — ' + c.name,
      html: `<div class="chip-row" style="margin:0 0 10px;flex-wrap:wrap">
          <button type="button" class="chip" data-td-d="1">فردا</button><button type="button" class="chip" data-td-d="3">۳ روز دیگر</button>
          <button type="button" class="chip" data-td-d="7">هفته‌ی دیگر</button><button type="button" class="chip" data-td-d="14">۲ هفته دیگر</button></div>
        <div class="set-row"><label>یا تاریخ دلخواه</label>${JDate.html('td-date', C.addDaysISO(1))}</div>
        <div class="dialog-btns"><button class="btn btn-ghost" id="td-cancel">انصراف</button><button class="btn btn-primary" id="td-ok">ثبت</button></div>`,
      onMount(body, close) {
        const jd = body.querySelector('#td-date');
        body.querySelectorAll('[data-td-d]').forEach((b) => b.addEventListener('click', () => {
          JDate.set(jd, C.addDaysISO(Number(b.dataset.tdD)));
          body.querySelectorAll('[data-td-d]').forEach((x) => x.classList.toggle('active', x === b));
        }));
        body.querySelector('#td-cancel').onclick = close;
        body.querySelector('#td-ok').onclick = async () => {
          const d = JDate.get(jd);
          if (!d) { ctx.showToast('تاریخ را کامل و معتبر انتخاب کن', 'error'); return; }
          if (JDate.isPast(d)) { ctx.showToast('تاریخ پیگیری نباید گذشته باشد', 'error'); return; }
          try {
            const saved = await Backend.putClient({ id: c.id, nextFollowupDate: d });
            Object.assign(c, saved); close(); ctx.showToast('پیگیری ' + c.name + ' برای ' + JDate.label(d) + ' ثبت شد', 'success'); paint();
          } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  function rowHtml(c, sub, color, extra, hideKey, mode, token) {
    const tel = c.phone ? `<a class="td-call" href="tel:${esc(c.phone)}" data-today-tel="1" aria-label="تماس">${PHONE_SVG}</a>` : '';
    return `<div class="td-row" data-today-open="${esc(c.id)}">
      <span class="rd-avatar sm">${esc((c.name || '؟').trim().charAt(0))}</span>
      <div class="td-main"><div class="td-name">${esc(c.name)}</div><div class="td-sub" style="color:${color};${extra || ''}">${esc(sub)}</div></div>
      <button class="td-snooze" data-today-snooze="${esc(c.id)}">فردا</button><button class="td-snooze td-cal" data-today-pick="${esc(c.id)}" aria-label="انتخاب روز و تاریخ دلخواه">${CAL_SVG}</button>${tel}${hideKey ? xBtn(hideKey, mode, token) : ''}</div>`;
  }

  /* بخش بازشونده‌ی «سرد شده» / «پیگیری تعیین نشده» (بعد از زدن دکمه‌ی «مشتری نیاز به توجه دارد») */
  function section(key, title, list, rowFn) {
    if (!list.length) return '';
    const shown = st.more['sec_' + key] ? list : list.slice(0, SHOW);
    const rest = list.length - shown.length;
    return `<div class="td-sec"><div class="td-name" style="margin:2px 0 6px">${title} (${Utils.faDigits(list.length)})</div>${shown.map(rowFn).join('')}`
      + (rest > 0 ? `<button class="btn btn-ghost btn-sm" data-today-more="sec_${key}">و ${Utils.faDigits(rest)} مورد دیگر</button>` : '') + '</div>';
  }

  /* همه‌ی یادآوری‌های کم‌اهمیت‌تر در یک نوار «امروز» (بسته)؛ چیپ‌ها تعداد هر دسته را نشان می‌دهند */
  function paint() {
    const box = ctx.$id('today-box');
    const today = C.isoDate(new Date());
    const hid = (k, token) => T.isHidden(st.hide, k, today, token);
    const r = T.buildToday(st.clients, st.notes, today);
    const last = T.lastContactMap(st.notes);
    const attOk = (c) => !hid('a:' + c.id, T.attToken(c, last));
    const overdue = r.overdue.filter((c) => !hid('f:' + c.id));
    const dueToday = r.today.filter((c) => !hid('f:' + c.id));
    const cold = r.cold.filter((x) => attOk(x.client)), nofu = r.noFollowup.filter((x) => attOk(x.client));
    const extra = cold.length + nofu.length;
    const planOn = !!(st.plan && st.plan.total) && !hid('plan');
    const cardsOn = st.cardsNew > 0 && !hid('cards');
    const dealsOn = st.dealsDue > 0 && !hid('deals');
    const dot = ctx.$id('dp-dot');
    if (dot) { const n = st.plan && st.plan.total ? st.plan.total : 0; dot.textContent = n ? Utils.faDigits(n) : ''; dot.hidden = !n; }

    const urgent = paysRowHtml() + supportRowHtml() + wantsRowHtml() + subRowHtml();
    const items = (planOn ? 1 : 0) + overdue.length + dueToday.length + extra + (cardsOn ? 1 : 0) + (dealsOn ? 1 : 0);
    if (!items) {
      const quiet = (r.overdue.length + r.today.length + r.cold.length + r.noFollowup.length) === 0;
      box.innerHTML = urgent + (quiet
        ? (st.clients.length ? '<div class="info-note">امروز کار عقب‌افتاده‌ای نداری.</div>' : '<div class="info-note">هنوز مشتری‌ای ثبت نکردی؛ از «مشتری‌ها» شروع کن.</div>')
        : '');
      return;
    }
    const chip = (cls, n, label) => (n ? `<span class="td-chip ${cls}">${Utils.faDigits(n)} ${label}</span>` : '');
    const pills = chip('plan', planOn ? 1 : 0, 'کار') + chip('bad', overdue.length, 'عقب‌افتاده') + chip('fu', dueToday.length, 'پیگیری')
      + chip('att', extra, 'توجه') + chip('more', cardsOn ? 1 : 0, 'بازدید') + chip('more', dealsOn ? 1 : 0, 'قرارداد');

    const due = overdue.map((c) => ({ c, sub: C.followupText(c), color: 'var(--danger)' })).concat(dueToday.map((c) => ({ c, sub: 'پیگیری امروز', color: 'var(--amber)' })));
    const shownDue = st.more.due ? due : due.slice(0, SHOW);
    const restDue = due.length - shownDue.length;
    const dueHtml = shownDue.map((x) => rowHtml(x.c, x.sub, x.color, 'font-weight:700', 'f:' + x.c.id, 'd')).join('')
      + (restDue > 0 ? `<button class="btn btn-ghost btn-sm" data-today-more="due">و ${Utils.faDigits(restDue)} مورد دیگر</button>` : '');
    const attRow = (x, sub, color) => rowHtml(x.client, sub, color, '', 'a:' + x.client.id, 't', T.attToken(x.client, last));
    const extraHtml = !extra ? '' : (st.more.extra
      ? section('cold', 'سرد شده', cold, (x) => attRow(x, T.coldText(x.days), 'var(--muted)'))
        + section('nofu', 'پیگیری تعیین نشده', nofu, (x) => attRow(x, 'تاریخ پیگیری بعدی را مشخص کن', 'var(--muted)'))
      : `<button class="btn btn-ghost btn-sm" data-today-more="extra">${Utils.faDigits(extra)} مشتری${due.length ? ' دیگر' : ''} نیاز به توجه ${extra === 1 ? 'دارد' : 'دارند'}</button>`);
    const cardsHtml = cardsOn ? note('data-today-cards', 'cards', Utils.faDigits(st.cardsNew) + ' بازدید جدید از کارت‌های ملک', 'ببین کی باز کرد و کی می‌خواهد ملک را ببیند') : '';
    const dealsHtml = dealsOn ? note('data-today-deals', 'deals', Utils.faDigits(st.dealsDue) + ' یادآوری قرارداد و معامله', 'رادار تمدید و پیام‌های بعد از معامله') : '';
    const open = !!st.more.open;
    box.innerHTML = urgent + `<div class="td-bar-wrap"><button type="button" class="td-bar${open ? ' open' : ''}" data-td-toggle="1" aria-expanded="${open ? 'true' : 'false'}">
        <span class="td-bar-t">امروز</span><span class="td-chips">${pills}</span><span class="td-bar-chev" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span></button>
      <div class="td-card td-open"${open ? '' : ' hidden'}>${planOn ? planRowHtml() : ''}${dueHtml}${extraHtml}${cardsHtml}${dealsHtml}</div></div>`;
  }

  async function onClick(e) {
    if (e.target.closest('[data-today-tel]')) return;   // خودِ لینک تماس
    const hx = e.target.closest('[data-td-hide]');
    if (hx) { e.stopPropagation(); hideItem(hx.dataset.tdHide, hx.dataset.tdMode, hx.dataset.tdToken); return; }
    const ws = e.target.closest('[data-today-want-seen]');
    if (ws) { e.stopPropagation(); if (typeof CardAlert !== 'undefined') CardAlert.dismiss([ws.dataset.todayWantSeen]); return; }
    if (e.target.closest('[data-td-toggle]')) { st.more.open = !st.more.open; paint(); return; }
    if (e.target.closest('[data-today-deals]')) { if (ctx.openDeals) ctx.openDeals(); return; }
    if (e.target.closest('[data-today-support]')) { if (ctx.openSupport) ctx.openSupport(); return; }
    if (e.target.closest('[data-today-plan]')) { if (ctx.openPlan) ctx.openPlan(); return; }
    if (e.target.closest('[data-today-pay]')) { if (ctx.openAdmin) ctx.openAdmin(); return; }
    if (e.target.closest('[data-today-sub]')) { if (ctx.openSub) ctx.openSub(); return; }
    if (e.target.closest('[data-today-cards]')) { if (ctx.openCards) ctx.openCards(); return; }
    const more = e.target.closest('[data-today-more]');
    if (more) { st.more[more.dataset.todayMore] = true; paint(); return; }
    const pk = e.target.closest('[data-today-pick]');
    if (pk) { e.stopPropagation(); openPicker(pk.dataset.todayPick); return; }
    const sn = e.target.closest('[data-today-snooze]');
    if (sn) {
      const c = st.clients.find((x) => String(x.id) === sn.dataset.todaySnooze); if (!c) return;
      sn.disabled = true;
      try {
        const saved = await Backend.putClient({ id: c.id, nextFollowupDate: C.addDaysISO(1) });
        Object.assign(c, saved); ctx.showToast('پیگیری ' + c.name + ' برای فردا (' + JDate.label(C.addDaysISO(1)) + ') ثبت شد', 'success'); paint();
      } catch (err) { sn.disabled = false; ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
      return;
    }
    const open = e.target.closest('[data-today-open]');
    if (open) ctx.openClient(open.dataset.todayOpen);
  }

  return { init, render };
})();
if (typeof globalThis !== 'undefined') globalThis.Today = Today;

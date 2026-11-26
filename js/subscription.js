'use strict';
/* ============================================================
   اشتراک من — وضعیت، انتخاب پلن، پرداخت کارت‌به‌کارت و پیگیری درخواست
   Subscription.init({ $id, showToast, showScreen, onAdminChange })
   Subscription.render()            ← صفحه‌ی «اشتراک من»
   Subscription.mountInto(el, opts) ← داخل هر جای دیگر (مثلاً صفحه‌ی پایان اشتراک)
   Subscription.mountAdmin(el, users) ← درخواست‌های تمدید برای مدیر
   Subscription.warning()           ← برای بنر «امروز»: { days } یا null
   ============================================================ */
const Subscription = (() => {
  const S = SubscriptionCore;
  let ctx = null;
  const st = { view: 'main', days: 60, plans: S.PLANS, cfg: null, requests: [], mount: null, blocked: false, busy: false };
  const esc = (s) => Utils.esc(s);
  const root = () => st.mount || ctx.$id('sub-root');
  const svg = (p, s) => `<svg width="${s || 20}" height="${s || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = { copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/>', tick: '<path d="M5 12l5 5 9-10"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', chat: '<path d="M4 5h16v11H9l-5 4z"/>' };

  function init(c) { ctx = c; const r = ctx.$id('sub-root'); if (r) bind(r); }
  function bind(el) { if (el.__subBound) return; el.__subBound = true; el.addEventListener('click', onClick); el.addEventListener('input', onInput); }

  /* ---------- بارگذاری ---------- */
  async function load() {
    try { await Backend.refreshProfile(); } catch (e) { /* با اطلاعات فعلی ادامه */ }
    const [prices, cfg, reqs] = await Promise.all([
      Backend.getSubscriptionPrices().catch(() => []), Backend.getSubscriptionConfig().catch(() => null), Backend.getMySubscriptionRequests().catch(() => [])
    ]);
    st.plans = S.applyPrices(prices); st.cfg = cfg; st.requests = reqs;
    if (!st.plans.some((p) => p.days === st.days)) st.days = 60;
  }

  async function render() { st.mount = null; st.blocked = false; await open(); }
  async function mountInto(el, opts) { st.mount = el; st.blocked = !!(opts && opts.blocked); bind(el); await open(); }
  async function open() {
    const r = root(); if (!r) return;
    if (!Backend.isActive()) { r.innerHTML = '<div class="info-note">این بخش نیاز به ورود به حساب دارد.</div>'; return; }
    r.innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    await load(); st.view = 'main'; paint();
  }

  const planOf = (days) => st.plans.find((p) => p.days === days) || st.plans[0];
  const pending = () => st.requests.find((q) => q.status === 'pending') || null;
  const user = () => Backend.getUser();

  /* برای بنر «امروز» روی صفحه‌ی خانه */
  async function warning() {
    try {
      if (!Backend.isActive() || Backend.isOffline() || Backend.isAdmin()) return null;
      const s = S.status(user());
      return s.warn ? { days: s.daysLeft } : null;
    } catch (e) { return null; }
  }

  /* ---------- نمایش ---------- */
  function paint() { const r = root(); if (!r) return; r.innerHTML = st.view === 'pay' ? payHtml() : (st.view === 'sent' ? sentHtml() : mainHtml()); }

  function statusCard() {
    const s = S.status(user());
    const fa = Utils.faDigits;
    const date = s.expiresAt ? Utils.faDate(s.expiresAt) : '';
    if (s.kind === 'admin') return '<div class="sub-status"><div class="sub-badge">مدیر</div><div class="sub-days">نیازی به اشتراک نیست</div><div class="sub-sm">حساب مدیر همیشه فعال است.</div></div>';
    if (s.kind === 'unlimited') return '<div class="sub-status"><div class="sub-badge">اشتراک فعال</div><div class="sub-days">بدون محدودیت زمانی</div></div>';
    if (s.kind === 'expired' || s.kind === 'suspended') return `<div class="sub-status expired"><div class="sub-badge">${s.kind === 'suspended' ? 'حساب غیرفعال' : 'اشتراک تمام شده'}</div><div class="sub-days">${s.kind === 'suspended' ? 'با پشتیبانی تماس بگیر' : 'برای ادامه، پلن انتخاب کن'}</div>${date ? `<div class="sub-sm">پایان: ${esc(date)}</div>` : ''}</div>`;
    const trial = s.kind === 'trial';
    return `<div class="sub-status"><div class="sub-badge">${trial ? 'دوره‌ی آموزشی' : 'اشتراک فعال'}</div>
      <div class="sub-days">${fa(s.daysLeft)} <small>روز مانده</small></div>
      ${trial ? `<div class="sub-bar"><i style="width:${Math.max(s.pct, 3)}%"></i></div><div class="sub-sm"><span>${fa(s.elapsed)} از ${fa(s.totalDays)} روز گذشته</span><span>پایان: ${esc(date)}</span></div>` : `<div class="sub-sm"><span>پایان: ${esc(date)}</span></div>`}</div>`;
  }

  function planCard(p) {
    const sel = p.days === st.days, fa = Utils.faDigits, sv = S.saving(p, st.plans);
    return `<button type="button" class="sub-plan${sel ? ' sel' : ''}" data-sub-pick="${p.days}" aria-pressed="${sel}">
      <span class="sub-radio">${sel ? svg(ICON.tick, 16) : ''}</span>
      <span class="sub-plan-body"><span class="sub-plan-t"><b>${esc(p.label)}</b><small>${fa(p.days)} روز</small>${p.badge ? `<em class="${p.days === 90 ? 'best' : 'rec'}">${esc(p.badge)}</em>` : ''}</span>
        <span class="sub-plan-d">روزی حدود ${S.money(S.perDay(p))} تومان</span>${sv ? `<span class="sub-save">صرفه‌جویی ${S.money(sv)} تومان</span>` : ''}</span>
      <span class="sub-price"><b>${S.money(p.amount)}</b><small>تومان</small></span></button>`;
  }

  function pendingCard() {
    const q = pending(); if (!q) return '';
    return `<div class="sub-pending">${svg(ICON.clock, 22)}<div class="rd-grow"><b>درخواست تمدید در انتظار تایید</b><div class="rd-hint">${esc(S.toFa(q.days))} روز · کد پیگیری ${esc(q.tracking_code)}</div></div><button type="button" class="rd-btn ghost sm" data-sub-view="sent">پیگیری</button></div>`;
  }

  function historyHtml() {
    const list = st.requests.filter((q) => q.status !== 'pending').slice(0, 4);
    if (!list.length) return '';
    return `<div class="rd-h">درخواست‌های قبلی</div>` + list.map((q) => `<div class="rd-card rd-static" style="margin-bottom:8px"><div class="rd-row"><b class="rd-grow">${Utils.faDigits(q.days)} روز · ${S.money(q.amount)} تومان</b><span class="rd-pill ${q.status === 'approved' ? 'ok' : 'bad'}">${esc(S.REQ_STATUS[q.status])}</span></div>${q.admin_note ? `<div class="rd-hint">${esc(q.admin_note)}</div>` : ''}</div>`).join('');
  }

  function mainHtml() {
    const p = planOf(st.days);
    const feats = ['مشتری‌ها و پیگیری', 'فایل‌ها و کارت ملک', 'همکاری‌ها', 'آگهی دیوار', 'یادآور تمدید'];
    return `${st.blocked ? '' : statusCard()}${pendingCard()}
      <div class="rd-row" style="margin:6px 4px 0"><b class="rd-grow" style="font-size:16px">${st.blocked ? 'تمدید اشتراک' : 'تمدید اشتراک'}</b><span class="rd-hint">امکانات همه‌ی پلن‌ها یکسان است</span></div>
      <div class="sub-plans">${st.plans.map(planCard).join('')}</div>
      <div class="rd-card rd-static"><b style="font-size:14px">همه‌ی پلن‌ها شامل</b><div class="sub-feats">${feats.map((f) => `<span>${svg(ICON.tick, 15)}${esc(f)}</span>`).join('')}</div></div>
      ${historyHtml()}
      <div class="sub-cta"><button type="button" class="rd-btn primary" data-sub-go="pay">ادامه و پرداخت · ${S.money(p.amount)} تومان</button></div>`;
  }

  const steps = (n) => `<div class="rd-card rd-static sub-steps">${['انتخاب پلن', 'پرداخت', 'ثبت رسید'].map((t, i) => `<div class="${i + 1 < n ? 'done' : (i + 1 === n ? 'now' : '')}"><span>${i + 1 < n ? svg(ICON.tick, 16) : Utils.faDigits(i + 1)}</span><small>${t}</small></div>`).join('')}</div>`;

  function payHtml() {
    const p = planOf(st.days), cfg = st.cfg || {};
    const hasCard = !!(cfg.card_number && cfg.card_number.trim());
    const num = S.toFa(String(cfg.card_number || '').trim());
    return `${steps(2)}
      <div class="rd-card rd-static"><div class="rd-row"><b class="rd-grow" style="font-size:16px">پلن ${esc(p.label)} · ${Utils.faDigits(p.days)} روز</b><button type="button" class="sub-link" data-sub-view="main">تغییر</button></div>
        <div class="rd-hint">مبلغ قابل پرداخت</div>
        <div class="rd-row"><span class="sub-amount rd-grow">${S.money(p.amount)} <small>تومان</small></span><button type="button" class="sub-copy" data-sub-copy="amount">${svg(ICON.copy, 16)}کپی مبلغ</button></div></div>
      ${hasCard ? `<div class="sub-bank"><div class="sub-bank-top"><span>شماره‌کارت مقصد</span><i></i></div><div class="sub-bank-num" dir="ltr">${esc(num)}</div>
        <div class="rd-row"><div class="rd-grow"><small>به نام</small><div class="sub-bank-own">${esc(cfg.card_owner || '')}</div></div><button type="button" class="sub-bank-copy" data-sub-copy="card">${svg(ICON.copy, 16)}کپی شماره</button></div></div>`
        : '<div class="rd-card rd-static rd-empty">اطلاعات کارت هنوز تنظیم نشده است؛ از پشتیبانی بپرس.</div>'}
      <div class="sub-note">${svg(ICON.clock, 18)}<span>مبلغ را دقیقاً با همین عدد واریز کن تا درخواستت سریع‌تر تایید شود.</span></div>
      <div class="rd-card rd-static"><b style="font-size:15px">بعد از پرداخت</b>
        <div class="set-row"><label>کد پیگیری تراکنش</label><input type="text" id="sub-track" autocomplete="off" inputmode="text" placeholder="مثلاً ۴۸۲۹۱۷" style="direction:ltr;text-align:right"></div>
        <div class="set-row"><label>۴ رقم آخر کارت مبدأ (اختیاری)</label><input type="text" id="sub-last4" autocomplete="off" inputmode="numeric" maxlength="4" placeholder="۰۰۰۰"></div></div>
      ${cfg.support_note ? `<div class="rd-hint" style="padding:0 4px">${esc(cfg.support_note)}</div>` : ''}
      <div class="sub-cta"><button type="button" class="rd-btn primary" data-sub-submit="1"${st.busy ? ' disabled' : ''}>ثبت پرداخت و درخواست تمدید</button></div>`;
  }

  function sentHtml() {
    const q = pending() || st.requests[0];
    if (!q) return `<div class="rd-card rd-static rd-empty">درخواستی ثبت نشده است.</div><div class="sub-cta"><button type="button" class="rd-btn primary" data-sub-view="main">بازگشت</button></div>`;
    const tl = (t, s, k) => `<div class="sub-tl ${k}"><span>${k === 'done' ? svg(ICON.tick, 15) : (k === 'now' ? svg(ICON.clock, 15) : '')}</span><div><b>${t}</b><small>${s}</small></div></div>`;
    const ok = q.status === 'approved', no = q.status === 'rejected';
    return `<div class="rd-card rd-static"><div class="rd-row"><b class="rd-grow" style="font-size:16px">${Utils.faDigits(q.days)} روز</b><span class="rd-pill ${ok ? 'ok' : (no ? 'bad' : 'warn')}">${esc(S.REQ_STATUS[q.status])}</span></div>
        <div class="rd-pair"><div class="sub-mini"><small>مبلغ</small><b>${S.money(q.amount)} تومان</b></div><div class="sub-mini"><small>کد پیگیری</small><b>${esc(q.tracking_code)}</b></div></div></div>
      <div class="rd-card rd-static">${tl('درخواست ثبت شد', esc(Utils.faDate(q.created_at)), 'done')}
        ${no ? tl('رد شد', esc(q.admin_note || 'با پشتیبانی تماس بگیر'), 'bad') : tl('بررسی پرداخت', 'پشتیبان رسید تو را بررسی می‌کند', ok ? 'done' : 'now')}
        ${no ? '' : tl('فعال‌سازی', ok ? 'اشتراکت تمدید شد' : `${Utils.faDigits(q.days)} روز به پایان اشتراک فعلی اضافه می‌شود`, ok ? 'done' : '')}</div>
      <div class="sub-cta"><button type="button" class="rd-btn ${ok ? 'primary' : 'ghost'}" data-sub-view="main">${ok ? 'عالی' : 'بازگشت به اشتراک من'}</button></div>`;
  }

  /* بالای صفحه (یا بالای پنجره‌ی انسدادی) */
  const top = () => { const r = root(); if (r && st.blocked && r.scrollIntoView) r.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0); };

  /* ---------- کپی ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); document.body.removeChild(t); return ok; } catch (e2) { return false; } }
  }

  /* ---------- رویدادها ---------- */
  function onInput(e) { /* مقدار کادرها هنگام ثبت خوانده می‌شود */ }

  async function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const D = t.dataset;
    if (D.subPick) { st.days = Number(D.subPick); paint(); return; }
    if (D.subGo === 'pay') { st.view = 'pay'; paint(); top(); return; }
    if (D.subView) { st.view = D.subView; paint(); top(); return; }
    if (D.subCopy) {
      const p = planOf(st.days);
      const text = D.subCopy === 'amount' ? String(p.amount) : String((st.cfg && st.cfg.card_number) || '').replace(/\s+/g, '');
      ctx.showToast((await copyText(text)) ? (D.subCopy === 'amount' ? 'مبلغ کپی شد ✓' : 'شماره‌کارت کپی شد ✓') : 'کپی نشد؛ دستی انتخاب کن', 'success');
      return;
    }
    if (D.subSubmit !== undefined) await submit(t);
  }

  async function submit(btn) {
    const r = root();
    try {
      const v = S.validateRequest({ days: st.days, tracking: r.querySelector('#sub-track').value, last4: r.querySelector('#sub-last4').value }, st.plans);
      btn.disabled = true; st.busy = true;
      await Backend.requestSubscription(v.days, v.tracking, v.last4);
      st.requests = await Backend.getMySubscriptionRequests().catch(() => st.requests);
      st.view = 'sent'; st.busy = false; paint(); top();
      ctx.showToast('درخواست ثبت شد ✓', 'success');
    } catch (err) {
      st.busy = false; btn.disabled = false;
      ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error');
    }
  }

  /* ---------- مدیر: درخواست‌های تمدید + هدیه‌ی روز ---------- */
  const adm = { users: [], gift: 7 };
  async function mountAdmin(el, users, giftEl) {
    if (!el) return;
    adm.users = users || [];
    if (!el.__admBound) { el.__admBound = true; el.addEventListener('click', onAdminClick); }
    if (giftEl && !giftEl.__admBound) { giftEl.__admBound = true; giftEl.addEventListener('click', onAdminClick); }
    el.__users = adm.users;
    const fa = Utils.faDigits;
    const opts = adm.users.filter((u) => u.role !== 'admin' && !u.archived_at).map((u) => `<option value="${esc(u.id)}">${esc(u.full_name || u.email || u.id)}</option>`).join('');
    const giftForm = `<div class="sub-gift">
        <select id="sa-gift-user" class="ad-input"><option value="">انتخاب کاربر…</option>${opts}</select>
        <div class="chip-row sub-gift-days">${[3, 7, 14, 30].map((d) => `<button type="button" class="chip${adm.gift === d ? ' active' : ''}" data-sa-gift-days="${d}">${fa(d)}+</button>`).join('')}</div>
        <button type="button" class="rd-btn primary" data-sa-gift="1">ثبت هدیه</button></div>`;
    /* تب هدیه جدا از درخواست‌هاست؛ بدون giftEl (حالت قدیمی) همه در یک کارت می‌آید */
    if (giftEl) giftEl.innerHTML = `<div class="set-card"><div class="set-title">🎁 هدیه‌ی روز به یک کاربر</div><div class="rd-hint" style="margin:-4px 0 10px">روزهای هدیه به پایان اشتراک اضافه می‌شود.</div>${giftForm}</div>`;
    let list = [];
    try { list = await Backend.adminGetSubscriptionRequests('pending'); }
    catch (e) {   // خطا را نشان می‌دهیم تا درخواست‌های پرداخت بی‌صدا پنهان نمانند
      el.innerHTML = `<div class="set-card"><div class="set-title">💳 درخواست‌های تمدید</div><div class="rd-hint" style="padding:6px 2px;color:#b91c1c">خطا در بارگذاری درخواست‌ها: ${esc(Backend.faErr(e))}</div></div>`;
      return;
    }
    const cnt = document.getElementById('adm-req-count');
    if (cnt) { cnt.textContent = fa(list.length); cnt.classList.toggle('hot', list.length > 0); }
    const card = (q) => `<div class="rd-card rd-static"><div class="rd-row"><span class="rd-avatar">${esc((q.full_name || q.email || '؟').trim().charAt(0))}</span>
        <div class="rd-grow"><div class="rd-title" style="font-size:16px">${esc(q.full_name || q.email || '—')}</div><div class="rd-hint">${esc(Utils.faDate(q.created_at))}</div></div>
        <div style="text-align:left"><b style="color:var(--brand-dark)">${S.money(q.amount)}</b><div class="rd-hint">${fa(q.days)} روز</div></div></div>
        <div class="rd-row"><span class="rd-hint">کد پیگیری</span><b>${esc(q.tracking_code)}</b>${q.card_last4 ? `<span class="rd-hint" style="margin-inline-start:auto">کارت …${esc(S.toFa(q.card_last4))}</span>` : ''}</div>
        <div class="sub-after">پایان بعد از تایید: <b>${esc(Utils.faDate(S.newExpiry(q.plan_expires_at, q.days)))}</b></div>
        <div class="rd-actions"><button type="button" class="rd-btn primary" data-sa-approve="${esc(q.id)}" style="flex:2">تایید و فعال‌سازی</button><button type="button" class="rd-btn danger" data-sa-reject="${esc(q.id)}" style="flex:1;width:auto">رد</button></div></div>`;
    el.innerHTML = `<div class="set-card"><div class="set-title">💳 درخواست‌های تمدید <span style="color:var(--muted);font-size:12px">(${fa(list.length)} در انتظار)</span></div>
      ${list.length ? list.map(card).join('') : '<div class="rd-hint" style="padding:6px 2px">درخواست در انتظاری نیست.</div>'}
      ${giftEl ? '' : `<div class="sub-gift"><b>🎁 هدیه‌ی روز به یک کاربر</b>${giftForm.replace('<div class="sub-gift">', '').replace(/<\/div>$/, '')}</div>`}</div>`;
  }

  async function onAdminClick(e) {
    const el = e.currentTarget, t = e.target.closest('button'); if (!t) return;
    const D = t.dataset;
    try {
      if (D.saGiftDays) { adm.gift = Number(D.saGiftDays); el.querySelectorAll('[data-sa-gift-days]').forEach((b) => b.classList.toggle('active', b.dataset.saGiftDays === D.saGiftDays)); return; }
      if (D.saGift !== undefined) {
        const uid = el.querySelector('#sa-gift-user').value;
        if (!uid) { ctx.showToast('یک کاربر انتخاب کن', 'error'); return; }
        t.disabled = true; await Backend.adminGiftDays(uid, adm.gift); ctx.showToast(Utils.faDigits(adm.gift) + ' روز هدیه ثبت شد ✓', 'success');
        if (ctx.onAdminChange) ctx.onAdminChange(); return;
      }
      if (D.saApprove || D.saReject) {
        const approve = !!D.saApprove, id = Number(D.saApprove || D.saReject);
        let note = null;
        if (!approve) {
          const reason = await ctx.showPrompt({ title: 'دلیل رد درخواست', message: 'اختیاری؛ این توضیح برای کاربر نمایش داده می‌شود.', placeholder: 'مثلاً: رسید خوانا نیست', maxLength: 200, confirmLabel: 'رد درخواست', icon: 'warn' });
          if (reason === null) return;   // انصراف
          note = String(reason).trim() || null;
          if (note === null && !(await ctx.showDialog({ title: 'رد بدون توضیح؟', message: 'درخواست بدون توضیح رد شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'رد کن', kind: 'btn-danger', value: true }] }))) return;
        }
        t.disabled = true; await Backend.adminDecideSubscription(id, approve, note);
        ctx.showToast(approve ? 'تایید شد و اشتراک تمدید شد ✓' : 'رد شد', 'success');
        if (ctx.onAdminChange) ctx.onAdminChange();
      }
    } catch (err) { t.disabled = false; ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  return { init, render, mountInto, mountAdmin, warning };
})();
if (typeof globalThis !== 'undefined') globalThis.Subscription = Subscription;

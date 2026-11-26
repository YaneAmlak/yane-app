'use strict';
/* ============================================================
   پرونده‌ی مشتری — رابط کاربری (لیست مشتری‌ها + پرونده‌ی هر مشتری)
   وابستگی‌ها از app.js تزریق می‌شود: Clients.init({ $id, showScreen, showSheet, showDialog, showToast })
   ============================================================ */
const Clients = (() => {
  const C = ClientsCore;
  let ctx = null;
  const st = { all: [], stage: 'all', q: '', currentId: null, notes: [], listings: [], noteKind: 'note' };

  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);
  const byId = (id) => st.all.find((c) => String(c.id) === String(id));

  function init(c) {
    ctx = c;
    $('btn-cl-add').addEventListener('click', () => openClientSheet());
    $('cl-search').addEventListener('input', Utils.debounce(() => { st.q = $('cl-search').value; paintList(); }, 150));
    $('cl-stages').addEventListener('click', (e) => {
      const b = e.target.closest('[data-stage]'); if (!b) return;
      st.stage = b.dataset.stage; paintList();
    });
    $('cl-filter').addEventListener('click', openStageSheet);
    $('cl-list').addEventListener('click', (e) => {
      if (e.target.closest('a[href^="tel:"]')) return;   // تماس مستقیم، نه باز کردن پرونده
      const card = e.target.closest('[data-cl-open]'); if (card) open(card.dataset.clOpen);
    });
    $('cl-detail').addEventListener('click', onDetailClick);
  }

  /* ---------- لیست ---------- */
  async function renderList() {
    if (!Backend.isActive()) {
      $('cl-list').innerHTML = '<div class="info-note">این بخش نیاز به ورود به حساب دارد.</div>';
      return;
    }
    $('cl-list').innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    try { st.all = await Backend.getClients(); paintList(); }
    catch (err) { $('cl-list').innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + esc(Backend.faErr(err)) + '</p></div>'; }
  }

  function paintList() {
    const counts = { all: st.all.length };
    C.STAGES.forEach((s) => { counts[s.key] = st.all.filter((c) => c.stage === s.key).length; });
    counts.overdue = st.all.filter((c) => C.followupState(c) === 'overdue').length;
    const chip = (key, label, red) => `<button type="button" class="${st.stage === key ? 'on' : ''}" data-stage="${key}">${label}<em class="${red && counts[key] ? 'red' : ''}${counts[key] ? '' : ' z'}">${Utils.faDigits(counts[key] || 0)}</em></button>`;
    /* نوار ثابت: همه، عقب‌افتاده و سه مرحله‌ی اصلی؛ «معامله» و «از دست رفته» از دکمه‌ی فیلتر کنار جستجو */
    $('cl-stages').innerHTML = chip('all', 'همه') + chip('overdue', 'عقب‌افتاده', true) + ['first_call', 'visit', 'negotiation'].map((k) => chip(k, C.stageLabel(k))).join('');
    const hidden = st.stage === 'won' || st.stage === 'lost';
    const dot = $('cl-filter').querySelector('.lr-dot'); if (dot) dot.hidden = !hidden;

    let list = st.all.filter((c) => (st.stage === 'all' || (st.stage === 'overdue' ? C.followupState(c) === 'overdue' : c.stage === st.stage)) && C.matchesQuery(c, st.q));
    list = C.sortClients(list);
    $('cl-empty').hidden = list.length > 0;
    $('cl-empty').querySelector('p').textContent = st.all.length ? 'مشتری‌ای پیدا نشد.' : 'هنوز مشتری‌ای ثبت نشده است.';
    $('cl-list').innerHTML = list.map(cardHtml).join('');
  }

  const faPhoneNum = (p) => String(p || '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

  /* فیلتر کامل مرحله‌ها (شامل معامله و از دست رفته) */
  function openStageSheet() {
    const items = [['all', 'همه', st.all.length]].concat(C.STAGES.map((s) => [s.key, s.icon + ' ' + s.label, st.all.filter((c) => c.stage === s.key).length]));
    ctx.showSheet({
      title: 'فیلتر مرحله',
      html: '<div class="stage-pick">' + items.map(([k, lb, n]) => `<button type="button" class="${st.stage === k ? 'on' : ''}" data-pick="${k}"><span>${esc(lb)}</span><em>${Utils.faDigits(n)}</em></button>`).join('') + '</div>',
      onMount(body, close) {
        body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { st.stage = b.dataset.pick; paintList(); close(); }));
      }
    });
  }

  const PHONE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/></svg>';
  const CLOCK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>';

  /* ردیف فشرده‌ی مشتری: نوار رنگی وضعیت پیگیری، اسم + مرحله، نیاز، پیگیری، و دکمه‌ی تماس */
  function cardHtml(c) {
    const fs = C.followupState(c);
    const fu = C.followupText(c);
    const cls = fs === 'overdue' ? 'bad' : fs === 'today' ? 'warn' : 'gray';
    const bar = fs === 'overdue' ? '#ef4444' : fs === 'today' ? '#f59e0b' : c.stage === 'won' ? '#22c55e' : '#cbd5e1';
    const tags = [C.INTENTS[c.intent], c.budgetMax ? 'تا ' + C.fmtShort(c.budgetMax) : '', c.areas].filter(Boolean);
    return `<div class="lrow" data-cl-open="${esc(c.id)}" role="button" tabindex="0" style="--c:${bar}">
      <div class="lr-mid"><b>${esc(c.name)}<span class="tp stg">${esc(C.stageLabel(c.stage))}</span></b>
        ${tags.length ? `<span class="lr-spec">${esc(tags.join(' · '))}</span>` : ''}
        ${fu ? `<span class="lr-tags"><i class="st ${cls}">${CLOCK_SVG}${esc(fu.replace('پیگیری: ', '') + ' · ' + Utils.faDate(c.nextFollowupDate))}</i></span>` : ''}</div>
      ${c.phone ? `<a class="lr-call" href="tel:${esc(c.phone)}" aria-label="تماس ${esc(faPhoneNum(c.phone))}">${PHONE_SVG}</a>` : ''}
    </div>`;
  }

  /* ---------- پرونده‌ی یک مشتری ---------- */
  function open(id) { st.currentId = id; st.noteKind = 'note'; ctx.showScreen('client'); }

  async function renderDetail() {
    if (!byId(st.currentId)) { try { st.all = await Backend.getClients(); } catch (err) { /* پایین پیام می‌دهد */ } }
    const c = byId(st.currentId);
    if (!c) { $('cl-detail').innerHTML = '<div class="empty-state"><p>مشتری پیدا نشد.</p></div>'; return; }
    $('cl-detail').innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    try { st.notes = await Backend.getClientNotes(c.id); }
    catch (err) { st.notes = []; ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
    try { st.listings = await Backend.getListings(); } catch (err) { st.listings = []; }   // فقط برای «فایل‌های پیشنهادی»
    paintDetail();
  }

  function paintDetail() {
    const c = byId(st.currentId); if (!c) return;
    const summary = C.buildSummary(c, st.notes);
    const tel = c.phone ? `<a href="tel:${esc(c.phone)}" class="rd-btn primary" style="text-decoration:none">تماس ${esc(faPhoneNum(c.phone))}</a>` : '';
    const fu = C.followupText(c);
    $('cl-detail').innerHTML = `
      <div class="rd-card rd-static rd-hero">
        <div class="rd-row"><span class="rd-avatar big">${esc((c.name || '؟').trim().charAt(0))}</span><div class="rd-title big rd-grow">${esc(c.name)}</div>
          <button class="rd-btn ghost sm" data-cl-act="edit">ویرایش</button></div>
        ${tel}
        <div class="rd-stages">${C.STAGES.map((s2) => `<button class="${c.stage === s2.key ? 'on' : ''}" data-cl-stage="${s2.key}">${s2.label}</button>`).join('')}</div>
        ${c.stage === 'lost' && c.lostReason ? `<div class="rd-hint">دلیل: ${esc(C.LOST_REASONS[c.lostReason] || '')}</div>` : ''}
      </div>

      <div class="rd-summary">
        <div class="rd-sum-title">خلاصه قبل از تماس</div>
        ${summary.length ? summary.map((l) => `<div>• ${esc(l)}</div>`).join('') : '<div>هنوز اطلاعاتی ثبت نشده است.</div>'}
      </div>

      ${suggestHtml(c)}

      ${c.stage !== 'won' && c.stage !== 'lost' ? `
      <div class="rd-card rd-static"><div class="rd-row"><span class="rd-lvl rd-grow">پیگیری بعدی</span>${fu ? `<span class="rd-pill ${C.followupState(c) === 'overdue' ? 'bad' : C.followupState(c) === 'today' ? 'warn' : 'mute'}">${esc(fu.replace('پیگیری: ', '') + ' · ' + Utils.faDate(c.nextFollowupDate))}</span>` : ''}</div>
        <div class="chip-row rd-fu" style="margin:0;flex-wrap:wrap">
          <button class="chip" data-cl-fu="0">امروز</button><button class="chip" data-cl-fu="1">فردا</button>
          <button class="chip" data-cl-fu="3">۳ روز دیگر</button><button class="chip" data-cl-fu="7">هفته‌ی دیگر</button>
          <button class="chip" data-cl-fu="custom">دلخواه…</button>${c.nextFollowupDate ? '<button class="chip" data-cl-fu="clear">حذف</button>' : ''}
        </div></div>` : ''}

      <div class="rd-card rd-static"><span class="rd-lvl">یادداشت جدید</span>
        <div class="chip-row rd-kinds" style="margin:0 0 8px;flex-wrap:wrap">${Object.keys(C.NOTE_KINDS).map((k) => `<button class="chip${st.noteKind === k ? ' active' : ''}" data-cl-kind="${k}">${C.NOTE_KINDS[k]}</button>`).join('')}</div>
        <textarea id="cl-note-text" rows="3" style="width:100%;resize:vertical;border-radius:16px" placeholder="مثلاً: پارکینگ براش مهمه، طبقه‌ی همکف رو رد کرد"></textarea>
        <button class="rd-btn primary" data-cl-act="add-note" style="margin-top:8px">ثبت یادداشت</button>
      </div>

      <div class="rd-h">تاریخچه</div>
      ${st.notes.length ? st.notes.map((n) => `
        <div class="order-card" style="cursor:default;align-items:flex-start">
          <div class="oc-body"><div class="oc-sub">${esc(C.NOTE_KINDS[n.kind] || '')} · ${esc(Utils.faDateShort(n.createdAt))} ${esc(Utils.faTime ? Utils.faTime(n.createdAt) : '')}</div>
          <div style="white-space:pre-wrap;margin-top:2px">${esc(n.text)}</div></div>
          <button class="wv-del" data-cl-delnote="${esc(n.id)}" aria-label="حذف">✕</button>
        </div>`).join('') : '<div class="oc-sub" style="padding:0 2px">هنوز یادداشتی ثبت نشده است.</div>'}

      <button class="rd-btn danger" data-cl-act="delete" style="margin-top:16px">حذف مشتری</button>`;
  }

  /* فایل‌های فعالِ مناسب این مشتری (حداکثر ۵ تا) */
  function suggestHtml(c) {
    const LC = ListingsCore, list = LC.matchListingsForClient(c, st.listings).slice(0, 5);
    if (!list.length) return '';
    return '<div style="font-weight:700;margin:6px 2px 8px">🏠 فایل‌های پیشنهادی</div>' + list.map((x) => {
      const l = x.listing;
      return `<div class="order-card" data-cl-listing="${esc(l.id)}"><div class="oc-no" style="font-size:20px">${LC.TYPES[l.type].icon}</div>
        <div class="oc-body"><div class="oc-title">${esc(LC.TYPES[l.type].label)} · ${esc(l.area)}</div>
        <div class="oc-sub">${esc([LC.specText(l), LC.priceText(l)].filter(Boolean).join(' — ').replace(/ \| /g, ' · '))}</div>
        <div class="oc-sub" style="color:var(--ok)">${esc(x.m.reasons.join('، '))}${x.m.warns.length ? ' · ' + esc(x.m.warns.join('، ')) : ''}</div></div></div>`;
    }).join('');
  }

  async function onDetailClick(e) {
    const c = byId(st.currentId); if (!c) return;
    const lc = e.target.closest('[data-cl-listing]');
    if (lc && ctx.openListing) { ctx.openListing(lc.dataset.clListing); return; }
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.clStage) { await changeStage(c, t.dataset.clStage); return; }
      if (t.dataset.clKind) { st.noteKind = t.dataset.clKind; const txt = $('cl-note-text').value; paintDetail(); $('cl-note-text').value = txt; return; }
      if (t.dataset.clFu !== undefined) { await setFollowup(c, t.dataset.clFu); return; }
      if (t.dataset.clDelnote) {
        const ok = await ctx.showDialog({ title: 'حذف یادداشت', message: 'این یادداشت حذف شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }] });
        if (!ok) return;
        await Backend.deleteClientNote(t.dataset.clDelnote); st.notes = await Backend.getClientNotes(c.id); paintDetail(); return;
      }
      const act = t.dataset.clAct;
      if (act === 'edit') openClientSheet(c);
      else if (act === 'add-note') {
        const text = $('cl-note-text').value.trim();
        if (!text) { ctx.showToast('متن یادداشت را بنویس', 'error'); return; }
        t.disabled = true;
        await Backend.addClientNote({ clientId: c.id, kind: st.noteKind, text });
        st.notes = await Backend.getClientNotes(c.id); st.noteKind = 'note';
        ctx.showToast('ثبت شد ✓', 'success'); paintDetail();
      } else if (act === 'delete') {
        const ok = await ctx.showDialog({ title: 'حذف مشتری', message: 'پرونده‌ی «' + c.name + '» همراه همه‌ی یادداشت‌هایش برای همیشه حذف شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }] });
        if (!ok) return;
        await Backend.deleteClient(c.id);
        st.all = st.all.filter((x) => x.id !== c.id);
        ctx.showToast('حذف شد', 'success'); ctx.showScreen('clients');
      }
    } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); paintDetail(); }
  }

  async function save(c, patch) {
    const updated = await Backend.putClient(Object.assign({ id: c.id }, patch));
    const i = st.all.findIndex((x) => x.id === c.id);
    if (i >= 0) st.all[i] = Object.assign(st.all[i], updated);
    return st.all[i];
  }

  async function changeStage(c, stage) {
    if (c.stage === stage) return;
    if (stage === 'lost') {
      ctx.showSheet({
        title: 'چرا از دست رفت؟',
        html: '<div class="chip-row" style="flex-wrap:wrap;margin:0">' + Object.keys(C.LOST_REASONS).map((k) => `<button class="chip" data-r="${k}">${C.LOST_REASONS[k]}</button>`).join('') + '</div>',
        onMount(body, close) {
          body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
            try { await save(c, { stage: 'lost', lostReason: b.dataset.r, nextFollowupDate: null }); close(); paintDetail(); }
            catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
          }));
        }
      });
      return;
    }
    await save(c, { stage, lostReason: null, nextFollowupDate: stage === 'won' ? null : c.nextFollowupDate });
    paintDetail();
  }

  async function setFollowup(c, v) {
    if (v === 'custom') {
      ctx.showSheet({
        title: 'تاریخ پیگیری',
        html: `<div class="set-row"><label>تاریخ پیگیری بعدی</label>${JDate.html('cl-fu-date', c.nextFollowupDate || C.addDaysISO(1))}</div>
               <div class="dialog-btns"><button class="btn btn-ghost" id="cl-fu-cancel">انصراف</button><button class="btn btn-primary" id="cl-fu-ok">ثبت</button></div>`,
        onMount(body, close) {
          body.querySelector('#cl-fu-cancel').onclick = close;
          body.querySelector('#cl-fu-ok').onclick = async () => {
            const d = JDate.get(body.querySelector('#cl-fu-date'));
            if (!d) { ctx.showToast('تاریخ را کامل و معتبر انتخاب کن', 'error'); return; }
            if (JDate.isPast(d)) { ctx.showToast('تاریخ پیگیری نباید گذشته باشد', 'error'); return; }
            try { await save(c, { nextFollowupDate: d }); close(); paintDetail(); }
            catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
          };
        }
      });
      return;
    }
    await save(c, { nextFollowupDate: v === 'clear' ? null : C.addDaysISO(Number(v)) });
    paintDetail();
  }

  /* ---------- فرم افزودن/ویرایش ---------- */
  function openClientSheet(c) {
    const e = c || {};
    const field = (label, inner) => `<div class="set-row"><label>${label}</label>${inner}</div>`;
    ctx.showSheet({
      title: c ? '✏️ ویرایش مشتری' : '＋ مشتری جدید',
      html: `
        ${field('نام *', `<input type="text" id="cf-name" value="${esc(e.name || '')}" autocomplete="off">`)}
        ${field('شماره‌ی تماس', `<input type="tel" id="cf-phone" value="${esc(e.phone || '')}" inputmode="tel" autocomplete="off">`)}
        ${field('نوع نیاز', `<select id="cf-intent">${C.INTENT_KEYS.map((k) => `<option value="${k}"${(e.intent || 'buy') === k ? ' selected' : ''}>${C.INTENTS[k]}</option>`).join('')}</select>`)}
        <div class="set-row"><label id="cf-budget-label">بودجه (حداکثر)</label>${Utils.moneyHtml('cf-budget', e.budgetMax, 'b')}</div>
        <div class="set-row" id="cf-rent-row"><label>اجاره‌ی ماهانه (حداکثر)</label>${Utils.moneyHtml('cf-rent', e.rentMax, 't')}</div>
        ${field('محله‌های دلخواه', `<input type="text" id="cf-areas" value="${esc(e.areas || '')}" placeholder="آپادانا، شهرک غرب" autocomplete="off">`)}
        ${field('حداقل متراژ', `<input type="text" id="cf-size" inputmode="numeric" value="${e.minSize || ''}">`)}
        ${field('موارد مهم', `<input type="text" id="cf-must" value="${esc(e.mustHaves || '')}" placeholder="پارکینگ، آسانسور، طبقه‌ی بالا" autocomplete="off">`)}
        <div class="dialog-btns"><button class="btn btn-ghost" id="cf-cancel">انصراف</button><button class="btn btn-primary" id="cf-save">ذخیره</button></div>`,
      onMount(body, close) {
        const q = (id) => body.querySelector(id);
        Utils.moneyBind(body);
        const syncIntent = () => {
          const buy = q('#cf-intent').value === 'buy';
          q('#cf-rent-row').hidden = buy;
          q('#cf-budget-label').textContent = buy ? 'بودجه (حداکثر)' : 'رهن (حداکثر)';
        };
        q('#cf-intent').addEventListener('change', syncIntent);
        syncIntent();
        // فوکوس خودکار فقط اگر کاربر هنوز روی فیلدی نرفته (وگرنه فوکوسش را نمی‌دزدیم)
        if (!c) setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || !body.contains(a)) q('#cf-name').focus(); }, 60);
        q('#cf-cancel').onclick = close;
        q('#cf-save').onclick = async () => {
          const num = (v) => { const n = C.parseDecimal(v); return isNaN(n) ? '' : n; };
          const btn = q('#cf-save');
          try {
            const sRaw = q('#cf-size').value.trim();
            const bVal = Utils.moneyRead(body, 'cf-budget'), rVal = Utils.moneyRead(body, 'cf-rent');
            if (typeof bVal === 'number' && isNaN(bVal)) throw Object.assign(new Error('بودجه معتبر نیست.'), { userFacing: true });
            if (typeof rVal === 'number' && isNaN(rVal)) throw Object.assign(new Error('اجاره معتبر نیست.'), { userFacing: true });
            const row = C.validateClient({
              name: q('#cf-name').value, phone: q('#cf-phone').value, intent: q('#cf-intent').value,
              budgetMax: bVal, rentMax: rVal,
              areas: q('#cf-areas').value, minSize: sRaw ? num(sRaw) : '', mustHaves: q('#cf-must').value
            });
            const dup = row.phone && st.all.find((x) => x.phone === row.phone && (!c || x.id !== c.id));
            if (dup) {
              const ok = await ctx.showDialog({ title: 'شماره‌ی تکراری', message: 'این شماره قبلاً برای «' + dup.name + '» ثبت شده است. باز هم ذخیره شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'ذخیره', value: true }] });
              if (!ok) return;
            }
            btn.disabled = true;
            const saved = await Backend.putClient(c ? Object.assign({ id: c.id }, row) : row);
            const i = st.all.findIndex((x) => x.id === saved.id);
            if (i >= 0) st.all[i] = Object.assign(st.all[i], saved); else st.all.unshift(saved);
            close();
            ctx.showToast('ذخیره شد ✓', 'success');
            if (c) paintDetail(); else open(saved.id);
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  /* نشان خانه: تعداد پیگیری‌های امروز/عقب‌افتاده */
  async function updateBadge() {
    const el = ctx && $('cl-badge'); if (!el) return;
    if (!Backend.isActive()) { el.textContent = ''; return; }
    try {
      st.all = await Backend.getClients();
      const due = st.all.filter((c) => { const s = C.followupState(c); return s === 'overdue' || s === 'today'; }).length;
      el.textContent = 'CRM مشاور'; el.style.color = ''; el.style.fontWeight = '';
      const dot = $('cl-dot'); if (dot) { dot.textContent = due > 0 ? Utils.faDigits(due) : ''; dot.hidden = !(due > 0); }
    } catch (e) { el.textContent = 'CRM مشاور'; }
  }

  return { init, renderList, renderDetail, updateBadge, open };
})();
if (typeof globalThis !== 'undefined') globalThis.Clients = Clients;

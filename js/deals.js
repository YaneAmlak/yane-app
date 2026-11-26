'use strict';
/* ============================================================
   قراردادها و معامله‌ها — صفحه‌ی مستقل (رادار تمدید + پیام بعد از معامله)
   Deals.init({ $id, showSheet, showDialog, showToast }) ؛ Deals.render()
   ============================================================ */
const Deals = (() => {
  const D = DealsCore, C = ClientsCore;
  const TPL_KEYS = Object.keys(D.DEFAULT_TEMPLATES);
  let ctx = null;
  const st = { deals: [], settings: D.normalizeSettings({}), agency: '', tab: 'due', first: true };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);
  const todayISO = () => C.isoDate(new Date());
  const KIND = { rent: { icon: '🔑', label: 'اجاره', a: 'مستأجر', b: 'مالک' }, sale: { icon: '🏠', label: 'خرید و فروش', a: 'خریدار', b: 'فروشنده' } };

  function init(c) {
    ctx = c;
    $('dl-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-dl-tab]'); if (b) { st.tab = b.dataset.dlTab; paint(); } });
    $('dl-add').addEventListener('click', () => openDealSheet(null));
    $('dl-list').addEventListener('click', onListClick);
    $('dl-save-settings').addEventListener('click', saveSettings);
  }

  async function render() {
    if (!Backend.isActive()) { $('dl-body').style.display = 'none'; $('dl-guard').textContent = 'این بخش فقط با ورود به حساب کار می‌کند.'; return; }
    $('dl-guard').textContent = ''; $('dl-body').style.display = '';
    try {
      const [deals, saved, rc] = await Promise.all([Backend.getDeals(), Backend.getSetting('deal_settings', {}).catch(() => ({})), Backend.getSetting('rc_settings', {}).catch(() => ({}))]);
      st.deals = deals; st.settings = D.normalizeSettings(saved || {}); st.agency = String((rc && rc.agency) || '');
    } catch (err) {
      $('dl-guard').textContent = 'خطا در بارگذاری: ' + Backend.faErr(err);
      return;
    }
    if (st.first) { const r = reminders(); st.tab = r.due.length || r.upcoming.length ? 'due' : 'all'; st.first = false; }
    paintSettings(); paint();
  }

  const reminders = () => D.buildReminders(st.deals, todayISO(), { leadDays: st.settings.leadDays });

  function paint() {
    const r = reminders();
    const n = r.due.length;
    const chip = (k, label) => `<button type="button" class="${st.tab === k ? 'on' : ''}" data-dl-tab="${k}">${label}</button>`;
    $('dl-tabs').innerHTML = chip('all', 'همه (' + Utils.faDigits(st.deals.length) + ')') + chip('due', 'یادآوری‌ها' + (n ? ' (' + Utils.faDigits(n) + ')' : ''));
    $('dl-list').innerHTML = st.tab === 'due' ? dueHtml(r) : allHtml();
  }

  function itemHtml(it) {
    const d = it.deal;
    const sub = it.step === 'renew'
      ? (it.daysToEnd >= 0 ? Utils.faDigits(it.daysToEnd) + ' روز تا پایان قرارداد' : 'قرارداد ' + Utils.faDigits(-it.daysToEnd) + ' روز پیش تمام شده')
      : it.label;
    const color = it.state === 'due' ? 'var(--amber)' : 'var(--muted)';
    return `<div class="rd-card" data-dl-edit="${esc(d.id)}">
      <div class="rd-row"><div class="rd-grow"><div class="rd-title">${esc(d.clientName)}</div>${d.property ? `<div class="rd-hint">${esc(d.property)}</div>` : ''}</div>
        <span class="rd-pill ${it.state === 'due' ? 'warn' : 'mute'}">${esc(it.step === 'renew' ? 'تمدید' : 'پیام')}</span></div>
      <div class="rd-hint" style="color:${color};font-weight:700">${esc(it.step === 'renew' ? 'تمدید: ' + sub : sub)}</div>
      <button type="button" class="rd-btn soft" data-dl-msg="${esc(it.key)}">ارسال پیام</button></div>`;
  }

  function dueHtml(r) {
    if (!r.due.length && !r.upcoming.length) {
      return `<div class="empty-state"><p>${st.deals.length ? '✅ یادآوری‌ای نداری.' : 'هنوز معامله‌ای ثبت نکرده‌ای. با «➕ ثبت معامله» شروع کن.'}</p></div>`;
    }
    const sec = (title, list) => list.length ? `<div class="rd-h">${title} ${Utils.faDigits(list.length)}</div>` + list.map(itemHtml).join('') : '';
    return sec('سررسید شده', r.due) + sec('به‌زودی', r.upcoming);
  }

  function allHtml() {
    if (!st.deals.length) return '<div class="empty-state"><p>هنوز معامله‌ای ثبت نکرده‌ای.</p></div>';
    const now = Date.now();
    return st.deals.map((d) => {
      const k = KIND[d.kind] || KIND.sale;
      const t0 = Date.parse(d.dealDate), t1 = d.kind === 'rent' && d.endDate ? Date.parse(d.endDate) : NaN;
      const hasSpan = isFinite(t0) && isFinite(t1) && t1 > t0;
      const pct = hasSpan ? Math.max(0, Math.min(100, Math.round((now - t0) / (t1 - t0) * 100))) : 0;
      const left = hasSpan ? Math.ceil((t1 - now) / 86400000) : null;
      return `<div class="rd-card" data-dl-edit="${esc(d.id)}">
        <div class="rd-row"><div class="rd-grow"><div class="rd-title">${esc(d.clientName)}</div>${d.property ? `<div class="rd-hint">${esc(d.property)}</div>` : ''}</div><span class="rd-badge t-${d.kind === 'rent' ? 'rent' : 'sale'}">${esc(k.label)}</span></div>
        <div class="rd-dates"><div><div class="rd-lbl">${d.kind === 'rent' ? 'شروع' : 'تاریخ معامله'}</div><div class="rd-val sm">${esc(Utils.faDateShort(d.dealDate))}</div></div>${d.kind === 'rent' && d.endDate ? `<div><div class="rd-lbl">پایان:</div><div class="rd-val sm">${esc(Utils.faDateShort(d.endDate))}</div></div>` : ''}</div>
        ${hasSpan ? `<div><div class="rd-prog-l"><span>${left >= 0 ? Utils.faDigits(left) + ' روز تا پایان قرارداد' : 'قرارداد تمام شده'}</span><span>${Utils.faDigits(pct)}٪</span></div><div class="rd-prog"><i style="width:${Math.max(pct, 3)}%"></i></div></div>` : ''}
      </div>`;
    }).join('');
  }

  function onListClick(e) {
    const m = e.target.closest('[data-dl-msg]');
    if (m) { const it = [].concat(reminders().due, reminders().upcoming).find((x) => x.key === m.dataset.dlMsg); if (it) openMsgSheet(it); return; }
    const ed = e.target.closest('[data-dl-edit]');
    if (ed) { const d = st.deals.find((x) => String(x.id) === ed.dataset.dlEdit); if (d) openDealSheet(d); }
  }

  /* ---------- پیام آماده ---------- */
  function openMsgSheet(it) {
    const msgs = D.messagesFor(it, st.settings.templates, st.agency);
    const d = it.deal;
    ctx.showSheet({
      title: (it.step === 'renew' ? '🔁 ' : '💬 ') + d.clientName,
      html: msgs.map((m, i) => `<div class="set-row"><label>${esc(m.label)}${m.phone ? '' : ' — بدون شماره (مخاطب را در واتساپ انتخاب کن)'}</label>
          <textarea id="dm-text-${i}" rows="4" style="width:100%;resize:vertical"></textarea>
          <button type="button" class="btn btn-primary btn-sm" id="dm-send-${i}" style="margin-top:6px">💬 ارسال در واتساپ</button></div>`).join('') +
        `<div class="btn-row" style="margin-top:8px"><button type="button" class="btn btn-primary" id="dm-done">✅ انجام شد</button><button type="button" class="btn btn-ghost" id="dm-off">🚫 حذف از چرخه</button></div>`,
      onMount(body, close) {
        msgs.forEach((m, i) => {
          body.querySelector('#dm-text-' + i).value = m.text;
          body.querySelector('#dm-send-' + i).onclick = () => window.open(D.waLink(m.phone, body.querySelector('#dm-text-' + i).value), '_blank', 'noopener');
        });
        body.querySelector('#dm-done').onclick = async () => {
          try { await patch(d, { done: D.markDone(d.done, it.step, todayISO()) }); close(); ctx.showToast('انجام شد ✓', 'success'); paint(); }
          catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
        body.querySelector('#dm-off').onclick = async () => {
          try { await patch(d, it.step === 'renew' ? { trackRenewal: false } : { trackAfter: false }); close(); ctx.showToast('از چرخه حذف شد', 'success'); paint(); }
          catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  async function patch(deal, fields) {
    const saved = await Backend.putDeal(Object.assign({ id: deal.id }, fields));
    const i = st.deals.findIndex((x) => x.id === deal.id);
    if (i >= 0) st.deals[i] = Object.assign(st.deals[i], saved);
    return saved;
  }

  /* ---------- ثبت / ویرایش ---------- */
  function openDealSheet(deal) {
    const isNew = !deal;
    const e = deal || { kind: 'rent', dealDate: todayISO(), trackAfter: true, trackRenewal: true };
    ctx.showSheet({
      title: isNew ? '➕ ثبت معامله / قرارداد' : '✏️ ویرایش',
      html: `<div class="chip-row" style="margin:0 0 8px"><button type="button" class="chip" id="dd-kind-rent">🔑 اجاره</button><button type="button" class="chip" id="dd-kind-sale">🏠 خرید و فروش</button></div>
        <div class="set-row"><label id="dd-clabel">مستأجر *</label><input type="text" id="dd-cname" autocomplete="off" value="${esc(e.clientName || '')}"></div>
        <div class="set-row"><label>شماره‌ی او (برای پیام واتساپ)</label><input type="text" id="dd-cphone" inputmode="tel" autocomplete="off" value="${esc(e.clientPhone || '')}"></div>
        <div class="set-row"><label id="dd-olabel">مالک</label><input type="text" id="dd-oname" autocomplete="off" value="${esc(e.otherName || '')}"></div>
        <div class="set-row"><label>شماره‌ی مالک</label><input type="text" id="dd-ophone" inputmode="tel" autocomplete="off" value="${esc(e.otherPhone || '')}"></div>
        <div class="set-row"><label>مشخصات ملک (اختیاری)</label><input type="text" id="dd-prop" autocomplete="off" placeholder="مثلاً: ۸۵ متری شهرک غرب" value="${esc(e.property || '')}"></div>
        <div class="set-row"><label>تاریخ معامله *</label>${JDate.html('dd-date', e.dealDate || '', { yearsBack: 3, yearsFwd: 3 })}</div>
        <div id="dd-end-row"><div class="set-row"><label>تاریخ پایان قرارداد *</label>${JDate.html('dd-end', e.endDate || '', { yearsBack: 1, yearsFwd: 8 })}
          <div class="chip-row" style="margin:6px 0 0"><button type="button" class="chip" id="dd-end-6">۶ ماه</button><button type="button" class="chip" id="dd-end-12">۱ سال</button></div></div></div>
        <div class="set-row"><label><input type="checkbox" id="dd-after"${e.trackAfter !== false ? ' checked' : ''}> یادآوری پیام ۱، ۶ و ۱۲ ماه بعد از معامله</label></div>
        <div class="set-row" id="dd-renew-row"><label><input type="checkbox" id="dd-renew"${e.trackRenewal !== false ? ' checked' : ''}> رادار تمدید (یادآوری قبل از پایان قرارداد)</label></div>
        <div class="set-row"><label>یادداشت (اختیاری)</label><input type="text" id="dd-notes" autocomplete="off" value="${esc(e.notes || '')}"></div>
        <div class="btn-row"><button type="button" class="btn btn-primary" id="dd-save">ثبت</button>${isNew ? '<button type="button" class="btn btn-ghost" id="dd-save-next">ثبت و بعدی</button>' : ''}</div>
        ${isNew ? '' : '<button type="button" class="btn btn-ghost" id="dd-delete" style="margin-top:8px;color:var(--danger)">🗑 حذف</button>'}`,
      onMount(body, close) {
        const q = (s) => body.querySelector(s);
        let kind = e.kind === 'sale' ? 'sale' : 'rent';
        const syncKind = () => {
          const k = KIND[kind];
          q('#dd-kind-rent').className = 'chip' + (kind === 'rent' ? ' active' : '');
          q('#dd-kind-sale').className = 'chip' + (kind === 'sale' ? ' active' : '');
          q('#dd-clabel').textContent = k.a + ' *'; q('#dd-olabel').textContent = k.b;
          q('#dd-end-row').style.display = kind === 'rent' ? '' : 'none';
          q('#dd-renew-row').style.display = kind === 'rent' ? '' : 'none';
        };
        q('#dd-kind-rent').onclick = () => { kind = 'rent'; syncKind(); };
        q('#dd-kind-sale').onclick = () => { kind = 'sale'; syncKind(); };
        const endIn = (m) => { const d = q('#dd-date').value; if (d) JDate.set(q('#dd-end'), D.addMonthsISO(d, m)); };
        q('#dd-end-6').onclick = () => endIn(6);
        q('#dd-end-12').onclick = () => endIn(12);
        syncKind();

        const collect = () => ({ kind, clientName: q('#dd-cname').value, clientPhone: q('#dd-cphone').value, otherName: q('#dd-oname').value, otherPhone: q('#dd-ophone').value,
          property: q('#dd-prop').value, dealDate: q('#dd-date').value, endDate: q('#dd-end').value, trackAfter: q('#dd-after').checked, trackRenewal: q('#dd-renew').checked, notes: q('#dd-notes').value });
        const save = async (next) => {
          try {
            const v = D.validateDeal(collect());
            const saved = await Backend.putDeal(isNew ? v : Object.assign({ id: deal.id }, v));
            if (isNew) st.deals.unshift(saved); else { const i = st.deals.findIndex((x) => x.id === deal.id); if (i >= 0) st.deals[i] = Object.assign(st.deals[i], saved); }
            st.deals.sort((a, b) => String(b.dealDate).localeCompare(String(a.dealDate)));
            ctx.showToast('ثبت شد ✓', 'success'); paint();
            if (next) { ['#dd-cname', '#dd-cphone', '#dd-oname', '#dd-ophone', '#dd-prop', '#dd-notes'].forEach((s) => { q(s).value = ''; }); JDate.set(q('#dd-end'), ''); } else close();
          } catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
        q('#dd-save').onclick = () => save(false);
        if (isNew) q('#dd-save-next').onclick = () => save(true);
        else q('#dd-delete').onclick = async () => {
          const ok = await ctx.showDialog({ title: 'حذف', message: 'این مورد برای همیشه حذف شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }] });
          if (!ok) return;
          try { await Backend.deleteDeal(deal.id); st.deals = st.deals.filter((x) => x.id !== deal.id); close(); ctx.showToast('حذف شد', 'success'); paint(); }
          catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  /* ---------- تنظیمات ---------- */
  function paintSettings() {
    $('dl-lead').value = st.settings.leadDays;
    TPL_KEYS.forEach((k) => { $('dl-tpl-' + k).value = st.settings.templates[k]; });
  }

  async function saveSettings() {
    try {
      const templates = {};
      TPL_KEYS.forEach((k) => { templates[k] = $('dl-tpl-' + k).value; });
      const s = D.validateSettings({ leadDays: $('dl-lead').value, templates });
      await Backend.setSetting('deal_settings', s);
      st.settings = s; paintSettings(); paint();
      ctx.showToast('تنظیمات ذخیره شد ✓', 'success');
    } catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
  }

  return { init, render };
})();

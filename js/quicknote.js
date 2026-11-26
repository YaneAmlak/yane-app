'use strict';
/* ============================================================
   یادداشت سریع — رابط کاربری (بعد از بازدید یا تماس، فوری ثبت کن)
   QuickNote.init({ $id, showToast }) ؛ QuickNote.render()
   ============================================================ */
const QuickNote = (() => {
  const Q = QuickNoteCore, C = ClientsCore;
  let ctx = null;
  const st = { clients: [], notes: [], pick: null, kind: 'note', fu: 'none', q: '' };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);

  function init(c) {
    ctx = c;
    $('qn-search').addEventListener('input', Utils.debounce(() => { st.q = $('qn-search').value; paintClients(); }, 150));
    $('qn-clients').addEventListener('click', (e) => {
      const b = e.target.closest('[data-qn-client]'); if (!b) return;
      st.pick = b.dataset.qnClient; paintClients(); paintFollowup();
    });
    $('qn-kinds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-qn-kind]'); if (!b) return;
      st.kind = b.dataset.qnKind; paintKinds();
    });
    $('qn-fu-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-qn-fu]'); if (!b) return;
      st.fu = b.dataset.qnFu; paintFollowup();
    });
    /* تاریخ دلخواه: با هر تغییر روز/ماه/سال، متن پیگیری به‌روز می‌شود */
    $('qn-fu-custom').addEventListener('change', () => { setTimeout(paintFollowupInfo, 0); });   // بعد از به‌روز شدن مقدار JDate
    $('qn-save').addEventListener('click', save);
    /* میکروفونِ داخل برنامه (دیکته‌ی فارسی)؛ اگر مرورگر پشتیبانی نکند دکمه مخفی و راهنمای کیبورد نشان داده می‌شود */
    const mic = (typeof Voice !== 'undefined') ? ($('qn-mic') ? Voice.attach({ textarea: $('qn-text'), button: $('qn-mic'), status: $('qn-mic-status') }) : { supported: false }) : { supported: false };
    const micHint = $('qn-mic-hint'); if (micHint) micHint.hidden = !!mic.supported;
  }

  const picked = () => st.clients.find((c) => String(c.id) === String(st.pick)) || null;

  async function render() {
    $('qn-msg').textContent = '';
    if (!Backend.isActive()) {
      $('qn-guard').textContent = 'این بخش نیاز به ورود به حساب دارد.';
      $('qn-guard').hidden = false; $('qn-body').hidden = true; return;
    }
    try {
      const [cs, ns] = await Promise.all([Backend.getClients(), Backend.getClientNotesIndex().catch(() => [])]);
      st.clients = cs; st.notes = ns;
    } catch (err) {
      $('qn-guard').textContent = 'خطا در بارگذاری: ' + Backend.faErr(err);
      $('qn-guard').hidden = false; $('qn-body').hidden = true; return;
    }
    if (!st.clients.length) {
      $('qn-guard').textContent = 'هنوز مشتری‌ای ثبت نکرده‌ای؛ اول از «مشتری‌ها» یک مشتری اضافه کن.';
      $('qn-guard').hidden = false; $('qn-body').hidden = true; return;
    }
    $('qn-guard').hidden = true; $('qn-body').hidden = false;
    paintClients(); paintKinds(); paintFollowup();
  }

  function paintClients() {
    const list = st.q.trim() ? Q.searchClients(st.clients, st.q, 6) : Q.recentClients(st.clients, st.notes, 6);
    const sel = picked();
    const shown = sel && !list.some((c) => String(c.id) === String(sel.id)) ? [sel].concat(list) : list;
    $('qn-clients').innerHTML = shown.length
      ? shown.map((c) => `<button type="button" class="chip${String(c.id) === String(st.pick) ? ' active' : ''}" data-qn-client="${esc(c.id)}">${esc(c.name)}</button>`).join('')
      : '<span class="oc-sub">مشتری‌ای پیدا نشد.</span>';
  }

  function paintKinds() {
    $('qn-kinds').innerHTML = Q.KINDS.map((k) => `<button type="button" class="chip${st.kind === k ? ' active' : ''}" data-qn-kind="${k}">${esc(Q.kindLabel(k))}</button>`).join('');
  }

  function paintFollowup() {
    $('qn-fu-chips').innerHTML = Q.FOLLOWUPS.map((f) => `<button type="button" class="chip${st.fu === f.key ? ' active' : ''}" data-qn-fu="${f.key}">${esc(f.label)}</button>`).join('');
    const box = $('qn-fu-custom');
    if (st.fu === 'custom') {
      if (!box.firstChild) box.innerHTML = JDate.html('qn-fu-date', C.addDaysISO(1), { yearsBack: 0, yearsFwd: 2 });
      box.hidden = false;
    } else { box.hidden = true; }
    paintFollowupInfo();
  }

  const customISO = () => { const el = $('qn-fu-date'); return el && typeof JDate !== 'undefined' ? JDate.get(el) : ''; };
  function paintFollowupInfo() {
    const c = picked(), d = Q.followupDate(st.fu, undefined, customISO());
    $('qn-fu-info').textContent = st.fu === 'custom'
      ? (d ? 'پیگیری بعدی: ' + JDate.label(d) : 'روز، ماه و سال را انتخاب کن.')
      : d ? 'پیگیری بعدی: ' + Utils.faDateShort(d)
        : (c && c.nextFollowupDate ? 'پیگیری فعلی می‌ماند: ' + Utils.faDateShort(c.nextFollowupDate) : 'پیگیری تغییری نمی‌کند.');
  }

  async function save() {
    const btn = $('qn-save');
    try {
      const v = Q.validateNote({ clientId: st.pick, kind: st.kind, text: $('qn-text').value, followup: st.fu, customDate: customISO() });
      btn.disabled = true;
      const cid = Number(v.clientId);
      await Backend.addClientNote({ clientId: cid, kind: v.kind, text: v.text });
      const date = Q.followupDate(v.followup, undefined, v.customDate);
      if (date) {
        const updated = await Backend.putClient({ id: cid, nextFollowupDate: date });
        const i = st.clients.findIndex((c) => String(c.id) === String(v.clientId));
        if (i >= 0) Object.assign(st.clients[i], updated);
      }
      st.notes.unshift({ clientId: cid, createdAt: new Date().toISOString() });
      $('qn-text').value = '';
      $('qn-msg').textContent = 'ثبت شد ✓';
      ctx.showToast('یادداشت ثبت شد ✓', 'success');
      paintClients(); paintFollowup();
    } catch (err) {
      $('qn-msg').textContent = '';
      ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error');
    } finally { btn.disabled = false; }
  }

  return { init, render };
})();
if (typeof globalThis !== 'undefined') globalThis.QuickNote = QuickNote;

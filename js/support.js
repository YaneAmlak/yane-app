'use strict';
/* ============================================================
   پشتیبانی درون‌برنامه (تیکت) — صفحه‌ی «پشتیبانی»
   • کاربر: پیام جدید + فهرست پیام‌های خودش + گفتگو (پاسخ/بستن)
   • مدیر: فهرست همه‌ی تیکت‌ها (باز/بسته) + پاسخ
   • ردیف تماس سریع (تلگرام/بله/واتساپ/تلفن) از SupportCore.CONTACTS
   Support.init({ $id, showToast, showSheet }) ؛ Support.render() ؛ Support.unreadCount() → { count, admin }
   ============================================================ */
const Support = (() => {
  let ctx = null;
  const st = { list: [], admin: false, filter: 'open', subject: '', loading: false };
  const esc = (s) => Utils.esc(s);
  const C = () => SupportCore;
  const root = () => ctx.$id('support-root');

  function init(c) {
    ctx = c;
    const r = root();
    if (r) r.addEventListener('click', onClick);
  }

  async function unreadCount() {
    if (!Backend.isActive()) return { count: 0, admin: false };
    return { count: Number(await Backend.supportUnreadCount()) || 0, admin: Backend.isAdmin() };
  }

  async function load() {
    st.admin = Backend.isAdmin();
    st.list = st.admin ? await Backend.supportAdminList(st.filter) : await Backend.supportMyList();
  }

  async function render() {
    const r = root(); if (!r) return;
    if (!Backend.isActive()) { r.innerHTML = '<div class="info-note">برای استفاده از پشتیبانی باید وارد حساب خودت شوی.</div>'; return; }
    st.admin = Backend.isAdmin();
    paint();                       // اول قالب، بعد داده؛ خطای شبکه صفحه را خالی نمی‌کند
    st.loading = true; paintList();
    try { await load(); } catch (e) { st.list = []; ctx.showToast('خطا در دریافت پیام‌ها: ' + Backend.faErr(e), 'error'); }
    st.loading = false; paintList();
  }

  function contactsHtml() {
    const links = C().contactLinks();
    if (!links.length) return '';
    return `<div class="sp-contacts"><span class="sp-hint">تماس سریع:</span>${links.map((l) => `<a class="sp-contact" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>`;
  }

  function paint() {
    const r = root();
    const compose = st.admin ? `<div class="sp-tabs">
        <button type="button" class="chip${st.filter === 'open' ? ' active' : ''}" data-sp-filter="open">باز</button>
        <button type="button" class="chip${st.filter === 'closed' ? ' active' : ''}" data-sp-filter="closed">بسته</button></div>`
      : `<div class="sp-card"><div class="sp-h">پیام جدید به پشتیبانی</div>
        <div class="chip-row sp-subj">${C().SUBJECTS.map((s) => `<button type="button" class="chip${st.subject === s ? ' active' : ''}" data-sp-subj="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <textarea id="sp-text" rows="4" maxlength="${C().MAX_BODY}" placeholder="مشکل یا سوالت را بنویس…"></textarea>
        <button type="button" class="btn btn-primary" id="sp-send">ارسال</button></div>`;
    r.innerHTML = `${contactsHtml()}${compose}<div class="sp-h2">${st.admin ? 'پیام‌های کاربران' : 'پیام‌های من'}</div><div id="sp-list"></div>`;
  }

  function paintList() {
    const box = ctx.$id('sp-list'); if (!box) return;
    if (st.loading && !st.list.length) { box.innerHTML = '<div class="sp-empty">در حال دریافت…</div>'; return; }
    if (!st.list.length) { box.innerHTML = `<div class="sp-empty">${st.admin ? 'پیامی نیست.' : 'هنوز پیامی نفرستاده‌ای.'}</div>`; return; }
    box.innerHTML = st.list.map((t) => {
      const who = st.admin ? esc(t.full_name || t.email || 'کاربر') + ' · ' : '';
      const mine = !st.admin && t.last_from_admin ? 'پشتیبانی: ' : (st.admin && t.last_from_admin ? 'تو: ' : '');
      return `<button type="button" class="sp-item${t.unread ? ' unread' : ''}" data-sp-open="${t.id}">
        <div class="sp-item-top"><b>${esc(t.subject || 'بدون عنوان')}</b>${t.unread ? '<i class="sp-dot" aria-label="جدید"></i>' : ''}<span class="sp-st ${t.status}">${esc(C().statusLabel(t.status))}</span></div>
        <div class="sp-item-sub">${who}${esc(mine + C().preview(t.last_body))}</div>
        <div class="sp-item-time">${esc(Utils.faDate(t.updated_at))}</div></button>`;
    }).join('');
  }

  async function send() {
    const ta = ctx.$id('sp-text'), btn = ctx.$id('sp-send'); if (!ta || !btn) return;
    const v = C().validateMessage(ta.value);
    if (!v.ok) { ctx.showToast(v.error, 'error'); return; }
    btn.disabled = true;
    try {
      await Backend.supportCreate(C().cleanSubject(st.subject), v.value);
      ctx.showToast('پیامت ارسال شد ✓', 'success');
      st.subject = ''; paint(); await load(); paintList();
    } catch (e) { btn.disabled = false; ctx.showToast(Backend.faErr(e), 'error'); }
  }

  /* گفتگو در برگه‌ی پایین */
  function openThread(id) {
    const t = st.list.find((x) => String(x.id) === String(id)); if (!t) return;
    ctx.showSheet({
      title: t.subject || 'پشتیبانی',
      html: `<div id="spt-msgs" class="sp-thread"><div class="sp-empty">در حال دریافت…</div></div>
        <div class="sp-reply"><textarea id="spt-text" rows="3" maxlength="${C().MAX_BODY}" placeholder="پاسخ…"></textarea>
        <div class="dialog-btns">${t.status === 'closed' ? '' : '<button type="button" class="btn btn-ghost" id="spt-close">بستن این پیام</button>'}<button type="button" class="btn btn-primary" id="spt-send">ارسال</button></div></div>`,
      onMount(body, close) {
        const q = (s) => body.querySelector(s);
        const paintMsgs = async () => {
          try {
            const rows = await Backend.supportThread(id);
            q('#spt-msgs').innerHTML = rows.map((m) => {
              const label = m.from_admin ? 'پشتیبانی' : (st.admin ? 'کاربر' : 'تو');
              return `<div class="sp-msg ${m.from_admin ? 'adm' : 'usr'}"><div class="sp-msg-h">${esc(label)} · ${esc(Utils.faDate(m.created_at))}</div><div class="sp-msg-b">${esc(m.body)}</div></div>`;
            }).join('');
            const box = q('#spt-msgs'); box.scrollTop = box.scrollHeight;
          } catch (e) { q('#spt-msgs').innerHTML = '<div class="sp-empty">خطا در دریافت گفتگو.</div>'; }
        };
        paintMsgs();
        q('#spt-send').onclick = async () => {
          const v = C().validateMessage(q('#spt-text').value);
          if (!v.ok) { ctx.showToast(v.error, 'error'); return; }
          const btn = q('#spt-send'); btn.disabled = true;
          try { await Backend.supportReply(id, v.value); q('#spt-text').value = ''; await paintMsgs(); await load(); paintList(); }
          catch (e) { ctx.showToast(Backend.faErr(e), 'error'); }
          btn.disabled = false;
        };
        const cl = q('#spt-close');
        if (cl) cl.onclick = async () => {
          try { await Backend.supportClose(id); close(); ctx.showToast('بسته شد ✓', 'success'); await load(); paintList(); }
          catch (e) { ctx.showToast(Backend.faErr(e), 'error'); }
        };
        /* دیدن گفتگو یعنی خوانده شد؛ نقطه‌ی «جدید» فهرست را به‌روز کن */
        setTimeout(async () => { try { await load(); paintList(); } catch (e) { /* بی‌اثر */ } }, 600);
      }
    });
  }

  function onClick(e) {
    const f = e.target.closest('[data-sp-filter]');
    if (f) { st.filter = f.dataset.spFilter; render(); return; }
    const s = e.target.closest('[data-sp-subj]');
    if (s) { st.subject = st.subject === s.dataset.spSubj ? '' : s.dataset.spSubj; root().querySelectorAll('[data-sp-subj]').forEach((b) => b.classList.toggle('active', b.dataset.spSubj === st.subject)); return; }
    if (e.target.closest('#sp-send')) { send(); return; }
    const o = e.target.closest('[data-sp-open]');
    if (o) openThread(o.dataset.spOpen);
  }

  return { init, render, unreadCount };
})();

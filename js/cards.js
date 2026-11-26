'use strict';
/* ============================================================
   کارت ملک — سمت مشاور: ساخت لینک برای مشتری + صفحه‌ی «بازدیدها»
   Cards.init({ $id, showSheet, showDialog, showToast, openClient, baseHref })
   Cards.render()            ← صفحه‌ی بازدیدها
   Cards.openCreate(listing) ← از جزئیات فایل
   ============================================================ */
const Cards = (() => {
  const K = CardsCore, C = ClientsCore, Q = QuickNoteCore, L = ListingsCore;
  let ctx = null;
  const st = { rows: [], clients: [], filter: 'all' };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e2) { return false; }
    }
  }
  /* بله لینک اشتراک رسمی ندارد: منوی اشتراک سیستم (اگر بود) وگرنه کپی پیام */
  async function shareBale(text) {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const ok = await copyText(text);
    ctx.showToast(ok ? 'پیام کپی شد؛ در بله بچسبان ✓' : 'کپی نشد', ok ? 'success' : 'error');
  }
  const waUrl = (phone, text) => 'https://wa.me/' + K.intlPhone(phone || '') + '?text=' + encodeURIComponent(text);
  const urlOf = (card) => K.cardUrl(ctx.baseHref(), card.token);

  function init(c) {
    ctx = c; $('cw-list').addEventListener('click', onClick); $('cw-notify').addEventListener('click', openNotify);
    $('cw-summary').addEventListener('click', (e) => { const b = e.target.closest('[data-cw-filter]'); if (b) { st.filter = b.dataset.cwFilter; paint(); } });
  }

  /* ---------- اعلان روی گوشی (سرور وقتی اپ بسته است اعلان می‌فرستد) ---------- */
  async function openNotify() {
    if (!Backend.isActive()) { ctx.showToast('برای این بخش باید وارد حساب شوی.', 'error'); return; }
    let cfg = {};
    try { cfg = (await Backend.getSetting('card_notify', {})) || {}; } catch (e) { /* خالی */ }
    ctx.showSheet({
      title: '🔔 اعلان بازدید',
      html: `<div class="pn-card">
          <div class="pn-row"><span class="pn-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 16V11a6 6 0 10-12 0v5l-2 2h16zM10 21h4"/></svg></span>
            <div class="rd-grow"><b>اعلان روی گوشی</b><small>وقتی مشتری «می‌خواهم ببینم» بزند، حتی با اپ بسته خبر می‌گیری. فقط روی آخرین مرورگری که فعال کنی می‌آید.</small></div>
            <button type="button" class="ad-switch" id="pn-switch" aria-label="اعلان روی گوشی" disabled><i></i></button></div>
          <div class="pn-note" id="pn-note"></div>
          <button type="button" class="btn btn-ghost pn-test" id="pn-test">ارسال تست</button></div>`,
      onMount(body) {
        const q = (s) => body.querySelector(s);
        /* ---- اعلان روی گوشی ---- */
        const NOTES = {
          unsupported: 'این مرورگر اعلان مستقیم را پشتیبانی نمی‌کند؛ از Chrome یا برنامه‌ی نصب‌شده استفاده کن.',
          install: 'روی آیفون اول اپ را به صفحه‌ی اصلی اضافه کن (Share ← Add to Home Screen) و از همان آیکن باز کن.',
          denied: 'اجازه‌ی اعلان برای این سایت بسته است؛ از تنظیمات مرورگر (Site settings ← Notifications) فعالش کن.',
          on: 'فعال است ✓ — «ارسال تست» را بزن تا ببینی.',
          off: ''
        };
        const sw = q('#pn-switch'), note = q('#pn-note');
        const paintPush = async () => {
          const s = await Push.status();
          sw.classList.toggle('on', s.state === 'on');
          sw.disabled = s.state === 'unsupported' || s.state === 'install' || s.state === 'denied';
          note.textContent = NOTES[s.state] || '';
          note.hidden = !note.textContent;
        };
        paintPush();
        sw.onclick = async () => {
          sw.disabled = true;
          try {
            if (sw.classList.contains('on')) { await Push.disable(); ctx.showToast('اعلان روی گوشی خاموش شد', 'success'); }
            else { await Push.enable(); ctx.showToast('اعلان روی گوشی فعال شد ✓', 'success'); }
          } catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
          sw.disabled = false; paintPush();
        };
        q('#pn-test').onclick = async () => {
          try { await Backend.sendCardNotifyTest(); ctx.showToast('تست فرستاده شد؛ تا چند ثانیه‌ی دیگر اعلان می‌رسد', 'success'); }
          catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  /* ---------- صفحه‌ی بازدیدها ---------- */
  async function render() {
    if (!Backend.isActive()) { $('cw-body').style.display = 'none'; $('cw-guard').textContent = 'این بخش فقط با ورود به حساب کار می‌کند.'; return; }
    $('cw-guard').textContent = ''; $('cw-body').style.display = '';
    try {
      const [cards, events, clients, listings] = await Promise.all([Backend.getCards(), Backend.getCardEvents(), Backend.getClients(), Backend.getListings()]);
      st.clients = clients;
      st.rows = K.summarize(cards, events, clients, listings);
    } catch (err) { $('cw-guard').textContent = 'خطا در بارگذاری: ' + Backend.faErr(err); return; }
    paint();
    if (K.unseenCount(st.rows.map((r) => ({ seen: r.unseen === 0 }))) > 0) Backend.markCardEventsSeen().catch(() => {});   // نشان «جدید» همین‌بار دیده می‌شود
  }

  function paint() {
    const total = st.rows.length, want = st.rows.filter((r) => r.want && !r.revoked).length, off = st.rows.filter((r) => r.revoked).length;
    const seg = (k, lb, n) => `<button type="button" class="${st.filter === k ? 'on' : ''}" data-cw-filter="${k}">${lb}<em${n ? '' : ' class="z"'}>${Utils.faDigits(n)}</em></button>`;
    $('cw-summary').innerHTML = total ? seg('all', 'همه', total) + seg('want', 'می‌خواهد ببیند', want) + seg('off', 'غیرفعال', off) : '';
    const rows = st.rows.filter((r) => st.filter === 'want' ? (r.want && !r.revoked) : st.filter === 'off' ? r.revoked : true);
    $('cw-list').innerHTML = !total ? '<div class="empty-state"><p>هنوز کارتی نساخته‌ای. از جزئیات یک فایل «🔗 ساخت کارت برای مشتری» را بزن.</p></div>'
      : rows.length ? '<div class="lr-group">' + rows.map(rowHtml).join('') + '</div>' : '<div class="empty-state"><p>موردی در این فیلتر نیست.</p></div>';
  }

  const IC = {
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  const ic = (k, s) => `<svg width="${s || 15}" height="${s || 15}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;

  /* ردیف بازدید: نوار رنگی وضعیت، اسم و فایل، آمار، و ردیف دکمه‌ها (کپی لینک/ارسال اصلی؛ بقیه آیکن) */
  /* هر تأییدِ «می‌خواهم ببینم»: برای مشتری ثبت‌شده ساعت تأیید؛ برای لینک عمومی اسم و شماره‌ی واردشده توسط خودِ مشتری */
  function wantsHtml(r) {
    if (!r.wants || !r.wants.length || r.revoked) return '';
    const items = r.wants.slice(0, 5).map((w) => {
      const t = w.at ? Utils.faDateShort(w.at) + ' ' + Utils.faTime(w.at) : '';
      const who = r.clientName ? '' : (w.name ? esc(w.name) : 'نام ثبت نشده') + (w.phone ? ' · ' + esc(Utils.faText(w.phone)) : '');
      const tel = !r.clientName && w.phone ? ` <a href="tel:${esc(w.phone)}" class="vr-tel">📞</a>` : '';
      return `<div class="vr-want${w.seen ? '' : ' new'}">🙋 ${who}${who && t ? ' · ' : ''}${esc(t)}${tel}</div>`;
    }).join('');
    const more = r.wants.length > 5 ? `<div class="vr-want">و ${Utils.faDigits(r.wants.length - 5)} تأیید دیگر</div>` : '';
    return `<div class="vr-wants">${items}${more}</div>`;
  }
  function rowHtml(r) {
    const c = r.card;
    const who = r.clientName ? esc(r.clientName) : 'لینک عمومی';
    const bar = r.revoked ? '#cbd5e1' : r.want ? '#22c55e' : '#94a3b8';
    const badge = r.revoked ? '<i class="st gray">غیرفعال</i>' : r.want ? '<i class="st ok">می‌خواهد ببیند</i>' : '';
    return `<div class="lrow vrow${r.revoked ? ' is-off' : ''}" style="--c:${bar}">
      <div class="vr-top"><b>${who}</b><span class="vr-sub">· ${esc(r.listingTitle)}</span>${r.unseen ? '<i class="st bad">جدید</i>' : ''}<span class="vr-badge">${badge}</span></div>
      ${wantsHtml(r)}
      <div class="vr-stats">${ic('eye', 12)}<span>${Utils.faDigits(r.opens)} بار باز شد</span><s></s><span>${esc(K.fmtDuration(r.seconds))}</span>${r.lastAt ? '<s></s><span>آخرین: ' + esc(Utils.faDateShort(r.lastAt)) + '</span>' : ''}</div>
      <div class="vr-acts">
        <button type="button" class="vr-b p" data-cw-copy="${esc(c.id)}">${ic('link', 14)}کپی لینک</button>
        <button type="button" class="vr-b" data-cw-wa="${esc(c.id)}">${ic('send', 14)}واتساپ</button>
        <button type="button" class="vr-b" data-cw-tg="${esc(c.id)}">${ic('send', 14)}تلگرام</button>
        <button type="button" class="vr-b" data-cw-bale="${esc(c.id)}">${ic('send', 14)}بله</button>
        ${c.clientId ? `<button type="button" class="vr-b i" data-cw-client="${esc(c.clientId)}" aria-label="پرونده‌ی مشتری">${ic('folder')}</button>` : ''}
        <button type="button" class="vr-b i" data-cw-toggle="${esc(c.id)}" aria-label="${r.revoked ? 'فعال‌سازی' : 'غیرفعال‌سازی'}">${ic(r.revoked ? 'play' : 'pause')}</button>
        <button type="button" class="vr-b i d" data-cw-del="${esc(c.id)}" aria-label="حذف">${ic('trash')}</button>
      </div></div>`;
  }

  async function onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.cwClient) { ctx.openClient(d.cwClient); return; }
    const id = d.cwCopy || d.cwWa || d.cwTg || d.cwBale || d.cwToggle || d.cwDel;
    const row = st.rows.find((r) => String(r.card.id) === String(id));
    if (!row) return;
    try {
      if (d.cwCopy) { ctx.showToast((await copyText(urlOf(row.card))) ? 'لینک کپی شد ✓' : 'کپی نشد', 'success'); return; }
      if (d.cwWa || d.cwTg || d.cwBale) {
        const cl = st.clients.find((x) => String(x.id) === String(row.card.clientId));
        const links = K.shareLinks({ clientName: row.clientName, listingTitle: row.listingTitle, body: row.listing ? K.bodyLines(row.listing) : null, advisor: [row.card.contactName, row.card.contactAgency].filter(Boolean).join(' · '), url: urlOf(row.card) }, cl && cl.phone);
        if (d.cwBale) { await shareBale(links.text); return; }
        window.open(d.cwWa ? links.wa : links.tg, '_blank', 'noopener');
        return;
      }
      if (d.cwToggle) {
        const revoke = !row.revoked;
        await Backend.revokeCard(row.card.id, revoke);
        row.revoked = revoke; row.card.revokedAt = revoke ? new Date().toISOString() : null; paint();
        ctx.showToast(revoke ? 'لینک غیرفعال شد؛ دیگر باز نمی‌شود' : 'لینک دوباره فعال شد', 'success'); return;
      }
      if (d.cwDel) {
        const ok = await ctx.showDialog({ title: 'حذف کارت', message: 'کارت و تاریخچه‌ی بازدیدهایش حذف شود؟ لینک دیگر باز نمی‌شود.', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }] });
        if (!ok) return;
        await Backend.deleteCard(row.card.id);
        st.rows = st.rows.filter((r) => r !== row); paint(); ctx.showToast('حذف شد', 'success');
      }
    } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  /* ---------- ساخت کارت از جزئیات فایل ---------- */
  async function openCreate(listing) {
    if (!Backend.isActive()) { ctx.showToast('برای ساخت کارت باید وارد حساب شوی.', 'error'); return; }
    let clients = [], notes = [], saved = {}, rc = {};
    try {
      [clients, notes, saved, rc] = await Promise.all([Backend.getClients(), Backend.getClientNotesIndex(), Backend.getSetting('card_contact', {}).catch(() => ({})), Backend.getSetting('rc_settings', {}).catch(() => ({}))]);
    } catch (err) { /* بدون فهرست مشتری هم می‌شود لینک عمومی ساخت */ }
    saved = saved || {}; rc = rc || {};
    const title = L.TYPES[listing.type].label + ' · ' + listing.area;
    ctx.showSheet({
      title: '🔗 کارت ملک برای مشتری',
      html: `<div id="cc-form">
        <div class="oc-sub" style="margin-bottom:8px">${esc(title)} — مشتری فقط مشخصات کلی را می‌بیند؛ نشانی و اطلاعات مالک هرگز نمایش داده نمی‌شود.</div>
        <div class="set-row"><label>برای کدام مشتری؟ (تا بدانی چه کسی دیده)</label>
          <div id="cc-clients" class="chip-row" style="margin:0 0 8px;flex-wrap:wrap"></div>
          <input type="search" id="cc-search" placeholder="جستجوی مشتری" autocomplete="off" style="width:100%"></div>
        <div class="set-row"><label>پیام کوتاه برای مشتری (اختیاری)</label><textarea id="cc-note" rows="3" style="width:100%;resize:vertical" placeholder="مثلاً: نور و موقعیتش را حتماً ببین"></textarea></div>
        <div class="set-row"><label>نام املاک (روی کارت مشتری)</label><input type="text" id="cc-agency" autocomplete="off" placeholder="مثلاً: املاک ..." value="${esc(saved.agency || rc.agency || '')}"></div>
        <div class="set-row"><label>نام شما *</label><input type="text" id="cc-name" autocomplete="off" value="${esc(saved.name || '')}"></div>
        <div class="set-row"><label>شماره‌ی تماس شما *</label><input type="text" id="cc-phone" inputmode="tel" autocomplete="off" value="${esc(saved.phone || '')}"></div>
        <button type="button" class="btn btn-primary" id="cc-create">ساخت لینک</button></div>
        <div id="cc-result" style="display:none">
          <div class="info-note" style="margin:6px 0">لینک ساخته شد ✓ برای مشتری بفرست. هر بار باز شدن و درخواست دیدنش در «بازدیدها» ثبت می‌شود.</div>
          <div id="cc-url" class="oc-sub" style="direction:ltr;text-align:left;word-break:break-all;margin:8px 0"></div>
          <div class="btn-row"><button type="button" class="btn btn-primary" id="cc-copy">📋 کپی لینک</button><button type="button" class="btn btn-ghost" id="cc-wa">💬 واتساپ</button></div>
          <div class="btn-row" style="margin-top:8px"><button type="button" class="btn btn-ghost" id="cc-tg">✈️ تلگرام</button><button type="button" class="btn btn-ghost" id="cc-bale">💬 بله</button></div></div>`,
      onMount(body, close) {
        const q = (s) => body.querySelector(s);
        let sel = null, search = '';
        const paintClients = () => {
          const list = search.trim() ? Q.searchClients(clients, search, 6) : Q.recentClients(clients, notes, 6);
          const cur = clients.find((c) => String(c.id) === String(sel));
          const shown = cur && !list.some((c) => String(c.id) === String(cur.id)) ? [cur].concat(list) : list;
          q('#cc-clients').innerHTML = `<button type="button" class="chip${sel === null ? ' active' : ''}" data-cc-client="none">🌐 لینک عمومی</button>` +
            shown.map((c) => `<button type="button" class="chip${String(c.id) === String(sel) ? ' active' : ''}" data-cc-client="${esc(c.id)}">${esc(c.name)}</button>`).join('');
        };
        q('#cc-clients').onclick = (e) => { const b = e.target.closest('[data-cc-client]'); if (b) { sel = b.dataset.ccClient === 'none' ? null : b.dataset.ccClient; paintClients(); } };
        q('#cc-search').oninput = () => { search = q('#cc-search').value; paintClients(); };
        paintClients();
        q('#cc-create').onclick = async () => {
          const btn = q('#cc-create');
          try {
            const v = K.validateCard({ listingId: listing.id, clientId: sel, note: q('#cc-note').value, contactName: q('#cc-name').value, contactAgency: q('#cc-agency').value, contactPhone: q('#cc-phone').value });
            btn.disabled = true;
            const row = await Backend.createCard(v);
            Backend.setSetting('card_contact', { name: v.contactName || '', agency: v.contactAgency || '', phone: v.contactPhone }).catch(() => {});
            const cl = clients.find((c) => String(c.id) === String(sel));
            const url = K.cardUrl(ctx.baseHref(), row.token);
            const links = K.shareLinks({ clientName: cl ? cl.name : '', listingTitle: title, body: K.bodyLines(listing), advisor: [v.contactName, v.contactAgency].filter(Boolean).join(' · '), url }, cl && cl.phone);
            q('#cc-form').style.display = 'none'; q('#cc-result').style.display = '';
            q('#cc-url').textContent = K.shortLabel(url);
            q('#cc-copy').onclick = async () => ctx.showToast((await copyText(url)) ? 'لینک کپی شد ✓' : 'کپی نشد', 'success');
            q('#cc-wa').onclick = () => window.open(links.wa, '_blank', 'noopener');
            q('#cc-tg').onclick = () => window.open(links.tg, '_blank', 'noopener');
            q('#cc-bale').onclick = () => shareBale(links.text);
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  return { init, render, openCreate };
})();

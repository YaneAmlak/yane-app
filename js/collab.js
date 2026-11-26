'use strict';
/* ============================================================
   همکاری‌ها — صفحه‌ی مجزا (فایل‌های تعاملیِ مشاورها + درخواست‌های من)
   Collab.init({ $id, showSheet, showDialog, showToast }) ؛ Collab.render() ؛ Collab.refreshBadge()
   ============================================================ */
const Collab = (() => {
  const L = ListingsCore, C = ClientsCore;
  let ctx = null;
  const st = { tab: 'collab', cType: 'all', q: '', collab: [], mine: [], collabErr: '' };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);

  function init(c) {
    ctx = c;
    $('cb-search').addEventListener('input', Utils.debounce(() => { st.q = $('cb-search').value; paint(); }, 150));
    $('cb-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cb-tab]'); if (!b) return;
      st.tab = b.dataset.cbTab; paint();
    });
    $('cb-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cb-ctype]'); if (!b) return;
      st.cType = b.dataset.cbCtype; paint();
    });
    $('cb-list').addEventListener('click', onClick);
  }

  const pending = () => L.collabPendingCount(st.mine);
  const pendingBadge = () => { const n = pending(); return n ? ' (' + Utils.faDigits(n) + ')' : ''; };

  /* ---------- بارگذاری ---------- */
  async function load() {
    const [col, mine] = await Promise.all([
      Backend.getCollabListings().then((v) => ({ v })).catch((err) => ({ err })),
      Backend.getMyCollabs().catch(() => [])
    ]);
    st.mine = mine;
    st.collab = col.v || [];
    st.collabErr = col.err ? Backend.faErr(col.err) : '';
  }

  async function render() {
    if (!Backend.isActive()) { $('cb-list').innerHTML = '<div class="info-note">این بخش نیاز به ورود به حساب دارد.</div>'; $('cb-empty').hidden = true; return; }
    $('cb-list').innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    $('cb-empty').hidden = true;
    try { await load(); paint(); }
    catch (err) { $('cb-list').innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + esc(Backend.faErr(err)) + '</p></div>'; }
  }

  /* نشان تعداد درخواست‌های منتظر پاسخ روی کارت صفحه‌ی خانه */
  async function refreshBadge() {
    const el = ctx && ctx.$id('cb-badge'); if (!el) return;
    if (!Backend.isActive() || Backend.isOffline()) return;
    try { st.mine = await Backend.getMyCollabs(); } catch (e) { return; }
    const n = pending();
    el.textContent = n ? Utils.faDigits(n) + ' درخواست منتظر پاسخ' : 'فایل‌های تعاملی و درخواست‌ها';
    el.style.color = n ? 'var(--danger)' : '';
    el.style.fontWeight = n ? '700' : '';
    const card = el.closest('.home-card'); if (card) card.classList.toggle('has-pending', n > 0);
  }

  /* ---------- نمایش ---------- */
  function paint() {
    const tab = (k, label) => `<button type="button" class="${st.tab === k ? 'on' : ''}" data-cb-tab="${k}">${label}</button>`;
    $('cb-tabs').innerHTML = tab('collab', 'تعاملی‌ها') + tab('mine', 'درخواست‌های من' + pendingBadge());
    const isCollab = st.tab === 'collab';
    $('cb-search').style.display = isCollab ? '' : 'none';
    $('cb-filters').style.display = isCollab ? '' : 'none';
    if (isCollab) {
      const chip = (k, label) => `<button type="button" class="chip${st.cType === k ? ' active' : ''}" data-cb-ctype="${k}">${label}</button>`;
      $('cb-filters').innerHTML = chip('all', 'همه') + L.TYPE_KEYS.map((k) => chip(k, L.TYPES[k].label)).join('');
      if (st.collabErr) { $('cb-empty').hidden = true; $('cb-list').innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + esc(st.collabErr) + '</p></div>'; return; }
      const list = L.filterCollab(st.collab, st.cType, st.q);
      $('cb-empty').hidden = list.length > 0;
      $('cb-empty').querySelector('p').textContent = st.collab.length ? 'فایلی پیدا نشد.' : 'فایل تعاملی‌ای نیست یا اشتراک شما فعال نیست.';
      $('cb-list').innerHTML = list.map(collabCardHtml).join('');
    } else {
      $('cb-empty').hidden = st.mine.length > 0;
      $('cb-empty').querySelector('p').textContent = 'هنوز همکاری‌ای ندارید.';
      $('cb-list').innerHTML = st.mine.map(mineCardHtml).join('');
    }
  }

  function chipsHtml(l) {
    const parts = L.specText(l).split(' | ').filter(Boolean);
    return parts.length ? '<div class="rd-chips">' + parts.map((t) => '<span class="rd-chip">' + esc(t) + '</span>').join('') + '</div>' : '';
  }
  function pricesHtml(l) {
    const rows = L.priceText(l).split(' | ').filter(Boolean).map((x) => { const i = x.indexOf(': '); return { label: x.slice(0, i), value: x.slice(i + 2) }; });
    return rows.length ? '<div class="rd-prices">' + rows.map((r) => '<div><div class="rd-lbl">' + esc(r.label) + '</div><div class="rd-val">' + esc(r.value) + '</div></div>').join('') + '</div>' : '';
  }

  function collabCardHtml(l) {
    return `<div class="rd-card rd-static">
      <div class="rd-row"><span class="rd-badge t-${esc(l.type)}">${esc(L.TYPES[l.type].label)}</span><span class="rd-tag">${esc(L.collabShareText(l.collabSharePct))}</span></div>
      <div class="rd-title">${esc(l.area)}</div>
      ${chipsHtml(l)}${pricesHtml(l)}
      ${l.features ? `<div class="rd-hint">${esc(l.features)}</div>` : ''}
      ${l.isMine
        ? '<div class="rd-collab">فایل شما (برای بقیه مشاورها نمایش داده می‌شود)</div>'
        : L.hasActiveCollab(st.mine, l.id)
          ? '<div class="rd-hint">برای این فایل درخواست داده‌ای.</div>'
          : `<button type="button" class="rd-btn primary" data-cb-req="${esc(l.id)}">درخواست همکاری</button>`}
    </div>`;
  }

  const PILL = { requested: 'warn', accepted: 'ok', done: 'ok', rejected: 'mute', cancelled: 'mute' };

  function mineCardHtml(c) {
    const owner = c.role === 'owner';
    const who = owner ? 'درخواست از ' + (c.otherName || 'یک مشاور') : 'درخواست شما';
    const money = (n) => C.fmtShort(n) + ' تومان';
    const reveal = !owner && (c.status === 'accepted' || c.status === 'done')
      ? `<div class="rd-collab">${esc(c.otherName || '')}${c.ownerContact ? ' — ' + esc(c.ownerContact) : ''}</div>` : '';
    let extra = '';
    if (c.status === 'requested') {
      extra = owner
        ? `<div class="rd-actions"><button type="button" class="rd-btn primary" data-cb-yes="${esc(c.id)}">قبول</button><button type="button" class="rd-btn ghost" data-cb-no="${esc(c.id)}">رد</button></div>`
        : `<button type="button" class="rd-btn ghost" data-cb-cancel="${esc(c.id)}">لغو درخواست</button>`;
    } else if (c.status === 'accepted') {
      extra = c.myDoneAt
        ? '<div class="rd-hint">تأیید کردی؛ طرف مقابل خبردار شد. اگر ۷ روز جواب ندهد، خودکار تأیید می‌شود.</div>'
        : `${c.otherDoneAt ? '<div class="rd-hint">طرف مقابل معامله را تأیید کرده است.</div>' : ''}<button type="button" class="rd-btn primary" data-cb-done="${esc(c.id)}">معامله انجام شد</button>`;
    } else if (c.status === 'done') {
      const sp = L.splitCommission(c.commission, c.sharePct);
      if (c.commission != null) extra += `<div class="rd-hint">کمیسیون: ${esc(money(c.commission))}</div>`;
      if (sp) extra += `<div class="rd-collab">${owner ? 'سهم شما: ' + esc(money(sp.owner)) + ' | سهم همکار: ' + esc(money(sp.advisor)) : 'سهم شما: ' + esc(money(sp.advisor)) + ' | سهم صاحب فایل: ' + esc(money(sp.owner))}</div>`;
      extra += c.myRating
        ? `<div class="rd-hint">امتیاز شما: ${Utils.faDigits(c.myRating)} از ۵</div>`
        : `<div class="rd-hint">به طرف مقابل امتیاز بده:</div><div class="rd-actions">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rd-btn ghost sm" data-cb-rate="${esc(c.id)}:${n}">${Utils.faDigits(n)}</button>`).join('')}</div>`;
    }
    return `<div class="rd-card rd-static">
      <div class="rd-row"><span class="rd-badge t-${esc(c.type)}">${esc(L.TYPES[c.type].label)}</span><span class="rd-pill ${PILL[c.status] || 'mute'}">${esc(L.COLLAB_STATUS[c.status] || c.status)}</span></div>
      <div class="rd-title">${esc(c.area)}</div>
      ${chipsHtml(c)}${pricesHtml(c)}
      <div class="rd-hint">${esc(who)} — ${esc(L.collabShareText(c.sharePct))} — ${esc(L.ratingText(c.otherAvg, c.otherCount))}</div>
      ${c.clientSummary ? `<div class="rd-hint">مشتری: ${esc(c.clientSummary)}</div>` : ''}
      ${reveal}${extra}
    </div>`;
  }

  /* ---------- اقدام‌ها ---------- */
  async function refresh() { try { await load(); } catch (e) { /* بی‌اثر */ } paint(); }

  async function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    try {
      if (d.cbReq) { openRequestSheet(d.cbReq); return; }
      if (d.cbYes) {
        /* یک‌لمسی: اگر قبلاً راه تماسی داده‌ای، همان استفاده می‌شود؛ بار اول فرم باز می‌شود */
        const prev = st.mine.find((x) => x.role === 'owner' && x.ownerContact);
        if (!prev) { openAcceptSheet(d.cbYes); return; }
        await Backend.respondCollab(d.cbYes, true, prev.ownerContact);
        ctx.showToast('قبول شد ✓ · راه تماس: ' + prev.ownerContact, 'success'); refresh(); return;
      }
      if (d.cbDone) {
        const c = st.mine.find((x) => String(x.id) === String(d.cbDone));
        openDoneSheet(d.cbDone, !!c && c.role === 'owner'); return;
      }
      if (d.cbRate) {
        const [id, stars] = d.cbRate.split(':');
        await Backend.rateCollab(id, stars);
        ctx.showToast('امتیاز ثبت شد ✓', 'success'); refresh(); return;
      }
      if (d.cbNo || d.cbCancel) {
        const isNo = !!d.cbNo;
        const ok = await ctx.showDialog({ title: isNo ? 'رد درخواست' : 'لغو درخواست', message: isNo ? 'این درخواست همکاری رد شود؟' : 'درخواست همکاری لغو شود؟', buttons: [{ label: 'انصراف', value: false }, { label: isNo ? 'رد' : 'لغو', value: true, kind: 'btn-danger' }] });
        if (!ok) return;
        if (isNo) await Backend.respondCollab(d.cbNo, false); else await Backend.cancelCollab(d.cbCancel);
        ctx.showToast('انجام شد ✓', 'success'); refresh();
      }
    } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  function openRequestSheet(listingId) {
    ctx.showSheet({
      title: '🤝 درخواست همکاری',
      html: `<div class="info-note" style="margin:6px 0">مشخصات مشتری را بدون نام و شماره بنویس.</div>
        <div class="set-row"><label>مشخصات مشتری *</label><textarea id="cr-text" rows="4" style="width:100%;resize:vertical" placeholder="بودجه، محله، زمان خرید"></textarea></div>
        <div class="dialog-btns"><button class="btn btn-ghost" id="cr-cancel">انصراف</button><button class="btn btn-primary" id="cr-save">ارسال درخواست</button></div>`,
      onMount(body, close) {
        const q = (id) => body.querySelector(id);
        q('#cr-cancel').onclick = close;
        q('#cr-save').onclick = async () => {
          const btn = q('#cr-save');
          try {
            const text = L.validateCollabRequest(q('#cr-text').value);
            btn.disabled = true;
            await Backend.requestCollab(listingId, text);
            close(); ctx.showToast('درخواست ارسال شد ✓', 'success');
            st.tab = 'mine'; refresh();
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  /* «انجام شد» + امتیازِ اختیاری در یک پنجره؛ کمیسیون فقط برای صاحب فایل */
  function openDoneSheet(collabId, isOwner) {
    const c = st.mine.find((x) => String(x.id) === String(collabId));
    const other = c && c.otherDoneAt ? '<div class="info-note" style="margin:6px 0">طرف مقابل قبلاً تأیید کرده؛ با تأیید تو معامله بسته می‌شود.</div>' : '';
    ctx.showSheet({
      title: '🏁 معامله انجام شد',
      html: `${other}${isOwner ? `<div class="set-row"><label>کمیسیون کل (اختیاری)</label>${Utils.moneyHtml('dn-commission', null, 't')}</div>` : ''}
        <div class="set-row"><label>امتیاز به طرف مقابل (اختیاری)</label><div class="chip-row" id="dn-stars" style="margin:0">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="chip" data-dn-star="${n}">${Utils.faDigits(n)}</button>`).join('')}</div></div>
        <div class="dialog-btns"><button class="btn btn-ghost" id="dn-cancel">انصراف</button><button class="btn btn-primary" id="dn-save">تأیید</button></div>`,
      onMount(body, close) {
        const q = (id) => body.querySelector(id);
        let stars = 0;
        if (isOwner) Utils.moneyBind(body);
        body.querySelectorAll('[data-dn-star]').forEach((b) => b.addEventListener('click', () => {
          stars = stars === Number(b.dataset.dnStar) ? 0 : Number(b.dataset.dnStar);
          body.querySelectorAll('[data-dn-star]').forEach((x) => x.classList.toggle('active', Number(x.dataset.dnStar) <= stars && stars > 0));
        }));
        q('#dn-cancel').onclick = close;
        q('#dn-save').onclick = async () => {
          const btn = q('#dn-save');
          try {
            let commission = null;
            if (isOwner) {
              const cv = Utils.moneyRead(body, 'dn-commission');
              if (typeof cv === 'number' && isNaN(cv)) throw Object.assign(new Error('مبلغ کمیسیون معتبر نیست.'), { userFacing: true });
              commission = L.validateCommission(cv === '' ? '' : String(cv / 1e6));
            }
            btn.disabled = true;
            await Backend.doneCollab(collabId, commission);
            if (stars) { try { await Backend.rateCollab(collabId, stars); } catch (e) { /* امتیاز اختیاری است؛ خطایش تأیید را خراب نمی‌کند */ } }
            close(); ctx.showToast('تأیید شد ✓', 'success'); refresh();
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  function openAcceptSheet(collabId) {
    ctx.showSheet({
      title: '✅ قبول همکاری',
      html: `<div class="info-note" style="margin:6px 0">راه تماس برای هماهنگی بازدید (اختیاری). فقط بعد از قبول برای همین مشاور دیده می‌شود. آدرس و شماره‌ی مالک هرگز نمایش داده نمی‌شود.</div>
        <div class="set-row"><label>راه تماس شما</label><input type="text" id="ac-contact" placeholder="شماره یا آیدی تلگرام" autocomplete="off"></div>
        <div class="dialog-btns"><button class="btn btn-ghost" id="ac-cancel">انصراف</button><button class="btn btn-primary" id="ac-save">قبول</button></div>`,
      onMount(body, close) {
        const q = (id) => body.querySelector(id);
        q('#ac-cancel').onclick = close;
        q('#ac-save').onclick = async () => {
          const btn = q('#ac-save');
          try {
            const contact = L.validateCollabContact(q('#ac-contact').value);
            btn.disabled = true;
            await Backend.respondCollab(collabId, true, contact);
            close(); ctx.showToast('همکاری تأیید شد ✓', 'success'); refresh();
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  return { init, render, refreshBadge };
})();
if (typeof globalThis !== 'undefined') globalThis.Collab = Collab;

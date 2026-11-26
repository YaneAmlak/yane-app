'use strict';
/* ============================================================
   فایل‌های ملکی — رابط کاربری (لیست + فرم ثبت سریع + جزئیات سه‌سطحی)
   Listings.init({ $id, showScreen, showSheet, showDialog, showToast, openClient })
   ============================================================ */
const Listings = (() => {
  const L = ListingsCore, C = ClientsCore;
  let ctx = null;
  const st = { all: [], clients: [], filter: 'open', q: '', currentId: null, reveal: false };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);
  const byId = (id) => st.all.find((l) => String(l.id) === String(id));
  const faPhone = (p) => String(p || '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

  function init(c) {
    ctx = c;
    $('btn-ls-add').addEventListener('click', () => openSheet());
    $('ls-search').addEventListener('input', Utils.debounce(() => { st.q = $('ls-search').value; paintList(); }, 150));
    $('ls-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ls-filter]');
      if (!b) return;
      st.filter = b.dataset.lsFilter;
      paintList();
    });
    $('ls-list').addEventListener('click', (e) => { const card = e.target.closest('[data-ls-open]'); if (card) open(card.dataset.lsOpen); });
    $('ls-detail').addEventListener('click', onDetailClick);
  }

  async function loadAll() {
    const [ls, cs, ad] = await Promise.all([Backend.getListings(), Backend.getClients().catch(() => []), Backend.getSetting('ad_builder', null).catch(() => null)]);
    st.all = ls; st.clients = cs;
    /* کدهای دستی آگهی‌ها (فایل → کد) تا جستجوی «کد» در لیست فایل‌ها آن‌ها را هم پیدا کند */
    st.codes = {};
    const ads = ad && typeof ad === 'object' && ad.ads && typeof ad.ads === 'object' ? ad.ads : {};
    Object.keys(ads).forEach((id) => { const c = ads[id] && ads[id].draft && ads[id].draft.codeText; if (c) st.codes[id] = String(c).toLowerCase(); });
  }

  /* ---------- لیست ---------- */
  async function renderList() {
    if (!Backend.isActive()) { $('ls-list').innerHTML = '<div class="info-note">این بخش نیاز به ورود به حساب دارد.</div>'; return; }
    $('ls-list').innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    try { await loadAll(); paintList(); }
    catch (err) { $('ls-list').innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + esc(Backend.faErr(err)) + '</p></div>'; }
  }

  function paintList() {
    const open = st.all.filter((l) => l.status !== 'closed');
    const counts = { open: open.length, sale: open.filter((l) => l.type === 'sale').length, rent: open.filter((l) => l.type === 'rent').length, closed: st.all.length - open.length };
    const chip = (k, label) => `<button type="button" class="${st.filter === k ? 'on' : ''}" data-ls-filter="${k}">${label}<em${counts[k] ? '' : ' class="z"'}>${Utils.faDigits(counts[k])}</em></button>`;
    $('ls-filters').innerHTML = chip('open', 'همه') + chip('sale', 'فروش') + chip('rent', 'رهن و اجاره') + chip('closed', 'بسته');

    let list = st.all.filter((l) => st.filter === 'closed' ? l.status === 'closed' : (l.status !== 'closed' && (st.filter === 'open' || l.type === st.filter)));
    const qc = String(st.q || '').trim().toLowerCase();
    list = L.sortListings(list.filter((l) => L.matchesQuery(l, st.q) || (qc && st.codes && st.codes[String(l.id)] === qc)));
    $('ls-empty').hidden = list.length > 0;
    $('ls-empty').querySelector('p').textContent = st.all.length ? 'فایلی پیدا نشد.' : 'هنوز فایلی ثبت نشده است.';
    $('ls-list').innerHTML = list.map(cardHtml).join('');
  }

  /* قطعه‌های ظاهری مشترک (کلاس‌ها در css/style.css با پیشوند rd-) */
  const STATUS_DOT = { active: 'ok', reserved: 'warn', closed: 'off' };
  function chipsHtml(l) {
    const parts = L.specText(l).split(' | ').filter(Boolean);
    return parts.length ? '<div class="rd-chips">' + parts.map((t) => '<span class="rd-chip">' + esc(t) + '</span>').join('') + '</div>' : '';
  }
  function pricesHtml(l, big) {
    const rows = L.priceText(l).split(' | ').filter(Boolean).map((x) => { const i = x.indexOf(': '); return { label: x.slice(0, i), value: x.slice(i + 2) }; });
    return rows.length ? '<div class="rd-prices' + (big ? ' big' : '') + '">' + rows.map((r) => '<div><div class="rd-lbl">' + esc(r.label) + '</div><div class="rd-val">' + esc(r.value) + '</div></div>').join('') + '</div>' : '';
  }
  function badgeHtml(l) {
    return '<span class="rd-badge t-' + esc(l.type) + '">' + esc(L.TYPES[l.type].label) + '</span>' +
      '<span class="rd-status ' + (STATUS_DOT[l.status] || 'off') + '"><i></i>' + esc(L.STATUSES[l.status] || '') + '</span>';
  }

  /* قیمت اصلی (فروش: قیمت؛ اجاره/رهن: اجاره یا رهن) درشت، بقیه ریز کنارش */
  function priceBlock(l) {
    const rows = L.priceText(l).split(' | ').filter(Boolean).map((x) => { const i = x.indexOf(': '); return { label: x.slice(0, i), value: x.slice(i + 2).replace(/ تومان$/, '') }; });
    if (!rows.length) return '';
    const main = rows.find((r) => /اجاره/.test(r.label)) || rows[0];
    const rest = rows.filter((r) => r !== main).map((r) => r.label + ' ' + r.value).join(' · ');
    return `<div class="lr-pr">${esc(main.value)}<small>${esc(main.label)}${rest ? ' · ' + esc(rest) : ''}</small></div>`;
  }
  const TYPE_BAR = { sale: '#10b981', mortgage: '#f59e0b', rent: '#6366f1' };
  const STATUS_CLS = { active: 'ok', reserved: 'warn', closed: 'gray' };

  /* ردیف فشرده: نوار رنگی نوع، اسم + نوع، مشخصات، وضعیت و قیمت */
  function cardHtml(l) {
    const n = L.matchClientsForListing(l, st.clients).length;
    const spec = L.specText(l).split(' | ').filter(Boolean).join(' · ');
    return `<div class="lrow" data-ls-open="${esc(l.id)}" role="button" tabindex="0" style="--c:${TYPE_BAR[l.type] || '#cbd5e1'}">
      <div class="lr-mid"><b>${esc(l.area)}<span class="rd-badge t-${esc(l.type)}">${esc(L.TYPES[l.type].label)}</span></b>
        ${spec ? `<span class="lr-spec">${esc(spec)}</span>` : ''}
        <span class="lr-tags"><i class="st ${STATUS_CLS[l.status] || 'gray'}">${esc(L.STATUSES[l.status] || '')}</i>${l.collabOpen ? '<i class="st tag">تعاملی</i>' : ''}${n && l.status === 'active' ? `<i class="st match">${Utils.faDigits(n)} مشتری مناسب</i>` : ''}</span></div>
      ${priceBlock(l)}
    </div>`;
  }

  /* ---------- جزئیات ---------- */
  function open(id) { st.currentId = id; st.reveal = false; ctx.showScreen('listing'); }

  async function renderDetail() {
    if (!byId(st.currentId)) { try { await loadAll(); } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); } }
    else { Backend.getClients().then((cs) => { st.clients = cs; }).catch(() => {}); }
    paintDetail();
  }

  const secretHtml = (l) => [
    l.address ? `<div>📍 ${esc(l.address)}</div>` : '',
    l.ownerName ? `<div>👤 ${esc(l.ownerName)}</div>` : '',
    l.ownerPhone ? `<div>📞 <a href="tel:${esc(l.ownerPhone)}">${esc(faPhone(l.ownerPhone))}</a></div>` : ''
  ].filter(Boolean).join('') || '<div class="oc-sub">آدرس و مالک ثبت نشده است.</div>';

  function paintDetail() {
    const l = byId(st.currentId);
    if (!l) { $('ls-detail').innerHTML = '<div class="empty-state"><p>فایل پیدا نشد.</p></div>'; return; }
    const matches = L.matchClientsForListing(l, st.clients);
    const created = Utils.faDateShort(l.createdAt) + ' ' + (Utils.faTime ? Utils.faTime(l.createdAt) : '');
    const spec = L.specText(l).split(' | ').filter(Boolean).join(' · ');
    const extra = [l.features ? 'ویژگی‌ها: ' + esc(l.features) : '', l.collabOpen ? 'همکاری: تعاملی · ' + esc(L.collabShareText(l.collabSharePct)) : ''].filter(Boolean);

    $('ls-detail').innerHTML = `
      <div class="rd-card rd-static rd-hero ld">
        <div class="ld-top"><span class="ld-name">${esc(l.area)}</span>${badgeHtml(l)}</div>
        ${spec ? `<div class="ld-spec">${esc(spec)}</div>` : ''}
        ${pricesHtml(l, true)}
        ${extra.length ? `<div class="ld-extra">${extra.map((x) => `<div>${x}</div>`).join('')}</div>` : ''}
        <div class="ld-fine">ثبت: ${esc(created)}</div>
      </div>
      <div class="ld-acts"><button class="rd-btn primary" data-ls-act="send">ارسال به مشتری</button><button class="rd-btn ghost" data-ls-act="manage">مدیریت</button></div>

      <div class="rd-h">مشتری‌های مناسب</div>
      ${matches.length && l.status === 'active' ? matches.map((x) => `
        <div class="order-card" data-ls-client="${esc(x.client.id)}">
          <div class="oc-no" style="font-size:20px">${C.stageIcon(x.client.stage)}</div>
          <div class="oc-body"><div class="oc-title">${esc(x.client.name)}</div>
          <div class="oc-sub" style="color:var(--ok)">${esc(x.m.reasons.join('، '))}</div>
          ${x.m.warns.length ? `<div class="oc-sub" style="color:var(--amber)">${esc(x.m.warns.join('، '))}</div>` : ''}</div></div>`).join('')
        : `<div class="ld-none">${l.status === 'active' ? 'مشتری مناسبی پیدا نشد.' : 'فقط برای فایل‌های فعال تطبیق انجام می‌شود.'}</div>`}`;
  }

  /* ---------- برگه‌ی «ارسال به مشتری» ---------- */
  function openSendSheet(l) {
    ctx.showSheet({
      title: 'ارسال به مشتری',
      html: `<div class="ld-sheet" id="ld-send">
        <button type="button" class="ld-row" data-sd="card"><span class="ld-ic">🔗</span><div><b>کارت (لینک)</b><span>مشتری مشخصات را می‌بیند و درخواست بازدید می‌دهد.</span></div><em>پیشنهادی</em></button>
        <button type="button" class="ld-row" data-sd="text"><span class="ld-ic">💬</span><div><b>پیام متنی</b><span>متن آماده برای واتساپ، تلگرام و بله.</span></div></button></div>`,
      onMount(body, close) {
        const box = body.querySelector('#ld-send');
        let level = 1;
        const textStep = () => {
          const hints = { 1: 'محله، متراژ و قیمت. مناسب اولین پیام.', 2: 'همه‌ی مشخصات و ویژگی‌ها. بعد از جدی شدن مشتری.' };
          box.innerHTML = `${l.features ? `<div class="rd-seg ld-lv"><button type="button" class="${level === 1 ? 'on' : ''}" data-lv="1">عمومی</button><button type="button" class="${level === 2 ? 'on' : ''}" data-lv="2">کامل با ویژگی‌ها</button></div>` : ''}
            <div class="ld-hint">${hints[level]}</div>
            <div class="ld-chips"><button type="button" class="ld-c wa" data-ch="wa">واتساپ</button><button type="button" class="ld-c tg" data-ch="tg">تلگرام</button><button type="button" class="ld-c tg" data-ch="bale">بله</button><button type="button" class="ld-c" data-ch="copy">کپی</button></div>`;
        };
        box.addEventListener('click', async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.sd === 'card') { close(); if (ctx.makeCard) ctx.makeCard(l); return; }
          if (b.dataset.sd === 'text') { textStep(); return; }
          if (b.dataset.lv) { level = Number(b.dataset.lv); textStep(); return; }
          if (!b.dataset.ch) return;
          const text = L.buildMessage(level, l);
          try {
            if (b.dataset.ch === 'wa') { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'); return; }
            if (b.dataset.ch === 'tg') { window.open('https://t.me/share/url?url=%20&text=' + encodeURIComponent(text), '_blank', 'noopener'); return; }
            if (b.dataset.ch === 'bale' && navigator.share) { try { await navigator.share({ text }); return; } catch (e2) { if (e2 && e2.name === 'AbortError') return; } }
            ctx.showToast((await copyText(text)) ? (b.dataset.ch === 'bale' ? 'پیام کپی شد؛ در بله بچسبان ✓' : 'پیام کپی شد ✓') : 'کپی نشد', 'success');
          } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        });
      }
    });
  }

  /* ---------- برگه‌ی «مدیریت» ---------- */
  function openManageSheet(l) {
    ctx.showSheet({
      title: 'مدیریت فایل',
      html: `<div class="ld-sheet" id="ld-manage">
        <button type="button" class="ld-row" data-md="edit"><div><b>ویرایش</b></div></button>
        <div class="ld-row static"><div style="flex:1"><b>وضعیت فایل</b><div class="rd-seg ld-st" style="margin-top:6px">${Object.keys(L.STATUSES).map((k) => `<button type="button" class="${l.status === k ? 'on' : ''}" data-md-status="${k}">${esc(L.STATUSES[k])}</button>`).join('')}</div></div></div>
        <button type="button" class="ld-row" data-md="ad"><div><b>ساخت آگهی دیوار</b></div></button>
        <div class="ld-row static" style="flex-direction:column;align-items:stretch"><div style="display:flex;align-items:center"><div><b>آدرس و مالک</b><span>فقط برای خودت. در پیام مشتری نمی‌آید.</span></div><button type="button" class="ld-c" data-md="reveal" style="margin-inline-start:auto">${st.reveal ? 'پنهان' : 'نمایش'}</button></div>${st.reveal ? `<div class="ld-secret-body">${secretHtml(l)}</div>` : ''}</div>
        <button type="button" class="ld-row danger" data-md="delete"><div><b>حذف فایل</b></div></button></div>`,
      onMount(body, close) {
        body.querySelector('#ld-manage').addEventListener('click', async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          try {
            if (b.dataset.mdStatus) {
              if (l.status === b.dataset.mdStatus) return;
              const saved = await Backend.putListing({ id: l.id, status: b.dataset.mdStatus }); Object.assign(l, saved);
              paintDetail(); openManageSheet(l); return;
            }
            const md = b.dataset.md;
            if (md === 'reveal') { st.reveal = !st.reveal; openManageSheet(l); return; }
            if (md === 'edit') { close(); openSheet(l); return; }
            if (md === 'ad') { close(); if (ctx.openAd) ctx.openAd(l); return; }
            if (md === 'delete') { close(); await deleteListing(l); }
          } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
        });
      }
    });
  }

  async function deleteListing(l) {
    const ok = await ctx.showDialog({ title: 'حذف فایل', message: 'این فایل برای همیشه حذف شود؟ (اگه فقط معامله شده، بهتره وضعیتش را «بسته‌شده» کنی.)', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', value: true, kind: 'btn-danger' }] });
    if (!ok) return;
    await Backend.deleteListing(l.id); st.all = st.all.filter((x) => x.id !== l.id);
    ctx.showToast('حذف شد', 'success'); ctx.showScreen('listings');
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch (e2) { return false; } }
  }

  async function onDetailClick(e) {
    const l = byId(st.currentId); if (!l) return;
    const cardClient = e.target.closest('[data-ls-client]');
    if (cardClient) { ctx.openClient(cardClient.dataset.lsClient); return; }
    const t = e.target.closest('button'); if (!t) return;
    try {
      const act = t.dataset.lsAct;
      if (act === 'send') openSendSheet(l);
      else if (act === 'manage') openManageSheet(l);
    } catch (err) { ctx.showToast('خطا: ' + Backend.faErr(err), 'error'); }
  }

  /* ---------- فرم ثبت سریع ---------- */
  function openSheet(l) {
    const e = l || {};
    const field = (label, inner, id) => `<div class="set-row"${id ? ` id="${id}"` : ''}><label>${label}</label>${inner}</div>`;
    ctx.showSheet({
      title: l ? '✏️ ویرایش فایل' : '＋ فایل جدید',
      html: `
        ${field('نوع *', `<select id="lf-type">${L.TYPE_KEYS.map((k) => `<option value="${k}"${(e.type || 'sale') === k ? ' selected' : ''}>${L.TYPES[k].label}</option>`).join('')}</select>`)}
        ${field('محله *', `<input type="text" id="lf-area" value="${esc(e.area || '')}" placeholder="آپادانا" autocomplete="off">`)}
        <div style="display:flex;gap:8px">
          <div class="set-row" style="flex:1"><label>متراژ</label><input type="text" id="lf-size" inputmode="numeric" value="${e.size == null ? '' : e.size}"></div>
          <div class="set-row" style="flex:1"><label>طبقه (۰ = همکف)</label><input type="text" id="lf-floor" inputmode="numeric" value="${e.floor == null ? '' : e.floor}"></div>
          <div class="set-row" style="flex:1"><label>سن بنا</label><input type="text" id="lf-age" inputmode="numeric" value="${e.age == null ? '' : e.age}"></div>
        </div>
        ${field('قیمت فروش *', Utils.moneyHtml('lf-price', e.price, 'b'), 'lf-price-row')}
        ${field('رهن', Utils.moneyHtml('lf-deposit', e.deposit, 'b'), 'lf-dep-row')}
        ${field('اجاره‌ی ماهانه', Utils.moneyHtml('lf-rent', e.rentMonthly, 't'), 'lf-rent-row')}
        <div class="set-row"><label><input type="checkbox" id="lf-collab"${e.collabOpen ? ' checked' : ''}> 🤝 آماده تعامل با مشاورهای دیگر</label></div>
        ${field('درصد سهم همکار (۱ تا ۹۹)', `<input type="text" id="lf-collabpct" inputmode="numeric" value="${e.collabSharePct == null ? '' : e.collabSharePct}" placeholder="مثلاً ۵۰">`, 'lf-collabpct-row')}
        ${field('ویژگی‌ها (سطح ۲)', `<input type="text" id="lf-features" value="${esc(e.features || '')}" placeholder="پارکینگ، آسانسور، انباری" autocomplete="off">`)}
        <div class="info-note" style="margin:6px 0">🔒 فقط برای خودت؛ در هیچ پیامی نمی‌آید (آدرس فقط در پیام سطح ۳):</div>
        ${field('آدرس دقیق', `<input type="text" id="lf-address" value="${esc(e.address || '')}" autocomplete="off">`)}
        ${field('نام مالک', `<input type="text" id="lf-owner" value="${esc(e.ownerName || '')}" autocomplete="off">`)}
        ${field('شماره‌ی مالک', `<input type="tel" id="lf-ophone" value="${esc(e.ownerPhone || '')}" inputmode="tel" autocomplete="off">`)}
        <div class="dialog-btns"><button class="btn btn-ghost" id="lf-cancel">انصراف</button><button class="btn btn-primary" id="lf-save">ذخیره</button></div>`,
      onMount(body, close) {
        const q = (id) => body.querySelector(id);
        Utils.moneyBind(body);
        const sync = () => { const sale = q('#lf-type').value === 'sale'; q('#lf-price-row').hidden = !sale; q('#lf-dep-row').hidden = sale; q('#lf-rent-row').hidden = sale; };
        const syncCollab = () => { q('#lf-collabpct-row').hidden = !q('#lf-collab').checked; };
        q('#lf-collab').addEventListener('change', syncCollab); syncCollab();
        q('#lf-type').addEventListener('change', sync); sync();
        // فوکوس خودکار فقط اگر کاربر هنوز روی فیلدی نرفته (وگرنه فوکوسش را نمی‌دزدیم)
        if (!l) setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || !body.contains(a)) q('#lf-area').focus(); }, 60);
        q('#lf-cancel').onclick = close;
        q('#lf-save').onclick = async () => {
          const btn = q('#lf-save');
          const num = (v) => { const n = C.parseDecimal(v); return isNaN(n) ? NaN : n; };
          const mon = (id) => { const n = Utils.moneyRead(body, id.slice(1)); if (typeof n === 'number' && isNaN(n)) throw Object.assign(new Error('مبلغ معتبر نیست.'), { userFacing: true }); return n; };
          const plain = (id) => { const raw = q(id).value.trim(); if (!raw) return ''; const n = num(raw); return isNaN(n) ? NaN : n; };
          try {
            const row = L.validateListing({
              type: q('#lf-type').value, area: q('#lf-area').value, size: plain('#lf-size'), floor: plain('#lf-floor'), age: plain('#lf-age'),
              price: mon('#lf-price'), deposit: mon('#lf-deposit'), rentMonthly: mon('#lf-rent'),
              features: q('#lf-features').value, collabOpen: q('#lf-collab').checked, collabSharePct: plain('#lf-collabpct'), address: q('#lf-address').value, ownerName: q('#lf-owner').value, ownerPhone: q('#lf-ophone').value
            });
            const dup = L.findSimilar(st.all, row, l && l.id);
            if (dup) {
              const when = Utils.faDateShort(dup.createdAt);
              const ok = await ctx.showDialog({ title: 'فایل مشابه', message: 'فایل مشابهی (' + L.TYPES[dup.type].label + ' · ' + dup.area + (dup.size ? ' · ' + dup.size + ' متر' : '') + ') در تاریخ ' + when + ' ثبت شده است. باز هم ذخیره شود؟', buttons: [{ label: 'انصراف', value: false }, { label: 'ذخیره', value: true }] });
              if (!ok) return;
            }
            btn.disabled = true;
            const saved = await Backend.putListing(l ? Object.assign({ id: l.id }, row) : row);
            const i = st.all.findIndex((x) => x.id === saved.id);
            if (i >= 0) st.all[i] = Object.assign(st.all[i], saved); else st.all.unshift(saved);
            close(); ctx.showToast('ذخیره شد ✓', 'success');
            if (l) paintDetail(); else open(saved.id);
          } catch (err) { btn.disabled = false; ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
        };
      }
    });
  }

  return { init, renderList, renderDetail, open, getAll: () => st.all };
})();
if (typeof globalThis !== 'undefined') globalThis.Listings = Listings;

'use strict';
/* ============================================================
   ساخت آگهی دیوار — رابط کاربری
   AdBuilder.init({ $id, showToast, showScreen, openListing }) ؛ AdBuilder.render() ؛ AdBuilder.openFor(id)
   AdBuilder.reset()
   • ویرایشگر روی «نسخه‌ی کاری» کار می‌کند؛ با «ثبت تغییرات» ذخیره و با «انصراف» دور ریخته می‌شود
   • متن داخل پرانتز در عنوان و متن آگهی هایلایت می‌شود؛ پاک‌کردن کامل عنوان/متن با یک کلیک
   • کد دستی، و آگهی بدون فایل (فایل مجازی داخل همین بخش)
   وضعیت (پیش‌نویس هر فایل، قالب من، جمله‌ها، تماس‌ها، آگهی‌های بدون فایل) در تنظیمات کاربر ذخیره می‌شود
   ============================================================ */
const AdBuilder = (() => {
  const A = AdBuilderCore, L = ListingsCore, C = ClientsCore;
  let ctx = null;
  const st = {
    view: 'pick', id: null, listings: [], clients: [], state: A.defaultState(), loaded: false, sig: { agency: '', phone: '' },
    emojiTab: 'home', saveTimer: null, tab: 'text', work: null, pickFilter: 'all', freeForm: null
  };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);
  const fa = (n) => Utils.faDigits(n);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const todayISO = () => C.isoDate(new Date());
  const allL = () => A.allListings(st.state, st.listings);
  const listing = () => allL().find((l) => String(l.id) === String(st.id)) || null;

  function newDraft() {
    const mine = st.state.myText ? { tpl: 'mine', title: st.state.myTitle || A.TEMPLATES.official.title, text: st.state.myText } : { tpl: 'official', title: A.TEMPLATES.official.title, text: A.TEMPLATES.official.text };
    return Object.assign(mine, { features: [], bullet: 'auto', v2: 1, v3: 1, v4: 1, frame: 'none', phrases: [], sig: true, code: false, codeText: '' });
  }
  /* قالب‌ها همیشه به متن واقعی (با اطلاعات فایل) تبدیل می‌شوند؛ قالب آماده‌ی ویرایش‌نشده با هر بار باز کردن تازه می‌شود */
  const tplOpts = (d) => ({ mine: st.state.myText ? { title: st.state.myTitle || A.TEMPLATES.official.title, text: st.state.myText } : null, sig: d && d.sig ? sigNow() : null });
  function prepDraft(d) {
    const l = listing(); if (!l) return;
    A.upgradeDraft(d);
    if (A.TEMPLATES[d.tpl]) A.applyTemplate(l, d, d.tpl, tplOpts(d)); else A.migrateDraft(l, d, d.sig ? st.sig : null);
  }
  /* بعد از تغییر ویژگی‌ها: اگر متن هنوز قالب آماده است دوباره ساخته می‌شود */
  function refreshTpl(d) {
    if (A.TEMPLATES[d.tpl]) { A.applyTemplate(listing(), d, d.tpl, tplOpts(d)); return; }
    if (d.inline) ctx.showToast('متن را خودت ویرایش کرده‌ای؛ برای جای‌گذاری ویژگی‌ها دوباره یک قالب بزن');
  }
  /* نسخه‌ی کاری: همه‌ی ویرایش‌های متن/ویژگی/امضا روی این نسخه انجام می‌شود تا با «ثبت تغییرات» ذخیره شود */
  function startWork() {
    const a = A.ensureAd(st.state, st.id);
    if (!a.draft) a.draft = newDraft();
    prepDraft(a.draft);
    st.work = { id: String(st.id), d: clone(a.draft), sig: clone(st.sig), base: JSON.stringify([a.draft, st.sig]), dirty: false };
  }
  const working = () => st.work && st.work.id === String(st.id);
  const draft = () => { if (working()) return st.work.d; const a = A.ensureAd(st.state, st.id); if (!a.draft) a.draft = newDraft(); return a.draft; };
  const sigNow = () => (working() ? st.work.sig : st.sig);
  function markDirty() {
    if (!working()) return;
    st.work.dirty = JSON.stringify([st.work.d, st.work.sig]) !== st.work.base;
    updateBar();
  }
  function updateBar() {
    const dirty = !!(working() && st.work.dirty);
    const b = $('ad-save'), badge = $('ad-dirty');
    if (b) { b.disabled = !dirty; b.classList.toggle('is-clean', !dirty); b.textContent = dirty ? 'ثبت تغییرات' : 'ثبت‌شده ✓'; }
    if (badge) badge.hidden = !dirty;
  }

  function init(c) {
    ctx = c;
    const root = $('ad-root');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', (e) => { if (e.target && e.target.id === 'ad-title' && e.key === 'Enter') e.preventDefault(); });
    root.addEventListener('scroll', (e) => { const t = e.target; if (t && t.classList && t.classList.contains('hl-input')) { const b = $(t.id + '-hl'); if (b) b.scrollTop = t.scrollTop; } }, true);
  }
  function reset() { st.view = 'pick'; st.id = null; st.work = null; st.freeForm = null; }

  /* ---------- بارگذاری و ذخیره ---------- */
  async function load() {
    const [ls, cs, state, card] = await Promise.all([
      Backend.getListings(), Backend.getClients().catch(() => []),
      Backend.getSetting('ad_builder', null).catch(() => null), Backend.getSetting('card_contact', {}).catch(() => ({}))
    ]);
    st.listings = ls; st.clients = cs; st.state = A.normalizeState(state); st.loaded = true;
    st.sig = { agency: (card && card.agency) || '', phone: (card && card.phone) || '' };
  }
  function saveSoon() {
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(() => { Backend.setSetting('ad_builder', st.state).catch(() => ctx.showToast('ذخیره‌ی آگهی انجام نشد', 'error')); }, 500);
  }

  async function render() {
    if (!Backend.isActive()) { $('ad-root').innerHTML = '<div class="info-note">این بخش نیاز به ورود به حساب دارد.</div>'; return; }
    $('ad-root').innerHTML = '<div class="progress-box"><div class="progress-text">در حال بارگذاری…</div></div>';
    try { await load(); } catch (err) { $('ad-root').innerHTML = '<div class="empty-state"><p>خطا در بارگذاری: ' + esc(Backend.faErr(err)) + '</p></div>'; return; }
    if (st.view === 'free') paintFree();
    else if (st.view === 'edit' && listing()) paintEdit();
    else { st.view = 'pick'; paintPick(); }
  }
  /* قبل از showScreen('ad') صدا بزن تا مستقیم همین فایل باز شود */
  function target(id) { st.view = 'edit'; st.id = id; st.emojiTab = 'home'; st.tab = 'text'; st.work = null; st.full = false; }
  async function openFor(id) { target(id); await render(); }

  /* ---------- هایلایت متن داخل پرانتز ---------- */
  const hl = (t) => esc(t).replace(/\([^()\n]*\)/g, (m) => '<mark>' + m + '</mark>') + '\u200b';
  const hlField = (id, value, opts) => {
    const o = opts || {};
    return `<div class="hl-wrap${o.x ? ' has-x' : ''}"><div class="hl-back" id="${id}-hl" aria-hidden="true">${hl(value)}</div>
      <textarea id="${id}" class="hl-input" rows="${o.rows}" autocomplete="off" spellcheck="false">${esc(value)}</textarea>
      ${o.x ? `<button type="button" class="hl-x" data-ad-clear="${o.x}" aria-label="پاک‌کردن ${esc(o.xl)}">×</button>` : ''}</div>`;
  };
  const syncHl = (id, value) => { const b = $(id + '-hl'); if (b) b.innerHTML = hl(value); };

  /* ---------- انتخاب فایل ---------- */
  const FILTERS = [['all', 'همه'], ['sale', 'فروش'], ['rent', 'رهن و اجاره'], ['new', 'آگهی نشده']];
  function pickData() {
    const open = L.sortListings(allL().filter((l) => l.status !== 'closed'));
    const today = todayISO();
    const posted = (l) => A.isPosted(st.state, l.id);
    const match = (l, k) => k === 'all' || (k === 'new' ? !posted(l) : l.type === k);
    const draftOf = (l) => ((st.state.ads || {})[l.id] || {}).draft || {};
    const list = open.filter((l) => match(l, st.pickFilter) && A.matchQuery(l, draftOf(l), st.pickQ));
    return { open, list, posted, match };
  }
  function pickListHtml() {
    const { open, list, posted } = pickData();
    if (!list.length) return `<div class="rd-card rd-static rd-empty">${open.length ? 'آگهی‌ای با این فیلتر یا جستجو نیست.' : 'فایل فعالی نداری؛ از «فایل‌ها» یک ملک ثبت کن یا «آگهی بدون فایل» بساز.'}</div>`;
    const grp = (cls, title, items) => items.length ? `<div class="ad-grp ${cls}"><i></i>${title}<span>· ${fa(items.length)} فایل</span></div>${items.map(pickCard).join('')}` : '';
    return grp('wait', 'منتظر آگهی', list.filter((l) => !posted(l))) + grp('done', 'آگهی شده', list.filter(posted));
  }
  function paintPick() {
    const { open, match } = pickData();
    const sum = A.pickSummary(st.state, open, todayISO());
    const chips = FILTERS.map(([k, lb]) => `<button type="button" class="chip${k === 'new' ? ' ad-chip-new' : ''}${st.pickFilter === k ? ' active' : ''}" data-ad-filter="${k}">${lb} ${fa(open.filter((l) => match(l, k)).length)}</button>`).join('');
    $('ad-root').innerHTML = `
      <div class="ad-hero"><div class="ad-hero-t">برای کدام فایل آگهی می‌سازی؟</div></div>
      <div class="ad-ctrl"><label class="ad-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="text" id="ad-q" autocomplete="off" placeholder="جستجو: محله، کد یا متراژ" value="${esc(st.pickQ || '')}"></label><button type="button" class="ad-newtop" data-ad-newfree="1">+ بدون فایل</button></div>
      <div class="chip-row ad-filters">${chips}</div>
      <div class="ad-strip"><span class="wait"><b>${fa(sum.waiting)}</b> منتظر آگهی</span><i>|</i><span class="done"><b>${fa(sum.posted)}</b> آگهی شده</span></div>
      <div id="ad-pick-list">${pickListHtml()}</div>`;
  }
  /* قیمت فشرده برای کارت: «۹ میلیارد»، «ودیعه ۱۰۰م · اجاره ۱۵م» */
  function shortPrice(l) {
    const parts = String(L.priceText(l) || '').split('|').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim()] : ['', x]; });
    const sv = (v) => v.replace(/\s*میلیون تومان/, 'م').replace(/\s*تومان/, '').trim();
    return parts.map(([k, v]) => (parts.length > 1 && k ? k + ' ' : '') + sv(v)).join(' · ');
  }
  function pickCard(l) {
    const r = A.isPosted(st.state, l.id);
    const specs = String(L.specText(l) || '').split('|').map((x) => x.trim()).filter(Boolean).join(' · ');
    const pr = shortPrice(l);
    return `<button type="button" class="ad-card t-${esc(l.type)}${r ? ' is-posted' : ''}" data-ad-open="${esc(l.id)}"><i class="ad-card-bar"></i>
      <span class="ad-card-b">
        <span class="ad-card-t"><span class="rd-badge t-${esc(l.type)}">${esc(L.TYPES[l.type].label)}</span><b>${esc(l.area || '—')}</b>${l.isFree ? '<em>بدون فایل</em>' : ''}</span>
        <span class="ad-card-s"><span>${esc(specs)}</span>${pr ? `<b class="ad-card-pr">${esc(pr)}</b>` : ''}</span>
      </span>
      <span class="ad-card-go${r ? ' edit' : ''}">${r ? 'ویرایش' : 'ساخت'}</span></button>`;
  }

  /* ---------- آگهی بدون فایل (فرم) ---------- */
  const M = 1e6;
  const toT = (v) => (v == null ? '' : v);   // مبلغ به تومان؛ کادرها خودشان واحد را نشان می‌دهند
  function openFreeForm(l) {
    st.view = 'free';
    st.freeForm = l ? { id: l.id, type: l.type, area: l.area, size: l.size == null ? '' : String(l.size), floor: l.floor == null ? '' : String(l.floor), age: l.age == null ? '' : String(l.age), price: toT(l.price), deposit: toT(l.deposit), rent: toT(l.rentMonthly) }
      : { id: null, type: 'sale', area: '', size: '', floor: '', age: '', price: '', deposit: '', rent: '' };
    paintFree();
  }
  function paintFree() {
    const f = st.freeForm || (st.freeForm = { id: null, type: 'sale', area: '', size: '', floor: '', age: '', price: '', deposit: '', rent: '' });
    const seg = L.TYPE_KEYS.map((k) => `<button type="button" class="${f.type === k ? 'on' : ''}" data-ad-ftype="${k}">${esc(L.TYPES[k].label)}</button>`).join('');
    const mon = (id, label, val, def) => `<div class="set-row"><label>${label}</label>${Utils.moneyHtml(id, val, def)}</div>`;
    const inp = (id, label, val, ph, unit) => `<div class="set-row"><label>${label}</label><div class="ad-unit"><input type="text" id="${id}" inputmode="decimal" autocomplete="off" placeholder="${ph || ''}" value="${esc(val)}">${unit ? `<i>${unit}</i>` : ''}</div></div>`;
    $('ad-root').innerHTML = `
      <button type="button" class="hp-back" data-ad-freecancel="1">→ ${f.id ? 'بازگشت به آگهی' : 'همه‌ی فایل‌ها'}</button>
      <div class="rd-card rd-static"><div class="rd-lvl">${f.id ? 'ویرایش مشخصات آگهی' : 'آگهی بدون فایل'}</div>
        <div class="rd-hint">مشخصات را اینجا می‌نویسی؛ این آگهی در لیست «فایل‌ها» ثبت نمی‌شود.</div>
        <div class="ad-seg">${seg}</div>
        <div class="set-row"><label>محله یا عنوان ملک *</label><input type="text" id="ad-f-area" autocomplete="off" placeholder="مثلاً پونک" value="${esc(f.area)}"></div>
        <div class="rd-pair">${inp('ad-f-size', 'متراژ', f.size, 'مثلاً ۹۰', 'متر')}${inp('ad-f-floor', 'طبقه', f.floor, 'مثلاً ۳')}</div>
        <div class="rd-pair">${inp('ad-f-age', 'سن بنا', f.age, '۰ = نوساز', 'سال')}${f.type === 'sale' ? mon('ad-f-price', 'قیمت', f.price, 'b') : mon('ad-f-deposit', 'رهن', f.deposit, 'b')}</div>
        ${f.type === 'rent' ? mon('ad-f-rent', 'اجاره‌ی ماهانه', f.rent, 't') : ''}
      </div>
      <div class="ad-bar"><button type="button" class="rd-btn ghost" data-ad-freecancel="1">انصراف</button><button type="button" class="rd-btn primary" data-ad-freesave="1" style="flex:2">${f.id ? 'ثبت تغییرات' : 'ساخت آگهی'}</button></div>
      ${f.id ? '<button type="button" class="rd-btn danger" data-ad-freedel="1" style="margin-top:6px">حذف این آگهی</button>' : ''}`;
    Utils.moneyBind($('ad-root'));
  }
  function readFreeForm() {
    const f = st.freeForm, v = (id) => { const e = $(id); return e ? e.value : ''; };
    f.area = v('ad-f-area').trim(); f.size = v('ad-f-size'); f.floor = v('ad-f-floor'); f.age = v('ad-f-age');
    const root = $('ad-root'), mv = (id) => (root ? Utils.moneyRead(root, id) : '');
    if (f.type === 'sale') f.price = mv('ad-f-price'); else f.deposit = mv('ad-f-deposit');
    if (f.type === 'rent') f.rent = mv('ad-f-rent');
    return f;
  }
  const mt = (x) => { if (typeof x === 'number' && !isNaN(x)) return x; if (x === '' || x == null) return null; throw Object.assign(new Error('مبلغ معتبر نیست.'), { userFacing: true }); };
  const num = (t, mult) => { const s = String(t == null ? '' : t).trim(); if (!s) return null; const n = C.parseDecimal(s); return isNaN(n) ? null : Math.round(n * (mult || 1) * 1000) / 1000; };
  async function saveFree() {
    const f = readFreeForm();
    try {
      const item = A.addFree(st.state, {
        id: f.id || undefined, type: f.type, area: f.area, size: num(f.size), floor: num(f.floor), age: num(f.age),
        price: f.type === 'sale' ? mt(f.price) : null, deposit: f.type === 'sale' ? null : mt(f.deposit), rentMonthly: f.type === 'rent' ? mt(f.rent) : null
      });
      await Backend.setSetting('ad_builder', st.state);
      ctx.showToast(f.id ? 'مشخصات آگهی ثبت شد ✓' : 'آگهی ساخته شد ✓', 'success');
      st.freeForm = null; st.work = null; st.full = false; st.view = 'edit'; st.id = item.id; st.tab = 'text'; paintEdit(); window.scrollTo(0, 0);
    } catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'ذخیره نشد: ' + Backend.faErr(err), 'error'); }
  }

  /* ---------- ویرایشگر ---------- */
  function built() { return A.build(listing(), buildInput()); }
  function buildInput() {
    const d = draft(), s = sigNow();
    return { title: d.title, text: d.text, inline: d.inline, features: d.features, bullet: d.bullet, frame: d.frame, phrases: d.phrases, code: d.code, codeText: d.codeText, sig: { on: d.sig, agency: s.agency, phone: s.phone } };
  }
  const chip = (on, attr, label) => `<button type="button" class="chip${on ? ' active' : ''}" ${attr}>${esc(label)}</button>`;
  const TABS = [['text', 'متن آگهی'], ['feat', 'ویژگی‌ها'], ['code', 'کد ملک']];
  const setFull = (v) => { st.full = !!v; };
  /* کادر متن با رشد خودکار: هم کامل دیده می‌شود، هم هایلایت هم‌تراز می‌ماند */
  const autoSize = () => { const ta = $('ad-text'); if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; } };

  function paintEdit() {
    if (!working()) startWork();
    const l = listing(), d = draft();
    const code = A.codeOf(l, d), price = L.priceText(l), spec = L.specText(l);
    const tabs = TABS.map(([k, lb]) => `<button type="button" class="${st.tab === k ? 'on' : ''}" data-ad-tab="${k}">${lb}</button>`).join('');
    $('ad-root').innerHTML = `
      <div class="ad-topline"><button type="button" class="hp-back" data-ad-hub="1">→ همه‌ی فایل‌ها</button><button type="button" class="ad-codetag" data-ad-tab="code" data-ad-focuscode="1" dir="ltr" aria-label="کد ملک">#<span id="ad-codechip">${esc(code)}</span></button></div>
      <div class="ad-file2">
        <div class="ad-file2-t"><span class="rd-badge t-${esc(l.type)}">${esc(L.TYPES[l.type].label)}</span><b>${esc(l.area || '—')}</b>${l.isFree ? '<button type="button" class="ad-file2-edit" data-ad-freeedit="1" aria-label="ویرایش مشخصات"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button>' : ''}</div>
        <div class="ad-file2-s">${String(spec || '').split('|').map((x) => x.trim()).filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        ${price ? `<div class="ad-file2-p">${String(price).split('|').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return i > 0 ? `<span><small>${esc(x.slice(0, i).trim())}</small><b>${esc(x.slice(i + 1).trim())}</b></span>` : `<span><b>${esc(x)}</b></span>`; }).join('')}</div>` : ''}
      </div>
      <div class="ad-tabs">${tabs}</div>
      <div id="ad-pane">${paneHtml(l, d)}</div>
      <div class="ad-bar ad-bar3"><button type="button" class="rd-btn ghost" data-ad-cancel="1">انصراف</button><button type="button" class="rd-btn primary" id="ad-save" data-ad-save="1" style="flex:1.6">ثبت تغییرات</button><button type="button" class="rd-btn soft ad-copyb" data-ad-copy="full" aria-label="کپی کامل آگهی">کپی</button></div>`;
    if (st.tab === 'text') { paintEmoji(); autoSize(); }
    paintLive(); if (st.tab === 'code') paintCode(); updateBar();
  }

  function paneHtml(l, d) {
    const sg = sigNow();
    if (st.tab === 'text') {
      const tplKeys = Object.keys(A.TEMPLATES);
      const tplCard = (k, lb, m) => {
        const n = (m.variants || []).length, on = d.tpl === k;
        const desc = on && n > 1 ? 'متن ' + fa((d.tv || 0) + 1) + ' از ' + fa(n) + ' · دوباره بزن' : m.desc;
        return `<button type="button" class="ad-tpl${on ? ' on' : ''}" style="--tc:${m.color}" data-ad-tpl="${k}"><i>${m.icon}</i><span><b>${esc(lb)}</b><em>${esc(desc)}</em></span></button>`;
      };
      const mineCard = st.state.myText ? [tplCard('mine', 'قالب من', { icon: '⭐', color: '#0d9488', desc: 'قالب ذخیره‌شده‌ی قبلی' })] : [];
      const mainCards = mineCard.concat(tplKeys.filter((k) => !A.TEMPLATES[k].extra).map((k) => tplCard(k, A.TEMPLATES[k].label, A.TEMPLATES[k])));
      const extraCards = tplKeys.filter((k) => A.TEMPLATES[k].extra).map((k) => tplCard(k, A.TEMPLATES[k].label, A.TEMPLATES[k]));
      const step = (n, cls, title, extra, body) => `<div class="ad-step ${cls}"><div class="ad-step-h"><b>${fa(n)}</b><span>${title}</span>${extra || ''}</div><div class="ad-step-b">${body}</div></div>`;
      return `
        ${step(1, 'ad-s1', 'سبک آگهی را انتخاب کن', '', `<div class="ad-tplgrid">${mainCards.join('')}</div><div class="ad-tplx">${extraCards.join('')}</div>
          <div class="rd-hint">با زدن هر سبک، متن کامل با اطلاعات همین فایل پر می‌شود. روی سبک انتخاب‌شده دوباره بزن تا متن دیگری بیاید؛ هر جایش را هم مستقیم ویرایش کن.</div>`)}
        ${step(2, 'ad-s2', 'عنوان آگهی', '<span class="rd-hint" id="ad-tcount"></span><span class="ad-dirty" id="ad-dirty" hidden>تغییر ذخیره‌نشده</span>',
          hlField('ad-title', d.title, { rows: 2, x: 'title', xl: 'عنوان' }))}
        ${step(3, 'ad-s3' + (st.full ? ' full' : ''), 'متن آگهی', '<span class="rd-hint" id="ad-bcount"></span><button type="button" class="ad-fsbtn" data-ad-full="1">' + (st.full ? '✕ بستن تمام‌صفحه' : '⛶ تمام‌صفحه') + '</button>',
          `<div class="ad-tools"><button type="button" class="rd-btn ghost sm" data-ad-tool="emoji">شکلک</button><button type="button" class="rd-btn ghost sm" data-ad-tool="reset">بازگردانی</button><button type="button" class="rd-btn ghost sm ad-del" data-ad-clear="text">پاک‌کردن</button></div>
          <div id="ad-emoji" class="ad-panel" hidden></div>
          ${hlField('ad-text', d.text, { rows: 12 })}`)}
        ${step(4, 'ad-s4', 'پیش‌نمایش نهایی', '<span class="ad-step-note">آماده‌ی کپی</span>', '<div class="rd-title ad-pvt" id="ad-pv-title"></div><div class="ad-pv" id="ad-pv-body"></div>')}`;
    }
    if (st.tab === 'feat') {
      const sec = (title, n, body) => `<details class="ad-sec" open><summary><span>${title}</span>${n ? `<em>${fa(n)} انتخاب</em>` : ''}</summary><div class="ad-sec-b">${body}</div></details>`;
      return `
        ${sec('ویژگی‌ها (به متن اضافه می‌شود)', d.features.length, `<div class="chip-row" style="margin:0;flex-wrap:wrap">${A.FEATURES.map((f) => chip(d.features.includes(f), 'data-ad-feat="' + esc(f) + '"', f)).join('')}</div>`)}
        ${sec('جمله‌های آماده', d.phrases.length, `<div class="chip-row" style="margin:0;flex-wrap:wrap">${A.PHRASES.concat(st.state.phrases).map((p) => chip(d.phrases.includes(p), 'data-ad-phrase="' + esc(p) + '"', p)).join('')}<button type="button" class="chip" data-ad-addphrase="1">+ جمله‌ی خودت</button></div>`)}
        ${sec('امضای ثابت', 0, `<div class="rd-row"><div class="rd-grow rd-hint">نام املاک و شماره‌ی تماس، انتهای آگهی</div><button type="button" class="ad-switch${d.sig ? ' on' : ''}" data-ad-sig="1" aria-label="امضای ثابت"><i></i></button></div>
          <div class="rd-pair" style="margin-top:8px"><div class="set-row"><label>نام املاک</label><input type="text" id="ad-agency" autocomplete="off" value="${esc(sg.agency)}"></div>
          <div class="set-row"><label>شماره</label><input type="text" id="ad-phone" inputmode="tel" autocomplete="off" style="direction:ltr" value="${esc(sg.phone)}"></div></div>`)}`;
    }
    return '<div id="ad-code-pane"></div>';
  }

  /* بخش‌هایی که با هر تایپ دوباره ساخته می‌شوند (بدون پریدن کادر متن) */
  function paintLive() {
    const l = listing(), b = built(), d = draft();
    const set = (id, fn) => { const e = $(id); if (e) fn(e); };
    set('ad-tcount', (e) => { e.textContent = '· ' + fa(b.titleLen) + ' از ' + fa(A.LIMITS.title); e.style.color = b.titleOver ? 'var(--danger)' : ''; });
    set('ad-bcount', (e) => { e.textContent = '· ' + fa(b.bodyLen) + ' از ' + fa(A.LIMITS.body); e.style.color = b.bodyOver ? 'var(--danger)' : ''; });
    set('ad-pv-title', (e) => { e.innerHTML = hl(b.title); });
    set('ad-pv-body', (e) => { e.innerHTML = hl(b.body); });
    set('ad-codechip', (e) => { e.textContent = A.codeOf(l, d); });
    set('ad-code-v', (e) => { e.textContent = A.codeOf(l, d); });
  }

  function paintEmoji() {
    const box = $('ad-emoji'); if (!box) return;
    const g = A.EMOJI_GROUPS.find((x) => x.key === st.emojiTab) || A.EMOJI_GROUPS[0];
    box.innerHTML = `<div class="chip-row" style="margin:0 0 8px;flex-wrap:wrap">${A.EMOJI_GROUPS.map((x) => chip(x.key === g.key, 'data-ad-etab="' + x.key + '"', x.label)).join('')}</div>
      <div class="ad-emojis">${g.items.map((e) => `<button type="button" data-ad-emoji="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
  }

  function paintCode() {
    const box = $('ad-code-pane'); if (!box) return;
    const l = listing(), d = draft();
    box.innerHTML = `
      <div class="ad-step ad-s2"><div class="ad-step-h"><b>#</b><span>کد ملک</span></div>
        <div class="ad-step-b">
          <div class="ad-code"><div class="rd-grow"><div class="rd-hint">کد کوتاه برای پیدا کردن همین فایل</div><div class="ad-code-v" id="ad-code-v">${esc(A.codeOf(l, d))}</div></div>
            <button type="button" class="ad-switch${d.code ? ' on' : ''}" data-ad-code="1" aria-label="درج کد در آگهی"><i></i></button></div>
          <div class="rd-hint">${d.code ? 'روشن: کد در انتهای متن آگهی نوشته می‌شود.' : 'خاموش: کد در آگهی نوشته نمی‌شود و فقط برای جستجوی خودت است.'}</div>
          <div class="ad-codeedit"><label for="ad-codetext">کد دستی (اختیاری)</label>
            <div class="ad-codeline"><input type="text" id="ad-codetext" class="ad-input" dir="ltr" maxlength="24" autocomplete="off" spellcheck="false" placeholder="مثلاً PK-90" value="${esc(d.codeText || '')}"><button type="button" class="rd-btn ghost sm" data-ad-codeauto="1">کد خودکار</button></div>
            <div class="rd-hint">فقط حرف، عدد و خط‌تیره؛ بعد از «ثبت تغییرات» در جستجوی «فایل‌ها» هم پیدا می‌شود.</div></div>
        </div></div>`;
  }

  /* ---------- کپی ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); document.body.removeChild(t); return ok; } catch (e2) { return false; } }
  }
  async function copy(text, okMsg) { ctx.showToast((await copyText(text)) ? okMsg : 'کپی نشد؛ متن را دستی انتخاب کن', 'success'); }

  /* ---------- ثبت / انصراف ---------- */
  async function commit() {
    const w = st.work; if (!w || !w.dirty) return;
    const a = A.ensureAd(st.state, w.id);
    w.d.codeText = A.cleanCode(w.d.codeText);
    a.draft = clone(w.d); st.sig = clone(w.sig);
    try {
      await Backend.setSetting('ad_builder', st.state);
      Backend.getSetting('card_contact', {}).then((c) => Backend.setSetting('card_contact', Object.assign({}, c || {}, { agency: st.sig.agency, phone: st.sig.phone }))).catch(() => {});
      w.base = JSON.stringify([a.draft, st.sig]); w.dirty = false;
      const inp = $('ad-codetext'); if (inp) inp.value = w.d.codeText;
      ctx.showToast('تغییرات ثبت شد ✓', 'success');
    } catch (err) { ctx.showToast('ثبت نشد: ' + Backend.faErr(err), 'error'); }
    updateBar();
  }
  /* خروج از ویرایشگر؛ اگر تغییر ذخیره‌نشده هست با پنجره‌ی زیبا می‌پرسد */
  async function leave() {
    if (working() && st.work.dirty) {
      const discard = await ctx.showDialog({
        title: 'تغییرات ذخیره‌نشده', icon: 'warn', stack: true,
        message: 'اگر خارج شوی، ویرایش‌های این آگهی از بین می‌رود.',
        buttons: [{ label: 'ادامه‌ی ویرایش', kind: 'btn-primary', value: false }, { label: 'لغو تغییرات', kind: 'btn-soft-danger', value: true }]
      });
      if (!discard) return;
    }
    st.work = null; st.full = false; st.view = 'pick'; st.id = null; paintPick(); window.scrollTo(0, 0);
  }

  /* ---------- رویدادها ---------- */
  function insertAtCursor(el, text) {
    const s = el.selectionStart != null ? el.selectionStart : el.value.length, e = el.selectionEnd != null ? el.selectionEnd : s;
    const next = el.value.charAt(e);
    if (next && !/\s/.test(next)) text += ' ';   // بعد از شکلک یک فاصله تا به کلمه نچسبد
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    el.focus(); const p = s + text.length; try { el.setSelectionRange(p, p); } catch (x) { /* بی‌اثر */ }
  }
  const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
  const touchTpl = (d) => { d.tpl = d.tpl === 'mine' || d.tpl === 'custom' ? d.tpl : 'custom'; };

  function onInput(e) {
    const t = e.target;
    if (t.id === 'ad-q') { st.pickQ = t.value; const bx = $('ad-pick-list'); if (bx) bx.innerHTML = pickListHtml(); return; }
    if (st.view === 'free') return;
    if (!st.id || st.view !== 'edit') return;
    const d = draft();
    if (t.id === 'ad-title') { if (/\n/.test(t.value)) t.value = t.value.replace(/\n/g, ' '); d.title = t.value; syncHl('ad-title', t.value); touchTpl(d); }
    else if (t.id === 'ad-text') { d.text = t.value; syncHl('ad-text', t.value); touchTpl(d); autoSize(); }
    else if (t.id === 'ad-agency') sigNow().agency = t.value;
    else if (t.id === 'ad-phone') sigNow().phone = t.value;
    else if (t.id === 'ad-codetext') d.codeText = t.value;
    else return;
    paintLive(); markDirty();
  }

  function setField(id, key, value) {
    const d = draft(), el = $(id);
    d[key] = value; touchTpl(d);
    if (el) { el.value = value; syncHl(id, value); el.focus(); autoSize(); }
    paintLive(); markDirty();
  }

  async function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const D = t.dataset;
    /* لیست */
    if (D.adOpen) { st.view = 'edit'; st.id = D.adOpen; st.emojiTab = 'home'; st.tab = 'text'; st.work = null; st.full = false; paintEdit(); window.scrollTo(0, 0); return; }
    if (D.adFilter) { st.pickFilter = D.adFilter; paintPick(); return; }
    if (D.adNewfree !== undefined) { openFreeForm(null); window.scrollTo(0, 0); return; }
    /* فرم آگهی بدون فایل */
    if (D.adFtype) { readFreeForm(); st.freeForm.type = D.adFtype; paintFree(); return; }
    if (D.adFreesave !== undefined) { saveFree(); return; }
    if (D.adFreecancel !== undefined) {
      const id = st.freeForm && st.freeForm.id; st.freeForm = null;
      if (id) { st.view = 'edit'; st.id = id; paintEdit(); } else { st.view = 'pick'; paintPick(); }
      window.scrollTo(0, 0); return;
    }
    if (D.adFreedel !== undefined) {
      const id = st.freeForm && st.freeForm.id; if (!id) return;
      const sure = await ctx.showDialog({ title: 'حذف این آگهی؟', message: 'آگهی و پیش‌نویسش برای همیشه حذف می‌شود و قابل بازگشت نیست.', buttons: [{ label: 'انصراف', value: false }, { label: 'حذف', kind: 'btn-danger', value: true }] });
      if (!sure) return;
      A.removeFree(st.state, id); st.freeForm = null; st.work = null; st.view = 'pick'; st.id = null;
      try { await Backend.setSetting('ad_builder', st.state); ctx.showToast('آگهی حذف شد', 'success'); } catch (err) { ctx.showToast('حذف ذخیره نشد', 'error'); }
      paintPick(); window.scrollTo(0, 0); return;
    }
    /* ویرایشگر */
    if (D.adHub) { await leave(); return; }
    if (!st.id) return;
    const l = listing(); if (!l) return;
    const d = draft();
    if (D.adFreeedit !== undefined) { openFreeForm(l); window.scrollTo(0, 0); return; }
    if (D.adTab) {
      st.tab = D.adTab; st.full = false; paintEdit();
      if (D.adFocuscode) { const i = $('ad-codetext'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } }
      return;
    }
    if (D.adSave !== undefined) { commit(); return; }
    if (D.adCancel !== undefined) { await leave(); return; }
    if (D.adClear) { setField(D.adClear === 'title' ? 'ad-title' : 'ad-text', D.adClear === 'title' ? 'title' : 'text', ''); return; }
    if (D.adTpl) {
      const T = A.TEMPLATES[D.adTpl], n = T && T.variants ? T.variants.length : 1;
      const v = d.tpl === D.adTpl && n > 1 ? ((d.tv || 0) + 1) % n : 0;
      A.applyTemplate(l, d, D.adTpl, Object.assign(tplOpts(d), { variant: v })); paintEdit(); markDirty(); return;
    }
    if (D.adTool === 'emoji') { $('ad-emoji').hidden = !$('ad-emoji').hidden; return; }
    if (D.adTool === 'reset') {
      const k = A.TEMPLATES[d.tpl] || (d.tpl === 'mine' && st.state.myText) ? d.tpl : 'official';
      A.applyTemplate(l, d, k, tplOpts(d)); paintEdit(); markDirty(); return;
    }
    if (D.adEtab) { st.emojiTab = D.adEtab; paintEmoji(); return; }
    if (D.adEmoji) { insertAtCursor($('ad-text'), D.adEmoji); d.text = $('ad-text').value; syncHl('ad-text', d.text); touchTpl(d); autoSize(); paintLive(); markDirty(); return; }
    if (D.adFeat) { toggle(d.features, D.adFeat); refreshTpl(d); paintEdit(); markDirty(); return; }
    if (D.adPhrase) { toggle(d.phrases, D.adPhrase); paintEdit(); markDirty(); return; }
    if (D.adAddphrase !== undefined) {
      const p = String(await ctx.showPrompt({ title: 'جمله‌ی خودت', message: 'این جمله به لیست جمله‌های آماده اضافه می‌شود.', placeholder: 'مثلاً: همسایه‌های آرام و محیط امن', maxLength: 120, confirmLabel: 'افزودن' }) || '').trim().slice(0, 120);
      if (p) { if (!st.state.phrases.includes(p)) st.state.phrases.push(p); d.phrases.push(p); saveSoon(); paintEdit(); markDirty(); }
      return;
    }
    if (D.adSig !== undefined) { d.sig = !d.sig; paintEdit(); markDirty(); return; }
    if (D.adCode !== undefined) { d.code = !d.code; paintCode(); paintLive(); markDirty(); return; }
    if (D.adCodeauto !== undefined) { d.codeText = ''; paintCode(); paintLive(); markDirty(); return; }
    if (D.adFull !== undefined) { setFull(!st.full); paintEdit(); if (st.full) { const ta = $('ad-text'); if (ta) ta.focus(); } return; }
    if (D.adCopy) { const b = built(); copy(b.full, 'آگهی کامل کپی شد ✓'); return; }
  }

  return { init, render, reset, target, openFor };
})();
if (typeof globalThis !== 'undefined') globalThis.AdBuilder = AdBuilder;

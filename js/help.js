'use strict';
/* ============================================================
   آموزش تصویری داخل داشبورد
   Help.init({ $id, showScreen }) ؛ Help.render() ؛ Help.reset() ؛ Help.paintTip()
   هر درس چند قدم دارد و هر قدم یک تصویر ساده از خود اپ با بخش مهمِ حلقه‌دار
   ============================================================ */
const Help = (() => {
  const H = HelpCore;
  let ctx = null;
  const st = { lesson: null, step: 0 };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);
  const store = () => { try { return window.localStorage; } catch (e) { return null; } };

  function init(c) {
    ctx = c;
    $('hp-root').addEventListener('click', onClick);
    const tipBtn = $('hh-tip-ok');
    if (tipBtn) tipBtn.addEventListener('click', () => { H.setTipSeen(store()); paintTip(); });
  }

  /* راهنمای یک‌باره‌ی کنار دکمه‌ی «آموزش» در صفحه‌ی خانه */
  function paintTip() {
    const tip = ctx && $('hh-tip'); if (!tip) return;
    const seen = H.tipSeen(store());
    tip.hidden = seen;
    const btn = $('hh-help'); if (btn) btn.classList.toggle('hh-new', !seen);
  }

  /* درس‌های «فقط مدیر» فقط برای مدیر */
  const lessons = () => { let adm = false; try { adm = !!(Backend && Backend.isAdmin && Backend.isAdmin()); } catch (e) { adm = false; } return H.visible(adm); };

  function reset() { st.lesson = null; st.step = 0; }

  function render() { if (st.lesson) paintLesson(); else paintHub(); }

  /* ---------- فهرست آموزش‌ها ---------- */
  const ICON_PATH = {
    listings: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    clients: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5.2a3 3 0 010 5.6M18 14.4c1.8.8 3 2.6 3 5.6"/>',
    collab: '<circle cx="8" cy="8" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.3c3 .3 5.5 2 5.5 5.7"/>',
    'card-views': '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    deals: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 14l2 2 4-4"/>',
    'quick-note': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    converter: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
    ad: '<path d="M3 11v3a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15 9a4 4 0 010 6M18 6a8 8 0 010 12"/>',
    subscription: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
    install: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    home: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    support: '<path d="M4 5h16v11H9l-5 4z"/>',
    admin: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'
  };
  const svg = (p, s) => `<svg width="${s || 22}" height="${s || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const TONE = { listings: 'teal', clients: 'indigo', collab: 'sky', 'card-views': 'rose', deals: 'amber', 'quick-note': 'rose', converter: 'teal', ad: 'amber', subscription: 'indigo', install: 'sky', home: 'teal', support: 'sky', admin: 'indigo' };

  function paintHub() {
    const done = H.readDone(store());
    const list = lessons();
    const pr = H.progress(done, list);
    $('hp-root').innerHTML = `
      <div class="rd-card rd-static"><div class="rd-row"><b class="rd-grow">پیشرفت شما</b><span class="rd-hint">${Utils.faDigits(pr.done)} از ${Utils.faDigits(pr.total)} آموزش</span></div>
        <div class="rd-prog"><i style="width:${Math.max(pr.pct, 3)}%"></i></div></div>
      <div class="hp-quick"><div class="rd-grow"><div class="hp-quick-t">شروع سریع</div><div class="hp-quick-s">${H.QUICK.length === 3 ? '۳ قدم تا اولین مشتری و اولین کارت ملک' : ''}</div></div>
        <button type="button" class="hp-quick-btn" data-hp-quick="1">شروع</button></div>
      <div class="rd-h">آموزش هر بخش</div>
      ${list.map((l, i) => `<button type="button" class="hp-row" data-hp-open="${esc(l.id)}">
        <span class="hp-ic tone-${TONE[l.icon] || 'teal'}">${svg(ICON_PATH[l.icon])}</span>
        <span class="rd-grow"><span class="hp-t">${Utils.faDigits(i + 1)}. ${esc(l.title)}</span><span class="hp-s">${esc(l.sub)}</span></span>
        ${done.includes(l.id) ? `<span class="hp-done">${svg('<path d="M5 12l5 5 9-10"/>', 17)}</span>` : `<span class="hp-chev">${svg('<path d="M15 6l-6 6 6 6"/>', 20)}</span>`}</button>`).join('')}`;
  }

  /* ---------- تصویر هر قدم ---------- */
  function block(b) {
    const hl = b.hl ? ' mk-hl' : '';
    const tag = b.hl ? '<span class="mk-tag">اینجا بزن</span>' : '';
    switch (b.t) {
      case 'title': return `<div class="mk-title">${esc(b.x)}</div>`;
      case 'text': return `<div class="mk-text">${esc(b.x)}</div>`;
      case 'price': return `<div class="mk-price">${esc(b.x)}</div>`;
      case 'note': return `<div class="mk-note">${esc(b.x)}</div>`;
      case 'banner': return `<div class="mk-banner${hl}">${esc(b.x)}${tag}</div>`;
      case 'field': return `<div class="mk-field${hl}"><span>${esc(b.l)}</span><b>${esc(b.v)}</b>${tag}</div>`;
      case 'chips': return `<div class="mk-chips${hl}">${b.x.map((c, i) => `<span class="${i === b.on ? 'on' : ''}">${esc(c)}</span>`).join('')}${tag}</div>`;
      case 'seg': return `<div class="mk-seg${hl}">${b.x.map((c, i) => `<span class="${i === b.on ? 'on' : ''}">${esc(c)}</span>`).join('')}${tag}</div>`;
      case 'row': return `<div class="mk-row${hl}"><div class="rd-grow"><b>${esc(b.x)}</b><small>${esc(b.s || '')}</small></div>${b.p ? `<span class="mk-pill">${esc(b.p)}</span>` : ''}${tag}</div>`;
      case 'btn': return `<div class="mk-btn k-${esc(b.kind || 'primary')}${hl}">${esc(b.x)}${tag}</div>`;
      default: return '';
    }
  }

  /* ---------- درس ---------- */
  function paintLesson() {
    const l = H.byId(st.lesson); if (!l) { reset(); paintHub(); return; }
    const s = l.steps[st.step], last = st.step === l.steps.length - 1;
    const list = lessons(), idx = list.indexOf(l) + 1;
    $('hp-root').innerHTML = `
      <button type="button" class="hp-back" data-hp-hub="1">→ همه‌ی آموزش‌ها</button>
      <div class="hp-lhead"><span class="hp-ic tone-${TONE[l.icon] || 'teal'}">${svg(ICON_PATH[l.icon])}</span><div class="rd-grow"><div class="rd-hint">آموزش ${Utils.faDigits(idx)} از ${Utils.faDigits(list.length)}</div><div class="rd-title">${esc(l.title)}</div></div></div>
      <div class="hp-dots">${l.steps.map((_, i) => `<i class="${i <= st.step ? 'on' : ''}"></i>`).join('')}<span>قدم ${Utils.faDigits(st.step + 1)} از ${Utils.faDigits(l.steps.length)}</span></div>
      <div class="mk">${s.mock.map(block).join('')}</div>
      <div class="rd-card rd-static hp-step"><span class="hp-num">${Utils.faDigits(st.step + 1)}</span><div><div class="hp-st">${esc(s.t)}</div><div class="rd-hint">${esc(s.d)}</div></div></div>
      ${s.tip ? `<div class="hp-tip"><b>نکته:</b> ${esc(s.tip)}</div>` : ''}
      <div class="rd-actions">
        ${st.step > 0 ? '<button type="button" class="rd-btn ghost" data-hp-prev="1">قبلی</button>' : ''}
        <button type="button" class="rd-btn primary" data-hp-${last ? 'finish' : 'next'}="1" style="flex:2">${last ? 'تمام شد' : 'بعدی'}</button>
      </div>
      ${last ? `<button type="button" class="rd-btn soft" data-hp-go="${esc(l.screen)}" style="margin-top:10px;width:100%">برو به «${esc(l.title)}»</button>` : ''}`;
    window.scrollTo(0, 0);
  }

  function open(id) { st.lesson = id; st.step = 0; paintLesson(); }

  function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.hpOpen) { open(d.hpOpen); return; }
    if (d.hpQuick) { open(H.QUICK[0].lesson); return; }
    if (d.hpHub) { reset(); paintHub(); window.scrollTo(0, 0); return; }
    if (d.hpNext) { st.step++; paintLesson(); return; }
    if (d.hpPrev) { st.step = Math.max(0, st.step - 1); paintLesson(); return; }
    if (d.hpFinish) { H.markDone(store(), st.lesson); reset(); paintHub(); window.scrollTo(0, 0); return; }
    if (d.hpGo) { H.markDone(store(), st.lesson); reset(); ctx.showScreen(d.hpGo); }
  }

  return { init, render, reset, paintTip };
})();
if (typeof globalThis !== 'undefined') globalThis.Help = Help;

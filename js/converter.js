'use strict';
/* ============================================================
   تبدیل رهن و اجاره — رابط کاربری (صفحه‌ی مستقل)
   Converter.init({ $id, showToast }) ؛ Converter.render()
   ============================================================ */
const Converter = (() => {
  const K = ConverterCore;
  const KEY = 'rc_settings';
  let ctx = null;
  const st = { settings: K.validateSettings({}), loaded: false, res: null, mode: 'deposit' };
  const esc = (s) => Utils.esc(s);
  const $ = (id) => ctx.$id(id);

  function init(c) {
    ctx = c;
    const recalc = Utils.debounce(calc, 150);
    ['cv-rent', 'cv-if-rent'].forEach((id) => $(id).addEventListener('input', recalc));
    /* رهن: ویرگول سه‌رقمی هنگام تایپ + انتخاب واحد (پیش‌فرض میلیارد) */
    ['cv-deposit', 'cv-if-deposit'].forEach((id) => $(id).addEventListener('input', (e) => { liveFormat(e && e.target ? e.target : $(id)); recalc(); }));
    ['cv-deposit-unit', 'cv-if-deposit-unit'].forEach((id) => { const u = $(id); if (u && u.addEventListener) u.addEventListener('change', calc); });
    $('cv-save-settings').addEventListener('click', saveSettings);
    $('cv-logo').addEventListener('change', onLogo);
    $('cv-logo-clear').addEventListener('click', () => { st.settings.logo = ''; paintLogo(); });
    $('cv-share-img').addEventListener('click', shareImage);
    $('cv-share-txt').addEventListener('click', shareText);
    $('cv-gear').addEventListener('click', () => { const d = $('cv-settings'); d.open = !d.open; if (d.open) d.scrollIntoView({ block: 'nearest' }); });
    $('cv-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-cv-mode]'); if (b) { st.mode = b.dataset.cvMode; paintMode(); calc(); } });
  }

  async function render() {
    if (!st.loaded) {
      try { st.settings = K.validateSettings(await Backend.getSetting(KEY, {}) || {}); } catch (e) { /* تنظیمات خوانده نشد؛ پیش‌فرض */ }
      st.loaded = true;
    }
    const s = st.settings;
    $('cv-ratio').value = s.ratio == null ? '' : s.ratio;
    $('cv-step').value = s.stepM;
    $('cv-agency').value = s.agency;
    paintLogo();
    $('cv-settings').open = !s.ratio;
    paintSummary(); paintMode();
    calc();
  }

  /* خلاصه‌ی تنظیمات به‌صورت یک خط: ضریب · پله */
  function paintSummary() {
    const s = st.settings;
    $('cv-setsum').innerHTML = s.ratio
      ? `ضریب <b>${Utils.faDigits(s.ratio)}</b><span class="cv-dot">·</span>پله <b>${Utils.faDigits(s.stepM)} میلیون</b>`
      : '<span class="cv-warn">اول ضریب تبدیل را تنظیم کن</span>';
  }
  /* یک ورودی «چه چیزی عوض شود» در هر لحظه */
  function paintMode() {
    $('cv-modes').querySelectorAll('[data-cv-mode]').forEach((b) => b.classList.toggle('on', b.dataset.cvMode === st.mode));
    $('cv-wrap-deposit').hidden = st.mode !== 'deposit';
    $('cv-wrap-rent').hidden = st.mode !== 'rent';
  }

  function readSettingsForm() {
    return K.validateSettings({ ratio: $('cv-ratio').value, stepM: $('cv-step').value, agency: $('cv-agency').value, logo: st.settings.logo });
  }

  async function saveSettings() {
    try {
      const s = readSettingsForm();
      await Backend.setSetting(KEY, s);
      st.settings = s;
      ctx.showToast('تنظیمات ذخیره شد ✓', 'success');
      $('cv-settings').open = false;
      paintSummary(); calc();
    } catch (err) { ctx.showToast(err && err.userFacing ? err.message : 'خطا: ' + Backend.faErr(err), 'error'); }
  }

  /* لوگو: کوچک می‌شود (حداکثر ۱۶۰ پیکسل) تا در تنظیمات جا بگیرد */
  function onLogo(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 160 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      st.settings.logo = c.toDataURL('image/png');
      paintLogo();
    };
    img.onerror = () => { URL.revokeObjectURL(url); ctx.showToast('این فایل تصویر نیست.', 'error'); };
    img.src = url;
  }

  function paintLogo() {
    const has = !!st.settings.logo;
    $('cv-logo-preview').innerHTML = has ? `<img src="${st.settings.logo}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:8px">` : '';
    $('cv-logo-clear').style.display = has ? '' : 'none';
  }

  /* ---------- ورودی رهن: ویرگول و واحد ---------- */
  const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
  const norm = (v) => String(v == null ? '' : v).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => AR.indexOf(d))
    .replace(/[٬,،\s]/g, '').replace(/[٫\/]/g, '.');
  function fmtCommas(raw) {
    const n = norm(raw).replace(/[^0-9.]/g, '');
    const parts = n.split('.'), ii = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n.indexOf('.') >= 0 ? ii + '.' + parts.slice(1).join('') : ii;
  }
  function liveFormat(el) {
    const pos = el.selectionStart == null ? String(el.value).length : el.selectionStart;
    const digitsBefore = norm(el.value.slice(0, pos)).replace(/[^0-9.]/g, '').length;
    if (!/^[0-9]*\.?[0-9]*$/.test(norm(el.value))) return;   // متن نامعتبر دست‌نخورده می‌ماند تا خطای «معتبر نیست» بیاید
    const f = fmtCommas(el.value);
    if (f === el.value) return;
    el.value = f;
    let cnt = 0, i = 0;
    for (; i < f.length && cnt < digitsBefore; i++) if (/[0-9.]/.test(f[i])) cnt++;
    try { el.setSelectionRange(i, i); } catch (e) { /* ignore */ }
  }
  const UNIT_TO_MILLION = { b: 1000, m: 1, t: 1e-6 };
  /* متن داخل کادر + واحد → «میلیون تومان» (ورودیِ منطق محاسبه) */
  function depositMillions(inp, u) {
    const v = norm(inp.value);
    if (!v) return '';
    const mul = UNIT_TO_MILLION[u ? u.value : 'm'] || 1;
    const n = Number(v);
    if (isNaN(n)) return v;
    return String(Math.round(n * mul * 1e6) / 1e6);
  }

  function calc() {
    const info = $('cv-info'), out = $('cv-result'), acts = $('cv-actions'), eq = $('cv-eq');
    st.res = null; out.innerHTML = ''; info.textContent = ''; acts.hidden = true; eq.hidden = true;
    const input = { deposit: depositMillions($('cv-deposit'), $('cv-deposit-unit')), rent: $('cv-rent').value, ifDeposit: st.mode === 'deposit' ? depositMillions($('cv-if-deposit'), $('cv-if-deposit-unit')) : '', ifRent: st.mode === 'rent' ? $('cv-if-rent').value : '' };
    try {
      const res = K.calculate(input, st.settings);
      st.res = res;
      eq.hidden = false; eq.innerHTML = 'اجاره‌ی ماهانه‌ی معادل: <b>' + esc(K.money(res.equivalent)) + '</b> <span>(با تغییر رهن و اجاره ثابت می‌ماند)</span>';
      out.innerHTML = resultHtml(res);
      acts.hidden = false;
    } catch (err) {
      info.textContent = err && err.userFacing ? err.message : 'خطا در محاسبه';
    }
  }

  /* کارت بزرگ نتیجه + جدول سناریوها (رهن | اجاره) با ردیف فعلی پررنگ */
  function resultHtml(res) {
    const m = K.money, model = K.buildCardModel(res, st.settings), w = model.whatIf[0];
    let sub = '';
    if (res.whatIfDeposit && !res.whatIfDeposit.full && res.rent) { const d = res.whatIfDeposit.rent - res.rent; sub = 'نسبت به اجاره‌ی فعلی ' + m(Math.abs(d)) + (d < 0 ? ' کمتر' : d > 0 ? ' بیشتر' : ' (بدون تغییر)'); }
    if (res.whatIfRent && !res.whatIfRent.over && res.deposit) { const d = res.whatIfRent.deposit - res.deposit; sub = 'نسبت به رهن فعلی ' + m(Math.abs(d)) + (d < 0 ? ' کمتر' : d > 0 ? ' بیشتر' : ' (بدون تغییر)'); }
    const hero = w
      ? `<div class="cv-hero"><small>${esc(w.title)}</small><div class="cv-hv">${esc(w.big)}</div><div class="cv-hs">${esc(w.caption)}${sub ? ' · ' + esc(sub) : ''}</div></div>`
      : `<div class="cv-hero"><small>اجاره‌ی ماهانه‌ی معادل</small><div class="cv-hv">${esc(m(res.equivalent))}</div><div class="cv-hs">برای دیدن حالت دلخواه، در مرحله‌ی ۲ مبلغ را بنویس</div></div>`;
    const rows = model.rows.map((r) => `<div class="cv-tr${r.base ? ' base' : ''}"><span>${esc(r.full ? 'رهن کامل ' + r.deposit : r.deposit)}${r.base ? '<em>فعلی</em>' : ''}</span><span>${esc(r.full ? 'بدون اجاره' : r.rent)}</span></div>`).join('');
    return `${hero}<div class="cv-table"><div class="cv-th"><span>رهن</span><span>اجاره‌ی ماهانه</span></div>${rows}</div>`;
  }

  /* ---------- کارت تصویری ---------- */
  function wrap(c, text, maxW) {
    const words = text.split(' '), lines = [];
    let cur = '';
    words.forEach((w) => {
      const t = cur ? cur + ' ' + w : w;
      if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  }

  /* کارت تصویری حرفه‌ای: سربرگ گرادیانی، شرایط فعلی، کارت نتیجه، جدول سناریوها، پاورقی */
  async function drawCard(model) {
    try { await document.fonts.ready; } catch (e) { /* بی‌اثر */ }
    const W = 1080, P = 56, FONT = 'Vazirmatn, Tahoma, sans-serif';
    const brand = (getComputedStyle(document.documentElement).getPropertyValue('--brand-dark') || '').trim() || '#0f766e';
    const BLUE = '#1e5aa0';
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = '500 30px ' + FONT; probe.direction = 'rtl';
    const noteParts = wrap(probe, model.note, W - 2 * P);
    const headH = 250, secH = 70, statH = 150, heroH = 230, rowH = 84, thH = 70;
    const hasCur = model.current.filter((c) => c.value !== '—');
    const heroes = model.whatIf.length ? model.whatIf : [{ title: 'اجاره‌ی ماهانه‌ی معادل', big: model.equivalent, caption: 'با تغییر رهن و اجاره ثابت می‌ماند' }];
    const H = headH + 40 + secH + statH + 30 + heroes.length * (heroH + 24) + 20 + secH + thH + model.rows.length * rowH + 40 + noteParts.length * 46 + 70;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, W, H);
    /* سربرگ */
    const grad = g.createLinearGradient(0, 0, W, headH); grad.addColorStop(0, '#0f9a8a'); grad.addColorStop(0.55, brand); grad.addColorStop(1, BLUE);
    g.fillStyle = grad; g.fillRect(0, 0, W, headH);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(120, headH - 20, 150, 0, Math.PI * 2); g.fill();
    let x = W - P;
    if (model.logo) {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = model.logo; });
      if (img) {
        const s = 140, k = Math.min((s - 20) / img.width, (s - 20) / img.height);
        g.fillStyle = '#ffffff'; rr(g, x - s, 55, s, s, 30); g.fill();
        g.drawImage(img, x - s + (s - img.width * k) / 2, 55 + (s - img.height * k) / 2, img.width * k, img.height * k);
        x -= s + 28;
      }
    }
    g.fillStyle = '#ffffff'; g.font = '700 54px ' + FONT;
    g.fillText(model.agency || model.title, x, 100);
    g.font = '500 32px ' + FONT; g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText(model.agency ? model.title : 'محاسبه‌ی دقیق و سریع', x, 164);
    let y = headH + 40;
    const label = (t) => { g.fillStyle = '#334155'; g.font = '700 34px ' + FONT; g.textAlign = 'right'; g.fillText(t, W - P, y + secH / 2 - 8); y += secH; };
    /* شرایط فعلی */
    label('شرایط فعلی');
    const bw = (W - 2 * P - (hasCur.length - 1) * 24) / Math.max(hasCur.length, 1);
    hasCur.forEach((c, i) => {
      const bx = W - P - (i + 1) * bw - i * 24;
      g.fillStyle = '#ffffff'; rr(g, bx, y, bw, statH, 28); g.fill();
      g.strokeStyle = '#e3e8ef'; g.lineWidth = 2; g.stroke();
      g.textAlign = 'right'; g.fillStyle = '#64748b'; g.font = '500 30px ' + FONT; g.fillText(c.label, bx + bw - 30, y + 44);
      g.fillStyle = '#0f172a'; g.font = '700 42px ' + FONT; g.fillText(c.value, bx + bw - 30, y + 102);
    });
    y += statH + 30;
    /* کارت(های) نتیجه */
    heroes.forEach((h) => {
      const gr = g.createLinearGradient(P, y, W - P, y + heroH); gr.addColorStop(0, '#0f9a8a'); gr.addColorStop(0.6, brand); gr.addColorStop(1, BLUE);
      g.fillStyle = gr; rr(g, P, y, W - 2 * P, heroH, 36); g.fill();
      g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '500 32px ' + FONT; g.fillText(h.title, W - P - 40, y + 50);
      g.fillStyle = '#ffffff'; g.font = '700 74px ' + FONT; g.fillText(h.big, W - P - 40, y + 128);
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '500 28px ' + FONT; g.fillText(h.caption, W - P - 40, y + 190);
      y += heroH + 24;
    });
    y += 20;
    /* جدول */
    label('جدول پیشنهادی');
    const tw = W - 2 * P;
    g.fillStyle = '#ffffff'; rr(g, P, y, tw, thH + model.rows.length * rowH, 28); g.fill();
    g.strokeStyle = '#e3e8ef'; g.lineWidth = 2; g.stroke();
    g.save(); rr(g, P, y, tw, thH + model.rows.length * rowH, 28); g.clip();
    g.fillStyle = '#f1f5f9'; g.fillRect(P, y, tw, thH);
    g.fillStyle = '#64748b'; g.font = '500 28px ' + FONT;
    g.textAlign = 'right'; g.fillText('رهن', W - P - 34, y + thH / 2);
    g.textAlign = 'left'; g.fillText('اجاره‌ی ماهانه', P + 34, y + thH / 2);
    y += thH;
    model.rows.forEach((r, i) => {
      if (r.base) { g.fillStyle = '#e3f5f1'; g.fillRect(P, y, tw, rowH); }
      else if (i % 2) { g.fillStyle = '#fafbfd'; g.fillRect(P, y, tw, rowH); }
      g.fillStyle = r.base ? brand : '#1f2937'; g.font = (r.base ? '700 ' : '500 ') + '36px ' + FONT;
      g.textAlign = 'right'; const dep = r.full ? 'رهن کامل ' + r.deposit : r.deposit;
      g.fillText(dep, W - P - 34, y + rowH / 2);
      if (r.base) {
        const dw = g.measureText(dep).width; g.font = '700 24px ' + FONT;
        const pw = g.measureText('فعلی').width + 36; const px = W - P - 34 - dw - 20 - pw;
        g.fillStyle = brand; rr(g, px, y + rowH / 2 - 20, pw, 40, 20); g.fill();
        g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('فعلی', px + pw / 2, y + rowH / 2 + 1);
      }
      g.fillStyle = r.base ? brand : '#1f2937'; g.font = (r.base ? '700 ' : '500 ') + '36px ' + FONT;
      g.textAlign = 'left'; g.fillText(r.full ? 'بدون اجاره' : r.rent, P + 34, y + rowH / 2);
      if (i < model.rows.length - 1) { g.fillStyle = '#eef1f5'; g.fillRect(P + 20, y + rowH - 1, tw - 40, 2); }
      y += rowH;
    });
    g.restore();
    /* پاورقی */
    y += 40;
    g.textAlign = 'center'; g.fillStyle = '#64748b'; g.font = '500 30px ' + FONT;
    noteParts.forEach((p, i) => g.fillText(p, W / 2, y + 20 + i * 46));
    g.fillStyle = brand; rr(g, W / 2 - 60, H - 40, 120, 8, 4); g.fill();
    return cv;
  }

  async function shareImage() {
    if (!st.res) return;
    const btn = $('cv-share-img'); btn.disabled = true;
    try {
      const cv = await drawCard(K.buildCardModel(st.res, st.settings));
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      const file = new File([blob], 'rahn-ejare.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: K.buildShareText(st.res, st.settings) }); }
        catch (err) { if (!err || err.name !== 'AbortError') throw err; }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'rahn-ejare.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        ctx.showToast('تصویر ذخیره شد؛ از گالری بفرست.', 'success');
      }
    } catch (err) { ctx.showToast('خطا در ساخت کارت: ' + (err && err.message || ''), 'error'); }
    btn.disabled = false;
  }

  function shareText() {
    if (!st.res) return;
    window.open('https://wa.me/?text=' + encodeURIComponent(K.buildShareText(st.res, st.settings)), '_blank', 'noopener');
  }

  return { init, render };
})();

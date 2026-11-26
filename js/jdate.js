'use strict';
/* ============================================================
   انتخاب‌گر تاریخ شمسی (روز / ماه / سال) — جایگزین <input type="date">
   • مقدار ذخیره‌شده همیشه ISO میلادی «YYYY-MM-DD» است (سازگار با دیتابیس و منطق قبلی)
   • JDate.html(id, iso, opts) → HTML (با <input type=hidden id> که .value آن همیشه ISO است)
   • JDate.get(el) → iso یا '' ؛ JDate.set(el, iso) ؛ JDate.isPartial(el) → انتخاب ناقص/نامعتبر
   • منطق خالص (بدون DOM) برای تست در Node: isoToParts / partsToIso / validParts / label
   ============================================================ */
const JDate = (() => {
  const U = (typeof Utils !== 'undefined') ? Utils : require('./utils.js');
  const pad = (x) => String(x).padStart(2, '0');
  const esc = (s) => U.esc(s);

  const localNoon = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

  function validParts(jy, jm, jd) {
    if (!(jy > 0 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31)) return false;
    const [gy, gm, gd] = U.jalaliToGregorian(jy, jm, jd);
    const b = U.gregorianToJalali(gy, gm, gd);
    return b[0] === jy && b[1] === jm && b[2] === jd;   // «۳۱ مهر» و «۳۰ اسفند در سال کبیسه‌نشده» نامعتبرند
  }
  function isoToParts(iso) {
    const d = localNoon(iso); if (!d) return null;
    const [jy, jm, jd] = U.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { jy, jm, jd };
  }
  function partsToIso(jy, jm, jd) {
    if (!validParts(jy, jm, jd)) return '';
    const [gy, gm, gd] = U.jalaliToGregorian(jy, jm, jd);
    return gy + '-' + pad(gm) + '-' + pad(gd);
  }
  /* «پنجشنبه ۲۱ آبان ۱۴۰۵» */
  function label(iso) { const d = localNoon(iso); return d ? U.faFullDate(d) : ''; }
  const isPast = (iso) => !!iso && String(iso).slice(0, 10) < todayISO();

  const opt = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;

  /* opts: { yearsBack = 1, yearsFwd = 6, attrs = '' }
     id و attrs روی <input type="hidden"> می‌نشینند و مقدار آن همیشه ISO میلادی (یا '') است؛
     یعنی کدِ قبلی که .value را می‌خواند بدون تغییر کار می‌کند. */
  function html(id, iso, opts) {
    const o = opts || {}, back = o.yearsBack == null ? 1 : o.yearsBack, fwd = o.yearsFwd == null ? 6 : o.yearsFwd;
    const p = isoToParts(iso), t = isoToParts(todayISO());
    const years = [];
    for (let y = t.jy - back; y <= t.jy + fwd; y++) years.push(y);
    if (p && years.indexOf(p.jy) < 0) { years.push(p.jy); years.sort((a, b) => a - b); }
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    return `<div class="jd" data-jd="1"><input type="hidden" id="${esc(id)}" value="${esc(p ? partsToIso(p.jy, p.jm, p.jd) : '')}" ${o.attrs || ''}><div class="jd-row">
      <select data-jd-p="d" aria-label="روز">${opt('', 'روز', !p)}${days.map((d) => opt(d, U.faDigits(d), p && p.jd === d)).join('')}</select>
      <select data-jd-p="m" aria-label="ماه">${opt('', 'ماه', !p)}${U.JALALI_MONTHS.map((m, i) => opt(i + 1, m, p && p.jm === i + 1)).join('')}</select>
      <select data-jd-p="y" aria-label="سال">${opt('', 'سال', !p)}${years.map((y) => opt(y, U.faDigits(y), p && p.jy === y)).join('')}</select>
    </div><div class="jd-hint">${esc(p ? label(iso) : '')}</div></div>`;
  }

  const root = (el) => (el && el.classList && el.classList.contains('jd')) ? el : (el && el.closest ? el.closest('.jd') : null);
  const sel = (w, k) => w.querySelector('[data-jd-p="' + k + '"]');
  const hid = (w) => w.querySelector('input[type="hidden"]');
  function read(w) {
    const jy = parseInt(sel(w, 'y').value, 10), jm = parseInt(sel(w, 'm').value, 10), jd = parseInt(sel(w, 'd').value, 10);
    return partsToIso(jy, jm, jd);
  }
  /* انتخاب ناقص یا نامعتبر (مثلاً «۳۱ مهر») */
  function isPartial(el) {
    const w = root(el); if (!w) return false;
    return !read(w) && ['d', 'm', 'y'].some((k) => sel(w, k).value);
  }
  function refresh(w) {
    const iso = read(w), h = hid(w); if (h) h.value = iso;
    const hint = w.querySelector('.jd-hint'); if (!hint) return;
    const bad = !iso && ['d', 'm', 'y'].some((k) => sel(w, k).value);
    hint.textContent = iso ? label(iso) : (bad ? 'تاریخ معتبر نیست' : '');
    hint.classList.toggle('bad', bad);
  }
  function get(el) { const w = root(el); return w ? read(w) : ((el && el.value) || ''); }
  function set(el, iso) {
    const w = root(el);
    if (!w) { if (el) el.value = iso || ''; return; }   // محیط‌های بدون DOM واقعی (تست)
    const p = isoToParts(iso), ys = sel(w, 'y');
    if (p && !ys.querySelector('option[value="' + p.jy + '"]')) {
      const o = document.createElement('option'); o.value = p.jy; o.textContent = U.faDigits(p.jy); ys.appendChild(o);
    }
    sel(w, 'd').value = p ? p.jd : ''; sel(w, 'm').value = p ? p.jm : ''; ys.value = p ? p.jy : '';
    refresh(w);
  }

  /* هر تغییر روی روز/ماه/سال، مقدار ISO پنهان و متن «پنجشنبه ۲۱ آبان ۱۴۰۵» را به‌روز می‌کند
     (برای انتخاب‌گرهایی که بعداً به صفحه اضافه می‌شوند هم کار می‌کند) */
  if (typeof document !== 'undefined') {
    document.addEventListener('change', (e) => { const w = e.target && e.target.closest && e.target.closest('.jd'); if (w) refresh(w); });
  }

  return { html, get, set, isPartial, isoToParts, partsToIso, validParts, label, isPast, todayISO };
})();

if (typeof globalThis !== 'undefined') globalThis.JDate = JDate;
if (typeof module !== 'undefined' && module.exports) module.exports = JDate;

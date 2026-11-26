'use strict';
/* ============================================================
   برنامه‌ی روزانه — منطق خالص (بدون DOM/دیتابیس/میکروفون؛ قابل تست در Node)
   • تحلیل متنِ گفته‌شده یا نوشته‌شده → چند کار جدا با تاریخ، ساعت و مشتری
   • گروه‌بندی روز، کارهای عقب‌افتاده، شمارنده‌ی «امروز»
   • اعتبارسنجی
   همه‌ی تاریخ‌ها رشته‌ی ISO محلی (YYYY-MM-DD)؛ ساعت‌ها «HH:MM».
   ============================================================ */
const DailyPlanCore = (() => {
  const U = () => (typeof Utils !== 'undefined' ? Utils : require('./utils.js'));
  const bad = (msg) => Object.assign(new Error(msg), { userFacing: true });

  const MAX_TITLE = 200;
  const MAX_TASKS = 30;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ---------- تاریخ (محلی، ظهر؛ بدون دردسر منطقه‌ی زمانی) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function fromISO(iso) {
    const m = ISO_RE.test(String(iso || '')) ? String(iso).split('-').map(Number) : null;
    return m ? new Date(m[0], m[1] - 1, m[2], 12, 0, 0, 0) : null;
  }
  function addDays(iso, n) {
    const d = fromISO(iso) || new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  const todayISO = () => toISO(new Date());
  const isValidISO = (s) => { const d = fromISO(s); return !!d && toISO(d) === s; };

  /* ---------- یکسان‌سازی متن (هم‌طول با متن اصلی تا بتوان بخش‌ها را از متن اصلی برید) ---------- */
  function fold(s) {
    return U().toLatinDigits(String(s == null ? '' : s))
      .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه').replace(/ة/g, 'ه')
      .replace(/\u200c/g, ' ').replace(/[\u064B-\u065F\u0670\u0640]/g, ' ');
  }

  /* ---------- عدد به حروف (۱ تا ۵۹) ---------- */
  const UNITS = { یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19 };
  const TENS = { بیست: 20, سی: 30, چهل: 40, پنجاه: 50 };
  const UNIT_ALT = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');
  const TENS_ALT = Object.keys(TENS).join('|');
  const NUM = '(?:\\d{1,2}|(?:' + TENS_ALT + ')(?:\\s+و\\s+(?:' + UNIT_ALT + '))?|(?:' + UNIT_ALT + '))';
  function parseNum(t) {
    const s = String(t || '').trim();
    if (/^\d{1,2}$/.test(s)) return Number(s);
    if (UNITS[s] != null) return UNITS[s];
    const m = new RegExp('^(' + TENS_ALT + ')(?:\\s+و\\s+(' + UNIT_ALT + '))?$').exec(s);
    return m ? TENS[m[1]] + (m[2] ? UNITS[m[2]] : 0) : null;
  }
  const END = '(?![\\u0600-\\u06FF])';   // «مرز کلمه» برای حروف فارسی

  /* ---------- ساعت ---------- */
  const PERIOD_DEFAULT = { morning: '09:00', noon: '12:00', afternoon: '15:00', evening: '17:00', night: '20:00' };
  const PERIOD_RES = [
    ['afternoon', /بعد\s*از\s*ظهر|بعدازظهر|بعد\s*ظهر|بعدظهر/],
    ['morning', /صبح|سحر/],
    ['noon', /ظهر/],
    ['evening', /عصر/],
    ['night', /امشب|شب|نیمه\s*شب/]
  ];

  function findPeriod(f) {
    for (const [key, re] of PERIOD_RES) {
      const m = new RegExp('(?<![\\u0600-\\u06FF])(?:' + re.source + ')' + END).exec(f);
      if (m) return { key, index: m.index, len: m[0].length };
    }
    return null;
  }

  function applyPeriod(h, key) {
    if (h > 23) return null;
    if (key === 'morning') return h === 12 ? 0 : h;
    if (key === 'noon') return h >= 1 && h <= 4 ? h + 12 : h;
    if (key === 'afternoon' || key === 'evening') return h < 12 ? h + 12 : h;
    if (key === 'night') return h === 12 ? 0 : (h >= 6 && h < 12 ? h + 12 : h);
    // بدون کلمه‌ی زمان: ۱ تا ۶ = بعدازظهر (قرار بازدید)، ۷ تا ۱۱ = صبح
    return h >= 1 && h <= 6 ? h + 12 : h;
  }

  /* خروجی: { time, spans:[[from,to],...] } روی متن fold‌شده؛ time ممکن است null باشد */
  function extractTime(f) {
    const spans = [];
    let hour = null, minute = 0;
    // ساعت ۱۰ | ساعت ده و نیم | ساعت ۴ و ربع | ساعت ۵ و ده دقیقه | ساعت ۱۰:۳۰
    const re = new RegExp('(?<![\\u0600-\\u06FF])ساعت\\s*(' + NUM + ')(?:\\s*[:٫.]\\s*(\\d{2}))?(?:\\s+و\\s+(نیم|ربع|(' + NUM + ')\\s*دقیقه)' + END + ')?');
    const m = re.exec(f);
    if (m) {
      const h = parseNum(m[1]);
      if (h != null && h <= 24) {
        hour = h === 24 ? 0 : h;
        if (m[2] != null) minute = Number(m[2]);
        else if (m[3] === 'نیم') minute = 30;
        else if (m[3] === 'ربع') minute = 15;
        else if (m[4]) minute = parseNum(m[4]) || 0;
        spans.push([m.index, m.index + m[0].length]);
      }
    } else {
      const c = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/.exec(f);
      if (c) { hour = Number(c[1]); minute = Number(c[2]); spans.push([c.index, c.index + c[0].length]); }
    }
    const per = findPeriod(f);
    if (per) spans.push([per.index, per.index + per.len]);
    if (minute > 59) minute = 0;
    let time = null;
    if (hour != null) {
      const h24 = hour > 12 ? hour : applyPeriod(hour, per ? per.key : null);
      if (h24 != null) time = pad(h24) + ':' + pad(minute);
    } else if (per) {
      time = PERIOD_DEFAULT[per.key];
    }
    return { time, period: per ? per.key : null, spans };
  }

  /* ---------- تاریخ ---------- */
  const WEEKDAYS = [
    ['سه شنبه', 2], ['چهار شنبه', 3], ['پنج شنبه', 4], ['یک شنبه', 0], ['دو شنبه', 1],
    ['شنبه', 6], ['جمعه', 5], ['آدینه', 5]
  ];
  const JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

  /* روز هفته‌ی شمسی از شنبه: شنبه=۰ ... جمعه=۶ */
  const persianDow = (d) => (d.getDay() + 1) % 7;

  function weekdayDate(wdJs, base, thisWeek, nextWeek) {
    const b = fromISO(base);
    const targetOff = (wdJs + 1) % 7;               // شنبه=۰
    if (nextWeek) {
      const startOffset = 7 - persianDow(b);        // شنبه‌ی هفته‌ی بعد
      return addDays(base, startOffset + targetOff);
    }
    let diff = targetOff - persianDow(b);
    if (diff < 0) diff += 7;
    if (diff === 0 && !thisWeek) diff = 7;
    return addDays(base, diff);
  }

  function jalaliToISO(jy, jm, jd) {
    const g = U().jalaliToGregorian(jy, jm, jd);
    const d = Array.isArray(g) ? new Date(g[0], g[1] - 1, g[2], 12) : (g && g.gy ? new Date(g.gy, g.gm - 1, g.gd, 12) : null);
    return d ? toISO(d) : null;
  }

  /* ---------- تقویم شمسی (منطق خالص برای انتخاب‌گر تاریخ و نوار هفته) ---------- */
  const FA_WEEK = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  function jalaliParts(iso) {
    const d = fromISO(iso); if (!d) return null;
    const g = U().gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { jy: g[0], jm: g[1], jd: g[2] };
  }
  function jalaliMonthLen(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    const iso = jalaliToISO(jy, 12, 30), p = iso && jalaliParts(iso);
    return p && p.jm === 12 && p.jd === 30 ? 30 : 29;      // اسفندِ سال کبیسه ۳۰ روز است
  }
  function jalaliAddMonth(jy, jm, n) {
    const t = jy * 12 + (jm - 1) + n;
    return { jy: Math.floor(t / 12), jm: (t % 12) + 1 };
  }
  /* شبکه‌ی یک ماه شمسی: offset = تعداد خانه‌ی خالی قبل از روز اول (هفته از شنبه) */
  function jalaliMonthGrid(jy, jm) {
    const first = jalaliToISO(jy, jm, 1), len = jalaliMonthLen(jy, jm);
    const offset = persianDow(fromISO(first));
    const days = [];
    for (let i = 1; i <= len; i++) days.push({ jd: i, iso: addDays(first, i - 1) });
    return { jy, jm, offset, days, title: U().JALALI_MONTHS[jm - 1] + ' ' + U().faDigits(jy) };
  }
  /* هفته‌ی شمسی (شنبه تا جمعه) که این روز در آن است */
  function weekOf(iso) {
    const start = addDays(iso, -persianDow(fromISO(iso)));
    return FA_WEEK.map((name, i) => { const d = addDays(start, i); return { iso: d, name, jd: jalaliParts(d).jd }; });
  }

  /* خروجی: { date|null, spans } */
  function extractDate(f, base) {
    const spans = [];
    const add = (m) => spans.push([m.index, m.index + m[0].length]);
    const lead = '(?<![\\u0600-\\u06FF])';
    let m;
    // «پس‌فردا» پیش از «فردا»
    if ((m = new RegExp(lead + 'پس\\s*فردا' + END).exec(f))) { add(m); return { date: addDays(base, 2), spans }; }
    if ((m = new RegExp(lead + 'فردا' + END).exec(f))) { add(m); return { date: addDays(base, 1), spans }; }
    if ((m = new RegExp(lead + '(?:امروز|امشب)' + END).exec(f))) { add(m); return { date: base, spans }; }
    // N روز دیگر / N هفته دیگر
    if ((m = new RegExp(lead + '(' + NUM + ')\\s*روز\\s*(?:دیگه|دیگر|بعد|آینده)' + END).exec(f)) && parseNum(m[1])) { add(m); return { date: addDays(base, parseNum(m[1])), spans }; }
    if ((m = new RegExp(lead + '(' + NUM + ')\\s*هفته\\s*(?:دیگه|دیگر|بعد|آینده)' + END).exec(f)) && parseNum(m[1])) { add(m); return { date: addDays(base, 7 * parseNum(m[1])), spans }; }
    // تاریخ کامل عددی شمسی 1405/08/25
    if ((m = /(?<!\d)(1[34]\d{2})[/-](\d{1,2})[/-](\d{1,2})(?!\d)/.exec(f))) {
      const iso = jalaliToISO(Number(m[1]), Number(m[2]), Number(m[3]));
      if (iso) { add(m); return { date: iso, spans }; }
    }
    // ۲۵ آبان | ۲۵ام آبان | ۲۵ آبان ۱۴۰۵
    const monthAlt = JMONTHS.join('|');
    if ((m = new RegExp('(?<!\\d)(\\d{1,2})\\s*(?:ام|م)?\\s*(' + monthAlt + ')' + END + '(?:\\s+(1[34]\\d{2}))?').exec(f))) {
      const jd = Number(m[1]), jm = JMONTHS.indexOf(m[2]) + 1;
      if (jd >= 1 && jd <= 31) {
        const bj = U().toJalali(fromISO(base));
        let jy = m[3] ? Number(m[3]) : bj.jy;
        let iso = jalaliToISO(jy, jm, jd);
        if (iso && !m[3] && iso < base) iso = jalaliToISO(jy + 1, jm, jd);
        if (iso) { add(m); return { date: iso, spans }; }
      }
    }
    // روز هفته (+ «هفته‌ی بعد» / «این»)
    let nextWeek = false, thisWeek = false, extra = null;
    if ((extra = new RegExp(lead + 'هفته\\s*(?:ی|ء)?\\s*(?:بعد|آینده|دیگه|دیگر)' + END).exec(f))) nextWeek = true;
    for (const [name, wd] of WEEKDAYS) {
      const re = new RegExp(lead + '(?:(این)\\s+)?' + name.replace(/ /g, '\\s*') + END);
      if ((m = re.exec(f))) {
        thisWeek = !!m[1];
        add(m); if (extra) add(extra);
        return { date: weekdayDate(wd, base, thisWeek, nextWeek), spans };
      }
    }
    if (extra) { add(extra); return { date: addDays(base, 7), spans }; }
    return { date: null, spans };
  }

  /* ---------- تکه‌تکه کردن متن به کار ---------- */
  const STOP = new Set(['و', 'در', 'به', 'برای', 'هم', 'را', 'که', 'این', 'آن', 'با', 'از', 'تا', 'ولی', 'اما', 'پس', 'بعد', 'بعدش', 'سپس']);
  const MARKER = '(?:ساعت|فردا|امروز|امشب|پس\\s*فردا|صبح|ظهر|عصر|شنبه|یک\\s*شنبه|دو\\s*شنبه|سه\\s*شنبه|چهار\\s*شنبه|پنج\\s*شنبه|جمعه)';

  function splitPieces(text) {
    const src = String(text == null ? '' : text);
    const rough = src.split(/[\n\r.؛;!؟?،,]+/);
    const out = [];
    rough.forEach((seg) => {
      const f = fold(seg);
      const cuts = [];
      // «بعد / سپس / بعدش …» و «و» قبل از نشانه‌ی ساعت/روز، آغاز کارِ تازه است
      const re = new RegExp('(?<![\\u0600-\\u06FF])(?:(?<!(?:هفته|روز|ماه)(?:\\s+ی)?\\s+)(?:بعدش|بعدا|بعداً|سپس|همچنین|ضمنا|ضمناً|بعد)\\s+|و\\s+(?=' + MARKER + END + '))', 'g');
      let m;
      while ((m = re.exec(f))) { if (m.index > 0) cuts.push([m.index, m.index + m[0].length]); }
      let last = 0;
      cuts.forEach(([a, b]) => { out.push(seg.slice(last, a)); last = b; });
      out.push(seg.slice(last));
    });
    return out.map((s) => s.trim()).filter(Boolean);
  }

  const FILLER_RE = /^(?:(?:و|بعد|بعدش|سپس|هم|حتما|حتماً|لطفا|لطفاً|یادم باشه|یادم نره|یادآوری|باید|فقط|دیگه|ضمنا|ضمناً)\s+)+/;

  function cutSpans(text, spans) {
    if (!spans.length) return text;
    const merged = spans.slice().sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    merged.forEach(([a, b]) => { if (a >= pos) { out += text.slice(pos, a) + ' '; pos = b; } else if (b > pos) pos = b; });
    return out + text.slice(pos);
  }
  function cleanTitle(s) {
    let t = String(s || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[\s،,.:;\-–—]+|[\s،,.:;\-–—]+$/g, '');
    for (let i = 0; i < 3; i++) t = t.replace(FILLER_RE, '').trim();
    t = t.replace(/\s+(?:و|در|به|برای)$/, '').trim();
    return t.slice(0, MAX_TITLE);
  }
  const fallbackTitle = (time) => (time ? 'کار ساعت ' + U().faText(time) : 'بدون عنوان');
  const hasContent = (title) => title.split(/\s+/).filter((w) => w && !STOP.has(w)).length >= 1;

  /* ---------- پیدا کردن مشتری از روی نام ---------- */
  const HONORIFICS = new Set(['آقای', 'آقا', 'خانم', 'دکتر', 'مهندس', 'حاج', 'حاجی', 'حاجیه', 'استاد', 'جناب', 'سرکار', 'سید', 'میرزا']);
  const words = (s) => fold(s).toLowerCase().split(/[^a-z0-9\u0600-\u06FF]+/).filter(Boolean);

  function matchClient(piece, clients) {
    const pw = words(piece);
    if (!pw.length || !clients || !clients.length) return null;
    const pset = new Set(pw);
    const joined = ' ' + pw.join(' ') + ' ';
    let best = [], bestScore = 0;
    clients.forEach((c) => {
      if (!c || c.stage === 'won' || c.stage === 'lost') return;
      const tokens = words(c.name || '').filter((t) => !HONORIFICS.has(t) && t.length >= 2);
      if (!tokens.length) return;
      let score = 0;
      if (tokens.length >= 2 && joined.includes(' ' + tokens.join(' ') + ' ')) score = 3;
      else if (tokens.length >= 2 && tokens[tokens.length - 1].length >= 3 && pset.has(tokens[tokens.length - 1])) score = 2;
      else if (tokens.some((t) => t.length >= 3 && pset.has(t))) score = 1;
      else if (tokens.length === 1 && tokens[0].length >= 3 && pset.has(tokens[0])) score = 1;
      if (score > bestScore) { bestScore = score; best = [c]; } else if (score === bestScore && score > 0) best.push(c);
    });
    return best.length === 1 ? best[0] : null;
  }

  /* ---------- تحلیل کامل ----------
     parse(text, { today, defaultDate, clients }) → [{ title, date, time, clientId, clientName, dateInherited }]
     • «فردا/پس‌فردا/…» همیشه نسبت به امروزِ واقعی (today) حساب می‌شود
     • کاری که تاریخ نگفته: defaultDate (روزی که کاربر روی آن است؛ پیش‌فرض امروز)
     • تاریخِ گفته‌شده برای کارهای بعدی همان جمله هم می‌ماند (تا تاریخ تازه‌ای بیاید)
     • محدودیتی روی متن نیست: هر متنی کار می‌شود؛ بدون عنوان (مثلاً فقط «فردا ساعت ۲») عنوان پیش‌فرض می‌گیرد */
  function parse(text, opts) {
    const o = opts || {};
    const base = isValidISO(o.today) ? o.today : todayISO();
    const dflt = isValidISO(o.defaultDate) ? o.defaultDate : base;
    const pieces = splitPieces(text);
    const items = [];
    let carry = null;
    let pending = '';
    pieces.forEach((raw) => {
      const piece = pending ? pending + ' ' + raw : raw;
      const f = fold(piece);
      const dt = extractDate(f, base);
      const tm = extractTime(f);
      const spans = dt.spans.concat(tm.spans);
      const title = cleanTitle(cutSpans(piece, spans).replace(new RegExp('(?<![\\u0600-\\u06FF])ساعت' + END, 'g'), ' '));
      if (!hasContent(title)) { pending = piece; return; }   // فقط «فردا ساعت ۱۰» بود؛ به کار بعدی بچسب
      pending = '';
      let date = dt.date, inherited = false;
      if (date) carry = date; else if (carry) { date = carry; inherited = true; } else date = dflt;
      const cl = matchClient(title, o.clients || []);
      items.push({ title, date, time: tm.time, clientId: cl ? cl.id : null, clientName: cl ? cl.name : '', dateInherited: inherited });
    });
    if (pending) {   // تکه‌ی آخرِ بدون عنوان (مثلاً فقط «فردا ساعت ۲»): با عنوان پیش‌فرض ثبت می‌شود
      const f = fold(pending), dt = extractDate(f, base), tm = extractTime(f);
      const left = cleanTitle(cutSpans(pending, dt.spans.concat(tm.spans)));
      const title = left && left.split(/\s+/).some((w) => !STOP.has(w)) ? left : fallbackTitle(tm.time);
      items.push({ title, date: dt.date || carry || dflt, time: tm.time, clientId: null, clientName: '', dateInherited: !dt.date });
    }
    if (!items.length && String(text == null ? '' : text).trim()) {   // هر متنی کار است
      items.push({ title: String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE), date: dflt, time: null, clientId: null, clientName: '', dateInherited: false });
    }
    return sortTasks(items).slice(0, MAX_TASKS);
  }

  /* ---------- مرتب‌سازی و نمایش ---------- */
  function sortTasks(list) {
    return (list || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
      || (Number(a.id) || 0) - (Number(b.id) || 0));
  }

  /* نمای یک روز: کارهای همان روز (انجام‌نشده اول)، و برای «امروز» کارهای عقب‌افتاده‌ی انجام‌نشده */
  function dayView(tasks, dayISO, today) {
    const t = today || todayISO();
    const all = tasks || [];
    const items = sortTasks(all.filter((x) => x.date === dayISO));
    items.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    const overdue = dayISO === t ? sortTasks(all.filter((x) => !x.done && x.date < t)) : [];
    const done = items.filter((x) => x.done).length;
    return { items, overdue, total: items.length, done, pct: items.length ? Math.round(done / items.length * 100) : 0 };
  }

  /* شمارنده‌ی صفحه‌ی «امروز»: کارهای باز امروز + عقب‌افتاده */
  function dueCount(tasks, today) {
    const t = today || todayISO();
    const open = (tasks || []).filter((x) => !x.done && x.date === t).length;
    const overdue = (tasks || []).filter((x) => !x.done && x.date < t).length;
    return { open, overdue, total: open + overdue };
  }

  function dayLabel(iso, today) {
    const t = today || todayISO();
    const diff = Math.round((fromISO(iso) - fromISO(t)) / 86400000);
    const full = U().faFullDate(fromISO(iso));
    if (diff === 0) return 'امروز';
    if (diff === 1) return 'فردا';
    if (diff === -1) return 'دیروز';
    return full;
  }
  const timeText = (hhmm) => (TIME_RE.test(String(hhmm || '')) ? U().faText(hhmm) : '');

  /* ---------- اعتبارسنجی یک کار ---------- */
  function validateTask(f) {
    f = f || {};
    /* هر متنی مجاز است؛ عنوان خالی «بدون عنوان» می‌شود و عنوان خیلی بلند کوتاه می‌شود */
    const title = String(f.title == null ? '' : f.title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || 'بدون عنوان';
    const date = String(f.date || '');
    if (!isValidISO(date)) throw bad('تاریخ کار معتبر نیست.');
    let time = f.time == null || f.time === '' ? null : String(f.time);
    if (time !== null && !TIME_RE.test(time)) throw bad('ساعت کار معتبر نیست.');
    const clientId = f.clientId === undefined || f.clientId === null || f.clientId === '' ? null : f.clientId;
    return { title, date, time, clientId, source: f.source === 'voice' ? 'voice' : 'text' };
  }
  function validateTasks(list) {
    if (!Array.isArray(list) || !list.length) throw bad('کاری برای ثبت نیست.');
    if (list.length > MAX_TASKS) throw bad('حداکثر ' + U().faDigits(MAX_TASKS) + ' کار را یک‌جا ثبت کن.');
    return list.map(validateTask);
  }

  /* ---------- هشدار (یادآوری) کارهای ساعت‌دار ---------- */
  const REMIND_OPTIONS = [0, 5, 15, 30, 60, 1440];   // دقیقه قبل از ساعت کار؛ ۰ = سر ساعت
  const MAX_OFFSETS = 3;
  const DEFAULT_OFFSETS = [15];
  function offsetLabel(n) {
    n = Number(n);
    if (n === 0) return 'سر ساعت';
    if (n === 1440) return U().faDigits(1) + ' روز قبل';
    if (n % 60 === 0) return U().faDigits(n / 60) + ' ساعت قبل';
    return U().faDigits(n) + ' دقیقه قبل';
  }
  /* تنظیم‌های هشدار را امن و کامل می‌کند: پیش‌فرض «روشن» و «۱۵ دقیقه قبل»؛ حداکثر ۳ زمان */
  function normalizeReminders(cfg) {
    const on = !cfg || cfg.on !== false;
    let offs = Array.isArray(cfg && cfg.offsets) ? cfg.offsets.map(Number).filter((n) => REMIND_OPTIONS.includes(n)) : [];
    offs = Array.from(new Set(offs)).sort((x, y) => y - x).slice(0, MAX_OFFSETS);
    if (!offs.length) offs = DEFAULT_OFFSETS.slice();
    // زمان آخرین همگام‌سازیِ هشدار محلی روی APK؛ تا ۳ روز بعدش سرور برای این کاربر Push نمی‌فرستد (جلوگیری از اعلان دوتایی)
    const na = cfg && typeof cfg.native_at === 'string' && !isNaN(Date.parse(cfg.native_at)) ? cfg.native_at : null;
    return { on, offsets: offs, nativeAt: na };
  }
  /* خلاصه‌ی کوتاه برای نوار هشدار */
  function remindSummary(cfg) {
    const c = normalizeReminders(cfg);
    return c.on ? c.offsets.map(offsetLabel).join('، ') : 'خاموش';
  }
  /* کاری هشدار می‌گیرد که ساعت دارد، انجام نشده، هشدار کلی و هشدار خودش روشن باشد */
  function taskReminds(t, cfg) {
    return !!(t && t.time && !t.done && t.remind !== false && normalizeReminders(cfg).on);
  }

  return {
    REMIND_OPTIONS, MAX_OFFSETS, DEFAULT_OFFSETS, offsetLabel, normalizeReminders, remindSummary, taskReminds,
    MAX_TITLE, MAX_TASKS, parse, splitPieces, extractDate, extractTime, matchClient, fold,
    sortTasks, dayView, dueCount, dayLabel, timeText, validateTask, validateTasks,
    addDays, todayISO, isValidISO, fromISO, toISO,
    jalaliParts, jalaliMonthLen, jalaliAddMonth, jalaliMonthGrid, weekOf
  };
})();
if (typeof globalThis !== 'undefined') globalThis.DailyPlanCore = DailyPlanCore;
if (typeof module !== 'undefined' && module.exports) module.exports = DailyPlanCore;

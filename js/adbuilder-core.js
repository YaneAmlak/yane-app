'use strict';
/* ============================================================
   ساخت آگهی دیوار — منطق خالص (بدون DOM/دیتابیس؛ قابل تست در Node)
   • متن آگهی یک «قالب» با متغیرهایی مثل {محله} است؛ نتیجه‌ی نهایی از روی مشخصات فایل پر می‌شود
   • نشانی دقیق و اسم/شماره‌ی مالک هرگز وارد آگهی نمی‌شود
   • ردیاب: کد رهگیری، شمارنده‌ی تماس
   ============================================================ */
const AdBuilderCore = (() => {
  const G = (n) => (typeof globalThis[n] !== 'undefined' ? globalThis[n] : require('./' + { Utils: 'utils', ClientsCore: 'clients-core', ListingsCore: 'listings-core' }[n] + '.js'));
  const U = () => G('Utils'), C = () => G('ClientsCore'), L = () => G('ListingsCore');

  const LIMITS = { title: 70, body: 1000 };
  const TYPE_WORD = { sale: 'فروش', mortgage: 'رهن و اجاره', rent: 'رهن و اجاره' };

  /* متغیرهای قابل درج */
  const VARIABLES = [
    { key: 'نوع_آگهی', label: 'نوع آگهی' }, { key: 'محله', label: 'محله' }, { key: 'متراژ', label: 'متراژ' },
    { key: 'طبقه', label: 'طبقه' }, { key: 'سن_بنا', label: 'سن بنا' }, { key: 'قیمت', label: 'قیمت' },
    { key: 'ویژگی‌ها', label: 'ویژگی‌ها' }, { key: 'نام_املاک', label: 'نام املاک' }, { key: 'شماره', label: 'شماره‌ی تماس' }, { key: 'کد', label: 'کد ملک' },
    { key: 'مشخصات', label: 'بلوک مشخصات' }, { key: 'امکانات', label: 'بلوک امکانات' }, { key: 'قیمت_شکلکی', label: 'قیمت با 💰' }, { key: 'هدف', label: 'هدف (خرید / رهن و اجاره)' }
  ];

  /* هر قالب چند متن مختلف دارد؛ زدن دوباره‌ی همان قالب، متن بعدی را می‌آورد */
  const T = (meta, variants) => Object.assign({}, meta, { variants, title: variants[0].title, text: variants[0].text });
  const TEMPLATES = {
    official: T({ label: 'رسمی', icon: '📋', color: '#0d9488', desc: 'کامل و معتبر' }, [
      { title: '{نوع_آگهی} ملک {متراژ} در {محله}',
        text: '🌟 فرصت {هدف} ملک {متراژ} در {محله}\n\nملکی با مشخصات کامل و روشن، مناسب کسانی که دنبال انتخابی مطمئن هستند.\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n📞 برای دریافت اطلاعات بیشتر تماس بگیرید.' },
      { title: '{نوع_آگهی} ملک {متراژ} در {محله}، {سن_بنا}',
        text: '🏢 معرفی ملک برای {هدف}\n{متراژ} در {محله}؛ {طبقه}، {سن_بنا}.\n\nمشخصات کامل ملک در ادامه آمده است 👇\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n☎️ منتظر تماس شما هستیم.' }]),
    friendly: T({ label: 'صمیمی', icon: '💬', color: '#d97706', desc: 'گرم و خودمونی' }, [
      { title: '{نوع_آگهی} ملک دلنشین {متراژ} در {محله}',
        text: 'سلام دوست عزیز 👋\nدنبال یه ملک خوب برای {هدف} توی {محله} می‌گردی؟ همین‌جاست 😍\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\nاگه به دلت نشست، یه پیام بده یا زنگ بزن؛ خوشحال می‌شیم راهنماییت کنیم 🤗' },
      { title: '{نوع_آگهی} ملک {متراژ} در {محله}؛ انتخابی دلچسب',
        text: '✌️ خبر خوب برای کسی که دنبال ملک تو {محله} هست!\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n💌 سوالی داشتی؟ راحت پیام بده، سریع جواب می‌دم.' }]),
    short: T({ label: 'کوتاه', icon: '📝', color: '#64748b', desc: 'خلاصه و سریع' }, [
      { title: '{نوع_آگهی} {متراژ}، {محله}',
        text: '🗺️ {محله}\n{متراژ}، {طبقه}، {سن_بنا}\n{ویژگی‌ها}\n{قیمت_شکلکی}\n📞 تماس بگیرید' },
      { title: '{محله}؛ {نوع_آگهی} {متراژ}',
        text: '🔖 {متراژ} در {محله}\n{طبقه}، {سن_بنا}\n{ویژگی‌ها}\n{قیمت_شکلکی}\n💬 پیام بدهید' }]),
    urgent: T({ label: 'فوری', icon: '🔥', color: '#e11d48', desc: 'فروش سریع' }, [
      { title: '{نوع_آگهی} فوری ملک {متراژ} در {محله}؛ قابل مذاکره',
        text: '🚨 {نوع_آگهی} فوری!\nفقط برای مشتری جدی که سریع تصمیم می‌گیرد.\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n🤝 قیمت قابل مذاکره\n\n🎯 فرصت‌هایی از این دست زود از دست می‌روند.\n⏰ فرصت محدود است؛ همین الان تماس بگیرید.' },
      { title: '{نوع_آگهی} فوری {متراژ} در {محله} | قیمت قابل مذاکره',
        text: '⚡ ملک {متراژ} در {محله}؛ فوری و آماده‌ی معامله\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n🤝 قابل مذاکره\n\n🏃 تا دیر نشده دست‌به‌کار شوید؛ تماس بگیرید.' }]),
    invest: T({ label: 'سرمایه‌گذاری', icon: '📈', color: '#4338ca', desc: 'برای خریدار حرفه‌ای' }, [
      { title: '{نوع_آگهی} ملک {متراژ} در {محله}؛ مناسب سرمایه‌گذاری',
        text: '📈 فرصت سرمایه‌گذاری در {محله}\n\nملک {متراژ}؛ انتخابی منطقی برای حفظ و رشد سرمایه.\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n🤝 امکان مذاکره برای خریدار جدی.\n📞 برای اطلاعات بیشتر تماس بگیرید.' },
      { title: '{محله}؛ {نوع_آگهی} ملک {متراژ}، فرصتی برای سرمایه‌گذاران',
        text: '💼 مخصوص سرمایه‌گذاران حرفه‌ای\nملک {متراژ} در {محله}؛ سرمایه‌ای که هم آرامش می‌دهد هم ارزش.\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n🏆 تصمیم هوشمندانه از همین‌جا شروع می‌شود؛ تماس بگیرید.' }]),
    luxury: T({ label: 'لوکس', icon: '💎', color: '#9333ea', desc: 'شیک و خاص' }, [
      { title: '{نوع_آگهی} ملک ویژه {متراژ} در {محله}',
        text: '✦ ━━━━ ✦ ━━━━ ✦\n💎 ملکی برای سلیقه‌های خاص\n✦ ━━━━ ✦ ━━━━ ✦\n\n{متراژ} در {محله}؛ جایی که کیفیت زندگی را از نو معنا می‌کند.\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n✦ ━━━━ ✦ ━━━━ ✦\n📞 برای اطلاعات بیشتر در تماس باشید' },
      { title: '{نوع_آگهی} ملک لوکس {متراژ}؛ {محله}',
        text: '👑 برای کسانی که کمتر از بهترین نمی‌خواهند\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n🥂 زندگی در سطحی دیگر؛ تماس بگیرید.' }]),
    family: T({ label: 'خانوادگی', icon: '🏡', color: '#16a34a', desc: 'آرامش و راحتی' }, [
      { title: '{نوع_آگهی} ملک {متراژ} مناسب خانواده در {محله}',
        text: '🏡 خانه‌ای برای آرامش و خاطره‌های خوب\n\nملک {متراژ} در {محله}؛ جایی برای زندگی راحت و لحظه‌های دلنشین خانواده 💞\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n👨‍👩‍👧‍👦 اگر دنبال خانه‌ی آرزوهایتان هستید، با ما در تماس باشید.' },
      { title: '{نوع_آگهی} ملک {متراژ} در {محله}؛ آرامش برای خانواده',
        text: '🧸 خانه‌ای که خانواده را کنار هم نگه می‌دارد\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n🌈 شروع یک زندگی تازه، همین‌جا؛ تماس بگیرید.' }]),
    trust: T({ label: 'اعتمادساز', icon: '🛡️', color: '#0891b2', desc: 'صادقانه و شفاف' }, [
      { title: '{نوع_آگهی} ملک {متراژ}، {محله} | معامله‌ی مطمئن',
        text: '🛡️ معامله‌ی مطمئن، با اطلاعات شفاف\n\nهمه‌ی مشخصات ملک {متراژ} در {محله} دقیق و روشن در اختیار شماست.\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n🤝 صادقانه و بی‌حاشیه؛ برای هر سوالی در خدمتیم.\n📞 با ما در تماس باشید.' },
      { title: '{نوع_آگهی} مطمئن ملک {متراژ} در {محله}',
        text: '🔐 خیال‌تان راحت؛ همه‌چیز شفاف است\nملک {متراژ} در {محله}\n\n{مشخصات}\n\n{امکانات}\n\n{قیمت_شکلکی}\n\n🙋 هر سوالی دارید بپرسید، دقیق و صادقانه پاسخ می‌دهیم.' }]),
    /* دو گزینه‌ی جدا (ردیف دوم): فقط از مشخصات فایل / کادر خالی */
    file: T({ label: 'خودکار از فایل', icon: '🪄', color: '#475569', desc: 'فقط مشخصات فایل', extra: true }, [
      { title: '{نوع_آگهی} ملک {متراژ}، {محله}', text: '{متراژ}، {محله}، {طبقه}، {سن_بنا}.\n{قیمت}' }]),
    empty: T({ label: 'خالی', icon: '✏️', color: '#475569', desc: 'خودت بنویس', extra: true }, [{ title: '', text: '' }])
  };

  const FEATURES = ['پارکینگ', 'انباری', 'آسانسور', 'بالکن', 'تراس', 'نوساز', 'تک‌واحدی', 'سند تک‌برگ', 'کابینت', 'کمد دیواری', 'آماده‌ی انتقال سند', 'قابل مذاکره'];
  const PHRASES = ['آماده‌ی بازدید', 'قابل مذاکره', 'سند تک‌برگ', 'آماده‌ی انتقال سند', 'نقد و اقساط', 'ملک مناسب سرمایه‌گذاری'];

  /* شکلک‌های کاربردی املاک — گروه‌بندی‌شده */
  const EMOJI_GROUPS = [
    { key: 'home', label: 'ملک', items: ['🏠', '🏡', '🏢', '🏘️', '🏬', '🔑', '🏷️', '📐', '🛋️', '🪟'] },
    { key: 'amen', label: 'امکانات', items: ['🅿️', '🚗', '📦', '🛗', '🔥', '❄️', '🚿', '🍳', '🌳', '☀️', '🔒', '🧱'] },
    { key: 'place', label: 'موقعیت', items: ['📍', '🚇', '🚌', '🛒', '🏫', '🏥', '🌇', '🕌', '🌊', '⛰️'] },
    { key: 'deal', label: 'قیمت و تماس', items: ['💰', '💵', '📞', '📲', '✅', '⭐', '🔥', '⚡', '📅', '🤝', '✔️', '🆕'] },
    { key: 'line', label: 'خط و تزئین', items: ['━━━━━━━━━━', '▫️▫️▫️▫️▫️', '✦ ✦ ✦', '〰️〰️〰️', '•••', '➖➖➖➖'] }
  ];

  const BULLETS = { none: { label: 'بدون', mark: '' }, auto: { label: 'هر مورد شکلک خودش', mark: '✨' }, tick: { label: 'تیک', mark: '✅' }, dot: { label: 'نقطه', mark: '▪️' }, arrow: { label: 'فلش', mark: '➤' }, star: { label: 'ستاره', mark: '⭐' } };
  /* هر قالب شکلک‌های مخصوص خودش را دارد تا آگهی‌ها شبیه هم نشوند */
  const STYLES = {
    official: { spec: '📋 مشخصات ملک', area: '📍 محله', size: '📐 متراژ', floor: '🏢', age: '🗓️ سن بنا', amen: '✅ امکانات', set: 'A', price: '💰' },
    friendly: { spec: '🏠 درباره‌ی ملک', area: '🌆 محله', size: '📏 متراژ', floor: '🪜', age: '⏳ سن بنا', amen: '🎁 امکانات', set: 'B', price: '🏷️' },
    short: { spec: '📌 مشخصات', area: '🗺️ محله', size: '🔳 متراژ', floor: '🏗️', age: '📅 سن بنا', amen: '▫️ امکانات', mark: '▫️', price: '💵' },
    urgent: { spec: '⚡ مشخصات', area: '🚩 محله', size: '🔲 متراژ', floor: '⬆️', age: '🕒 سن بنا', amen: '🔥 امکانات', mark: '🔸', price: '💥' },
    invest: { spec: '📊 مشخصات', area: '🧭 موقعیت', size: '🔢 متراژ', floor: '🏙️', age: '📆 سن بنا', amen: '💎 امکانات', mark: '🔹', price: '💹' },
    luxury: { spec: '◆ مشخصات', area: '✦ محله', size: '✦ متراژ', floor: '✦', age: '✦ سن بنا', amen: '◆ امکانات', mark: '❖', price: '💎' },
    family: { spec: '🏡 ویژگی‌های خانه', area: '🌳 محله', size: '🛋️ فضا', floor: '🪟', age: '🧸 سن بنا', amen: '🌼 امکانات', mark: '🌷', price: '🧡' },
    trust: { spec: '🔎 مشخصات دقیق', area: '📌 محله', size: '🧮 متراژ', floor: '🏬', age: '🧾 سن بنا', amen: '🔒 امکانات', mark: '☑️', price: '💳' }
  };
  const styleOf = (k) => STYLES[k] || STYLES.official;
  /* شکلک ویژگی‌ها: دو مجموعه‌ی متفاوت؛ بعضی قالب‌ها هم یک نشان ثابت دارند */
  const FEATURE_ICON_SETS = {
    A: { 'پارکینگ': '🅿️', 'انباری': '📦', 'آسانسور': '🛗', 'بالکن': '🌇', 'تراس': '🌿', 'نوساز': '🆕', 'تک‌واحدی': '🏠', 'سند تک‌برگ': '📜', 'کابینت': '🍳', 'کمد دیواری': '🚪', 'آماده‌ی انتقال سند': '✍️', 'قابل مذاکره': '🤝' },
    B: { 'پارکینگ': '🚘', 'انباری': '🧰', 'آسانسور': '🔼', 'بالکن': '🌅', 'تراس': '🪴', 'نوساز': '🌟', 'تک‌واحدی': '🔑', 'سند تک‌برگ': '📑', 'کابینت': '🍽️', 'کمد دیواری': '🧥', 'آماده‌ی انتقال سند': '🖊️', 'قابل مذاکره': '💬' }
  };
  const FEATURE_ICONS = FEATURE_ICON_SETS.A;
  function featLine(f, bullet, styleKey) {
    if (bullet === 'auto') {
      const st = styleOf(styleKey);
      return (st.set ? (FEATURE_ICON_SETS[st.set][f] || '✔️') : (st.mark || '✔️')) + ' ' + f;
    }
    const m = bullet && bullet !== 'none' && BULLETS[bullet] ? BULLETS[bullet].mark : '';
    return (m || '▪️') + ' ' + f;
  }
  const FRAMES = { none: { label: 'بدون قاب', line: '' }, lines: { label: 'خط', line: '━━━━━━━━━━' }, stars: { label: 'تزئینی', line: '✦ ✦ ✦' } };

  /* ---------- کد رهگیری ---------- */
  const makeCode = (l) => 'Y-' + String(l.id);
  /* کد دستی: فقط حرف/عدد/خط‌تیره، بدون فاصله، حداکثر ۲۴ نویسه */
  const cleanCode = (s) => String(s == null ? '' : s).replace(/[\s\u200c]+/g, '').replace(/[^A-Za-z0-9\-_\u0600-\u06FF]/g, '').slice(0, 24);
  /* کدی که در آگهی می‌آید: دستی (اگر ساخته شده) وگرنه خودکار */
  const codeOf = (l, d) => cleanCode(d && d.codeText) || makeCode(l);
  function parseCode(q) {
    const m = /^\s*y[-\s]?(\d{1,12})\s*$/i.exec(U().toLatinDigits(String(q || '')));
    return m ? m[1] : null;
  }

  /* ---------- ارزش متغیرها از روی فایل ---------- */
  function priceLine(l) {
    const f = C().fmtShort;
    if (l.type === 'sale') return l.price != null ? 'قیمت: ' + f(l.price) + ' تومان' : '';
    const p = [];
    if (l.deposit != null) p.push('رهن: ' + f(l.deposit) + ' تومان');
    if (l.rentMonthly != null) p.push('اجاره‌ی ماهانه: ' + f(l.rentMonthly) + ' تومان');
    return p.join('، ');
  }
  function values(l, ctx) {
    const fa = U().faDigits;
    const feats = (ctx.features || []).slice();
    const floorTxt = l.floor != null ? (L().floorText ? L().floorText(l.floor) : 'طبقه ' + fa(l.floor)) : '';
    const st = styleOf(ctx.style);
    const specLines = [];
    if (l.area) specLines.push(st.area + ': ' + l.area);
    if (l.size != null) specLines.push(st.size + ': ' + fa(l.size) + ' متر');
    if (floorTxt) specLines.push(st.floor + ' ' + floorTxt);
    if (l.age != null) specLines.push(st.age + ': ' + (Number(l.age) === 0 ? 'نوساز' : fa(l.age) + ' ساله'));
    const pl = priceLine(l);
    return {
      'نوع_آگهی': TYPE_WORD[l.type] || '',
      'محله': l.area || '',
      'متراژ': l.size != null ? fa(l.size) + ' متر' : '',
      'طبقه': l.floor != null ? (L().floorText ? L().floorText(l.floor) : 'طبقه ' + fa(l.floor)) : '',
      'سن_بنا': l.age != null ? (Number(l.age) === 0 ? 'نوساز' : fa(l.age) + ' ساله') : '',
      'قیمت': priceLine(l),
      'ویژگی‌ها': (ctx.bullet && ctx.bullet !== 'none') ? feats.map((f) => featLine(f, ctx.bullet, ctx.style)).join('\n') : feats.join('، '),
      'نام_املاک': (ctx.sig && ctx.sig.agency) || '',
      'شماره': (ctx.sig && ctx.sig.phone) || '',
      'کد': ctx.code || makeCode(l),
      'مشخصات': specLines.length ? st.spec + '\n' + specLines.join('\n') : '',
      'امکانات': feats.length ? st.amen + '\n' + feats.map((f) => featLine(f, ctx.bullet, ctx.style)).join('\n') : '',
      'هدف': { sale: 'خرید', mortgage: 'رهن و اجاره', rent: 'رهن و اجاره' }[l.type] || '',
      'قیمت_شکلکی': pl ? st.price + ' ' + pl : ''
    };
  }

  /* متغیرها را جایگزین می‌کند؛ خطی که فقط متغیرِ خالی داشته حذف می‌شود و جاهای خالی مرتب می‌شود */
  function fill(tpl, vals) {
    const hasVar = (t) => /\{[^{}\n]{1,30}\}/.test(t);
    const lines = String(tpl || '').split('\n').map((ln) => {
      const out = ln.replace(/\{([^{}\n]{1,30})\}/g, (m, k) => (k in vals ? vals[k] : m));
      return hasVar(ln) && !out.trim() ? null : out;
    }).filter((x) => x !== null);
    return lines.join('\n')
      .replace(/[ \t]+،/g, '،').replace(/،(\s*،)+/g, '،').replace(/،\s*\./g, '.').replace(/،[ \t]*(?=\n|$)/g, '')
      .replace(/(^|\n)[ \t]*[،.][ \t]*/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }


  /* ---------- قالب → متن آماده ----------
     با انتخاب قالب، متن همان لحظه با اطلاعات فایل پر می‌شود و کاربر متن واقعی را می‌بیند و ویرایش می‌کند
     (دیگر {متغیر} داخل کادر نمی‌ماند). inline = ویژگی‌ها داخل خود متن آمده‌اند و ته آگهی دوباره اضافه نمی‌شوند. */
  const INLINE_RE = /\{(امکانات|ویژگی‌ها)\}/;
  const VAR_RE = () => new RegExp('\\{(' + VARIABLES.map((v) => v.key).join('|') + ')\\}');
  function ctxOf(l, d, sig, style) { return { features: d.features || [], bullet: d.bullet || 'none', sig: sig || null, code: codeOf(l, d), style: style || (TEMPLATES[d.tpl] ? d.tpl : 'official') }; }
  function applyTemplate(l, d, key, opts) {
    const o = opts || {};
    let base = null, idx = 0;
    if (key === 'mine') base = o.mine;
    else if (TEMPLATES[key]) {
      const n = TEMPLATES[key].variants.length;
      idx = Math.max(0, Math.min(n - 1, Number(o.variant != null ? o.variant : d.tv) || 0));
      base = TEMPLATES[key].variants[idx];
    }
    if (!base) return d;
    const vals = values(l, ctxOf(l, d, o.sig, TEMPLATES[key] ? key : 'official'));
    d.title = fill(base.title, vals);
    d.text = fill(base.text, vals);
    d.tpl = key; d.tv = idx;
    d.inline = INLINE_RE.test(base.text);
    return d;
  }
  /* یک‌بار: پیش‌نویس‌های قبلی که «تیک» داشتند، به «هر مورد شکلک خودش» می‌روند */
  function upgradeDraft(d) {
    if (!d.v2) { d.v2 = 1; if (d.bullet === 'tick') d.bullet = 'auto'; }
    if (!d.v4) { d.v4 = 1; d.bullet = 'auto'; d.frame = 'none'; } /* «جلوه‌های ویژه» از رابط برداشته شد */
    if (!d.v3) { d.v3 = 1; d.code = false; } /* کد ملک ته آگهی دیگر پیش‌فرض نیست؛ از تب «ردیابی» روشن می‌شود */
    return d;
  }
  /* پیش‌نویس‌های قدیمی که هنوز {متغیر} دارند: یک بار با مقدار واقعی پر می‌شوند */
  function migrateDraft(l, d, sig) {
    const re = VAR_RE();
    if (!re.test(String(d.title || '') + '\n' + String(d.text || ''))) return d;
    const vals = values(l, ctxOf(l, d, sig));
    if (INLINE_RE.test(String(d.text || ''))) d.inline = true;
    d.title = fill(d.title, vals);
    d.text = fill(d.text, vals);
    return d;
  }


  /* ---------- صفحه‌ی انتخاب فایل: خلاصه و جستجو ---------- */
  function pickSummary(state, listings, today) {
    const o = { waiting: 0, posted: 0 };
    (listings || []).forEach((l) => { if (isPosted(state, l.id)) o.posted++; else o.waiting++; });
    return o;
  }
  const normQ = (x) => String(x == null ? '' : x).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
  function matchQuery(l, d, q) {
    const words = normQ(q).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = normQ([l.area, codeOf(l, d || {}), L().specText(l), L().priceText(l), (L().TYPES[l.type] || {}).label].join(' '));
    return words.every((w) => hay.includes(w));
  }

  /* ---------- ساخت آگهی نهایی ---------- */
  function build(l, d) {
    d = d || {};
    const ctx = { features: d.features || [], bullet: d.bullet || 'none', sig: d.sig && d.sig.on ? d.sig : null, code: codeOf(l, d), style: TEMPLATES[d.tpl] ? d.tpl : 'official' };
    const vals = values(l, ctx);
    const title = fill(d.title != null ? d.title : TEMPLATES.official.title, vals);
    let main = fill(d.text != null ? d.text : TEMPLATES.official.text, vals);
    const parts = [main];
    const withMarks = ctx.bullet !== 'none' && !!BULLETS[ctx.bullet];
    const tplText = d.text != null ? d.text : TEMPLATES.official.text;
    if (withMarks && ctx.features.length && !d.inline && !tplText.includes('{ویژگی‌ها}') && !tplText.includes('{امکانات}')) parts.push(ctx.features.map((f) => featLine(f, ctx.bullet, ctx.style)).join('\n'));
    (d.phrases || []).forEach((p) => { if (String(p).trim()) parts.push(String(p).trim()); });
    let body = parts.filter(Boolean).join('\n');
    const line = (FRAMES[d.frame] || FRAMES.none).line;
    if (line) body = line + '\n' + body + '\n' + line;
    const tail = [];
    if (ctx.sig) {
      const sg = [ctx.sig.agency, ctx.sig.phone].filter(Boolean).join(' · ');
      if (sg) tail.push(sg);
    }
    if (d.code) tail.push('کد ملک: ' + codeOf(l, d));
    if (tail.length) body += '\n\n' + tail.join('\n');
    body = body.trim();
    return {
      title, body, full: title + '\n\n' + body,
      titleLen: title.length, bodyLen: body.length,
      titleOver: title.length > LIMITS.title, bodyOver: body.length > LIMITS.body
    };
  }

  /* فیلدهای جداگانه برای کپی تکی (دیوار این‌ها را جدا می‌گیرد) — ارقام لاتین */
  function fields(l, built) {
    const out = [{ key: 'title', label: 'عنوان', value: built.title }, { key: 'body', label: 'متن آگهی', value: built.body }];
    const raw = (n) => (n != null && n !== '' ? String(Math.round(Number(n))) : '');
    if (l.type === 'sale') out.push({ key: 'price', label: 'قیمت (تومان)', value: raw(l.price) });
    else {
      out.push({ key: 'deposit', label: 'رهن (تومان)', value: raw(l.deposit) });
      if (l.type === 'rent') out.push({ key: 'rent', label: 'اجاره‌ی ماهانه (تومان)', value: raw(l.rentMonthly) });
    }
    out.push({ key: 'size', label: 'متراژ', value: raw(l.size) }, { key: 'floor', label: 'طبقه', value: raw(l.floor) }, { key: 'age', label: 'سن بنا (سال)', value: raw(l.age) });
    return out.filter((f) => f.value !== '');
  }

  /* ---------- ردیاب ---------- */
  const defaultState = () => ({ v: 1, myTitle: '', myText: '', phrases: [], ads: {}, freeAds: [], freeSeq: 0 });

  /* ---------- آگهی بدون فایل: یک «فایل مجازی» که فقط داخل ساخت آگهی نگه داشته می‌شود ---------- */
  const numOrNull = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : null; };
  function normalizeFree(x) {
    if (!x || typeof x !== 'object' || !/^F\d{1,9}$/.test(String(x.id))) return null;
    if (!TYPE_WORD[x.type]) return null;
    return {
      id: String(x.id), type: x.type === 'mortgage' ? 'rent' : x.type, area: String(x.area || '').trim().slice(0, 60), isFree: true, status: 'active',
      size: numOrNull(x.size, 1, 100000), floor: numOrNull(x.floor, -5, 200), age: numOrNull(x.age, 0, 200),
      price: numOrNull(x.price, 0, 1e13), deposit: numOrNull(x.deposit, 0, 1e13), rentMonthly: numOrNull(x.rentMonthly, 0, 1e13),
      createdAt: typeof x.createdAt === 'string' ? x.createdAt.slice(0, 30) : ''
    };
  }
  /* ورودی فرم (مبلغ‌ها به تومان) → آگهی بدون فایل؛ خطا با throw userFacing */
  function addFree(state, f) {
    const bad = (m) => Object.assign(new Error(m), { userFacing: true });
    const item = normalizeFree(Object.assign({}, f, { id: f && f.id ? f.id : 'F' + (Number(state.freeSeq || 0) + 1) }));
    if (!item) throw bad('نوع آگهی را انتخاب کن.');
    if (!item.area) throw bad('محله یا عنوان ملک را بنویس.');
    if (!(f && f.id)) { state.freeSeq = Number(state.freeSeq || 0) + 1; item.createdAt = new Date().toISOString(); state.freeAds.push(item); }
    else { const i = state.freeAds.findIndex((x) => x.id === item.id); if (i < 0) throw bad('آگهی پیدا نشد.'); item.createdAt = state.freeAds[i].createdAt; state.freeAds[i] = item; }
    return item;
  }
  function removeFree(state, id) {
    state.freeAds = state.freeAds.filter((x) => x.id !== String(id));
    delete state.ads[String(id)];
  }
  const allListings = (state, listings) => (listings || []).concat((state && state.freeAds) || []);
  function normalizeState(s) {
    const d = defaultState();
    if (!s || typeof s !== 'object') return d;
    d.myTitle = typeof s.myTitle === 'string' ? s.myTitle.slice(0, 200) : '';
    d.myText = typeof s.myText === 'string' ? s.myText.slice(0, 3000) : '';
    d.phrases = Array.isArray(s.phrases) ? s.phrases.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim().slice(0, 120)).slice(0, 30) : [];
    d.ads = s.ads && typeof s.ads === 'object' ? s.ads : {};
    d.freeAds = Array.isArray(s.freeAds) ? s.freeAds.map(normalizeFree).filter(Boolean).slice(0, 200) : [];
    const sq = Number(s.freeSeq); d.freeSeq = sq >= 0 && sq < 1e9 ? Math.floor(sq) : 0;
    d.freeAds.forEach((x) => { const n = Number(x.id.slice(1)); if (n > d.freeSeq) d.freeSeq = n; });
    return d;
  }
  const adOf = (state, id) => state.ads[String(id)] || null;
  function ensureAd(state, id) {
    const k = String(id);
    if (!state.ads[k]) state.ads[k] = { postedAt: null, calls: 0, draft: null };
    return state.ads[k];
  }
  /* آگهی شده؟ (تاریخ انتشار ثبت شده باشد) */
  const isPosted = (state, id) => { const a = adOf(state, id); return !!(a && a.postedAt); };

  return { LIMITS, VARIABLES, TEMPLATES, FEATURES, PHRASES, EMOJI_GROUPS, BULLETS, FRAMES, TYPE_WORD,
    makeCode, cleanCode, codeOf, parseCode, values, fill, applyTemplate, migrateDraft, upgradeDraft, pickSummary, matchQuery, FEATURE_ICONS, FEATURE_ICON_SETS, STYLES, featLine, build, fields, defaultState, normalizeState, adOf, ensureAd, isPosted,
    normalizeFree, addFree, removeFree, allListings };
})();
if (typeof globalThis !== 'undefined') globalThis.AdBuilderCore = AdBuilderCore;
if (typeof module !== 'undefined' && module.exports) module.exports = AdBuilderCore;

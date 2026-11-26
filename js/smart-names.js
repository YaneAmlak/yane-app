'use strict';
/* ============================================================
   موتور فهم نام محصولات (SmartNames) — نسخهٔ دقیق (v2)
   ------------------------------------------------------------
   لایهٔ مستقل و افزایشی برای تکمیل نتایج جست‌وجو:
   - بدون API پولی/اینترنت؛ فقط یک فرهنگ لغت داخلی + تطبیق تقریبی.
   - هیچ محصولی نمی‌سازد/حدس نمی‌زند: فقط از میان محصولات واقعیِ انبار پیشنهاد می‌دهد.
   - هرگز چیزی را خودکار انتخاب یا به سفارش اضافه نمی‌کند.
   - جست‌وجوی فعلی (Searcher) و نام‌های مستعار را تغییر نمی‌دهد.

   انواع گروه‌ها:
   - brand : نام برند / سری محصول (غلط‌های املایی را هم می‌پذیرد)
   - use   : کاربرد واقعی محصول (آبرسان، ضدجوش، ضدلک، لایه‌بردار، …)
   - form  : نوع محصول (سرم، ژل، شامپو، …)
   - feat  : ویژگی اختصاصی (موی رنگ‌شده، کودک، آقایان، …) — اگر در پرسش باشد، الزامی است؛
             اگر فقط در محصول باشد، محصول فقط به‌عنوان «مرتبط» (سطح ۲) می‌آید.
   - dom   : حوزهٔ محصول (مو، دهان) — محصول مو/دهان با پرسش پوست قاطی نمی‌شود.
   - skin  : نوع پوست/ویژگی (چرب، خشک، حساس، مستعد جوش، …) — اعضای یک «خانواده» با هم
             ناسازگارند: «پوست خشک» برای جست‌وجوی «چرب» هرگز نمی‌آید؛ ذکرنشدن = سطح ۲.

   سطح ۱ = همه‌چیز تطبیق دارد. سطح ۲ = مرتبط ولی غیرمستقیم (نوع پوست ذکر نشده، ویژگی اضافه،
   یا کاربرد مجاور). محصول نامرتبط/ناسازگار اصلاً برنمی‌گردد.
   ============================================================ */

const SmartNames = (() => {
  /* ---------- نرمال‌سازی (هم‌راستا با Searcher، بدون وابستگی به آن) ---------- */
  function baseNorm(s) {
    if (typeof Utils !== 'undefined' && Utils.norm) return Utils.norm(s);
    return String(s || '').toLowerCase().replace(/[يىئ]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
  }
  function normText(s) {
    return baseNorm(s).replace(/[\u200c\u200d\u200e\u200f\u00ad\u2010-\u2015_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function compact(s) { return normText(s).replace(/ /g, ''); }

  /* اسکلت آوایی: برای غلط‌های تایپی/املایی رایج و حذف مصوت‌های نوشتاری (ا ی و) به‌جز حرف اول */
  const PHON = { 'ث': 'س', 'ص': 'س', 'ذ': 'ز', 'ض': 'ز', 'ظ': 'ز', 'ط': 'ت', 'ح': 'ه', 'غ': 'ق', 'ع': 'ا', 'ئ': 'ی' };
  function skeleton(s) {
    const t = compact(s);
    if (!t) return '';
    let out = '';
    for (let i = 0; i < t.length; i++) {
      let ch = PHON[t[i]] || t[i];
      if (i > 0 && (ch === 'ا' || ch === 'ی' || ch === 'و')) continue;
      if (out.length && out[out.length - 1] === ch) continue; // حروف تکراری
      out += ch;
    }
    return out;
  }

  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* پسوندهای نوشتاری فارسی (های/ها/ی): «موهای»→«مو»، «شستشوی»→«شستشو» */
  function stripSuffix(t) {
    if (t.length > 4 && t.endsWith('های')) return t.slice(0, -3);
    if (t.length > 3 && t.endsWith('ها')) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('ی')) return t.slice(0, -1);
    return t;
  }
  function tokVariants(t) {
    const s = stripSuffix(t);
    return s === t ? [t] : [t, s];
  }

  /* ---------- فرهنگ لغت ---------- */
  // هر گروه: { id, type, label, phrases, dom?, fam?, strict? }
  //  - عبارت با «*» در پایان: تطبیق پیشوندی روی کلمه (مثلاً spf* برای SPF50)
  //  - strict: فقط کلمهٔ کامل (نه بخشی از کلمهٔ دیگر)
  const GROUPS = [
    // ---- کاربردها ----
    { id: 'u-hydrate', type: 'use', label: 'آبرسان / مرطوب‌کننده', phrases: ['آبرسان', 'آب رسان', 'آبرسانی', 'مرطوب کننده', 'مرطوب کننده پوست', 'مرطوبکننده', 'رطوبت رسان', 'رطوبت‌رسان', 'هیدراتانت', 'هیدراتان', 'هیدرا', 'هیدراتینگ', 'hydrating', 'hydrate', 'moisturizer', 'moisturising', 'moisturizing', 'moisturiser'] },
    // «جوش» کلی: هم درمان جوش و هم مراقبت پوست مستعد جوش را در بر می‌گیرد (از طریق IMPLIES)
    { id: 'u-acne', type: 'use', label: 'جوش / آکنه', dom: 'skin', phrases: ['آکنه', 'اکنه', 'جوش', 'acne'] },
    // درمان جوش (ژل/کرم/لوسیون ضدجوش)
    { id: 'u-acne-treat', type: 'use', label: 'ضد جوش (درمان)', dom: 'skin', phrases: ['ضد جوش', 'ضدجوش', 'ضد آکنه', 'ضدآکنه', 'ضد اکنه', 'درمان جوش', 'درمان آکنه', 'درمان اکنه', 'درمانی جوش', 'جوش گیر', 'جوشگیر', 'لکه جوش', 'anti acne', 'anti-acne', 'acne treatment', 'spot treatment'] },
    { id: 'u-redness', type: 'use', label: 'ضد قرمزی', dom: 'skin', phrases: ['ضد قرمزی', 'ضدقرمزی', 'قرمزی', 'کاهش قرمزی', 'رزاسه', 'anti redness', 'redness'] },
    { id: 'u-spot', type: 'use', label: 'ضد لک / روشن‌کننده', dom: 'skin', strict: true, phrases: ['ضد لک', 'ضدلک', 'لک', 'روشن کننده', 'روشنکننده', 'روشن کننده پوست', 'ضد تیرگی', 'ملاسما', 'روشن‌کننده', 'whitening skin', 'brightening', 'anti spot', 'anti dark spot'] },
    { id: 'u-repair', type: 'use', label: 'ترمیم‌کننده', phrases: ['ترمیم کننده', 'ترمیمی', 'ترمیم', 'ریپیر', 'ریپر', 'repair', 'repairing', 'recovery'] },
    { id: 'u-exfol', type: 'use', label: 'لایه‌بردار', phrases: ['لایه بردار', 'لایه برداری', 'لایه بردار پوست', 'پیلینگ', 'پیلین', 'peeling', 'exfoliating', 'exfoliant', 'اسکراب', 'scrub'] },
    { id: 'u-sun', type: 'use', label: 'ضد آفتاب', phrases: ['ضد آفتاب', 'ضدآفتاب', 'ضد افتاب', 'سان اسکرین', 'سانسکرین', 'سان‌اسکرین', 'sunscreen', 'sun screen', 'sunblock', 'sun block', 'spf*'] },
    { id: 'u-aging', type: 'use', label: 'ضد چروک / ضد پیری', phrases: ['ضد چروک', 'ضدچروک', 'ضد پیری', 'ضدپیری', 'جوانساز', 'جوان ساز', 'جوان کننده', 'ضد خط چین', 'anti aging', 'anti-aging', 'antiaging', 'anti wrinkle'] },
    // «شستشو» به‌تنهایی کاربرد است؛ «ژل/فوم» نوع محصول جدا حساب می‌شود (ژل شستشو ≠ فوم شستشو)
    { id: 'u-cleanse', type: 'use', label: 'پاک‌کننده / شوینده', phrases: ['پاک کننده', 'پاک‌کننده', 'پاککننده', 'شوینده', 'کلینزر', 'cleanser', 'cleansing', 'شستشو', 'صابون مایع'] },
    { id: 'u-makeup-remove', type: 'use', label: 'پاک‌کننده آرایش', dom: 'skin', phrases: ['پاک کننده آرایش', 'آرایش پاک کن', 'میسلار', 'میسلار واتر', 'micellar'] },
    { id: 'u-dandruff', type: 'use', label: 'ضد شوره', dom: 'hair', phrases: ['ضد شوره', 'ضدشوره', 'شوره', 'anti dandruff', 'dandruff'] },
    { id: 'u-hairloss', type: 'use', label: 'ضد ریزش', dom: 'hair', phrases: ['ضد ریزش', 'ضدریزش', 'ریزش مو', 'تقویت مو', 'تقویت کننده مو', 'hair loss', 'anti hair loss'] },
    { id: 'u-whiten-teeth', type: 'use', label: 'سفیدکننده دندان', dom: 'oral', phrases: ['سفید کننده', 'سفیدکننده', 'سفید کننده دندان', 'whitening teeth'] },
    { id: 'u-badbreath', type: 'use', label: 'ضد بوی دهان', dom: 'oral', phrases: ['ضد بوی دهان', 'بوی دهان', 'خوشبو کننده دهان', 'halitosis'] },
    { id: 'u-nourish', type: 'use', label: 'مغذی / تغذیه‌کننده', phrases: ['مغذی', 'تغذیه کننده', 'تغذیه‌کننده', 'نرم کننده', 'نرمکننده', 'نرم‌کننده', 'نوریشینگ', 'nourishing', 'nutritive'] },
    { id: 'u-lip', type: 'use', label: 'مراقبت لب', dom: 'lip', phrases: ['بالم لب', 'کرم لب', 'لب', 'lip balm', 'lipbalm'] },
    { id: 'u-eye', type: 'use', label: 'دور چشم', dom: 'eye', phrases: ['دور چشم', 'دورچشم', 'کانتور چشم', 'کانتور', 'eye contour', 'eye cream'] },

    // ---- نوع / فرم محصول ----
    { id: 'f-serum', type: 'form', label: 'سرم', phrases: ['سرم', 'سیروم', 'serum'] },
    { id: 'f-cream', type: 'form', label: 'کرم', phrases: ['کرم', 'کریم', 'cream', 'creme'] },
    { id: 'f-gel', type: 'form', label: 'ژل', phrases: ['ژل', 'جل', 'gel'] },
    { id: 'f-foam', type: 'form', label: 'فوم', phrases: ['فوم', 'foam'] },
    { id: 'f-lotion', type: 'form', label: 'لوسیون', phrases: ['لوسیون', 'لوشن', 'لوسین', 'lotion'] },
    { id: 'f-toner', type: 'form', label: 'تونر', phrases: ['تونر', 'تونیک', 'toner', 'tonic'] },
    { id: 'f-shampoo', type: 'form', label: 'شامپو', dom: 'hair', phrases: ['شامپو', 'شمپو', 'shampoo'] },
    { id: 'f-conditioner', type: 'form', label: 'نرم‌کنندهٔ مو', dom: 'hair', phrases: ['کاندیشنر', 'conditioner', 'نرم کننده مو', 'نرم‌کننده مو', 'نرمکننده مو'] },
    { id: 'f-mask', type: 'form', label: 'ماسک', phrases: ['ماسک', 'mask'] },
    { id: 'f-mouthwash', type: 'form', label: 'دهان‌شویه', dom: 'oral', phrases: ['دهانشویه', 'دهان شویه', 'دهان‌شویه', 'mouthwash', 'mouth wash'] },
    { id: 'f-toothpaste', type: 'form', label: 'خمیر دندان', dom: 'oral', phrases: ['خمیر دندان', 'خمیردندان', 'خمیر', 'toothpaste'] },
    { id: 'f-fluid', type: 'form', label: 'فلوئید', phrases: ['فلوئید', 'فلوید', 'فلوییید', 'fluid'] },
    { id: 'f-spray', type: 'form', label: 'اسپری', phrases: ['اسپری', 'اسپره', 'spray'] },
    { id: 'f-wash', type: 'form', label: 'شوینده صورت/بدن', phrases: ['صابون', 'سینژ', 'syndet'] },
    { id: 'f-pan', type: 'form', anchor: true, label: 'پن', phrases: ['پن', 'pan', 'syndet bar'] },
    { id: 'f-strengthening', type: 'form', anchor: true, label: 'محلول تقویتی', phrases: ['محلول تقویتی', 'محلول تقویت کننده'] },
    { id: 'f-deodorant', type: 'form', anchor: true, label: 'ضد تعریق (مام / رول‌آن)', phrases: ['ضد تعریق', 'ضدتعریق', 'مام', 'رول آن', 'رولان', 'رول‌آن', 'رولون', 'دئودورانت', 'دئودرانت', 'deodorant', 'roll on', 'rollon', 'antiperspirant'] },
    { id: 'f-hair-tonic', type: 'form', anchor: true, label: 'محلول مو (تونیک مو)', dom: 'hair', phrases: ['محلول مو', 'تونیک مو', 'هیر تونیک', 'hair tonic'] },
    { id: 'f-hair-glue', type: 'form', anchor: true, label: 'چسب مو', dom: 'hair', phrases: ['چسب مو', 'هیر گلو', 'hair glue'] },
    { id: 'f-floss', type: 'form', anchor: true, label: 'نخ دندان', dom: 'oral', phrases: ['نخ دندان', 'نخ‌دندان', 'فلاس', 'dental floss', 'floss'] },
    { id: 'f-toothbrush', type: 'form', anchor: true, label: 'مسواک', dom: 'oral', phrases: ['مسواک', 'toothbrush', 'tooth brush'] },
    { id: 'f-wipes', type: 'form', anchor: true, label: 'دستمال مرطوب', phrases: ['دستمال مرطوب', 'دستمال‌مرطوب', 'دستمالمرطوب', 'ویپس', 'wet wipes', 'wipes'] },
    { id: 'f-baby-oil', type: 'form', anchor: true, label: 'روغن بچه', phrases: ['روغن بچه', 'روغن کودک', 'روغن نوزاد', 'بیبی اویل', 'baby oil'] },
    { id: 'f-earbud', type: 'form', anchor: true, label: 'گوش‌پاک‌کن', phrases: ['گوش پاک کن', 'گوش‌پاک‌کن', 'گوشپاک کن', 'گوش پاککن', 'cotton bud', 'ear bud', 'earbud'] },
    { id: 'f-freshener-tab', type: 'form', anchor: true, label: 'قرص خوشبوکننده', phrases: ['قرص خوشبو کننده', 'قرص خوشبوکننده', 'قرص خوشبو'] },
    { id: 'f-acetone', type: 'form', anchor: true, label: 'استون / لاک‌پاک‌کن', phrases: ['استون', 'آستون', 'اسِتون', 'acetone', 'لاک پاک کن', 'لاک‌پاک‌کن', 'لاکپاک کن', 'nail polish remover'] },
    { id: 'f-oxidant', type: 'form', anchor: true, label: 'اکسیدان', phrases: ['اکسیدان', 'اکسیدانت', 'oxidant', 'oxydant'] },

    // ---- حوزه‌ها (مو / دهان) ----
    { id: 'h-hair', type: 'dom', label: 'مو', dom: 'hair', strict: true, phrases: ['مو', 'موی', 'موها', 'موهای', 'hair', 'پوست سر', 'فرق سر', 'scalp'] },
    { id: 'o-oral', type: 'dom', label: 'دهان و دندان', dom: 'oral', strict: true, phrases: ['دندان', 'دهان', 'لثه', 'oral', 'dental'] },

    // ---- ویژگی‌های اختصاصی محصول ----
    { id: 'h-colored', type: 'feat', label: 'موی رنگ‌شده', dom: 'hair', strict: true, phrases: ['موی رنگ شده', 'موهای رنگ شده', 'رنگ شده', 'رنگ شده ها', 'رنگ‌شده', 'کالر پروتکت', 'color protect', 'colored hair', 'color treated'] },
    { id: 'f-kids', type: 'feat', label: 'کودک', strict: true, phrases: ['کودک', 'کودکان', 'بچه', 'بچگانه', 'نوزاد', 'baby', 'kids', 'kid'] },
    { id: 'f-men', type: 'feat', label: 'آقایان', strict: true, phrases: ['آقایان', 'مردانه', 'مردان', 'men', 'for men'] },
    { id: 'f-women', type: 'feat', label: 'بانوان', strict: true, phrases: ['بانوان', 'زنانه', 'خانم', 'خانمها', 'women'] },

    // ---- نوع پوست / ویژگی (تعدیل‌کننده؛ اعضای هر fam با هم ناسازگارند) ----
    { id: 's-oily', type: 'skin', fam: 'skintype', dom: 'skin', strict: true, label: 'پوست چرب', phrases: ['چرب', 'پوست چرب', 'روغنی', 'پوست روغنی', 'اویل فری', 'اویل‌فری', 'oil free', 'oilfree', 'oily'] },
    { id: 's-dry', type: 'skin', fam: 'skintype', dom: 'skin', strict: true, label: 'پوست خشک', phrases: ['خشک', 'پوست خشک', 'خیلی خشک', 'بسیار خشک', 'dry'] },
    { id: 's-sensitive', type: 'skin', fam: 'skintype', dom: 'skin', strict: true, label: 'پوست حساس', phrases: ['حساس', 'پوست حساس', 'سنسیتیو', 'سنسیتیف', 'sensitive'] },
    { id: 's-combo', type: 'skin', fam: 'skintype', dom: 'skin', strict: true, label: 'پوست مختلط', phrases: ['مختلط', 'پوست مختلط', 'ترکیبی', 'combination', 'combo'] },
    { id: 's-normal', type: 'skin', fam: 'skintype', dom: 'skin', strict: true, label: 'پوست نرمال', phrases: ['نرمال', 'پوست نرمال', 'معمولی', 'پوست معمولی', 'normal'] },
    { id: 's-acne', type: 'skin', fam: 'skintype', dom: 'skin', strict: true, label: 'پوست مستعد جوش', phrases: ['مستعد جوش', 'پوست مستعد جوش', 'مستعد آکنه', 'جوش دار', 'جوشدار', 'پوست جوش دار', 'آکنه دار', 'آکنه ای', 'acne prone', 'acne-prone'] },
    // «همه انواع پوست»: با هیچ نوع پوستی ناسازگار نیست
    { id: 's-all', type: 'skin', fam: 'skintype-all', dom: 'skin', strict: true, label: 'همه انواع پوست', phrases: ['همه انواع پوست', 'انواع پوست', 'همه پوست ها', 'all skin types'] },
    { id: 's-colored', type: 'skin', fam: 'tint', strict: true, label: 'رنگی', phrases: ['رنگی', 'کالر', 'tinted', 'colored', 'color', 'بژ', 'بژ طبیعی', 'بژ روشن', 'بژ تیره', 'beige'] },
    { id: 's-nocolor', type: 'skin', fam: 'tint', strict: true, label: 'بدون رنگ', phrases: ['بی رنگ', 'بدون رنگ', 'بیرنگ', 'نچرال', 'colorless'] },
    { id: 's-noalc', type: 'skin', fam: 'alc', strict: true, label: 'بدون الکل', phrases: ['بدون الکل', 'فاقد الکل', 'بی الکل', 'alcohol free'] },

    // ---- برندها / سری‌ها (با املاهای رایج و غلط‌های متداول) ----
    { id: 'b-dermalift', type: 'brand', label: 'درمالیفت', phrases: ['درمالیفت', 'درماليفت', 'درمالفت', 'دارمالیفت', 'درمالیفیت', 'درمالیفد', 'درمالیف', 'dermalift', 'dermalyft', 'dermalif'] },
    { id: 'b-sebolift', type: 'brand', label: 'سبولیفت', phrases: ['سبولیفت', 'سبوليفت', 'سبولفت', 'سبولیفد', 'sebolift'] },
    { id: 'b-sunlift', type: 'brand', label: 'سان‌لیفت', phrases: ['سان لیفت', 'سانلیفت', 'سان‌لیفت', 'sunlift', 'sun lift'] },
    { id: 'b-sunsafe', type: 'brand', label: 'سان سیف', phrases: ['سان سیف', 'سانسیف', 'سان‌سیف', 'سان صیف', 'sunsafe', 'sun safe'] },
    { id: 'b-vione', type: 'brand', label: 'وی‌وان', phrases: ['وی وان', 'ویوان', 'وی‌وان', 'vione', 'vi one', 'v one', 'vi-one'] },
    { id: 'b-acop', type: 'brand', label: 'آکوپ', phrases: ['آکوپ', 'اکوپ', 'آکوب', 'acop', 'akop'] },
    { id: 'b-atousa', type: 'brand', label: 'آتوسا', phrases: ['آتوسا', 'اتوسا', 'آتوصا', 'atousa', 'atusa'] },
    { id: 'b-folica', type: 'brand', label: 'فولیکا', phrases: ['فولیکا', 'فلیکا', 'folica', 'follica'] },
    { id: 'b-halita', type: 'brand', label: 'هالیتا', phrases: ['هالیتا', 'halita'] },
    { id: 'b-sensitive-pro', type: 'brand', label: 'پرو ریلایف', phrases: ['پرو ریلایف', 'پروریلایف', 'pro relief'] }
  ];

  /* اگر محصول مفهوم کلید را داشته باشد، مفاهیم مقدار هم برایش حساب می‌شود */
  const IMPLIES = {
    'u-acne-treat': ['u-acne'],
    's-acne': ['u-acne'],
    'f-shampoo': ['h-hair'],
    'f-conditioner': ['h-hair'],
    'f-hair-tonic': ['h-hair'],
    'f-hair-glue': ['h-hair'],
    'f-floss': ['o-oral'],
    'f-toothbrush': ['o-oral'],
    'f-baby-oil': ['f-kids'],
    'u-dandruff': ['h-hair'],
    'u-hairloss': ['h-hair'],
    'h-colored': ['h-hair'],
    'f-mouthwash': ['o-oral'],
    'f-toothpaste': ['o-oral'],
    'u-whiten-teeth': ['o-oral'],
    'u-badbreath': ['o-oral']
  };

  /* کاربردهای مجاورِ هم که نباید با هم قاطی شوند: اگر پرسش یکی را بخواهد و محصول (علاوه بر آن)
     دیگری را هم داشته باشد، فقط به‌عنوان «مرتبط» (سطح ۲) می‌آید؛ اگر فقط دیگری را داشته باشد، اصلاً نمی‌آید. */
  const ADJACENT = [
    ['u-acne-treat', 'u-cleanse'],     // ژل درمان جوش ≠ ژل شستشوی پوست مستعد جوش
    ['u-spot', 'u-exfol'],             // ضدلک ≠ لایه‌بردار
    ['u-cleanse', 'u-makeup-remove']   // پاک‌کنندهٔ صورت ≠ پاک‌کنندهٔ آرایش
  ];

  // حوزه‌هایی که محصولشان با پرسش پوست/صورت قاطی نمی‌شود
  const SPECIAL_DOMAINS = new Set(['hair', 'oral', 'lip', 'eye']);

  const STOPWORDS = new Set(['پوست', 'برای', 'مخصوص', 'مناسب', 'و', 'با', 'از', 'در', 'به', 'محصول', 'نوع', 'یک', 'های', 'ی', 'تا', 'که', 'را', 'the', 'for', 'of', 'and']);

  // وزن امتیاز هر نوع واحد پرسش (کاربرد > برند > ویژگی > نوع پوست > نوع محصول)
  const WEIGHT = { use: 40, brand: 30, feat: 25, skin: 18, form: 15, dom: 8, lit: 15 };

  /* ---------- نمایهٔ فرهنگ لغت ---------- */
  let phraseIndex = null; // compactPhrase -> group
  let phraseList = null;  // [{ cp, np, sk, group, strict, prefix }]
  let groupById = null;
  let famMembers = null;  // fam -> [id,...]
  const customGroups = [];

  function buildDictionary() {
    phraseIndex = new Map();
    phraseList = [];
    groupById = new Map();
    famMembers = {};
    const all = GROUPS.concat(customGroups);
    for (const g of all) {
      groupById.set(g.id, g);
      if (g.fam) (famMembers[g.fam] = famMembers[g.fam] || []).push(g.id);
      for (const raw of g.phrases) {
        const prefix = /\*$/.test(raw);
        const ph = prefix ? raw.slice(0, -1) : raw;
        const cp = compact(ph);
        if (!cp) continue;
        if (!phraseIndex.has(cp)) phraseIndex.set(cp, g);
        phraseList.push({ cp, np: normText(ph), sk: skeleton(ph), group: g, strict: !!g.strict, prefix });
      }
    }
    productCache = new WeakMap();
  }

  /* افزودن گروه‌های جدید (مثلاً برند تازه) بدون دست‌زدن به کد: SmartNames.extend([{id,type,label,phrases}]) */
  function extend(groups) {
    (groups || []).forEach((g) => {
      if (g && g.id && Array.isArray(g.phrases) && g.phrases.length && !customGroups.some((c) => c.id === g.id)) {
        customGroups.push({ id: g.id, type: g.type || 'use', label: g.label || g.phrases[0], phrases: g.phrases, dom: g.dom, fam: g.fam, strict: g.strict, anchor: g.anchor });
      }
    });
    phraseIndex = null;
  }

  function ensureDict() { if (!phraseIndex) buildDictionary(); }

  /* ---------- تحلیل یک متن (نام محصول / نام مستعار) ---------- */
  // «غیر چرب»، «بدون چربی»، «non oily»: کلمهٔ بعد از نفی، نوع پوست محصول حساب نمی‌شود
  const NEGATORS = /(^| )(غیر|بدون|بی|فاقد|non|without|no)( )(\S+)/g;
  function analyze(text, noPos) {
    const a = analyzeBase(text);
    a.pos = noPos ? a : analyzeBase(text.replace(NEGATORS, '$1').replace(/\s+/g, ' ').trim());
    return a;
  }
  function analyzeBase(text) {
    const tokens = Array.from(new Set(text.split(' ').filter(Boolean)));
    const tokSet = new Set();
    tokens.forEach((t) => tokVariants(t).forEach((v) => tokSet.add(v)));
    return {
      text,
      tokens,
      tokSet,
      comp: text.replace(/ /g, ''),
      strippedText: ' ' + tokens.map(stripSuffix).join(' ') + ' ',
      spaced: ' ' + text + ' ',
      skTokens: tokens.map(skeleton)
    };
  }

  function phraseHit(e, a) {
    if (e.group.fam === 'skintype' && a.pos) a = a.pos;
    if (e.prefix) return a.tokens.some((t) => t.startsWith(e.cp));
    if (e.cp.length <= 3) return a.tokSet.has(e.cp);
    if (e.strict) {
      if (a.tokSet.has(e.cp)) return true;
      const needle = ' ' + e.np + ' ';
      return a.spaced.includes(needle) || a.strippedText.includes(needle);
    }
    return a.comp.includes(e.cp);
  }

  function conceptsOf(a, skipSkin) {
    const set = new Set();
    for (const e of phraseList) {
      if (skipSkin && e.group.type === 'skin') continue;
      if (set.has(e.group.id)) continue;
      if (phraseHit(e, a)) { set.add(e.group.id); continue; }
      // برای برندها، تطبیق اسکلتی هم برای غلط‌های املایی نام برند در خود فایل انبار
      if (e.group.type === 'brand' && e.sk.length >= 4 && a.skTokens.some((t) => t === e.sk || (t.length >= 4 && t.includes(e.sk)))) set.add(e.group.id);
    }
    // بستهٔ استلزام‌ها
    for (const id of Array.from(set)) (IMPLIES[id] || []).forEach((x) => set.add(x));
    return set;
  }

  /* ---------- پروفایل هر محصول (کش‌شده، تنبل) ---------- */
  let productCache = new WeakMap();
  let aliasLookup = null; // (code) => [alias,...]

  function setAliasLookup(fn) { aliasLookup = typeof fn === 'function' ? fn : null; productCache = new WeakMap(); }

  /* ---------- مشخصه‌های ساختاریافتهٔ تأییدشده (product_attrs) ----------
     فقط ردیف‌های status='confirmed' اثر دارند؛ «پیشنهادی» نادیده گرفته می‌شود.
     مشخصهٔ تأییدشده، نوع محصول و نوع پوستِ حدسی از روی نام را کنار می‌زند. */
  let attrsLookup = null; // (code) => { form, skins[], uses[], volume, status } | null
  function setAttrsLookup(fn) { attrsLookup = typeof fn === 'function' ? fn : null; productCache = new WeakMap(); }
  function confirmedAttrs(code) {
    if (!attrsLookup) return null;
    let a = null;
    try { a = attrsLookup(code); } catch (e) { a = null; }
    return a && a.status === 'confirmed' ? a : null;
  }

  const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  const VOL_RE = /(\d+(?:\.\d+)?)\s*(میلی\s*لیتر|میلی‌لیتر|میل|ml|cc|گرم|gr|g)(?![a-z])/i;
  /* حجم/وزن از متن: «۱۰۰ میل» و «100ml» هر دو → '100ml' */
  function volumeOf(text) {
    const t = String(text || '').replace(/[۰-۹٠-٩]/g, (c) => FA_DIGITS[c]).replace(/٫/g, '.').toLowerCase();
    const m = t.match(VOL_RE);
    if (!m) return null;
    const unit = /^(g|gr|گرم)$/.test(m[2]) ? 'g' : 'ml';
    return { key: String(parseFloat(m[1])) + unit, num: m[1], unit };
  }
  function normVolumeKey(v) {
    const r = volumeOf(String(v || ''));
    return r ? r.key : null;
  }

  function profileOf(p) {
    ensureDict();
    let aliases = [];
    try { aliases = aliasLookup ? (aliasLookup(p.code) || []) : []; } catch (e) { aliases = []; }
    const cAt = confirmedAttrs(p.code);
    const sig = aliases.join('\u0001') + '\u0002' + (cAt ? JSON.stringify([cAt.form, cAt.skins, cAt.uses, cAt.volume]) : '');
    let pr = productCache.get(p);
    if (pr && pr.sig === sig) return pr; // اگر نام مستعار عوض شد، پروفایل دوباره ساخته می‌شود
    const nameA = analyze(normText(p.name || p.normName || ''));
    const allA = analyze(normText((p.normName || p.name || '') + ' ' + (p.name || '') + ' ' + aliases.join(' ')));
    const nameConcepts = conceptsOf(nameA);
    // نوع پوست (و رنگی/بدون‌رنگ/بدون‌الکل) فقط از «نام» خود محصول؛ نام مستعار/اسم پیشنهادی/برچسب‌ها
    // ممکن است از روی جست‌وجو یا دسته‌بندی کلی اضافه شده باشند و نوع پوست معتبر محصول نیستند.
    const concepts = conceptsOf(allA, true);
    nameConcepts.forEach((id) => { const g = groupById.get(id); if (g && g.type === 'skin') concepts.add(id); });
    for (const id of Array.from(concepts)) (IMPLIES[id] || []).forEach((x) => concepts.add(x));
    if (cAt) {
      // نوع محصول و «نوع پوست» تأییدشده جایگزین حدسِ نام می‌شود؛ ویژگی‌های ذکرشده در نام (رنگی، بدون الکل) حفظ می‌شوند
      const drop = (type) => { [concepts, nameConcepts].forEach((set) => Array.from(set).forEach((id) => { const g = groupById.get(id); if (g && g.type === type && (type !== 'skin' || g.fam === 'skintype' || g.fam === 'skintype-all')) set.delete(id); })); };
      if (cAt.form && groupById.has(cAt.form)) { drop('form'); concepts.add(cAt.form); nameConcepts.add(cAt.form); }
      if (Array.isArray(cAt.skins) && cAt.skins.length) { drop('skin'); cAt.skins.forEach((id) => { if (groupById.has(id)) { concepts.add(id); nameConcepts.add(id); } }); }
      (cAt.uses || []).forEach((id) => { if (groupById.has(id)) concepts.add(id); });
      for (const id of Array.from(concepts)) (IMPLIES[id] || []).forEach((x) => concepts.add(x));
    }
    const domains = new Set();
    concepts.forEach((id) => { const g = groupById.get(id); if (g && g.dom) domains.add(g.dom); });
    const volInfo = (cAt && cAt.volume ? volumeOf(cAt.volume) : null) || volumeOf(p.name || p.normName || '');
    pr = {
      text: allA.text, tokens: allA.tokens, tokSet: allA.tokSet, comp: allA.comp, skTokens: allA.skTokens,
      nameText: normText(p.name || p.normName || ''),
      concepts, nameConcepts, domains, sig, confirmed: !!cAt, volume: volInfo ? volInfo.key : null, volumeFromAttrs: !!(cAt && cAt.volume)
    };
    productCache.set(p, pr);
    return pr;
  }

  /* ---------- تحلیل پرسش ---------- */
  function lookupPhrase(parts) {
    let g = phraseIndex.get(parts.join(''));
    if (g) return g;
    // پسوند آخرین کلمه («موهای رنگ شده‌ی»، «شستشوی»)
    const last = parts[parts.length - 1];
    const sv = stripSuffix(last);
    if (sv !== last) g = phraseIndex.get(parts.slice(0, -1).concat(sv).join(''));
    return g || null;
  }

  function parseQuery(query) {
    ensureDict();
    const q = normText(query);
    const toks = q.split(' ').filter(Boolean);
    const units = []; // { kind:'concept'|'lit', ... }
    const used = new Array(toks.length).fill(false);
    // بلندترین عبارت اول (تا ۴ کلمه)
    for (let i = 0; i < toks.length; i++) {
      if (used[i]) continue;
      let hit = null;
      for (let len = Math.min(4, toks.length - i); len >= 1; len--) {
        const parts = toks.slice(i, i + len);
        const cp = parts.join('');
        let g = lookupPhrase(parts);
        // تحمل غلط تایپی (فقط توکن‌های بلند، تا نتیجهٔ بی‌ربط نیاید)
        if (!g && len <= 2 && cp.length >= 5) {
          const sk = skeleton(cp);
          let best = null, bestD = 99;
          for (const e of phraseList) {
            const t = e.group.type;
            if (t === 'brand') {
              if (e.sk.length < 4) continue;
              const d = editDistance(sk, e.sk, 1);
              if (d <= 1 && d < bestD) { best = e.group; bestD = d; }
            } else if ((t === 'use' || t === 'form') && !e.group.strict && !e.prefix && e.cp.length >= 6 && cp.length >= 6) {
              const d = editDistance(cp, e.cp, 1);
              if (d <= 1 && d < bestD) { best = e.group; bestD = d; }
            }
          }
          g = best;
        }
        if (g) { hit = { g, len }; break; }
      }
      if (hit) {
        for (let k = 0; k < hit.len; k++) used[i + k] = true;
        if (!units.some((u) => u.id === hit.g.id)) {
          units.push({ kind: 'concept', id: hit.g.id, type: hit.g.type, label: hit.g.label, dom: hit.g.dom || null, fam: hit.g.fam || null, anchor: !!hit.g.anchor });
        }
      }
    }
    let skinWord = false;
    for (let i = 0; i < toks.length; i++) {
      if (used[i]) continue;
      const t = toks[i];
      if (t === 'پوست') skinWord = true;
      if (STOPWORDS.has(t)) continue;
      if (t.length < 2 && !/\d/.test(t)) continue;
      units.push({ kind: 'lit', tok: t, sk: skeleton(t), numeric: /^\d+$/.test(t) });
    }
    units.skinWord = skinWord;
    return units;
  }

  function litMatch(unit, pr) {
    if (unit.tok.length < 3 && !unit.numeric) return pr.tokSet.has(unit.tok) ? 1 : 0;
    if (pr.text.includes(unit.tok)) return 1;
    if (unit.tok.length >= 3 && pr.comp.includes(unit.tok)) return 1;
    const sv = stripSuffix(unit.tok);
    if (sv.length >= 3 && sv !== unit.tok && pr.text.includes(sv)) return 0.9;
    if (unit.numeric || unit.tok.length < 5) return 0; // تحمل غلط فقط برای کلمات بلند
    for (let i = 0; i < pr.tokens.length; i++) {
      const t = pr.tokens[i];
      if (t.length < 5) continue;
      if (pr.skTokens[i] === unit.sk) return 0.8;
      if (unit.sk.length >= 5 && editDistance(pr.skTokens[i], unit.sk, 1) <= 1) return 0.6;
      if (editDistance(t, unit.tok, 1) <= 1) return 0.7;
    }
    return 0;
  }

  /* رابطهٔ نوع پوست پرسش با محصول: match | all | missing | conflict */
  function skinRelation(u, pr) {
    if (pr.concepts.has(u.id)) return 'match';
    if (u.fam === 'skintype' && pr.concepts.has('s-all')) return 'all'; // «همه انواع پوست»: مناسب است ولی بعد از محصولِ اختصاصیِ همان نوع می‌آید
    const members = u.fam ? (famMembers[u.fam] || []) : [];
    if (members.some((id) => id !== u.id && pr.concepts.has(id))) return 'conflict';
    return 'missing';
  }

  /* ---------- پیشنهاد ---------- */
  /**
   * @param {string} query
   * @param {Array} products   همهٔ محصولات واقعی (Searcher.getProducts())
   * @param {Object} opts      { warehouse, exclude:Set|Array (محصولات نتایج فعلی), limit }
   * @returns {Array<{p, tier, score, why:[string]}>}
   *   tier 1 = همه‌چیز تطبیق دارد؛ tier 2 = مرتبط ولی غیرمستقیم؛ score بزرگ‌تر = بهتر
   */
  function suggest(query, products, opts = {}) {
    const { warehouse, limit = 30 } = opts;
    const exclude = new Set(opts.exclude ? Array.from(opts.exclude) : []);
    const raw = String(query || '').trim();
    if (!raw || !Array.isArray(products) || !products.length) return [];
    if (/^[\d\s۰-۹٠-٩]+$/.test(raw)) return []; // عبارت فقط عددی: جست‌وجوی کد؛ کار موتور نیست

    const units = parseQuery(raw);
    if (!units.length) return [];
    // حجم در پرسش («۱۰۰ میل»، «50ml»): عدد و واحد از شرط‌های متنی خارج و با حجمِ ثبت‌شدهٔ محصول مقایسه می‌شوند
    const qVol = volumeOf(raw);
    if (qVol) {
      units.forEach((u) => {
        if (u.kind !== 'lit') return;
        if (u.numeric && parseFloat(u.tok) === parseFloat(qVol.num)) u.vol = true;
        else if (/^(میل|میلی|لیتر|ml|cc|گرم|gr|g|میلی‌لیتر)$/.test(u.tok)) u.volUnit = true;
      });
    }
    const conceptUnits = units.filter((u) => u.kind === 'concept');
    if (!conceptUnits.length && !units.some((u) => u.kind === 'lit' && u.tok.length >= 3)) return [];

    const core = units.filter((u) => !(u.kind === 'concept' && u.type === 'skin') && !u.volUnit);
    const skinUnits = units.filter((u) => u.kind === 'concept' && u.type === 'skin');
    if (!core.length) return []; // فقط «چرب» یا «حساس» بدون محصول/کاربرد: خیلی مبهم

    // «لنگر»: حداقل یک معیار اختصاصی (کاربرد/برند/ویژگی/حوزه/کلمهٔ خاص)؛ کلمات عمومی (ژل، کرم، شامپو، …) به‌تنهایی معیار نیستند
    const anchored = units.some((u) => (u.kind === 'concept' && (u.anchor || u.type === 'use' || u.type === 'brand' || u.type === 'feat' || u.type === 'dom')) ||
      (u.kind === 'lit' && !u.numeric && !u.volUnit && u.tok.length >= 3));
    if (!anchored && !skinUnits.length) return [];

    const qIds = new Set(conceptUnits.map((u) => u.id));
    const qDom = new Set();
    conceptUnits.forEach((u) => { if (u.dom) qDom.add(u.dom); });
    if (!qDom.size && units.skinWord) qDom.add('skin');
    const qNormFull = normText(raw);
    const qWords = qNormFull.split(' ').filter((w) => w && !STOPWORDS.has(w));

    const out = [];
    for (const p of products) {
      if (!p) continue;
      if (warehouse && warehouse !== 'all' && String(p.warehouse) !== String(warehouse)) continue;
      const key = p.warehouse + '|' + p.code;
      if (exclude.has(key)) continue;
      const pr = profileOf(p);

      // ---- حوزه: محصول مو/دهان/لب/چشم با پرسش پوست/صورت قاطی نمی‌شود ----
      let tier = 1;
      const weak = []; // دلیل «مرتبط» بودن (نه تطبیق کامل)؛ در UI نمایش داده می‌شود
      const pSpecial = Array.from(pr.domains).filter((d) => SPECIAL_DOMAINS.has(d));
      if (pSpecial.length) {
        if (qDom.size) { if (!pSpecial.every((d) => qDom.has(d))) continue; }
        else { tier = 2; weak.push('محصول اختصاصی مو/دهان'); } // پرسش بدون حوزه: محصول مو/دهان فقط «مرتبط»
      }

      let ok = true, score = 0;
      const why = [];

      // ---- معیارهای اصلی (کاربرد/نوع/برند/ویژگی/کلمه): همه باید تطبیق داشته باشند ----
      for (const u of core) {
        if (u.kind === 'concept') {
          if (!pr.concepts.has(u.id)) { ok = false; break; }
          score += WEIGHT[u.type] || 10;
          if (pr.nameConcepts.has(u.id)) score += 8; // ذکر مستقیم در نام محصول
          why.push(u.label);
        } else if (u.vol && pr.volume) {
          if (pr.volume !== qVol.key) { ok = false; break; }   // حجم متفاوت = محصول متفاوت
          score += 20; why.push('حجم ' + qVol.num + (qVol.unit === 'g' ? ' گرم' : ' میل'));
        } else {
          const m = litMatch(u, pr);
          if (!m) { ok = false; break; }
          score += WEIGHT.lit * m;
        }
      }
      if (!ok) continue;

      // ---- نوع پوست / ویژگی‌های تعدیل‌کننده ----
      for (const u of skinUnits) {
        const rel = skinRelation(u, pr);
        if (rel === 'conflict') { ok = false; break; }            // چرب ≠ خشک ≠ حساس ≠ مستعد جوش ≠ معمولی
        if (rel === 'all') { tier = 2; score -= 5; weak.push('مناسب همه انواع پوست'); continue; } // جدا و بعد از محصولاتِ اختصاصی
        if (rel === 'missing') {
          if (!anchored) { ok = false; break; }                    // پرسش فقط «نوع + نوع پوست»: ذکر نوع پوست الزامی
          tier = 2; weak.push(pr.confirmed ? 'نوع پوست/ویژگی ثبت نشده' : 'نوع پوست/ویژگی در نام ذکر نشده');
        } else { score += WEIGHT.skin; why.push(u.label); }
      }
      if (!ok) continue;

      // ---- ویژگی اختصاصیِ اضافه در محصول (مثلاً «موهای رنگ‌شده») که پرسش نخواسته: فقط مرتبط ----
      pr.concepts.forEach((id) => {
        const g = groupById.get(id);
        if (g && g.type === 'feat' && !qIds.has(id) && !Array.from(qIds).some((q) => (IMPLIES[q] || []).includes(id))) { tier = 2; score -= 12; weak.push('ویژگی اضافه: ' + g.label); }
      });

      // ---- کاربردهای مجاور (ژل درمان جوش/شستشو، ضدلک/لایه‌بردار، …) ----
      for (const [a, b] of ADJACENT) {
        if ((qIds.has(a) && !qIds.has(b) && pr.concepts.has(b)) || (qIds.has(b) && !qIds.has(a) && pr.concepts.has(a))) { tier = 2; score -= 15; weak.push('کاربرد مجاور: ' + labelOf(qIds.has(a) ? b : a)); }
      }

      if (pr.confirmed) score += 10; // مشخصه‌های تأییدشده: قابل‌اعتمادتر از حدس روی نام
      // ---- تطابق دقیق نام: بالاترین امتیاز ----
      if (qNormFull && pr.nameText.includes(qNormFull)) score += 60;
      else if (qWords.length && qWords.every((w) => pr.nameText.includes(w))) score += 25;
      // کاربردهای دیگرِ ذکرشده در نام که پرسش نخواسته: کمی پایین‌تر (محصول اختصاصی‌تر بالاتر)
      pr.nameConcepts.forEach((id) => {
        const g = groupById.get(id);
        if (g && g.type === 'use' && !qIds.has(id) && !(IMPLIES[id] || []).some((x) => qIds.has(x))) score -= 3;
      });
      score -= Math.min(pr.nameText.length, 80) / 100;

      out.push({ p, tier, score, why, weak });
    }
    out.sort((a, b) => (a.tier - b.tier) || (b.score - a.score));
    return out.slice(0, limit);
  }

  /* مرتب‌سازی نتایج جست‌وجوی اصلی با مشخصه‌های تأییدشده (هیچ نتیجه‌ای حذف نمی‌شود):
     ۱) تطبیق کامل نوع/نوع‌پوست پرسش  ۲) بدون اطلاعات تأییدشده (ترتیب قبلی)  ۳) متضاد (انتها) */
  function rank(query, list) {
    try {
      if (!attrsLookup || !Array.isArray(list) || list.length < 2) return list;
      ensureDict();
      const rel = parseQuery(query).filter((u) => u.kind === 'concept' && (u.type === 'form' || u.type === 'skin'));
      if (!rel.length) return list;
      const g0 = [], g1 = [], g2 = [];
      for (const p of list) {
        if (!confirmedAttrs(p.code)) { g1.push(p); continue; }
        const pr = profileOf(p);
        let conflict = false, match = 0;
        for (const u of rel) {
          if (u.type === 'form') {
            if (pr.concepts.has(u.id)) match++;
            else if ([...pr.concepts].some((id) => { const g = groupById.get(id); return g && g.type === 'form'; })) conflict = true;
          } else {
            const r = skinRelation(u, pr);
            if (r === 'match') match++; else if (r === 'conflict') conflict = true;
          }
        }
        (conflict ? g2 : (match === rel.length ? g0 : g1)).push(p);
      }
      return g0.concat(g1, g2);
    } catch (e) { return list; }
  }

  /* حدس مشخصه‌ها از روی نام محصول (فقط «پیشنهاد»؛ تا تأیید انسانی روی جست‌وجو اثری ندارد).
     اگر چند نوع محصول در نام باشد (مثلاً «ژل فوم»)، form خالی می‌ماند تا انسان تصمیم بگیرد. */
  function inferAttrs(name) {
    ensureDict();
    const a = analyze(normText(name || ''));
    const ids = conceptsOf(a, false);
    const forms = [], skins = [], uses = [];
    ids.forEach((id) => {
      const g = groupById.get(id);
      if (!g) return;
      if (g.type === 'form') forms.push(id);
      else if (g.type === 'skin') skins.push(id);
      else if (g.type === 'use') uses.push(id);
    });
    // نوع اختصاصیِ مو/دهان («تونیک مو»، «نخ دندان») بر نوع عمومی («تونیک»، «نخ») غالب است
    const domForms = forms.filter((id) => { const g = groupById.get(id); return g && g.dom; });
    if (domForms.length && domForms.length < forms.length) { for (let i = forms.length - 1; i >= 0; i--) if (!domForms.includes(forms[i])) forms.splice(i, 1); }
    const v = volumeOf(name);
    return { form: forms.length === 1 ? forms[0] : null, forms, skins, uses, volume: v ? v.key : null };
  }

  function groupsOfType(type) {
    ensureDict();
    return GROUPS.concat(customGroups).filter((g) => g.type === type).map((g) => ({ id: g.id, label: g.label }));
  }
  function labelOf(id) { ensureDict(); const g = groupById.get(id); return g ? g.label : id; }

  return { suggest, parseQuery, extend, setAliasLookup, setAttrsLookup, rank, inferAttrs, groupsOfType, labelOf, volumeOf: (t) => { const v = volumeOf(t); return v ? v.key : null; }, normText, skeleton, editDistance, _groups: GROUPS };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SmartNames; // پشتیبانی از تست در Node
}

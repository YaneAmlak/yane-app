'use strict';
/* ============================================================
   هسته‌ی پردازش فایل‌های انبار (مشترک بین اکسل / CSV / PDF)
   شناسایی ستون‌ها، تشخیص واحد قیمت (ریال/تومان)، ساخت محصولات
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../utils.js'));
  } else {
    root.ParserCore = factory(root.Utils);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Utils) {
  'use strict';
  const norm = Utils.norm;
  const parseNumber = Utils.parseNumber;

  const KEYWORDS = {
    code:  ['کد', 'بارکد', 'code', 'sku', 'barcode', 'کدکالا', 'کدکالا/محصول'],
    name:  ['نام', 'شرح', 'توضیحات', 'کالا', 'محصول', 'name', 'title', 'description', 'item', 'product', 'شرح کالا'],
    stock: ['موجودی', 'مانده', 'مقدار', 'تعداد', 'stock', 'balance', 'qty', 'quantity', 'count', 'onhand', 'موجود'],
    // «مبلغ/amount/value» جدا نگه داشته می‌شوند چون معمولاً یعنی «جمع کل» (تعداد × قیمت واحد)
    // نه خود قیمت واحد؛ در scoreHeader با وزن پایین‌تر امتیاز می‌گیرند تا وقتی
    // ستونی مثل «قیمت واحد» هم وجود دارد، اشتباهاً به‌عنوان قیمت انتخاب نشوند.
    price: ['قیمت', 'فی', 'بها', 'نرخ', 'price', 'fee', 'rate', 'cost'],
    price_total: ['مبلغ', 'amount', 'value', 'جمع']
  };

  function cleanCell(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  /* امتیاز تطبیق یک عنوان ستون با یک دسته */
  function scoreHeader(header, category) {
    const h = norm(header).replace(/\s+/g, '');
    if (!h) return 0;
    let best = 0;
    for (const kw of KEYWORDS[category]) {
      const k = norm(kw).replace(/\s+/g, '');
      if (!k) continue;
      if (h === k) { best = Math.max(best, 100); continue; }
      if (h.includes(k)) best = Math.max(best, 60 + k.length);
      else if (k.includes(h) && h.length >= 2) best = Math.max(best, 40 + h.length);
    }
    return best;
  }

  /* نگاشت ستون‌ها بر اساس عنوان */
  function mapColumns(headers) {
    const cats = ['code', 'name', 'stock', 'price'];
    const scores = headers.map((h, i) => {
      const s = {};
      for (const c of cats) s[c] = scoreHeader(h, c);
      return { i, s };
    });
    const result = { code: -1, name: -1, stock: -1, price: -1 };
    const used = new Set();
    // اول قوی‌ترین تطبیق‌ها (قیمت/فی به مبلغ اولویت دارند چون مبلغ = جمع کل)
    const order = ['code', 'name', 'price', 'stock'];
    for (const c of order) {
      let bestIdx = -1, bestScore = 0;
      for (const item of scores) {
        if (used.has(item.i)) continue;
        if (item.s[c] > bestScore) { bestScore = item.s[c]; bestIdx = item.i; }
      }
      if (bestIdx >= 0 && bestScore >= 50) { result[c] = bestIdx; used.add(bestIdx); }
    }
    // اگر هیچ ستون «قیمت/فی/بها/نرخ» واقعی پیدا نشد:
    if (result.price < 0) {
      // اول دنبال ستونی با کلمهٔ «واحد» می‌گردیم؛ حتی اگر عنوان دقیق آن با
      // کلیدواژه‌های شناخته‌شده مطابقت نداشته باشد (مثلاً عنوانی غیرمنتظره)،
      // وجود «واحد» نشانهٔ قوی «به‌ازای هر واحد» است، نه جمع کل.
      let unitIdx = -1;
      for (let i = 0; i < headers.length; i++) {
        if (used.has(i)) continue;
        const h = norm(headers[i]);
        if (h.includes('واحد') && scoreHeader(headers[i], 'price_total') < 100) { unitIdx = i; break; }
      }
      if (unitIdx >= 0) {
        result.price = unitIdx; used.add(unitIdx);
      } else {
        // آخرین راه‌حل: از «مبلغ» استفاده کن (ممکن است جمع کل باشد، اما بهتر از هیچ است)
        let bestIdx = -1, bestScore = 0;
        for (let i = 0; i < headers.length; i++) {
          if (used.has(i)) continue;
          const s = scoreHeader(headers[i], 'price_total');
          if (s > bestScore) { bestScore = s; bestIdx = i; }
        }
        if (bestIdx >= 0 && bestScore >= 50) { result.price = bestIdx; used.add(bestIdx); }
      }
    }
    return result;
  }

  /* تشخیص ردیف عنوان: ردیفی که بیشترین امتیاز کلیدواژه را دارد
     نکته: ردیف‌های تیتر (مثل «شرکت فلان - لیست موجودی») معمولاً فقط یک
     سلول غیرخالی دارند (سلول‌های ادغام‌شده/merge). چنین ردیف‌هایی هرگز
     نباید به‌عنوان ردیف هدر واقعی انتخاب شوند، چون یک هدر واقعی جدول
     همیشه چند ستون مجزا (حداقل ۳) دارد. همچنین امتیاز هر سلول باید
     بهترین تطبیق آن سلول با یک دسته باشد، نه مجموع تطبیق‌های جزئی آن
     با همه‌ی دسته‌ها (وگرنه یک سلول تیتر که تصادفاً چند کلمه‌ی مشابه
     کلیدواژه دارد امتیاز مصنوعی بالا می‌گیرد). */
  function detectHeaderRow(rows) {
    let bestRow = -1, bestScore = 0;
    const limit = Math.min(rows.length, 5);
    for (let r = 0; r < limit; r++) {
      const cells = rows[r];
      let score = 0, nonEmpty = 0;
      for (const c of cells) {
        const cc = cleanCell(c);
        if (!cc) continue;
        nonEmpty++;
        let cellBest = 0;
        for (const cat of Object.keys(KEYWORDS)) cellBest = Math.max(cellBest, scoreHeader(cc, cat));
        score += cellBest;
      }
      // ردیف‌های با کمتر از ۳ سلول غیرخالی نمی‌توانند هدر واقعی جدول باشند
      // (احتمالاً تیتر merge‌شده یا ردیف ناقص هستند)
      if (nonEmpty < 3) continue;
      if (score / nonEmpty > bestScore) { bestScore = score / nonEmpty; bestRow = r; }
    }
    return bestScore >= 30 ? bestRow : -1;
  }

  /* تشخیص واحد قیمت: ابتدا از عنوان، سپس از بزرگی اعداد */
  function detectPriceUnit(priceHeader, values) {
    const h = norm(priceHeader || '');
    if (h.includes('ریال')) return 'rial';
    if (h.includes('تومان')) return 'toman';
    const nums = values.map(parseNumber).filter((n) => !isNaN(n) && n > 0);
    if (nums.length === 0) return 'toman'; // پیش‌فرض محافظه‌کارانه
    nums.sort((a, b) => a - b);
    const median = nums[Math.floor(nums.length / 2)];
    const max = nums[nums.length - 1];
    if (median >= 10000000) return 'rial';
    if (median <= 5000000) return 'toman';
    if (max >= 100000000) return 'rial';
    return 'toman';
  }

  function priceToToman(price, unit) {
    if (price === null || price === undefined || isNaN(price)) return null;
    // همیشه به عدد صحیح تومان گرد می‌شود تا مبلغ نمایش‌داده‌شده دقیقاً همان مبلغی
    // باشد که در محاسبه (قیمت × تعداد) استفاده می‌شود — بدون این کار، اعشار
    // باقی‌مانده از تقسیم ریال بر ۱۰ باعث اختلاف چند تومانی بین «قیمت واحد» نمایشی
    // و «مبلغ کل» در خروجی می‌شد.
    return Math.round(unit === 'rial' ? price / 10 : price);
  }

  /* حدس ستون‌ها در فایل بدون عنوان */
  function guessColumnsByShape(rows, dataStart, colCount) {
    // جمع‌آوری نمونه‌ها از ستون‌ها
    const sample = { code: 0, name: 0, num: [] };
    const numCols = [];
    for (let c = 0; c < colCount; c++) {
      let numeric = 0, alpha = 0, empty = 0, total = 0;
      const nums = [];
      for (let r = dataStart; r < Math.min(rows.length, dataStart + 40); r++) {
        const cell = cleanCell(rows[r][c]);
        if (!cell) { empty++; continue; }
        total++;
        const n = parseNumber(cell);
        if (!isNaN(n)) { numeric++; nums.push(n); }
        else alpha++;
      }
      if (total === 0) continue;
      const numRatio = numeric / total;
      if (numRatio > 0.85) numCols.push({ c, nums });
      else if (numRatio < 0.35) { if (sample.code < 0 || true) { /* غیرعددی */ } }
    }
    // ستون کد: ترکیبی از حروف/ارقام، معمولاً اولین ستون
    let codeCol = -1, nameCol = -1, stockCol = -1, priceCol = -1;
    const nonNumeric = [];
    for (let c = 0; c < colCount; c++) {
      let numeric = 0, total = 0;
      for (let r = dataStart; r < Math.min(rows.length, dataStart + 40); r++) {
        const cell = cleanCell(rows[r][c]);
        if (!cell) continue;
        total++;
        if (!isNaN(parseNumber(cell))) numeric++;
      }
      if (total && numeric / total < 0.5) nonNumeric.push(c);
    }
    if (nonNumeric.length >= 2) {
      codeCol = nonNumeric[0];
      nameCol = nonNumeric[1];
    } else if (nonNumeric.length === 1) {
      codeCol = nonNumeric[0];
      nameCol = -1;
    }
    // دو ستون عددی: بزرگ‌تر = قیمت، کوچک‌تر = موجودی
    // سه ستون عددی: معمولاً موجودی / قیمت واحد / مبلغ کل هستند. مبلغ کل
    // (= موجودی × قیمت واحد) تقریباً همیشه از همه بزرگ‌تر است، پس اگر مثل
    // حالت دوستونی «بزرگ‌ترین = قیمت» فرض شود، اشتباهاً مبلغ کل به‌جای قیمت
    // واحد انتخاب می‌شود. برای همین در حالت سه‌ستونی، ستون میانی (میانه)
    // به‌عنوان قیمت واحد در نظر گرفته می‌شود و بزرگ‌ترین (مبلغ کل) نادیده
    // گرفته می‌شود.
    if (numCols.length >= 2) {
      numCols.sort((a, b) => {
        const ma = a.nums[a.nums.length >> 1] || 0, mb = b.nums[b.nums.length >> 1] || 0;
        return ma - mb;
      });
      stockCol = numCols[0].c;
      if (numCols.length === 3) {
        priceCol = numCols[1].c;
      } else {
        priceCol = numCols[numCols.length - 1].c;
      }
    } else if (numCols.length === 1) {
      priceCol = numCols[0].c;
    }
    // پر کردن ستون‌های خالی با اولین ستون‌های استفاده‌نشده
    const used = new Set([codeCol, nameCol, stockCol, priceCol].filter((x) => x >= 0));
    const free = [];
    for (let c = 0; c < colCount; c++) if (!used.has(c)) free.push(c);
    let fi = 0;
    if (codeCol < 0 && free[fi] !== undefined) codeCol = free[fi++];
    if (nameCol < 0 && free[fi] !== undefined) nameCol = free[fi++];
    if (stockCol < 0 && free[fi] !== undefined) stockCol = free[fi++];
    if (priceCol < 0 && free[fi] !== undefined) priceCol = free[fi++];
    return { code: codeCol, name: nameCol, stock: stockCol, price: priceCol };
  }

  /* ساخت محصولات از ردیف‌های جدول */
  function buildTable(rows, opts = {}) {
    const warnings = [];
    const { priceUnit: forcedUnit } = opts;
    const data = rows.map((r) => (Array.isArray(r) ? r.map(cleanCell) : []));

    const headerRow = opts.forceHeader ? opts.headerRowIndex : detectHeaderRow(data);
    let colMap = opts.colMap || null;
    if (colMap && (colMap.code < 0 || colMap.name < 0) && headerRow >= 0) {
      colMap = mapColumns(data[headerRow]);
    }
    if (!colMap) {
      if (headerRow >= 0) {
        const headers = data[headerRow];
        colMap = mapColumns(headers);
        if (Object.values(colMap).every((v) => v < 0)) {
          colMap = guessColumnsByShape(data, headerRow + 1, (headers || []).length);
        }
      } else {
        const colCount = data.reduce((m, r) => Math.max(m, r.length), 0);
        colMap = guessColumnsByShape(data, 0, colCount);
      }
    }

    const dataStart = headerRow >= 0 ? headerRow + 1 : 0;
    const priceValues = [];
    for (let r = dataStart; r < data.length; r++) {
      const v = colMap.price >= 0 ? parseNumber(data[r][colMap.price]) : NaN;
      if (!isNaN(v) && v > 0) priceValues.push(v);
    }
    const priceHeader = headerRow >= 0 && colMap.price >= 0 ? data[headerRow][colMap.price] : '';
    // اگر خودِ فایل توی هدر ستون قیمت صراحتاً «ریال» یا «تومان» نوشته باشه،
    // این حرف خودِ فایل از تنظیم پیش‌فرض عمومی اپ (forcedUnit) معتبرتره —
    // چون هر فایل می‌تونه واحد متفاوتی داشته باشه (مثلاً انبار اول ریال خامه،
    // ولی انبار دوم از قبل به تومان تبدیل شده و توی هدرش هم نوشته «تومان»).
    const headerHint = norm(priceHeader || '');
    const explicitUnit = headerHint.includes('ریال') ? 'rial' : (headerHint.includes('تومان') ? 'toman' : null);
    const detectedUnit = explicitUnit || forcedUnit || detectPriceUnit(priceHeader, priceValues);
    const unit = detectedUnit;

    const products = [];
    const seen = new Map(); // کد نرمال‌شده → index
    let skipped = 0, noPrice = 0, noStock = 0;

    for (let r = dataStart; r < data.length; r++) {
      const row = data[r];
      const isEmpty = row.every((c) => !c);
      if (isEmpty) continue;
      const code = (colMap.code >= 0 ? Utils.toLatinDigits(String(row[colMap.code] || '')) : '').trim();
      const name = (colMap.name >= 0 ? row[colMap.name] : '').trim();
      if (!code && !name) { skipped++; continue; }

      // اگر فایل چند بخش/جدول پشت‌سرهم داشته باشه (هرکدوم با ردیف هدر
      // خودش)، ردیف‌های هدر تکراریِ وسط فایل نباید به‌عنوان یه محصول با
      // کد «کد کالا» خونده بشن — تشخیص می‌دیم و کامل نادیده می‌گیریم.
      const normCodeCell = norm(code).replace(/\s+/g, '');
      const looksLikeRepeatedHeader = normCodeCell && KEYWORDS.code.some((kw) => norm(kw).replace(/\s+/g, '') === normCodeCell);
      if (looksLikeRepeatedHeader) { skipped++; continue; }

      const rawPrice = colMap.price >= 0 ? parseNumber(row[colMap.price]) : NaN;
      const rawStock = colMap.stock >= 0 ? parseNumber(row[colMap.stock]) : NaN;
      const price = isNaN(rawPrice) ? null : rawPrice;
      const stock = (isNaN(rawStock) || rawStock < 0) ? (isNaN(rawStock) ? null : 0) : Math.round(rawStock);
      if (price === null) noPrice++;
      if (stock === null) noStock++;

      const priceToman = priceToToman(price, unit);
      // نکته مهم: کلید تشخیص تکراری باید فقط «کد» باشه، نه «کد+نام» —
      // چون محدودیت یکتایی خود دیتابیس هم فقط روی کد است. اگه یه کد با
      // دو تا نوشتار کمی متفاوت از نام (فاصله اضافه، حروف متفاوت و…) در
      // فایل تکرار بشه ولی کلید شامل نام هم باشه، این‌جا به‌عنوان دو
      // محصول جدا در نظر گرفته می‌شه، ولی موقع ذخیره در دیتابیس هر دو
      // می‌خوان با همون کد یکسان درج بشن → خطای duplicate key.
      // اگه کد خالی بود (محصول بدون کد)، به‌ناچار از نام برای جلوگیری
      // از ادغام نادرست محصولات بی‌کد مختلف استفاده می‌شود.
      const key = code ? norm(code) : norm('__nocode__|' + name);
      const prod = {
        code, name: name || '—', stock, price, priceToman,
        unit, normName: norm(name), normCode: norm(code), importedAt: new Date().toISOString()
      };
      if (seen.has(key)) {
        const existing = products[seen.get(key)];
        // ادغام: جمع موجودی، قیمت آخر
        if (existing.stock !== null && stock !== null) existing.stock += stock;
        if (priceToman !== null) { existing.price = price; existing.priceToman = priceToman; }
        warnings.push('کد تکراری «' + code + '» در فایل: موجودی‌ها جمع شد.');
      } else {
        seen.set(key, products.length);
        products.push(prod);
      }
    }

    if (headerRow >= 0 && Object.values(colMap).every((v) => v < 0)) {
      warnings.push('ساختار جدول شناسایی نشد؛ ستون‌ها حدس زده شدند.');
    }
    return { products, warnings, detectedUnit: unit, skipped, noPrice, noStock, colMap, headerRow, totalRows: data.length };
  }

  return {
    KEYWORDS, cleanCell, scoreHeader, mapColumns, detectHeaderRow,
    detectPriceUnit, priceToToman, guessColumnsByShape, buildTable, norm, parseNumber
  };
});

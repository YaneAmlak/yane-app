'use strict';
/* ============================================================
   پارسر PDF — استخراج جدول از PDF متنی (pdf.js)
   و OCR برای PDF اسکن‌شده (Tesseract.js با زبان فارسی)
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root, {});
  } else {
    root.PdfParser = factory(root, { pdfjs: root.pdfjsLib, Tesseract: root.Tesseract });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, deps) {
  const ParserCore = (typeof module !== 'undefined' && module.exports)
    ? require('./parser-core.js')
    : root.ParserCore;
  const parseNumber = ParserCore.parseNumber;
  const normNum = ParserCore.norm; // نرمال‌سازی (شامل تبدیل ارقام فارسی به لاتین)

  /* آیا توکن فقط رقم و جداکننده است؟ */
  function looksNumeric(t) {
    const latin = normNum(t).replace(/\s+/g, '').trim();
    return /^[\d.,]+$/.test(latin) && /\d/.test(latin);
  }

  function parseNumberStrict(t) {
    if (!looksNumeric(t)) return NaN;
    return parseNumber(t);
  }

  /* ساخت خطوط از آیتم‌های متنی pdf.js */
  function buildLines(items) {
    const arr = items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ t: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 8, h: it.height || 10 }));
    arr.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let cur = null;
    for (const it of arr) {
      if (cur && Math.abs(cur.y - it.y) < Math.max(it.h, cur.h) * 0.6) {
        cur.tokens.push(it);
        cur.h = Math.max(cur.h, it.h);
        cur.y = (cur.y * cur.count + it.y) / (cur.count + 1);
        cur.count++;
      } else {
        cur = { y: it.y, h: it.h, count: 1, tokens: [it] };
        lines.push(cur);
      }
    }
    for (const l of lines) l.tokens.sort((a, b) => a.x - b.x);
    return lines;
  }

  /* ادغام توکن‌های عددی مجاور (مثلاً ۱ و ۲۰۰٬۰۰۰ جدا شده باشند) */
  function mergeAdjacentNumeric(tokens) {
    const merged = [];
    for (const tk of tokens) {
      const last = merged[merged.length - 1];
      if (last && last.x + last.w + 5 >= tk.x && looksNumeric(last.t) && looksNumeric(tk.t)) {
        last.t = last.t + tk.t;
        last.w = tk.x + tk.w - last.x;
      } else {
        merged.push({ ...tk });
      }
    }
    return merged;
  }

  /* آیا توکن شبیه کد کالاست؟ */
  function looksLikeCode(t) {
    const s = t.trim();
    return /^[A-Za-z0-9_\-./:#]+$/.test(s) && s.length <= 24 && s.length >= 1;
  }

  /* تجزیه یک خط به ردیف جدول: کد | نام | موجودی | قیمت
     از هر دو چیدمان چپ‌به‌راست و راست‌به‌چپ پشتیبانی می‌کند.
     قاعده: قیمت = بزرگ‌ترین عدد، موجودی = عدد مجاور قیمت، کد = عدد/توکن انتهایی */
  function parseLine(tokens) {
    const merged = mergeAdjacentNumeric(tokens);
    const numIdx = [];
    merged.forEach((tk, i) => {
      const n = parseNumberStrict(tk.t);
      if (!isNaN(n)) numIdx.push({ i, n, x: tk.x + (tk.w || 8) / 2, tk });
    });
    if (numIdx.length === 0) return null;

    // اگر ردیف یک ستون «مبلغ کل» هم داشته باشد (موجودی × قیمت واحد)، آن عدد
    // تقریباً همیشه از همه بزرگ‌تر است و اگر قاعدهٔ «بزرگ‌ترین = قیمت» بدون
    // توجه به این موضوع اجرا شود، مبلغ کل به‌جای قیمت واحد انتخاب می‌شود.
    // اینجا رابطهٔ ضربی «الف × ب ≈ ج» را بین سه‌تایی از اعداد سطر جست‌وجو
    // می‌کنیم؛ اگر پیدا شد، آن عدد (مبلغ کل) از کاندیدهای قیمت/موجودی کنار
    // گذاشته می‌شود.
    let totalTok = null;
    if (numIdx.length >= 3) {
      search:
      for (const a of numIdx) {
        for (const b of numIdx) {
          if (a === b) continue;
          const product = a.n * b.n;
          if (!product) continue;
          for (const c of numIdx) {
            if (c === a || c === b) continue;
            if (Math.abs(c.n - product) / product < 0.01) { totalTok = c; break search; }
          }
        }
      }
    }
    const candidates = totalTok ? numIdx.filter((it) => it !== totalTok) : numIdx;

    let priceTok = null, stockTok = null;
    // قیمت = عدد با بیشترین مقدار (در میان کاندیدها، بدون مبلغ کل)
    let priceN = -Infinity;
    candidates.forEach((it) => { if (it.n > priceN) { priceN = it.n; priceTok = it; } });
    // موجودی = عددی که از نظر افقی به قیمت نزدیک‌تر است (و کوچک‌ترین مقدار)
    if (candidates.length >= 2) {
      let best = null, bestD = Infinity;
      candidates.forEach((it) => {
        if (it === priceTok) return;
        const d = Math.abs(it.x - priceTok.x);
        if (d < bestD) { bestD = d; best = it; }
      });
      stockTok = best;
    }
    const usedIdx = new Set([priceTok.i, stockTok ? stockTok.i : -1, totalTok ? totalTok.i : -1]);
    // کد: عدد باقی‌مانده (اگر دقیقاً یکی باشد)
    const leftoverNum = numIdx.filter((it) => !usedIdx.has(it.i));
    let code = '';
    if (leftoverNum.length === 1 && looksLikeCode(merged[leftoverNum[0].i].t)) {
      code = merged[leftoverNum[0].i].t.trim();
      usedIdx.add(leftoverNum[0].i);
    }
    // نام: توکن‌های غیرعددی باقی‌مانده
    const nameTokens = merged.filter((tk, i) => !usedIdx.has(i) && !looksNumeric(tk.t));
    let name = nameTokens.map((tk) => tk.t).join(' ').replace(/\s+/g, ' ').trim();
    // اگر کد هنوز پیدا نشده: دورترین توکن غیرعددی (نسبت به ستون قیمت) که شبیه کد باشد
    if (!code && nameTokens.length >= 2) {
      let far = null, farD = -1;
      nameTokens.forEach((tk) => {
        const d = Math.abs((tk.x + (tk.w || 8) / 2) - (priceTok ? priceTok.x : 0));
        if (d > farD) { farD = d; far = tk; }
      });
      if (far && looksLikeCode(far.t)) {
        code = far.t.trim();
        name = nameTokens.filter((tk) => tk !== far).map((tk) => tk.t).join(' ').replace(/\s+/g, ' ').trim();
      }
    }
    if (!code && !name) return null;
    // ردیف‌های سربرگ/پاصفحه مثل «صفحه ۱» یا «۱ از ۵»
    const text = normNum(merged.map((tk) => tk.t).join(' ')).replace(/\s+/g, ' ');
    if (/^(صفحه|برگه|چاپ)\s*\d/.test(text) || /^\d+\s*از\s*\d+$/.test(text)) return null;
    return { code, name, stock: stockTok ? stockTok.tk.t : '', price: priceTok ? priceTok.tk.t : '' };
  }

  /* خطوط → سلول‌های ردیف‌ها */
  function linesToCells(lines) {
    const cells = [];
    for (const line of lines) {
      const parsed = parseLine(line.tokens);
      if (parsed) cells.push([parsed.code, parsed.name, parsed.stock, parsed.price]);
    }
    return cells;
  }

  function setDeps(d) { Object.assign(deps, d || {}); }

  function getPdfjs() {
    if (deps.pdfjs) return deps.pdfjs;
    return root.pdfjsLib;
  }

  function getTesseract() {
    if (deps.Tesseract) return deps.Tesseract;
    return root.Tesseract;
  }

  function pdfJsLoad(data) {
    const pdfjs = getPdfjs();
    if (!pdfjs) throw new Error('کتابخانه PDF در دسترس نیست.');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = (typeof module !== 'undefined' && module.exports)
        ? deps.workerSrc
        : (root.PdfWorkerSrc || 'vendor/pdf.worker.min.js');
    }
    // امنیت (CVE-2024-4367): اجرای eval برای فونت‌ها خاموش است؛ فقط استخراج متن/رندر لازم است
    return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  }

  /* ---------- OCR ---------- */

  function toLatinDigitsLocal(s) {
    return String(s)
      .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  }

  async function ocrPage(worker, canvas) {
    const { data } = await worker.recognize(canvas);
    const lines = [];
    for (const l of (data && data.lines ? data.lines : [])) {
      (l.text || '').split('\n').forEach((t) => { if (t.trim()) lines.push(t); });
    }
    return lines;
  }

  /* تبدیل خط متن OCR (به ترتیب منطقی) به سلول‌ها */
  function ocrLineToCells(lineText) {
    let s = String(lineText).replace(/[\u200E\u200F\u202A-\u202E]/g, ' ').replace(/\s+/g, ' ').trim();
    s = toLatinDigitsLocal(s);
    if (/^(صفحه|برگه|چاپ)\s*\d/.test(s) || /^\d+\s*از\s*\d+$/.test(s)) return null;
    let m = s.match(/^(\S+)\s+(.+?)\s+(\d[\d.,]*)\s+(\d[\d.,]*)$/);
    if (m) return [m[1], m[2], m[3], m[4]];
    m = s.match(/^(\S+)\s+(.+?)\s+(\d[\d.,]*)$/);
    if (m) return [m[1], m[2], '', m[3]];
    return null;
  }

  async function createTesseractWorker({ Tesseract, paths }) {
    const worker = await Tesseract.createWorker({
      workerPath: paths.workerPath || 'vendor/tesseract/worker.min.js',
      corePath: paths.corePath || 'vendor/tesseract/tesseract-core.wasm.js',
      langPath: paths.langPath || 'vendor/tesseract/',
      gzip: false,
      logger: () => {}
    });
    // در برخی نسخه‌ها زبان خودکار لود نمی‌شود؛ صریحاً لود می‌کنیم
    await worker.loadLanguage('fas');
    await worker.initialize('fas', 1);
    return worker;
  }

  /* ---------- ورودی اصلی ---------- */

  /**
   * parseFile(buffer, opts)
   * opts: { onStatus, onProgress, forceOcr }
   * خروجی: { cells, isScanned, usedOcr, pageCount, needsOcr }
   */
  async function parseFile(buffer, opts = {}) {
    const { onStatus = () => {}, onProgress = () => {}, forceOcr } = opts;
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    onStatus('در حال باز کردن PDF...');
    const pdf = await pdfJsLoad(data);

    onStatus('در حال استخراج متن از PDF...');
    const allLines = [];
    let totalChars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const lines = buildLines(tc.items);
      allLines.push(...lines);
      for (const l of lines) for (const tk of l.tokens) totalChars += tk.t.length;
      onProgress(p, pdf.numPages);
    }
    const avgChars = pdf.numPages ? totalChars / pdf.numPages : 0;
    const isScanned = totalChars < 60 && avgChars < 25;

    if (isScanned && !forceOcr) {
      return { cells: [], isScanned: true, usedOcr: false, needsOcr: true, pageCount: pdf.numPages };
    }

    if (isScanned && forceOcr) {
      const Tesseract = getTesseract();
      if (!Tesseract) throw new Error('کتابخانه OCR در دسترس نیست.');
      onStatus('فایل اسکن‌شده است؛ در حال خواندن با OCR (چند لحظه صبر کنید)...');
      const worker = await createTesseractWorker({ Tesseract, paths: opts.tesseractPaths || {} });
      const cells = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: opts.ocrScale || 2.2 });
        const canvas = root.document ? root.document.createElement('canvas') : null;
        if (!canvas) throw new Error('رندر صفحه PDF در این محیط ممکن نیست.');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const lines = await ocrPage(worker, canvas);
        for (const lineText of lines) {
          const c = ocrLineToCells(lineText);
          if (c) cells.push(c);
        }
        onProgress(p, pdf.numPages);
      }
      await worker.terminate();
      return { cells, isScanned: true, usedOcr: true, pageCount: pdf.numPages };
    }

    const cells = linesToCells(allLines);
    return { cells, isScanned: false, usedOcr: false, pageCount: pdf.numPages };
  }

  return { parseFile, buildLines, parseLine, linesToCells, ocrLineToCells, looksNumeric, parseNumberStrict, setDeps };
});

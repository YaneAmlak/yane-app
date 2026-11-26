'use strict';
/* ============================================================
   نقطه ورود پردازش فایل: تشخیص نوع (PDF / Excel / CSV) و اجرا
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root);
  } else {
    root.FileImporter = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const ParserCore = (typeof module !== 'undefined' && module.exports)
    ? require('./parser-core.js')
    : root.ParserCore;
  const CsvParser = (typeof module !== 'undefined' && module.exports)
    ? require('./csv.js')
    : root.CsvParser;
  const ExcelParser = (typeof module !== 'undefined' && module.exports)
    ? require('./excel.js')
    : root.ExcelParser;
  const PdfParser = (typeof module !== 'undefined' && module.exports)
    ? require('./pdf.js')
    : root.PdfParser;

  function detectType(file) {
    const name = String(file.name || '').toLowerCase();
    const mime = String(file.type || '').toLowerCase();
    if (/\.pdf$/.test(name) || mime === 'application/pdf') return 'pdf';
    if (/\.(xlsx|xls)$/.test(name) || /spreadsheet|excel|officedocument/.test(mime)) return 'excel';
    if (/\.csv$/.test(name) || /csv|text\//.test(mime) || /\.txt$/.test(name)) return 'csv';
    return 'unknown';
  }

  function sniffType(buffer) {
    const head = new Uint8Array(buffer.slice(0, 8));
    const txt = String.fromCharCode.apply(null, head);
    if (txt.startsWith('%PDF')) return 'pdf';
    if (head[0] === 0x50 && head[1] === 0x4B) return 'excel'; // ZIP (xlsx)
    if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11) return 'excel'; // OLE (xls)
    return 'csv';
  }

  /**
   * parseFile(file, opts)
   * opts: { warehouse, priceUnit, onStatus, onProgress, forceOcr }
   * خروجی: { products, warnings, detectedUnit, source, meta, needsOcr, pageCount }
   */
  async function parseFile(file, opts = {}) {
    const { onStatus = () => {}, onProgress = () => {}, priceUnit: forcedUnit, forceOcr } = opts;
    const buffer = await file.arrayBuffer();
    let type = detectType(file);
    if (type === 'unknown') type = sniffType(buffer);

    onStatus('در حال آماده‌سازی فایل «' + file.name + '»...');

    let rows = null, cells = null, result, isScanned = false, needsOcr = false, pageCount = null;

    if (type === 'csv') {
      result = await CsvParser.parseFile(buffer, { onStatus });
      rows = result.rows;
    } else if (type === 'excel') {
      result = await ExcelParser.parseFile(buffer, { onStatus });
      rows = result.rows;
    } else if (type === 'pdf') {
      const pr = await PdfParser.parseFile(buffer, { onStatus, onProgress, forceOcr });
      isScanned = pr.isScanned;
      needsOcr = pr.needsOcr;
      pageCount = pr.pageCount;
      cells = pr.cells;
      if (needsOcr) {
        return {
          products: [], warnings: [], detectedUnit: 'toman', source: 'pdf',
          needsOcr: true, isScanned: true, pageCount, fileMeta: makeMeta(file, 0, 'pdf')
        };
      }
      result = { detectedUnit: 'toman' }; // واحد توسط buildTable تعیین می‌شود
    } else {
      throw new Error('فرمت فایل پشتیبانی نمی‌شود. لطفاً PDF یا Excel یا CSV انتخاب کنید.');
    }

    const colMap = type === 'pdf' ? { code: 0, name: 1, stock: 2, price: 3 } : null;
    const table = ParserCore.buildTable(type === 'pdf' ? cells : rows, {
      colMap,
      priceUnit: forcedUnit || undefined
    });

    return {
      products: table.products,
      warnings: table.warnings || [],
      detectedUnit: table.detectedUnit,
      source: type,
      needsOcr: false,
      isScanned,
      pageCount,
      meta: makeMeta(file, table.products.length, type),
      table,
      inputRows: type === 'pdf' ? cells : rows // برای بازپردازش با واحد قیمت دیگر
    };
  }

  function makeMeta(file, rowCount, source) {
    return {
      fileName: file.name,
      fileSize: file.size,
      fileType: source,
      uploadedAt: new Date().toISOString(),
      rowCount
    };
  }

  return { parseFile, detectType, sniffType };
});

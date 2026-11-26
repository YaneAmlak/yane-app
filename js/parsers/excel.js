'use strict';
/* ============================================================
   پارسر اکسل (XLSX / XLS) با کتابخانه SheetJS
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root);
  } else {
    root.ExcelParser = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const ParserCore = (typeof module !== 'undefined' && module.exports)
    ? require('./parser-core.js')
    : root.ParserCore;

  function getXLSX() {
    if (typeof module !== 'undefined' && module.exports) {
      try { return require('xlsx'); } catch (e) { return global.XLSX; }
    }
    return root.XLSX;
  }

  async function parseFile(buffer, { onStatus } = {}) {
    const XLSX = getXLSX();
    if (!XLSX) throw new Error('کتابخانه اکسل در دسترس نیست.');
    onStatus && onStatus('در حال خواندن فایل اکسل...');
    const wb = XLSX.read(buffer, { type: 'array', dense: false });
    // انتخاب اولین شیت غیرخالی
    let sheetName = null, maxCells = 0;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const ref = ws && ws['!ref'];
      if (!ref) continue;
      const range = XLSX.utils.decode_range(ref);
      const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (cells > maxCells) { maxCells = cells; sheetName = name; }
    }
    if (!sheetName) throw new Error('فایل اکسل خالی است.');
    onStatus && onStatus('در حال خواندن شیت «' + sheetName + '»...');
    const ws = wb.Sheets[sheetName];
    // فرمول‌ها محاسبه شوند
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr];
          if (cell && cell.t === 'n' && typeof cell.v === 'number') cell.w = String(cell.v);
        }
      }
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const result = ParserCore.buildTable(rows, {});
    return { ...result, source: 'excel', sheetName, rows };
  }

  return { parseFile, getXLSX };
});

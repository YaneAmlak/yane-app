'use strict';
/* ============================================================
   پارسر فایل CSV — پشتیبانی از جداکننده‌های مختلف و کدبندی فارسی
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root);
  } else {
    root.CsvParser = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const ParserCore = (typeof module !== 'undefined' && module.exports)
    ? require('./parser-core.js')
    : root.ParserCore;

  function detectDelimiter(text) {
    const first = text.split(/\r?\n/).find((l) => l.trim());
    if (!first) return ',';
    let best = ',', bestCount = 0;
    for (const d of [',', ';', '\t', '|']) {
      const c = first.split(d).length - 1;
      if (c > bestCount) { bestCount = c; best = d; }
    }
    return best;
  }

  /* تجزیه CSV با پشتیبانی از کوتیشن */
  function splitLine(line, delim) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === delim) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parse(text) {
    const delim = detectDelimiter(text);
    const lines = text.split(/\r?\n/);
    const rows = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      rows.push(splitLine(line, delim));
    }
    return rows;
  }

  async function parseFile(buffer) {
    // تشخیص کدبندی: اول UTF-8، اگر ناخوانا بود windows-1256
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad > 0 && bad > text.length * 0.02) {
      try { text = new TextDecoder('windows-1256').decode(buffer); } catch (e) { /* utf-8 بماند */ }
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
    const rows = parse(text);
    const result = ParserCore.buildTable(rows, {});
    return { ...result, source: 'csv', rows };
  }

  return { parse, parseFile, detectDelimiter };
});

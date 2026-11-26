'use strict';
/* ============================================================
   Web Worker پردازش فایل انبار — Excel/CSV/PDF متنی (بدون OCR)
   خارج از Main Thread اجرا می‌شود تا با فایل‌های حجیم، رابط
   کاربری قفل نشود. مسیر OCR (PDF اسکن‌شده) عمداً این‌جا نیست،
   چون به Canvas نیاز دارد که در Worker وجود ندارد؛ آن مسیر
   همچنان در رشتهٔ اصلی (app.js) اجرا می‌شود.
   ============================================================ */

// مسیر Worker داخلی pdf.js — نسبت به مسیر همین فایل (js/) تنظیم می‌شود
self.PdfWorkerSrc = new URL('../vendor/pdf.worker.min.js', self.location.href).href;

importScripts(
  '../vendor/xlsx.full.min.js',
  './utils.js',
  './parsers/parser-core.js',
  './parsers/csv.js',
  './parsers/excel.js',
  './parsers/pdf.js',
  './parsers/index.js'
);

// PDF.js 5.x فقط ES Module است و با importScripts بارگذاری نمی‌شود؛ با import() پویا (در Worker کلاسیک مجاز است)
// اگر بارگذاری نشد، فقط مسیر PDF خطا می‌دهد و برنامه خودش به رشتهٔ اصلی برمی‌گردد (Excel/CSV بی‌اثر می‌مانند)
const pdfjsReady = import(new URL('../vendor/pdf.min.js', self.location.href).href)
  .then((m) => { self.pdfjsLib = m; })
  .catch(() => { /* بی‌اثر */ });

self.onmessage = async (e) => {
  const { file, opts } = e.data || {};
  try {
    await pdfjsReady;
    const result = await self.FileImporter.parseFile(file, {
      warehouse: opts && opts.warehouse,
      priceUnit: opts && opts.priceUnit,
      forceOcr: false, // این Worker هیچ‌وقت OCR انجام نمی‌دهد
      onStatus: (m) => self.postMessage({ type: 'status', message: m }),
      onProgress: (done, total) => self.postMessage({ type: 'progress', done, total })
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};

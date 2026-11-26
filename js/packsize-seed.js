'use strict';
/* ============================================================
   داده اولیه اندازه بسته/کارتن — یک‌بار مصرف
   بعد از اجرا، این مقادیر داخل PackSize (قابل ویرایش/حذف توسط
   کاربر از داخل خود اپ) ذخیره می‌شوند. اجرای دوباره این فایل چیزی
   را که کاربر بعداً تغییر داده بازنویسی نمی‌کند.
   ============================================================ */

const PackSizeSeedData = [
  { code: '90126', size: 12 }, // ساج وازلین معطر / سبز
  { code: '90127', size: 12 }, // ساج وازلین ویتامینه / آبی
  { code: '70199', size: 12 }, // قطره دنتول
  { code: '70164', size: 24 }, // پودر دکلره پاییزان
  { code: '55024', size: 24 }, // وازلین ۱۲۰گرمی دارویی آناهیتا
  { code: '55025', size: 24 }, // وازلین ۱۲۰گرمی آناهیتا حاوی عصاره آلوورا
  { code: '52002', size: 126 }, // بی‌بی‌چک کاستی مدیکور
  { code: '27001', size: 102 }, // بی‌بی‌چک ویتاساین
  { code: '70292', size: 12 }, // گاز وازلینه شاهد

  // نخ دندان (عمومی = ۲۰، فوق نازک = ۱۲)
  { code: '10525', size: 20 }, { code: '24014', size: 20 },
  { code: '49001', size: 20 }, { code: '49002', size: 20 },
  { code: '49003', size: 20 }, { code: '49006', size: 12 },
  { code: '49007', size: 20 }, { code: '49008', size: 20 },
  { code: '50301', size: 20 }, { code: '70250', size: 12 },
  { code: '70326', size: 20 },

  // آبنبات سرد ساری انس
  { code: '51001', size: 12 }, { code: '51002', size: 12 },
  { code: '51003', size: 12 }, { code: '51004', size: 12 },
  { code: '51005', size: 12 }, { code: '51006', size: 12 },
  { code: '51007', size: 12 }, { code: '51008', size: 12 },
  { code: '51009', size: 12 }, { code: '51010', size: 12 },
  { code: '51011', size: 12 },

  // تافت درکس
  { code: '50401', size: 6 }, { code: '50402', size: 6 }, { code: '50403', size: 6 },

  // گوش پاک‌کن
  { code: '50201', size: 12 }, { code: '50202', size: 12 },
  { code: '50203', size: 12 }, { code: '50601', size: 12 },
  { code: '59001', size: 12 },

  { code: '70245', size: 60 }, // چسب دندان اپتی فیکس
  { code: '70198', size: 300, note: '۴۰ بسته در هر کارتن' }, // چسب زخم پزشکی KM
  { code: '22401', size: 6 }, { code: '22402', size: 6 }, // اسپری موبر 2me
  { code: '70108', size: 24 } // چسب میخچه آجیکور
];

async function runPackSizeSeed() {
  try {
    const done = await DB.getSetting('packSizeSeed_v1', false);
    if (done) return;
    await PackSize.bulkSet(PackSizeSeedData);
    await DB.setSetting('packSizeSeed_v1', true);
  } catch (e) { /* بی‌اثر — دفعه بعد دوباره تلاش می‌شود */ }
}

if (typeof globalThis !== 'undefined') globalThis.runPackSizeSeed = runPackSizeSeed;

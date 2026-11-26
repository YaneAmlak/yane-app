'use strict';
/* ============================================================
   پشتیبانی — منطق خالص (بدون DOM/دیتابیس): اعتبارسنجی پیام، لینک‌های تماس سریع
   ✏️ راه‌های تماس سریع را همین‌جا در CONTACTS پر کن؛ خالی = دکمه‌اش نمایش داده نمی‌شود.
     telegram: آیدی بدون @ (مثلاً 'yane_support')      bale: آیدی بله
     whatsapp: شماره با کد کشور یا 09…  (مثلاً '09121234567')   phone: شماره‌ی تماس
   ============================================================ */
const SupportCore = (() => {
  const CONTACTS = { telegram: '', bale: '', whatsapp: '', phone: '' };
  const SUBJECTS = ['مشکل فنی', 'اشتراک و پرداخت', 'پیشنهاد', 'سایر'];
  const MAX_BODY = 2000, MAX_SUBJECT = 80;

  const cleanBody = (s) => String(s == null ? '' : s).replace(/\r/g, '').trim();
  const cleanSubject = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT);

  function validateMessage(body) {
    const b = cleanBody(body);
    if (!b) return { ok: false, error: 'متن پیام را بنویس.' };
    if (b.length > MAX_BODY) return { ok: false, error: 'پیام خیلی طولانی است (حداکثر ۲۰۰۰ حرف).' };
    return { ok: true, value: b };
  }
  const digits = (s) => String(s == null ? '' : s).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  const handle = (s) => String(s == null ? '' : s).trim().replace(/^https?:\/\/(t\.me|ble\.ir|telegram\.me)\//i, '').replace(/^@/, '');
  const okHandle = (h) => /^[A-Za-z0-9_]{3,64}$/.test(h);

  /* لینک‌های تماس سریع؛ ورودی نامعتبر یا خالی نادیده گرفته می‌شود */
  function contactLinks(c) {
    c = c || CONTACTS; const out = [];
    const tg = handle(c.telegram); if (okHandle(tg)) out.push({ key: 'telegram', label: 'تلگرام', href: 'https://t.me/' + tg });
    const bl = handle(c.bale); if (okHandle(bl)) out.push({ key: 'bale', label: 'بله', href: 'https://ble.ir/' + bl });
    let wa = digits(c.whatsapp); if (/^0\d{10}$/.test(wa)) wa = '98' + wa.slice(1);
    if (/^\d{8,15}$/.test(wa)) out.push({ key: 'whatsapp', label: 'واتساپ', href: 'https://wa.me/' + wa });
    const ph = digits(c.phone); if (/^\d{6,15}$/.test(ph)) out.push({ key: 'phone', label: 'تماس', href: 'tel:' + ph });
    return out;
  }
  const statusLabel = (s) => (s === 'closed' ? 'بسته' : 'باز');
  const preview = (s, n) => { const t = cleanBody(s).replace(/\s+/g, ' '); return t.length > (n || 60) ? t.slice(0, n || 60) + '…' : t; };

  return { CONTACTS, SUBJECTS, MAX_BODY, MAX_SUBJECT, cleanBody, cleanSubject, validateMessage, contactLinks, statusLabel, preview };
})();
if (typeof globalThis !== 'undefined') globalThis.SupportCore = SupportCore;
if (typeof module !== 'undefined' && module.exports) module.exports = SupportCore;

'use strict';
/* ============================================================
   انتقال یک‌بارمصرف دیتای قدیمی
   ------------------------------------------------------------
   نسخهٔ قبلی aliases/packSizes رو به‌صورت یک آبجکت JSON واحد زیر
   کلیدهای settings («productAliases» و «packSizes») ذخیره می‌کرد.
   این دیتا هنوز همون‌جاست (پاک نشده)، فقط سیستم جدید دیگه ازش
   نمی‌خونه. این اسکریپت یک‌بار همون دیتای قدیمی رو می‌خونه و به
   جدول‌های جدید (product_aliases / pack_sizes) منتقل می‌کنه.
   بعد از اجرای موفق، یک پرچم ثبت می‌شه تا دوباره اجرا نشه.
   ============================================================ */

async function runLegacyAliasPackMigration() {
  try {
    const done = await DB.getSetting('legacyAliasPackMigration_v1', false);
    if (done) return;

    const oldAliases = (await DB.getSetting('productAliases', null)) || {};
    const oldPackSizes = (await DB.getSetting('packSizes', null)) || {};

    const aliasEntries = Object.keys(oldAliases)
      .map((code) => ({ code, aliases: oldAliases[code] || [] }))
      .filter((e) => e.aliases.length);
    if (aliasEntries.length) await DB.bulkAddAliases(aliasEntries);

    const packEntries = Object.keys(oldPackSizes)
      .map((code) => {
        const v = oldPackSizes[code] || {};
        return { code, size: v.size, note: v.note };
      })
      .filter((e) => e.size);
    if (packEntries.length) await DB.bulkSetPackSizes(packEntries);

    await DB.setSetting('legacyAliasPackMigration_v1', true);
  } catch (e) {
    /* بی‌اثر — اگه به هر دلیلی (مثلاً قطعی اینترنت) شکست بخوره، دفعه
       بعد که اپ باز بشه دوباره تلاش می‌کنه، چون پرچم ثبت نشده */
  }
}

if (typeof globalThis !== 'undefined') globalThis.runLegacyAliasPackMigration = runLegacyAliasPackMigration;
if (typeof module !== 'undefined' && module.exports) module.exports = runLegacyAliasPackMigration;

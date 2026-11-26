'use strict';
/* ============================================================
   آرشیو داروخانه‌ها — گروه‌بندی خودکار سفارش‌ها بر اساس داروخانه
   (مشتق از سفارش‌ها؛ ویرایش سفارش به‌صورت خودکار آرشیو را به‌روز می‌کند)
   ============================================================ */

const Archive = (() => {
  function keyOf(order) {
    return Utils.norm(order && order.pharmacyName || '');
  }

  /* سازگاری با سفارش‌های قدیمی (بدون فیلدهای جدید) */
  function normalizeOrder(o) {
    return {
      ...o,
      visitorName: o.visitorName || '',
      pharmacyName: o.pharmacyName || '',
      pharmacyAddress: o.pharmacyAddress || '',
      pharmacyArea: o.pharmacyArea || '',
      pharmacyPhone: o.pharmacyPhone || '',
      note: o.note || ''
    };
  }

  function normalizeOrders(orders) {
    return (orders || []).map(normalizeOrder);
  }

  /* گروه‌بندی سفارش‌ها به پرونده‌های داروخانه */
  function groupByPharmacy(orders) {
    const map = new Map();
    for (const raw of normalizeOrders(orders)) {
      const key = keyOf(raw);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: (raw.pharmacyName || '').trim(),
          phone: raw.pharmacyPhone || '',
          address: raw.pharmacyAddress || '',
          area: raw.pharmacyArea || '',
          orders: []
        });
      }
      const ph = map.get(key);
      ph.orders.push(raw);
      if (raw.pharmacyPhone) ph.phone = raw.pharmacyPhone;
      if (raw.pharmacyAddress) ph.address = raw.pharmacyAddress;
      if (raw.pharmacyArea) ph.area = raw.pharmacyArea;
    }
    const arr = Array.from(map.values());
    arr.forEach((ph) => {
      // جدیدترین سفارش اول
      ph.orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      ph.orderCount = ph.orders.length;
      ph.total = ph.orders.reduce((s, o) => s + (o.total || 0), 0);
      ph.lastDate = ph.orders[0].createdAt;
      ph.visitors = Array.from(new Set(ph.orders.map((o) => (o.visitorName || '').trim()).filter(Boolean))).join('، ');
    });
    arr.sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
    return arr;
  }

  /* دسته‌بندی داروخانه‌ها بر اساس منطقه/خیابان (فیلد دستی area) */
  function groupByArea(pharmacies) {
    const map = new Map();
    for (const ph of (pharmacies || [])) {
      const area = (ph.area || '').trim();
      const key = area || '__none__';
      if (!map.has(key)) map.set(key, { area: area || 'بدون منطقه', pharmacies: [] });
      map.get(key).pharmacies.push(ph);
    }
    const groups = Array.from(map.values());
    groups.sort((a, b) => Utils.norm(a.area).localeCompare(Utils.norm(b.area), 'fa'));
    // «بدون منطقه» همیشه آخر (مرتب‌سازی پایدار، ترتیب الفبایی بقیه حفظ می‌شود)
    groups.sort((a, b) => (a.area === 'بدون منطقه' ? 1 : 0) - (b.area === 'بدون منطقه' ? 1 : 0));
    groups.forEach((g) => { g.count = g.pharmacies.length; });
    return groups;
  }

  /* سفارش‌هایی که هنوز داروخانه ندارند (سازگاری با داده قبلی) */
  function ordersWithoutPharmacy(orders) {
    return normalizeOrders(orders)
      .filter((o) => !keyOf(o))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /* جستجو در آرشیو: نام داروخانه، تلفن، ویزیتور، شماره سفارش، تاریخ */
  function searchPharmacies(pharmacies, query) {
    const q = Utils.norm(query || '');
    if (!q) return pharmacies;
    return pharmacies.filter((ph) => {
      const phHay = Utils.norm(ph.name + ' ' + ph.phone + ' ' + ph.address + ' ' + ph.area + ' ' + ph.visitors);
      if (phHay.includes(q)) return true;
      return ph.orders.some((o) => orderSearchableText(o).includes(q));
    });
  }

  function orderSearchableText(order) {
    return Utils.norm([
      order.pharmacyName, order.pharmacyPhone, order.pharmacyAddress,
      order.visitorName, order.no, order.createdAt,
      Utils.faDate(order.createdAt), Utils.faFullDate(order.createdAt),
      Utils.faMonthYear(order.createdAt), Utils.faWeekday(order.createdAt),
      order.note
    ].join(' '));
  }

  return { keyOf, normalizeOrder, normalizeOrders, groupByPharmacy, groupByArea, ordersWithoutPharmacy, searchPharmacies, orderSearchableText };
})();

if (typeof globalThis !== 'undefined') globalThis.Archive = Archive;
if (typeof module !== 'undefined' && module.exports) module.exports = Archive;

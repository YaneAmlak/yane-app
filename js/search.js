'use strict';
/* ============================================================
   جستجوی سریع محصولات (نام، بخشی از نام، کد، بخشی از کد) — فارسی
   ============================================================ */

const Searcher = (() => {
  let products = [];
  let index = []; // [{p, hay}]
  let aliasMap = {}; // code(string) -> [عبارت مستعار,...] — نام‌هایی که داروخانه‌ها/مشتری‌ها می‌گویند اما در فایل انبار نیست

  /* نرمال‌سازی مخصوص جستجو: علاوه بر Utils.norm، نیم‌فاصله و خط‌تیره/زیرخط هم مثل فاصله
     حساب می‌شوند تا «سه‌لایه» = «سه لایه» و «دستمال-کاغذی» = «دستمال کاغذی» باشد. */
  function normText(s) {
    return Utils.norm(s).replace(/[\u200c\u200d\u200e\u200f\u00ad\u2010-\u2015_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function normCodeKey(s) { return Utils.toLatinDigits(String(s || '')).trim(); }

  function buildIndex() {
    index = products.map((p) => {
      const aliases = aliasMap[normCodeKey(p.code)] || [];
      const aliasNorm = aliases.map(normText).filter(Boolean);
      const nn = normText(p.normName || p.name || '');
      const nc = normText(p.normCode || p.code || '');
      const hay = nn + ' ' + nc + ' ' + normText((p.name || '') + ' ' + (p.code || '')) + (aliasNorm.length ? ' ' + aliasNorm.join(' ') : '');
      // hayC: همان متن بدون هیچ فاصله‌ای؛ برای وقتی که کاربر کلمات را چسبیده تایپ می‌کند («سردساری»)
      return { p, hay, hayC: hay.replace(/ /g, ''), nn, nc, aliasNorm };
    });
  }

  function setProducts(list) {
    products = list || [];
    buildIndex();
  }

  /* تنظیم نام‌های مستعار محصولات (برای رفع مشکل «اسم داروخانه‌ای» متفاوت از «اسم فایل انبار») */
  function setAliases(map) {
    // کلیدها (کد محصول) با ارقام فارسی یا انگلیسی ممکن است ذخیره شده باشند؛
    // نرمال‌سازی هر دو طرف به ارقام لاتین تا محصولاتی با کد فارسی هم با
    // alias‌های ثبت‌شده با ارقام انگلیسی (و برعکس) درست تطبیق پیدا کنند.
    const src = map || {};
    aliasMap = {};
    for (const k of Object.keys(src)) {
      const nk = normCodeKey(k);
      if (!aliasMap[nk]) aliasMap[nk] = [];
      aliasMap[nk] = aliasMap[nk].concat(src[k]);
    }
    buildIndex();
  }

  function getProducts() { return products; }

  /* جستجو با توکن‌های نرمال‌شده؛ همه توکن‌ها باید در نام یا کد باشند */
  function search(query, opts = {}) {
    const { warehouse, limit = 200 } = opts;
    const q = normText(query || '');
    const tokens = q.split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const out = [];
    const qc = tokens.join(''); // نسخه‌ی چسبیده‌ی عبارت جستجو
    for (const item of index) {
      if (warehouse && warehouse !== 'all' && String(item.p.warehouse) !== String(warehouse)) continue;
      let ok = true;
      for (const t of tokens) {
        if (!item.hay.includes(t)) { ok = false; break; }
      }
      let loose = false;
      if (!ok) {
        // فالبک: عبارت چسبیده‌ی کاربر داخل متن چسبیده‌ی محصول/مستعار باشد
        if (qc.length >= 3 && item.hayC.includes(qc)) { ok = true; loose = true; } else continue;
      }
      let score = loose ? 20 : 0; // تطبیق چسبیده کمی پایین‌تر از تطبیق معمولی رتبه می‌گیرد
      const nc = item.nc;
      const nn = item.nn;
      const exact = q;
      if (nc === exact) score -= 100;
      else if (nc.startsWith(exact)) score -= 60;
      else if (nc.includes(exact)) score -= 40;
      else if (nn === exact) score -= 55;
      else if (nn.startsWith(exact)) score -= 35;
      else if (nn.includes(exact)) score -= 15;
      // تطبیق با نام مستعار (مثلاً «درمالیفت شماره ۱») امتیاز بالا می‌گیرد
      for (const na of item.aliasNorm) {
        if (na === exact) { score -= 90; break; }
        if (na.includes(exact) || exact.includes(na)) { score -= 45; break; }
      }
      score += Math.min(nn.length, 60);
      out.push({ p: item.p, score });
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, limit).map((r) => r.p);
  }

  /* مرور کامل انبار */
  function browse(warehouse, limit = 500) {
    let list = products;
    if (warehouse && warehouse !== 'all') {
      list = list.filter((p) => String(p.warehouse) === String(warehouse));
    }
    const sorted = list.slice().sort((a, b) => {
      const na = a.normName || '', nb = b.normName || '';
      return na.localeCompare(nb, 'fa');
    });
    return sorted.slice(0, limit);
  }

  return { setProducts, setAliases, getProducts, search, browse };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Searcher; // پشتیبانی از تست در Node
}

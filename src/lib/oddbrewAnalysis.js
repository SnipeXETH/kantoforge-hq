// OddBrew analysis: how many of each cup (by variant) have sold, so stock can
// be bought in to shorten shipping times, plus the maths that turns a sales
// rate + current stock into a "how many to reorder" suggestion.
import { orderRevenue } from "./calc";
import { regionOf, isExcluded } from "./oddbrew";

const squash = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

// Analysis allow-list. When `include` has any keywords, only variants whose
// name contains one of them count in the Stock & analysis tab — so discontinued
// lines drop out. Empty list = include everything (backward compatible).
export function isAnalysed(name, include) {
  const list = include || [];
  if (!list.length) return true;
  const n = squash(name);
  return list.some((k) => k && n.includes(squash(k)));
}

// A stable key for a sold line / a stock item. SKU wins when present (it's what
// the supplier and Shopify agree on); otherwise fall back to the variant name.
export function variantKey(item) {
  const sku = squash(item && item.sku);
  if (sku) return "sku:" + sku;
  return "name:" + squash(item && item.name);
}

const DAY = 86400000;

// Aggregate every sold line item into one row per variant: units, revenue,
// order count, a UK/US/EU split, first/last sale, and a recent sales rate
// (units in the last `recentDays`, expressed per day and per month).
export function salesByVariant(orders, cfg, opts = {}) {
  const recentDays = opts.recentDays || 90;
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const map = new Map();

  for (const o of orders || []) {
    const items = o.items || [];
    if (!items.length) continue;
    const region = regionOf(o.country);
    const rev = orderRevenue(o);
    const orderUnits = items.reduce((s, it) => s + (it.qty || 1), 0) || 1;
    const t = o.date ? new Date(o.date).getTime() : null;
    const recent = t != null && now - t <= recentDays * DAY;

    for (const it of items) {
      if (isExcluded(it.name, cfg)) continue;
      const key = variantKey(it);
      let row = map.get(key);
      if (!row) {
        row = {
          key, name: it.name || "(unnamed)", sku: it.sku || "",
          units: 0, revenue: 0, orders: 0, recentUnits: 0,
          region: { UK: 0, US: 0, EU: 0 },
          firstSale: null, lastSale: null,
        };
        map.set(key, row);
      }
      const qty = it.qty || 1;
      row.units += qty;
      row.orders += 1;
      row.region[region] += qty;
      // Split the order's revenue across its units so per-variant revenue is
      // sensible on multi-line orders (line price isn't always populated).
      row.revenue += (it.price ? it.price * qty : (rev * qty) / orderUnits);
      if (recent) row.recentUnits += qty;
      if (o.date) {
        if (!row.firstSale || o.date < row.firstSale) row.firstSale = o.date;
        if (!row.lastSale || o.date > row.lastSale) row.lastSale = o.date;
      }
      if (!row.sku && it.sku) row.sku = it.sku;
    }
  }

  const rows = Array.from(map.values()).map((r) => {
    const perDay = r.recentUnits / recentDays;
    return {
      ...r,
      revenue: +r.revenue.toFixed(2),
      perDay,
      perMonth: +(perDay * 30).toFixed(1),
    };
  });
  rows.sort((a, b) => b.units - a.units);
  return rows;
}

// Merge sales rows with saved inventory rows (keyed the same way) and work out,
// for each variant, days of stock cover and a suggested reorder quantity.
//   reorder = ceil(perDay × (leadDays + targetCoverDays)) − onHand − incoming
export function mergeInventory(salesRows, inventory, opts = {}) {
  const leadDays = opts.leadDays || 0;
  const targetCover = opts.targetCover || 0;
  const invByKey = new Map((inventory || []).map((r) => [r.key, r]));
  const seen = new Set();

  const rows = (salesRows || []).map((s) => {
    const inv = invByKey.get(s.key) || {};
    seen.add(s.key);
    return combine(s, inv, leadDays, targetCover);
  });

  // Stock items that have never sold still deserve a row (so you can see and
  // manage them), just with zero sales.
  for (const inv of inventory || []) {
    if (seen.has(inv.key)) continue;
    rows.push(combine(
      { key: inv.key, name: inv.name || "(unnamed)", sku: inv.sku || "", units: 0, revenue: 0, orders: 0, recentUnits: 0, region: { UK: 0, US: 0, EU: 0 }, perDay: 0, perMonth: 0, firstSale: null, lastSale: null },
      inv, leadDays, targetCover
    ));
  }
  return rows;
}

function combine(s, inv, leadDays, targetCover) {
  const onHand = Number(inv.onHand) || 0;
  const incoming = Number(inv.incoming) || 0;
  const reorderPoint = inv.reorderPoint != null ? Number(inv.reorderPoint) || 0 : null;
  const shopifyAvailable = inv.shopifyAvailable != null ? Number(inv.shopifyAvailable) : null;
  const available = onHand + incoming;
  const daysCover = s.perDay > 0 ? available / s.perDay : (available > 0 ? Infinity : 0);
  const suggested = s.perDay > 0
    ? Math.max(0, Math.ceil(s.perDay * (leadDays + targetCover)) - available)
    : 0;
  const low = reorderPoint != null ? onHand <= reorderPoint : (s.perDay > 0 && daysCover < leadDays + targetCover);
  return {
    ...s,
    onHand, incoming, reorderPoint, shopifyAvailable,
    available, daysCover, suggested, low,
    shopifyVariantId: inv.shopifyVariantId || null,
    lastSyncedAt: inv.lastSyncedAt || null,
  };
}

// Totals for the strip at the top of the analysis tab.
export function analysisTotals(rows) {
  const units = rows.reduce((s, r) => s + r.units, 0);
  const onHand = rows.reduce((s, r) => s + (r.onHand || 0), 0);
  const incoming = rows.reduce((s, r) => s + (r.incoming || 0), 0);
  const needReorder = rows.filter((r) => r.suggested > 0).length;
  return { variants: rows.length, units, onHand, incoming, needReorder };
}

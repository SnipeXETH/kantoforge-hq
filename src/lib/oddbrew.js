// OddBrew: a separate Shopify store. Reuses KantoForge's CSV parser and
// revenue formula, but with its own IDs, its own (simpler) cost model, and no
// Etsy anywhere.
import { importCsvText } from "./csv";
import { orderRevenue } from "./calc";
import { shopifyFees } from "./fees";

export const ODDBREW_DEFAULTS = {
  storeName: "OddBrew",
  currency: "GBP",
  shopify: { paymentPct: 1.7, paymentFixed: 0.25 }, // Shopify Payments UK online
  cogsPct: 0, // cost of goods as % of revenue
  costPerOrder: 0, // packaging + postage per order
  fixedMonthly: 0, // fixed monthly overhead (rent, subs, etc.)
};

export function mergeConfig(saved) {
  const s = saved || {};
  return {
    ...ODDBREW_DEFAULTS,
    ...s,
    shopify: { ...ODDBREW_DEFAULTS.shopify, ...(s.shopify || {}) },
  };
}

// Parse a Shopify orders CSV export and re-key it for OddBrew.
export function importOddbrewCsv(text) {
  const { format, orders } = importCsvText(text);
  if (format !== "shopify_orders") {
    throw new Error("OddBrew accepts Shopify order exports only (Shopify Admin → Orders → Export).");
  }
  return orders.map((o) => ({ ...o, id: "oddbrew:" + o.orderId, platform: "shopify", channelVia: "shopify" }));
}

export function enrichOddbrew(order, cfg) {
  const revenue = orderRevenue(order);
  const fees = shopifyFees(order, cfg.shopify || ODDBREW_DEFAULTS.shopify).total;
  const cogs = Math.max(0, revenue) * ((cfg.cogsPct || 0) / 100) + (cfg.costPerOrder || 0);
  const profit = revenue - fees - cogs;
  return { ...order, revenue, fees, cogs, profit };
}

function monthsSpanned(orders) {
  const ds = orders.map((o) => o.date).filter(Boolean).sort();
  if (!ds.length) return 1;
  const a = new Date(ds[0]);
  const b = new Date(ds[ds.length - 1]);
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

export function oddbrewTotals(orders, cfg) {
  const rows = orders.map((o) => enrichOddbrew(o, cfg));
  const revenue = rows.reduce((s, o) => s + o.revenue, 0);
  const fees = rows.reduce((s, o) => s + o.fees, 0);
  const cogs = rows.reduce((s, o) => s + o.cogs, 0);
  const grossProfit = revenue - fees - cogs;
  const months = monthsSpanned(orders);
  const fixed = (cfg.fixedMonthly || 0) * months;
  const units = rows.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (i.qty || 0), 0), 0);
  return {
    revenue, fees, cogs, grossProfit,
    fixed, months,
    net: grossProfit - fixed,
    orders: rows.length,
    units,
    aov: rows.length ? revenue / rows.length : 0,
    margin: revenue > 0 ? (grossProfit / revenue) * 100 : null,
  };
}

// Per-month revenue and net profit (monthly profit has one month of fixed
// overhead subtracted, so the bars sum to the net figure).
export function oddbrewMonthly(orders, cfg) {
  const map = new Map();
  for (const o of orders) {
    if (!o.date) continue;
    const m = o.date.slice(0, 7);
    const e = enrichOddbrew(o, cfg);
    const cur = map.get(m) || { month: m, revenue: 0, profit: 0, orders: 0 };
    cur.revenue += e.revenue;
    cur.profit += e.profit;
    cur.orders += 1;
    map.set(m, cur);
  }
  const fixed = cfg.fixedMonthly || 0;
  return Array.from(map.values())
    .map((r) => ({ ...r, profit: r.profit - fixed }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

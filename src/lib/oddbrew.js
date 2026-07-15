// OddBrew: a separate Shopify store. Reuses KantoForge's CSV parser and
// revenue formula, but with its own IDs, its own (simpler) cost model, and no
// Etsy anywhere.
import { importCsvText, parseCSV } from "./csv";
import { orderRevenue } from "./calc";
import { shopifyFees } from "./fees";

function normalizeDay(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let [, mm, dd, yy] = us;
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// Parse a Meta Ads Manager spend export. Two shapes are supported:
//  - a daily breakdown (a "Day"/"Date" column) → per-day totals, or
//  - a campaign table (no Day column, but "Reporting starts/ends") → a single
//    period total, which the caller files against the month it covers.
export function parseMetaSpendCsv(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("That CSV looks empty.");
  const headers = rows[0].map((h) => (h || "").trim());
  const lower = headers.map((h) => h.toLowerCase());
  let dayCol = lower.indexOf("day");
  if (dayCol < 0) dayCol = lower.indexOf("date");
  const startCol = lower.findIndex((h) => h.startsWith("reporting starts"));
  const endCol = lower.findIndex((h) => h.startsWith("reporting ends"));
  const amtCol = lower.findIndex((h) => h.startsWith("amount spent") || h === "spend" || h === "amount");
  if (amtCol < 0) throw new Error("Couldn't find an 'Amount spent' column in this export.");
  // Meta's "Include summary totals" adds a subtotal row with a blank campaign
  // name that repeats the total — skip those so spend isn't double-counted.
  const campCol = lower.findIndex((h) => h === "campaign name" || h === "ad set name" || h === "ad name");
  const isSummary = (r) => campCol >= 0 && !String(r[campCol] == null ? "" : r[campCol]).trim();
  const m = headers[amtCol].match(/\(([A-Za-z]{3})\)/);
  const currency = m ? m[1].toUpperCase() : null;
  const amtOf = (r) => parseFloat(String(r[amtCol] == null ? "" : r[amtCol]).replace(/[£$€,\s]/g, ""));

  if (dayCol >= 0) {
    const byDay = new Map();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (isSummary(r)) continue;
      const day = normalizeDay(r[dayCol]);
      const amt = amtOf(r);
      if (!day || isNaN(amt)) continue;
      byDay.set(day, (byDay.get(day) || 0) + amt);
    }
    const days = Array.from(byDay.entries()).map(([date, amount]) => ({ date, amount: +amount.toFixed(2) })).sort((a, b) => a.date.localeCompare(b.date));
    if (days.length <= 1 && rows.length - 1 > 3) {
      throw new Error("This export collapsed onto a single date — it has no real day-by-day breakdown.");
    }
    return { mode: "daily", currency, days, total: +days.reduce((s, d) => s + d.amount, 0).toFixed(2), from: days[0] && days[0].date, to: days.length ? days[days.length - 1].date : null };
  }

  // Campaign table (no Day column): sum spend, read the reporting window.
  let total = 0, from = null, to = null;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (isSummary(r)) continue;
    const a = amtOf(r);
    if (!isNaN(a)) total += a;
    const s = startCol >= 0 ? normalizeDay(r[startCol]) : null;
    const e = endCol >= 0 ? normalizeDay(r[endCol]) : null;
    if (s && (!from || s < from)) from = s;
    if (e && (!to || e > to)) to = e;
  }
  total = +total.toFixed(2);
  if (!total) throw new Error("Couldn't read any spend from this export.");
  return { mode: "period", currency, total, from, to };
}

export const ODDBREW_DEFAULTS = {
  storeName: "OddBrew",
  currency: "GBP",
  shopify: { paymentPct: 1.7, paymentFixed: 0.25 }, // Shopify Payments UK online
  cogsPct: 0, // extra cost of goods as % of revenue (optional)
  costPerOrder: 0, // extra flat cost per order (optional)
  fixedMonthly: 0, // fixed monthly overhead (rent, subs, etc.)
  // Per-size cost rules: match the size text in the variant name, then product
  // cost + shipping cost for the destination region (UK / US / EU-rest).
  costRules: [], // [{ id, label, match, productCost, shipUK, shipUS, shipEU }]
  costFx: 1, // multiply rule costs by this to convert to the store currency
  //          e.g. 0.79 if your cost sheet is in USD and the store is in GBP
};

// Map an order's destination to one of the three shipping-cost regions.
export function regionOf(country) {
  const c = (country || "").trim().toUpperCase();
  if (c === "GB" || c === "UK" || c === "UNITED KINGDOM") return "UK";
  if (c === "US" || c === "USA" || c === "UNITED STATES") return "US";
  return "EU"; // everywhere else uses the Europe (FR-example) rate
}

const REGION_LABEL = { UK: "UK", US: "US", EU: "Europe / rest" };
export { REGION_LABEL };

// Match a variant name to a cost rule, ignoring case and whitespace, so "350ml"
// matches "350 ml", "350ML", etc.
const squash = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
export function findCostRule(name, rules) {
  const n = squash(name);
  return (rules || []).find((r) => r.match && n.includes(squash(r.match)));
}

// Distinct sold items that don't match any rule, with total quantity.
export function unmatchedBreakdown(orders, cfg) {
  const rules = cfg.costRules || [];
  const map = new Map();
  for (const o of orders || []) {
    for (const it of o.items || []) {
      if (findCostRule(it.name, rules)) continue;
      const name = it.name || "(unnamed)";
      map.set(name, (map.get(name) || 0) + (it.qty || 1));
    }
  }
  return Array.from(map.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
}

// Cost of goods for one order from the size rules: for each line item, find a
// rule whose `match` text appears in the item name, then add (product cost +
// region shipping) × quantity. Falls back to the flat/percentage fields.
export function orderCogsOddbrew(order, cfg, revenue) {
  const rules = cfg.costRules || [];
  const fx = cfg.costFx || 1;
  const region = regionOf(order.country);
  let cogs = 0;
  let unmatched = 0;
  for (const item of order.items || []) {
    const rule = findCostRule(item.name, rules);
    const qty = item.qty || 1;
    if (rule) {
      const ship = region === "UK" ? rule.shipUK : region === "US" ? rule.shipUS : rule.shipEU;
      cogs += ((Number(rule.productCost) || 0) + (Number(ship) || 0)) * fx * qty;
    } else {
      unmatched += qty;
    }
  }
  // optional extras
  cogs += Number(cfg.costPerOrder) || 0;
  cogs += Math.max(0, revenue || 0) * ((Number(cfg.cogsPct) || 0) / 100);
  return { total: cogs, unmatched };
}

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

// If actualCost is given (from a verified supplier invoice) it's used as the
// cost of goods; otherwise the size-rule estimate is used.
export function enrichOddbrew(order, cfg, actualCost) {
  const revenue = orderRevenue(order);
  const fees = shopifyFees(order, cfg.shopify || ODDBREW_DEFAULTS.shopify).total;
  let cogs, unmatched = 0, basis;
  if (actualCost != null) {
    cogs = actualCost;
    basis = "invoice";
  } else {
    const c = orderCogsOddbrew(order, cfg, revenue);
    cogs = c.total;
    unmatched = c.unmatched;
    basis = "estimate";
  }
  const profit = revenue - fees - cogs;
  return { ...order, revenue, fees, cogs, cogsUnmatched: unmatched, costBasis: basis, profit };
}

// Map each covered order to its actual cost from saved invoices. An invoice's
// invoiced total is split across its orders in proportion to their estimated
// cost, so the shipping discount is shared fairly.
export function buildInvoiceCostIndex(invoices, orders, cfg) {
  const byId = new Map((orders || []).map((o) => [o.orderId, o]));
  const index = new Map();
  const storeCur = cfg.currency || "GBP";
  for (const inv of invoices || []) {
    const nums = inv.orderNumbers || [];
    const invoiced = storeCur === "USD" ? inv.invoicedUsd : inv.invoicedGbp;
    if (invoiced == null || !nums.length) continue;
    const ests = nums.map((n) => {
      const o = byId.get(n);
      return { n, est: o ? orderCogsOddbrew(o, cfg, orderRevenue(o)).total : 0 };
    });
    const totalEst = ests.reduce((s, e) => s + e.est, 0);
    for (const e of ests) {
      const share = totalEst > 0 ? e.est / totalEst : 1 / ests.length;
      index.set(e.n, (index.get(e.n) || 0) + invoiced * share);
    }
  }
  return index;
}

function monthsSpanned(orders) {
  const ds = orders.map((o) => o.date).filter(Boolean).sort();
  if (!ds.length) return 1;
  const a = new Date(ds[0]);
  const b = new Date(ds[ds.length - 1]);
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

export function oddbrewTotals(orders, cfg, costIndex) {
  const idx = costIndex || new Map();
  const rows = orders.map((o) => enrichOddbrew(o, cfg, idx.get(o.orderId)));
  const revenue = rows.reduce((s, o) => s + o.revenue, 0);
  const fees = rows.reduce((s, o) => s + o.fees, 0);
  const cogs = rows.reduce((s, o) => s + o.cogs, 0);
  const grossProfit = revenue - fees - cogs;
  const months = monthsSpanned(orders);
  const fixed = (cfg.fixedMonthly || 0) * months;
  const units = rows.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (i.qty || 0), 0), 0);
  const verifiedRows = rows.filter((o) => o.costBasis === "invoice");
  const verifiedCost = verifiedRows.reduce((s, o) => s + o.cogs, 0);
  return {
    revenue, fees, cogs, grossProfit,
    fixed, months,
    net: grossProfit - fixed,
    orders: rows.length,
    units,
    unmatched: rows.reduce((s, o) => s + (o.cogsUnmatched || 0), 0),
    verifiedOrders: verifiedRows.length,
    verifiedCost,
    verifiedPct: cogs > 0 ? (verifiedCost / cogs) * 100 : 0,
    aov: rows.length ? revenue / rows.length : 0,
    margin: revenue > 0 ? (grossProfit / revenue) * 100 : null,
  };
}

// Per-month revenue and net profit (monthly profit has one month of fixed
// overhead subtracted, so the bars sum to the net figure).
export function oddbrewMonthly(orders, cfg, costIndex) {
  const idx = costIndex || new Map();
  const map = new Map();
  for (const o of orders) {
    if (!o.date) continue;
    const m = o.date.slice(0, 7);
    const e = enrichOddbrew(o, cfg, idx.get(o.orderId));
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

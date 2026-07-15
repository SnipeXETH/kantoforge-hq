import { orderFees, orderCogs } from "./fees";
import { normOrderNo } from "./fulfilment";
import { monthKey } from "./format";

// Revenue excludes sales tax (it's collected and remitted, not yours).
export function orderRevenue(order) {
  return order.itemsTotal - order.discount + order.shipping - (order.refunded || 0);
}

// `fulfilment` (optional) is a Map of normalised order number → actual
// fulfilment cost from an uploaded supplier invoice.
export function enrichOrder(order, settings, productCosts, fulfilment) {
  const revenue = orderRevenue(order);
  const fees = orderFees(order, settings);
  const actual = fulfilment ? fulfilment.get(normOrderNo(order.orderId)) : null;
  const cogs = orderCogs(order, settings, productCosts, actual == null ? null : actual);
  const profit = revenue - fees.total - cogs.total;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;
  return { ...order, revenue, fees, cogs, profit, margin };
}

export function enrichAll(orders, settings, productCosts, fulfilment) {
  return orders.map((o) => enrichOrder(o, settings, productCosts, fulfilment));
}

export function filterByRange(orders, range) {
  if (!range || range === "all") return orders;
  const now = new Date();
  let from;
  if (range === "30d") from = new Date(now.getTime() - 30 * 864e5);
  else if (range === "90d") from = new Date(now.getTime() - 90 * 864e5);
  else if (range === "12m") from = new Date(now.getTime() - 365 * 864e5);
  else if (range === "ytd") from = new Date(now.getFullYear(), 0, 1);
  else return orders;
  const iso = from.toISOString();
  return orders.filter((o) => o.date && o.date >= iso);
}

export function totals(enriched) {
  const t = { revenue: 0, fees: 0, cogs: 0, profit: 0, orders: enriched.length, units: 0 };
  for (const o of enriched) {
    t.revenue += o.revenue;
    t.fees += o.fees.total;
    t.cogs += o.cogs.total;
    t.profit += o.profit;
    t.units += o.items.length ? o.items.reduce((s, i) => s + i.qty, 0) : o.numItems || 1;
  }
  t.margin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : null;
  t.aov = t.orders > 0 ? t.revenue / t.orders : null;
  return t;
}

export function byPlatform(enriched) {
  return {
    shopify: totals(enriched.filter((o) => o.platform === "shopify")),
    etsy: totals(enriched.filter((o) => o.platform === "etsy")),
  };
}

// Continuous month series between the first and last order in the set.
export function monthlySeries(enriched) {
  const byMonth = new Map();
  for (const o of enriched) {
    const key = o.date ? monthKey(o.date) : null;
    if (!key) continue;
    let m = byMonth.get(key);
    if (!m) {
      m = { month: key, revenue: 0, profit: 0, fees: 0, cogs: 0, orders: 0, shopifyRevenue: 0, etsyRevenue: 0, shopifyProfit: 0, etsyProfit: 0 };
      byMonth.set(key, m);
    }
    m.revenue += o.revenue;
    m.profit += o.profit;
    m.fees += o.fees.total;
    m.cogs += o.cogs.total;
    m.orders += 1;
    if (o.platform === "shopify") {
      m.shopifyRevenue += o.revenue;
      m.shopifyProfit += o.profit;
    } else {
      m.etsyRevenue += o.revenue;
      m.etsyProfit += o.profit;
    }
  }
  const keys = Array.from(byMonth.keys()).sort();
  if (!keys.length) return [];
  const out = [];
  let [y, m] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const key = y + "-" + String(m).padStart(2, "0");
    out.push(
      byMonth.get(key) || { month: key, revenue: 0, profit: 0, fees: 0, cogs: 0, orders: 0, shopifyRevenue: 0, etsyRevenue: 0, shopifyProfit: 0, etsyProfit: 0 }
    );
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function productBreakdown(enriched, settings, productCosts) {
  // Per-product revenue/profit. Order-level fees, postage and packaging are
  // apportioned across items by their share of the order's item value.
  const byProduct = new Map();
  for (const o of enriched) {
    if (!o.items.length) continue;
    const itemValue = o.items.reduce((s, i) => s + i.price * i.qty, 0) || 1;
    const overhead = o.fees.total + o.cogs.postage + o.cogs.packaging + (o.cogs.variable || 0) + (o.cogs.fulfilmentActual || 0) + o.discount;
    for (const item of o.items) {
      const key = item.name;
      let p = byProduct.get(key);
      if (!p) {
        p = { name: item.name, sku: item.sku, qty: 0, revenue: 0, profit: 0, orders: 0 };
        byProduct.set(key, p);
      }
      const gross = item.price * item.qty;
      const share = gross / itemValue;
      const rule = matchCost(item, productCosts, settings);
      const net = gross - overhead * share - rule * item.qty + o.shipping * share;
      p.qty += item.qty;
      p.revenue += gross + o.shipping * share - o.discount * share;
      p.profit += net;
      p.orders += 1;
    }
  }
  return Array.from(byProduct.values()).sort((a, b) => b.revenue - a.revenue);
}

function matchCost(item, productCosts, settings) {
  const sku = (item.sku || "").trim().toLowerCase();
  const name = (item.name || "").trim().toLowerCase();
  for (const rule of productCosts) {
    const pattern = (rule.pattern || "").trim().toLowerCase();
    if (!pattern) continue;
    if (rule.matchType === "sku" && sku && sku === pattern) return rule.unitCost;
  }
  for (const rule of productCosts) {
    const pattern = (rule.pattern || "").trim().toLowerCase();
    if (!pattern) continue;
    if (rule.matchType === "name" && name.includes(pattern)) return rule.unitCost;
  }
  return settings.defaults.fallbackItemCost || 0;
}

export function feeBreakdown(enriched) {
  const agg = { transaction: 0, payment: 0, listing: 0, regulatory: 0, offsiteAds: 0 };
  for (const o of enriched) {
    for (const [k, v] of Object.entries(o.fees.breakdown)) {
      agg[k] = (agg[k] || 0) + v;
    }
  }
  return agg;
}

// Months covered by a set of orders (for spreading fixed monthly costs).
export function monthsSpanned(enriched) {
  const keys = new Set();
  for (const o of enriched) {
    const k = o.date ? monthKey(o.date) : null;
    if (k) keys.add(k);
  }
  return Math.max(1, keys.size);
}

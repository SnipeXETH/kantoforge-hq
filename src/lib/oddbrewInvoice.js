// Parse an OMGO / Nanning Youkeshu supplier invoice (.xlsx) and reconcile it
// against OddBrew's orders and cost rules. xlsx is loaded lazily so it never
// weighs down the main bundle.
import { regionOf, findCostRule } from "./oddbrew";
import { orderRevenue } from "./calc";

const norm = (v) =>
  String(v == null ? "" : v)
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s+/g, "")
    .toLowerCase();

const TOTAL_LABELS = {
  sum: "sum",
  additionalfreight: "additionalFreight",
  shippingdiscount: "shippingDiscount",
  "total($)": "totalUsd",
  "total(£)": "totalGbp",
};

function lastNumeric(row) {
  for (let i = row.length - 1; i >= 0; i--) {
    const n = typeof row[i] === "number" ? row[i] : parseFloat(String(row[i]).replace(/[£$,\s]/g, ""));
    if (row[i] != null && row[i] !== "" && !isNaN(n)) return n;
  }
  return null;
}

function headerIndex(rows, required) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hdr = (rows[i] || []).map(norm);
    if (required.every((req) => hdr.includes(norm(req)))) {
      const map = {};
      (rows[i] || []).forEach((c, ci) => { map[norm(c)] = ci; });
      return { row: i, cols: map };
    }
  }
  return null;
}

export async function parseInvoiceWorkbook(arrayBuffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null }),
  }));

  // --- order list: the sheet with Name / Lineitem name / quantity / country ---
  let orders = [];
  for (const sh of sheets) {
    const h = headerIndex(sh.rows, ["Name", "Lineitem name", "Lineitem quantity"]);
    if (!h) continue;
    const c = h.cols;
    const cName = c[norm("Name")];
    const cItem = c[norm("Lineitem name")];
    const cQty = c[norm("Lineitem quantity")];
    const cCountry = c[norm("Shipping Country")];
    const byName = new Map();
    for (let i = h.row + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i] || [];
      const name = r[cName];
      const item = r[cItem];
      if (!name || !item) continue;
      let o = byName.get(name);
      if (!o) { o = { name: String(name), country: "", items: [] }; byName.set(name, o); }
      if (cCountry != null && r[cCountry] && !o.country) o.country = String(r[cCountry]);
      o.items.push({ name: String(item), qty: Number(r[cQty]) || 1 });
    }
    orders = Array.from(byName.values());
    break;
  }

  // --- totals: scan every sheet for the labelled figures ---
  const totals = {};
  for (const sh of sheets) {
    for (const row of sh.rows) {
      if (!row) continue;
      for (const cell of row) {
        const key = TOTAL_LABELS[norm(cell)];
        if (key && totals[key] == null) {
          const v = lastNumeric(row);
          if (v != null) totals[key] = v;
        }
      }
    }
  }

  // --- batch reference: a cell like "0529 George order 1573-1579" ---
  let ref = "";
  for (const sh of sheets) {
    for (const row of sh.rows) {
      if (!row) continue;
      for (const cell of row) {
        if (typeof cell === "string" && /order/i.test(cell) && /\d/.test(cell) && cell.length < 60) {
          ref = cell.trim();
          break;
        }
      }
      if (ref) break;
    }
    if (ref) break;
  }
  if (!ref && orders.length) {
    const nums = orders.map((o) => o.name).sort();
    ref = nums[0] + (nums.length > 1 ? "–" + nums[nums.length - 1] : "");
  }

  return { ref, orders, totals, sheetNames: wb.SheetNames };
}

// Supplier's expected cost for a set of line items (raw invoice currency, no fx)
// from the size rules: product cost + region shipping per unit.
function expectedForItems(items, country, rules) {
  const region = regionOf(country);
  let total = 0;
  const unmatched = [];
  let units = 0;
  for (const it of items) {
    const qty = it.qty || 1;
    units += qty;
    const rule = findCostRule(it.name, rules);
    if (rule) {
      const ship = region === "UK" ? rule.shipUK : region === "US" ? rule.shipUS : rule.shipEU;
      total += ((Number(rule.productCost) || 0) + (Number(ship) || 0)) * qty;
    } else {
      unmatched.push(it.name);
    }
  }
  return { total, unmatched, units };
}

export function reconcileInvoice(parsed, storeOrders, cfg) {
  const rules = cfg.costRules || [];
  const byOrderId = new Map((storeOrders || []).map((o) => [o.orderId, o]));

  let expectedUsd = 0;
  let units = 0;
  const unmatchedItems = [];
  const missingOrders = [];
  let revenueStore = 0;

  for (const o of parsed.orders) {
    const e = expectedForItems(o.items, o.country, rules);
    expectedUsd += e.total;
    units += e.units;
    e.unmatched.forEach((n) => unmatchedItems.push(n));
    const so = byOrderId.get(o.name);
    if (so) revenueStore += orderRevenue(so);
    else missingOrders.push(o.name);
  }

  const invoicedUsd = parsed.totals.totalUsd != null ? parsed.totals.totalUsd : null;
  const invoicedGbp = parsed.totals.totalGbp != null ? parsed.totals.totalGbp : null;
  const discount = parsed.totals.shippingDiscount || 0;
  // Supplier total should be expected (base + freight) minus the shipping
  // discount. Anything else is a rate change or an error.
  const variance = invoicedUsd != null ? +(expectedUsd - discount - invoicedUsd).toFixed(2) : null;
  const fxImplied = invoicedUsd && invoicedGbp ? +(invoicedGbp / invoicedUsd).toFixed(4) : null;

  const flags = [];
  if (variance != null && Math.abs(variance) > 0.5) {
    flags.push(variance > 0
      ? `Invoiced $${invoicedUsd} is $${variance.toFixed(2)} LESS than expected — an extra discount, or missing items.`
      : `Invoiced $${invoicedUsd} is $${Math.abs(variance).toFixed(2)} MORE than expected — possible overcharge or rate change.`);
  }
  if (unmatchedItems.length) flags.push(`${unmatchedItems.length} item(s) didn't match a size rule (counted as $0). Check the rules.`);
  if (missingOrders.length) flags.push(`${missingOrders.length} order(s) on this invoice aren't in OddBrew yet — sync/import so revenue lines up.`);
  if (invoicedUsd == null) flags.push("Couldn't read the invoice total from the file — enter it manually below.");

  return {
    ref: parsed.ref,
    orderNumbers: parsed.orders.map((o) => o.name),
    orders: parsed.orders.length,
    units,
    expectedUsd: +expectedUsd.toFixed(2),
    invoicedUsd,
    invoicedGbp,
    discount,
    variance,
    fxImplied,
    revenueStore: +revenueStore.toFixed(2),
    unmatchedItems,
    missingOrders,
    flags,
    ok: variance != null && Math.abs(variance) <= 0.5 && !unmatchedItems.length,
  };
}

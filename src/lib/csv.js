// CSV import pipeline: RFC-4180 parser + format detection + normalisation
// into one order shape shared by Shopify and Etsy.
//
// Supported files:
//  - Shopify Admin → Orders → Export (orders_export.csv)
//  - Etsy Shop Manager → Settings → Options → Download Data → Orders   (EtsySoldOrders….csv)
//  - Etsy Shop Manager → … → Order Items                               (EtsySoldOrderItems….csv)

export function parseCSV(text) {
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] || "").trim();
    });
    return o;
  });
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[£$€,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDate(v) {
  if (!v) return null;
  // Etsy: "08/15/25" or "08/15/2025" (US order)
  const us = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let [, mm, dd, yy] = us;
    if (yy.length === 2) yy = "20" + yy;
    const d = new Date(Number(yy), Number(mm) - 1, Number(dd));
    return isNaN(d) ? null : d.toISOString();
  }
  // Shopify: "2025-08-15 10:31:22 +0100" — Date.parse copes once we insert a T
  const d = new Date(String(v).replace(" ", "T").replace(" ", ""));
  if (!isNaN(d)) return d.toISOString();
  const d2 = new Date(v);
  return isNaN(d2) ? null : d2.toISOString();
}

export function detectFormat(rows) {
  if (!rows.length) return null;
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const has = (name) => h.includes(name.toLowerCase());
  if (has("Lineitem name") && (has("Financial Status") || has("Subtotal"))) return "shopify_orders";
  if (has("Order ID") && (has("Item Name") || has("Transaction ID"))) return "etsy_items";
  if (has("Order ID") && (has("Order Total") || has("Order Value"))) return "etsy_orders";
  return null;
}

export const FORMAT_LABELS = {
  shopify_orders: "Shopify orders export",
  etsy_orders: "Etsy sold orders",
  etsy_items: "Etsy sold order items",
};

function parseShopifyOrders(objects) {
  const orders = new Map();
  for (const row of objects) {
    const name = row["Name"];
    if (!name) continue;
    let order = orders.get(name);
    if (!order) {
      order = {
        id: "shopify:" + name,
        platform: "shopify",
        orderId: name,
        date: null,
        currency: row["Currency"] || "GBP",
        itemsTotal: 0,
        shipping: 0,
        discount: 0,
        tax: 0,
        total: 0,
        refunded: 0,
        feesActual: null,
        buyer: row["Billing Name"] || row["Shipping Name"] || "",
        email: row["Email"] || "",
        country: "",
        status: (row["Financial Status"] || "").toLowerCase(),
        tags: "",
        items: [],
      };
      orders.set(name, order);
    }
    if (row["Tags"]) order.tags = row["Tags"];
    if (row["Email"] && !order.email) order.email = row["Email"];
    if (row["Shipping Country"] && !order.country) order.country = row["Shipping Country"];
    // Order-level money fields only appear on the first row of each order
    if (row["Total"] !== "" && row["Total"] != null) {
      order.itemsTotal = num(row["Subtotal"]);
      order.shipping = num(row["Shipping"]);
      order.tax = num(row["Taxes"]);
      order.total = num(row["Total"]);
      order.discount = num(row["Discount Amount"]);
      order.refunded = num(row["Refunded Amount"]);
      order.date = parseDate(row["Created at"] || row["Paid at"]) || order.date;
      if (row["Financial Status"]) order.status = row["Financial Status"].toLowerCase();
      if (row["Currency"]) order.currency = row["Currency"];
    }
    if (!order.date) order.date = parseDate(row["Created at"] || row["Paid at"]);
    if (row["Lineitem name"]) {
      order.items.push({
        name: row["Lineitem name"],
        sku: row["Lineitem sku"] || "",
        qty: num(row["Lineitem quantity"]) || 1,
        price: num(row["Lineitem price"]),
      });
    }
  }
  // Shopify Subtotal is already discount-inclusive, so zero the discount to
  // avoid double-counting it in revenue maths downstream.
  // Orders the Etsy integration pushed into Shopify carry an "Etsy" tag —
  // those belong to the Etsy channel (and Etsy's fee model).
  return Array.from(orders.values()).map((o) => ({
    ...o,
    platform: isEtsyTagged(o.tags) ? "etsy" : "shopify",
    channelVia: "shopify",
    itemsTotal: o.itemsTotal,
    discount: 0,
    rawDiscount: o.discount,
  }));
}

export function isEtsyTagged(tags) {
  return /(^|,)\s*etsy\s*(,|$)/i.test(tags || "");
}

function parseEtsyOrders(objects) {
  const orders = [];
  for (const row of objects) {
    const orderId = row["Order ID"];
    if (!orderId) continue;
    const itemsTotal = num(row["Order Value"]);
    const discount = num(row["Discount Amount"]) + num(row["Shipping Discount"]);
    orders.push({
      id: "etsy:" + orderId,
      platform: "etsy",
      orderId,
      date: parseDate(row["Sale Date"] || row["Date Paid"]),
      currency: "GBP",
      itemsTotal,
      shipping: num(row["Shipping"]),
      discount,
      tax: num(row["Sales Tax"]),
      total: num(row["Order Total"]),
      refunded: 0,
      feesActual: num(row["Card Processing Fees"]) || null,
      buyer: row["Full Name"] || row["Buyer"] || "",
      country: row["Ship Country"] || row["Shipping Country"] || "",
      status: (row["Status"] || "paid").toLowerCase(),
      items: [],
      numItems: num(row["Number of Items"]) || null,
    });
  }
  return orders;
}

function parseEtsyItems(objects) {
  const orders = new Map();
  for (const row of objects) {
    const orderId = row["Order ID"];
    if (!orderId) continue;
    let order = orders.get(orderId);
    if (!order) {
      order = {
        id: "etsy:" + orderId,
        platform: "etsy",
        orderId,
        date: parseDate(row["Sale Date"] || row["Date Paid"]),
        currency: "GBP",
        itemsTotal: 0,
        shipping: num(row["Order Shipping"]),
        discount: 0,
        tax: num(row["Order Sales Tax"]),
        total: 0,
        refunded: 0,
        feesActual: null,
        buyer: row["Buyer"] || "",
        status: "paid",
        items: [],
        itemsOnly: true, // built from the items file; totals derived below
      };
      orders.set(orderId, order);
    }
    const qty = num(row["Quantity"]) || 1;
    const price = num(row["Price"]);
    order.items.push({
      name: row["Item Name"] || "Unknown item",
      sku: row["SKU"] || "",
      qty,
      price,
      variations: row["Variations"] || "",
    });
    order.itemsTotal += price * qty;
    order.discount += num(row["Discount Amount"]);
  }
  return Array.from(orders.values()).map((o) => ({
    ...o,
    total: o.itemsTotal - o.discount + o.shipping + o.tax,
  }));
}

// Merge freshly parsed orders into the existing list.
// Etsy items files enrich orders imported from the orders file (and vice
// versa) instead of overwriting their money fields.
export function mergeOrders(existing, incoming) {
  const byId = new Map(existing.map((o) => [o.id, o]));
  let added = 0;
  let updated = 0;
  for (const order of incoming) {
    const prev = byId.get(order.id);
    if (!prev) {
      byId.set(order.id, order);
      added++;
    } else {
      const merged = { ...prev };
      // Items win over no-items
      if (order.items.length && !prev.items.length) merged.items = order.items;
      // Money fields from a full orders file win over items-only reconstruction
      if (prev.itemsOnly && !order.itemsOnly) {
        merged.itemsTotal = order.itemsTotal;
        merged.shipping = order.shipping;
        merged.discount = order.discount;
        merged.tax = order.tax;
        merged.total = order.total;
        merged.feesActual = order.feesActual;
        merged.buyer = order.buyer || prev.buyer;
        merged.itemsOnly = false;
      }
      if (!merged.date && order.date) merged.date = order.date;
      if (order.feesActual != null && merged.feesActual == null) merged.feesActual = order.feesActual;
      byId.set(order.id, merged);
      updated++;
    }
  }
  const all = Array.from(byId.values());
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { orders: all, added, updated };
}

export function importCsvText(text) {
  const rows = parseCSV(text);
  const format = detectFormat(rows);
  if (!format) {
    throw new Error(
      "Couldn't recognise this CSV. Expected a Shopify orders export, an Etsy sold-orders file, or an Etsy sold-order-items file."
    );
  }
  const objects = toObjects(rows);
  let orders;
  if (format === "shopify_orders") orders = parseShopifyOrders(objects);
  else if (format === "etsy_orders") orders = parseEtsyOrders(objects);
  else orders = parseEtsyItems(objects);
  return { format, orders };
}

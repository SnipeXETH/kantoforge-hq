// Fee engine — every rate is editable in Settings, so when Etsy or Shopify
// change their pricing you update the numbers, not the code.

export function etsyFees(order, etsy) {
  const base = order.itemsTotal - order.discount + order.shipping; // what Etsy charges % fees on
  const qty = order.items.length ? order.items.reduce((s, i) => s + i.qty, 0) : order.numItems || 1;
  const transaction = Math.max(0, base) * (etsy.transactionPct / 100);
  const payment =
    order.feesActual != null
      ? order.feesActual // actual card processing fee from the Etsy CSV
      : Math.max(0, base + order.tax) * (etsy.paymentPct / 100) + etsy.paymentFixed;
  const listing = etsy.listingFee * Math.max(1, qty);
  const regulatory = Math.max(0, base) * (etsy.regulatoryPct / 100);
  const offsiteAds = Math.max(0, base) * (etsy.offsiteAdsPct / 100) * ((etsy.offsiteAdsShare || 0) / 100);
  const breakdown = { transaction, payment, listing, regulatory, offsiteAds };
  return { total: transaction + payment + listing + regulatory + offsiteAds, breakdown };
}

export function shopifyFees(order, shopify) {
  const payment = Math.max(0, order.total) * (shopify.paymentPct / 100) + shopify.paymentFixed;
  return { total: payment, breakdown: { payment } };
}

export function orderFees(order, settings) {
  return order.platform === "etsy" ? etsyFees(order, settings.etsy) : shopifyFees(order, settings.shopify);
}

// --- Product cost matching -------------------------------------------------

export function matchProductCost(item, productCosts) {
  const sku = (item.sku || "").trim().toLowerCase();
  const name = (item.name || "").trim().toLowerCase();
  for (const rule of productCosts) {
    const pattern = (rule.pattern || "").trim().toLowerCase();
    if (!pattern) continue;
    if (rule.matchType === "sku" && sku && sku === pattern) return rule;
  }
  for (const rule of productCosts) {
    const pattern = (rule.pattern || "").trim().toLowerCase();
    if (!pattern) continue;
    if (rule.matchType === "name" && name.includes(pattern)) return rule;
  }
  return null;
}

// --- Variable per-order costs (formula rules) ------------------------------
// A rule is `pct % of <base> + fixed`, optionally scoped to a platform/region.
// Lets you model % costs like fulfilment fees and DDP that vary per order.

export function orderBaseAmount(order, base) {
  const itemsAfterDiscount = (order.itemsTotal || 0) - (order.discount || 0); // ex shipping
  switch (base) {
    case "orderTotal": return order.total || 0;
    case "revenue": return itemsAfterDiscount + (order.shipping || 0) - (order.refunded || 0);
    case "shipping": return order.shipping || 0;
    case "itemSubtotal":
    default: return itemsAfterDiscount;
  }
}

function isUkOrder(order) {
  const c = (order.country || "").trim().toUpperCase();
  return c === "" || c === "GB" || c === "UK" || c === "GBR" || c === "UNITED KINGDOM";
}

function variableRuleApplies(order, rule) {
  if (rule.enabled === false) return false;
  const plat = rule.platform || "all";
  if (plat !== "all" && order.platform !== plat) return false;
  const region = rule.region || "all";
  if (region === "uk" && !isUkOrder(order)) return false;
  if (region === "intl" && isUkOrder(order)) return false;
  return true;
}

export function variableCosts(order, settings) {
  const rules = (settings && settings.costRules) || [];
  let total = 0;
  const breakdown = {};
  for (const rule of rules) {
    if (!variableRuleApplies(order, rule)) continue;
    const amt = Math.max(0, orderBaseAmount(order, rule.base)) * ((Number(rule.pct) || 0) / 100) + (Number(rule.fixed) || 0);
    if (!amt) continue;
    const key = rule.label || "Variable cost";
    total += amt;
    breakdown[key] = (breakdown[key] || 0) + amt;
  }
  return { total, breakdown };
}

export function orderCogs(order, settings, productCosts) {
  const d = settings.defaults;
  let itemCosts = 0;
  let unmatched = 0;
  if (order.items.length) {
    for (const item of order.items) {
      const rule = matchProductCost(item, productCosts);
      if (rule) {
        itemCosts += rule.unitCost * item.qty;
      } else {
        itemCosts += (d.fallbackItemCost || 0) * item.qty;
        unmatched += item.qty;
      }
    }
  } else {
    const qty = order.numItems || 1;
    itemCosts += (d.fallbackItemCost || 0) * qty;
    unmatched += qty;
  }
  const postage = order.platform === "etsy" ? d.postagePerOrderEtsy : d.postagePerOrderShopify;
  const packaging = d.packagingPerOrder || 0;
  const variable = variableCosts(order, settings);
  return {
    total: itemCosts + postage + packaging + variable.total,
    itemCosts, postage, packaging,
    variable: variable.total,
    variableBreakdown: variable.breakdown,
    unmatched,
  };
}

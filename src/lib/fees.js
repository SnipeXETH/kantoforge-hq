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
  return { total: itemCosts + postage + packaging, itemCosts, postage, packaging, unmatched };
}

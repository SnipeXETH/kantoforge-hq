// Parse a Total Cards "Detailed" fulfilment invoice (.xlsx) — one row per order
// with the real Royal Mail postage, Total Cards fee and DDP already broken out.
// Uploading it gives each order its actual fulfilment cost, overriding the
// formula estimate. xlsx is loaded lazily so it never weighs down the bundle.

// "#KF56842" / " kf56842 " → "KF56842", so an invoice order number lines up
// with a Shopify order name however either side is punctuated.
export const normOrderNo = (s) => String(s == null ? "" : s).replace(/[#\s]/g, "").toUpperCase();

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[£$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
};

export async function parseFulfilmentInvoice(arrayBuffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
  if (!rows.length) throw new Error("That spreadsheet looks empty.");

  const header = (rows[0] || []).map((h) => String(h == null ? "" : h).trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cOrder = col("OrderNumber");
  const cExcl = col("GrandTotal_ExclVAT");
  const cIncl = col("GrandTotal_InclVAT");
  if (cOrder < 0 || (cExcl < 0 && cIncl < 0)) {
    throw new Error("This doesn't look like a Total Cards fulfilment invoice — expected OrderNumber and GrandTotal columns.");
  }
  const cRm = col("RM_Subtotal"), cFee = col("TotalCards_Fee"), cFeeVat = col("TotalCards_VAT"), cDdp = col("DDP_Total");
  const cWeight = col("WeightKg"), cService = col("ShippingService"), cCountry = col("DestinationCountry"), cDate = col("DateFulfilled"), cInv = col("InvoiceId"), cTitles = col("LineItems_Titles");

  const out = [];
  let invoiceId = "";
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const orderRaw = r[cOrder];
    if (!orderRaw) continue;
    if (!invoiceId && cInv >= 0 && r[cInv]) invoiceId = String(r[cInv]);
    const grandIncl = cIncl >= 0 ? num(r[cIncl]) : 0;
    const grandExcl = cExcl >= 0 ? num(r[cExcl]) : 0;
    out.push({
      order: String(orderRaw).trim(),
      key: normOrderNo(orderRaw),
      rmSubtotal: cRm >= 0 ? num(r[cRm]) : 0,
      fulfilmentFee: (cFee >= 0 ? num(r[cFee]) : 0) + (cFeeVat >= 0 ? num(r[cFeeVat]) : 0),
      ddpTotal: cDdp >= 0 ? num(r[cDdp]) : 0,
      grandExcl,
      grandIncl: grandIncl || grandExcl,
      weightKg: cWeight >= 0 ? num(r[cWeight]) : null,
      service: cService >= 0 ? String(r[cService] || "") : "",
      country: cCountry >= 0 ? String(r[cCountry] || "") : "",
      dateFulfilled: cDate >= 0 ? String(r[cDate] || "") : "",
      titles: cTitles >= 0 ? String(r[cTitles] || "") : "",
      invoiceId,
    });
  }
  if (!out.length) throw new Error("No order rows found in this invoice.");
  const totalExcl = +out.reduce((s, r) => s + r.grandExcl, 0).toFixed(2);
  const totalIncl = +out.reduce((s, r) => s + r.grandIncl, 0).toFixed(2);
  return { invoiceId, rows: out, totalExcl, totalIncl, count: out.length };
}

// The actual fulfilment cost to charge an order, honouring VAT preference.
export function fulfilmentActual(rec, vatMode) {
  if (!rec) return null;
  const incl = rec.grandIncl || rec.rmSubtotal + rec.fulfilmentFee + rec.ddpTotal;
  const excl = rec.grandExcl || incl;
  return vatMode === "excl" ? excl : incl;
}

// order-number → actual cost, for the cost engine to look up.
export function buildFulfilmentIndex(records, vatMode) {
  const map = new Map();
  for (const r of records || []) {
    map.set(r.key || normOrderNo(r.order), fulfilmentActual(r, vatMode));
  }
  return map;
}

const isUkDest = (c) => !c || /not assigned/i.test(c) || /^(uk|gb|gbr|united kingdom)$/i.test(String(c).trim());

// Average the real costs across uploaded invoices, split UK vs international, so
// they can seed the estimate for orders that don't have an invoice yet.
export function invoiceAverages(records) {
  let ukSum = 0, ukN = 0, intlSum = 0, intlN = 0, intlDdp = 0, feeSum = 0, n = 0;
  for (const r of records || []) {
    n++;
    feeSum += r.fulfilmentFee || 0;
    if (isUkDest(r.country)) { ukSum += r.rmSubtotal || 0; ukN++; }
    else { intlSum += r.rmSubtotal || 0; intlN++; intlDdp += r.ddpTotal || 0; }
  }
  const avg = (s, c) => (c ? +(s / c).toFixed(2) : 0);
  return {
    count: n,
    ukPostage: avg(ukSum, ukN), ukN,
    intlPostage: avg(intlSum, intlN), intlN,
    intlDdp: avg(intlDdp, intlN),
    avgFee: avg(feeSum, n),
  };
}

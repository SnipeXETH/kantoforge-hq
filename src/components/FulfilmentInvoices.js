import React, { useMemo, useRef, useState } from "react";
import { money } from "../lib/format";
import { parseFulfilmentInvoice, fulfilmentActual, normOrderNo, invoiceAverages } from "../lib/fulfilment";

// Upload a Total Cards "Detailed" invoice (.xlsx) → attach the real per-order
// fulfilment cost (Royal Mail + Total Cards fee + DDP) to matching orders.
export default function FulfilmentInvoices({ db, update }) {
  const currency = db.settings.currency;
  const vat = db.settings.fulfilmentVat || "incl";
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const fulfilment = useMemo(() => db.fulfilment || [], [db.fulfilment]);
  const orderNos = useMemo(() => new Set((db.orders || []).map((o) => normOrderNo(o.orderId))), [db.orders]);

  const setVat = (mode) => update((db2) => ({ ...db2, settings: { ...db2.settings, fulfilmentVat: mode } }));

  const onFile = async (files) => {
    const file = files && files[0];
    if (!file) return;
    setErr(null); setNote(null); setBusy(true);
    try {
      const parsed = await parseFulfilmentInvoice(await file.arrayBuffer());
      const matched = parsed.rows.filter((r) => orderNos.has(r.key));
      const missing = parsed.rows.filter((r) => !orderNos.has(r.key));
      setPreview({ ...parsed, matched: matched.length, missing });
    } catch (e) {
      setErr(e.message || String(e));
      setPreview(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () => {
    if (!preview) return;
    const byId = new Map(fulfilment.map((r) => [r.id, r]));
    for (const r of preview.rows) byId.set(r.key, { id: r.key, ...r });
    update((db2) => ({ ...db2, fulfilment: Array.from(byId.values()) }));
    setNote(`Saved ${preview.rows.length} order costs from invoice ${preview.invoiceId || ""}. ${preview.matched} matched your orders${preview.missing.length ? `, ${preview.missing.length} not found yet` : ""}.`);
    setPreview(null);
  };

  const clearAll = () => {
    if (!window.confirm("Remove all saved fulfilment-invoice costs? Orders will fall back to the estimate rules.")) return;
    update((db2) => ({ ...db2, fulfilment: [] }));
    setNote("Cleared all saved fulfilment costs.");
  };

  const savedTotal = fulfilment.reduce((s, r) => s + (fulfilmentActual(r, vat) || 0), 0);

  // How many imported orders now have an actual cost vs still estimated.
  const savedKeys = useMemo(() => new Set(fulfilment.map((r) => r.id)), [fulfilment]);
  const invoicedOrders = useMemo(() => (db.orders || []).filter((o) => savedKeys.has(normOrderNo(o.orderId))).length, [db.orders, savedKeys]);
  const totalOrders = (db.orders || []).length;
  const coverage = totalOrders ? Math.round((invoicedOrders / totalOrders) * 100) : 0;
  const avgs = useMemo(() => invoiceAverages(fulfilment), [fulfilment]);

  const applyEstimates = () => {
    update((db2) => {
      const rules = (db2.settings.costRules || []).filter((r) => r.id !== "kf-est-postage-uk" && r.id !== "kf-est-postage-intl");
      rules.push({ id: "kf-est-postage-uk", label: "Royal Mail postage (UK, est.)", pct: 0, base: "itemSubtotal", fixed: avgs.ukPostage, platform: "all", region: "uk", enabled: true });
      rules.push({ id: "kf-est-postage-intl", label: "Royal Mail postage (intl, est.)", pct: 0, base: "itemSubtotal", fixed: avgs.intlPostage, platform: "all", region: "intl", enabled: true });
      return { ...db2, settings: { ...db2.settings, costRules: rules, defaults: { ...db2.settings.defaults, postagePerOrderShopify: 0, postagePerOrderEtsy: 0 } } };
    });
    setNote(`Postage estimate set from your invoices: ${money(avgs.ukPostage, currency)} UK, ${money(avgs.intlPostage, currency)} international. Un-invoiced orders now use these; flat postage default zeroed to avoid double counting.`);
  };

  return (
    <div className="card mt">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Fulfilment invoices (Total Cards)</h2>
          <div className="card-sub" style={{ margin: 0 }}>
            Upload Cameron's <b>Detailed</b> invoice spreadsheet. It reads the real Royal Mail postage, Total Cards fee and DDP
            for each order and uses that instead of the estimate — so postage's weight/destination guesswork is handled for you.
          </div>
        </div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <label className="lab" style={{ marginRight: 2 }}>VAT</label>
          <select value={vat} onChange={(e) => setVat(e.target.value)}>
            <option value="incl">Include VAT</option>
            <option value="excl">Exclude VAT (reclaimed)</option>
          </select>
          <button className="btn small primary" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>{busy ? "Reading…" : "⬆ Upload invoice"}</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files)} />
        </div>
      </div>

      {err && <div className="notice bad mt small">⚠️ {err}</div>}
      {note && <div className="notice good mt small">✅ {note}</div>}

      {fulfilment.length > 0 && !preview && (
        <>
          <div className="muted small mt">
            <b>{invoicedOrders}</b> of your <b>{totalOrders}</b> imported orders now use a real invoice cost ({coverage}%). The other {totalOrders - invoicedOrders} use the estimate rules until an invoice covers them. {fulfilment.length} invoice line{fulfilment.length === 1 ? "" : "s"} stored · {money(savedTotal, currency)} ({vat === "excl" ? "ex" : "inc"} VAT).
            {" "}<button className="btn small danger" style={{ marginLeft: 8 }} onClick={clearAll}>Clear all</button>
          </div>
          {(avgs.ukN > 0 || avgs.intlN > 0) && (
            <div className="notice mt small">
              <b>Calibrate the estimate from these invoices.</b> Real Royal Mail postage averages{" "}
              {avgs.ukN > 0 && <>{money(avgs.ukPostage, currency)} UK</>}
              {avgs.ukN > 0 && avgs.intlN > 0 && " · "}
              {avgs.intlN > 0 && <>{money(avgs.intlPostage, currency)} international</>}.
              {" "}Apply these so orders <i>without</i> an invoice are estimated realistically instead of the flat default.
              {" "}<button className="btn small" style={{ marginLeft: 6 }} onClick={applyEstimates}>Use as postage estimate</button>
            </div>
          )}
        </>
      )}

      {preview && (
        <div className="mt">
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <div className="card" style={{ margin: 0 }}><div className="muted small">Orders on invoice</div><div style={{ fontSize: 22, fontWeight: 750 }}>{preview.count}</div></div>
            <div className="card" style={{ margin: 0 }}><div className="muted small">Matched your orders</div><div style={{ fontSize: 22, fontWeight: 750 }}>{preview.matched}</div></div>
            <div className="card" style={{ margin: 0 }}><div className="muted small">Total cost (inc VAT)</div><div style={{ fontSize: 22, fontWeight: 750 }}>{money(preview.totalIncl, currency)}</div></div>
            <div className="card" style={{ margin: 0 }}><div className="muted small">Total cost (ex VAT)</div><div style={{ fontSize: 22, fontWeight: 750 }}>{money(preview.totalExcl, currency)}</div></div>
          </div>
          {preview.missing.length > 0 && (
            <div className="notice mt small">{preview.missing.length} order{preview.missing.length === 1 ? "" : "s"} on the invoice aren't imported yet ({preview.missing.slice(0, 6).map((r) => r.order).join(", ")}{preview.missing.length > 6 ? "…" : ""}). We'll still save their costs — they'll apply once the orders are imported.</div>
          )}
          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn primary" onClick={save}>Save {preview.count} order costs</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

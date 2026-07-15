import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { uid, money, shortDate } from "../lib/format";
import { parseInvoiceWorkbook, reconcileInvoice } from "../lib/oddbrewInvoice";

const MIGRATION = `create table if not exists public.oddbrew_invoices (
  id text primary key, data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.oddbrew_invoices enable row level security;
create policy "team full access" on public.oddbrew_invoices
  for all to authenticated using (true) with check (true);`;

function Metric({ label, value, tone }) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: tone }}>{value}</div>
    </div>
  );
}

export default function OddBrewInvoices({ user, orders, cfg }) {
  const [ready, setReady] = useState(true);
  const [ledger, setLedger] = useState(null);
  const [review, setReview] = useState(null); // reconciliation result awaiting save
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const usd = "USD";
  const cur = cfg.currency || "GBP";

  const fetchLedger = async () => {
    const { data, error } = await supabase.from("oddbrew_invoices").select("id,data").order("updated_at", { ascending: false });
    if (error) { setReady(false); return; }
    setReady(true);
    setLedger((data || []).map((r) => ({ id: r.id, ...r.data })));
  };
  useEffect(() => { fetchLedger(); }, []);

  const onFile = async (file) => {
    if (!file) return;
    setErr(null); setReview(null); setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseInvoiceWorkbook(buf);
      if (!parsed.orders.length) throw new Error("Couldn't find an order list in that file — is it the OMGO invoice with the order sheet?");
      const rec = reconcileInvoice(parsed, orders, cfg);
      setReview({ ...rec, fileName: file.name });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveToLedger = async () => {
    if (!review) return;
    setBusy(true); setErr(null);
    try {
      const rec = { id: uid(), ...review, status: "unpaid", savedAt: new Date().toISOString(), savedByName: user.name };
      const { error } = await supabase.from("oddbrew_invoices").insert({ id: rec.id, data: rec, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      setReview(null);
      await fetchLedger();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (inv, status) => {
    const next = { ...inv, status };
    await supabase.from("oddbrew_invoices").update({ data: next, updated_at: new Date().toISOString() }).eq("id", inv.id);
    fetchLedger();
  };
  const removeInv = async (id) => {
    if (!window.confirm("Remove this invoice from the ledger?")) return;
    await supabase.from("oddbrew_invoices").delete().eq("id", id);
    fetchLedger();
  };

  if (!ready) {
    return (
      <div className="card">
        <h2>One-time database step needed</h2>
        <p className="muted">Run this in Supabase → SQL Editor, then refresh. (Also at <code>supabase/migrations/2026-07-oddbrew-invoices.sql</code>.)</p>
        <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{MIGRATION}</pre>
      </div>
    );
  }

  const unpaidTotal = (ledger || []).filter((i) => i.status !== "paid").reduce((s, i) => s + (i.invoicedGbp || 0), 0);
  const spendTotal = (ledger || []).reduce((s, i) => s + (i.invoicedGbp || 0), 0);

  return (
    <>
      {err && <div className="notice bad mb">⚠️ {err}</div>}

      <div className="card">
        <h3>Check a supplier invoice</h3>
        <div className="muted small mt">Upload the OMGO <code>.xlsx</code> invoice. It reconciles the charged costs against your OddBrew orders and cost rules before you pay.</div>
        <label className="field mt">
          <span className="lab">Invoice file (.xlsx)</span>
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files[0])} disabled={busy} />
        </label>
        {busy && <div className="muted small">Reading…</div>}
      </div>

      {review && (
        <div className="card mt">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 style={{ marginBottom: 2 }}>{review.ref || review.fileName}</h3>
              <div className="muted small">{review.orders} orders · {review.units} cups · {review.orderNumbers.join(", ")}</div>
            </div>
            <span className={"badge " + (review.ok ? "green" : "yellow")}>{review.ok ? "Looks right ✓" : "Check flags"}</span>
          </div>

          <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            <Metric label="Expected (rules)" value={money(review.expectedUsd, usd)} />
            <Metric label="Invoiced" value={review.invoicedUsd != null ? money(review.invoicedUsd, usd) : "—"} />
            <Metric label="Shipping discount" value={money(review.discount, usd)} tone="var(--good)" />
            <Metric
              label="Variance"
              value={review.variance != null ? money(review.variance, usd) : "—"}
              tone={review.variance != null && Math.abs(review.variance) > 0.5 ? "var(--bad)" : "var(--good)"}
            />
            <Metric label="Invoiced (£)" value={review.invoicedGbp != null ? money(review.invoicedGbp, cur) : "—"} />
            <Metric label="Order revenue" value={money(review.revenueStore, cur)} />
          </div>

          {review.flags.length > 0 ? (
            <div className="notice mt small">
              {review.flags.map((f, i) => <div key={i}>⚠️ {f}</div>)}
            </div>
          ) : (
            <div className="notice good mt small">✅ Rates match your sheet, all orders are in OddBrew, and the total reconciles (difference is the ${review.discount} shipping discount).</div>
          )}

          <div className="row mt">
            <button className="btn primary" onClick={saveToLedger} disabled={busy}>Save to ledger</button>
            <button className="btn" onClick={() => setReview(null)}>Discard</button>
          </div>
        </div>
      )}

      <div className="card mt">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Invoice ledger</h3>
          <div className="muted small">Unpaid: <b>{money(unpaidTotal, cur)}</b> · Total spend: <b>{money(spendTotal, cur)}</b></div>
        </div>
        <div className="table-wrap mt">
          <table className="data">
            <thead><tr><th>Invoice</th><th>Orders</th><th className="num">£ total</th><th className="num">Variance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(ledger || []).map((i) => (
                <tr key={i.id}>
                  <td><b>{i.ref}</b><div className="muted small">{shortDate(i.savedAt)}</div></td>
                  <td className="small">{i.orders} · {i.units} cups</td>
                  <td className="num">{i.invoicedGbp != null ? money(i.invoicedGbp, cur) : "—"}</td>
                  <td className="num" style={{ color: i.variance != null && Math.abs(i.variance) > 0.5 ? "var(--bad)" : "var(--muted)" }}>
                    {i.variance != null ? money(i.variance, usd) : "—"}{i.flags && i.flags.length ? " ⚠️" : ""}
                  </td>
                  <td>
                    <button className={"badge " + (i.status === "paid" ? "green" : "yellow")} style={{ cursor: "pointer", border: "none" }} onClick={() => setStatus(i, i.status === "paid" ? "unpaid" : "paid")}>
                      {i.status === "paid" ? "Paid" : "Unpaid"}
                    </button>
                  </td>
                  <td className="num"><button className="btn small danger" onClick={() => removeInv(i.id)}>✕</button></td>
                </tr>
              ))}
              {ledger && !ledger.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>No invoices checked yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

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
  const [reviews, setReviews] = useState([]); // reconciliation results awaiting save
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

  const onFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setErr(null); setBusy(true);
    const out = [];
    for (const file of files) {
      try {
        const parsed = await parseInvoiceWorkbook(await file.arrayBuffer());
        if (!parsed.orders.length) throw new Error("no order sheet found — is this the OMGO invoice?");
        const rec = reconcileInvoice(parsed, orders, cfg);
        out.push({ key: uid(), ...rec, fileName: file.name });
      } catch (e) {
        out.push({ key: uid(), fileName: file.name, error: e.message || String(e) });
      }
    }
    setReviews((prev) => [...prev, ...out]);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const discardOne = (key) => setReviews((prev) => prev.filter((r) => r.key !== key));

  const saveAll = async () => {
    const good = reviews.filter((r) => !r.error);
    if (!good.length) return;
    setBusy(true); setErr(null);
    try {
      const rows = good.map((r) => {
        const { key, ...rest } = r;
        const rec = { id: uid(), ...rest, status: "unpaid", savedAt: new Date().toISOString(), savedByName: user.name };
        return { id: rec.id, data: rec, updated_at: new Date().toISOString() };
      });
      const { error } = await supabase.from("oddbrew_invoices").insert(rows);
      if (error) throw new Error(error.message);
      setReviews([]);
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
        <div className="muted small mt">Upload one or more OMGO <code>.xlsx</code> invoices. Each reconciles the charged costs against your OddBrew orders and cost rules before you pay — and their actual costs override the estimates in your P&amp;L.</div>
        <label className="field mt">
          <span className="lab">Invoice files (.xlsx) — select several at once</span>
          <input ref={fileRef} type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFiles(e.target.files)} disabled={busy} />
        </label>
        {busy && <div className="muted small">Reading…</div>}
      </div>

      {reviews.length > 0 && (
        <div className="card mt">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>{reviews.length} invoice{reviews.length === 1 ? "" : "s"} to check</h3>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn primary" onClick={saveAll} disabled={busy || !reviews.some((r) => !r.error)}>Save all to ledger</button>
              <button className="btn" onClick={() => setReviews([])}>Discard all</button>
            </div>
          </div>

          {reviews.map((r) => (
            <div key={r.key} className="mt" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              {r.error ? (
                <div className="notice bad small">⚠️ <b>{r.fileName}</b>: {r.error} <button className="btn small" style={{ marginLeft: 8 }} onClick={() => discardOne(r.key)}>Remove</button></div>
              ) : (
                <>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <b>{r.ref || r.fileName}</b>
                      <div className="muted small">{r.orders} orders · {r.units} cups · {r.orderNumbers.join(", ")}</div>
                    </div>
                    <span className={"badge " + (r.ok ? "green" : "yellow")}>{r.ok ? "Looks right ✓" : "Check flags"}</span>
                  </div>

                  <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(138px, 1fr))", gap: 10 }}>
                    <Metric label="Expected (rules)" value={money(r.expectedUsd, usd)} />
                    <Metric label="Invoiced" value={r.invoicedUsd != null ? money(r.invoicedUsd, usd) : "—"} />
                    <Metric label="Shipping discount" value={money(r.discount, usd)} tone="var(--good)" />
                    <Metric label="Variance" value={r.variance != null ? money(r.variance, usd) : "—"} tone={r.variance != null && Math.abs(r.variance) > 0.5 ? "var(--bad)" : "var(--good)"} />
                    <Metric label="Invoiced (£)" value={r.invoicedGbp != null ? money(r.invoicedGbp, cur) : "—"} />
                    <Metric label="Order revenue" value={money(r.revenueStore, cur)} />
                  </div>

                  {r.flags.length > 0 ? (
                    <div className="notice mt small">{r.flags.map((f, i) => <div key={i}>⚠️ {f}</div>)}</div>
                  ) : (
                    <div className="notice good mt small">✅ Rates match your sheet, all orders are in OddBrew, and the total reconciles.</div>
                  )}

                  <div className="row mt"><button className="btn small" onClick={() => discardOne(r.key)}>Discard this one</button></div>
                </>
              )}
            </div>
          ))}
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

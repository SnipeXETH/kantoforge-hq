import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import { activeOrders, buildInvoiceCostIndex, oddbrewTotals } from "../lib/oddbrew";

const ymd = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const shiftDay = (dateStr, delta) => ymd(new Date(new Date(dateStr + "T12:00:00").getTime() + delta * 86400000));
const prettyDate = (dateStr) => new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const fmtRoas = (x) => (x == null || !isFinite(x) ? "—" : x.toFixed(2) + "×");

function Stat({ label, value, sub, tone, accent }) {
  return (
    <div className="card" style={{ margin: 0, position: "relative", overflow: "hidden" }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />}
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 750, marginTop: 5, lineHeight: 1.1, color: tone || "var(--text)" }}>{value}</div>
      {sub != null && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const dayTotalsFor = (active, cfg, costIndex, dateStr) =>
  oddbrewTotals(active.filter((o) => (o.date || "").slice(0, 10) === dateStr), cfg, costIndex);

export default function OddBrewDaily({ orders, adspend, invoices, cfg, connected, onSync, syncing, onReload }) {
  const cur = cfg.currency || "GBP";
  const todayStr = ymd(new Date());
  const [date, setDate] = useState(shiftDay(todayStr, -1)); // reconcile: yesterday
  const [spendInput, setSpendInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [estSpend, setEstSpend] = useState(""); // today's estimate — never saved

  const active = activeOrders(orders || [], cfg);
  const costIndex = buildInvoiceCostIndex(invoices || [], active, cfg);

  const overall = oddbrewTotals(active, cfg, costIndex);
  const margin = overall.revenue > 0 ? overall.grossProfit / overall.revenue : null;
  const breakEven = margin > 0 ? 1 / margin : null;

  // --- reconcile day ---
  const isFuture = date > todayStr;
  const dayT = dayTotalsFor(active, cfg, costIndex, date);
  const spendEntry = (adspend || []).find((s) => s.id === date);
  const savedSpend = spendEntry ? Number(spendEntry.amount) || 0 : null;
  const reconciled = savedSpend != null;
  const dayNet = dayT.grossProfit - (savedSpend || 0);
  const dayRoas = savedSpend ? dayT.revenue / savedSpend : null;

  const goDate = (d) => { setDate(d); setSpendInput(""); setErr(null); setNote(null); };

  const doSync = async () => {
    setErr(null); setNote(null); setBusy(true);
    try { if (onSync) await onSync(); setNote("Synced — revenue & costs are up to date."); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };
  const saveSpend = async () => {
    setErr(null); setNote(null); setBusy(true);
    try {
      const amount = spendInput === "" ? 0 : parseFloat(spendInput) || 0;
      const rec = { date, day: date, amount, currency: cur, source: "daily" };
      const { error } = await supabase.from("oddbrew_adspend").upsert({ id: date, data: rec, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      if (onReload) await onReload();
      setSpendInput("");
      setNote(`Saved ${money(amount, cur)} ad spend for ${date}. Day done ✓`);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  // --- today's live estimate (not saved) ---
  const todayT = dayTotalsFor(active, cfg, costIndex, todayStr);
  const estSpendNum = estSpend === "" ? 0 : parseFloat(estSpend) || 0;
  const estNet = todayT.grossProfit - estSpendNum;
  const estRoas = estSpendNum > 0 ? todayT.revenue / estSpendNum : null;

  return (
    <>
      {/* ---------- Reconcile the previous day ---------- */}
      <div className="card" style={{ marginTop: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>Reconcile the day {reconciled && <span className="badge green" style={{ marginLeft: 6 }}>✓ Done</span>}</h3>
            <div className="muted small">Do this the morning after — a finished day has all its orders and final ad spend.</div>
          </div>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <button className="btn small" onClick={() => goDate(shiftDay(date, -1))} title="Previous day">‹</button>
            <div style={{ minWidth: 150, textAlign: "center", fontWeight: 700 }}>{prettyDate(date)}</div>
            <button className="btn small" onClick={() => goDate(shiftDay(date, 1))} disabled={isFuture} title="Next day">›</button>
            {date !== shiftDay(todayStr, -1) && <button className="btn small" onClick={() => goDate(shiftDay(todayStr, -1))}>Yesterday</button>}
          </div>
        </div>

        {err && <div className="notice bad mt small">⚠️ {err}</div>}
        {note && <div className="notice good mt small">✅ {note}</div>}

        <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <Stat label="Revenue" value={money(dayT.revenue, cur)} sub={`${dayT.orders} orders · ${dayT.units} units`} accent="var(--c-revenue)" />
          <Stat label="Gross profit" value={money(dayT.grossProfit, cur)} sub="after fees & COGS" accent="var(--c-profit)" />
          <Stat label="Ad spend" value={savedSpend != null ? money(savedSpend, cur) : "—"} sub={savedSpend != null ? "saved" : "not entered"} accent="#e8934a" />
          <Stat label="Net profit" value={money(dayNet, cur)} sub={savedSpend != null ? "revenue − fees, COGS & ads" : "before ad spend"} accent={dayNet >= 0 ? "var(--good)" : "var(--bad)"} tone={dayNet >= 0 ? "var(--good)" : "var(--bad)"} />
        </div>

        <div className="row mt" style={{ gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          {connected && (
            <div>
              <div className="lab" style={{ marginBottom: 4 }}>1 · Pull orders</div>
              <button className="btn" onClick={doSync} disabled={busy || syncing}>{busy || syncing ? "Syncing…" : "⟳ Sync Shopify"}</button>
            </div>
          )}
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="lab">{connected ? "2 · " : ""}Meta ad spend ({cur})</span>
            <input type="number" step="0.01" value={spendInput} onChange={(e) => setSpendInput(e.target.value)} placeholder={savedSpend != null ? String(savedSpend) : "0.00"} />
          </label>
          <button className="btn primary" onClick={saveSpend} disabled={busy}>{busy ? "Saving…" : reconciled ? "Update spend" : "Save & finish day"}</button>
        </div>
        {savedSpend != null && breakEven != null && (
          <div className="muted small mt">Day ROAS <b>{fmtRoas(dayRoas)}</b> vs break-even {fmtRoas(breakEven)} — {dayRoas >= breakEven ? "ads paid off 👍" : "ads ran at a loss 👇"}.</div>
        )}
        <div className="muted small mt">Fixed monthly overhead isn't counted per day — the Overview tab has the full monthly P&amp;L.</div>
      </div>

      {/* ---------- Today's live estimate (nothing saved) ---------- */}
      <div className="card mt">
        <h3 style={{ marginBottom: 2 }}>Today so far — quick estimate</h3>
        <div className="muted small mb">A live feel for how {prettyDate(todayStr)} is going. Nothing is saved — enter a rough ad spend to see where you'd land. Today isn't finished, so treat it as a guide.</div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <Stat label="Revenue so far" value={money(todayT.revenue, cur)} sub={`${todayT.orders} orders`} accent="var(--c-revenue)" />
          <Stat label="Gross profit" value={money(todayT.grossProfit, cur)} sub="after fees & COGS" accent="var(--c-profit)" />
          <Stat label="Est. net" value={money(estNet, cur)} sub={estSpendNum > 0 ? "minus your est. spend" : "enter spend →"} accent={estNet >= 0 ? "var(--good)" : "var(--bad)"} tone={estNet >= 0 ? "var(--good)" : "var(--bad)"} />
          <Stat label="Est. ROAS" value={fmtRoas(estRoas)} sub={breakEven != null ? `break-even ${fmtRoas(breakEven)}` : "—"} accent={estRoas != null && breakEven != null ? (estRoas >= breakEven ? "var(--good)" : "var(--bad)") : "#888"} tone={estRoas != null && breakEven != null ? (estRoas >= breakEven ? "var(--good)" : "var(--bad)") : undefined} />
        </div>
        <label className="field mt" style={{ maxWidth: 220 }}>
          <span className="lab">Today's ad spend so far ({cur})</span>
          <input type="number" step="0.01" value={estSpend} onChange={(e) => setEstSpend(e.target.value)} placeholder="0.00" />
          <span className="hint">Just for this view — not stored anywhere.</span>
        </label>
        {connected && (
          <div className="row mt"><button className="btn small" onClick={doSync} disabled={busy || syncing}>{busy || syncing ? "Syncing…" : "⟳ Sync latest orders"}</button></div>
        )}
      </div>
    </>
  );
}

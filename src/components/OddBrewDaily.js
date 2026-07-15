import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { money, uid } from "../lib/format";
import { activeOrders, buildInvoiceCostIndex, oddbrewTotals, parseMetaSpendCsv, parseMetaCampaignsCsv } from "../lib/oddbrew";

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

const STEPS = ["Orders", "Ad spend", "Campaign ROAS", "Review"];

export default function OddBrewDaily({ orders, adspend, invoices, cfg, connected, saveCfg, onSync, syncing, onReload }) {
  const cur = cfg.currency || "GBP";
  const todayStr = ymd(new Date());
  const [date, setDate] = useState(shiftDay(todayStr, -1)); // default: yesterday
  const [step, setStep] = useState(0);
  const [spendInput, setSpendInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const isFuture = date > todayStr;
  const isToday = date === todayStr;

  const active = activeOrders(orders || [], cfg);
  const costIndex = buildInvoiceCostIndex(invoices || [], active, cfg);
  const dayOrders = active.filter((o) => (o.date || "").slice(0, 10) === date);
  const dayTotals = oddbrewTotals(dayOrders, cfg, costIndex);

  const overall = oddbrewTotals(active, cfg, costIndex);
  const margin = overall.revenue > 0 ? overall.grossProfit / overall.revenue : null;
  const breakEven = margin > 0 ? 1 / margin : null;

  const spendEntry = (adspend || []).find((s) => s.id === date);
  const daySpend = spendEntry ? Number(spendEntry.amount) || 0 : null;
  const dayRoas = daySpend ? dayTotals.revenue / daySpend : null;
  const dayNet = dayTotals.grossProfit - (daySpend || 0);

  const doneMap = cfg.dailyDone || {};
  const isDone = !!doneMap[date];
  // streak: consecutive reconciled days ending yesterday
  let streak = 0;
  for (let d = shiftDay(todayStr, -1); doneMap[d]; d = shiftDay(d, -1)) streak++;

  const goDate = (d) => { setDate(d); setStep(0); setSpendInput(""); setErr(null); setNote(null); };

  const saveSpend = async (amount) => {
    const rec = { date, day: date, amount: Number(amount) || 0, currency: cur, source: "daily" };
    const { error } = await supabase.from("oddbrew_adspend").upsert({ id: date, data: rec, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    if (onReload) await onReload();
  };

  const onSpendCsv = async (files) => {
    const file = files && files[0];
    if (!file) return;
    setErr(null); setNote(null);
    try {
      const p = parseMetaSpendCsv(await file.text());
      let amount = null;
      if (p.mode === "daily") {
        const row = (p.days || []).find((d) => d.date === date);
        if (!row) throw new Error(`This export has no row for ${date}. Set Meta's date range to that day, or type the amount below.`);
        amount = row.amount;
      } else {
        amount = p.total; // a single-day export → its total is that day
      }
      setSpendInput(String(amount));
      setNote(`Read ${money(amount, cur)} for ${date} from Meta.`);
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  const onCampaignCsv = async (files) => {
    const file = files && files[0];
    if (!file) return;
    setErr(null); setNote(null);
    try {
      const parsed = parseMetaCampaignsCsv(await file.text());
      const ads = cfg.ads || {};
      const byName = new Map((ads.campaigns || []).map((c) => [c.name.trim().toLowerCase(), c]));
      for (const pc of parsed.campaigns) {
        const key = pc.name.trim().toLowerCase();
        const ex = byName.get(key);
        byName.set(key, ex ? { ...ex, spend: pc.spend, revenue: pc.revenue } : { id: uid(), name: pc.name, spend: pc.spend, revenue: pc.revenue });
      }
      await saveCfg({ ...cfg, ads: { ...ads, campaigns: Array.from(byName.values()) } });
      setNote(`Imported ${parsed.campaigns.length} campaign${parsed.campaigns.length === 1 ? "" : "s"} into the scorecard.`);
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  const step1Sync = async () => {
    setErr(null); setBusy(true);
    try { if (onSync) await onSync(); setStep(1); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };
  const step2Save = async () => {
    setErr(null); setBusy(true);
    try { await saveSpend(spendInput === "" ? 0 : spendInput); setStep(2); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };
  const finish = async () => {
    setErr(null); setBusy(true);
    try { await saveCfg({ ...cfg, dailyDone: { ...doneMap, [date]: true } }); setNote(`${prettyDate(date)} reconciled 🎉`); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  };

  // prefill the spend box with any saved value when landing on step 2
  const enterSpendStep = () => { if (spendInput === "" && daySpend != null) setSpendInput(String(daySpend)); setStep(1); };

  return (
    <>
      <div className="card" style={{ marginTop: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <button className="btn small" onClick={() => goDate(shiftDay(date, -1))} title="Previous day">‹</button>
            <div>
              <div style={{ fontWeight: 750, fontSize: 18 }}>{prettyDate(date)} {isDone && <span className="badge green" style={{ marginLeft: 6 }}>✓ Done</span>}</div>
              <div className="muted small">{isToday ? "Today — not finished yet" : date}</div>
            </div>
            <button className="btn small" onClick={() => goDate(shiftDay(date, 1))} disabled={isFuture} title="Next day">›</button>
            <button className="btn small" onClick={() => goDate(shiftDay(todayStr, -1))}>Yesterday</button>
          </div>
          <div className="muted small" style={{ textAlign: "right" }}>
            {streak > 0 ? <>🔥 <b>{streak}</b>-day streak</> : "Reconcile a completed day"}
          </div>
        </div>

        {isToday && (
          <div className="notice mt small">⏳ Today isn't over, so orders and ad spend are incomplete. The best routine is to reconcile <b>yesterday</b> each morning — a closed day is final. <button className="btn small" style={{ marginLeft: 6 }} onClick={() => goDate(shiftDay(todayStr, -1))}>Switch to yesterday</button></div>
        )}
      </div>

      {/* stepper */}
      <div className="row mt" style={{ gap: 6, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} className={"btn small" + (i === step ? " primary" : "")} style={{ opacity: i < step ? 0.85 : 1 }}>
            {i < step ? "✓ " : `${i + 1}. `}{s}
          </button>
        ))}
      </div>

      {err && <div className="notice bad mt small">⚠️ {err}</div>}
      {note && <div className="notice good mt small">✅ {note}</div>}

      {step === 0 && (
        <div className="card mt">
          <h3>1 · Orders for {date}</h3>
          <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Stat label="Orders" value={dayTotals.orders} accent="var(--c-revenue)" />
            <Stat label="Units" value={dayTotals.units} accent="#4a90e8" />
            <Stat label="Revenue" value={money(dayTotals.revenue, cur)} accent="var(--c-profit)" />
          </div>
          <div className="muted small mt">Pull the latest orders so this day is complete, then continue.</div>
          <div className="row mt" style={{ gap: 8 }}>
            {connected
              ? <button className="btn primary" onClick={step1Sync} disabled={busy || syncing}>{busy || syncing ? "Syncing…" : "⟳ Sync Shopify & continue"}</button>
              : <span className="muted small">Not connected to Shopify — import orders on the Overview tab, or continue.</span>}
            <button className="btn" onClick={enterSpendStep}>{connected ? "Already synced — continue" : "Continue"}</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card mt">
          <h3>2 · Ad spend for {date}</h3>
          <div className="muted small mb">Enter the day's Meta spend (type it, or drop a Meta export for that day). Enter <b>0</b> if you didn't run ads.</div>
          <div className="form-row">
            <label className="field" style={{ maxWidth: 220 }}>
              <span className="lab">Meta ad spend ({cur})</span>
              <input type="number" step="0.01" value={spendInput} onChange={(e) => setSpendInput(e.target.value)} placeholder={daySpend != null ? String(daySpend) : "0.00"} autoFocus />
              {daySpend != null && <span className="hint">Currently saved: {money(daySpend, cur)}</span>}
            </label>
            <label className="field" style={{ maxWidth: 260 }}>
              <span className="lab">…or drop a Meta CSV</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => onSpendCsv(e.target.files)} />
              <span className="hint">Set Meta's date range to {date} and export.</span>
            </label>
          </div>
          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn primary" onClick={step2Save} disabled={busy}>{busy ? "Saving…" : "Save & continue"}</button>
            <button className="btn" onClick={() => setStep(2)}>Skip</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card mt">
          <h3>3 · Campaign ROAS <span className="muted small">(optional)</span></h3>
          <div className="muted small mb">Drop a Meta <b>campaign breakdown</b> export to refresh the ROAS scorecard. Handy weekly rather than daily, since Meta keeps updating attribution for a few days.</div>
          <div className="form-row">
            <label className="field" style={{ maxWidth: 300 }}>
              <span className="lab">Meta campaign CSV</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => onCampaignCsv(e.target.files)} />
              <span className="hint">Needs Amount spent + Purchases conversion value (or ROAS).</span>
            </label>
          </div>
          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => setStep(3)}>Continue to review</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card mt">
          <h3>4 · {prettyDate(date)} — the day in numbers</h3>
          <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <Stat label="Revenue" value={money(dayTotals.revenue, cur)} sub={`${dayTotals.orders} orders`} accent="var(--c-revenue)" />
            <Stat label="Gross profit" value={money(dayTotals.grossProfit, cur)} sub="after fees & COGS" accent="var(--c-profit)" />
            <Stat label="Ad spend" value={daySpend != null ? money(daySpend, cur) : "—"} sub="Meta" accent="#e8934a" />
            <Stat label="Net profit" value={money(dayNet, cur)} sub="before fixed overhead" accent={dayNet >= 0 ? "var(--good)" : "var(--bad)"} tone={dayNet >= 0 ? "var(--good)" : "var(--bad)"} />
            <Stat label="Day ROAS" value={fmtRoas(dayRoas)} sub={breakEven != null ? `break-even ${fmtRoas(breakEven)}` : "—"} accent={dayRoas != null && breakEven != null ? (dayRoas >= breakEven ? "var(--good)" : "var(--bad)") : "#888"} tone={dayRoas != null && breakEven != null ? (dayRoas >= breakEven ? "var(--good)" : "var(--bad)") : undefined} />
          </div>

          {daySpend != null && breakEven != null && (
            <div className={"notice mt small " + (dayRoas >= breakEven ? "good" : "bad")}>
              {dayRoas >= breakEven
                ? `👍 ROAS ${fmtRoas(dayRoas)} beat break-even ${fmtRoas(breakEven)} — ads paid off.`
                : `👇 ROAS ${fmtRoas(dayRoas)} was below break-even ${fmtRoas(breakEven)} — ads ran at a loss this day.`}
            </div>
          )}

          <div className="muted small mt">Fixed monthly overhead isn't subtracted per day — see the Overview for the full monthly P&amp;L.</div>

          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn primary" onClick={finish} disabled={busy || isDone}>{isDone ? "✓ Marked complete" : (busy ? "Saving…" : `Mark ${date} complete ✓`)}</button>
            <button className="btn" onClick={() => goDate(shiftDay(date, -1))}>Do the day before</button>
            {isDone && <button className="btn" onClick={() => goDate(shiftDay(date, 1))} disabled={date >= todayStr}>Next day ›</button>}
          </div>
        </div>
      )}
    </>
  );
}

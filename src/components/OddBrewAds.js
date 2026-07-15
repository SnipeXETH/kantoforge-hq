import React, { useState } from "react";
import { uid, money } from "../lib/format";
import { activeOrders, buildInvoiceCostIndex, oddbrewTotals } from "../lib/oddbrew";

const RANGES = [["all", "All time"], ["12m", "12 months"], ["90d", "90 days"]];
const fmtRoas = (x) => (x == null || !isFinite(x) ? "—" : x.toFixed(2) + "×");

function Stat({ label, value, sub, tone, accent }) {
  return (
    <div className="card" style={{ margin: 0, position: "relative", overflow: "hidden" }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />}
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 27, fontWeight: 750, marginTop: 5, lineHeight: 1.1, color: tone || "var(--text)" }}>{value}</div>
      {sub != null && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// Break-even ROAS is 1 / gross-margin: a sale's contribution (revenue − fees −
// COGS) has to cover the ad spend that won it. To also leave a target margin t
// on that revenue, the ad needs ROAS ≥ 1 / (margin − t).
export default function OddBrewAds({ orders, cfg, invoices, saveCfg }) {
  const cur = cfg.currency || "GBP";
  const [range, setRange] = useState("all");

  const inRange = (o) => {
    if (range === "all") return true;
    if (!o.date) return false;
    const days = range === "90d" ? 90 : 365;
    return Date.now() - new Date(o.date).getTime() <= days * 86400000;
  };

  const active = activeOrders(orders || [], cfg).filter(inRange);
  const costIndex = buildInvoiceCostIndex(invoices || [], active, cfg);
  const totals = oddbrewTotals(active, cfg, costIndex);
  const computedMargin = totals.revenue > 0 ? totals.grossProfit / totals.revenue : null;

  const ads = cfg.ads || {};
  const targetMargin = ads.targetMargin != null ? ads.targetMargin : 20; // % of revenue
  const marginOverride = ads.marginOverride; // % or undefined
  const m = marginOverride != null && marginOverride !== "" ? Number(marginOverride) / 100 : computedMargin;

  const breakEven = m > 0 ? 1 / m : null;
  const t = Number(targetMargin) / 100;
  const targetRoas = m - t > 0 ? 1 / (m - t) : null;

  const campaigns = ads.campaigns || [];
  const saveAds = (patch) => saveCfg({ ...cfg, ads: { ...ads, ...patch } });
  const num = (v) => (v === "" ? 0 : parseFloat(v) || 0);
  const addCampaign = () => saveAds({ campaigns: [...campaigns, { id: uid(), name: "", spend: 0, revenue: 0 }] });
  const updateCampaign = (i, patch) => saveAds({ campaigns: campaigns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const removeCampaign = (i) => saveAds({ campaigns: campaigns.filter((_, idx) => idx !== i) });

  const evalC = (c) => {
    const spend = Number(c.spend) || 0;
    const revenue = Number(c.revenue) || 0;
    const roas = spend > 0 ? revenue / spend : null;
    const contribution = m != null ? revenue * m : null; // gross profit before ad spend
    const profit = contribution != null ? contribution - spend : null; // profit the ad actually made
    const good = breakEven != null && roas != null ? roas >= breakEven : null;
    return { spend, revenue, roas, profit, good };
  };
  const sum = campaigns.reduce((a, c) => { const e = evalC(c); a.spend += e.spend; a.revenue += e.revenue; a.profit += e.profit || 0; return a; }, { spend: 0, revenue: 0, profit: 0 });
  const blendedRoas = sum.spend > 0 ? sum.revenue / sum.spend : null;

  const goalRows = [0, 10, 20, 30].map((g) => ({ g, roas: m - g / 100 > 0 ? 1 / (m - g / 100) : null }));

  return (
    <>
      <div className="pills mb">
        {RANGES.map(([k, l]) => (
          <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{l}</button>
        ))}
      </div>

      {m == null ? (
        <div className="notice mb">Add some orders (and product costs) first — the break-even ROAS is worked out from your real margin.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Stat label="Gross margin" value={(m * 100).toFixed(1) + "%"} sub={marginOverride != null && marginOverride !== "" ? "manual override" : "revenue − fees − COGS"} accent="var(--c-profit)" />
          <Stat label="Break-even ROAS" value={fmtRoas(breakEven)} sub="ads below this lose money" accent="#e8934a" tone="#e8934a" />
          <Stat label={`ROAS for ${targetMargin}% margin`} value={fmtRoas(targetRoas)} sub={targetRoas ? "aim above this" : "target above your margin"} accent="var(--c-revenue)" />
        </div>
      )}

      {m != null && totals.cogs <= 0 && (
        <div className="notice mt small">⚠️ No product costs are set, so this margin only subtracts Shopify fees — the real break-even ROAS is higher. Add size costs on the Overview tab for an accurate figure.</div>
      )}

      <div className="card mt">
        <h3 style={{ marginBottom: 2 }}>Targets</h3>
        <div className="muted small mb">Break-even ROAS = 1 ÷ gross margin. Set a profit goal and (optionally) override the margin used.</div>
        <div className="form-row">
          <label className="field" style={{ maxWidth: 220 }}>
            <span className="lab">Target profit margin (%)</span>
            <input type="number" step="1" value={ads.targetMargin == null ? "" : ads.targetMargin} onChange={(e) => saveAds({ targetMargin: num(e.target.value) })} placeholder="20" />
            <span className="hint">Profit you want left on ad-driven revenue, after fees, COGS &amp; the ad spend.</span>
          </label>
          <label className="field" style={{ maxWidth: 220 }}>
            <span className="lab">Margin override (%)</span>
            <input type="number" step="0.1" value={ads.marginOverride == null ? "" : ads.marginOverride} onChange={(e) => saveAds({ marginOverride: e.target.value === "" ? "" : num(e.target.value) })} placeholder={computedMargin != null ? (computedMargin * 100).toFixed(1) : "auto"} />
            <span className="hint">Leave blank to use your actual {computedMargin != null ? (computedMargin * 100).toFixed(1) + "%" : ""} margin.</span>
          </label>
        </div>
        {m != null && (
          <div className="table-wrap mt">
            <table className="data">
              <thead><tr><th>Profit goal</th><th className="num">ROAS needed</th></tr></thead>
              <tbody>
                {goalRows.map((r) => (
                  <tr key={r.g}>
                    <td>{r.g === 0 ? "Break even (0%)" : `${r.g}% margin`}</td>
                    <td className="num"><b>{fmtRoas(r.roas)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>Campaign scorecard</h3>
            <div className="muted small">Enter each campaign's spend and the revenue it drove (from Meta / your store). Green means it's beating your break-even ROAS.</div>
          </div>
          <button className="btn small" onClick={addCampaign}>+ Add campaign</button>
        </div>

        {campaigns.length > 0 ? (
          <div className="table-wrap mt">
            <table className="data">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="num">Spend</th>
                  <th className="num">Revenue</th>
                  <th className="num">ROAS</th>
                  <th className="num">Profit</th>
                  <th className="num">Verdict</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => {
                  const e = evalC(c);
                  return (
                    <tr key={c.id || i}>
                      <td><input type="text" value={c.name} onChange={(ev) => updateCampaign(i, { name: ev.target.value })} placeholder="e.g. Prospecting — UK" style={{ width: 160 }} /></td>
                      <td className="num"><input type="number" step="0.01" value={c.spend} onChange={(ev) => updateCampaign(i, { spend: num(ev.target.value) })} style={{ width: 84 }} /></td>
                      <td className="num"><input type="number" step="0.01" value={c.revenue} onChange={(ev) => updateCampaign(i, { revenue: num(ev.target.value) })} style={{ width: 84 }} /></td>
                      <td className="num"><b>{fmtRoas(e.roas)}</b></td>
                      <td className="num" style={{ color: e.profit == null ? "var(--text)" : e.profit >= 0 ? "var(--good)" : "var(--bad)" }}>{e.profit == null ? "—" : money(e.profit, cur)}</td>
                      <td className="num">
                        {e.good == null ? <span className="muted">—</span>
                          : e.good ? <span className="badge green">Profitable</span>
                            : <span className="badge red">Losing</span>}
                      </td>
                      <td><button className="btn small danger" onClick={() => removeCampaign(i)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
              {campaigns.length > 1 && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>All campaigns</td>
                    <td className="num">{money(sum.spend, cur)}</td>
                    <td className="num">{money(sum.revenue, cur)}</td>
                    <td className="num">{fmtRoas(blendedRoas)}</td>
                    <td className="num" style={{ color: sum.profit >= 0 ? "var(--good)" : "var(--bad)" }}>{money(sum.profit, cur)}</td>
                    <td className="num">{breakEven != null && blendedRoas != null ? (blendedRoas >= breakEven ? <span className="badge green">Profitable</span> : <span className="badge red">Losing</span>) : <span className="muted">—</span>}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="muted mt">No campaigns yet — add one to check it against your break-even ROAS of <b>{fmtRoas(breakEven)}</b>.</div>
        )}
        <div className="hint mt">Profit here is the campaign's contribution (revenue × {m != null ? (m * 100).toFixed(0) + "%" : "margin"} gross margin) minus its spend — what the ad itself made, before fixed overhead.</div>
      </div>
    </>
  );
}

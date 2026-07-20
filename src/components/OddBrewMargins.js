import React, { useMemo, useState } from "react";
import { money } from "../lib/format";
import { activeOrders, productMargins, discountContribution, maxDiscountPct, discountAtMargin, ODDBREW_RANGES, inOddbrewRange } from "../lib/oddbrew";

const DISCOUNTS = [5, 10, 15, 20];
const pct = (x) => (x == null ? "—" : x.toFixed(1) + "%");

function Stat({ label, value, sub, tone, accent }) {
  return (
    <div className="card" style={{ margin: 0, position: "relative", overflow: "hidden" }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />}
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 750, marginTop: 5, lineHeight: 1.1, color: tone || "var(--text)" }}>{value}</div>
      {sub != null && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const marginTone = (m) => (m == null ? "var(--text)" : m >= 45 ? "var(--good)" : m >= 25 ? "#e8934a" : "var(--bad)");

export default function OddBrewMargins({ orders, cfg, saveCfg }) {
  const cur = cfg.currency || "GBP";
  const [range, setRange] = useState("all");
  const inRange = (o) => inOddbrewRange(o.date, range);

  // Minimum-margin floor — the rule we won't sell below. Saved to config.
  const savedFloor = cfg.marginFloor == null ? 30 : cfg.marginFloor;
  const [floorInput, setFloorInput] = useState("");
  const floor = floorInput === "" ? savedFloor : Math.max(0, Math.min(90, parseFloat(floorInput) || 0));
  const commitFloor = () => {
    if (floorInput === "" || !saveCfg) return;
    const v = Math.max(0, Math.min(90, parseFloat(floorInput) || 0));
    if (v !== savedFloor) saveCfg({ ...cfg, marginFloor: v });
    setFloorInput("");
  };

  const rows = useMemo(() => productMargins(activeOrders(orders || [], cfg).filter(inRange), cfg), [orders, cfg, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = rows.reduce((a, r) => { a.units += r.units; a.revenue += r.revenue; a.cost += r.cost; a.profit += r.profit; return a; }, { units: 0, revenue: 0, cost: 0, profit: 0 });
  const totMargin = tot.revenue > 0 ? (tot.profit / tot.revenue) * 100 : null;

  const feePct = (cfg.shopify && cfg.shopify.paymentPct) || 0;
  const feeFixed = (cfg.shopify && cfg.shopify.paymentFixed) || 0;

  // Discount calculator — prefilled with the store's weighted-average cup.
  const avgPrice = tot.units ? +(tot.revenue / tot.units).toFixed(2) : 24;
  const avgCost = tot.units ? +(tot.cost / tot.units).toFixed(2) : 10;
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const p = price === "" ? avgPrice : parseFloat(price) || 0;
  const c = cost === "" ? avgCost : parseFloat(cost) || 0;

  const base = discountContribution(p, c, feePct, feeFixed, 0);
  const maxD = maxDiscountPct(p, c, feePct, feeFixed);
  const safeD = discountAtMargin(p, c, feePct, feeFixed, floor); // biggest discount that still clears the floor
  const scenarios = DISCOUNTS.map((d) => {
    const r = discountContribution(p, c, feePct, feeFixed, d);
    const volMult = base.contribution > 0 && r.contribution > 0 ? base.contribution / r.contribution : null;
    return { d, ...r, extraUnits: volMult != null ? (volMult - 1) * 100 : null, loss: r.contribution < 0, belowFloor: r.margin < floor };
  });

  return (
    <>
      <div className="pills mb">
        {ODDBREW_RANGES.map(([k, l]) => (
          <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{l}</button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 12 }}>
        <Stat label="Revenue" value={money(tot.revenue, cur)} sub={`${tot.units} units`} accent="var(--c-revenue)" />
        <Stat label="Product cost" value={money(tot.cost, cur)} sub="landed, from size rules" accent="#e8934a" />
        <Stat label="Gross profit" value={money(tot.profit, cur)} sub="before fees & ads" accent="var(--c-profit)" />
        <Stat label="Gross margin" value={pct(totMargin)} sub="blended across products" accent={marginTone(totMargin)} tone={marginTone(totMargin)} />
      </div>

      {/* ---- per-product margins ---- */}
      <div className="card mt">
        <h3 style={{ marginBottom: 2 }}>Margin by product</h3>
        <div className="muted small mb">Gross margin per variant — line revenue minus landed product cost (per destination region). Fees &amp; ad spend are store-level, so this is the “does this cup make money” view.</div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className="num">Units</th>
                  <th className="num">Revenue</th>
                  <th className="num">Avg price</th>
                  <th className="num">Avg cost</th>
                  <th className="num">Gross profit</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {!r.matched && <div className="muted small">⚠️ no size cost rule — cost counted as £0</div>}
                    </td>
                    <td className="num">{r.units}</td>
                    <td className="num">{money(r.revenue, cur)}</td>
                    <td className="num">{money(r.unitPrice, cur)}</td>
                    <td className="num">{money(r.unitCost, cur)}</td>
                    <td className="num">{money(r.profit, cur)}</td>
                    <td className="num" style={{ color: marginTone(r.margin), fontWeight: 700 }}>{pct(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>All products</td>
                  <td className="num">{tot.units}</td>
                  <td className="num">{money(tot.revenue, cur)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">{money(tot.profit, cur)}</td>
                  <td className="num" style={{ color: marginTone(totMargin) }}>{pct(totMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="muted mt">No sales in this range yet. Add product cost rules on the Overview tab so margins can be worked out.</div>
        )}
      </div>

      {/* ---- discount calculator ---- */}
      <div className="card mt">
        <h3 style={{ marginBottom: 2 }}>How much discount can we afford?</h3>
        <div className="muted small mb">Worked out on one order after the Shopify fee ({feePct}% + {money(feeFixed, cur)}). Prefilled with your average cup — override to model a specific product.</div>

        <div className="form-row">
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="lab">Selling price ({cur})</span>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(avgPrice)} />
            <span className="hint">Avg from sales: {money(avgPrice, cur)}</span>
          </label>
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="lab">Product cost ({cur})</span>
            <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={String(avgCost)} />
            <span className="hint">Avg landed: {money(avgCost, cur)}</span>
          </label>
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="lab">Minimum margin floor</span>
            <input type="number" step="1" min="0" max="90" value={floorInput === "" ? savedFloor : floorInput}
              onChange={(e) => setFloorInput(e.target.value)} onBlur={commitFloor}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} disabled={!saveCfg} />
            <span className="hint">Our rule: never sell below this margin{saveCfg ? " · saved" : ""}</span>
          </label>
        </div>

        <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 12 }}>
          <Stat label="Profit / order now" value={money(base.contribution, cur)} sub="after fee & cost" accent="var(--c-profit)" />
          <Stat label="Margin now" value={pct(base.margin)} sub="contribution margin" accent={marginTone(base.margin)} tone={marginTone(base.margin)} />
          <Stat label={`Safe max discount (≥${floor.toFixed(0)}% margin)`} value={pct(safeD)} sub="biggest promo that keeps the floor" accent="var(--good)" tone="var(--good)" />
          <Stat label="Break-even discount" value={pct(maxD)} sub="0 profit at this discount" accent="var(--bad)" tone="var(--bad)" />
        </div>

        <div className="table-wrap mt">
          <table className="data">
            <thead>
              <tr>
                <th>Discount</th>
                <th className="num">New price</th>
                <th className="num">Profit / order</th>
                <th className="num">Margin</th>
                <th className="num">Units to hold profit</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.d} className={s.loss ? "warn-row" : ""}>
                  <td>
                    <b>{s.d}% off</b>
                    {!s.loss && s.belowFloor && <span className="badge yellow" style={{ marginLeft: 8 }}>below floor</span>}
                  </td>
                  <td className="num">{money(s.price, cur)}</td>
                  <td className="num" style={{ color: s.contribution >= 0 ? "var(--text)" : "var(--bad)", fontWeight: 600 }}>{money(s.contribution, cur)}</td>
                  <td className="num" style={{ color: marginTone(s.margin) }}>{pct(s.margin)}</td>
                  <td className="num">{s.loss ? <span className="badge red">loses money</span> : s.extraUnits != null ? `+${s.extraUnits.toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted small mt">
          <b>Our rule:</b> never sell below a <b>{floor.toFixed(0)}% margin</b>, which means keeping promos at or under <b>{pct(safeD)}</b> off on this cup. Rows tagged <span className="badge yellow">below floor</span> break that rule; <span className="badge red">loses money</span> is past break-even entirely.
          <b> “Units to hold profit”</b> = how much more volume a discount must drive just to make the <i>same</i> total profit — a 10% code that needs +25% orders only pays off if it actually lifts sales that much.
          Your current <b>ODD10 (10%)</b> leaves {money(scenarios[1] ? scenarios[1].contribution : 0, cur)}/order at {pct(scenarios[1] ? scenarios[1].margin : null)} margin.
        </div>
      </div>
    </>
  );
}

import React, { useMemo, useState } from "react";
import { enrichAll, filterByRange, totals, byPlatform, monthlySeries, monthsSpanned } from "../lib/calc";
import { buildFulfilmentIndex } from "../lib/fulfilment";
import { money, pct, monthLabel } from "../lib/format";
import { GroupedBars, Donut } from "./charts";
import { ticketsSold, effectiveStatus, compFinancials } from "../lib/comp";

const RANGES = [
  ["30d", "30 days"],
  ["90d", "90 days"],
  ["ytd", "This year"],
  ["all", "All time"],
];

export function RangePills({ range, setRange }) {
  return (
    <div className="pills">
      {RANGES.map(([key, label]) => (
        <button key={key} className={range === key ? "active" : ""} onClick={() => setRange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard({ db, user, go }) {
  const [range, setRange] = useState("90d");
  const currency = db.settings.currency;

  const { t, plat, months, fixedMonthly, netAfterFixed, openTasks, compLive, compRaised } = useMemo(() => {
    const fulfil = buildFulfilmentIndex(db.fulfilment, db.settings.fulfilmentVat);
    const enriched = filterByRange(enrichAll(db.orders, db.settings, db.productCosts, fulfil), range);
    const t = totals(enriched);
    const plat = byPlatform(enriched);
    const months = monthlySeries(enriched).slice(-12);
    const fixedMonthly = db.fixedCosts.reduce((s, c) => s + (c.monthly || 0), 0);
    const netAfterFixed = t.profit - fixedMonthly * monthsSpanned(enriched);
    const openTasks = db.tasks.filter((x) => x.status !== "done").length;
    let compLive = 0, compRaised = 0;
    for (const c of db.competitions || []) {
      const sold = ticketsSold((db.raffleEntries || []).filter((e) => e.competitionId === c.id));
      if (effectiveStatus(c, sold) === "open") compLive++;
      compRaised += compFinancials(c, sold).raised;
    }
    return { t, plat, months, fixedMonthly, netAfterFixed, openTasks, compLive, compRaised };
  }, [db, range]);

  const hasData = db.orders.length > 0;
  const firstName = (user.name || "").split(" ")[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Welcome back, {firstName} 👋</h1>
          <div className="sub">Here's how KantoForge is trading.</div>
        </div>
        <RangePills range={range} setRange={setRange} />
      </div>

      {(db.competitions || []).length > 0 && (
        <div className="notice mb" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>🎟️ <b>{compLive}</b> live competition{compLive === 1 ? "" : "s"} · <b>{money(compRaised, currency)}</b> raised all-time</span>
          <a href="#raffles" onClick={(e) => { e.preventDefault(); go("raffles"); }}>Manage competitions →</a>
        </div>
      )}

      {!hasData && (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <h2>No orders yet</h2>
          <p className="muted" style={{ maxWidth: 480, margin: "8px auto 18px" }}>
            Import your Shopify and Etsy order CSVs to light this dashboard up, and enter your product
            costs so profit numbers are real.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => go("orders")}>Import orders</button>
            <button className="btn" onClick={() => go("costs")}>Enter costs</button>
          </div>
        </div>
      )}

      {hasData && (
        <>
          <div className="grid kpis mb">
            <div className="kpi">
              <div className="label">Revenue</div>
              <div className="value">{money(t.revenue, currency)}</div>
              <div className="delta">{t.orders} orders · AOV {money(t.aov, currency)}</div>
            </div>
            <div className="kpi">
              <div className="label">Fees paid</div>
              <div className="value">{money(t.fees, currency)}</div>
              <div className="delta">{t.revenue > 0 ? pct((t.fees / t.revenue) * 100) : "—"} of revenue</div>
            </div>
            <div className="kpi">
              <div className="label">Gross profit</div>
              <div className={"value " + (t.profit >= 0 ? "good" : "bad")}>{money(t.profit, currency)}</div>
              <div className="delta">margin {pct(t.margin)}</div>
            </div>
            <div className="kpi">
              <div className="label">Net after fixed costs</div>
              <div className={"value " + (netAfterFixed >= 0 ? "good" : "bad")}>{money(netAfterFixed, currency)}</div>
              <div className="delta">{money(fixedMonthly, currency)}/mo overheads</div>
            </div>
          </div>

          <div className="card">
            <h2>Revenue vs profit by month</h2>
            <div className="card-sub">Gross profit after fees, product costs, postage &amp; packaging.</div>
            <GroupedBars
              currency={currency}
              data={months.map((m) => ({ label: monthLabel(m.month), values: [m.revenue, m.profit] }))}
              series={[
                { label: "Revenue", color: "var(--c-revenue)" },
                { label: "Profit", color: "var(--c-profit)" },
              ]}
            />
          </div>

          <div className="grid two mt">
            <div className="card" style={{ margin: 0 }}>
              <h2>Revenue by channel</h2>
              <div className="card-sub">Where the money comes from.</div>
              <Donut
                currency={currency}
                centerLabel={[money(t.revenue, currency), "revenue"]}
                segments={[
                  { label: "Website", value: plat.shopify.revenue, color: "var(--c-shopify)" },
                  { label: "Etsy", value: plat.etsy.revenue, color: "var(--c-etsy)" },
                ]}
              />
            </div>
            <div className="card" style={{ margin: 0 }}>
              <h2>Channel scorecard</h2>
              <div className="card-sub">Same period, side by side.</div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th></th>
                      <th className="num"><span className="badge shopify">Website</span></th>
                      <th className="num"><span className="badge etsy">Etsy</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Orders</td>
                      <td className="num">{plat.shopify.orders}</td>
                      <td className="num">{plat.etsy.orders}</td>
                    </tr>
                    <tr>
                      <td>Revenue</td>
                      <td className="num">{money(plat.shopify.revenue, currency)}</td>
                      <td className="num">{money(plat.etsy.revenue, currency)}</td>
                    </tr>
                    <tr>
                      <td>Fees</td>
                      <td className="num">{money(plat.shopify.fees, currency)}</td>
                      <td className="num">{money(plat.etsy.fees, currency)}</td>
                    </tr>
                    <tr>
                      <td>Profit</td>
                      <td className={"num " + (plat.shopify.profit >= 0 ? "pos" : "neg")}>{money(plat.shopify.profit, currency)}</td>
                      <td className={"num " + (plat.etsy.profit >= 0 ? "pos" : "neg")}>{money(plat.etsy.profit, currency)}</td>
                    </tr>
                    <tr>
                      <td>Margin</td>
                      <td className="num">{pct(plat.shopify.margin)}</td>
                      <td className="num">{pct(plat.etsy.margin)}</td>
                    </tr>
                    <tr>
                      <td>Avg order</td>
                      <td className="num">{money(plat.shopify.aov, currency)}</td>
                      <td className="num">{money(plat.etsy.aov, currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="row mt">
            <div className="notice" style={{ flex: 1 }}>
              📋 <b>{openTasks}</b> open task{openTasks === 1 ? "" : "s"} on the team board.{" "}
              <a href="#tasks" onClick={(e) => { e.preventDefault(); go("tasks"); }}>View board →</a>
            </div>
            <div className="notice" style={{ flex: 1 }}>
              🎯 Wondering what to charge? Try the <a href="#pricing" onClick={(e) => { e.preventDefault(); go("pricing"); }}>pricing calculator →</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

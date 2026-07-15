import React, { useMemo, useState } from "react";
import { enrichAll, filterByRange, totals, monthlySeries, productBreakdown, feeBreakdown, monthsSpanned } from "../lib/calc";
import { buildFulfilmentIndex } from "../lib/fulfilment";
import { money, pct, monthLabel } from "../lib/format";
import { GroupedBars, Donut, HBars } from "./charts";
import { RangePills } from "./Dashboard";

export default function AnalyticsPage({ db }) {
  const [range, setRange] = useState("all");
  const [productSort, setProductSort] = useState("revenue");
  const currency = db.settings.currency;

  const { t, months, products, fees, pnl, behaviour } = useMemo(() => {
    const fulfil = buildFulfilmentIndex(db.fulfilment, db.settings.fulfilmentVat);
    const enriched = filterByRange(enrichAll(db.orders, db.settings, db.productCosts, fulfil), range);
    const t = totals(enriched);
    const months = monthlySeries(enriched).slice(-12);
    const products = productBreakdown(enriched, db.settings, db.productCosts);
    const fees = feeBreakdown(enriched);
    const nMonths = monthsSpanned(enriched);
    const fixedMonthly = db.fixedCosts.reduce((s, c) => s + c.monthly, 0);
    const fixed = fixedMonthly * nMonths;
    const pnl = { nMonths, fixed, net: t.profit - fixed };

    // Customer & behaviour metrics — need nothing but the orders themselves
    const byBuyer = new Map();
    let discounted = 0;
    let refunded = 0;
    let refundedOrders = 0;
    for (const o of enriched) {
      const key = (o.email || o.buyer || "").trim().toLowerCase();
      if (key) byBuyer.set(key, (byBuyer.get(key) || 0) + 1);
      if ((o.rawDiscount || o.discount || 0) > 0) discounted++;
      if ((o.refunded || 0) > 0) {
        refunded += o.refunded;
        refundedOrders++;
      }
    }
    const buyers = byBuyer.size;
    const returning = Array.from(byBuyer.values()).filter((n) => n > 1).length;
    const behaviour = {
      buyers,
      returningPct: buyers ? (returning / buyers) * 100 : null,
      discountedPct: enriched.length ? (discounted / enriched.length) * 100 : null,
      refunded,
      refundedPct: enriched.length ? (refundedOrders / enriched.length) * 100 : null,
    };
    return { t, months, products, fees, pnl, behaviour };
  }, [db, range]);

  const sortedProducts = useMemo(() => {
    const arr = [...products];
    if (productSort === "profit") arr.sort((a, b) => b.profit - a.profit);
    else if (productSort === "qty") arr.sort((a, b) => b.qty - a.qty);
    else arr.sort((a, b) => b.revenue - a.revenue);
    return arr;
  }, [products, productSort]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Where the profit actually is — by month, platform, product and fee.</div>
        </div>
        <RangePills range={range} setRange={setRange} />
      </div>

      <div className="card">
        <h2>Profit &amp; loss</h2>
        <div className="card-sub">{pnl.nMonths} month{pnl.nMonths === 1 ? "" : "s"} of data in this range.</div>
        <div className="table-wrap">
          <table className="data">
            <tbody>
              <tr><td>Revenue (items + postage charged − discounts/refunds, ex. sales tax)</td><td className="num">{money(t.revenue, currency)}</td></tr>
              <tr><td>Platform &amp; payment fees</td><td className="num neg">−{money(t.fees, currency)}</td></tr>
              <tr><td>Product costs, packaging &amp; postage paid</td><td className="num neg">−{money(t.cogs, currency)}</td></tr>
              <tr><td><b>Gross profit</b> <span className="muted small">(margin {pct(t.margin)})</span></td><td className={"num " + (t.profit >= 0 ? "pos" : "neg")}><b>{money(t.profit, currency)}</b></td></tr>
              <tr><td>Fixed overheads ({pnl.nMonths} mo)</td><td className="num neg">−{money(pnl.fixed, currency)}</td></tr>
              <tr><td><b>Net profit</b></td><td className={"num " + (pnl.net >= 0 ? "pos" : "neg")}><b>{money(pnl.net, currency)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid kpis mt">
        <div className="kpi">
          <div className="label">Unique customers</div>
          <div className="value">{behaviour.buyers}</div>
          <div className="delta">{t.orders} orders in range</div>
        </div>
        <div className="kpi">
          <div className="label">Returning customers</div>
          <div className="value">{pct(behaviour.returningPct)}</div>
          <div className="delta">bought more than once</div>
        </div>
        <div className="kpi">
          <div className="label">Orders with a discount</div>
          <div className="value">{pct(behaviour.discountedPct)}</div>
          <div className="delta">coupon or sale price used</div>
        </div>
        <div className="kpi">
          <div className="label">Refunded</div>
          <div className="value">{money(behaviour.refunded, currency)}</div>
          <div className="delta">{pct(behaviour.refundedPct)} of orders had a refund</div>
        </div>
      </div>

      <div className="card mt">
        <h2>Monthly revenue by channel</h2>
        <div className="card-sub">Is one channel carrying the business?</div>
        <GroupedBars
          currency={currency}
          data={months.map((m) => ({ label: monthLabel(m.month), values: [m.shopifyRevenue, m.etsyRevenue] }))}
          series={[
            { label: "Website", color: "var(--c-shopify)" },
            { label: "Etsy", color: "var(--c-etsy)" },
          ]}
        />
      </div>

      <div className="card mt">
        <h2>Monthly profit by channel</h2>
        <div className="card-sub">Same months, after fees and costs. Bars below the line are loss-making months.</div>
        <GroupedBars
          currency={currency}
          data={months.map((m) => ({ label: monthLabel(m.month), values: [m.shopifyProfit, m.etsyProfit] }))}
          series={[
            { label: "Website", color: "var(--c-shopify)" },
            { label: "Etsy", color: "var(--c-etsy)" },
          ]}
        />
      </div>

      <div className="grid two mt">
        <div className="card" style={{ margin: 0 }}>
          <h2>Where the fees go</h2>
          <div className="card-sub">Every fee across the selected range.</div>
          <Donut
            currency={currency}
            centerLabel={[money(t.fees, currency), "total fees"]}
            segments={[
              { label: "Transaction fees", value: fees.transaction || 0, color: "var(--c-revenue)" },
              { label: "Payment processing", value: fees.payment || 0, color: "var(--c-profit)" },
              { label: "Listing fees", value: fees.listing || 0, color: "var(--c-slot3)" },
              { label: "Regulatory fee", value: fees.regulatory || 0, color: "var(--c-slot4)" },
              { label: "Offsite ads", value: fees.offsiteAds || 0, color: "var(--c-slot5)" },
            ]}
          />
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2>Top products by profit</h2>
          <div className="card-sub">Fees, postage and packaging apportioned per order.</div>
          <HBars
            currency={currency}
            color="var(--c-profit)"
            rows={products
              .slice()
              .sort((a, b) => b.profit - a.profit)
              .slice(0, 8)
              .map((p) => ({ label: p.name, value: p.profit, sub: p.qty + " sold" }))}
          />
        </div>
      </div>

      <div className="card mt">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Product table</h2>
          <div className="pills">
            {[["revenue", "By revenue"], ["profit", "By profit"], ["qty", "By units"]].map(([k, l]) => (
              <button key={k} className={productSort === k ? "active" : ""} onClick={() => setProductSort(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap mt">
          <table className="data">
            <thead>
              <tr><th>Product</th><th>SKU</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">Margin</th></tr>
            </thead>
            <tbody>
              {sortedProducts.slice(0, 40).map((p, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 380 }}>{p.name}</td>
                  <td className="muted">{p.sku || "—"}</td>
                  <td className="num">{p.qty}</td>
                  <td className="num">{money(p.revenue, currency)}</td>
                  <td className={"num " + (p.profit >= 0 ? "pos" : "neg")}>{money(p.profit, currency)}</td>
                  <td className="num">{p.revenue > 0 ? pct((p.profit / p.revenue) * 100) : "—"}</td>
                </tr>
              ))}
              {!sortedProducts.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 26 }}>
                  No line-item data yet. Import your Shopify orders export and the Etsy <b>order items</b> CSV.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

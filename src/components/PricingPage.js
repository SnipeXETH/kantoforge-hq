import React, { useMemo, useState } from "react";
import { etsyFees, shopifyFees } from "../lib/fees";
import { money, pct } from "../lib/format";

// What-if calculator: price an item on either platform and see the real
// take-home, plus the price needed to hit a target margin.
export default function PricingPage({ db }) {
  const currency = db.settings.currency;
  const [platform, setPlatform] = useState("etsy");
  const [price, setPrice] = useState("25");
  const [shipCharge, setShipCharge] = useState("3.50");
  const [unitCost, setUnitCost] = useState("6");
  const [postage, setPostage] = useState(String(db.settings.defaults.postagePerOrderEtsy));
  const [packaging, setPackaging] = useState(String(db.settings.defaults.packagingPerOrder));
  const [targetMargin, setTargetMargin] = useState("30");

  const n = (v) => {
    const x = parseFloat(v);
    return isNaN(x) ? 0 : x;
  };

  const compute = (itemPrice) => {
    const order = {
      platform,
      itemsTotal: itemPrice,
      shipping: n(shipCharge),
      discount: 0,
      tax: 0,
      total: itemPrice + n(shipCharge),
      feesActual: null,
      items: [{ name: "item", qty: 1, price: itemPrice }],
    };
    const fees = platform === "etsy" ? etsyFees(order, db.settings.etsy) : shopifyFees(order, db.settings.shopify);
    const costs = n(unitCost) + n(postage) + n(packaging);
    const revenue = itemPrice + n(shipCharge);
    const profit = revenue - fees.total - costs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { fees, costs, revenue, profit, margin };
  };

  const result = useMemo(() => compute(n(price)), [price, shipCharge, unitCost, postage, packaging, platform, db.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Solve for the price that hits the target margin (binary search — fees
  // aren't linear because of fixed components).
  const targetPrice = useMemo(() => {
    const target = n(targetMargin) / 100;
    if (target >= 0.95) return null;
    let lo = 0.01;
    let hi = 10000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const r = compute(mid);
      if (r.margin / 100 < target) lo = mid;
      else hi = mid;
    }
    return hi >= 9999 ? null : hi;
  }, [targetMargin, shipCharge, unitCost, postage, packaging, platform, db.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const fb = result.fees.breakdown;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pricing calculator</h1>
          <div className="sub">Know your take-home before you list. Uses the fee rates from Settings.</div>
        </div>
      </div>

      <div className="grid two">
        <div className="card" style={{ margin: 0 }}>
          <h2>Scenario</h2>
          <div className="card-sub">One unit, one order.</div>
          <label className="field">
            <span className="lab">Platform</span>
            <div className="pills">
              {[["etsy", "Etsy"], ["shopify", "Website"]].map(([k, l]) => (
                <button key={k} type="button" className={platform === k ? "active" : ""} onClick={() => {
                  setPlatform(k);
                  setPostage(String(k === "etsy" ? db.settings.defaults.postagePerOrderEtsy : db.settings.defaults.postagePerOrderShopify));
                }}>{l}</button>
              ))}
            </div>
          </label>
          <div className="form-row">
            <label className="field">
              <span className="lab">Item price ({currency})</span>
              <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">Postage charged to buyer</span>
              <input type="number" step="0.01" value={shipCharge} onChange={(e) => setShipCharge(e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span className="lab">Unit cost to make</span>
              <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">Postage you pay</span>
              <input type="number" step="0.01" value={postage} onChange={(e) => setPostage(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">Packaging</span>
              <input type="number" step="0.01" value={packaging} onChange={(e) => setPackaging(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h2>Result</h2>
          <div className="card-sub">At {money(n(price), currency)} on {platform === "etsy" ? "Etsy" : "your website"}.</div>
          <div className="grid kpis" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="kpi" style={{ background: "var(--panel-2)" }}>
              <div className="label">Profit per sale</div>
              <div className={"value " + (result.profit >= 0 ? "good" : "bad")}>{money(result.profit, currency)}</div>
            </div>
            <div className="kpi" style={{ background: "var(--panel-2)" }}>
              <div className="label">Margin</div>
              <div className={"value " + (result.margin >= 0 ? "good" : "bad")}>{pct(result.margin)}</div>
            </div>
          </div>
          <table className="data mt">
            <tbody>
              <tr><td>Revenue (item + postage charged)</td><td className="num">{money(result.revenue, currency)}</td></tr>
              {fb.transaction != null && <tr><td>Transaction fee</td><td className="num neg">−{money(fb.transaction, currency)}</td></tr>}
              <tr><td>Payment processing</td><td className="num neg">−{money(fb.payment, currency)}</td></tr>
              {fb.listing != null && <tr><td>Listing fee</td><td className="num neg">−{money(fb.listing, currency)}</td></tr>}
              {fb.regulatory != null && <tr><td>Regulatory operating fee</td><td className="num neg">−{money(fb.regulatory, currency)}</td></tr>}
              {fb.offsiteAds != null && fb.offsiteAds > 0 && <tr><td>Offsite ads (expected)</td><td className="num neg">−{money(fb.offsiteAds, currency)}</td></tr>}
              <tr><td>Making, postage &amp; packaging</td><td className="num neg">−{money(result.costs, currency)}</td></tr>
              <tr><td><b>Take-home</b></td><td className={"num " + (result.profit >= 0 ? "pos" : "neg")}><b>{money(result.profit, currency)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt">
        <h2>Price for a target margin</h2>
        <div className="row">
          <label className="field" style={{ maxWidth: 180, marginBottom: 0 }}>
            <span className="lab">Target margin %</span>
            <input type="number" step="1" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} />
          </label>
          <div style={{ paddingTop: 18 }}>
            {targetPrice ? (
              <span>
                → list at <b style={{ fontSize: 18, color: "#34c759" }}>{money(targetPrice, currency)}</b>{" "}
                <span className="muted">to make {pct(n(targetMargin))} on {platform === "etsy" ? "Etsy" : "your website"} with these costs</span>
              </span>
            ) : (
              <span className="muted">No realistic price hits that margin with these costs.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

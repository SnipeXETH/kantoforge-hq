import React, { useMemo, useState } from "react";
import { uid, money } from "../lib/format";
import { matchProductCost } from "../lib/fees";

export default function CostsPage({ db, update }) {
  const currency = db.settings.currency;
  const d = db.settings.defaults;

  // --- product cost rules ---
  const [form, setForm] = useState({ label: "", matchType: "name", pattern: "", unitCost: "" });
  const addRule = (e) => {
    e.preventDefault();
    const unitCost = parseFloat(form.unitCost);
    if (!form.pattern.trim() || isNaN(unitCost)) return;
    update((db2) => ({
      ...db2,
      productCosts: [
        ...db2.productCosts,
        { id: uid(), label: form.label.trim() || form.pattern.trim(), matchType: form.matchType, pattern: form.pattern.trim(), unitCost },
      ],
    }));
    setForm({ label: "", matchType: form.matchType, pattern: "", unitCost: "" });
  };
  const removeRule = (id) => update((db2) => ({ ...db2, productCosts: db2.productCosts.filter((r) => r.id !== id) }));

  // --- fixed costs ---
  const [fixed, setFixed] = useState({ label: "", monthly: "" });
  const addFixed = (e) => {
    e.preventDefault();
    const monthly = parseFloat(fixed.monthly);
    if (!fixed.label.trim() || isNaN(monthly)) return;
    update((db2) => ({ ...db2, fixedCosts: [...db2.fixedCosts, { id: uid(), label: fixed.label.trim(), monthly }] }));
    setFixed({ label: "", monthly: "" });
  };
  const removeFixed = (id) => update((db2) => ({ ...db2, fixedCosts: db2.fixedCosts.filter((r) => r.id !== id) }));

  const setDefault = (key, value) => {
    const v = parseFloat(value);
    update((db2) => ({ ...db2, settings: { ...db2.settings, defaults: { ...db2.settings.defaults, [key]: isNaN(v) ? 0 : v } } }));
  };

  // --- variable cost rules (formula: % of a base + fixed, scoped) ---
  const costRules = db.settings.costRules || [];
  const setCostRules = (next) => update((db2) => ({ ...db2, settings: { ...db2.settings, costRules: next } }));
  const addCostRule = () => setCostRules([...costRules, { id: uid(), label: "", pct: 0, base: "itemSubtotal", fixed: 0, platform: "all", region: "all", enabled: true }]);
  const updateCostRule = (id, patch) => setCostRules(costRules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeCostRule = (id) => setCostRules(costRules.filter((r) => r.id !== id));
  const numOf = (v) => (v === "" ? 0 : parseFloat(v) || 0);
  const seedCostRules = () => setCostRules([
    ...costRules,
    { id: uid(), label: "Total Cards fulfilment", pct: 12, base: "itemSubtotal", fixed: 0, platform: "all", region: "all", enabled: true },
    { id: uid(), label: "DDP", pct: 10, base: "itemSubtotal", fixed: 0.5, platform: "all", region: "intl", enabled: true },
  ]);

  // Which imported products still have no matching cost rule?
  const unmatchedProducts = useMemo(() => {
    const seen = new Map();
    for (const o of db.orders) {
      for (const item of o.items) {
        if (!matchProductCost(item, db.productCosts)) {
          const key = item.name;
          seen.set(key, { name: item.name, sku: item.sku, qty: (seen.get(key)?.qty || 0) + item.qty });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.qty - a.qty);
  }, [db.orders, db.productCosts]);

  const fixedTotal = db.fixedCosts.reduce((s, c) => s + c.monthly, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Costs</h1>
          <div className="sub">Tell HQ what things cost you, and every profit number in the app becomes real.</div>
        </div>
      </div>

      <div className="grid two">
        <div className="card" style={{ margin: 0 }}>
          <h2>Per-order defaults</h2>
          <div className="card-sub">Applied to every order on top of product costs.</div>
          <div className="form-row">
            <label className="field">
              <span className="lab">Packaging per order ({currency})</span>
              <input type="number" step="0.01" defaultValue={d.packagingPerOrder} onBlur={(e) => setDefault("packagingPerOrder", e.target.value)} />
              <span className="hint">Box, mailer, tape, thank-you card…</span>
            </label>
            <label className="field">
              <span className="lab">Fallback item cost ({currency})</span>
              <input type="number" step="0.01" defaultValue={d.fallbackItemCost} onBlur={(e) => setDefault("fallbackItemCost", e.target.value)} />
              <span className="hint">Used when no cost rule matches an item.</span>
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span className="lab">Postage paid per Etsy order</span>
              <input type="number" step="0.01" defaultValue={d.postagePerOrderEtsy} onBlur={(e) => setDefault("postagePerOrderEtsy", e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">Postage paid per Shopify order</span>
              <input type="number" step="0.01" defaultValue={d.postagePerOrderShopify} onBlur={(e) => setDefault("postagePerOrderShopify", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h2>Fixed monthly overheads — {money(fixedTotal, currency)}/mo</h2>
          <div className="card-sub">Subscriptions, rent, software, ads budget. Spread across months in the P&amp;L.</div>
          <form onSubmit={addFixed} className="form-row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 2 }}>
              <span className="lab">Name</span>
              <input type="text" placeholder="e.g. Shopify subscription" value={fixed.label} onChange={(e) => setFixed({ ...fixed, label: e.target.value })} />
            </label>
            <label className="field">
              <span className="lab">{currency}/month</span>
              <input type="number" step="0.01" value={fixed.monthly} onChange={(e) => setFixed({ ...fixed, monthly: e.target.value })} />
            </label>
            <button className="btn primary" style={{ marginBottom: 12 }}>Add</button>
          </form>
          <table className="data">
            <tbody>
              {db.fixedCosts.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="num">{money(c.monthly, currency)}/mo</td>
                  <td className="num"><button className="btn small danger" onClick={() => removeFixed(c.id)}>✕</button></td>
                </tr>
              ))}
              {!db.fixedCosts.length && <tr><td className="muted">Nothing yet — add your Shopify plan, tools, etc.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt">
        <h2>Product cost rules</h2>
        <div className="card-sub">
          Match imported order items by SKU (exact) or by product name (contains), and set what one unit costs you to make —
          acrylic, print, magnets, screws, your time if you like.
        </div>
        <form onSubmit={addRule} className="form-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="field" style={{ flex: 2, minWidth: 160 }}>
            <span className="lab">Label</span>
            <input type="text" placeholder="e.g. Magnetic case" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="field" style={{ minWidth: 110 }}>
            <span className="lab">Match by</span>
            <select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })}>
              <option value="name">Name contains</option>
              <option value="sku">SKU equals</option>
            </select>
          </label>
          <label className="field" style={{ flex: 2, minWidth: 160 }}>
            <span className="lab">Pattern</span>
            <input type="text" placeholder={form.matchType === "sku" ? "e.g. KF-MAG-01" : "e.g. magnetic"} value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
          </label>
          <label className="field" style={{ minWidth: 110 }}>
            <span className="lab">Unit cost ({currency})</span>
            <input type="number" step="0.01" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
          </label>
          <button className="btn primary" style={{ marginBottom: 12 }}>Add rule</button>
        </form>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Label</th><th>Match</th><th>Pattern</th><th className="num">Unit cost</th><th></th></tr>
            </thead>
            <tbody>
              {db.productCosts.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.label}</b></td>
                  <td><span className="badge gray">{r.matchType === "sku" ? "SKU =" : "name ⊃"}</span></td>
                  <td>{r.pattern}</td>
                  <td className="num">{money(r.unitCost, currency)}</td>
                  <td className="num"><button className="btn small danger" onClick={() => removeRule(r.id)}>✕</button></td>
                </tr>
              ))}
              {!db.productCosts.length && <tr><td colSpan={5} className="muted">No rules yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>Variable cost rules</h2>
            <div className="card-sub" style={{ margin: 0 }}>
              For costs that are a <b>percentage of each order</b> — fulfilment fees, DDP, etc. Each rule is
              <b> % of a base amount + a fixed amount</b>, and can be scoped to a platform or to UK / international orders.
              These pull through every order automatically. (Etsy &amp; Shopify payment fees are handled in Settings — don't re-add them here.)
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {!costRules.length && <button className="btn small" onClick={seedCostRules}>Load Total Cards + DDP</button>}
            <button className="btn small primary" onClick={addCostRule}>+ Add rule</button>
          </div>
        </div>

        {costRules.length > 0 && (
          <div className="table-wrap mt">
            <table className="data">
              <thead>
                <tr>
                  <th>Label</th>
                  <th className="num">%</th>
                  <th>of</th>
                  <th className="num">+ fixed ({currency})</th>
                  <th>Platform</th>
                  <th>Applies to</th>
                  <th className="num">On</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {costRules.map((r) => (
                  <tr key={r.id} style={{ opacity: r.enabled === false ? 0.5 : 1 }}>
                    <td><input type="text" defaultValue={r.label} onBlur={(e) => updateCostRule(r.id, { label: e.target.value })} placeholder="e.g. DDP" style={{ width: 150 }} /></td>
                    <td className="num"><input type="number" step="0.1" defaultValue={r.pct} onBlur={(e) => updateCostRule(r.id, { pct: numOf(e.target.value) })} style={{ width: 62 }} /></td>
                    <td>
                      <select value={r.base} onChange={(e) => updateCostRule(r.id, { base: e.target.value })}>
                        <option value="itemSubtotal">Item subtotal (after disc, ex shipping)</option>
                        <option value="orderTotal">Order total</option>
                        <option value="revenue">Revenue (incl shipping)</option>
                        <option value="shipping">Shipping</option>
                      </select>
                    </td>
                    <td className="num"><input type="number" step="0.01" defaultValue={r.fixed} onBlur={(e) => updateCostRule(r.id, { fixed: numOf(e.target.value) })} style={{ width: 68 }} /></td>
                    <td>
                      <select value={r.platform || "all"} onChange={(e) => updateCostRule(r.id, { platform: e.target.value })}>
                        <option value="all">All</option>
                        <option value="shopify">Shopify</option>
                        <option value="etsy">Etsy</option>
                      </select>
                    </td>
                    <td>
                      <select value={r.region || "all"} onChange={(e) => updateCostRule(r.id, { region: e.target.value })}>
                        <option value="all">All orders</option>
                        <option value="uk">UK only</option>
                        <option value="intl">International only</option>
                      </select>
                    </td>
                    <td className="num"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => updateCostRule(r.id, { enabled: e.target.checked })} /></td>
                    <td className="num"><button className="btn small danger" onClick={() => removeCostRule(r.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="muted small mt">
          Example — <b>Total Cards fulfilment</b>: 12% of item subtotal. <b>DDP</b>: 10% of item subtotal + £0.50, International only.
          “International” means any non-UK shipping country. Royal Mail postage stays as the flat per-order figure above until we wire in Cameron's invoice spreadsheet.
        </div>
      </div>

      {unmatchedProducts.length > 0 && (
        <div className="card mt">
          <h2>⚠️ Products without a cost rule ({unmatchedProducts.length})</h2>
          <div className="card-sub">
            These imported items fall back to the default item cost ({money(d.fallbackItemCost, currency)}), which skews profit.
            Add rules above — click a row to pre-fill the form.
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Product</th><th>SKU</th><th className="num">Units sold</th></tr></thead>
              <tbody>
                {unmatchedProducts.slice(0, 15).map((p, i) => (
                  <tr key={i} style={{ cursor: "pointer" }} onClick={() => setForm({ label: p.name.slice(0, 40), matchType: p.sku ? "sku" : "name", pattern: p.sku || p.name.slice(0, 30), unitCost: "" })}>
                    <td>{p.name}</td>
                    <td className="muted">{p.sku || "—"}</td>
                    <td className="num">{p.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unmatchedProducts.length > 15 && <div className="muted small mt">…and {unmatchedProducts.length - 15} more.</div>}
        </div>
      )}
    </div>
  );
}

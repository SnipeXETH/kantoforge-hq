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

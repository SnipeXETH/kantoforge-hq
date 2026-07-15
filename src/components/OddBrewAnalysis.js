import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import { activeOrders, findCostRule, ruleCost } from "../lib/oddbrew";
import { salesByVariant, mergeInventory, analysisTotals } from "../lib/oddbrewAnalysis";

const RANGES = [["all", "All time"], ["12m", "12 months"], ["90d", "90 days"]];

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

const coverLabel = (d) => {
  if (d === Infinity) return "∞";
  if (!d || d <= 0) return "0d";
  return Math.round(d) + "d";
};

// "Signature — Blue/White / 350ml" → "Signature". Splits on the first en/em
// dash or spaced hyphen, so we group variants back to their product line.
const productLine = (name) => String(name || "").split(/\s+[—–-]\s+/)[0].trim() || "(unnamed)";
// The colour/size detail — everything after the product line.
const variantDetail = (name) => {
  const parts = String(name || "").split(/\s+[—–-]\s+/);
  return parts.length > 1 ? parts.slice(1).join(" — ").trim() : "";
};
const csvEscape = (v) => {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// The variants still on sale (from the store's product pages):
//   Signature cup — 5 colours × {250ml, 350ml}
//   Studio cup    — 5 colours × 200ml
const SIG_COLOURS = ["Blue/White", "Black/White", "Black", "Cream/Pink", "Green/Black"];
const STU_COLOURS = ["Yellow/Blue", "White Mix", "Yellow/Brown", "Brown/Cream", "Cream/Orange"];
// Lower-case and collapse runs of whitespace to a single space — keeping the
// spaces means the " / " option separator stays distinct from the slash inside
// a compound colour like "blue/white".
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Does the variant name carry this colour option? A compound colour ("blue/white")
// is distinctive enough to match as a substring; a plain colour ("black") must
// stand alone so it doesn't get swallowed by "black/white".
function hasColour(name, colour) {
  const c = norm(colour);
  if (c.includes("/")) return name.includes(c);
  return new RegExp(`(^|[^a-z0-9])${c}([^a-z0-9/]|$)`).test(name);
}
const hasSize = (name, ml) => new RegExp(`(^|[^0-9])${ml}\\s*ml`).test(name);
function isSellingName(raw) {
  const name = norm(raw);
  const sig = SIG_COLOURS.some((c) => hasColour(name, c)) && (hasSize(name, 250) || hasSize(name, 350));
  const stu = STU_COLOURS.some((c) => hasColour(name, c)) && hasSize(name, 200);
  return sig || stu;
}

// Keys to hide so only the current Signature + Studio variants remain. It finds
// the two live products by their colour fingerprint (a line where at least half
// the variants, and 2+, match the spec) — so a discontinued line that happens
// to share one colour/size doesn't sneak through.
function autoHideKeys(allRows) {
  const byLine = new Map();
  for (const r of allRows) {
    const p = productLine(r.name);
    if (!byLine.has(p)) byLine.set(p, []);
    byLine.get(p).push(r);
  }
  const current = new Set();
  for (const [line, rs] of byLine) {
    const matches = rs.filter((r) => isSellingName(r.name)).length;
    if (matches >= 2 && matches / rs.length >= 0.5) current.add(line);
  }
  // Fallback: if no line fingerprints as current, keep any spec-matching row.
  const keep = (r) => current.size
    ? current.has(productLine(r.name)) && isSellingName(r.name)
    : isSellingName(r.name);
  return allRows.filter((r) => !keep(r)).map((r) => r.key);
}

const chipStyle = (on) => ({
  padding: "4px 11px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
  border: "1px solid " + (on ? "var(--accent, #6ea8fe)" : "var(--border)"),
  background: on ? "rgba(110, 168, 254, 0.15)" : "transparent",
  color: on ? "var(--text)" : "var(--text-2)",
});
const textBtn = { background: "none", border: "none", padding: 0, color: "var(--accent, #6ea8fe)", cursor: "pointer", font: "inherit", textDecoration: "underline" };

export default function OddBrewAnalysis({ orders, cfg, connected, saveCfg }) {
  const cur = cfg.currency || "GBP";
  const [range, setRange] = useState("all");
  const [inv, setInv] = useState([]);
  const [err, setErr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [orderQty, setOrderQty] = useState({});

  const stock = cfg.stock || {};
  const leadDays = Number(stock.leadDays) || 0;
  const targetCover = Number(stock.targetCover) || 0;

  const fetchInv = async () => {
    const { data, error } = await supabase.from("oddbrew_inventory").select("id,data");
    if (!error) setInv((data || []).map((r) => ({ key: r.id, ...r.data })));
  };
  useEffect(() => { fetchInv(); }, []);

  const inRange = (o) => {
    if (range === "all") return true;
    if (!o.date) return false;
    const days = range === "90d" ? 90 : 365;
    return Date.now() - new Date(o.date).getTime() <= days * 86400000;
  };

  const active = activeOrders(orders || [], cfg).filter(inRange);
  const sales = salesByVariant(active, cfg);
  const allRows = mergeInventory(sales, inv, { leadDays, targetCover });

  // Per-variant hide list, keyed by the variant's stable key. Everything shows
  // by default; you hide the ones you no longer sell.
  const hidden = new Set(cfg.hiddenVariants || []);
  const rows = allRows.filter((r) => !hidden.has(r.key));
  const hiddenRows = allRows.filter((r) => hidden.has(r.key));
  const totals = analysisTotals(rows);

  // Product lines (Signature, Studio, Galactic, …) as a quick bulk toggle: the
  // product line is the part of the variant name before the first separator.
  const lineMap = new Map();
  for (const r of allRows) {
    const p = productLine(r.name);
    const cur = lineMap.get(p) || { name: p, units: 0, keys: [] };
    cur.units += r.units;
    cur.keys.push(r.key);
    lineMap.set(p, cur);
  }
  const lines = Array.from(lineMap.values())
    .map((l) => ({ ...l, on: l.keys.some((k) => !hidden.has(k)) }))
    .sort((a, b) => b.units - a.units);

  const setStock = (patch) => saveCfg({ ...cfg, stock: { ...stock, ...patch } });
  const setHidden = (keys) => saveCfg({ ...cfg, hiddenVariants: keys });
  const hideKeys = (keys, hide) => {
    const set = new Set(cfg.hiddenVariants || []);
    keys.forEach((k) => (hide ? set.add(k) : set.delete(k)));
    setHidden([...set]);
  };
  const toggleRow = (key) => hideKeys([key], !hidden.has(key));
  const toggleLine = (l) => hideKeys(l.keys, l.on); // any shown → hide all; else show all
  const showAll = () => setHidden([]);
  const keepCurrentOnly = () => {
    const keys = autoHideKeys(allRows);
    setHidden(keys);
    const kept = allRows.length - keys.length;
    setSyncResult(`Kept ${kept} current variant${kept === 1 ? "" : "s"}, hid ${keys.length}. Check the “Hidden” list below if anything looks off.`);
  };

  // Supplier stock order. Per-unit cost is the size rule's UK landed rate (the
  // single figure we hold) — a rough budgeting estimate, not the order total.
  const unitCost = (r) => {
    const rule = findCostRule(r.name, cfg.costRules || []);
    return rule ? ruleCost(rule, "UK") * (cfg.costFx || 1) : 0;
  };
  const setQty = (key, v) => setOrderQty((prev) => ({ ...prev, [key]: v === "" ? "" : Math.max(0, parseInt(v, 10) || 0) }));
  const fillFromSuggestions = () => {
    const next = {};
    for (const r of rows) if (r.suggested > 0) next[r.key] = r.suggested;
    setOrderQty(next);
  };
  const clearOrder = () => setOrderQty({});
  const orderItems = rows
    .map((r) => ({ r, qty: Number(orderQty[r.key]) || 0 }))
    .filter((x) => x.qty > 0);
  const orderUnits = orderItems.reduce((s, x) => s + x.qty, 0);
  const orderCost = orderItems.reduce((s, x) => s + x.qty * unitCost(x.r), 0);
  const downloadOrder = () => {
    if (!orderItems.length) return;
    const header = ["Product", "Variant", "SKU", "Order qty", "Est. unit cost (" + cur + ")", "Est. line cost (" + cur + ")"];
    const lineFor = ({ r, qty }) => {
      const unit = unitCost(r);
      return [productLine(r.name), variantDetail(r.name), r.sku || "", qty, unit ? unit.toFixed(2) : "", unit ? (unit * qty).toFixed(2) : ""];
    };
    const body = orderItems.map((x) => lineFor(x).map(csvEscape).join(","));
    const totalRow = ["", "", "TOTAL", orderUnits, "", orderCost ? orderCost.toFixed(2) : ""].map(csvEscape).join(",");
    const csv = [header.map(csvEscape).join(","), ...body, totalRow].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "oddbrew-stock-order-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Persist one variant's manual counts. Merge onto any Shopify-synced fields so
  // a later stock sync (which keeps manual fields) and this stay consistent.
  const saveRow = async (row, patch) => {
    setErr(null);
    const base = inv.find((r) => r.key === row.key) || {};
    const next = {
      ...base,
      key: row.key,
      name: base.name || row.name,
      sku: base.sku || row.sku || "",
      onHand: row.onHand, incoming: row.incoming, reorderPoint: row.reorderPoint,
      ...patch,
    };
    setInv((prev) => {
      const others = prev.filter((r) => r.key !== row.key);
      return [...others, next];
    });
    const { key, ...data } = next;
    const { error } = await supabase.from("oddbrew_inventory").upsert({ id: key, data, updated_at: new Date().toISOString() });
    if (error) setErr(error.message);
  };

  const num = (v) => (v === "" ? 0 : parseFloat(v) || 0);
  const numOrNull = (v) => (v === "" ? null : parseFloat(v) || 0);

  const syncStock = async () => {
    setErr(null); setSyncResult(null); setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session && data.session.access_token;
      const resp = await fetch("/api/oddbrew-inventory", { method: "POST", headers: { Authorization: "Bearer " + token } });
      let body = null;
      try { body = await resp.json(); } catch (e) { body = null; }
      if (!body) throw new Error("Stock endpoint not reachable (" + resp.status + ").");
      if (!body.ok) throw new Error(body.error || "Stock sync failed.");
      setSyncResult(`Pulled stock for ${body.variants} variant${body.variants === 1 ? "" : "s"} from Shopify.`);
      await fetchInv();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="pills mb">
        {RANGES.map(([k, l]) => (
          <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{l}</button>
        ))}
      </div>

      {err && <div className="notice bad mb">⚠️ {err}</div>}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 12 }}>
        <Stat label="Variants sold" value={totals.variants} sub="distinct cups/sizes" accent="var(--c-revenue)" />
        <Stat label="Units sold" value={totals.units} sub="in this period" accent="var(--c-profit)" />
        <Stat label="In stock" value={totals.onHand} sub={totals.incoming ? `+ ${totals.incoming} incoming` : "on hand"} accent="#4a90e8" />
        <Stat label="Need reorder" value={totals.needReorder} sub="below target cover" accent={totals.needReorder ? "var(--bad)" : "var(--good)"} tone={totals.needReorder ? "var(--bad)" : "var(--good)"} />
      </div>

      <div className="card mt">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>Sales &amp; stock by variant</h3>
            <div className="muted small">How many of each cup has sold, next to what you hold — so you can buy in the fast movers and cut shipping times.</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {connected
              ? <button className="btn small primary" onClick={syncStock} disabled={syncing}>{syncing ? "Syncing…" : "⟳ Sync stock from Shopify"}</button>
              : <span className="muted small">Connect Shopify on the Overview tab to link live stock.</span>}
          </div>
        </div>
        {syncResult && <div className="notice good mt small">{syncResult}</div>}

        {allRows.length > 0 && (
          <div className="row mt" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn small primary" onClick={keepCurrentOnly}>✨ Keep only current lines</button>
            <span className="muted small">Auto-hides everything except the Signature (10) and Studio (5) variants you still sell.</span>
          </div>
        )}

        {lines.length > 1 && (
          <div className="mt">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
              <span className="lab">Quick filter by product line</span>
              <button type="button" style={textBtn} onClick={showAll}>Show all</button>
            </div>
            <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
              {lines.map((l) => (
                <button key={l.name} type="button" onClick={() => toggleLine(l)} style={chipStyle(l.on)}>
                  {l.on ? "✓ " : ""}{l.name} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {l.units}</span>
                </button>
              ))}
            </div>
            <div className="hint mt">Click a line to hide/show all its variants at once — or use the Hide button on any row below for individual control.</div>
          </div>
        )}

        <div className="form-row">
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="lab">Supplier lead time (days)</span>
            <input type="number" step="1" value={stock.leadDays == null ? "" : stock.leadDays} onChange={(e) => setStock({ leadDays: num(e.target.value) })} placeholder="e.g. 25" />
            <span className="hint">How long a restock takes to arrive.</span>
          </label>
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="lab">Target cover (days)</span>
            <input type="number" step="1" value={stock.targetCover == null ? "" : stock.targetCover} onChange={(e) => setStock({ targetCover: num(e.target.value) })} placeholder="e.g. 30" />
            <span className="hint">How many days of stock to hold on top of lead time.</span>
          </label>
        </div>

        {rows.length ? (
          <div className="table-wrap mt">
            <table className="data">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className="num">Sold</th>
                  <th className="num">Revenue</th>
                  <th className="num">UK / US / EU</th>
                  <th className="num">Units / mo</th>
                  <th className="num">On hand</th>
                  <th className="num">Incoming</th>
                  <th className="num">Reorder&nbsp;pt</th>
                  <th className="num">Cover</th>
                  <th className="num">Suggest buy</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.low ? "warn-row" : ""}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div className="muted small">
                        {r.sku ? <code>{r.sku}</code> : <span className="muted">no SKU</span>}
                        {r.shopifyAvailable != null && <span> · Shopify: {r.shopifyAvailable}</span>}
                      </div>
                    </td>
                    <td className="num">{r.units}</td>
                    <td className="num">{money(r.revenue, cur)}</td>
                    <td className="num muted small">{r.region.UK} / {r.region.US} / {r.region.EU}</td>
                    <td className="num">{r.perMonth || "—"}</td>
                    <td className="num"><input type="number" step="1" value={r.onHand || 0} onChange={(e) => saveRow(r, { onHand: num(e.target.value) })} style={{ width: 62 }} /></td>
                    <td className="num"><input type="number" step="1" value={r.incoming || 0} onChange={(e) => saveRow(r, { incoming: num(e.target.value) })} style={{ width: 62 }} /></td>
                    <td className="num"><input type="number" step="1" value={r.reorderPoint == null ? "" : r.reorderPoint} onChange={(e) => saveRow(r, { reorderPoint: numOrNull(e.target.value) })} style={{ width: 62 }} placeholder="—" /></td>
                    <td className="num">{coverLabel(r.daysCover)}</td>
                    <td className="num">{r.suggested > 0 ? <span className="badge amber">+{r.suggested}</span> : <span className="muted">—</span>}</td>
                    <td className="num"><button className="btn small" title="Hide — I don't sell this variant" onClick={() => toggleRow(r.key)}>Hide</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : allRows.length ? (
          <div className="muted mt">Every variant is hidden. <button type="button" style={textBtn} onClick={showAll}>Show all</button> to bring them back.</div>
        ) : (
          <div className="muted mt">No sales yet — sync the store or import a CSV on the Overview tab.</div>
        )}

        {hiddenRows.length > 0 && (
          <details className="mt">
            <summary className="muted small" style={{ cursor: "pointer" }}>
              Hidden — not selling ({hiddenRows.length}){" "}
              <button type="button" style={textBtn} onClick={(e) => { e.preventDefault(); showAll(); }}>restore all</button>
            </summary>
            <div className="table-wrap mt">
              <table className="data">
                <tbody>
                  {hiddenRows.map((r) => (
                    <tr key={r.key} style={{ opacity: 0.65 }}>
                      <td>{r.name}{r.sku ? <> · <code>{r.sku}</code></> : null}</td>
                      <td className="num muted small">{r.units} sold</td>
                      <td className="num"><button className="btn small" onClick={() => toggleRow(r.key)}>Restore</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        <div className="muted small mt">
          <b>Suggest buy</b> = daily sales rate × (lead time + target cover) − on hand − incoming. Set the two numbers above to get useful suggestions.
          {connected ? " “Sync stock from Shopify” fills the Shopify column; enter your own on-hand counts if you hold stock the store doesn't track." : ""}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card mt">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 style={{ marginBottom: 2 }}>Supplier order</h3>
              <div className="muted small">Set how many of each variant to order, then export a CSV to send your supplier. Pre-fill from the reorder suggestions or type your own.</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" onClick={fillFromSuggestions}>Fill from suggestions</button>
              <button className="btn small" onClick={clearOrder} disabled={!orderItems.length}>Clear</button>
            </div>
          </div>

          <div className="table-wrap mt">
            <table className="data">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className="num">On hand</th>
                  <th className="num">Units / mo</th>
                  <th className="num">Suggested</th>
                  <th className="num">Order qty</th>
                  <th className="num">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const qty = Number(orderQty[r.key]) || 0;
                  const unit = unitCost(r);
                  return (
                    <tr key={r.key}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.name}</div>
                        {r.sku ? <div className="muted small"><code>{r.sku}</code></div> : null}
                      </td>
                      <td className="num">{r.onHand || 0}</td>
                      <td className="num">{r.perMonth || "—"}</td>
                      <td className="num">{r.suggested > 0 ? "+" + r.suggested : "—"}</td>
                      <td className="num"><input type="number" step="1" min="0" value={orderQty[r.key] == null ? "" : orderQty[r.key]} onChange={(e) => setQty(r.key, e.target.value)} placeholder="0" style={{ width: 68 }} /></td>
                      <td className="num muted small">{qty > 0 && unit ? money(unit * qty, cur) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row mt" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div className="muted small">
              {orderUnits > 0
                ? <>Ordering <b>{orderUnits}</b> unit{orderUnits === 1 ? "" : "s"} across <b>{orderItems.length}</b> variant{orderItems.length === 1 ? "" : "s"}{orderCost ? <> · est. <b>{money(orderCost, cur)}</b></> : null}.</>
                : "Set an order quantity on at least one variant to export."}
            </div>
            <button className="btn primary" onClick={downloadOrder} disabled={!orderItems.length}>⬇ Download order CSV</button>
          </div>
          <div className="hint mt">Est. cost uses your size rules' UK landed rate as a rough guide — the supplier's own pricing is the source of truth.</div>
        </div>
      )}
    </>
  );
}

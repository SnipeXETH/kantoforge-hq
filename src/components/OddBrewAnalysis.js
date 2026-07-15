import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import { activeOrders } from "../lib/oddbrew";
import { salesByVariant, mergeInventory, analysisTotals, isAnalysed } from "../lib/oddbrewAnalysis";

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

  // Distinct product lines actually present in the data (Signature, Studio,
  // Galactic, …). The variant name is "Product — Colour / Size", so the product
  // line is the part before the first separator.
  const lineMap = new Map();
  for (const r of allRows) {
    const p = productLine(r.name);
    const cur = lineMap.get(p) || { name: p, units: 0, variants: 0 };
    cur.units += r.units;
    cur.variants += 1;
    lineMap.set(p, cur);
  }
  const lines = Array.from(lineMap.values()).sort((a, b) => b.units - a.units);

  // Which lines to analyse. Unconfigured → auto-pick the ones that look current
  // (Signature/Studio); if none match, show everything so the table is never
  // mysteriously empty. The chip picker below lets you set it explicitly.
  const autoDefault = lines.filter((l) => /signature|studio/i.test(l.name)).map((l) => l.name);
  const include = cfg.analysisInclude !== undefined
    ? cfg.analysisInclude
    : (autoDefault.length ? autoDefault : lines.map((l) => l.name));

  const rows = allRows.filter((r) => isAnalysed(r.name, include));
  const hiddenCount = allRows.length - rows.length;
  const totals = analysisTotals(rows);

  const setStock = (patch) => saveCfg({ ...cfg, stock: { ...stock, ...patch } });
  const setInclude = (list) => saveCfg({ ...cfg, analysisInclude: list });
  const lineOn = (name) => isAnalysed(name, include);
  const toggleLine = (name) => {
    const set = new Set(lines.filter((l) => lineOn(l.name)).map((l) => l.name));
    if (set.has(name)) set.delete(name); else set.add(name);
    setInclude([...set]);
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

        {lines.length > 0 && (
          <div className="mt">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
              <span className="lab">Product lines to analyse</span>
              <span className="muted small">
                <button type="button" style={textBtn} onClick={() => setInclude(lines.map((l) => l.name))}>All</button>
                {autoDefault.length ? <> · <button type="button" style={textBtn} onClick={() => setInclude(autoDefault)}>Signature + Studio</button></> : null}
              </span>
            </div>
            <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
              {lines.map((l) => {
                const on = lineOn(l.name);
                return (
                  <button key={l.name} type="button" onClick={() => toggleLine(l.name)} style={chipStyle(on)}>
                    {on ? "✓ " : ""}{l.name} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {l.units}</span>
                  </button>
                );
              })}
            </div>
            <div className="hint mt">Tick the lines you still sell — discontinued ones drop out of the table and the totals above.{hiddenCount ? ` ${hiddenCount} variant${hiddenCount === 1 ? "" : "s"} hidden.` : ""}</div>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted mt">No sales yet — sync the store or import a CSV on the Overview tab.</div>
        )}

        <div className="muted small mt">
          <b>Suggest buy</b> = daily sales rate × (lead time + target cover) − on hand − incoming. Set the two numbers above to get useful suggestions.
          {connected ? " “Sync stock from Shopify” fills the Shopify column; enter your own on-hand counts if you hold stock the store doesn't track." : ""}
        </div>
      </div>
    </>
  );
}

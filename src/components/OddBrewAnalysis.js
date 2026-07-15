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

  // Default to the two lines still on sale; an explicit empty array means the
  // user has deliberately chosen to show everything.
  const include = cfg.analysisInclude !== undefined ? cfg.analysisInclude : ["Signature", "Studio"];
  const active = activeOrders(orders || [], cfg).filter(inRange);
  const sales = salesByVariant(active, cfg);
  const allRows = mergeInventory(sales, inv, { leadDays, targetCover });
  const rows = allRows.filter((r) => isAnalysed(r.name, include));
  const hiddenCount = allRows.length - rows.length;
  const totals = analysisTotals(rows);

  const setStock = (patch) => saveCfg({ ...cfg, stock: { ...stock, ...patch } });
  const setInclude = (list) => saveCfg({ ...cfg, analysisInclude: list });

  // Edited locally, committed on blur so we don't write to the DB per keystroke.
  const [includeText, setIncludeText] = useState(include.join(", "));
  useEffect(() => { setIncludeText(include.join(", ")); }, [cfg.analysisInclude]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitInclude = () => setInclude(includeText.split(",").map((s) => s.trim()).filter(Boolean));

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

        <div className="form-row mt">
          <label className="field" style={{ flex: 1, minWidth: 240 }}>
            <span className="lab">Only analyse these products</span>
            <input type="text" value={includeText} onChange={(e) => setIncludeText(e.target.value)} onBlur={commitInclude} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitInclude(); } }} placeholder="e.g. Signature, Studio" />
            <span className="hint">
              Comma-separated keywords matched against the variant name — discontinued lines drop out. Leave blank to show everything.
              {" "}<button type="button" onClick={() => setInclude(["Signature", "Studio"])} style={{ background: "none", border: "none", padding: 0, color: "var(--accent, #6ea8fe)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>Signature + Studio only</button>.
              {include.length ? ` Showing ${rows.length}${hiddenCount ? `, ${hiddenCount} hidden` : ""}.` : ""}
            </span>
          </label>
        </div>

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

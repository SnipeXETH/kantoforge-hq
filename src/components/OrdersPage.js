import React, { useMemo, useRef, useState } from "react";
import { importCsvText, mergeOrders, FORMAT_LABELS } from "../lib/csv";
import { enrichAll } from "../lib/calc";
import { money, shortDate, monthKey } from "../lib/format";

const PAGE_SIZE = 50;

// --- CSV coverage grid -------------------------------------------------------
const COVERAGE_START_YEAR = 2021;
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PLATFORMS = [
  ["shopify", "Shopify"],
  ["etsy", "Etsy"],
];

function CoverageCard({ db, update }) {
  const marks = db.settings.coverageMarks || {};

  const counts = useMemo(() => {
    const m = new Map();
    for (const o of db.orders) {
      const k = o.date ? monthKey(o.date) : null;
      if (!k) continue;
      const key = k + ":" + o.platform;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [db.orders]);

  const now = new Date();
  const curIdx = now.getFullYear() * 12 + now.getMonth();
  const years = [];
  for (let y = now.getFullYear(); y >= COVERAGE_START_YEAR; y--) years.push(y);

  const missing = { shopify: 0, etsy: 0 };
  for (let idx = COVERAGE_START_YEAR * 12; idx <= curIdx; idx++) {
    const mk = Math.floor(idx / 12) + "-" + String((idx % 12) + 1).padStart(2, "0");
    for (const [p] of PLATFORMS) {
      if (!counts.get(mk + ":" + p) && !marks[mk + ":" + p]) missing[p]++;
    }
  }

  const toggleMark = (mk, platform) => {
    const key = mk + ":" + platform;
    update((d) => {
      const cm = { ...(d.settings.coverageMarks || {}) };
      if (cm[key]) delete cm[key];
      else cm[key] = true;
      return { ...d, settings: { ...d.settings, coverageMarks: cm } };
    });
  };

  return (
    <div className="card mt">
      <h2>CSV coverage by month</h2>
      <div className="card-sub">
        Which months have order data, all the way back to {COVERAGE_START_YEAR}. Red dashed months have nothing imported yet —
        if a month genuinely had no sales, click it to mark it “no sales” (click again to unmark).
      </div>
      <div className="row mb">
        <span className="badge shopify">Shopify — {missing.shopify === 0 ? "complete ✓" : missing.shopify + " month" + (missing.shopify === 1 ? "" : "s") + " missing"}</span>
        <span className="badge etsy">Etsy — {missing.etsy === 0 ? "complete ✓" : missing.etsy + " month" + (missing.etsy === 1 ? "" : "s") + " missing"}</span>
      </div>
      <div className="table-wrap">
        <div className="cov-grid">
          {years.map((y) => (
            <div className="cov-year" key={y}>
              <div className="cov-label">
                <div>{y}</div>
                {PLATFORMS.map(([p, label]) => (
                  <span key={p} className="dot" style={{ background: p === "shopify" ? "var(--c-shopify)" : "var(--c-etsy)" }} title={label} />
                ))}
              </div>
              <div className="cov-months">
                {MONTH_LETTERS.map((letter, m) => {
                  const mk = y + "-" + String(m + 1).padStart(2, "0");
                  const future = y * 12 + m > curIdx;
                  return (
                    <div className="cov-col" key={m}>
                      <div className="cov-head">{letter}</div>
                      {PLATFORMS.map(([p, label]) => {
                        const count = counts.get(mk + ":" + p) || 0;
                        const marked = !!marks[mk + ":" + p];
                        const cls = future ? "future" : count ? "covered " + p : marked ? "marked" : "missing";
                        const title = future
                          ? MONTH_NAMES[m] + " " + y + " — in the future"
                          : count
                          ? `${MONTH_NAMES[m]} ${y} — ${label}: ${count} order${count === 1 ? "" : "s"} imported`
                          : marked
                          ? `${MONTH_NAMES[m]} ${y} — ${label}: marked as no sales (click to unmark)`
                          : `${MONTH_NAMES[m]} ${y} — ${label}: no CSV data yet (click to mark as no sales)`;
                        return (
                          <button
                            key={p}
                            type="button"
                            className={"cov-cell " + cls}
                            title={title}
                            disabled={future || count > 0}
                            onClick={() => toggleMark(mk, p)}
                          >
                            {future ? "" : count ? "✓" : marked ? "–" : "!"}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="legend">
        <span className="li"><span className="cov-cell covered shopify" style={{ width: 18 }}>✓</span> imported</span>
        <span className="li"><span className="cov-cell missing" style={{ width: 18 }}>!</span> missing</span>
        <span className="li"><span className="cov-cell marked" style={{ width: 18 }}>–</span> marked no sales</span>
      </div>
    </div>
  );
}

export default function OrdersPage({ db, update }) {
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [platform, setPlatform] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const currency = db.settings.currency;

  const enriched = useMemo(() => enrichAll(db.orders, db.settings, db.productCosts), [db]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((o) => {
      if (platform !== "all" && o.platform !== platform) return false;
      if (!q) return true;
      return (
        o.orderId.toLowerCase().includes(q) ||
        (o.buyer || "").toLowerCase().includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q))
      );
    });
  }, [enriched, platform, query]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const handleFiles = async (files) => {
    setError(null);
    setResult(null);
    const summaries = [];
    let orders = db.orders;
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        const { format, orders: incoming } = importCsvText(text);
        const merged = mergeOrders(orders, incoming);
        orders = merged.orders;
        summaries.push(`${file.name}: ${FORMAT_LABELS[format]} — ${merged.added} new, ${merged.updated} updated`);
      }
      update((d) => ({ ...d, orders }));
      setResult(summaries);
      setPage(0);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const removeOrder = (id) => {
    update((d) => ({ ...d, orders: d.orders.filter((o) => o.id !== id) }));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Orders &amp; imports</h1>
          <div className="sub">Upload CSV exports from Shopify and Etsy — duplicates are merged automatically, so re-importing is safe.</div>
        </div>
      </div>

      <div
        className={"dropzone" + (drag ? " over" : "")}
        onClick={() => fileRef.current && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      >
        <div className="big">Drop CSV files here, or click to browse</div>
        <div className="small">
          Shopify: Admin → Orders → Export. &nbsp; Etsy: Shop Manager → Settings → Options → Download Data
          (both the <b>Orders</b> and <b>Order Items</b> files — import both for full detail).
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      <CoverageCard db={db} update={update} />

      {result && (
        <div className="notice good mt">
          ✅ Imported successfully:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {result.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {error && <div className="notice bad mt">⚠️ {error}</div>}

      <div className="card mt">
        <div className="row mb" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{filtered.length} orders</h2>
          <div className="toolbar">
            <div className="pills">
              {[["all", "All"], ["shopify", "Shopify"], ["etsy", "Etsy"]].map(([k, l]) => (
                <button key={k} className={platform === k ? "active" : ""} onClick={() => { setPlatform(k); setPage(0); }}>{l}</button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search order, buyer, product, SKU…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              style={{ width: 240 }}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Platform</th>
                <th>Items</th>
                <th className="num">Revenue</th>
                <th className="num">Fees</th>
                <th className="num">Costs</th>
                <th className="num">Profit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <tr key={o.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{shortDate(o.date)}</td>
                  <td>
                    <b>{o.orderId}</b>
                    {o.buyer ? <div className="muted small">{o.buyer}</div> : null}
                  </td>
                  <td><span className={"badge " + o.platform}>{o.platform === "shopify" ? "Shopify" : "Etsy"}</span></td>
                  <td style={{ maxWidth: 320 }}>
                    {o.items.length
                      ? o.items.map((it, i) => (
                          <div key={i} className="small" style={{ color: "var(--text-2)" }}>
                            {it.qty}× {it.name}{it.sku ? <span className="muted"> [{it.sku}]</span> : null}
                          </div>
                        ))
                      : <span className="muted small">{o.numItems ? o.numItems + " item(s) — import the Etsy order-items CSV for detail" : "—"}</span>}
                    {o.cogs.unmatched > 0 && <span className="badge yellow" style={{ marginTop: 3 }}>no cost rule</span>}
                  </td>
                  <td className="num">{money(o.revenue, currency)}</td>
                  <td className="num">{money(o.fees.total, currency)}</td>
                  <td className="num">{money(o.cogs.total, currency)}</td>
                  <td className={"num " + (o.profit >= 0 ? "pos" : "neg")}>{money(o.profit, currency)}</td>
                  <td className="num">
                    <button className="btn small danger" onClick={() => removeOrder(o.id)} title="Remove this order">✕</button>
                  </td>
                </tr>
              ))}
              {!pageRows.length && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 30 }}>No orders match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="row mt" style={{ justifyContent: "center" }}>
            <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
            <span className="muted small">Page {page + 1} of {pages}</span>
            <button className="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

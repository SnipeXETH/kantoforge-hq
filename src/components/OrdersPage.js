import React, { useMemo, useRef, useState } from "react";
import { importCsvText, mergeOrders, FORMAT_LABELS } from "../lib/csv";
import { enrichAll } from "../lib/calc";
import { money, shortDate, monthKey } from "../lib/format";
import { supabase } from "../lib/supabase";

function ShopifySyncCard({ db, refetch }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const sync = db.settings.shopifySync;

  const runSync = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session && data.session.access_token;

      // The server syncs in resumable ~40s chunks and saves its place after
      // every page, so we keep calling until it reports done.
      let total = 0;
      let done = false;
      let mode = "backfill";
      let timeouts = 0;
      for (let round = 0; round < 80 && !done; round++) {
        const resp = await fetch("/api/sync-shopify", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
        let body = null;
        try {
          body = await resp.json();
        } catch (e) {
          body = null;
        }
        if (!body) {
          // 504 = the chunk itself timed out; progress is saved, so retry.
          if ((resp.status === 504 || resp.status === 502) && timeouts < 5) {
            timeouts++;
            setResult(`Still syncing — picking up where it left off (${total} orders so far)…`);
            continue;
          }
          throw new Error("Sync endpoint not reachable (" + resp.status + "). It runs on the Vercel deployment, not on local dev servers.");
        }
        if (!body.ok) {
          if (body.missing && body.missing.length) {
            setShowHelp(true);
            throw new Error("Not configured yet — missing: " + body.missing.join(", ") + ". Setup steps below.");
          }
          throw new Error(body.error || "Sync failed.");
        }
        total += body.fetched;
        done = body.done !== false;
        mode = body.mode || mode;
        if (!done) setResult(`Syncing… ${total} orders so far, still going.`);
      }
      setResult(`Pulled ${total} order${total === 1 ? "" : "s"} from Shopify (${mode === "backfill" ? "history backfill complete" : "changes since last sync"}).`);
      await refetch();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mt">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2><span className="badge shopify">Shopify</span> automatic sync</h2>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            Pulls every order straight from Shopify — website sales and Etsy orders alike (the “Etsy” tag sorts them
            into channels). No CSVs needed. Also runs automatically every night at 3am.
            {sync && sync.lastSyncAt ? <> Last sync: <b>{new Date(sync.lastSyncAt).toLocaleString("en-GB")}</b> ({sync.lastFetched} orders).</> : " Never synced yet."}
          </div>
        </div>
        <span className="row">
          <button className="btn small" onClick={() => setShowHelp(!showHelp)}>{showHelp ? "Hide setup" : "Setup guide"}</button>
          <button className="btn primary" onClick={runSync} disabled={busy}>{busy ? "Syncing…" : "⟳ Sync Shopify now"}</button>
        </span>
      </div>
      {result && <div className="notice good mt">✅ {result}</div>}
      {error && <div className="notice bad mt">⚠️ {error}</div>}
      {showHelp && (
        <div className="notice mt" style={{ lineHeight: 1.7 }}>
          <b>One-time setup (~5 minutes):</b>
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>Shopify admin → <b>Settings → Apps and sales channels → Develop apps</b> → Allow custom app development → <b>Create an app</b> (name it "KantoForge HQ").</li>
            <li>In the app: <b>Configuration → Admin API integration</b> → tick <b>read_orders</b> (and <b>read_all_orders</b> if listed, for history beyond 60 days) → Save.</li>
            <li><b>API credentials</b> tab → Install app → reveal the <b>Admin API access token</b> (starts <code>shpat_</code>) — copy it, it's shown once.</li>
            <li>Vercel → your project → <b>Settings → Environment Variables</b>, add:
              <div style={{ fontFamily: "monospace", fontSize: 12, margin: "4px 0" }}>
                SHOPIFY_STORE_DOMAIN = your-store.myshopify.com<br />
                SHOPIFY_ADMIN_TOKEN = shpat_…<br />
                SUPABASE_SERVICE_ROLE_KEY = (Supabase → Settings → API → service_role)<br />
                CRON_SECRET = any long random text
              </div>
            </li>
            <li>Vercel → <b>Deployments</b> → redeploy the latest, then press <b>Sync Shopify now</b>. First run pulls your full history.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 50;

// --- order-data coverage grid ------------------------------------------------
const COVERAGE_START_YEAR = 2021;
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function CoverageCard({ db, update }) {
  const marks = db.settings.coverageMarks || {};

  const counts = useMemo(() => {
    const m = new Map();
    for (const o of db.orders) {
      const k = o.date ? monthKey(o.date) : null;
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [db.orders]);

  const now = new Date();
  const curIdx = now.getFullYear() * 12 + now.getMonth();
  const years = [];
  for (let y = now.getFullYear(); y >= COVERAGE_START_YEAR; y--) years.push(y);

  let missing = 0;
  for (let idx = COVERAGE_START_YEAR * 12; idx <= curIdx; idx++) {
    const mk = Math.floor(idx / 12) + "-" + String((idx % 12) + 1).padStart(2, "0");
    if (!counts.get(mk) && !marks[mk + ":any"]) missing++;
  }

  const toggleMark = (mk) => {
    const key = mk + ":any";
    update((d) => {
      const cm = { ...(d.settings.coverageMarks || {}) };
      if (cm[key]) delete cm[key];
      else cm[key] = true;
      return { ...d, settings: { ...d.settings, coverageMarks: cm } };
    });
  };

  return (
    <div className="card mt">
      <h2>Order data by month</h2>
      <div className="card-sub">
        Which months have orders loaded, back to {COVERAGE_START_YEAR}. Red dashed months have nothing yet — if a month
        genuinely had no sales, click it to mark it “no sales” (click again to unmark).
      </div>
      <div className="row mb">
        <span className={"badge " + (missing === 0 ? "green" : "yellow")}>
          {missing === 0 ? "Complete ✓ — every month covered" : missing + " month" + (missing === 1 ? "" : "s") + " missing"}
        </span>
      </div>
      <div className="table-wrap">
        <div className="cov-grid">
          {years.map((y) => (
            <div className="cov-year" key={y}>
              <div className="cov-label">
                <div>{y}</div>
              </div>
              <div className="cov-months">
                {MONTH_LETTERS.map((letter, m) => {
                  const mk = y + "-" + String(m + 1).padStart(2, "0");
                  const future = y * 12 + m > curIdx;
                  const count = counts.get(mk) || 0;
                  const marked = !!marks[mk + ":any"];
                  const cls = future ? "future" : count ? "covered shopify" : marked ? "marked" : "missing";
                  const title = future
                    ? MONTH_NAMES[m] + " " + y + " — in the future"
                    : count
                    ? `${MONTH_NAMES[m]} ${y} — ${count} order${count === 1 ? "" : "s"} loaded`
                    : marked
                    ? `${MONTH_NAMES[m]} ${y} — marked as no sales (click to unmark)`
                    : `${MONTH_NAMES[m]} ${y} — no order data yet (click to mark as no sales)`;
                  return (
                    <div className="cov-col" key={m}>
                      <div className="cov-head">{letter}</div>
                      <button
                        type="button"
                        className={"cov-cell " + cls}
                        title={title}
                        disabled={future || count > 0}
                        onClick={() => toggleMark(mk)}
                      >
                        {future ? "" : count ? "✓" : marked ? "–" : "!"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="legend">
        <span className="li"><span className="cov-cell covered shopify" style={{ width: 18 }}>✓</span> loaded</span>
        <span className="li"><span className="cov-cell missing" style={{ width: 18 }}>!</span> missing</span>
        <span className="li"><span className="cov-cell marked" style={{ width: 18 }}>–</span> marked no sales</span>
      </div>
    </div>
  );
}

export default function OrdersPage({ db, update, refetch }) {
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
    // Etsy orders from the cutover date onwards already live in Shopify —
    // drop them from Etsy CSV imports so the same sale isn't counted twice.
    const cutover = db.settings.etsyCutover ? new Date(db.settings.etsyCutover).toISOString() : null;
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        const { format, orders: parsed } = importCsvText(text);
        let incoming = parsed;
        let skipped = 0;
        if (cutover && format.startsWith("etsy")) {
          incoming = parsed.filter((o) => !o.date || o.date < cutover);
          skipped = parsed.length - incoming.length;
        }
        const merged = mergeOrders(orders, incoming);
        orders = merged.orders;
        summaries.push(
          `${file.name}: ${FORMAT_LABELS[format]} — ${merged.added} new, ${merged.updated} updated` +
            (skipped ? ` (${skipped} skipped: on/after ${shortDate(cutover)} they come from Shopify instead)` : "")
        );
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
          <h1>Orders</h1>
          <div className="sub">
            Everything flows from Shopify — website sales and Etsy orders (tagged “Etsy”) alike. Re-syncing and
            re-importing are always safe: orders merge by number, never duplicate.
          </div>
        </div>
      </div>

      <ShopifySyncCard db={db} refetch={refetch} />

      <div
        className={"dropzone mt" + (drag ? " over" : "")}
        onClick={() => fileRef.current && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      >
        <div className="big">Or drop CSV files here (as many as you like)</div>
        <div className="small">
          Shopify exports (Admin → Orders → Export) work as an alternative to the sync above.
          Etsy CSVs are only needed for history before <b>{shortDate(db.settings.etsyCutover)}</b> (when Etsy orders
          started flowing into Shopify) — anything newer in them is skipped automatically.
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
              {[["all", "All"], ["shopify", "Website"], ["etsy", "Etsy"]].map(([k, l]) => (
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
                <th>Channel</th>
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
                  <td><span className={"badge " + o.platform}>{o.platform === "shopify" ? "Website" : "Etsy"}</span></td>
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
